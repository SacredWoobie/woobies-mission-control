import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ksp_dashboard_app as app


class FakeWidget:
    def __init__(self):
        self.options = {}

    def config(self, **options):
        self.options.update(options)


class FakeRoot:
    def __init__(self):
        self.after_calls = []

    def after(self, delay, callback):
        self.after_calls.append((delay, callback))


class FakeBackend:
    def __init__(self, running=True):
        self.is_running = running
        self.startup_ready = False

    def running(self):
        return self.is_running


class LauncherReadinessTests(unittest.TestCase):
    def make_launcher(self, backend, dashboard=True):
        launcher = app.App.__new__(app.App)
        launcher.root = FakeRoot()
        launcher.component_setups = set()
        launcher.backend_rows = [{
            "component": {
                "name": "feed" if dashboard else "panel",
                "dashboard": dashboard,
            },
            "backend": backend,
            "status": FakeWidget(),
            "button": FakeWidget(),
        }]
        return launcher

    def test_feed_stays_starting_until_loopback_is_ready_then_latches(self):
        backend = FakeBackend()
        launcher = self.make_launcher(backend)
        launcher._dashboard_ready = mock.Mock(side_effect=[False, True])

        launcher._refresh()
        row = launcher.backend_rows[0]
        self.assertEqual(row["status"].options["text"], "starting...")
        self.assertEqual(row["button"].options["text"], "Stop")

        launcher._refresh()
        self.assertEqual(row["status"].options["text"], "\u25cf running")
        self.assertTrue(backend.startup_ready)

        launcher._refresh()
        self.assertEqual(launcher._dashboard_ready.call_count, 2)

    def test_stopped_process_clears_latched_readiness(self):
        backend = FakeBackend(running=False)
        backend.startup_ready = True
        launcher = self.make_launcher(backend)

        with mock.patch.object(app, "component_dependencies_ready", return_value=True):
            launcher._refresh()

        row = launcher.backend_rows[0]
        self.assertEqual(row["status"].options["text"], "\u25cb stopped")
        self.assertFalse(backend.startup_ready)


if __name__ == "__main__":
    unittest.main()
