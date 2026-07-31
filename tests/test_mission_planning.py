import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "mission_planning.py"

spec = importlib.util.spec_from_file_location("mission_planning_commands", EXTENSION)
planning = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planning)


class FakePlanner:
    def __init__(self, *, available=True, state="idle"):
        self.available = available
        self.detected_mech_jeb_version = "2.15.3.0"
        self.compatibility_target = "2.15.3.0"
        self.state = state
        self.progress = 0
        self.error = ""
        self.origin_body = ""
        self.destination_body = ""
        self.parking_altitude = 0.0
        self.include_capture_burn = False
        self.best_departure_ut = 0.0
        self.best_arrival_ut = 0.0
        self.best_transfer_time = 0.0
        self.best_ejection_delta_v = 0.0
        self.best_arrival_v_infinity = 0.0
        self.best_capture_delta_v = 0.0
        self.best_total_delta_v = 0.0
        self.started = []
        self.cancel_count = 0
        self.date_samples = 2
        self.duration_samples = 3
        self.best_departure_index = 1
        self.best_transfer_time_index = 2
        self.departure_uts = [100.0, 200.0]
        self.transfer_times = [10.0, 20.0, 30.0]
        self.delta_v_grid = [900.0, 800.0, float("inf"), 700.0, 600.0, 500.0]
        self.evaluations = {}
        self.prepared_ejection_token = ""
        self.previewed_ejections = []
        self.created_ejections = []
        self.nodes = []

    def start_automatic(self, origin, destination, altitude, powered_capture):
        self.started.append((origin, destination, altitude, powered_capture))
        self.state = "running"

    def start_automatic_after(self, origin, destination, altitude, powered_capture, earliest):
        self.started.append((origin, destination, altitude, powered_capture, earliest))
        self.state = "running"

    def get_departure_u_ts(self):
        return list(self.departure_uts)

    def get_transfer_times(self):
        return list(self.transfer_times)

    def get_delta_v_grid(self):
        return list(self.delta_v_grid)

    def evaluate_point(self, departure_index, transfer_time_index):
        return self.evaluations.get(
            (departure_index, transfer_time_index),
            [200.0, 230.0, 30.0, 1110.0, 734.0, 1844.0],
        )

    def evaluate_point_detailed(self, departure_index, transfer_time_index):
        return [
            *self.evaluate_point(departure_index, transfer_time_index),
            321.0,
            -654.0,
            987.0,
        ]

    def preview_active_vessel_ejection(
        self, origin, departure_ut, exit_x, exit_y, exit_z, vessel_guid
    ):
        self.previewed_ejections.append(
            (origin, departure_ut, exit_x, exit_y, exit_z, vessel_guid)
        )
        self.prepared_ejection_token = "prepared-node-1"
        return [
            4_550.0,
            100.0,
            -25.0,
            1045.0,
            1_050.08,
            82_000.0,
            78_000.0,
            0.7,
            0.01,
            -6_800_000.0,
        ]

    def create_prepared_ejection(self, token, vessel_guid):
        self.created_ejections.append((token, vessel_guid))
        self.nodes[:] = [SimpleNamespace(ut=4_550.0, delta_v=1_050.08)]
        return [
            4_550.0,
            100.0,
            -25.0,
            1045.0,
            1_050.08,
            82_000.0,
            78_000.0,
            0.7,
            0.01,
            -6_800_000.0,
        ]

    def cancel(self):
        self.cancel_count += 1
        self.state = "cancelled"


class FakeConnection:
    def __init__(self, planner=None, *, compatibility_ready=True):
        self.planner = planner or FakePlanner()
        self.mech_jeb = type(
            "MechJeb",
            (),
            {
                "transfer_planner": self.planner,
                "type_compatibility_ready": compatibility_ready,
            },
        )()
        self.space_center = type(
            "SpaceCenter",
            (),
            {
                "bodies": {},
                "ut": 12345.0,
                "active_vessel": SimpleNamespace(
                    control=SimpleNamespace(nodes=self.planner.nodes)
                ),
            },
        )()


def start_command(request_id="request-1"):
    return {
        "type": "mechjeb.transfer.start",
        "requestId": request_id,
        "fingerprint": "Kerbin|Duna|80000|capture",
        "origin": "Kerbin",
        "destination": "Duna",
        "originParkingAltitude": 80_000,
        "optimizePoweredCapture": True,
    }


