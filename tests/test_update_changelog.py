import queue
import sys
import time
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ksp_dashboard_app as app


class UpdateAndChangelogTests(unittest.TestCase):
    def test_font_choice_uses_explicit_fallback_order(self):
        self.assertEqual(
            app.choose_ui_font_family(["Arial", "Cascadia Code", "Consolas"]),
            "Cascadia Code",
        )
        self.assertEqual(
            app.choose_ui_font_family(["Arial", "Consolas"]),
            "Consolas",
        )
        self.assertEqual(app.choose_ui_font_family(["Arial"]), "TkFixedFont")

    def test_initial_window_size_is_roomy_and_screen_bounded(self):
        self.assertEqual(
            app.calculate_initial_window_size(2560, 1440, 706, 801),
            (1360, 860),
        )
        self.assertEqual(
            app.calculate_initial_window_size(1366, 768, 706, 801),
            (1286, 648),
        )
        self.assertEqual(
            app.calculate_initial_window_size(800, 600, 706, 801),
            (720, 520),
        )

    def test_initial_launcher_panes_favor_controls_and_preserve_log(self):
        self.assertEqual(app.calculate_initial_pane_sash(700), 504)
        self.assertEqual(app.calculate_initial_pane_sash(400), 250)
        self.assertEqual(app.calculate_initial_pane_sash(300), 150)
        self.assertEqual(app.calculate_initial_pane_sash(100), 0)

    def test_launcher_log_filters_keep_sources_and_warning_focus(self):
        records = [
            ("feed", "telemetry ready", False),
            ("preflight", "kRPC port refused the connection", True),
            ("updates", "up to date", False),
        ]
        self.assertEqual(
            app.filter_launcher_log_records(records, "feed"),
            [records[0]],
        )
        self.assertEqual(
            app.filter_launcher_log_records(records, "preflight"),
            [records[1]],
        )
        self.assertEqual(
            app.filter_launcher_log_records(records, "warnings"),
            [records[1]],
        )
        self.assertEqual(
            app.filter_launcher_log_records(records, "all"),
            records,
        )
        self.assertTrue(
            app.is_launcher_log_warning(
                "feed", "WARNING: LAN access has no authentication"
            )
        )
        self.assertFalse(
            app.is_launcher_log_warning("preflight", "live kRPC test passed")
        )

    def test_launcher_enqueue_preserves_structured_source_and_message(self):
        launcher = app.App.__new__(app.App)
        launcher.log_queue = queue.Queue()
        launcher._enqueue("feed", "telemetry ready")
        self.assertEqual(
            launcher.log_queue.get_nowait(),
            ("feed", "telemetry ready"),
        )

    def test_mousewheel_delta_normalizes_for_tk_scrolling(self):
        self.assertEqual(app.normalize_mousewheel_units(120), -1)
        self.assertEqual(app.normalize_mousewheel_units(240), -2)
        self.assertEqual(app.normalize_mousewheel_units(-120), 1)
        self.assertEqual(app.normalize_mousewheel_units(-1), 1)
        self.assertEqual(app.normalize_mousewheel_units(0), 0)

    def test_fresh_cache_is_scoped_to_launcher_version(self):
        now = time.time()
        state = {
            "app_version": app.APP_VERSION,
            "last_checked": now,
            "tag_name": "v0.2.2",
            "html_url": (
                "https://github.com/SacredWoobie/"
                "woobies-mission-control/releases/tag/v0.2.2"
            ),
            "draft": False,
            "prerelease": False,
            "immutable": False,
            "body": "Cached release notes",
            "assets": [],
        }
        self.assertIsNotNone(app.get_fresh_cached_release(state, now=now))
        state["app_version"] = "0.2.2"
        self.assertIsNone(app.get_fresh_cached_release(state, now=now))

    def test_extract_version_changelog_returns_only_requested_section(self):
        changelog = """# Changelog

## v0.2.3 - New work

- First item.
- Second item.

## v0.2.2 - Previous work

- Older item.
"""
        section = app.extract_version_changelog(changelog, "0.2.3")
        self.assertIn("v0.2.3", section)
        self.assertIn("First item", section)
        self.assertNotIn("v0.2.2", section)
        self.assertNotIn("Older item", section)

    def test_whats_new_is_once_per_version_and_optional(self):
        self.assertTrue(app.should_show_changelog({}, "0.2.3", True))
        self.assertFalse(
            app.should_show_changelog(
                {"last_changelog_version": "0.2.3"}, "0.2.3", True
            )
        )
        self.assertFalse(
            app.should_show_changelog(
                {"show_changelog_on_update": False}, "0.2.3", True
            )
        )
        self.assertFalse(app.should_show_changelog({}, "0.2.3", False))

    def test_source_tree_contains_current_version_notes(self):
        path = app.find_changelog_path()
        self.assertIsNotNone(path)
        section = app.extract_version_changelog(
            app.load_changelog(path), app.APP_VERSION
        )
        self.assertIn("Flight navball and launch communications", section)
        self.assertIn("north-reference line", section)
        self.assertIn("false COMMS Master Caution", section)


if __name__ == "__main__":
    unittest.main()
