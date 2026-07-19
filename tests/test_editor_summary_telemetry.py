import unittest

import telemetry_server


class SummaryService:
    editor_part_count = 31
    editor_crew_capacity = 3
    editor_stage_count = 4
    editor_wet_mass = 18.742
    editor_dry_mass = 7.416
    editor_resource_mass = 11.326
    editor_total_cost = 42580
    editor_dry_cost = 39740
    editor_resource_cost = 2840

    def editor_resource_names(self):
        return ["LiquidFuel", "ElectricCharge", "StealBackMyFunds"]

    def editor_resource_amounts(self):
        return [810, 1200, 999]

    def editor_resource_capacities(self):
        return [810, 1200, 999]


class EditorSummaryTelemetryTests(unittest.TestCase):
    def test_maps_summary_and_filters_internal_resources(self):
        result = telemetry_server._gather_editor_summary(SummaryService())

        self.assertTrue(result["editor.summaryAvailable"])
        self.assertEqual(result["editor.partCount"], 31)
        self.assertEqual(result["editor.crewCapacity"], 3)
        self.assertEqual(result["editor.stageCount"], 4)
        self.assertAlmostEqual(result["editor.wetMass"], 18.742)
        self.assertEqual(
            result["editor.res.names"],
            ["LiquidFuel", "ElectricCharge"],
        )
        self.assertEqual(result["editor.res[LiquidFuel]"], 810)
        self.assertNotIn("editor.res[StealBackMyFunds]", result)

    def test_marks_mismatched_parallel_resource_arrays_unavailable(self):
        service = SummaryService()
        service.editor_resource_amounts = lambda: [810]

        self.assertEqual(
            telemetry_server._gather_editor_summary(service),
            {"editor.summaryAvailable": False},
        )


if __name__ == "__main__":
    unittest.main()
