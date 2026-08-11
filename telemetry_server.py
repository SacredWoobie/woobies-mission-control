"""Standalone kRPC telemetry and WebSocket server for the KSP dashboard.

This module owns every dashboard-facing responsibility:
  * its own kRPC connection and reconnect loop
  * flight, orbit, resource, science, heat, electricity, target, and stage data
  * VAB/SPH craft stage analysis and editor-condition selection
  * the loopback HTTP and WebSocket server consumed by the React dashboard

It has no ESP32, serial-port, staging, abort, or panel-control dependencies.
The physical control pad is handled exclusively by panel_bridge.py in a
separate process and a separate kRPC connection.

Requires:  pip install krpc websockets

Optional args: telemetry_server.py [host] [port]
  telemetry_server.py 0.0.0.0 8090

Set WOOBIE_STAGE_TRACE=1 to emit opt-in StageStats lifecycle diagnostics.
"""
import json
import math
import mimetypes
import os
import re
import sys
import time
import urllib.parse
from http import HTTPStatus
from pathlib import Path

import krpc
from krpc.services.spacecenter import VesselType as KRPCVesselType

from electricity import (
    ElectricityFlowEstimator,
    bracketed_generation_remainder,
    curved_solar_readings,
    latest_generation_total,
    solar_summary,
)
from damage import gather_part_damage, read_loss_fields
from heat import enrich_system_heat_result
from heat_electricity_snapshot import decode_heat_electricity_snapshot
from flight_core_snapshot import decode_flight_core_snapshot
from mission_planning import (
    MAX_ACTION_ID_LENGTH,
    MissionPlanningController,
)
from resource_snapshot import decode_resource_snapshot
from stage_snapshot import decode_flight_stage_snapshot
from staging import enrich_stage_result, flight_conditions
from telemetry_runtime import create_telemetry_runtime

TELEMETRY_WS_PORT = 8090  # dashboard connects here
TELEMETRY_HZ = 4          # dashboard update rate
KRPC_RETRY_SECONDS = 2
KRPC_MAX_ATTEMPTS = 10
KRPC_CONNECTED_EVENT = "WOOBIE_EVENT:KRPC_CONNECTED"
KRPC_RETRY_EXHAUSTED_EVENT = "WOOBIE_EVENT:KRPC_RETRY_EXHAUSTED"
DASHBOARD_WEB_ROOT = Path(__file__).resolve().parent / "web"

# Poll tiers. Flight/orbit/navball values are inexpensive and update every tick.
# Data that requires many RPC round trips is throttled and cached.
SCI_POLL_SECONDS = 5      # science walk is many RPCs
HEAT_POLL_SECONDS = 1     # heat via the custom kRPC service is cheap
ELEC_POLL_SECONDS = 1     # per-reactor + solar + RTG
DAMAGE_POLL_SECONDS = 1   # complete stock breakable-part collections
RES_POLL_SECONDS = 0.5    # Fast path while the vessel is producing thrust.
RES_IDLE_POLL_SECONDS = 2.0  # Retain useful drain/refill updates while idle.
RESOURCE_TOPOLOGY_REFRESH_SECONDS = 5.0
TGT_POLL_SECONDS = 0.5    # target + docking geometry
STAGE_POLL_SECONDS = 0.5  # dv changes continuously during a burn; ~2 Hz readout
STAGE_SETTLE_SECONDS = 0.12  # legacy row fallback waits for MechJeb's async sim
SMART_ASS_NEGATIVE_READY_POLL_SECONDS = 1.0
EDITOR_SUMMARY_RETRY_SECONDS = 1
NOTES_POLL_SECONDS = 2.0
NOTES_MAX_BYTES = 32 * 1024
NOTES_MAX_CATALOG = 500
OVERVIEW_ECONOMY_POLL_SECONDS = 2.0
OVERVIEW_ALARMS_POLL_SECONDS = 2.0
OVERVIEW_FLEET_POLL_SECONDS = 5.0
OVERVIEW_CONTRACTS_POLL_SECONDS = 10.0
OVERVIEW_ROSTER_POLL_SECONDS = 15.0
OVERVIEW_MAX_VESSELS = 500
OVERVIEW_MAX_VESSEL_NAME_LENGTH = 80
OVERVIEW_MAX_VESSEL_CREW = 256
OVERVIEW_MAX_KERBAL_NAME_LENGTH = 128
OVERVIEW_MAX_CONTRACT_TEXT_LENGTH = 4000
OVERVIEW_MAX_CONTRACT_PARAMETERS = 64
OVERVIEW_TRACKED_VESSEL_TYPES = frozenset({
    "Debris", "Probe", "Rover", "Lander", "Ship", "Station", "Base",
    "Plane", "Relay",
})
OVERVIEW_EDITABLE_VESSEL_TYPES = {
    "Base": KRPCVesselType.base,
    "Debris": KRPCVesselType.debris,
    "Lander": KRPCVesselType.lander,
    "Plane": KRPCVesselType.plane,
    "Probe": KRPCVesselType.probe,
    "Relay": KRPCVesselType.relay,
    "Rover": KRPCVesselType.rover,
    "Ship": KRPCVesselType.ship,
    "Station": KRPCVesselType.station,
}
STAGE_TRACE_ENABLED = os.environ.get("WOOBIE_STAGE_TRACE", "").casefold() in {
    "1", "true", "yes", "on",
}

# KSP Recall exposes these internal refund-bookkeeping resources through kRPC.
# They are implementation details, not vessel consumables. Match normalized
# names so case and punctuation differences across mod versions do not matter.
_HIDDEN_RESOURCE_NAMES = frozenset({
    "stealback",
    "stealbackmyfunds",
    "refundingforksp111x",
})

_sci_cache = {}
_sci_last_poll = 0.0
_heat_cache = {}
_heat_last_poll = 0.0
_elec_cache = {}
_elec_last_poll = 0.0
_damage_cache = {}
_damage_last_poll = 0.0
_damage_cache_key = None
_damage_last_ut = None
_damage_loss_cache = None
_damage_loss_revision = None
_res_cache = {}
_res_last_poll = 0.0
_res_cache_key = None
_resource_topology_cache = None
_tgt_cache = {}
_tgt_last_poll = 0.0
_stage_cache = {}
_stage_current_authority = {}
_stage_last_poll = 0.0
_stage_last_ut = None
_stage_trace_last_published = None
_notes_cache = {}
_notes_last_poll = 0.0
_notes_cache_key = None
_notes_selected_path = None
_notes_pinned_path = None
_notes_favorites = None

# MechJeb recalculates editor craft asynchronously. The service exposes an
# editor_stable flag; the server also requires two matching snapshots before
# publishing a changed craft/environment to the dashboard.
_editor_revision = None
_editor_identity = None
_editor_analysis_revision = None
_editor_analysis_identity = None
_editor_analysis_craft_revision = None
_editor_bodies_cache = []
_editor_stage_cache = {}
_editor_stage_last_poll = 0.0
_editor_stage_candidate = None
_editor_stage_candidate_hits = 0
_editor_summary_cache = {}
_editor_summary_candidate = {}
_editor_summary_last_poll = 0.0
_editor_rebuild_cache = {}
_editor_rebuild_token = None
_editor_rebuild_ready = True
_editor_rebuild_trace_last = None
_telemetry_mode = None
_smart_ass_negative_ready_connection = None
_smart_ass_negative_ready_vessel = None
_smart_ass_negative_ready_last_poll = 0.0

# The mission-control overview deliberately uses independent polling tiers.
# Current UT is read every frame; larger collections are scanned much less
# often so a tracking-station dashboard remains inexpensive on mature saves.
_overview_cache = {
    "economy": {},
    "alarms": {},
    "fleet": {},
    "contracts": {},
    "roster": {},
}
_overview_last_poll = {key: 0.0 for key in _overview_cache}
_overview_last_ut = None
_mission_planning = MissionPlanningController()
_electricity_flow = ElectricityFlowEstimator()

_NOTES_PLUGIN_DATA = Path("Plugins") / "PluginData" / "notes"


def _default_notes_favorites_path():
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return (
            Path(local_app_data) / "WoobiesMissionControl" /
            "notes_favorites.json"
        )
    return Path.home() / ".woobies-mission-control" / "notes_favorites.json"


NOTES_FAVORITES_PATH = _default_notes_favorites_path()

# Current-stage resource ownership is inferred only when one decouple group
# contains multiple engine stages. Cache the part assignment until the vessel
# or KSP stage changes; resource amounts themselves are still polled live.
_stage_partition_cache = None

# kRPC builds differ in whether vessel.control.current_stage is available. Probe
# the stock property once and retain the result. StageStats 0.2.8 exposes KSP's
# direct vessel.currentStage value as a compatibility fallback.
#   None  = not probed yet
#   True  = present, use it
#   False = absent, try StageStats instead
_HAS_CURRENT_STAGE = None
_STAGE_STATS_CURRENT_STAGE_REPORTED = False
_CURRENT_STAGE_UNSET = object()
_RESOURCE_IDENTITY_UNSET = object()


# ---------------------------------------------------------------------------
# kRPC connection helper
# ---------------------------------------------------------------------------
def connect_krpc(name):
    print(f"Connecting to kRPC ({name})...")
    conn = krpc.connect(name=name)
    print(f"Connected to kRPC ({name}).")
    return conn


def krpc_wait_message(error):
    """Return an actionable retry message for common local kRPC failures."""
    refused = isinstance(error, ConnectionRefusedError) or getattr(
        error, "winerror", None
    ) == 10061
    if refused:
        return (
            "[telemetry] kRPC refused the connection at 127.0.0.1:50000. "
            "Load a KSP save (the main menu is not enough), then start or "
            "auto-start kRPC using RPC 50000 / Stream 50001. Port 8090 belongs "
            "to Mission Control's browser telemetry feed."
        )
    return f"[telemetry] waiting for kRPC server... ({error})"


def connect_krpc_with_retry(
    name,
    connector=connect_krpc,
    attempts=KRPC_MAX_ATTEMPTS,
    retry_seconds=KRPC_RETRY_SECONDS,
    sleeper=time.sleep,
):
    """Try a bounded number of times and return a kRPC connection or ``None``."""
    for attempt in range(1, attempts + 1):
        try:
            connection = connector(name)
            print(KRPC_CONNECTED_EVENT)
            return connection
        except Exception as error:
            print(
                f"{krpc_wait_message(error)} "
                f"(attempt {attempt}/{attempts})"
            )
            if attempt < attempts:
                sleeper(retry_seconds)
    print(KRPC_RETRY_EXHAUSTED_EVENT)
    print(
        "[telemetry] kRPC connection attempts exhausted. Use Mission Control's "
        "Test connection action after checking KSP and kRPC."
    )
    return None


def dashboard_asset(request_target, web_root=DASHBOARD_WEB_ROOT):
    """Return an HTTP status, media type, cache policy, and local dashboard bytes."""
    root = Path(web_root).resolve()
    path = urllib.parse.unquote(urllib.parse.urlsplit(request_target).path)
    relative_text = path.lstrip("/") or "index.html"
    relative = Path(relative_text.replace("\\", "/"))
    if relative.is_absolute() or ".." in relative.parts:
        return HTTPStatus.NOT_FOUND, "text/plain; charset=utf-8", "no-store", b"Not found\n"

    target = (root / relative).resolve()
    try:
        inside_root = target.is_relative_to(root)
    except AttributeError:
        inside_root = root == target or root in target.parents
    if not inside_root or not target.is_file():
        return HTTPStatus.NOT_FOUND, "text/plain; charset=utf-8", "no-store", b"Not found\n"

    media_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    # Python's platform MIME database may report JavaScript as either
    # text/javascript or application/javascript. Keep the loopback server's
    # response stable across supported Windows/Python environments.
    if target.suffix.casefold() == ".js":
        media_type = "text/javascript"
    if media_type.startswith("text/") or media_type in {
        "application/javascript", "application/json", "image/svg+xml"
    }:
        media_type += "; charset=utf-8"
    cache_policy = (
        "no-cache"
        if target.name == "index.html"
        else "public, max-age=31536000, immutable"
    )
    return HTTPStatus.OK, media_type, cache_policy, target.read_bytes()


def _stage_summary(snapshot):
    """Return the small StageStats state needed for lifecycle diagnostics."""
    if not isinstance(snapshot, dict):
        return {}
    rows = snapshot.get("stage.stages")
    return {
        "available": snapshot.get("stage.available"),
        "complete": snapshot.get("stage.complete"),
        "pending": snapshot.get("stage.pending"),
        "count": snapshot.get("stage.count"),
        "currentKsp": snapshot.get("stage.currentKsp"),
        "rows": len(rows) if isinstance(rows, list) else None,
    }


def _stage_trace(event, **fields):
    """Emit one compact JSON diagnostic when StageStats tracing is enabled."""
    if not STAGE_TRACE_ENABLED:
        return
    record = {
        "event": event,
        "wallTime": round(time.time(), 3),
    }
    record.update(fields)
    print("[stage-trace] " + json.dumps(record, sort_keys=True, default=str),
          flush=True)


def _trace_stage_publish(snapshot, source):
    """Trace only stage-state transitions, not every 4 Hz telemetry frame."""
    global _stage_trace_last_published
    if not STAGE_TRACE_ENABLED:
        return
    summary = _stage_summary(snapshot)
    signature = tuple(summary.get(key) for key in (
        "available", "complete", "pending", "count", "currentKsp", "rows",
    ))
    if signature != _stage_trace_last_published:
        _stage_trace_last_published = signature
        _stage_trace("publish_transition", source=source, stage=summary)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def _mag(v):
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


def _normalized_resource_name(name):
    return "".join(ch for ch in str(name).casefold() if ch.isalnum())


def _is_consumable_resource(name):
    return _normalized_resource_name(name) not in _HIDDEN_RESOURCE_NAMES


def _resource_values(resources):
    """Return visible resource amounts and capacities from a kRPC container."""
    values = {}
    try:
        names = resources.names
    except Exception:
        return values
    for name in names:
        if not _is_consumable_resource(name):
            continue
        try:
            maximum = resources.max(name)
            if maximum > 0:
                values[name] = (resources.amount(name), maximum)
        except Exception:
            pass
    return values


def _part_index(parts, wanted):
    """Find a kRPC Part proxy without assuming remote objects are hashable."""
    if wanted is None:
        return -1
    for index, part in enumerate(parts):
        try:
            if part == wanted:
                return index
        except Exception:
            if part is wanted:
                return index
    return -1


def _tree_distance(first, second, parent_indexes):
    """Number of attachment edges between two indexes in the vessel part tree."""
    first_path = {}
    index = first
    distance = 0
    while index >= 0 and index not in first_path:
        first_path[index] = distance
        index = parent_indexes[index]
        distance += 1

    index = second
    distance = 0
    visited = set()
    while index >= 0 and index not in visited:
        if index in first_path:
            return distance + first_path[index]
        visited.add(index)
        index = parent_indexes[index]
        distance += 1
    return 1000000


def _stage_partition_parts(vessel, decouple_stage, current_stage):
    """Assign a shared decouple group to its operational engine stages.

    KSP has no direct concept of resource ownership when several burn stages
    remain permanently attached (all report decouple_stage=-1). Resource types
    provide the strongest signal: a LiquidFuel tank belongs to a LiquidFuel
    engine stage and an LqdHydrogen tank to an LqdHydrogen stage. Shared or
    stage-neutral stores such as Oxidizer, ElectricCharge, uranium, and depleted
    fuel are assigned to the closest engine stage in the vessel attachment tree.
    """
    global _stage_partition_cache

    cached = _stage_partition_cache
    if cached is not None:
        try:
            if (cached["vessel"] == vessel
                    and cached["decouple_stage"] == decouple_stage
                    and cached["current_stage"] == current_stage):
                return cached["activation_stage"], cached["parts"]
        except Exception:
            _stage_partition_cache = None

    try:
        parts = list(vessel.parts.all)
        engines = list(vessel.parts.engines)
    except Exception:
        return None, None

    part_stages = []
    part_decouple_stages = []
    part_resource_names = []
    for part in parts:
        try:
            part_stages.append(int(part.stage))
        except Exception:
            part_stages.append(-1)
        try:
            part_decouple_stages.append(int(part.decouple_stage))
        except Exception:
            part_decouple_stages.append(-999999)
        try:
            names = {
                name for name in part.resources.names
                if _is_consumable_resource(name)
            }
        except Exception:
            names = set()
        part_resource_names.append(names)

    anchors = []
    propellants_by_stage = {}
    for engine in engines:
        try:
            part_index = _part_index(parts, engine.part)
            if part_index < 0:
                continue
            if part_decouple_stages[part_index] != decouple_stage:
                continue
            activation_stage = part_stages[part_index]
            if activation_stage < 0:
                continue
            propellants = {
                name for name in engine.propellant_names
                if _is_consumable_resource(name)
            }
            anchors.append((activation_stage, part_index))
            propellants_by_stage.setdefault(activation_stage, set()).update(
                propellants
            )
        except Exception:
            pass

    anchor_stages = sorted(propellants_by_stage)
    eligible_stages = [
        stage for stage in anchor_stages if stage <= current_stage
    ]
    if len(anchor_stages) < 2 or not eligible_stages:
        result = (None, None)
        _stage_partition_cache = {
            "vessel": vessel,
            "decouple_stage": decouple_stage,
            "current_stage": current_stage,
            "activation_stage": result[0],
            "parts": result[1],
        }
        return result

    target_stage = max(eligible_stages)

    resource_users = {}
    for stage, names in propellants_by_stage.items():
        for name in names:
            resource_users.setdefault(name, set()).add(stage)

    parent_indexes = []
    for part in parts:
        try:
            parent_indexes.append(_part_index(parts, part.parent))
        except Exception:
            parent_indexes.append(-1)

    assigned_parts = []
    for part_index, names in enumerate(part_resource_names):
        if (part_decouple_stages[part_index] != decouple_stage or not names):
            continue

        # An engine part's own stored resources belong to its activation stage.
        staged_part = part_stages[part_index]
        if staged_part in propellants_by_stage:
            assigned_stage = staged_part
        else:
            scores = {}
            for stage, propellants in propellants_by_stage.items():
                score = 0
                for name in names:
                    if name not in propellants:
                        continue
                    # A resource unique to one engine stage is much stronger
                    # evidence than a shared resource such as Oxidizer.
                    score += 4 if len(resource_users[name]) == 1 else 1
                scores[stage] = score

            best_score = max(scores.values())
            candidates = [
                stage for stage, score in scores.items()
                if score == best_score
            ]
            if best_score > 0 and len(candidates) == 1:
                assigned_stage = candidates[0]
            else:
                # Neutral resources (EC, uranium, depleted fuel) and ties are
                # owned by the structurally closest engine stage.
                assigned_stage = min(
                    anchors,
                    key=lambda anchor: (
                        _tree_distance(
                            part_index, anchor[1], parent_indexes
                        ),
                        anchor[0],
                    ),
                )[0]

        if assigned_stage == target_stage:
            assigned_parts.append(parts[part_index])

    _stage_partition_cache = {
        "vessel": vessel,
        "decouple_stage": decouple_stage,
        "current_stage": current_stage,
        "activation_stage": target_stage,
        "parts": assigned_parts,
    }
    return target_stage, assigned_parts


def _resource_values_for_parts(parts):
    """Aggregate all visible resources stored on the supplied vessel parts."""
    values = {}
    for part in parts:
        try:
            part_values = _resource_values(part.resources)
        except Exception:
            continue
        for name, (amount, maximum) in part_values.items():
            previous_amount, previous_maximum = values.get(name, (0.0, 0.0))
            values[name] = (
                previous_amount + amount,
                previous_maximum + maximum,
            )
    return values


def _resource_capacities(resources, include_zero=False):
    """Read the cold names/capacities for one kRPC resource container."""
    capacities = {}
    for name in resources.names:
        if not _is_consumable_resource(name):
            continue
        maximum = resources.max(name)
        if include_zero or maximum > 0:
            capacities[name] = maximum
    return capacities


def _clear_resource_topology_cache(clear_partition=True):
    """Discard vessel/stage resource topology and its part assignment."""
    global _resource_topology_cache, _stage_partition_cache
    _resource_topology_cache = None
    if clear_partition:
        _stage_partition_cache = None


def _resource_part_signature(vessel):
    """Return stable kRPC part object IDs with one bounded part-list read."""
    parts = list(vessel.parts.all)
    return tuple(
        getattr(part, "_object_id", id(part))
        for part in parts
    )


def _same_resource_vessel(cached, vessel, identity):
    """Compare a cache context without requiring remote proxies to be hashable."""
    if identity:
        return cached.get("identity") == identity
    try:
        return cached.get("vessel") == vessel
    except Exception:
        return cached.get("vessel") is vessel


