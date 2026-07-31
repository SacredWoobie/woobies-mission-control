import math
import unittest
from types import SimpleNamespace

import telemetry_server


class AlarmWithoutRemaining:
    def __init__(self, title, alarm_time, alarm_type="Alarm", vessel=None):
        self.title = title
        self.name = title
        self.time = alarm_time
        self.type = alarm_type
        self.vessel = vessel
        self.notes = ""

    @property
    def remaining(self):
        raise AssertionError("alarm.remaining must not be queried")


class MissionOverviewService:
    available = True

    def roster_names(self): return ["Jebediah Kerman", "Valentina Kerman"]
    def roster_statuses(self): return ["Assigned", "Dead"]
    def roster_types(self): return ["Crew", "Crew"]
    def roster_traits(self): return ["Pilot", "Pilot"]
    def roster_experience(self): return [12.0, 20.0]
    def roster_levels(self): return [2, 4]
    def roster_veterans(self): return [True, True]
    def roster_flight_counts(self): return [5, 11]


def fake_vessel(
    name="Odyssey", vessel_type="VesselType.ship", body="Kerbin", object_id=1
):
    return SimpleNamespace(
        _object_id=object_id,
        id=f"{name}-guid",
        name=name,
        type=vessel_type,
        situation="VesselSituation.orbiting",
        orbit=SimpleNamespace(
            body=SimpleNamespace(name=body),
            apoapsis_altitude=122_480.0,
            periapsis_altitude=118_920.0,
            inclination=0.25,
            period=2_080.4,
            eccentricity=0.0008,
        ),
        met=134.2,
        crew=[SimpleNamespace(name="Jebediah Kerman")],
    )


def fake_connection():
    stock_alarm = AlarmWithoutRemaining("Stock burn", 1100, "AlarmType.maneuver")
    kac_alarm = AlarmWithoutRemaining("KAC SOI", 1050, "AlarmType.soi_change")
    manager = SimpleNamespace(
        active_contracts=[], offered_contracts=[], completed_contracts=[],
        failed_contracts=[],
    )
    sc = SimpleNamespace(
        ut=1000,
        game_mode="GameMode.career",
        funds=250000,
        science=42.5,
        reputation=71.2,
        vessels=[
            fake_vessel(object_id=1),
            fake_vessel("Spent stage", "VesselType.debris", object_id=2),
            fake_vessel("Jebediah Kerman", "VesselType.eva", object_id=3),
            fake_vessel("KSC Flag", "VesselType.flag", object_id=4),
            fake_vessel("Comet SWM-204", "VesselType.space_object", object_id=5),
            fake_vessel("Mystery object", "VesselType.unknown", object_id=6),
        ],
        contract_manager=manager,
        alarm_manager=SimpleNamespace(alarms=[stock_alarm]),
    )
    return SimpleNamespace(
        space_center=sc,
        mission_overview=MissionOverviewService(),
        kerbal_alarm_clock=SimpleNamespace(available=True, alarms=[kac_alarm]),
    )


