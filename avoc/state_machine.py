"""
Finite State Machine for Autonomous Ego Vehicle
Governs state transitions, hysteresis stability,
and recovery sequences back to cruise speed.
"""

from typing import Dict, Any, Optional
from .constants import EgoState, RiskLevel
from .physics import Vehicle

class StateMachine:
    def __init__(self):
        self.current_state = EgoState.CRUISING
        self.time_in_state = 0.0
        self.recovery_timer = 0.0
        self.last_decision = ""
        self.last_voice_alert = ""

    def update(self, dt: float, eval_result: Dict[str, Any], ego: Vehicle) -> Optional[str]:
        """
        Update state machine per tick.
        Returns newly triggered voice message if state change or decision warrants it.
        """
        self.time_in_state += dt
        risk_level = RiskLevel(eval_result["risk_level"])
        decision = eval_result["decision"]
        new_voice_to_speak: Optional[str] = None

        if self.current_state == EgoState.CRUISING:
            if risk_level == RiskLevel.CRITICAL:
                if decision == "POLICE_OVERRIDE_STOP":
                    self.transition_to(EgoState.POLICE_OVERRIDE_STOP)
                elif decision in ("EMERGENCY_STOP_WRONG_WAY", "YIELD_TO_PEDESTRIAN", "STOP_PEDESTRIAN_IN_LANE", "YIELD_JUNCTION_CROSS_TRAFFIC"):
                    self.transition_to(EgoState.EMERGENCY_STOP)
                elif decision in ("HOLD_LANE_ADJACENT_OCCUPIED", "SLOW_DOWN_REAR_SAFETY"):
                    self.transition_to(EgoState.DECELERATING)
                else:
                    self.transition_to(EgoState.DECELERATING)
            elif risk_level == RiskLevel.ELEVATED:
                if decision == "SAFE_REPOSITION_AROUND_OBSTACLE":
                    self.transition_to(EgoState.SAFE_REPOSITIONING)
                elif decision == "SLOW_DOWN_REAR_SAFETY":
                    self.transition_to(EgoState.DECELERATING)
                else:
                    self.transition_to(EgoState.DECELERATING)
            elif risk_level == RiskLevel.AWARENESS:
                self.transition_to(EgoState.MONITORING)

        elif self.current_state == EgoState.MONITORING:
            if risk_level == RiskLevel.CRITICAL:
                self.transition_to(EgoState.EMERGENCY_STOP)
            elif risk_level == RiskLevel.ELEVATED:
                self.transition_to(EgoState.DECELERATING)
            elif risk_level == RiskLevel.NOMINAL:
                self.transition_to(EgoState.CRUISING)

        elif self.current_state == EgoState.DECELERATING:
            if risk_level == RiskLevel.CRITICAL:
                self.transition_to(EgoState.EMERGENCY_STOP)
            elif risk_level == RiskLevel.NOMINAL:
                self.transition_to(EgoState.RECOVERING)

        elif self.current_state in (EgoState.EMERGENCY_STOP, EgoState.POLICE_OVERRIDE_STOP, EgoState.YIELDING):
            if risk_level == RiskLevel.NOMINAL or decision in ("POLICE_PROCEED_ALLOWED", "NORMAL_CRUISE"):
                self.recovery_timer += dt
                if self.recovery_timer > 0.6:
                    self.transition_to(EgoState.RECOVERING)
                    self.recovery_timer = 0.0
            else:
                self.recovery_timer = 0.0

        elif self.current_state == EgoState.SAFE_REPOSITIONING:
            # Check if ego has traversed past the obstacle
            if decision == "NORMAL_CRUISE" or not eval_result["primary_threat"]:
                self.transition_to(EgoState.RETURNING_TO_LANE)

        elif self.current_state == EgoState.RETURNING_TO_LANE:
            if abs(ego.x - ego.target_x) < 3.0:
                self.transition_to(EgoState.RECOVERING)

        elif self.current_state == EgoState.RECOVERING:
            if risk_level != RiskLevel.NOMINAL:
                self.transition_to(EgoState.DECELERATING)
            elif self.time_in_state > 1.2 and abs(ego.speed - ego.target_speed) < 0.5:
                self.transition_to(EgoState.CRUISING)
                new_voice_to_speak = "Path clear. Resuming cruising speed."

        # Check for new voice alerts
        voice_alert = eval_result.get("voice_alert")
        if voice_alert and voice_alert != self.last_voice_alert:
            self.last_voice_alert = voice_alert
            new_voice_to_speak = voice_alert

        return new_voice_to_speak

    def transition_to(self, new_state: EgoState):
        if self.current_state == new_state:
            return
        self.current_state = new_state
        self.time_in_state = 0.0

    def reset(self):
        self.current_state = EgoState.CRUISING
        self.time_in_state = 0.0
        self.recovery_timer = 0.0
        self.last_decision = ""
        self.last_voice_alert = ""
