import json
import os
import sys
import time
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
    "draft": False,
    "prerelease": False,
    "immutable": False,
    "body": "Release notes",
    "assets": [],
}


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc, _traceback):
        return False

    def read(self, size=-1):
        return self.payload if size < 0 else self.payload[:size]


class UpdateCheckerTests(unittest.TestCase):
    def test_update_buttons_follow_the_check_review_reference_workflow(self):
        source = Path(ksp_dashboard_app.__file__).read_text(encoding="utf-8")
        start = source.index('update_actions = ttk.Frame')
        end = source.index('self.main_panes = tk.PanedWindow', start)
        update_bar = source[start:end]

        workflow = (
            ("check_updates_control", '"AUTOMATIC UPDATE CHECKS"'),
            ("check_updates_button", 'text="Check now"'),
            ("install_update_button", 'text="Review & install"'),
            ("changelog_button", 'text="Changelog"'),
            ("view_release_button", 'text="View release"'),
        )
        positions = [
            update_bar.index(f"self.{attribute} =") for attribute, _label in workflow
        ]
        self.assertEqual(positions, sorted(positions))
        boundaries = positions[1:] + [len(update_bar)]
        for (attribute, label), assignment, next_assignment in zip(
            workflow, positions, boundaries
        ):
            definition = update_bar[assignment:next_assignment]
            self.assertIn("update_actions,", definition)
            self.assertIn(label, definition)
            self.assertIn(f'self.{attribute}.pack(side="left"', definition)

        self.assertIn('update_actions = ttk.Frame(update_bar', update_bar)
        for attribute in (
            "check_updates_control",
            "check_updates_button",
            "install_update_button",
            "changelog_button",
            "view_release_button",
        ):
            self.assertEqual(update_bar.count(f"self.{attribute}.pack("), 1)

    def test_delayed_changelog_does_not_steal_an_update_decision(self):
        class Probe:
            staged_update = {"transaction_id": "synthetic"}
            update_install_dialog = None

        # This deliberately supplies none of the changelog attributes. Reaching
        # past the modal guard would therefore fail the test immediately.
        self.assertIsNone(ksp_dashboard_app.App._maybe_show_changelog(Probe()))

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
            f"Woobies-Mission-Control/{ksp_dashboard_app.APP_VERSION}",
        )
        self.assertEqual(
            captured["request"].get_header("Accept"),
            "application/vnd.github+json",
        )

    def test_cache_must_be_recent_and_valid(self):
        state = dict(
            VALID_RELEASE,
            app_version=ksp_dashboard_app.APP_VERSION,
            last_checked=1000,
        )
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
            app_version=ksp_dashboard_app.APP_VERSION,
            last_checked=1234,
            check_enabled=False,
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "nested" / "update_state.json"
            ksp_dashboard_app.save_update_state(state, path)

            self.assertEqual(ksp_dashboard_app.load_update_state(path), state)
            self.assertFalse(path.with_suffix(".json.tmp").exists())

    def test_packaged_startup_blocks_pending_update_without_exact_token(self):
        update = ksp_dashboard_app.runtime_update
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            dashboard = root / "Dashboard"
            dashboard.mkdir(parents=True)
            (root / update.INSTALL_MANIFEST_NAME).write_text("{}", encoding="utf-8")
            transaction_id = "1" * 32
            paths = update._transaction_paths(root, transaction_id)
            paths["transaction_root"].mkdir(parents=True)
            update._atomic_write_json(
                paths["active"],
                {"schema": 1, "transaction_id": transaction_id},
            )
            update._journal(paths, "awaiting_restart", helper_pid=None)
            before = paths["journal"].read_bytes()

            with self.assertRaises(update.TransactionError):
                ksp_dashboard_app.runtime_start_context(dashboard, {})
            package_root, token = ksp_dashboard_app.runtime_start_context(
                dashboard, {"WMC_UPDATE_TRANSACTION": transaction_id}
            )

            self.assertEqual(package_root, root.resolve())
            self.assertEqual(token, transaction_id)
            self.assertEqual(paths["journal"].read_bytes(), before)

    def test_source_checkout_has_no_managed_startup_guard(self):
        with tempfile.TemporaryDirectory() as directory:
            dashboard = Path(directory) / "Dashboard"
            dashboard.mkdir()
            self.assertEqual(
                ksp_dashboard_app.runtime_start_context(dashboard, {}),
                (None, None),
            )

    @unittest.skipUnless(os.name == "nt", "launcher mutex is Windows-specific")
    def test_only_one_launcher_instance_owns_a_package_path(self):
        with tempfile.TemporaryDirectory() as directory:
            first = ksp_dashboard_app.LauncherInstanceGuard(directory)
            try:
                with self.assertRaisesRegex(RuntimeError, "already running"):
                    ksp_dashboard_app.LauncherInstanceGuard(directory)
            finally:
                first.close()
            replacement = ksp_dashboard_app.LauncherInstanceGuard(directory)
            replacement.close()

    @unittest.skipUnless(os.name == "nt", "component process jobs are Windows-specific")
    def test_backend_stop_terminates_its_descendant_process_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child_pid_path = root / "child.pid"
            script = root / "component.py"
            script.write_text(
                "import subprocess, sys, time\n"
                f"marker = {str(child_pid_path)!r}\n"
                "child = subprocess.Popen([sys.executable, '-c', "
                "'import time; time.sleep(30)'])\n"
                "open(marker, 'w', encoding='utf-8').write(str(child.pid))\n"
                "time.sleep(30)\n",
                encoding="utf-8",
            )
            backend = ksp_dashboard_app.Backend(
                "synthetic tree", script, lambda *_args: None
            )
            self.assertTrue(backend.start())
            deadline = time.monotonic() + 10
            while not child_pid_path.is_file() and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertTrue(child_pid_path.is_file())
            child_pid = int(child_pid_path.read_text(encoding="utf-8"))
            self.assertTrue(ksp_dashboard_app.runtime_update._pid_is_running(child_pid))

            backend.stop()
            deadline = time.monotonic() + 5
            while (
                ksp_dashboard_app.runtime_update._pid_is_running(child_pid)
                and time.monotonic() < deadline
            ):
                time.sleep(0.05)
            self.assertFalse(
                ksp_dashboard_app.runtime_update._pid_is_running(child_pid)
            )


if __name__ == "__main__":
    unittest.main()
