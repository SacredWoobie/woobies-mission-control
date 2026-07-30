"""Mission-planning telemetry and commands for Woobie's Mission Control."""

import math
import time


BODY_CATALOG_POLL_SECONDS = 300.0
CRAFT_IDENTITY_POLL_SECONDS = 1.0
ATMOSPHERE_SAMPLE_COUNT = 33
MAX_BODY_NAME_LENGTH = 128
MAX_REQUEST_ID_LENGTH = 128
MAX_ACTION_ID_LENGTH = 128
MAX_FINGERPRINT_LENGTH = 512
MAX_PARKING_ALTITUDE = 1.0e10
MAX_GRID_CELLS = 200_000
MAX_MANEUVER_VECTOR_COMPONENT = 1.0e7
MAX_MANEUVER_DELTA_V = 1.0e7
MANEUVER_NODE_UT_TOLERANCE_SECONDS = 2.0
MANEUVER_NODE_DELTA_V_ABSOLUTE_TOLERANCE = 1.0
MANEUVER_NODE_DELTA_V_RELATIVE_TOLERANCE = 0.001
MISSION_PLANNING_COMMAND_TYPES = frozenset({
    "mechjeb.transfer.start",
    "mechjeb.transfer.cancel",
    "mechjeb.transfer.release",
    "mechjeb.transfer.windows.refresh",
    "mechjeb.transfer.windows.cancel",
    "mechjeb.transfer.grid.request",
    "mechjeb.transfer.grid.ack",
    "mechjeb.transfer.evaluate",
    "mechjeb.transfer.node.preview",
    "mechjeb.transfer.node.create",
})


def _text(value, maximum):
    return value if isinstance(value, str) and 0 < len(value) <= maximum else None


def _planner_state():
    return {
        "available": False,
        "compatibilityReady": False,
        "state": "idle",
        "progress": 0,
        "error": "",
        "requestId": "",
        "fingerprint": "",
        "origin": "",
        "destination": "",
        "originParkingAltitude": 0.0,
        "optimizePoweredCapture": False,
        "requestedAtUT": 0.0,
        "departureUT": 0.0,
        "arrivalUT": 0.0,
        "transferTime": 0.0,
        "ejectionDeltaV": 0.0,
        "arrivalVInfinity": 0.0,
        "calculatedTotal": 0.0,
        "detectedVersion": "",
        "compatibilityTarget": "",
    }


def _grid_state():
    return {
        "requestId": "",
        "fingerprint": "",
        "dateSamples": 0,
        "durationSamples": 0,
        "departureUTs": [],
        "transferTimes": [],
        "costs": [],
        "bestDepartureIndex": -1,
        "bestTransferTimeIndex": -1,
        "published": False,
        "error": "",
    }


def _evaluation_state():
    return {
        "requestId": "",
        "fingerprint": "",
        "departureIndex": -1,
        "transferTimeIndex": -1,
        "departureUT": 0.0,
        "arrivalUT": 0.0,
        "transferTime": 0.0,
        "ejectionDeltaV": 0.0,
        "arrivalVInfinity": 0.0,
        "rawCost": 0.0,
        "departureVInfinityX": 0.0,
        "departureVInfinityY": 0.0,
        "departureVInfinityZ": 0.0,
        "error": "",
    }


def _maneuver_node_state():
    return {
        "actionId": "",
        "fingerprint": "",
        "vesselGuid": "",
        "state": "idle",
        "error": "",
        "nodeUT": 0.0,
        "deltaV": 0.0,
        "deltaVX": 0.0,
        "deltaVY": 0.0,
        "deltaVZ": 0.0,
        "apoapsisAltitude": 0.0,
        "periapsisAltitude": 0.0,
        "inclination": 0.0,
        "eccentricity": 0.0,
        "semiMajorAxis": 0.0,
    }


def _matching_maneuver_node_exists(conn, expected_ut, expected_delta_v=None):
    """Return whether the active vessel still has the node we created.

    A read failure is reported as ``None`` so a transient kRPC problem cannot
    incorrectly invalidate a node.
    """
    try:
        vessel = conn.space_center.active_vessel
        nodes = list(vessel.control.nodes)
    except Exception:
        return None
    for node in nodes:
        try:
            node_ut = float(node.ut)
        except Exception:
            continue
        if not (
            math.isfinite(node_ut)
            and abs(node_ut - expected_ut) <= MANEUVER_NODE_UT_TOLERANCE_SECONDS
        ):
            continue
        if (
            not isinstance(expected_delta_v, (int, float))
            or isinstance(expected_delta_v, bool)
            or not math.isfinite(float(expected_delta_v))
        ):
            return True
        try:
            node_delta_v = float(node.delta_v)
        except Exception:
            # Older kRPC surfaces and transient property failures still retain
            # the established UT-only behavior.
            return True
        if not math.isfinite(node_delta_v):
            continue
        tolerance = max(
            MANEUVER_NODE_DELTA_V_ABSOLUTE_TOLERANCE,
            abs(float(expected_delta_v))
            * MANEUVER_NODE_DELTA_V_RELATIVE_TOLERANCE,
        )
        if abs(node_delta_v - float(expected_delta_v)) <= tolerance:
            return True
    return False


