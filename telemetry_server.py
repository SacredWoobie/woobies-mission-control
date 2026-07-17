"""Standalone kRPC telemetry and WebSocket server for the KSP dashboard.

This module owns every dashboard-facing responsibility:
  * its own kRPC connection and reconnect loop
  * flight, orbit, resource, science, heat, electricity, target, and stage data
  * VAB/SPH craft stage analysis and editor-condition selection
  * the WebSocket server consumed by ksp_mission_dashboard.html

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
import os
import sys
import time
import krpc

TELEMETRY_WS_PORT = 8090  # dashboard connects here
TELEMETRY_HZ = 4          # dashboard update rate

# Poll tiers. Flight/orbit/navball values are inexpensive and update every tick.
# Data that requires many RPC round trips is throttled and cached.
SCI_POLL_SECONDS = 5      # science walk is many RPCs
HEAT_POLL_SECONDS = 1     # heat via the custom kRPC service is cheap
ELEC_POLL_SECONDS = 1     # per-reactor + solar + RTG
RES_POLL_SECONDS = 0.5    # 2N calls for N resources aboard
TGT_POLL_SECONDS = 0.5    # target + docking geometry
STAGE_POLL_SECONDS = 0.5  # dv changes continuously during a burn; ~2 Hz readout
STAGE_SETTLE_SECONDS = 0.12  # let MechJeb's 100 ms async sim finish before read
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

# MechJeb recalculates editor craft asynchronously. The service exposes an
# editor_stable flag; the server also requires two matching snapshots before
# publishing a changed craft/environment to the dashboard.
_editor_revision = None
_editor_bodies_cache = []
_editor_stage_cache = {}
_editor_stage_last_poll = 0.0
_editor_stage_candidate = None
_editor_stage_candidate_hits = 0
_telemetry_mode = None

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
# A complete MechJeb result includes every KSP staging slot, including
# zero-thrust decoupler/fairing stages. Therefore a vessel at currentStage N
# must have N+1 result rows, indexed S0 through SN. A shorter result is an async
# partial (or a stale module after a scene change), not a propulsive-only table.
# Reject it so the dashboard never disguises missing stages as S0/S4, etc.
#
#   ksp_number(index) = current_ksp - ((count - 1) - index)
#                     = index + (current_ksp - (count - 1))
#
# atmo (current-pressure) and vac are both emitted per row; the dashboard picks.
# The custom service pumps MechJeb's async sim on every read. Prime it, allow
# MechJeb's 100 ms flight refresh window to complete, then take one snapshot.
# ---------------------------------------------------------------------------
def _gather_stages(conn, source="flight"):
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
    try:
        # The first call collects the previous completed result and requests a
        # new asynchronous simulation. Waiting past MechJeb's 100 ms refresh
        # interval lets the second call collect that new result before we read
        # its individual fields.
        prime_count = int(ss.stage_count())
        time.sleep(STAGE_SETTLE_SECONDS)
        count = int(ss.stage_count())
        current_ksp = int(ss.current_stage())

        # The MechJeb table is indexed S0..S(current). A smaller table is a
        # transient/incomplete simulation. Publish an explicitly empty snapshot
        # rather than relabeling two surviving rows as non-contiguous stages or
        # continuing to show rows from the previous staging state.
        expected_count = max(0, current_ksp + 1)
        if count != expected_count:
            _stage_trace(
                "service_sample", source=source, primeCount=prime_count,
                count=count, currentKsp=current_ksp,
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
        out["stage.mapping"] = "complete"
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
                "ksp": i,
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
        final_current_ksp = int(ss.current_stage())
        if final_count != count or final_current_ksp != current_ksp:
            _stage_trace(
                "mixed_service_sample", source=source,
                primeCount=prime_count, count=count,
                currentKsp=current_ksp, finalCount=final_count,
                finalCurrentKsp=final_current_ksp,
            )
            return {
                "stage.available": True,
                "stage.complete": False,
                "stage.stages": [],
            }
        _stage_trace(
            "service_sample", source=source, primeCount=prime_count,
            count=count, currentKsp=current_ksp,
            expectedCount=expected_count, complete=True, rows=len(stages),
        )
    except Exception as exc:
        _stage_trace("service_read_error", source=source,
                     error=type(exc).__name__, message=str(exc))
        return {}  # mid-scene-change / sim not ready; retain last good cache

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


def _reset_editor_stage_state(revision=None):
    global _editor_revision, _editor_stage_cache, _editor_stage_last_poll
    global _editor_stage_candidate, _editor_stage_candidate_hits
    _editor_revision = revision
    _editor_stage_cache = {}
    _editor_stage_last_poll = 0.0
    _editor_stage_candidate = None
    _editor_stage_candidate_hits = 0


def _gather_editor_telemetry(conn, facility):
    """Gather the focused VAB/SPH payload from KRPC.StageStats."""
    global _editor_revision, _editor_bodies_cache
    global _editor_stage_cache, _editor_stage_last_poll
    global _editor_stage_candidate, _editor_stage_candidate_hits

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
        data["stage.available"] = False
        data["stage.pending"] = False
        return data

    try:
        revision = int(service.editor_revision)
        stable = bool(service.editor_stable)
        data.update({
            "editor.craftName": (
                service.editor_craft_name or "Untitled Space Craft"
            ),
            "editor.body": service.editor_body,
            "editor.altitude": service.editor_altitude,
            "editor.mach": service.editor_mach,
            "editor.revision": revision,
            "editor.stable": stable,
        })
    except Exception:
        return data  # editor scene/service is still loading

    if not _editor_bodies_cache:
        try:
            _editor_bodies_cache = list(service.editor_body_names())
        except Exception:
            pass
    data["editor.bodies"] = _editor_bodies_cache

    if revision != _editor_revision:
        _reset_editor_stage_state(revision)

    if not stable:
        return data

    now = time.time()
    if now - _editor_stage_last_poll >= STAGE_POLL_SECONDS:
        _editor_stage_last_poll = now
        try:
            result = _gather_stages(conn, "editor")
            signature = _stage_signature(result)
            if signature is None:
                if result.get("stage.available") is False:
                    _editor_stage_cache = result
                    _editor_stage_candidate = None
                    _editor_stage_candidate_hits = 0
            elif signature == _editor_stage_candidate:
                _editor_stage_candidate_hits += 1
                if _editor_stage_candidate_hits >= 2:
                    _editor_stage_cache = result
            else:
                _editor_stage_candidate = signature
                _editor_stage_candidate_hits = 1
        except Exception:
            pass

    if _editor_stage_cache:
        data.update(_editor_stage_cache)
        data["stage.pending"] = False
    return data


def _apply_telemetry_command(conn, command):
    """Apply a dashboard editor-condition command on the telemetry connection."""
    if not isinstance(command, dict) or command.get("type") != "editor.conditions":
        return

    try:
        scene = conn.krpc.current_game_scene
        if scene not in (
            conn.krpc.GameScene.editor_vab,
            conn.krpc.GameScene.editor_sph,
        ):
            return

        service = conn.stage_stats
        if "body" in command:
            service.editor_body = str(command["body"])
        if "altitude" in command:
            altitude = float(command["altitude"])
            if math.isfinite(altitude):
                service.editor_altitude = altitude
        if "mach" in command:
            mach = float(command["mach"])
            if math.isfinite(mach):
                service.editor_mach = mach
    except (TypeError, ValueError):
        pass
    except Exception:
        pass  # scene transition or service temporarily unavailable


# ---------------------------------------------------------------------------
# Science aboard. KRPC.VesselScience includes both experiment modules and
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

        if mode == "editor_vab":
            return _gather_editor_telemetry(conn, "VAB")
        if mode == "editor_sph":
            return _gather_editor_telemetry(conn, "SPH")
        if mode != "flight":
            return {
                "context.mode": "inactive",
                "flight.active": False,
                "editor.active": False,
            }
    except Exception:
        pass

    try:
        sc = conn.space_center
        vessel = sc.active_vessel
    except Exception:
        # Connected to kRPC, but no active vessel -- not in flight (in the
        # tracking station, VAB, main menu, or a scene load). The dashboard uses
        # this flag to show its "No Flight in Progress" overlay instead of
        # guessing from absent keys.
        return {
            "context.mode": "inactive",
            "flight.active": False,
            "editor.active": False,
        }

    d["context.mode"] = "flight"
    d["flight.active"] = True
    d["editor.active"] = False
    now = time.time()

    # ---- clocks (every tick) ----
    universal_time = None
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

    # ---- MechJeb SmartASS mode ----
    try:
        mj = conn.mech_jeb
        if mj.api_ready:
            d["mj.sasMode"] = str(mj.smart_ass.autopilot_mode)
    except Exception:
        pass  # MechJeb not ready / not installed this session

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

    # ---- System Heat: via the custom KRPC.SystemHeat service ----
    # Reads System Heat's live simulator through the custom service. Fluxes are
    # reported in kW and temperatures in K.
    global _heat_cache, _heat_last_poll
    if now - _heat_last_poll >= HEAT_POLL_SECONDS:
        _heat_last_poll = now
        try:
            sh = conn.system_heat
            if sh.available:
                loops = []
                for lid in sh.loop_ids():
                    loops.append({
                        "id": str(lid),
                        "tempK": round(sh.loop_temperature(lid), 1),
                        "genKw": round(sh.loop_positive_flux(lid), 2),
                        "remKw": round(sh.loop_removed_flux(lid), 2),
                    })
                gen = sh.total_heat_generation
                rem = abs(sh.total_heat_rejection)  # reported negative; show magnitude
                _heat_cache = {
                    "heat.generatedKw": round(gen, 2),
                    "heat.removedKw": round(rem, 2),
                    "heat.netKw": round(gen - rem, 2),
                    "heat.loops": loops,
                }
            else:
                _heat_cache = {}  # no SystemHeat parts on this vessel
        except Exception:
            pass  # service not present this session / scene change -- keep last good
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
            other = total_gen - reactor_sum - solar_ec - rtg_ec
            if -0.05 < other < 0.0:
                other = 0.0  # clamp tiny rounding noise to zero

            elec["elec.totalGenEcPerSec"] = round(total_gen, 2)
            elec["elec.otherEcPerSec"] = round(other, 2)
        except Exception:
            pass  # service absent -> dashboard just won't show total/other

        if elec:
            _elec_cache = elec
    d.update(_elec_cache)

    return d


# ---------------------------------------------------------------------------
# Telemetry WebSocket server (runs in its own thread, own kRPC connection)
# ---------------------------------------------------------------------------
def run_telemetry_server(host, port):
    import asyncio
    import json
    import math as _math

    def _json_safe(obj):
        """Replace non-finite floats with None so frames remain valid JSON."""
        if isinstance(obj, float):
            return obj if _math.isfinite(obj) else None
        if isinstance(obj, dict):
            return {k: _json_safe(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [_json_safe(v) for v in obj]
        return obj

    try:
        import websockets
    except ImportError:
        print("[telemetry] 'websockets' not installed -- dashboard feed disabled.")
        print("[telemetry] Install with:  pip install websockets")
        return

    tconn = None
    while tconn is None:
        try:
            tconn = connect_krpc("KSP Dashboard Telemetry")
        except Exception as e:
            print(f"[telemetry] waiting for kRPC server... ({e})")
            time.sleep(2)

    print(f"[telemetry] serving dashboard on ws://{host}:{port}  ({TELEMETRY_HZ} Hz)")
    clients = set()
    commands = asyncio.Queue()

    async def handler(ws, *args):  # *args tolerates old & new websockets signatures
        clients.add(ws)
        try:
            async for raw in ws:
                try:
                    command = json.loads(raw)
                    if (isinstance(command, dict) and
                            command.get("type") == "editor.conditions"):
                        await commands.put(command)
                except (TypeError, ValueError, json.JSONDecodeError):
                    pass
        except Exception:
            pass
        finally:
            clients.discard(ws)

    async def broadcaster():
        loop = asyncio.get_event_loop()
        interval = 1.0 / TELEMETRY_HZ
        while True:
            if clients:
                try:
                    # Serialize commands and reads through this connection;
                    # kRPC's protobuf stream is not safe for concurrent calls.
                    while not commands.empty():
                        command = commands.get_nowait()
                        await loop.run_in_executor(
                            None, _apply_telemetry_command, tconn, command)
                    # run the blocking kRPC gather off the event loop
                    data = await loop.run_in_executor(None, gather_telemetry, tconn)
                    # Reject any non-finite value that escaped _json_safe.
                    msg = json.dumps(_json_safe(data), allow_nan=False)
                    await asyncio.gather(*(c.send(msg) for c in list(clients)),
                                         return_exceptions=True)
                except Exception:
                    pass  # transient, e.g. scene change
            await asyncio.sleep(interval)

    async def serve():
        async with websockets.serve(handler, host, port):
            await broadcaster()

    try:
        asyncio.run(serve())
    except Exception as e:
        print(f"[telemetry] server stopped: {e}")


def main():
    host = sys.argv[1] if len(sys.argv) >= 2 else "127.0.0.1"
    port = int(sys.argv[2]) if len(sys.argv) >= 3 else TELEMETRY_WS_PORT

    print("KSP dashboard telemetry server (no ESP32 control code).")
    print(f"Serving ws://{host}:{port} at {TELEMETRY_HZ} Hz. Ctrl+C to stop.")
    if host not in ("127.0.0.1", "localhost", "::1"):
        print("WARNING: this read-only telemetry feed has no authentication.")
        print(f"Network binding is enabled on {host}; use only a trusted network.")

    run_telemetry_server(host, port)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
    except Exception:
        import traceback
        traceback.print_exc()
        if sys.stdin and sys.stdin.isatty():
            input("\nPress Enter to close...")
