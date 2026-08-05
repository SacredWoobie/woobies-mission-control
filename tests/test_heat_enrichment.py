import importlib.util
import math
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "heat.py"

spec = importlib.util.spec_from_file_location("heat_extension", EXTENSION)
heat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(heat)


class FakeSystemHeat:
    def loop_nominal_temperature(self, loop_id):
        return {1: 800.04, 2: 1_200.0}[loop_id]

    def loop_net_flux(self, loop_id):
        return {1: 60.004, 2: -35.125}[loop_id]

    def loop_has_radiators(self, loop_id):
        return loop_id == 1

    def loop_radiator_part_ids(self, loop_id):
        return {1: [10], 2: []}[loop_id]

    def loop_radiator_state(self, loop_id):
        return {1: "online", 2: "unavailable"}[loop_id]

    def loop_radiator_control_action(self, loop_id):
        return {1: "stop", 2: ""}[loop_id]

    def loop_component_part_names(self, loop_id):
        return {
            1: [
                "MN-1 SNAK Fission Reactor",
                "MN-1 SNAK Fission Reactor",
                "GR-1 Drill",
                "GR-1 Drill",
            ],
            2: [],
        }[loop_id]

    def loop_component_part_ids(self, loop_id):
        return {1: [10, 10, 20, 21], 2: []}[loop_id]

    def loop_component_module_names(self, loop_id):
        return {
            1: [
                "ModuleSystemHeatFissionReactor",
                "ModuleSystemHeatRadiator",
                "ModuleSystemHeatHarvester",
                "ModuleSystemHeatHarvester",
            ],
            2: [],
        }[loop_id]

    def loop_component_roles(self, loop_id):
        return {
            1: ["producer", "radiator", "producer", "producer"],
            2: [],
        }[loop_id]

    def loop_component_fluxes(self, loop_id):
        return {1: [120.0, 0.0, 47.5, 47.5], 2: []}[loop_id]


