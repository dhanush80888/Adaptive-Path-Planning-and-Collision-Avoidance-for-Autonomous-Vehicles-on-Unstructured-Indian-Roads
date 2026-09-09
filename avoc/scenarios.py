"""
Mixed-Traffic Scenario Definitions and Orchestrator
All 6 scenarios implemented with continuous realistic trajectories,
left-hand traffic (LHT) rules, relative camera tracking, and clear lifecycles.
"""

import math
import random
from typing import List, Dict, Any, Tuple
from .constants import EntityType, PoliceGesture, LANE_WIDTH_METERS, PIXELS_PER_METER
from .physics import Vehicle
from .road_memory import RoadMemoryDatabase

class BaseScenario:
    def __init__(self, id: str, name: str, description: str, duration: float):
        self.id = id
        self.name = name
        self.description = description
        self.duration = duration
        self.elapsed = 0.0

    def setup(self, road_layout: Dict[str, float]) -> Tuple[Vehicle, List[Vehicle]]:
        raise NotImplementedError

    def update(self, dt: float, ego: Vehicle, entities: List[Vehicle]):
        self.elapsed += dt

    def is_completed(self) -> bool:
        return self.elapsed >= self.duration


class Scenario0_AutoRealWorld(BaseScenario):
    """
    Scenario 0: Auto Real-World Multi-Hazard Sequence (Continuous Driving Mode)
    Continuous driving along an urban corridor with unscripted, procedural
    sequences of real-world hazards:
    1. Motorcycle rapid cut-in & weaving
    2. Roadside pedestrian crossing (with anti-rear-end buffer maintenance)
    3. Oncoming wrong-way vehicle avoiding median U-turn
    4. Road pothole defect with occupied adjacent lane blindspot hold
    5. Traffic police manual hand-signal stop & clearance
    6. Unregulated mixed-traffic junction negotiation
    Supports continuous looping, real-time hazard avoidance counting, and
    on-demand dynamic hazard injection.
    """
    def __init__(self):
        super().__init__(
            id="SCENARIO_0_AUTO",
            name="⚡ Auto (Real-World Mixed Traffic)",
            description="Continuous real-world road driving: dynamic multi-hazard sequencing, procedural event scheduling, and continuous adaptive collision avoidance.",
            duration=600.0,
        )
        self.road_layout: Dict[str, float] = {}
        self.seq_index = 0
        self.phase = "CRUISE_CLEAR"  # "CRUISE_CLEAR" or "HAZARD"
        self.phase_elapsed = 0.0
        self.distance_m = 0.0
        self.hazards_avoided = 0
        self.collisions = 0
        self.active_hazard_title = "Corridor Safe Cruise - Monitoring Surroundings"
        self.sequence_names = [
            "1. Motorcycle Rapid Cut-In",
            "2. Roadside Pedestrian (Anti-Rear-End Buffer)",
            "3. Oncoming Wrong-Way Vehicle",
            "4. Road Pothole (Blindspot Hold)",
            "5. Traffic Police Hand Override",
            "6. Unregulated Mixed Junction",
        ]
        self.show_zebra = False
        self.show_junction = False
        self.pending_injections: List[str] = []

    def setup(self, road_layout: Dict[str, float]) -> Tuple[Vehicle, List[Vehicle]]:
        self.elapsed = 0.0
        self.road_layout = road_layout
        self.seq_index = 0
        self.phase = "CRUISE_CLEAR"
        self.phase_elapsed = 0.0
        self.distance_m = 0.0
        self.hazards_avoided = 0
        self.collisions = 0
        self.show_zebra = False
        self.show_junction = False
        self.pending_injections = []
        self.active_hazard_title = "Corridor Safe Cruise - Monitoring Surroundings"

        ego_lane_x = road_layout["lane_left_x"]
        ego = Vehicle(
            id="ego",
            type=EntityType.EGO,
            name="Autonomous Ego Vehicle",
            x=ego_lane_x,
            y=480.0,
            speed=10.5,
            target_speed=10.5,
            max_speed=11.1,
            width_m=1.9,
            length_m=4.4,
            color="#0ea5e9",
        )
        ego.target_x = ego_lane_x

        ambient_sedan = Vehicle(
            id="ambient_sedan",
            type=EntityType.SURROUND_CAR,
            name="Oncoming Traffic",
            x=road_layout["lane_right_x"],
            y=100.0,
            speed=9.0,
            target_speed=9.0,
            heading=math.pi,
            width_m=1.8,
            length_m=4.2,
            color="#64748b",
        )

        return ego, [ego, ambient_sedan]

    def get_current_road_memory(self):
        if self.phase == "CRUISE_CLEAR":
            return RoadMemoryDatabase.get_memory_for_scenario("SCENARIO_0_AUTO")
        cur_id = self.seq_index % len(self.sequence_names)
        scenario_ids = [
            "SCENARIO_1_MOTO_CUT_IN",
            "SCENARIO_2_PEDESTRIAN",
            "SCENARIO_3_WRONG_WAY",
            "SCENARIO_5_OBSTACLE_SWERVE",
            "SCENARIO_4_TRAFFIC_POLICE",
            "SCENARIO_6_BUSY_JUNCTION",
        ]
        return RoadMemoryDatabase.get_memory_for_scenario(scenario_ids[cur_id])

    def get_auto_stats(self) -> Dict[str, Any]:
        return {
            "isAutoMode": True,
            "sequenceIndex": (self.seq_index % len(self.sequence_names)) + 1,
            "totalSequences": len(self.sequence_names),
            "sequenceName": self.sequence_names[self.seq_index % len(self.sequence_names)],
            "phase": self.phase,
            "phaseElapsed": round(self.phase_elapsed, 1),
            "phaseDuration": 8.5 if self.phase == "HAZARD" else 2.8,
            "distanceMeters": round(self.distance_m, 1),
            "hazardsAvoided": self.hazards_avoided,
            "collisions": self.collisions,
            "activeHazardTitle": self.active_hazard_title,
            "showZebra": self.show_zebra,
            "showJunction": self.show_junction,
        }

    def is_completed(self) -> bool:
        return False

    def inject_hazard(self, hazard_type: str, ego: Vehicle = None, entities: List[Vehicle] = None):
        """Allow user / evaluator to dynamically inject a hazard at any instant"""
        inj = hazard_type.lower()
        target_seq = 0
        if "ped" in inj:
            target_seq = 1
        elif "wrong" in inj:
            target_seq = 2
        elif "pothole" in inj or "obst" in inj:
            target_seq = 3
        elif "police" in inj:
            target_seq = 4
        elif "junc" in inj:
            target_seq = 5
        elif "random" in inj:
            # Pick a hazard different from current if possible
            cur_seq = self.seq_index % len(self.sequence_names)
            choices = [i for i in range(len(self.sequence_names)) if i != cur_seq]
            target_seq = random.choice(choices) if choices else random.choice(range(len(self.sequence_names)))
        else:
            target_seq = 0

        self.seq_index = target_seq
        self.phase = "HAZARD"
        self.phase_elapsed = 0.0
        if ego is not None and entities is not None:
            self._spawn_sequence(target_seq, ego, entities)
        else:
            self.pending_injections.append(inj)

    def update(self, dt: float, ego: Vehicle, entities: List[Vehicle]):
        super().update(dt, ego, entities)
        self.distance_m += ego.speed * dt
        self.phase_elapsed += dt

        # Collision verification check (safety invariant)
        for e in entities:
            if e.id != ego.id and e.state == "ACTIVE":
                dx = abs(ego.x - e.x) / PIXELS_PER_METER
                dy = abs(ego.y - e.y) / PIXELS_PER_METER
                min_safe_lat = (ego.width_m + e.width_m) * 0.35
                min_safe_long = (ego.length_m + e.length_m) * 0.35
                if dx < min_safe_lat and dy < min_safe_long:
                    self.collisions += 1

        # Check for user on-demand hazard injection queued earlier
        if self.pending_injections:
            inj = self.pending_injections.pop(0)
            self.inject_hazard(inj, ego, entities)
            return

        if self.phase == "CRUISE_CLEAR":
            self.show_zebra = False
            self.show_junction = False
            self.active_hazard_title = "Corridor Safe Cruise - Monitoring Surroundings"

            # After 2.8s of clear cruising, advance to next hazard sequence
            if self.phase_elapsed >= 2.8:
                self.phase = "HAZARD"
                self.phase_elapsed = 0.0
                curr_seq = self.seq_index % len(self.sequence_names)
                self._spawn_sequence(curr_seq, ego, entities)

        elif self.phase == "HAZARD":
            curr_seq = self.seq_index % len(self.sequence_names)
            self._update_sequence(curr_seq, dt, ego, entities)

    def _spawn_sequence(self, seq_id: int, ego: Vehicle, entities: List[Vehicle]):
        entities[:] = [e for e in entities if e.id == ego.id]
        ego_lane_x = self.road_layout["lane_left_x"]
        right_lane_x = self.road_layout["lane_right_x"]

        if seq_id == 0:
            # 1. Motorcycle Cut-In
            self.show_zebra = False
            self.show_junction = False
            self.active_hazard_title = "Aggressive 2-Wheeler Overtake & Cut-In"
            flank_x = ego_lane_x + (LANE_WIDTH_METERS * PIXELS_PER_METER * 0.75)
            moto = Vehicle(
                id="auto_moto_0",
                type=EntityType.MOTORCYCLE,
                name="Motorcycle (DL-01)",
                x=flank_x,
                y=ego.y + (13.0 * PIXELS_PER_METER),
                speed=17.5,
                target_speed=17.5,
                max_speed=19.0,
                width_m=0.8,
                length_m=2.1,
                color="#f97316",
                lateral_volatility=0.2,
            )
            moto.target_x = flank_x
            entities.append(moto)

        elif seq_id == 1:
            # 2. Roadside Pedestrian (Anti-Rear-End Buffer)
            self.show_zebra = True
            self.show_junction = False
            self.active_hazard_title = "Informal Pedestrian Crossing Zone"
            ped = Vehicle(
                id="auto_ped_1",
                type=EntityType.PEDESTRIAN,
                name="Roadside Pedestrian",
                x=ego_lane_x - 34.0,  # on curb ramp
                y=ego.y - (18.0 * PIXELS_PER_METER),
                speed=0.0,
                target_speed=0.0,
                max_speed=1.8,
                heading=-math.pi / 2,
                width_m=0.7,
                length_m=0.7,
                color="#a855f7",
            )
            ped.target_x = ped.x

            trailing_auto = Vehicle(
                id="auto_trailing_1",
                type=EntityType.AUTO_RICKSHAW,
                name="Trailing Auto (Rear Buffer)",
                x=ego_lane_x,
                y=ego.y + (14.0 * PIXELS_PER_METER),
                speed=ego.speed,
                target_speed=ego.speed,
                max_speed=11.5,
                width_m=1.5,
                length_m=2.8,
                color="#eab308",
            )
            trailing_auto.target_x = ego_lane_x
            entities.extend([ped, trailing_auto])

        elif seq_id == 2:
            # 3. Wrong-Way Vehicle
            self.show_zebra = False
            self.show_junction = False
            self.active_hazard_title = "Wrong-Way Vehicle (Illegal Median Entry)"
            wrong_way = Vehicle(
                id="auto_wrong_way_2",
                type=EntityType.WRONG_WAY_VEHICLE,
                name="Wrong-Way Vehicle (KA-03)",
                x=ego_lane_x,
                y=70.0,
                speed=6.0,
                target_speed=6.0,
                max_speed=7.5,
                heading=math.pi,
                width_m=1.4,
                length_m=2.8,
                color="#ef4444",
            )
            wrong_way.target_x = wrong_way.x
            wrong_way.base_heading = math.pi
            entities.append(wrong_way)

        elif seq_id == 3:
            # 4. Obstacle & Blindspot
            self.show_zebra = False
            self.show_junction = False
            self.active_hazard_title = "Pothole Hazard with Blocked Adjacent Lane"
            obstacle = Vehicle(
                id="auto_obstacle_3",
                type=EntityType.ROAD_OBSTACLE,
                name="Monsoon Pothole & Debris",
                x=ego_lane_x,
                y=ego.y - (18.0 * PIXELS_PER_METER),
                speed=0.0,
                target_speed=0.0,
                width_m=1.6,
                length_m=2.0,
                color="#475569",
            )
            blocking_sedan = Vehicle(
                id="auto_blocking_3",
                type=EntityType.SURROUND_CAR,
                name="Adjacent Lane Sedan",
                x=right_lane_x,
                y=ego.y - (4.0 * PIXELS_PER_METER),
                speed=8.5,
                target_speed=8.5,
                max_speed=14.0,
                width_m=1.8,
                length_m=4.2,
                color="#3b82f6",
            )
            blocking_sedan.target_x = right_lane_x
            entities.extend([obstacle, blocking_sedan])

        elif seq_id == 4:
            # 5. Traffic Police Hand Override
            self.show_zebra = False
            self.show_junction = True
            self.active_hazard_title = "Traffic Police Intersection Control"
            officer = Vehicle(
                id="auto_police_4",
                type=EntityType.TRAFFIC_POLICE,
                name="Traffic Police Officer",
                x=self.road_layout["road_center_x"] + 8.0,
                y=ego.y - (16.0 * PIXELS_PER_METER),
                speed=0.0,
                target_speed=0.0,
                gesture=PoliceGesture.STOP,
                width_m=0.8,
                length_m=0.8,
                color="#ca8a04",
            )
            officer.target_x = officer.x
            entities.append(officer)

        elif seq_id == 5:
            # 6. Mixed Junction
            self.show_zebra = False
            self.show_junction = True
            self.active_hazard_title = "Unregulated Mixed Junction Conflicts"
            cross_auto = Vehicle(
                id="auto_cross_5",
                type=EntityType.AUTO_RICKSHAW,
                name="Crossing Auto (MH-12)",
                x=self.road_layout["road_right_edge"] + 45.0,
                y=280.0,
                speed=4.2,
                target_speed=4.2,
                heading=-math.pi / 2,
                width_m=1.5,
                length_m=2.8,
                color="#eab308",
            )
            cross_auto.target_x = cross_auto.x
            cross_auto.base_heading = -math.pi / 2

            turning_moto = Vehicle(
                id="auto_turning_5",
                type=EntityType.MOTORCYCLE,
                name="Turning Bike (DL-08)",
                x=right_lane_x,
                y=190.0,
                speed=3.2,
                target_speed=3.2,
                heading=math.pi * 0.75,
                width_m=0.8,
                length_m=2.1,
                color="#f97316",
            )
            turning_moto.base_heading = math.pi * 0.75
            entities.extend([cross_auto, turning_moto])

    def _update_sequence(self, seq_id: int, dt: float, ego: Vehicle, entities: List[Vehicle]):
        if seq_id == 0:
            # Motorcycle Cut-In
            moto = next((e for e in entities if e.id == "auto_moto_0"), None)
            if not moto:
                self._finish_sequence(ego, entities)
                return

            if self.phase_elapsed < 2.8:
                moto.target_speed = 17.5
                moto.lateral_volatility = 0.2
            elif 2.8 <= self.phase_elapsed < 5.0:
                moto.target_x = ego.target_x
                moto.lateral_volatility = 1.6
                moto.target_speed = 9.2
            elif 5.0 <= self.phase_elapsed < 6.8:
                moto.target_x = ego.target_x
                moto.lateral_volatility = 0.0
                moto.target_speed = 18.5
            elif self.phase_elapsed >= 6.8:
                moto.target_speed = 20.0
                if moto.y < ego.y - (14.0 * PIXELS_PER_METER) or self.phase_elapsed >= 8.0:
                    self._finish_sequence(ego, entities)

        elif seq_id == 1:
            # Roadside Pedestrian (Anti-Rear-End Buffer)
            ped = next((e for e in entities if e.id == "auto_ped_1"), None)
            trailing = next((e for e in entities if e.id == "auto_trailing_1"), None)
            if not ped:
                self._finish_sequence(ego, entities)
                return

            if self.phase_elapsed < 1.0:
                ped.speed = 0.0
                ped.target_speed = 0.0
            elif 1.0 <= self.phase_elapsed < 5.2:
                ped.target_speed = 1.4
                ped.x += 1.4 * PIXELS_PER_METER * dt
                ped.heading = -math.pi / 2
            elif self.phase_elapsed >= 5.2:
                ped.target_speed = 1.4
                ped.x += 1.4 * PIXELS_PER_METER * dt

            if trailing:
                trailing.target_speed = max(0.0, ego.speed)

            if (self.phase_elapsed >= 7.0 and ego.speed > 7.0) or self.phase_elapsed >= 8.5:
                self._finish_sequence(ego, entities)

        elif seq_id == 2:
            # Wrong-Way Vehicle
            ww = next((e for e in entities if e.id == "auto_wrong_way_2"), None)
            if not ww:
                self._finish_sequence(ego, entities)
                return

            ww.speed = 6.0
            ww.target_speed = 6.0
            ww.base_heading = math.pi

            if 1.6 <= self.phase_elapsed < 6.5:
                ww.target_x = ego.base_lane_x + (LANE_WIDTH_METERS * PIXELS_PER_METER * 0.45)

            if ww.y > ego.y + 50.0:
                ww.state = "PASSED"

            if (ww.state == "PASSED" and self.phase_elapsed >= 5.0 and ego.speed > 5.0) or self.phase_elapsed >= 8.0:
                self._finish_sequence(ego, entities)

        elif seq_id == 3:
            # Obstacle & Blindspot Hold
            obs = next((e for e in entities if e.id == "auto_obstacle_3"), None)
            blocking = next((e for e in entities if e.id == "auto_blocking_3"), None)
            if not obs:
                self._finish_sequence(ego, entities)
                return

            if blocking:
                if self.phase_elapsed < 2.5:
                    blocking.speed = 8.5
                    blocking.target_speed = 8.5
                else:
                    blocking.target_speed = 15.0

            if ego.longitudinal_distance_to(obs) < -1.5:
                obs.state = "PASSED"

            if (self.phase_elapsed >= 8.5 and abs(ego.x - ego.base_lane_x) < 6.0 and ego.speed > 6.0) or self.phase_elapsed >= 11.0:
                self._finish_sequence(ego, entities)

        elif seq_id == 4:
            # Police Hand Gesture
            officer = next((e for e in entities if e.id == "auto_police_4"), None)
            if not officer:
                self._finish_sequence(ego, entities)
                return

            if self.phase_elapsed < 3.8:
                officer.gesture = PoliceGesture.STOP
            else:
                officer.gesture = PoliceGesture.PROCEED

            if (self.phase_elapsed >= 7.5 and ego.speed > 7.5) or self.phase_elapsed >= 9.5:
                self._finish_sequence(ego, entities)

        elif seq_id == 5:
            # Mixed Junction
            cross_auto = next((e for e in entities if e.id == "auto_cross_5"), None)
            turning_moto = next((e for e in entities if e.id == "auto_turning_5"), None)

            if cross_auto:
                cross_auto.x -= cross_auto.speed * PIXELS_PER_METER * dt
                if cross_auto.x < ego.target_x - (3.0 * PIXELS_PER_METER):
                    cross_auto.state = "PASSED"

            if turning_moto:
                turning_moto.x += math.sin(turning_moto.heading) * turning_moto.speed * PIXELS_PER_METER * dt
                turning_moto.y += math.cos(turning_moto.heading) * turning_moto.speed * PIXELS_PER_METER * dt

            if (self.phase_elapsed >= 7.5 and ego.speed > 7.0) or self.phase_elapsed >= 9.5:
                self._finish_sequence(ego, entities)

    def _finish_sequence(self, ego: Vehicle = None, entities: List[Vehicle] = None):
        self.hazards_avoided += 1
        self.seq_index += 1
        self.phase = "CRUISE_CLEAR"
        self.phase_elapsed = 0.0
        if ego:
            ego.target_x = ego.base_lane_x
            ego.target_speed = 10.5
        if entities is not None and ego is not None:
            entities[:] = [e for e in entities if e.id == ego.id]


