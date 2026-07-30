import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "staging.py"

spec = importlib.util.spec_from_file_location("staging_extension", EXTENSION)
staging = importlib.util.module_from_spec(spec)
spec.loader.exec_module(staging)


class FakeStageStats:
    def stage_ksp_stage(self, index):
        return [0, 2, 3][index]

    def stage_twr(self, index, vacuum):
        return [0.8, 0.0, 1.4][index]

    def stage_burnout_twr(self, index, vacuum):
        return [1.1, 0.0, 2.3][index]

    def stage_burn_time(self, index, vacuum):
        return [42.0, 0.0, 75.0][index]


class StagingExtensionTests(unittest.TestCase):
    def test_enriches_rows_and_derives_active_and_unpowered_counts(self):
        result = {
            "stage.currentKsp": 3,
            "stage.stages": [
                {"index": 0, "ksp": 0, "dvAtmo": 500.0, "dvVac": 650.0},
                {"index": 1, "ksp": 1, "dvAtmo": 0.0, "dvVac": 0.0},
                {"index": 2, "ksp": 2, "dvAtmo": 1000.0, "dvVac": 1200.0},
            ],
        }

        enriched = staging.enrich_stage_result(FakeStageStats(), result)

        self.assertEqual([row["ksp"] for row in enriched["stage.stages"]], [0, 2, 3])
        self.assertEqual(enriched["stage.stages"][0]["twrStart"], 0.8)
        self.assertEqual(enriched["stage.stages"][0]["twrEnd"], 1.1)
        self.assertEqual(enriched["stage.activeKsp"], 3)
        self.assertEqual(enriched["stage.unpoweredCount"], 1)
        self.assertEqual(enriched["stage.totalBurnSeconds"], 117.0)

    def test_legacy_service_derives_burnout_twr_from_mass_ratio(self):
        class LegacyStageStats:
            def stage_twr(self, index, vacuum):
                return 0.75

            def stage_start_mass(self, index, vacuum):
                return 12.0

            def stage_end_mass(self, index, vacuum):
                return 8.0

            def stage_burn_time(self, index, vacuum):
                return 30.0

        result = {
            "stage.currentKsp": 1,
            "stage.stages": [
                {"index": 0, "ksp": 0, "dvAtmo": 0.0, "dvVac": 0.0},
                {"index": 1, "ksp": 1, "dvAtmo": 900.0, "dvVac": 1000.0},
            ],
        }

        enriched = staging.enrich_stage_result(LegacyStageStats(), result)

        self.assertEqual(enriched["stage.stages"][1]["twrEnd"], 1.12)
        self.assertEqual(enriched["stage.activeKsp"], 1)
        self.assertEqual(enriched["stage.unpoweredCount"], 1)

    def test_uses_nearest_powered_stage_when_raw_current_is_unpowered(self):
        result = {
            "stage.currentKsp": 2,
            "stage.stages": [
                {"index": 0, "ksp": 0, "dvAtmo": 800.0, "dvVac": 1000.0},
                {"index": 1, "ksp": 1, "dvAtmo": 0.0, "dvVac": 0.0},
            ],
        }

        enriched = staging.enrich_stage_result(FakeStageStats(), result)

        self.assertEqual(enriched["stage.activeKsp"], 0)


if __name__ == "__main__":
    unittest.main()
