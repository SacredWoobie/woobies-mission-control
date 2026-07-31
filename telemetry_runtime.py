"""Hardened loopback dashboard transport and shared planner persistence."""

from __future__ import annotations

import asyncio
import json
import math
import re
import urllib.parse
import uuid
from http import HTTPStatus

from planner_persistence import PlannerPersistence


PLANNER_COMMAND_TYPES = frozenset(
    {
        "mission.planning.persistence.get",
        "mission.planning.persistence.merge",
        "mission.planning.persistence.update",
    }
)
KRPC_COMMAND_TYPES = frozenset(
    {
        "editor.conditions",
        "overview.vessel.switch",
        "overview.vessel.edit",
        "overview.vessel.lifecycle",
        "notes.select",
        "notes.pin",
        "notes.favorite",
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
    }
)
MAX_COMMAND_BYTES = 2 * 1024 * 1024
MAX_PENDING_COMMANDS = 256
FINGERPRINTED_ASSET = re.compile(r"^.+-[A-Za-z0-9_-]{8,}\.[^.]+$")


def canonical_origin(host, port):
    return f"http://{host}:{int(port)}"


def allowed_host_header(value, host, port):
    return str(value or "").casefold() == f"{host}:{int(port)}".casefold()


def planner_event(store, command):
    """Apply one validated planner command and return its wire event."""
    request_id = command.get("requestId")
    section = command.get("section")
    command_type = command.get("type")
    if not isinstance(request_id, str) or not request_id or len(request_id) > 160:
        raise ValueError("A valid requestId is required.")
    if command_type == "mission.planning.persistence.get":
        result = store.get(section)
    elif command_type == "mission.planning.persistence.merge":
        result = store.merge(section, command.get("incoming"))
    elif command_type == "mission.planning.persistence.update":
        result = store.update(
            section,
            command.get("baseRevision"),
            command.get("value"),
        )
    else:
        raise ValueError("Unsupported planner persistence command.")
    return {
        "type": "mission.planning.persistence.state",
        "requestId": request_id,
        **result,
    }