class Scenario1_MotoCutIn(BaseScenario):
    """
    Scenario 1: Sudden Motorcycle Overtake + Cut-In
    Motorcycle overtakes from behind on flank, swerves into our braking corridor.
    Ego detects lateral drift + low TTC -> decelerates & expands gap -> recovers.
    """
    def __init__(self):
        super().__init__(
            id="SCENARIO_1_MOTO_CUT_IN",
            name="1. Sudden Motorcycle Cut-In",
            description="Motorcycle overtakes from behind and abruptly swerves into our safe braking corridor.",
            duration=14.0,
        )

    def setup(self, road_layout: Dict[str, float]) -> Tuple[Vehicle, List[Vehicle]]:
        self.elapsed = 0.0
        ego_lane_x = road_layout["lane_left_x"]
        flank_x = ego_lane_x + (LANE_WIDTH_METERS * PIXELS_PER_METER * 0.75)

        ego = Vehicle(
            id="ego",
            type=EntityType.EGO,
            name="Autonomous Ego Vehicle",
            x=ego_lane_x,
            y=480.0,
            speed=11.1,  # 40 km/h
            target_speed=11.1,
            max_speed=11.1,
            width_m=1.9,
            length_m=4.4,
            color="#0ea5e9",
        )
        ego.target_x = ego_lane_x

        moto = Vehicle(
            id="moto_1",
            type=EntityType.MOTORCYCLE,
            name="Motorcycle (MH-02)",
            x=flank_x,
            y=480.0 + (16.0 * PIXELS_PER_METER),  # 16m behind on flank
            speed=17.2,  # 62 km/h
            target_speed=17.2,
            max_speed=19.0,
            width_m=0.8,
            length_m=2.1,
            color="#f97316",
            lateral_volatility=0.2,
        )
        moto.target_x = flank_x

        oncoming = Vehicle(
            id="oncoming_sedan",
            type=EntityType.SURROUND_CAR,
            name="Oncoming Sedan",
            x=road_layout["lane_right_x"],
            y=120.0,
            speed=10.0,
            target_speed=10.0,
            heading=math.pi,
            width_m=1.8,
            length_m=4.2,
            color="#64748b",
        )

        return ego, [ego, moto, oncoming]

    def update(self, dt: float, ego: Vehicle, entities: List[Vehicle]):
        super().update(dt, ego, entities)
        moto = next((e for e in entities if e.id == "moto_1"), None)
        if not moto:
            return

        if self.elapsed < 3.0:
            moto.target_speed = 17.2
            moto.lateral_volatility = 0.2
        elif 3.0 <= self.elapsed < 6.5:
            moto.target_x = ego.target_x
            moto.lateral_volatility = 1.6
            moto.target_speed = 8.8
        elif 6.5 <= self.elapsed < 9.0:
            moto.target_x = ego.target_x
            moto.lateral_volatility = 0.1
            moto.target_speed = 11.5
        elif self.elapsed >= 9.0:
            moto.target_speed = 18.5
            moto.lateral_volatility = 0.0


