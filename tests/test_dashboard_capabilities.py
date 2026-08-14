import sys
import tempfile
import unittest
import ast
import inspect
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import dashboard_capabilities as capabilities
import telemetry_server


class DashboardCapabilitiesTests(unittest.TestCase):
    def setUp(self):
        capabilities.reset_scan_cache()

    def make_file(self, root, relative):
        target = root.joinpath(*relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"known marker")

    def make_notes(self, root):
        target = root / "gamedata" / "nOtEs" / "pLuGiNs" / "pLuGiNdAtA" / "NoTeS"
        target.mkdir(parents=True)

    def test_complete_stable_shape_and_order(self):
        result = capabilities.build_dashboard_capabilities({})
        self.assertEqual(result["schemaVersion"], 1)
        self.assertEqual(tuple(result["features"]), capabilities.FEATURE_IDS)
        self.assertEqual(len(result["features"]), 10)
        for feature in capabilities.FEATURE_IDS:
            row = result["features"][feature]
            self.assertEqual(set(row), {"status", "reason", "evidence"})
            self.assertIn(row["status"], capabilities.STATUSES)
            self.assertIn(row["reason"], capabilities.REASONS)

    def test_whitelist_scan_is_case_insensitive_and_sanitised(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.make_notes(root)
            self.make_file(root, ("gAmEdAtA", "WoObIeSCoNtRoLStAtS", "wOobiEsControlStats.DLL"))
            self.make_file(root, ("gAmEdAtA", "ReMoTeTeCh", "pLuGiNs", "rEmOtEtEcH.DLL"))
            self.make_file(root, ("gAmEdAtA", "TrIgGeRtEcH", "KeRbAlAlArMcLoCk", "PlUgInS", "kErBaLaLaRmClOcK.DLL"))
            self.make_file(root, ("gAmEdAtA", "DyNaMiCbAtTeRyStOrAgE", "PlUgInS", "dYnAmIcBaTtErYsToRaGe.DLL"))
            scan = capabilities.scan_root_capabilities(root)
        self.assertEqual(scan["dependencies"]["notes"]["status"], "detected")
        self.assertEqual(scan["dependencies"]["wcs"]["status"], "detected")
        self.assertEqual(scan["dependencies"]["remote_tech"]["status"], "detected")
        self.assertEqual(scan["dependencies"]["kac"]["status"], "detected")
        self.assertEqual(
            scan["dependencies"]["dynamic_battery_storage"]["status"],
            "detected",
        )
        self.assertNotIn("root", scan)
        self.assertNotIn("path", scan)
        self.assertNotIn("hash", repr(scan).casefold())
        self.assertNotIn("arbitrary", repr(scan).casefold())

    def test_unconfigured_and_scan_error_are_safe(self):
        unconfigured = capabilities.scan_root_capabilities("")
        self.assertFalse(unconfigured["configured"])
        self.assertEqual(unconfigured["dependencies"], {})
        with mock.patch.object(capabilities, "_scan_uncached", return_value={"configured": True, "dependencies": {}, "error": True}):
            result = capabilities.scan_root_capabilities("C:/configured")
        built = capabilities.build_dashboard_capabilities({}, result)
        self.assertEqual(built["features"]["notes"]["reason"], "probe_error")
        self.assertEqual(built["features"]["notes"]["status"], "unknown")

    def test_missing_scan_markers_do_not_infer_runtime_fallbacks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "GameData").mkdir()
            result = capabilities.build_dashboard_capabilities(
                {}, capabilities.scan_root_capabilities(root)
            )
        for feature in capabilities.FEATURE_IDS:
            self.assertEqual(result["features"][feature]["status"], "unknown")
            self.assertEqual(
                result["features"][feature]["reason"], "dependency_missing"
            )

    def test_scan_is_cached_and_reset_reprobes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with mock.patch.object(capabilities, "_scan_uncached", wraps=capabilities._scan_uncached) as probe:
                capabilities.scan_root_capabilities(root)
                capabilities.scan_root_capabilities(root)
                self.assertEqual(probe.call_count, 1)
                capabilities.reset_scan_cache()
                capabilities.scan_root_capabilities(root)
                self.assertEqual(probe.call_count, 2)

    def test_runtime_evidence_overrides_detected_scan_dependency(self):
        scan = {
            "configured": True,
            "error": False,
            "dependencies": {
                "stage_stats": {"source": "root_scan", "status": "detected"},
                "mechjeb": {"source": "root_scan", "status": "detected"},
            },
        }
        result = capabilities.build_dashboard_capabilities({"stage.available": False}, scan)
        row = result["features"]["stage_analysis"]
        self.assertEqual(row["status"], "unknown")
        self.assertEqual(row["reason"], "not_observed")
        self.assertEqual(row["evidence"][0]["source"], "runtime")
        self.assertEqual(row["evidence"][0]["status"], "unavailable")
        self.assertEqual(row["evidence"][1]["source"], "root_scan")
        self.assertEqual(row["evidence"][1]["status"], "detected")

    def test_stock_fallbacks_and_provider_requirements(self):
        telemetry = {
            "sci.krpc.backend": "SpaceCenter experiments fallback",
            "comm.krpc.signalStrength": 0.7,
            "heat.backend": "stock",
            "editor.elec.backend": "stock",
            "damage.source": "stock_krpc",
        }
        result = capabilities.build_dashboard_capabilities(telemetry)
        self.assertEqual(result["features"]["science_telemetry"]["status"], "fallback")
        self.assertEqual(result["features"]["communications"]["status"], "fallback")
        self.assertEqual(result["features"]["heat_monitoring"]["status"], "fallback")
        self.assertEqual(result["features"]["heat_controls"]["status"], "unavailable")
        self.assertEqual(result["features"]["editor_electricity"]["status"], "fallback")
        self.assertEqual(result["features"]["damage_monitoring"]["status"], "fallback")
        self.assertEqual(result["features"]["live_transfer_calculations"]["status"], "unknown")

    def test_notes_runtime_availability_is_authoritative(self):
        available = capabilities.build_dashboard_capabilities({"notes.available": True})
        unavailable = capabilities.build_dashboard_capabilities({"notes.available": False})
        self.assertEqual(available["features"]["notes"]["status"], "available")
        self.assertEqual(unavailable["features"]["notes"]["status"], "unavailable")

    def test_alarm_provider_matrix_and_runtime_versions(self):
        telemetry = {
            "sci.alarmProviders": {"kac": False, "stock": True},
            "mj.transfer.available": True,
            "mj.transfer.compatibilityReady": True,
            "mj.transfer.detectedVersion": "2.15.3.0",
            "mj.transfer.compatibilityTarget": "0.8.10",
        }
        result = capabilities.build_dashboard_capabilities(telemetry)
        alarms = result["features"]["science_alarms"]
        self.assertEqual(alarms["status"], "fallback")
        self.assertEqual(alarms["reason"], "fallback_active")
        self.assertEqual(
            {item["id"] for item in alarms["evidence"]}, {"kac", "stock"}
        )
        transfer = result["features"]["live_transfer_calculations"]
        self.assertEqual(transfer["status"], "available")
        versions = [item for item in transfer["evidence"] if "version" in item]
        self.assertEqual({item["version"] for item in versions}, {"2.15.3.0", "0.8.10"})

    def test_scan_missing_resolves_an_unobserved_required_runtime_provider(self):
        scan = {
            "configured": True,
            "error": False,
            "dependencies": {
                "stage_stats": {"source": "root_scan", "status": "missing"},
                "mechjeb": {"source": "root_scan", "status": "detected"},
            },
        }
        result = capabilities.build_dashboard_capabilities(
            {"stage.available": False}, scan
        )
        self.assertEqual(result["features"]["stage_analysis"]["status"], "unavailable")
        self.assertEqual(result["features"]["stage_analysis"]["reason"], "dependency_missing")

    def test_no_paths_hashes_or_arbitrary_mod_listing_in_builder(self):
        result = capabilities.build_dashboard_capabilities(
            {"mj.transfer.detectedVersion": "2.15.3.0"},
            {
                "configured": True,
                "error": False,
                "dependencies": {
                    "mechjeb": {
                        "source": "root_scan",
                        "status": "detected",
                        "path": "C:/secret/GameData/MechJeb2/Plugins/MechJeb2.dll",
                        "sha256": "deadbeef",
                        "name": "ArbitraryMod",
                    }
                },
            },
        )
        text = repr(result).casefold()
        self.assertNotIn("c:/secret", text)
        self.assertNotIn("sha256", text)
        self.assertNotIn("deadbeef", text)
        self.assertNotIn("arbitrarymod", text)

    def test_finalize_attaches_one_cached_complete_snapshot_across_scenes(self):
        scan = {
            "configured": True,
            "error": False,
            "dependencies": {},
        }
        telemetry_server._dashboard_capability_scan_root = None
        telemetry_server._dashboard_capability_scan = None
        with (
            mock.patch.dict(
                telemetry_server.os.environ,
                {"WOOBIE_KSP_ROOT": "C:/configured-ksp"},
                clear=False,
            ),
            mock.patch.object(
                telemetry_server,
                "scan_root_capabilities",
                return_value=scan,
            ) as root_scan,
            mock.patch.object(
                telemetry_server._mission_planning,
                "gather",
                return_value={},
            ),
            mock.patch.object(
                telemetry_server._electricity_flow,
                "update",
                return_value={},
            ),
        ):
            for mode in ("flight", "editor_vab", "editor_sph", "inactive"):
                result = telemetry_server._finalize_telemetry(
                    object(), {"context.mode": mode}
                )
                snapshot = result[capabilities.TELEMETRY_KEY]
                self.assertEqual(snapshot["schemaVersion"], 1)
                self.assertEqual(
                    tuple(snapshot["features"]), capabilities.FEATURE_IDS
                )
            self.assertEqual(root_scan.call_count, 1)

            telemetry_server.os.environ["WOOBIE_KSP_ROOT"] = "D:/another-ksp"
            telemetry_server._finalize_telemetry(
                object(), {"context.mode": "inactive"}
            )
            self.assertEqual(root_scan.call_count, 2)

    def test_every_gather_scene_return_uses_the_shared_finalizer(self):
        tree = ast.parse(inspect.getsource(telemetry_server.gather_telemetry))
        returns = [node for node in ast.walk(tree) if isinstance(node, ast.Return)]
        self.assertGreaterEqual(len(returns), 5)
        for statement in returns:
            self.assertIsInstance(statement.value, ast.Call)
            self.assertIsInstance(statement.value.func, ast.Name)
            self.assertEqual(statement.value.func.id, "_finalize_telemetry")


if __name__ == "__main__":
    unittest.main()
