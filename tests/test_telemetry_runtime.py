import importlib.util
import json
import sys
import tempfile
import unittest
from http import HTTPStatus
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location(
    "telemetry_runtime_tests",
    ROOT / "telemetry_runtime.py",
)
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)

from planner_persistence import PlannerPersistence


class FakeLogRecord:
    def __init__(self, message, exc_info):
        self._message = message
        self.exc_info = exc_info

    def getMessage(self):
        return self._message


class TelemetryRuntimeTests(unittest.TestCase):
    def test_canonical_host_validation_is_exact(self):
        self.assertTrue(runtime.allowed_host_header("127.0.0.1:8090", "127.0.0.1", 8090))
        self.assertFalse(runtime.allowed_host_header("localhost:8090", "127.0.0.1", 8090))
        self.assertFalse(runtime.allowed_host_header("attacker.example", "127.0.0.1", 8090))

    def test_origin_validation_is_listener_specific(self):
        self.assertTrue(runtime.allowed_origin_header(None, "192.168.1.50", 8090))
        self.assertTrue(
            runtime.allowed_origin_header(
                "http://192.168.1.50:8090", "192.168.1.50", 8090
            )
        )
        self.assertFalse(
            runtime.allowed_origin_header(
                "http://127.0.0.1:8090", "192.168.1.50", 8090
            )
        )

    def test_is_local_network_address_accepts_loopback_and_rfc1918(self):
        for address in (
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
        ):
            self.assertTrue(runtime.is_local_network_address(address), address)

    def test_is_local_network_address_rejects_non_private(self):
        for address in (
            "172.32.0.1",
            "8.8.8.8",
            "169.254.1.1",
            "0.0.0.0",
            "not-an-ip",
            "",
        ):
            self.assertFalse(runtime.is_local_network_address(address), address)

    def test_bind_host_allowed(self):
        self.assertTrue(runtime.bind_host_allowed("127.0.0.1"))
        self.assertTrue(runtime.bind_host_allowed("192.168.1.50"))
        self.assertFalse(runtime.bind_host_allowed("0.0.0.0"))
        self.assertFalse(runtime.bind_host_allowed("localhost"))
        self.assertFalse(runtime.bind_host_allowed("8.8.8.8"))

    def test_remote_address_allowed(self):
        self.assertTrue(runtime.remote_address_allowed(("127.0.0.1", 54321)))
        self.assertTrue(runtime.remote_address_allowed(("192.168.1.5", 54321)))
        self.assertFalse(runtime.remote_address_allowed(("8.8.8.8", 54321)))
        self.assertFalse(runtime.remote_address_allowed(None))
        self.assertFalse(runtime.remote_address_allowed(()))

    def test_remote_address_must_match_listener_class(self):
        self.assertTrue(
            runtime.remote_address_allowed(("127.0.0.1", 5000), "127.0.0.1")
        )
        self.assertFalse(
            runtime.remote_address_allowed(("192.168.1.20", 5000), "127.0.0.1")
        )
        self.assertTrue(
            runtime.remote_address_allowed(("192.168.1.20", 5000), "192.168.1.50")
        )
        self.assertFalse(
            runtime.remote_address_allowed(("127.0.0.1", 5000), "192.168.1.50")
        )
        self.assertFalse(
            runtime.remote_address_allowed(("8.8.8.8", 5000), "192.168.1.50")
        )

    def test_detect_lan_address_returns_private_candidate(self):
        class FakeSocket:
            def settimeout(self, _value):
                pass

            def connect(self, _address):
                pass

            def getsockname(self):
                return ("192.168.50.7", 0)

            def close(self):
                pass

        self.assertEqual(
            runtime.detect_lan_address(probe_factory=FakeSocket), "192.168.50.7"
        )

    def test_detect_lan_address_rejects_non_private_result(self):
        class FakeSocket:
            def settimeout(self, _value):
                pass

            def connect(self, _address):
                pass

            def getsockname(self):
                return ("8.8.8.8", 0)

            def close(self):
                pass

        self.assertIsNone(runtime.detect_lan_address(probe_factory=FakeSocket))

    def test_detect_lan_address_returns_none_on_socket_error(self):
        def failing_factory():
            raise OSError("no network")

        self.assertIsNone(runtime.detect_lan_address(probe_factory=failing_factory))

    def test_detect_lan_addresses_prioritizes_route_and_deduplicates(self):
        self.assertEqual(
            runtime.detect_lan_addresses(
                route_detector=lambda: "192.168.1.50",
                hostname_factory=lambda: "host",
                hostname_resolver=lambda _host: (
                    "host",
                    [],
                    ["10.10.0.4", "192.168.1.50", "127.0.0.1", "8.8.8.8"],
                ),
            ),
            ("192.168.1.50", "10.10.0.4"),
        )

    def test_private_lan_predicate_rejects_loopback_wildcard_public_and_ipv6(self):
        self.assertTrue(runtime.is_private_lan_address("172.20.1.5"))
        for address in ("127.0.0.1", "0.0.0.0", "8.8.8.8", "::1"):
            self.assertFalse(runtime.is_private_lan_address(address), address)

    def test_is_handshake_noise_ignores_unrelated_messages(self):
        record = FakeLogRecord("connection handler failed", (EOFError, EOFError(), None))
        self.assertFalse(runtime.is_handshake_noise(record))

    def test_is_handshake_noise_ignores_records_without_exception(self):
        record = FakeLogRecord("opening handshake failed", None)
        self.assertFalse(runtime.is_handshake_noise(record))

    def test_is_handshake_noise_matches_eof_during_handshake(self):
        record = FakeLogRecord("opening handshake failed", (EOFError, EOFError(), None))
        self.assertTrue(runtime.is_handshake_noise(record))

    def test_is_handshake_noise_matches_invalid_message(self):
        from websockets.exceptions import InvalidMessage

        record = FakeLogRecord(
            "opening handshake failed",
            (InvalidMessage, InvalidMessage("did not receive a valid HTTP request"), None),
        )
        self.assertTrue(runtime.is_handshake_noise(record))

    def test_is_handshake_noise_leaves_genuine_errors_visible(self):
        record = FakeLogRecord(
            "opening handshake failed", (ValueError, ValueError("boom"), None)
        )
        self.assertFalse(runtime.is_handshake_noise(record))

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

    def test_server_requires_loopback_primary_and_private_additional_hosts(self):
        connections = []

        def baseline(_target, _root=None):
            return HTTPStatus.OK, "text/html", "no-cache", b"ok"

        _dashboard_asset, server = runtime.create_telemetry_runtime(
            baseline,
            lambda name: connections.append(name),
            lambda _conn: {},
            lambda _conn, _command: None,
            ROOT / "web",
            4,
        )

        self.assertFalse(server("192.168.1.50", 8090))
        self.assertFalse(server("127.0.0.1", 8090, ("0.0.0.0",)))
        self.assertFalse(server("127.0.0.1", 8090, ("8.8.8.8",)))
        self.assertEqual(connections, [])

    def test_dual_listeners_bind_before_krpc_and_share_security_and_commands(self):
        registrations = []
        applied_commands = []
        connection_calls = []
        handler_exercised = False
        real_asyncio_sleep = runtime.asyncio.sleep

        class FakeSocket:
            def __init__(self):
                self.messages = [
                    json.dumps(
                        {
                            "type": "overview.vessel.lifecycle",
                            "requestId": "lan-command-1",
                        }
                    )
                ]
                self.release = runtime.asyncio.Event()

            def __aiter__(self):
                return self

            async def __anext__(self):
                if self.messages:
                    return self.messages.pop(0)
                await self.release.wait()
                raise StopAsyncIteration

            async def send(self, _payload):
                pass

        class FakeServerContext:
            def __init__(self, registration):
                self.registration = registration
                self.socket = None
                self.handler_task = None

            async def __aenter__(self):
                nonlocal handler_exercised
                if not handler_exercised:
                    handler_exercised = True
                    self.socket = FakeSocket()
                    self.handler_task = runtime.asyncio.create_task(
                        self.registration["handler"](self.socket)
                    )
                    await real_asyncio_sleep(0)
                return self

            async def __aexit__(self, _exc_type, _exc, _traceback):
                if self.handler_task is not None:
                    self.socket.release.set()
                    await self.handler_task
                return False

        def fake_serve(handler, host, port, **options):
            registration = {
                "handler": handler,
                "host": host,
                "port": port,
                **options,
            }
            registrations.append(registration)
            return FakeServerContext(registration)

        def connect(name):
            connection_calls.append((name, len(registrations)))
            return "shared-krpc"

        def apply_command(connection, command):
            applied_commands.append((connection, command))
            return {"type": "command.accepted"}

        async def stop_after_first_cycle(_interval):
            raise RuntimeError("stop integration server")

        def baseline(_target, _root=None):
            return HTTPStatus.OK, "text/html", "no-cache", b"dashboard"

        class FakeStore:
            path = Path("test-planner-store.json")

        with tempfile.TemporaryDirectory() as temporary:
            web_root = Path(temporary)
            (web_root / "index.html").write_text("dashboard", encoding="utf-8")
            _asset, server = runtime.create_telemetry_runtime(
                baseline,
                connect,
                lambda _conn: {},
                apply_command,
                web_root,
                4,
            )
            with (
                mock.patch("websockets.serve", side_effect=fake_serve),
                mock.patch.object(runtime.asyncio, "sleep", stop_after_first_cycle),
                mock.patch.object(runtime, "PlannerPersistence", return_value=FakeStore()),
            ):
                self.assertFalse(server("127.0.0.1", 8090, ("192.168.1.50",)))

        self.assertEqual(
            [(item["host"], item["port"]) for item in registrations],
            [("127.0.0.1", 8090), ("192.168.1.50", 8090)],
        )
        self.assertIs(registrations[0]["handler"], registrations[1]["handler"])
        self.assertEqual(connection_calls, [("KSP Dashboard Telemetry", 2)])
        self.assertEqual(applied_commands[0][0], "shared-krpc")
        self.assertEqual(
            applied_commands[0][1]["type"], "overview.vessel.lifecycle"
        )

        loopback_policy = registrations[0]["process_request"]
        lan_policy = registrations[1]["process_request"]

        def websocket_request(host, origin):
            return SimpleNamespace(
                headers={"Host": host, "Upgrade": "websocket", "Origin": origin},
                path="/",
            )

        self.assertIsNone(
            loopback_policy(
                SimpleNamespace(remote_address=("127.0.0.1", 5000)),
                websocket_request(
                    "127.0.0.1:8090", "http://127.0.0.1:8090"
                ),
            )
        )
        self.assertIsNone(
            lan_policy(
                SimpleNamespace(remote_address=("192.168.1.25", 5000)),
                websocket_request(
                    "192.168.1.50:8090", "http://192.168.1.50:8090"
                ),
            )
        )
        rejected_peer = loopback_policy(
            SimpleNamespace(remote_address=("192.168.1.25", 5000)),
            websocket_request("127.0.0.1:8090", "http://127.0.0.1:8090"),
        )
        rejected_host = lan_policy(
            SimpleNamespace(remote_address=("192.168.1.25", 5000)),
            websocket_request("127.0.0.1:8090", "http://192.168.1.50:8090"),
        )
        rejected_origin = lan_policy(
            SimpleNamespace(remote_address=("192.168.1.25", 5000)),
            websocket_request("192.168.1.50:8090", "http://127.0.0.1:8090"),
        )
        self.assertEqual(rejected_peer.status_code, HTTPStatus.FORBIDDEN)
        self.assertEqual(rejected_host.status_code, HTTPStatus.FORBIDDEN)
        self.assertEqual(rejected_origin.status_code, HTTPStatus.FORBIDDEN)

    def test_packaged_server_source_contains_origin_csp_and_session_guards(self):
        source = (ROOT / "telemetry_runtime.py").read_text(encoding="utf-8")
        for marker in (
            "origins=[origin, None]",
            "AsyncExitStack",
            "remote_address_allowed(",
            "allowed_origin_header(",
            'logging.getLogger("websockets.server").addFilter(_HandshakeNoiseFilter())',
            "Content-Security-Policy",
            "Queue(maxsize=MAX_PENDING_COMMANDS)",
            "sessions.get(ws) != session_id",
            '"overview.vessel.switch"',
            '"overview.vessel.edit"',
            '"overview.vessel.lifecycle"',
            '"science.alarm.create"',
            '"science.lab.research"',
            '"science.lab.transmit"',
            '"target.clear"',
            "if isinstance(event, dict)",
            'event.get("status") in {"merged", "updated"}',
        ):
            self.assertIn(marker, source)


if __name__ == "__main__":
    unittest.main()
