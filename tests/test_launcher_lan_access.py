import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ksp_dashboard_app as app_module


class FakeVar:
    def __init__(self, value):
        self.value = value

    def get(self):
        return self.value

    def set(self, value):
        self.value = value


class FakeBackend:
    def __init__(self, running=False):
        self.is_running = running
        self.stop_calls = 0

    def running(self):
        return self.is_running

    def stop(self):
        self.stop_calls += 1
        self.is_running = False


class FakeRoot:
    def __init__(self):
        self.clipboard = None

    def clipboard_clear(self):
        self.clipboard = ""

    def clipboard_append(self, value):
        self.clipboard += value

    def update_idletasks(self):
        pass


def build_app(*, enabled=False, acknowledgement=0, backend_running=False):
    instance = app_module.App.__new__(app_module.App)
    instance.settings = {
        "ksp_root": "",
        "lan_access_enabled": enabled,
        "lan_bind_address": "192.168.1.50",
        "lan_warning_ack_version": acknowledgement,
    }
    instance.settings_path = Path("unused-settings.json")
    instance.lan_access_var = FakeVar(enabled)
    instance.lan_address_var = FakeVar("192.168.1.50")
    instance.lan_addresses = ("192.168.1.50", "10.0.0.5")
    backend = FakeBackend(backend_running)
    instance.backend_rows = [
        {
            "component": {"name": "feed"},
            "backend": backend,
        }
    ]
    instance._enqueue = mock.Mock()
    instance._update_lan_address_status = mock.Mock()
    instance.root = FakeRoot()
    return instance, backend


