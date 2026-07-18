import json
import io
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.modules.setdefault("krpc", types.ModuleType("krpc"))
sys.modules["krpc"].connect = lambda **_kwargs: None

serial_module = types.ModuleType("serial")
serial_tools_module = types.ModuleType("serial.tools")
serial_list_ports_module = types.ModuleType("serial.tools.list_ports")
serial_list_ports_module.comports = lambda: []
serial_tools_module.list_ports = serial_list_ports_module
serial_module.tools = serial_tools_module
serial_module.Serial = object
sys.modules.setdefault("serial", serial_module)
sys.modules.setdefault("serial.tools", serial_tools_module)
sys.modules.setdefault("serial.tools.list_ports", serial_list_ports_module)

import ksp_dashboard_app as app
import panel_bridge
import telemetry_server


def krpc_settings(
    rpc_port=50000,
    stream_port=50001,
    address="127.0.0.1",
    auto_start=True,
    auto_accept=True,
):
    return f"""KRPCConfiguration
{{
    autoStartServers = {str(auto_start)}
    autoAcceptConnections = {str(auto_accept)}
    servers
    {{
        Item
        {{
            name = Default Server
            settings
            {{
                Item
                {{
                    key = address
                    value = {address}
                }}
                Item
                {{
                    key = rpc_port
                    value = {rpc_port}
                }}
                Item
                {{
                    key = stream_port
                    value = {stream_port}
                }}
            }}
        }}
    }}
}}
"""