def preview_node_command():
    return {
        "type": "mechjeb.transfer.node.preview",
        "actionId": "segment-1-primary",
        "fingerprint": "selected-transfer-1",
        "origin": "Kerbin",
        "plannedParkingAltitude": 80_000,
        "departureUT": 4_600,
        "expectedDeltaV": 1_050,
        "departureVInfinity": [321.0, -654.0, 987.0],
        "expectedVesselGuid": "11111111-2222-3333-4444-555555555555",
    }


def transfer_windows_command(request_id="windows-1"):
    return {
        "type": "mechjeb.transfer.windows.refresh",
        "requestId": request_id,
        "origin": "Kerbin",
        "originParkingAltitude": 80_000,
        "optimizePoweredCapture": True,
    }


def transfer_window_catalog():
    return [
        {"name": "Kerbin", "parent": "Sun"},
        {"name": "Mun", "parent": "Kerbin"},
        {"name": "Duna", "parent": "Sun"},
        {"name": "Eve", "parent": "Sun"},
        {"name": "Sarnus", "parent": "Sun"},
        {"name": "Tekto", "parent": "Sarnus"},
    ]


class ControllerHarness:
    def __init__(self):
        self.payload = {
            "context.mode": "flight",
            "t.universalTime": 12345.0,
        }
        self.controller = planning.MissionPlanningController()

    def command(self, conn, command):
        return self.controller.apply_command(conn, command)

    def gather(self, conn):
        return self.controller.gather(
            conn,
            self.payload["context.mode"],
            self.payload["t.universalTime"],
        )


