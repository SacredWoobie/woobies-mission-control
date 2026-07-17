import json
import tempfile
import unittest
from pathlib import Path

import ksp_dashboard_app


VALID_RELEASE = {
    "tag_name": "v0.3.0",
    "html_url": (
        "https://github.com/SacredWoobie/"
        "woobies-mission-control/releases/tag/v0.3.0"
    ),
}


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc, _traceback):
        return False

    def read(self):
        return self.payload


class UpdateCheckerTests(unittest.TestCase):
    def test_parse_version_tag_accepts_release_versions(self):
        self.assertEqual(ksp_dashboard_app.parse_version_tag("v1.2.3"), (1, 2, 3))
        self.assertEqual(ksp_dashboard_app.parse_version_tag("1.2.3"), (1, 2, 3))

    def test_parse_version_tag_rejects_prereleases_and_extra_parts(self):
        self.assertIsNone(ksp_dashboard_app.parse_version_tag("v1.2.3-beta"))
        self.assertIsNone(ksp_dashboard_app.parse_version_tag("v1.2.3.4"))

    def test_classify_release_handles_update_current_and_development(self):
        self.assertEqual(
            ksp_dashboard_app.classify_release("0.2.0", "v0.3.0"),
            "available",
        )
        self.assertEqual(
            ksp_dashboard_app.classify_release("0.2.0", "v0.2.0"),
            "current",
        )
        self.assertEqual(
            ksp_dashboard_app.classify_release("0.3.0", "v0.2.0"),
            "development",
        )

    def test_validate_release_payload_rejects_unexpected_link(self):
        payload = dict(VALID_RELEASE, html_url="https://example.com/update.zip")
        with self.assertRaises(ValueError):
            ksp_dashboard_app.validate_release_payload(payload)

    def test_fetch_latest_release_sets_headers_and_validates_response(self):
        captured = {}

        def opener(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return FakeResponse(VALID_RELEASE)

        result = ksp_dashboard_app.fetch_latest_release(opener=opener, timeout=2)

        self.assertEqual(result, VALID_RELEASE)
        self.assertEqual(captured["timeout"], 2)
        self.assertEqual(
            captured["request"].get_header("User-agent"),
            "Woobies-Mission-Control/0.2.1",
        )
        self.assertEqual(
            captured["request"].get_header("Accept"),
            "application/vnd.github+json",
        )

    def test_cache_must_be_recent_and_valid(self):
        state = dict(VALID_RELEASE, app_version="0.2.1", last_checked=1000)
        self.assertEqual(
            ksp_dashboard_app.get_fresh_cached_release(
                state,
                now=1050,
                max_age=100,
            ),
            VALID_RELEASE,
        )
        self.assertIsNone(
            ksp_dashboard_app.get_fresh_cached_release(
                state,
                now=1200,
                max_age=100,
            )
        )
        state["app_version"] = "0.1.0"
        self.assertIsNone(
            ksp_dashboard_app.get_fresh_cached_release(
                state,
                now=1050,
                max_age=100,
            )
        )

    def test_update_state_round_trip(self):
        state = dict(
            VALID_RELEASE,
            app_version="0.2.1",
            last_checked=1234,
            check_enabled=False,
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "nested" / "update_state.json"
            ksp_dashboard_app.save_update_state(state, path)

            self.assertEqual(ksp_dashboard_app.load_update_state(path), state)
            self.assertFalse(path.with_suffix(".json.tmp").exists())


if __name__ == "__main__":
    unittest.main()
