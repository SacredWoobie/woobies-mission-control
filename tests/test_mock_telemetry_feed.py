import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "scripts" / "mock_telemetry_server.py"
SPEC = importlib.util.spec_from_file_location("mock_telemetry_feed", SERVER)
mock_feed = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mock_feed)


class FlightMockTelemetryTests(unittest.TestCase):
    def setUp(self):
        self.flight = mock_feed.SCENES["flight"]

    def test_all_system_heat_loops_have_expandable_component_details(self):
        loops = self.flight["heat.loops"]

        self.assertEqual({loop["id"] for loop in loops}, {"0", "1", "2"})
        self.assertEqual(self.flight["heat.backend"], "system_heat")
        self.assertEqual(self.flight["heat.systemHeatStatus"], "known")
        for loop in loops:
            self.assertGreater(len(loop["producers"]), 0)
            self.assertGreater(len(loop["radiators"]), 0)

    def test_reactor_inventory_has_two_fission_and_one_fusion_reactor(self):
        reactors = self.flight["elec.reactors"]

        self.assertEqual(len(reactors), 3)
        self.assertEqual(self.flight["elec.reactorsStatus"], "known")
        self.assertEqual(
            [reactor["family"] for reactor in reactors].count("fission"), 2
        )
        self.assertEqual(
            [reactor["family"] for reactor in reactors].count("fusion"), 1
        )
        self.assertEqual(
            len({reactor["partId"] for reactor in reactors}), len(reactors)
        )

    def test_consumables_include_nuclear_cryo_and_ore_stress_data(self):
        expected = {"EnrichedUranium", "LqdDeuterium", "Ore", "DepletedFuel"}

        self.assertTrue(expected.issubset(self.flight["res.names"]))
        for resource in expected:
            self.assertGreater(self.flight[f"r.resourceMax[{resource}]"], 0)
            self.assertGreaterEqual(self.flight[f"r.resource[{resource}]"], 0)


if __name__ == "__main__":
    unittest.main()
