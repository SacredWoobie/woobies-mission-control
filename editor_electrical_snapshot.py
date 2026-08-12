"""Strict decoder for the EditorElectrical schema-1 packed snapshot."""

import base64
import math


_HEADER_WIDTH = 15
_COMPONENT_WIDTH = 12  # ``C`` plus the eleven documented fields.
_BODY_WIDTH = 11
_STATES = frozenset({"ready", "warming", "degraded", "empty", "unavailable"})
_BACKENDS = frozenset({"dynamic_battery_storage", "stock"})
_ROLES = frozenset({"producer", "consumer"})
_MAX_COMPONENTS = 4096
_MAX_BODIES = 512
_MAX_TEXT_BYTES = 4096
_MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024


def _text(value, label):
    try:
        decoded = base64.b64decode(value.encode("ascii"), validate=True)
        if len(decoded) > _MAX_TEXT_BYTES:
            raise ValueError("EditorElectrical %s exceeds text bound" % label)
        return decoded.decode("utf-8")
    except Exception as exc:
        raise ValueError("Invalid EditorElectrical %s" % label) from exc


def _integer(value, label, minimum=0):
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid EditorElectrical %s" % label) from exc
    if str(number) != value or number < minimum:
        raise ValueError("Invalid EditorElectrical %s" % label)
    return number


def _integer_text(value, label, minimum=0):
    _integer(value, label, minimum)
    return value


def _number(value, label, minimum=None):
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid EditorElectrical %s" % label) from exc
    if not math.isfinite(number) or (minimum is not None and number < minimum):
        raise ValueError("Invalid EditorElectrical %s" % label)
    return number


def _flag(value, label):
    if value not in ("0", "1"):
        raise ValueError("Invalid EditorElectrical %s" % label)
    return value == "1"


def _rows(payload):
    if isinstance(payload, str):
        if len(payload.encode("utf-8")) > _MAX_SNAPSHOT_BYTES:
            raise ValueError("EditorElectrical snapshot exceeds byte bound")
        rows = payload.splitlines()
    else:
        try:
            rows = list(payload)
        except TypeError as exc:
            raise ValueError("EditorElectrical snapshot is not rows") from exc
    if not rows or any(not isinstance(row, str) or not row for row in rows):
        raise ValueError("EditorElectrical snapshot rows are invalid")
    return [row.split("\t") for row in rows]


def decode_editor_electrical_snapshot(payload):
    """Decode an all-or-nothing WEE1 schema-1 editor snapshot."""
    rows = _rows(payload)
    header = rows[0]
    if len(header) != _HEADER_WIDTH or header[0] != "WEE1":
        raise ValueError("EditorElectrical snapshot header is incompatible")
    if _integer(header[1], "schema") != 1:
        raise ValueError("Unsupported EditorElectrical snapshot schema")
    if header[2] not in _STATES or header[3] not in _BACKENDS:
        raise ValueError("Invalid EditorElectrical state or backend")
    revision = _integer(header[8], "revision")
    current_ec = _number(header[10], "current EC", 0)
    max_ec = _number(header[11], "max EC", 0)
    if current_ec > max_ec:
        raise ValueError("EditorElectrical current EC exceeds maximum")
    component_count = _integer(header[12], "component count")
    body_count = _integer(header[13], "body count")
    if component_count > _MAX_COMPONENTS or body_count > _MAX_BODIES:
        raise ValueError("EditorElectrical snapshot exceeds row bounds")
    if len(rows) != 1 + component_count + body_count:
        raise ValueError("EditorElectrical snapshot count does not match rows")
    if header[2] == "ready" and header[14]:
        raise ValueError("Ready EditorElectrical snapshot is contradictory")

    components = []
    for row in rows[1:1 + component_count]:
        if len(row) != _COMPONENT_WIDTH or row[0] != "C":
            raise ValueError("Invalid EditorElectrical component row")
        if row[6] not in _ROLES:
            raise ValueError("Invalid EditorElectrical component role")
        components.append({
            "stableId": _text(row[1], "component stable id"),
            # The wire token is decimal-only but persistent part IDs are
            # dashboard identity strings, preserving their canonical spelling.
            "partId": _integer_text(row[2], "component part id"),
            "partTitle": _text(row[3], "component part title"),
            "moduleName": _text(row[4], "component module name"),
            "category": _text(row[5], "component category"),
            "role": row[6],
            "referenceEcPerSec": _number(row[7], "component EC rate"),
            "defaultIncluded": _flag(row[8], "component default included"),
            "continuous": _flag(row[9], "component continuous"),
            "solarScaled": _flag(row[10], "component solar scaled"),
            "valueKnown": _flag(row[11], "component value known"),
        })

    bodies = []
    for row in rows[1 + component_count:]:
        if len(row) != _BODY_WIDTH or row[0] != "B":
            raise ValueError("Invalid EditorElectrical body row")
        mu = _number(row[3], "body mu", 0)
        radius = _number(row[4], "body radius", 0)
        rotation = _number(row[5], "body rotation", 0)
        atmosphere = _number(row[6], "body atmosphere", 0)
        soi = _number(row[7], "body SOI", 0)
        max_distance = _number(row[8], "body max star distance", 0)
        luminosity = _number(row[9], "body luminosity", 0)
        bodies.append({"bodyName": _text(row[1], "body name"),
            "starName": _text(row[2], "star name"), "gravitationalParameter": mu,
            "radius": radius, "rotationPeriod": rotation,
            "atmosphereDepth": atmosphere, "sphereOfInfluence": soi,
            "maxStarDistance": max_distance, "luminosityScale": luminosity,
            "authoritative": _flag(row[10], "body authoritative")})
    return {"editor.elec.status": header[2], "editor.elec.backend": header[3],
        "editor.elec.backendVersion": _text(header[4], "backend version"),
        "editor.elec.saveFolder": _text(header[5], "save folder"),
        "editor.elec.craftPersistentId": header[6],
        "editor.elec.rootPartPersistentId": header[7], "editor.elec.revision": revision,
        "editor.elec.fingerprint": header[9], "editor.elec.currentEc": current_ec,
        "editor.elec.maxEc": max_ec, "editor.elec.components": components,
        "editor.elec.bodies": bodies,
        "editor.elec.degradedReason": _text(header[14], "degraded reason")}