class Scenario2_Pedestrian(BaseScenario):
    """
    Scenario 2: Sudden Pedestrian Crossing
    Roadside pedestrian suddenly steps off curb into vehicle corridor.
    Ego detects crossing path, calculates intersection, yields to complete stop, resumes.
    """
    def __init__(self):
        super().__init__(
            id="SCENARIO_2_PEDESTRIAN",
            name="2. Sudden Pedestrian Crossing",
            description="Pedestrian steps off roadside shoulder to cross the road directly into our vehicle corridor.",
            duration=13.0,
        )

    def setup(self, road_layout: Dict[str, float]) -> Tuple[Vehicle, List[Vehicle]]:
        self.elapsed = 0.0
        ego_lane_x = road_layout["lane_left_x"]
        shoulder_left_x = ego_lane_x - (LANE_WIDTH_METERS * PIXELS_PER_METER * 0.7)

        ego = Vehicle(
            id="ego",
            type=EntityType.EGO,
            name="Autonomous Ego Vehicle",
            x=ego_lane_x,
            y=480.0,
            speed=10.5,
            target_speed=10.5,
            max_speed=10.5,
            width_m=1.9,
            length_m=4.4,
            color="#0ea5e9",
        )
        ego.target_x = ego_lane_x

        # Roadside Pedestrian standing right at curb edge ready to step onto zebra crossing
        ped = Vehicle(
            id="ped_1",
            type=EntityType.PEDESTRIAN,
            name="Crossing Pedestrian",
            x=ego_lane_x - 34.0,  # 5px from lane edge (curb ramp)
            y=480.0 - (18.0 * PIXELS_PER_METER),  # 18m ahead (Y = 192)
            speed=0.0,
            target_speed=0.0,
            max_speed=1.8,
            heading=-math.pi / 2,
            width_m=0.7,
            length_m=0.7,
            color="#a855f7",
        )
        ped.target_x = ego_lane_x - 34.0

        # Parked roadside vehicle on left shoulder, providing realistic context
        parked_auto = Vehicle(
            id="parked_auto",
            type=EntityType.SURROUND_CAR,
            name="Parked Delivery Van",
            x=shoulder_left_x - 14.0,
            y=480.0 - (21.0 * PIXELS_PER_METER),
            speed=0.0,
            target_speed=0.0,
            width_m=1.6,
            length_m=3.2,
            color="#475569",
        )

        # Following vehicle behind us in our lane (tailgater demonstrating rear-end collision prevention)
        following_auto = Vehicle(
            id="following_auto",
            type=EntityType.AUTO_RICKSHAW,
            name="Trailing Auto (Rear Traffic)",
            x=ego_lane_x,
            y=480.0 + (14.0 * PIXELS_PER_METER),  # 14m behind ego
            speed=10.5,
            target_speed=10.5,
            max_speed=11.5,
            width_m=1.5,
            length_m=2.8,
            color="#eab308",
        )
        following_auto.target_x = ego_lane_x

        return ego, [ego, ped, parked_auto, following_auto]

    def update(self, dt: float, ego: Vehicle, entities: List[Vehicle]):
        super().update(dt, ego, entities)
        ped = next((e for e in entities if e.id == "ped_1"), None)
        following = next((e for e in entities if e.id == "following_auto"), None)
        if not ped:
            return

        # Phase 1 (0 to 1.0s): Pedestrian stands at curb ramp.
        # Ego spots pedestrian, initiates gentle deceleration to 20 km/h to protect trailing traffic!
        if self.elapsed < 1.0:
            ped.speed = 0.0
            ped.target_speed = 0.0
        # Phase 2 (1.0s to 5.5s): Pedestrian steps directly into the lane corridor across zebra stripes!
        # Ego executes controlled full stop safely 6m before pedestrian!
        elif 1.0 <= self.elapsed < 5.5:
            ped.target_speed = 1.4  # walking across
            ped.x += 1.4 * PIXELS_PER_METER * dt
            ped.heading = -math.pi / 2
        # Phase 3 (5.5s+): Pedestrian clears the ego lane and reaches center divider
        elif self.elapsed >= 5.5:
            ped.target_speed = 1.4
            ped.x += 1.4 * PIXELS_PER_METER * dt
            if ped.x > ego.target_x + (LANE_WIDTH_METERS * PIXELS_PER_METER * 0.85):
                ped.state = "CLEARED"

        # Trailing auto adjusts speed to follow ego vehicle safely
        if following:
            following.target_speed = max(0.0, ego.speed)
            if ego.speed < 1.0:
                following.target_speed = 0.0


