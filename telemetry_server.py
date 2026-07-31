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
import sys
import time
import urllib.parse
from http import HTTPStatus
from pathlib import Path

import krpc

from electricity import ElectricityFlowEstimator, generation_remainder
from heat import enrich_system_heat_result
from mission_planning import (
    MAX_ACTION_ID_LENGTH,
    MissionPlanningController,
)
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
RES_POLL_SECONDS = 0.5    # 2N calls for N resources aboard
TGT_POLL_SECONDS = 0.5    # target + docking geometry
STAGE_POLL_SECONDS = 0.5  # dv changes continuously during a burn; ~2 Hz readout
STAGE_SETTLE_SECONDS = 0.12  # let MechJeb's 100 ms async sim finish before read
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
OVERVIEW_TRACKED_VESSEL_TYPES = frozenset({
    "Debris", "Probe", "Rover", "Lander", "Ship", "Station", "Base",
    "Plane", "Relay",
})
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
_res_cache = {}
_res_last_poll = 0.0
_tgt_cache = {}
_tgt_last_poll = 0.0
_stage_cache = {}
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
# it once at runtime and retain the result.
#   None  = not probed yet
#   True  = present, use it
#   False = absent, leave the stage-resource column blank. (Note: KRPC.StageStats
#           now also reports the current KSP stage via stage.currentKsp, so the
#           dashboard is no longer blind to current stage even when this is False;
#           this flag only gates the per-stage RESOURCE breakdown.)
_HAS_CURRENT_STAGE = None


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


def _current_stage(vessel):
    """Current stage index, or None if this kRPC build doesn't expose it."""
    global _HAS_CURRENT_STAGE
    if _HAS_CURRENT_STAGE is False:
        return None
    try:
        s = int(vessel.control.current_stage)
        if _HAS_CURRENT_STAGE is None:
            print("[telemetry] current-stage resources are available.")
        _HAS_CURRENT_STAGE = True
        return s
    except Exception:
        if _HAS_CURRENT_STAGE is None:
            print("[telemetry] this kRPC build does not expose the current stage; "
                  "the current-stage resource column will remain blank.")
        _HAS_CURRENT_STAGE = False
        return None


# ---------------------------------------------------------------------------
# Resources (vessel total + current stage)
# ---------------------------------------------------------------------------
def _gather_resources(vessel):
    """Return vessel and current-stage resources for dashboard rendering."""
    out = {}
    try:
        res = vessel.resources
        names = [name for name in res.names if _is_consumable_resource(name)]
    except Exception:
        return {}

    out["res.names"] = names
    for n in names:
        try:
            out[f"r.resource[{n}]"] = res.amount(n)
            out[f"r.resourceMax[{n}]"] = res.max(n)
        except Exception:
            pass

    stage = _current_stage(vessel)
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


def _gather_target(conn, vessel):
    sc = conn.space_center
    out = {}
    tgt = None
    ttype = ""
    tport = None

    try:
        tport = sc.target_docking_port
        if tport is not None:
            tgt, ttype = tport, "dockingport"
    except Exception:
        pass
    if tgt is None:
        try:
            tv = sc.target_vessel
            if tv is not None:
                tgt, ttype = tv, "vessel"
        except Exception:
            pass
    if tgt is None:
        try:
            tb = sc.target_body
            if tb is not None:
                tgt, ttype = tb, "body"
        except Exception:
            pass

    if tgt is None:
        return {"tar.name": ""}   # explicit "no target" -- dashboard hides the panel

    try:
        out["tar.name"] = tgt.name
    except Exception:
        out["tar.name"] = ttype
    out["tar.type"] = ttype

    # Distance / relative velocity, expressed in OUR vessel's frame.
    try:
        vref = vessel.reference_frame
        out["tar.distance"] = _mag(tgt.position(vref))
        out["tar.o.relativeVelocity"] = _mag(tgt.velocity(vref))
    except Exception:
        pass

    # Target's own orbit. A docking port has no .orbit -- climb to its vessel.
    orbit_src = tgt
    if ttype == "dockingport":
        try:
            orbit_src = tport.part.vessel
        except Exception:
            orbit_src = None
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
# The custom service pumps MechJeb's async sim on every read. Prime it, allow
# MechJeb's 100 ms flight refresh window to complete, then take one snapshot.
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
):
    try:
        ss = conn.stage_stats
    except Exception as exc:
        _stage_trace("service_missing", source=source,
                     error=type(exc).__name__, message=str(exc))
        return {}  # service DLL not installed this session

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
        out.update(flight_conditions(conn))
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
        scene = conn.krpc.current_game_scene
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


