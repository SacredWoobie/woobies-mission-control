import unittest
from types import SimpleNamespace

from telemetry_server import _apply_reactor_control_command, _gather_reactors


class LegacyFissionService:
    def reactor_count(self):
        return 1

    def reactor_name(self, _index):
        return "MX-0 Fission Reactor"

    def reactor_enabled(self, _index):
        return True

    def reactor_status(self, _index):
        return "Nominal"

    def reactor_electrical_generation(self, _index):
        return 62.501

    def reactor_max_electrical_generation(self, _index):
        return 62.5

    def reactor_core_temperature(self, _index):
        return 850.04

    def reactor_nominal_temperature(self, _index):
        return 850

    def reactor_core_integrity(self, _index):
        return 99.96

    def reactor_fuel_status(self, _index):
        return "10y"

    def reactor_throttle(self, _index):
        return 100


class FusionService(LegacyFissionService):
    def reactor_family(self, _index):
        return "fusion"

    def reactor_core_integrity_available(self, _index):
        return False

    def reactor_name(self, _index):
        return "FX-2 Fusion Reactor"

    def reactor_electrical_generation(self, _index):
        return 100

    def reactor_max_electrical_generation(self, _index):
        return 4_000

    def reactor_core_temperature(self, _index):
        return 1_600

    def reactor_nominal_temperature(self, _index):
        return 1_600

    def reactor_core_integrity(self, _index):
        raise AssertionError("fusion must not fabricate fission integrity")

    def reactor_fuel_status(self, _index):
        return "0.00000027 u/s"

    def reactor_throttle(self, _index):
        return 2.5


class FusionLifeService(FusionService):
    def reactor_part_id(self, _index):
        return 101

    def reactor_fuel_life_status(self, _index):
        return "112y 4d 3h 2m"

    def reactor_fuel_rate_status(self, _index):
        return "LqdDeuterium 0.00000027 u/s"

    def reactor_fuel_limiting_resource(self, _index):
        return "LqdDeuterium"

    def reactor_control_action(self, _index):
        return "stop"

    def reactor_charge_state(self, _index):
        return "running"

    def reactor_charge_percent(self, _index):
        return 0


class ChargingFusionService(FusionLifeService):
    def reactor_enabled(self, _index):
        return False

    def reactor_status(self, _index):
        return "Charging"

    def reactor_control_action(self, _index):
        return "stop_charging"

    def reactor_charge_state(self, _index):
        return "charging"

    def reactor_charge_percent(self, _index):
        return 37.54


class ReactorCommandService:
    def __init__(self, action="start_charging", part_id=101):
        self.action = action
        self.part_id = part_id
        self.calls = []

    def reactor_count(self):
        return 1

    def reactor_name(self, _index):
        return "FX-2 Fusion Reactor"

    def reactor_family(self, _index):
        return "fusion"

    def reactor_part_id(self, _index):
        return self.part_id

    def reactor_control_action(self, _index):
        return self.action

    def reactor_start(self, index):
        self.calls.append(("start", index))
        return True

    def reactor_stop(self, index):
        self.calls.append(("stop", index))
        return True

    def reactor_start_charging(self, index):
        self.calls.append(("start_charging", index))
        return True

    def reactor_stop_charging(self, index):
        self.calls.append(("stop_charging", index))
        return True


def reactor_command_connection(service, vessel_id="vessel-1"):
    game_scene = SimpleNamespace(flight="flight")
    return SimpleNamespace(
        krpc=SimpleNamespace(
            current_game_scene="flight",
            GameScene=game_scene,
        ),
        space_center=SimpleNamespace(
            active_vessel=SimpleNamespace(),
        ),
        stage_stats=SimpleNamespace(
            game_save_folder="default",
            vessel_guid=vessel_id,
            vessel_persistent_id=1,
            vessel_root_part_persistent_id=101,
            vessel_part_persistent_ids=lambda: [101],
        ),
        system_heat=service,
    )