def _build_stage_resource_topology(vessel, current_stage):
    """Resolve the current stage once and retain only cold topology data."""
    for decouple_stage in range(current_stage - 1, -2, -1):
        resources = vessel.resources_in_decouple_stage(
            stage=decouple_stage,
            cumulative=False,
        )
        capacities = _resource_capacities(resources)
        if not capacities:
            continue

        activation_stage, parts = _stage_partition_parts(
            vessel, decouple_stage, current_stage
        )
        if parts is None:
            return {
                "resource_stage": decouple_stage,
                "activation_stage": None,
                "capacities": capacities,
                "sources": [(resources, tuple(capacities))],
            }

        aggregate_capacities = {}
        sources = []
        for part in parts:
            part_resources = part.resources
            part_capacities = _resource_capacities(part_resources)
            if not part_capacities:
                continue
            sources.append((part_resources, tuple(part_capacities)))
            for name, maximum in part_capacities.items():
                aggregate_capacities[name] = (
                    aggregate_capacities.get(name, 0.0) + maximum
                )
        return {
            "resource_stage": decouple_stage,
            "activation_stage": activation_stage,
            "capacities": aggregate_capacities,
            "sources": sources,
        }
    return None


def _build_resource_topology(
        vessel, current_stage, identity, now, part_signature):
    """Build a bounded cold snapshot for repeated hot amount reads."""
    vessel_resources = vessel.resources
    vessel_capacities = _resource_capacities(
        vessel_resources,
        include_zero=True,
    )
    stage = None
    if current_stage is not None:
        stage = _build_stage_resource_topology(vessel, current_stage)
    return {
        "vessel": vessel,
        "identity": identity,
        "current_stage": current_stage,
        "built_at": now,
        "part_signature": part_signature,
        "vessel_capacities": vessel_capacities,
        "vessel_sources": [
            (vessel_resources, tuple(vessel_capacities))
        ],
        "stage": stage,
    }


def _current_resource_topology(vessel, current_stage, identity, now):
    """Return a matching fresh topology, rebuilding on every context epoch."""
    global _resource_topology_cache
    cached = _resource_topology_cache
    same_context = False
    if cached is not None:
        try:
            same_context = (
                _same_resource_vessel(cached, vessel, identity)
                and cached.get("current_stage") == current_stage
            )
            if same_context and (
                now - cached["built_at"] < RESOURCE_TOPOLOGY_REFRESH_SECONDS
            ):
                return cached
        except Exception:
            same_context = False

    # One part-list read detects docking, undocking, destruction, and mod-driven
    # topology changes without repeating per-part metadata calls. Preserve the
    # existing partition only for an expired but otherwise unchanged context.
    part_signature = _resource_part_signature(vessel)
    keep_partition = (
        same_context
        and cached.get("part_signature") == part_signature
    )
    _clear_resource_topology_cache(clear_partition=not keep_partition)
    topology = _build_resource_topology(
        vessel,
        current_stage,
        identity,
        now,
        part_signature,
    )
    _resource_topology_cache = topology
    return topology


def _resource_amounts(sources, capacities):
    """Aggregate hot amounts using cached container handles and resource names."""
    amounts = {name: 0.0 for name in capacities}
    for resources, names in sources:
        for name in names:
            amounts[name] += resources.amount(name)
    return amounts


def _render_resource_topology(topology):
    """Project cached cold data plus live amounts into the public schema."""
    capacities = topology["vessel_capacities"]
    amounts = _resource_amounts(topology["vessel_sources"], capacities)
    out = {
        "res.status": "known",
        "res.names": list(capacities),
        "res.stageKnown": topology["current_stage"] is not None,
    }
    for name, maximum in capacities.items():
        out[f"r.resource[{name}]"] = amounts[name]
        out[f"r.resourceMax[{name}]"] = maximum

    stage = topology.get("stage")
    if stage is not None:
        out["res.stageResourceStage"] = stage["resource_stage"]
        if stage["activation_stage"] is not None:
            out["res.stageActivationStage"] = stage["activation_stage"]
        stage_amounts = _resource_amounts(
            stage["sources"],
            stage["capacities"],
        )
        for name, maximum in stage["capacities"].items():
            out[f"r.resourceCurrent[{name}]"] = stage_amounts[name]
            out[f"r.resourceCurrentMax[{name}]"] = maximum
    return out


# ---------------------------------------------------------------------------
# Notes mod compatibility (zer0Kerbal/Notes)
# ---------------------------------------------------------------------------
def _load_notes_favorites(path=None):
    """Load saved relative note paths, returning an empty set on bad data."""
    if path is None:
        path = NOTES_FAVORITES_PATH
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError):
        return set()
    if not isinstance(payload, dict) or not isinstance(payload.get("favorites"), list):
        return set()
    return {
        value.replace("\\", "/")
        for value in payload["favorites"]
        if isinstance(value, str) and value and len(value) <= 1024
    }


