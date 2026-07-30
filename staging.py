"""Enrich Flight staging telemetry for the compact planning panel.

StageStats 0.2.5 exposes MechJeb's authoritative KSP stage number and burnout
TWR. Older compatible services retain a mass-ratio fallback so the dashboard
does not blank while the launcher is waiting to repair the DLL.
"""

from __future__ import annotations

import math


def _finite_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _call_number(service, method_name, *args):
    try:
        return _finite_number(getattr(service, method_name)(*args))
    except Exception:
        return None


def _powered(row):
    return (
        (_finite_number(row.get("dvAtmo")) or 0.0) > 0.5
        or (_finite_number(row.get("dvVac")) or 0.0) > 0.5
    )


def enrich_stage_result(service, result):
    """Add stable stage identity, TWR ranges, and compact summary fields."""
    if not isinstance(result, dict):
        return result
    rows = result.get("stage.stages")
    if not isinstance(rows, list):
        return result

    for fallback_index, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        raw_index = row.get("index", fallback_index)
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            index = fallback_index

        ksp_stage = _call_number(service, "stage_ksp_stage", index)
        if ksp_stage is not None:
            row["ksp"] = int(round(ksp_stage))

        twr_start = _call_number(service, "stage_twr", index, False)
        twr_end = _call_number(service, "stage_burnout_twr", index, False)
        if twr_end is None and twr_start is not None:
            start_mass = _call_number(service, "stage_start_mass", index, False)
            end_mass = _call_number(service, "stage_end_mass", index, False)
            if (
                start_mass is not None
                and end_mass is not None
                and start_mass > 0
                and end_mass > 0
            ):
                twr_end = twr_start * start_mass / end_mass
        if twr_start is not None:
            row["twrStart"] = round(twr_start, 2)
        if twr_end is not None:
            row["twrEnd"] = round(twr_end, 2)

        # MechJeb's own stage table uses the vacuum DeltaTime for the Burn
        # column. It is the stable full-throttle planning duration.
        burn = _call_number(service, "stage_burn_time", index, True)
        if burn is not None:
            row["burn"] = round(burn, 1)

    powered_rows = [row for row in rows if isinstance(row, dict) and _powered(row)]
    result["stage.unpoweredCount"] = max(0, len(rows) - len(powered_rows))
    result["stage.totalBurnSeconds"] = round(
        sum(_finite_number(row.get("burn")) or 0.0 for row in powered_rows),
        1,
    )

    raw_current = _finite_number(result.get("stage.currentKsp"))
    candidates = []
    for row in powered_rows:
        ksp = _finite_number(row.get("ksp"))
        if ksp is None:
            continue
        if raw_current is None or ksp <= raw_current:
            candidates.append(int(round(ksp)))
    if candidates:
        result["stage.activeKsp"] = max(candidates)

    return result


def flight_conditions(conn):
    conditions = {}
    try:
        vessel = conn.space_center.active_vessel
    except Exception:
        return conditions
    if vessel is None:
        return conditions

    try:
        body = vessel.orbit.body
        conditions["stage.body"] = str(body.name)
        flight = vessel.flight(body.reference_frame)
        altitude = _finite_number(flight.mean_altitude)
        pressure_pa = _finite_number(flight.static_pressure)
        if altitude is not None:
            conditions["stage.altitude"] = round(altitude, 1)
        if pressure_pa is not None:
            conditions["stage.staticPressureAtm"] = round(
                pressure_pa / 101_325.0, 4
            )
    except Exception:
        pass

    try:
        situation = str(vessel.situation).split(".")[-1].replace("_", " ").title()
        conditions["stage.situation"] = situation
    except Exception:
        pass
    try:
        throttle = _finite_number(vessel.control.throttle)
        if throttle is not None:
            conditions["stage.throttle"] = round(throttle, 4)
    except Exception:
        pass
    return conditions