class Scenario3_WrongWay(BaseScenario):
    """
    Scenario 3: Wrong-Way Vehicle (Against Traffic)
    An oncoming vehicle/scooter drives against traffic in our left lane.
    AV detects directional anomaly (heading discrepancy > 150°), emergency brakes,
    biases to left shoulder to maintain maximum separation, and resumes after hazard passes.
    """
    def __init__(self):
        super().__init__(
            id="SCENARIO_3_WRONG_WAY",
            name="3. Wrong-Way Vehicle (Reverse Heading)",
            description="A vehicle travels directly against the flow of traffic in our left lane.",
            duration=13.0,
        )

    def setup(self, road_layout: Dict[str, float]) -> Tuple[Vehicle, List[Vehicle]]:
        self.elapsed = 0.0
        ego_lane_x = road_layout["lane_left_x"]

        ego = Vehicle(
            id="ego",
            type=EntityType.EGO,
            name="Autonomous Ego Vehicle",
            x=ego_lane_x,
            y=480.0,
            speed=10.0,
            target_speed=10.0,
            max_speed=10.0,
            width_m=1.9,
            length_m=4.4,
            color="#0ea5e9",
        )
        ego.target_x = ego_lane_x

        # Wrong-way auto-rickshaw/scooter starting ON-SCREEN at Y=70 (25.6m ahead)
        wrong_way = Vehicle(
            id="wrong_way_veh",
            type=EntityType.WRONG_WAY_VEHICLE,
            name="Wrong-Way Vehicle (KA-03)",
            x=ego_lane_x,
            y=70.0,  # clearly visible in upper viewport
            speed=6.0,
            target_speed=6.0,
            max_speed=7.5,
            heading=math.pi,  # facing DOWN directly into our path
            width_m=1.4,
            length_m=2.8,
            color="#ef4444",
        )
        wrong_way.target_x = wrong_way.x
        wrong_way.base_heading = math.pi

        return ego, [ego, wrong_way]

    def update(self, dt: float, ego: Vehicle, entities: List[Vehicle]):
        super().update(dt, ego, entities)
        wrong_way = next((e for e in entities if e.id == "wrong_way_veh"), None)
        if not wrong_way:
            return

        wrong_way.speed = 6.0
        wrong_way.target_speed = 6.0
        wrong_way.base_heading = math.pi

        # As the wrong-way vehicle approaches the stopped ego car, it edges towards the center divider
        if 1.6 <= self.elapsed < 7.0:
            wrong_way.target_x = ego.base_lane_x + (LANE_WIDTH_METERS * PIXELS_PER_METER * 0.45)

        # Mark passed once it is safely behind ego car
        if wrong_way.y > ego.y + 50.0:
            wrong_way.state = "PASSED"


