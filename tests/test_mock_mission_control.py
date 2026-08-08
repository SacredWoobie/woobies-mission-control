import importlib.util
import tempfile
import unittest
from http import HTTPStatus
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "tools" / "mock_mission_control_server.py"
SPEC = importlib.util.spec_from_file_location("mock_mission_control", SERVER)
mock_server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mock_server)


class MockMissionControlTests(unittest.TestCase):
    def test_scene_aliases_cover_dashboard_views(self):
        self.assertEqual(
            mock_server.normalize_scenes("flight,VAB,mission"),
            ["flight", "editor", "inactive"],
        )
        with self.assertRaisesRegex(ValueError, "Unknown scene"):
            mock_server.normalize_scenes("tracking-potato")

    def test_payloads_use_populated_snapshot_data(self):
        editor = mock_server.initial_editor_conditions()
        notes = mock_server.initial_note_state()
        flight = mock_server.build_payload("flight", 4, 1.5, editor, notes)
        vab = mock_server.build_payload("editor", 4, 1.5, editor, notes)
        mission = mock_server.build_payload("inactive", 4, 1.5, editor, notes)

        self.assertEqual(flight["context.mode"], "flight")
        self.assertEqual(flight["v.name"], "Mock Odyssey")
        self.assertEqual(flight["heat.backend"], "system_heat")
        self.assertGreater(len(flight["res.names"]), 0)
        self.assertEqual(vab["context.mode"], "editor")
        self.assertGreater(vab["editor.partCount"], 0)
        self.assertEqual(mission["context.mode"], "inactive")
        self.assertGreater(len(mission["overview.vessels"]), 0)
        self.assertGreater(len(mission["overview.roster"]), 0)
        self.assertGreater(len(mission["overview.alarms"]), 0)

    def test_http_assets_are_bounded_to_web_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "index.html").write_text("Mission Control", encoding="utf-8")
            (root / "app.js").write_text("export {};", encoding="utf-8")
            status, media, cache, body = mock_server.dashboard_asset("/", root)
            script = mock_server.dashboard_asset("/app.js", root)
            traversal = mock_server.dashboard_asset("/%2e%2e/secret.txt", root)

            self.assertEqual(status, HTTPStatus.OK)
            self.assertEqual(media, "text/html; charset=utf-8")
            self.assertEqual(cache, "no-cache")
            self.assertIn(b"Mission Control", body)
            self.assertEqual(script[1], "text/javascript; charset=utf-8")
            self.assertEqual(traversal[0], HTTPStatus.NOT_FOUND)


class MissionPlanningMockTests(unittest.IsolatedAsyncioTestCase):
    async def test_profile_overlays_windows_and_completes_transfer_commands(self):
        profile = mock_server.MissionPlanningMockProfile()
        payload = {}
        profile.overlay(payload)

        self.assertTrue(payload["mj.transfer.available"])
        self.assertEqual(payload["mj.transfer.windows.state"], "completed")
        self.assertGreater(len(payload["mj.transfer.windows.results"]), 0)

        await profile.apply_command({
            "type": "mechjeb.transfer.start",
            "requestId": "mock-request",
            "fingerprint": "mock-fingerprint",
            "origin": "Kerbin",
            "destination": "Duna",
            "originParkingAltitude": 100_000,
            "optimizePoweredCapture": False,
        })
        await profile.apply_command({
            "type": "mechjeb.transfer.grid.request",
            "requestId": "mock-request",
            "fingerprint": "mock-fingerprint",
        })
        profile.overlay(payload)

        self.assertEqual(payload["mj.transfer.state"], "completed")
        self.assertEqual(payload["mj.transfer.destination"], "Duna")
        self.assertEqual(payload["mj.transfer.grid.dateSamples"], 3)
        self.assertEqual(len(payload["mj.transfer.grid.costs"]), 9)

    async def test_profile_round_trips_persistence_state(self):
        profile = mock_server.MissionPlanningMockProfile()
        await profile.apply_command({
            "type": "mission.planning.persistence.update",
            "requestId": "save-resonant",
            "section": "resonant",
            "baseRevision": 0,
            "value": {"plans": []},
        })
        events = await profile.drain_events()

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["status"], "updated")
        self.assertEqual(events[0]["revision"], 1)
        self.assertEqual(events[0]["value"], {"plans": []})


if __name__ == "__main__":
    unittest.main()
