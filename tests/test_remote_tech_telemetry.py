import unittest
from types import SimpleNamespace

import telemetry_server


class _CountingComms:
    def __init__(self, connected, delay=0.0):
        self.connected = connected
        self.delay = delay
        self.connection_reads = 0
        self.delay_reads = 0

    @property
    def has_connection(self):
        self.connection_reads += 1
        return self.connected

    @property
    def signal_delay(self):
        self.delay_reads += 1
        return self.delay


class _CountingRemoteTech:
    def __init__(self, available, comms=None):
        self.value = available
        self.comms_proxy = comms
        self.available_reads = 0
        self.comms_calls = 0

    @property
    def available(self):
        self.available_reads += 1
        return self.value

    def comms(self, _vessel):
        self.comms_calls += 1
        return self.comms_proxy


class RemoteTechTelemetryTests(unittest.TestCase):
    def test_connected_link_reads_each_live_property_once(self):
        comms = _CountingComms(True, 1.25)
        remote_tech = _CountingRemoteTech(True, comms)

        result = telemetry_server._gather_remote_tech(
            SimpleNamespace(remote_tech=remote_tech),
            SimpleNamespace(),
        )

        self.assertEqual(result, {
            "rt.available": True,
            "rt.hasConnection": True,
            "rt.signalDelay": 1.25,
        })
        self.assertEqual(remote_tech.available_reads, 1)
        self.assertEqual(remote_tech.comms_calls, 1)
        self.assertEqual(comms.connection_reads, 1)
        self.assertEqual(comms.delay_reads, 1)

    def test_unavailable_service_does_not_request_comms(self):
        remote_tech = _CountingRemoteTech(False)

        result = telemetry_server._gather_remote_tech(
            SimpleNamespace(remote_tech=remote_tech),
            SimpleNamespace(),
        )

        self.assertEqual(result, {"rt.available": False})
        self.assertEqual(remote_tech.available_reads, 1)
        self.assertEqual(remote_tech.comms_calls, 0)

    def test_disconnected_link_omits_signal_delay_read(self):
        comms = _CountingComms(False, 99.0)
        remote_tech = _CountingRemoteTech(True, comms)

        result = telemetry_server._gather_remote_tech(
            SimpleNamespace(remote_tech=remote_tech),
            SimpleNamespace(),
        )

        self.assertEqual(result, {
            "rt.available": True,
            "rt.hasConnection": False,
            "rt.signalDelay": None,
        })
        self.assertEqual(comms.connection_reads, 1)
        self.assertEqual(comms.delay_reads, 0)

    def test_missing_remote_tech_remains_nonfatal(self):
        self.assertEqual(
            telemetry_server._gather_remote_tech(
                SimpleNamespace(),
                SimpleNamespace(),
            ),
            {},
        )


if __name__ == "__main__":
    unittest.main()
