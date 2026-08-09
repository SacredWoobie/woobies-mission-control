"""Collect authoritative broken-part state from stock kRPC part APIs."""

from __future__ import annotations

import base64
import binascii
from collections import defaultdict
import math
from types import SimpleNamespace


MAX_DAMAGE_NAME_LENGTH = 120
MAX_DAMAGE_TAG_LENGTH = 80
MAX_DAMAGE_MODULE_LENGTH = 120

_DAMAGE_KINDS = {
    "solar_panel", "radiator", "antenna", "landing_leg", "wheel",
    "reaction_wheel", "engine", "tank", "wing", "sas", "rcs",
    "command", "structural", "other",
}

_STATE_COLLECTIONS = (
    ("solar_panel", "solar_panels"),
    ("radiator", "radiators"),
    ("antenna", "antennas"),
    ("landing_leg", "legs"),
    ("wheel", "wheels"),
)
_FLAG_COLLECTIONS = (
    ("reaction_wheel", "reaction_wheels"),
)
_LOSS_FIELDS_UNSET = object()
_MAX_PACKED_SNAPSHOT_BYTES = 2 * 1024 * 1024
_MAX_PACKED_SNAPSHOT_ROWS = 5000


def _text(value, fallback, limit):
    try:
        text = str(value or "").strip()
    except Exception:
        text = ""
    return (text or fallback)[:limit]


def _enum_name(value):
    try:
        name = getattr(value, "name", None)
        if name:
            return str(name).strip().casefold()
    except Exception:
        pass
    return str(value).strip().rsplit(".", 1)[-1].casefold()


def _part_identity(component, kind):
    part = component.part
    fallback = kind.replace("_", " ").title()
    name = _text(getattr(part, "title", None), "", MAX_DAMAGE_NAME_LENGTH)
    if not name:
        name = _text(getattr(part, "name", None), fallback, MAX_DAMAGE_NAME_LENGTH)
    tag = _text(getattr(part, "tag", None), "", MAX_DAMAGE_TAG_LENGTH)
    return name, tag


def _state_is_broken(component):
    return _enum_name(component.state) == "broken"


def _flag_is_broken(component):
    value = component.broken
    if not isinstance(value, bool):
        raise ValueError("broken flag is not boolean")
    return value


def _scan(parts, kind, collection_name, predicate, groups):
    try:
        components = list(getattr(parts, collection_name))
    except Exception:
        return 0, False

    complete = True
    checked = 0
    for component in components:
        try:
            broken = predicate(component)
            checked += 1
            if not broken:
                continue
            name, tag = _part_identity(component, kind)
            groups[(kind, name, tag)] += 1
        except Exception:
            complete = False
    return checked, complete


def _unknown_service_result():
    return {
        "damage.status": "unknown",
        "damage.source": "vessel_damage",
        "damage.parts": [],
        "damage.checkedKinds": [],
        "damage.incompleteKinds": ["vessel_damage"],
        "damage.unsupportedKinds": [],
        "damage.lossStatus": "incomplete",
        "damage.lossEvents": [],
    }


def _decode_packed_text(value):
    if not isinstance(value, str) or len(value) > _MAX_PACKED_SNAPSHOT_BYTES:
        raise ValueError("invalid packed text")
    try:
        raw = base64.b64decode(value, validate=True)
        return raw.decode("utf-8", errors="strict")
    except (binascii.Error, UnicodeDecodeError, ValueError) as error:
        raise ValueError("invalid packed text") from error