class TransferCommandTests(unittest.TestCase):
    def setUp(self):
        self.extension = ControllerHarness()
        self.conn = FakeConnection()

    def test_start_records_request_and_invokes_planner(self):
        self.extension.command(self.conn, start_command())
        payload = self.extension.gather(self.conn)

        self.assertEqual(
            self.conn.planner.started, [("Kerbin", "Duna", 80_000.0, True)]
        )
        self.assertEqual(payload["mj.transfer.requestId"], "request-1")
        self.assertEqual(payload["mj.transfer.fingerprint"], "Kerbin|Duna|80000|capture")
        self.assertEqual(payload["mj.transfer.state"], "running")
        self.assertEqual(payload["mj.transfer.requestedAtUT"], 12345.0)

    def test_running_progress_is_attached_to_ordinary_snapshot(self):
        self.extension.command(self.conn, start_command())
        self.conn.planner.progress = 47

        payload = self.extension.gather(self.conn)

        self.assertEqual(payload["context.mode"], "flight")
        self.assertEqual(payload["mj.transfer.state"], "running")
        self.assertEqual(payload["mj.transfer.progress"], 47)

    def test_start_after_uses_a_timeline_constraint(self):
        command = start_command()
        command["earliestDepartureUT"] = 500_000.0

        self.extension.command(self.conn, command)

        self.assertEqual(self.conn.planner.started, [
            ("Kerbin", "Duna", 80_000.0, True, 500_000.0)
        ])

    def test_completed_result_uses_arrival_v_infinity(self):
        self.extension.command(self.conn, start_command())
        planner = self.conn.planner
        planner.state = "completed"
        planner.progress = 100
        planner.origin_body = "Kerbin"
        planner.destination_body = "Duna"
        planner.parking_altitude = 80_000.0
        planner.include_capture_burn = True
        planner.best_departure_ut = 1_000_000.0
        planner.best_arrival_ut = 2_000_000.0
        planner.best_transfer_time = 1_000_000.0
        planner.best_ejection_delta_v = 1_065.25
        planner.best_arrival_v_infinity = 805.75
        planner.best_capture_delta_v = 999_999.0
        planner.best_total_delta_v = 1_871.0

        payload = self.extension.gather(self.conn)

        self.assertEqual(payload["mj.transfer.state"], "completed")
        self.assertEqual(payload["mj.transfer.progress"], 100)
        self.assertEqual(payload["mj.transfer.departureUT"], 1_000_000.0)
        self.assertEqual(payload["mj.transfer.arrivalUT"], 2_000_000.0)
        self.assertEqual(payload["mj.transfer.transferTime"], 1_000_000.0)
        self.assertEqual(payload["mj.transfer.ejectionDeltaV"], 1_065.25)
        self.assertEqual(payload["mj.transfer.arrivalVInfinity"], 805.75)
        self.assertEqual(payload["mj.transfer.calculatedTotal"], 1_871.0)
        self.assertEqual(payload["mj.transfer.departureVInfinityX"], 321.0)
        self.assertEqual(payload["mj.transfer.departureVInfinityY"], -654.0)
        self.assertEqual(payload["mj.transfer.departureVInfinityZ"], 987.0)
        self.assertEqual(payload["mj.transfer.maneuverVectorSchema"], 1)

    def test_completed_result_survives_missing_maneuver_vector(self):
        self.extension.command(self.conn, start_command())
        planner = self.conn.planner
        planner.state = "completed"
        planner.best_departure_ut = 1_000_000.0
        planner.best_arrival_ut = 2_000_000.0
        planner.best_transfer_time = 1_000_000.0
        planner.best_ejection_delta_v = 1_065.25
        planner.best_arrival_v_infinity = 805.75
        planner.best_total_delta_v = 1_871.0

        def fail_detailed(*_args):
            raise RuntimeError("Detailed evaluation unavailable")

        planner.evaluate_point_detailed = fail_detailed
        payload = self.extension.gather(self.conn)

        self.assertEqual(payload["mj.transfer.state"], "completed")
        self.assertEqual(payload["mj.transfer.ejectionDeltaV"], 1_065.25)
        self.assertIsNone(payload["mj.transfer.departureVInfinityX"])
        self.assertEqual(payload["mj.transfer.maneuverVectorSchema"], 0)

    def test_cancel_matching_request(self):
        self.extension.command(self.conn, start_command())

        self.extension.command(
            self.conn, {"type": "mechjeb.transfer.cancel", "requestId": "request-1"}
        )
        payload = self.extension.gather(self.conn)

        self.assertEqual(self.conn.planner.cancel_count, 1)
        self.assertEqual(payload["mj.transfer.state"], "cancelled")

    def test_cancel_wrong_request_id_is_ignored(self):
        self.extension.command(self.conn, start_command())

        self.extension.command(
            self.conn, {"type": "mechjeb.transfer.cancel", "requestId": "stale-request"}
        )

        self.assertEqual(self.conn.planner.cancel_count, 0)

    def test_unavailable_service_reports_failure_for_request(self):
        conn = FakeConnection(FakePlanner(available=False))

        self.extension.command(conn, start_command())
        payload = self.extension.gather(conn)

        self.assertEqual(conn.planner.started, [])
        self.assertFalse(payload["mj.transfer.available"])
        self.assertEqual(payload["mj.transfer.state"], "failed")
        self.assertIn("unavailable", payload["mj.transfer.error"].lower())
        self.assertEqual(payload["mj.transfer.requestId"], "request-1")

    def test_incompatible_service_reports_failure_for_request(self):
        conn = FakeConnection(compatibility_ready=False)

        self.extension.command(conn, start_command())
        payload = self.extension.gather(conn)

        self.assertEqual(conn.planner.started, [])
        self.assertFalse(payload["mj.transfer.compatibilityReady"])
        self.assertEqual(payload["mj.transfer.state"], "failed")

    def test_external_busy_planner_is_not_reused(self):
        conn = FakeConnection(FakePlanner(state="running"))

        self.extension.command(conn, start_command())
        payload = self.extension.gather(conn)

        self.assertEqual(conn.planner.started, [])
        self.assertEqual(payload["mj.transfer.state"], "failed")
        self.assertIn("already busy", payload["mj.transfer.error"].lower())

    def test_running_request_ignores_matching_retry_without_losing_state(self):
        self.extension.command(self.conn, start_command())

        self.extension.command(self.conn, start_command())
        payload = self.extension.gather(self.conn)

        self.assertEqual(payload["mj.transfer.requestId"], "request-1")
        self.assertEqual(payload["mj.transfer.state"], "running")
        self.assertEqual(len(self.conn.planner.started), 1)

    def test_running_request_rejects_competing_start_without_losing_owner(self):
        self.extension.command(self.conn, start_command())

        self.extension.command(self.conn, start_command("request-2"))
        payload = self.extension.gather(self.conn)
        self.extension.command(
            self.conn, {"type": "mechjeb.transfer.cancel", "requestId": "request-1"}
        )

        self.assertEqual(payload["mj.transfer.requestId"], "request-1")
        self.assertEqual(payload["mj.transfer.state"], "running")
        self.assertEqual(len(self.conn.planner.started), 1)
        self.assertEqual(self.conn.planner.cancel_count, 1)

    def test_unrelated_command_is_not_claimed(self):
        command = {"type": "notes.pin", "noteId": "note-1"}

        handled = self.extension.command(self.conn, command)

        self.assertFalse(handled)
        self.assertEqual(self.conn.planner.started, [])

    def test_grid_is_bulk_published_then_acknowledged(self):
        self.extension.command(self.conn, start_command())
        self.conn.planner.state = "completed"
        self.extension.gather(self.conn)

        self.extension.command(self.conn, {
            "type": "mechjeb.transfer.grid.request",
            "requestId": "request-1",
            "fingerprint": "Kerbin|Duna|80000|capture",
        })
        payload = self.extension.gather(self.conn)

        self.assertTrue(payload["mj.transfer.grid.published"])
        self.assertEqual(payload["mj.transfer.grid.dateSamples"], 2)
        self.assertEqual(payload["mj.transfer.grid.durationSamples"], 3)
        self.assertEqual(payload["mj.transfer.grid.departureUTs"], [100.0, 200.0])
        self.assertEqual(payload["mj.transfer.grid.transferTimes"], [10.0, 20.0, 30.0])
        self.assertEqual(payload["mj.transfer.grid.costs"], [900.0, 800.0, None, 700.0, 600.0, 500.0])
        self.assertEqual(payload["mj.transfer.grid.bestDepartureIndex"], 1)
        self.assertEqual(payload["mj.transfer.grid.bestTransferTimeIndex"], 2)

        self.extension.command(self.conn, {
            "type": "mechjeb.transfer.grid.ack", "requestId": "request-1"
        })
        acknowledged = self.extension.gather(self.conn)
        self.assertFalse(acknowledged["mj.transfer.grid.published"])
        self.assertEqual(acknowledged["mj.transfer.grid.costs"], [])

    def test_evaluates_a_selected_grid_point(self):
        self.extension.command(self.conn, start_command())
        self.conn.planner.state = "completed"
        self.extension.gather(self.conn)

        self.extension.command(self.conn, {
            "type": "mechjeb.transfer.evaluate",
            "requestId": "request-1",
            "fingerprint": "Kerbin|Duna|80000|capture",
            "departureIndex": 1,
            "transferTimeIndex": 2,
        })
        payload = self.extension.gather(self.conn)

        self.assertEqual(payload["mj.transfer.evaluation.departureIndex"], 1)
        self.assertEqual(payload["mj.transfer.evaluation.transferTimeIndex"], 2)
        self.assertEqual(payload["mj.transfer.evaluation.departureUT"], 200.0)
        self.assertEqual(payload["mj.transfer.evaluation.arrivalUT"], 230.0)
        self.assertEqual(payload["mj.transfer.evaluation.ejectionDeltaV"], 1110.0)
        self.assertEqual(payload["mj.transfer.evaluation.arrivalVInfinity"], 734.0)
        self.assertEqual(payload["mj.transfer.evaluation.departureVInfinityX"], 321.0)
        self.assertEqual(payload["mj.transfer.evaluation.departureVInfinityY"], -654.0)
        self.assertEqual(payload["mj.transfer.evaluation.departureVInfinityZ"], 987.0)

    def test_released_request_cannot_publish_or_evaluate_grid(self):
        self.extension.command(self.conn, start_command())
        self.conn.planner.state = "completed"
        self.extension.gather(self.conn)
        self.extension.command(self.conn, {
            "type": "mechjeb.transfer.release",
            "requestId": "request-1",
        })

        self.extension.command(self.conn, {
            "type": "mechjeb.transfer.grid.request",
            "requestId": "request-1",
            "fingerprint": "Kerbin|Duna|80000|capture",
        })
        self.extension.command(self.conn, {
            "type": "mechjeb.transfer.evaluate",
            "requestId": "request-1",
            "fingerprint": "Kerbin|Duna|80000|capture",
            "departureIndex": 1,
            "transferTimeIndex": 2,
        })
        payload = self.extension.gather(self.conn)

        self.assertEqual(payload["mj.transfer.grid.requestId"], "")
        self.assertEqual(payload["mj.transfer.evaluation.requestId"], "")

    def test_previews_then_creates_one_selected_ejection_node(self):
        command = preview_node_command()
        self.extension.command(self.conn, command)
        preview = self.extension.gather(self.conn)

        self.assertEqual(preview["mj.transfer.node.state"], "ready")
        self.assertEqual(preview["mj.transfer.node.nodeUT"], 4_550.0)
        self.assertEqual(preview["mj.transfer.node.deltaV"], 1_050.08)
        self.assertEqual(preview["mj.transfer.node.apoapsisAltitude"], 82_000.0)
        self.assertEqual(preview["mj.transfer.node.periapsisAltitude"], 78_000.0)
        self.assertEqual(preview["mj.transfer.node.semiMajorAxis"], -6_800_000.0)
        self.assertEqual(self.conn.planner.previewed_ejections, [(
            "Kerbin", 4_600.0, 321.0, -654.0, 987.0,
            "11111111-2222-3333-4444-555555555555",
        )])

        create = {
            "type": "mechjeb.transfer.node.create",
            "actionId": command["actionId"],
            "fingerprint": command["fingerprint"],
            "expectedVesselGuid": command["expectedVesselGuid"],
        }
        self.extension.command(self.conn, create)
        self.extension.command(self.conn, create)
        created = self.extension.gather(self.conn)

        self.assertEqual(created["mj.transfer.node.state"], "created")
        self.assertEqual(
            created["mj.transfer.node.vesselGuid"],
            "11111111-2222-3333-4444-555555555555",
        )
        self.assertEqual(self.conn.planner.created_ejections, [(
            "prepared-node-1",
            "11111111-2222-3333-4444-555555555555",
        )])

    def test_create_rejects_vessel_guid_changed_after_preview(self):
        command = preview_node_command()
        self.extension.command(self.conn, command)

        self.extension.command(self.conn, {
            "type": "mechjeb.transfer.node.create",
            "actionId": command["actionId"],
            "fingerprint": command["fingerprint"],
            "expectedVesselGuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        })
        payload = self.extension.gather(self.conn)

        self.assertEqual(payload["mj.transfer.node.state"], "ready")
        self.assertEqual(self.conn.planner.created_ejections, [])

    def test_create_rejects_a_different_browser_session(self):
        command = {**preview_node_command(), "_sessionId": "browser-a"}
        self.extension.command(self.conn, command)

        self.extension.command(self.conn, {
            "type": "mechjeb.transfer.node.create",
            "_sessionId": "browser-b",
            "actionId": command["actionId"],
            "fingerprint": command["fingerprint"],
            "expectedVesselGuid": command["expectedVesselGuid"],
        })
        payload = self.extension.gather(self.conn)

        self.assertEqual(payload["mj.transfer.node.state"], "ready")
        self.assertEqual(self.conn.planner.created_ejections, [])

    def test_revert_clears_created_maneuver_readiness(self):
        self.extension.payload["t.universalTime"] = 5_000.0
        command = preview_node_command()
        self.extension.command(self.conn, command)
        self.extension.gather(self.conn)
        self.extension.command(self.conn, {
            "type": "mechjeb.transfer.node.create",
            "actionId": command["actionId"],
            "fingerprint": command["fingerprint"],
            "expectedVesselGuid": command["expectedVesselGuid"],
        })
        self.assertEqual(
            self.extension.gather(self.conn)["mj.transfer.node.state"],
            "created",
        )

        self.extension.payload["t.universalTime"] = 1_000.0
        reverted = self.extension.gather(self.conn)

        self.assertEqual(reverted["mj.transfer.node.state"], "idle")
        self.assertEqual(reverted["mj.transfer.node.actionId"], "")
        self.assertEqual(reverted["mj.transfer.node.vesselGuid"], "")
        self.extension.command(self.conn, {
            "type": "mechjeb.transfer.node.create",
            "actionId": command["actionId"],
            "fingerprint": command["fingerprint"],
            "expectedVesselGuid": command["expectedVesselGuid"],
        })
        self.assertEqual(len(self.conn.planner.created_ejections), 1)

    def test_deleting_future_node_resets_maneuver_readiness(self):
        self.extension.payload["t.universalTime"] = 1_000.0
        command = preview_node_command()
        self.extension.command(self.conn, command)
        self.extension.command(self.conn, {
            "type": "mechjeb.transfer.node.create",
            "actionId": command["actionId"],
            "fingerprint": command["fingerprint"],
            "expectedVesselGuid": command["expectedVesselGuid"],
        })
        self.assertEqual(
            self.extension.gather(self.conn)["mj.transfer.node.state"],
            "created",
        )

        self.conn.planner.nodes.clear()
        deleted = self.extension.gather(self.conn)

        self.assertEqual(deleted["mj.transfer.node.state"], "idle")
        self.assertEqual(deleted["mj.transfer.node.actionId"], "")

    def test_replacing_created_node_at_same_ut_with_different_delta_v_resets(self):
        self.extension.payload["t.universalTime"] = 1_000.0
        command = preview_node_command()
        self.extension.command(self.conn, command)
        self.extension.command(self.conn, {
            "type": "mechjeb.transfer.node.create",
            "actionId": command["actionId"],
            "fingerprint": command["fingerprint"],
            "expectedVesselGuid": command["expectedVesselGuid"],
        })
        self.extension.gather(self.conn)
        self.conn.planner.nodes[:] = [
            SimpleNamespace(ut=4_550.0, delta_v=25.0)
        ]

        replaced = self.extension.gather(self.conn)

        self.assertEqual(replaced["mj.transfer.node.state"], "idle")

    def test_node_without_delta_v_keeps_ut_only_compatibility(self):
        self.extension.payload["t.universalTime"] = 1_000.0
        command = preview_node_command()
        self.extension.command(self.conn, command)
        self.extension.command(self.conn, {
            "type": "mechjeb.transfer.node.create",
            "actionId": command["actionId"],
            "fingerprint": command["fingerprint"],
            "expectedVesselGuid": command["expectedVesselGuid"],
        })
        self.extension.gather(self.conn)
        self.conn.planner.nodes[:] = [SimpleNamespace(ut=4_550.0)]

        compatible = self.extension.gather(self.conn)

        self.assertEqual(compatible["mj.transfer.node.state"], "created")

    def test_consumed_node_preserves_manual_plan_completion(self):
        self.extension.payload["t.universalTime"] = 1_000.0
        command = preview_node_command()
        self.extension.command(self.conn, command)
        self.extension.command(self.conn, {
            "type": "mechjeb.transfer.node.create",
            "actionId": command["actionId"],
            "fingerprint": command["fingerprint"],
            "expectedVesselGuid": command["expectedVesselGuid"],
        })
        self.extension.gather(self.conn)

        self.extension.payload["t.universalTime"] = 4_600.0
        self.conn.planner.nodes.clear()
        consumed = self.extension.gather(self.conn)

        self.assertEqual(consumed["mj.transfer.node.state"], "executed")
        self.assertEqual(consumed["mj.transfer.node.actionId"], command["actionId"])
        self.assertEqual(
            consumed["mj.transfer.node.vesselGuid"],
            command["expectedVesselGuid"],
        )

    def test_rejects_malformed_maneuver_preview_without_mutation(self):
        command = preview_node_command()
        command["departureVInfinity"] = [float("nan"), 0.0, 0.0]

        self.extension.command(self.conn, command)
        payload = self.extension.gather(self.conn)

        self.assertEqual(payload["mj.transfer.node.state"], "idle")
        self.assertEqual(self.conn.planner.previewed_ejections, [])

    def test_stale_grid_and_evaluation_requests_are_ignored(self):
        self.extension.command(self.conn, start_command())
        self.conn.planner.state = "completed"
        self.extension.gather(self.conn)

        for command_type in ("mechjeb.transfer.grid.request", "mechjeb.transfer.evaluate"):
            command = {
                "type": command_type,
                "requestId": "stale",
                "fingerprint": "stale",
                "departureIndex": 0,
                "transferTimeIndex": 0,
            }
            self.extension.command(self.conn, command)
        payload = self.extension.gather(self.conn)

        self.assertEqual(payload["mj.transfer.grid.requestId"], "")
        self.assertEqual(payload["mj.transfer.evaluation.requestId"], "")

    def test_transfer_window_board_serializes_live_primary_planets(self):
        with patch.object(planning, "_body_catalog", return_value=transfer_window_catalog()):
            self.extension.command(self.conn, transfer_windows_command())

        self.assertEqual(self.conn.planner.started, [
            ("Kerbin", "Duna", 80_000.0, True),
        ])
        for index, destination in enumerate(("Duna", "Eve", "Sarnus"), start=1):
            planner = self.conn.planner
            planner.state = "completed"
            planner.progress = 100
            planner.best_departure_ut = 100_000.0 * index
            planner.best_arrival_ut = 100_000.0 * index + 50_000.0
            planner.best_transfer_time = 50_000.0
            planner.best_ejection_delta_v = 1_000.0 + index
            planner.best_arrival_v_infinity = 700.0 + index
            planner.best_total_delta_v = 1_700.0 + index
            payload = self.extension.gather(self.conn)
            self.assertEqual(
                payload["mj.transfer.windows.completedCount"], index
            )
            self.assertEqual(
                payload["mj.transfer.windows.results"][-1]["destination"],
                destination,
            )

        self.assertEqual(payload["mj.transfer.windows.state"], "completed")
        self.assertEqual(
            [row["destination"] for row in payload["mj.transfer.windows.results"]],
            ["Duna", "Eve", "Sarnus"],
        )
        self.assertEqual(self.conn.planner.started, [
            ("Kerbin", "Duna", 80_000.0, True),
            ("Kerbin", "Eve", 80_000.0, True),
            ("Kerbin", "Sarnus", 80_000.0, True),
        ])

    def test_transfer_window_board_waits_for_interactive_release(self):
        self.extension.command(self.conn, start_command())
        self.conn.planner.state = "completed"
        self.extension.gather(self.conn)

        with patch.object(planning, "_body_catalog", return_value=transfer_window_catalog()):
            self.extension.command(self.conn, transfer_windows_command())
        paused = self.extension.gather(self.conn)

        self.assertEqual(paused["mj.transfer.windows.state"], "paused")
        self.assertIn("Interactive", paused["mj.transfer.windows.pauseReason"])
        self.assertEqual(len(self.conn.planner.started), 1)

        self.extension.command(self.conn, {
            "type": "mechjeb.transfer.release",
            "requestId": "request-1",
        })
        running = self.extension.gather(self.conn)

        self.assertEqual(running["mj.transfer.windows.state"], "running")
        self.assertEqual(self.conn.planner.started[-1], (
            "Kerbin", "Duna", 80_000.0, True,
        ))

    def test_cancelling_paused_board_never_cancels_interactive_planner(self):
        self.extension.command(self.conn, start_command())
        with patch.object(planning, "_body_catalog", return_value=transfer_window_catalog()):
            self.extension.command(self.conn, transfer_windows_command())

        self.extension.command(self.conn, {
            "type": "mechjeb.transfer.windows.cancel",
            "requestId": "windows-1",
        })
        payload = self.extension.gather(self.conn)

        self.assertEqual(payload["mj.transfer.windows.state"], "cancelled")
        self.assertEqual(self.conn.planner.cancel_count, 0)
        self.assertEqual(payload["mj.transfer.state"], "running")

    def test_transfer_window_board_waits_for_external_mechjeb_work(self):
        for busy_state in ("running", "cancelling"):
            with self.subTest(busy_state=busy_state):
                extension = ControllerHarness()
                planner = FakePlanner(state=busy_state)
                conn = FakeConnection(planner)
                with patch.object(planning, "_body_catalog", return_value=transfer_window_catalog()):
                    extension.command(conn, transfer_windows_command())
                paused = extension.gather(conn)

                self.assertEqual(paused["mj.transfer.windows.state"], "paused")
                self.assertIn("already in use", paused["mj.transfer.windows.pauseReason"])
                self.assertEqual(planner.started, [])

                planner.state = "completed"
                running = extension.gather(conn)

                self.assertEqual(running["mj.transfer.windows.state"], "running")
                self.assertEqual(planner.started, [(
                    "Kerbin", "Duna", 80_000.0, True,
                )])

    def test_transfer_window_refresh_reports_unavailable_service(self):
        conn = FakeConnection(FakePlanner(available=False))
        with patch.object(planning, "_body_catalog", return_value=transfer_window_catalog()):
            self.extension.command(conn, transfer_windows_command())
        payload = self.extension.gather(conn)

        self.assertEqual(payload["mj.transfer.windows.state"], "failed")
        self.assertIn("unavailable", payload["mj.transfer.windows.error"].lower())
        self.assertEqual(conn.planner.started, [])


if __name__ == "__main__":
    unittest.main()
