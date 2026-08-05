import unittest
from types import SimpleNamespace

import telemetry_server


class FakeSystemHeat:
    def __init__(self, *, action="start", part_ids=None):
        self.action = action
        self.part_ids = list(part_ids or [101, 202])
        self.calls = []

    def loop_ids(self):
        return [0, 1]

    def loop_radiator_part_ids(self, loop_id):
        return list(self.part_ids)

    def loop_radiator_control_action(self, loop_id):
        return self.action

    def loop_radiator_start(self, loop_id):
        self.calls.append(("start", loop_id))
        return True

    def loop_radiator_stop(self, loop_id):
        self.calls.append(("stop", loop_id))
        return True


def fake_connection(service, vessel_guid="vessel-1"):
    return SimpleNamespace(
        krpc=SimpleNamespace(
            current_game_scene="flight",
            GameScene=SimpleNamespace(flight="flight"),
        ),
        stage_stats=SimpleNamespace(
            game_save_folder="default",
            vessel_guid=vessel_guid,
            vessel_persistent_id=1,
            vessel_root_part_persistent_id=101,
            vessel_part_persistent_ids=lambda: [101, 202],
        ),
        system_heat=service,
    )


def command(**changes):
    value = {
        "type": "heat.loop.control",
        "requestId": "heat-loop-1",
        "loopId": 1,
        "action": "start",
        "expectedVesselGuid": "vessel-1",
        "expectedRadiatorPartIds": [202, 101],
    }
    value.update(changes)
    return value


class HeatLoopControlTests(unittest.TestCase):
    def test_accepts_matching_live_identity_membership_and_action(self):
        service = FakeSystemHeat()

        result = telemetry_server._apply_telemetry_command(
            fake_connection(service), command()
        )

        self.assertEqual(result["status"], "accepted")
        self.assertEqual(result["loopId"], 1)
        self.assertEqual(service.calls, [("start", 1)])

    def test_rejects_stale_vessel_before_native_call(self):
        service = FakeSystemHeat()

        result = telemetry_server._apply_telemetry_command(
            fake_connection(service, vessel_guid="vessel-2"), command()
        )

        self.assertEqual(result["status"], "error")
        self.assertIn("active vessel changed", result["message"])
        self.assertEqual(service.calls, [])

    def test_rejects_changed_radiator_membership_before_native_call(self):
        service = FakeSystemHeat(part_ids=[101, 303])

        result = telemetry_server._apply_telemetry_command(
            fake_connection(service), command()
        )

        self.assertEqual(result["status"], "error")
        self.assertIn("assigned to this loop changed", result["message"])
        self.assertEqual(service.calls, [])

    def test_rejects_changed_action_before_native_call(self):
        service = FakeSystemHeat(action="stop")

        result = telemetry_server._apply_telemetry_command(
            fake_connection(service), command()
        )

        self.assertEqual(result["status"], "error")
        self.assertIn("radiator state changed", result["message"])
        self.assertEqual(service.calls, [])

    def test_accepts_full_signed_system_heat_loop_id_range(self):
        service = FakeSystemHeat()
        service.loop_ids = lambda: [0x7FFFFFFF]

        result = telemetry_server._apply_telemetry_command(
            fake_connection(service),
            command(loopId=0x7FFFFFFF),
        )

        self.assertEqual(result["status"], "accepted")
        self.assertEqual(service.calls, [("start", 0x7FFFFFFF)])


if __name__ == "__main__":
    unittest.main()
