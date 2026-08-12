import base64
import unittest
from unittest import mock

import telemetry_server
from editor_electrical_snapshot import decode_editor_electrical_snapshot


def b(value):
    return base64.b64encode(value.encode()).decode()


def snapshot(*, craft="craft-1", revision=1):
    return [
        "\t".join(["WEE1", "1", "ready", "stock", b("1.0"),
                   b("Save"), craft, "root-1", str(revision), "fp",
                   "10", "20", "1", "1", b("")]),
        "\t".join(["C", b("part:module"), "42", b("Battery"),
                   b("ModuleBattery"), b("storage"), "consumer", "0",
                   "1", "1", "0", "1"]),
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
        self.assertEqual(result["editor.elec.components"][0]["partId"], "42")
        self.assertTrue(result["editor.elec.bodies"][0]["authoritative"])
        self.assertIn("gravitationalParameter", result["editor.elec.bodies"][0])
        self.assertNotIn("mu", result["editor.elec.bodies"][0])

    def test_rejects_atomic_count_and_enum_failures(self):
        bad = snapshot()
        bad[0] = bad[0].replace("\t1\t1\t", "\t2\t1\t", 1)
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


if __name__ == "__main__":
    unittest.main()