def _transfer_windows_state():
    return {
        "requestId": "",
        "state": "idle",
        "origin": "Kerbin",
        "originParkingAltitude": 80000.0,
        "optimizePoweredCapture": True,
        "activeDestination": "",
        "completedCount": 0,
        "totalCount": 0,
        "progress": 0,
        "requestedAtUT": 0.0,
        "refreshedAtUT": 0.0,
        "results": [],
        "pauseReason": "",
        "error": "",
    }


def _body_catalog(conn):
    """Read every non-star KSP body, including installed planet packs.

    Parent/orbit data makes the frontend independent of a Stock/OPM name list.
    The immutable density samples support a lightweight reference aerocapture
    model without issuing route-specific RPC calls.
    """
    catalog = []
    for body in conn.space_center.bodies.values():
        try:
            if bool(body.is_star):
                continue
            name = str(body.name)
            gravitational_parameter = float(body.gravitational_parameter)
            radius = float(body.equatorial_radius)
            rotation_period = abs(float(body.rotational_period))
            atmosphere_depth = max(0.0, float(body.atmosphere_depth))
            sphere_of_influence = float(body.sphere_of_influence)
            surface_gravity = float(body.surface_gravity)
            solid_surface = bool(body.has_solid_surface)
            orbit = body.orbit
            parent = str(orbit.body.name)
            parent_gravitational_parameter = float(
                orbit.body.gravitational_parameter
            )
            semi_major_axis = float(orbit.semi_major_axis)
        except Exception:
            continue

        values = (
            gravitational_parameter,
            radius,
            rotation_period,
            atmosphere_depth,
            sphere_of_influence,
            surface_gravity,
            parent_gravitational_parameter,
            semi_major_axis,
        )
        if not all(math.isfinite(value) for value in values):
            continue
        if (
            not name
            or gravitational_parameter <= 0.0
            or radius <= 0.0
            or rotation_period <= 0.0
            or sphere_of_influence <= radius
            or surface_gravity <= 0.0
            or not parent
            or parent_gravitational_parameter <= 0.0
            or semi_major_axis <= 0.0
        ):
            continue

        orbit_epoch = None
        mean_longitude_at_epoch = None
        try:
            orbit_epoch = float(orbit.epoch)
            mean_longitude_at_epoch = math.fmod(
                float(orbit.longitude_of_ascending_node)
                + float(orbit.argument_of_periapsis)
                + float(orbit.mean_anomaly_at_epoch),
                2.0 * math.pi,
            )
            if mean_longitude_at_epoch < 0.0:
                mean_longitude_at_epoch += 2.0 * math.pi
            if not (
                math.isfinite(orbit_epoch)
                and math.isfinite(mean_longitude_at_epoch)
            ):
                orbit_epoch = None
                mean_longitude_at_epoch = None
        except Exception:
            # Older kRPC builds and unusual body implementations remain valid
            # catalog entries; only recurring local-window dating is omitted.
            pass

        density_altitudes = []
        densities = []
        if atmosphere_depth > 0.0:
            for index in range(ATMOSPHERE_SAMPLE_COUNT):
                altitude = atmosphere_depth * index / (ATMOSPHERE_SAMPLE_COUNT - 1)
                try:
                    density = max(0.0, float(body.density_at(altitude)))
                except Exception:
                    density_altitudes = []
                    densities = []
                    break
                if not math.isfinite(density):
                    density_altitudes = []
                    densities = []
                    break
                density_altitudes.append(altitude)
                densities.append(density)

        catalog.append(
            {
                "name": name,
                "parent": parent,
                "semiMajorAxis": semi_major_axis,
                "parentGravitationalParameter": parent_gravitational_parameter,
                **(
                    {
                        "orbitEpoch": orbit_epoch,
                        "meanLongitudeAtEpoch": mean_longitude_at_epoch,
                    }
                    if orbit_epoch is not None
                    and mean_longitude_at_epoch is not None
                    else {}
                ),
                "gravitationalParameter": gravitational_parameter,
                "radius": radius,
                "rotationPeriod": rotation_period,
                "atmosphereDepth": atmosphere_depth,
                "sphereOfInfluence": sphere_of_influence,
                "surfaceGravity": surface_gravity,
                "solidSurface": solid_surface,
                "atmosphereDensityAltitudes": density_altitudes,
                "atmosphereDensities": densities,
            }
        )
    return sorted(catalog, key=lambda row: row["name"].casefold())


def _persistent_ids(values):
    """Normalize KSP uint IDs as strings so JavaScript never rounds them."""
    return [str(value) for value in values if str(value)]