def _packed_snapshot_service(payload):
    """Decode WoobiesControlStats' bounded one-call damage snapshot."""
    if not isinstance(payload, str):
        return None
    try:
        if len(payload.encode("utf-8")) > _MAX_PACKED_SNAPSHOT_BYTES:
            return None
        lines = payload.splitlines()
        if not lines or len(lines) > _MAX_PACKED_SNAPSHOT_ROWS:
            return None
        header = lines[0].split("\t")
        if len(header) != 12 or header[:2] != ["WCS_DAMAGE_SNAPSHOT", "1"]:
            return None
        available_flag = header[2]
        status = header[3]
        read_error_count = int(header[4])
        checked_part_count = int(header[5])
        checked_module_count = int(header[6])
        damaged_count = int(header[7])
        loss_status = header[8]
        loss_revision = int(header[9])
        loss_event_count = int(header[10])
        detector_count = int(header[11])
        counts = (
            read_error_count, checked_part_count, checked_module_count,
            damaged_count, loss_revision, loss_event_count, detector_count,
        )
        if (
            available_flag not in ("0", "1")
            or status not in ("known", "incomplete")
            or loss_status not in ("known", "loading")
            or any(value < 0 for value in counts)
            or damaged_count + loss_event_count + detector_count != len(lines) - 1
        ):
            return None

        damage_columns = {
            "part_ids": [], "part_names": [], "part_titles": [],
            "part_tags": [], "module_names": [], "kinds": [],
            "detectors": [], "conditions": [], "event_ids": [],
        }
        loss_columns = {
            "loss_event_ids": [], "loss_part_ids": [],
            "loss_part_names": [], "loss_part_titles": [],
            "loss_part_tags": [], "loss_module_names": [],
            "loss_kinds": [], "loss_states": [],
            "loss_occurrence_uts": [], "loss_occurrence_mets": [],
            "loss_cleared_uts": [], "loss_clear_reasons": [],
            "loss_causes": [],
        }
        supported_detectors = []
        for line in lines[1:]:
            fields = line.split("\t")
            if fields[0] == "D" and len(fields) == 10:
                damage_columns["part_ids"].append(int(fields[1]))
                decoded = [_decode_packed_text(value) for value in fields[2:]]
                for key, value in zip((
                    "part_names", "part_titles", "part_tags", "module_names",
                    "kinds", "detectors", "conditions", "event_ids",
                ), decoded):
                    damage_columns[key].append(value)
            elif fields[0] == "L" and len(fields) == 14:
                loss_columns["loss_event_ids"].append(
                    _decode_packed_text(fields[1])
                )
                loss_columns["loss_part_ids"].append(int(fields[2]))
                decoded = [_decode_packed_text(value) for value in fields[3:8]]
                for key, value in zip((
                    "loss_part_names", "loss_part_titles", "loss_part_tags",
                    "loss_module_names", "loss_kinds",
                ), decoded):
                    loss_columns[key].append(value)
                loss_columns["loss_states"].append(
                    _decode_packed_text(fields[8])
                )
                loss_columns["loss_occurrence_uts"].append(float(fields[9]))
                loss_columns["loss_occurrence_mets"].append(float(fields[10]))
                loss_columns["loss_cleared_uts"].append(float(fields[11]))
                loss_columns["loss_clear_reasons"].append(
                    _decode_packed_text(fields[12])
                )
                loss_columns["loss_causes"].append(
                    _decode_packed_text(fields[13])
                )
            elif fields[0] == "S" and len(fields) == 2:
                supported_detectors.append(_decode_packed_text(fields[1]))
            else:
                return None
        if (
            len(damage_columns["part_ids"]) != damaged_count
            or len(loss_columns["loss_event_ids"]) != loss_event_count
            or len(supported_detectors) != detector_count
        ):
            return None

        service = SimpleNamespace(
            available=available_flag == "1",
            status=status,
            read_error_count=read_error_count,
            checked_part_count=checked_part_count,
            checked_module_count=checked_module_count,
            damaged_count=damaged_count,
            loss_status=loss_status,
            loss_revision=loss_revision,
            loss_event_count=loss_event_count,
        )
        for name, values in {**damage_columns, **loss_columns}.items():
            setattr(service, name, lambda values=values: list(values))
        service.supported_detectors = lambda: list(supported_detectors)
        return service
    except (TypeError, ValueError, OverflowError):
        return None


def _loss_fields(service):
    """Read the optional aligned loss ledger without weakening 0.2.10."""
    try:
        loss_status = service.loss_status
    except AttributeError:
        return "unavailable", []
    except Exception:
        return "incomplete", []

    if loss_status == "loading":
        return "loading", []
    if loss_status != "known":
        return "incomplete", []
    try:
        count = service.loss_event_count
        columns = {
            "eventId": list(service.loss_event_ids()),
            "partId": list(service.loss_part_ids()),
            "partName": list(service.loss_part_names()),
            "partTitle": list(service.loss_part_titles()),
            "tag": list(service.loss_part_tags()),
            "module": list(service.loss_module_names()),
            "kind": list(service.loss_kinds()),
            "state": list(service.loss_states()),
            "occurrenceUt": list(service.loss_occurrence_uts()),
            "occurrenceMet": list(service.loss_occurrence_mets()),
            "clearedUt": list(service.loss_cleared_uts()),
            "clearReason": list(service.loss_clear_reasons()),
            "cause": list(service.loss_causes()),
        }
    except Exception:
        return "incomplete", []
    if (
        not isinstance(count, int)
        or count < 0
        or any(len(values) != count for values in columns.values())
    ):
        return "incomplete", []

    events = []
    for index in range(count):
        try:
            part_id = int(columns["partId"][index])
            occurrence_ut = float(columns["occurrenceUt"][index])
            occurrence_met = float(columns["occurrenceMet"][index])
            cleared_ut = float(columns["clearedUt"][index])
        except (TypeError, ValueError, OverflowError):
            return "incomplete", []
        kind = str(columns["kind"][index] or "").strip()
        state = str(columns["state"][index] or "").strip()
        event_id = _text(columns["eventId"][index], "", 120)
        if (
            part_id <= 0
            or kind not in _DAMAGE_KINDS
            or state not in ("active", "cleared")
            or not event_id
            or not all(math.isfinite(value) for value in (
                occurrence_ut, occurrence_met, cleared_ut,
            ))
        ):
            return "incomplete", []
        event = {
            "eventId": event_id,
            "partId": part_id,
            "name": _text(
                columns["partTitle"][index],
                _text(columns["partName"][index], "Unknown part",
                      MAX_DAMAGE_NAME_LENGTH),
                MAX_DAMAGE_NAME_LENGTH,
            ),
            "partName": _text(columns["partName"][index], "", 120),
            "tag": _text(columns["tag"][index], "", MAX_DAMAGE_TAG_LENGTH),
            "module": _text(
                columns["module"][index], "", MAX_DAMAGE_MODULE_LENGTH
            ),
            "kind": kind,
            "state": state,
            "occurrenceUt": occurrence_ut,
            "occurrenceMet": occurrence_met,
            "cause": _text(columns["cause"][index], "topology_change", 80),
        }
        if state == "cleared":
            event["clearedUt"] = cleared_ut
            event["clearReason"] = _text(
                columns["clearReason"][index], "unknown", 80
            )
        events.append(event)
    return "known", events


