import unittest

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
        self.assertEqual(result["tar.distance"], 12.0)
        self.assertEqual(result["tar.o.relativeVelocity"], 5.0)
        self.assertIs(target_part.velocity_reference_frame, reference_frame)

    def test_docking_port_keeps_part_velocity_when_vessel_name_is_unavailable(self):
        target_part = _TargetPart(None, (0.0, 0.0, 1.5))
        target_port = _DockingPort(target_part, (0.0, 2.0, 0.0))

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


if __name__ == "__main__":
    unittest.main()