class KrpcPrerequisiteTests(unittest.TestCase):
    def make_root(self, directory):
        root = Path(directory) / "KSP"
        (root / "GameData" / "Squad").mkdir(parents=True)
        (root / "KSP_x64.exe").write_bytes(b"")
        (root / "readme.txt").write_text(
            "Kerbal Space Program\nVersion 1.12.5\n", encoding="utf-8"
        )
        return root

    def test_ksp_identity_reports_tested_and_untested_versions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)
            current = app.ksp_installation_inventory(root)
            self.assertEqual(current["status"], "current")
            self.assertEqual(current["version"], "1.12.5")

            (root / "readme.txt").write_text(
                "Kerbal Space Program\nVersion 1.11.2\n", encoding="utf-8"
            )
            untested = app.ksp_installation_inventory(root)
            self.assertEqual(untested["status"], "untested")
            recommendations = app.installation_recommendations(
                untested, {"status": "current", "issues": []}
            )
            self.assertIn("KSP 1.12.5", recommendations[0]["fix"])

    def test_ksp_identity_rejects_gamedata_only_folder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "KSP"
            (root / "GameData").mkdir(parents=True)
            identity = app.ksp_installation_inventory(root)
            self.assertEqual(identity["status"], "invalid")
            self.assertIn("KSP_x64.exe", identity["missing"])
            self.assertIn("GameData\\Squad", identity["missing"])

    def test_dll_layout_finds_duplicate_and_misplaced_copies(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)
            canonical = root / "GameData" / "kRPC" / "KRPC.dll"
            canonical.parent.mkdir(parents=True)
            canonical.write_bytes(b"current")
            duplicate = root / "GameData" / "OldMods" / "KRPC.dll"
            duplicate.parent.mkdir()
            duplicate.write_bytes(b"old")
            misplaced = root / "GameData" / "Nested" / "MechJeb2.dll"
            misplaced.parent.mkdir()
            misplaced.write_bytes(b"wrong place")

            inventory = app.dll_layout_inventory(root)
            self.assertEqual(inventory["status"], "issues")
            issues = {item["filename"]: item for item in inventory["issues"]}
            self.assertEqual(issues["KRPC.dll"]["kind"], "duplicate")
            self.assertEqual(issues["MechJeb2.dll"]["kind"], "misplaced")
            recommendations = app.installation_recommendations(
                app.ksp_installation_inventory(root), inventory
            )
            self.assertTrue(any("OldMods" in item["observed"] for item in recommendations))

    def install_krpc(self, root, settings=None):
        folder = root / "GameData" / "kRPC"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "KRPC.dll").write_bytes(b"krpc")
        if settings is not None:
            plugin_data = folder / "PluginData"
            plugin_data.mkdir()
            (plugin_data / "settings.cfg").write_text(
                settings, encoding="utf-8"
            )
        return folder

    def test_inventory_reports_tested_untested_and_missing_mods(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)
            krpc = self.install_krpc(root)
            (krpc / "kRPC.version").write_text(
                json.dumps(
                    {"VERSION": {"MAJOR": 0, "MINOR": 5, "PATCH": 4}}
                ),
                encoding="utf-8",
            )
            (krpc / "KRPC.MechJeb.dll").write_bytes(b"mechjeb bridge")

            def version_reader(path):
                if Path(path).name == "KRPC.MechJeb.dll":
                    return "0.8.0.0"
                return None

            inventory = {
                item["key"]: item
                for item in app.prerequisite_inventory(root, version_reader)
            }
            self.assertEqual(inventory["krpc"]["status"], "current")
            self.assertEqual(inventory["krpc_mechjeb"]["status"], "untested")
            self.assertEqual(inventory["mechjeb"]["status"], "missing")

    def test_version_comparison_ignores_trailing_zeroes(self):
        self.assertTrue(app.versions_equivalent("0.7.1.0", "0.7.1"))
        self.assertFalse(app.versions_equivalent("0.7.2", "0.7.1"))

    def test_newer_mechjeb_recommends_ckan_downgrade_to_tested_version(self):
        inventory = []
        for definition in app.KSP_PREREQUISITES:
            item = {
                **definition,
                "target": None,
                "installed_version": definition["tested_version"],
                "status": "current",
            }
            if definition["key"] == "mechjeb":
                item["installed_version"] = "2.15.0.0"
                item["status"] = "untested"
            inventory.append(item)
        recommendations = app.prerequisite_recommendations(
            inventory,
            {
                "status": "current",
                "server": {
                    "address": "127.0.0.1",
                    "rpc_port": 50000,
                    "stream_port": 50001,
                },
                "auto_start": True,
                "auto_accept": True,
            },
        )
        self.assertEqual(len(recommendations), 1)
        recommendation = recommendations[0]
        self.assertIn("Installed version 2.15.0.0", recommendation["observed"])
        self.assertIn("Tested version 2.14.3.0", recommendation["expected"])
        self.assertIn("CKAN to downgrade MechJeb 2", recommendation["fix"])
        self.assertIn("may work", recommendation["fix"])

    def test_custom_endpoint_recommendation_shows_observed_and_required_ports(self):
        inventory = [
            {
                **definition,
                "target": None,
                "installed_version": definition["tested_version"],
                "status": "current",
            }
            for definition in app.KSP_PREREQUISITES
        ]
        recommendations = app.prerequisite_recommendations(
            inventory,
            {
                "status": "custom",
                "server": {
                    "address": "127.0.0.1",
                    "rpc_port": 8090,
                    "stream_port": 8091,
                },
                "auto_start": True,
                "auto_accept": True,
            },
        )
        self.assertEqual(len(recommendations), 1)
        recommendation = recommendations[0]
        self.assertIn("RPC 8090, Stream 8091", recommendation["observed"])
        self.assertIn("RPC 50000, Stream 50001", recommendation["expected"])
        self.assertIn("reserved", recommendation["fix"])

    def test_fully_tested_setup_has_no_recommendations(self):
        inventory = [
            {
                **definition,
                "target": None,
                "installed_version": definition["tested_version"],
                "status": "current",
            }
            for definition in app.KSP_PREREQUISITES
        ]
        recommendations = app.prerequisite_recommendations(
            inventory,
            {
                "status": "current",
                "server": {
                    "address": "127.0.0.1",
                    "rpc_port": 50000,
                    "stream_port": 50001,
                },
                "auto_start": True,
                "auto_accept": True,
            },
        )
        self.assertEqual(recommendations, [])

    def test_default_configuration_and_flags_are_parsed(self):
        parsed = app.parse_krpc_settings(
            krpc_settings(auto_start=False, auto_accept=True)
        )
        self.assertFalse(parsed["auto_start"])
        self.assertTrue(parsed["auto_accept"])
        self.assertEqual(parsed["servers"][0]["rpc_port"], 50000)
        self.assertEqual(parsed["servers"][0]["stream_port"], 50001)

    def test_disabled_auto_start_creates_actionable_recommendation(self):
        inventory = [
            {
                **definition,
                "target": None,
                "installed_version": definition["tested_version"],
                "status": "current",
            }
            for definition in app.KSP_PREREQUISITES
        ]
        recommendations = app.prerequisite_recommendations(
            inventory,
            {
                "status": "current",
                "server": {
                    "address": "127.0.0.1",
                    "rpc_port": 50000,
                    "stream_port": 50001,
                },
                "auto_start": False,
                "auto_accept": True,
            },
        )
        self.assertEqual([item["key"] for item in recommendations], ["krpc.auto_start"])
        self.assertIn("Enable automatic server start", recommendations[0]["fix"])

    def test_missing_settings_use_krpc_defaults_without_claiming_flags(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)
            self.install_krpc(root)
            inventory = app.krpc_configuration_inventory(root)
            self.assertEqual(inventory["status"], "not_initialized")
            self.assertEqual(inventory["server"]["rpc_port"], 50000)
            self.assertIsNone(inventory["auto_start"])

    def test_custom_dashboard_ports_are_blocked_with_targeted_message(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)
            self.install_krpc(root, krpc_settings(8090, 8091))
            preflight = app.component_preflight(
                root,
                "feed",
                port_open=lambda _address, _port: False,
                dashboard_port_available=lambda _port: False,
            )
            self.assertEqual(len(preflight["errors"]), 1)
            message = preflight["errors"][0]
            self.assertIn("RPC 8090 and Stream 8091", message)
            self.assertIn("reserves port 8090", message)
            self.assertIn("RPC 50000 / Stream 50001", message)

    def test_closed_krpc_port_is_a_waiting_warning_not_an_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)
            self.install_krpc(root, krpc_settings())
            preflight = app.component_preflight(
                root,
                "feed",
                port_open=lambda _address, _port: False,
                dashboard_port_available=lambda _port: True,
            )
            self.assertEqual(preflight["errors"], [])
            self.assertTrue(
                any("try 10 times" in warning for warning in preflight["warnings"])
            )

    def test_busy_dashboard_port_blocks_only_the_feed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)
            self.install_krpc(root, krpc_settings())
            common = {
                "port_open": lambda _address, _port: True,
                "dashboard_port_available": lambda _port: False,
            }
            feed = app.component_preflight(root, "feed", **common)
            panel = app.component_preflight(root, "panel", **common)
            self.assertTrue(any("already in use" in error for error in feed["errors"]))
            self.assertEqual(panel["errors"], [])

    def test_missing_base_krpc_blocks_start(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)
            preflight = app.component_preflight(
                root,
                "feed",
                port_open=lambda _address, _port: False,
                dashboard_port_available=lambda _port: True,
            )
            self.assertTrue(
                any("kRPC is missing" in error for error in preflight["errors"])
            )

    def test_connection_refused_message_explains_both_port_pairs(self):
        message = telemetry_server.krpc_wait_message(ConnectionRefusedError())
        self.assertIn("RPC 50000 / Stream 50001", message)
        self.assertIn("Port 8090", message)
        self.assertIn("main menu is not enough", message)

    def test_live_probe_reports_registered_services_and_closes(self):
        class Status:
            version = "0.5.4"

        class KrpcService:
            @staticmethod
            def get_status():
                return Status()

        class Connection:
            krpc = KrpcService()
            space_center = object()
            stage_stats = object()
            closed = False

            def close(self):
                self.closed = True

        connection = Connection()
        result = app.probe_krpc_connection(
            lambda **_kwargs: connection
        )
        self.assertEqual(result["server_version"], "0.5.4")
        self.assertTrue(result["services"]["space_center"])
        self.assertTrue(result["services"]["stage_stats"])
        self.assertFalse(result["services"]["mech_jeb"])
        self.assertTrue(connection.closed)

    def test_telemetry_retry_is_bounded_and_emits_exhausted_event(self):
        attempts = []
        sleeps = []

        def connector(name):
            attempts.append(name)
            raise ConnectionRefusedError()

        output = io.StringIO()
        with redirect_stdout(output):
            connection = telemetry_server.connect_krpc_with_retry(
                "Test", connector=connector, attempts=3,
                retry_seconds=0.25, sleeper=sleeps.append,
            )
        self.assertIsNone(connection)
        self.assertEqual(len(attempts), 3)
        self.assertEqual(sleeps, [0.25, 0.25])
        self.assertIn(telemetry_server.KRPC_RETRY_EXHAUSTED_EVENT, output.getvalue())

    def test_panel_retry_is_bounded_and_emits_exhausted_event(self):
        attempts = []
        sleeps = []

        def connector(**kwargs):
            attempts.append(kwargs["name"])
            raise ConnectionRefusedError()

        output = io.StringIO()
        with redirect_stdout(output):
            connection = panel_bridge.connect_krpc_with_retry(
                connector=connector, attempts=2,
                retry_seconds=0.5, sleeper=sleeps.append,
            )
        self.assertIsNone(connection)
        self.assertEqual(len(attempts), 2)
        self.assertEqual(sleeps, [0.5])
        self.assertIn(panel_bridge.KRPC_RETRY_EXHAUSTED_EVENT, output.getvalue())

    def test_malformed_configuration_is_reported_as_invalid(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.make_root(directory)
            self.install_krpc(root, "KRPCConfiguration\n{\nservers\n{")
            inventory = app.krpc_configuration_inventory(root)
            self.assertEqual(inventory["status"], "invalid")
            self.assertIn("unclosed", inventory["error"])


if __name__ == "__main__":
    unittest.main()
