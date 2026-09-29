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

**On Windows:**
```powershell
python main.py
```
*(or `py main.py` / `python server.py 8000`)*

**On macOS / Linux:**
```bash
python3 main.py
```
*(or `python3 server.py 8000`)*

### Step 2: Open the Web Visualizer
Open your browser and navigate to:
```
http://localhost:8000
```

The interactive dashboard loads immediately with continuous Auto Real-World driving, live sensor overlays, and real-time telemetry.

---

## 3. Interactive Web Visualizer Guide

The visualizer provides a modern professional autonomous-vehicle mission control center split into an organized 4-zone dashboard:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ TOP BAR: NEUROPATH-AV Header │ System Online │ Sim Status │ Clock │ 60 FPS             │
├────────────────────┬──────────────────────────────────────────┬────────────────────────┤
│ LEFT PANEL         │ CENTER VIEWPORT                          │ RIGHT PANEL            │
│ (Vehicle Telemetry)│ (Main 60 FPS Simulation Canvas)          │ (Safety Decision HUD)  │
│                    │                                          │                        │
│ • Speedometer Gauge│ • Bright Violet Autonomous Vehicle       │ • Real-Time Risk Level │
│ • Target Speed     │ • Medium-Gray Asphalt Road Surface       │ • Safety Decision      │
│ • Global (X, Y) Pos│ • Current Planned Route (Teal Corridor)  │ • Primary Threat Card  │
│ • Lane Offset (m)  │ • Replanned Route (Amber Bézier Swerve)  │ • Blindspot Monitor    │
│ • Heading Angle (°)│ • Predicted Trajectory (Green/Orange/Red)│ • Spatial Road Memory  │
│ • Autonomous State │ • Dynamic Vehicle Cushion & Blindspots   │ • Audio Voice Dispatch │
│ • Throttle & Brake │ • Distinct Color-Coded Obstacles         │   Transcript Log       │
├────────────────────┴──────────────────────────────────────────┴────────────────────────┤
│ BOTTOM DOCK (Mission Controls & Simulation Settings)                                   │
│ • Scenario Selection Tabs (Auto Mode + 6 Benchmarks)                                  │
│ • Hazard Injection Quick-Bar (+ Bike, + Pedestrian, + Wrong-Way, + Pothole, etc.)     │
│ • Playback Bar (Pause / Play, Replay, 0.5x, 1x, 2x Speed Multipliers)                │
│ • Sensor Layer Toggles (LiDAR Sweep, Trajectory Arcs, Blindspots, Road Memory)        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Dashboard Controls

| Control | Description |
|---|---|
| **⚡ Auto Real-World (Tab 0)** | Continuous autonomous driving mode with dynamic multi-hazard sequencing (8 realistic traffic challenges), live distance tracking, and safe avoidance counters. |
| **Scenarios 1 to 7 (Tabs 1-7)** | Instant switching across 7 dedicated standalone benchmark driving scenarios. |
| **🌦️ Atmospheric Weather Deck** | Real-time weather switches: `☀️ Day` (nominal daylight), `🌙 Night` (headlights, streetlamps, dark tint), `🌫️ Fog` (volumetric mist & sensor range attenuation), and `🌧️ Rain` (falling particles, wet asphalt sheen, tire spray). |
| **⚡ Inject Hazard Bar** | Trigger immediate real-world hazards on demand (`+ Cut-In`, `+ Pedestrian`, `+ Wrong-Way`, `+ Pothole`, `+ Police`, `+ Junction`, `+ Ambulance`, `+ Stray Cattle`, `🎲 Random`). |
| **Simulation Playback Bar** | Compact playback dock with `⏸ Pause` / `▶ Play`, `↺ Replay`, and simulation speed multipliers (`0.5x`, `1x`, `2x`). |
| **Sensor Toggles** | Live toggles for `LiDAR Sweep Pulse`, `Predictive Trajectory Arcs`, `Blindspot Gap Envelope`, and `Road Spatial Memory`. |
| **Voice Dispatch** | Real-time audio alerts and transcript log with priority escalation (`INFO`, `WARNING`, `CRITICAL`). |

---

### Visualization & Color Architecture

The simulation canvas and dashboard employ an intentional, high-contrast color palette designed for maximum clarity and instant situational awareness:

