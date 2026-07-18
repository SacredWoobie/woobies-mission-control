import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ksp_dashboard_app


class LauncherSettingsTests(unittest.TestCase):
    def test_settings_round_trip(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "settings.json"
            ksp_dashboard_app.save_settings({"ksp_root": "C:/Games/KSP"}, path)
            self.assertEqual(
                ksp_dashboard_app.load_settings(path),
                {"ksp_root": "C:/Games/KSP"},
            )
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(payload["ksp_root"], "C:/Games/KSP")

    def test_invalid_settings_fall_back_to_empty_root(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "settings.json"
            path.write_text("[]", encoding="utf-8")
            self.assertEqual(ksp_dashboard_app.load_settings(path), {"ksp_root": ""})

    def test_ksp_root_requires_gamedata(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertIsNone(ksp_dashboard_app.resolve_ksp_root(str(root)))
            (root / "GameData").mkdir()
            self.assertEqual(
                ksp_dashboard_app.resolve_ksp_root(str(root)), root.resolve()
            )

    def test_telemetry_environment_only_includes_valid_root(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertEqual(ksp_dashboard_app.telemetry_environment(str(root)), {})
            (root / "GameData").mkdir()
            self.assertEqual(
                ksp_dashboard_app.telemetry_environment(str(root)),
                {"WOOBIE_KSP_ROOT": str(root.resolve())},
            )


if __name__ == "__main__":
    unittest.main()
