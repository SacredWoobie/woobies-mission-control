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
        self.editor = mock_feed.SCENES["editor"]

    def test_all_system_heat_loops_have_expandable_component_details(self):
        loops = self.flight["heat.loops"]

        self.assertEqual({loop["id"] for loop in loops}, {"0", "1", "2"})
        self.assertEqual(self.flight["heat.backend"], "system_heat")
        self.assertEqual(self.flight["heat.systemHeatStatus"], "known")
        for loop in loops:
            self.assertGreater(len(loop["producers"]), 0)
            self.assertGreater(len(loop["radiators"]), 0)

        states = {loop["id"]: loop["radiatorState"] for loop in loops}
        self.assertEqual(states, {"0": "deploying", "1": "online", "2": "broken"})
        self.assertTrue(all(not loop["radiatorControlAvailable"] for loop in loops))

    def test_flight_staging_stresses_eight_powered_rows(self):
        stages = self.flight["stage.stages"]

        self.assertEqual(len(stages), 8)
        self.assertEqual([stage["ksp"] for stage in stages], [0, 2, 3, 5, 6, 7, 8, 9])
        self.assertEqual(self.flight["stage.count"], 10)
        self.assertEqual(self.flight["stage.unpoweredCount"], 2)
        self.assertEqual(self.flight["stage.currentKsp"], 9)
        self.assertEqual(self.flight["stage.totalDvAtmo"], 4460)
        self.assertEqual(self.flight["stage.totalDvVac"], 5470)
        self.assertEqual(self.flight["stage.totalBurnSeconds"], 335)

    def test_editor_reuses_the_dense_staged_craft(self):
        self.assertIs(
            self.editor["stage.stages"],
            self.flight["stage.stages"],
        )
        self.assertEqual(self.editor["editor.stageCount"], 10)
        self.assertEqual(self.editor["stage.count"], 10)
        self.assertEqual(self.editor["stage.unpoweredCount"], 2)
        self.assertEqual(self.editor["stage.currentKsp"], 9)
        self.assertEqual(self.editor["stage.totalDvAtmo"], 4460)
        self.assertEqual(self.editor["stage.totalDvVac"], 5470)
        self.assertEqual(self.editor["stage.totalBurnSeconds"], 335)
        self.assertTrue(self.editor["identity.available"])
        self.assertEqual(self.editor["game.saveFolder"], "WMC Fixture Save")
        self.assertEqual(self.editor["editor.craftPersistentId"], "9001")
        self.assertEqual(self.editor["editor.rootPartPersistentId"], "1001")

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