class Scenario4_TrafficPolice(BaseScenario):
    """
    Scenario 4: Traffic Police Hand Signal Override
    Traffic police officer at intersection gives STOP hand gesture.
    Human-in-the-loop priority override: AV stops 8m before officer, waits for PROCEED wave.
    """
    def __init__(self):
        super().__init__(
            id="SCENARIO_4_TRAFFIC_POLICE",
            name="4. Traffic Police Hand Signal",
            description="A traffic police officer raises a STOP hand gesture, overriding normal intersection flow.",
            duration=14.0,
        )

    def setup(self, road_layout: Dict[str, float]) -> Tuple[Vehicle, List[Vehicle]]:
        self.elapsed = 0.0
        ego_lane_x = road_layout["lane_left_x"]

        ego = Vehicle(
            id="ego",
            type=EntityType.EGO,
            name="Autonomous Ego Vehicle",
            x=ego_lane_x,
            y=480.0,
            speed=8.9,
            target_speed=8.9,
            max_speed=8.9,
            width_m=1.9,
            length_m=4.4,
            color="#0ea5e9",
        )
        ego.target_x = ego_lane_x

        police = Vehicle(
            id="police_officer",
            type=EntityType.TRAFFIC_POLICE,
            name="Traffic Police Officer",
            x=ego_lane_x + (LANE_WIDTH_METERS * PIXELS_PER_METER * 0.55),
            y=480.0 - (24.0 * PIXELS_PER_METER),
            speed=0.0,
            target_speed=0.0,
            width_m=0.8,
            length_m=0.8,
            color="#eab308",
            gesture=PoliceGesture.STOP,
        )
        police.target_x = police.x

        return ego, [ego, police]

    def update(self, dt: float, ego: Vehicle, entities: List[Vehicle]):
        super().update(dt, ego, entities)
        police = next((e for e in entities if e.id == "police_officer"), None)
        if not police:
            return

        if self.elapsed < 7.0:
            police.gesture = PoliceGesture.STOP
        else:
            police.gesture = PoliceGesture.PROCEED


