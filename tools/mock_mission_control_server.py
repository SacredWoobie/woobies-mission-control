"""Serve the production dashboard with deterministic populated telemetry."""

import argparse
import asyncio
import contextlib
import importlib.util
import json
import math
import mimetypes
import sys
import time
import urllib.parse
from http import HTTPStatus
from pathlib import Path

import websockets
from websockets.datastructures import Headers
from websockets.http11 import Response


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_MODULE = ROOT / "scripts" / "mock_telemetry_server.py"
SCENE_ALIASES = {
    "flight": "flight",
    "editor": "editor",
    "vab": "editor",
    "sph": "editor",
    "inactive": "inactive",
    "mission": "inactive",
    "mission-control": "inactive",
}


def load_fixture_module():
    specification = importlib.util.spec_from_file_location(
        "mission_control_mock_fixtures", FIXTURE_MODULE
    )
    if specification is None or specification.loader is None:
        raise RuntimeError(f"Unable to load mock fixtures from {FIXTURE_MODULE}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


FIXTURES = load_fixture_module()
SCENES = FIXTURES.SCENES
NOTE = FIXTURES.NOTE
CHECKLIST = FIXTURES.CHECKLIST


def normalize_scenes(value):
    names = []
    for raw in value.split(","):
        requested = raw.strip().casefold()
        if not requested:
            continue
        canonical = SCENE_ALIASES.get(requested)
        if canonical is None:
            raise ValueError(
                f"Unknown scene '{raw}'. Use flight, editor/VAB, inactive/mission, or a comma-separated list."
            )
        names.append(canonical)
    if not names:
        raise ValueError("At least one mock scene is required.")
    return names


def resolve_web_root(explicit=None):
    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    candidates.extend((ROOT / "web", ROOT / "frontend" / "dist"))
    for candidate in candidates:
        if candidate.joinpath("index.html").is_file():
            return candidate.resolve()
    expected = " or ".join(str(path / "index.html") for path in candidates)
    raise FileNotFoundError(
        "Compiled dashboard files were not found. Run tools\\Build-Frontend.ps1 "
        f"first. Expected {expected}."
    )


def dashboard_asset(request_target, web_root):
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
        "no-cache" if target.name == "index.html"
        else "public, max-age=31536000, immutable"
    )
    return HTTPStatus.OK, media_type, cache_policy, target.read_bytes()


def initial_editor_conditions():
    editor = SCENES["editor"]
    return {
        "body": editor["editor.body"],
        "altitude": editor["editor.altitude"],
        "mach": editor["editor.mach"],
        "revision": editor["editor.revision"],
    }


def initial_note_state():
    return {
        "pinned": NOTE,
        "selected": NOTE,
        "selection_mode": "active",
        "favorite": True,
    }


def build_payload(scene, frame, elapsed, editor_conditions, note_state):
    payload = dict(SCENES[scene])
    payload["notes.pinned"] = note_state["pinned"]
    payload["notes.pinnedPath"] = (
        note_state["pinned"]["relativePath"] if note_state["pinned"] else ""
    )
    payload["notes.selected"] = note_state["selected"]
    payload["notes.selectedPath"] = note_state["selected"]["relativePath"]
    payload["notes.selectionMode"] = note_state["selection_mode"]
    payload["notes.catalog"] = [
        {
            "name": NOTE["name"],
            "relativePath": NOTE["relativePath"],
            "isActiveLog": True,
            "isFavorite": False,
        },
        {
            "name": CHECKLIST["name"],
            "relativePath": CHECKLIST["relativePath"],
            "isActiveLog": False,
            "isFavorite": note_state["favorite"],
        },
    ]

    if scene == "editor":
        payload.update({
            "editor.body": editor_conditions["body"],
            "editor.altitude": editor_conditions["altitude"],
            "editor.mach": editor_conditions["mach"],
            "editor.revision": editor_conditions["revision"],
        })
    elif scene == "flight":
        base = SCENES["flight"]
        payload.update({
            "t.universalTime": base["t.universalTime"] + elapsed,
            "v.missionTime": base["v.missionTime"] + elapsed,
            "v.altitude": base["v.altitude"] + math.sin(frame / 12.0) * 1400.0,
            "v.verticalSpeed": base["v.verticalSpeed"] + math.cos(frame / 12.0) * 18.0,
            "n.heading": (base["n.heading"] + frame * 0.18) % 360.0,
            "heat.backend": "system_heat",
        })

    payload["mock.frame"] = frame + 1
    payload["mock.scene"] = scene
    return payload


