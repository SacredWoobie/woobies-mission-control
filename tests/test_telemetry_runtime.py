import importlib.util
import sys
import tempfile
import unittest
from http import HTTPStatus
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location(
    "telemetry_runtime_tests",
    ROOT / "telemetry_runtime.py",
)
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)

from planner_persistence import PlannerPersistence


class TelemetryRuntimeTests(unittest.TestCase):
    def test_canonical_host_validation_is_exact(self):
        self.assertTrue(runtime.allowed_host_header("127.0.0.1:8090", "127.0.0.1", 8090))
        self.assertFalse(runtime.allowed_host_header("localhost:8090", "127.0.0.1", 8090))
        self.assertFalse(runtime.allowed_host_header("attacker.example", "127.0.0.1", 8090))

    def test_planner_wire_events_preserve_status_revision_and_request(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = PlannerPersistence(Path(temporary) / "mission_planning.json")
            value = {"schemaVersion": 4, "plans": [], "pinnedPlanId": None}
            merged = runtime.planner_event(store, {
                "type": "mission.planning.persistence.merge",
                "requestId": "merge-1",
                "section": "resonant",
                "incoming": value,
            })
            self.assertEqual(merged["type"], "mission.planning.persistence.state")
            self.assertEqual(merged["requestId"], "merge-1")
            self.assertEqual(merged["status"], "merged")
            self.assertEqual(merged["revision"], 1)

            updated = runtime.planner_event(store, {
                "type": "mission.planning.persistence.update",
                "requestId": "update-1",
                "section": "resonant",
                "baseRevision": 1,
                "value": value,
            })
            self.assertEqual(updated["status"], "updated")
            self.assertEqual(updated["revision"], 2)

            conflict = runtime.planner_event(store, {
                "type": "mission.planning.persistence.update",
                "requestId": "update-stale",
                "section": "resonant",
                "baseRevision": 1,
                "value": value,
            })
            self.assertEqual(conflict["status"], "conflict")
            self.assertEqual(conflict["revision"], 2)

    def test_only_fingerprinted_asset_paths_are_immutable(self):
        def baseline(_target, _root=None):
            return (
                HTTPStatus.OK,
                "application/javascript",
                "public, max-age=31536000, immutable",
                b"asset",
            )

        dashboard_asset, _server = runtime.create_telemetry_runtime(
            baseline,
            lambda _name: None,
            lambda _conn: {},
            lambda _conn, _command: None,
            ROOT / "web",
            4,
        )

        self.assertEqual(
            dashboard_asset("/assets/index-AbCdEf12.js")[2],
            "public, max-age=31536000, immutable",
        )
        self.assertEqual(dashboard_asset("/assets/config.js")[2], "no-cache")
        self.assertEqual(dashboard_asset("/config.json")[2], "no-cache")

    def test_packaged_server_source_contains_origin_csp_and_session_guards(self):
        source = (ROOT / "telemetry_runtime.py").read_text(encoding="utf-8")
        for marker in (
            "origins=[origin, None]",
            "Content-Security-Policy",
            "Queue(maxsize=MAX_PENDING_COMMANDS)",
            "sessions.get(ws) != session_id",
            '"overview.vessel.switch"',
            '"overview.vessel.edit"',
            '"overview.vessel.lifecycle"',
            "if isinstance(event, dict)",
            'event.get("status") in {"merged", "updated"}',
        ):
            self.assertIn(marker, source)


if __name__ == "__main__":
    unittest.main()
