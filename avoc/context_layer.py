"""
Adaptive Road Context Layer
The core safety cap evaluating unstructured mixed-traffic behaviors,
lateral volatility, wrong-way detection, dynamic TTC buffers,
surrounding gap clearance ("never blindly swerve"), and police hand signals.
"""

import math
from typing import List, Dict, Any, Optional, Tuple
from .constants import EntityType, RiskLevel, PoliceGesture, LANE_WIDTH_METERS, PIXELS_PER_METER
from .physics import Vehicle

class ContextLayer:
    def __init__(self):
        self.blindspot_clearance_meters = 14.0
        self.lateral_cut_in_threshold = 0.8

    def evaluate(self, ego: Vehicle, entities: List[Vehicle], memory_prior: Optional[Any] = None) -> Dict[str, Any]:
        highest_risk = RiskLevel.NOMINAL
        primary_threat: Optional[Vehicle] = None
        min_ttc: float = float("inf")
        decision = "NORMAL_CRUISE"
        safe_target_speed = ego.max_speed
        target_x = ego.base_lane_x
        voice_alert: Optional[str] = None
        voice_priority = "INFO"

        # Prior Road Memory Prime
        if memory_prior and memory_prior.speed_cap_kmh:
            safe_target_speed = min(safe_target_speed, memory_prior.speed_cap_kmh / 3.6)
            decision = f"MEMORY_PRIME_{memory_prior.pre_action}"

        # Step 1: Scan adjacent lanes and rear blindspots
        blindspot_status = self.assess_adjacent_clearance(ego, entities)

        # Step 2: Evaluate individual threats
        for entity in entities:
            if entity.id == ego.id or entity.state != "ACTIVE":
                continue

            long_dist = ego.longitudinal_distance_to(entity)  # positive = ahead
            lat_dist = ego.lateral_distance_to(entity)        # positive = right
            total_dist = ego.distance_to(entity)

            # ----------------------------------------------------
            # 1. TRAFFIC POLICE HAND SIGNAL OVERRIDE
            # ----------------------------------------------------
            if entity.type == EntityType.TRAFFIC_POLICE:
                if entity.gesture == PoliceGesture.STOP and 0 < long_dist < 32:
                    highest_risk = RiskLevel.CRITICAL
                    primary_threat = entity
                    decision = "POLICE_OVERRIDE_STOP"
                    safe_target_speed = 0.0
                    voice_alert = "Traffic police stop signal detected. Vehicle stopping."
                    voice_priority = "WARNING"
                    break
                elif entity.gesture == PoliceGesture.PROCEED and 0 < long_dist < 32:
                    highest_risk = RiskLevel.NOMINAL
                    primary_threat = entity
                    decision = "POLICE_PROCEED_ALLOWED"
                    safe_target_speed = 7.0
                    voice_alert = "Police clearance received. Resuming driving."
                    voice_priority = "INFO"
                    break

            # ----------------------------------------------------
            # 2. WRONG-WAY VEHICLE (REVERSE HEADING IN SAME LANE)
            # ----------------------------------------------------
            is_wrong_way = (
                entity.state != "PASSED"
                and long_dist > -2.0
                and (
                    entity.type == EntityType.WRONG_WAY_VEHICLE
                    or (
                        0 < long_dist < 45
                        and abs(lat_dist) < 1.4
                        and abs(entity.heading - math.pi) < 0.5
                    )
                )
            )

            if is_wrong_way:
                if long_dist > 0:
                    closing_speed = ego.speed + entity.speed
                    ttc = long_dist / closing_speed if closing_speed > 0.1 else 99.0
                    min_ttc = min(min_ttc, ttc)
                else:
                    ttc = 0.5
                    min_ttc = min(min_ttc, ttc)

                if ttc < 4.5 or long_dist < 38:
                    highest_risk = RiskLevel.CRITICAL
                    primary_threat = entity
                    decision = "EMERGENCY_STOP_WRONG_WAY"
                    safe_target_speed = 0.0
                    # Tucking safely towards left shoulder to maximize separation gap
                    target_x = ego.base_lane_x - (LANE_WIDTH_METERS * PIXELS_PER_METER * 0.32)
                    voice_alert = "Warning! Wrong-way vehicle detected ahead. Emergency braking and pulling to shoulder."
                    voice_priority = "CRITICAL"
                    break

            # ----------------------------------------------------
            # 3. ROAD OBSTACLE & "NEVER BLINDLY SWERVE"
            # ----------------------------------------------------
            if entity.type == EntityType.ROAD_OBSTACLE:
                is_in_base_corridor = abs(entity.x - ego.base_lane_x) < 2.0 * PIXELS_PER_METER
                if is_in_base_corridor and -2.5 < long_dist < 28.0:
                    primary_threat = entity
                    ttc = long_dist / max(0.1, ego.speed) if long_dist > 0 else 99.0
                    min_ttc = min(min_ttc, ttc)

                    if blindspot_status["is_right_clear"]:
                        if long_dist > -1.0:
                            highest_risk = RiskLevel.ELEVATED
                            decision = "SAFE_REPOSITION_AROUND_OBSTACLE"
                            safe_target_speed = min(5.5, max(3.5, ego.speed))
                            target_x = ego.base_lane_x + (LANE_WIDTH_METERS * PIXELS_PER_METER * 0.85)
                            voice_alert = "Obstacle detected. Checking adjacent lane... Safe gap confirmed. Repositioning."
                            voice_priority = "WARNING"
                        else:
                            # Safely past obstacle, recovering lane
                            highest_risk = RiskLevel.NOMINAL
                            decision = "NORMAL_CRUISE"
                            safe_target_speed = ego.max_speed
                            target_x = ego.base_lane_x
                    else:
                        highest_risk = RiskLevel.CRITICAL
                        decision = "HOLD_LANE_ADJACENT_OCCUPIED"
                        safe_target_speed = 0.0
                        target_x = ego.base_lane_x
                        voice_alert = "Obstacle detected. Adjacent lane occupied. Braking to stop behind obstacle."
                        voice_priority = "CRITICAL"
                    break

            # ----------------------------------------------------
            # 4. PEDESTRIAN TWO-STAGE AVOIDANCE (REAR-TRAFFIC SAFETY)
            # ----------------------------------------------------
            if entity.type == EntityType.PEDESTRIAN:
                is_ahead = 0 < long_dist < 28
                in_lateral_corridor = abs(entity.x - ego.base_lane_x) < 3.5 * PIXELS_PER_METER

                if is_ahead and in_lateral_corridor:
                    ttc = long_dist / ego.speed if ego.speed > 0.1 else 99.0
                    min_ttc = min(min_ttc, ttc)
                    lane_half_width = (LANE_WIDTH_METERS * PIXELS_PER_METER) / 2 # ~28.8px

                    # Check if pedestrian has physically stepped INTO our driving lane
                    is_inside_lane = (entity.x > (ego.base_lane_x - lane_half_width + 4)) and (entity.x < (ego.base_lane_x + lane_half_width + 4))

                    if is_inside_lane:
                        # STAGE 2: Pedestrian is directly in our path -> Stop safely!
                        highest_risk = RiskLevel.CRITICAL
                        primary_threat = entity
                        decision = "STOP_PEDESTRIAN_IN_LANE"
                        safe_target_speed = 0.0
                        voice_alert = "Pedestrian entered lane! Stopping."
                        voice_priority = "WARNING"
                    else:
                        # STAGE 1: Pedestrian is near roadside/curb ->
                        # DO NOT stop suddenly! Decelerate gently from 40 to 20 km/h
                        # to prevent tailgating vehicles behind us from rear-ending!
                        highest_risk = RiskLevel.ELEVATED
                        primary_threat = entity
                        decision = "SLOW_DOWN_REAR_SAFETY"
                        safe_target_speed = min(5.5, ego.speed) # smooth ~20 km/h
                        voice_alert = "Pedestrian near roadway. Slowing down to protect rear traffic."
                        voice_priority = "INFO"
                    break

            # ----------------------------------------------------
            # 5. SUDDEN MOTORCYCLE CUT-IN & WEAVING
            # ----------------------------------------------------
            if entity.type == EntityType.MOTORCYCLE:
                is_cutting_in = abs(lat_dist) < 1.8 and (-2 < long_dist < 18)
                has_drift = abs(entity.lateral_volatility) > 0.3 or abs(lat_dist) < 1.2

                if is_cutting_in and has_drift:
                    closing_rel_speed = ego.speed - entity.speed
                    ttc = (
                        max(0.5, long_dist / closing_rel_speed)
                        if closing_rel_speed > 0
                        else (long_dist / max(0.1, ego.speed))
                    )
                    min_ttc = min(min_ttc, ttc)

                    if long_dist < 9.0:
                        highest_risk = RiskLevel.CRITICAL
                        primary_threat = entity
                        decision = "EMERGENCY_BUFFER_EXPANSION"
                        safe_target_speed = min(4.5, max(1.5, entity.speed - 3.5))
                        voice_alert = "Warning! Motorcycle cutting directly into lane. Expanding buffer."
                        voice_priority = "CRITICAL"
                    else:
                        highest_risk = RiskLevel.ELEVATED
                        primary_threat = entity
                        decision = "SLOW_AND_MAINTAIN_GAP"
                        safe_target_speed = min(5.5, max(2.5, entity.speed - 1.5))
                        voice_alert = "Motorcycle cut-in detected. Reducing speed to maintain safe gap."
                        voice_priority = "WARNING"
                    break
                elif -16 < long_dist <= 0 and abs(lat_dist) < 2.5:
                    if highest_risk == RiskLevel.NOMINAL:
                        highest_risk = RiskLevel.AWARENESS
                        primary_threat = entity
                        decision = "MONITORING_REAR_APPROACH"
                        voice_alert = "Motorcycle approaching from behind."
                        voice_priority = "INFO"

            # ----------------------------------------------------
            # 6. JUNCTION CROSS-TRAFFIC CONFLICT CONES
            # ----------------------------------------------------
            if entity.type in (EntityType.AUTO_RICKSHAW, EntityType.SURROUND_CAR, EntityType.BUS):
                conflict = self.check_trajectory_conflict(ego, entity)
                # Also check direct lateral crossing across ego lane corridor
                is_crossing_path = (
                    0 < long_dist < 22
                    and abs(entity.heading - (-math.pi / 2)) < 0.3
                    and entity.x > ego.x - (2.0 * PIXELS_PER_METER)
                )

                if conflict["has_conflict"] or is_crossing_path:
                    ttc = conflict["time_to_intersect"] if conflict["has_conflict"] else (long_dist / max(0.1, ego.speed))
                    min_ttc = min(min_ttc, ttc)

                    if ttc < 2.8 or long_dist < 18:
                        highest_risk = RiskLevel.CRITICAL
                        primary_threat = entity
                        decision = "YIELD_JUNCTION_CROSS_TRAFFIC"
                        safe_target_speed = 0.0
                        voice_alert = f"Yielding to {entity.name} at junction."
                        voice_priority = "WARNING"
                        break
                    elif ttc < 4.2:
                        highest_risk = RiskLevel.ELEVATED
                        primary_threat = entity
                        decision = "JUNCTION_CRAWL_CAUTION"
                        safe_target_speed = 3.5
                        voice_alert = "Junction conflict projected. Crawling with caution."
                        voice_priority = "INFO"

        if highest_risk == RiskLevel.NOMINAL:
            decision = "NORMAL_CRUISE"
            safe_target_speed = 11.1

        return {
            "primary_threat": primary_threat.to_dict() if primary_threat else None,
            "primary_threat_id": primary_threat.id if primary_threat else None,
            "risk_level": highest_risk.value,
            "decision": decision,
            "safe_target_speed": round(safe_target_speed, 2),
            "target_x": round(target_x, 1),
            "ttc": round(min_ttc, 1) if min_ttc != float("inf") else None,
            "blindspot_status": blindspot_status,
            "voice_alert": voice_alert,
            "voice_priority": voice_priority,
        }

    def assess_adjacent_clearance(self, ego: Vehicle, entities: List[Vehicle]) -> Dict[str, Any]:
        is_right_clear = True
        is_left_clear = True
        blocking_entity_id = None

        for entity in entities:
            if entity.id == ego.id or entity.state != "ACTIVE":
                continue

            long_dist = ego.longitudinal_distance_to(entity)
            lat_dist = ego.lateral_distance_to(entity)

            if 1.8 < lat_dist < 5.0:
                if -12 < long_dist < 16:
                    is_right_clear = False
                    blocking_entity_id = entity.id

            if -5.0 < lat_dist < -1.8:
                if -10 < long_dist < 14:
                    is_left_clear = False

        return {
            "is_right_clear": is_right_clear,
            "is_left_clear": is_left_clear,
            "blocking_entity_id": blocking_entity_id,
        }

    def check_trajectory_conflict(self, ego: Vehicle, entity: Vehicle) -> Dict[str, Any]:
        if not ego.predicted_trajectory or not entity.predicted_trajectory:
            return {"has_conflict": False}

        collision_radius_px = 3.2 * PIXELS_PER_METER

        for p_ego in ego.predicted_trajectory:
            for p_other in entity.predicted_trajectory:
                if abs(p_ego["t"] - p_other["t"]) < 0.8:
                    dx = p_ego["x"] - p_other["x"]
                    dy = p_ego["y"] - p_other["y"]
                    dist = math.sqrt(dx * dx + dy * dy)

                    if dist < collision_radius_px:
                        return {
                            "has_conflict": True,
                            "time_to_intersect": (p_ego["t"] + p_other["t"]) / 2,
                            "intersection_x": (p_ego["x"] + p_other["x"]) / 2,
                            "intersection_y": (p_ego["y"] + p_other["y"]) / 2,
                        }

        return {"has_conflict": False}


AdaptiveContextLayer = ContextLayer
