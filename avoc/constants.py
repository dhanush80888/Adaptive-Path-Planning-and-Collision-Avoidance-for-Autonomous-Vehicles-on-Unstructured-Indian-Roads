"""
Adaptive Collision Avoidance for Autonomous Vehicles (AVOC)
Core Constants, Entity Types, Risk Tiers, and Vehicle States.
"""

from enum import Enum

# Simulation parameters
TIME_STEP = 1 / 60  # 60 FPS physics step
PIXELS_PER_METER = 16.0  # Visual scaling
LANE_WIDTH_METERS = 3.6  # Standard road lane width
ROAD_OFFSET_X = 180.0

class EntityType(str, Enum):
    EGO = "EGO_AV"
    MOTORCYCLE = "MOTORCYCLE"
    AUTO_RICKSHAW = "AUTO_RICKSHAW"
    PEDESTRIAN = "PEDESTRIAN"
    TRAFFIC_POLICE = "TRAFFIC_POLICE"
    WRONG_WAY_VEHICLE = "WRONG_WAY_VEHICLE"
    ROAD_OBSTACLE = "ROAD_OBSTACLE"
    SURROUND_CAR = "SURROUND_CAR"
    BUS = "BUS"
    AMBULANCE = "AMBULANCE"
    STRAY_ANIMAL = "STRAY_ANIMAL"

class PoliceGesture(str, Enum):
    NONE = "NONE"
    STOP = "STOP"
    PROCEED = "PROCEED"

class RiskLevel(str, Enum):
    NOMINAL = "NOMINAL"       # Green: Clear path, standard cruise
    AWARENESS = "AWARENESS"   # Amber: Flank/rear approach or lateral drift
    ELEVATED = "ELEVATED"     # Orange: Trajectory intersection, proactive buffer
    CRITICAL = "CRITICAL"     # Red: Imminent collision / blocked corridor / wrong-way

class EgoState(str, Enum):
    CRUISING = "CRUISING"
    MONITORING = "MONITORING"
    DECELERATING = "DECELERATING"
    EMERGENCY_STOP = "EMERGENCY_STOP"
    CHECKING_BLINDSPOT = "CHECKING_BLINDSPOT"
    SAFE_REPOSITIONING = "SAFE_REPOSITIONING"
    RETURNING_TO_LANE = "RETURNING_TO_LANE"
    YIELDING = "YIELDING"
    POLICE_OVERRIDE_STOP = "POLICE_OVERRIDE_STOP"
    RECOVERING = "RECOVERING"
    YIELDING_EMERGENCY = "YIELDING_EMERGENCY"

RISK_METADATA = {
    RiskLevel.NOMINAL: {
        "color": "#10b981",
        "bg": "rgba(16, 185, 129, 0.15)",
        "label": "NOMINAL",
        "description": "Path clear, safe following distance maintained",
    },
    RiskLevel.AWARENESS: {
        "color": "#f59e0b",
        "bg": "rgba(245, 158, 11, 0.15)",
        "label": "AWARENESS",
        "description": "Object in peripheral zone, monitoring lateral drift",
    },
    RiskLevel.ELEVATED: {
        "color": "#f97316",
        "bg": "rgba(249, 115, 22, 0.18)",
        "label": "ELEVATED",
        "description": "Trajectory conflict projected, proactive speed reduction",
    },
    RiskLevel.CRITICAL: {
        "color": "#ef4444",
        "bg": "rgba(239, 68, 68, 0.25)",
        "label": "CRITICAL",
        "description": "Imminent collision risk, emergency brake / evasive hold",
    },
}