async def run(args):
    scene_names = normalize_scenes(args.scenes)
    web_root = resolve_web_root(args.web_root)
    clients = set()

    def process_request(_connection, request):
        if request.headers.get("Upgrade", "").casefold() == "websocket":
            return None
        if urllib.parse.urlsplit(request.path).path == "/__mock/status":
            body = json.dumps({
                "mock": True,
                "scenes": scene_names,
                "hz": args.hz,
                "sceneSeconds": args.scene_seconds,
            }).encode("utf-8")
            status = HTTPStatus.OK
            media_type = "application/json; charset=utf-8"
            cache_policy = "no-store"
        else:
            status, media_type, cache_policy, body = dashboard_asset(
                request.path, web_root
            )
        return Response(
            int(status),
            status.phrase,
            Headers([
                ("Content-Type", media_type),
                ("Content-Length", str(len(body))),
                ("Cache-Control", cache_policy),
                ("X-Content-Type-Options", "nosniff"),
            ]),
            body,
        )

    async def handler(socket):
        clients.add(socket)
        peer = getattr(socket, "remote_address", None)
        print(f"[mock-mission-control] dashboard linked: {peer}", flush=True)
        editor_conditions = initial_editor_conditions()
        note_state = initial_note_state()
        receiver = asyncio.create_task(
            FIXTURES.receive_commands(socket, editor_conditions, note_state)
        )
        started = time.monotonic()
        frame = 0
        last_scene = None
        try:
            while True:
                elapsed = time.monotonic() - started
                scene_index = int(elapsed / args.scene_seconds) % len(scene_names)
                scene = scene_names[scene_index]
                if scene != last_scene:
                    print(f"[mock-mission-control] scene: {scene}", flush=True)
                    last_scene = scene
                payload = build_payload(
                    scene, frame, elapsed, editor_conditions, note_state
                )
                await socket.send(json.dumps(payload))
                frame += 1
                await asyncio.sleep(1.0 / args.hz)
        except websockets.ConnectionClosed:
            pass
        finally:
            receiver.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await receiver
            clients.discard(socket)
            print(f"[mock-mission-control] dashboard disconnected: {peer}", flush=True)

    print(f"[mock-mission-control] dashboard: http://{args.host}:{args.port}/", flush=True)
    print(f"[mock-mission-control] telemetry: ws://{args.host}:{args.port}/", flush=True)
    print(
        f"[mock-mission-control] scenes={','.join(scene_names)} "
        f"hz={args.hz:g} scene_seconds={args.scene_seconds:g}",
        flush=True,
    )
    print(f"[mock-mission-control] web root: {web_root}", flush=True)
    async with websockets.serve(
        handler,
        args.host,
        args.port,
        process_request=process_request,
    ):
        await asyncio.Future()


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--scenes", default="flight,editor,inactive")
    parser.add_argument("--hz", type=float, default=4.0)
    parser.add_argument("--scene-seconds", type=float, default=15.0)
    parser.add_argument("--web-root")
    parser.add_argument("--output-log")
    parser.add_argument("--error-log")
    arguments = parser.parse_args(argv)
    if arguments.hz <= 0:
        parser.error("--hz must be greater than zero")
    if arguments.scene_seconds <= 0:
        parser.error("--scene-seconds must be greater than zero")
    return arguments


def configure_logs(arguments):
    if arguments.output_log:
        sys.stdout = open(arguments.output_log, "a", encoding="utf-8", buffering=1)
    if arguments.error_log:
        sys.stderr = open(arguments.error_log, "a", encoding="utf-8", buffering=1)


if __name__ == "__main__":
    arguments = parse_args()
    configure_logs(arguments)
    try:
        asyncio.run(run(arguments))
    except KeyboardInterrupt:
        print("\n[mock-mission-control] stopped", flush=True)
