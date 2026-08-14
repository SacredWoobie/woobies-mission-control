"""Pure dashboard capability contract and bounded installation scan.

The telemetry server owns the transport and supplies a normalised snapshot
dictionary to :func:`build_dashboard_capabilities`.  This module deliberately
has no kRPC or UI dependencies.  Runtime observations are preferred over the
small fixed whitelist scan, while an unobserved provider is never reported as
missing merely because a scene did not expose it.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
TELEMETRY_KEY = "dashboard.capabilities"

FEATURE_IDS = (
    "notes",
    "science_telemetry",
    "science_alarms",
    "communications",
    "stage_analysis",
    "live_transfer_calculations",
    "heat_monitoring",
    "heat_controls",
    "editor_electricity",
    "damage_monitoring",
)
STATUSES = ("available", "fallback", "unavailable", "unknown")
REASONS = (
    "ready",
    "fallback_active",
    "dependency_missing",
    "provider_unavailable",
    "not_observed",
    "scan_unconfigured",
    "probe_error",
)
EVIDENCE_SOURCES = ("runtime", "root_scan")
EVIDENCE_STATUSES = ("active", "detected", "missing", "unavailable", "unknown")

# Only these fixed relative paths are ever inspected.  The values are internal
# implementation details and are never included in the returned contract.
_SCAN_WHITELIST = {
    "notes": (("GameData", "Notes", "Plugins", "PluginData", "notes"), True),
    "wcs": (("GameData", "WoobiesControlStats", "WoobiesControlStats.dll"), False),
    "stage_stats": (("GameData", "KRPC.StageStats", "KRPC.StageStats.dll"), False),
    "system_heat_service": (("GameData", "KRPC.SystemHeat", "KRPC.SystemHeat.dll"), False),
    "system_heat_mod": (("GameData", "SystemHeat", "Plugin", "SystemHeat.dll"), False),
    "woobies_mechjeb": (("GameData", "KRPC.WoobiesMechJeb", "KRPC.WoobiesMechJeb.dll"), False),
    "mechjeb": (("GameData", "MechJeb2", "Plugins", "MechJeb2.dll"), False),
    "remote_tech": (("GameData", "RemoteTech", "RemoteTech.dll"), False),
    "kac": (("GameData", "TriggerTech", "KerbalAlarmClock", "KerbalAlarmClock.dll"), False),
    "dynamic_battery_storage": (("GameData", "DynamicBatteryStorage", "DynamicBatteryStorage.dll"), False),
}

_FEATURE_DEPENDENCIES = {
    "notes": ("notes",),
    "science_telemetry": ("wcs",),
    "science_alarms": ("kac",),
    "communications": ("remote_tech",),
    "stage_analysis": ("stage_stats", "mechjeb"),
    "live_transfer_calculations": ("woobies_mechjeb", "mechjeb"),
    "heat_monitoring": ("system_heat_service", "system_heat_mod"),
    "heat_controls": ("system_heat_service", "system_heat_mod"),
    "editor_electricity": ("dynamic_battery_storage",),
    "damage_monitoring": ("wcs",),
}

_STOCK_FALLBACK_FEATURES = frozenset({
    "science_telemetry",
    "science_alarms",
    "communications",
    "heat_monitoring",
    "editor_electricity",
    "damage_monitoring",
})

_scan_cache: dict[str, dict[str, Any]] = {}


def reset_scan_cache() -> None:
    """Clear the process-local root-scan cache (primarily for tests)."""

    _scan_cache.clear()


def _casefold_child(parent: Path, wanted: str) -> Path | None:
    """Resolve one child by name without exposing directory contents."""

    try:
        for child in parent.iterdir():
            if child.name.casefold() == wanted.casefold():
                return child
    except (OSError, RuntimeError):
        return None
    return None


def _whitelist_target(root: Path, parts: tuple[str, ...]) -> Path | None:
    current = root
    for part in parts:
        current = _casefold_child(current, part)
        if current is None:
            return None
    return current


def _scan_uncached(root: Any) -> dict[str, Any]:
    """Scan only known dependency markers and return sanitised evidence."""

    if not isinstance(root, (str, os.PathLike)) or not str(root).strip():
        return {
            "configured": False,
            "dependencies": {},
            "error": False,
        }
    try:
        resolved = Path(os.path.expandvars(os.fspath(root))).expanduser().resolve()
    except (OSError, RuntimeError, TypeError):
        return {"configured": True, "dependencies": {}, "error": True}
    try:
        game_data = _casefold_child(resolved, "GameData") if resolved.is_dir() else None
        if game_data is None or not game_data.is_dir():
            return {"configured": True, "dependencies": {}, "error": True}
    except OSError:
        return {"configured": True, "dependencies": {}, "error": True}
    try:
        if not resolved.is_dir():
            return {"configured": True, "dependencies": {}, "error": True}
    except OSError:
        return {"configured": True, "dependencies": {}, "error": True}

    dependencies: dict[str, dict[str, str]] = {}
    for dependency, (parts, directory) in _SCAN_WHITELIST.items():
        target = _whitelist_target(resolved, parts)
        present = target is not None
        if present and directory:
            try:
                present = target.is_dir()
            except OSError:
                present = False
        elif present:
            try:
                present = target.is_file()
            except OSError:
                present = False
        dependencies[dependency] = {
            "source": "root_scan",
            "status": "detected" if present else "missing",
        }
    return {
        "configured": True,
        "dependencies": dependencies,
        "error": False,
    }


def scan_root_capabilities(root: Any) -> dict[str, Any]:
    """Return cached, fixed-whitelist dependency evidence for ``root``.

    The returned value contains no paths, hashes, filenames, or raw errors.
    Empty/unusable roots are represented as an unconfigured/error result and
    never trigger a broad filesystem inventory.
    """

    if not isinstance(root, (str, os.PathLike)) or not str(root).strip():
        return _scan_uncached(root)
    try:
        key = os.path.normcase(str(Path(os.path.expandvars(os.fspath(root))).expanduser().resolve()))
    except (OSError, RuntimeError, TypeError):
        return _scan_uncached(root)
    cached = _scan_cache.get(key)
    if cached is None:
        cached = _scan_uncached(root)
        _scan_cache[key] = cached
    return cached


def _clean_version(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if not candidate or len(candidate) > 64:
        return None
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]*", candidate):
        return None
    return candidate


def _evidence(identifier: str, status: str, source: str, version: str | None = None) -> dict[str, str]:
    record = {
        "id": identifier,
        "status": status,
        "source": source,
    }
    if version:
        record["version"] = version
    return record


def _runtime_evidence(telemetry: Mapping[str, Any], feature: str) -> tuple[str, str, list[dict[str, str]]] | None:
    """Map observed telemetry to ``(status, reason, evidence)``."""

    if feature == "notes" and "notes.available" in telemetry:
        active = telemetry.get("notes.available") is True
        status, reason = ("available", "ready") if active else ("unavailable", "provider_unavailable")
        return status, reason, [_evidence("notes", "active" if active else "unavailable", "runtime")]

    if feature == "science_telemetry":
        backend = str(telemetry.get("sci.krpc.backend") or "")
        if backend.casefold() == "vesselscience":
            return "available", "ready", [_evidence("vessel_science", "active", "runtime")]
        if backend:
            return "fallback", "fallback_active", [_evidence("stock_science", "active", "runtime")]
        if telemetry.get("sci.krpc.labTelemetryAvailable") is True:
            return "available", "ready", [_evidence("vessel_science", "active", "runtime")]

    if feature == "science_alarms" and "sci.alarmProviders" in telemetry:
        providers = telemetry.get("sci.alarmProviders")
        if isinstance(providers, Mapping):
            evidence = []
            for identifier in ("kac", "stock"):
                enabled = providers.get(identifier) is True
                evidence.append(_evidence(identifier, "active" if enabled else "unavailable", "runtime"))
            if providers.get("kac") is True:
                status, reason = "available", "ready"
            elif providers.get("stock") is True:
                status, reason = "fallback", "fallback_active"
            else:
                status, reason = "unavailable", "provider_unavailable"
            return status, reason, evidence

    if feature == "communications":
        if telemetry.get("rt.available") is True:
            return "available", "ready", [_evidence("remote_tech", "active", "runtime")]
        if any(key in telemetry for key in ("comm.krpc.canCommunicate", "comm.krpc.signalStrength")):
            return "fallback", "fallback_active", [_evidence("stock_commnet", "active", "runtime")]
        if "rt.available" in telemetry:
            return "unknown", "not_observed", [_evidence("remote_tech", "unavailable", "runtime")]

    if feature == "stage_analysis" and "stage.available" in telemetry:
        if telemetry.get("stage.available") is True:
            return "available", "ready", [_evidence("stage_stats", "active", "runtime")]
        # False means no usable current-vessel sample, not an absent install.
        return "unknown", "not_observed", [_evidence("stage_stats", "unavailable", "runtime")]

    if feature == "live_transfer_calculations" and "mj.transfer.available" in telemetry:
        available = telemetry.get("mj.transfer.available") is True
        compatible = telemetry.get("mj.transfer.compatibilityReady") is True
        evidence = [_evidence("woobies_mechjeb", "active" if available else "unavailable", "runtime")]
        version = _clean_version(telemetry.get("mj.transfer.detectedVersion"))
        target = _clean_version(telemetry.get("mj.transfer.compatibilityTarget"))
        if version:
            evidence.append(_evidence("mechjeb", "detected", "runtime", version))
        if target:
            evidence.append(_evidence("compatibility_target", "detected", "runtime", target))
        if available and compatible:
            return "available", "ready", evidence
        if available and not compatible:
            evidence.append(_evidence("mechjeb", "unavailable", "runtime"))
            return "unavailable", "provider_unavailable", evidence
        return "unknown", "not_observed", evidence

    if feature in {"heat_monitoring", "heat_controls"} and "heat.backend" in telemetry:
        backend = str(telemetry.get("heat.backend") or "").casefold()
        if backend == "system_heat":
            return "available", "ready", [_evidence("system_heat", "active", "runtime")]
        if backend == "stock":
            status = "fallback" if feature == "heat_monitoring" else "unavailable"
            reason = "fallback_active" if status == "fallback" else "provider_unavailable"
            return status, reason, [_evidence("stock_thermal", "active", "runtime")]

    if feature == "editor_electricity" and "editor.elec.backend" in telemetry:
        backend = str(telemetry.get("editor.elec.backend") or "").casefold()
        if backend == "dynamic_battery_storage":
            version = _clean_version(telemetry.get("editor.elec.backendVersion"))
            return "available", "ready", [_evidence("dynamic_battery_storage", "active", "runtime", version)]
        if backend == "stock":
            return "fallback", "fallback_active", [_evidence("stock_electricity", "active", "runtime")]

    if feature == "damage_monitoring" and "damage.source" in telemetry:
        source = str(telemetry.get("damage.source") or "").casefold()
        if source == "vessel_damage":
            return "available", "ready", [_evidence("vessel_damage", "active", "runtime")]
        if source == "stock_krpc":
            return "fallback", "fallback_active", [_evidence("stock_damage", "active", "runtime")]

    return None


def _scan_evidence(scan: Mapping[str, Any], feature: str) -> list[dict[str, str]]:
    dependencies = scan.get("dependencies") if isinstance(scan, Mapping) else None
    if not isinstance(dependencies, Mapping):
        return []
    evidence = []
    for dependency in _FEATURE_DEPENDENCIES.get(feature, ()):
        item = dependencies.get(dependency)
        if not isinstance(item, Mapping):
            continue
        status = item.get("status") if item.get("status") in {"detected", "missing", "unknown"} else "unknown"
        evidence.append(_evidence(dependency, status, "root_scan"))
    return evidence


def build_dashboard_capabilities(
    telemetry: Mapping[str, Any] | None = None,
    scan: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a complete, stable capability snapshot from safe observations."""

    telemetry = telemetry if isinstance(telemetry, Mapping) else {}
    scan = scan if isinstance(scan, Mapping) else {"configured": False, "dependencies": {}}
    configured = scan.get("configured") is True
    scan_error = scan.get("error") is True
    rows: dict[str, dict[str, Any]] = {}
    for feature in FEATURE_IDS:
        runtime = _runtime_evidence(telemetry, feature)
        scan_evidence = _scan_evidence(scan, feature)
        if runtime is not None:
            status, reason, evidence = runtime
            # Runtime evidence outranks scan evidence, but dependency context is
            # retained as expandable evidence.
            evidence = evidence + scan_evidence
            if status == "unknown" and any(item["status"] == "missing" for item in scan_evidence):
                if feature in _STOCK_FALLBACK_FEATURES:
                    status, reason = "fallback", "fallback_active"
                else:
                    status, reason = "unavailable", "dependency_missing"
        elif scan_evidence and configured and not scan_error:
            statuses = {item["status"] for item in scan_evidence}
            if "missing" in statuses:
                if feature in _STOCK_FALLBACK_FEATURES:
                    status, reason = "fallback", "fallback_active"
                else:
                    status, reason = "unavailable", "dependency_missing"
            elif statuses == {"detected"}:
                status, reason = "unknown", "not_observed"
            else:
                status, reason = "unknown", "probe_error"
            evidence = scan_evidence
        else:
            status = "unknown"
            reason = "probe_error" if scan_error else "scan_unconfigured" if not configured else "not_observed"
            evidence = scan_evidence
        rows[feature] = {
            "status": status,
            "reason": reason,
            "evidence": evidence,
        }
    return {
        "schemaVersion": SCHEMA_VERSION,
        "features": rows,
    }


# Concise aliases make parent integration and tests self-documenting without
# adding another contract surface.
build_capabilities = build_dashboard_capabilities
scan_root = scan_root_capabilities