class LauncherLanAccessTests(unittest.TestCase):
    def test_warning_copy_and_unchecked_default_are_explicit(self):
        source = (ROOT / "ksp_dashboard_app.py").read_text(encoding="utf-8")
        for marker in (
            'dialog.title("Enable trusted-LAN dashboard access?")',
            "There is no authentication and traffic is not encrypted.",
            "finances, contracts, notes",
            "vessel recovery or termination",
            '"controls, and maneuver-node creation."',
            '"Remember that I understand this warning"',
            "remember_var = tk.BooleanVar(value=False)",
        ):
            self.assertIn(marker, source)

    @mock.patch.object(app_module.messagebox, "showerror")
    @mock.patch.object(app_module, "save_settings")
    def test_cancel_reverts_toggle_without_saving(self, save, _showerror):
        instance, backend = build_app(backend_running=True)
        instance.lan_access_var.set(True)
        instance._show_lan_access_warning = mock.Mock(return_value=(False, False))

        instance._toggle_lan_access()

        self.assertFalse(instance.lan_access_var.get())
        self.assertFalse(instance.settings["lan_access_enabled"])
        save.assert_not_called()
        self.assertEqual(backend.stop_calls, 0)

    @mock.patch.object(app_module.messagebox, "showerror")
    @mock.patch.object(app_module, "save_settings")
    def test_unremembered_warning_is_shown_on_every_enable(self, _save, _showerror):
        instance, _backend = build_app()
        instance._show_lan_access_warning = mock.Mock(return_value=(True, False))

        instance.lan_access_var.set(True)
        instance._toggle_lan_access()
        instance.lan_access_var.set(False)
        instance._toggle_lan_access()
        instance.lan_access_var.set(True)
        instance._toggle_lan_access()

        self.assertEqual(instance._show_lan_access_warning.call_count, 2)
        self.assertEqual(instance.settings["lan_warning_ack_version"], 0)
        self.assertTrue(instance.settings["lan_access_enabled"])

    @mock.patch.object(app_module.messagebox, "showerror")
    @mock.patch.object(app_module, "save_settings")
    def test_remembered_warning_suppresses_later_enable(self, _save, _showerror):
        instance, _backend = build_app()
        instance._show_lan_access_warning = mock.Mock(return_value=(True, True))

        instance.lan_access_var.set(True)
        instance._toggle_lan_access()
        instance.lan_access_var.set(False)
        instance._toggle_lan_access()
        instance.lan_access_var.set(True)
        instance._toggle_lan_access()

        self.assertEqual(instance._show_lan_access_warning.call_count, 1)
        self.assertEqual(
            instance.settings["lan_warning_ack_version"],
            app_module.LAN_WARNING_ACK_VERSION,
        )

    @mock.patch.object(app_module.messagebox, "showerror")
    @mock.patch.object(app_module, "save_settings")
    def test_old_acknowledgement_version_requires_warning(self, _save, _showerror):
        instance, _backend = build_app(
            acknowledgement=app_module.LAN_WARNING_ACK_VERSION - 1
        )
        instance._show_lan_access_warning = mock.Mock(return_value=(True, False))
        instance.lan_access_var.set(True)

        instance._toggle_lan_access()

        instance._show_lan_access_warning.assert_called_once_with()

    @mock.patch.object(app_module.messagebox, "showerror")
    @mock.patch.object(app_module, "save_settings", side_effect=OSError("disk full"))
    def test_persistence_failure_does_not_enable_or_remember(self, _save, showerror):
        instance, backend = build_app(backend_running=True)
        instance._show_lan_access_warning = mock.Mock(return_value=(True, True))
        instance.lan_access_var.set(True)

        instance._toggle_lan_access()

        self.assertFalse(instance.lan_access_var.get())
        self.assertFalse(instance.settings["lan_access_enabled"])
        self.assertEqual(instance.settings["lan_warning_ack_version"], 0)
        self.assertEqual(backend.stop_calls, 0)
        showerror.assert_called_once()

    @mock.patch.object(app_module.messagebox, "showerror")
    @mock.patch.object(app_module, "save_settings")
    def test_enabling_stops_running_feed_after_setting_is_saved(self, _save, _showerror):
        instance, backend = build_app(backend_running=True)
        instance._show_lan_access_warning = mock.Mock(return_value=(True, False))
        instance.lan_access_var.set(True)

        instance._toggle_lan_access()

        self.assertEqual(backend.stop_calls, 1)
        self.assertTrue(instance.settings["lan_access_enabled"])

    @mock.patch.object(app_module.messagebox, "showerror")
    @mock.patch.object(app_module, "save_settings")
    def test_selecting_a_new_address_stops_feed_and_persists(self, _save, _showerror):
        instance, backend = build_app(enabled=True, backend_running=True)
        instance.lan_address_var.set("10.0.0.5")

        instance._select_lan_address()

        self.assertEqual(backend.stop_calls, 1)
        self.assertEqual(instance.settings["lan_bind_address"], "10.0.0.5")

    @mock.patch.object(app_module.messagebox, "showerror")
    def test_copy_lan_url_uses_selected_active_address(self, _showerror):
        instance, _backend = build_app()

        instance._copy_lan_url()

        self.assertEqual(instance.root.clipboard, "http://192.168.1.50:8090/")
        self.assertIn("copied trusted-LAN", instance._enqueue.call_args.args[1])

    def test_preflight_rejects_stale_and_unavailable_lan_endpoints(self):
        common = {
            "port_open": lambda *_args: True,
            "dashboard_port_available": lambda *_args: True,
            "lan_access_enabled": True,
            "lan_bind_address": "192.168.1.50",
            "lan_address_provider": lambda: ("10.0.0.5",),
        }
        stale = app_module.component_preflight("", "feed", **common)
        self.assertTrue(any("no longer active" in item for item in stale["errors"]))

        common["lan_address_provider"] = lambda: ("192.168.1.50",)
        common["dashboard_port_available"] = (
            lambda _port, address=app_module.KRPC_ADDRESS: address
            != "192.168.1.50"
        )
        busy = app_module.component_preflight("", "feed", **common)
        self.assertTrue(any("cannot be bound" in item for item in busy["errors"]))


if __name__ == "__main__":
    unittest.main()
