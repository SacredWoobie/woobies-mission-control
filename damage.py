"""Collect authoritative broken-part state from stock kRPC part APIs."""

from __future__ import annotations

from collections import defaultdict


MAX_DAMAGE_NAME_LENGTH = 120
MAX_DAMAGE_TAG_LENGTH = 80
MAX_DAMAGE_MODULE_LENGTH = 120

_DAMAGE_KINDS = {
    "solar_panel", "radiator", "antenna", "landing_leg", "wheel",
    "reaction_wheel", "other",
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
    }


def _gather_service_damage(connection):
    if connection is None:
        return None
    try:
        service = connection.vessel_damage
    except AttributeError:
        return None
    except Exception:
        return _unknown_service_result()

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
        detectors,
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
        groups[(kind, name, tag, module, detector)] += 1

    damaged = [
        {
            "kind": kind,
            "name": name,
            "tag": tag,
            "module": module,
            "detector": detector,
            "count": count,
        }
        for (kind, name, tag, module, detector), count
        in sorted(groups.items())
    ]
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
    }


def gather_part_damage(vessel, *, connection=None, remote_tech_active=False):
    """Return an additive telemetry bundle for currently broken craft parts.

    Prefer the batched in-game VesselDamage service. Older service sets fall
    back to stock kRPC; that API deliberately hides ``Parts.antennas`` when
    RemoteTech is active, so fallback antenna coverage is reported unsupported
    instead of inferred from localized PAW strings.
    """

    service_result = _gather_service_damage(connection)
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
        {"kind": kind, "name": name, "tag": tag, "count": count}
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
    }
