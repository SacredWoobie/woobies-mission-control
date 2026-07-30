"""Shared, revisioned persistence for Mission Planning browser clients.

The telemetry transport owns client sessions and wire events while this class
owns validation, merging, concurrency, and durable local storage.
"""

from __future__ import annotations

import copy
import json
import math
import os
import shutil
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
MAX_PAYLOAD_BYTES = 2 * 1024 * 1024
MAX_JSON_DEPTH = 64
SECTIONS = ("resonant", "deltaVLibrary", "deltaVDraft")
_LIBRARY_SCHEMA_VERSIONS = {
    "resonant": 4,
    "deltaVLibrary": 2,
}


def default_persistence_path() -> Path:
    """Return the per-user Mission Planning data path."""
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return (
            Path(local_app_data)
            / "WoobiesMissionControl"
            / "mission_planning.json"
        )
    return (
        Path.home()
        / ".woobies-mission-control"
        / "mission_planning.json"
    )


def _default_document() -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "sections": {
            section: {"revision": 0, "value": None}
            for section in SECTIONS
        },
    }


def _is_json_value(
    value: Any,
    seen: set[int] | None = None,
    depth: int = 0,
) -> bool:
    if depth > MAX_JSON_DEPTH:
        return False
    if value is None or isinstance(value, (str, bool, int)):
        return True
    if isinstance(value, float):
        return math.isfinite(value)

    if seen is None:
        seen = set()
    if isinstance(value, (list, dict)):
        identity = id(value)
        if identity in seen:
            return False
        seen.add(identity)
        try:
            if isinstance(value, list):
                return all(
                    _is_json_value(item, seen, depth + 1)
                    for item in value
                )
            return all(
                isinstance(key, str)
                and _is_json_value(item, seen, depth + 1)
                for key, item in value.items()
            )
        finally:
            seen.remove(identity)
    return False


def _record_timestamp(record: dict[str, Any]) -> float:
    value = record.get("updatedAt")
    if not isinstance(value, str) or not value:
        return float("-inf")
    try:
        normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    except (OSError, OverflowError, ValueError):
        return float("-inf")


def _valid_record(record: Any) -> bool:
    return (
        isinstance(record, dict)
        and isinstance(record.get("id"), str)
        and bool(record["id"].strip())
        and isinstance(record.get("updatedAt"), str)
    )