class Scenario5_ObstacleSwerve(BaseScenario):
    """
    Scenario 5: Road Obstacle with Adjacent Clearance Validation
    "Never Blindly Swerve":
    Phase 1: Lane blocked by debris; adjacent right lane occupied by Auto-Rickshaw.
    AV checks blindspot -> recognizes unsafe gap -> stops in lane.
    Phase 2: Auto passes -> blindspot verified clear -> AV repositions around obstacle,
    verifies left clearance, returns smoothly to lane.
    """
    def __init__(self):
        super().__init__(
            id="SCENARIO_5_OBSTACLE_SWERVE",
            name="5. Obstacle & Blindspot Gap Check",
            description="Demonstrates 'Never Blindly Swerve': halts while adjacent lane is occupied, repositions only when gap is clear.",
            duration=16.0,
        )

    def setup(self, road_layout: Dict[str, float]) -> Tuple[Vehicle, List[Vehicle]]:
        self.elapsed = 0.0
        ego_lane_x = road_layout["lane_left_x"]
        adjacent_lane_x = road_layout["lane_right_x"]

        ego = Vehicle(
            id="ego",
            type=EntityType.EGO,
            name="Autonomous Ego Vehicle",
            x=ego_lane_x,
            y=480.0,
            speed=9.7,
            target_speed=9.7,
            max_speed=9.7,
            width_m=1.9,
            length_m=4.4,
            color="#0ea5e9",
        )
        ego.target_x = ego_lane_x

        obstacle = Vehicle(
            id="obstacle_debris",
            type=EntityType.ROAD_OBSTACLE,
            name="Road Construction Debris",
            x=ego_lane_x,
            y=480.0 - (24.0 * PIXELS_PER_METER),
            speed=0.0,
            target_speed=0.0,
            width_m=1.8,
            length_m=2.2,
            color="#dc2626",
        )

        auto = Vehicle(
            id="auto_blocking",
            type=EntityType.AUTO_RICKSHAW,
            name="Auto-Rickshaw (Adjacent Lane)",
            x=adjacent_lane_x,
            y=480.0 - (4.0 * PIXELS_PER_METER),
            speed=8.0,
            target_speed=8.0,
            max_speed=12.0,
            width_m=1.5,
            length_m=2.8,
            color="#eab308",
        )
        auto.target_x = adjacent_lane_x

        return ego, [ego, obstacle, auto]

    def update(self, dt: float, ego: Vehicle, entities: List[Vehicle]):
        super().update(dt, ego, entities)
        auto = next((e for e in entities if e.id == "auto_blocking"), None)
        obstacle = next((e for e in entities if e.id == "obstacle_debris"), None)

        if self.elapsed < 4.5:
            if auto:
                auto.target_speed = 7.5
        elif 4.5 <= self.elapsed < 8.0:
            if auto:
                auto.target_speed = 14.0
        elif 8.0 <= self.elapsed < 12.0:
            if auto and obstacle and auto.y < obstacle.y - 80.0:
                auto.state = "PASSED"
        elif self.elapsed >= 12.0:
            if obstacle:
                obstacle.state = "CLEARED"