def _save_notes_favorites(favorites, path=None):
    """Atomically persist favorite note keys outside the Notes mod folder."""
    if path is None:
        path = NOTES_FAVORITES_PATH
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps({"favorites": sorted(favorites, key=str.casefold)}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def _get_notes_favorites():
    global _notes_favorites
    if _notes_favorites is None:
        _notes_favorites = _load_notes_favorites()
    return set(_notes_favorites)


def _resolve_notes_dir(ksp_root=None):
    """Return the installed Notes text directory, or ``None``.

    A configured KSP root is authoritative. Relative fallbacks retain the
    convenient source-checkout/KSP_ROOT/Dashboard development arrangement.
    Both directory casings are accepted for provisional non-Windows support.
    """
    configured = ksp_root
    if configured is None:
        configured = os.environ.get("WOOBIE_KSP_ROOT", "").strip()

    if configured:
        roots = [Path(os.path.expandvars(str(configured))).expanduser()]
    else:
        script_dir = Path(__file__).resolve().parent
        roots = [Path.cwd().parent, Path.cwd(), script_dir.parent, script_dir]

    seen = set()
    for root in roots:
        try:
            root = root.resolve(strict=False)
        except (OSError, RuntimeError):
            continue
        for mod_folder in ("Notes", "notes"):
            candidate = root / "GameData" / mod_folder / _NOTES_PLUGIN_DATA
            try:
                candidate = candidate.resolve(strict=False)
                key = os.path.normcase(str(candidate))
                if key in seen:
                    continue
                seen.add(key)
                if candidate.is_dir():
                    return candidate
            except (OSError, RuntimeError):
                pass
    return None


def _list_note_paths(notes_dir):
    """Return saved Notes text files in a stable, searchable order."""
    paths = []
    try:
        candidates = notes_dir.rglob("*.txt")
    except OSError:
        return paths
    for path in candidates:
        try:
            if path.is_file():
                paths.append(path)
        except OSError:
            continue
    return sorted(
        paths,
        key=lambda path: path.relative_to(notes_dir).as_posix().casefold(),
    )


def _find_active_note(notes_dir, vessel_name, note_paths=None):
    """Find the newest exact ship-log match, including Notes subfolders."""
    if not vessel_name:
        return None
    expected = f"log_{vessel_name}"
    matches = []
    for path in note_paths if note_paths is not None else _list_note_paths(notes_dir):
        try:
            if path.stem == expected:
                matches.append((path.stat().st_mtime, path))
        except OSError:
            continue
    return max(matches, default=(None, None), key=lambda item: item[0])[1]


def _read_note_tail(path, max_bytes=NOTES_MAX_BYTES):
    """Return a bounded UTF-8 tail and whether content was truncated."""
    with path.open("rb") as stream:
        stream.seek(0, 2)
        byte_size = stream.tell()
        start = max(0, byte_size - max_bytes)
        stream.seek(start)
        raw = stream.read(max_bytes)

    text = raw.decode("utf-8", errors="replace")
    if start:
        # The first decoded line may begin in the middle of a multibyte value or
        # log entry. Drop it when possible so the visible tail starts cleanly.
        _discarded, separator, remainder = text.partition("\n")
        if separator:
            text = remainder
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return text, start > 0, byte_size


def _note_payload(path, notes_dir):
    """Return bounded content and metadata for one catalogued note."""
    stat = path.stat()
    text, truncated, byte_size = _read_note_tail(path)
    return {
        "name": path.stem,
        "relativePath": path.relative_to(notes_dir).as_posix(),
        "modified": stat.st_mtime,
        "size": byte_size,
        "text": text,
        "truncated": truncated,
    }


def _gather_notes(
        vessel_name, ksp_root=None, selected_path=None, favorites=None,
        pinned_path=None):
    """Read the active log, catalog, browsed note, and flight-panel note."""
    notes_dir = _resolve_notes_dir(ksp_root)
    if notes_dir is None:
        return {
            "notes.available": False,
            "notes.activeFound": False,
            "notes.message": "Notes mod folder not found.",
            "notes.active": None,
            "notes.selected": None,
            "notes.selectedPath": "",
            "notes.selectionMode": "active",
            "notes.pinned": None,
            "notes.pinnedPath": "",
            "notes.catalog": [],
            "notes.catalogTruncated": False,
        }

    favorite_paths = set(favorites or ())
    note_paths = _list_note_paths(notes_dir)
    note_paths.sort(key=lambda path: (
        0 if path.relative_to(notes_dir).as_posix() in favorite_paths else 1,
        path.relative_to(notes_dir).as_posix().casefold(),
    ))
    active_path = _find_active_note(notes_dir, vessel_name, note_paths)
    selected_lookup = selected_path.replace("\\", "/") if isinstance(selected_path, str) else None
    selected_note_path = next(
        (
            path for path in note_paths
            if path.relative_to(notes_dir).as_posix() == selected_lookup
        ),
        None,
    )
    pinned_lookup = pinned_path.replace("\\", "/") if isinstance(pinned_path, str) else None
    pinned_note_path = next(
        (
            path for path in note_paths
            if path.relative_to(notes_dir).as_posix() == pinned_lookup
        ),
        None,
    )
    selection_mode = "browse" if selected_note_path is not None else "active"
    if selected_note_path is None:
        selected_note_path = active_path

    catalog_truncated = len(note_paths) > NOTES_MAX_CATALOG
    catalog_paths = note_paths[:NOTES_MAX_CATALOG]
    for important_path in (active_path, selected_note_path, pinned_note_path):
        if important_path is not None and important_path not in catalog_paths:
            # Keep context-critical entries even when the ordinary catalog cap
            # has been reached. This can exceed the cap by at most three.
            catalog_paths.append(important_path)
    catalog_paths = sorted(
        set(catalog_paths),
        key=lambda path: (
            0 if path.relative_to(notes_dir).as_posix() in favorite_paths else 1,
            path.relative_to(notes_dir).as_posix().casefold(),
        ),
    )
    catalog = []
    for path in catalog_paths:
        try:
            stat = path.stat()
            relative_path = path.relative_to(notes_dir).as_posix()
            catalog.append({
                "name": path.stem,
                "relativePath": relative_path,
                "modified": stat.st_mtime,
                "size": stat.st_size,
                "isActiveLog": path == active_path,
                "isFavorite": relative_path in favorite_paths,
            })
        except (OSError, ValueError):
            continue

    active_note = None
    selected_note = None
    pinned_note = None
    try:
        if active_path is not None:
            active_note = _note_payload(active_path, notes_dir)
        if selected_note_path == active_path:
            selected_note = active_note
        elif selected_note_path is not None:
            selected_note = _note_payload(selected_note_path, notes_dir)
        if pinned_note_path == active_path:
            pinned_note = active_note
        elif pinned_note_path == selected_note_path:
            pinned_note = selected_note
        elif pinned_note_path is not None:
            pinned_note = _note_payload(pinned_note_path, notes_dir)
    except (OSError, ValueError):
        if selected_note_path == active_path:
            active_note = None
        selected_note = None
        pinned_note = None

    if selected_note is not None and selection_mode == "browse":
        message = "Saved note selected."
    elif active_note is not None:
        message = ""
    elif note_paths:
        message = "No ship log exists for the active vessel. Choose another saved note."
    else:
        message = "No saved notes were found."

    return {
        "notes.available": True,
        "notes.activeFound": active_note is not None,
        "notes.message": message,
        "notes.active": active_note,
        "notes.selected": selected_note,
        "notes.selectedPath": (
            selected_note["relativePath"] if selected_note is not None else ""
        ),
        "notes.selectionMode": selection_mode,
        "notes.pinned": pinned_note,
        "notes.pinnedPath": (
            pinned_note["relativePath"] if pinned_note is not None else ""
        ),
        "notes.catalog": catalog,
        "notes.catalogTruncated": catalog_truncated,
    }


def _attach_notes_telemetry(data, vessel_name="", now=None):
    """Attach cached Notes data in flight, editor, and inactive scenes."""
    global _notes_cache, _notes_last_poll, _notes_cache_key
    global _notes_selected_path, _notes_pinned_path

    if now is None:
        now = time.time()
    notes_key = (os.environ.get("WOOBIE_KSP_ROOT", ""), vessel_name)
    if notes_key != _notes_cache_key:
        _notes_cache_key = notes_key
        _notes_cache = {}
        _notes_last_poll = 0.0
    if now - _notes_last_poll >= NOTES_POLL_SECONDS:
        _notes_last_poll = now
        try:
            _notes_cache = _gather_notes(
                vessel_name,
                selected_path=_notes_selected_path,
                favorites=_get_notes_favorites(),
                pinned_path=_notes_pinned_path,
            )
        except Exception:
            _notes_cache = {
                "notes.available": False,
                "notes.activeFound": False,
                "notes.message": "Notes scan failed.",
                "notes.active": None,
                "notes.selected": None,
                "notes.selectedPath": "",
                "notes.selectionMode": "active",
                "notes.pinned": None,
                "notes.pinnedPath": "",
                "notes.catalog": [],
                "notes.catalogTruncated": False,
            }
    data.update(_notes_cache)
    return data


def _current_stage_resource_values(vessel, current_stage):
    """Return the current operational stage's resource values."""
    # resources_in_decouple_stage groups parts by when they are discarded, not
    # by the stage that activated their engines. Pure separator/fairing stages
    # can therefore be empty, and parts that are never discarded use stage -1.
    # Walk downward through those gaps instead of assuming current_stage - 1 is
    # always the resource-bearing group. cumulative=False is deliberate: kRPC's
    # cumulative direction does not include the never-decoupled -1 group.
    for decouple_stage in range(current_stage - 1, -2, -1):
        try:
            resources = vessel.resources_in_decouple_stage(
                stage=decouple_stage,
                cumulative=False,
            )
            values = _resource_values(resources)
            if not values:
                continue

            activation_stage, parts = _stage_partition_parts(
                vessel, decouple_stage, current_stage
            )
            if parts is not None:
                return (
                    decouple_stage,
                    activation_stage,
                    _resource_values_for_parts(parts),
                )
            return decouple_stage, None, values
        except Exception:
            pass
    return None, None, {}


def _current_stage(vessel, stage_snapshot=None, control=None):
    """Return the active KSP stage from stock kRPC or StageStats."""
    global _HAS_CURRENT_STAGE, _STAGE_STATS_CURRENT_STAGE_REPORTED
    if _HAS_CURRENT_STAGE is not False:
        try:
            selected_control = control if control is not None else vessel.control
            try:
                stage = int(selected_control.current_stage)
            except Exception:
                if control is None:
                    raise
                stage = int(vessel.control.current_stage)
            if _HAS_CURRENT_STAGE is None:
                print("[telemetry] current-stage resources use stock kRPC.")
            _HAS_CURRENT_STAGE = True
            if stage < 0:
                return None
            return stage
        except Exception:
            if _HAS_CURRENT_STAGE is None:
                print("[telemetry] stock kRPC does not expose the current stage; "
                      "trying StageStats.")
            _HAS_CURRENT_STAGE = False

    if not isinstance(stage_snapshot, dict):
        return None
    try:
        stage = int(stage_snapshot["stage.currentKsp"])
        if stage < 0:
            return None
        if not _STAGE_STATS_CURRENT_STAGE_REPORTED:
            print("[telemetry] current-stage resources use StageStats.")
            _STAGE_STATS_CURRENT_STAGE_REPORTED = True
        return stage
    except Exception:
        return None


def _current_stage_authority(stage_result):
    """Keep only a fresh, valid StageStats current-stage sample."""
    if not isinstance(stage_result, dict):
        return {}
    try:
        stage = int(stage_result["stage.currentKsp"])
    except (KeyError, TypeError, ValueError):
        return {}
    if stage < 0:
        return {}
    return {"stage.currentKsp": stage}


# ---------------------------------------------------------------------------
# Resources (vessel total + current stage)
# ---------------------------------------------------------------------------
def _gather_resources_full_scan(vessel, current_stage=_CURRENT_STAGE_UNSET):
    """Original compatibility path for a complete uncached resource scan."""
    out = {"res.status": "known"}
    try:
        res = vessel.resources
        names = [name for name in res.names if _is_consumable_resource(name)]
    except Exception:
        return {"res.status": "unknown"}

    out["res.names"] = names
    for n in names:
        try:
            out[f"r.resource[{n}]"] = res.amount(n)
            out[f"r.resourceMax[{n}]"] = res.max(n)
        except Exception:
            out["res.status"] = "incomplete"

    stage = (
        _current_stage(vessel)
        if current_stage is _CURRENT_STAGE_UNSET
        else current_stage
    )
    # Distinguish an unavailable stage index from a valid stage with no resources.
    out["res.stageKnown"] = (stage is not None)
    if stage is not None:
        resource_stage, activation_stage, stage_values = (
            _current_stage_resource_values(vessel, stage)
        )
        if resource_stage is not None:
            out["res.stageResourceStage"] = resource_stage
        if activation_stage is not None:
            out["res.stageActivationStage"] = activation_stage
        for name, (amount, maximum) in stage_values.items():
            out[f"r.resourceCurrent[{name}]"] = amount
            out[f"r.resourceCurrentMax[{name}]"] = maximum

    return out


def _gather_resources(
        vessel, current_stage=_CURRENT_STAGE_UNSET,
        resource_identity=None, now=None):
    """Return resources using cached cold topology and live hot amounts.

    Any topology-build or cached-proxy failure clears the optimization and
    returns through the original complete scan in the same poll.
    """
    if now is None:
        now = time.time()
    stage = (
        _current_stage(vessel)
        if current_stage is _CURRENT_STAGE_UNSET
        else current_stage
    )
    try:
        topology = _current_resource_topology(
            vessel,
            stage,
            resource_identity,
            now,
        )
        return _render_resource_topology(topology)
    except Exception:
        _clear_resource_topology_cache()
        return _gather_resources_full_scan(vessel, current_stage=stage)


def _gather_resources_preferred(
        conn, vessel, current_stage=_CURRENT_STAGE_UNSET,
        resource_identity=None, now=None,
        expected_vessel_id=_RESOURCE_IDENTITY_UNSET):
    """Prefer one custom-service call, retaining stock fallback in this poll."""
    stage = (
        _current_stage(vessel)
        if current_stage is _CURRENT_STAGE_UNSET
        else current_stage
    )
    try:
        packed = conn.vessel_resources.packed_snapshot(
            stage if stage is not None else -1
        )
        expected = (
            resource_identity
            if expected_vessel_id is _RESOURCE_IDENTITY_UNSET
            else expected_vessel_id
        )
        if expected is None:
            # Stock kRPC 0.6 doesn't expose KSP's vessel GUID. The packed
            # service stamps its captured Vessel.id and keys its cache by that
            # identity; one post-call proxy check prevents publishing a capture
            # after an active-vessel transition without reviving the stock
            # per-part topology walk.
            if conn.space_center.active_vessel != vessel:
                raise RuntimeError(
                    "active vessel changed during resource snapshot"
                )
        return decode_resource_snapshot(
            packed,
            expected_vessel_id=expected,
            expected_stage=stage,
        )
    except Exception:
        return _gather_resources(
            vessel,
            current_stage=stage,
            resource_identity=resource_identity,
            now=now,
        )


def _resource_poll_interval(telemetry):
    """Keep full burn responsiveness without repeating idle topology work."""
    for key in ("krpc.throttle", "v.thrust"):
        try:
            if float(telemetry.get(key, 0.0)) > 0.001:
                return RES_POLL_SECONDS
        except (TypeError, ValueError):
            pass
    return RES_IDLE_POLL_SECONDS


# ---------------------------------------------------------------------------
# Target + docking geometry
# ---------------------------------------------------------------------------
def _gather_dock(vessel, target_port):
    """Derive docking alignment from kRPC reference-frame data.

    In a docking port's reference frame the +y axis points OUT of the port and
    x/z lie in its face plane. So, expressed in OUR port's frame:
      - the target port's position gives lateral offset (x, z) and axial gap (y)
      - a perfectly-aligned target port faces back at us, i.e. direction ~ (0,-1,0);
        the deviation of that vector from -y is the angular misalignment.
    Axis signs depend on KSP's docking-port reference-frame convention.
    """
    ours = None
    try:
        ctrl = vessel.parts.controlling
        ours = ctrl.docking_port if ctrl is not None else None
    except Exception:
        ours = None
    if ours is None or target_port is None:
        return {}

    try:
        ref = ours.reference_frame
        px, py, pz = target_port.position(ref)
        dx, dy, dz = target_port.direction(ref)
    except Exception:
        return {}

    if abs(dy) < 1e-6:
        dy = -1e-6  # avoid a divide-by-zero blowup at 90 deg off

    return {
        "dock.x": px,                                   # lateral offset, m
        "dock.y": pz,                                   # lateral offset, m
        "dock.axial": py,                               # gap along the docking axis, m
        "dock.ax": math.degrees(math.atan2(dz, -dy)),   # angular misalignment, deg
        "dock.ay": math.degrees(math.atan2(dx, -dy)),
    }


def _current_target(space_center):
    """Return the exact selected kRPC target proxy and its dashboard type."""
    for attribute, target_type in (
        ("target_docking_port", "dockingport"),
        ("target_vessel", "vessel"),
        ("target_body", "body"),
    ):
        try:
            target = getattr(space_center, attribute)
            if target is not None:
                return target, target_type
        except Exception:
            pass
    return None, ""


def _gather_target(conn, vessel):
    sc = conn.space_center
    out = {}
    tgt, ttype = _current_target(sc)
    tport = None
    target_part = None
    target_vessel = None

    if ttype == "dockingport":
        tport = tgt
        try:
            target_part = tport.part
        except Exception:
            target_part = None
        try:
            target_vessel = target_part.vessel
        except Exception:
            target_vessel = None

    if tgt is None:
        return {"tar.name": ""}   # explicit "no target" -- dashboard hides the panel

    try:
        target_object_id = getattr(tgt, "_object_id")
        if (
            isinstance(target_object_id, int)
            and not isinstance(target_object_id, bool)
            and target_object_id > 0
        ):
            out["tar.objectId"] = str(target_object_id)
    except Exception:
        pass

    if ttype == "dockingport":
        try:
            vessel_name = str(target_vessel.name).strip()
        except Exception:
            vessel_name = ""
        out["tar.name"] = (
            f"{vessel_name} Docking Port" if vessel_name else "Docking Port"
        )
    else:
        try:
            out["tar.name"] = tgt.name
        except Exception:
            out["tar.name"] = ttype
    out["tar.type"] = ttype

    # Distance / relative velocity, expressed in OUR vessel's frame.
    try:
        vref = vessel.reference_frame
    except Exception:
        vref = None
    try:
        if vref is not None:
            out["tar.distance"] = _mag(tgt.position(vref))
    except Exception:
        pass
    try:
        velocity_src = target_part if ttype == "dockingport" else tgt
        if velocity_src is not None and vref is not None:
            out["tar.o.relativeVelocity"] = _mag(velocity_src.velocity(vref))
    except Exception:
        pass

    # Target's own orbit. A docking port has no .orbit -- climb to its vessel.
    orbit_src = target_vessel if ttype == "dockingport" else tgt
    try:
        o = orbit_src.orbit if orbit_src is not None else None
        if o is not None:
            out["tar.o.ApA"] = o.apoapsis_altitude
            out["tar.o.PeA"] = o.periapsis_altitude
            out["tar.o.inclination"] = math.degrees(o.inclination)  # kRPC: radians
            out["tar.o.velocity"] = o.speed
    except Exception:
        pass

    if ttype == "dockingport":
        out.update(_gather_dock(vessel, tport))

    return out


# ---------------------------------------------------------------------------
# Per-stage delta-V via the custom KRPC.StageStats service (MechJeb's sim).
#
# The service indexes stages by ARRAY INDEX: index 0 is the final/upper stage.
# A complete flight result includes every KSP staging slot, including
# zero-thrust decoupler/fairing stages. In the editor, MechJeb can also append
# one empty virtual slot above the highest inverseStage assigned to a part.
# StageStats 0.2.6+ exposes rebuild provenance, so after that provenance is
# verified we accept MechJeb's explicit contiguous KSPStage sequence as the
# table authority. Older services retain the strict currentStage + 1 check.
#
#   ksp_number(index) = current_ksp - ((count - 1) - index)
#                     = index + (current_ksp - (count - 1))
#
# atmo (current-pressure) and vac are both emitted per row; the dashboard picks.
# StageStats 0.2.10+ returns the complete Flight table in one RPC and opens a
# short server-side demand lease so MechJeb's async job finishes for the next
# poll. Older services retain the prime/settle/per-field compatibility path.
# ---------------------------------------------------------------------------
_EDITOR_STAGE_SNAPSHOT_HEADER_WIDTHS = {1: 11, 2: 12}
_EDITOR_STAGE_SNAPSHOT_ROW_WIDTH = 7


def _snapshot_integer(value, label):
    number = float(value)
    if not math.isfinite(number) or not number.is_integer():
        raise ValueError(f"Invalid editor snapshot {label}: {value!r}")
    return int(number)


def _parse_editor_stage_snapshot(payload):
    """Decode one atomic StageStats 0.2.6+ editor-table response."""
    values = [float(value) for value in payload]
    if len(values) < min(_EDITOR_STAGE_SNAPSHOT_HEADER_WIDTHS.values()):
        raise ValueError("Editor stage snapshot header is truncated")
    if any(not math.isfinite(value) for value in values):
        raise ValueError("Editor stage snapshot contains a non-finite value")

    schema = _snapshot_integer(values[0], "schema")
    if schema not in _EDITOR_STAGE_SNAPSHOT_HEADER_WIDTHS:
        raise ValueError(f"Unsupported editor stage snapshot schema: {schema}")
    expected_header_width = _EDITOR_STAGE_SNAPSHOT_HEADER_WIDTHS[schema]
    header_width = _snapshot_integer(values[1], "header width")
    row_width = _snapshot_integer(values[2], "row width")
    if header_width != expected_header_width:
        raise ValueError("Editor stage snapshot header width is incompatible")
    if row_width != _EDITOR_STAGE_SNAPSHOT_ROW_WIDTH:
        raise ValueError("Editor stage snapshot row width is incompatible")
    editor_revision = _snapshot_integer(values[3], "editor revision")
    craft_revision = _snapshot_integer(values[4], "craft revision")
    stage_revision = _snapshot_integer(values[5], "staging revision")
    rebuild_revision = _snapshot_integer(values[6], "rebuild revision")
    if schema >= 2:
        simulation_revision = _snapshot_integer(
            values[7], "simulation revision"
        )
        stable_offset = 8
    else:
        simulation_revision = None
        stable_offset = 7
    stable_value = _snapshot_integer(values[stable_offset], "stable flag")
    if stable_value not in (0, 1):
        raise ValueError("Editor stage snapshot stable flag must be 0 or 1")
    editor_max_stage = _snapshot_integer(
        values[stable_offset + 1], "editor max stage"
    )
    atmo_count = _snapshot_integer(
        values[stable_offset + 2], "atmosphere row count"
    )
    vac_count = _snapshot_integer(
        values[stable_offset + 3], "vacuum row count"
    )
    if atmo_count < 0 or vac_count < 0:
        raise ValueError("Editor stage snapshot row count is negative")
    if atmo_count != vac_count:
        raise ValueError("Editor stage snapshot tables are misaligned")
    count = atmo_count

    expected_length = (
        header_width +
        count * _EDITOR_STAGE_SNAPSHOT_ROW_WIDTH
    )
    if len(values) != expected_length:
        raise ValueError(
            "Editor stage snapshot length does not match its row count"
        )

    rows = []
    total_atmo = total_vac = 0.0
    for index in range(count):
        offset = (
            header_width +
            index * _EDITOR_STAGE_SNAPSHOT_ROW_WIDTH
        )
        ksp_stage = _snapshot_integer(values[offset], "KSP stage")
        dv_atmo = values[offset + 1]
        dv_vac = values[offset + 2]
        twr_atmo = values[offset + 3]
        twr_vac = values[offset + 4]
        twr_end = values[offset + 5]
        burn = values[offset + 6]
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

    ksp_stages = [row["ksp"] for row in rows]
    if ksp_stages != list(range(count)):
        raise ValueError(
            "Editor stage snapshot KSP stages are not contiguous from S0"
        )
    expected_counts = {max(0, editor_max_stage + 1)}
    if editor_max_stage >= 0:
        expected_counts.add(editor_max_stage + 2)
    if count not in expected_counts:
        raise ValueError(
            "Editor stage snapshot row count does not match KSP staging"
        )

    result = {
        "stage.available": True,
        "stage.complete": True,
        "stage.count": count,
        "stage.currentKsp": ksp_stages[-1] if ksp_stages else -1,
        "stage.mapping": "atomic",
        "stage.snapshotSchema": schema,
        "stage.snapshotEditorRevision": editor_revision,
        "stage.snapshotCraftRevision": craft_revision,
        "stage.snapshotStageSequenceRevision": stage_revision,
        "stage.snapshotPartSetRebuildRevision": rebuild_revision,
        "stage.snapshotSimulationRevision": simulation_revision,
        "stage.snapshotStable": stable_value == 1,
        "stage.snapshotEditorMaxStage": editor_max_stage,
        "stage.stages": rows,
        "stage.totalDvAtmo": round(total_atmo, 1),
        "stage.totalDvVac": round(total_vac, 1),
    }
    return enrich_stage_result(None, result)


def _gather_atomic_editor_stages(service, completion_proven=False):
    """Prime and read one aligned MechJeb editor table per RPC response."""
    if not completion_proven:
        service.editor_stage_snapshot()
        time.sleep(STAGE_SETTLE_SECONDS)
    return _parse_editor_stage_snapshot(service.editor_stage_snapshot())


def _gather_stages(
    conn,
    source="flight",
    editor_rebuild_verified=False,
    prefer_atomic_editor_snapshot=False,
    atomic_editor_completion_proven=False,
    flight_context=None,
):
    try:
        ss = conn.stage_stats
    except Exception as exc:
        _stage_trace("service_missing", source=source,
                     error=type(exc).__name__, message=str(exc))
        return {}  # service DLL not installed this session

    if source == "flight":
        try:
            result = decode_flight_stage_snapshot(
                ss.flight_stage_snapshot()
            )
            result = enrich_stage_result(None, result)
            context = (
                flight_context
                if isinstance(flight_context, dict)
                else {}
            )
            result.update(flight_conditions(conn, **context))
            _stage_trace(
                "atomic_flight_sample",
                source=source,
                count=result.get("stage.count"),
                currentKsp=result.get("stage.currentKsp"),
                complete=True,
            )
            return result
        except AttributeError:
            # StageStats 0.2.8 and older retain the existing per-field path.
            pass
        except Exception as exc:
            # A new but incomplete or malformed response gets the same-poll
            # compatibility path. The first request after a vessel/scene change
            # may legitimately be priming MechJeb's asynchronous simulation.
            _stage_trace(
                "atomic_flight_sample_error",
                source=source,
                error=type(exc).__name__,
                message=str(exc),
            )

    try:
        if not ss.available:
            _stage_trace("service_unavailable", source=source)
            return {"stage.available": False}  # MechJeb not on this vessel
    except Exception as exc:
        _stage_trace("availability_error", source=source,
                     error=type(exc).__name__, message=str(exc))
        return {}

    out = {"stage.available": True}
    if source == "editor" and prefer_atomic_editor_snapshot:
        try:
            result = _gather_atomic_editor_stages(
                ss,
                completion_proven=atomic_editor_completion_proven,
            )
            _stage_trace(
                "atomic_editor_sample",
                source=source,
                count=result.get("stage.count"),
                currentKsp=result.get("stage.currentKsp"),
                editorRevision=result.get(
                    "stage.snapshotEditorRevision"
                ),
                stable=result.get("stage.snapshotStable"),
                complete=True,
            )
            return result
        except AttributeError:
            # Early StageStats 0.2.6 prototypes before the additive snapshot
            # procedure retain the verified explicit-stage fallback below.
            pass
        except Exception as exc:
            _stage_trace(
                "atomic_editor_sample_error",
                source=source,
                error=type(exc).__name__,
                message=str(exc),
            )
            return {}

    try:
        # The first call collects the previous completed result and requests a
        # new asynchronous simulation. Waiting past MechJeb's 100 ms refresh
        # interval lets the second call collect that new result before we read
        # its individual fields.
        prime_count = int(ss.stage_count())
        time.sleep(STAGE_SETTLE_SECONDS)
        count = int(ss.stage_count())
        raw_current_ksp = int(ss.current_stage())
        current_ksp = raw_current_ksp
        explicit_ksp_stages = None

        if source == "editor" and editor_rebuild_verified and count > 0:
            try:
                candidate_stages = [
                    int(ss.stage_ksp_stage(index))
                    for index in range(count)
                ]
                if candidate_stages == list(range(count)):
                    explicit_ksp_stages = candidate_stages
                    current_ksp = candidate_stages[-1]
            except Exception:
                explicit_ksp_stages = None

        # Outside the verified 0.2.6+ editor path, a count mismatch remains a
        # transient/incomplete simulation and must fail closed.
        expected_count = max(0, current_ksp + 1)
        if count != expected_count:
            _stage_trace(
                "service_sample", source=source, primeCount=prime_count,
                count=count, currentKsp=current_ksp,
                rawCurrentKsp=raw_current_ksp,
                expectedCount=expected_count, complete=False,
            )
            return {
                "stage.available": True,
                "stage.complete": False,
                "stage.count": count,
                "stage.currentKsp": current_ksp,
                "stage.stages": [],
            }

        out["stage.count"] = count
        out["stage.currentKsp"] = current_ksp
        out["stage.complete"] = True
        out["stage.mapping"] = (
            "explicit"
            if explicit_ksp_stages is not None
            else "complete"
        )
        stages = []
        total_atmo = total_vac = 0.0
        for i in range(count):
            dv_atmo = ss.stage_delta_v(i, False)
            dv_vac = ss.stage_delta_v(i, True)
            twr_atmo = ss.stage_twr(i, False)
            twr_vac = ss.stage_twr(i, True)
            total_atmo += dv_atmo
            total_vac += dv_vac
            stages.append({
                "index": i,
                "ksp": (
                    explicit_ksp_stages[i]
                    if explicit_ksp_stages is not None
                    else i
                ),
                "dvAtmo": round(dv_atmo, 1),
                "dvVac": round(dv_vac, 1),
                # Keep `twr` as the atmospheric alias so released dashboards
                # and any external consumers remain compatible.
                "twr": round(twr_atmo, 2),
                "twrAtmo": round(twr_atmo, 2),
                "twrVac": round(twr_vac, 2),
                "burn": round(ss.stage_burn_time(i, False), 1),
            })
        out["stage.stages"] = stages
        out["stage.totalDvAtmo"] = round(total_atmo, 1)
        out["stage.totalDvVac"] = round(total_vac, 1)

        # If staging or a scene change happened while the individual RPCs were
        # being read, discard the mixed snapshot and retry on the next poll.
        final_count = int(ss.stage_count())
        final_raw_current_ksp = int(ss.current_stage())
        if (
            final_count != count or
            final_raw_current_ksp != raw_current_ksp
        ):
            _stage_trace(
                "mixed_service_sample", source=source,
                primeCount=prime_count, count=count,
                currentKsp=current_ksp,
                rawCurrentKsp=raw_current_ksp,
                finalCount=final_count,
                finalRawCurrentKsp=final_raw_current_ksp,
            )
            return {
                "stage.available": True,
                "stage.complete": False,
                "stage.stages": [],
            }
        _stage_trace(
            "service_sample", source=source, primeCount=prime_count,
            count=count, currentKsp=current_ksp,
            rawCurrentKsp=raw_current_ksp,
            expectedCount=expected_count, complete=True, rows=len(stages),
        )
    except Exception as exc:
        _stage_trace("service_read_error", source=source,
                     error=type(exc).__name__, message=str(exc))
        return {}  # mid-scene-change / sim not ready; retain last good cache

    enrich_stage_result(ss, out)
    if source == "flight":
        context = flight_context if isinstance(flight_context, dict) else {}
        out.update(flight_conditions(conn, **context))
    return out


def _stage_signature(result):
    """Return a compact signature for recognizing a settled MechJeb result."""
    rows = result.get("stage.stages") if isinstance(result, dict) else None
    if not isinstance(rows, list) or result.get("stage.complete") is not True:
        return None
    return tuple(
        (
            row.get("index"), row.get("ksp"), row.get("dvAtmo"),
            row.get("dvVac"), row.get("twrAtmo"), row.get("twrVac"),
            row.get("burn"),
        )
        for row in rows
    )


def _editor_snapshot_matches(result, revision, diagnostics):
    """Require an atomic table header to match the surrounding diagnostics."""
    if result.get("stage.snapshotSchema") is None:
        return True
    snapshot_schema = result.get("stage.snapshotSchema")
    return (
        snapshot_schema in _EDITOR_STAGE_SNAPSHOT_HEADER_WIDTHS
        and result.get("stage.snapshotEditorRevision") == revision
        and result.get("stage.snapshotCraftRevision") ==
            diagnostics.get("editor.craftRevision")
        and result.get("stage.snapshotStageSequenceRevision") ==
            diagnostics.get("editor.stageSequenceRevision")
        and result.get("stage.snapshotPartSetRebuildRevision") ==
            diagnostics.get("editor.partSetRebuildRevision")
        and (
            snapshot_schema < 2 or
            result.get("stage.snapshotSimulationRevision") ==
                diagnostics.get("editor.simulationRevision")
        )
        and result.get("stage.snapshotStable") is True
    )


def _editor_completion_proven(revision, diagnostics, result=None):
    """Return true only for a frozen StageStats schema-2 job generation."""
    proven = (
        diagnostics.get("editor.rebuildDiagnosticsSchema") == 2
        and diagnostics.get("editor.simulationTrackingSupported") is True
        and not diagnostics.get("editor.simulationTrackingError")
        and diagnostics.get("editor.simulationRevision") == revision
    )
    if result is None:
        return proven
    return (
        proven
        and result.get("stage.snapshotSchema") == 2
        and result.get("stage.snapshotSimulationRevision") == revision
    )


def _drop_editor_analysis_candidates():
    global _editor_stage_candidate, _editor_stage_candidate_hits
    global _editor_summary_candidate, _editor_summary_last_poll
    _editor_stage_candidate = None
    _editor_stage_candidate_hits = 0
    _editor_summary_candidate = {}
    _editor_summary_last_poll = 0.0


def _clear_editor_candidates():
    global _editor_stage_last_poll
    global _editor_rebuild_cache, _editor_rebuild_token
    global _editor_rebuild_ready
    _editor_stage_last_poll = 0.0
    _editor_rebuild_cache = {}
    _editor_rebuild_token = None
    _editor_rebuild_ready = True
    _drop_editor_analysis_candidates()


def _editor_rebuild_diagnostics(service):
    """Read the optional StageStats 0.2.6+ editor rebuild contract.

    A missing schema is the supported StageStats 0.2.5 compatibility path.
    Once a supported schema is present, any staging revision after zero must
    have a matching successful rebuild-scheduling revision before fresh
    editor analysis can be published.
    """
    try:
        schema = int(service.editor_rebuild_diagnostics_schema)
    except AttributeError:
        return {}, None, True
    except Exception as exc:
        error = "diagnostics_schema_" + type(exc).__name__
        data = {
            "editor.partSetRebuildSupported": False,
            "editor.partSetRebuildError": error,
        }
        return data, ("schema_error", error), False

    data = {"editor.rebuildDiagnosticsSchema": schema}
    if schema not in (1, 2):
        data["editor.partSetRebuildError"] = "unsupported_schema"
        return data, ("schema", schema), False

    try:
        craft_revision = int(service.editor_craft_revision)
        stage_revision = int(service.editor_stage_sequence_revision)
        rebuild_revision = int(service.editor_part_set_rebuild_revision)
        rebuild_supported = bool(
            service.editor_part_set_rebuild_supported
        )
        rebuild_error = str(
            service.editor_part_set_rebuild_error or ""
        )
        last_change = str(service.editor_last_change or "")
        fingerprint = str(service.editor_staging_fingerprint or "")
        part_counts = tuple(
            int(value) for value in service.editor_stage_part_counts()
        )
        if schema >= 2:
            simulation_tracking_supported = bool(
                service.editor_simulation_tracking_supported
            )
            simulation_tracking_error = str(
                service.editor_simulation_tracking_error or ""
            )
            simulation_started_revision = int(
                service.editor_simulation_started_revision
            )
            simulation_revision = int(
                service.editor_simulation_revision
            )
        else:
            simulation_tracking_supported = False
            simulation_tracking_error = ""
            simulation_started_revision = None
            simulation_revision = None
    except Exception as exc:
        error = "diagnostics_read_" + type(exc).__name__
        data.update({
            "editor.partSetRebuildSupported": False,
            "editor.partSetRebuildError": error,
        })
        return data, ("read_error", error), False

    data.update({
        "editor.craftRevision": craft_revision,
        "editor.stageSequenceRevision": stage_revision,
        "editor.partSetRebuildRevision": rebuild_revision,
        "editor.partSetRebuildSupported": rebuild_supported,
        "editor.partSetRebuildError": rebuild_error,
        "editor.lastChange": last_change,
        "editor.stagingFingerprint": fingerprint,
        "editor.stagePartCounts": list(part_counts),
    })
    if schema >= 2:
        data.update({
            "editor.simulationTrackingSupported":
                simulation_tracking_supported,
            "editor.simulationTrackingError":
                simulation_tracking_error,
            "editor.simulationStartedRevision":
                simulation_started_revision,
            "editor.simulationRevision": simulation_revision,
        })
    token = (
        schema,
        craft_revision,
        stage_revision,
        rebuild_revision,
        rebuild_supported,
        rebuild_error,
        fingerprint,
        part_counts,
        simulation_tracking_supported,
        simulation_tracking_error,
        simulation_started_revision,
        simulation_revision,
    )
    ready = (
        stage_revision == 0 or (
            rebuild_supported and
            rebuild_revision == stage_revision and
            not rebuild_error
        )
    )
    return data, token, ready


_EDITOR_REBUILD_FIELDS = (
    "editor.rebuildDiagnosticsSchema",
    "editor.craftRevision",
    "editor.stageSequenceRevision",
    "editor.partSetRebuildRevision",
    "editor.partSetRebuildSupported",
    "editor.partSetRebuildError",
    "editor.lastChange",
    "editor.stagingFingerprint",
    "editor.stagePartCounts",
    "editor.simulationTrackingSupported",
    "editor.simulationTrackingError",
    "editor.simulationStartedRevision",
    "editor.simulationRevision",
)


def _replace_editor_rebuild_data(data, diagnostics):
    """Replace, rather than merge, one internally consistent diagnostic read."""
    for key in _EDITOR_REBUILD_FIELDS:
        data.pop(key, None)
    data.update(diagnostics)


def _trace_editor_rebuild(diagnostics, ready):
    """Trace editor rebuild transitions without logging every telemetry tick."""
    global _editor_rebuild_trace_last
    if not diagnostics:
        signature = ("legacy",)
    else:
        signature = (
            diagnostics.get("editor.rebuildDiagnosticsSchema"),
            diagnostics.get("editor.craftRevision"),
            diagnostics.get("editor.stageSequenceRevision"),
            diagnostics.get("editor.partSetRebuildRevision"),
            diagnostics.get("editor.partSetRebuildSupported"),
            diagnostics.get("editor.partSetRebuildError"),
            diagnostics.get("editor.simulationTrackingSupported"),
            diagnostics.get("editor.simulationTrackingError"),
            diagnostics.get("editor.simulationRevision"),
            diagnostics.get("editor.stagingFingerprint"),
            ready,
        )
    if signature == _editor_rebuild_trace_last:
        return
    _editor_rebuild_trace_last = signature
    _stage_trace(
        "editor_rebuild_transition",
        ready=ready,
        diagnostics=diagnostics,
    )


def _reset_editor_stage_state(revision=None, identity=None):
    """Hard-reset all editor analysis state at a context boundary."""
    global _editor_revision, _editor_identity
    global _editor_analysis_revision, _editor_analysis_identity
    global _editor_analysis_craft_revision
    global _editor_stage_cache, _editor_summary_cache
    global _editor_rebuild_trace_last
    _editor_revision = revision
    _editor_identity = identity
    _editor_analysis_revision = None
    _editor_analysis_identity = None
    _editor_analysis_craft_revision = None
    _editor_stage_cache = {}
    _editor_summary_cache = {}
    _editor_rebuild_trace_last = None
    _clear_editor_candidates()


def _begin_editor_revision(revision, identity):
    """Start a revision while retaining only same-craft published analysis."""
    global _editor_revision, _editor_identity
    global _editor_analysis_revision, _editor_analysis_identity
    global _editor_analysis_craft_revision
    global _editor_stage_cache, _editor_summary_cache
    retain_published = (
        _editor_analysis_revision is not None
        and identity is not None
        and identity == _editor_analysis_identity
    )
    _editor_revision = revision
    _editor_identity = identity
    _clear_editor_candidates()
    if not retain_published:
        _editor_analysis_revision = None
        _editor_analysis_identity = None
        _editor_analysis_craft_revision = None
        _editor_stage_cache = {}
        _editor_summary_cache = {}


def _editor_craft_identity(service):
    """Return the existing StageStats editor identity, or None fail-closed."""
    try:
        raw_save_folder = service.game_save_folder
        raw_craft_id = service.editor_craft_persistent_id
        raw_root_id = service.editor_root_part_persistent_id
    except Exception:
        return None
    if raw_save_folder is None or raw_craft_id is None or raw_root_id is None:
        return None
    save_folder = str(raw_save_folder).strip()
    craft_id = str(raw_craft_id).strip()
    root_id = str(raw_root_id).strip()
    if not save_folder or not craft_id or not root_id:
        return None
    return save_folder, craft_id, root_id


def _attach_editor_analysis(data, revision, force_pending=False):
    """Attach the last atomically published editor analysis bundle."""
    if _editor_summary_cache:
        data.update(_editor_summary_cache)
    if _editor_stage_cache:
        data.update(_editor_stage_cache)
    if _editor_analysis_revision is not None:
        data["editor.analysisRevision"] = _editor_analysis_revision
    data["stage.pending"] = (
        force_pending
        or _editor_analysis_revision is None
        or _editor_analysis_revision != revision
    )
    return data


def _gather_editor_summary(service):
    """Read the revision-cached VAB/SPH craft summary from StageStats."""
    try:
        names = list(service.editor_resource_names())
        amounts = list(service.editor_resource_amounts())
        capacities = list(service.editor_resource_capacities())
        if len(names) != len(amounts) or len(names) != len(capacities):
            return {"editor.summaryAvailable": False}

        visible_names = []
        resources = {}
        for name, amount, capacity in zip(names, amounts, capacities):
            if not _is_consumable_resource(name) or capacity <= 0:
                continue
            visible_names.append(name)
            resources[f"editor.res[{name}]"] = float(amount)
            resources[f"editor.resMax[{name}]"] = float(capacity)

        return {
            "editor.summaryAvailable": True,
            "editor.partCount": int(service.editor_part_count),
            "editor.crewCapacity": int(service.editor_crew_capacity),
            "editor.stageCount": int(service.editor_stage_count),
            "editor.wetMass": float(service.editor_wet_mass),
            "editor.dryMass": float(service.editor_dry_mass),
            "editor.resourceMass": float(service.editor_resource_mass),
            "editor.totalCost": float(service.editor_total_cost),
            "editor.dryCost": float(service.editor_dry_cost),
            "editor.resourceCost": float(service.editor_resource_cost),
            "editor.res.names": visible_names,
            **resources,
        }
    except Exception:
        # The currently loaded DLL may predate the summary API, or the editor
        # may be rebuilding the ship. The next craft revision/server restart
        # retries without disturbing stage analysis.
        return {"editor.summaryAvailable": False}


def _gather_editor_telemetry(conn, facility):
    """Gather the focused VAB/SPH payload from KRPC.StageStats."""
    global _editor_revision, _editor_identity, _editor_bodies_cache
    global _editor_analysis_revision, _editor_analysis_identity
    global _editor_analysis_craft_revision
    global _editor_stage_cache, _editor_stage_last_poll
    global _editor_stage_candidate, _editor_stage_candidate_hits
    global _editor_summary_cache, _editor_summary_candidate
    global _editor_summary_last_poll
    global _editor_rebuild_cache, _editor_rebuild_token
    global _editor_rebuild_ready

    data = {
        "context.mode": "editor",
        "flight.active": False,
        "editor.active": True,
        "editor.facility": facility,
        "stage.pending": True,
    }

    try:
        service = conn.stage_stats
    except Exception:
        _reset_editor_stage_state()
        data["stage.available"] = False
        data["stage.pending"] = False
        return data

    try:
        revision = int(service.editor_revision)
        stable = bool(service.editor_stable)
        available = bool(service.available)
        data.update({
            "editor.craftName": (
                service.editor_craft_name or "Untitled Space Craft"
            ),
            "editor.body": service.editor_body,
            "editor.altitude": service.editor_altitude,
            "editor.mach": service.editor_mach,
            "editor.revision": revision,
            "editor.stable": stable,
            "stage.available": available,
        })
    except Exception:
        _reset_editor_stage_state()
        data["stage.available"] = False
        data["stage.pending"] = False
        return data

    if not available:
        _reset_editor_stage_state(revision)
        data["stage.pending"] = False
        return data

    identity = _editor_craft_identity(service)

    if not _editor_bodies_cache:
        try:
            _editor_bodies_cache = list(service.editor_body_names())
        except Exception:
            pass
    data["editor.bodies"] = _editor_bodies_cache

    if revision != _editor_revision or identity != _editor_identity:
        _begin_editor_revision(revision, identity)

    now = time.time()
    completion_signal = False
    if (
        _editor_analysis_revision != revision
        and _editor_rebuild_cache.get(
            "editor.rebuildDiagnosticsSchema"
        ) == 2
    ):
        try:
            completion_signal = (
                int(service.editor_simulation_revision) == revision
            )
        except Exception:
            completion_signal = False
    stage_poll_due = (
        now - _editor_stage_last_poll >= STAGE_POLL_SECONDS
        or completion_signal
    )
    if stage_poll_due:
        _editor_stage_last_poll = now
        (
            _editor_rebuild_cache,
            _editor_rebuild_token,
            _editor_rebuild_ready,
        ) = _editor_rebuild_diagnostics(service)
        _trace_editor_rebuild(
            _editor_rebuild_cache, _editor_rebuild_ready
        )
    _replace_editor_rebuild_data(data, _editor_rebuild_cache)

    if not stable:
        return _attach_editor_analysis(data, revision)

    if not _editor_rebuild_ready:
        _drop_editor_analysis_candidates()
        return _attach_editor_analysis(data, revision, force_pending=True)

    condition_change = (
        _editor_rebuild_cache.get("editor.lastChange") == "conditions"
    )
    if (
        condition_change and
        not _editor_summary_candidate and
        _editor_summary_cache and
        identity == _editor_analysis_identity and
        _editor_rebuild_cache.get("editor.craftRevision") ==
            _editor_analysis_craft_revision
    ):
        # Reference body/altitude/Mach do not change craft mass, resources,
        # cost, crew, or stage count. Reuse the confirmed same-craft summary
        # while only the MechJeb table is being reconfirmed.
        _editor_summary_candidate = dict(_editor_summary_cache)
        _editor_summary_last_poll = now

    summary_unavailable = _editor_summary_candidate.get(
        "editor.summaryAvailable"
    ) is False
    if not _editor_summary_candidate or (
        summary_unavailable and
        now - _editor_summary_last_poll >= EDITOR_SUMMARY_RETRY_SECONDS
    ):
        _editor_summary_last_poll = now
        _editor_summary_candidate = _gather_editor_summary(service)

    if _editor_summary_candidate.get("editor.summaryAvailable") is False:
        return _attach_editor_analysis(data, revision, force_pending=True)

    if stage_poll_due:
        try:
            result = _gather_stages(
                conn,
                "editor",
                editor_rebuild_verified=(
                    _editor_rebuild_ready and
                    _editor_rebuild_cache.get(
                        "editor.rebuildDiagnosticsSchema"
                    ) in (1, 2)
                ),
                prefer_atomic_editor_snapshot=(
                    _editor_rebuild_cache.get(
                        "editor.rebuildDiagnosticsSchema"
                    ) in (1, 2)
                ),
                atomic_editor_completion_proven=(
                    _editor_completion_proven(
                        revision, _editor_rebuild_cache
                    )
                ),
            )
            if not _editor_snapshot_matches(
                result, revision, _editor_rebuild_cache
            ):
                _drop_editor_analysis_candidates()
                return _attach_editor_analysis(
                    data, revision, force_pending=True
                )
            stage_signature = _stage_signature(result)
            signature = (
                (stage_signature, _editor_rebuild_token)
                if stage_signature is not None
                else None
            )
            if stage_signature is None:
                if result.get("stage.available") is False:
                    _reset_editor_stage_state(revision)
                    data["stage.available"] = False
                    data["stage.pending"] = False
                    return data
            elif stage_signature is not None:
                if signature == _editor_stage_candidate:
                    _editor_stage_candidate_hits += 1
                else:
                    _editor_stage_candidate = signature
                    _editor_stage_candidate_hits = 1
                required_hits = (
                    1
                    if _editor_completion_proven(
                        revision, _editor_rebuild_cache, result
                    )
                    else 2
                )
                if _editor_stage_candidate_hits >= required_hits:
                    final_revision = int(service.editor_revision)
                    final_stable = bool(service.editor_stable)
                    final_available = bool(service.available)
                    final_identity = _editor_craft_identity(service)
                    final_rebuild_data, final_rebuild_token, final_ready = (
                        _editor_rebuild_diagnostics(service)
                    )
                    _editor_rebuild_cache = final_rebuild_data
                    _editor_rebuild_token = final_rebuild_token
                    _editor_rebuild_ready = final_ready
                    _replace_editor_rebuild_data(
                        data, final_rebuild_data
                    )
                    _trace_editor_rebuild(final_rebuild_data, final_ready)
                    data["editor.revision"] = final_revision
                    data["editor.stable"] = final_stable
                    if not final_available:
                        _reset_editor_stage_state(final_revision)
                        data["stage.available"] = False
                        data["stage.pending"] = False
                        return data
                    if final_identity != identity:
                        _reset_editor_stage_state(final_revision, final_identity)
                        return _attach_editor_analysis(
                            data, final_revision, force_pending=True
                        )
                    if final_revision != revision or not final_stable:
                        _drop_editor_analysis_candidates()
                        return _attach_editor_analysis(
                            data, final_revision, force_pending=True
                        )
                    if (
                        not final_ready or
                        final_rebuild_token != signature[1]
                    ):
                        _drop_editor_analysis_candidates()
                        return _attach_editor_analysis(
                            data, final_revision, force_pending=True
                        )
                    if (
                        required_hits == 1
                        and not _editor_completion_proven(
                            final_revision, final_rebuild_data, result
                        )
                    ):
                        _drop_editor_analysis_candidates()
                        return _attach_editor_analysis(
                            data, final_revision, force_pending=True
                        )
                    _editor_stage_cache = result
                    _editor_summary_cache = _editor_summary_candidate
                    _editor_analysis_revision = revision
                    _editor_analysis_identity = identity
                    _editor_analysis_craft_revision = (
                        final_rebuild_data.get("editor.craftRevision")
                    )
        except Exception:
            pass

    return _attach_editor_analysis(data, revision)


def _apply_telemetry_command(conn, command):
    """Apply a dashboard command on the telemetry connection."""
    global _notes_selected_path, _notes_pinned_path
    global _notes_cache, _notes_last_poll
    global _notes_favorites

    if not isinstance(command, dict):
        return
    if _mission_planning.apply_command(conn, command):
        return

    if command.get("type") == "science.alarm.create":
        return _apply_science_alarm_command(conn, command)

    if command.get("type") == "science.lab.transmit":
        return _apply_science_lab_transmit_command(conn, command)

    if command.get("type") == "science.lab.research":
        return _apply_science_lab_research_command(conn, command)

    if command.get("type") == "overview.vessel.switch":
        return _apply_overview_vessel_switch_command(conn, command)

    if command.get("type") == "overview.vessel.edit":
        return _apply_overview_vessel_edit_command(conn, command)

    if command.get("type") == "overview.vessel.lifecycle":
        return _apply_overview_vessel_lifecycle_command(conn, command)

    if command.get("type") == "reactor.control":
        return _apply_reactor_control_command(conn, command)

    if command.get("type") == "heat.loop.control":
        return _apply_heat_loop_control_command(conn, command)

    if command.get("type") == "target.clear":
        return _apply_target_clear_command(conn, command)

    if command.get("type") == "notes.pin":
        pinned = command.get("relativePath")
        if pinned is None or pinned == "":
            _notes_pinned_path = None
        elif isinstance(pinned, str) and len(pinned) <= 1024:
            # As with selection, retain only a catalog key. _gather_notes must
            # discover an exact match before any content can be read.
            _notes_pinned_path = pinned.replace("\\", "/")
        _notes_cache = {}
        _notes_last_poll = 0.0
        return

    if command.get("type") == "notes.select":
        selected = command.get("relativePath")
        if selected is None or selected == "":
            _notes_selected_path = None
        elif isinstance(selected, str) and len(selected) <= 1024:
            # This is only a catalog key. _gather_notes resolves it by exact
            # match against discovered files and never joins it to the disk.
            _notes_selected_path = selected.replace("\\", "/")
        _notes_cache = {}
        _notes_last_poll = 0.0
        return

    if command.get("type") == "notes.favorite":
        relative_path = command.get("relativePath")
        favorite = command.get("favorite")
        if not isinstance(relative_path, str) or not isinstance(favorite, bool):
            return
        relative_path = relative_path.replace("\\", "/")
        notes_dir = _resolve_notes_dir()
        if notes_dir is None:
            return
        valid_paths = {
            path.relative_to(notes_dir).as_posix()
            for path in _list_note_paths(notes_dir)
        }
        if relative_path not in valid_paths:
            return
        favorites = _get_notes_favorites()
        if favorite:
            favorites.add(relative_path)
        else:
            favorites.discard(relative_path)
        try:
            _save_notes_favorites(favorites)
        except OSError:
            return
        _notes_favorites = favorites
        _notes_cache = {}
        _notes_last_poll = 0.0
        return

    if command.get("type") != "editor.conditions":
        return

    try:
        scene = conn.krpc.game_scene
        if scene not in (
            conn.krpc.GameScene.editor_vab,
            conn.krpc.GameScene.editor_sph,
        ):
            return

        service = conn.stage_stats
        body = (
            str(command["body"])
            if "body" in command
            else str(service.editor_body)
        )
        altitude = (
            float(command["altitude"])
            if "altitude" in command
            else float(service.editor_altitude)
        )
        mach = (
            float(command["mach"])
            if "mach" in command
            else float(service.editor_mach)
        )
        if (
            not body or
            not math.isfinite(altitude) or altitude < 0 or
            not math.isfinite(mach) or mach < 0
        ):
            return
        try:
            service.set_editor_conditions(body, altitude, mach)
        except AttributeError:
            # StageStats 0.2.5 compatibility path.
            if "body" in command:
                service.editor_body = body
            if "altitude" in command:
                service.editor_altitude = altitude
            if "mach" in command:
                service.editor_mach = mach
    except (TypeError, ValueError):
        pass
    except Exception:
        pass  # scene transition or service temporarily unavailable


# ---------------------------------------------------------------------------
# Science aboard. WoobiesControlStats' VesselScience service includes both experiment modules and
# science containers; built-in SpaceCenter experiments remain the fallback.
# ---------------------------------------------------------------------------
def _gather_science_stock(vessel):
    rows = []
    total = 0.0
    transmit_total = 0.0
    for experiment in vessel.parts.experiments:
        if not experiment.has_data:
            continue
        for data in experiment.data:
            value = data.science_value
            transmit = data.transmit_value
            total += value
            transmit_total += transmit
            rows.append({
                "title": experiment.title,
                "value": round(value, 1),
                "transmit": round(transmit, 1),
                "data": round(data.data_amount, 1),
                "sourceKind": "experiment",
            })

    rows.sort(key=lambda row: -row["value"])
    return {
        "sci.krpc.total": round(total, 1),
        "sci.krpc.transmitTotal": round(transmit_total, 1),
        "sci.krpc.count": len(rows),
        "sci.krpc.experiments": rows,
        "sci.krpc.backend": "SpaceCenter experiments fallback",
    }


def _optional_service_list(service, method_name):
    try:
        return list(getattr(service, method_name)())
    except Exception:
        return []


def _science_lab_number(value, default=0.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _science_alarm_capabilities(conn):
    providers = {"kac": False, "stock": False}
    try:
        providers["stock"] = conn.space_center.alarm_manager is not None
    except Exception:
        pass
    try:
        providers["kac"] = bool(conn.kerbal_alarm_clock.available)
    except Exception:
        pass
    return providers


def _science_lab_transmit_result(request_id, lab_id, status, message):
    return {
        "type": "science.lab.transmit.result",
        "requestId": request_id,
        "labId": lab_id,
        "status": status,
        "message": message,
    }


def _apply_science_lab_transmit_command(conn, command):
    """Invoke only the selected ModuleScienceLab stock Transmit Science event."""
    request_id = command.get("requestId")
    lab_id = command.get("labId")
    if (
        not isinstance(request_id, str)
        or not request_id
        or len(request_id) > MAX_ACTION_ID_LENGTH
        or not isinstance(lab_id, str)
        or not lab_id
        or len(lab_id) > 256
    ):
        return None

    def result(status, message):
        return _science_lab_transmit_result(
            request_id, lab_id, status, message,
        )

    try:
        service = conn.vessel_science
        labs = _gather_science_labs(service)
        if labs is None:
            return result("error", "Science lab telemetry is unavailable.")
        lab = next(
            (row for row in labs["sci.krpc.labs"] if row["id"] == lab_id),
            None,
        )
        if lab is None:
            return result("error", "The selected science lab is no longer aboard.")
        if _science_lab_number(lab.get("scienceStored"), 0.0) <= 1.0:
            return result("error", "The selected science lab needs more than 1 science to transmit.")

        transmit = getattr(service, "transmit_lab_science", None)
        if not callable(transmit):
            return result("error", "Science transmission requires the current service update.")
        if not bool(transmit(lab_id)):
            return result("error", "KSP did not invoke the selected lab's Transmit Science event.")
        return result(
            "accepted",
            f"Transmit Science invoked for {lab.get('title') or 'science lab'}.",
        )
    except Exception as error:
        return result("error", f"The lab's Transmit Science event failed: {error}")


def _science_lab_research_result(
        request_id, lab_id, enabled, status, message):
    return {
        "type": "science.lab.research.result",
        "requestId": request_id,
        "labId": lab_id,
        "enabled": enabled,
        "status": status,
        "message": message,
    }


def _apply_science_lab_research_command(conn, command):
    """Invoke the selected lab converter's stock Start/Stop Research event."""
    request_id = command.get("requestId")
    lab_id = command.get("labId")
    enabled = command.get("enabled")
    if (
        not isinstance(request_id, str)
        or not request_id
        or len(request_id) > MAX_ACTION_ID_LENGTH
        or not isinstance(lab_id, str)
        or not lab_id
        or len(lab_id) > 256
        or not isinstance(enabled, bool)
    ):
        return None

    def result(status, message):
        return _science_lab_research_result(
            request_id, lab_id, enabled, status, message,
        )

    try:
        service = conn.vessel_science
        labs = _gather_science_labs(service)
        if labs is None:
            return result("error", "Science lab telemetry is unavailable.")
        lab = next(
            (row for row in labs["sci.krpc.labs"] if row["id"] == lab_id),
            None,
        )
        if lab is None:
            return result("error", "The selected science lab is no longer aboard.")
        if not lab.get("converterAvailable"):
            return result("error", "The selected science lab has no research converter.")

        set_enabled = getattr(service, "set_lab_research_enabled", None)
        if not callable(set_enabled):
            return result("error", "Research control requires the current service update.")
        if not bool(set_enabled(lab_id, enabled)):
            action = "Start Research" if enabled else "Stop Research"
            return result("error", f"KSP did not apply the selected lab's {action} event.")
        action = "started" if enabled else "stopped"
        return result(
            "accepted",
            f"Research {action} for {lab.get('title') or 'science lab'}.",
        )
    except Exception as error:
        action = "Start Research" if enabled else "Stop Research"
        return result("error", f"The lab's {action} event failed: {error}")


def _science_alarm_result(
        request_id, lab_id, status, message, provider=None,
        trigger_ut=None, lead_seconds=None):
    result = {
        "type": "science.alarm.create.result",
        "requestId": request_id,
        "labId": lab_id,
        "status": status,
        "message": message,
    }
    if provider in ("kac", "stock"):
        result["provider"] = provider
    if trigger_ut is not None:
        result["triggerUT"] = trigger_ut
    if lead_seconds is not None:
        result["leadSeconds"] = lead_seconds
    return result


def _apply_science_alarm_command(conn, command):
    """Create one manually scheduled alarm from a freshly computed lab ETA."""
    request_id = command.get("requestId")
    lab_id = command.get("labId")
    preference = command.get("provider")
    lead_seconds = command.get("leadSeconds")
    kac_action = command.get("kacAction")
    if (
        not isinstance(request_id, str)
        or not request_id
        or len(request_id) > MAX_ACTION_ID_LENGTH
        or not isinstance(lab_id, str)
        or not lab_id
        or len(lab_id) > 256
        or preference not in ("auto", "kac", "stock")
        or lead_seconds not in (1800, 3600)
        or kac_action not in ("kill_warp", "pause_game", "message_only", "do_nothing")
    ):
        return None

    def reject(message):
        return _science_alarm_result(
            request_id, lab_id, "error", message,
            lead_seconds=lead_seconds,
        )

    try:
        sc = conn.space_center
        vessel = sc.active_vessel
        if vessel is None:
            return reject("No active Flight vessel is available.")
        labs = _gather_science_labs(conn.vessel_science)
        if labs is None:
            return reject("Science lab telemetry is unavailable.")
        lab = next(
            (row for row in labs["sci.krpc.labs"] if row["id"] == lab_id),
            None,
        )
        if lab is None:
            return reject("The selected science lab is no longer aboard.")
        completion_kind = lab.get("etaKind")
        if lab.get("state") != "researching" or completion_kind not in ("finite", "depleted"):
            return reject("The selected science lab no longer has a finite completion estimate.")
        eta_seconds = _science_lab_number(lab.get("etaSeconds"), -1.0)
        current_ut = _science_lab_number(sc.ut, -1.0)
        if eta_seconds <= 0 or current_ut < 0:
            return reject("The science alarm time could not be calculated.")

        providers = _science_alarm_capabilities(conn)
        if preference == "auto":
            provider = "kac" if providers["kac"] else "stock" if providers["stock"] else None
        else:
            provider = preference if providers[preference] else None
        if provider is None:
            label = "KAC" if preference == "kac" else "Stock" if preference == "stock" else "KAC or Stock"
            return reject(f"{label} alarm creation is unavailable.")

        trigger_delay = max(60.0, eta_seconds - lead_seconds)
        trigger_ut = current_ut + trigger_delay
        vessel_name = str(getattr(vessel, "name", "Vessel") or "Vessel").strip()[:80]
        lab_title = str(lab.get("title") or "Science lab").strip()[:100]
        reaches_capacity = completion_kind == "finite"
        title = (
            f"{vessel_name} science lab nearly full"
            if reaches_capacity
            else f"{vessel_name} science lab research nearly complete"
        )
        completion_description = (
            "reach science capacity"
            if reaches_capacity
            else "reach its practical data-depletion cutoff"
        )
        description = (
            f"{lab_title} is estimated to {completion_description} at UT "
            f"{current_ut + eta_seconds:.1f}. Created by Woobie's Mission Control "
            f"with a {lead_seconds // 60}-minute lead from the current lab state."
        )

        if provider == "kac":
            kac = conn.kerbal_alarm_clock
            alarm = kac.create_alarm(kac.AlarmType.raw, title, trigger_ut)
            try:
                alarm.action = getattr(kac.AlarmAction, kac_action)
                if alarm.action != getattr(kac.AlarmAction, kac_action):
                    raise RuntimeError("KAC did not retain the requested alarm action.")
            except Exception as error:
                try:
                    alarm.remove()
                except Exception:
                    pass
                return reject(f"KAC could not apply the requested alarm action: {error}")
            try:
                alarm.vessel = vessel
            except Exception:
                pass
            try:
                alarm.notes = description
            except Exception:
                pass
        else:
            sc.alarm_manager.add_vessel_alarm(
                trigger_delay, vessel, title, description,
            )

        return _science_alarm_result(
            request_id,
            lab_id,
            "accepted",
            f"{provider.upper() if provider == 'kac' else 'Stock'} alarm set "
            f"{lead_seconds // 60} minutes before estimated "
            f"{'capacity' if reaches_capacity else 'data depletion'}.",
            provider=provider,
            trigger_ut=round(trigger_ut, 1),
            lead_seconds=lead_seconds,
        )
    except Exception as error:
        return reject(f"The science alarm could not be created: {error}")


def _science_lab_state(row):
    science = row["scienceStored"]
    science_capacity = row["scienceCapacity"]
    data = row["dataStored"]
    if not row["converterAvailable"]:
        return "unavailable"
    if science_capacity > 0 and science >= science_capacity - 1e-3:
        return "science-full"
    if data <= 1e-6:
        return "no-data"
    if row["scientistCount"] <= 0 or row["scientistFactor"] <= 0:
        return "no-scientist"
    if not row["operational"] or row["crewCount"] + 1e-6 < row["crewRequired"]:
        return "insufficient-crew"
    if not row["researchEnabled"]:
        return "stopped"
    if row["calculatedSciencePerDay"] <= 0:
        return "stalled"
    return "researching"


def _science_lab_eta(row, day_seconds):
    state = row["state"]
    if state == "science-full":
        return "full", 0.0
    if state != "researching":
        return state, None

    science = row["scienceStored"]
    science_capacity = row["scienceCapacity"]
    data = row["dataStored"]
    multiplier = row["scienceMultiplier"]
    rate = row["calculatedSciencePerDay"]
    if day_seconds <= 0 or science_capacity <= 0 or data <= 0 or multiplier <= 0 or rate <= 0:
        return "unavailable", None

    science_needed = max(0.0, science_capacity - science)
    potential_science = multiplier * data
    if science_needed <= 1e-6:
        return "full", 0.0
    if science_needed < potential_science - 1e-6:
        eta_kind = "finite"
        remaining_potential = potential_science - science_needed
    else:
        # Science production decays exponentially with the remaining data and
        # reaches literal zero only at infinite time. Treat the data as spent
        # after 99.9% of its convertible science has been produced, or once no
        # more than 0.1 science remains, whichever happens first.
        eta_kind = "depleted"
        remaining_potential = min(
            potential_science,
            max(0.1, potential_science * 0.001),
        )
    try:
        seconds = (
            day_seconds * potential_science / rate
            * math.log(potential_science / remaining_potential)
        )
    except (ValueError, ZeroDivisionError, OverflowError):
        return "unavailable", None
    if not math.isfinite(seconds) or seconds < 0:
        return "unavailable", None
    return eta_kind, seconds


def _gather_science_labs(service):
    try:
        reported_count = max(0, int(service.lab_count()))
        day_seconds = max(0, int(service.lab_day_seconds()))
        failed_count = max(0, int(service.failed_lab_count()))
        columns = {
            "ids": list(service.lab_ids()),
            "titles": list(service.lab_part_titles()),
            "dataStored": list(service.lab_data_stored()),
            "dataCapacity": list(service.lab_data_capacities()),
            "scienceStored": list(service.lab_science_stored()),
            "scienceCapacity": list(service.lab_science_capacities()),
            "calculatedSciencePerDay": list(service.lab_calculated_science_rates()),
            "scienceMultiplier": list(service.lab_science_multipliers()),
            "crewCount": list(service.lab_crew_counts()),
            "scientistCount": list(service.lab_scientist_counts()),
            "crewRequired": list(service.lab_crew_required()),
            "scientistFactor": list(service.lab_scientist_factors()),
            "converterAvailable": list(service.lab_converters_available()),
            "researchEnabled": list(service.lab_research_enabled()),
            "operational": list(service.lab_operational()),
            "converterStatus": list(service.lab_converter_statuses()),
            "lastTimeFactor": list(service.lab_last_time_factors()),
        }
    except Exception:
        # Older WoobiesControlStats builds have no lab procedures. Omit the
        # capability instead of claiming that the vessel has no labs.
        return None

    aligned_count = min([reported_count] + [len(values) for values in columns.values()])
    rows = []
    for index in range(aligned_count):
        row = {
            "id": str(columns["ids"][index] or f"lab-{index}"),
            "title": str(columns["titles"][index] or "Science lab"),
            "dataStored": _science_lab_number(columns["dataStored"][index]),
            "dataCapacity": _science_lab_number(columns["dataCapacity"][index]),
            "scienceStored": _science_lab_number(columns["scienceStored"][index]),
            "scienceCapacity": _science_lab_number(columns["scienceCapacity"][index]),
            "calculatedSciencePerDay": _science_lab_number(
                columns["calculatedSciencePerDay"][index]
            ),
            "scienceMultiplier": _science_lab_number(columns["scienceMultiplier"][index]),
            "crewCount": max(0, int(_science_lab_number(columns["crewCount"][index]))),
            "scientistCount": max(
                0, int(_science_lab_number(columns["scientistCount"][index]))
            ),
            "crewRequired": max(0.0, _science_lab_number(columns["crewRequired"][index])),
            "scientistFactor": max(
                0.0, _science_lab_number(columns["scientistFactor"][index])
            ),
            "converterAvailable": bool(columns["converterAvailable"][index]),
            "researchEnabled": bool(columns["researchEnabled"][index]),
            "operational": bool(columns["operational"][index]),
            "converterStatus": str(columns["converterStatus"][index] or ""),
            "lastTimeFactor": _science_lab_number(columns["lastTimeFactor"][index]),
        }
        row["state"] = _science_lab_state(row)
        row["sciencePerDay"] = (
            row["calculatedSciencePerDay"] if row["state"] == "researching" else 0.0
        )
        eta_kind, eta_seconds = _science_lab_eta(row, day_seconds)
        row["etaKind"] = eta_kind
        if eta_seconds is not None:
            row["etaSeconds"] = round(eta_seconds, 1)
        rows.append(row)

    return {
        "sci.krpc.labTelemetryAvailable": True,
        "sci.krpc.labDaySeconds": day_seconds,
        "sci.krpc.labCount": reported_count,
        "sci.krpc.failedLabCount": failed_count,
        "sci.krpc.malformedLabCount": max(0, reported_count - aligned_count),
        "sci.krpc.labs": rows,
    }


def _gather_science(conn, vessel):
    alarm_capabilities = {
        "sci.alarmProviders": _science_alarm_capabilities(conn),
    }
    try:
        service = conn.vessel_science
        if not service.available:
            result = _gather_science_stock(vessel)
            result.update(alarm_capabilities)
            return result

        titles = list(service.titles())
        values = list(service.science_values())
        transmit_values = list(service.transmit_values())
        data_amounts = list(service.data_amounts())

        subject_ids = _optional_service_list(service, "subject_ids")
        source_parts = _optional_service_list(service, "source_part_titles")
        source_modules = _optional_service_list(service, "source_modules")
        source_kinds = _optional_service_list(service, "source_kinds")

        count = min(
            len(titles), len(values), len(transmit_values), len(data_amounts)
        )
        rows = []
        for index in range(count):
            title = titles[index] or (
                subject_ids[index] if index < len(subject_ids) else "Science Data"
            )
            rows.append({
                "title": title,
                "value": round(values[index], 1),
                "transmit": round(transmit_values[index], 1),
                "data": round(data_amounts[index], 1),
                "subjectId": (
                    subject_ids[index] if index < len(subject_ids) else ""
                ),
                "sourcePart": (
                    source_parts[index] if index < len(source_parts) else ""
                ),
                "sourceModule": (
                    source_modules[index] if index < len(source_modules) else ""
                ),
                "sourceKind": (
                    source_kinds[index] if index < len(source_kinds) else ""
                ),
            })

        rows.sort(key=lambda row: -row["value"])
        result = {
            "sci.krpc.total": round(sum(values[:count]), 1),
            "sci.krpc.transmitTotal": round(sum(transmit_values[:count]), 1),
            "sci.krpc.count": len(rows),
            "sci.krpc.experiments": rows,
            "sci.krpc.backend": "VesselScience",
        }

        labs = _gather_science_labs(service)
        if labs is not None:
            result.update(labs)

        for key, method_name in (
            ("sci.krpc.containerCount", "container_count"),
            ("sci.krpc.failedContainerCount", "failed_container_count"),
            ("sci.krpc.failedValueCount", "failed_value_count"),
        ):
            try:
                result[key] = getattr(service, method_name)()
            except Exception:
                pass
        result.update(alarm_capabilities)
        return result
    except Exception:
        result = _gather_science_stock(vessel)
        result.update(alarm_capabilities)
        return result


# ---------------------------------------------------------------------------
# Telemetry gathering
# ---------------------------------------------------------------------------
def _clear_smart_ass_api_ready_cache():
    global _smart_ass_negative_ready_connection
    global _smart_ass_negative_ready_vessel
    global _smart_ass_negative_ready_last_poll
    _smart_ass_negative_ready_connection = None
    _smart_ass_negative_ready_vessel = None
    _smart_ass_negative_ready_last_poll = 0.0


def _smart_ass_vessel_key(vessel):
    try:
        object_id = getattr(vessel, "_object_id", None)
    except Exception:
        object_id = None
    return object_id if object_id is not None else id(vessel)


def _gather_sas(conn, vessel, control=None, known=None, now=None):
    """Return stock SAS and Smart A.S.S. state without coupling either source."""
    global _smart_ass_negative_ready_connection
    global _smart_ass_negative_ready_vessel
    global _smart_ass_negative_ready_last_poll
    result = dict(known) if isinstance(known, dict) else {}
    if "krpc.sas" not in result:
        try:
            selected_control = control if control is not None else vessel.control
            try:
                result["krpc.sas"] = bool(selected_control.sas)
            except Exception:
                if control is None:
                    raise
                selected_control = vessel.control
                result["krpc.sas"] = bool(selected_control.sas)
            try:
                result["krpc.sasMode"] = str(selected_control.sas_mode)
            except Exception:
                pass
        except Exception:
            pass

    current_time = time.time() if now is None else now
    vessel_key = _smart_ass_vessel_key(vessel)
    negative_ready_age = current_time - _smart_ass_negative_ready_last_poll
    if (
        conn is _smart_ass_negative_ready_connection
        and vessel_key == _smart_ass_negative_ready_vessel
        and 0.0 <= negative_ready_age < SMART_ASS_NEGATIVE_READY_POLL_SECONDS
    ):
        return result

    try:
        mj = conn.mech_jeb
        if not mj.api_ready:
            _smart_ass_negative_ready_connection = conn
            _smart_ass_negative_ready_vessel = vessel_key
            _smart_ass_negative_ready_last_poll = current_time
            return result
        # A positive result is deliberately never cached: Smart A.S.S. mode is
        # live control state and must remain visible every telemetry cycle.
        _clear_smart_ass_api_ready_cache()
        smart_ass_mode = str(mj.smart_ass.autopilot_mode)
        result["mj.sasMode"] = smart_ass_mode
        result["mj.sasActive"] = smart_ass_mode.split(".")[-1].lower() != "off"
    except Exception:
        # Service/proxy failures are not negative availability. Fail closed in
        # this frame and retry on the next one instead of caching the error.
        _clear_smart_ass_api_ready_cache()
    return result


def _gather_remote_tech(conn, vessel):
    """Return RemoteTech link fields with one read of each live property."""
    result = {}
    try:
        rt = conn.remote_tech
        available = rt.available
        result["rt.available"] = available
        if available:
            comms = rt.comms(vessel)
            has_connection = comms.has_connection
            result["rt.hasConnection"] = has_connection
            result["rt.signalDelay"] = (
                comms.signal_delay if has_connection else None
            )
    except Exception:
        pass  # RemoteTech service not present this session
    return result


def _gather_system_heat(conn):
    """Return live System Heat loop telemetry in the mod's native kW units."""
    sh = conn.system_heat
    if not sh.available:
        return None
    loop_ids = list(sh.loop_ids())
    if not loop_ids:
        return None
    loops = []
    for loop_id in loop_ids:
        loops.append({
            "id": str(loop_id),
            "tempK": round(sh.loop_temperature(loop_id), 1),
            "genKw": round(sh.loop_positive_flux(loop_id), 2),
            "remKw": round(sh.loop_removed_flux(loop_id), 2),
        })
    generated = sh.total_heat_generation
    removed = abs(sh.total_heat_rejection)
    result = {
        "heat.backend": "system_heat",
        "heat.generatedKw": round(generated, 2),
        "heat.removedKw": round(removed, 2),
        "heat.netKw": round(generated - removed, 2),
        "heat.loops": loops,
    }
    return enrich_system_heat_result(sh, result)


def _gather_heat_electricity_preferred(conn, vessel_id):
    """Use one strict SystemHeat 0.2.11 call, or signal same-poll fallback."""
    try:
        return decode_heat_electricity_snapshot(
            conn.system_heat.telemetry_snapshot(),
            expected_vessel_id=vessel_id,
        )
    except Exception:
        return None


def _gather_stock_heat(conn):
    """Return stock part thermal telemetry in watts, hottest parts first."""
    stock = conn.stock_thermal
    if not stock.available:
        return None
    columns = [
        list(stock.part_names()),
        list(stock.part_temperatures()),
        list(stock.part_max_temperatures()),
        list(stock.part_skin_temperatures()),
        list(stock.part_max_skin_temperatures()),
        list(stock.part_utilizations()),
        list(stock.part_net_watts()),
    ]
    parts = []
    for name, temp, max_temp, skin_temp, max_skin_temp, utilization, net in zip(*columns):
        parts.append({
            "name": str(name),
            "tempK": round(temp, 1),
            "maxTempK": round(max_temp, 1),
            "skinTempK": round(skin_temp, 1),
            "maxSkinTempK": round(max_skin_temp, 1),
            "utilization": round(utilization, 1),
            "netW": round(net, 1),
        })
        if len(parts) >= 12:
            break
    return {
        "heat.backend": "stock",
        "heat.generatedW": round(stock.generated_watts, 1),
        "heat.removedW": round(stock.removed_watts, 1),
        "heat.netW": round(stock.net_watts, 1),
        "heat.parts": parts,
    }


def _gather_heat(conn):
    """Prefer real System Heat loops, then fall back to stock vessel heat."""
    system_heat_status = "not_applicable"
    try:
        system_heat = conn.system_heat
    except AttributeError:
        system_heat = None
    except Exception:
        system_heat = None
        system_heat_status = "unknown"
    if system_heat is not None:
        try:
            if bool(system_heat.available):
                result = _gather_system_heat(conn)
                if result:
                    result["heat.systemHeatStatus"] = "known"
                    return result
        except Exception:
            system_heat_status = "unknown"
    try:
        result = _gather_stock_heat(conn)
        if result:
            result["heat.systemHeatStatus"] = system_heat_status
            return result
    except Exception:
        pass
    return {"heat.systemHeatStatus": system_heat_status}


def _overview_label(value, fallback=""):
    """Turn a kRPC enum value into a stable, human-readable label."""
    if value is None:
        return fallback
    text = str(value).split(".")[-1].strip()
    return text.replace("_", " ").title() if text else fallback


def _overview_value(obj, name, default=None):
    try:
        return getattr(obj, name)
    except Exception:
        return default


def _overview_finite_float(value):
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _overview_list(obj, name):
    value = _overview_value(obj, name, [])
    try:
        return list(value or [])
    except Exception:
        return []


def _overview_contract_text(obj, name, limit=OVERVIEW_MAX_CONTRACT_TEXT_LENGTH):
    """Return bounded plain text from KSP's contract briefing fields."""
    value = _overview_value(obj, name)
    if value is None:
        return ""
    try:
        text = str(value).strip()
    except Exception:
        return ""
    if not text:
        return ""
    # KSP contract text can include Unity rich-text tags. The dashboard renders
    # a compact plain-text briefing, so do not expose the markup as content.
    text = re.sub(r"</?[A-Za-z][A-Za-z0-9-]*(?:=[^<>]*)?\s*>", "", text)
    text = "".join(
        character if character in "\n\t" or ord(character) >= 32 else " "
        for character in text
    ).strip()
    return text[:limit]


def _overview_contract_parameters(contract):
    """Flatten a bounded contract-parameter tree for an accessible summary."""
    rows = []

    def append(parameters, depth):
        if depth > 8:
            return
        for parameter in parameters:
            if len(rows) >= OVERVIEW_MAX_CONTRACT_PARAMETERS:
                return
            title = _overview_contract_text(parameter, "title", 512)
            if title:
                completed = _overview_value(parameter, "completed") is True
                failed = _overview_value(parameter, "failed") is True
                row = {
                    "title": title,
                    "status": (
                        "complete" if completed else
                        "failed" if failed else
                        "incomplete"
                    ),
                    "depth": depth,
                }
                optional = _overview_value(parameter, "optional")
                if isinstance(optional, bool):
                    row["optional"] = optional
                notes = _overview_contract_text(parameter, "notes", 1000)
                if notes:
                    row["notes"] = notes
                rows.append(row)
            append(_overview_list(parameter, "children"), depth + 1)

    append(_overview_list(contract, "parameters"), 0)
    return rows


def _overview_crew_names(vessel):
    """Return an exact bounded crew list, or None when it cannot be trusted."""
    try:
        members = list(getattr(vessel, "crew") or [])
    except Exception:
        return None
    if len(members) > OVERVIEW_MAX_VESSEL_CREW:
        return None
    names = []
    for member in members:
        try:
            name = str(member.name or "").strip()
        except Exception:
            return None
        if not name or len(name) > OVERVIEW_MAX_KERBAL_NAME_LENGTH:
            return None
        names.append(name)
    return names


def _overview_vessel_switch_result(request_id, status, message):
    return {
        "type": "overview.vessel.switch.result",
        "requestId": request_id,
        "status": status,
        "message": message,
    }


def _target_clear_result(request_id, status, message):
    return {
        "type": "target.clear.result",
        "requestId": request_id if isinstance(request_id, str) else "",
        "status": status,
        "message": message,
    }


def _apply_target_clear_command(conn, command):
    """Clear the exact target observed on the expected active vessel."""
    request_id = command.get("requestId")

    def reject(message):
        return _target_clear_result(request_id, "error", message)

    if (
        not isinstance(request_id, str)
        or not request_id
        or len(request_id) > MAX_ACTION_ID_LENGTH
    ):
        return reject("A valid target-clear request ID is required.")

    expected_vessel_guid = command.get("expectedVesselGuid")
    if (
        not isinstance(expected_vessel_guid, str)
        or not expected_vessel_guid
        or len(expected_vessel_guid) > MAX_ACTION_ID_LENGTH
    ):
        return reject("A valid expected vessel ID is required.")

    expected_target_object_id = command.get("expectedTargetObjectId")
    if (
        not isinstance(expected_target_object_id, str)
        or not expected_target_object_id.isdecimal()
        or len(expected_target_object_id) > 20
    ):
        return reject("A valid expected target identity is required.")
    target_object_id = int(expected_target_object_id)
    if target_object_id <= 0:
        return reject("A valid expected target identity is required.")

    expected_target_type = command.get("expectedTargetType")
    if expected_target_type not in {"body", "dockingport", "vessel"}:
        return reject("A valid expected target type is required.")

    expected_target_name = command.get("expectedTargetName")
    if (
        not isinstance(expected_target_name, str)
        or not expected_target_name.strip()
        or len(expected_target_name) > 256
    ):
        return reject("A valid expected target name is required.")
    expected_target_name = expected_target_name.strip()

    try:
        if conn.krpc.game_scene != conn.krpc.GameScene.flight:
            return reject("Targets can be cleared only in flight.")

        current_identity = _mission_planning.current_craft_identity(conn, "flight")
        current_vessel_guid = str(current_identity.get("v.guid", "")).strip()
        if current_vessel_guid != expected_vessel_guid:
            return reject("The active vessel changed; refresh before clearing its target.")

        current_target, current_target_type = _current_target(conn.space_center)
        if current_target is None:
            return reject("KSP no longer has a target selected.")
        current_target_object_id = getattr(current_target, "_object_id", None)
        if (
            current_target_type != expected_target_type
            or current_target_object_id != target_object_id
        ):
            return reject("The selected target changed; refresh before clearing it.")

        conn.space_center.clear_target()
        return _target_clear_result(
            request_id,
            "accepted",
            f"Target {expected_target_name} cleared.",
        )
    except Exception as exc:
        return reject(f"Target clear failed: {exc}")


_HEAT_LOOP_CONTROL_ACTIONS = {"start", "stop"}


def _heat_loop_control_result(
    request_id, loop_id, action, status, message
):
    return {
        "type": "heat.loop.control.result",
        "requestId": request_id if isinstance(request_id, str) else "",
        "loopId": loop_id if isinstance(loop_id, int) and not isinstance(loop_id, bool) else -1,
        "action": action if action in _HEAT_LOOP_CONTROL_ACTIONS else "start",
        "status": status,
        "message": message,
    }


def _normalized_radiator_part_ids(values):
    if not isinstance(values, (list, tuple)) or not values or len(values) > 256:
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


def _apply_heat_loop_control_command(conn, command):
    """Apply one vessel-, membership-, and state-guarded loop radiator action."""
    request_id = command.get("requestId")
    loop_id = command.get("loopId")
    action = command.get("action")

    def reject(message):
        return _heat_loop_control_result(
            request_id, loop_id, action, "error", message
        )

    if (
        not isinstance(request_id, str)
        or not request_id
        or len(request_id) > MAX_ACTION_ID_LENGTH
    ):
        return reject("A valid heat-loop request ID is required.")
    if (
        not isinstance(loop_id, int)
        or isinstance(loop_id, bool)
        or loop_id < 0
        or loop_id > 0x7FFFFFFF
    ):
        return reject("Select a valid heat loop.")
    if action not in _HEAT_LOOP_CONTROL_ACTIONS:
        return reject("Select a valid radiator action.")

    expected_vessel_guid = command.get("expectedVesselGuid")
    if (
        not isinstance(expected_vessel_guid, str)
        or not expected_vessel_guid
        or len(expected_vessel_guid) > MAX_ACTION_ID_LENGTH
    ):
        return reject("A valid expected vessel ID is required.")
    expected_part_ids = _normalized_radiator_part_ids(
        command.get("expectedRadiatorPartIds")
    )
    if expected_part_ids is None:
        return reject("Valid expected radiator identities are required.")

    try:
        if conn.krpc.game_scene != conn.krpc.GameScene.flight:
            return reject("Heat-loop controls are available only in flight.")

        current_identity = _mission_planning.current_craft_identity(
            conn, "flight"
        )
        current_vessel_guid = str(
            current_identity.get("v.guid", "")
        ).strip()
        if current_vessel_guid != expected_vessel_guid:
            return reject(
                "The active vessel changed; refresh before controlling radiators."
            )

        service = conn.system_heat
        current_loop_ids = [int(value) for value in service.loop_ids()]
        if loop_id not in current_loop_ids:
            return reject(
                "The heat-loop list changed; refresh before trying again."
            )

        current_part_ids = _normalized_radiator_part_ids(
            list(service.loop_radiator_part_ids(loop_id))
        )
        if current_part_ids != expected_part_ids:
            return reject(
                "The radiators assigned to this loop changed; refresh before trying again."
            )

        current_action = str(
            service.loop_radiator_control_action(loop_id) or ""
        ).lower()
        if current_action != action:
            return reject(
                "The radiator state changed; use the newly available control."
            )

        procedure = (
            service.loop_radiator_start
            if action == "start"
            else service.loop_radiator_stop
        )
        if not bool(procedure(loop_id)):
            return reject(
                "The radiators rejected the requested state change."
            )

        message = (
            f"Loop {loop_id} radiator activation accepted."
            if action == "start"
            else f"Loop {loop_id} radiator shutdown accepted."
        )
        return _heat_loop_control_result(
            request_id, loop_id, action, "accepted", message
        )
    except Exception as exc:
        return reject(f"Heat-loop control failed: {exc}")


def _apply_overview_vessel_switch_command(conn, command):
    """Switch to one exact overview vessel, rejecting stale identities."""
    request_id = command.get("requestId")
    if (
        not isinstance(request_id, str)
        or not request_id
        or len(request_id) > MAX_ACTION_ID_LENGTH
    ):
        return None

    def reject(message):
        return _overview_vessel_switch_result(request_id, "error", message)

    raw_object_id = command.get("objectId")
    if (
        not isinstance(raw_object_id, str)
        or not raw_object_id.isdecimal()
        or len(raw_object_id) > 20
    ):
        return reject("The selected vessel no longer has a valid live identity.")
    object_id = int(raw_object_id)
    if object_id <= 0:
        return reject("The selected vessel no longer has a valid live identity.")

    expected_guid = command.get("expectedGuid")
    if expected_guid is not None and (
        not isinstance(expected_guid, str)
        or not expected_guid
        or len(expected_guid) > MAX_ACTION_ID_LENGTH
    ):
        return reject("The selected vessel identity is invalid.")

    expected_name = command.get("expectedName")
    if expected_name is not None and (
        not isinstance(expected_name, str)
        or not expected_name
        or len(expected_name) > 256
    ):
        return reject("The selected vessel identity is invalid.")

    try:
        scene_name = _overview_label(conn.krpc.game_scene).casefold()
        if scene_name not in {"space center", "tracking station"}:
            return reject(
                "Vessels can only be switched from the Space Center "
                "or Tracking Station."
            )

        sc = conn.space_center
        target = next((
            vessel for vessel in _overview_list(sc, "vessels")
            if _overview_value(vessel, "_object_id") == object_id
        ), None)
        if target is None:
            return reject(
                "That vessel is no longer available. "
                "Refresh the fleet and try again."
            )

        if expected_guid is not None:
            current_guid = str(_overview_value(target, "id", "")).strip()
            if current_guid != expected_guid:
                return reject(
                    "That vessel changed after it was selected. "
                    "Refresh the fleet and try again."
                )
        if expected_name is not None:
            current_name = str(_overview_value(target, "name", "")).strip()
            if current_name != expected_name:
                return reject(
                    "That vessel changed after it was selected. "
                    "Refresh the fleet and try again."
                )

        sc.active_vessel = target
        return _overview_vessel_switch_result(
            request_id, "accepted", "Switching to the selected vessel."
        )
    except Exception:
        return reject("KSP could not switch to that vessel right now.")


def _overview_vessel_edit_result(
    request_id, status, message, name=None, vessel_type=None
):
    result = {
        "type": "overview.vessel.edit.result",
        "requestId": request_id,
        "status": status,
        "message": message,
    }
    if name is not None:
        result["name"] = name
    if vessel_type is not None:
        result["vesselType"] = vessel_type
    return result


def _apply_overview_vessel_edit_command(conn, command):
    """Edit one exact overview vessel, rejecting stale identities."""
    request_id = command.get("requestId")
    if (
        not isinstance(request_id, str)
        or not request_id
        or len(request_id) > MAX_ACTION_ID_LENGTH
    ):
        return None

    def reject(message):
        return _overview_vessel_edit_result(request_id, "error", message)

    raw_object_id = command.get("objectId")
    if (
        not isinstance(raw_object_id, str)
        or not raw_object_id.isdecimal()
        or len(raw_object_id) > 20
    ):
        return reject("The selected vessel no longer has a valid live identity.")
    object_id = int(raw_object_id)
    if object_id <= 0:
        return reject("The selected vessel no longer has a valid live identity.")

    expected_name = command.get("expectedName")
    if (
        not isinstance(expected_name, str)
        or not expected_name
        or len(expected_name) > 256
    ):
        return reject("The selected vessel identity is invalid.")

    expected_guid = command.get("expectedGuid")
    if expected_guid is not None and (
        not isinstance(expected_guid, str)
        or not expected_guid
        or len(expected_guid) > MAX_ACTION_ID_LENGTH
    ):
        return reject("The selected vessel identity is invalid.")

    expected_type = command.get("expectedType")
    if expected_type not in OVERVIEW_EDITABLE_VESSEL_TYPES:
        return reject("The selected vessel type is invalid.")

    proposed_name = command.get("newName")
    if not isinstance(proposed_name, str):
        return reject("Enter a valid vessel name.")
    new_name = proposed_name.strip()
    if (
        not new_name
        or len(new_name) > OVERVIEW_MAX_VESSEL_NAME_LENGTH
        or any(ord(character) < 32 for character in new_name)
    ):
        return reject(
            f"Vessel names must be 1 to {OVERVIEW_MAX_VESSEL_NAME_LENGTH} "
            "characters without line breaks or control characters."
        )
    new_type = command.get("newType")
    if new_type not in OVERVIEW_EDITABLE_VESSEL_TYPES:
        return reject("Select a valid vessel type.")
    if new_name == expected_name and new_type == expected_type:
        return reject("Change the vessel name or type before saving.")

    try:
        scene_name = _overview_label(conn.krpc.game_scene).casefold()
        if scene_name not in {"space center", "tracking station"}:
            return reject(
                "Vessels can only be edited from the Space Center "
                "or Tracking Station."
            )

        sc = conn.space_center
        target = next((
            vessel for vessel in _overview_list(sc, "vessels")
            if _overview_value(vessel, "_object_id") == object_id
        ), None)
        if target is None:
            return reject(
                "That vessel is no longer available. "
                "Refresh the fleet and try again."
            )

        current_name = str(_overview_value(target, "name", "")).strip()
        if current_name != expected_name:
            return reject(
                "That vessel changed after it was selected. "
                "Refresh the fleet and try again."
            )
        if expected_guid is not None:
            current_guid = str(_overview_value(target, "id", "")).strip()
            if current_guid != expected_guid:
                return reject(
                    "That vessel changed after it was selected. "
                    "Refresh the fleet and try again."
                )
        current_type_value = _overview_value(target, "type")
        current_type = _overview_label(current_type_value, "Unknown")
        if current_type != expected_type:
            return reject(
                "That vessel changed after it was selected. "
                "Refresh the fleet and try again."
            )

        try:
            if new_type != current_type:
                target.type = OVERVIEW_EDITABLE_VESSEL_TYPES[new_type]
            if new_name != current_name:
                target.name = new_name
        except Exception:
            try:
                target.type = current_type_value
                target.name = current_name
            except Exception:
                pass
            return reject(
                "KSP could not save all vessel changes. "
                "Refresh the fleet and verify its current details."
            )

        saved_name = str(_overview_value(target, "name", new_name)).strip() or new_name
        saved_type = _overview_label(_overview_value(target, "type"), new_type)
        _overview_last_poll["fleet"] = 0.0
        _overview_last_poll["roster"] = 0.0
        return _overview_vessel_edit_result(
            request_id,
            "accepted",
            f"Saved {saved_name} as {saved_type}.",
            saved_name,
            saved_type,
        )
    except Exception:
        return reject("KSP could not edit that vessel right now.")


def _overview_vessel_lifecycle_result(
    request_id, action, status, message
):
    return {
        "type": "overview.vessel.lifecycle.result",
        "requestId": request_id,
        "action": action,
        "status": status,
        "message": message,
    }


def _apply_overview_vessel_lifecycle_command(conn, command):
    """Recover or terminate one exact vessel after a fresh identity check."""
    request_id = command.get("requestId")
    if (
        not isinstance(request_id, str)
        or not request_id
        or len(request_id) > MAX_ACTION_ID_LENGTH
    ):
        return None

    action = command.get("action")
    result_action = action if action in {"recover", "terminate"} else "terminate"

    def reject(message):
        return _overview_vessel_lifecycle_result(
            request_id, result_action, "error", message
        )

    if action not in {"recover", "terminate"}:
        return reject("Select a valid vessel lifecycle action.")

    raw_object_id = command.get("objectId")
    if (
        not isinstance(raw_object_id, str)
        or not raw_object_id.isdecimal()
        or len(raw_object_id) > 20
    ):
        return reject("The selected vessel no longer has a valid live identity.")
    object_id = int(raw_object_id)
    if object_id <= 0:
        return reject("The selected vessel no longer has a valid live identity.")

    expected_name = command.get("expectedName")
    if (
        not isinstance(expected_name, str)
        or not expected_name
        or len(expected_name) > OVERVIEW_MAX_VESSEL_NAME_LENGTH
    ):
        return reject("The selected vessel identity is invalid.")

    expected_guid = command.get("expectedGuid")
    if expected_guid is not None and (
        not isinstance(expected_guid, str)
        or not expected_guid
        or len(expected_guid) > MAX_ACTION_ID_LENGTH
    ):
        return reject("The selected vessel identity is invalid.")

    expected_recoverable = command.get("expectedRecoverable")
    if not isinstance(expected_recoverable, bool):
        return reject("The selected vessel recovery state is unavailable.")

    expected_crew_names = command.get("expectedCrewNames")
    if (
        not isinstance(expected_crew_names, list)
        or len(expected_crew_names) > OVERVIEW_MAX_VESSEL_CREW
        or any(
            not isinstance(name, str)
            or not name
            or len(name) > OVERVIEW_MAX_KERBAL_NAME_LENGTH
            for name in expected_crew_names
        )
    ):
        return reject("The selected vessel crew list is unavailable.")

    try:
        scene_name = _overview_label(conn.krpc.game_scene).casefold()
        if scene_name not in {"space center", "tracking station"}:
            return reject(
                "Vessels can only be recovered or terminated from the "
                "Space Center or Tracking Station."
            )

        sc = conn.space_center
        target = next((
            vessel for vessel in _overview_list(sc, "vessels")
            if _overview_value(vessel, "_object_id") == object_id
        ), None)
        if target is None:
            return reject(
                "That vessel is no longer available. "
                "Refresh the fleet and try again."
            )

        current_name = str(_overview_value(target, "name", "")).strip()
        if current_name != expected_name:
            return reject(
                "That vessel changed after it was selected. "
                "Refresh the fleet and try again."
            )
        if expected_guid is not None:
            current_guid = str(_overview_value(target, "id", "")).strip()
            if current_guid != expected_guid:
                return reject(
                    "That vessel changed after it was selected. "
                    "Refresh the fleet and try again."
                )

        current_recoverable = _overview_value(target, "recoverable")
        if not isinstance(current_recoverable, bool):
            return reject("KSP could not verify whether that vessel is recoverable.")
        if current_recoverable != expected_recoverable:
            return reject(
                "That vessel's recovery state changed. Refresh the fleet and try again."
            )

        current_crew_names = _overview_crew_names(target)
        if current_crew_names is None:
            return reject("KSP could not verify that vessel's current crew.")
        if sorted(current_crew_names) != sorted(expected_crew_names):
            return reject(
                "That vessel's crew changed. Refresh the fleet and try again."
            )

        if action == "recover":
            if not current_recoverable:
                return reject("That vessel is no longer recoverable.")
            target.recover()
            message = f"Recovered {current_name}."
        else:
            if current_recoverable:
                return reject(
                    "That vessel is recoverable and must be recovered instead."
                )
            service = conn.vessel_management
            if not bool(service.available):
                return reject("Vessel termination support is not available in KSP.")
            service.terminate_vessel(
                target, current_name, current_crew_names
            )
            message = f"Terminated {current_name}."

        _overview_last_poll["fleet"] = 0.0
        _overview_last_poll["roster"] = 0.0
        return _overview_vessel_lifecycle_result(
            request_id, action, "accepted", message
        )
    except Exception:
        verb = "recovery" if action == "recover" else "termination"
        return reject(
            f"KSP could not confirm vessel {verb}. "
            "Refresh the fleet and verify its current state."
        )


def _overview_capabilities(game_mode):
    normalized = str(game_mode or "").casefold().replace(" ", "_")
    if normalized == "career":
        return {
            "funds": True,
            "science": True,
            "reputation": True,
            "contracts": True,
        }
    if normalized in {"science", "science_sandbox"}:
        return {
            "funds": False,
            "science": True,
            "reputation": False,
            "contracts": False,
        }
    return {
        "funds": False,
        "science": False,
        "reputation": False,
        "contracts": False,
    }


def _gather_overview_economy(sc):
    game_mode = _overview_label(_overview_value(sc, "game_mode"), "Unknown")
    capabilities = _overview_capabilities(game_mode)
    data = {
        "overview.gameMode": game_mode,
        "overview.capabilities": capabilities,
    }
    if capabilities["funds"]:
        funds = _overview_value(sc, "funds")
        if funds is not None:
            data["overview.funds"] = funds
    if capabilities["science"]:
        science = _overview_value(sc, "science")
        if science is not None:
            data["overview.science"] = science
    if capabilities["reputation"]:
        reputation = _overview_value(sc, "reputation")
        if reputation is not None:
            data["overview.reputation"] = reputation
    return data


def _gather_overview_fleet(sc):
    rows = []
    vessels = _overview_list(sc, "vessels")
    truncated = False
    for vessel in vessels:
        try:
            vessel_type = _overview_label(
                _overview_value(vessel, "type"), "Unknown"
            )
            if vessel_type not in OVERVIEW_TRACKED_VESSEL_TYPES:
                continue
            if len(rows) >= OVERVIEW_MAX_VESSELS:
                truncated = True
                break
            situation = _overview_label(
                _overview_value(vessel, "situation"), "Unknown"
            )
            orbit = _overview_value(vessel, "orbit")
            body = _overview_value(orbit, "body")
            body_name = _overview_value(body, "name", "Unknown")
            crew_names = _overview_crew_names(vessel)
            crew_count = _overview_value(vessel, "crew_count")
            if crew_count is None:
                crew_count = len(crew_names) if crew_names is not None else 0
            met = _overview_value(vessel, "met", 0.0)
            row = {
                "name": _overview_value(vessel, "name", "Unnamed vessel"),
                "type": vessel_type,
                "situation": situation,
                "body": body_name,
                "met": met if met is not None else 0.0,
                "crewCount": int(crew_count),
                "mission": vessel_type != "Debris",
            }
            if crew_names is not None:
                row["crewNames"] = crew_names
            recoverable = _overview_value(vessel, "recoverable")
            if isinstance(recoverable, bool):
                row["recoverable"] = recoverable
            for source, target, convert in (
                ("apoapsis_altitude", "apoapsisAltitude", lambda value: value),
                ("periapsis_altitude", "periapsisAltitude", lambda value: value),
                ("inclination", "inclination", math.degrees),
                ("period", "period", lambda value: value),
                ("eccentricity", "eccentricity", lambda value: value),
            ):
                value = _overview_finite_float(_overview_value(orbit, source))
                if value is not None:
                    row[target] = convert(value)
            # kRPC class proxies carry a connection-scoped object handle. It is
            # unique for the lifetime of this telemetry connection, which is
            # enough to distinguish same-named vessels in the home overview.
            # Do not treat it as KSP's persistent vessel GUID.
            vessel_object_id = _overview_value(vessel, "_object_id")
            if (
                isinstance(vessel_object_id, int)
                and not isinstance(vessel_object_id, bool)
                and vessel_object_id > 0
            ):
                row["objectId"] = str(vessel_object_id)
            vessel_guid = str(_overview_value(vessel, "id", "")).strip()
            if vessel_guid and len(vessel_guid) <= MAX_ACTION_ID_LENGTH:
                row["guid"] = vessel_guid
            rows.append(row)
        except Exception:
            # One modded or half-loaded vessel should not hide the rest.
            continue
    rows.sort(key=lambda row: str(row["name"]).casefold())
    return {
        "overview.vessels": rows,
        "overview.vesselsTruncated": truncated,
    }


def _overview_contract_deadline(contract, mission_overview=None):
    if mission_overview is not None:
        schema = _overview_value(
            mission_overview, "contract_deadline_schema"
        )
        if (
            isinstance(schema, int)
            and not isinstance(schema, bool)
            and schema >= 1
        ):
            try:
                deadline = _overview_finite_float(
                    mission_overview.contract_deadline(contract)
                )
                if deadline is not None and deadline > 0:
                    return deadline
            except Exception:
                pass

    for attribute in ("date_deadline", "deadline"):
        deadline = _overview_finite_float(
            _overview_value(contract, attribute)
        )
        if deadline is not None and deadline > 0:
            return deadline
    return None


def _gather_overview_contracts(sc, mission_overview=None):
    manager = _overview_value(sc, "contract_manager")
    if manager is None:
        return {
            "overview.contractCounts": {
                "active": 0, "offered": 0, "completed": 0, "failed": 0,
            },
            "overview.contracts": [],
        }

    groups = {
        "active": _overview_list(manager, "active_contracts"),
        "offered": _overview_list(manager, "offered_contracts"),
        "completed": _overview_list(manager, "completed_contracts"),
        "failed": _overview_list(manager, "failed_contracts"),
    }
    active_rows = []
    for contract in groups["active"]:
        deadline = _overview_contract_deadline(contract, mission_overview)
        row = {
            "title": (
                _overview_contract_text(contract, "title", 512) or
                "Untitled contract"
            ),
            "type": _overview_label(_overview_value(contract, "type"), "Contract"),
            "deadline": deadline,
        }
        contract_object_id = _overview_value(contract, "_object_id")
        if (
            isinstance(contract_object_id, int)
            and not isinstance(contract_object_id, bool)
            and contract_object_id > 0
        ):
            row["objectId"] = str(contract_object_id)
        for source, target in (
            ("synopsis", "synopsis"),
            ("description", "description"),
            ("notes", "notes"),
        ):
            text = _overview_contract_text(contract, source)
            if text:
                row[target] = text
        parameters = _overview_contract_parameters(contract)
        if parameters:
            row["parameters"] = parameters
        for source, target in (
            ("funds_completion", "fundsCompletion"),
            ("reputation_completion", "reputationCompletion"),
            ("science_completion", "scienceCompletion"),
        ):
            value = _overview_value(contract, source)
            if (
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(float(value))
            ):
                row[target] = float(value)
        active_rows.append(row)
    active_rows.sort(key=lambda row: (
        row["deadline"] is None,
        row["deadline"] if row["deadline"] is not None else float("inf"),
        str(row["title"]).casefold(),
    ))
    return {
        "overview.contractCounts": {
            name: len(items) for name, items in groups.items()
        },
        "overview.contracts": active_rows,
    }


def _alarm_row(alarm, source):
    alarm_time = _overview_value(alarm, "time")
    if alarm_time is None:
        return None
    vessel = _overview_value(alarm, "vessel")
    return {
        "title": _overview_value(
            alarm, "title",
            _overview_value(alarm, "name", "Untitled alarm"),
        ),
        "type": _overview_label(_overview_value(alarm, "type"), "Alarm"),
        "time": alarm_time,
        "source": source,
        "vessel": _overview_value(vessel, "name", "") if vessel else "",
        "notes": (
            _overview_value(alarm, "notes") or
            _overview_value(alarm, "description", "") or ""
        ),
    }


def _gather_overview_alarms(conn, sc):
    rows = []
    providers = {"stock": "unavailable", "kac": "unavailable"}

    try:
        manager = sc.alarm_manager
        for alarm in _overview_list(manager, "alarms"):
            row = _alarm_row(alarm, "Stock")
            if row is not None:
                rows.append(row)
        providers["stock"] = "available"
    except Exception:
        providers["stock"] = "error"

    try:
        kac = conn.kerbal_alarm_clock
        if bool(_overview_value(kac, "available", False)):
            for alarm in _overview_list(kac, "alarms"):
                row = _alarm_row(alarm, "KAC")
                if row is not None:
                    rows.append(row)
            providers["kac"] = "available"
    except Exception:
        providers["kac"] = "unavailable"

    rows.sort(key=lambda row: (row["time"], row["source"], row["title"]))
    return {
        "overview.alarms": rows,
        "overview.alarmProviders": providers,
    }


def _overview_crew_assignments(sc):
    assignments = {}
    for vessel in _overview_list(sc, "vessels"):
        try:
            vessel_name = str(
                _overview_value(vessel, "name", "") or ""
            ).strip()
            if not vessel_name:
                continue
            for member in _overview_list(vessel, "crew"):
                member_name = str(
                    _overview_value(member, "name", "") or ""
                ).strip()
                if member_name:
                    assignments.setdefault(member_name.casefold(), vessel_name)
        except Exception:
            # One half-loaded vessel should not hide valid assignments.
            continue
    return assignments


def _gather_overview_roster(conn):
    try:
        service = conn.mission_overview
        if not bool(service.available):
            raise RuntimeError("MissionOverview unavailable")
        columns = {
            "name": list(service.roster_names()),
            "status": list(service.roster_statuses()),
            "type": list(service.roster_types()),
            "trait": list(service.roster_traits()),
            "experience": list(service.roster_experience()),
            "level": list(service.roster_levels()),
            "veteran": list(service.roster_veterans()),
            "flightCount": list(service.roster_flight_counts()),
        }
        count = min((len(values) for values in columns.values()), default=0)
        rows = [
            {name: values[index] for name, values in columns.items()}
            for index in range(count)
        ]
        try:
            assignments = _overview_crew_assignments(conn.space_center)
        except Exception:
            assignments = {}
        for row in rows:
            assignment = assignments.get(str(row["name"]).casefold())
            if assignment:
                row["assignment"] = assignment
        rows.sort(key=lambda row: str(row["name"]).casefold())
        return {
            "overview.rosterAvailable": True,
            "overview.roster": rows,
        }
    except Exception:
        return {
            "overview.rosterAvailable": False,
            "overview.roster": [],
        }


def _reset_overview_state():
    global _overview_cache, _overview_last_poll, _overview_last_ut
    _overview_cache = {key: {} for key in _overview_cache}
    _overview_last_poll = {key: 0.0 for key in _overview_last_poll}
    _overview_last_ut = None


def _gather_overview_telemetry(conn, scene, now=None):
    """Return the independently throttled non-flight mission overview."""
    global _overview_last_ut
    if now is None:
        now = time.time()
    cached_vessel_count = len(
        _overview_cache["fleet"].get("overview.vessels", [])
    )
    fleet_interval = min(
        30.0,
        OVERVIEW_FLEET_POLL_SECONDS + cached_vessel_count / 20.0,
    )
    data = {
        "context.mode": "inactive",
        "flight.active": False,
        "editor.active": False,
        "overview.scene": _overview_label(scene, "Space Center"),
        "overview.readOnly": False,
        "overview.refreshSeconds": {
            "economy": OVERVIEW_ECONOMY_POLL_SECONDS,
            "alarms": OVERVIEW_ALARMS_POLL_SECONDS,
            "fleet": round(fleet_interval, 1),
            "contracts": OVERVIEW_CONTRACTS_POLL_SECONDS,
            "roster": OVERVIEW_ROSTER_POLL_SECONDS,
        },
    }
    try:
        sc = conn.space_center
        mission_overview = _overview_value(conn, "mission_overview")
        current_ut = sc.ut
        data["t.universalTime"] = current_ut
        if _overview_last_ut is not None and current_ut < _overview_last_ut:
            _reset_overview_state()
        _overview_last_ut = current_ut
    except Exception:
        return data

    try:
        data["overview.vesselTerminationAvailable"] = bool(
            conn.vessel_management.available
        )
    except Exception:
        data["overview.vesselTerminationAvailable"] = False

    tiers = (
        ("economy", OVERVIEW_ECONOMY_POLL_SECONDS,
         lambda: _gather_overview_economy(sc)),
        ("alarms", OVERVIEW_ALARMS_POLL_SECONDS,
         lambda: _gather_overview_alarms(conn, sc)),
        ("fleet", fleet_interval,
         lambda: _gather_overview_fleet(sc)),
        ("contracts", OVERVIEW_CONTRACTS_POLL_SECONDS,
         lambda: _gather_overview_contracts(sc, mission_overview)),
        ("roster", OVERVIEW_ROSTER_POLL_SECONDS,
         lambda: _gather_overview_roster(conn)),
    )
    for name, interval, gather in tiers:
        if now - _overview_last_poll[name] >= interval:
            _overview_last_poll[name] = now
            try:
                _overview_cache[name] = gather()
            except Exception:
                pass
        data.update(_overview_cache[name])
    return data


def _finalize_telemetry(conn, payload):
    """Attach shared planning and derived fields to one scene payload."""
    payload.update(_mission_planning.gather(
        conn,
        payload.get("context.mode"),
        payload.get("t.universalTime"),
    ))
    payload.update(_electricity_flow.update(payload))
    return payload


_REACTOR_CONTROL_ACTIONS = {
    "start",
    "stop",
    "start_charging",
    "stop_charging",
}


def _reactor_control_result(request_id, index, action, status, message):
    return {
        "type": "reactor.control.result",
        "requestId": request_id if isinstance(request_id, str) else "",
        "index": index if isinstance(index, int) and not isinstance(index, bool) else -1,
        "action": action if action in _REACTOR_CONTROL_ACTIONS else "start",
        "status": status,
        "message": message,
    }


def _apply_reactor_control_command(conn, command):
    """Apply one identity- and state-guarded native reactor action."""
    request_id = command.get("requestId")
    index = command.get("index")
    action = command.get("action")

    def reject(message):
        return _reactor_control_result(
            request_id, index, action, "error", message
        )

    if (
        not isinstance(request_id, str)
        or not request_id
        or len(request_id) > MAX_ACTION_ID_LENGTH
    ):
        return reject("A valid reactor request ID is required.")
    if (
        not isinstance(index, int)
        or isinstance(index, bool)
        or index < 0
        or index > 255
    ):
        return reject("Select a valid reactor index.")
    if action not in _REACTOR_CONTROL_ACTIONS:
        return reject("Select a valid reactor action.")

    expected_name = command.get("expectedName")
    expected_family = command.get("expectedFamily")
    expected_part_id = command.get("expectedPartId")
    expected_vessel_guid = command.get("expectedVesselGuid")
    if (
        not isinstance(expected_name, str)
        or not expected_name
        or len(expected_name) > 256
    ):
        return reject("A valid expected reactor name is required.")
    if expected_family not in {"fission", "fusion"}:
        return reject("A valid expected reactor family is required.")
    if (
        not isinstance(expected_part_id, int)
        or isinstance(expected_part_id, bool)
        or expected_part_id < 0
        or expected_part_id > 0xFFFFFFFF
    ):
        return reject("A valid expected reactor part ID is required.")
    if (
        not isinstance(expected_vessel_guid, str)
        or not expected_vessel_guid
        or len(expected_vessel_guid) > MAX_ACTION_ID_LENGTH
    ):
        return reject("A valid expected vessel ID is required.")

    try:
        if conn.krpc.game_scene != conn.krpc.GameScene.flight:
            return reject("Reactor controls are available only in flight.")

        current_identity = _mission_planning.current_craft_identity(conn, "flight")
        current_vessel_guid = str(current_identity.get("v.guid", "")).strip()
        if current_vessel_guid != expected_vessel_guid:
            return reject("The active vessel changed; refresh before controlling a reactor.")

        service = conn.system_heat
        count = int(service.reactor_count())
        if index >= count:
            return reject("The reactor list changed; refresh before trying again.")

        current_name = str(service.reactor_name(index) or "")
        current_family = str(service.reactor_family(index) or "").lower()
        current_part_id = int(service.reactor_part_id(index))
        current_action = str(service.reactor_control_action(index) or "")
        if current_part_id != expected_part_id:
            return reject("The selected reactor identity changed; refresh before trying again.")
        if current_name != expected_name or current_family != expected_family:
            return reject("The selected reactor changed; refresh before trying again.")
        if current_action != action:
            return reject(
                "The reactor state changed; use the newly available control."
            )

        procedures = {
            "start": service.reactor_start,
            "stop": service.reactor_stop,
            "start_charging": service.reactor_start_charging,
            "stop_charging": service.reactor_stop_charging,
        }
        if not bool(procedures[action](index)):
            return reject("The reactor rejected the requested state change.")

        messages = {
            "start": "Reactor start accepted.",
            "stop": "Reactor shutdown accepted.",
            "start_charging": "Fusion startup charging accepted.",
            "stop_charging": "Fusion startup charging paused.",
        }
        return _reactor_control_result(
            request_id, index, action, "accepted", messages[action]
        )
    except Exception as exc:
        return reject(f"Reactor control failed: {exc}")


def _gather_reactors(system_heat):
    """Read the additive reactor contract while remaining compatible with 0.2.3."""
    reactors = []
    for index in range(system_heat.reactor_count()):
        family = "fission"
        try:
            reported_family = str(system_heat.reactor_family(index) or "").lower()
            if reported_family in {"fission", "fusion"}:
                family = reported_family
        except Exception:
            pass

        has_integrity = family != "fusion"
        try:
            has_integrity = bool(
                system_heat.reactor_core_integrity_available(index)
            )
        except Exception:
            pass

        reactor = {
            "index": index,
            "name": system_heat.reactor_name(index),
            "family": family,
            "hasIntegrity": has_integrity,
            "on": bool(system_heat.reactor_enabled(index)),
            "status": system_heat.reactor_status(index) or "",
            "ecPerSec": round(
                system_heat.reactor_electrical_generation(index), 2
            ),
            "ecMax": round(
                system_heat.reactor_max_electrical_generation(index), 2
            ),
            "coreTemp": round(system_heat.reactor_core_temperature(index), 1),
            "nominalTemp": round(
                system_heat.reactor_nominal_temperature(index), 1
            ),
            "fuel": system_heat.reactor_fuel_status(index) or "",
            "fuelKind": "life" if family == "fission" else "rate",
            "throttle": round(system_heat.reactor_throttle(index), 1),
        }
        try:
            part_id = int(system_heat.reactor_part_id(index))
            if part_id < 0 or part_id > 0xFFFFFFFF:
                raise ValueError("invalid reactor part ID")
            control_action = str(
                system_heat.reactor_control_action(index) or ""
            )
            if control_action in _REACTOR_CONTROL_ACTIONS:
                reactor["partId"] = part_id
                reactor["controlAction"] = control_action
                reactor["controlAvailable"] = True
            charge_state = str(
                system_heat.reactor_charge_state(index) or ""
            )
            if charge_state in {"off", "charging", "ready", "running"}:
                reactor["chargeState"] = charge_state
                charge_percent = float(
                    system_heat.reactor_charge_percent(index)
                )
                if math.isfinite(charge_percent):
                    reactor["chargePercent"] = round(
                        max(0.0, min(100.0, charge_percent)), 1
                    )
        except Exception:
            # SystemHeat 0.2.6 and older remain telemetry-only.
            pass
        if family == "fusion":
            try:
                fuel_life = system_heat.reactor_fuel_life_status(index) or ""
                if fuel_life:
                    reactor["fuel"] = fuel_life
                    reactor["fuelKind"] = "life"
            except Exception:
                # SystemHeat 0.2.4 exposes the exact rate but not remaining life.
                pass
            try:
                fuel_rate = system_heat.reactor_fuel_rate_status(index) or ""
                if fuel_rate:
                    reactor["fuelRate"] = fuel_rate
            except Exception:
                pass
            try:
                limiting = (
                    system_heat.reactor_fuel_limiting_resource(index) or ""
                )
                if limiting:
                    reactor["fuelLimitingResource"] = limiting
            except Exception:
                pass
        if has_integrity:
            reactor["integrity"] = round(
                system_heat.reactor_core_integrity(index), 1
            )
        reactors.append(reactor)
    return reactors


def _gather_reactor_telemetry(conn):
    """Return reactors plus an explicit completeness state for alarm rules."""
    try:
        service = conn.system_heat
    except AttributeError:
        return {"elec.reactorsStatus": "not_applicable"}
    except Exception:
        return {"elec.reactorsStatus": "unknown"}
    try:
        if not service.available:
            return {"elec.reactorsStatus": "not_applicable"}
        return {
            "elec.reactors": _gather_reactors(service),
            "elec.reactorsStatus": "known",
        }
    except Exception:
        return {"elec.reactorsStatus": "unknown"}


def _gather_throttle_state(vessel, control=None):
    """Return commanded throttle plus limiter-adjusted vessel thrust."""
    out = {}
    try:
        selected_control = control if control is not None else vessel.control
        try:
            out["krpc.throttle"] = selected_control.throttle
        except Exception:
            if control is None:
                raise
            out["krpc.throttle"] = vessel.control.throttle
    except Exception:
        pass
    try:
        out["v.thrust"] = vessel.thrust
        out["v.availableThrust"] = vessel.available_thrust
    except Exception:
        pass
    return out


def _gather_flight_core_preferred(conn, vessel, expected_vessel_id=None):
    """Return one strict custom Flight snapshot, or ``None`` for stock reads."""
    try:
        packed = conn.vessel_flight_core.packed_snapshot()
        result = decode_flight_core_snapshot(
            packed,
            expected_vessel_id=expected_vessel_id,
        )
        if expected_vessel_id is None:
            # Stock kRPC 0.6 omits KSP's vessel GUID. The service stamps the
            # active vessel's canonical Guid and checks its reference after the
            # capture; this one post-call proxy check closes the client-side
            # transition window before any packed values are published.
            if conn.space_center.active_vessel != vessel:
                raise RuntimeError("active vessel changed during Flight snapshot")
        return result
    except Exception:
        return None


def _stage_flight_context(vessel, control, body, flight, telemetry):
    """Share core Flight reads with the slower StageStats enrichment poll."""
    known = {}
    try:
        body_name = telemetry["v.body"]
        if body_name is not None:
            known["stage.body"] = str(body_name)
    except (KeyError, TypeError, ValueError):
        pass
    for source, target, digits in (
        ("v.altitude", "stage.altitude", 1),
        ("krpc.throttle", "stage.throttle", 4),
        ("stage.staticPressureAtm", "stage.staticPressureAtm", 4),
    ):
        try:
            value = telemetry[source]
            if (
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(float(value))
            ):
                known[target] = round(float(value), digits)
        except (KeyError, TypeError, ValueError):
            pass
    try:
        situation = telemetry["stage.situation"]
        if situation is not None:
            known["stage.situation"] = str(situation)
    except (KeyError, TypeError, ValueError):
        pass
    return {
        "vessel": vessel,
        "control": control,
        "body": body,
        "flight": flight,
        "known": known,
    }


def gather_telemetry(conn):
    global _stage_cache, _stage_current_authority
    global _stage_last_poll, _stage_last_ut
    global _telemetry_mode, _editor_bodies_cache, _stage_trace_last_published
    global _damage_cache, _damage_last_poll, _damage_cache_key, _damage_last_ut
    global _damage_loss_cache, _damage_loss_revision
    global _res_cache, _res_last_poll, _res_cache_key
    d = {}

    # The game scene is the authoritative signal. A vessel handle may remain
    # available briefly during editor and scene transitions.
    try:
        scene = conn.krpc.game_scene
        if scene == conn.krpc.GameScene.editor_vab:
            mode = "editor_vab"
        elif scene == conn.krpc.GameScene.editor_sph:
            mode = "editor_sph"
        elif scene == conn.krpc.GameScene.flight:
            mode = "flight"
        else:
            mode = "inactive"

        if mode != _telemetry_mode:
            previous_mode = _telemetry_mode
            _clear_smart_ass_api_ready_cache()
            _stage_trace("mode_transition", previous=previous_mode, current=mode)
            if mode == "flight":
                _stage_trace("cache_clear", reason="enter_flight",
                             previous=_stage_summary(_stage_cache))
                _stage_cache = {}
                _stage_current_authority = {}
                _stage_last_poll = 0.0
                _stage_last_ut = None
                _damage_cache = {"damage.status": "unknown"}
                _damage_last_poll = 0.0
                _damage_cache_key = None
                _damage_last_ut = None
                _damage_loss_cache = None
                _damage_loss_revision = None
                _res_cache = {}
                _res_last_poll = 0.0
                _res_cache_key = None
                _clear_resource_topology_cache()
            _telemetry_mode = mode
            _stage_trace_last_published = None
            _editor_bodies_cache = []
            _reset_editor_stage_state()
            if mode == "inactive":
                _reset_overview_state()

        if mode == "editor_vab":
            payload = _attach_notes_telemetry(
                _gather_editor_telemetry(conn, "VAB")
            )
            return _finalize_telemetry(conn, payload)
        if mode == "editor_sph":
            payload = _attach_notes_telemetry(
                _gather_editor_telemetry(conn, "SPH")
            )
            return _finalize_telemetry(conn, payload)
        if mode != "flight":
            payload = _attach_notes_telemetry(
                _gather_overview_telemetry(conn, scene)
            )
            return _finalize_telemetry(conn, payload)
    except Exception:
        pass

    try:
        sc = conn.space_center
        vessel = sc.active_vessel
    except Exception:
        # Connected to kRPC, but no active vessel in a supported context (for
        # example, the tracking station, space center, main menu, or a scene
        # load). The dashboard uses this mode to show its inactive-scene overlay
        # instead of guessing from absent keys.
        payload = _attach_notes_telemetry({
            "context.mode": "inactive",
            "flight.active": False,
            "editor.active": False,
        })
        return _finalize_telemetry(conn, payload)

    d["context.mode"] = "flight"
    d["flight.active"] = True
    d["editor.active"] = False
    now = time.time()
    control = None
    universal_time = None
    body = None
    fbody = None
    try:
        vessel_guid = str(_overview_value(vessel, "id", "")).strip()
        if vessel_guid and len(vessel_guid) <= MAX_ACTION_ID_LENGTH:
            d["v.guid"] = vessel_guid
    except Exception:
        pass

    # ---- clocks + thrust + navball + Flight/orbit stock core ----
    # WCS 0.2.16 performs the same official SpaceCenter wrapper reads behind
    # one demand-only RPC. Absence, invalid data, or a vessel transition falls
    # through to the complete pre-feature stock path in this same cycle.
    flight_core = _gather_flight_core_preferred(
        conn,
        vessel,
        expected_vessel_id=d.get("v.guid"),
    )
    if flight_core is not None:
        d.update(flight_core)
        universal_time = d.get("t.universalTime")
    else:
        try:
            control = vessel.control
        except Exception:
            # Individual consumers retain their original retry behavior.
            pass
        try:
            d["v.name"] = vessel.name
        except Exception:
            d["v.name"] = ""
        try:
            universal_time = sc.ut
            d["t.universalTime"] = universal_time
            d["v.missionTime"] = vessel.met
        except Exception:
            pass

        d.update(_gather_throttle_state(vessel, control=control))
        try:
            orbit = vessel.orbit
            body = orbit.body
            srf = vessel.flight(vessel.surface_reference_frame)
            fbody = vessel.flight(body.reference_frame)

            d["n.heading"] = srf.heading
            d["n.pitch"] = srf.pitch
            d["n.roll"] = srf.roll
            d["v.altitude"] = fbody.mean_altitude
            d["v.verticalSpeed"] = fbody.vertical_speed
            d["v.surfaceSpeed"] = fbody.speed
            d["v.geeForce"] = fbody.g_force
            d["v.orbitalVelocity"] = orbit.speed
            d["o.ApA"] = orbit.apoapsis_altitude
            d["o.PeA"] = orbit.periapsis_altitude
            d["o.timeToAp"] = orbit.time_to_apoapsis
            d["o.timeToPe"] = orbit.time_to_periapsis
            d["o.inclination"] = math.degrees(orbit.inclination)
            d["o.eccentricity"] = orbit.eccentricity
            d["o.period"] = orbit.period
            d["v.body"] = body.name
        except Exception:
            pass

    # ---- per-stage delta-V (KRPC.StageStats / MechJeb) ----
    # Revert-to-launch rewinds universal time while the process and kRPC
    # connection can remain alive. Never carry the previous flight's last good
    # stage snapshot across that boundary. Gather this before resources so the
    # same bounded StageStats poll can supply the current KSP stage when stock
    # kRPC omits it.
    if universal_time is not None:
        if _stage_last_ut is not None and universal_time < _stage_last_ut:
            _clear_smart_ass_api_ready_cache()
            _stage_trace(
                "ut_rewind", previousUt=_stage_last_ut,
                currentUt=universal_time,
                previousCache=_stage_summary(_stage_cache),
            )
            _stage_cache = {}
            _stage_current_authority = {}
            _stage_last_poll = 0.0
            _res_cache = {}
            _res_last_poll = 0.0
            _res_cache_key = None
            _clear_resource_topology_cache()
        _stage_last_ut = universal_time

    if now - _stage_last_poll >= STAGE_POLL_SECONDS:
        _stage_last_poll = now
        result = {}
        try:
            result = _gather_stages(
                conn,
                flight_context=_stage_flight_context(
                    vessel, control, body, fbody, d
                ),
            )
            if result:
                previous_stage_cache = _stage_summary(_stage_cache)
                _stage_cache = result
                _stage_trace(
                    "cache_replace", source="flight",
                    previous=previous_stage_cache,
                    current=_stage_summary(result),
                )
        except Exception:
            pass  # keep last good cache through scene changes
        # The staging panel intentionally retains its last good display cache,
        # but resource partitioning must fail closed when this poll did not
        # produce a fresh current-stage value.
        _stage_current_authority = _current_stage_authority(result)
    d.update(_stage_cache)
    _trace_stage_publish(d, "flight")

    # ---- current stage index ----
    cs = d.get("krpc.currentStage") if flight_core is not None else None
    if cs is None:
        cs = _current_stage(
            vessel, _stage_current_authority, control=control
        )
    if cs is not None:
        d["krpc.currentStage"] = cs

    # ---- comms: RemoteTech is authoritative here; stock CommNet is the fallback ----
    d.update(_gather_remote_tech(conn, vessel))

    if not {
        "comm.krpc.canCommunicate", "comm.krpc.signalStrength"
    }.issubset(d):
        try:
            c = vessel.comms
            d["comm.krpc.canCommunicate"] = c.can_communicate
            d["comm.krpc.signalStrength"] = c.signal_strength
        except Exception:
            pass  # no antenna / no CommNet

    # ---- Authoritative broken craft parts ---------------------------------
    # Bind the cache to the active vessel and UT lifecycle so a vessel switch
    # or revert can never publish the previous craft's damage for one poll.
    damage_key = str(d.get("v.guid") or d.get("v.name") or "").strip()
    damage_reverted = (
        _damage_last_ut is not None
        and universal_time is not None
        and universal_time < _damage_last_ut
    )
    if damage_key != _damage_cache_key or damage_reverted:
        _damage_cache = {"damage.status": "unknown"}
        _damage_last_poll = 0.0
        _damage_cache_key = damage_key
        _damage_loss_cache = None
        _damage_loss_revision = None
    _damage_last_ut = universal_time
    if now - _damage_last_poll >= DAMAGE_POLL_SECONDS:
        _damage_last_poll = now
        try:
            loss_fields = None
            packed_damage = False
            try:
                damage_service = conn.vessel_damage
                try:
                    damage_service.packed_snapshot
                    packed_damage = True
                except AttributeError:
                    loss_revision = damage_service.loss_revision
                    if (
                        isinstance(loss_revision, int)
                        and not isinstance(loss_revision, bool)
                        and loss_revision >= 0
                    ):
                        if (
                            _damage_loss_cache is None
                            or loss_revision != _damage_loss_revision
                        ):
                            candidate = read_loss_fields(damage_service)
                            if candidate[0] != "incomplete":
                                _damage_loss_cache = candidate
                                _damage_loss_revision = loss_revision
                            loss_fields = candidate
                        else:
                            loss_fields = _damage_loss_cache
            except AttributeError:
                pass
            if packed_damage or loss_fields is None:
                _damage_cache = gather_part_damage(
                    vessel,
                    connection=conn,
                    remote_tech_active=d.get("rt.available") is True,
                )
            else:
                _damage_cache = gather_part_damage(
                    vessel,
                    connection=conn,
                    remote_tech_active=d.get("rt.available") is True,
                    loss_fields=loss_fields,
                )
        except Exception:
            _damage_cache = {"damage.status": "unknown"}
    d.update(_damage_cache)

    # ---- stock SAS + MechJeb SmartASS mode ----
    # Smart A.S.S. and stock SAS are mutually exclusive in normal operation,
    # but stock SAS can pulse on briefly before MechJeb turns it back off. Send
    # both sources so the dashboard can keep Smart A.S.S. authoritative during
    # that handoff instead of flashing a stock mode.
    sas_known = {
        key: d[key]
        for key in ("krpc.sas", "krpc.sasMode")
        if key in d
    }
    d.update(_gather_sas(
        conn,
        vessel,
        control=control,
        known=sas_known,
        now=now,
    ))

    # ---- resources ----
    resource_context = (
        damage_key or getattr(vessel, "_object_id", id(vessel)),
        cs,
    )
    if damage_reverted or resource_context != _res_cache_key:
        _res_cache = {}
        _res_last_poll = 0.0
        _res_cache_key = resource_context
        _clear_resource_topology_cache()
    if now - _res_last_poll >= _resource_poll_interval(d):
        _res_last_poll = now
        try:
            _res_cache = _gather_resources_preferred(
                conn,
                vessel,
                current_stage=cs,
                resource_identity=damage_key,
                now=now,
                expected_vessel_id=d.get("v.guid"),
            )
        except Exception:
            _res_cache = {"res.status": "unknown"}
    d.update(_res_cache)

    # ---- target + docking ----
    global _tgt_cache, _tgt_last_poll
    if now - _tgt_last_poll >= TGT_POLL_SECONDS:
        _tgt_last_poll = now
        try:
            _tgt_cache = _gather_target(conn, vessel)
        except Exception:
            pass
    d.update(_tgt_cache)

    # ---- science aboard: VesselScience, with stock experiment fallback ----
    global _sci_cache, _sci_last_poll
    if now - _sci_last_poll >= SCI_POLL_SECONDS:
        _sci_last_poll = now
        try:
            sci = _gather_science(conn, vessel)
            # Add career and vessel context to the science summary.
            try:
                sci["career.science"] = sc.science
            except Exception:
                pass  # sandbox save -- no science total
            try:
                sci["v.situationString"] = (
                    str(vessel.situation).split(".")[-1].replace("_", " ").title()
                )
                sci["v.biome"] = vessel.biome
            except Exception:
                pass
            _sci_cache = sci
        except Exception:
            pass  # keep last good cache through scene changes
    d.update(_sci_cache)

    # ---- Heat management: System Heat loops, with stock thermal fallback ----
    # System Heat retains its native kW display. Stock part flux is explicitly
    # reported in W so the two backends never silently change scale.
    global _heat_cache, _heat_last_poll, _elec_cache, _elec_last_poll
    heat_due = now - _heat_last_poll >= HEAT_POLL_SECONDS
    elec_due = now - _elec_last_poll >= ELEC_POLL_SECONDS
    packed_heat_electricity = None
    if heat_due or elec_due:
        packed_heat_electricity = _gather_heat_electricity_preferred(
            conn, d.get("v.guid")
        )

    if heat_due:
        _heat_last_poll = now
        packed_heat = (
            packed_heat_electricity.get("heat")
            if packed_heat_electricity is not None
            else None
        )
        _heat_cache = packed_heat or _gather_heat(conn) or {}
    d.update(_heat_cache)

    # ---- Electricity by source: reactors (custom service) + RTGs + solar ----
    if elec_due:
        _elec_last_poll = now
        elec = (
            dict(packed_heat_electricity["electricity"])
            if packed_heat_electricity is not None
            else {}
        )

        if packed_heat_electricity is None:
            # Bracket the sequential legacy per-reactor reads with generation
            # samples. The packed path is already one atomic service capture.
            service_total_before = None
            try:
                service_total_before = (
                    conn.system_heat.total_electrical_generation()
                )
            except Exception:
                pass

            elec.update(_gather_reactor_telemetry(conn))

            try:
                sh = conn.system_heat
                elec["rtg.count"] = sh.rtg_count()
                elec["rtg.outputEcPerSec"] = round(sh.rtg_total_output(), 2)
            except Exception:
                pass

            solar_ec = 0.0
            try:
                panels = vessel.parts.solar_panels
                readings = [
                    (sp.energy_flow, sp.sun_exposure) for sp in panels
                ]
                readings.extend(curved_solar_readings(vessel.parts))
                panel_count, total_flow, average_exposure = solar_summary(
                    readings
                )
                solar_ec = total_flow
                elec["solar.count"] = panel_count
                elec["solar.outputEcPerSec"] = round(total_flow, 2)
                elec["solar.efficiency"] = round(average_exposure, 3)
            except Exception:
                pass

            # ---- Total generation + "all other" --------------------------
            # Legacy SystemHeat excludes solar; add the stock/custom readings.
            try:
                sh = conn.system_heat
                service_total_after = service_total_before
                try:
                    service_total_after = (
                        sh.total_electrical_generation()
                    )  # excludes solar
                except Exception:
                    pass
                service_total = latest_generation_total(
                    service_total_before,
                    service_total_after,
                )
                if service_total is None:
                    raise RuntimeError(
                        "SystemHeat generation total unavailable"
                    )
                total_gen = service_total + solar_ec

                reactor_sum = sum(
                    r["ecPerSec"] for r in elec.get("elec.reactors", [])
                )
                rtg_ec = elec.get("rtg.outputEcPerSec", 0.0) or 0.0
                other = bracketed_generation_remainder(
                    service_total_before,
                    service_total_after,
                    reactor_sum,
                    rtg_ec,
                )

                elec["elec.totalGenEcPerSec"] = round(total_gen, 2)
                elec["elec.otherEcPerSec"] = round(other or 0.0, 2)
            except Exception:
                pass  # service absent -> omit total/other

        if elec:
            _elec_cache = elec
    d.update(_elec_cache)

    payload = _attach_notes_telemetry(d, d.get("v.name", ""), now)
    return _finalize_telemetry(conn, payload)


def run_telemetry_server(host, port):
    """Run the hardened, session-bound production dashboard transport."""
    _asset_handler, server = create_telemetry_runtime(
        dashboard_asset,
        connect_krpc_with_retry,
        gather_telemetry,
        _apply_telemetry_command,
        DASHBOARD_WEB_ROOT,
        TELEMETRY_HZ,
    )
    return server(host, port)


def main():
    host = sys.argv[1] if len(sys.argv) >= 2 else "127.0.0.1"
    port = int(sys.argv[2]) if len(sys.argv) >= 3 else TELEMETRY_WS_PORT

    print("KSP React dashboard and telemetry server (no ESP32 control code).")
    print(f"Serving on http://{host}:{port}/. Ctrl+C to stop.")
    if host not in ("127.0.0.1", "localhost", "::1"):
        print("WARNING: this read-only telemetry feed has no authentication.")
        print(f"Network binding is enabled on {host}; use only a trusted network.")

    return 0 if run_telemetry_server(host, port) else 2


if __name__ == "__main__":
    try:
        exit_code = main()
        if exit_code:
            raise SystemExit(exit_code)
    except KeyboardInterrupt:
        print("\nStopped.")
    except Exception:
        import traceback
        traceback.print_exc()
        if sys.stdin and sys.stdin.isatty():
            input("\nPress Enter to close...")
