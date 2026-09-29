/**
 * AVOC Web Visualizer & Frontend Controller
 * Connects to Python simulation engine, renders 60 FPS Canvas with LHT mixed-traffic road,
 * manages prioritized audio queue, and updates the Safety Brain HUD.
 */

// Simulation Configuration
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const PIXELS_PER_METER = 16.0;

class AudioController {
  constructor() {
    this.speechSynth = 'speechSynthesis' in window ? window.speechSynthesis : null;
    this.audioCtx = null;
    this.isMuted = false;
    this.isSpeaking = false;
    this.currentPriority = 0; // 1: INFO, 2: WARNING, 3: CRITICAL
    this.lastSpokenText = '';
    this.lastSpokenTime = 0;
    this.queue = [];
  }

  initAudioContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.audioCtx = new AudioCtx();
    }
  }

  playChime(type) {
    if (this.isMuted) return;
    try {
      this.initAudioContext();
      if (!this.audioCtx) return;

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      if (type === 'CRITICAL') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1100, now + 0.08);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
      } else if (type === 'WARNING') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(550, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.22);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, now);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      }
    } catch (e) {
      // Audio not supported or blocked by autoplay policy
    }
  }

  speak(text, priority = 'INFO') {
    if (!text) return;
    try {
      const pMap = { INFO: 1, WARNING: 2, CRITICAL: 3 };
      const pLevel = pMap[priority] || 1;

      const now = Date.now();
      if (this.lastSpokenText === text && (now - this.lastSpokenTime) < 2500) {
        return;
      }
      this.lastSpokenText = text;
      this.lastSpokenTime = now;

      this.playChime(priority);

      if (this.isMuted || !this.speechSynth) return;

      if (pLevel === 3 && this.isSpeaking) {
        try { this.speechSynth.cancel(); } catch (e) {}
        this.queue = [];
        this.isSpeaking = false;
      } else if (this.isSpeaking && pLevel <= this.currentPriority) {
        return;
      }

      this.queue.push({ text, pLevel });
      this.processQueue();
    } catch (e) {
      // Ignore speech synth error
    }
  }

  processQueue() {
    if (this.isSpeaking || this.queue.length === 0 || this.isMuted) return;

    try {
      const item = this.queue.shift();
      this.isSpeaking = true;
      this.currentPriority = item.pLevel;

      const utterance = new SpeechSynthesisUtterance(item.text);
      this.currentUtterance = utterance;
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.lang = 'en-US';

      const clearSpeaking = () => {
        if (this.currentUtterance === utterance) {
          this.isSpeaking = false;
          this.currentPriority = 0;
          this.currentUtterance = null;
          setTimeout(() => this.processQueue(), 120);
        }
      };

      utterance.onend = clearSpeaking;
      utterance.onerror = clearSpeaking;

      setTimeout(() => {
        if (this.isSpeaking && this.currentUtterance === utterance) {
          clearSpeaking();
        }
      }, 4000);

      this.speechSynth.speak(utterance);
    } catch (e) {
      this.isSpeaking = false;
      this.currentPriority = 0;
      this.currentUtterance = null;
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.isMuted && this.speechSynth) {
      try { this.speechSynth.cancel(); } catch (e) {}
      this.isSpeaking = false;
      this.queue = [];
    }
    return this.isMuted;
  }
}

