import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


DASHBOARD = Path(__file__).resolve().parents[1]
sys.modules.setdefault("krpc", types.ModuleType("krpc"))
sys.path.insert(0, str(DASHBOARD))

import telemetry_server


class NotesTelemetryTests(unittest.TestCase):
    def setUp(self):
        telemetry_server._notes_cache = {}
        telemetry_server._notes_last_poll = 0.0
        telemetry_server._notes_cache_key = None
        telemetry_server._notes_selected_path = None
        telemetry_server._notes_pinned_path = None
        telemetry_server._notes_favorites = None

    def make_notes_dir(self, root, mod_folder="Notes"):
        notes = root / "GameData" / mod_folder / "Plugins" / "PluginData" / "notes"
        notes.mkdir(parents=True)
        return notes

    def test_resolves_configured_ksp_root_with_both_folder_casings(self):
        for mod_folder in ("Notes", "notes"):
            with self.subTest(mod_folder=mod_folder), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                expected = self.make_notes_dir(root, mod_folder)
                self.assertEqual(
                    telemetry_server._resolve_notes_dir(str(root)), expected.resolve()
                )

    def test_missing_mod_is_optional(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "GameData").mkdir()
            result = telemetry_server._gather_notes("Odyssey", root)
        self.assertFalse(result["notes.available"])
        self.assertFalse(result["notes.activeFound"])
        self.assertIsNone(result["notes.active"])

    def test_finds_nested_active_log_even_with_many_newer_notes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            notes = self.make_notes_dir(root)
            nested = notes / "Mission Logs"
            nested.mkdir()
            active = nested / "log_Odyssey.txt"
            active.write_text("Launch complete\nOrbit nominal", encoding="utf-8")
            for index in range(30):
                decoy = notes / f"newer_{index:02d}.txt"
                decoy.write_text("not the active log", encoding="utf-8")
                os.utime(decoy, (active.stat().st_mtime + index + 1,) * 2)

            result = telemetry_server._gather_notes("Odyssey", root)

        self.assertTrue(result["notes.available"])
        self.assertTrue(result["notes.activeFound"])
        self.assertEqual(result["notes.active"]["relativePath"], "Mission Logs/log_Odyssey.txt")
        self.assertIn("Orbit nominal", result["notes.active"]["text"])

    def test_large_log_returns_a_bounded_clean_tail(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            notes = self.make_notes_dir(root)
            active = notes / "log_Odyssey.txt"
            lines = [f"entry {index:05d} - systems nominal" for index in range(4000)]
            active.write_text("\n".join(lines), encoding="utf-8")

            result = telemetry_server._gather_notes("Odyssey", root)

        note = result["notes.active"]
        self.assertTrue(note["truncated"])
        self.assertLessEqual(len(note["text"].encode("utf-8")), telemetry_server.NOTES_MAX_BYTES)
        self.assertNotIn("entry 00000", note["text"])
        self.assertIn("entry 03999", note["text"])

    def test_environment_root_is_used(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            expected = self.make_notes_dir(root)
            with mock.patch.dict(os.environ, {"WOOBIE_KSP_ROOT": str(root)}):
                self.assertEqual(telemetry_server._resolve_notes_dir(), expected.resolve())

    def test_catalog_and_saved_note_selection(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            notes = self.make_notes_dir(root)
            (notes / "log_Odyssey.txt").write_text(
                "Active vessel log", encoding="utf-8"
            )
            plans = notes / "Mission Plans"
            plans.mkdir()
            (plans / "Duna Transfer.txt").write_text(
                "Window opens on year 3.", encoding="utf-8"
            )

            result = telemetry_server._gather_notes(
                "Odyssey", root, "Mission Plans/Duna Transfer.txt"
            )

        self.assertEqual(result["notes.selectionMode"], "browse")
        self.assertEqual(
            result["notes.selected"]["relativePath"],
            "Mission Plans/Duna Transfer.txt",
        )
        self.assertIn("Window opens", result["notes.selected"]["text"])
        self.assertEqual(result["notes.active"]["name"], "log_Odyssey")
        self.assertEqual(len(result["notes.catalog"]), 2)
        self.assertTrue(
            next(
                note for note in result["notes.catalog"]
                if note["relativePath"] == "log_Odyssey.txt"
            )["isActiveLog"]
        )

    def test_unknown_selection_cannot_escape_catalog(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            notes = self.make_notes_dir(root)
            (notes / "log_Odyssey.txt").write_text("Safe log", encoding="utf-8")
            (root / "secret.txt").write_text("do not read", encoding="utf-8")

            result = telemetry_server._gather_notes(
                "Odyssey", root, "../../secret.txt",
                pinned_path="../../secret.txt",
            )

        self.assertEqual(result["notes.selectionMode"], "active")
        self.assertEqual(result["notes.selected"]["relativePath"], "log_Odyssey.txt")
        self.assertNotIn("do not read", result["notes.selected"]["text"])
        self.assertIsNone(result["notes.pinned"])
        self.assertEqual(result["notes.pinnedPath"], "")

    def test_notes_select_command_updates_browser_selection(self):
        telemetry_server._notes_selected_path = None
        telemetry_server._notes_cache = {"stale": True}
        telemetry_server._notes_last_poll = 123.0

        telemetry_server._apply_telemetry_command(
            None,
            {"type": "notes.select", "relativePath": "Mission Plans/Duna.txt"},
        )

        self.assertEqual(
            telemetry_server._notes_selected_path, "Mission Plans/Duna.txt"
        )
        self.assertEqual(telemetry_server._notes_cache, {})
        self.assertEqual(telemetry_server._notes_last_poll, 0.0)

        telemetry_server._apply_telemetry_command(
            None, {"type": "notes.select", "relativePath": None}
        )
        self.assertIsNone(telemetry_server._notes_selected_path)

    def test_pinned_note_is_independent_from_browser_selection(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            notes = self.make_notes_dir(root)
            (notes / "Checklist.txt").write_text("Check staging", encoding="utf-8")
            (notes / "Flight Plan.txt").write_text("Circularize", encoding="utf-8")

            result = telemetry_server._gather_notes(
                "", root, selected_path="Checklist.txt",
                pinned_path="Flight Plan.txt",
            )

        self.assertEqual(result["notes.selectedPath"], "Checklist.txt")
        self.assertEqual(result["notes.pinnedPath"], "Flight Plan.txt")
        self.assertIn("Check staging", result["notes.selected"]["text"])
        self.assertIn("Circularize", result["notes.pinned"]["text"])

    def test_notes_pin_command_replaces_and_clears_single_pin(self):
        telemetry_server._notes_cache = {"stale": True}
        telemetry_server._notes_last_poll = 123.0

        telemetry_server._apply_telemetry_command(
            None, {"type": "notes.pin", "relativePath": "Plans/Duna.txt"}
        )

        self.assertEqual(telemetry_server._notes_pinned_path, "Plans/Duna.txt")
        self.assertEqual(telemetry_server._notes_cache, {})
        self.assertEqual(telemetry_server._notes_last_poll, 0.0)

        telemetry_server._apply_telemetry_command(
            None, {"type": "notes.pin", "relativePath": None}
        )
        self.assertIsNone(telemetry_server._notes_pinned_path)

    def test_favorites_round_trip_and_sort_to_top(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            notes = self.make_notes_dir(root)
            (notes / "Alpha.txt").write_text("alpha", encoding="utf-8")
            (notes / "Zulu.txt").write_text("zulu", encoding="utf-8")
            favorites_path = root / "favorites.json"

            telemetry_server._save_notes_favorites(
                {"Zulu.txt"}, favorites_path
            )
            favorites = telemetry_server._load_notes_favorites(favorites_path)
            result = telemetry_server._gather_notes(
                "", root, favorites=favorites
            )

        self.assertEqual(favorites, {"Zulu.txt"})
        self.assertEqual(
            [note["relativePath"] for note in result["notes.catalog"]],
            ["Zulu.txt", "Alpha.txt"],
        )
        self.assertTrue(result["notes.catalog"][0]["isFavorite"])
        self.assertFalse(result["notes.catalog"][1]["isFavorite"])

    def test_favorite_command_validates_catalog_and_persists(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            notes = self.make_notes_dir(root)
            (notes / "Checklist.txt").write_text("items", encoding="utf-8")
            favorites_path = root / "favorites.json"

            with (
                mock.patch.dict(os.environ, {"WOOBIE_KSP_ROOT": str(root)}),
                mock.patch.object(
                    telemetry_server, "NOTES_FAVORITES_PATH", favorites_path
                ),
            ):
                telemetry_server._notes_favorites = set()
                telemetry_server._apply_telemetry_command(
                    None,
                    {
                        "type": "notes.favorite",
                        "relativePath": "Checklist.txt",
                        "favorite": True,
                    },
                )
                self.assertEqual(
                    telemetry_server._load_notes_favorites(favorites_path),
                    {"Checklist.txt"},
                )

                telemetry_server._apply_telemetry_command(
                    None,
                    {
                        "type": "notes.favorite",
                        "relativePath": "../outside.txt",
                        "favorite": True,
                    },
                )
                self.assertEqual(
                    telemetry_server._load_notes_favorites(favorites_path),
                    {"Checklist.txt"},
                )

    def test_notes_attach_to_inactive_scene_payload(self):
        payload = {
            "notes.available": True,
            "notes.catalog": [{"relativePath": "Checklist.txt"}],
        }
        with (
            mock.patch.object(
                telemetry_server, "_gather_notes", return_value=payload
            ),
            mock.patch.object(
                telemetry_server, "_get_notes_favorites", return_value=set()
            ),
        ):
            result = telemetry_server._attach_notes_telemetry(
                {"context.mode": "inactive"}, now=10.0
            )

        self.assertTrue(result["notes.available"])
        self.assertEqual(result["notes.catalog"][0]["relativePath"], "Checklist.txt")


if __name__ == "__main__":
    unittest.main()
