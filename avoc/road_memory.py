"""
Historical Road Memory & Spatial Prior Engine
Maintains localized memory priors of recurring road features:
- Habitual two-wheeler cut-in zones
- Unmarked informal pedestrian crossing hotspots
- Known road surface hazards / chronic potholes
- Median openings with high wrong-way traffic frequency
- Traffic police manual control posts

Fuses instantaneous sensor perception with historical spatial memory to:
1. Pre-fill brakes and heighten sensor sensitivity before visual confirmation
2. Proactively reduce cruise speed in high-volatility memory zones
3. Lower response latency in unpredictable mixed-traffic environments
"""

from enum import Enum
from typing import List, Dict, Any, Optional
from .constants import PIXELS_PER_METER

class MemoryType(str, Enum):
    HABITUAL_CUT_IN = "HABITUAL_CUT_IN"
    PEDESTRIAN_HOTSPOT = "PEDESTRIAN_HOTSPOT"
    WRONG_WAY_CORRIDOR = "WRONG_WAY_CORRIDOR"
    POLICE_POST = "POLICE_POST"
    KNOWN_ROAD_DEFECT = "KNOWN_ROAD_DEFECT"
    UNREGULATED_JUNCTION = "UNREGULATED_JUNCTION"

class MemoryFeature:
    def __init__(
        self,
        id: str,
        type: MemoryType,
        title: str,
        description: str,
        relative_y: float, # road Y coordinate
        span_meters: float = 18.0,
        confidence: float = 0.94,
        pre_action: str = "HEIGHTENED_SENSITIVITY",
        speed_cap_kmh: Optional[float] = None,
    ):
        self.id = id
        self.type = type
        self.title = title
        self.description = description
        self.relative_y = relative_y
        self.span_meters = span_meters
        self.confidence = confidence
        self.pre_action = pre_action
        self.speed_cap_kmh = speed_cap_kmh

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type.value,
            "title": self.title,
            "description": self.description,
            "y": round(self.relative_y, 1),
            "spanMeters": self.span_meters,
            "confidence": round(self.confidence * 100, 1),
            "preAction": self.pre_action,
            "speedCapKmh": self.speed_cap_kmh,
        }

class RoadMemoryDatabase:
    """Pre-loaded spatial memory priors mapped across scenarios"""
    @staticmethod
    def get_memory_for_scenario(scenario_id: str) -> List[MemoryFeature]:
        if scenario_id == "SCENARIO_1_MOTO_CUT_IN":
            return [
                MemoryFeature(
                    id="MEM_CUTIN_01",
                    type=MemoryType.HABITUAL_CUT_IN,
                    title="Habitual Overtake & Cut-In Corridor",
                    description="Fleet history: Frequent rapid 2-wheeler cut-ins from service road merge",
                    relative_y=380.0,
                    span_meters=22.0,
                    confidence=0.92,
                    pre_action="BRAKE_PREFILL_ACTIVE",
                    speed_cap_kmh=38.0,
                )
            ]
        elif scenario_id == "SCENARIO_2_PEDESTRIAN":
            return [
                MemoryFeature(
                    id="MEM_PED_02",
                    type=MemoryType.PEDESTRIAN_HOTSPOT,
                    title="Informal Crossing & Market Hotspot",
                    description="Fleet history: Habitual jaywalking and dart-outs behind parked vehicles",
                    relative_y=240.0,
                    span_meters=20.0,
                    confidence=0.96,
                    pre_action="PROACTIVE_PEDESTRIAN_BUFFER",
                    speed_cap_kmh=32.0,
                )
            ]
        elif scenario_id == "SCENARIO_3_WRONG_WAY":
            return [
                MemoryFeature(
                    id="MEM_WRONGWAY_03",
                    type=MemoryType.WRONG_WAY_CORRIDOR,
                    title="High-Frequency Wrong-Way Median Cut",
                    description="Fleet history: 2-wheelers frequently avoid U-turn by driving against left lane",
                    relative_y=180.0,
                    span_meters=25.0,
                    confidence=0.95,
                    pre_action="LEFT_SHOULDER_BIAS_READY",
                    speed_cap_kmh=30.0,
                )
            ]
        elif scenario_id == "SCENARIO_4_TRAFFIC_POLICE":
            return [
                MemoryFeature(
                    id="MEM_POLICE_04",
                    type=MemoryType.POLICE_POST,
                    title="Regular Traffic Police Duty Post",
                    description="Fleet history: Manual hand-signal intervention during peak congestion hours",
                    relative_y=240.0,
                    span_meters=20.0,
                    confidence=0.98,
                    pre_action="HUMAN_GESTURE_PRIORITY_READY",
                    speed_cap_kmh=28.0,
                )
            ]
        elif scenario_id == "SCENARIO_5_OBSTACLE_SWERVE":
            return [
                MemoryFeature(
                    id="MEM_HAZARD_05",
                    type=MemoryType.KNOWN_ROAD_DEFECT,
                    title="Chronic Monsoon Pothole & Road Defect",
                    description="Fleet history: Deep surface crater reported by multiple autonomous vehicles",
                    relative_y=240.0,
                    span_meters=18.0,
                    confidence=0.99,
                    pre_action="VERIFY_ADJACENT_LANE_CLEARANCE",
                    speed_cap_kmh=25.0,
                )
            ]
        elif scenario_id == "SCENARIO_6_BUSY_JUNCTION":
            return [
                MemoryFeature(
                    id="MEM_JUNCTION_06",
                    type=MemoryType.UNREGULATED_JUNCTION,
                    title="Unregulated Mixed-Traffic Intersection",
                    description="Fleet history: Multi-directional auto and bike crossings without traffic lights",
                    relative_y=280.0,
                    span_meters=26.0,
                    confidence=0.97,
                    pre_action="JUNCTION_CRAWL_PRIME",
                    speed_cap_kmh=22.0,
                )
            ]
        elif scenario_id == "SCENARIO_0_AUTO":
            return [
                MemoryFeature(
                    id="MEM_AUTO_CORRIDOR",
                    type=MemoryType.HABITUAL_CUT_IN,
                    title="Dynamic Mixed Traffic Corridor",
                    description="Fleet history: High-frequency multi-hazard urban arterial road",
                    relative_y=380.0,
                    span_meters=30.0,
                    confidence=0.95,
                    pre_action="DYNAMIC_HAZARD_SCAN",
                    speed_cap_kmh=38.0,
                )
            ]
        return []

class RoadMemoryEngine:
    def __init__(self):
        self.active_features: List[MemoryFeature] = []
        self.current_matched: Optional[MemoryFeature] = None

    def load_scenario_memory(self, scenario_id: str):
        self.active_features = RoadMemoryDatabase.get_memory_for_scenario(scenario_id)
        self.current_matched = None

    def set_features(self, features: List[MemoryFeature]):
        self.active_features = list(features)
        self.current_matched = None

    def evaluate_proximity(self, ego_y: float) -> Optional[MemoryFeature]:
        """Check if ego car is approaching or inside a memorized road hotspot"""
        matched = None
        for feat in self.active_features:
            # Check if ego is within 25 meters ahead of the memory coordinate
            long_dist_px = ego_y - feat.relative_y
            long_dist_m = long_dist_px / PIXELS_PER_METER
            if -4.0 <= long_dist_m <= 28.0:
                matched = feat
                break
        self.current_matched = matched
        return matched

    def get_state(self) -> Dict[str, Any]:
        return {
            "hasActiveMemory": self.current_matched is not None,
            "activeMemory": self.current_matched.to_dict() if self.current_matched else None,
            "allFeatures": [f.to_dict() for f in self.active_features],
        }
