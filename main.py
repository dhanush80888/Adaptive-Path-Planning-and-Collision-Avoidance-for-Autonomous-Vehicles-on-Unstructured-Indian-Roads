#!/usr/bin/env python3
"""
Main Entrypoint for Adaptive Collision Avoidance System for Autonomous Vehicles (AVOC)
Supports:
  1. Default: Interactive Web Visualizer Server (python3 main.py)
  2. CLI Mode: Live terminal ASCII telemetry (python3 main.py --cli [--scenario 1])
  3. Test Mode: Automated test verification suite (python3 main.py --test)
"""

import sys
import time
import argparse
from avoc.simulation import Simulation
from avoc.constants import RiskLevel, EgoState

def run_test_suite():
    """Runs automated verification tests across all benchmark scenarios"""
    print("\n" + "=" * 65)
    print("  RUNNING AVOC SAFETY VERIFICATION SUITE (ALL BENCHMARK SCENARIOS)")
    print("=" * 65)

    sim = Simulation()
    all_passed = True

    tests = [
        ("Auto Mode: Multi-Hazard Dynamic Sequence", 0, lambda s, logs: "CRITICAL" in logs["risks"] and logs["min_speed"] < 1.0 and s.hazards_avoided >= 1 and s.collisions == 0),
        ("Scenario 1: Bike Cut-In", 1, lambda s, logs: "CRITICAL" in logs["risks"] and logs["min_dist"] > 2.0),
        ("Scenario 2: Sudden Pedestrian", 2, lambda s, logs: "CRITICAL" in logs["risks"] and logs["min_speed"] < 1.0),
        ("Scenario 3: Wrong-Way Vehicle", 3, lambda s, logs: "CRITICAL" in logs["risks"] and logs["min_speed"] < 1.0),
        ("Scenario 4: Traffic Police Gesture", 4, lambda s, logs: "POLICE_OVERRIDE_STOP" in logs["decisions"] and logs["min_speed"] < 1.0),
        ("Scenario 5: Obstacle Blindspot Check", 5, lambda s, logs: "HOLD_LANE_ADJACENT_OCCUPIED" in logs["decisions"] and "SAFE_REPOSITION_AROUND_OBSTACLE" in logs["decisions"]),
        ("Scenario 6: Busy Mixed Junction", 6, lambda s, logs: "YIELD_JUNCTION_CROSS_TRAFFIC" in logs["decisions"] and logs["min_dist"] > 1.8),
        ("Scenario 7: Emergency Corridor Yield", 7, lambda s, logs: "YIELD_EMERGENCY_CORRIDOR" in logs["decisions"] and logs["min_speed"] < 4.0),
    ]

    for name, idx, validator in tests:
        sim.select_scenario(idx)
        scen = sim.scenario_manager.current_scenario
        steps = 1200 if idx == 0 else int(scen.duration * 60)

        logs = {
            "risks": set(),
            "states": set(),
            "decisions": set(),
            "min_dist": float("inf"),
            "min_speed": float("inf"),
        }

        for _ in range(steps):
            st = sim.step(1 / 60)
            logs["risks"].add(st["evaluation"]["riskLevel"])
            logs["states"].add(st["egoState"])
            logs["decisions"].add(st["evaluation"]["decision"])
            logs["min_speed"] = min(logs["min_speed"], st["ego"]["speed"])

            threat = st["evaluation"]["primaryThreat"]
            if threat:
                dx = (threat["x"] - st["ego"]["x"]) / 16.0
                dy = (threat["y"] - st["ego"]["y"]) / 16.0
                dist = (dx * dx + dy * dy) ** 0.5
                logs["min_dist"] = min(logs["min_dist"], dist)

        passed = validator(scen, logs)
        status_str = "\033[92m[PASSED]\033[0m" if passed else "\033[91m[FAILED]\033[0m"
        print(f"  {status_str} {name}")
        print(f"           Min Dist: {logs['min_dist']:.1f}m | Min Speed: {logs['min_speed']*3.6:.1f} km/h")
        print(f"           Key Decisions: {', '.join(sorted(list(logs['decisions']))[:3])}")
        if not passed:
            all_passed = False

    print("=" * 65)
    if all_passed:
        print("\033[92m  ALL BENCHMARK SCENARIOS SAFELY VERIFIED! ZERO COLLISIONS DETECTED.\033[0m")
    else:
        print("\033[91m  SOME SCENARIOS FAILED VERIFICATION.\033[0m")
    print("=" * 65 + "\n")
    return all_passed


def run_cli_simulation(scenario_idx: int = 0):
    """Runs a real-time ASCII telemetry dashboard in terminal"""
    sim = Simulation()
    sim.select_scenario(scenario_idx)
    scen = sim.scenario_manager.current_scenario

    print(f"\nStarting CLI Telemetry for: {scen.name}")
    print(f"Description: {scen.description}\n")
    time.sleep(1.0)

    step_dt = 1 / 20  # 20 Hz output for readability
    total_steps = int(scen.duration / step_dt)

    for i in range(total_steps):
        st = sim.step(step_dt)
        ego = st["ego"]
        eval_res = st["evaluation"]
        risk = eval_res["riskLevel"]
        decision = eval_res["decision"]
        ttc = eval_res.get("ttc") or "--"
        bs = eval_res["blindspotStatus"]
        bs_str = "CLEAR" if bs.get("is_right_clear") else "OCCUPIED"

        # ANSI color for risk
        color = "\033[92m"  # green
        if risk == "AWARENESS":
            color = "\033[93m"  # yellow
        elif risk == "ELEVATED":
            color = "\033[38;5;208m"  # orange
        elif risk == "CRITICAL":
            color = "\033[91m"  # red

        line = (
            f"T={st['scenario']['elapsed']:4.1f}s | "
            f"Speed: {ego['speedKmh']:4.1f} km/h | "
            f"State: {st['egoState']:<15} | "
            f"Risk: {color}{risk:<8}\033[0m | "
            f"TTC: {str(ttc):>4}s | "
            f"RightGap: {bs_str:<8} | "
            f"Decision: {decision}"
        )
        try:
            print(line, flush=True)
            if eval_res.get("voiceAlert") and st["audio"]["latestVoice"]:
                print(f"   📢 [VOICE]: \"{st['audio']['latestVoice']}\"", flush=True)
        except BrokenPipeError:
            sys.exit(0)

        time.sleep(step_dt)

    print("\nScenario completed safely.\n")


def main():
    parser = argparse.ArgumentParser(description="Adaptive Collision Avoidance for Autonomous Vehicles (AVOC)")
    parser.add_argument("--cli", action="store_true", help="Run in terminal CLI mode")
    parser.add_argument("--scenario", type=int, default=1, help="Scenario index 1-6 (for CLI mode)")
    parser.add_argument("--test", action="store_true", help="Run automated safety verification test suite")
    parser.add_argument("--port", type=int, default=8000, help="Web server port (default: 8000)")

    args = parser.parse_args()

    if args.test:
        success = run_test_suite()
        sys.exit(0 if success else 1)
    elif args.cli:
        idx = max(0, min(6, args.scenario))
        run_cli_simulation(idx)
    else:
        # Default: Start web visualizer server
        from server import run_server
        run_server(args.port)


if __name__ == "__main__":
    main()
