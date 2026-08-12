"""Enrich SystemHeat loops with limits, flux, and component detail.

The KRPC.SystemHeat service exposes these additive procedures. The
collector remains compatible with older services while populating expandable
loop rows whenever the newer procedures are available.
"""

from __future__ import annotations

import math


def _finite_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _rounded_call(service, method_name, loop_id, decimal_places):
    try:
        value = _finite_number(getattr(service, method_name)(loop_id))
    except Exception:
        return None
    return round(value, decimal_places) if value is not None else None


def _list_call(service, method_name, loop_id):
    try:
        values = getattr(service, method_name)(loop_id)
        return list(values)
    except Exception:
        return None


def _boolean_call(service, method_name, loop_id):
    try:
        value = getattr(service, method_name)(loop_id)
    except Exception:
        return None
    return value if isinstance(value, bool) else None


def _string_call(service, method_name, loop_id):
    try:
        value = getattr(service, method_name)(loop_id)
    except Exception:
        return None
    return str(value).strip().lower() if value is not None else None


def _radiator_part_ids(service, loop_id):
    values = _list_call(service, "loop_radiator_part_ids", loop_id)
    if values is None or len(values) > 256:
        return None
    normalized = []
    for value in values:
        if (
            not isinstance(value, int)
            or isinstance(value, bool)
            or value < 0
            or value > 0xFFFFFFFF
        ):
            return None
        normalized.append(value)
    return sorted(normalized)


def _component_groups_from_columns(
    names, part_ids, module_names, roles, fluxes
):
    if names is None or roles is None or fluxes is None:
        return None

    row_count = min(len(names), len(roles), len(fluxes))
    has_part_ids = part_ids is not None and len(part_ids) >= row_count
    physical_groups = {}
    module_groups = {}
    for index in range(row_count):
        name = str(names[index]).strip() if names[index] is not None else ""
        role = str(roles[index]).strip().lower() if roles[index] is not None else ""
        if not name:
            name = "Unknown heat component"
        if not role:
            role = "component"
        module_name = ""
        if module_names is not None and index < len(module_names):
            module_name = (
                str(module_names[index]).strip()
                if module_names[index] is not None
                else ""
            )
        flux = _finite_number(fluxes[index])
        if has_part_ids:
            key = (str(part_ids[index]), name.casefold(), role)
            groups = physical_groups
        else:
            key = (name.casefold(), role, module_name)
            groups = module_groups
        group = groups.setdefault(
            key,
            {
                "name": name,
                "role": role,
                "_moduleNames": set(),
                "count": 1 if has_part_ids else 0,
                "fluxKw": 0.0,
                "_hasFlux": False,
            },
        )
        if not has_part_ids:
            group["count"] += 1
        if module_name:
            group["_moduleNames"].add(module_name)
        if flux is not None:
            group["fluxKw"] += flux
            group["_hasFlux"] = True

    # A physical part may expose several mutually exclusive SystemHeat
    # modules. Stock drills, for example, register planetary, asteroid, and
    # comet harvesters on the same part even though only one produces heat.
    # Collapse those registrations before counting the parts in the UI.
    #
    # Older 0.2.1 services do not expose part IDs. In that compatibility path,
    # each module family enumerates the same physical parts, so the largest
    # family count is the best non-inflating estimate.
    groups = {}
    source_groups = (
        physical_groups.values() if has_part_ids else module_groups.values()
    )
    for source in source_groups:
        key = (source["name"].casefold(), source["role"])
        group = groups.setdefault(
            key,
            {
                "name": source["name"],
                "role": source["role"],
                "_moduleNames": set(),
                "count": 0,
                "fluxKw": 0.0,
                "_hasFlux": False,
            },
        )
        if has_part_ids:
            group["count"] += 1
        else:
            group["count"] = max(group["count"], source["count"])
        group["_moduleNames"].update(source["_moduleNames"])
        if source["_hasFlux"]:
            group["fluxKw"] += source["fluxKw"]
            group["_hasFlux"] = True

    producers = []
    radiators = []
    for group in groups.values():
        has_flux = group.pop("_hasFlux")
        module_names = group.pop("_moduleNames")
        if has_flux:
            group["fluxKw"] = round(group["fluxKw"], 2)
        else:
            group.pop("fluxKw")
        if len(module_names) == 1:
            group["moduleName"] = next(iter(module_names))

        role = group["role"]
        flux = group.get("fluxKw")
        rejection_role = role in {"radiator", "sink", "consumer"} or (
            role == "exchanger" and flux is not None and flux < 0
        )
        (radiators if rejection_role else producers).append(group)

    return {"producers": producers, "radiators": radiators}


def group_component_rows(rows):
    """Group strict packed component rows through the legacy UI semantics."""
    if not isinstance(rows, list) or len(rows) > 2048:
        raise ValueError("invalid System Heat component rows")
    names = []
    part_ids = []
    module_names = []
    roles = []
    fluxes = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("invalid System Heat component row")
        names.append(row["name"])
        part_ids.append(row["partId"])
        module_names.append(row["moduleName"])
        roles.append(row["role"])
        fluxes.append(row["fluxKw"])
    return _component_groups_from_columns(
        names, part_ids, module_names, roles, fluxes
    )


def _component_groups(service, loop_id):
    return _component_groups_from_columns(
        _list_call(service, "loop_component_part_names", loop_id),
        _list_call(service, "loop_component_part_ids", loop_id),
        _list_call(service, "loop_component_module_names", loop_id),
        _list_call(service, "loop_component_roles", loop_id),
        _list_call(service, "loop_component_fluxes", loop_id),
    )


def enrich_system_heat_result(service, result):
    """Add fields supported by the selected service to one collector result."""
    if not isinstance(result, dict):
        return result
    loops = result.get("heat.loops")
    if not isinstance(loops, list):
        return result

    for loop in loops:
        if not isinstance(loop, dict) or "id" not in loop:
            continue
        try:
            loop_id = int(loop["id"])
        except (TypeError, ValueError):
            continue

        nominal = _rounded_call(
            service, "loop_nominal_temperature", loop_id, 1
        )
        if nominal is not None and nominal > 0:
            loop["nominalTempK"] = nominal

        net = _rounded_call(service, "loop_net_flux", loop_id, 2)
        if net is None:
            generated = _finite_number(loop.get("genKw"))
            removed = _finite_number(loop.get("remKw"))
            if generated is not None and removed is not None:
                net = round(generated - removed, 2)
        if net is not None:
            loop["netKw"] = net

        has_radiators = _boolean_call(
            service, "loop_has_radiators", loop_id
        )
        if has_radiators is not None:
            loop["hasRadiators"] = has_radiators

        radiator_part_ids = _radiator_part_ids(service, loop_id)
        radiator_state = _string_call(
            service, "loop_radiator_state", loop_id
        )
        radiator_action = _string_call(
            service, "loop_radiator_control_action", loop_id
        )
        if radiator_part_ids is not None:
            loop["radiatorPartIds"] = radiator_part_ids
            loop["radiatorCount"] = len(radiator_part_ids)
        if radiator_state in {
            "unavailable", "broken", "deploying", "retracting",
            "offline", "partial", "online",
        }:
            loop["radiatorState"] = radiator_state
            loop["radiatorControlAvailable"] = False
        if (
            radiator_action in {"start", "stop"}
            and radiator_part_ids
        ):
            loop["radiatorControlAction"] = radiator_action
            loop["radiatorControlAvailable"] = True

        components = _component_groups(service, loop_id)
        if components is not None:
            loop["producers"] = components["producers"]
            loop["radiators"] = components["radiators"]
    return result