class Scenario6_BusyJunction(BaseScenario):
    """
    Scenario 6: Busy Mixed-Traffic Junction
    Multi-agent conflict cones: cross-traffic Auto-Rickshaw crossing from right.
    Ego crawls, yields to crossing auto, waits for clearance, traverses safely.
    """
    def __init__(self):
        super().__init__(
            id="SCENARIO_6_BUSY_JUNCTION",
            name="6. Busy Mixed-Traffic Junction",
            description="Navigating an unstructured junction with crossing autos, turning bikes, and tight gaps.",
            duration=16.0,
        )

    def setup(self, road_layout: Dict[str, float]) -> Tuple[Vehicle, List[Vehicle]]:
        self.elapsed = 0.0
        ego_lane_x = road_layout["lane_left_x"]

        ego = Vehicle(
            id="ego",
            type=EntityType.EGO,
            name="Autonomous Ego Vehicle",
            x=ego_lane_x,
            y=480.0,
            speed=7.5,
            target_speed=7.5,
            max_speed=7.5,
            width_m=1.9,
            length_m=4.4,
            color="#0ea5e9",
        )
        ego.target_x = ego_lane_x

        junction_center_y = 480.0 - (18.0 * PIXELS_PER_METER)
        # Cross-traffic Auto-Rickshaw crossing laterally across intersection
        cross_auto = Vehicle(
            id="cross_auto",
            type=EntityType.AUTO_RICKSHAW,
            name="Cross-Traffic Auto (KA-05)",
            x=road_layout["lane_right_x"] + (7.0 * PIXELS_PER_METER),
            y=junction_center_y,
            speed=4.5,
            target_speed=4.5,
            heading=-math.pi / 2,  # crossing leftwards
            width_m=1.5,
            length_m=2.8,
            color="#eab308",
        )
        cross_auto.target_x = ego_lane_x - (12.0 * PIXELS_PER_METER)

        # Ambient turning bike in opposite intersection quadrant
        turning_moto = Vehicle(
            id="turning_moto",
            type=EntityType.MOTORCYCLE,
            name="Ambient Motorcycle",
            x=road_layout["lane_right_x"] + (14.0 * PIXELS_PER_METER),
            y=junction_center_y - (10.0 * PIXELS_PER_METER),
            speed=4.0,
            target_speed=4.0,
            heading=math.pi * 0.75,
            width_m=0.8,
            length_m=2.0,
            color="#f97316",
        )

        return ego, [ego, cross_auto, turning_moto]

    def update(self, dt: float, ego: Vehicle, entities: List[Vehicle]):
        super().update(dt, ego, entities)
        cross_auto = next((e for e in entities if e.id == "cross_auto"), None)
        turning_moto = next((e for e in entities if e.id == "turning_moto"), None)

        if cross_auto:
            cross_auto.x -= cross_auto.speed * PIXELS_PER_METER * dt
            if cross_auto.x < ego.target_x - (3.0 * PIXELS_PER_METER):
                cross_auto.state = "PASSED"

        if turning_moto:
            turning_moto.x += math.sin(turning_moto.heading) * turning_moto.speed * PIXELS_PER_METER * dt
            turning_moto.y += math.cos(turning_moto.heading) * turning_moto.speed * PIXELS_PER_METER * dt