class ReactorTelemetryTests(unittest.TestCase):
    def test_legacy_service_defaults_to_fission_contract(self):
        reactor = _gather_reactors(LegacyFissionService())[0]

        self.assertEqual(reactor["family"], "fission")
        self.assertTrue(reactor["hasIntegrity"])
        self.assertEqual(reactor["integrity"], 100.0)
        self.assertEqual(reactor["ecPerSec"], 62.5)
        self.assertNotIn("controlAction", reactor)

    def test_fusion_omits_integrity_and_preserves_small_fuel_rate(self):
        reactor = _gather_reactors(FusionService())[0]

        self.assertEqual(reactor["family"], "fusion")
        self.assertFalse(reactor["hasIntegrity"])
        self.assertNotIn("integrity", reactor)
        self.assertEqual(reactor["fuel"], "0.00000027 u/s")
        self.assertEqual(reactor["fuelKind"], "rate")
        self.assertEqual(reactor["throttle"], 2.5)

    def test_fusion_prefers_life_and_keeps_itemized_rate_detail(self):
        reactor = _gather_reactors(FusionLifeService())[0]

        self.assertEqual(reactor["fuel"], "112y 4d 3h 2m")
        self.assertEqual(reactor["fuelKind"], "life")
        self.assertEqual(
            reactor["fuelRate"], "LqdDeuterium 0.00000027 u/s"
        )
        self.assertEqual(reactor["fuelLimitingResource"], "LqdDeuterium")
        self.assertEqual(reactor["chargeState"], "running")
        self.assertEqual(reactor["controlAction"], "stop")

    def test_fusion_charging_exposes_progress_and_pause_action(self):
        reactor = _gather_reactors(ChargingFusionService())[0]

        self.assertFalse(reactor["on"])
        self.assertEqual(reactor["chargeState"], "charging")
        self.assertEqual(reactor["chargePercent"], 37.5)
        self.assertEqual(reactor["controlAction"], "stop_charging")

    def test_reactor_command_uses_stage_stats_identity_when_vessel_has_no_id(self):
        service = ReactorCommandService()
        result = _apply_reactor_control_command(
            reactor_command_connection(service),
            {
                "type": "reactor.control",
                "requestId": "reactor-1",
                "index": 0,
                "action": "start_charging",
                "expectedName": "FX-2 Fusion Reactor",
                "expectedFamily": "fusion",
                "expectedPartId": 101,
                "expectedVesselGuid": "vessel-1",
            },
        )

        self.assertEqual(result["status"], "accepted")
        self.assertEqual(service.calls, [("start_charging", 0)])

    def test_reactor_command_rejects_stale_vessel_and_state(self):
        service = ReactorCommandService(action="start")
        stale_vessel = _apply_reactor_control_command(
            reactor_command_connection(service, vessel_id="vessel-2"),
            {
                "type": "reactor.control",
                "requestId": "reactor-2",
                "index": 0,
                "action": "start",
                "expectedName": "FX-2 Fusion Reactor",
                "expectedFamily": "fusion",
                "expectedPartId": 101,
                "expectedVesselGuid": "vessel-1",
            },
        )
        stale_state = _apply_reactor_control_command(
            reactor_command_connection(service),
            {
                "type": "reactor.control",
                "requestId": "reactor-3",
                "index": 0,
                "action": "stop_charging",
                "expectedName": "FX-2 Fusion Reactor",
                "expectedFamily": "fusion",
                "expectedPartId": 101,
                "expectedVesselGuid": "vessel-1",
            },
        )

        self.assertEqual(stale_vessel["status"], "error")
        self.assertIn("active vessel changed", stale_vessel["message"])
        self.assertEqual(stale_state["status"], "error")
        self.assertIn("reactor state changed", stale_state["message"])
        self.assertEqual(service.calls, [])

    def test_reactor_command_rejects_duplicate_name_after_index_reorder(self):
        service = ReactorCommandService(part_id=202)
        result = _apply_reactor_control_command(
            reactor_command_connection(service),
            {
                "type": "reactor.control",
                "requestId": "reactor-4",
                "index": 0,
                "action": "start_charging",
                "expectedName": "FX-2 Fusion Reactor",
                "expectedFamily": "fusion",
                "expectedPartId": 101,
                "expectedVesselGuid": "vessel-1",
            },
        )

        self.assertEqual(result["status"], "error")
        self.assertIn("reactor identity changed", result["message"])
        self.assertEqual(service.calls, [])


if __name__ == "__main__":
    unittest.main()
