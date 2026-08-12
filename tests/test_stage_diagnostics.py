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

    def stage_ksp_stage(self, index):
        return index

    def stage_burnout_twr(self, index, vacuum):
        return self.stage_twr(index, vacuum)


def editor_snapshot_payload(
    *,
    schema=1,
    editor_revision=7,
    craft_revision=3,
    stage_revision=2,
    rebuild_revision=2,
    stable=1,
    editor_max_stage=3,
):
    rows = [
        [0, 1010.0, 3929.0, 2.17, 2.25, 3.1, 109.8],
        [1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        [2, 156.0, 846.0, 1.94, 2.01, 2.4, 39.7],
        [3, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        [4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    ]
    header = [
        schema, 12 if schema == 2 else 11, 7, editor_revision,
        craft_revision, stage_revision, rebuild_revision,
    ]
    if schema == 2:
        header.append(editor_revision)
    header.extend([stable, editor_max_stage, len(rows), len(rows)])
    return [*header, *(value for row in rows for value in row)]


class FakeAtomicEditorStageStats:
    available = True

    def __init__(self, payload):
        self.payload = payload
        self.snapshot_calls = 0

    def editor_stage_snapshot(self):
        self.snapshot_calls += 1
        return self.payload

    def stage_count(self):
        raise AssertionError("atomic editor path must not make per-row RPCs")


class FakeAtomicFlightStageStats:
    def __init__(self, payload, error=None):
        self.payload = payload
        self.error = error
        self.snapshot_calls = 0
        self.available_reads = 0

    def flight_stage_snapshot(self):
        self.snapshot_calls += 1
        if self.error is not None:
            raise self.error
        return self.payload

    @property
    def available(self):
        self.available_reads += 1
        return True

    def stage_count(self):
        raise AssertionError("atomic Flight path must not make per-row RPCs")


class FakeVessel:
    name = "Diagnostic Craft"
    id = "vessel-guid"


class FakeConnection:
    def __init__(self, service):
        self.stage_stats = service
        self.krpc = types.SimpleNamespace(game_scene="flight")
        self.space_center = types.SimpleNamespace(active_vessel=FakeVessel())


class StageDiagnosticsTests(unittest.TestCase):
    def test_atomic_flight_snapshot_is_exactly_one_service_rpc(self):
        payload = [
            1, 6, 7, 1, 2, 2,
            0, 101.0, 202.0, 0.8, 0.9, 1.1, 20.0,
            1, 303.0, 404.0, 1.8, 1.9, 2.1, 30.0,
        ]
        service = FakeAtomicFlightStageStats(payload)
        result = telemetry_server._gather_stages(FakeConnection(service))

        self.assertEqual(service.snapshot_calls, 1)
        self.assertEqual(service.available_reads, 0)
        self.assertTrue(result["stage.complete"])
        self.assertEqual(result["stage.flightSnapshotSchema"], 1)
        self.assertEqual(result["stage.totalDvAtmo"], 404.0)
        self.assertEqual(result["stage.totalBurnSeconds"], 50.0)

    def test_invalid_atomic_flight_snapshot_uses_legacy_same_poll(self):
        service = FakeStageStats(count=2, current=1)
        service.flight_stage_snapshot = lambda: [1, 6, 7, 1, 2, 2]

        with mock.patch.object(telemetry_server, "STAGE_SETTLE_SECONDS", 0):
            result = telemetry_server._gather_stages(FakeConnection(service))

        self.assertTrue(result["stage.complete"])
        self.assertNotIn("stage.flightSnapshotSchema", result)
        self.assertEqual(len(result["stage.stages"]), 2)

    def test_atomic_editor_snapshot_replaces_all_per_row_rpcs(self):
        service = FakeAtomicEditorStageStats(editor_snapshot_payload())
        conn = FakeConnection(service)

        with mock.patch.object(telemetry_server, "STAGE_SETTLE_SECONDS", 0):
            result = telemetry_server._gather_stages(
                conn,
                source="editor",
                editor_rebuild_verified=True,
                prefer_atomic_editor_snapshot=True,
            )

        self.assertEqual(service.snapshot_calls, 2)
        self.assertTrue(result["stage.complete"])
        self.assertEqual(result["stage.mapping"], "atomic")
        self.assertEqual(result["stage.snapshotCraftRevision"], 3)
        self.assertEqual(result["stage.snapshotEditorMaxStage"], 3)
        self.assertEqual(
            [row["ksp"] for row in result["stage.stages"]],
            [0, 1, 2, 3, 4],
        )
        self.assertEqual(result["stage.totalDvAtmo"], 1166.0)

    def test_atomic_editor_snapshot_rejects_malformed_contract(self):
        payload = editor_snapshot_payload()
        payload[2] = 8

        with self.assertRaisesRegex(ValueError, "row width"):
            telemetry_server._parse_editor_stage_snapshot(payload)

    def test_completed_schema_two_snapshot_needs_one_rpc(self):
        service = FakeAtomicEditorStageStats(
            editor_snapshot_payload(schema=2)
        )
        conn = FakeConnection(service)

        result = telemetry_server._gather_stages(
            conn,
            source="editor",
            editor_rebuild_verified=True,
            prefer_atomic_editor_snapshot=True,
            atomic_editor_completion_proven=True,
        )

        self.assertEqual(service.snapshot_calls, 1)
        self.assertEqual(result["stage.snapshotSchema"], 2)
        self.assertEqual(result["stage.snapshotSimulationRevision"], 7)
        self.assertEqual(result["stage.totalDvAtmo"], 1166.0)

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

    def test_editor_rejects_extra_rows_even_when_terminal_row_is_unpowered(self):
        service = FakeStageStats(count=5, current=3)
        service.stage_delta_v = lambda index, vacuum: (
            1_000.0 if index == 0 else 0.0
        )
        service.stage_twr = lambda index, vacuum: 1.5 if index == 0 else 0.0
        service.stage_burn_time = lambda index, vacuum: (
            60.0 if index == 0 else 0.0
        )
        conn = FakeConnection(service)

        with mock.patch.object(telemetry_server, "STAGE_SETTLE_SECONDS", 0):
            result = telemetry_server._gather_stages(conn, source="editor")

        self.assertFalse(result["stage.complete"])
        self.assertEqual(result["stage.count"], 5)
        self.assertEqual(result["stage.currentKsp"], 3)
        self.assertEqual(result["stage.stages"], [])

    def test_verified_editor_accepts_mechjeb_virtual_empty_stage(self):
        service = FakeStageStats(count=5, current=3)
        service.stage_delta_v = lambda index, vacuum: (
            [1_010.0, 0.0, 156.0, 0.0, 0.0][index]
        )
        conn = FakeConnection(service)

        with mock.patch.object(telemetry_server, "STAGE_SETTLE_SECONDS", 0):
            result = telemetry_server._gather_stages(
                conn,
                source="editor",
                editor_rebuild_verified=True,
            )

        self.assertTrue(result["stage.complete"])
        self.assertEqual(result["stage.count"], 5)
        self.assertEqual(result["stage.currentKsp"], 4)
        self.assertEqual(result["stage.mapping"], "explicit")
        self.assertEqual(
            [row["ksp"] for row in result["stage.stages"]],
            [0, 1, 2, 3, 4],
        )
        self.assertEqual(
            [
                row["ksp"]
                for row in result["stage.stages"]
                if row["dvAtmo"] > 0.5 or row["dvVac"] > 0.5
            ],
            [0, 2],
        )

if __name__ == "__main__":
    unittest.main()