def _merge_records(
    current: list[dict[str, Any]],
    incoming: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge stable-ID records, retaining the newer timestamp for each ID."""
    merged: dict[str, dict[str, Any]] = {}
    order: list[str] = []

    for record in current:
        record_id = record["id"]
        if record_id not in merged:
            order.append(record_id)
            merged[record_id] = copy.deepcopy(record)
        elif _record_timestamp(record) > _record_timestamp(merged[record_id]):
            merged[record_id] = copy.deepcopy(record)

    for record in incoming:
        record_id = record["id"]
        existing = merged.get(record_id)
        if existing is None:
            order.append(record_id)
            merged[record_id] = copy.deepcopy(record)
        elif _record_timestamp(record) > _record_timestamp(existing):
            merged[record_id] = copy.deepcopy(record)

    return [merged[record_id] for record_id in order]


class PlannerPersistence:
    """Thread-safe, optimistic persistence for shared planner state."""

    def __init__(
        self,
        path: str | os.PathLike[str] | None = None,
        *,
        max_payload_bytes: int = MAX_PAYLOAD_BYTES,
    ) -> None:
        self.path = Path(path) if path is not None else default_persistence_path()
        self.backup_path = self.path.with_name(self.path.name + ".bak")
        self.max_payload_bytes = max_payload_bytes
        self._lock = threading.RLock()
        self._load_message = "Initialized empty planner storage."
        self._primary_was_corrupt = False
        self._document = self._load_document()

    def get(self, section: str) -> dict[str, Any]:
        with self._lock:
            if section not in SECTIONS:
                return self._invalid_section_result(section)
            stored = self._document["sections"][section]
            return self._result(
                section,
                stored,
                "ok",
                self._load_message,
            )

    def update(
        self,
        section: str,
        base_revision: int,
        value: dict[str, Any] | None,
    ) -> dict[str, Any]:
        with self._lock:
            if section not in SECTIONS:
                return self._invalid_section_result(section)
            current = self._document["sections"][section]
            if (
                isinstance(base_revision, bool)
                or not isinstance(base_revision, int)
                or base_revision < 0
            ):
                return self._result(
                    section,
                    current,
                    "invalid",
                    "base_revision must be a non-negative integer.",
                )
            if base_revision != current["revision"]:
                return self._result(
                    section,
                    current,
                    "conflict",
                    "The section changed after the supplied base revision.",
                )

            validation_error = self._section_value_error(section, value)
            if validation_error:
                return self._result(
                    section,
                    current,
                    "invalid",
                    validation_error,
                )

            next_section = {
                "revision": current["revision"] + 1,
                "value": copy.deepcopy(value),
            }
            return self._commit_section(
                section,
                next_section,
                "updated",
                "Section updated.",
            )

    def merge(
        self,
        section: str,
        incoming: dict[str, Any] | None,
    ) -> dict[str, Any]:
        with self._lock:
            if section not in SECTIONS:
                return self._invalid_section_result(section)
            current = self._document["sections"][section]
            validation_error = self._section_value_error(section, incoming)
            if validation_error:
                return self._result(
                    section,
                    current,
                    "invalid",
                    validation_error,
                )

            current_value = current["value"]
            if section == "deltaVDraft":
                merged = (
                    copy.deepcopy(current_value)
                    if current_value is not None
                    else copy.deepcopy(incoming)
                )
            else:
                merged = self._merge_library(
                    section,
                    current_value,
                    incoming,
                )

            if merged == current_value:
                return self._result(
                    section,
                    current,
                    "unchanged",
                    "Merge did not change the section.",
                )
            next_section = {
                "revision": current["revision"] + 1,
                "value": merged,
            }
            return self._commit_section(
                section,
                next_section,
                "merged",
                "Section merged.",
            )

    def _load_document(self) -> dict[str, Any]:
        primary, primary_error = self._read_document(self.path)
        if primary is not None:
            self._load_message = "Loaded planner storage."
            return primary

        backup, backup_error = self._read_document(self.backup_path)
        if backup is not None:
            self._primary_was_corrupt = self.path.exists()
            self._load_message = "Recovered planner storage from backup."
            return backup

        self._primary_was_corrupt = self.path.exists()
        if self._primary_was_corrupt:
            details = primary_error or "unknown primary error"
            if self.backup_path.exists():
                details += f"; backup: {backup_error or 'invalid'}"
            self._load_message = (
                "Initialized empty planner storage without overwriting corrupt "
                f"data ({details})."
            )
        return _default_document()

    def _read_document(
        self,
        path: Path,
    ) -> tuple[dict[str, Any] | None, str]:
        if not path.is_file():
            return None, "file is missing"
        try:
            size = path.stat().st_size
            if size > self.max_payload_bytes:
                return None, "payload exceeds the size limit"
            raw = path.read_bytes()
            if len(raw) > self.max_payload_bytes:
                return None, "payload exceeds the size limit"
            document = json.loads(raw.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            return None, str(error)

        validation_error = self._document_error(document)
        if validation_error:
            return None, validation_error
        return document, ""

    def _document_error(self, document: Any) -> str:
        if not isinstance(document, dict):
            return "root must be an object"
        if set(document) != {"schemaVersion", "sections"}:
            return "root keys do not match schema version 1"
        if document.get("schemaVersion") != SCHEMA_VERSION:
            return "unsupported schema version"
        sections = document.get("sections")
        if not isinstance(sections, dict) or set(sections) != set(SECTIONS):
            return "sections do not match schema version 1"
        for section in SECTIONS:
            stored = sections[section]
            if not isinstance(stored, dict) or set(stored) != {
                "revision",
                "value",
            }:
                return f"{section} entry is invalid"
            revision = stored["revision"]
            if (
                isinstance(revision, bool)
                or not isinstance(revision, int)
                or revision < 0
            ):
                return f"{section} revision is invalid"
            validation_error = self._section_value_error(
                section,
                stored["value"],
            )
            if validation_error:
                return validation_error
        return ""

    def _section_value_error(self, section: str, value: Any) -> str:
        if value is not None and not isinstance(value, dict):
            return f"{section} value must be an object or null."
        if not _is_json_value(value):
            return (
                f"{section} value must contain only finite, JSON-serializable "
                "values with string object keys."
            )
        if value is None:
            return ""
        if section in _LIBRARY_SCHEMA_VERSIONS:
            expected = _LIBRARY_SCHEMA_VERSIONS[section]
            if value.get("schemaVersion") != expected:
                return f"{section} requires schemaVersion {expected}."
            plans = value.get("plans")
            if not isinstance(plans, list) or not all(
                _valid_record(record) for record in plans
            ):
                return f"{section} plans require stable IDs and updatedAt."
            if section == "resonant":
                pinned = value.get("pinnedPlanId")
                if pinned is not None and not isinstance(pinned, str):
                    return "resonant pinnedPlanId must be a string or null."
            else:
                assignments = value.get("assignments")
                if not isinstance(assignments, list) or not all(
                    _valid_record(record) for record in assignments
                ):
                    return (
                        "deltaVLibrary assignments require stable IDs and "
                        "updatedAt."
                    )
        elif value.get("schemaVersion") != 1:
            return "deltaVDraft requires schemaVersion 1."

        try:
            encoded = self._encode(value)
        except (TypeError, ValueError) as error:
            return str(error)
        if len(encoded) > self.max_payload_bytes:
            return f"{section} value exceeds the payload size limit."
        return ""

    def _merge_library(
        self,
        section: str,
        current: dict[str, Any] | None,
        incoming: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        if incoming is None:
            return copy.deepcopy(current)
        if current is None:
            return copy.deepcopy(incoming)

        plans = _merge_records(current["plans"], incoming["plans"])
        plan_ids = {record["id"] for record in plans}
        result: dict[str, Any] = {
            **copy.deepcopy(current),
            "schemaVersion": _LIBRARY_SCHEMA_VERSIONS[section],
            "plans": plans,
        }

        if section == "resonant":
            current_pin = current.get("pinnedPlanId")
            incoming_pin = incoming.get("pinnedPlanId")
            if isinstance(current_pin, str) and current_pin in plan_ids:
                result["pinnedPlanId"] = current_pin
            elif isinstance(incoming_pin, str) and incoming_pin in plan_ids:
                result["pinnedPlanId"] = incoming_pin
            else:
                result["pinnedPlanId"] = None
            return result

        assignments = _merge_records(
            current["assignments"],
            incoming["assignments"],
        )
        result["assignments"] = [
            assignment
            for assignment in assignments
            if assignment.get("planId") in plan_ids
        ]
        result["legacyPinned"] = self._valid_legacy_pin(
            current.get("legacyPinned"),
            plan_ids,
        ) or self._valid_legacy_pin(
            incoming.get("legacyPinned"),
            plan_ids,
        )
        return result

    @staticmethod
    def _valid_legacy_pin(
        value: Any,
        plan_ids: set[str],
    ) -> dict[str, Any] | None:
        if (
            isinstance(value, dict)
            and isinstance(value.get("planId"), str)
            and value["planId"] in plan_ids
        ):
            return copy.deepcopy(value)
        return None

    def _commit_section(
        self,
        section: str,
        next_section: dict[str, Any],
        status: str,
        message: str,
    ) -> dict[str, Any]:
        next_document = copy.deepcopy(self._document)
        next_document["sections"][section] = next_section
        try:
            payload = self._encode(next_document)
        except (TypeError, ValueError) as error:
            return self._result(
                section,
                self._document["sections"][section],
                "invalid",
                str(error),
            )
        if len(payload) > self.max_payload_bytes:
            return self._result(
                section,
                self._document["sections"][section],
                "too_large",
                "The complete planner payload exceeds the size limit.",
            )

        try:
            self._write_document(payload)
        except OSError as error:
            return self._result(
                section,
                self._document["sections"][section],
                "error",
                f"Planner storage could not be written: {error}",
            )
        self._document = next_document
        self._primary_was_corrupt = False
        self._load_message = "Loaded planner storage."
        return self._result(section, next_section, status, message)

    def _write_document(self, payload: bytes) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)

        primary, _ = self._read_document(self.path)
        backup, _ = self._read_document(self.backup_path)
        if primary is not None:
            self._atomic_write(self.backup_path, self._encode(primary))
        elif self._primary_was_corrupt and self.path.is_file():
            self._preserve_corrupt_primary()

        self._atomic_write(self.path, payload)
        if primary is None and backup is None:
            self._atomic_write(self.backup_path, payload)

    def _preserve_corrupt_primary(self) -> None:
        candidate = self.path.with_name(self.path.name + ".corrupt")
        suffix = 1
        while candidate.exists():
            candidate = self.path.with_name(
                f"{self.path.name}.corrupt.{suffix}"
            )
            suffix += 1
        shutil.copy2(self.path, candidate)

    @staticmethod
    def _atomic_write(path: Path, payload: bytes) -> None:
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{path.name}.",
            suffix=".tmp",
            dir=path.parent,
        )
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(payload)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            if temporary.exists():
                temporary.unlink()

    @staticmethod
    def _encode(value: Any) -> bytes:
        return json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")

    @staticmethod
    def _result(
        section: str,
        stored: dict[str, Any],
        status: str,
        message: str,
    ) -> dict[str, Any]:
        return {
            "section": section,
            "revision": stored["revision"],
            "value": copy.deepcopy(stored["value"]),
            "status": status,
            "message": message,
        }

    @staticmethod
    def _invalid_section_result(section: str) -> dict[str, Any]:
        return {
            "section": section,
            "revision": 0,
            "value": None,
            "status": "invalid",
            "message": f"Unknown planner section: {section}",
        }
