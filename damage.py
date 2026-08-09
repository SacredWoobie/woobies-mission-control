"""Collect authoritative broken-part state from stock kRPC part APIs."""

from __future__ import annotations

from collections import defaultdict


MAX_DAMAGE_NAME_LENGTH = 120
MAX_DAMAGE_TAG_LENGTH = 80

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


def gather_part_damage(vessel, *, remote_tech_active=False):
    """Return an additive telemetry bundle for currently broken craft parts.

    Stock kRPC deliberately hides ``Parts.antennas`` when RemoteTech is active,
    while RemoteTech's own antenna API has no damage-state property. That
    coverage is reported as unsupported instead of inferred from localized PAW
    strings.
    """

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
        "damage.parts": damaged,
        "damage.checkedKinds": checked_kinds,
        "damage.incompleteKinds": incomplete_kinds,
        "damage.unsupportedKinds": unsupported_kinds,
        "damage.checkedCount": checked_count,
        "damage.damagedCount": sum(item["count"] for item in damaged),
    }
