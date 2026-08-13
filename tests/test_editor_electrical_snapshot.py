import base64
import unittest
from unittest import mock

import telemetry_server
from editor_electrical_snapshot import decode_editor_electrical_snapshot


def b(value):
    return base64.b64encode(value.encode()).decode()


def snapshot(*, craft="craft-1", root="root-1", revision=1,
             status="ready", rate="0"):
    components = [] if status == "empty" else [
        "\t".join(["C", b("part:module"), "42", b("Battery"),
                   b("ModuleBattery"), b("storage"), "consumer", rate,
                   "1", "1", "0", "1"]),
    ]
    return [
        "\t".join(["WEE1", "1", status, "stock", b("1.0"),
                   b("Save"), craft, root, str(revision), "fp",
                   "10", "20", str(len(components)), "1", b("")]),
        *components,
        "\t".join(["B", b("Kerbin"), b("Kerbol"), "3.5", "600000",
                   "21600", "70000", "84159286", "13599840256", "1", "1"]),
    ]


class Service:
    def __init__(self):
        self.calls = 0
        self.payload = snapshot()

    def snapshot(self):
        self.calls += 1
        return self.payload


class Connection:
    def __init__(self, service):
        self.editor_electrical = service


class EditorElectricalSnapshotTests(unittest.TestCase):
    def setUp(self):
        telemetry_server._reset_editor_electrical_state()
        telemetry_server._editor_identity = None
        telemetry_server._editor_rebuild_cache = {}

    def test_decodes_complete_snapshot(self):
        result = decode_editor_electrical_snapshot(snapshot())
        self.assertEqual(result["editor.elec.backend"], "stock")
        self.assertEqual(result["editor.elec.saveFolder"], "Save")
        self.assertEqual(result["editor.elec.components"][0]["partId"], "42")
        self.assertTrue(result["editor.elec.bodies"][0]["authoritative"])
        self.assertIn("gravitationalParameter", result["editor.elec.bodies"][0])
        self.assertEqual(result["editor.elec.bodies"][0]["solarDistance"], 13599840256)
        self.assertEqual(result["editor.elec.bodies"][0]["solarEfficiency"], 1)
        self.assertNotIn("mu", result["editor.elec.bodies"][0])

    def test_rejects_atomic_count_and_enum_failures(self):
        bad = snapshot()
        bad[0] = bad[0].replace("\t1\t1\t", "\t2\t1\t", 1)
        with self.assertRaises(ValueError):
            decode_editor_electrical_snapshot(bad)

    def test_rejects_declared_and_encoded_bounds(self):
        bad = snapshot()
        fields = bad[0].split("\t")
        fields[12] = "4097"
        bad[0] = "\t".join(fields)
        with self.assertRaises(ValueError):
            decode_editor_electrical_snapshot(bad)
        bad = snapshot()
        fields = bad[1].split("\t")
        fields[3] = b("x" * 4097)
        bad[1] = "\t".join(fields)
        with self.assertRaises(ValueError):
            decode_editor_electrical_snapshot(bad)
        bad = snapshot()
        bad[1] = bad[1].replace("\tconsumer\t0", "\tbad-role\t0")
        with self.assertRaises(ValueError):
            decode_editor_electrical_snapshot(bad)

    def test_cache_retry_and_cross_craft_retention(self):
        service = Service()
        conn = Connection(service)
        telemetry_server._editor_identity = ("Save", "craft-1", "root-1")
        with mock.patch.object(telemetry_server.time, "time", side_effect=[1, 1.1, 1.3, 1.4, 2.5]):
            first = telemetry_server._attach_editor_electrical(
                conn, {"editor.revision": 1}
            )
            cached = telemetry_server._attach_editor_electrical(
                conn, {"editor.revision": 1}
            )
            service.payload = ["bad"]
            retained = telemetry_server._attach_editor_electrical(
                conn, {"editor.revision": 2}
            )
            throttled = telemetry_server._attach_editor_electrical(
                conn, {"editor.revision": 2}
            )
            service.payload = snapshot(craft="craft-2", revision=2)
            telemetry_server._editor_identity = ("Save", "craft-2", "root-1")
            changed = telemetry_server._attach_editor_electrical(
                conn, {"editor.revision": 2}
            )
        self.assertEqual(service.calls, 3)
        self.assertEqual(first["editor.elec.craftPersistentId"], "craft-1")
        self.assertEqual(cached["editor.elec.craftPersistentId"], "craft-1")
        self.assertTrue(retained["editor.elec.retained"])
        self.assertTrue(throttled["editor.elec.retained"])
        self.assertEqual(changed["editor.elec.craftPersistentId"], "craft-2")

    def test_warming_retries_once_per_second_until_ready_on_same_craft(self):
        service = Service()
        service.payload = snapshot(status="warming")
        conn = Connection(service)
        telemetry_server._editor_identity = ("Save", "craft-1", "root-1")
        with mock.patch.object(telemetry_server.time, "time", side_effect=[1.0, 1.5, 2.0, 2.5]):
            warming = telemetry_server._attach_editor_electrical(conn, {"editor.revision": 1})
            cached_warming = telemetry_server._attach_editor_electrical(conn, {"editor.revision": 1})
            service.payload = snapshot(status="ready")
            ready = telemetry_server._attach_editor_electrical(conn, {"editor.revision": 1})
            cached_ready = telemetry_server._attach_editor_electrical(conn, {"editor.revision": 1})

        self.assertEqual(service.calls, 2)
        self.assertEqual(warming["editor.elec.status"], "warming")
        self.assertFalse(warming["editor.elec.retained"])
        self.assertEqual(cached_warming["editor.elec.status"], "warming")
        self.assertEqual(ready["editor.elec.status"], "ready")
        self.assertFalse(ready["editor.elec.retained"])
        self.assertEqual(cached_ready["editor.elec.status"], "ready")
        self.assertFalse(cached_ready["editor.elec.retained"])

    def test_terminal_electrical_states_receive_bounded_refresh(self):
        for status in ("ready", "empty", "degraded", "unavailable"):
            with self.subTest(status=status):
                telemetry_server._reset_editor_electrical_state()
                service = Service()
                service.payload = snapshot(status=status)
                conn = Connection(service)
                telemetry_server._editor_identity = ("Save", "craft-1", "root-1")
                with mock.patch.object(telemetry_server.time, "time", side_effect=[1.0, 2.5]):
                    first = telemetry_server._attach_editor_electrical(conn, {"editor.revision": 1})
                    cached = telemetry_server._attach_editor_electrical(conn, {"editor.revision": 1})
                self.assertEqual(service.calls, 2)
                self.assertEqual(first["editor.elec.status"], status)
                self.assertEqual(cached["editor.elec.status"], status)

    def test_same_identity_rate_change_refreshes_without_editor_event(self):
        service = Service()
        conn = Connection(service)
        telemetry_server._editor_identity = ("Save", "craft-1", "root-1")
        with mock.patch.object(telemetry_server.time, "time",
                               side_effect=[1.0, 1.5, 2.0]):
            inactive = telemetry_server._attach_editor_electrical(
                conn, {"editor.revision": 1}
            )
            cached = telemetry_server._attach_editor_electrical(
                conn, {"editor.revision": 1}
            )
            service.payload = snapshot(revision=2, rate="1.25")
            active = telemetry_server._attach_editor_electrical(
                conn, {"editor.revision": 1}
            )
        self.assertEqual(service.calls, 2)
        self.assertEqual(
            inactive["editor.elec.components"][0]["referenceEcPerSec"], 0
        )
        self.assertEqual(
            cached["editor.elec.components"][0]["referenceEcPerSec"], 0
        )
        self.assertEqual(
            active["editor.elec.components"][0]["referenceEcPerSec"], 1.25
        )

    def test_missing_stage_identity_clears_rooted_snapshot_for_new_craft(self):
        service = Service()
        conn = Connection(service)
        telemetry_server._editor_identity = ("Save", "craft-1", "root-1")
        with mock.patch.object(telemetry_server.time, "time",
                               side_effect=[1.0, 1.1, 2.2]):
            prior = telemetry_server._attach_editor_electrical(
                conn, {"editor.revision": 1}
            )
            telemetry_server._editor_identity = None
            missing = telemetry_server._attach_editor_electrical(
                conn, {"editor.revision": 2}
            )
            service.payload = snapshot(
                craft="craft-2", root="", revision=2, status="empty"
            )
            empty = telemetry_server._attach_editor_electrical(
                conn, {"editor.revision": 2}
            )
        self.assertEqual(prior["editor.elec.status"], "ready")
        self.assertEqual(missing["editor.elec.status"], "unavailable")
        self.assertFalse(missing["editor.elec.retained"])
        self.assertEqual(empty["editor.elec.status"], "empty")
        self.assertEqual(empty["editor.elec.rootPartPersistentId"], "")
        self.assertEqual(empty["editor.elec.components"], [])


if __name__ == "__main__":
    unittest.main()
