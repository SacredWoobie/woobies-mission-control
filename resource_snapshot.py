"""Strict decoder for WoobiesControlStats packed vessel-resource snapshots."""

import base64
import binascii
import math


MAGIC = "WCS_RESOURCE_SNAPSHOT"
SCHEMA = 1
MAX_PACKED_CHARACTERS = 1024 * 1024
MAX_RESOURCES = 256
MAX_TEXT_BYTES = 4096


class ResourceSnapshotError(ValueError):
    """The service response is malformed, stale, incomplete, or mismatched."""


def _decode_text(value, label):
    try:
        encoded = value.encode("ascii")
        if len(encoded) > MAX_TEXT_BYTES * 2:
            raise ResourceSnapshotError(f"{label} is too large")
        decoded = base64.b64decode(encoded, validate=True)
        if len(decoded) > MAX_TEXT_BYTES:
            raise ResourceSnapshotError(f"{label} is too large")
        return decoded.decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError, binascii.Error) as exc:
        raise ResourceSnapshotError(f"invalid {label} encoding") from exc


def _integer(value, label, optional=False):
    if optional and value == "-":
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ResourceSnapshotError(f"invalid {label}") from exc
    if str(parsed) != value:
        raise ResourceSnapshotError(f"non-canonical {label}")
    return parsed


def _number(value, label):
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ResourceSnapshotError(f"invalid {label}") from exc
    if not math.isfinite(parsed):
        raise ResourceSnapshotError(f"non-finite {label}")
    return parsed


def decode_resource_snapshot(
        packed, *, expected_vessel_id=None, expected_stage=None):
    """Decode one bounded schema-1 snapshot into the established flat fields.

    Anything other than a complete, context-matching ``known`` response raises
    ``ResourceSnapshotError`` so the caller can use the stock compatibility
    collector in the same poll.
    """
    if not isinstance(packed, str) or not packed:
        raise ResourceSnapshotError("snapshot must be a non-empty string")
    if len(packed) > MAX_PACKED_CHARACTERS:
        raise ResourceSnapshotError("snapshot exceeds the character bound")
    if "\r" in packed:
        raise ResourceSnapshotError("snapshot contains unsupported framing")

    lines = packed.split("\n")
    header = lines[0].split("\t")
    if len(header) != 10 or header[0] != MAGIC:
        raise ResourceSnapshotError("invalid snapshot header")
    if _integer(header[1], "schema") != SCHEMA:
        raise ResourceSnapshotError("unsupported snapshot schema")
    if header[2] not in {"0", "1"}:
        raise ResourceSnapshotError("invalid active-vessel flag")
    if header[2] != "1" or header[3] != "known":
        raise ResourceSnapshotError("resource snapshot is not complete")

    vessel_id = _decode_text(header[4], "vessel identity")
    current_stage = _integer(header[5], "current stage")
    resource_stage = _integer(header[6], "resource stage", optional=True)
    activation_stage = _integer(
        header[7], "activation stage", optional=True
    )
    total_count = _integer(header[8], "total resource count")
    stage_count = _integer(header[9], "stage resource count")
    if not vessel_id or current_stage < -1:
        raise ResourceSnapshotError("invalid snapshot context")
    if not 0 <= total_count <= MAX_RESOURCES:
        raise ResourceSnapshotError("total resource count exceeds bound")
    if not 0 <= stage_count <= MAX_RESOURCES:
        raise ResourceSnapshotError("stage resource count exceeds bound")
    if len(lines) != 1 + total_count + stage_count:
        raise ResourceSnapshotError("resource row count does not match header")

    if expected_vessel_id is not None:
        expected = str(expected_vessel_id).strip()
        if expected and vessel_id.casefold() != expected.casefold():
            raise ResourceSnapshotError("snapshot belongs to another vessel")
    if expected_stage is not None and current_stage != int(expected_stage):
        raise ResourceSnapshotError("snapshot belongs to another stage")

    total = []
    stage = []
    total_names = set()
    stage_names = set()
    for index, line in enumerate(lines[1:]):
        fields = line.split("\t")
        if len(fields) != 4:
            raise ResourceSnapshotError("invalid resource row width")
        expected_kind = "R" if index < total_count else "S"
        if fields[0] != expected_kind:
            raise ResourceSnapshotError("resource row is out of order")
        name = _decode_text(fields[1], "resource name")
        if not name:
            raise ResourceSnapshotError("resource name is empty")
        amount = _number(fields[2], "resource amount")
        maximum = _number(fields[3], "resource maximum")
        if maximum < 0:
            raise ResourceSnapshotError("resource maximum is negative")
        destination = total if expected_kind == "R" else stage
        names = total_names if expected_kind == "R" else stage_names
        if name in names:
            raise ResourceSnapshotError("duplicate resource name")
        names.add(name)
        destination.append((name, amount, maximum))

    if current_stage < 0 and (
            resource_stage is not None or activation_stage is not None or stage):
        raise ResourceSnapshotError("stage data exists without a current stage")
    if activation_stage is not None and resource_stage is None:
        raise ResourceSnapshotError(
            "activation stage exists without a resource stage"
        )
    if stage and resource_stage is None:
        raise ResourceSnapshotError("stage resources lack a resource stage")

    out = {
        "res.status": "known",
        "res.names": [name for name, _amount, _maximum in total],
        "res.stageKnown": current_stage >= 0,
    }
    for name, amount, maximum in total:
        out[f"r.resource[{name}]"] = amount
        out[f"r.resourceMax[{name}]"] = maximum
    if resource_stage is not None:
        out["res.stageResourceStage"] = resource_stage
    if activation_stage is not None:
        out["res.stageActivationStage"] = activation_stage
    for name, amount, maximum in stage:
        out[f"r.resourceCurrent[{name}]"] = amount
        out[f"r.resourceCurrentMax[{name}]"] = maximum
    return out