| Visual Element | Color Code | Representation & Purpose |
|---|---|---|
| **Ego Autonomous Vehicle** | Bright Violet / Purple (`#A855F7` $\rightarrow$ `#6D28D9`) | Gradient violet chassis, `#F3E8FF` specular perimeter border, vibrant purple underglow, xenon headlights, and roof sensor deck with cyan LiDAR puck. High contrast against asphalt. |
| **Current Vehicle Position** | Violet Radar Reticle (`#C084FC`) | Concentric radar pulses expanding from `(ego.x, ego.y)` with calibrated millimeter crosshairs and live telemetry tracking. |
| **Current Planned Route** | Teal (`#2DD4BF` / `#14B8A6`) | Nominal lane corridor ribbon, dashed path centerline, and waypoint navigation nodes. |
| **Replanned / Alternate Route** | Amber (`#F59E0B` / `#FBBF24`) | Glowing cubic Bézier evasion trajectory activated during dynamic obstacle clearance and lane swerves. |
| **Predicted Trajectory** | Dynamic Risk Colors | Forward trajectory projection ribbon and milestone pips:<br>• **Green** (`#10B981`): Safe nominal path<br>• **Orange** (`#F97316`): Caution / warning trajectory<br>• **Red** (`#EF4444`): Dangerous collision trajectory |
| **Safety / Collision Zones** | Dynamic Envelope | Forward vehicle safety cushion and adjacent blindspot envelope indicating clearance status (`CLEAR` in green vs `BLINDSPOT HAZARD` in red). |
| **Asphalt Road Surface** | Medium Gray (`#3A3F4B`) | Non-glare asphalt roadbed with yellow centerline divider and curb markers. |
| **Dashboard Panels** | Deep Charcoal (`#121316`) & Dark Navy (`#090F1D`) | Modern dark theme cards with rounded rectangular borders and clear typographic hierarchy. |

#### Detected Obstacle Classification Colors

Obstacles are dynamically rendered with distinct visual models and color identities based on object type:

- **Emergency Ambulance (108)**: Clean White (`#FFFFFF`) with red cross, reflective chevrons, and roof lightbar with alternating Blue (`#3B82F6`) and Red (`#EF4444`) emergency strobes.
- **Stray Cattle (Indian Zebu)**: Warm Tan/Brown (`#C29B38`) with white flank patches, curved horns, and animated tail.
- **Motorcycle / Two-Wheeler**: Coral / Sunset Orange (`#FF5722`) with rider helmet & orange bounding box.
- **Pedestrian (VRU)**: Electric Yellow / Cyber Gold (`#FACC15`) with animated walking legs and yellow bounding box.
- **Wrong-Way Vehicle**: Crimson / Hazard Red (`#DC2626`) with forward oncoming headlight beams and strobe beacon.
- **Road Defect / Pothole**: Construction Safety Orange (`#F97316`) with asphalt crater and safety cone.
- **Traffic Police Officer**: Royal Blue Uniform (`#2563EB`) with Khaki sash & glowing `STOP`/`PROCEED` hand gesture.
- **Auto-Rickshaw (3W)**: Canary Yellow body (`#FACC15`) with Emerald Green canopy (`#059669`).
- **Parked Auto**: Steel Slate (`#475569`) with flashing amber hazard blinkers (`#F59E0B`).
- **Civilian Sedan**: Cobalt / Royal Blue (`#0284C7`).

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

### Tab 7: Emergency Responder Priority Corridor Yield
- **Real-World Reality**: A high-speed emergency ambulance with flashing red and blue strobe beacons and siren approaches rapidly from behind in our driving lane.
- **Traditional AV Failure**: Maintains nominal cruise speed or performs late erratic braking, obstructing the life-saving transit corridor.
- **AVOC Adaptive Decision**: Continuously monitors rear closing rate (`TTC_rear < 3.5s with emergency signature`). Pre-conditions left turn indicator, validates left shoulder clearance, smoothly repositions toward the left shoulder, and decelerates to a crawl (`~3.0 m/s`) to open a wide corridor for the ambulance to overtake safely. Resumes nominal cruising once longitudinal separation is restored.

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
# Windows
python main.py --test
# (or: py main.py --test)

# macOS / Linux
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
# Windows:
python main.py --cli --scenario 1
python main.py --cli --scenario 5

# macOS / Linux:
python3 main.py --cli --scenario 1
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
│   ├── index.html              # 4-Zone Autonomous Control Center (Top Bar, Telemetry, Canvas, Brain HUD, Dock)
│   ├── styles.css              # Modern dark theme styles, rounded cards, and radar animations
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