def _craft_identity(conn, mode):
    """Read the save- and part-scoped identity used by pinned mission plans.

    Vessel GUID alone cannot restore the departing craft after undock because
    KSP creates a new GUID for that side. Persistent part membership supplies
    the lineage anchor, while the retained GUID tells the UI which docked craft
    was the dockee and therefore which plan should remain active.
    """
    result = {"identity.available": False}
    try:
        service = conn.stage_stats
        save_folder = str(service.game_save_folder)
        if not save_folder:
            return result
        result["game.saveFolder"] = save_folder
        if mode not in ("editor", "flight"):
            return result
        if mode == "editor":
            craft_id = str(service.editor_craft_persistent_id)
            root_id = str(service.editor_root_part_persistent_id)
            part_ids = _persistent_ids(service.editor_part_persistent_ids())
            if not craft_id or not root_id or root_id not in part_ids:
                return result
            result.update({
                "editor.craftPersistentId": craft_id,
                "editor.rootPartPersistentId": root_id,
                "editor.partPersistentIds": part_ids,
            })
        else:
            vessel_guid = str(service.vessel_guid)
            vessel_id = str(service.vessel_persistent_id)
            root_id = str(service.vessel_root_part_persistent_id)
            part_ids = _persistent_ids(service.vessel_part_persistent_ids())
            if not vessel_guid or not vessel_id or not root_id or root_id not in part_ids:
                return result
            result.update({
                "v.guid": vessel_guid,
                "v.persistentId": vessel_id,
                "v.rootPartPersistentId": root_id,
                "v.partPersistentIds": part_ids,
            })
        result["identity.available"] = True
    except Exception:
        # Older StageStats builds remain usable for staging; the UI will retain
        # its explicit legacy/global pin fallback until 0.2.4 or newer is installed.
        pass
    return result


