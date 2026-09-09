"""
Simulation Engine
Orchestrates road layout, entity updates, adaptive context evaluation,
ego finite state machine, and telemetry logging.
"""

from typing import Dict, Any, List
from .constants import (
    TIME_STEP,
    PIXELS_PER_METER,
    LANE_WIDTH_METERS,
    EgoState,
    RiskLevel,
    RISK_METADATA,
)
from .physics import Vehicle
from .context_layer import ContextLayer
from .state_machine import StateMachine
from .scenarios import ScenarioManager

class Simulation:
    def __init__(self, canvas_width: float = 1280.0, canvas_height: float = 720.0):
        self.canvas_width = canvas_width
        self.canvas_height = canvas_height

        # Road dimensions (Left-hand traffic)
        self.road_center_x = canvas_width * 0.48
        self.lane_width_px = LANE_WIDTH_METERS * PIXELS_PER_METER
        self.lane_left_x = self.road_center_x - (self.lane_width_px / 2)
        self.lane_right_x = self.road_center_x + (self.lane_width_px / 2)
        self.road_left_edge = self.road_center_x - self.lane_width_px - 30.0
        self.road_right_edge = self.road_center_x + self.lane_width_px + 30.0

        self.road_layout = {
            "canvas_width": self.canvas_width,
            "canvas_height": self.canvas_height,
            "road_center_x": self.road_center_x,
            "lane_left_x": self.lane_left_x,
            "lane_right_x": self.lane_right_x,
            "road_left_edge": self.road_left_edge,
            "road_right_edge": self.road_right_edge,
            "lane_width_px": self.lane_width_px,
        }

        self.context_layer = ContextLayer()
        self.state_machine = StateMachine()
        self.scenario_manager = ScenarioManager(self.road_layout)
        from .road_memory import RoadMemoryEngine
        self.road_memory = RoadMemoryEngine()

        self.ego: Vehicle = None
        self.entities: List[Vehicle] = []
        self.latest_eval: Dict[str, Any] = {}
        self.latest_voice: str = ""
        self.audio_log: List[Dict[str, str]] = []

        self.reset()

    def reset(self):
        """Reset current scenario to initial conditions"""
        self.state_machine.reset()
        self.ego, self.entities = self.scenario_manager.reset_current()
        self.road_memory.load_scenario_memory(self.scenario_manager.current_scenario.id)
        active_memory = self.road_memory.evaluate_proximity(self.ego.y)
        self.latest_eval = self.context_layer.evaluate(self.ego, self.entities, active_memory)
        self.latest_voice = ""

    def select_scenario(self, index: int):
        """Switch to another scenario"""
        self.state_machine.reset()
        self.ego, self.entities = self.scenario_manager.select_scenario(index)
        self.road_memory.load_scenario_memory(self.scenario_manager.current_scenario.id)
        active_memory = self.road_memory.evaluate_proximity(self.ego.y)
        self.latest_eval = self.context_layer.evaluate(self.ego, self.entities, active_memory)
        self.latest_voice = ""

    def inject_hazard(self, hazard_type: str):
        """Inject a dynamic hazard into the active scenario (or switch to Auto mode)"""
        current = self.scenario_manager.current_scenario
        if hasattr(current, "inject_hazard"):
            current.inject_hazard(hazard_type, self.ego, self.entities)
        else:
            self.select_scenario(0)
            if hasattr(self.scenario_manager.current_scenario, "inject_hazard"):
                self.scenario_manager.current_scenario.inject_hazard(hazard_type, self.ego, self.entities)

        # Immediately update road memory prior and evaluate perception
        if hasattr(self.scenario_manager.current_scenario, "get_current_road_memory"):
            active_mems = self.scenario_manager.current_scenario.get_current_road_memory()
            if active_mems:
                self.road_memory.set_features(active_mems)

        active_memory = self.road_memory.evaluate_proximity(self.ego.y)
        self.latest_eval = self.context_layer.evaluate(self.ego, self.entities, active_memory)

    def step(self, dt: float = TIME_STEP) -> Dict[str, Any]:
        """Execute one simulation frame"""
        # 1. Update scenario progression and scripted trajectories
        self.scenario_manager.current_scenario.update(dt, self.ego, self.entities)

        # Dynamic road memory update for Auto Mode
        if hasattr(self.scenario_manager.current_scenario, "get_current_road_memory"):
            active_mems = self.scenario_manager.current_scenario.get_current_road_memory()
            if active_mems:
                self.road_memory.set_features(active_mems)

        # 2. Evaluate proximity to historical road memory priors
        active_memory = self.road_memory.evaluate_proximity(self.ego.y)

        # 3. Evaluate perception fused with Road Memory Prior
        self.latest_eval = self.context_layer.evaluate(self.ego, self.entities, active_memory)

        # 3. Update Ego State Machine
        new_voice = self.state_machine.update(dt, self.latest_eval, self.ego)
        if new_voice:
            self.latest_voice = new_voice
            self.audio_log.append({
                "time": f"{self.scenario_manager.current_scenario.elapsed:.1f}s",
                "text": new_voice,
                "priority": self.latest_eval.get("voice_priority", "INFO"),
            })
            if len(self.audio_log) > 20:
                self.audio_log.pop(0)

        # 4. Actuate Ego Vehicle according to Context Layer output
        self.ego.target_speed = self.latest_eval["safe_target_speed"]
        self.ego.target_x = self.latest_eval["target_x"]

        # 5. Integrate kinematics and relative camera positioning
        ego_speed = self.ego.speed
        for entity in self.entities:
            entity.update_kinematics(dt)
            entity.update_relative_position(dt, ego_speed)

        return self.get_state()

    def get_state(self) -> Dict[str, Any]:
        """Serialize complete simulation state for web visualizer or CLI inspection"""
        current_scen = self.scenario_manager.current_scenario
        progress = min(1.0, current_scen.elapsed / current_scen.duration) if current_scen.duration else 0.0

        risk_val = self.latest_eval.get("risk_level", RiskLevel.NOMINAL.value)
        risk_enum = RiskLevel(risk_val)

        auto_stats = current_scen.get_auto_stats() if hasattr(current_scen, "get_auto_stats") else None

        return {
            "scenario": {
                "id": current_scen.id,
                "name": current_scen.name,
                "description": current_scen.description,
                "elapsed": round(current_scen.elapsed, 1),
                "duration": current_scen.duration,
                "progress": round(progress, 3),
                "isCompleted": current_scen.is_completed(),
                "currentIndex": self.scenario_manager.current_index,
            },
            "autoStats": auto_stats,
            "road": self.road_layout,
            "ego": self.ego.to_dict(),
            "entities": [e.to_dict() for e in self.entities if e.id != self.ego.id],
            "evaluation": {
                "riskLevel": risk_val,
                "riskMetadata": RISK_METADATA.get(risk_enum, {}),
                "decision": self.latest_eval.get("decision", ""),
                "safeTargetSpeed": self.latest_eval.get("safe_target_speed", 0.0),
                "targetX": self.latest_eval.get("target_x", self.ego.x),
                "ttc": self.latest_eval.get("ttc"),
                "primaryThreat": self.latest_eval.get("primary_threat"),
                "blindspotStatus": self.latest_eval.get("blindspot_status", {}),
                "voiceAlert": self.latest_eval.get("voice_alert"),
                "voicePriority": self.latest_eval.get("voice_priority"),
            },
            "egoState": self.state_machine.current_state.value,
            "roadMemory": self.road_memory.get_state(),
            "audio": {
                "latestVoice": self.latest_voice,
                "log": self.audio_log,
            },
        }
