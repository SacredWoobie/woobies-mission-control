"""Strict decoder for the packed WoobiesControlStats Flight-core snapshot."""

import base64
import binascii
import math
import re
import uuid


MAGIC = "WCS_FLIGHT_CORE_SNAPSHOT"
SCHEMA = 1
FIELD_COUNT = 34
MAX_PACKED_CHARACTERS = 32 * 1024
MAX_TEXT_BYTES = 4096


class FlightCoreSnapshotError(ValueError):
    """The packed Flight-core response is unsafe, stale, or incomplete."""


def _decode_text(value, label, optional=False):
    if optional and value == "-":
        return None
    try:
        encoded = value.encode("ascii")
        if len(encoded) > MAX_TEXT_BYTES * 2:
            raise FlightCoreSnapshotError(f"{label} is too large")
        decoded = base64.b64decode(encoded, validate=True)
        if len(decoded) > MAX_TEXT_BYTES:
            raise FlightCoreSnapshotError(f"{label} is too large")
        return decoded.decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError, binascii.Error) as exc:
        raise FlightCoreSnapshotError(f"invalid {label} encoding") from exc


def _integer(value, label):
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise FlightCoreSnapshotError(f"invalid {label}") from exc
    if str(parsed) != value:
        raise FlightCoreSnapshotError(f"non-canonical {label}")
    return parsed


def _number(value, label, optional=False):
    if optional and value == "-":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise FlightCoreSnapshotError(f"invalid {label}") from exc
    if not math.isfinite(parsed):
        raise FlightCoreSnapshotError(f"non-finite {label}")
    return parsed


def _boolean(value, label, optional=False):
    if optional and value == "-":
        return None
    if value not in {"0", "1"}:
        raise FlightCoreSnapshotError(f"invalid {label}")
    return value == "1"


def _snake_case(value):
    value = str(value).split(".")[-1]
    value = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", value)
    value = re.sub(r"[^A-Za-z0-9]+", "_", value)
    return value.strip("_").casefold()


def _enum_value(prefix, value):
    normalized = _snake_case(value)
    if not normalized:
        raise FlightCoreSnapshotError("empty enum value")
    return f"{prefix}.{normalized}"


def _situation_label(value):
    normalized = _snake_case(value)
    if not normalized:
        raise FlightCoreSnapshotError("empty vessel situation")
    return normalized.replace("_", " ").title()