class MissionOverviewTelemetryTests(unittest.TestCase):
    def setUp(self):
        telemetry_server._reset_overview_state()

    def test_save_mode_capabilities_hide_irrelevant_program_fields(self):
        career = telemetry_server._gather_overview_economy(fake_connection().space_center)
        self.assertEqual(career["overview.gameMode"], "Career")
        self.assertTrue(career["overview.capabilities"]["contracts"])
        self.assertEqual(career["overview.funds"], 250000)

        science = SimpleNamespace(game_mode="GameMode.science_sandbox", science=88)
        result = telemetry_server._gather_overview_economy(science)
        self.assertTrue(result["overview.capabilities"]["science"])
        self.assertFalse(result["overview.capabilities"]["funds"])
        self.assertNotIn("overview.funds", result)
        self.assertNotIn("overview.reputation", result)

    def test_fleet_keeps_requested_craft_types_and_drops_other_objects(self):
        result = telemetry_server._gather_overview_fleet(fake_connection().space_center)
        self.assertEqual([row["name"] for row in result["overview.vessels"]], ["Odyssey", "Spent stage"])
        by_name = {row["name"]: row for row in result["overview.vessels"]}
        self.assertTrue(by_name["Odyssey"]["mission"])
        self.assertFalse(by_name["Spent stage"]["mission"])
        self.assertEqual(by_name["Odyssey"]["body"], "Kerbin")
        self.assertEqual(by_name["Odyssey"]["objectId"], "1")
        self.assertEqual(by_name["Odyssey"]["guid"], "Odyssey-guid")
        self.assertEqual(by_name["Odyssey"]["apoapsisAltitude"], 122_480.0)
        self.assertEqual(by_name["Odyssey"]["periapsisAltitude"], 118_920.0)
        self.assertAlmostEqual(by_name["Odyssey"]["inclination"], math.degrees(0.25))
        self.assertEqual(by_name["Odyssey"]["period"], 2_080.4)
        self.assertEqual(by_name["Odyssey"]["eccentricity"], 0.0008)

    def test_fleet_omits_unavailable_and_non_finite_orbit_values(self):
        vessel = fake_vessel()
        vessel.orbit.apoapsis_altitude = float("nan")
        vessel.orbit.periapsis_altitude = float("inf")
        vessel.orbit.inclination = None
        vessel.orbit.period = "unknown"
        del vessel.orbit.eccentricity

        row = telemetry_server._gather_overview_fleet(
            SimpleNamespace(vessels=[vessel])
        )["overview.vessels"][0]

        for field in (
            "apoapsisAltitude", "periapsisAltitude", "inclination",
            "period", "eccentricity",
        ):
            self.assertNotIn(field, row)

    def test_fleet_assigns_distinct_object_ids_to_same_named_vessels(self):
        result = telemetry_server._gather_overview_fleet(SimpleNamespace(
            vessels=[
                fake_vessel("Relay", "VesselType.relay", object_id=101),
                fake_vessel("Relay", "VesselType.relay", object_id=202),
            ]
        ))

        self.assertEqual(
            [row["objectId"] for row in result["overview.vessels"]],
            ["101", "202"],
        )

    def test_contract_rows_include_finite_completion_rewards(self):
        contract = SimpleNamespace(
            title="Point a dish out from Kerbin",
            type="ContractType.configured",
            date_deadline=None,
            funds_completion=42_500,
            reputation_completion=8.5,
            science_completion=3,
        )
        manager = SimpleNamespace(
            active_contracts=[contract],
            offered_contracts=[],
            completed_contracts=[],
            failed_contracts=[],
        )

        row = telemetry_server._gather_overview_contracts(
            SimpleNamespace(contract_manager=manager)
        )["overview.contracts"][0]

        self.assertEqual(row["fundsCompletion"], 42_500)
        self.assertEqual(row["reputationCompletion"], 8.5)
        self.assertEqual(row["scienceCompletion"], 3)

    def test_merges_alarm_sources_by_time_without_querying_remaining(self):
        conn = fake_connection()
        result = telemetry_server._gather_overview_alarms(conn, conn.space_center)
        self.assertEqual([row["source"] for row in result["overview.alarms"]], ["KAC", "Stock"])
        self.assertEqual(result["overview.alarmProviders"], {"stock": "available", "kac": "available"})

    def test_reads_complete_roster_from_read_only_custom_service(self):
        result = telemetry_server._gather_overview_roster(fake_connection())
        self.assertTrue(result["overview.rosterAvailable"])
        self.assertEqual(result["overview.roster"][0]["assignment"], "Odyssey")
        self.assertEqual(result["overview.roster"][1]["status"], "Dead")
        self.assertNotIn("assignment", result["overview.roster"][1])
        self.assertEqual(result["overview.roster"][1]["flightCount"], 11)

    def test_poll_tiers_cache_slow_data_but_keep_ut_current(self):
        conn = fake_connection()
        first = telemetry_server._gather_overview_telemetry(conn, "GameScene.space_center", now=100)
        self.assertEqual(first["overview.funds"], 250000)
        self.assertEqual(first["t.universalTime"], 1000)

        conn.space_center.funds = 300000
        conn.space_center.ut = 1001
        cached = telemetry_server._gather_overview_telemetry(conn, "GameScene.space_center", now=101)
        self.assertEqual(cached["overview.funds"], 250000)
        self.assertEqual(cached["t.universalTime"], 1001)

        refreshed = telemetry_server._gather_overview_telemetry(conn, "GameScene.space_center", now=102.1)
        self.assertEqual(refreshed["overview.funds"], 300000)


if __name__ == "__main__":
    unittest.main()