class HeatExtensionTests(unittest.TestCase):
    def test_enriches_each_loop_without_changing_aggregate_fields(self):
        result = {
            "heat.backend": "system_heat",
            "heat.generatedKw": 215.0,
            "heat.loops": [
                {"id": "1", "tempK": 771.0, "genKw": 215.0, "remKw": 155.0},
                {"id": "2", "tempK": 612.0, "genKw": 20.0, "remKw": 55.0},
            ],
        }

        enriched = heat.enrich_system_heat_result(FakeSystemHeat(), result)

        self.assertEqual(enriched["heat.generatedKw"], 215.0)
        self.assertEqual(enriched["heat.loops"][0]["nominalTempK"], 800.0)
        self.assertEqual(enriched["heat.loops"][0]["netKw"], 60.0)
        self.assertTrue(enriched["heat.loops"][0]["hasRadiators"])
        self.assertEqual(enriched["heat.loops"][0]["radiatorPartIds"], [10])
        self.assertEqual(enriched["heat.loops"][0]["radiatorState"], "online")
        self.assertEqual(
            enriched["heat.loops"][0]["radiatorControlAction"], "stop"
        )
        self.assertTrue(
            enriched["heat.loops"][0]["radiatorControlAvailable"]
        )
        self.assertEqual(
            enriched["heat.loops"][0]["producers"],
            [
                {
                    "name": "MN-1 SNAK Fission Reactor",
                    "role": "producer",
                    "moduleName": "ModuleSystemHeatFissionReactor",
                    "count": 1,
                    "fluxKw": 120.0,
                },
                {
                    "name": "GR-1 Drill",
                    "role": "producer",
                    "moduleName": "ModuleSystemHeatHarvester",
                    "count": 2,
                    "fluxKw": 95.0,
                },
            ],
        )
        self.assertEqual(
            enriched["heat.loops"][0]["radiators"],
            [
                {
                    "name": "MN-1 SNAK Fission Reactor",
                    "role": "radiator",
                    "moduleName": "ModuleSystemHeatRadiator",
                    "count": 1,
                    "fluxKw": 0.0,
                }
            ],
        )
        self.assertEqual(enriched["heat.loops"][1]["nominalTempK"], 1200.0)
        self.assertEqual(enriched["heat.loops"][1]["netKw"], -35.12)
        self.assertFalse(enriched["heat.loops"][1]["hasRadiators"])
        self.assertEqual(enriched["heat.loops"][1]["radiatorPartIds"], [])
        self.assertEqual(
            enriched["heat.loops"][1]["radiatorState"], "unavailable"
        )
        self.assertNotIn(
            "radiatorControlAction", enriched["heat.loops"][1]
        )

    def test_falls_back_to_collector_generation_and_removal(self):
        class LegacySystemHeat:
            pass

        result = {
            "heat.loops": [
                {"id": "3", "genKw": 10.25, "remKw": 12.5},
            ],
        }
        enriched = heat.enrich_system_heat_result(LegacySystemHeat(), result)
        self.assertEqual(enriched["heat.loops"][0]["netKw"], -2.25)
        self.assertNotIn("nominalTempK", enriched["heat.loops"][0])
        self.assertNotIn("hasRadiators", enriched["heat.loops"][0])
        self.assertNotIn("producers", enriched["heat.loops"][0])
        self.assertNotIn("radiators", enriched["heat.loops"][0])
        self.assertNotIn("radiatorPartIds", enriched["heat.loops"][0])
        self.assertNotIn("radiatorControlAction", enriched["heat.loops"][0])

    def test_omits_invalid_numeric_values(self):
        class InvalidSystemHeat:
            def loop_nominal_temperature(self, loop_id):
                return math.inf

            def loop_net_flux(self, loop_id):
                return math.nan

        result = {"heat.loops": [{"id": "4"}]}
        enriched = heat.enrich_system_heat_result(InvalidSystemHeat(), result)
        self.assertNotIn("nominalTempK", enriched["heat.loops"][0])
        self.assertNotIn("netKw", enriched["heat.loops"][0])

    def test_keeps_integrated_zero_flux_radiator_authoritative(self):
        result = {
            "heat.loops": [
                {"id": "1", "tempK": 288.0, "genKw": 0.0, "remKw": 0.0},
            ],
        }

        loop = heat.enrich_system_heat_result(FakeSystemHeat(), result)[
            "heat.loops"
        ][0]

        self.assertTrue(loop["hasRadiators"])
        self.assertEqual(loop["radiators"][0]["role"], "radiator")
        self.assertEqual(loop["radiators"][0]["fluxKw"], 0.0)

    def test_counts_multi_mode_harvesters_once_per_physical_part(self):
        class MultiModeDrills:
            def loop_component_part_names(self, loop_id):
                return ["Drill-O-Matic"] * 6

            def loop_component_part_ids(self, loop_id):
                return [101, 101, 101, 102, 102, 102]

            def loop_component_module_names(self, loop_id):
                return [
                    "ModuleSystemHeatHarvester",
                    "ModuleSystemHeatAsteroidHarvester",
                    "ModuleSystemHeatCometHarvester",
                ] * 2

            def loop_component_roles(self, loop_id):
                return ["producer"] * 6

            def loop_component_fluxes(self, loop_id):
                return [60.0, 0.0, 0.0, 60.0, 0.0, 0.0]

        result = {"heat.loops": [{"id": "1"}]}
        loop = heat.enrich_system_heat_result(MultiModeDrills(), result)[
            "heat.loops"
        ][0]

        self.assertEqual(
            loop["producers"],
            [
                {
                    "name": "Drill-O-Matic",
                    "role": "producer",
                    "count": 2,
                    "fluxKw": 120.0,
                }
            ],
        )

    def test_legacy_service_uses_largest_module_family_count(self):
        class LegacyMultiModeDrills:
            def loop_component_part_names(self, loop_id):
                return ["Drill-O-Matic"] * 6

            def loop_component_module_names(self, loop_id):
                return [
                    "ModuleSystemHeatHarvester",
                    "ModuleSystemHeatHarvester",
                    "ModuleSystemHeatAsteroidHarvester",
                    "ModuleSystemHeatAsteroidHarvester",
                    "ModuleSystemHeatCometHarvester",
                    "ModuleSystemHeatCometHarvester",
                ]

            def loop_component_roles(self, loop_id):
                return ["producer"] * 6

            def loop_component_fluxes(self, loop_id):
                return [60.0, 60.0, 0.0, 0.0, 0.0, 0.0]

        result = {"heat.loops": [{"id": "1"}]}
        loop = heat.enrich_system_heat_result(
            LegacyMultiModeDrills(), result
        )["heat.loops"][0]

        self.assertEqual(loop["producers"][0]["count"], 2)
        self.assertEqual(loop["producers"][0]["fluxKw"], 120.0)


if __name__ == "__main__":
    unittest.main()
