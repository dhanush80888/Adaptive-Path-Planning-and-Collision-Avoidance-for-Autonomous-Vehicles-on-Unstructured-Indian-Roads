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
    });

    // Reset
    document.getElementById('btnReset').addEventListener('click', () => {
      this.resetScenario();
    });

    // Speed buttons
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.speed-btn').forEach(b => {
          b.classList.remove('bg-sky-600', 'text-white', 'font-bold');
          b.classList.add('bg-slate-800', 'text-slate-300');
        });
        e.target.classList.remove('bg-slate-800', 'text-slate-300');
        e.target.classList.add('bg-sky-600', 'text-white', 'font-bold');
        this.simSpeed = parseFloat(e.target.dataset.speed);
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
      { id: 0, label: '⚡ Auto Real-World' },
      { id: 1, label: '1. Bike Cut-In' },
      { id: 2, label: '2. Pedestrian' },
      { id: 3, label: '3. Wrong-Way' },
      { id: 4, label: '4. Police Signal' },
      { id: 5, label: '5. Obstacle Swerve' },
      { id: 6, label: '6. Busy Junction' },
    ];

    if (!this.tabsInitialized) {
      container.innerHTML = '';
      scenarios.forEach(scen => {
        const btn = document.createElement('button');
        btn.id = `tab-scen-${scen.id}`;
        btn.className = 'px-2.5 py-1 rounded text-xs transition-all font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-300';
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
          btn.className = 'px-2.5 py-1 rounded text-xs transition-all font-bold bg-sky-600 text-white shadow-lg shadow-sky-900/50';
        } else {
          btn.className = 'px-2.5 py-1 rounded text-xs transition-all font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-300';
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

    // 1. Terrain (Direct opaque fill - no clearRect needed, eliminates transparent flicker)
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 2. Road Shoulder & Curbs
    const roadW = (road.road_right_edge - road.road_left_edge);
    ctx.fillStyle = '#2d3748';
    ctx.fillRect(road.road_left_edge - 30, 0, roadW + 60, CANVAS_HEIGHT);

    // Black & Yellow road curb strips
    const curbH = 30;
    const curbCount = Math.ceil(CANVAS_HEIGHT / curbH) + 1;
    for (let i = 0; i < curbCount; i++) {
      const y = (i * curbH) - (this.dashOffset % curbH);
      ctx.fillStyle = i % 2 === 0 ? '#1e293b' : '#f59e0b';
      ctx.fillRect(road.road_left_edge - 8, y, 8, curbH);
      ctx.fillRect(road.road_right_edge, y, 8, curbH);
    }

    // 3. Main Asphalt Road Surface
    ctx.fillStyle = '#1e242d';
    ctx.fillRect(road.road_left_edge, 0, roadW, CANVAS_HEIGHT);

    // 4. Junction Cross Street (Scenarios 4 and 6, and Auto Junction)
    if (isJunction) {
      const jY = 280;
      const jH = 150;
      ctx.fillStyle = '#1e242d';
      ctx.fillRect(0, jY - (jH / 2), CANVAS_WIDTH, jH);

      // Zebra Crossings
      ctx.fillStyle = '#f8fafc';
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

    // Zebra Crossing for Scenario 2 and Auto Pedestrian Zone
    if (this.state.scenario.id === 'SCENARIO_2_PEDESTRIAN' || (this.state.autoStats && this.state.autoStats.showZebra)) {
      const crossY = 240;
      ctx.fillStyle = '#f8fafc';
      const stripeW = 10;
      const gap = 7;
      const count = Math.floor(roadW / (stripeW + gap));
      for (let i = 0; i < count; i++) {
        const x = road.road_left_edge + (i * (stripeW + gap)) + 4;
        ctx.fillRect(x, crossY - 14, stripeW, 28);
      }
      // Curb crossing warning posts
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      ctx.arc(road.road_left_edge - 12, crossY, 6, 0, Math.PI * 2);
      ctx.arc(road.road_right_edge + 12, crossY, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Solid Edge Lines
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(road.road_left_edge, 0);
    ctx.lineTo(road.road_left_edge, CANVAS_HEIGHT);
    ctx.moveTo(road.road_right_edge, 0);
    ctx.lineTo(road.road_right_edge, CANVAS_HEIGHT);
    ctx.stroke();

    // 6. Yellow Center Divider (Left-Hand Traffic separator)
    ctx.strokeStyle = '#eab308';
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
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('▲ LHT DRIVE (OUR LANE)', road.lane_left_x, 690);
    ctx.fillText('▼ ONCOMING LANE', road.lane_right_x, 690);

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

    // 8. Entities (Surroundings, Pedestrians, Police, Obstacles)
    for (const entity of entities) {
      this.renderEntity(ctx, entity);
    }

    // 9. Ego Autonomous Vehicle
    this.renderEgoVehicle(ctx, ego);

    // Blit completed offscreen frame to visible canvas atomically (eliminates screen flicker)
    if (this.offscreenCanvas && this.ctx) {
      this.ctx.drawImage(this.offscreenCanvas, 0, 0);
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
      // Holographic spatial prior bounding zone
      ctx.fillStyle = isInside ? 'rgba(99, 102, 241, 0.18)' : 'rgba(99, 102, 241, 0.08)';
      ctx.fillRect(road.road_left_edge, y - (spanPx / 2), roadW, spanPx);

      ctx.strokeStyle = isInside ? 'rgba(129, 140, 248, 0.85)' : 'rgba(99, 102, 241, 0.4)';
      ctx.lineWidth = isInside ? 2 : 1.5;
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(road.road_left_edge, y - (spanPx / 2), roadW, spanPx);
      ctx.setLineDash([]);

      // Holographic Tag
      ctx.fillStyle = isInside ? '#818cf8' : '#a5b4fc';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'left';
      const label = `🧠 [ROAD MEMORY: ${feat.title.toUpperCase()} | ${feat.confidence}% CONF]`;
      ctx.fillText(label, road.road_left_edge + 8, y - (spanPx / 2) - 6);

      // Pre-action tag on shoulder
      ctx.fillStyle = '#fbbf24';
      ctx.font = '9px monospace';
      ctx.fillText(`PRE-ACTION: ${feat.preAction}`, road.road_left_edge + 8, y - (spanPx / 2) + 14);

      // Expanding wave pulse when ego is inside memory zone
      if (isInside) {
        const pulse = (Date.now() * 0.003) % 1;
        ctx.strokeStyle = `rgba(165, 180, 252, ${1 - pulse})`;
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

    // Range rings
    const rings = [10 * PIXELS_PER_METER, 20 * PIXELS_PER_METER, 30 * PIXELS_PER_METER];
    rings.forEach((r, idx) => {
      ctx.strokeStyle = idx === 1 ? 'rgba(56, 189, 248, 0.25)' : 'rgba(56, 189, 248, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Spinning LiDAR Beam
    const beamLen = 32 * PIXELS_PER_METER;
    const grad = ctx.createRadialGradient(0, 0, 5, 0, 0, beamLen);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.5)');
    grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, beamLen, this.lidarSweepAngle - 0.25, this.lidarSweepAngle + 0.25);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  renderBlindspotEnvelope(ctx, ego, blindspot) {
    if (!blindspot) return;
    ctx.save();

    // Right adjacent lane envelope
    const isRightClear = blindspot.is_right_clear;
    const envX = ego.x + (1.8 * PIXELS_PER_METER);
    const envW = 3.6 * PIXELS_PER_METER;
    const envY = ego.y - (16 * PIXELS_PER_METER);
    const envH = 28 * PIXELS_PER_METER;

    ctx.fillStyle = isRightClear ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.2)';
    ctx.strokeStyle = isRightClear ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

    ctx.fillRect(envX, envY, envW, envH);
    ctx.strokeRect(envX, envY, envW, envH);

    ctx.setLineDash([]);
    ctx.font = '10px monospace';
    ctx.fillStyle = isRightClear ? '#4ade80' : '#f87171';
    ctx.fillText(
      isRightClear ? '✓ ADJACENT LANE CLEAR' : '✗ BLINDSPOT OCCUPIED',
      envX + envW / 2,
      envY - 6
    );

    ctx.restore();
  }

  renderTrajectories(ctx, ego, entities) {
    const riskLevel = this.state.evaluation.riskLevel;
    let egoColor = '#10b981'; // Green
    if (riskLevel === 'AWARENESS') egoColor = '#f59e0b';
    if (riskLevel === 'ELEVATED') egoColor = '#f97316';
    if (riskLevel === 'CRITICAL') egoColor = '#ef4444';

    // Ego Forward Projected Ribbon
    if (ego.trajectory && ego.trajectory.length > 0) {
      ctx.strokeStyle = egoColor;
      ctx.lineWidth = 3.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(ego.x, ego.y);
      for (const p of ego.trajectory) {
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Entities Trajectories
    for (const entity of entities) {
      if (entity.trajectory && entity.trajectory.length > 0) {
        ctx.strokeStyle = 'rgba(249, 115, 22, 0.6)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(entity.x, entity.y);
        for (const p of entity.trajectory) {
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  renderEgoVehicle(ctx, ego) {
    ctx.save();
    ctx.translate(ego.x, ego.y);
    ctx.rotate(ego.heading);

    const w = ego.widthPx;
    const h = ego.lengthPx;

    // Vehicle Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(-w / 2 + 3, -h / 2 + 3, w, h);

    // Main Body
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 6);
    ctx.fill();

    // Windshield & Rear glass
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-w / 2 + 3, -h / 2 + 10, w - 6, 12); // Front
    ctx.fillRect(-w / 2 + 3, h / 2 - 16, w - 6, 8);   // Rear

    // Roof Sensor Dome (LiDAR puck)
    ctx.fillStyle = '#0369a1';
    ctx.fillRect(-w / 2 + 4, -h / 2 + 24, w - 8, 18);
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();

    // Headlights (Beam forward)
    ctx.fillStyle = 'rgba(254, 240, 138, 0.8)';
    ctx.fillRect(-w / 2 + 2, -h / 2 - 1, 6, 2);
    ctx.fillRect(w / 2 - 8, -h / 2 - 1, 6, 2);

    ctx.restore();

    // Ego Identifier Badge
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('EGO AV', ego.x, ego.y + (ego.lengthPx / 2) + 12);
  }

  renderEntity(ctx, entity) {
    ctx.save();
    ctx.translate(entity.x, entity.y);
    ctx.rotate(entity.heading);

    const w = entity.widthPx;
    const h = entity.lengthPx;

    if (entity.type === 'MOTORCYCLE') {
      // Bike Body
      ctx.fillStyle = '#ea580c';
      ctx.fillRect(-3, -h / 2, 6, h);
      // Front Fork & Handlebars
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(-w / 2, -h / 2 + 4, w, 3);
      // Rider Helmet
      ctx.fillStyle = '#fed7aa';
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
    } else if (entity.type === 'AUTO_RICKSHAW') {
      // Auto-Rickshaw (tapered front, 3 wheels)
      // Yellow body base
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      ctx.moveTo(0, -h / 2);
      ctx.lineTo(w / 2, -h / 2 + 10);
      ctx.lineTo(w / 2, h / 2);
      ctx.lineTo(-w / 2, h / 2);
      ctx.lineTo(-w / 2, -h / 2 + 10);
      ctx.closePath();
      ctx.fill();

      // Green Canopy Roof
      ctx.fillStyle = '#15803d';
      ctx.fillRect(-w / 2 + 2, -h / 2 + 10, w - 4, h - 14);

      // Single Front Wheel
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-2, -h / 2 - 2, 4, 6);
    } else if (entity.type === 'PEDESTRIAN') {
      // High-detail pedestrian walking across road
      const swing = Math.sin(entity.walkCycle) * 8;
      // Soft ground shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.ellipse(0, 7, 9, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Swinging Legs (trousers)
      ctx.strokeStyle = '#1e3a8a';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-3, 1);
      ctx.lineTo(-3 + swing, 11);
      ctx.moveTo(3, 1);
      ctx.lineTo(3 - swing, 11);
      ctx.stroke();

      // Shoes
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-5 + swing, 10, 4, 3);
      ctx.fillRect(1 - swing, 10, 4, 3);

      // Torso (vibrant shirt)
      ctx.fillStyle = '#9333ea';
      ctx.beginPath();
      ctx.roundRect(-6, -7, 12, 12, 3);
      ctx.fill();

      // Head & Skin
      ctx.fillStyle = '#fed7aa';
      ctx.beginPath();
      ctx.arc(0, -11, 4.5, 0, Math.PI * 2);
      ctx.fill();
      // Hair
      ctx.fillStyle = '#451a03';
      ctx.beginPath();
      ctx.arc(0, -13, 4, Math.PI, Math.PI * 2);
      ctx.fill();

      // Arms swinging opposite to legs
      ctx.strokeStyle = '#fed7aa';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-6, -4);
      ctx.lineTo(-6 - swing * 0.7, 3);
      ctx.moveTo(6, -4);
      ctx.lineTo(6 + swing * 0.7, 3);
      ctx.stroke();
    } else if (entity.type === 'WRONG_WAY_VEHICLE') {
      // Dedicated Wrong-Way Vehicle (with heading = PI, local -Y rotates facing downwards towards Ego)
      // Dual forward oncoming Headlight beams projecting down towards Ego!
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

      // Oncoming Vehicle Body (Bright hazard red)
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, 4);
      ctx.fill();

      // Front Windshield facing travel direction (downwards towards Ego)
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-w / 2 + 3, -h / 2 + 6, w - 6, 9);

      // Rear window
      ctx.fillRect(-w / 2 + 3, h / 2 - 12, w - 6, 6);

      // Front Headlight bulbs
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(-w / 2 + 5, -h / 2 + 2, 3.5, 0, Math.PI * 2);
      ctx.arc(w / 2 - 5, -h / 2 + 2, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Flashing top hazard warning strobe
      const flash = Math.sin(Date.now() * 0.015) > 0;
      ctx.fillStyle = flash ? '#facc15' : '#ef4444';
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (entity.id === 'parked_auto') {
      // Parked roadside delivery van with hazard flashers
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, 4);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-w / 2 + 3, -h / 2 + 6, w - 6, 8);

      const blink = Math.sin(Date.now() * 0.008) > 0;
      if (blink) {
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(-w / 2, -h / 2, 4, 3);
        ctx.fillRect(w / 2 - 4, -h / 2, 4, 3);
        ctx.fillRect(-w / 2, h / 2 - 3, 4, 3);
        ctx.fillRect(w / 2 - 4, h / 2 - 3, 4, 3);
      }
    } else if (entity.type === 'TRAFFIC_POLICE') {
      // Police Officer in Khaki
      ctx.fillStyle = '#ca8a04';
      ctx.fillRect(-6, -6, 12, 12);
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(0, -8, 4, 0, Math.PI * 2); // Cap/Head
      ctx.fill();

      // Raised STOP Palm or PROCEED Wave
      if (entity.gesture === 'STOP') {
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(-8, 6, 16, 4); // Red STOP gesture
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('STOP', 0, 16);
      } else {
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(-8, 6, 16, 4); // Green wave
      }
    } else if (entity.type === 'ROAD_OBSTACLE') {
      // Pothole / Debris + Construction cones
      ctx.fillStyle = '#3f3f46';
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Traffic Cone
      ctx.fillStyle = '#f97316';
      ctx.fillRect(-4, -4, 8, 8);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-4, -1, 8, 2);
    } else {
      // Standard Vehicle / Sedan
      ctx.fillStyle = entity.color || '#64748b';
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, 4);
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-w / 2 + 2, -h / 2 + 8, w - 4, 8);
    }

    ctx.restore();

    // Entity Bounding Box & Classification Badge
    const isThreat = this.state.evaluation.primaryThreat && this.state.evaluation.primaryThreat.id === entity.id;
    const boxColor = isThreat ? '#ef4444' : 'rgba(148, 163, 184, 0.4)';
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = isThreat ? 2 : 1;
    ctx.strokeRect(entity.x - (w / 2) - 4, entity.y - (h / 2) - 4, w + 8, h + 8);

    // Badge Label
    ctx.fillStyle = isThreat ? '#ef4444' : '#94a3b8';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(entity.name, entity.x, entity.y - (h / 2) - 8);
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
      if (autoInjectBar) autoInjectBar.style.display = 'none';
      document.getElementById('scenarioTime').textContent = `${scen.elapsed}s / ${scen.duration}s`;
      document.getElementById('elapsedLabel').textContent = `${scen.elapsed}s`;
      document.getElementById('durationLabel').textContent = `${scen.duration}s`;
      document.getElementById('timelineFill').style.width = `${scen.progress * 100}%`;
    }

    // Ego State Badge
    if (this.cachedHud.egoState !== egoState) {
      this.cachedHud.egoState = egoState;
      document.getElementById('egoStateBadge').textContent = egoState;
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
        riskText.className = 'text-2xl font-black tracking-tight text-red-500 animate-pulse';
        riskCard.className = 'p-3.5 rounded-xl border bg-red-950/20 border-red-500/60 transition-colors duration-150';
        riskSub.textContent = 'Imminent collision hazard';
      } else if (evalResult.riskLevel === 'ELEVATED') {
        riskText.className = 'text-2xl font-black tracking-tight text-orange-500';
        riskCard.className = 'p-3.5 rounded-xl border bg-orange-950/20 border-orange-500/50 transition-colors duration-150';
        riskSub.textContent = 'Active trajectory conflict';
      } else if (evalResult.riskLevel === 'AWARENESS') {
        riskText.className = 'text-2xl font-black tracking-tight text-amber-400';
        riskCard.className = 'p-3.5 rounded-xl border bg-amber-950/20 border-amber-500/40 transition-colors duration-150';
        riskSub.textContent = 'Monitoring lateral approach';
      } else {
        riskText.className = 'text-2xl font-black tracking-tight text-emerald-400';
        riskCard.className = 'p-3.5 rounded-xl border bg-emerald-950/20 border-emerald-500/30 transition-colors duration-150';
        riskSub.textContent = 'Path clear';
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
        badge.className = 'px-1.5 py-0.5 rounded bg-red-900/60 text-red-300 text-[10px] font-bold border border-red-700/60';
        document.getElementById('targetName').textContent = threat.name;
        document.getElementById('targetBehavior').textContent = evalResult.decision.replace(/_/g, ' ');
      } else {
        badge.textContent = 'SCANNING';
        badge.className = 'px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]';
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

    // Blindspot Status
    const bs = evalResult.blindspotStatus || {};
    if (this.cachedHud.isRightClear !== bs.is_right_clear) {
      this.cachedHud.isRightClear = bs.is_right_clear;
      const bsRight = document.getElementById('blindspotRight');
      const gapBadge = document.getElementById('gapBadge');
      if (bs.is_right_clear) {
        bsRight.textContent = 'CLEAR (>15m safe gap)';
        bsRight.className = 'font-semibold text-emerald-400';
        gapBadge.textContent = 'GAP: CLEAR';
        gapBadge.className = 'px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 text-[10px] border border-emerald-800/60';
      } else {
        bsRight.textContent = 'OCCUPIED (Auto in blindspot)';
        bsRight.className = 'font-semibold text-red-400';
        gapBadge.textContent = 'GAP: BLOCKED';
        gapBadge.className = 'px-1.5 py-0.5 rounded bg-red-950 text-red-400 text-[10px] border border-red-800/60';
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
          memBadge.className = 'px-1.5 py-0.2 rounded bg-indigo-900 text-indigo-200 text-[10px] font-bold border border-indigo-500 animate-pulse';
        }
        if (memTitle) memTitle.textContent = activeMem.title;
        if (memConf) memConf.textContent = `${activeMem.confidence}% (MATCHED)`;
        if (memAction) memAction.textContent = activeMem.preAction;
      } else if (memData && memData.allFeatures && memData.allFeatures.length > 0) {
        const upcoming = memData.allFeatures[0];
        if (memBadge) {
          memBadge.textContent = 'AHEAD (PRIOR MAP)';
          memBadge.className = 'px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 text-[10px] border border-indigo-800';
        }
        if (memTitle) memTitle.textContent = upcoming.title;
        if (memConf) memConf.textContent = `${upcoming.confidence}% (FLEET PRIOR)`;
        if (memAction) memAction.textContent = upcoming.preAction;
      } else {
        if (memBadge) {
          memBadge.textContent = 'STANDBY';
          memBadge.className = 'px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 text-[10px]';
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
      item.className = 'p-1.5 rounded bg-slate-900 border border-slate-800 flex flex-col gap-0.5';
      const timeStr = `${scen.elapsed}s`;
      item.innerHTML = `
        <div class="flex items-center justify-between text-[9px] text-slate-500 font-mono">
          <span>TIME: ${timeStr}</span>
          <span class="text-${evalResult.voicePriority === 'CRITICAL' ? 'red' : 'sky'}-400 font-bold">${evalResult.voicePriority}</span>
        </div>
        <div class="text-slate-200 text-[11px] leading-tight font-medium">"${evalResult.voiceAlert}"</div>
      `;
      voiceLogContainer.prepend(item);
    }
  }
}

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.avocApp = new App();
});