def read_loss_fields(service):
    """Read and validate the aligned loss history for a service snapshot."""
    return _loss_fields(service)


def _gather_service_damage(connection, *, loss_fields=_LOSS_FIELDS_UNSET):
    if connection is None:
        return None
    try:
        service = connection.vessel_damage
    except AttributeError:
        return None
    except Exception:
        return _unknown_service_result()

    try:
        packed_snapshot = service.packed_snapshot
    except AttributeError:
        pass
    except Exception:
        return _unknown_service_result()
    else:
        try:
            packed_service = _packed_snapshot_service(packed_snapshot())
        except Exception:
            return _unknown_service_result()
        if packed_service is None:
            return {
                **_unknown_service_result(),
                "damage.status": "incomplete",
            }
        service = packed_service
        loss_fields = _LOSS_FIELDS_UNSET

    try:
        if service.available is not True:
            return _unknown_service_result()
        part_ids = list(service.part_ids())
        part_names = list(service.part_names())
        part_titles = list(service.part_titles())
        part_tags = list(service.part_tags())
        module_names = list(service.module_names())
        kinds = list(service.kinds())
        detectors = list(service.detectors())
        try:
            conditions = list(service.conditions())
        except AttributeError:
            conditions = None
        try:
            event_ids = list(service.event_ids())
        except AttributeError:
            event_ids = None
        if conditions is None and event_ids is None:
            conditions = ["damaged"] * len(part_ids)
            event_ids = [""] * len(part_ids)
            has_loss_columns = False
        elif conditions is None or event_ids is None:
            return {
                **_unknown_service_result(),
                "damage.status": "incomplete",
            }
        else:
            has_loss_columns = True
        supported_detectors = list(service.supported_detectors())
        status = service.status
        read_error_count = service.read_error_count
        checked_part_count = service.checked_part_count
        checked_module_count = service.checked_module_count
        damaged_count = service.damaged_count
    except Exception:
        return _unknown_service_result()

    columns = (
        part_ids, part_names, part_titles, part_tags, module_names, kinds,
        detectors, conditions, event_ids,
    )
    if (
        status not in ("known", "incomplete")
        or not isinstance(read_error_count, int)
        or not isinstance(checked_part_count, int)
        or not isinstance(checked_module_count, int)
        or not isinstance(damaged_count, int)
        or read_error_count < 0
        or checked_part_count < 0
        or checked_module_count < 0
        or damaged_count < 0
        or any(len(column) != damaged_count for column in columns)
    ):
        return {
            **_unknown_service_result(),
            "damage.status": "incomplete",
        }

    groups = defaultdict(int)
    for index in range(damaged_count):
        kind = str(kinds[index] or "").strip()
        if kind not in _DAMAGE_KINDS:
            return {
                **_unknown_service_result(),
                "damage.status": "incomplete",
            }
        try:
            part_id = int(part_ids[index])
        except (TypeError, ValueError, OverflowError):
            return {
                **_unknown_service_result(),
                "damage.status": "incomplete",
            }
        if part_id < 0:
            return {
                **_unknown_service_result(),
                "damage.status": "incomplete",
            }
        name = _text(
            part_titles[index],
            _text(part_names[index], kind.replace("_", " ").title(),
                  MAX_DAMAGE_NAME_LENGTH),
            MAX_DAMAGE_NAME_LENGTH,
        )
        tag = _text(part_tags[index], "", MAX_DAMAGE_TAG_LENGTH)
        module = _text(
            module_names[index], "Unknown module", MAX_DAMAGE_MODULE_LENGTH
        )
        detector = _text(
            detectors[index], "Unknown detector", MAX_DAMAGE_MODULE_LENGTH
        )
        condition = str(conditions[index] or "").strip()
        event_id = _text(event_ids[index], "", 120)
        if condition not in ("damaged", "lost") or (
            condition == "lost" and not event_id
        ):
            return {
                **_unknown_service_result(),
                "damage.status": "incomplete",
            }
        identity_part_id = part_id if condition == "lost" else None
        groups[(
            kind, name, tag, module, detector, condition, event_id,
            identity_part_id,
        )] += 1

    damaged = [
        {
            "kind": kind,
            "name": name,
            "tag": tag,
            "module": module,
            "detector": detector,
            "condition": condition,
            "count": count,
            **({"partId": part_id} if part_id is not None else {}),
            **({"eventId": event_id} if event_id else {}),
        }
        for (
            kind, name, tag, module, detector, condition, event_id, part_id
        ), count
        in sorted(groups.items())
    ]
    if loss_fields is _LOSS_FIELDS_UNSET:
        loss_status, loss_events = _loss_fields(service)
    else:
        loss_status, loss_events = loss_fields
    if has_loss_columns and loss_status == "unavailable":
        loss_status = "incomplete"
    return {
        "damage.status": status,
        "damage.source": "vessel_damage",
        "damage.parts": damaged,
        # The service reports detector-level coverage rather than claiming
        # every module in a semantic family has a damage contract.
        "damage.checkedKinds": [],
        "damage.incompleteKinds": (
            [] if status == "known" else ["vessel_damage"]
        ),
        "damage.unsupportedKinds": [],
        "damage.detectors": [
            _text(value, "Unknown detector", MAX_DAMAGE_MODULE_LENGTH)
            for value in supported_detectors
        ],
        "damage.checkedCount": checked_part_count,
        "damage.checkedModuleCount": checked_module_count,
        "damage.readErrorCount": read_error_count,
        "damage.damagedCount": sum(item["count"] for item in damaged),
        "damage.lossStatus": loss_status,
        "damage.lossEvents": loss_events,
    }


