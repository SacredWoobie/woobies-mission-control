import contextlib
import importlib.util
import io
import json
import sys
import types
import unittest
from pathlib import Path
from unittest import mock


sys.modules.setdefault("krpc", types.ModuleType("krpc"))

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import telemetry_server


def _load_probe_module():
    path = ROOT / "tools" / "probe_stage_stats.py"
    spec = importlib.util.spec_from_file_location("probe_stage_stats", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


probe_stage_stats = _load_probe_module()


class FakeStageStats:
    available = True

    def __init__(self, count, current):
        self.count = count
        self.current = current

    def stage_count(self):
        return self.count

    def current_stage(self):
        return self.current

    def stage_delta_v(self, index, vacuum):
        return (index + 1) * (200.0 if vacuum else 100.0)

    def stage_twr(self, index, vacuum):
        return (index + 1) * (2.0 if vacuum else 1.0)

    def stage_burn_time(self, index, vacuum):
        return (index + 1) * 10.0


class FakeVessel:
    name = "Diagnostic Craft"
    id = "vessel-guid"


class FakeConnection:
    def __init__(self, service):
        self.stage_stats = service
        self.krpc = types.SimpleNamespace(current_game_scene="flight")
        self.space_center = types.SimpleNamespace(active_vessel=FakeVessel())


class StageDiagnosticsTests(unittest.TestCase):
    def test_telemetry_trace_records_incomplete_service_sample(self):
        conn = FakeConnection(FakeStageStats(count=7, current=7))
        output = io.StringIO()

        with mock.patch.object(telemetry_server, "STAGE_TRACE_ENABLED", True), \
                mock.patch.object(telemetry_server, "STAGE_SETTLE_SECONDS", 0), \
                contextlib.redirect_stdout(output):
            result = telemetry_server._gather_stages(conn)

        self.assertEqual(result["stage.count"], 7)
        self.assertEqual(result["stage.currentKsp"], 7)
        self.assertFalse(result["stage.complete"])
        self.assertEqual(result["stage.stages"], [])

        prefix = "[stage-trace] "
        trace = json.loads(output.getvalue().split(prefix, 1)[1])
        self.assertEqual(trace["event"], "service_sample")
        self.assertEqual(trace["expectedCount"], 8)
        self.assertFalse(trace["complete"])

    def test_raw_probe_records_complete_rows(self):
        conn = FakeConnection(FakeStageStats(count=2, current=1))

        record = probe_stage_stats.sample(conn, settle_seconds=0)

        self.assertTrue(record["complete"])
        self.assertEqual(record["count"], 2)
        self.assertEqual(record["expectedCount"], 2)
        self.assertEqual(len(record["rows"]), 2)
        self.assertEqual(record["rowErrors"], [])
        self.assertEqual(record["vesselId"], "vessel-guid")


if __name__ == "__main__":
    unittest.main()
