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
            ksp_dashboard_app.save_settings(
                {
                    "ksp_root": "C:/Games/KSP",
                    "lan_access_enabled": True,
                    "lan_bind_address": "192.168.1.50",
                    "lan_warning_ack_version": 1,
                },
                path,
            )
            self.assertEqual(
                ksp_dashboard_app.load_settings(path),
                {
                    "ksp_root": "C:/Games/KSP",
                    "lan_access_enabled": True,
                    "lan_bind_address": "192.168.1.50",
                    "lan_warning_ack_version": 1,
                },
            )
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(payload["ksp_root"], "C:/Games/KSP")
            self.assertIs(payload["lan_access_enabled"], True)

    def test_invalid_settings_fall_back_to_empty_root(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "settings.json"
            path.write_text("[]", encoding="utf-8")
            self.assertEqual(
                ksp_dashboard_app.load_settings(path),
                {
                    "ksp_root": "",
                    "lan_access_enabled": False,
                    "lan_bind_address": "",
                    "lan_warning_ack_version": 0,
                },
            )

    def test_old_settings_migrate_to_safe_lan_defaults(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "settings.json"
            path.write_text(json.dumps({"ksp_root": " C:/KSP "}), encoding="utf-8")
            self.assertEqual(
                ksp_dashboard_app.load_settings(path),
                {
                    "ksp_root": "C:/KSP",
                    "lan_access_enabled": False,
                    "lan_bind_address": "",
                    "lan_warning_ack_version": 0,
                },
            )

    def test_invalid_warning_acknowledgement_versions_are_reset(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "settings.json"
            for value in (True, -1, "1"):
                path.write_text(
                    json.dumps({"lan_warning_ack_version": value}), encoding="utf-8"
                )
                self.assertEqual(
                    ksp_dashboard_app.load_settings(path)["lan_warning_ack_version"],
                    0,
                )

    def test_lan_access_enabled_requires_exact_bool_true(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "settings.json"
            path.write_text(
                json.dumps({"ksp_root": "", "lan_access_enabled": "yes"}),
                encoding="utf-8",
            )
            self.assertEqual(
                ksp_dashboard_app.load_settings(path)["lan_access_enabled"], False
            )

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
            self.assertEqual(
                ksp_dashboard_app.telemetry_environment(str(root)),
                {"WOOBIE_ALLOW_LAN": "0", "WOOBIE_LAN_BIND": ""},
            )
            (root / "GameData").mkdir()
            self.assertEqual(
                ksp_dashboard_app.telemetry_environment(str(root)),
                {
                    "WOOBIE_KSP_ROOT": str(root.resolve()),
                    "WOOBIE_ALLOW_LAN": "0",
                    "WOOBIE_LAN_BIND": "",
                },
            )

    def test_telemetry_environment_includes_lan_flag_when_enabled(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "GameData").mkdir()
            self.assertEqual(
                ksp_dashboard_app.telemetry_environment(
                    str(root), True, "192.168.1.50"
                ),
                {
                    "WOOBIE_KSP_ROOT": str(root.resolve()),
                    "WOOBIE_ALLOW_LAN": "1",
                    "WOOBIE_LAN_BIND": "192.168.1.50",
                },
            )
            self.assertEqual(
                ksp_dashboard_app.telemetry_environment("", True, "10.2.3.4"),
                {"WOOBIE_ALLOW_LAN": "1", "WOOBIE_LAN_BIND": "10.2.3.4"},
            )

    def test_telemetry_environment_neutralizes_inherited_or_invalid_lan_state(self):
        self.assertEqual(
            ksp_dashboard_app.telemetry_environment("", False, "192.168.1.50"),
            {"WOOBIE_ALLOW_LAN": "0", "WOOBIE_LAN_BIND": "192.168.1.50"},
        )
        self.assertEqual(
            ksp_dashboard_app.telemetry_environment("", True, "8.8.8.8"),
            {"WOOBIE_ALLOW_LAN": "0", "WOOBIE_LAN_BIND": ""},
        )


if __name__ == "__main__":
    unittest.main()
