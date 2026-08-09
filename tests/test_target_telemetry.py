import unittest
from unittest import mock

import telemetry_server


class _Object:
    pass


class _TargetPart:
    def __init__(self, vessel, velocity):
        self.vessel = vessel
        self._velocity = velocity
        self.velocity_reference_frame = None

    def velocity(self, reference_frame):
        self.velocity_reference_frame = reference_frame
        return self._velocity


class _DockingPort:
    def __init__(self, part, position):
        self.part = part
        self._position = position

    def position(self, _reference_frame):
        return self._position


class TargetTelemetryTests(unittest.TestCase):
    def test_docking_port_uses_vessel_name_and_part_relative_velocity(self):
        target_vessel = _Object()
        target_vessel.name = "Odyssey Station"
        target_vessel.orbit = None
        target_part = _TargetPart(target_vessel, (3.0, 4.0, 0.0))
        target_port = _DockingPort(target_part, (0.0, 0.0, 12.0))
        target_port._object_id = 8080

        space_center = _Object()
        space_center.target_docking_port = target_port
        space_center.target_vessel = target_vessel
        space_center.target_body = None
        connection = _Object()
        connection.space_center = space_center

        reference_frame = object()
        active_vessel = _Object()
        active_vessel.reference_frame = reference_frame
        active_vessel.parts = _Object()
        active_vessel.parts.controlling = None

        result = telemetry_server._gather_target(connection, active_vessel)

        self.assertEqual(result["tar.name"], "Odyssey Station Docking Port")
        self.assertEqual(result["tar.type"], "dockingport")
        self.assertEqual(result["tar.objectId"], "8080")
        self.assertEqual(result["tar.distance"], 12.0)
        self.assertEqual(result["tar.o.relativeVelocity"], 5.0)
        self.assertIs(target_part.velocity_reference_frame, reference_frame)

    def test_docking_port_keeps_part_velocity_when_vessel_name_is_unavailable(self):
        target_part = _TargetPart(None, (0.0, 0.0, 1.5))
        target_port = _DockingPort(target_part, (0.0, 2.0, 0.0))
        target_port._object_id = 9090

        space_center = _Object()
        space_center.target_docking_port = target_port
        space_center.target_vessel = None
        space_center.target_body = None
        connection = _Object()
        connection.space_center = space_center

        active_vessel = _Object()
        active_vessel.reference_frame = object()
        active_vessel.parts = _Object()
        active_vessel.parts.controlling = None

        result = telemetry_server._gather_target(connection, active_vessel)

        self.assertEqual(result["tar.name"], "Docking Port")
        self.assertEqual(result["tar.distance"], 2.0)
        self.assertEqual(result["tar.o.relativeVelocity"], 1.5)

    def test_clear_target_accepts_exact_vessel_and_target_identity(self):
        target = _Object()
        target._object_id = 1212
        space_center = _Object()
        space_center.target_docking_port = None
        space_center.target_vessel = None
        space_center.target_body = target
        space_center.clear_target = mock.Mock()

        krpc = _Object()
        krpc.GameScene = _Object()
        krpc.GameScene.flight = "flight"
        krpc.game_scene = "flight"
        connection = _Object()
        connection.krpc = krpc
        connection.space_center = space_center

        command = {
            "type": "target.clear",
            "requestId": "clear-1",
            "expectedVesselGuid": "vessel-guid",
            "expectedTargetObjectId": "1212",
            "expectedTargetName": "Slate",
            "expectedTargetType": "body",
        }
        with mock.patch.object(
            telemetry_server._mission_planning,
            "current_craft_identity",
            return_value={"v.guid": "vessel-guid"},
        ):
            result = telemetry_server._apply_telemetry_command(connection, command)

        self.assertEqual(result, {
            "type": "target.clear.result",
            "requestId": "clear-1",
            "status": "accepted",
            "message": "Target Slate cleared.",
        })
        space_center.clear_target.assert_called_once_with()

    def test_clear_target_rejects_a_stale_target_without_mutating_ksp(self):
        target = _Object()
        target._object_id = 3434
        space_center = _Object()
        space_center.target_docking_port = None
        space_center.target_vessel = target
        space_center.target_body = None
        space_center.clear_target = mock.Mock()

        krpc = _Object()
        krpc.GameScene = _Object()
        krpc.GameScene.flight = "flight"
        krpc.game_scene = "flight"
        connection = _Object()
        connection.krpc = krpc
        connection.space_center = space_center

        command = {
            "type": "target.clear",
            "requestId": "clear-stale",
            "expectedVesselGuid": "vessel-guid",
            "expectedTargetObjectId": "1212",
            "expectedTargetName": "Old target",
            "expectedTargetType": "vessel",
        }
        with mock.patch.object(
            telemetry_server._mission_planning,
            "current_craft_identity",
            return_value={"v.guid": "vessel-guid"},
        ):
            result = telemetry_server._apply_telemetry_command(connection, command)

        self.assertEqual(result["status"], "error")
        self.assertIn("target changed", result["message"])
        space_center.clear_target.assert_not_called()


if __name__ == "__main__":
    unittest.main()