def _gather_science(conn, vessel):
    try:
        service = conn.vessel_science
        if not service.available:
            return _gather_science_stock(vessel)

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

        for key, method_name in (
            ("sci.krpc.containerCount", "container_count"),
            ("sci.krpc.failedContainerCount", "failed_container_count"),
            ("sci.krpc.failedValueCount", "failed_value_count"),
        ):
            try:
                result[key] = getattr(service, method_name)()
            except Exception:
                pass
        return result
    except Exception:
        return _gather_science_stock(vessel)


# ---------------------------------------------------------------------------
# Telemetry gathering
# ---------------------------------------------------------------------------
def _gather_sas(conn, vessel):
    """Return stock SAS and Smart A.S.S. state without coupling either source."""
    result = {}
    try:
        control = vessel.control
        result["krpc.sas"] = bool(control.sas)
        try:
            result["krpc.sasMode"] = str(control.sas_mode)
        except Exception:
            pass
    except Exception:
        pass

    try:
        mj = conn.mech_jeb
        if mj.api_ready:
            smart_ass_mode = str(mj.smart_ass.autopilot_mode)
            result["mj.sasMode"] = smart_ass_mode
            result["mj.sasActive"] = smart_ass_mode.split(".")[-1].lower() != "off"
    except Exception:
        pass
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
    try:
        result = _gather_system_heat(conn)
        if result:
            return result
    except Exception:
        pass
    try:
        return _gather_stock_heat(conn)
    except Exception:
        return None


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
            crew_count = _overview_value(vessel, "crew_count")
            if crew_count is None:
                crew_count = len(_overview_list(vessel, "crew"))
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