def _build_controller():
    state = _planner_state()
    grid = _grid_state()
    evaluation = _evaluation_state()
    maneuver_node = _maneuver_node_state()
    transfer_windows = _transfer_windows_state()
    prepared_ejection_token = ""
    prepared_ejection_session = ""
    planner_owner = ""
    planner_owner_request_id = ""
    transfer_window_queue = []
    transfer_windows_last_ut = None
    maneuver_node_last_ut = None
    catalog_cache = []
    catalog_last_poll = 0.0
    identity_cache = {"identity.available": False}
    identity_last_poll = 0.0
    identity_mode = None

    def planner_for(conn):
        service = conn.mech_jeb
        planner = service.transfer_planner
        state["available"] = bool(planner.available)
        state["compatibilityReady"] = bool(service.type_compatibility_ready)
        state["detectedVersion"] = str(planner.detected_mech_jeb_version)
        state["compatibilityTarget"] = str(planner.compatibility_target)
        return planner

    def fail(message):
        state["state"] = "failed"
        state["progress"] = 0
        state["error"] = str(message)

    def start_transfer(conn, command):
        nonlocal planner_owner, planner_owner_request_id
        request_id = _text(command.get("requestId"), MAX_REQUEST_ID_LENGTH)
        fingerprint = _text(command.get("fingerprint"), MAX_FINGERPRINT_LENGTH)
        origin = _text(command.get("origin"), MAX_BODY_NAME_LENGTH)
        destination = _text(command.get("destination"), MAX_BODY_NAME_LENGTH)
        altitude = command.get("originParkingAltitude")
        powered_capture = command.get("optimizePoweredCapture")
        earliest_departure = command.get("earliestDepartureUT")
        if not request_id or not fingerprint or not origin or not destination:
            return
        if (
            isinstance(altitude, bool)
            or not isinstance(altitude, (int, float))
            or not math.isfinite(float(altitude))
            or float(altitude) < 0.0
            or float(altitude) > MAX_PARKING_ALTITUDE
            or not isinstance(powered_capture, bool)
        ):
            return
        if earliest_departure is not None and (
            isinstance(earliest_departure, bool)
            or not isinstance(earliest_departure, (int, float))
            or not math.isfinite(float(earliest_departure))
            or float(earliest_departure) < 0.0
        ):
            return

        if (
            planner_owner == "interactive"
            and planner_owner_request_id
            and state["state"] in {"starting", "running", "cancelling"}
        ):
            # An active singleton request owns the public state. Matching retries
            # are idempotent; competing requests must wait for release.
            return
        state.update(_planner_state())
        grid.update(_grid_state())
        evaluation.update(_evaluation_state())
        state.update(
            {
                "requestId": request_id,
                "fingerprint": fingerprint,
                "origin": origin,
                "destination": destination,
                "originParkingAltitude": float(altitude),
                "optimizePoweredCapture": powered_capture,
                "state": "starting",
            }
        )
        try:
            planner = planner_for(conn)
            if not state["available"] or not state["compatibilityReady"]:
                fail("WoobiesMechJeb transfer planning is unavailable.")
                return
            if planner_owner == "windows":
                fail(
                    "Mission Control is refreshing the transfer-window board. "
                    "Cancel that refresh or wait for it to finish."
                )
                return
            remote_state = str(planner.state).lower()
            if remote_state in {"running", "cancelling"}:
                fail("MechJeb transfer planner is already busy.")
                return
            try:
                state["requestedAtUT"] = float(conn.space_center.ut)
            except Exception:
                state["requestedAtUT"] = 0.0
            if earliest_departure is None:
                planner.start_automatic(origin, destination, float(altitude), powered_capture)
            else:
                planner.start_automatic_after(
                    origin, destination, float(altitude), powered_capture,
                    float(earliest_departure),
                )
            planner_owner = "interactive"
            planner_owner_request_id = request_id
            state["state"] = "running"
            state["progress"] = 0
        except Exception as error:
            fail(error)

    def cancel_transfer(conn, command):
        request_id = _text(command.get("requestId"), MAX_REQUEST_ID_LENGTH)
        if not request_id or request_id != state["requestId"]:
            return
        try:
            planner_for(conn).cancel()
            if state["state"] in {"starting", "running"}:
                state["state"] = "cancelling"
        except Exception as error:
            fail(error)

    def release_transfer(command):
        nonlocal planner_owner, planner_owner_request_id
        request_id = _text(command.get("requestId"), MAX_REQUEST_ID_LENGTH)
        if (
            request_id
            and planner_owner == "interactive"
            and request_id == planner_owner_request_id
            and state["state"] not in {"starting", "running", "cancelling"}
        ):
            planner_owner = ""
            planner_owner_request_id = ""

    def request_grid(conn, command):
        request_id = _text(command.get("requestId"), MAX_REQUEST_ID_LENGTH)
        fingerprint = _text(command.get("fingerprint"), MAX_FINGERPRINT_LENGTH)
        if (
            not request_id
            or request_id != state["requestId"]
            or fingerprint != state["fingerprint"]
            or state["state"] != "completed"
            or planner_owner != "interactive"
            or planner_owner_request_id != request_id
        ):
            return
        grid.update(_grid_state())
        grid["requestId"] = request_id
        grid["fingerprint"] = fingerprint
        try:
            planner = planner_for(conn)
            date_samples = int(planner.date_samples)
            duration_samples = int(planner.duration_samples)
            if (
                date_samples <= 0
                or duration_samples <= 0
                or date_samples * duration_samples > MAX_GRID_CELLS
            ):
                raise ValueError("MechJeb returned an invalid porkchop grid size.")
            departures = [float(value) for value in planner.get_departure_u_ts()]
            durations = [float(value) for value in planner.get_transfer_times()]
            raw_costs = [float(value) for value in planner.get_delta_v_grid()]
            if len(departures) != date_samples or len(durations) != duration_samples:
                raise ValueError("MechJeb porkchop axes do not match the grid dimensions.")
            if len(raw_costs) != date_samples * duration_samples:
                raise ValueError("MechJeb porkchop costs do not match the grid dimensions.")
            if not all(math.isfinite(value) for value in departures + durations):
                raise ValueError("MechJeb porkchop axes contain non-finite values.")
            grid.update(
                {
                    "dateSamples": date_samples,
                    "durationSamples": duration_samples,
                    "departureUTs": departures,
                    "transferTimes": durations,
                    "costs": [value if math.isfinite(value) else None for value in raw_costs],
                    "bestDepartureIndex": int(planner.best_departure_index),
                    "bestTransferTimeIndex": int(planner.best_transfer_time_index),
                    "published": True,
                }
            )
        except Exception as error:
            grid["error"] = str(error)
            grid["published"] = True

    def acknowledge_grid(command):
        request_id = _text(command.get("requestId"), MAX_REQUEST_ID_LENGTH)
        if request_id and request_id == grid["requestId"]:
            grid["published"] = False
            grid["departureUTs"] = []
            grid["transferTimes"] = []
            grid["costs"] = []

    def evaluate_point(conn, command):
        request_id = _text(command.get("requestId"), MAX_REQUEST_ID_LENGTH)
        fingerprint = _text(command.get("fingerprint"), MAX_FINGERPRINT_LENGTH)
        departure_index = command.get("departureIndex")
        transfer_time_index = command.get("transferTimeIndex")
        if (
            not request_id
            or request_id != state["requestId"]
            or fingerprint != state["fingerprint"]
            or state["state"] != "completed"
            or planner_owner != "interactive"
            or planner_owner_request_id != request_id
            or isinstance(departure_index, bool)
            or not isinstance(departure_index, int)
            or isinstance(transfer_time_index, bool)
            or not isinstance(transfer_time_index, int)
        ):
            return
        evaluation.update(_evaluation_state())
        evaluation.update(
            {
                "requestId": request_id,
                "fingerprint": fingerprint,
                "departureIndex": departure_index,
                "transferTimeIndex": transfer_time_index,
            }
        )
        try:
            values = [float(value) for value in planner_for(conn).evaluate_point_detailed(
                departure_index, transfer_time_index,
            )]
            if len(values) != 9 or not all(math.isfinite(value) for value in values):
                raise ValueError("MechJeb returned an invalid porkchop point evaluation.")
            evaluation.update(
                {
                    "departureUT": values[0],
                    "arrivalUT": values[1],
                    "transferTime": values[2],
                    "ejectionDeltaV": values[3],
                    "arrivalVInfinity": values[4],
                    "rawCost": values[5],
                    "departureVInfinityX": values[6],
                    "departureVInfinityY": values[7],
                    "departureVInfinityZ": values[8],
                }
            )
        except Exception as error:
            evaluation["error"] = str(error)

    def begin_next_transfer_window(conn, planner):
        nonlocal planner_owner, planner_owner_request_id
        if planner_owner:
            transfer_windows["state"] = "paused"
            transfer_windows["pauseReason"] = (
                "Interactive transfer planning is using MechJeb."
                if planner_owner == "interactive"
                else "Another transfer-window calculation is still running."
            )
            return
        if not transfer_window_queue:
            transfer_windows["state"] = (
                "partial"
                if any(row.get("error") for row in transfer_windows["results"])
                else "completed"
            )
            transfer_windows["activeDestination"] = ""
            transfer_windows["progress"] = 100
            transfer_windows["pauseReason"] = ""
            try:
                transfer_windows["refreshedAtUT"] = float(conn.space_center.ut)
            except Exception:
                transfer_windows["refreshedAtUT"] = transfer_windows["requestedAtUT"]
            return

        destination = transfer_window_queue.pop(0)
        transfer_windows["activeDestination"] = destination
        transfer_windows["state"] = "running"
        transfer_windows["progress"] = 0
        transfer_windows["pauseReason"] = ""
        planner.start_automatic(
            transfer_windows["origin"],
            destination,
            transfer_windows["originParkingAltitude"],
            transfer_windows["optimizePoweredCapture"],
        )
        planner_owner = "windows"
        planner_owner_request_id = transfer_windows["requestId"]

    def start_transfer_windows(conn, command):
        nonlocal catalog_cache, catalog_last_poll, transfer_window_queue
        request_id = _text(command.get("requestId"), MAX_REQUEST_ID_LENGTH)
        origin = _text(command.get("origin"), MAX_BODY_NAME_LENGTH)
        altitude = command.get("originParkingAltitude")
        powered_capture = command.get("optimizePoweredCapture")
        if (
            not request_id
            or not origin
            or isinstance(altitude, bool)
            or not isinstance(altitude, (int, float))
            or not math.isfinite(float(altitude))
            or float(altitude) < 0.0
            or float(altitude) > MAX_PARKING_ALTITUDE
            or not isinstance(powered_capture, bool)
        ):
            return
        if (
            request_id == transfer_windows["requestId"]
            and transfer_windows["state"] != "failed"
        ):
            return
        if transfer_windows["state"] in {
            "queued", "paused", "running", "cancelling",
        }:
            return

        transfer_windows.update(_transfer_windows_state())
        transfer_windows.update({
            "requestId": request_id,
            "origin": origin,
            "originParkingAltitude": float(altitude),
            "optimizePoweredCapture": powered_capture,
            "state": "queued",
        })
        try:
            planner = planner_for(conn)
            if not state["available"] or not state["compatibilityReady"]:
                raise ValueError("WoobiesMechJeb transfer planning is unavailable.")
            catalog = _body_catalog(conn)
            if not catalog:
                catalog = list(catalog_cache)
            origin_row = next(
                (row for row in catalog if row["name"].casefold() == origin.casefold()),
                None,
            )
            if not origin_row:
                raise ValueError(f"{origin} is not available in the live body catalog.")
            destinations = sorted(
                (
                    row["name"]
                    for row in catalog
                    if row["name"].casefold() != origin.casefold()
                    and row.get("parent") == origin_row.get("parent")
                ),
                key=str.casefold,
            )
            if not destinations:
                raise ValueError(
                    f"No same-system planetary destinations were found for {origin}."
                )

            catalog_cache = catalog
            catalog_last_poll = time.time()
            transfer_window_queue = list(destinations)
            transfer_windows["totalCount"] = len(destinations)
            try:
                transfer_windows["requestedAtUT"] = float(conn.space_center.ut)
            except Exception:
                transfer_windows["requestedAtUT"] = 0.0
            if planner_owner:
                transfer_windows["state"] = "paused"
                transfer_windows["pauseReason"] = (
                    "Interactive transfer planning is using MechJeb."
                    if planner_owner == "interactive"
                    else "A transfer-window refresh is already running."
                )
            else:
                begin_next_transfer_window(conn, planner)
        except Exception as error:
            transfer_window_queue = []
            transfer_windows["state"] = "failed"
            transfer_windows["activeDestination"] = ""
            transfer_windows["error"] = str(error)

    def cancel_transfer_windows(conn, command):
        nonlocal planner_owner, planner_owner_request_id, transfer_window_queue
        request_id = _text(command.get("requestId"), MAX_REQUEST_ID_LENGTH)
        if (
            not request_id
            or request_id != transfer_windows["requestId"]
            or transfer_windows["state"] not in {
                "queued", "paused", "running", "cancelling",
            }
        ):
            return
        transfer_window_queue = []
        transfer_windows["pauseReason"] = ""
        transfer_windows["error"] = ""
        if planner_owner != "windows":
            transfer_windows["state"] = "cancelled"
            transfer_windows["activeDestination"] = ""
            return
        transfer_windows["state"] = "cancelling"
        try:
            planner_for(conn).cancel()
        except Exception as error:
            planner_owner = ""
            planner_owner_request_id = ""
            transfer_windows["state"] = "failed"
            transfer_windows["activeDestination"] = ""
            transfer_windows["error"] = str(error)

    def refresh_transfer_windows(conn):
        nonlocal planner_owner, planner_owner_request_id
        if transfer_windows["state"] in {"queued", "paused"}:
            if planner_owner:
                transfer_windows["state"] = "paused"
                transfer_windows["pauseReason"] = (
                    "Interactive transfer planning is using MechJeb."
                    if planner_owner == "interactive"
                    else transfer_windows["pauseReason"]
                )
                return
            try:
                begin_next_transfer_window(conn, planner_for(conn))
            except Exception as error:
                transfer_windows["state"] = "failed"
                transfer_windows["error"] = str(error)
            return
        if planner_owner != "windows":
            return

        try:
            planner = planner_for(conn)
            remote_state = str(planner.state).lower()
            transfer_windows["progress"] = int(planner.progress)
            if remote_state in {"running", "cancelling"}:
                transfer_windows["state"] = remote_state
                return
            if remote_state == "cancelled":
                planner_owner = ""
                planner_owner_request_id = ""
                transfer_windows["state"] = "cancelled"
                transfer_windows["activeDestination"] = ""
                return

            destination = transfer_windows["activeDestination"]
            row = {"destination": destination}
            if remote_state == "completed":
                arrival_property = getattr(
                    planner, "best_arrival_v_infinity", None
                )
                if arrival_property is None:
                    arrival_property = planner.best_capture_delta_v
                values = {
                    "departureUT": float(planner.best_departure_ut),
                    "arrivalUT": float(planner.best_arrival_ut),
                    "transferTime": float(planner.best_transfer_time),
                    "ejectionDeltaV": float(planner.best_ejection_delta_v),
                    "arrivalVInfinity": float(arrival_property),
                    "calculatedTotal": float(planner.best_total_delta_v),
                }
                if not all(
                    math.isfinite(value) and value >= 0.0
                    for value in values.values()
                ):
                    raise ValueError(
                        f"MechJeb returned invalid transfer-window data for {destination}."
                    )
                row.update(values)
            else:
                row["error"] = str(planner.error) or (
                    f"MechJeb could not calculate a transfer window for {destination}."
                )

            transfer_windows["results"] = [*transfer_windows["results"], row]
            transfer_windows["completedCount"] += 1
            planner_owner = ""
            planner_owner_request_id = ""
            begin_next_transfer_window(conn, planner)
        except Exception as error:
            destination = transfer_windows["activeDestination"]
            transfer_windows["results"] = [
                *transfer_windows["results"],
                {"destination": destination, "error": str(error)},
            ]
            transfer_windows["completedCount"] += 1
            planner_owner = ""
            planner_owner_request_id = ""
            try:
                begin_next_transfer_window(conn, planner_for(conn))
            except Exception as next_error:
                transfer_windows["state"] = "failed"
                transfer_windows["activeDestination"] = ""
                transfer_windows["error"] = str(next_error)

    def preview_maneuver_node(conn, command):
        nonlocal prepared_ejection_token, prepared_ejection_session
        session_id = _text(command.get("_sessionId"), MAX_ACTION_ID_LENGTH) or "legacy"
        action_id = _text(command.get("actionId"), MAX_ACTION_ID_LENGTH)
        fingerprint = _text(command.get("fingerprint"), MAX_FINGERPRINT_LENGTH)
        origin = _text(command.get("origin"), MAX_BODY_NAME_LENGTH)
        expected_vessel_guid = _text(
            command.get("expectedVesselGuid"), MAX_ACTION_ID_LENGTH
        )
        parking_altitude = command.get("plannedParkingAltitude")
        departure_ut = command.get("departureUT")
        expected_delta_v = command.get("expectedDeltaV")
        departure_v_infinity = command.get("departureVInfinity")
        numeric_values = [parking_altitude, departure_ut, expected_delta_v]
        if (
            not action_id
            or not fingerprint
            or not origin
            or not expected_vessel_guid
            or any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(float(value))
                for value in numeric_values
            )
            or float(parking_altitude) < 0.0
            or float(parking_altitude) > MAX_PARKING_ALTITUDE
            or float(departure_ut) <= 0.0
            or float(expected_delta_v) < 0.0
            or float(expected_delta_v) > MAX_MANEUVER_DELTA_V
            or not isinstance(departure_v_infinity, list)
            or len(departure_v_infinity) != 3
            or any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(float(value))
                or abs(float(value)) > MAX_MANEUVER_VECTOR_COMPONENT
                for value in departure_v_infinity
            )
        ):
            return

        maneuver_node.update(_maneuver_node_state())
        maneuver_node.update({
            "actionId": action_id,
            "fingerprint": fingerprint,
            "vesselGuid": expected_vessel_guid,
            "state": "previewing",
        })
        prepared_ejection_token = ""
        prepared_ejection_session = ""
        try:
            planner = planner_for(conn)
            if not state["available"] or not state["compatibilityReady"]:
                raise ValueError("WoobiesMechJeb maneuver planning is unavailable.")
            values = [float(value) for value in planner.preview_active_vessel_ejection(
                origin,
                float(departure_ut),
                float(departure_v_infinity[0]),
                float(departure_v_infinity[1]),
                float(departure_v_infinity[2]),
                expected_vessel_guid,
            )]
            if len(values) != 10 or not all(math.isfinite(value) for value in values):
                raise ValueError("MechJeb returned an invalid maneuver preview.")
            prepared_ejection_token = str(planner.prepared_ejection_token)
            if not prepared_ejection_token:
                raise ValueError("MechJeb did not prepare a maneuver token.")
            prepared_ejection_session = session_id
            maneuver_node.update({
                "state": "ready",
                "nodeUT": values[0],
                "deltaVX": values[1],
                "deltaVY": values[2],
                "deltaVZ": values[3],
                "deltaV": values[4],
                "apoapsisAltitude": values[5],
                "periapsisAltitude": values[6],
                "inclination": values[7],
                "eccentricity": values[8],
                "semiMajorAxis": values[9],
            })
        except Exception as error:
            prepared_ejection_token = ""
            prepared_ejection_session = ""
            maneuver_node["state"] = "failed"
            maneuver_node["error"] = str(error)

    def create_maneuver_node(conn, command):
        session_id = _text(command.get("_sessionId"), MAX_ACTION_ID_LENGTH) or "legacy"
        action_id = _text(command.get("actionId"), MAX_ACTION_ID_LENGTH)
        fingerprint = _text(command.get("fingerprint"), MAX_FINGERPRINT_LENGTH)
        expected_vessel_guid = _text(
            command.get("expectedVesselGuid"), MAX_ACTION_ID_LENGTH
        )
        if (
            not action_id
            or action_id != maneuver_node["actionId"]
            or not fingerprint
            or fingerprint != maneuver_node["fingerprint"]
            or not expected_vessel_guid
            or expected_vessel_guid != maneuver_node["vesselGuid"]
            or maneuver_node["state"] not in {"ready", "created"}
            or not prepared_ejection_token
            or session_id != prepared_ejection_session
        ):
            return
        if maneuver_node["state"] == "created":
            return
        maneuver_node["state"] = "creating"
        maneuver_node["error"] = ""
        try:
            values = [float(value) for value in planner_for(conn).create_prepared_ejection(
                prepared_ejection_token, expected_vessel_guid,
            )]
            if len(values) != 10 or not all(math.isfinite(value) for value in values):
                raise ValueError("MechJeb returned an invalid created maneuver.")
            maneuver_node.update({
                "state": "created",
                "nodeUT": values[0],
                "deltaVX": values[1],
                "deltaVY": values[2],
                "deltaVZ": values[3],
                "deltaV": values[4],
                "apoapsisAltitude": values[5],
                "periapsisAltitude": values[6],
                "inclination": values[7],
                "eccentricity": values[8],
                "semiMajorAxis": values[9],
            })
        except Exception as error:
            maneuver_node["state"] = "failed"
            maneuver_node["error"] = str(error)

    def apply_command(conn, command):
        if isinstance(command, dict):
            command_type = command.get("type")
            if command_type == "mechjeb.transfer.start":
                start_transfer(conn, command)
                return True
            if command_type == "mechjeb.transfer.cancel":
                cancel_transfer(conn, command)
                return True
            if command_type == "mechjeb.transfer.release":
                release_transfer(command)
                return True
            if command_type == "mechjeb.transfer.grid.request":
                request_grid(conn, command)
                return True
            if command_type == "mechjeb.transfer.grid.ack":
                acknowledge_grid(command)
                return True
            if command_type == "mechjeb.transfer.evaluate":
                evaluate_point(conn, command)
                return True
            if command_type == "mechjeb.transfer.windows.refresh":
                start_transfer_windows(conn, command)
                return True
            if command_type == "mechjeb.transfer.windows.cancel":
                cancel_transfer_windows(conn, command)
                return True
            if command_type == "mechjeb.transfer.node.preview":
                preview_maneuver_node(conn, command)
                return True
            if command_type == "mechjeb.transfer.node.create":
                create_maneuver_node(conn, command)
                return True
        return False

    def refresh_transfer(conn):
        nonlocal planner_owner, planner_owner_request_id
        if planner_owner != "interactive":
            return
        try:
            planner = planner_for(conn)
            if not state["requestId"]:
                return
            # A local validation/availability/busy failure belongs to this
            # request. Do not replace it with the state of an unrelated or
            # idle remote worker on the next telemetry poll.
            if state["state"] == "failed":
                return
            remote_state = str(planner.state).lower()
            state["state"] = remote_state
            state["progress"] = int(planner.progress)
            state["error"] = str(planner.error)
            if remote_state != "completed":
                if remote_state not in {"starting", "running", "cancelling"}:
                    planner_owner = ""
                    planner_owner_request_id = ""
                return
            state["origin"] = str(planner.origin_body)
            state["destination"] = str(planner.destination_body)
            state["originParkingAltitude"] = float(planner.parking_altitude)
            state["optimizePoweredCapture"] = bool(planner.include_capture_burn)
            state["departureUT"] = float(planner.best_departure_ut)
            state["arrivalUT"] = float(planner.best_arrival_ut)
            state["transferTime"] = float(planner.best_transfer_time)
            state["ejectionDeltaV"] = float(planner.best_ejection_delta_v)
            arrival_property = getattr(planner, "best_arrival_v_infinity", None)
            if arrival_property is None:
                arrival_property = planner.best_capture_delta_v
            state["arrivalVInfinity"] = float(arrival_property)
            state["calculatedTotal"] = float(planner.best_total_delta_v)
        except Exception as error:
            if state["requestId"]:
                fail(error)
                planner_owner = ""
                planner_owner_request_id = ""
            else:
                state["available"] = False
                state["compatibilityReady"] = False

    def attach_planning(conn, payload):
        nonlocal catalog_cache, catalog_last_poll
        nonlocal identity_cache, identity_last_poll, identity_mode
        nonlocal transfer_windows_last_ut, maneuver_node_last_ut
        nonlocal prepared_ejection_token, prepared_ejection_session
        current_time = time.time()
        if not catalog_cache or current_time - catalog_last_poll >= BODY_CATALOG_POLL_SECONDS:
            catalog_last_poll = current_time
            try:
                catalog = _body_catalog(conn)
                if catalog:
                    catalog_cache = catalog
            except Exception:
                pass

        result = dict(payload)
        current_ut = result.get("t.universalTime")
        if (
            isinstance(current_ut, (int, float))
            and not isinstance(current_ut, bool)
            and math.isfinite(float(current_ut))
        ):
            if (
                maneuver_node_last_ut is not None
                and float(current_ut) < maneuver_node_last_ut
            ):
                maneuver_node.update(_maneuver_node_state())
                prepared_ejection_token = ""
                prepared_ejection_session = ""
            maneuver_node_last_ut = float(current_ut)
            if (
                transfer_windows_last_ut is not None
                and float(current_ut) < transfer_windows_last_ut
                and transfer_windows["state"] not in {
                    "queued", "paused", "running", "cancelling",
                }
            ):
                transfer_windows.update(_transfer_windows_state())
            transfer_windows_last_ut = float(current_ut)
        mode = result.get("context.mode")
        if (
            mode != identity_mode
            or current_time - identity_last_poll >= CRAFT_IDENTITY_POLL_SECONDS
        ):
            identity_mode = mode
            identity_last_poll = current_time
            identity_cache = _craft_identity(conn, mode)
        result.update(identity_cache)
        active_vessel_guid = str(identity_cache.get("v.guid", ""))
        if (
            maneuver_node["state"] != "idle"
            and (
                mode != "flight"
                or (
                    maneuver_node["vesselGuid"]
                    and active_vessel_guid
                    and maneuver_node["vesselGuid"] != active_vessel_guid
                )
            )
        ):
            maneuver_node.update(_maneuver_node_state())
            prepared_ejection_token = ""
            prepared_ejection_session = ""
        if maneuver_node["state"] == "created":
            created_node_exists = _matching_maneuver_node_exists(
                conn,
                maneuver_node["nodeUT"],
                maneuver_node["deltaV"],
            )
            if created_node_exists is False:
                action_id = maneuver_node["actionId"]
                fingerprint = maneuver_node["fingerprint"]
                vessel_guid = maneuver_node["vesselGuid"]
                node_ut = maneuver_node["nodeUT"]
                if (
                    isinstance(current_ut, (int, float))
                    and not isinstance(current_ut, bool)
                    and math.isfinite(float(current_ut))
                    and float(current_ut) >= (
                        node_ut - MANEUVER_NODE_UT_TOLERANCE_SECONDS
                    )
                ):
                    maneuver_node.update(_maneuver_node_state())
                    maneuver_node.update({
                        "actionId": action_id,
                        "fingerprint": fingerprint,
                        "vesselGuid": vessel_guid,
                        "state": "executed",
                        "nodeUT": node_ut,
                    })
                else:
                    maneuver_node.update(_maneuver_node_state())
                prepared_ejection_token = ""
                prepared_ejection_session = ""
        if catalog_cache:
            result["catalog.bodies"] = list(catalog_cache)
        try:
            planner_for(conn)
        except Exception:
            state["available"] = False
            state["compatibilityReady"] = False
        refresh_transfer_windows(conn)
        refresh_transfer(conn)
        for key, value in state.items():
            result[f"mj.transfer.{key}"] = value
        for key, value in grid.items():
            result[f"mj.transfer.grid.{key}"] = value
        for key, value in evaluation.items():
            result[f"mj.transfer.evaluation.{key}"] = value
        for key, value in maneuver_node.items():
            result[f"mj.transfer.node.{key}"] = value
        for key, value in transfer_windows.items():
            result[f"mj.transfer.windows.{key}"] = value
        return result

    return attach_planning, apply_command


class MissionPlanningController:
    """Own the singleton MechJeb planning worker and its published state."""

    def __init__(self):
        self._attach_planning, self._apply_command = _build_controller()

    def gather(self, connection, mode, universal_time):
        """Return mission-planning fields for one production telemetry frame."""
        return self._attach_planning(
            connection,
            {
                "context.mode": mode,
                "t.universalTime": universal_time,
            },
        )

    def apply_command(self, connection, command):
        """Apply a planning command, returning whether it was recognized."""
        return self._apply_command(connection, command)
