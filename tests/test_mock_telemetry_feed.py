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
        self.inactive = mock_feed.SCENES["inactive"]

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

    def test_editor_fixture_has_electrical_planner_snapshot(self):
        components = self.editor["editor.elec.components"]
        producers = [component for component in components if component["role"] == "producer"]
        consumers = [component for component in components if component["role"] == "consumer"]
        enabled_producers = [component for component in producers if component["defaultIncluded"]]
        enabled_consumers = [component for component in consumers if component["defaultIncluded"]]

        self.assertEqual(self.editor["editor.elec.status"], "ready")
        self.assertEqual(self.editor["editor.elec.backend"], "stock")
        self.assertFalse(self.editor["editor.elec.pending"])
        self.assertEqual(self.editor["editor.elec.currentEc"], 1200)
        self.assertEqual(self.editor["editor.elec.maxEc"], 1200)
        self.assertEqual((len(producers), len(consumers)), (4, 7))
        self.assertEqual((len(enabled_producers), len(enabled_consumers)), (3, 5))
        self.assertEqual(len({component["stableId"] for component in components}), len(components))
        self.assertEqual(
            round(sum(component["referenceEcPerSec"] * 0.962 for component in enabled_producers if component["solarScaled"])
                  + sum(component["referenceEcPerSec"] for component in enabled_producers if not component["solarScaled"]), 2),
            3.90,
        )
        self.assertEqual(round(sum(component["referenceEcPerSec"] for component in enabled_consumers), 2), 1.31)
        self.assertEqual(
            {component["partTitle"] for component in components if not component["defaultIncluded"]},
            {"Fuel Cell Array", "IX-6315 Ion Engine ×2", "Communotron HG-55 (transmitting)"},
        )
        self.assertTrue(all(component["solarScaled"] and not component["continuous"] for component in producers[:2]))
        self.assertTrue(producers[2]["continuous"])
        self.assertFalse(producers[2]["solarScaled"])
        self.assertTrue(self.editor["editor.elec.bodies"][0]["authoritative"])
        self.assertIn("gravitationalParameter", self.editor["editor.elec.bodies"][0])
        self.assertIn("atmosphereDepth", self.editor["editor.elec.bodies"][0])
        self.assertIn("sphereOfInfluence", self.editor["editor.elec.bodies"][0])

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

    def test_flight_damage_fixture_identifies_grouped_broken_parts(self):
        parts = self.flight["damage.parts"]

        self.assertEqual(self.flight["damage.status"], "known")
        self.assertEqual(self.flight["damage.source"], "vessel_damage")
        self.assertEqual(self.flight["damage.damagedCount"], 36)
        self.assertEqual(
            {(part["kind"], part["count"]) for part in parts},
            {("antenna", 24), ("radiator", 12)},
        )
        self.assertEqual(self.flight["damage.unsupportedKinds"], [])

    def test_consumables_include_nuclear_cryo_and_ore_stress_data(self):
        expected = {"EnrichedUranium", "LqdDeuterium", "Ore", "DepletedFuel"}

        self.assertTrue(expected.issubset(self.flight["res.names"]))
        for resource in expected:
            self.assertGreater(self.flight[f"r.resourceMax[{resource}]"], 0)
            self.assertGreaterEqual(self.flight[f"r.resource[{resource}]"], 0)

    def test_inactive_scene_has_a_completed_transfer_window_board(self):
        windows = self.inactive["mj.transfer.windows.results"]

        self.assertTrue(self.inactive["mj.transfer.available"])
        self.assertTrue(self.inactive["mj.transfer.compatibilityReady"])
        self.assertEqual(self.inactive["mj.transfer.windows.state"], "completed")
        self.assertEqual(self.inactive["mj.transfer.windows.origin"], "Kerbin")
        self.assertEqual(len(windows), 9)
        self.assertEqual(
            {window["destination"] for window in windows},
            {"Moho", "Duna", "Dres", "Neidon", "Urlum", "Eve", "Jool", "Plock", "Sarnus"},
        )


if __name__ == "__main__":
    unittest.main()