def _json_safe(value):
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def create_telemetry_runtime(
    original_dashboard_asset,
    connect,
    gather_telemetry,
    apply_command,
    web_root,
    telemetry_hz,
):
    """Build the production asset handler and WebSocket server."""

    def dashboard_asset(request_target, web_root=None):
        if web_root is None:
            result = original_dashboard_asset(request_target)
        else:
            result = original_dashboard_asset(request_target, web_root)
        status, media_type, cache_policy, body = result
        path = urllib.parse.unquote(
            urllib.parse.urlsplit(request_target).path
        ).replace("\\", "/")
        name = path.rsplit("/", 1)[-1]
        if (
            status == HTTPStatus.OK
            and path.startswith("/assets/")
            and FINGERPRINTED_ASSET.fullmatch(name)
        ):
            cache_policy = "public, max-age=31536000, immutable"
        elif status == HTTPStatus.OK:
            cache_policy = "no-cache"
        return status, media_type, cache_policy, body

    def run_telemetry_server(host, port):
        if host != "127.0.0.1":
            print(
                "[telemetry] Mission Control requires the canonical "
                "loopback host 127.0.0.1."
            )
            return False

        try:
            import websockets
            from websockets.datastructures import Headers
            from websockets.http11 import Response
        except ImportError:
            print("[telemetry] 'websockets' not installed -- dashboard feed disabled.")
            print("[telemetry] Install with:  pip install websockets")
            return False

        tconn = connect("KSP Dashboard Telemetry")
        if tconn is None:
            return False
        if not web_root.joinpath("index.html").is_file():
            print(
                "[telemetry] React dashboard files are missing. Expected "
                f"{web_root / 'index.html'}"
            )
            return False

        origin = canonical_origin(host, port)
        websocket_origin = origin.replace("http://", "ws://", 1)
        content_security_policy = (
            "default-src 'self'; "
            f"connect-src 'self' {websocket_origin}; "
            "img-src 'self' data:; "
            "style-src 'self' 'unsafe-inline'; "
            "object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        )
        store = PlannerPersistence()
        clients = set()
        sessions = {}
        send_locks = {}
        commands = asyncio.Queue(maxsize=MAX_PENDING_COMMANDS)

        print(f"[telemetry] dashboard: {origin}/")
        print(f"[telemetry] telemetry: {websocket_origin}/  ({telemetry_hz} Hz)")
        print(f"[telemetry] planner saves: {store.path}")

        def response(status, body, extra_headers=()):
            encoded = body if isinstance(body, bytes) else str(body).encode("utf-8")
            return Response(
                int(status),
                status.phrase,
                Headers(
                    [
                        ("Content-Type", "text/plain; charset=utf-8"),
                        ("Content-Length", str(len(encoded))),
                        ("Cache-Control", "no-store"),
                        ("X-Content-Type-Options", "nosniff"),
                        ("Content-Security-Policy", content_security_policy),
                        ("Referrer-Policy", "no-referrer"),
                    ]
                    + list(extra_headers)
                ),
                encoded,
            )

        def process_request(_connection, request):
            if not allowed_host_header(request.headers.get("Host"), host, port):
                if request.headers.get("Upgrade", "").casefold() == "websocket":
                    return response(HTTPStatus.FORBIDDEN, "Forbidden\n")
                location = f"{origin}{request.path}"
                return response(
                    HTTPStatus.PERMANENT_REDIRECT,
                    "Use the canonical loopback address.\n",
                    (("Location", location),),
                )
            if request.headers.get("Upgrade", "").casefold() == "websocket":
                return None
            status, media_type, cache_policy, body = dashboard_asset(request.path)
            return Response(
                int(status),
                status.phrase,
                Headers(
                    [
                        ("Content-Type", media_type),
                        ("Content-Length", str(len(body))),
                        ("Cache-Control", cache_policy),
                        ("X-Content-Type-Options", "nosniff"),
                        ("Content-Security-Policy", content_security_policy),
                        ("Referrer-Policy", "no-referrer"),
                    ]
                ),
                body,
            )

        async def safe_send(ws, payload):
            if ws not in clients:
                return False
            lock = send_locks.get(ws)
            if lock is None:
                return False
            try:
                async with lock:
                    await ws.send(payload)
                return True
            except Exception:
                return False

        async def broadcast(payload):
            if not clients:
                return
            await asyncio.gather(
                *(safe_send(client, payload) for client in list(clients)),
                return_exceptions=True,
            )

        async def handler(ws, *args):
            session_id = uuid.uuid4().hex
            clients.add(ws)
            sessions[ws] = session_id
            send_locks[ws] = asyncio.Lock()
            loop = asyncio.get_running_loop()
            try:
                async for raw in ws:
                    if not isinstance(raw, str) or len(raw.encode("utf-8")) > MAX_COMMAND_BYTES:
                        continue
                    try:
                        command = json.loads(raw)
                    except (TypeError, ValueError, json.JSONDecodeError):
                        continue
                    if not isinstance(command, dict):
                        continue
                    command_type = command.get("type")
                    if command_type in PLANNER_COMMAND_TYPES:
                        try:
                            event = await loop.run_in_executor(
                                None, planner_event, store, command
                            )
                        except Exception as error:
                            event = {
                                "type": "mission.planning.persistence.state",
                                "requestId": str(command.get("requestId") or ""),
                                "section": str(command.get("section") or ""),
                                "revision": 0,
                                "value": None,
                                "status": "error",
                                "message": str(error),
                            }
                        message = json.dumps(_json_safe(event), allow_nan=False)
                        if (
                            event.get("status") in {"merged", "updated"}
                            and command_type != "mission.planning.persistence.get"
                        ):
                            await broadcast(message)
                        else:
                            await safe_send(ws, message)
                        continue
                    if command_type in KRPC_COMMAND_TYPES:
                        command["_sessionId"] = session_id
                        try:
                            commands.put_nowait((ws, session_id, command))
                        except asyncio.QueueFull:
                            continue
            except Exception:
                pass
            finally:
                clients.discard(ws)
                sessions.pop(ws, None)
                send_locks.pop(ws, None)

        async def broadcaster():
            loop = asyncio.get_running_loop()
            interval = 1.0 / telemetry_hz
            while True:
                try:
                    while True:
                        try:
                            ws, session_id, command = commands.get_nowait()
                        except asyncio.QueueEmpty:
                            break
                        if sessions.get(ws) != session_id:
                            continue
                        event = await loop.run_in_executor(
                            None, apply_command, tconn, command
                        )
                        if isinstance(event, dict):
                            await safe_send(
                                ws,
                                json.dumps(_json_safe(event), allow_nan=False),
                            )
                    if clients:
                        data = await loop.run_in_executor(
                            None, gather_telemetry, tconn
                        )
                        message = json.dumps(_json_safe(data), allow_nan=False)
                        await broadcast(message)
                except Exception:
                    pass
                await asyncio.sleep(interval)

        async def serve():
            async with websockets.serve(
                handler,
                host,
                port,
                process_request=process_request,
                origins=[origin, None],
                max_size=MAX_COMMAND_BYTES,
                max_queue=32,
            ):
                await broadcaster()

        try:
            asyncio.run(serve())
        except Exception as error:
            print(f"[telemetry] server stopped: {error}")
            return False
        return True

    return dashboard_asset, run_telemetry_server
