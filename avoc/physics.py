"""
Vehicle Physics and Kinematics Engine (Ego-Centric & Relative Reference Frame)
Supports camera tracking where Ego AV remains in clear view on screen (Y ≈ 480),
road scrolls dynamically at Ego speed, and surrounding entities move
with realistic longitudinal and lateral physics.
"""

import math
from typing import List, Dict, Any
from .constants import EntityType, PoliceGesture, PIXELS_PER_METER, TIME_STEP

class Vehicle:
    def __init__(
        self,
        id: str,
        type: EntityType,
        name: str = "",
        x: float = 0.0,
        y: float = 0.0,
        speed: float = 0.0,
        target_speed: float = 0.0,
        max_speed: float = 15.0,
        heading: float = 0.0,
        width_m: float = 1.8,
        length_m: float = 4.2,
        color: str = "#0ea5e9",
        max_accel: float = 2.8,
        max_decel: float = 6.5,
        lateral_volatility: float = 0.0,
        gesture: PoliceGesture = PoliceGesture.NONE,
    ):
        self.id = id
        self.type = type
        self.name = name or type.value
        self.x = float(x)
        self.y = float(y)
        self.target_x = float(x)
        self.target_y = float(y)
        self.base_lane_x = float(x)

        self.width_m = float(width_m)
        self.length_m = float(length_m)

        self.heading = float(heading)  # 0 radians = North (-Y)
        self.base_heading = float(heading)
        self.speed = float(speed)
        self.target_speed = float(target_speed if target_speed != 0 else speed)
        self.max_speed = float(max_speed)
        self.acceleration = 0.0
        self.max_accel = float(max_accel)
        self.max_decel = float(max_decel)

        self.lateral_volatility = float(lateral_volatility)
        self.color = color
        self.gesture = gesture
        self.state = "ACTIVE"
        self.walk_cycle = 0.0
        self.predicted_trajectory: List[Dict[str, float]] = []

    @property
    def speed_kmh(self) -> float:
        return round(self.speed * 3.6, 1)

    @property
    def width_px(self) -> float:
        return self.width_m * PIXELS_PER_METER

    @property
    def length_px(self) -> float:
        return self.length_m * PIXELS_PER_METER

    def update_kinematics(self, dt: float = TIME_STEP):
        """Update longitudinal speed and lateral steering"""
        speed_diff = self.target_speed - self.speed
        if abs(speed_diff) > 0.05:
            if speed_diff > 0:
                self.acceleration = min(self.max_accel, speed_diff / 0.5)
            else:
                self.acceleration = max(-self.max_decel, speed_diff / 0.35)
            self.speed += self.acceleration * dt
            if self.speed < 0:
                self.speed = 0.0
        else:
            self.speed = self.target_speed
            self.acceleration = 0.0

        # Lateral steering towards target_x (for wheeled vehicles only)
        if self.type not in (EntityType.PEDESTRIAN, EntityType.ROAD_OBSTACLE, EntityType.TRAFFIC_POLICE):
            base_h = getattr(self, "base_heading", 0.0)
            if abs(self.target_x - self.x) > 1.0:
                lateral_err = self.target_x - self.x
                steer_factor = 0.08
                self.x += lateral_err * steer_factor
                steer_deflection = max(-0.25, min(0.25, lateral_err * 0.015))
                if abs(base_h) < 1.0:
                    self.heading = base_h + steer_deflection
                else:
                    self.heading = base_h - steer_deflection
            else:
                self.heading = base_h + (self.heading - base_h) * 0.85

        if self.speed > 0.1:
            self.walk_cycle += dt * 8.0

        self.compute_predicted_trajectory(horizon_seconds=3.0, sample_count=6)

    def update_relative_position(self, dt: float, ego_speed: float):
        """
        Update position in camera/ego-centric reference frame
        Ego stays anchored vertically around Y ≈ 480 on screen.
        Relative longitudinal velocity determines screen movement.
        """
        if self.type == EntityType.EGO:
            return  # Ego position is camera-anchored vertically

        # Longitudinal velocity component in vehicle heading
        forward_vy = self.speed * math.cos(self.heading)
        # Relative speed to ego forward speed
        v_rel = forward_vy - ego_speed
        # Screen Y update: forward relative motion moves UP (-Y)
        self.y -= v_rel * PIXELS_PER_METER * dt

    def compute_predicted_trajectory(self, horizon_seconds: float = 3.0, sample_count: int = 6):
        """Project future spatial trajectory relative to road"""
        points = []
        dt = horizon_seconds / sample_count
        curr_x = self.x
        curr_y = self.y
        curr_heading = self.heading
        speed_px_sec = self.speed * PIXELS_PER_METER

        for i in range(1, sample_count + 1):
            t = round(i * dt, 2)
            curr_x += math.sin(curr_heading) * speed_px_sec * dt
            curr_y -= math.cos(curr_heading) * speed_px_sec * dt
            points.append({"x": round(curr_x, 1), "y": round(curr_y, 1), "t": t})

        self.predicted_trajectory = points

    def distance_to(self, other: "Vehicle") -> float:
        dx = (self.x - other.x) / PIXELS_PER_METER
        dy = (self.y - other.y) / PIXELS_PER_METER
        return math.sqrt(dx * dx + dy * dy)

    def longitudinal_distance_to(self, other: "Vehicle") -> float:
        """Longitudinal distance in meters (positive = other is ahead in driving corridor)"""
        return (self.y - other.y) / PIXELS_PER_METER

    def lateral_distance_to(self, other: "Vehicle") -> float:
        """Lateral distance in meters (positive = other is to the right)"""
        return (other.x - self.x) / PIXELS_PER_METER

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type.value,
            "name": self.name,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "targetX": round(self.target_x, 1),
            "widthMeters": self.width_m,
            "lengthMeters": self.length_m,
            "widthPx": round(self.width_px, 1),
            "lengthPx": round(self.length_px, 1),
            "heading": round(self.heading, 3),
            "speed": round(self.speed, 2),
            "speedKmh": self.speed_kmh,
            "targetSpeed": round(self.target_speed, 2),
            "acceleration": round(self.acceleration, 2),
            "lateralVolatility": round(self.lateral_volatility, 2),
            "color": self.color,
            "gesture": self.gesture.value,
            "state": self.state,
            "walkCycle": round(self.walk_cycle, 2),
            "trajectory": self.predicted_trajectory,
        }
