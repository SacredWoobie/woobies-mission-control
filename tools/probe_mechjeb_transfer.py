"""Exercise KRPC.WoobiesMechJeb's read-only transfer planner in a live KSP scene.

Start KSP, load a save, ensure the kRPC server is running, then run:

    .venv\\Scripts\\python.exe tools\\probe_mechjeb_transfer.py

The probe does not create maneuver nodes or modify the editor craft.
"""

import argparse
import json
import math
import sys
import time

import krpc


TERMINAL_STATES = {"completed", "cancelled", "failed"}


def _scene_name(conn):
    value = str(conn.krpc.current_game_scene)
    return value.rsplit(".", 1)[-1].lower()


def _emit(event, **values):
    print(json.dumps({"event": event, **values}, sort_keys=True), flush=True)


def _finite_positive(value):
    return math.isfinite(value) and value > 0


def _wait_for_result(planner, timeout, cancel_after):
    started = time.monotonic()
    last_progress = None
    cancel_sent = False

    while True:
        state = str(planner.state).lower()
        progress = int(planner.progress)
        if progress != last_progress:
            _emit("progress", state=state, progress=progress)
            last_progress = progress

        elapsed = time.monotonic() - started
        if cancel_after is not None and not cancel_sent and elapsed >= cancel_after:
            planner.cancel()
            cancel_sent = True
            _emit("cancel_requested", elapsed=round(elapsed, 3))

        if state in TERMINAL_STATES:
            return state
        if elapsed >= timeout:
            raise TimeoutError(
                f"transfer calculation did not finish within {timeout:g} seconds"
            )
        time.sleep(0.25)


def _validate_result(planner, capture):
    result = {
        "origin": str(planner.origin_body),
        "destination": str(planner.destination_body),
        "parkingAltitude": float(planner.parking_altitude),
        "includeCapture": bool(planner.include_capture_burn),
        "departureUT": float(planner.best_departure_ut),
        "arrivalUT": float(planner.best_arrival_ut),
        "transferTime": float(planner.best_transfer_time),
        "ejectionDeltaV": float(planner.best_ejection_delta_v),
        "captureDeltaV": float(planner.best_capture_delta_v),
        "totalDeltaV": float(planner.best_total_delta_v),
        "dateSamples": int(planner.date_samples),
        "durationSamples": int(planner.duration_samples),
    }

    problems = []
    for key in (
        "departureUT",
        "arrivalUT",
        "transferTime",
        "ejectionDeltaV",
        "totalDeltaV",
    ):
        if not _finite_positive(result[key]):
            problems.append(f"{key} is not finite and positive")
    if result["arrivalUT"] <= result["departureUT"]:
        problems.append("arrivalUT is not after departureUT")
    if capture and not _finite_positive(result["captureDeltaV"]):
        problems.append("captureDeltaV is not finite and positive")

    expected_total = result["ejectionDeltaV"]
    if capture:
        expected_total += result["captureDeltaV"]
    tolerance = max(1.0, expected_total * 0.002)
    if abs(result["totalDeltaV"] - expected_total) > tolerance:
        problems.append(
            "totalDeltaV differs from the reported leg sum by more than "
            f"{tolerance:.3f} m/s"
        )

    _emit("result", **result, problems=problems)
    return not problems


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Run a live, read-only WoobiesMechJeb transfer calculation."
    )
    parser.add_argument("--origin", default="Kerbin")
    parser.add_argument("--destination", default="Duna")
    parser.add_argument(
        "--parking-altitude",
        type=float,
        default=80_000.0,
        help="origin parking altitude in metres (default: 80000)",
    )
    parser.add_argument(
        "--capture",
        action="store_true",
        help="include destination capture delta-v in grid optimization",
    )
    parser.add_argument(
        "--cancel-after",
        type=float,
        help="request cancellation after this many seconds instead of validating a result",
    )
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument(
        "--require-editor",
        action="store_true",
        help="require VAB/SPH when specifically testing editor-scene availability",
    )
    args = parser.parse_args(argv)
    if args.parking_altitude < 0 or args.timeout <= 0:
        parser.error("parking altitude must be non-negative and timeout positive")
    if args.cancel_after is not None and args.cancel_after < 0:
        parser.error("cancel-after must be non-negative")

    conn = None
    try:
        _emit("connecting")
        conn = krpc.connect(name="WoobiesMechJeb transfer planner probe")
        scene = _scene_name(conn)
        _emit("connected", scene=scene)
        if args.require_editor and scene not in {"vab", "sph"}:
            raise RuntimeError(
                f"current scene is {scene!r}; enter the VAB or SPH and run the probe again"
            )

        service = conn.mech_jeb
        planner = service.transfer_planner
        available = bool(planner.available)
        detected = str(planner.detected_mech_jeb_version)
        target = str(planner.compatibility_target)
        service_status = {
            "flightApiReady": bool(service.api_ready),
            "plannerAvailable": available,
            "detectedMechJebVersion": detected,
            "compatibilityTarget": target,
        }
        try:
            service_status["typeCompatibilityReady"] = bool(
                service.type_compatibility_ready
            )
            service_status["legacyAscentAvailable"] = bool(
                service.legacy_ascent_available
            )
        except AttributeError:
            # WoobiesMechJeb 0.8.0 and earlier did not expose the distinction.
            pass
        _emit("service", **service_status)
        if not available:
            raise RuntimeError("transfer planner reflection contract is unavailable")
        if service_status.get("typeCompatibilityReady") is False:
            raise RuntimeError("a required MechJeb reflection contract is unavailable")
        if detected != target:
            raise RuntimeError(
                f"detected MechJeb {detected}, but the bridge targets {target}"
            )

        initial_state = str(planner.state).lower()
        if initial_state in {"running", "cancelling"}:
            raise RuntimeError(f"planner is unexpectedly busy: {initial_state}")

        _emit(
            "starting",
            origin=args.origin,
            destination=args.destination,
            parkingAltitude=args.parking_altitude,
            capture=args.capture,
        )
        planner.start_automatic(
            args.origin,
            args.destination,
            args.parking_altitude,
            args.capture,
        )
        state = _wait_for_result(planner, args.timeout, args.cancel_after)
        if args.cancel_after is not None:
            if state != "cancelled":
                raise RuntimeError(f"expected cancelled state, received {state}")
            _emit("pass", check="cancellation")
            return 0
        if state == "failed":
            raise RuntimeError(f"planner failed: {planner.error}")
        if state != "completed":
            raise RuntimeError(f"expected completed state, received {state}")
        if not _validate_result(planner, args.capture):
            return 2
        _emit("pass", check="transfer")
        return 0
    except Exception as exc:
        _emit("fail", error=type(exc).__name__, message=str(exc))
        return 1
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