def gather_part_damage(
    vessel,
    *,
    connection=None,
    remote_tech_active=False,
    loss_fields=_LOSS_FIELDS_UNSET,
):
    """Return an additive telemetry bundle for currently broken craft parts.

    Prefer the batched in-game VesselDamage service. Older service sets fall
    back to stock kRPC; that API deliberately hides ``Parts.antennas`` when
    RemoteTech is active, so fallback antenna coverage is reported unsupported
    instead of inferred from localized PAW strings.
    """

    service_result = _gather_service_damage(
        connection,
        loss_fields=loss_fields,
    )
    if service_result is not None:
        return service_result

    groups = defaultdict(int)
    checked_kinds = []
    incomplete_kinds = []
    unsupported_kinds = []
    checked_count = 0

    try:
        parts = vessel.parts
    except Exception:
        return {
            "damage.status": "unknown",
            "damage.source": "stock_krpc",
            "damage.parts": [],
            "damage.checkedKinds": [],
            "damage.incompleteKinds": ["parts"],
            "damage.unsupportedKinds": [],
            "damage.lossStatus": "unavailable",
            "damage.lossEvents": [],
        }

    for kind, collection_name in _STATE_COLLECTIONS:
        if kind == "antenna" and remote_tech_active:
            unsupported_kinds.append(kind)
            continue
        count, complete = _scan(
            parts, kind, collection_name, _state_is_broken, groups
        )
        if complete:
            checked_kinds.append(kind)
        else:
            incomplete_kinds.append(kind)
        checked_count += count

    for kind, collection_name in _FLAG_COLLECTIONS:
        count, complete = _scan(
            parts, kind, collection_name, _flag_is_broken, groups
        )
        if complete:
            checked_kinds.append(kind)
        else:
            incomplete_kinds.append(kind)
        checked_count += count

    damaged = [
        {
            "kind": kind,
            "name": name,
            "tag": tag,
            "condition": "damaged",
            "count": count,
        }
        for (kind, name, tag), count in sorted(groups.items())
    ]
    status = "known"
    if incomplete_kinds:
        status = "incomplete" if checked_kinds else "unknown"
    return {
        "damage.status": status,
        "damage.source": "stock_krpc",
        "damage.parts": damaged,
        "damage.checkedKinds": checked_kinds,
        "damage.incompleteKinds": incomplete_kinds,
        "damage.unsupportedKinds": unsupported_kinds,
        "damage.checkedCount": checked_count,
        "damage.damagedCount": sum(item["count"] for item in damaged),
        "damage.lossStatus": "unavailable",
        "damage.lossEvents": [],
    }