class ScenarioManager:
    def __init__(self, road_layout: Dict[str, float]):
        self.road_layout = road_layout
        self.scenarios: List[BaseScenario] = [
            Scenario0_AutoRealWorld(),
            Scenario1_MotoCutIn(),
            Scenario2_Pedestrian(),
            Scenario3_WrongWay(),
            Scenario4_TrafficPolice(),
            Scenario5_ObstacleSwerve(),
            Scenario6_BusyJunction(),
        ]
        self.current_index = 0

    @property
    def current_scenario(self) -> BaseScenario:
        return self.scenarios[self.current_index]

    def select_scenario(self, index: int) -> Tuple[Vehicle, List[Vehicle]]:
        if 0 <= index < len(self.scenarios):
            self.current_index = index
            return self.scenarios[self.current_index].setup(self.road_layout)
        return self.current_scenario.setup(self.road_layout)

    def reset_current(self) -> Tuple[Vehicle, List[Vehicle]]:
        return self.current_scenario.setup(self.road_layout)

    def get_scenario_metadata(self) -> List[Dict[str, Any]]:
        return [
            {
                "index": idx,
                "id": s.id,
                "name": s.name,
                "description": s.description,
                "duration": s.duration,
            }
            for idx, s in enumerate(self.scenarios)
        ]