def decode_flight_core_snapshot(packed, *, expected_vessel_id=None):
    """Return the established flat Flight fields from one strict snapshot."""
    if not isinstance(packed, str) or not packed:
        raise FlightCoreSnapshotError("snapshot must be a non-empty string")
    if len(packed) > MAX_PACKED_CHARACTERS:
        raise FlightCoreSnapshotError("snapshot exceeds the character bound")
    if "\r" in packed or "\n" in packed:
        raise FlightCoreSnapshotError("snapshot contains unsupported framing")

    fields = packed.split("\t")
    if len(fields) != FIELD_COUNT or fields[0] != MAGIC:
        raise FlightCoreSnapshotError("invalid snapshot header")
    if _integer(fields[1], "schema") != SCHEMA:
        raise FlightCoreSnapshotError("unsupported snapshot schema")
    if fields[2] not in {"0", "1"}:
        raise FlightCoreSnapshotError("invalid active-vessel flag")
    if fields[2] != "1" or fields[3] != "known":
        raise FlightCoreSnapshotError("Flight snapshot is not complete")

    vessel_id = _decode_text(fields[4], "vessel identity")
    try:
        parsed_id = uuid.UUID(vessel_id)
    except (AttributeError, TypeError, ValueError) as exc:
        raise FlightCoreSnapshotError("invalid vessel identity") from exc
    canonical_id = str(parsed_id)
    if vessel_id != canonical_id:
        raise FlightCoreSnapshotError("non-canonical vessel identity")
    if expected_vessel_id is not None:
        expected = str(expected_vessel_id).strip().casefold()
        if expected and expected != vessel_id.casefold():
            raise FlightCoreSnapshotError("snapshot belongs to another vessel")

    vessel_name = _decode_text(fields[5], "vessel name")
    body_name = _decode_text(fields[6], "body name")
    situation = _decode_text(fields[7], "vessel situation")
    if not body_name:
        raise FlightCoreSnapshotError("body name is empty")

    values = [
        _number(fields[index], label)
        for index, label in (
            (8, "universal time"),
            (9, "mission time"),
            (10, "throttle"),
            (11, "thrust"),
            (12, "available thrust"),
            (13, "heading"),
            (14, "pitch"),
            (15, "roll"),
            (16, "mean altitude"),
            (17, "vertical speed"),
            (18, "surface speed"),
            (19, "g force"),
            (20, "orbital speed"),
            (21, "apoapsis altitude"),
            (22, "periapsis altitude"),
            (23, "time to apoapsis"),
            (24, "time to periapsis"),
            (25, "inclination"),
            (26, "eccentricity"),
            (27, "period"),
            (28, "static pressure"),
        )
    ]
    (
        universal_time, mission_time, throttle, thrust, available_thrust,
        heading, pitch, roll, altitude, vertical_speed, surface_speed,
        g_force, orbital_speed, apoapsis, periapsis, time_to_apoapsis,
        time_to_periapsis, inclination, eccentricity, period, static_pressure,
    ) = values
    current_stage = _integer(fields[29], "current stage")
    can_communicate = _boolean(
        fields[30], "can-communicate flag", optional=True
    )
    signal_strength = _number(fields[31], "signal strength", optional=True)
    sas = _boolean(fields[32], "SAS flag", optional=True)
    sas_mode = _decode_text(fields[33], "SAS mode", optional=True)

    if not 0.0 <= throttle <= 1.0:
        raise FlightCoreSnapshotError("throttle is out of range")
    if thrust < 0.0 or available_thrust < 0.0:
        raise FlightCoreSnapshotError("thrust is negative")
    if g_force < 0.0 or static_pressure < 0.0:
        raise FlightCoreSnapshotError("Flight environment value is negative")
    if current_stage < -1:
        raise FlightCoreSnapshotError("current stage is invalid")
    if signal_strength is not None and not 0.0 <= signal_strength <= 1.0:
        raise FlightCoreSnapshotError("signal strength is out of range")
    if sas is True and sas_mode is None:
        raise FlightCoreSnapshotError("active SAS lacks a mode")

    situation_label = _situation_label(situation)
    out = {
        "v.guid": canonical_id,
        "v.name": vessel_name,
        "v.body": body_name,
        "v.situationString": situation_label,
        "stage.situation": situation_label,
        "stage.staticPressureAtm": round(static_pressure / 101_325.0, 4),
        "t.universalTime": universal_time,
        "v.missionTime": mission_time,
        "krpc.throttle": throttle,
        "v.thrust": thrust,
        "v.availableThrust": available_thrust,
        "n.heading": heading,
        "n.pitch": pitch,
        "n.roll": roll,
        "v.altitude": altitude,
        "v.verticalSpeed": vertical_speed,
        "v.surfaceSpeed": surface_speed,
        "v.geeForce": g_force,
        "v.orbitalVelocity": orbital_speed,
        "o.ApA": apoapsis,
        "o.PeA": periapsis,
        "o.timeToAp": time_to_apoapsis,
        "o.timeToPe": time_to_periapsis,
        "o.inclination": math.degrees(inclination),
        "o.eccentricity": eccentricity,
        "o.period": period,
        "krpc.currentStage": current_stage,
    }
    if can_communicate is not None:
        out["comm.krpc.canCommunicate"] = can_communicate
    if signal_strength is not None:
        out["comm.krpc.signalStrength"] = signal_strength
    if sas is not None:
        out["krpc.sas"] = sas
    if sas_mode is not None:
        out["krpc.sasMode"] = _enum_value("SASMode", sas_mode)
    return out
