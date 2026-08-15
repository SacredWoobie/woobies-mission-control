import tempfile
import unittest
from unittest import mock
from http import HTTPStatus
from pathlib import Path

import telemetry_server


class DashboardLoopbackTests(unittest.TestCase):
    def test_server_main_keeps_loopback_when_lan_is_enabled(self):
        with (
            mock.patch.object(telemetry_server.sys, "argv", ["telemetry_server.py"]),
            mock.patch.object(telemetry_server, "ALLOW_LAN_ENABLED", True),
            mock.patch.object(telemetry_server, "LAN_BIND_ADDRESS", "192.168.1.50"),
            mock.patch.object(
                telemetry_server, "run_telemetry_server", return_value=True
            ) as run,
        ):
            self.assertEqual(telemetry_server.main(), 0)
        run.assert_called_once_with("127.0.0.1", 8090, "192.168.1.50")

    def test_server_main_fails_closed_when_enabled_without_selected_address(self):
        with (
            mock.patch.object(telemetry_server.sys, "argv", ["telemetry_server.py"]),
            mock.patch.object(telemetry_server, "ALLOW_LAN_ENABLED", True),
            mock.patch.object(telemetry_server, "LAN_BIND_ADDRESS", ""),
            mock.patch.object(telemetry_server, "run_telemetry_server") as run,
        ):
            self.assertEqual(telemetry_server.main(), 2)
        run.assert_not_called()

    def test_explicit_cli_host_is_an_additional_listener(self):
        with (
            mock.patch.object(
                telemetry_server.sys,
                "argv",
                ["telemetry_server.py", "10.0.0.5", "9000"],
            ),
            mock.patch.object(telemetry_server, "ALLOW_LAN_ENABLED", False),
            mock.patch.object(
                telemetry_server, "run_telemetry_server", return_value=True
            ) as run,
        ):
            self.assertEqual(telemetry_server.main(), 0)
        run.assert_called_once_with("127.0.0.1", 9000, "10.0.0.5")

    def test_serves_index_and_hashed_assets_with_expected_cache_policy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            (root / "index.html").write_text("<main>Mission Control</main>", encoding="utf-8")
            (root / "assets" / "app-123.js").write_text("export {};", encoding="utf-8")

            index = telemetry_server.dashboard_asset("/?launch=1", root)
            asset = telemetry_server.dashboard_asset("/assets/app-123.js", root)

            self.assertEqual(index[0], HTTPStatus.OK)
            self.assertEqual(index[1], "text/html; charset=utf-8")
            self.assertEqual(index[2], "no-cache")
            self.assertIn(b"Mission Control", index[3])
            self.assertEqual(asset[0], HTTPStatus.OK)
            self.assertEqual(asset[1], "text/javascript; charset=utf-8")
            self.assertIn("immutable", asset[2])

    def test_rejects_missing_and_parent_traversal_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "index.html").write_text("safe", encoding="utf-8")

            missing = telemetry_server.dashboard_asset("/missing.js", root)
            traversal = telemetry_server.dashboard_asset("/%2e%2e/secret.txt", root)

            self.assertEqual(missing[0], HTTPStatus.NOT_FOUND)
            self.assertEqual(traversal[0], HTTPStatus.NOT_FOUND)

    def test_krpc_retry_remains_bounded_and_reports_success(self):
        attempts = []
        sleeps = []

        def connector(name):
            attempts.append(name)
            if len(attempts) < 3:
                raise ConnectionRefusedError()
            return "connected"

        result = telemetry_server.connect_krpc_with_retry(
            "test",
            connector=connector,
            attempts=3,
            retry_seconds=0.25,
            sleeper=sleeps.append,
        )

        self.assertEqual(result, "connected")
        self.assertEqual(attempts, ["test", "test", "test"])
        self.assertEqual(sleeps, [0.25, 0.25])


if __name__ == "__main__":
    unittest.main()
