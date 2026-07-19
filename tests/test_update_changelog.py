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
            (960, 820),
        )
        self.assertEqual(
            app.calculate_initial_window_size(1366, 768, 706, 801),
            (960, 648),
        )
        self.assertEqual(
            app.calculate_initial_window_size(800, 600, 706, 801),
            (720, 520),
        )

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
        self.assertIn("React dashboard and Mission Control overview", section)
        self.assertIn("compiled React", section)


if __name__ == "__main__":
    unittest.main()