def _gather_overview_contracts(sc):
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
        row = {
            "title": _overview_value(contract, "title", "Untitled contract"),
            "type": _overview_label(_overview_value(contract, "type"), "Contract"),
            "deadline": _overview_value(contract, "date_deadline"),
        }
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
    """Return the read-only, independently throttled mission overview."""
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
        "overview.readOnly": True,
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
        current_ut = sc.ut
        data["t.universalTime"] = current_ut
        if _overview_last_ut is not None and current_ut < _overview_last_ut:
            _reset_overview_state()
        _overview_last_ut = current_ut
    except Exception:
        return data

    tiers = (
        ("economy", OVERVIEW_ECONOMY_POLL_SECONDS,
         lambda: _gather_overview_economy(sc)),
        ("alarms", OVERVIEW_ALARMS_POLL_SECONDS,
         lambda: _gather_overview_alarms(conn, sc)),
        ("fleet", fleet_interval,
         lambda: _gather_overview_fleet(sc)),
        ("contracts", OVERVIEW_CONTRACTS_POLL_SECONDS,
         lambda: _gather_overview_contracts(sc)),
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


def gather_telemetry(conn):
    global _stage_cache, _stage_last_poll, _stage_last_ut
    global _telemetry_mode, _editor_bodies_cache, _stage_trace_last_published
    d = {}

    # The game scene is the authoritative signal. A vessel handle may remain
    # available briefly during editor and scene transitions.
    try:
        scene = conn.krpc.current_game_scene
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
            _stage_trace("mode_transition", previous=previous_mode, current=mode)
            if mode == "flight":
                _stage_trace("cache_clear", reason="enter_flight",
                             previous=_stage_summary(_stage_cache))
                _stage_cache = {}
                _stage_last_poll = 0.0
                _stage_last_ut = None
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

    # ---- clocks (every tick) ----
    universal_time = None
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

    # ---- throttle ----
    try:
        d["krpc.throttle"] = vessel.control.throttle
    except Exception:
        pass

    # ---- navball + flight + orbit (every tick; all cheap) ----
    try:
        body = vessel.orbit.body
        srf = vessel.flight(vessel.surface_reference_frame)   # navball attitude
        fbody = vessel.flight(body.reference_frame)           # surface-relative motion
        orbit = vessel.orbit

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
        d["o.inclination"] = math.degrees(orbit.inclination)  # kRPC: radians
        d["o.eccentricity"] = orbit.eccentricity
        d["o.period"] = orbit.period

        d["v.body"] = body.name
    except Exception:
        pass

    # ---- current stage index (fed to the dashboard if this build has it) ----
    cs = _current_stage(vessel)
    if cs is not None:
        d["krpc.currentStage"] = cs

    # ---- comms: RemoteTech is authoritative here; stock CommNet is the fallback ----
    try:
        rt = conn.remote_tech
        d["rt.available"] = rt.available
        if rt.available:
            comms = rt.comms(vessel)
            d["rt.hasConnection"] = comms.has_connection
            d["rt.signalDelay"] = comms.signal_delay if comms.has_connection else None
    except Exception:
        pass  # RemoteTech service not present this session

    try:
        c = vessel.comms
        d["comm.krpc.canCommunicate"] = c.can_communicate
        d["comm.krpc.signalStrength"] = c.signal_strength
    except Exception:
        pass  # no antenna / no CommNet

    # ---- stock SAS + MechJeb SmartASS mode ----
    # Smart A.S.S. and stock SAS are mutually exclusive in normal operation,
    # but stock SAS can pulse on briefly before MechJeb turns it back off. Send
    # both sources so the dashboard can keep Smart A.S.S. authoritative during
    # that handoff instead of flashing a stock mode.
    d.update(_gather_sas(conn, vessel))

    # ---- resources ----
    global _res_cache, _res_last_poll
    if now - _res_last_poll >= RES_POLL_SECONDS:
        _res_last_poll = now
        try:
            r = _gather_resources(vessel)
            if r:
                _res_cache = r
        except Exception:
            pass
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

    # ---- per-stage delta-V (KRPC.StageStats / MechJeb) ----
    # Revert-to-launch rewinds universal time while the process and kRPC
    # connection can remain alive. Never carry the previous flight's last good
    # stage snapshot across that boundary.
    if universal_time is not None:
        if _stage_last_ut is not None and universal_time < _stage_last_ut:
            _stage_trace(
                "ut_rewind", previousUt=_stage_last_ut,
                currentUt=universal_time,
                previousCache=_stage_summary(_stage_cache),
            )
            _stage_cache = {}
            _stage_last_poll = 0.0
        _stage_last_ut = universal_time

    if now - _stage_last_poll >= STAGE_POLL_SECONDS:
        _stage_last_poll = now
        try:
            result = _gather_stages(conn)
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
    d.update(_stage_cache)
    _trace_stage_publish(d, "flight")

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
    global _heat_cache, _heat_last_poll
    if now - _heat_last_poll >= HEAT_POLL_SECONDS:
        _heat_last_poll = now
        _heat_cache = _gather_heat(conn) or {}
    d.update(_heat_cache)

    # ---- Electricity by source: reactors (custom service) + RTGs + solar ----
    global _elec_cache, _elec_last_poll
    if now - _elec_last_poll >= ELEC_POLL_SECONDS:
        _elec_last_poll = now
        elec = {}

        try:
            sh = conn.system_heat
            reactors = []
            for i in range(sh.reactor_count()):
                reactors.append({
                    "name": sh.reactor_name(i),
                    "on": bool(sh.reactor_enabled(i)),
                    "status": sh.reactor_status(i) or "",
                    "ecPerSec": round(sh.reactor_electrical_generation(i), 2),
                    "ecMax": round(sh.reactor_max_electrical_generation(i), 2),
                    "coreTemp": round(sh.reactor_core_temperature(i), 1),
                    "nominalTemp": round(sh.reactor_nominal_temperature(i), 1),
                    "integrity": round(sh.reactor_core_integrity(i), 1),
                    "fuel": sh.reactor_fuel_status(i) or "",
                    "throttle": round(sh.reactor_throttle(i), 1),
                })
            elec["elec.reactors"] = reactors
        except Exception:
            pass  # service not present / scene change

        try:
            sh = conn.system_heat
            elec["rtg.count"] = sh.rtg_count()
            elec["rtg.outputEcPerSec"] = round(sh.rtg_total_output(), 2)
        except Exception:
            pass

        solar_ec = 0.0
        try:
            panels = vessel.parts.solar_panels
            total_flow = 0.0
            exposures = []
            for sp in panels:
                total_flow += sp.energy_flow
                exposures.append(sp.sun_exposure)
            solar_ec = total_flow
            elec["solar.count"] = len(exposures)
            elec["solar.outputEcPerSec"] = round(total_flow, 2)
            elec["solar.efficiency"] = round(sum(exposures) / len(exposures), 3) if exposures else 0.0
        except Exception:
            pass

        # ---- Total generation + "all other" ----------------------------------
        # The service's TotalElectricalGeneration covers reactors + RTGs + fuel
        # cells + alternators (NOT solar -- we read solar natively above). So the
        # true vessel total = service total + native solar. "All other" is then
        # whatever isn't itemized in the reactor/solar/RTG cards: fuel cells,
        # alternators, and any modded producer the service could read.
        try:
            sh = conn.system_heat
            service_total = sh.total_electrical_generation()  # excludes solar
            total_gen = service_total + solar_ec

            reactor_sum = sum(r["ecPerSec"] for r in elec.get("elec.reactors", []))
            rtg_ec = elec.get("rtg.outputEcPerSec", 0.0) or 0.0
            other = generation_remainder(
                total_gen,
                reactor_sum,
                solar_ec,
                rtg_ec,
            )

            elec["elec.totalGenEcPerSec"] = round(total_gen, 2)
            elec["elec.otherEcPerSec"] = round(other or 0.0, 2)
        except Exception:
            pass  # service absent -> dashboard just won't show total/other

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
