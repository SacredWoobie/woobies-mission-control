"""Hardened loopback dashboard transport and shared planner persistence."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import math
import re
import socket
import urllib.parse
import uuid
from contextlib import AsyncExitStack
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
        "science.alarm.create",
        "science.lab.research",
        "science.lab.transmit",
        "overview.vessel.switch",
        "overview.vessel.edit",
        "overview.vessel.lifecycle",
        "reactor.control",
        "heat.loop.control",
        "target.clear",
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
LOOPBACK_NETWORK = ipaddress.ip_network("127.0.0.0/8")
PRIVATE_LAN_NETWORKS = tuple(
    ipaddress.ip_network(cidr)
    for cidr in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
)


def canonical_origin(host, port):
    return f"http://{host}:{int(port)}"


def allowed_host_header(value, host, port):
    return str(value or "").casefold() == f"{host}:{int(port)}".casefold()


def allowed_origin_header(value, host, port):
    """Accept an absent Origin or the exact HTTP origin for one listener."""
    return (
        value is None
        or str(value).casefold() == canonical_origin(host, port).casefold()
    )


def _ipv4_address(value):
    try:
        address = ipaddress.ip_address(str(value))
    except ValueError:
        return None
    return address if isinstance(address, ipaddress.IPv4Address) else None


def is_loopback_address(value):
    address = _ipv4_address(value)
    return address is not None and address in LOOPBACK_NETWORK


def is_private_lan_address(value):
    """Return whether *value* is an RFC1918, non-loopback IPv4 address."""
    address = _ipv4_address(value)
    return address is not None and any(
        address in network for network in PRIVATE_LAN_NETWORKS
    )


def is_local_network_address(value):
    """Return whether *value* is a loopback or private-LAN IPv4 address."""
    return is_loopback_address(value) or is_private_lan_address(value)


def bind_host_allowed(host):
    """Return whether *host* is safe for the dashboard server to bind to."""
    return is_local_network_address(host)


def remote_address_allowed(remote_address, listener_host=None):
    """Validate a peer against the specific listener it reached.

    Without ``listener_host`` this retains the legacy local-network predicate
    for callers that only need a general classification.
    """
    if not remote_address:
        return False
    peer = remote_address[0]
    if listener_host is None:
        return is_local_network_address(peer)
    if is_loopback_address(listener_host):
        return is_loopback_address(peer)
    if is_private_lan_address(listener_host):
        return is_private_lan_address(peer)
    return False


def detect_lan_address(probe_factory=lambda: socket.socket(socket.AF_INET, socket.SOCK_DGRAM)):
    """Best-effort discovery of this machine's LAN-facing private IPv4 address.

    Opens no real connection (UDP, non-routable target) -- only asks the OS
    which local interface it would use. Returns ``None`` if detection fails
    or the resolved address isn't itself private, so callers can fail closed
    to loopback-only.
    """
    try:
        probe = probe_factory()
    except OSError:
        return None
    try:
        probe.settimeout(0.2)
        probe.connect(("10.255.255.255", 1))
        candidate = probe.getsockname()[0]
    except OSError:
        return None
    finally:
        probe.close()
    return candidate if is_private_lan_address(candidate) else None


def detect_lan_addresses(
    route_detector=detect_lan_address,
    hostname_factory=socket.gethostname,
    hostname_resolver=socket.gethostbyname_ex,
):
    """Discover active RFC1918 IPv4 addresses, routed candidate first."""
    candidates = []
    try:
        candidates.append(route_detector())
    except OSError:
        pass
    try:
        _hostname, _aliases, resolved = hostname_resolver(hostname_factory())
        candidates.extend(resolved)
    except (OSError, TypeError, ValueError):
        pass

    result = []
    for candidate in candidates:
        value = str(candidate or "").strip()
        if is_private_lan_address(value) and value not in result:
            result.append(value)
    return tuple(result)


def is_handshake_noise(record):
    """Return whether a ``websockets.server`` log record is routine LAN
    noise from a malformed/incomplete handshake, safe to drop from the log.

    A LAN-facing socket routinely receives non-HTTP traffic (device
    discovery, health-check probes, port scans), and websockets logs a full
    traceback for each one. Filtering on the specific parse-failure
    exception types -- rather than muting the whole logger -- keeps genuine
    handshake and connection-handler errors visible. These connections never
    reach process_request, so nothing is ever disclosed by them; this is
    purely about keeping the log readable.
    """
    if record.getMessage() != "opening handshake failed":
        return False
    exc_type = record.exc_info[0] if record.exc_info else None
    if exc_type is None:
        return False
    if exc_type is EOFError:
        return True
    from websockets.exceptions import InvalidMessage

    return issubclass(exc_type, InvalidMessage)


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

    def run_telemetry_server(host, port, additional_hosts=()):
        if isinstance(additional_hosts, str):
            additional_hosts = (additional_hosts,)
        listener_hosts = []
        for candidate in (host, *tuple(additional_hosts or ())):
            candidate = str(candidate or "").strip()
            if candidate and candidate not in listener_hosts:
                listener_hosts.append(candidate)

        if (
            not listener_hosts
            or listener_hosts[0] != "127.0.0.1"
            or any(not is_private_lan_address(item) for item in listener_hosts[1:])
        ):
            print(
                "[telemetry] Mission Control requires 127.0.0.1 as its primary "
                "listener and only RFC1918 IPv4 addresses as additional listeners."
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

        class _HandshakeNoiseFilter(logging.Filter):
            def filter(self, record):
                return not is_handshake_noise(record)

        logging.getLogger("websockets.server").addFilter(_HandshakeNoiseFilter())

        if not web_root.joinpath("index.html").is_file():
            print(
                "[telemetry] React dashboard files are missing. Expected "
                f"{web_root / 'index.html'}"
            )
            return False

        store = PlannerPersistence()
        clients = set()
        sessions = {}
        send_locks = {}
        commands = asyncio.Queue(maxsize=MAX_PENDING_COMMANDS)

        for listener_host in listener_hosts:
            origin = canonical_origin(listener_host, port)
            websocket_origin = origin.replace("http://", "ws://", 1)
            print(f"[telemetry] dashboard: {origin}/")
            print(f"[telemetry] telemetry: {websocket_origin}/  ({telemetry_hz} Hz)")
            if is_private_lan_address(listener_host):
                print(
                    "[telemetry] WARNING: trusted-LAN access has no authentication "
                    "or encryption and exposes every dashboard command."
                )
        print(f"[telemetry] planner saves: {store.path}")

        def request_processor(listener_host):
            origin = canonical_origin(listener_host, port)
            websocket_origin = origin.replace("http://", "ws://", 1)
            content_security_policy = (
                "default-src 'self'; "
                f"connect-src 'self' {websocket_origin}; "
                "img-src 'self' data:; "
                "style-src 'self' 'unsafe-inline'; "
                "object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
            )

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

            def process_request(connection, request):
                if not remote_address_allowed(
                    getattr(connection, "remote_address", None), listener_host
                ):
                    return response(HTTPStatus.FORBIDDEN, "Forbidden\n")
                if not allowed_host_header(
                    request.headers.get("Host"), listener_host, port
                ):
                    if request.headers.get("Upgrade", "").casefold() == "websocket":
                        return response(HTTPStatus.FORBIDDEN, "Forbidden\n")
                    return response(
                        HTTPStatus.PERMANENT_REDIRECT,
                        "Use the address for this dashboard listener.\n",
                        (("Location", f"{origin}{request.path}"),),
                    )
                if request.headers.get("Upgrade", "").casefold() == "websocket":
                    if not allowed_origin_header(
                        request.headers.get("Origin"), listener_host, port
                    ):
                        return response(HTTPStatus.FORBIDDEN, "Forbidden\n")
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

            return process_request

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

        async def broadcaster(tconn):
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
            async with AsyncExitStack() as stack:
                for listener_host in listener_hosts:
                    origin = canonical_origin(listener_host, port)
                    await stack.enter_async_context(
                        websockets.serve(
                            handler,
                            listener_host,
                            port,
                            process_request=request_processor(listener_host),
                            origins=[origin, None],
                            max_size=MAX_COMMAND_BYTES,
                            max_queue=32,
                        )
                    )
                # Bind both HTTP/WebSocket listeners before the blocking kRPC
                # retry begins. The launcher and local browser can therefore
                # load immediately while KSP is still starting or at its main
                # menu. The existing bounded retry still stops the component
                # if no kRPC connection becomes available.
                loop = asyncio.get_running_loop()
                tconn = await loop.run_in_executor(
                    None, connect, "KSP Dashboard Telemetry"
                )
                if tconn is None:
                    raise RuntimeError("kRPC connection was not available")
                await broadcaster(tconn)

        try:
            asyncio.run(serve())
        except Exception as error:
            print(f"[telemetry] server stopped: {error}")
            return False
        return True

    return dashboard_asset, run_telemetry_server
