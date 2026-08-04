import unittest

from telemetry_server import _gather_reactors


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


class ReactorTelemetryTests(unittest.TestCase):
    def test_legacy_service_defaults_to_fission_contract(self):
        reactor = _gather_reactors(LegacyFissionService())[0]

        self.assertEqual(reactor["family"], "fission")
        self.assertTrue(reactor["hasIntegrity"])
        self.assertEqual(reactor["integrity"], 100.0)
        self.assertEqual(reactor["ecPerSec"], 62.5)

    def test_fusion_omits_integrity_and_preserves_small_fuel_rate(self):
        reactor = _gather_reactors(FusionService())[0]

        self.assertEqual(reactor["family"], "fusion")
        self.assertFalse(reactor["hasIntegrity"])
        self.assertNotIn("integrity", reactor)
        self.assertEqual(reactor["fuel"], "0.00000027 u/s")
        self.assertEqual(reactor["throttle"], 2.5)


if __name__ == "__main__":
    unittest.main()
