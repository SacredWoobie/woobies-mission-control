"""Strict decoder for the one-call StageStats Flight snapshot."""

from __future__ import annotations

import math


SCHEMA_VERSION = 1
HEADER_WIDTH = 6
ROW_WIDTH = 7
MAX_ROWS = 256


def _integer(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Flight stage snapshot {label} is not numeric")
    number = float(value)
    if not math.isfinite(number) or not number.is_integer():
        raise ValueError(f"Flight stage snapshot {label} is not an integer")
    return int(number)


def _finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Flight stage snapshot {label} is not numeric")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"Flight stage snapshot {label} is not finite")
    return number


def decode_flight_stage_snapshot(payload):
    """Decode and validate a StageStats schema-1 Flight snapshot.

    The service response is deliberately a flat numeric vector so one kRPC
    procedure returns the complete aligned atmosphere/vacuum table. No partial
    result is published: malformed, oversized, stale/incomplete, or non-finite
    responses raise ``ValueError`` and let the caller use its legacy fallback.
    """
    if isinstance(payload, (str, bytes, bytearray)):
        raise ValueError("Flight stage snapshot payload is not numeric")
    try:
        values = list(payload)
    except TypeError as exc:
        raise ValueError("Flight stage snapshot payload is not iterable") from exc

    if len(values) < HEADER_WIDTH:
        raise ValueError("Flight stage snapshot header is truncated")
    schema = _integer(values[0], "schema")
    header_width = _integer(values[1], "header width")
    row_width = _integer(values[2], "row width")
    current_stage = _integer(values[3], "current stage")
    atmo_count = _integer(values[4], "atmosphere row count")
    vac_count = _integer(values[5], "vacuum row count")

    if schema != SCHEMA_VERSION:
        raise ValueError(f"Unsupported Flight stage snapshot schema: {schema}")
    if header_width != HEADER_WIDTH:
        raise ValueError("Flight stage snapshot header width is incompatible")
    if row_width != ROW_WIDTH:
        raise ValueError("Flight stage snapshot row width is incompatible")
    if current_stage < -1 or current_stage >= MAX_ROWS:
        raise ValueError("Flight stage snapshot current stage is out of range")
    if atmo_count < 0 or vac_count < 0:
        raise ValueError("Flight stage snapshot row count is negative")
    if atmo_count != vac_count:
        raise ValueError("Flight stage snapshot tables are misaligned")
    if atmo_count > MAX_ROWS:
        raise ValueError("Flight stage snapshot has too many rows")
    if atmo_count != max(0, current_stage + 1):
        raise ValueError("Flight stage snapshot is incomplete for current stage")

    expected_length = HEADER_WIDTH + atmo_count * ROW_WIDTH
    if len(values) != expected_length:
        raise ValueError("Flight stage snapshot length does not match row count")

    rows = []
    total_atmo = 0.0
    total_vac = 0.0
    for index in range(atmo_count):
        offset = HEADER_WIDTH + index * ROW_WIDTH
        ksp_stage = _integer(values[offset], "KSP stage")
        if ksp_stage != index:
            raise ValueError("Flight stage snapshot KSP stages are not contiguous")
        dv_atmo = _finite(values[offset + 1], "atmosphere delta-v")
        dv_vac = _finite(values[offset + 2], "vacuum delta-v")
        twr_atmo = _finite(values[offset + 3], "atmosphere TWR")
        twr_vac = _finite(values[offset + 4], "vacuum TWR")
        twr_end = _finite(values[offset + 5], "atmosphere burnout TWR")
        burn = _finite(values[offset + 6], "vacuum burn time")
        total_atmo += dv_atmo
        total_vac += dv_vac
        rows.append({
            "index": index,
            "ksp": ksp_stage,
            "dvAtmo": round(dv_atmo, 1),
            "dvVac": round(dv_vac, 1),
            "twr": round(twr_atmo, 2),
            "twrAtmo": round(twr_atmo, 2),
            "twrVac": round(twr_vac, 2),
            "twrStart": round(twr_atmo, 2),
            "twrEnd": round(twr_end, 2),
            "burn": round(burn, 1),
        })

    return {
        "stage.available": True,
        "stage.complete": True,
        "stage.count": atmo_count,
        "stage.currentKsp": current_stage,
        # Preserve the released Flight mapping value. The protocol validates
        # the explicit row stages as the same complete contiguous mapping.
        "stage.mapping": "complete",
        "stage.flightSnapshotSchema": schema,
        "stage.stages": rows,
        "stage.totalDvAtmo": round(total_atmo, 1),
        "stage.totalDvVac": round(total_vac, 1),
    }
