"""Poll the raw KRPC.StageStats service and write JSON Lines diagnostics.

This probe deliberately bypasses telemetry_server.py. Run it alongside the
dashboard feed while reproducing a launch/revert failure to determine whether
the service itself recovers before telemetry caching is involved.

Requires: pip install krpc
"""

import argparse
import json
import sys
import time

import krpc


def _safe(call, default=None):
    try:
        return call()
    except Exception:
        return default


def _scene_name(conn):
    scene = _safe(lambda: conn.krpc.current_game_scene)
    return str(scene) if scene is not None else None


def _vessel_identity(conn):
    vessel = _safe(lambda: conn.space_center.active_vessel)
    if vessel is None:
        return {"vesselName": None, "vesselId": None}
    vessel_id = _safe(lambda: vessel.id)
    return {
        "vesselName": _safe(lambda: vessel.name),
        "vesselId": str(vessel_id) if vessel_id is not None else None,
    }


def _stage_rows(service, count):
    rows = []
    errors = []
    for index in range(max(0, count)):
        try:
            rows.append({
                "index": index,
                "dvAtmo": service.stage_delta_v(index, False),
                "dvVac": service.stage_delta_v(index, True),
                "twrAtmo": service.stage_twr(index, False),
                "twrVac": service.stage_twr(index, True),
                "burn": service.stage_burn_time(index, False),
            })
        except Exception as exc:
            errors.append({
                "index": index,
                "error": type(exc).__name__,
                "message": str(exc),
            })
    return rows, errors


def sample(conn, settle_seconds):
    record = {
        "wallTime": round(time.time(), 3),
        "monotonic": round(time.monotonic(), 3),
        "scene": _scene_name(conn),
    }
    record.update(_vessel_identity(conn))

    try:
        service = conn.stage_stats
        record["available"] = bool(service.available)
        if not record["available"]:
            return record

        record["primeCount"] = int(service.stage_count())
        time.sleep(settle_seconds)
        record["count"] = int(service.stage_count())
        record["currentKsp"] = int(service.current_stage())
        record["expectedCount"] = max(0, record["currentKsp"] + 1)
        record["complete"] = record["count"] == record["expectedCount"]
        record["rows"], record["rowErrors"] = _stage_rows(
            service, record["count"]
        )
        record["finalCount"] = int(service.stage_count())
        record["finalCurrentKsp"] = int(service.current_stage())
    except Exception as exc:
        record["error"] = type(exc).__name__
        record["message"] = str(exc)
    return record


def _write(record, output):
    line = json.dumps(record, sort_keys=True, default=str)
    print(line, flush=True)
    if output is not None:
        output.write(line + "\n")
        output.flush()


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Continuously poll raw KRPC.StageStats lifecycle state."
    )
    parser.add_argument("--interval", type=float, default=0.5,
                        help="seconds between samples (default: 0.5)")
    parser.add_argument("--settle", type=float, default=0.12,
                        help="seconds between prime and read calls (default: 0.12)")
    parser.add_argument("--samples", type=int, default=0,
                        help="stop after N samples; 0 runs until Ctrl+C")
    parser.add_argument("--output",
                        help="optional JSONL file; stdout is always retained")
    args = parser.parse_args(argv)
    if args.interval < 0 or args.settle < 0 or args.samples < 0:
        parser.error("interval, settle, and samples must be non-negative")

    output = open(args.output, "a", encoding="utf-8") if args.output else None
    conn = None
    emitted = 0
    try:
        while args.samples == 0 or emitted < args.samples:
            started = time.monotonic()
            if conn is None:
                try:
                    conn = krpc.connect(name="StageStats raw lifecycle probe")
                    _write({
                        "event": "connected",
                        "wallTime": round(time.time(), 3),
                    }, output)
                except Exception as exc:
                    _write({
                        "event": "connect_error",
                        "wallTime": round(time.time(), 3),
                        "error": type(exc).__name__,
                        "message": str(exc),
                    }, output)
                    time.sleep(max(args.interval, 0.25))
                    continue

            record = sample(conn, args.settle)
            _write(record, output)
            emitted += 1
            if "error" in record:
                try:
                    conn.close()
                except Exception:
                    pass
                conn = None

            remaining = args.interval - (time.monotonic() - started)
            if remaining > 0:
                time.sleep(remaining)
    except KeyboardInterrupt:
        return 0
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        if output is not None:
            output.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
