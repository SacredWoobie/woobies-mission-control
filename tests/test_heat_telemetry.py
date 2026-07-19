import unittest
from types import SimpleNamespace

import telemetry_server


class HeatTelemetryTests(unittest.TestCase):
    def test_prefers_system_heat_and_preserves_kilowatts(self):
        system_heat = SimpleNamespace(
            available=True,
            loop_ids=lambda: [1],
            loop_temperature=lambda _loop: 612.4,
            loop_positive_flux=lambda _loop: 184.2,
            loop_removed_flux=lambda _loop: 201.6,
            total_heat_generation=184.2,
            total_heat_rejection=-201.6,
        )
        result = telemetry_server._gather_heat(SimpleNamespace(system_heat=system_heat))
        self.assertEqual(result["heat.backend"], "system_heat")
        self.assertEqual(result["heat.generatedKw"], 184.2)
        self.assertNotIn("heat.generatedW", result)

    def test_falls_back_to_stock_watts_when_system_heat_has_no_loops(self):
        system_heat = SimpleNamespace(available=True, loop_ids=lambda: [])
        stock = SimpleNamespace(
            available=True,
            part_names=lambda: ["Nose Cone", "Engine"],
            part_temperatures=lambda: [410.0, 360.0],
            part_max_temperatures=lambda: [1200.0, 2000.0],
            part_skin_temperatures=lambda: [920.0, 440.0],
            part_max_skin_temperatures=lambda: [1000.0, 2000.0],
            part_utilizations=lambda: [92.0, 22.0],
            part_net_watts=lambda: [125.4, -18.0],
            generated_watts=410.3,
            removed_watts=203.1,
            net_watts=207.2,
        )
        result = telemetry_server._gather_heat(SimpleNamespace(
            system_heat=system_heat,
            stock_thermal=stock,
        ))
        self.assertEqual(result["heat.backend"], "stock")
        self.assertEqual(result["heat.generatedW"], 410.3)
        self.assertEqual(result["heat.parts"][0]["name"], "Nose Cone")
        self.assertNotIn("heat.generatedKw", result)

    def test_falls_back_when_system_heat_service_is_missing(self):
        stock = SimpleNamespace(
            available=True,
            part_names=lambda: [], part_temperatures=lambda: [],
            part_max_temperatures=lambda: [], part_skin_temperatures=lambda: [],
            part_max_skin_temperatures=lambda: [], part_utilizations=lambda: [],
            part_net_watts=lambda: [], generated_watts=0.0,
            removed_watts=0.0, net_watts=0.0,
        )
        result = telemetry_server._gather_heat(SimpleNamespace(stock_thermal=stock))
        self.assertEqual(result["heat.backend"], "stock")


if __name__ == "__main__":
    unittest.main()
