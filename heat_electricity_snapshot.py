"""Strict decoder for the additive SystemHeat 0.2.11 packed snapshot."""

from __future__ import annotations

import base64
import math
import uuid

from electricity import generation_remainder
from heat import group_component_rows


MAGIC = "WMC_HEAT_ELECTRICITY"
SCHEMA = 1
MAX_PAYLOAD_CHARS = 2 * 1024 * 1024
MAX_TEXT_BYTES = 4096
MAX_LOOPS = 64
MAX_COMPONENTS = 2048
MAX_RADIATORS = 1024
MAX_REACTORS = 128
MAX_SOLAR_PANELS = 4096


def _integer(value, label, minimum=0, maximum=None):
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid {label}") from exc
    if str(parsed) != str(value) or parsed < minimum:
        raise ValueError(f"invalid {label}")
    if maximum is not None and parsed > maximum:
        raise ValueError(f"invalid {label}")
    return parsed


def _number(value, label, minimum=None, maximum=None):
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid {label}") from exc
    if not math.isfinite(parsed):
        raise ValueError(f"invalid {label}")
    if minimum is not None and parsed < minimum:
        raise ValueError(f"invalid {label}")
    if maximum is not None and parsed > maximum:
        raise ValueError(f"invalid {label}")
    return parsed


def _optional_number(value, label, minimum=None, maximum=None):
    if value == "-":
        return None
    return _number(value, label, minimum, maximum)


def _boolean(value, label):
    if value == "0":
        return False
    if value == "1":
        return True
    raise ValueError(f"invalid {label}")


def _text(value, label):
    if not isinstance(value, str) or len(value) > MAX_TEXT_BYTES * 2:
        raise ValueError(f"invalid {label}")
    try:
        raw = base64.b64decode(value, validate=True)
        if len(raw) > MAX_TEXT_BYTES:
            raise ValueError(f"invalid {label}")
        return raw.decode("utf-8")
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError(f"invalid {label}") from exc


def _guid(value, label):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError, TypeError) as exc:
        raise ValueError(f"invalid {label}") from exc