class App {
  constructor() {
    this.canvas = document.getElementById('simCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.audio = new AudioController();

    this.isPlaying = true;
    this.simSpeed = 1.0;
    this.dashOffset = 0;
    this.lidarSweepAngle = 0;

    this.state = null;
    this.lastTimestamp = performance.now();
    this.lastVoiceLogged = '';

    // Sensor Toggles
    this.showLidar = true;
    this.showTrajectory = true;
    this.showBlindspot = true;
    this.showMemory = true;

    // Atmospheric Weather System
    this.weatherMode = 'CLEAR'; // 'CLEAR', 'NIGHT', 'FOG', 'RAIN'
    this.rainParticles = [];
    for (let i = 0; i < 120; i++) {
      this.rainParticles.push({
        x: Math.random() * CANVAS_WIDTH,
        y: Math.random() * CANVAS_HEIGHT,
        speed: 14 + Math.random() * 10,
        length: 12 + Math.random() * 10,
        drift: -1.8,
      });
    }
    this.fogAnimOffset = 0;

    // Concurrency & Smooth Stepping Controls (eliminates frame jitter)
    this.isStepping = false;
    this.isSwitching = false;
    this.activeStepController = null;
    this.stepStartTime = 0;
    this.accumulatedDt = 0;
    this.lastSeqId = 0;
    this.lastHudUpdate = 0;
    this.cachedHud = {};

    // Offscreen Canvas for Double Buffering (eliminates canvas tearing/flickering)
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = CANVAS_WIDTH;
    this.offscreenCanvas.height = CANVAS_HEIGHT;
    this.offscreenCtx = this.offscreenCanvas.getContext('2d');

    this.initCanvasSize();
    this.setupEventListeners();
    this.loadInitialState();
    this.startRenderLoop();
  }

  initCanvasSize() {
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    if (this.offscreenCanvas) {
      this.offscreenCanvas.width = CANVAS_WIDTH;
      this.offscreenCanvas.height = CANVAS_HEIGHT;
    }
  }

  setupEventListeners() {
    window.addEventListener('resize', () => this.initCanvasSize());

    // Play/Pause
    const playBtn = document.getElementById('btnPlayPause');
    playBtn.addEventListener('click', () => {
      this.isPlaying = !this.isPlaying;
      document.getElementById('playIcon').textContent = this.isPlaying ? '⏸' : '▶';
      document.getElementById('playText').textContent = this.isPlaying ? 'Pause' : 'Play';
      const simStatusEl = document.getElementById('simStatusBadge');
      if (simStatusEl) {
        simStatusEl.textContent = this.isPlaying ? 'RUNNING' : 'PAUSED';
        simStatusEl.className = this.isPlaying
          ? 'px-2 py-0.5 rounded text-[9.5px] bg-emerald-950/60 text-[#10B981] border border-[#10B981]/40 font-bold font-mono'
          : 'px-2 py-0.5 rounded text-[9.5px] bg-amber-950/60 text-[#F59E0B] border border-[#F59E0B]/40 font-bold font-mono';
      }
    });

    // Reset
    document.getElementById('btnReset').addEventListener('click', () => {
      this.resetScenario();
    });

    // Speed buttons
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget || e.target;
        document.querySelectorAll('.speed-btn').forEach(b => {
          b.classList.remove('active', 'bg-[#7C3AED]', 'bg-sky-600', 'text-white', 'font-bold');
          b.classList.add('bg-[#0A1222]', 'text-[#94A3B8]');
        });
        target.classList.remove('bg-[#0A1222]', 'bg-[#0C1426]', 'text-[#94A3B8]', 'bg-slate-800', 'text-slate-300');
        target.classList.add('active', 'bg-[#7C3AED]', 'text-white', 'font-bold');
        this.simSpeed = parseFloat(target.dataset.speed);
      });
    });

    // Mute button
    const muteBtn = document.getElementById('muteBtn');
    muteBtn.addEventListener('click', () => {
      const isMuted = this.audio.toggleMute();
      document.getElementById('muteIcon').textContent = isMuted ? '🔇' : '🔊';
      document.getElementById('muteLabel').textContent = isMuted ? 'Voice: OFF' : 'Voice: ON';
    });

    // Sensor Layer Toggles
    document.getElementById('toggleLidar').addEventListener('change', (e) => {
      this.showLidar = e.target.checked;
    });
    document.getElementById('toggleTrajectory').addEventListener('change', (e) => {
      this.showTrajectory = e.target.checked;
    });
    document.getElementById('toggleBlindspot').addEventListener('change', (e) => {
      this.showBlindspot = e.target.checked;
    });
    document.getElementById('toggleMemory').addEventListener('change', (e) => {
      this.showMemory = e.target.checked;
    });

    // Dynamic Hazard Injection Buttons
    document.querySelectorAll('.inject-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const hazard = e.currentTarget.dataset.hazard;
        this.injectHazard(hazard);
      });
    });

    // Weather Selection Deck
    document.querySelectorAll('#weatherDeck .weather-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = e.currentTarget.dataset.weather;
        this.weatherMode = mode;
        document.querySelectorAll('#weatherDeck .weather-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
      });
    });
  }

  async injectHazard(hazard) {
    if (this.activeStepController) {
      try { this.activeStepController.abort(); } catch (e) {}
      this.activeStepController = null;
    }
    this.isSwitching = true;
    this.isStepping = false;
    this.accumulatedDt = 0;
    try {
      const res = await fetch(`/api/inject/${hazard}`, { method: 'POST' });
      if (res.ok) {
        const newState = await res.json();
        if (newState && newState.scenario) {
          this.state = newState;
          this.lastSeqId = newState.seqId || 0;
          this.renderScenarioTabs();
          this.updateHud();
        }
      }
    } catch (err) {
      console.error('Failed to inject hazard', err);
    } finally {
      this.isSwitching = false;
      this.isStepping = false;
    }
  }

  async loadInitialState() {
    try {
      const res = await fetch('/api/state');
      if (res.ok) {
        const newState = await res.json();
        if (newState && newState.scenario) {
          this.state = newState;
          this.lastSeqId = newState.seqId || 0;
          this.accumulatedDt = 0;
          this.renderScenarioTabs();
          this.updateHud();
        }
      }
    } catch (err) {
      console.warn('API error, retrying...', err);
    }
  }

  async selectScenario(index) {
    if (this.activeStepController) {
      try { this.activeStepController.abort(); } catch (e) {}
      this.activeStepController = null;
    }
    this.isSwitching = true;
    this.isStepping = false;
    this.accumulatedDt = 0;
    try {
      const res = await fetch(`/api/scenario/${index}`, { method: 'POST' });
      if (res.ok) {
        const newState = await res.json();
        if (newState && newState.scenario) {
          this.state = newState;
          this.lastSeqId = newState.seqId || 0;
          this.renderScenarioTabs();
          this.updateHud();
        }
      }
    } catch (err) {
      console.error('Failed to switch scenario', err);
    } finally {
      this.isSwitching = false;
      this.isStepping = false;
    }
  }

  async resetScenario() {
    if (this.activeStepController) {
      try { this.activeStepController.abort(); } catch (e) {}
      this.activeStepController = null;
    }
    this.isSwitching = true;
    this.isStepping = false;
    this.accumulatedDt = 0;
    try {
      const res = await fetch('/api/reset', { method: 'POST' });
      if (res.ok) {
        const newState = await res.json();
        if (newState && newState.scenario) {
          this.state = newState;
          this.lastSeqId = newState.seqId || 0;
          this.renderScenarioTabs();
          this.updateHud();
        }
      }
    } catch (err) {
      console.error('Failed to reset scenario', err);
    } finally {
      this.isSwitching = false;
      this.isStepping = false;
    }
  }

  async stepBackend() {
    const now = performance.now();
    // Safety Watchdog: If step request hung for > 1500ms, forcibly release lock
    if (this.isStepping && (now - this.stepStartTime) > 1500) {
      if (this.activeStepController) {
        try { this.activeStepController.abort(); } catch (e) {}
        this.activeStepController = null;
      }
      this.isStepping = false;
    }

    // Regulate network stepping to stable ~30 Hz (0.028s) to prevent socket flooding
    if (this.isSwitching || this.isStepping || this.accumulatedDt < 0.028) return;
    this.isStepping = true;
    this.stepStartTime = now;
    const sendDt = this.accumulatedDt;
    this.accumulatedDt = 0;

    const controller = new AbortController();
    this.activeStepController = controller;
    const timeoutId = setTimeout(() => controller.abort(), 1200);

    try {
      const res = await fetch('/api/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dt: sendDt }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const newState = await res.json();
        if (newState && !this.isSwitching) {
          // Accept newer frame or server restart/reset
          if (this.lastSeqId === 0 || newState.seqId === undefined || newState.seqId >= this.lastSeqId || newState.seqId < (this.lastSeqId - 50)) {
            this.lastSeqId = newState.seqId || 0;
            this.state = newState;
          }
        }
      }
    } catch (err) {
      // Backend step timeout or network drop - recover gracefully
    } finally {
      clearTimeout(timeoutId);
      if (this.activeStepController === controller) {
        this.activeStepController = null;
      }
      this.isStepping = false;
    }
  }

  renderScenarioTabs() {
    const container = document.getElementById('scenarioTabs');
    if (!container || !this.state || !this.state.scenario) return;

    const scenarios = [
      { id: 0, label: '⚡ Auto Mode' },
      { id: 1, label: '🏍️ 1. Bike Cut-In' },
      { id: 2, label: '🚶 2. Pedestrian' },
      { id: 3, label: '⛔ 3. Wrong-Way' },
      { id: 4, label: '👮 4. Police Stop' },
      { id: 5, label: '⚠️ 5. Obstacle Swerve' },
      { id: 6, label: '🚦 6. Busy Junction' },
      { id: 7, label: '🚑 7. Emergency Yield' },
    ];

    if (!this.tabsInitialized) {
      container.innerHTML = '';
      scenarios.forEach(scen => {
        const btn = document.createElement('button');
        btn.id = `tab-scen-${scen.id}`;
        btn.className = 'scen-tab-btn';
        btn.textContent = scen.label;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this.selectScenario(scen.id);
        });
        container.appendChild(btn);
      });
      this.tabsInitialized = true;
    }

    const currentIdx = this.state.scenario.currentIndex;
    scenarios.forEach(scen => {
      const btn = document.getElementById(`tab-scen-${scen.id}`);
      if (btn) {
        if (currentIdx === scen.id) {
          btn.className = 'scen-tab-btn active';
        } else {
          btn.className = 'scen-tab-btn';
        }
      }
    });
  }

  startRenderLoop() {
    const loop = (timestamp) => {
      // Always schedule next frame first to guarantee loop never stops
      requestAnimationFrame(loop);

      const rawDt = (timestamp - this.lastTimestamp) / 1000;
      this.lastTimestamp = timestamp;
      const dt = Math.min(rawDt, 0.05) * this.simSpeed;

      if (this.isPlaying && this.state) {
        this.accumulatedDt += dt;
        this.stepBackend();
        this.lidarSweepAngle = (this.lidarSweepAngle + dt * 4.5) % (Math.PI * 2);
        const egoSpeed = this.state.ego ? this.state.ego.speed : 0;
        this.dashOffset = (this.dashOffset + egoSpeed * PIXELS_PER_METER * dt) % 40;
      }

      if (this.state) {
        try {
          this.render();
        } catch (err) {
          console.error('Render error:', err);
        }

        const now = performance.now();
        if (now - this.lastHudUpdate >= 33) {
          try {
            this.updateHud();
          } catch (err) {
            console.error('HUD error:', err);
          }
          this.lastHudUpdate = now;
        }
      }
    };

    requestAnimationFrame(loop);
  }

  // ==========================================
  // CANVAS RENDERING (75% Road Viewport)
  // Double-buffered: renders to offscreen canvas,
  // then blits atomically to visible canvas.
  // ==========================================
  render() {
    const ctx = this.offscreenCtx || this.ctx;
    const road = this.state.road;
    const ego = this.state.ego;
    const entities = this.state.entities;
    const isJunction = this.state.scenario.id === 'SCENARIO_4_TRAFFIC_POLICE' || this.state.scenario.id === 'SCENARIO_6_BUSY_JUNCTION' || (this.state.autoStats && this.state.autoStats.showJunction);

    // 1. Terrain: Deep Charcoal background (#121316) with subtle dark navy coordinate grid
    ctx.fillStyle = '#121316';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Subtle dark navy coordinate grid on outer terrain
    const roadL = road.road_left_edge - 30;
    const roadR = road.road_right_edge + 30;
    ctx.fillStyle = 'rgba(30, 45, 74, 0.45)';
    for (let gx = 25; gx < CANVAS_WIDTH; gx += 45) {
      if (gx >= roadL && gx <= roadR) continue;
      for (let gy = 25; gy < CANVAS_HEIGHT; gy += 45) {
        ctx.fillRect(gx - 1, gy - 1, 2, 2);
      }
    }

    // 2. Road Shoulder & Curbs
    const roadW = (road.road_right_edge - road.road_left_edge);
    ctx.fillStyle = '#262A33';
    ctx.fillRect(road.road_left_edge - 30, 0, roadW + 60, CANVAS_HEIGHT);

    // Curbs: Dark Slate and Amber markers
    const curbH = 30;
    const curbCount = Math.ceil(CANVAS_HEIGHT / curbH) + 1;
    for (let i = 0; i < curbCount; i++) {
      const y = (i * curbH) - (this.dashOffset % curbH);
      ctx.fillStyle = i % 2 === 0 ? '#333742' : '#F59E0B';
      ctx.fillRect(road.road_left_edge - 8, y, 8, curbH);
      ctx.fillRect(road.road_right_edge, y, 8, curbH);
    }

    // 3. Main Asphalt Road Surface (Professional Medium Gray road)
    ctx.fillStyle = '#3A3F4B';
    ctx.fillRect(road.road_left_edge, 0, roadW, CANVAS_HEIGHT);

    // 4. Junction Cross Street (Scenarios 4 & 6, and Auto Junction)
    if (isJunction) {
      const jY = 280;
      const jH = 150;
      ctx.fillStyle = '#3A3F4B';
      ctx.fillRect(0, jY - (jH / 2), CANVAS_WIDTH, jH);

      // Zebra Crossings
      ctx.fillStyle = '#F3F4F6';
      const stripeW = 8;
      const gap = 6;
      const count = Math.floor(roadW / (stripeW + gap));
      const northY = jY - (jH / 2) - 18;
      const southY = jY + (jH / 2) + 4;
      for (let i = 0; i < count; i++) {
        const x = road.road_left_edge + (i * (stripeW + gap)) + 4;
        ctx.fillRect(x, northY, stripeW, 14);
        ctx.fillRect(x, southY, stripeW, 14);
      }
    }

    // Zebra Crossing for Pedestrian Scenarios
    if (this.state.scenario.id === 'SCENARIO_2_PEDESTRIAN' || (this.state.autoStats && this.state.autoStats.showZebra)) {
      const crossY = 240;
      ctx.fillStyle = '#F3F4F6';
      const stripeW = 10;
      const gap = 7;
      const count = Math.floor(roadW / (stripeW + gap));
      for (let i = 0; i < count; i++) {
        const x = road.road_left_edge + (i * (stripeW + gap)) + 4;
        ctx.fillRect(x, crossY - 14, stripeW, 28);
      }
      // Curb crossing beacons (Amber)
      ctx.fillStyle = '#F59E0B';
      ctx.beginPath();
      ctx.arc(road.road_left_edge - 12, crossY, 6, 0, Math.PI * 2);
      ctx.arc(road.road_right_edge + 12, crossY, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Solid Edge Lines (Clean Crisp Light Gray / Off-White)
    ctx.strokeStyle = '#9CA3AF';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(road.road_left_edge, 0);
    ctx.lineTo(road.road_left_edge, CANVAS_HEIGHT);
    ctx.moveTo(road.road_right_edge, 0);
    ctx.lineTo(road.road_right_edge, CANVAS_HEIGHT);
    ctx.stroke();

    // 6. Yellow Center Divider (Left-Hand Traffic separator)
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([22, 14]);
    ctx.lineDashOffset = -this.dashOffset;
    ctx.beginPath();
    if (!isJunction) {
      ctx.moveTo(road.road_center_x, 0);
      ctx.lineTo(road.road_center_x, CANVAS_HEIGHT);
    } else {
      ctx.moveTo(road.road_center_x, 0);
      ctx.lineTo(road.road_center_x, 205);
      ctx.moveTo(road.road_center_x, 355);
      ctx.lineTo(road.road_center_x, CANVAS_HEIGHT);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Lane Direction Labels
    ctx.fillStyle = 'rgba(241, 245, 249, 0.45)';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('▲ LHT DRIVE (AUTONOMOUS LANE)', road.lane_left_x, 690);
    ctx.fillText('▼ ONCOMING LANE', road.lane_right_x, 690);

    // Weather Underlay Effects (Street lamps, wet asphalt sheen)
    this.renderWeatherUnderlay(ctx, road, ego);

    // 7. Sensor & Memory Layers
    if (this.showMemory && this.state.roadMemory) {
      this.renderRoadMemoryOverlay(ctx, road, ego, this.state.roadMemory);
    }

    if (this.showBlindspot) {
      this.renderBlindspotEnvelope(ctx, ego, this.state.evaluation.blindspotStatus);
    }

    if (this.showTrajectory) {
      this.renderTrajectories(ctx, ego, entities);
    }

    if (this.showLidar) {
      this.renderLidarPulse(ctx, ego);
    }

    // 8. Detected Entities
    for (const entity of entities) {
      this.renderEntity(ctx, entity);
    }

    // 9. Ego Autonomous Vehicle
    this.renderEgoVehicle(ctx, ego);

    // Weather Overlay Effects (Night atmospheric darkness, fog mist, falling rain)
    this.renderWeatherOverlay(ctx, road, ego);

    // Blit completed offscreen frame to visible canvas atomically
    if (this.offscreenCanvas && this.ctx) {
      this.ctx.drawImage(this.offscreenCanvas, 0, 0);
    }
  }

  renderWeatherUnderlay(ctx, road, ego) {
    if (this.weatherMode === 'NIGHT') {
      ctx.save();
      // Street Lamps along road edges
      const lampInterval = 140;
      const count = Math.ceil(CANVAS_HEIGHT / lampInterval) + 1;
      for (let i = 0; i < count; i++) {
        const ly = (i * lampInterval) - (this.dashOffset % lampInterval);
        
        // Left Curb Lamp
        const leftGrad = ctx.createRadialGradient(road.road_left_edge - 14, ly, 4, road.road_left_edge - 14, ly, 90);
        leftGrad.addColorStop(0, 'rgba(251, 191, 36, 0.45)');
        leftGrad.addColorStop(0.5, 'rgba(245, 158, 11, 0.15)');
        leftGrad.addColorStop(1, 'rgba(245, 158, 11, 0)');
        ctx.fillStyle = leftGrad;
        ctx.beginPath();
        ctx.arc(road.road_left_edge - 14, ly, 90, 0, Math.PI * 2);
        ctx.fill();

        // Left Lamp Post fixture
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.arc(road.road_left_edge - 14, ly, 4, 0, Math.PI * 2);
        ctx.fill();

        // Right Curb Lamp
        const rightGrad = ctx.createRadialGradient(road.road_right_edge + 14, ly, 4, road.road_right_edge + 14, ly, 90);
        rightGrad.addColorStop(0, 'rgba(251, 191, 36, 0.45)');
        rightGrad.addColorStop(0.5, 'rgba(245, 158, 11, 0.15)');
        rightGrad.addColorStop(1, 'rgba(245, 158, 11, 0)');
        ctx.fillStyle = rightGrad;
        ctx.beginPath();
        ctx.arc(road.road_right_edge + 14, ly, 90, 0, Math.PI * 2);
        ctx.fill();

        // Right Lamp Post fixture
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.arc(road.road_right_edge + 14, ly, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else if (this.weatherMode === 'RAIN') {
      ctx.save();
      // Wet Asphalt Specular Sheen on road
      const roadW = road.road_right_edge - road.road_left_edge;
      const rainSheenGrad = ctx.createLinearGradient(road.road_left_edge, 0, road.road_right_edge, 0);
      rainSheenGrad.addColorStop(0, 'rgba(147, 197, 253, 0.08)');
      rainSheenGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.12)');
      rainSheenGrad.addColorStop(0.7, 'rgba(147, 197, 253, 0.08)');
      rainSheenGrad.addColorStop(1, 'rgba(255, 255, 255, 0.04)');
      ctx.fillStyle = rainSheenGrad;
      ctx.fillRect(road.road_left_edge, 0, roadW, CANVAS_HEIGHT);

      // Tire Spray Mist behind ego vehicle
      if (ego) {
        ctx.fillStyle = 'rgba(224, 242, 254, 0.22)';
        ctx.beginPath();
        ctx.ellipse(ego.x, ego.y + (ego.lengthPx / 2) + 18, ego.widthPx * 0.9, 14, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  renderWeatherOverlay(ctx, road, ego) {
    if (this.weatherMode === 'NIGHT') {
      ctx.save();
      // Atmospheric Night Darkness Tint
      ctx.fillStyle = 'rgba(5, 8, 18, 0.62)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Night Mode HUD Badge on Canvas
      ctx.fillStyle = 'rgba(245, 158, 11, 0.9)';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText('🌙 ATMOSPHERIC NIGHT MODE [HEADLIGHT ILLUMINATION ON]', CANVAS_WIDTH - 25, 30);
      ctx.restore();

    } else if (this.weatherMode === 'RAIN') {
      ctx.save();
      // Falling Rain Drops Particle System
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.65)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (const p of this.rainParticles) {
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + (p.drift * (p.length / 5)), p.y + p.length);
        p.y += p.speed;
        p.x += p.drift;
        if (p.y > CANVAS_HEIGHT) {
          p.y = -15;
          p.x = Math.random() * CANVAS_WIDTH;
        }
        if (p.x < 0) {
          p.x = CANVAS_WIDTH;
        }
      }
      ctx.stroke();

      // Atmospheric Rain Tint
      ctx.fillStyle = 'rgba(14, 30, 56, 0.15)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Rain Status Tag
      ctx.fillStyle = '#38BDF8';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText('🌧️ MONSOON RAIN [WET ROADWAY FRICTION: 0.65]', CANVAS_WIDTH - 25, 30);
      ctx.restore();

    } else if (this.weatherMode === 'FOG') {
      ctx.save();
      this.fogAnimOffset = (this.fogAnimOffset || 0) + 0.4;

      // Volumetric translucent fog bands drifting across road
      for (let f = 0; f < 5; f++) {
        const fy = (f * 150) + (Math.sin((this.fogAnimOffset + f * 40) * 0.02) * 20);
        const fogGrad = ctx.createLinearGradient(0, fy, CANVAS_WIDTH, fy + 120);
        fogGrad.addColorStop(0, 'rgba(203, 213, 225, 0.22)');
        fogGrad.addColorStop(0.5, 'rgba(226, 232, 240, 0.35)');
        fogGrad.addColorStop(1, 'rgba(203, 213, 225, 0.18)');
        ctx.fillStyle = fogGrad;
        ctx.fillRect(0, fy, CANVAS_WIDTH, 120);
      }

      // Attenuated Sensor Range Boundary Ring
      if (ego) {
        ctx.strokeStyle = 'rgba(249, 115, 22, 0.75)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.arc(ego.x, ego.y, 20 * PIXELS_PER_METER, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#F97316';
        ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⚠️ FOG ATTENUATION HORIZON (SENSOR RANGE REDUCED: 20m)', ego.x, ego.y - (20 * PIXELS_PER_METER) - 8);
      }

      // Fog Status Tag
      ctx.fillStyle = '#CBD5E1';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText('🌫️ DENSE FOG [SENSOR VISIBILITY RESTRICTED]', CANVAS_WIDTH - 25, 30);
      ctx.restore();
    }
  }

  renderRoadMemoryOverlay(ctx, road, ego, roadMemory) {
    if (!roadMemory || !roadMemory.allFeatures) return;
    const roadW = (road.road_right_edge - road.road_left_edge);

    for (const feat of roadMemory.allFeatures) {
      const y = feat.y;
      const spanPx = feat.spanMeters * PIXELS_PER_METER;
      const isInside = roadMemory.hasActiveMemory && roadMemory.activeMemory && roadMemory.activeMemory.id === feat.id;

      ctx.save();
      // Holographic spatial prior bounding zone (Purple/Violet prior)
      ctx.fillStyle = isInside ? 'rgba(124, 58, 237, 0.16)' : 'rgba(124, 58, 237, 0.06)';
      ctx.fillRect(road.road_left_edge, y - (spanPx / 2), roadW, spanPx);

      ctx.strokeStyle = isInside ? 'rgba(45, 212, 191, 0.9)' : 'rgba(139, 92, 246, 0.45)';
      ctx.lineWidth = isInside ? 2 : 1.5;
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(road.road_left_edge, y - (spanPx / 2), roadW, spanPx);
      ctx.setLineDash([]);

      // Holographic Tag (Teal)
      ctx.fillStyle = isInside ? '#2DD4BF' : '#94A3B8';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      const label = `[PRIOR MEMORY: ${feat.title.toUpperCase()} | ${feat.confidence}% CONF]`;
      ctx.fillText(label, road.road_left_edge + 8, y - (spanPx / 2) - 6);

      // Pre-action tag on shoulder (Amber warning action)
      ctx.fillStyle = '#F59E0B';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText(`PRE-ACTION: ${feat.preAction}`, road.road_left_edge + 8, y - (spanPx / 2) + 14);

      if (isInside) {
        const pulse = (Date.now() * 0.003) % 1;
        ctx.strokeStyle = `rgba(45, 212, 191, ${1 - pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(road.road_left_edge, y - (spanPx / 2) + (pulse * spanPx));
        ctx.lineTo(road.road_right_edge, y - (spanPx / 2) + (pulse * spanPx));
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  renderLidarPulse(ctx, ego) {
    ctx.save();
    ctx.translate(ego.x, ego.y);

    // Range rings with technical distance annotations (Teal rings)
    const rings = [
      { r: 10 * PIXELS_PER_METER, label: '10m' },
      { r: 20 * PIXELS_PER_METER, label: '20m' },
      { r: 30 * PIXELS_PER_METER, label: '30m' }
    ];
    rings.forEach((ring, idx) => {
      ctx.strokeStyle = idx === 1 ? 'rgba(20, 184, 166, 0.35)' : 'rgba(20, 184, 166, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, ring.r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText(ring.label, ring.r + 3, 3);
    });

    // Spinning LiDAR Beam in Teal and Violet
    const beamLen = 32 * PIXELS_PER_METER;
    const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, beamLen);
    grad.addColorStop(0, 'rgba(20, 184, 166, 0.5)');
    grad.addColorStop(0.7, 'rgba(124, 58, 237, 0.15)');
    grad.addColorStop(1, 'rgba(20, 184, 166, 0)');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, beamLen, this.lidarSweepAngle - 0.22, this.lidarSweepAngle + 0.22);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  renderBlindspotEnvelope(ctx, ego, blindspot) {
    if (!blindspot) return;
    ctx.save();

    // Right adjacent lane collision safety zone
    const isRightClear = blindspot.is_right_clear;
    const envX = ego.x + (1.8 * PIXELS_PER_METER);
    const envW = 3.6 * PIXELS_PER_METER;
    const envY = ego.y - (16 * PIXELS_PER_METER);
    const envH = 28 * PIXELS_PER_METER;

    // Safety/Collision Zone: Green when clear, Red when occupied/dangerous
    ctx.fillStyle = isRightClear ? 'rgba(16, 185, 129, 0.14)' : 'rgba(239, 68, 68, 0.25)';
    ctx.strokeStyle = isRightClear ? '#10B981' : '#EF4444';
    ctx.lineWidth = isRightClear ? 1.5 : 2.5;
    ctx.setLineDash(isRightClear ? [6, 4] : []);

    ctx.fillRect(envX, envY, envW, envH);
    ctx.strokeRect(envX, envY, envW, envH);

    ctx.setLineDash([]);
    ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = isRightClear ? '#10B981' : '#EF4444';
    ctx.fillText(
      isRightClear ? '✓ ADJACENT CORRIDOR CLEAR (GREEN)' : '✗ BLINDSPOT HAZARD (RED)',
      envX + envW / 2,
      envY - 6
    );

    ctx.restore();
  }

  renderTrajectories(ctx, ego, entities) {
    const riskLevel = this.state.evaluation.riskLevel;
    const egoState = this.state.egoState;
    const decision = this.state.evaluation.decision || '';
    const nominalLaneX = this.state.road ? this.state.road.lane_left_x : 590;
    const isReplanning = (
      egoState === 'SAFE_REPOSITIONING' ||
      egoState === 'CHECKING_BLINDSPOT' ||
      egoState === 'RETURNING_TO_LANE' ||
      decision.includes('NUDGE') || decision.includes('EVADE') || decision.includes('REPLAN') ||
      (ego.targetX && Math.abs(ego.targetX - nominalLaneX) > 6)
    );

    // ========================================================
    // 1. SAFETY / COLLISION DYNAMIC ZONE (Ego Safety Cushion)
    // ========================================================
    ctx.save();
    const forwardCushion = Math.max(55, (ego.speed || 10) * 1.8 * PIXELS_PER_METER);
    const cushionW = ego.widthPx + 24;
    const cushionH = ego.lengthPx + forwardCushion;
    const cushionX = ego.x - (cushionW / 2);
    const cushionY = ego.y - (ego.lengthPx / 2) - forwardCushion + 8;

    let zoneFill = 'rgba(16, 185, 129, 0.08)';
    let zoneBorder = '#10B981';
    let zoneText = 'SAFETY ZONE [CLEAR: GREEN]';

    if (riskLevel === 'CRITICAL' || riskLevel === 'ELEVATED') {
      zoneFill = 'rgba(239, 68, 68, 0.22)';
      zoneBorder = '#EF4444';
      zoneText = 'COLLISION ZONE [DANGER: RED]';
    } else if (riskLevel === 'AWARENESS') {
      zoneFill = 'rgba(249, 115, 22, 0.15)';
      zoneBorder = '#F97316';
      zoneText = 'SAFETY BUFFER [CAUTION: ORANGE]';
    }

    ctx.fillStyle = zoneFill;
    ctx.strokeStyle = zoneBorder;
    ctx.lineWidth = (riskLevel === 'CRITICAL') ? 2.5 : 1.5;
    ctx.setLineDash((riskLevel === 'CRITICAL') ? [] : [6, 4]);
    ctx.beginPath();
    ctx.roundRect(cushionX, cushionY, cushionW, cushionH, 12);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = zoneBorder;
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(zoneText, ego.x, cushionY - 6);
    ctx.restore();

    // ========================================================
    // 2. CURRENT PLANNED PATH (Teal - Nominal Lane Corridor)
    // ========================================================
    ctx.save();
    const planHalfW = (ego.widthPx / 2) + 4;
    // Planned corridor ribbon (Teal)
    ctx.fillStyle = 'rgba(20, 184, 166, 0.12)';
    ctx.beginPath();
    ctx.rect(nominalLaneX - planHalfW, 60, planHalfW * 2, ego.y - 60);
    ctx.fill();

    // Planned path centerline (Teal)
    ctx.strokeStyle = '#2DD4BF';
    ctx.lineWidth = 2.8;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.moveTo(nominalLaneX, ego.y);
    ctx.lineTo(nominalLaneX, 70);
    ctx.stroke();
    ctx.setLineDash([]);

    // Planned route waypoint markers (Teal dots)
    ctx.fillStyle = '#2DD4BF';
    for (let py = ego.y - 45; py >= 90; py -= 55) {
      ctx.beginPath();
      ctx.arc(nominalLaneX, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Planned route destination pip (Teal)
    ctx.beginPath();
    ctx.arc(nominalLaneX, 70, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PLANNED ROUTE (TEAL)', nominalLaneX, 56);
    ctx.restore();

    // ========================================================
    // 3. REPLANNED / ALTERNATE PATH (Amber - Evasive Maneuver)
    // ========================================================
    if (isReplanning) {
      ctx.save();
      const targetX = ego.targetX || (nominalLaneX + 60);
      const startX = ego.x;
      const startY = ego.y;
      const endY = Math.max(90, ego.y - 250);

      const cp1X = startX;
      const cp1Y = startY - 70;
      const cp2X = targetX;
      const cp2Y = startY - 150;

      // Corridor ribbon (Amber)
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.30)';
      ctx.lineWidth = ego.widthPx + 8;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, targetX, endY);
      ctx.stroke();

      // Main Replanned centerline (Glowing Amber)
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 3.8;
      ctx.shadowColor = 'rgba(245, 158, 11, 0.7)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, targetX, endY);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Evasion waypoints along curve (Amber nodes)
      ctx.fillStyle = '#FEF08A';
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 2;
      [0.25, 0.5, 0.75, 1.0].forEach(t => {
        const bx = Math.pow(1-t, 3)*startX + 3*Math.pow(1-t, 2)*t*cp1X + 3*(1-t)*t*t*cp2X + Math.pow(t, 3)*targetX;
        const by = Math.pow(1-t, 3)*startY + 3*Math.pow(1-t, 2)*t*cp1Y + 3*(1-t)*t*t*cp2Y + Math.pow(t, 3)*endY;
        ctx.beginPath();
        ctx.arc(bx, by, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });

      // Evasion target marker
      ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#F59E0B';
      ctx.textAlign = 'center';
      ctx.fillText('REPLANNED ROUTE (AMBER)', targetX, endY - 10);
      ctx.restore();
    }

    // ========================================================
    // 4. PREDICTED TRAJECTORY (Safe: Green / Warning: Orange / Dangerous: Red)
    // ========================================================
    if (ego.trajectory && ego.trajectory.length > 0) {
      ctx.save();
      let trajColor = '#10B981'; // Safe: Green
      let trajFill = 'rgba(16, 185, 129, 0.16)';

      if (riskLevel === 'CRITICAL' || riskLevel === 'ELEVATED') {
        trajColor = '#EF4444'; // Dangerous: Red
        trajFill = 'rgba(239, 68, 68, 0.24)';
      } else if (riskLevel === 'AWARENESS') {
        trajColor = '#F97316'; // Warning: Orange
        trajFill = 'rgba(249, 115, 22, 0.18)';
      }

      // Predicted corridor ribbon
      const corridorHalfW = (ego.widthPx / 2) + 2;
      ctx.fillStyle = trajFill;
      ctx.beginPath();
      for (let i = 0; i < ego.trajectory.length; i++) {
        const p = ego.trajectory[i];
        if (i === 0) ctx.moveTo(p.x - corridorHalfW, p.y);
        else ctx.lineTo(p.x - corridorHalfW, p.y);
      }
      for (let i = ego.trajectory.length - 1; i >= 0; i--) {
        const p = ego.trajectory[i];
        ctx.lineTo(p.x + corridorHalfW, p.y);
      }
      ctx.closePath();
      ctx.fill();

      // Predicted trajectory spine
      ctx.strokeStyle = trajColor;
      ctx.lineWidth = 3.6;
      ctx.beginPath();
      ctx.moveTo(ego.x, ego.y);
      for (const p of ego.trajectory) {
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      // Prediction milestone pips with time annotations
      ego.trajectory.forEach((pt, idx) => {
        ctx.fillStyle = trajColor;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fill();

        if (idx === ego.trajectory.length - 1 || idx === Math.floor(ego.trajectory.length / 2)) {
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`+${pt.t}s`, pt.x + 8, pt.y + 3);
        }
      });

      ctx.restore();
    }

    // ========================================================
    // 5. ENTITIES' PREDICTED TRAJECTORIES (Safe/Warning/Dangerous)
    // ========================================================
    for (const entity of entities) {
      if (entity.trajectory && entity.trajectory.length > 0) {
        ctx.save();
        const isThreat = this.state.evaluation.primaryThreat && this.state.evaluation.primaryThreat.id === entity.id;
        let entColor = '#10B981'; // Safe (Green)
        if (isThreat) {
          if (riskLevel === 'CRITICAL' || riskLevel === 'ELEVATED') {
            entColor = '#EF4444'; // Dangerous (Red)
          } else {
            entColor = '#F97316'; // Warning (Orange)
          }
        }

        ctx.strokeStyle = entColor;
        ctx.lineWidth = isThreat ? 3 : 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(entity.x, entity.y);
        for (const p of entity.trajectory) {
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        const lastP = entity.trajectory[entity.trajectory.length - 1];
        if (lastP) {
          ctx.fillStyle = entColor;
          ctx.beginPath();
          ctx.arc(lastP.x, lastP.y, isThreat ? 4.5 : 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  renderEgoVehicle(ctx, ego) {
    // ========================================================
    // 1. CURRENT VEHICLE POSITION (Bright Violet Beacon & Reticle)
    // ========================================================
    ctx.save();
    const posPulse = (Date.now() * 0.003) % 1;
    ctx.strokeStyle = `rgba(192, 132, 252, ${1 - posPulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ego.x, ego.y, 18 + (posPulse * 16), 0, Math.PI * 2);
    ctx.stroke();

    // Center crosshair ticks
    ctx.strokeStyle = '#C084FC';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(ego.x - 7, ego.y);
    ctx.lineTo(ego.x + 7, ego.y);
    ctx.moveTo(ego.x, ego.y - 7);
    ctx.lineTo(ego.x, ego.y + 7);
    ctx.stroke();
    ctx.restore();

    // ========================================================
    // 2. MAIN VEHICLE BODY (Bright Violet / Purple)
    // ========================================================
    ctx.save();
    ctx.translate(ego.x, ego.y);
    ctx.rotate(ego.heading);

    const w = ego.widthPx;
    const h = ego.lengthPx;

    // Forward Headlight Illumination Cone (Teal beam)
    const beamGradient = ctx.createLinearGradient(0, -h / 2, 0, -h / 2 - 130);
    beamGradient.addColorStop(0, 'rgba(45, 212, 191, 0.28)');
    beamGradient.addColorStop(1, 'rgba(45, 212, 191, 0.0)');
    ctx.fillStyle = beamGradient;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 2, -h / 2);
    ctx.lineTo(-w - 20, -h / 2 - 130);
    ctx.lineTo(w + 20, -h / 2 - 130);
    ctx.lineTo(w / 2 - 2, -h / 2);
    ctx.closePath();
    ctx.fill();

    // Luminous Chassis Glow & Shadow
    ctx.shadowColor = 'rgba(168, 85, 247, 0.75)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.roundRect(-w / 2 + 4, -h / 2 + 4, w, h, 6);
    ctx.fill();

    // Main Chassis - Bright Violet / Purple Gradient
    const chassisGrad = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    chassisGrad.addColorStop(0, '#A855F7');   // Neon violet
    chassisGrad.addColorStop(0.4, '#8B5CF6'); // Electric purple
    chassisGrad.addColorStop(1, '#6D28D9');   // Deep violet
    ctx.fillStyle = chassisGrad;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 6);
    ctx.fill();

    // Specular High-Contrast Lavender/White Outline
    ctx.strokeStyle = '#F3E8FF';
    ctx.lineWidth = 2.0;
    ctx.stroke();
    ctx.shadowBlur = 0; // reset shadow

    // Gloss Windshield & Rear Window (Deep Obsidian)
    ctx.fillStyle = '#090F1D';
    ctx.fillRect(-w / 2 + 3, -h / 2 + 10, w - 6, 12); // Front windshield
    ctx.fillRect(-w / 2 + 3, h / 2 - 16, w - 6, 8);   // Rear window

    // Windshield reflection streak
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 6, -h / 2 + 20);
    ctx.lineTo(-w / 2 + 16, -h / 2 + 11);
    ctx.stroke();

    // Aerodynamic Roof Sensor Deck (Bright violet deck with Cyan LiDAR puck)
    ctx.fillStyle = '#1E1B4B';
    ctx.fillRect(-w / 2 + 4, -h / 2 + 24, w - 8, 18);
    // LiDAR sensor dome
    ctx.fillStyle = '#2DD4BF';
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#C084FC';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Front Xenon White Headlights
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-w / 2 + 2, -h / 2 - 1, 6, 2.5);
    ctx.fillRect(w / 2 - 8, -h / 2 - 1, 6, 2.5);

    // Rear Ruby Red Taillights
    ctx.fillStyle = '#EF4444';
    ctx.fillRect(-w / 2 + 2, h / 2 - 1.5, 6, 2);
    ctx.fillRect(w / 2 - 8, h / 2 - 1.5, 6, 2);

    ctx.restore();

    // Vehicle Identifier Badge (Bright Violet with Coordinate)
    ctx.fillStyle = '#C084FC';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('NEUROPATH EGO-AV [VIOLET]', ego.x, ego.y + (ego.lengthPx / 2) + 14);
  }

  renderEntity(ctx, entity) {
    ctx.save();
    ctx.translate(entity.x, entity.y);
    ctx.rotate(entity.heading);

    const w = entity.widthPx;
    const h = entity.lengthPx;

    // Distinct Colors Based on Object Type
    let typeColor = '#0EA5E9';
    let typeName = entity.name || 'OBSTACLE';

    if (entity.type === 'MOTORCYCLE') {
      typeColor = '#FF5722'; // Coral / Sunset Orange
      typeName = '[2W: MOTORCYCLE]';
      // Bike Body
      ctx.fillStyle = '#FF5722';
      ctx.fillRect(-3, -h / 2, 6, h);
      // Fork & Handlebars
      ctx.fillStyle = '#FED7AA';
      ctx.fillRect(-w / 2, -h / 2 + 4, w, 3);
      // Rider Helmet
      ctx.fillStyle = '#FF8A65';
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
      ctx.fill();
      // Glowing Headlight
      ctx.fillStyle = '#FFF7ED';
      ctx.fillRect(-2, -h / 2 - 2, 4, 3);
    } else if (entity.type === 'AUTO_RICKSHAW') {
      typeColor = '#10B981'; // Emerald Green & Canary Yellow
      typeName = '[3W: AUTO-RICKSHAW]';
      // Yellow body base
      ctx.fillStyle = '#FACC15';
      ctx.beginPath();
      ctx.moveTo(0, -h / 2);
      ctx.lineTo(w / 2, -h / 2 + 10);
      ctx.lineTo(w / 2, h / 2);
      ctx.lineTo(-w / 2, h / 2);
      ctx.lineTo(-w / 2, -h / 2 + 10);
      ctx.closePath();
      ctx.fill();

      // Emerald Green Canopy Roof
      ctx.fillStyle = '#059669';
      ctx.fillRect(-w / 2 + 2, -h / 2 + 10, w - 4, h - 14);

      // Single Front Wheel
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(-2, -h / 2 - 2, 4, 6);
    } else if (entity.type === 'PEDESTRIAN') {
      typeColor = '#FACC15'; // Electric Yellow / High-vis Lime
      typeName = '[VRU: PEDESTRIAN]';
      const swing = Math.sin(entity.walkCycle || 0) * 8;

      // Ground shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.ellipse(0, 7, 9, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Walking legs (navy jeans)
      ctx.strokeStyle = '#1E3A8A';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-3, 1);
      ctx.lineTo(-3 + swing, 11);
      ctx.moveTo(3, 1);
      ctx.lineTo(3 - swing, 11);
      ctx.stroke();

      // Shoes
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(-5 + swing, 10, 4, 3);
      ctx.fillRect(1 - swing, 10, 4, 3);

      // Torso (Electric Yellow High-Vis Shirt)
      ctx.fillStyle = '#FACC15';
      ctx.beginPath();
      ctx.roundRect(-6, -7, 12, 12, 3);
      ctx.fill();

      // Head
      ctx.fillStyle = '#FED7AA';
      ctx.beginPath();
      ctx.arc(0, -11, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // Arms swinging
      ctx.strokeStyle = '#FED7AA';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-6, -4);
      ctx.lineTo(-6 - swing * 0.7, 3);
      ctx.moveTo(6, -4);
      ctx.lineTo(6 + swing * 0.7, 3);
      ctx.stroke();
    } else if (entity.type === 'WRONG_WAY_VEHICLE') {
      typeColor = '#DC2626'; // Crimson / Hazard Red
      typeName = '[HAZARD: WRONG-WAY]';
      // Dual forward oncoming Headlight beams projecting down towards Ego
      ctx.fillStyle = 'rgba(254, 240, 138, 0.45)';
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 4, -h / 2);
      ctx.lineTo(-w / 2 - 14, -h / 2 - 55);
      ctx.lineTo(-w / 2 + 16, -h / 2 - 55);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(w / 2 - 4, -h / 2);
      ctx.lineTo(w / 2 - 16, -h / 2 - 55);
      ctx.lineTo(w / 2 + 14, -h / 2 - 55);
      ctx.closePath();
      ctx.fill();

      // Crimson Vehicle Chassis
      ctx.fillStyle = '#DC2626';
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, 4);
      ctx.fill();

      // Windshield facing travel direction
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(-w / 2 + 3, -h / 2 + 6, w - 6, 9);
      ctx.fillRect(-w / 2 + 3, h / 2 - 12, w - 6, 6);

      // Flashing top hazard warning strobe
      const flash = Math.sin(Date.now() * 0.015) > 0;
      ctx.fillStyle = flash ? '#FACC15' : '#EF4444';
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (entity.type === 'TRAFFIC_POLICE') {
      typeColor = '#3B82F6'; // Police Blue & Gold
      typeName = '[POLICE: TRAFFIC OFFICER]';
      // Police Uniform
      ctx.fillStyle = '#2563EB';
      ctx.fillRect(-6, -6, 12, 12);
      // Khaki Cap
      ctx.fillStyle = '#CA8A04';
      ctx.beginPath();
      ctx.arc(0, -8, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // Raised STOP or PROCEED Gesture
      if (entity.gesture === 'STOP') {
        ctx.fillStyle = '#EF4444';
        ctx.fillRect(-8, 6, 16, 4);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('STOP', 0, 16);
      } else {
        ctx.fillStyle = '#22C55E';
        ctx.fillRect(-8, 6, 16, 4);
      }
    } else if (entity.type === 'ROAD_OBSTACLE') {
      typeColor = '#F97316'; // Construction Amber / Safety Orange
      typeName = '[STATIC: ROAD DEFECT]';
      // Pothole dark crater
      ctx.fillStyle = '#27272A';
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Orange construction cone
      ctx.fillStyle = '#F97316';
      ctx.fillRect(-4, -4, 8, 8);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(-4, -1, 8, 2);
    } else if (entity.id === 'parked_auto') {
      typeColor = '#94A3B8'; // Steel Slate with flashing amber
      typeName = '[PARKED: HAZARDS ON]';
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, 4);
      ctx.fill();
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(-w / 2 + 3, -h / 2 + 6, w - 6, 8);

      const blink = Math.sin(Date.now() * 0.008) > 0;
      if (blink) {
        ctx.fillStyle = '#F59E0B';
        ctx.fillRect(-w / 2, -h / 2, 4, 3);
        ctx.fillRect(w / 2 - 4, -h / 2, 4, 3);
        ctx.fillRect(-w / 2, h / 2 - 3, 4, 3);
        ctx.fillRect(w / 2 - 4, h / 2 - 3, 4, 3);
      }
    } else if (entity.type === 'AMBULANCE' || entity.id.includes('ambulance')) {
      typeColor = '#EF4444'; // Red & Blue Emergency Strobe
      typeName = '[EMERGENCY: AMBULANCE (108)]';
      
      // Ambulance White Box Body
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, 5);
      ctx.fill();

      // Red Medical Cross in center
      ctx.fillStyle = '#EF4444';
      ctx.fillRect(-3, -4, 6, 8);
      ctx.fillRect(-5, -2, 10, 4);

      // Hi-Vis Green/Yellow reflective chevron stripes along sides
      ctx.fillStyle = '#10B981';
      ctx.fillRect(-w / 2 + 1, -h / 2 + 12, 3, h - 20);
      ctx.fillRect(w / 2 - 4, -h / 2 + 12, 3, h - 20);

      // Windshield
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(-w / 2 + 3, -h / 2 + 6, w - 6, 8);

      // Emergency Lightbar on roof (Alternating Red and Blue Flashes)
      const flashStrobe = Math.floor(Date.now() / 90) % 2 === 0;
      const blueLight = flashStrobe ? '#3B82F6' : '#1D4ED8';
      const redLight = flashStrobe ? '#EF4444' : '#B91C1C';
      
      // Lightbar base
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(-w / 2 + 4, -h / 2 + 16, w - 8, 5);

      // Left blue strobe
      ctx.fillStyle = blueLight;
      ctx.beginPath();
      ctx.arc(-w / 4, -h / 2 + 18, 4, 0, Math.PI * 2);
      ctx.fill();

      // Right red strobe
      ctx.fillStyle = redLight;
      ctx.beginPath();
      ctx.arc(w / 4, -h / 2 + 18, 4, 0, Math.PI * 2);
      ctx.fill();

      // Emergency flashing aura
      ctx.fillStyle = flashStrobe ? 'rgba(59, 130, 246, 0.22)' : 'rgba(239, 68, 68, 0.22)';
      ctx.beginPath();
      ctx.arc(0, -h / 2 + 18, 32, 0, Math.PI * 2);
      ctx.fill();

    } else if (entity.type === 'STRAY_ANIMAL' || entity.id.includes('cattle')) {
      typeColor = '#F59E0B'; // Amber
      typeName = '[ANIMAL: STRAY CATTLE]';

      // Cattle Body (Tan/Brown with White patches)
      ctx.fillStyle = '#C29B38';
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2 + 4, w, h - 8, 6);
      ctx.fill();

      // White flank patch
      ctx.fillStyle = '#FDF6E2';
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();

      // Cattle Head & Snout
      ctx.fillStyle = '#A77D2C';
      ctx.beginPath();
      ctx.arc(0, -h / 2 + 3, 5.5, 0, Math.PI * 2);
      ctx.fill();

      // Curved Horns
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(-4, -h / 2 + 1, 4, Math.PI * 0.8, Math.PI * 1.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(4, -h / 2 + 1, 4, Math.PI * 1.4, Math.PI * 2.2);
      ctx.stroke();

      // Tail
      ctx.strokeStyle = '#785A1D';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, h / 2 - 4);
      ctx.lineTo(Math.sin(Date.now() * 0.005) * 4, h / 2 + 4);
      ctx.stroke();

    } else {
      typeColor = '#0EA5E9'; // Royal Blue / Cobalt Sedan
      typeName = '[CAR: SEDAN]';
      ctx.fillStyle = '#0284C7';
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, 4);
      ctx.fill();
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(-w / 2 + 2, -h / 2 + 8, w - 4, 8);
    }

    ctx.restore();

    // Entity Bounding Box & Perception Classification Badge
    const isThreat = this.state.evaluation.primaryThreat && this.state.evaluation.primaryThreat.id === entity.id;
    const boxColor = isThreat ? '#EF4444' : typeColor;
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = isThreat ? 2.5 : 1.3;
    ctx.strokeRect(entity.x - (w / 2) - 4, entity.y - (h / 2) - 4, w + 8, h + 8);

    // Corner brackets for threats (High-tech autonomous perception look)
    if (isThreat) {
      const bX = entity.x - (w / 2) - 4;
      const bY = entity.y - (h / 2) - 4;
      const bW = w + 8;
      const bH = h + 8;
      const cLen = 7;
      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = 2.8;
      // Top-Left
      ctx.beginPath(); ctx.moveTo(bX, bY + cLen); ctx.lineTo(bX, bY); ctx.lineTo(bX + cLen, bY); ctx.stroke();
      // Top-Right
      ctx.beginPath(); ctx.moveTo(bX + bW - cLen, bY); ctx.lineTo(bX + bW, bY); ctx.lineTo(bX + bW, bY + cLen); ctx.stroke();
      // Bottom-Left
      ctx.beginPath(); ctx.moveTo(bX, bY + bH - cLen); ctx.lineTo(bX, bY + bH); ctx.lineTo(bX + cLen, bY + bH); ctx.stroke();
      // Bottom-Right
      ctx.beginPath(); ctx.moveTo(bX + bW - cLen, bY + bH); ctx.lineTo(bX + bW, bY + bH); ctx.lineTo(bX + bW, bY + bH - cLen); ctx.stroke();
    }

    // Badge Label with distinct type classification
    ctx.fillStyle = isThreat ? '#EF4444' : typeColor;
    ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${typeName} ${entity.name}`, entity.x, entity.y - (h / 2) - 8);
  }

  // ==========================================
  // HUD TELEMETRY UPDATE
  // ==========================================
  updateHud() {
    if (!this.state) return;

    const scen = this.state.scenario;
    const ego = this.state.ego;
    const evalResult = this.state.evaluation;
    const egoState = this.state.egoState;

    // Top Scenario info
    document.getElementById('scenarioTitle').textContent = scen.name;
    document.getElementById('scenarioDesc').textContent = scen.description;

    // Automatically synchronize Scenario Tab highlights
    if (this.cachedHud.scenarioId !== scen.id) {
      this.cachedHud.scenarioId = scen.id;
      this.renderScenarioTabs();
    }

    // Auto Mode Card & Injection Bar Update
    const autoCard = document.getElementById('autoMetricsCard');
    const autoInjectBar = document.getElementById('autoInjectBar');
    if (this.state.autoStats && this.state.autoStats.isAutoMode) {
      if (autoCard) autoCard.style.display = 'flex';
      if (autoInjectBar) autoInjectBar.style.display = 'flex';
      const stats = this.state.autoStats;
      const seqTitleEl = document.getElementById('autoSeqTitle');
      const loopBadgeEl = document.getElementById('autoLoopBadge');
      const distEl = document.getElementById('autoDistance');
      const avoidedEl = document.getElementById('autoAvoided');
      const collEl = document.getElementById('autoCollisions');
      if (seqTitleEl) seqTitleEl.textContent = stats.activeHazardTitle || stats.sequenceName;
      if (loopBadgeEl) loopBadgeEl.textContent = `SEQ ${stats.sequenceIndex}/${stats.totalSequences}`;
      if (distEl) distEl.textContent = `${stats.distanceMeters} m`;
      if (avoidedEl) avoidedEl.textContent = `${stats.hazardsAvoided} Safe`;
      if (collEl) collEl.textContent = `${stats.collisions} (Safe)`;

      document.getElementById('scenarioTime').textContent = `LIVE • ${stats.distanceMeters}m • ${stats.hazardsAvoided} Avoided`;
      document.getElementById('elapsedLabel').textContent = `${stats.phase === 'HAZARD' ? 'Hazard' : 'Clear'}: ${stats.phaseElapsed}s`;
      document.getElementById('durationLabel').textContent = `${stats.phaseDuration}s`;
      const phasePct = Math.min(100, Math.max(0, (stats.phaseElapsed / (stats.phaseDuration || 8.5)) * 100));
      document.getElementById('timelineFill').style.width = `${phasePct.toFixed(1)}%`;
    } else {
      if (autoCard) autoCard.style.display = 'none';
      if (autoInjectBar) autoInjectBar.style.display = 'flex';
      document.getElementById('scenarioTime').textContent = `${scen.elapsed}s / ${scen.duration}s`;
      document.getElementById('elapsedLabel').textContent = `${scen.elapsed}s`;
      document.getElementById('durationLabel').textContent = `${scen.duration}s`;
      document.getElementById('timelineFill').style.width = `${scen.progress * 100}%`;
    }

    // Ego State Badge
    if (this.cachedHud.egoState !== egoState) {
      this.cachedHud.egoState = egoState;
      const egoBadge = document.getElementById('egoStateBadge');
      if (egoBadge) {
        egoBadge.textContent = egoState;
        if (egoState === 'EMERGENCY_STOP' || egoState === 'POLICE_OVERRIDE_STOP') {
          egoBadge.className = 'px-2.5 py-0.5 rounded-md text-[10px] bg-red-950/60 text-[#EF4444] border border-[#EF4444]/40 font-bold';
        } else if (egoState === 'SAFE_REPOSITIONING' || egoState === 'CHECKING_BLINDSPOT' || egoState === 'RETURNING_TO_LANE') {
          egoBadge.className = 'px-2.5 py-0.5 rounded-md text-[10px] bg-teal-950/60 text-[#2DD4BF] border border-[#14B8A6]/40 font-bold';
        } else if (egoState === 'DECELERATING' || egoState === 'YIELDING') {
          egoBadge.className = 'px-2.5 py-0.5 rounded-md text-[10px] bg-amber-950/60 text-[#F59E0B] border border-[#F59E0B]/40 font-bold';
        } else {
          egoBadge.className = 'px-2.5 py-0.5 rounded-md text-[10px] bg-emerald-950/60 text-[#10B981] border border-[#10B981]/40 font-bold';
        }
      }
    }

    // Synchronize 4-Stage Safety & Risk Matrix
    const pillSafe = document.getElementById('matrixPillSafe');
    const pillWarning = document.getElementById('matrixPillWarning');
    const pillDanger = document.getElementById('matrixPillDanger');
    const pillReplan = document.getElementById('matrixPillReplan');

    const isReplanning = (
      egoState === 'SAFE_REPOSITIONING' ||
      egoState === 'CHECKING_BLINDSPOT' ||
      egoState === 'RETURNING_TO_LANE' ||
      (evalResult.decision && (evalResult.decision.includes('NUDGE') || evalResult.decision.includes('EVADE') || evalResult.decision.includes('REPLAN')))
    );

    if (pillSafe && pillWarning && pillDanger && pillReplan) {
      pillSafe.className = 'risk-indicator-item';
      pillWarning.className = 'risk-indicator-item';
      pillDanger.className = 'risk-indicator-item';
      pillReplan.className = 'risk-indicator-item';

      if (evalResult.riskLevel === 'CRITICAL' || evalResult.riskLevel === 'ELEVATED') {
        pillDanger.className = 'risk-indicator-item active-danger';
      } else if (evalResult.riskLevel === 'AWARENESS') {
        pillWarning.className = 'risk-indicator-item active-warning';
      } else {
        pillSafe.className = 'risk-indicator-item active-safe';
      }

      if (isReplanning) {
        pillReplan.className = 'risk-indicator-item active-replan';
      }
    }

    // Risk Card
    const riskText = document.getElementById('riskLevelText');
    const riskCard = document.getElementById('riskCard');
    const riskTTC = document.getElementById('riskTTC');
    const riskSub = document.getElementById('riskSubText');

    riskTTC.textContent = evalResult.ttc ? `TTC: ${evalResult.ttc}s` : 'TTC: --';

    if (this.cachedHud.riskLevel !== evalResult.riskLevel) {
      this.cachedHud.riskLevel = evalResult.riskLevel;
      riskText.textContent = evalResult.riskLevel;

      if (evalResult.riskLevel === 'CRITICAL') {
        riskText.className = 'text-2xl font-black tracking-tight text-[#EF4444] animate-pulse';
        riskCard.className = 'p-3.5 rounded-[12px] border bg-[#090F1D] border-[#EF4444] shadow-[0_0_15px_rgba(239,68,68,0.25)] transition-colors duration-150';
        riskSub.textContent = 'Imminent collision hazard';
      } else if (evalResult.riskLevel === 'ELEVATED') {
        riskText.className = 'text-2xl font-black tracking-tight text-[#EF4444]';
        riskCard.className = 'p-3.5 rounded-[12px] border bg-[#090F1D] border-[#EF4444]/70 shadow-[0_0_10px_rgba(239,68,68,0.18)] transition-colors duration-150';
        riskSub.textContent = 'Active trajectory conflict';
      } else if (evalResult.riskLevel === 'AWARENESS') {
        riskText.className = 'text-2xl font-black tracking-tight text-[#F59E0B]';
        riskCard.className = 'p-3.5 rounded-[12px] border bg-[#090F1D] border-[#F59E0B]/60 shadow-[0_0_10px_rgba(245,158,11,0.15)] transition-colors duration-150';
        riskSub.textContent = 'Monitoring lateral approach';
      } else {
        riskText.className = 'text-2xl font-black tracking-tight text-[#10B981]';
        riskCard.className = 'p-3.5 rounded-[12px] border bg-[#090F1D] border-[#10B981]/40 transition-colors duration-150';
        riskSub.textContent = 'Path clear • Safe corridor';
      }
    }

    // Detected Entity
    const threat = evalResult.primaryThreat;
    const threatId = threat ? threat.id : null;
    if (this.cachedHud.threatId !== threatId) {
      this.cachedHud.threatId = threatId;
      const badge = document.getElementById('entityBadge');
      if (threat) {
        badge.textContent = threat.type;
        badge.className = 'px-2 py-0.5 rounded bg-red-950/60 text-[#EF4444] text-[10px] font-bold border border-[#EF4444]/50';
        document.getElementById('targetName').textContent = threat.name;
        document.getElementById('targetBehavior').textContent = evalResult.decision.replace(/_/g, ' ');
      } else {
        badge.textContent = 'SCANNING';
        badge.className = 'px-2 py-0.5 rounded bg-[#0C1426] text-[#94A3B8] text-[10px] border border-[#1E2D4A]';
        document.getElementById('targetName').textContent = 'None in threat zone';
        document.getElementById('targetBehavior').textContent = 'Normal flow';
        document.getElementById('targetDrift').textContent = '0.0 m/s';
        document.getElementById('targetDistance').textContent = '--';
      }
    }

    if (threat) {
      document.getElementById('targetDrift').textContent = `${threat.lateralVolatility} m/s`;
      const dist = Math.sqrt(Math.pow((threat.x - ego.x) / PIXELS_PER_METER, 2) + Math.pow((threat.y - ego.y) / PIXELS_PER_METER, 2)).toFixed(1);
      document.getElementById('targetDistance').textContent = `${dist}m`;
    }

    // Decision
    if (this.cachedHud.decision !== evalResult.decision) {
      this.cachedHud.decision = evalResult.decision;
      document.getElementById('decisionText').textContent = evalResult.decision;
    }

    // Gauges
    const currentSpeed = ego.speedKmh;
    const targetSpeed = (evalResult.safeTargetSpeed * 3.6).toFixed(1);
    document.getElementById('currentSpeedKmh').textContent = `${currentSpeed} km/h`;
    document.getElementById('targetSpeedKmh').textContent = targetSpeed;
    const speedPct = Math.min(100, (ego.speed / 15.0) * 100);
    document.getElementById('speedBar').style.width = `${speedPct}%`;

    // Brake Pressure
    let brakePct = 0;
    if (ego.acceleration < 0) {
      brakePct = Math.min(100, Math.round((Math.abs(ego.acceleration) / 6.5) * 100));
    }
    document.getElementById('brakeValue').textContent = `${brakePct}%`;
    document.getElementById('brakeBar').style.width = `${brakePct}%`;

    // Vehicle Position & Heading Telemetry (Left Panel)
    if (ego) {
      const posXEl = document.getElementById('egoPosX');
      if (posXEl) posXEl.textContent = `${(ego.x / PIXELS_PER_METER).toFixed(1)}m`;
      const posYEl = document.getElementById('egoPosY');
      if (posYEl) posYEl.textContent = `${(ego.y / PIXELS_PER_METER).toFixed(1)}m`;
      const offsetEl = document.getElementById('egoLaneOffset');
      if (offsetEl) {
        const offsetMeters = ((ego.x - 590) / PIXELS_PER_METER).toFixed(2);
        offsetEl.textContent = `${offsetMeters >= 0 ? '+' : ''}${offsetMeters}m`;
      }
      const headingEl = document.getElementById('egoHeading');
      if (headingEl) {
        const deg = ((ego.heading || 0) * 180 / Math.PI).toFixed(1);
        headingEl.textContent = `${deg}°`;
      }
    }
    const simStatusEl = document.getElementById('simStatusBadge');
    if (simStatusEl) {
      simStatusEl.textContent = this.isPlaying ? 'RUNNING' : 'PAUSED';
      simStatusEl.className = this.isPlaying
        ? 'px-2 py-0.5 rounded text-[9.5px] bg-emerald-950/60 text-[#10B981] border border-[#10B981]/40 font-bold font-mono'
        : 'px-2 py-0.5 rounded text-[9.5px] bg-amber-950/60 text-[#F59E0B] border border-[#F59E0B]/40 font-bold font-mono';
    }

    // Blindspot Status
    const bs = evalResult.blindspotStatus || {};
    if (this.cachedHud.isRightClear !== bs.is_right_clear) {
      this.cachedHud.isRightClear = bs.is_right_clear;
      const bsRight = document.getElementById('blindspotRight');
      const gapBadge = document.getElementById('gapBadge');
      if (bs.is_right_clear) {
        bsRight.textContent = 'CLEAR (>15m safe gap)';
        bsRight.className = 'font-semibold text-[#10B981]';
        gapBadge.textContent = 'GAP: CLEAR';
        gapBadge.className = 'px-2 py-0.5 rounded bg-emerald-950/60 text-[#10B981] text-[10px] border border-[#10B981]/40 font-bold';
      } else {
        bsRight.textContent = 'OCCUPIED (Auto in blindspot)';
        bsRight.className = 'font-semibold text-[#EF4444]';
        gapBadge.textContent = 'GAP: BLOCKED';
        gapBadge.className = 'px-2 py-0.5 rounded bg-red-950/60 text-[#EF4444] text-[10px] border border-[#EF4444]/40 font-bold';
      }
    }

    // Historical Road Spatial Memory Update
    const memData = this.state.roadMemory;
    const activeMem = memData && memData.activeMemory ? memData.activeMemory : null;
    const activeMemId = activeMem ? activeMem.id : null;
    if (this.cachedHud.activeMemId !== activeMemId) {
      this.cachedHud.activeMemId = activeMemId;
      const memBadge = document.getElementById('memoryStatusBadge');
      const memTitle = document.getElementById('memoryHotspotTitle');
      const memConf = document.getElementById('memoryConfidence');
      const memAction = document.getElementById('memoryPreAction');

      if (activeMem) {
        if (memBadge) {
          memBadge.textContent = 'ACTIVE INFLUENCE';
          memBadge.className = 'px-2 py-0.5 rounded bg-teal-950/60 text-[#2DD4BF] text-[9px] font-bold border border-[#14B8A6]/50 pulse-active';
        }
        if (memTitle) memTitle.textContent = activeMem.title;
        if (memConf) memConf.textContent = `${activeMem.confidence}% (MATCHED)`;
        if (memAction) memAction.textContent = activeMem.preAction;
      } else if (memData && memData.allFeatures && memData.allFeatures.length > 0) {
        const upcoming = memData.allFeatures[0];
        if (memBadge) {
          memBadge.textContent = 'AHEAD (PRIOR MAP)';
          memBadge.className = 'px-2 py-0.5 rounded bg-[#0C1426] text-[#A855F7] text-[9px] border border-[#1E2D4A]';
        }
        if (memTitle) memTitle.textContent = upcoming.title;
        if (memConf) memConf.textContent = `${upcoming.confidence}% (FLEET PRIOR)`;
        if (memAction) memAction.textContent = upcoming.preAction;
      } else {
        if (memBadge) {
          memBadge.textContent = 'STANDBY';
          memBadge.className = 'px-2 py-0.5 rounded bg-[#0C1426] text-[#94A3B8] text-[9px] border border-[#1E2D4A]';
        }
        if (memTitle) memTitle.textContent = 'Standard Road Segment';
        if (memConf) memConf.textContent = '--';
        if (memAction) memAction.textContent = 'NOMINAL MONITORING';
      }
    }

    // Voice Queue Log & Audio Triggering
    if (evalResult.voiceAlert && evalResult.voiceAlert !== this.lastVoiceLogged) {
      this.lastVoiceLogged = evalResult.voiceAlert;
      this.audio.speak(evalResult.voiceAlert, evalResult.voicePriority);

      const voiceLogContainer = document.getElementById('voiceLog');
      const item = document.createElement('div');
      item.className = 'p-2 rounded-lg bg-[#0C1426] border border-[#1E2D4A] flex flex-col gap-0.5';
      const timeStr = `${scen.elapsed}s`;
      item.innerHTML = `
        <div class="flex items-center justify-between text-[9px] text-[#94A3B8] font-mono">
          <span>TIME: ${timeStr}</span>
          <span class="text-${evalResult.voicePriority === 'CRITICAL' ? '[#EF4444]' : '[#2DD4BF]'} font-bold">${evalResult.voicePriority}</span>
        </div>
        <div class="text-[#F8FAFC] text-[11px] leading-tight font-medium">"${evalResult.voiceAlert}"</div>
      `;
      voiceLogContainer.prepend(item);
    }
  }
}

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.avocApp = new App();
});
