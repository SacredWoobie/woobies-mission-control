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


class ContractDeadlineService:
    available = True
    contract_deadline_schema = 1

    def __init__(self, deadline=None, error=None):
        self.deadline = deadline
        self.error = error
        self.contracts = []

    def contract_deadline(self, contract):
        self.contracts.append(contract)
        if self.error is not None:
            raise self.error
        return self.deadline


class VesselManagementService:
    available = True

    def __init__(self):
        self.termination_calls = []

    def terminate_vessel(self, vessel, expected_name, expected_crew_names):
        self.termination_calls.append(
            (vessel, expected_name, list(expected_crew_names))
        )


def fake_vessel(
    name="Odyssey", vessel_type="VesselType.ship", body="Kerbin", object_id=1,
    crew_names=None, recoverable=False,
):
    vessel = SimpleNamespace(
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
        crew=[
            SimpleNamespace(name=crew_name)
            for crew_name in (crew_names if crew_names is not None else ["Jebediah Kerman"])
        ],
        recoverable=recoverable,
        recovered=False,
    )
    vessel.recover = lambda: setattr(vessel, "recovered", True)
    return vessel


def fake_connection():
    stock_alarm = AlarmWithoutRemaining("Stock burn", 1100, "AlarmType.maneuver")
    kac_alarm = AlarmWithoutRemaining("KAC SOI", 1050, "AlarmType.soi_change")
    manager = SimpleNamespace(
        active_contracts=[], offered_contracts=[], completed_contracts=[],
        failed_contracts=[],
    )
    sc = SimpleNamespace(
        ut=1000,
        active_vessel=None,
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
        krpc=SimpleNamespace(current_game_scene="GameScene.space_center"),
        space_center=sc,
        mission_overview=MissionOverviewService(),
        vessel_management=VesselManagementService(),
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
        self.assertEqual(by_name["Odyssey"]["crewNames"], ["Jebediah Kerman"])
        self.assertFalse(by_name["Odyssey"]["recoverable"])
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

    def test_switches_to_exact_object_id_after_guid_validation(self):
        conn = fake_connection()
        first = fake_vessel("Relay", "VesselType.relay", object_id=101)
        second = fake_vessel("Relay", "VesselType.relay", object_id=202)
        conn.space_center.vessels = [first, second]
        telemetry_server._overview_last_poll["fleet"] = 500.0
        telemetry_server._overview_last_poll["roster"] = 500.0

        result = telemetry_server._apply_telemetry_command(conn, {
            "type": "overview.vessel.switch",
            "requestId": "switch-1",
            "objectId": "202",
            "expectedGuid": "Relay-guid",
        })

        self.assertIs(conn.space_center.active_vessel, second)
        self.assertEqual(result, {
            "type": "overview.vessel.switch.result",
            "requestId": "switch-1",
            "status": "accepted",
            "message": "Switching to the selected vessel.",
        })

    def test_rejects_stale_guid_without_switching_vessels(self):
        conn = fake_connection()
        original = conn.space_center.vessels[0]
        conn.space_center.active_vessel = original

        result = telemetry_server._apply_telemetry_command(conn, {
            "type": "overview.vessel.switch",
            "requestId": "switch-stale",
            "objectId": "2",
            "expectedGuid": "old-guid",
        })

        self.assertIs(conn.space_center.active_vessel, original)
        self.assertEqual(result["status"], "error")
        self.assertIn("changed", result["message"])

    def test_rejects_stale_name_when_krpc_guid_is_unavailable(self):
        conn = fake_connection()
        vessel = conn.space_center.vessels[0]
        del vessel.id

        result = telemetry_server._apply_telemetry_command(conn, {
            "type": "overview.vessel.switch",
            "requestId": "switch-stale-name",
            "objectId": "1",
            "expectedName": "Old Odyssey",
        })

        self.assertIsNone(conn.space_center.active_vessel)
        self.assertEqual(result["status"], "error")
        self.assertIn("changed", result["message"])

    def test_rejects_switch_outside_space_center_scenes(self):
        conn = fake_connection()
        conn.krpc.current_game_scene = "GameScene.flight"

        result = telemetry_server._apply_telemetry_command(conn, {
            "type": "overview.vessel.switch",
            "requestId": "switch-flight",
            "objectId": "1",
            "expectedGuid": "Odyssey-guid",
        })

        self.assertIsNone(conn.space_center.active_vessel)
        self.assertEqual(result["status"], "error")
        self.assertIn("Space Center", result["message"])

    def test_rejects_unbounded_object_id_before_integer_conversion(self):
        result = telemetry_server._apply_telemetry_command(fake_connection(), {
            "type": "overview.vessel.switch",
            "requestId": "switch-huge",
            "objectId": "9" * 21,
        })

        self.assertEqual(result["status"], "error")
        self.assertIn("valid live identity", result["message"])

    def test_edits_exact_object_id_and_returns_typed_result(self):
        conn = fake_connection()
        first = fake_vessel("Relay", "VesselType.relay", object_id=101)
        second = fake_vessel("Relay", "VesselType.relay", object_id=202)
        conn.space_center.vessels = [first, second]

        result = telemetry_server._apply_telemetry_command(conn, {
            "type": "overview.vessel.edit",
            "requestId": "edit-1",
            "objectId": "202",
            "expectedName": "Relay",
            "expectedType": "Relay",
            "expectedGuid": "Relay-guid",
            "newName": "Duna Relay",
            "newType": "Probe",
        })

        self.assertEqual(first.name, "Relay")
        self.assertEqual(second.name, "Duna Relay")
        self.assertEqual(second.type, telemetry_server.KRPCVesselType.probe)
        self.assertEqual(telemetry_server._overview_last_poll["fleet"], 0.0)
        self.assertEqual(telemetry_server._overview_last_poll["roster"], 0.0)
        self.assertEqual(result, {
            "type": "overview.vessel.edit.result",
            "requestId": "edit-1",
            "status": "accepted",
            "message": "Saved Duna Relay as Probe.",
            "name": "Duna Relay",
            "vesselType": "Probe",
        })

    def test_rejects_edit_when_selected_details_are_stale(self):
        conn = fake_connection()

        result = telemetry_server._apply_telemetry_command(conn, {
            "type": "overview.vessel.edit",
            "requestId": "edit-stale",
            "objectId": "1",
            "expectedName": "Old Odyssey",
            "expectedType": "Ship",
            "newName": "New Odyssey",
            "newType": "Relay",
        })

        self.assertEqual(conn.space_center.vessels[0].name, "Odyssey")
        self.assertEqual(result["status"], "error")
        self.assertIn("changed", result["message"])

    def test_rejects_invalid_or_unchanged_edit_values(self):
        conn = fake_connection()
        base = {
            "type": "overview.vessel.edit",
            "objectId": "1",
            "expectedName": "Odyssey",
            "expectedType": "Ship",
            "newType": "Ship",
        }

        invalid = telemetry_server._apply_telemetry_command(conn, {
            **base, "requestId": "edit-invalid", "newName": "Bad\nName",
        })
        unchanged = telemetry_server._apply_telemetry_command(conn, {
            **base, "requestId": "edit-unchanged", "newName": "Odyssey",
        })
        invalid_type = telemetry_server._apply_telemetry_command(conn, {
            **base,
            "requestId": "edit-invalid-type",
            "newName": "Odyssey",
            "newType": "Flag",
        })

        self.assertEqual(invalid["status"], "error")
        self.assertIn("control characters", invalid["message"])
        self.assertEqual(unchanged["status"], "error")
        self.assertIn("Change", unchanged["message"])
        self.assertEqual(invalid_type["status"], "error")
        self.assertIn("valid vessel type", invalid_type["message"])

    def test_changes_type_without_requiring_a_rename(self):
        conn = fake_connection()
        vessel = conn.space_center.vessels[0]

        result = telemetry_server._apply_telemetry_command(conn, {
            "type": "overview.vessel.edit",
            "requestId": "edit-type-only",
            "objectId": "1",
            "expectedName": "Odyssey",
            "expectedType": "Ship",
            "newName": "Odyssey",
            "newType": "Relay",
        })

        self.assertEqual(vessel.name, "Odyssey")
        self.assertEqual(vessel.type, telemetry_server.KRPCVesselType.relay)
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(result["vesselType"], "Relay")

    def test_rejects_edit_outside_space_center_scenes(self):
        conn = fake_connection()
        conn.krpc.current_game_scene = "GameScene.flight"

        result = telemetry_server._apply_telemetry_command(conn, {
            "type": "overview.vessel.edit",
            "requestId": "edit-flight",
            "objectId": "1",
            "expectedName": "Odyssey",
            "expectedType": "Ship",
            "newName": "Odyssey Prime",
            "newType": "Ship",
        })

        self.assertEqual(conn.space_center.vessels[0].name, "Odyssey")
        self.assertEqual(result["status"], "error")
        self.assertIn("Space Center", result["message"])

    def test_rolls_back_type_when_rename_setter_fails(self):
        class FailingNameVessel:
            _object_id = 301
            id = "failure-guid"
            type = telemetry_server.KRPCVesselType.ship

            @property
            def name(self):
                return "Failure Test"

            @name.setter
            def name(self, _value):
                raise RuntimeError("rename failed")

        conn = fake_connection()
        vessel = FailingNameVessel()
        conn.space_center.vessels = [vessel]

        result = telemetry_server._apply_telemetry_command(conn, {
            "type": "overview.vessel.edit",
            "requestId": "edit-rollback",
            "objectId": "301",
            "expectedName": "Failure Test",
            "expectedType": "Ship",
            "expectedGuid": "failure-guid",
            "newName": "Failure Test Prime",
            "newType": "Relay",
        })

        self.assertEqual(vessel.type, telemetry_server.KRPCVesselType.ship)
        self.assertEqual(result["status"], "error")
        self.assertIn("verify", result["message"])

    def test_recovers_exact_recoverable_vessel_with_guarded_crew_snapshot(self):
        conn = fake_connection()
        vessel = fake_vessel(
            "KSC Survey Plane", "VesselType.plane", object_id=707,
            crew_names=["Valentina Kerman"], recoverable=True,
        )
        conn.space_center.vessels = [vessel]
        telemetry_server._overview_last_poll["fleet"] = 500.0
        telemetry_server._overview_last_poll["roster"] = 500.0

        result = telemetry_server._apply_telemetry_command(conn, {
            "type": "overview.vessel.lifecycle",
            "requestId": "recover-1",
            "action": "recover",
            "objectId": "707",
            "expectedName": "KSC Survey Plane",
            "expectedGuid": "KSC Survey Plane-guid",
            "expectedRecoverable": True,
            "expectedCrewNames": ["Valentina Kerman"],
        })

        self.assertTrue(vessel.recovered)
        self.assertEqual(conn.vessel_management.termination_calls, [])
        self.assertEqual(telemetry_server._overview_last_poll["fleet"], 0.0)
        self.assertEqual(telemetry_server._overview_last_poll["roster"], 0.0)
        self.assertEqual(result, {
            "type": "overview.vessel.lifecycle.result",
            "requestId": "recover-1",
            "action": "recover",
            "status": "accepted",
            "message": "Recovered KSC Survey Plane.",
        })

    def test_terminates_exact_vessel_with_guid_name_and_crew_guards(self):
        conn = fake_connection()
        vessel = fake_vessel(
            object_id=808,
            crew_names=["Jebediah Kerman", "Bill Kerman", "Bob Kerman"],
        )
        conn.space_center.vessels = [vessel]

        result = telemetry_server._apply_telemetry_command(conn, {
            "type": "overview.vessel.lifecycle",
            "requestId": "terminate-1",
            "action": "terminate",
            "objectId": "808",
            "expectedName": "Odyssey",
            "expectedRecoverable": False,
            "expectedCrewNames": ["Jebediah Kerman", "Bill Kerman", "Bob Kerman"],
        })

        self.assertEqual(len(conn.vessel_management.termination_calls), 1)
        call = conn.vessel_management.termination_calls[0]
        self.assertIs(call[0], vessel)
        self.assertEqual(call[1:], (
            "Odyssey", ["Jebediah Kerman", "Bill Kerman", "Bob Kerman"]
        ))
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(result["action"], "terminate")

    def test_rejects_termination_when_crew_changed_after_confirmation_opened(self):
        conn = fake_connection()
        vessel = fake_vessel(object_id=909, crew_names=["Jebediah Kerman", "Bill Kerman"])
        conn.space_center.vessels = [vessel]

        result = telemetry_server._apply_telemetry_command(conn, {
            "type": "overview.vessel.lifecycle",
            "requestId": "terminate-stale-crew",
            "action": "terminate",
            "objectId": "909",
            "expectedName": "Odyssey",
            "expectedGuid": "Odyssey-guid",
            "expectedRecoverable": False,
            "expectedCrewNames": ["Jebediah Kerman"],
        })

        self.assertEqual(result["status"], "error")
        self.assertIn("crew changed", result["message"])
        self.assertEqual(conn.vessel_management.termination_calls, [])

    def test_rejects_lifecycle_request_when_recovery_state_is_stale(self):
        conn = fake_connection()
        vessel = fake_vessel(object_id=1001, crew_names=[], recoverable=True)
        conn.space_center.vessels = [vessel]

        result = telemetry_server._apply_telemetry_command(conn, {
            "type": "overview.vessel.lifecycle",
            "requestId": "terminate-stale-state",
            "action": "terminate",
            "objectId": "1001",
            "expectedName": "Odyssey",
            "expectedGuid": "Odyssey-guid",
            "expectedRecoverable": False,
            "expectedCrewNames": [],
        })

        self.assertEqual(result["status"], "error")
        self.assertIn("recovery state changed", result["message"])
        self.assertFalse(vessel.recovered)
        self.assertEqual(conn.vessel_management.termination_calls, [])

    def test_rejects_termination_when_custom_service_is_unavailable(self):
        conn = fake_connection()
        vessel = fake_vessel(object_id=1101, crew_names=[])
        conn.space_center.vessels = [vessel]
        conn.vessel_management.available = False

        result = telemetry_server._apply_telemetry_command(conn, {
            "type": "overview.vessel.lifecycle",
            "requestId": "terminate-unavailable",
            "action": "terminate",
            "objectId": "1101",
            "expectedName": "Odyssey",
            "expectedGuid": "Odyssey-guid",
            "expectedRecoverable": False,
            "expectedCrewNames": [],
        })

        self.assertEqual(result["status"], "error")
        self.assertIn("not available", result["message"])
        self.assertEqual(conn.vessel_management.termination_calls, [])

    def test_contract_rows_include_finite_completion_rewards(self):
        child = SimpleNamespace(
            title="Transmit the data",
            completed=False,
            failed=False,
            optional=True,
            notes="Use any antenna.",
            children=[],
        )
        parameter = SimpleNamespace(
            title="<b>Collect science</b>",
            completed=True,
            failed=False,
            optional=False,
            notes="",
            children=[child],
        )
        contract = SimpleNamespace(
            _object_id=77,
            title="Point a dish out from Kerbin",
            type="ContractType.configured",
            date_deadline=None,
            synopsis="Build a relay network.",
            description="<color=#ffcc00>Keep Kerbin connected.</color>",
            notes="Read the fine print.",
            parameters=[parameter],
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
        self.assertEqual(row["objectId"], "77")
        self.assertEqual(row["reputationCompletion"], 8.5)
        self.assertEqual(row["scienceCompletion"], 3)
        self.assertEqual(row["synopsis"], "Build a relay network.")
        self.assertEqual(row["description"], "Keep Kerbin connected.")
        self.assertEqual(row["notes"], "Read the fine print.")
        self.assertEqual(row["parameters"], [
            {
                "title": "Collect science",
                "status": "complete",
                "depth": 0,
                "optional": False,
            },
            {
                "title": "Transmit the data",
                "status": "incomplete",
                "depth": 1,
                "optional": True,
                "notes": "Use any antenna.",
            },
        ])

    def test_contract_deadline_prefers_exact_custom_service_contract(self):
        contract = SimpleNamespace(
            title="Explore Duna",
            type="ContractType.exploration",
            parameters=[],
        )
        service = ContractDeadlineService(deadline=13_200_000.0)
        manager = SimpleNamespace(
            active_contracts=[contract], offered_contracts=[],
            completed_contracts=[], failed_contracts=[],
        )

        row = telemetry_server._gather_overview_contracts(
            SimpleNamespace(contract_manager=manager), service
        )["overview.contracts"][0]

        self.assertEqual(row["deadline"], 13_200_000.0)
        self.assertEqual(service.contracts, [contract])

    def test_contract_deadline_retains_old_service_property_fallback(self):
        contract = SimpleNamespace(
            title="Legacy relay contract",
            type="ContractType.satellite",
            date_deadline=10_800_000.0,
            parameters=[],
        )
        manager = SimpleNamespace(
            active_contracts=[contract], offered_contracts=[],
            completed_contracts=[], failed_contracts=[],
        )

        row = telemetry_server._gather_overview_contracts(
            SimpleNamespace(contract_manager=manager), MissionOverviewService()
        )["overview.contracts"][0]

        self.assertEqual(row["deadline"], 10_800_000.0)

    def test_contract_deadline_omits_invalid_or_failed_service_values(self):
        contract = SimpleNamespace(
            title="Evergreen contract",
            type="ContractType.configured",
            parameters=[],
        )
        manager = SimpleNamespace(
            active_contracts=[contract], offered_contracts=[],
            completed_contracts=[], failed_contracts=[],
        )
        services = (
            ContractDeadlineService(deadline=float("nan")),
            ContractDeadlineService(deadline=0),
            ContractDeadlineService(error=RuntimeError("stale contract")),
        )

        for service in services:
            with self.subTest(service=service):
                row = telemetry_server._gather_overview_contracts(
                    SimpleNamespace(contract_manager=manager), service
                )["overview.contracts"][0]
                self.assertIsNone(row["deadline"])

    def test_contract_text_strips_markup_without_removing_numeric_comparisons(self):
        contract = SimpleNamespace(
            title="<b>Low flight</b>",
            type="ContractType.configured",
            date_deadline=None,
            synopsis="Maintain altitude < 1000 m and speed > 0 m/s.",
            description="<color=#ffcc00>Stay below the ceiling.</color>",
            notes="",
            parameters=[],
        )
        row = telemetry_server._gather_overview_contracts(SimpleNamespace(
            contract_manager=SimpleNamespace(
                active_contracts=[contract],
                offered_contracts=[],
                completed_contracts=[],
                failed_contracts=[],
            )
        ))["overview.contracts"][0]

        self.assertEqual(row["title"], "Low flight")
        self.assertEqual(
            row["synopsis"],
            "Maintain altitude < 1000 m and speed > 0 m/s.",
        )
        self.assertEqual(row["description"], "Stay below the ceiling.")

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
        self.assertTrue(first["overview.vesselTerminationAvailable"])

        conn.space_center.funds = 300000
        conn.space_center.ut = 1001
        cached = telemetry_server._gather_overview_telemetry(conn, "GameScene.space_center", now=101)
        self.assertEqual(cached["overview.funds"], 250000)
        self.assertEqual(cached["t.universalTime"], 1001)

        refreshed = telemetry_server._gather_overview_telemetry(conn, "GameScene.space_center", now=102.1)
        self.assertEqual(refreshed["overview.funds"], 300000)

    def test_contract_poll_uses_and_caches_custom_service_deadline(self):
        conn = fake_connection()
        contract = SimpleNamespace(
            title="Explore Duna",
            type="ContractType.exploration",
            parameters=[],
        )
        conn.space_center.contract_manager.active_contracts = [contract]
        conn.mission_overview = ContractDeadlineService(deadline=13_200_000.0)

        first = telemetry_server._gather_overview_telemetry(
            conn, "GameScene.space_center", now=100
        )
        self.assertEqual(
            first["overview.contracts"][0]["deadline"], 13_200_000.0
        )
        self.assertEqual(conn.mission_overview.contracts, [contract])

        conn.mission_overview.deadline = 14_400_000.0
        cached = telemetry_server._gather_overview_telemetry(
            conn, "GameScene.space_center", now=101
        )
        self.assertEqual(
            cached["overview.contracts"][0]["deadline"], 13_200_000.0
        )
        self.assertEqual(conn.mission_overview.contracts, [contract])

        refreshed = telemetry_server._gather_overview_telemetry(
            conn, "GameScene.space_center", now=110.1
        )
        self.assertEqual(
            refreshed["overview.contracts"][0]["deadline"], 14_400_000.0
        )
        self.assertEqual(conn.mission_overview.contracts, [contract, contract])


if __name__ == "__main__":
    unittest.main()