def decode_heat_electricity_snapshot(payload, *, expected_vessel_id):
    """Decode one complete identity-matched payload or raise ``ValueError``."""
    if not isinstance(payload, str) or not payload:
        raise ValueError("snapshot payload is not text")
    if len(payload) > MAX_PAYLOAD_CHARS or "\r" in payload:
        raise ValueError("snapshot payload is invalid")
    lines = payload.splitlines()
    if not lines:
        raise ValueError("snapshot header is missing")
    header = lines[0].split("\t")
    if len(header) != 16 or header[0] != MAGIC:
        raise ValueError("snapshot header is invalid")
    if _integer(header[1], "snapshot schema") != SCHEMA:
        raise ValueError("unsupported snapshot schema")

    vessel_id = _guid(header[2], "snapshot vessel ID")
    if vessel_id != _guid(expected_vessel_id, "expected vessel ID"):
        raise ValueError("snapshot vessel identity is stale")
    heat_available = _boolean(header[3], "heat availability")
    loop_count = _integer(header[4], "loop count", maximum=MAX_LOOPS)
    component_count = _integer(
        header[5], "component count", maximum=MAX_COMPONENTS
    )
    radiator_count = _integer(
        header[6], "radiator count", maximum=MAX_RADIATORS
    )
    reactor_count = _integer(
        header[7], "reactor count", maximum=MAX_REACTORS
    )
    total_heat_generation = _number(
        header[8], "total heat generation", minimum=0.0
    )
    total_heat_rejection = _number(
        header[9], "total heat rejection", minimum=0.0
    )
    service_generation = _number(
        header[10], "service generation", minimum=0.0
    )
    rtg_count = _integer(header[11], "RTG count")
    rtg_output = _number(header[12], "RTG output", minimum=0.0)
    solar_count = _integer(
        header[13], "solar count", maximum=MAX_SOLAR_PANELS
    )
    solar_output = _number(header[14], "solar output", minimum=0.0)
    solar_exposure = _number(
        header[15], "solar exposure", minimum=0.0, maximum=1.0
    )
    if solar_count == 0 and (solar_output != 0.0 or solar_exposure != 0.0):
        raise ValueError("empty solar summary is inconsistent")
    if not heat_available and (
        loop_count != 0
        or component_count != 0
        or radiator_count != 0
        or total_heat_generation != 0.0
        or total_heat_rejection != 0.0
    ):
        raise ValueError("unavailable heat summary is inconsistent")

    loops = {}
    radiators_seen = 0
    components_seen = 0
    reactor_rows = []
    for raw_line in lines[1:]:
        fields = raw_line.split("\t")
        kind = fields[0] if fields else ""
        if kind == "L":
            if len(fields) != 12:
                raise ValueError("invalid loop row")
            loop_id = _integer(fields[1], "loop ID", maximum=2**31 - 1)
            if loop_id in loops:
                raise ValueError("duplicate loop ID")
            radiator_state = _text(fields[9], "radiator state")
            if radiator_state not in {
                "unavailable", "broken", "deploying", "retracting",
                "offline", "partial", "online",
            }:
                raise ValueError("invalid radiator state")
            radiator_action = _text(fields[10], "radiator action")
            if radiator_action not in {"", "start", "stop"}:
                raise ValueError("invalid radiator action")
            loops[loop_id] = {
                "id": str(loop_id),
                "tempK": round(_number(fields[2], "loop temperature", 0.0), 1),
                "genKw": round(_number(fields[3], "loop generation", 0.0), 2),
                "remKw": round(_number(fields[4], "loop removal", 0.0), 2),
                "nominalTempK": round(
                    _number(fields[5], "nominal loop temperature", 0.0), 1
                ),
                "netKw": round(_number(fields[6], "loop net flux"), 2),
                "hasRadiators": _boolean(fields[7], "radiator presence"),
                "_radiatorExpected": _integer(
                    fields[8], "loop radiator count", maximum=256
                ),
                "_componentExpected": _integer(
                    fields[11], "loop component count", maximum=MAX_COMPONENTS
                ),
                "radiatorPartIds": [],
                "radiatorCount": 0,
                "radiatorState": radiator_state,
                "radiatorControlAvailable": False,
                "_radiatorAction": radiator_action,
                "_components": [],
            }
        elif kind == "D":
            if len(fields) != 3:
                raise ValueError("invalid radiator row")
            loop_id = _integer(fields[1], "radiator loop ID", maximum=2**31 - 1)
            if loop_id not in loops:
                raise ValueError("radiator precedes its loop")
            part_id = _integer(fields[2], "radiator part ID", maximum=0xFFFFFFFF)
            loops[loop_id]["radiatorPartIds"].append(part_id)
            radiators_seen += 1
        elif kind == "C":
            if len(fields) != 7:
                raise ValueError("invalid component row")
            loop_id = _integer(fields[1], "component loop ID", maximum=2**31 - 1)
            if loop_id not in loops:
                raise ValueError("component precedes its loop")
            loops[loop_id]["_components"].append({
                "partId": _integer(
                    fields[2], "component part ID", maximum=0xFFFFFFFF
                ),
                "fluxKw": _number(fields[3], "component flux"),
                "name": _text(fields[4], "component name"),
                "moduleName": _text(fields[5], "component module"),
                "role": _text(fields[6], "component role").lower(),
            })
            components_seen += 1
        elif kind == "R":
            if len(fields) != 21:
                raise ValueError("invalid reactor row")
            index = _integer(fields[1], "reactor index", maximum=MAX_REACTORS - 1)
            if index != len(reactor_rows):
                raise ValueError("reactor indexes are not contiguous")
            family = _text(fields[3], "reactor family").lower()
            if family not in {"fission", "fusion"}:
                raise ValueError("invalid reactor family")
            control_action = _text(fields[14], "reactor action")
            if control_action not in {
                "", "start", "stop", "start_charging", "stop_charging"
            }:
                raise ValueError("invalid reactor action")
            charge_state = _text(fields[15], "reactor charge state")
            if charge_state not in {
                "not_applicable", "off", "charging", "ready", "running"
            }:
                raise ValueError("invalid reactor charge state")
            charge_percent = _optional_number(
                fields[16], "reactor charge", 0.0, 100.0
            )
            has_integrity = _boolean(fields[17], "reactor integrity availability")
            integrity = _optional_number(
                fields[18], "reactor integrity", 0.0, 100.0
            )
            if has_integrity != (integrity is not None):
                raise ValueError("reactor integrity fields are inconsistent")
            if family == "fission" and charge_percent is not None:
                raise ValueError("fission reactor has fusion charge")
            reactor = {
                "index": index,
                "partId": _integer(
                    fields[2], "reactor part ID", maximum=0xFFFFFFFF
                ),
                "family": family,
                "name": _text(fields[4], "reactor name"),
                "hasIntegrity": has_integrity,
                "on": _boolean(fields[5], "reactor enabled"),
                "status": _text(fields[6], "reactor status"),
                "ecPerSec": round(_number(fields[7], "reactor generation", 0.0), 2),
                "ecMax": round(_number(fields[8], "reactor maximum", 0.0), 2),
                "coreTemp": round(_number(fields[9], "reactor temperature", 0.0), 1),
                "nominalTemp": round(
                    _number(fields[10], "reactor nominal temperature", 0.0), 1
                ),
                "fuel": _text(fields[11], "reactor fuel"),
                "fuelKind": _text(fields[12], "reactor fuel kind"),
                "throttle": round(_number(fields[13], "reactor throttle", 0.0, 100.0), 1),
                "controlAction": control_action,
                "controlAvailable": bool(control_action),
            }
            if charge_state != "not_applicable":
                reactor["chargeState"] = charge_state
                if charge_percent is not None:
                    reactor["chargePercent"] = round(charge_percent, 1)
            if integrity is not None:
                reactor["integrity"] = round(integrity, 1)
            fuel_rate = _text(fields[19], "reactor fuel rate")
            limiting = _text(fields[20], "reactor limiting resource")
            if fuel_rate:
                reactor["fuelRate"] = fuel_rate
            if limiting:
                reactor["fuelLimitingResource"] = limiting
            reactor_rows.append(reactor)
        else:
            raise ValueError("unknown snapshot row")

    if (
        len(loops) != loop_count
        or components_seen != component_count
        or radiators_seen != radiator_count
        or len(reactor_rows) != reactor_count
    ):
        raise ValueError("snapshot row counts are incomplete")

    loop_rows = []
    for loop in loops.values():
        if (
            len(loop["radiatorPartIds"]) != loop.pop("_radiatorExpected")
            or len(loop["_components"]) != loop.pop("_componentExpected")
        ):
            raise ValueError("loop detail counts are incomplete")
        loop["radiatorPartIds"].sort()
        loop["radiatorCount"] = len(loop["radiatorPartIds"])
        action = loop.pop("_radiatorAction")
        if action and loop["radiatorPartIds"]:
            loop["radiatorControlAction"] = action
            loop["radiatorControlAvailable"] = True
        groups = group_component_rows(loop.pop("_components"))
        loop["producers"] = groups["producers"]
        loop["radiators"] = groups["radiators"]
        loop_rows.append(loop)

    heat = None
    if heat_available and loop_rows:
        heat = {
            "heat.backend": "system_heat",
            "heat.systemHeatStatus": "known",
            "heat.generatedKw": round(total_heat_generation, 2),
            "heat.removedKw": round(total_heat_rejection, 2),
            "heat.netKw": round(
                total_heat_generation - total_heat_rejection, 2
            ),
            "heat.loops": loop_rows,
        }

    reactor_sum = sum(row["ecPerSec"] for row in reactor_rows)
    other = generation_remainder(
        service_generation, reactor_sum, rtg_output
    )
    electricity = {
        "elec.reactorsStatus": "known" if heat_available else "not_applicable",
        "elec.reactors": reactor_rows if heat_available else [],
        "rtg.count": rtg_count,
        "rtg.outputEcPerSec": round(rtg_output, 2),
        "solar.count": solar_count,
        "solar.outputEcPerSec": round(solar_output, 2),
        "solar.efficiency": round(solar_exposure, 3),
        "elec.totalGenEcPerSec": round(
            service_generation + solar_output, 2
        ),
        "elec.otherEcPerSec": round(other or 0.0, 2),
    }
    return {
        "schema": SCHEMA,
        "vesselId": vessel_id,
        "heat": heat,
        "electricity": electricity,
    }
