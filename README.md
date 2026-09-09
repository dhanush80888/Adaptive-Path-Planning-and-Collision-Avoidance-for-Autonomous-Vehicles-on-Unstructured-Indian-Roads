# Adaptive Collision Avoidance for Autonomous Vehicles (AVOC)

> **A Pure Python Adaptive Safety Layer & Real-Time 60 FPS Simulation Engine for Unstructured Mixed-Traffic Driving (Left-Hand Traffic / LHT).**

[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-emerald.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-zero%20(stdlib%20only)-brightgreen.svg)]()
[![Safety Invariant](https://img.shields.io/badge/safety-zero%20collisions-success.svg)]()
[![Driving Rule](https://img.shields.io/badge/traffic-left--hand%20traffic%20(LHT)-orange.svg)]()

---

## Table of Contents
1. [Overview & What AVOC Solves](#1-overview--what-avoc-solves)
2. [Quickstart (Run in 10 Seconds)](#2-quickstart-run-in-10-seconds)
3. [Interactive Web Visualizer Guide](#3-interactive-web-visualizer-guide)
4. [Driving Scenarios & Dynamic Hazard Suite](#4-driving-scenarios--dynamic-hazard-suite)
5. [System Architecture & Core Safety Modules](#5-system-architecture--core-safety-modules)
6. [CLI Telemetry & Safety Test Suite](#6-cli-telemetry--safety-test-suite)
7. [Codebase & File Structure](#7-codebase--file-structure)

---

## 1. Overview & What AVOC Solves

### The Problem
Traditional Autonomous Vehicle (AV) safety systems assume structured roads: clear lane markings, uniform passenger vehicles, predictable highway merges, and rule-abiding drivers.

In **unstructured mixed-traffic environments**, road conditions are fundamentally non-ideal:
- **Heterogeneous Road Users**: 2-wheelers (motorcycles, scooters), 3-wheelers (auto-rickshaws), city buses, heavy commercial trucks, roadside pedestrians, and road work debris sharing dense corridors.
- **Micro-Swerves & Lateral Drift**: Vehicles weave within single lanes, filter aggressively through narrow gaps, and cut into vehicle braking corridors.
- **Directional & Human Anomalies**: Oncoming wrong-way vehicles entering from illegal median cuts, unregulated multi-agent junction conflicts, and human traffic police directing traffic via manual hand gestures.

### What AVOC Does
**AVOC is an Adaptive Safety Layer ("Safety Supervisor")** that sits directly between vehicle perception/tracking and low-level actuation. It evaluates:
1. **Lateral Volatility**: Detects micro-swerves and drifts before a vehicle physically cuts across our lane.
2. **Asymmetric 2D Conflict Cones**: Computes closing rates based on spatial trajectories rather than fixed lane bounds.
3. **The "Never Blindly Swerve" Rule**: Validates adjacent lane blindspots before swerving around obstacles; halts safely in-lane if adjacent space is blocked.
4. **Human Priority Hand Override**: Gives precedence to traffic police hand gestures over standard intersection flow rules.
5. **Spatial Road Memory Priors**: Pre-conditions vehicle braking and lane centering based on historical hotspot knowledge.

> **Zero External Dependencies**: AVOC requires only Python 3 standard library (`math`, `json`, `http.server`, `urllib`). No pip packages required.

---

## 2. Quickstart (Run in 10 Seconds)

### Step 1: Launch the Server
Clone or navigate to the project directory and run:

```bash
python3 main.py
```
*(Alternatively: `python3 server.py 8000`)*

### Step 2: Open the Web Visualizer
Open your browser and navigate to:
```
http://localhost:8000
```

The interactive dashboard loads immediately with continuous Auto Real-World driving, live sensor overlays, and real-time telemetry.

---

## 3. Interactive Web Visualizer Guide

The visualizer provides a modern automotive glassmorphism dashboard split into two main sections:

```text
┌────────────────────────────────────────────────────────┬───────────────────────────┐
│              75% ROAD VIEWPORT (CANVAS)                │   25% SAFETY BRAIN HUD    │
│  - 60 FPS Double-Buffered Canvas (Zero Screen Flicker) │  - Collision Risk Meter   │
│  - Real-Time LHT Road Geometry & Curbs                 │  - Target Vehicle Telemetry│
│  - Animated Radar Sweep & Predicted Trajectories       │  - Speedometer & Braking  │
│  - Blindspot Spatial Envelope Overlay                  │  - Blindspot Gap Monitor  │
│  - Historical Road Memory Hotspot Highlights           │  - Spatial Memory Prior   │
│  - Dynamic Scenario Tabs & Hazard Injection Bar        │  - Live Voice Log Queue   │
└────────────────────────────────────────────────────────┴───────────────────────────┘
```

### Dashboard Controls

| Control | Description |
|---|---|
| **⚡ Auto Real-World (Tab 0)** | Continuous driving mode with dynamic hazard sequencing, live distance tracking, and safe avoidance counters. |
| **Scenarios 1 to 6 (Tabs 1-6)** | Instant switching to dedicated standalone benchmark scenarios. |
| **⚡ Inject Hazard Bar** | Trigger immediate real-world hazards on demand (`+ Bike Cut-In`, `+ Pedestrian`, `+ Wrong-Way`, `+ Pothole`, `+ Police`, `+ Junction`, `🎲 Random`). |
| **Playback Bar** | `⏸ Pause` / `▶ Play`, `↺ Replay`, and simulation speed multipliers (`0.5x`, `1x`, `2x`). |
| **Sensor Toggles** | Live toggles for `LiDAR Sweep Pulse`, `Predictive Trajectory Arcs`, `Blindspot Gap Envelope`, and `Road Spatial Memory`. |
| **Voice Dispatch** | Real-time audio alerts and transcript log with priority escalation (`INFO`, `WARNING`, `CRITICAL`). |

---

## 4. Driving Scenarios & Dynamic Hazard Suite

### Tab 0: ⚡ Auto Real-World (Continuous Driving)
- **Concept**: A continuous urban corridor driving experience. Procedurally cycles through all realistic traffic challenges with clear cruising intervals between events.
- **Live Metrics**: Displays cumulative distance traveled (`meters`), safe hazards avoided count, and zero collision tracking.
- **On-Demand Injection**: Users can inject any of the 6 hazards or click `🎲 Random Multi-Hazard` to test immediate adaptive reaction.

---

### Tab 1: Sudden Motorcycle Cut-In
- **Real-World Reality**: A two-wheeler overtakes from behind on the vehicle flank and sharply cuts into the ego car braking corridor.
- **Traditional AV Failure**: Ignores the bike until it enters the lane; results in late, violent braking or rear-end collisions.
- **AVOC Adaptive Decision**: Monitors lateral volatility (`lateral_volatility > 1.4 m/s`). As the bike veers inward, AVOC proactively expands the longitudinal buffer, smoothly drops speed to ~20 km/h, and restores nominal cruising once the bike clears ahead.

---

### Tab 2: Sudden Roadside Pedestrian Crossing
- **Real-World Reality**: A pedestrian suddenly steps from an informal roadside curb ramp into the vehicle travel lane while another vehicle follows closely behind.
- **Traditional AV Failure**: Slams on emergency brakes regardless of following traffic, causing a rear-end collision from the trailing car.
- **AVOC Adaptive Decision**: Computes closing trajectory to the pedestrian. Balances front stopping distance with rear buffer safety, coming to a gentle, controlled stop at least 5m before the pedestrian, and safely resuming once the pedestrian clears.

---

### Tab 3: Oncoming Wrong-Way Vehicle
- **Real-World Reality**: An oncoming vehicle drives in reverse against traffic in our left lane following an illegal median opening.
- **Traditional AV Failure**: Assumes all vehicles in the lane travel in the forward direction, causing fatal head-on collision.
- **AVOC Adaptive Decision**: Flags reverse heading (`abs(heading - π) < 0.5`), escalates risk to **CRITICAL RED**, initiates maximum emergency braking to 0 km/h, and tucks laterally toward the shoulder to maximize separation as the vehicle edges past.

---

### Tab 4: Traffic Police Hand Signal Override
- **Real-World Reality**: An active traffic police officer at an intersection raises a manual hand gesture to halt traffic, overriding traffic lights.
- **Traditional AV Failure**: Autonomous perception only recognizes electronic traffic signals; ignores human hand gestures.
- **AVOC Adaptive Decision**: **Human-in-the-loop priority override**. Perception recognizes `PoliceGesture.STOP`, stops the AV 8 meters before the intersection, holds position, and automatically proceeds when the officer waves `PoliceGesture.PROCEED`.

---

### Tab 5: Road Pothole Obstacle with Blindspot Validation
- **Real-World Reality**: A severe road defect/construction rubble blocks the lane while the adjacent right lane is occupied by a passing vehicle.
- **The "Never Blindly Swerve" Rule**:
  - **Phase 1 (Blocked Blindspot)**: Adjacent lane is occupied. Ego vehicle **holds lane and halts safely behind the obstacle** without swerving into the occupied lane.
  - **Phase 2 (Clearance)**: Once the adjacent vehicle passes and a safe gap (`>14m`) is verified, Ego signals, repositions safely into the opening, clears the obstacle, and returns to the base lane.

---

### Tab 6: Busy Unregulated Mixed-Traffic Junction
- **Real-World Reality**: An unstructured intersection with cross-traffic auto-rickshaws and turning bikes cutting across without priority signs.
- **Traditional AV Failure**: Deadlocks or attempts aggressive insertion into occupied paths.
- **AVOC Adaptive Decision**: Employs multi-agent conflict cones. Drops to a cautious crawl (`~3.5 m/s`), yields smoothly to cross-traffic, and accelerates cleanly through the junction once the corridor clears.

---

## 5. System Architecture & Core Safety Modules

```text
 ┌────────────────────────────────────────────────────────┐
 │                    PERCEPTION FEED                     │
 │          (Vehicles, Pedestrians, Police, Road)         │
 └───────────────────────────┬────────────────────────────┘
                             │
                             ▼
 ┌────────────────────────────────────────────────────────┐
 │               HISTORICAL ROAD MEMORY                   │
 │   - Spatial prior database (Curbs, junctions, hazards) │
 │   - Proximity pre-conditioning of speed and lane       │
 └───────────────────────────┬────────────────────────────┘
                             │
                             ▼
 ┌────────────────────────────────────────────────────────┐
 │                ADAPTIVE CONTEXT LAYER                  │
 │   1. Lateral Volatility Profiler (Micro-swerves)       │
 │   2. Asymmetric Spatial TTC Engine                     │
 │   3. "Never Blindly Swerve" Blindspot Gap Validator    │
 │   4. Human Gesture Priority Resolver (Police STOP)     │
 └───────────────────────────┬────────────────────────────┘
                             │
                             ▼
 ┌────────────────────────────────────────────────────────┐
 │              DETERMINISTIC STATE MACHINE               │
 │   [CRUISING] ──► [AWARENESS] ──► [DECELERATING]        │
 │       ▲                                │               │
 │       │                                ▼               │
 │   [RECOVERING] ◄── [CLEARING] ◄── [EMERGENCY_STOP /    │
 │                                    SAFE_REPOSITION]    │
 └───────────────────────────┬────────────────────────────┘
                             │
                             ▼
 ┌────────────────────────────────────────────────────────┐
 │                  ACTUATION CONTROLS                    │
 │        (Target Speed, Target X, Steering, Brakes)      │
 └────────────────────────────────────────────────────────┘
```

### 1. Spatial Road Memory (`avoc/road_memory.py`)
Maintains prior knowledge of roadway segments (informal pedestrian crossing points, unregulated junctions, blind spots). Pre-activates defensive awareness before sensors achieve line-of-sight.

### 2. Kinematics & Physics Engine (`avoc/physics.py`)
Computes realistic longitudinal acceleration (`max 2.8 m/s²`), deceleration (`max 6.5 m/s²`), smooth bicycle-model lateral steering, and predictive trajectory ribbons (projected 3 seconds ahead).

### 3. Adaptive Context Layer (`avoc/context_layer.py`)
Synthesizes sensor inputs, spatial memory priors, and blindspot clearances to evaluate the primary threat and output safe target speed and lateral coordinate targets.

### 4. Deterministic State Machine (`avoc/state_machine.py`)
Guarantees deterministic, auditable state transitions without jitter or mode-thrashing.

---

## 6. CLI Telemetry & Safety Test Suite

### Run the Automated Safety Test Suite
To verify collision-free guarantees across all benchmark scenarios and rules:

```bash
python3 main.py --test
```

**Expected Output:**
```text
=================================================================
  RUNNING AVOC SAFETY VERIFICATION SUITE (ALL 6 SCENARIOS)
=================================================================
  [PASSED] Auto Mode: Multi-Hazard Dynamic Sequence
           Min Dist: 4.7m | Min Speed: 0.0 km/h
           Key Decisions: EMERGENCY_BUFFER_EXPANSION, NORMAL_CRUISE, SLOW_AND_MAINTAIN_GAP
  [PASSED] Scenario 1: Bike Cut-In
           Min Dist: 3.3m | Min Speed: 19.8 km/h
  [PASSED] Scenario 2: Sudden Pedestrian
           Min Dist: 5.3m | Min Speed: 0.0 km/h
  [PASSED] Scenario 3: Wrong-Way Vehicle
           Min Dist: 2.7m | Min Speed: 0.0 km/h
  [PASSED] Scenario 4: Traffic Police Gesture
           Min Dist: 2.0m | Min Speed: 0.0 km/h
  [PASSED] Scenario 5: Obstacle Blindspot Check
           Min Dist: 2.0m | Min Speed: 0.0 km/h
  [PASSED] Scenario 6: Busy Mixed Junction
           Min Dist: 17.2m | Min Speed: 23.1 km/h
=================================================================
  ALL 6 SCENARIOS SAFELY VERIFIED! ZERO COLLISIONS DETECTED.
=================================================================
```

### Run Terminal CLI Telemetry Mode
Inspect frame-by-frame ASCII telemetry directly inside your terminal:

```bash
# Run Motorcycle Cut-In scenario in terminal
python3 main.py --cli --scenario 1

# Run Pothole Blindspot Swerve scenario in terminal
python3 main.py --cli --scenario 5
```

---

## 7. Codebase & File Structure

```text
avoc/
├── avoc/                       # Core Python Safety Engine (Standard Library Only)
│   ├── constants.py            # Road layouts, entity types, risk levels, and physics constants
│   ├── physics.py              # 2D vehicle kinematics, trajectory projection, camera tracking
│   ├── context_layer.py        # Threat evaluation, TTC, volatility, and blindspot rules
│   ├── road_memory.py          # Spatial memory database & historical prior map
│   ├── state_machine.py        # Deterministic Ego AV finite state machine
│   ├── scenarios.py            # Scenario 0 (Auto Mode) & benchmark scenarios 1 through 6
│   └── simulation.py           # Simulation orchestrator & telemetry serializer
├── web/                        # 60 FPS Web Simulation Dashboard
│   ├── index.html              # 75% Road Canvas Viewport + 25% Safety Brain HUD
│   ├── styles.css              # Automotive glassmorphism dark theme & radar animations
│   └── app.js                  # Double-buffered canvas renderer, audio controller & HUD updater
├── server.py                   # Lightweight multi-threaded Python HTTP server & REST API
├── main.py                     # Unified CLI launcher, test suite runner, and server entrypoint
└── README.md                   # Project documentation & user guide
```

---

## 8. Requirements & Compatibility

- **Operating System**: Linux, macOS, or Windows
- **Python Version**: Python 3.8+ (Pure Standard Library; zero external dependencies)
- **Web Browser**: Any modern browser (Firefox, Chrome, Edge, Safari) with HTML5 Canvas and JavaScript enabled.
- **Traffic Rule**: Strict Left-Hand Traffic (LHT) corridor conventions.
