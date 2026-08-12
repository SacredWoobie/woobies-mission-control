"""Verified, crash-recoverable runtime updates for packaged Mission Control.

The module deliberately uses only the Python standard library.  Source
checkouts are not update targets: an eligible installation has a ``Dashboard``
directory beside a generated ``WMC-INSTALL-MANIFEST.json`` at its package root.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import time
import urllib.parse
import urllib.request
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


def _load_runtime_contract():
    path = Path(__file__).resolve().with_name("runtime-update-contract.json")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as exc:
        raise RuntimeError(f"could not load the runtime-update contract: {exc}") from exc
    expected = {
        "schema",
        "limits",
        "root_managed_files",
        "dashboard_contract_path",
        "dashboard_top_level_extensions",
        "dashboard_web_index",
        "dashboard_asset_extensions",
        "service_folders",
        "source_archive_suffix",
    }
    if not isinstance(value, dict) or set(value) != expected or value["schema"] != 1:
        raise RuntimeError("the runtime-update contract schema is invalid")
    limit_keys = {
        "download_bytes",
        "checksum_bytes",
        "archive_entries",
        "archive_file_bytes",
        "archive_expanded_bytes",
        "relative_path_length",
    }
    limits = value["limits"]
    if (
        not isinstance(limits, dict)
        or set(limits) != limit_keys
        or any(
            not isinstance(item, int) or isinstance(item, bool) or item <= 0
            for item in limits.values()
        )
    ):
        raise RuntimeError("the runtime-update contract limits are invalid")
    for key in (
        "root_managed_files",
        "dashboard_top_level_extensions",
        "dashboard_asset_extensions",
        "service_folders",
    ):
        items = value[key]
        if (
            not isinstance(items, list)
            or not items
            or any(not isinstance(item, str) or not item for item in items)
            or len({item.casefold() for item in items}) != len(items)
        ):
            raise RuntimeError(f"the runtime-update contract field {key} is invalid")
    for key in (
        "dashboard_contract_path",
        "dashboard_web_index",
        "source_archive_suffix",
    ):
        if not isinstance(value[key], str) or not value[key]:
            raise RuntimeError(f"the runtime-update contract field {key} is invalid")
    return value


_RUNTIME_CONTRACT = _load_runtime_contract()
_LIMITS = _RUNTIME_CONTRACT["limits"]

INSTALL_MANIFEST_NAME = "WMC-INSTALL-MANIFEST.json"
UPDATE_MANIFEST_NAME = "update-manifest.json"
UPDATE_DIRECTORY_NAME = ".wmc-update"
ACTIVE_TRANSACTION_NAME = "active.json"
TRANSACTION_PLAN_NAME = "plan.json"
TRANSACTION_JOURNAL_NAME = "journal.json"
RESTART_ACK_NAME = "restart-ack.json"
UPDATER_PROTOCOL = 1
RESTART_STABILITY_SECONDS = 1.0

MAX_UPDATE_DOWNLOAD_BYTES = _LIMITS["download_bytes"]
MAX_CHECKSUM_BYTES = _LIMITS["checksum_bytes"]
MAX_RELEASE_NOTES_CHARS = 256 * 1024
MAX_RELEASE_ASSETS = 128
MAX_ARCHIVE_ENTRIES = _LIMITS["archive_entries"]
MAX_ARCHIVE_FILE_BYTES = _LIMITS["archive_file_bytes"]
MAX_ARCHIVE_EXPANDED_BYTES = _LIMITS["archive_expanded_bytes"]
MAX_RELATIVE_PATH_LENGTH = _LIMITS["relative_path_length"]

REPOSITORY_OWNER = "SacredWoobie"
REPOSITORY_NAME = "woobies-mission-control"
GITHUB_API_VERSION = "2026-03-10"
ALLOWED_DOWNLOAD_HOSTS = frozenset(
    {"github.com", "release-assets.githubusercontent.com"}
)

_VERSION_TAG = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")
_SERVICE_VERSION = re.compile(r"^\d+\.\d+\.\d+(?:\.\d+)?$")
_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")
_COMMIT = re.compile(r"^[0-9a-fA-F]{40}$")
_WINDOWS_RESERVED = frozenset(
    {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        *(f"COM{index}" for index in range(1, 10)),
        *(f"LPT{index}" for index in range(1, 10)),
    }
)
_ROOT_MANAGED_FILES = frozenset(_RUNTIME_CONTRACT["root_managed_files"])
_SERVICE_FOLDERS = frozenset(_RUNTIME_CONTRACT["service_folders"])
_UPDATER_CRITICAL_FILES = frozenset(
    {
        "Dashboard/Start KSP Dashboard.bat",
        "Dashboard/ksp_dashboard_app.py",
        "Dashboard/runtime_update.py",
        "Dashboard/runtime_update_helper.py",
        _RUNTIME_CONTRACT["dashboard_contract_path"],
    }
)


class UpdateError(ValueError):
    """Base class for a safe, user-displayable update failure."""


class ReleaseValidationError(UpdateError):
    """The GitHub response or selected assets violated the update contract."""


class ManifestValidationError(UpdateError):
    """An installation or update manifest violated its schema."""


class ArchiveValidationError(UpdateError):
    """An update archive was unsafe, incomplete, or internally inconsistent."""


class InstallationError(UpdateError):
    """The selected package is not eligible for managed updates."""


class TransactionError(UpdateError):
    """A transactional apply, health check, recovery, or rollback failed."""


@dataclass(frozen=True)
class WindowsProcessIdentity:
    """Identity strong enough to distinguish a PID from a later reuse."""

    pid: int
    creation_time: int
    executable: str


@dataclass
class RestartedProcess:
    """Keep the owned subprocess handle alive until commit or rollback."""

    process: subprocess.Popen
    identity: WindowsProcessIdentity | None


def parse_version(value):
    """Return a comparable semantic-release tuple, or ``None``."""
    if not isinstance(value, str):
        return None
    match = _VERSION_TAG.fullmatch(value.strip())
    if match is None:
        return None
    return tuple(int(part) for part in match.groups())


def canonical_version(value):
    parsed = parse_version(value)
    if parsed is None:
        raise ManifestValidationError("versions must use MAJOR.MINOR.PATCH")
    return ".".join(str(part) for part in parsed)


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _atomic_write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def _load_json(path, description):
    if _is_reparse_or_symlink(path):
        raise ManifestValidationError(f"refusing linked {description}")
    try:
        with Path(path).open("r", encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, UnicodeError, ValueError) as exc:
        raise ManifestValidationError(f"could not read {description}: {exc}") from exc


def canonical_relative_path(value):
    """Validate one portable, Windows-safe relative file path."""
    if not isinstance(value, str) or not value:
        raise ManifestValidationError("managed paths must be non-empty strings")
    if len(value) > MAX_RELATIVE_PATH_LENGTH:
        raise ManifestValidationError(f"managed path is too long: {value!r}")
    if "\\" in value or "\x00" in value or ":" in value:
        raise ManifestValidationError(f"managed path uses unsafe characters: {value!r}")
    if any(ord(character) < 32 for character in value):
        raise ManifestValidationError(f"managed path uses control characters: {value!r}")

    path = PurePosixPath(value)
    if path.is_absolute() or value.startswith("/"):
        raise ManifestValidationError(f"managed path must be relative: {value!r}")
    if any(part in {"", ".", ".."} for part in path.parts):
        raise ManifestValidationError(f"managed path contains an unsafe segment: {value!r}")
    for part in path.parts:
        if part.endswith((" ", ".")):
            raise ManifestValidationError(
                f"managed path is ambiguous on Windows: {value!r}"
            )
        stem = part.split(".", 1)[0].upper()
        if stem in _WINDOWS_RESERVED:
            raise ManifestValidationError(
                f"managed path uses a reserved Windows name: {value!r}"
            )
    return path.as_posix()


def _is_allowed_dashboard_path(path):
    parts = PurePosixPath(path).parts
    if len(parts) < 2 or parts[0] != "Dashboard":
        return False
    if any(part.casefold() in {".venv", "__pycache__"} for part in parts):
        return False
    if any(part.casefold().endswith((".log", ".pyc", ".pyo")) for part in parts):
        return False
    if path == _RUNTIME_CONTRACT["dashboard_contract_path"]:
        return True
    if len(parts) == 2:
        suffix = PurePosixPath(parts[-1]).suffix.casefold()
        return suffix in {
            item.casefold()
            for item in _RUNTIME_CONTRACT["dashboard_top_level_extensions"]
        }
    if parts[1] != "web":
        return False
    if path == _RUNTIME_CONTRACT["dashboard_web_index"]:
        return True
    if len(parts) == 4 and parts[2] == "assets":
        return PurePosixPath(parts[3]).suffix.casefold() in {
            item.casefold()
            for item in _RUNTIME_CONTRACT["dashboard_asset_extensions"]
        }
    return False


def is_allowed_managed_path(path):
    """Return whether *path* belongs to the product-managed update surface."""
    try:
        path = canonical_relative_path(path)
    except ManifestValidationError:
        return False
    if path in _ROOT_MANAGED_FILES:
        return True
    if _is_allowed_dashboard_path(path):
        return True
    parts = PurePosixPath(path).parts
    if len(parts) >= 3 and parts[0] == "GameData" and parts[1] in _SERVICE_FOLDERS:
        return True
    if len(parts) == 2 and parts[0] == "SOURCE":
        return parts[1].casefold().endswith(
            _RUNTIME_CONTRACT["source_archive_suffix"].casefold()
        )
    return False


def _validate_hash(value, description):
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
        raise ManifestValidationError(f"{description} must be a SHA-256 digest")
    return value.lower()


def _validate_file_records(records, *, allow_install_manifest=False):
    if not isinstance(records, list) or not records:
        raise ManifestValidationError("manifest files must be a non-empty list")
    normalized = []
    identities = set()
    for record in records:
        if not isinstance(record, dict) or set(record) != {"path", "size", "sha256"}:
            raise ManifestValidationError(
                "each manifest file must contain only path, size, and sha256"
            )
        path = canonical_relative_path(record["path"])
        managed_path = path
        if allow_install_manifest:
            if not path.startswith("payload/"):
                raise ManifestValidationError(
                    f"update payload path must begin with payload/: {path}"
                )
            managed_path = path[len("payload/") :]
        allowed = is_allowed_managed_path(managed_path)
        if allow_install_manifest and managed_path == INSTALL_MANIFEST_NAME:
            allowed = True
        if not allowed:
            raise ManifestValidationError(f"path is outside the managed surface: {path}")
        identity = path.casefold()
        if identity in identities:
            raise ManifestValidationError(
                f"manifest contains a case-insensitive path collision: {path}"
            )
        identities.add(identity)
        size = record["size"]
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise ManifestValidationError(f"invalid file size for {path}")
        if size > MAX_ARCHIVE_FILE_BYTES:
            raise ManifestValidationError(f"managed file is too large: {path}")
        normalized.append(
            {"path": path, "size": size, "sha256": _validate_hash(record["sha256"], path)}
        )
    if normalized != sorted(normalized, key=lambda item: item["path"].casefold()):
        raise ManifestValidationError("manifest file records must be sorted by path")
    return normalized


def _validate_services(records):
    if not isinstance(records, list):
        raise ManifestValidationError("manifest services must be a list")
    normalized = []
    names = set()
    for record in records:
        if not isinstance(record, dict) or set(record) != {"name", "version", "sha256"}:
            raise ManifestValidationError(
                "each service must contain only name, version, and sha256"
            )
        name = record["name"]
        if name not in _SERVICE_FOLDERS or name in names:
            raise ManifestValidationError(f"invalid or duplicate service name: {name!r}")
        names.add(name)
        version = record["version"]
        if not isinstance(version, str) or _SERVICE_VERSION.fullmatch(version) is None:
            raise ManifestValidationError(f"invalid service version for {name}")
        normalized.append(
            {
                "name": name,
                "version": version,
                "sha256": _validate_hash(record["sha256"], name),
            }
        )
    if normalized != sorted(normalized, key=lambda item: item["name"].casefold()):
        raise ManifestValidationError("service records must be sorted by name")
    return normalized


def validate_install_manifest(value):
    """Validate and normalize a generated installation manifest."""
    expected = {
        "schema",
        "product_version",
        "updater_protocol",
        "source_commit",
        "services",
        "files",
    }
    if not isinstance(value, dict) or set(value) != expected:
        raise ManifestValidationError(
            "install manifest must contain the exact schema, version, source, service, and file fields"
        )
    if value["schema"] != 1:
        raise ManifestValidationError("unsupported install-manifest schema")
    protocol = value["updater_protocol"]
    if not isinstance(protocol, int) or isinstance(protocol, bool) or protocol < 1:
        raise ManifestValidationError("invalid updater protocol")
    source_commit = value["source_commit"]
    if not isinstance(source_commit, str) or _COMMIT.fullmatch(source_commit) is None:
        raise ManifestValidationError("install manifest source commit must be a Git commit")
    return {
        "schema": 1,
        "product_version": canonical_version(value["product_version"]),
        "updater_protocol": protocol,
        "source_commit": source_commit.lower(),
        "services": _validate_services(value["services"]),
        "files": _validate_file_records(value["files"]),
    }


def validate_update_manifest(value):
    """Validate and normalize the manifest stored inside an update archive."""
    expected = {
        "schema",
        "product_version",
        "source_commit",
        "compatible_updater_protocols",
        "services",
        "files",
    }
    if not isinstance(value, dict) or set(value) != expected:
        raise ManifestValidationError(
            "update manifest must contain the exact schema, version, source, protocol, service, and file fields"
        )
    if value["schema"] != 1:
        raise ManifestValidationError("unsupported update-manifest schema")
    protocols = value["compatible_updater_protocols"]
    if (
        not isinstance(protocols, list)
        or not protocols
        or any(not isinstance(item, int) or isinstance(item, bool) or item < 1 for item in protocols)
        or protocols != sorted(set(protocols))
    ):
        raise ManifestValidationError("compatible updater protocols must be unique sorted integers")
    source_commit = value["source_commit"]
    if not isinstance(source_commit, str) or _COMMIT.fullmatch(source_commit) is None:
        raise ManifestValidationError("update manifest source commit must be a Git commit")
    return {
        "schema": 1,
        "product_version": canonical_version(value["product_version"]),
        "source_commit": source_commit.lower(),
        "compatible_updater_protocols": protocols,
        "services": _validate_services(value["services"]),
        "files": _validate_file_records(value["files"], allow_install_manifest=True),
    }


def verify_installation_files(root, manifest):
    """Return missing or changed managed files without writing anything."""
    root = Path(root)
    differences = []
    for record in manifest["files"]:
        path = safe_destination(root, record["path"])
        if not path.is_file():
            differences.append({"path": record["path"], "status": "missing"})
            continue
        try:
            size = path.stat().st_size
            digest = sha256_file(path)
        except OSError as exc:
            differences.append(
                {"path": record["path"], "status": "unreadable", "error": str(exc)}
            )
            continue
        if size != record["size"] or digest != record["sha256"]:
            differences.append({"path": record["path"], "status": "modified"})
    return differences


def load_install_manifest(root, *, verify_files=False):
    root = Path(root)
    manifest = validate_install_manifest(
        _load_json(root / INSTALL_MANIFEST_NAME, "installation manifest")
    )
    if verify_files:
        differences = verify_installation_files(root, manifest)
        if differences:
            summary = ", ".join(item["path"] for item in differences[:5])
            raise InstallationError(f"managed installation files do not match: {summary}")
    return manifest


def update_asset_names(version):
    version = canonical_version(version)
    archive = f"Woobies-Mission-Control-v{version}.zz-90-runtime-update.zip"
    return archive, archive + ".sha256"


def _canonical_release_html(tag):
    return (
        f"https://github.com/{REPOSITORY_OWNER}/{REPOSITORY_NAME}/"
        f"releases/tag/{tag}"
    )


def _canonical_asset_url(tag, name):
    return (
        f"https://github.com/{REPOSITORY_OWNER}/{REPOSITORY_NAME}/"
        f"releases/download/{tag}/{urllib.parse.quote(name)}"
    )


def validate_release_payload(payload):
    """Validate the stable GitHub release fields used by the launcher."""
    if not isinstance(payload, dict):
        raise ReleaseValidationError("GitHub returned an invalid release response")
    tag = payload.get("tag_name")
    if parse_version(tag) is None or not isinstance(tag, str):
        raise ReleaseValidationError("the latest release tag is not vMAJOR.MINOR.PATCH")
    tag = tag.strip()
    if tag != f"v{canonical_version(tag)}":
        raise ReleaseValidationError("the latest release tag is not canonical vMAJOR.MINOR.PATCH")
    html_url = payload.get("html_url")
    if html_url != _canonical_release_html(tag):
        raise ReleaseValidationError("the latest release has an unexpected web address")
    if payload.get("draft") is not False or payload.get("prerelease") is not False:
        raise ReleaseValidationError("the latest endpoint returned a non-stable release")
    immutable = payload.get("immutable")
    if not isinstance(immutable, bool):
        raise ReleaseValidationError("GitHub did not report release immutability")
    body = payload.get("body", "")
    if body is None:
        body = ""
    if not isinstance(body, str):
        raise ReleaseValidationError("the latest release notes are invalid")
    if len(body) > MAX_RELEASE_NOTES_CHARS:
        raise ReleaseValidationError("the latest release notes are unexpectedly large")
    assets = payload.get("assets")
    if not isinstance(assets, list) or len(assets) > MAX_RELEASE_ASSETS:
        raise ReleaseValidationError("the latest release assets are invalid")
    normalized_assets = []
    names = set()
    for asset in assets:
        if not isinstance(asset, dict):
            raise ReleaseValidationError("the latest release contains an invalid asset")
        name = asset.get("name")
        size = asset.get("size")
        url = asset.get("browser_download_url")
        digest = asset.get("digest")
        if (
            not isinstance(name, str)
            or not name
            or len(name) > 200
            or "/" in name
            or "\\" in name
            or any(ord(character) < 32 for character in name)
        ):
            raise ReleaseValidationError("a release asset has an invalid name")
        identity = name.casefold()
        if identity in names:
            raise ReleaseValidationError(f"duplicate release asset name: {name}")
        names.add(identity)
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise ReleaseValidationError(f"release asset has an invalid size: {name}")
        if asset.get("state") != "uploaded":
            raise ReleaseValidationError(f"release asset is not fully uploaded: {name}")
        if url != _canonical_asset_url(tag, name):
            raise ReleaseValidationError(f"release asset has an unexpected URL: {name}")
        normalized_digest = None
        if digest is not None:
            if not isinstance(digest, str) or not digest.startswith("sha256:"):
                raise ReleaseValidationError(f"release asset has an invalid digest: {name}")
            normalized_digest = _validate_hash(digest[7:], name)
        normalized_assets.append(
            {
                "name": name,
                "size": size,
                "browser_download_url": url,
                "state": "uploaded",
                "digest": (
                    f"sha256:{normalized_digest}"
                    if normalized_digest is not None
                    else None
                ),
                "sha256": normalized_digest,
            }
        )
    return {
        "tag_name": tag,
        "html_url": html_url,
        "draft": False,
        "prerelease": False,
        "immutable": immutable,
        "body": body,
        "assets": normalized_assets,
    }


def select_update_assets(release):
    """Return the unique, immutable runtime update and checksum assets."""
    if release.get("immutable") is not True:
        raise ReleaseValidationError("the release is mutable and cannot be installed")
    archive_name, checksum_name = update_asset_names(release["tag_name"])
    by_name = {asset["name"]: asset for asset in release["assets"]}
    archive = by_name.get(archive_name)
    checksum = by_name.get(checksum_name)
    if archive is None or checksum is None:
        raise ReleaseValidationError("the release does not include the runtime update and checksum")
    if archive["size"] <= 0 or archive["size"] > MAX_UPDATE_DOWNLOAD_BYTES:
        raise ReleaseValidationError("the runtime update asset has an unsafe size")
    if checksum["size"] <= 0 or checksum["size"] > MAX_CHECKSUM_BYTES:
        raise ReleaseValidationError("the runtime update checksum has an unsafe size")
    if archive["sha256"] is None or checksum["sha256"] is None:
        raise ReleaseValidationError("GitHub did not provide SHA-256 digests for the update assets")
    return archive, checksum


def _validate_final_download_url(value):
    parsed = urllib.parse.urlparse(value)
    try:
        port = parsed.port
    except ValueError as exc:
        raise ReleaseValidationError("the update download used an invalid port") from exc
    if (
        parsed.scheme != "https"
        or parsed.hostname not in ALLOWED_DOWNLOAD_HOSTS
        or port not in {None, 443}
    ):
        raise ReleaseValidationError("the update download redirected to an unexpected host")
    if parsed.username is not None or parsed.password is not None:
        raise ReleaseValidationError("the update download URL contains credentials")


def download_asset(asset, destination, *, opener=urllib.request.urlopen, timeout=30, max_bytes):
    """Stream one canonical release asset with strict length and digest checks."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        asset["browser_download_url"],
        headers={
            "Accept": "application/octet-stream",
            "User-Agent": "Woobies-Mission-Control-Updater/1",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
    )
    temporary = destination.with_name(destination.name + ".part")
    digest = hashlib.sha256()
    total = 0
    try:
        with opener(request, timeout=timeout) as response:
            final_url = (
                response.geturl()
                if callable(getattr(response, "geturl", None))
                else asset["browser_download_url"]
            )
            _validate_final_download_url(final_url)
            headers = getattr(response, "headers", None)
            if headers is not None:
                declared = headers.get("Content-Length")
                if declared is not None:
                    try:
                        declared_size = int(declared)
                    except ValueError as exc:
                        raise ReleaseValidationError("download returned an invalid length") from exc
                    if declared_size != asset["size"] or declared_size > max_bytes:
                        raise ReleaseValidationError("download length does not match release metadata")
            with temporary.open("wb") as stream:
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    total += len(block)
                    if total > max_bytes or total > asset["size"]:
                        raise ReleaseValidationError("download exceeded its declared safe size")
                    digest.update(block)
                    stream.write(block)
                stream.flush()
                os.fsync(stream.fileno())
        if total != asset["size"]:
            raise ReleaseValidationError("download size does not match release metadata")
        if digest.hexdigest() != asset["sha256"]:
            raise ReleaseValidationError("download SHA-256 does not match GitHub metadata")
        os.replace(temporary, destination)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
    return destination


def parse_checksum(text, expected_name):
    if not isinstance(text, str):
        raise ReleaseValidationError("update checksum is not text")
    match = re.fullmatch(r"([0-9a-fA-F]{64})[ \t]+\*?([^\r\n]+)\r?\n?", text)
    if match is None or match.group(2) != expected_name:
        raise ReleaseValidationError("update checksum has an unexpected format or filename")
    return match.group(1).lower()


def download_verified_update(release, cache_directory, *, opener=urllib.request.urlopen):
    """Download both immutable assets and enforce GitHub plus sidecar hashes."""
    archive_asset, checksum_asset = select_update_assets(release)
    cache_directory = Path(cache_directory)
    archive = download_asset(
        archive_asset,
        cache_directory / archive_asset["name"],
        opener=opener,
        max_bytes=MAX_UPDATE_DOWNLOAD_BYTES,
    )
    checksum = download_asset(
        checksum_asset,
        cache_directory / checksum_asset["name"],
        opener=opener,
        max_bytes=MAX_CHECKSUM_BYTES,
    )
    try:
        checksum_text = checksum.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise ReleaseValidationError(f"could not read update checksum: {exc}") from exc
    sidecar_digest = parse_checksum(checksum_text, archive_asset["name"])
    if sidecar_digest != archive_asset["sha256"] or sha256_file(archive) != sidecar_digest:
        raise ReleaseValidationError("update archive does not match its published checksum")
    return archive


def _zip_entry_is_link_or_reparse(info):
    unix_mode = (info.external_attr >> 16) & 0xFFFF
    if unix_mode and stat.S_ISLNK(unix_mode):
        return True
    dos_attributes = info.external_attr & 0xFFFF
    return bool(dos_attributes & 0x0400)


def inspect_update_archive(path):
    """Validate an update ZIP without extracting it and return both manifests."""
    path = Path(path)
    try:
        archive = zipfile.ZipFile(path, "r")
    except (OSError, zipfile.BadZipFile) as exc:
        raise ArchiveValidationError(f"could not open update archive: {exc}") from exc
    with archive:
        infos = archive.infolist()
        if not infos or len(infos) > MAX_ARCHIVE_ENTRIES:
            raise ArchiveValidationError("update archive has an unsafe entry count")
        files = {}
        identities = set()
        expanded = 0
        for info in infos:
            try:
                name = canonical_relative_path(info.filename)
            except ManifestValidationError as exc:
                raise ArchiveValidationError(str(exc)) from exc
            if _zip_entry_is_link_or_reparse(info):
                raise ArchiveValidationError(f"update archive contains a link: {name}")
            if info.flag_bits & 0x1:
                raise ArchiveValidationError(f"update archive contains an encrypted entry: {name}")
            if info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
                raise ArchiveValidationError(
                    f"update archive uses an unsupported compression method: {name}"
                )
            identity = name.casefold().rstrip("/")
            if identity in identities:
                raise ArchiveValidationError(f"update archive contains a path collision: {name}")
            identities.add(identity)
            if info.is_dir():
                continue
            if info.file_size < 0 or info.file_size > MAX_ARCHIVE_FILE_BYTES:
                raise ArchiveValidationError(f"update archive entry is too large: {name}")
            expanded += info.file_size
            if expanded > MAX_ARCHIVE_EXPANDED_BYTES:
                raise ArchiveValidationError("update archive expands beyond its safe limit")
            files[name] = info
        manifest_info = files.get(UPDATE_MANIFEST_NAME)
        if manifest_info is None:
            raise ArchiveValidationError("update archive is missing update-manifest.json")
        try:
            raw_manifest = archive.read(manifest_info)
            if len(raw_manifest) > 1024 * 1024:
                raise ArchiveValidationError("update manifest is too large")
            update_manifest = validate_update_manifest(json.loads(raw_manifest.decode("utf-8")))
        except (UnicodeError, ValueError, ManifestValidationError) as exc:
            raise ArchiveValidationError(f"invalid update manifest: {exc}") from exc

        expected = {UPDATE_MANIFEST_NAME, *(record["path"] for record in update_manifest["files"])}
        if set(files) != expected:
            missing = sorted(expected - set(files))
            extra = sorted(set(files) - expected)
            raise ArchiveValidationError(
                f"update archive contents do not match its manifest; missing={missing}, extra={extra}"
            )
        for record in update_manifest["files"]:
            info = files[record["path"]]
            if info.file_size != record["size"]:
                raise ArchiveValidationError(f"payload size mismatch: {record['path']}")
            digest = hashlib.sha256()
            with archive.open(info, "r") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
            if digest.hexdigest() != record["sha256"]:
                raise ArchiveValidationError(f"payload hash mismatch: {record['path']}")

        install_record_path = f"payload/{INSTALL_MANIFEST_NAME}"
        install_info = files.get(install_record_path)
        if install_info is None:
            raise ArchiveValidationError("update payload is missing its install manifest")
        try:
            install_manifest = validate_install_manifest(
                json.loads(archive.read(install_info).decode("utf-8"))
            )
        except (UnicodeError, ValueError, ManifestValidationError) as exc:
            raise ArchiveValidationError(f"invalid target install manifest: {exc}") from exc
        if (
            install_manifest["product_version"] != update_manifest["product_version"]
            or install_manifest["source_commit"] != update_manifest["source_commit"]
            or install_manifest["services"] != update_manifest["services"]
        ):
            raise ArchiveValidationError("update and target install manifests disagree")
        payload_records = {
            record["path"][len("payload/") :]: {
                "path": record["path"][len("payload/") :],
                "size": record["size"],
                "sha256": record["sha256"],
            }
            for record in update_manifest["files"]
            if record["path"] != install_record_path
        }
        target_records = {record["path"]: record for record in install_manifest["files"]}
        if payload_records != target_records:
            raise ArchiveValidationError("update payload does not exactly match target managed files")
        return update_manifest, install_manifest


def _is_reparse_or_symlink(path):
    try:
        metadata = Path(path).lstat()
    except FileNotFoundError:
        return False
    if stat.S_ISLNK(metadata.st_mode):
        return True
    return bool(getattr(metadata, "st_file_attributes", 0) & 0x0400)


def safe_destination(root, relative_path):
    """Resolve one validated path while rejecting existing link ancestors."""
    relative_path = canonical_relative_path(relative_path)
    root = Path(root).resolve()
    current = root
    for part in PurePosixPath(relative_path).parts:
        current = current / part
        if current.exists() and _is_reparse_or_symlink(current):
            raise InstallationError(f"managed path crosses a link or reparse point: {relative_path}")
    try:
        current.resolve(strict=False).relative_to(root)
    except ValueError as exc:
        raise InstallationError(f"managed path escapes the package: {relative_path}") from exc
    return current


def package_root_from_dashboard(dashboard_directory):
    dashboard = Path(dashboard_directory).resolve()
    if dashboard.name.casefold() != "dashboard":
        return None
    root = dashboard.parent
    if (root / INSTALL_MANIFEST_NAME).is_file():
        return root
    return None


def _validate_package_root_boundary(root):
    root = Path(root).resolve()
    if not root.is_dir():
        raise InstallationError("the Mission Control package folder is unavailable")
    if any(part.casefold() == "gamedata" for part in root.parts):
        raise InstallationError("Mission Control must be moved outside KSP GameData before updating")
    return root


def validate_package_location(root):
    root = _validate_package_root_boundary(root)
    if not (root / "Dashboard" / "ksp_dashboard_app.py").is_file():
        raise InstallationError("the selected folder is not a packaged Mission Control installation")
    return root


def assess_installation(dashboard_directory, current_version):
    """Return read-only updater eligibility for one running launcher."""
    root = package_root_from_dashboard(dashboard_directory)
    if root is None:
        return {
            "eligible": False,
            "reason": "Managed updates are available only in an installed release package.",
            "root": None,
            "manifest": None,
        }
    try:
        validate_package_location(root)
        manifest = load_install_manifest(root)
        if manifest["product_version"] != canonical_version(current_version):
            raise InstallationError("the package manifest version does not match the launcher")
        if manifest["updater_protocol"] != UPDATER_PROTOCOL:
            raise InstallationError("this package uses an unsupported updater protocol")
        managed_paths = {item["path"].casefold() for item in manifest["files"]}
        missing_critical = sorted(
            path for path in _UPDATER_CRITICAL_FILES if path.casefold() not in managed_paths
        )
        if missing_critical:
            raise InstallationError(
                "the package manifest does not own every updater-critical file"
            )
        differences = verify_installation_files(root, manifest)
        critical = [
            item
            for item in differences
            if item["path"].casefold()
            in {path.casefold() for path in _UPDATER_CRITICAL_FILES}
        ]
        if critical:
            raise InstallationError(
                "updater-critical package files were modified or missing"
            )
    except UpdateError as exc:
        return {"eligible": False, "reason": str(exc), "root": root, "manifest": None}
    return {"eligible": True, "reason": "", "root": root, "manifest": manifest}


def assess_release_offer(release, current_version, dashboard_directory):
    """Classify whether a normalized newer release can be installed in-app."""
    current = parse_version(current_version)
    latest = parse_version(release.get("tag_name"))
    if current is None or latest is None:
        return {"installable": False, "reason": "Release versions are invalid."}
    if latest <= current:
        return {
            "installable": False,
            "reason": "The published release is not newer than this launcher.",
        }
    installation = assess_installation(dashboard_directory, current_version)
    if not installation["eligible"]:
        return {"installable": False, "reason": installation["reason"]}
    try:
        archive, checksum = select_update_assets(release)
    except UpdateError as exc:
        return {"installable": False, "reason": str(exc)}
    return {
        "installable": True,
        "reason": "",
        "root": installation["root"],
        "manifest": installation["manifest"],
        "archive_asset": archive,
        "checksum_asset": checksum,
    }


def verify_update_compatibility(current_manifest, update_manifest, target_manifest):
    current = parse_version(current_manifest["product_version"])
    target = parse_version(update_manifest["product_version"])
    if current is None or target is None or target <= current:
        raise InstallationError("the update target must be newer than this installation")
    if current_manifest["updater_protocol"] not in update_manifest["compatible_updater_protocols"]:
        raise InstallationError("this launcher needs a manual full-package update")
    if target_manifest["updater_protocol"] not in update_manifest["compatible_updater_protocols"]:
        raise InstallationError("the target install manifest uses an incompatible updater protocol")
    for description, manifest in (
        ("current", current_manifest),
        ("target", target_manifest),
    ):
        managed_paths = {item["path"].casefold() for item in manifest["files"]}
        missing = sorted(
            path for path in _UPDATER_CRITICAL_FILES if path.casefold() not in managed_paths
        )
        if missing:
            raise InstallationError(
                f"the {description} package is missing updater-critical manifest entries: "
                + ", ".join(missing)
            )


def extract_update_payload(archive_path, stage_root):
    """Validate then extract only declared payload files into a clean stage."""
    update_manifest, install_manifest = inspect_update_archive(archive_path)
    stage_root = Path(stage_root)
    if stage_root.exists():
        raise TransactionError(f"update stage already exists: {stage_root}")
    stage_root.mkdir(parents=True)
    try:
        with zipfile.ZipFile(archive_path, "r") as archive:
            for record in update_manifest["files"]:
                relative = record["path"][len("payload/") :]
                destination = safe_destination(stage_root, relative)
                destination.parent.mkdir(parents=True, exist_ok=True)
                temporary = destination.with_name(destination.name + ".tmp")
                with archive.open(record["path"], "r") as source, temporary.open("wb") as target:
                    shutil.copyfileobj(source, target, 1024 * 1024)
                    target.flush()
                    os.fsync(target.fileno())
                os.replace(temporary, destination)
        for record in install_manifest["files"]:
            destination = safe_destination(stage_root, record["path"])
            if destination.stat().st_size != record["size"] or sha256_file(destination) != record["sha256"]:
                raise TransactionError(f"staged payload verification failed: {record['path']}")
        manifest_path = stage_root / INSTALL_MANIFEST_NAME
        if not manifest_path.is_file():
            raise TransactionError("staged payload is missing its install manifest")
    except Exception:
        shutil.rmtree(stage_root, ignore_errors=True)
        raise
    return update_manifest, install_manifest


def _validate_update_workspace(root, transaction_root=None):
    root = Path(root).resolve()
    candidates = [root / UPDATE_DIRECTORY_NAME, root / UPDATE_DIRECTORY_NAME / "transactions"]
    if transaction_root is not None:
        candidates.append(Path(transaction_root))
    for candidate in candidates:
        if _is_reparse_or_symlink(candidate):
            raise TransactionError("the update workspace contains a link or reparse point")
        if candidate.exists() and not candidate.is_dir():
            raise TransactionError("the update workspace contains a non-directory path")


def _transaction_paths(root, transaction_id=None):
    root = Path(root).resolve()
    update_root = root / UPDATE_DIRECTORY_NAME
    transaction_id = transaction_id or uuid.uuid4().hex
    if not re.fullmatch(r"[0-9a-f]{32}", transaction_id):
        raise TransactionError("invalid update transaction identifier")
    transaction_root = update_root / "transactions" / transaction_id
    _validate_update_workspace(root, transaction_root)
    return {
        "root": root,
        "update_root": update_root,
        "active": update_root / ACTIVE_TRANSACTION_NAME,
        "transaction_id": transaction_id,
        "transaction_root": transaction_root,
        "stage": transaction_root / "stage",
        "backup": transaction_root / "backup",
        "helper": transaction_root / "helper",
        "plan": transaction_root / TRANSACTION_PLAN_NAME,
        "journal": transaction_root / TRANSACTION_JOURNAL_NAME,
        "ack": transaction_root / RESTART_ACK_NAME,
        "log": transaction_root / "update.log",
    }


def _read_active_marker(root):
    root = Path(root).resolve()
    _validate_update_workspace(root)
    path = root / UPDATE_DIRECTORY_NAME / ACTIVE_TRANSACTION_NAME
    if not path.exists():
        return None
    if not path.is_file():
        raise TransactionError("active update marker is not a regular file")
    value = _load_json(path, "active update marker")
    if not isinstance(value, dict) or set(value) != {"schema", "transaction_id"}:
        raise TransactionError("active update marker is invalid")
    if value["schema"] != 1 or not isinstance(value["transaction_id"], str):
        raise TransactionError("active update marker is invalid")
    _transaction_paths(root, value["transaction_id"])
    return value


def pending_update_status(root, transaction_token=None):
    """Return a read-only description of any active update transaction."""
    root = Path(root).resolve()
    try:
        marker = _read_active_marker(root)
    except UpdateError as exc:
        return {"pending": True, "state": "invalid", "message": str(exc)}
    if marker is None:
        return {"pending": False, "state": "none", "message": "No update is pending."}
    paths = _transaction_paths(root, marker["transaction_id"])
    try:
        journal = _load_json(paths["journal"], "update journal")
        state = journal.get("state") if isinstance(journal, dict) else "invalid"
    except UpdateError:
        state = "invalid"
    authorized = transaction_token == marker["transaction_id"] and state in {
        "checking",
        "awaiting_restart",
    }
    return {
        "pending": not authorized,
        "state": state,
        "transaction_id": marker["transaction_id"],
        "message": (
            "The active update may launch its verified target."
            if authorized
            else f"An update transaction needs attention ({state})."
        ),
    }


def _journal(paths, state, **values):
    current = {}
    if paths["journal"].is_file():
        loaded = _load_json(paths["journal"], "update journal")
        if isinstance(loaded, dict):
            current.update(loaded)
    current.update(values)
    current.update(
        {
            "schema": 1,
            "transaction_id": paths["transaction_id"],
            "state": state,
            "updated_at": time.time(),
        }
    )
    _atomic_write_json(paths["journal"], current)
    return current


def stage_transaction(root, archive_path, *, transaction_id=None):
    """Stage and inspect a verified archive without activating an update."""
    root = validate_package_location(root)
    if _read_active_marker(root) is not None:
        raise TransactionError("another update transaction is already active")
    current_manifest = load_install_manifest(root)
    paths = _transaction_paths(root, transaction_id)
    if paths["transaction_root"].exists():
        raise TransactionError("update transaction directory already exists")
    paths["transaction_root"].mkdir(parents=True)
    try:
        update_manifest, target_manifest = extract_update_payload(archive_path, paths["stage"])
        verify_update_compatibility(current_manifest, update_manifest, target_manifest)
        differences = verify_installation_files(root, current_manifest)
        critical = [
            item
            for item in differences
            if item["path"].casefold()
            in {path.casefold() for path in _UPDATER_CRITICAL_FILES}
        ]
        if critical:
            names = ", ".join(item["path"] for item in critical)
            raise InstallationError(
                "updater-critical files were modified or missing; use the full package: "
                + names
            )
        current_identities = {
            item["path"].casefold() for item in current_manifest["files"]
        }
        unmanaged_collisions = []
        for record in target_manifest["files"]:
            if record["path"].casefold() in current_identities:
                continue
            destination = safe_destination(root, record["path"])
            if destination.exists():
                unmanaged_collisions.append(record["path"])
        if unmanaged_collisions:
            raise InstallationError(
                "new managed files conflict with user-owned package paths; "
                "preserve them and use the full package: "
                + ", ".join(unmanaged_collisions[:5])
            )
        plan = {
            "schema": 1,
            "transaction_id": paths["transaction_id"],
            "install_root": str(root),
            "current_manifest": current_manifest,
            "update_manifest": update_manifest,
            "target_manifest": target_manifest,
            "local_differences": differences,
            "created_at": time.time(),
        }
        _atomic_write_json(paths["plan"], plan)
        _journal(paths, "staged", helper_pid=None, launcher_pid=None)
        return {
            "transaction_id": paths["transaction_id"],
            "current_version": current_manifest["product_version"],
            "target_version": target_manifest["product_version"],
            "services": target_manifest["services"],
            "local_differences": differences,
            "transaction_root": paths["transaction_root"],
        }
    except Exception:
        shutil.rmtree(paths["transaction_root"], ignore_errors=True)
        raise


def _validate_plan(paths):
    value = _load_json(paths["plan"], "update transaction plan")
    expected = {
        "schema",
        "transaction_id",
        "install_root",
        "current_manifest",
        "update_manifest",
        "target_manifest",
        "local_differences",
        "created_at",
    }
    if not isinstance(value, dict) or set(value) != expected or value["schema"] != 1:
        raise TransactionError("update transaction plan is invalid")
    if value["transaction_id"] != paths["transaction_id"]:
        raise TransactionError("update transaction identifier does not match its folder")
    if Path(value["install_root"]).resolve() != paths["root"]:
        raise TransactionError("update transaction targets a different installation")
    value["current_manifest"] = validate_install_manifest(value["current_manifest"])
    value["update_manifest"] = validate_update_manifest(value["update_manifest"])
    value["target_manifest"] = validate_install_manifest(value["target_manifest"])
    verify_update_compatibility(
        value["current_manifest"], value["update_manifest"], value["target_manifest"]
    )
    if not isinstance(value["local_differences"], list):
        raise TransactionError("update transaction local-difference list is invalid")
    return value


def activate_transaction(root, transaction_id, *, launcher_pid, python_executable=None):
    """Activate a staged transaction and spawn its trusted external helper."""
    paths = _transaction_paths(root, transaction_id)
    plan = _validate_plan(paths)
    if _read_active_marker(paths["root"]) is not None:
        raise TransactionError("another update transaction is already active")
    journal = _load_json(paths["journal"], "update journal")
    if journal.get("state") not in {"staged", "activation_failed"}:
        raise TransactionError("only a staged update transaction can be activated")
    if not isinstance(launcher_pid, int) or launcher_pid <= 0:
        raise TransactionError("launcher PID is invalid")
    launcher_identity = (
        _windows_process_identity(launcher_pid) if os.name == "nt" else None
    )
    if python_executable is None:
        python_executable = Path(
            paths["root"] / "Dashboard" / ".venv" / "Scripts" / "python.exe"
        )
    python_executable = Path(python_executable).resolve()
    if not python_executable.is_file():
        raise InstallationError("the package-local Python environment is not available")

    live_manifest = load_install_manifest(paths["root"])
    if live_manifest != plan["current_manifest"]:
        raise InstallationError("the installed package changed after update review")
    reviewed_differences = {
        (item.get("path"), item.get("status"))
        for item in plan["local_differences"]
        if isinstance(item, dict)
    }
    live_differences = {
        (item.get("path"), item.get("status"))
        for item in verify_installation_files(paths["root"], live_manifest)
    }
    if live_differences != reviewed_differences:
        raise InstallationError(
            "managed package files changed after update review; verify the update again"
        )

    current_records = {item["path"]: item for item in plan["current_manifest"]["files"]}
    helper_sources = (
        "Dashboard/runtime_update.py",
        "Dashboard/runtime_update_helper.py",
        _RUNTIME_CONTRACT["dashboard_contract_path"],
    )
    command = [
        str(python_executable),
        str(paths["helper"] / "runtime_update_helper.py"),
        "apply",
        str(paths["root"]),
        transaction_id,
        "--launcher-pid",
        str(launcher_pid),
    ]
    creation_flags = 0
    if os.name == "nt":
        creation_flags = 0x00000008 | 0x08000000  # DETACHED_PROCESS | CREATE_NO_WINDOW
    try:
        if paths["helper"].exists():
            shutil.rmtree(paths["helper"])
        paths["helper"].mkdir(parents=True, exist_ok=False)
        for relative in helper_sources:
            record = current_records.get(relative)
            source = safe_destination(paths["root"], relative)
            if record is None or not source.is_file():
                raise InstallationError(f"trusted updater helper is missing: {relative}")
            if (
                source.stat().st_size != record["size"]
                or sha256_file(source) != record["sha256"]
            ):
                raise InstallationError(f"trusted updater helper was modified: {relative}")
            _copy_verified(
                source,
                paths["helper"] / Path(relative).name,
                record["size"],
                record["sha256"],
            )
        _journal(
            paths,
            "activated",
            launcher_pid=launcher_pid,
            launcher_identity=_identity_record(launcher_identity),
            helper_pid=None,
            helper_identity=None,
        )
        _atomic_write_json(
            paths["active"], {"schema": 1, "transaction_id": transaction_id}
        )
        process = subprocess.Popen(
            command,
            cwd=str(paths["helper"]),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            creationflags=creation_flags,
        )
    except Exception:
        try:
            paths["active"].unlink()
        except FileNotFoundError:
            pass
        shutil.rmtree(paths["helper"], ignore_errors=True)
        _journal(paths, "activation_failed")
        raise
    helper_pid = process.pid
    # The child records its own PID and waiting state. Avoid a second parent
    # write to the same atomic journal immediately after process creation.
    if process.returncode is None and os.name == "nt":
        handle = getattr(process, "_handle", None)
        if handle is not None:
            handle.Close()
        process.returncode = 0
    return helper_pid


def _windows_process_api():
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = (
        wintypes.DWORD,
        wintypes.BOOL,
        wintypes.DWORD,
    )
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.GetExitCodeProcess.argtypes = (
        wintypes.HANDLE,
        ctypes.POINTER(wintypes.DWORD),
    )
    kernel32.GetExitCodeProcess.restype = wintypes.BOOL
    kernel32.GetProcessTimes.argtypes = (
        wintypes.HANDLE,
        ctypes.POINTER(wintypes.FILETIME),
        ctypes.POINTER(wintypes.FILETIME),
        ctypes.POINTER(wintypes.FILETIME),
        ctypes.POINTER(wintypes.FILETIME),
    )
    kernel32.GetProcessTimes.restype = wintypes.BOOL
    kernel32.QueryFullProcessImageNameW.argtypes = (
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD),
    )
    kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL
    return ctypes, wintypes, kernel32


def _filetime_value(value):
    return (int(value.dwHighDateTime) << 32) | int(value.dwLowDateTime)


def _windows_process_identity_from_handle(handle, pid):
    ctypes, wintypes, kernel32 = _windows_process_api()
    created = wintypes.FILETIME()
    exited = wintypes.FILETIME()
    kernel = wintypes.FILETIME()
    user = wintypes.FILETIME()
    if not kernel32.GetProcessTimes(
        handle,
        ctypes.byref(created),
        ctypes.byref(exited),
        ctypes.byref(kernel),
        ctypes.byref(user),
    ):
        raise OSError(ctypes.get_last_error(), "could not identify updater process time")
    capacity = wintypes.DWORD(32768)
    buffer = ctypes.create_unicode_buffer(capacity.value)
    if not kernel32.QueryFullProcessImageNameW(
        handle, 0, buffer, ctypes.byref(capacity)
    ):
        raise OSError(ctypes.get_last_error(), "could not identify updater executable")
    return WindowsProcessIdentity(
        pid=pid,
        creation_time=_filetime_value(created),
        executable=str(Path(buffer.value).resolve()).casefold(),
    )


def _open_windows_process(pid):
    ctypes, _wintypes, kernel32 = _windows_process_api()
    handle = kernel32.OpenProcess(0x00100000 | 0x1000, False, pid)
    if not handle:
        error = ctypes.get_last_error()
        if error == 87:  # ERROR_INVALID_PARAMETER: no process owns this PID.
            return None
        raise OSError(error, "could not open updater-owned process")
    return handle


def _windows_process_identity(pid):
    if not isinstance(pid, int) or pid <= 0:
        raise TransactionError("process PID is invalid")
    handle = _open_windows_process(pid)
    if handle is None:
        raise TransactionError("could not securely identify the updater-owned process")
    _ctypes, _wintypes, kernel32 = _windows_process_api()
    try:
        return _windows_process_identity_from_handle(handle, pid)
    finally:
        kernel32.CloseHandle(handle)


def _identity_record(identity):
    if identity is None:
        return None
    return {
        "pid": identity.pid,
        "creation_time": identity.creation_time,
        "executable": identity.executable,
    }


def _parse_identity_record(value, *, description):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {
        "pid",
        "creation_time",
        "executable",
    }:
        raise TransactionError(f"{description} identity is invalid")
    pid = value["pid"]
    creation_time = value["creation_time"]
    executable = value["executable"]
    if (
        not isinstance(pid, int)
        or isinstance(pid, bool)
        or pid <= 0
        or not isinstance(creation_time, int)
        or isinstance(creation_time, bool)
        or creation_time <= 0
        or not isinstance(executable, str)
        or not executable
    ):
        raise TransactionError(f"{description} identity is invalid")
    return WindowsProcessIdentity(pid, creation_time, executable.casefold())


def _pid_is_running(pid, identity=None):
    if not isinstance(pid, int) or pid <= 0:
        return False
    if os.name == "nt":
        handle = _open_windows_process(pid)
        if handle is None:
            return False
        ctypes, wintypes, kernel32 = _windows_process_api()
        try:
            exit_code = wintypes.DWORD()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                raise OSError(ctypes.get_last_error(), "could not inspect process exit")
            if exit_code.value != 259:
                return False
            if identity is not None:
                observed = _windows_process_identity_from_handle(handle, pid)
                if observed != identity:
                    return False
            return True
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _wait_for_pid_exit(pid, timeout, identity=None):
    if os.name == "nt" and identity is not None:
        handle = _open_windows_process(pid)
        if handle is None:
            return
        _ctypes, _wintypes, kernel32 = _windows_process_api()
        try:
            exit_code = _wintypes.DWORD()
            if not kernel32.GetExitCodeProcess(
                handle, _ctypes.byref(exit_code)
            ):
                raise OSError(
                    _ctypes.get_last_error(), "could not inspect launcher exit"
                )
            if exit_code.value != 259:
                return
            observed = _windows_process_identity_from_handle(handle, pid)
            if observed != identity:
                return
            wait_result = kernel32.WaitForSingleObject(handle, int(timeout * 1000))
            if wait_result == 0:
                return
            if wait_result == 0x102:
                raise TransactionError(
                    "the launcher did not exit before the update timeout"
                )
            raise OSError(wait_result, "could not wait for the launcher to exit")
        finally:
            kernel32.CloseHandle(handle)
    deadline = time.monotonic() + timeout
    while _pid_is_running(pid, identity):
        if time.monotonic() >= deadline:
            raise TransactionError("the launcher did not exit before the update timeout")
        time.sleep(0.1)


def _copy_verified(source, destination, expected_size=None, expected_hash=None):
    source = Path(source)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + f".wmc-{uuid.uuid4().hex}.tmp")
    try:
        with source.open("rb") as input_stream, temporary.open("wb") as output_stream:
            shutil.copyfileobj(input_stream, output_stream, 1024 * 1024)
            output_stream.flush()
            os.fsync(output_stream.fileno())
        if expected_size is not None and temporary.stat().st_size != expected_size:
            raise TransactionError(f"copied file size mismatch: {destination}")
        if expected_hash is not None and sha256_file(temporary) != expected_hash:
            raise TransactionError(f"copied file hash mismatch: {destination}")
        os.replace(temporary, destination)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _prepare_backup(paths, plan):
    current_identities = {
        item["path"].casefold() for item in plan["current_manifest"]["files"]
    }
    for record in plan["target_manifest"]["files"]:
        if record["path"].casefold() not in current_identities:
            destination = safe_destination(paths["root"], record["path"])
            if destination.exists():
                raise TransactionError(
                    "a user-owned path appeared after staging: " + record["path"]
                )
    touched = {
        INSTALL_MANIFEST_NAME,
        *(item["path"] for item in plan["current_manifest"]["files"]),
        *(item["path"] for item in plan["target_manifest"]["files"]),
    }
    inventory = []
    paths["backup"].mkdir(parents=True, exist_ok=False)
    for relative in sorted(touched, key=str.casefold):
        source = safe_destination(paths["root"], relative)
        entry = {"path": relative, "existed": source.is_file(), "size": None, "sha256": None}
        if source.exists() and not source.is_file():
            raise TransactionError(f"managed update target is not a file: {relative}")
        if source.is_file():
            entry["size"] = source.stat().st_size
            entry["sha256"] = sha256_file(source)
            backup = safe_destination(paths["backup"], relative)
            _copy_verified(source, backup, entry["size"], entry["sha256"])
        inventory.append(entry)
    _atomic_write_json(paths["transaction_root"] / "backup-inventory.json", inventory)
    _journal(paths, "backed_up", backup_inventory=inventory)
    return inventory


def _load_backup_inventory(paths):
    value = _load_json(paths["transaction_root"] / "backup-inventory.json", "backup inventory")
    if not isinstance(value, list) or not value:
        raise TransactionError("backup inventory is invalid")
    normalized = []
    identities = set()
    for entry in value:
        if not isinstance(entry, dict) or set(entry) != {"path", "existed", "size", "sha256"}:
            raise TransactionError("backup inventory entry is invalid")
        path = canonical_relative_path(entry["path"])
        if path.casefold() in identities:
            raise TransactionError("backup inventory contains a path collision")
        identities.add(path.casefold())
        if not isinstance(entry["existed"], bool):
            raise TransactionError("backup inventory existence flag is invalid")
        if entry["existed"]:
            if not isinstance(entry["size"], int) or entry["size"] < 0:
                raise TransactionError("backup inventory size is invalid")
            digest = _validate_hash(entry["sha256"], path)
        else:
            if entry["size"] is not None or entry["sha256"] is not None:
                raise TransactionError("nonexistent backup entry contains file metadata")
            digest = None
        normalized.append(
            {"path": path, "existed": entry["existed"], "size": entry["size"], "sha256": digest}
        )
    return normalized


def _remove_file_if_present(path):
    path = Path(path)
    try:
        path.unlink()
    except FileNotFoundError:
        return
    except IsADirectoryError as exc:
        raise TransactionError(f"refusing to remove a directory as a managed file: {path}") from exc


def _apply_target(paths, plan):
    target_records = {item["path"]: item for item in plan["target_manifest"]["files"]}
    old_paths = {item["path"] for item in plan["current_manifest"]["files"]}
    _journal(paths, "applying")
    for relative in sorted(target_records, key=str.casefold):
        record = target_records[relative]
        source = safe_destination(paths["stage"], relative)
        destination = safe_destination(paths["root"], relative)
        _copy_verified(source, destination, record["size"], record["sha256"])
    for relative in sorted(old_paths - set(target_records), key=str.casefold):
        _remove_file_if_present(safe_destination(paths["root"], relative))
    differences = verify_installation_files(paths["root"], plan["target_manifest"])
    if differences:
        raise TransactionError(
            "target verification failed: " + ", ".join(item["path"] for item in differences[:5])
        )
    target_manifest_path = safe_destination(paths["stage"], INSTALL_MANIFEST_NAME)
    encoded = target_manifest_path.read_bytes()
    target_manifest_hash = hashlib.sha256(encoded).hexdigest()
    _copy_verified(
        target_manifest_path,
        paths["root"] / INSTALL_MANIFEST_NAME,
        len(encoded),
        target_manifest_hash,
    )
    loaded = load_install_manifest(paths["root"], verify_files=True)
    if loaded != plan["target_manifest"]:
        raise TransactionError("installed manifest does not match the update target")
    _journal(paths, "checking")


def rollback_transaction(root, transaction_id, *, reason="update did not complete"):
    """Restore every touched path to its exact pre-update file state."""
    paths = _transaction_paths(root, transaction_id)
    inventory = _load_backup_inventory(paths)
    errors = []
    _journal(paths, "rolling_back", rollback_reason=reason)
    for entry in inventory:
        try:
            destination = safe_destination(paths["root"], entry["path"])
            if entry["existed"]:
                backup = safe_destination(paths["backup"], entry["path"])
                if (
                    not backup.is_file()
                    or backup.stat().st_size != entry["size"]
                    or sha256_file(backup) != entry["sha256"]
                ):
                    raise TransactionError(f"backup verification failed: {entry['path']}")
                # A locked destination that was never replaced is already a
                # valid rollback result. Avoid rewriting it so recovery can
                # succeed even when another process permits reads but denies
                # replacement/deletion.
                destination_matches = False
                try:
                    destination_matches = (
                        destination.is_file()
                        and destination.stat().st_size == entry["size"]
                        and sha256_file(destination) == entry["sha256"]
                    )
                except OSError:
                    pass
                if not destination_matches:
                    _copy_verified(backup, destination, entry["size"], entry["sha256"])
            else:
                _remove_file_if_present(destination)
        except Exception as exc:
            errors.append(f"{entry['path']}: {exc}")
    if errors:
        _journal(paths, "rollback_failed", rollback_errors=errors)
        raise TransactionError("automatic rollback was incomplete: " + "; ".join(errors))
    _journal(paths, "rolled_back")
    try:
        paths["active"].unlink()
    except FileNotFoundError:
        pass
    return True


def _default_health_check(paths):
    batch = paths["root"] / "Dashboard" / "Start KSP Dashboard.bat"
    environment = os.environ.copy()
    environment["WMC_UPDATE_TRANSACTION"] = paths["transaction_id"]
    command_processor = os.environ.get("COMSPEC", "cmd.exe")
    result = subprocess.run(
        [command_processor, "/d", "/s", "/c", "call", str(batch), "--check"],
        cwd=str(batch.parent),
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=30,
        shell=False,
    )
    if result.returncode != 0:
        raise TransactionError(
            "updated launcher check failed: " + (result.stdout or "").strip()
        )


def _default_restart(paths, timeout=30):
    dashboard = paths["root"] / "Dashboard"
    pythonw = dashboard / ".venv" / "Scripts" / "pythonw.exe"
    python = dashboard / ".venv" / "Scripts" / "python.exe"
    executable = pythonw if pythonw.is_file() else python
    if not executable.is_file():
        raise TransactionError("package-local Python disappeared before restart")
    environment = os.environ.copy()
    environment["WMC_UPDATE_TRANSACTION"] = paths["transaction_id"]
    process = subprocess.Popen(
        [str(executable), str(dashboard / "ksp_dashboard_app.py")],
        cwd=str(dashboard),
        env=environment,
        creationflags=0x08000000 if os.name == "nt" else 0,
    )
    try:
        identity = (
            _windows_process_identity(process.pid) if os.name == "nt" else None
        )
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if paths["ack"].is_file():
                value = _load_json(paths["ack"], "restart acknowledgement")
                if not (
                    isinstance(value, dict)
                    and value.get("schema") == 1
                    and value.get("transaction_id") == paths["transaction_id"]
                ):
                    raise TransactionError(
                        "updated launcher wrote an invalid restart acknowledgement"
                    )
                stability_deadline = time.monotonic() + RESTART_STABILITY_SECONDS
                while time.monotonic() < stability_deadline:
                    code = process.poll()
                    if code is not None:
                        raise TransactionError(
                            "updated launcher exited immediately after startup "
                            f"acknowledgement ({code})"
                        )
                    time.sleep(0.1)
                # Keep the owned process handle until the transaction has
                # committed. If commit fails, rollback can terminate exactly
                # this process without trusting a potentially reused PID.
                return RestartedProcess(process, identity)
            code = process.poll()
            if code is not None:
                raise TransactionError(
                    f"updated launcher exited before startup acknowledgement ({code})"
                )
            time.sleep(0.1)
        raise TransactionError("updated launcher did not acknowledge startup in time")
    except Exception:
        if process.poll() is None:
            try:
                process.terminate()
                process.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    process.kill()
                except OSError:
                    pass
        raise


def _commit_transaction(paths, plan):
    _journal(
        paths,
        "complete",
        completed_at=time.time(),
        previous_version=plan["current_manifest"]["product_version"],
    )
    try:
        paths["active"].unlink()
    except FileNotFoundError:
        pass
    except OSError as exc:
        print(f"Warning: completed update marker could not be removed: {exc}")
    transactions_root = paths["transaction_root"].parent
    for obsolete in transactions_root.iterdir():
        if not obsolete.is_dir() or obsolete == paths["transaction_root"]:
            continue
        journal = obsolete / TRANSACTION_JOURNAL_NAME
        try:
            value = _load_json(journal, "completed update journal")
        except UpdateError:
            continue
        if value.get("state") == "complete":
            try:
                shutil.rmtree(obsolete)
            except OSError as exc:
                print(f"Warning: old update backup could not be pruned: {exc}")
    return paths["backup"]


def _terminate_restarted_process(value):
    if isinstance(value, RestartedProcess):
        value = value.process
    if isinstance(value, subprocess.Popen):
        if value.poll() is None:
            try:
                value.terminate()
                value.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    value.kill()
                except OSError:
                    pass
        return
    # Never signal an integer PID supplied by a custom restart hook. Without a
    # retained handle and creation identity, the PID could belong to a later,
    # unrelated process.


def _release_restarted_process(value):
    if isinstance(value, RestartedProcess):
        value = value.process
    if not isinstance(value, subprocess.Popen):
        return
    value.poll()
    if value.returncode is None and os.name == "nt":
        handle = getattr(value, "_handle", None)
        if handle is not None:
            handle.Close()
        value.returncode = 0


def discard_staged_transaction(root, transaction_id):
    """Remove a never-activated staged transaction after user cancellation."""
    paths = _transaction_paths(root, transaction_id)
    marker = _read_active_marker(paths["root"])
    if marker is not None:
        raise TransactionError("an active update transaction cannot be discarded")
    journal = _load_json(paths["journal"], "update journal")
    if journal.get("state") not in {"staged", "activation_failed"}:
        raise TransactionError("only an unapplied staged transaction can be discarded")
    shutil.rmtree(paths["transaction_root"])


def apply_transaction(
    root,
    transaction_id,
    *,
    launcher_pid=None,
    health_check=None,
    restart=None,
    restart_required=True,
):
    """Apply one activated transaction; rollback deterministically on failure."""
    paths = _transaction_paths(root, transaction_id)
    marker = _read_active_marker(paths["root"])
    if marker is None or marker["transaction_id"] != transaction_id:
        raise TransactionError("update transaction is not active")
    plan = _validate_plan(paths)
    journal = _load_json(paths["journal"], "update journal")
    if launcher_pid is None:
        launcher_pid = journal.get("launcher_pid")
    launcher_identity = _parse_identity_record(
        journal.get("launcher_identity"), description="launcher"
    )
    if os.name == "nt" and launcher_pid is not None and launcher_identity is None:
        raise TransactionError("the activated update has no trusted launcher identity")
    helper_identity = (
        _windows_process_identity(os.getpid()) if os.name == "nt" else None
    )
    _journal(
        paths,
        "waiting_for_launcher_exit",
        helper_pid=os.getpid(),
        helper_identity=_identity_record(helper_identity),
        launcher_pid=launcher_pid,
        launcher_identity=_identity_record(launcher_identity),
    )
    restarted_process = None
    try:
        if launcher_pid is not None:
            _wait_for_pid_exit(launcher_pid, 30, launcher_identity)
        _journal(paths, "backing_up")
        _prepare_backup(paths, plan)
        _apply_target(paths, plan)
        (health_check or _default_health_check)(paths)
        if not restart_required:
            return _commit_transaction(paths, plan)
        _journal(paths, "awaiting_restart")
        restarted_process = (restart or _default_restart)(paths)
        result = _commit_transaction(paths, plan)
        _release_restarted_process(restarted_process)
        return result
    except Exception as exc:
        if restarted_process is not None:
            _terminate_restarted_process(restarted_process)
        journal = _load_json(paths["journal"], "update journal")
        if journal.get("state") in {
            "backed_up",
            "applying",
            "checking",
            "awaiting_restart",
            "rolling_back",
        }:
            rollback_transaction(paths["root"], transaction_id, reason=str(exc))
        else:
            try:
                paths["active"].unlink()
            except FileNotFoundError:
                pass
            _journal(paths, "abandoned", failure=str(exc))
        raise


def recover_pending_update(root):
    """Recover a stale transaction before normal launcher startup."""
    # Recovery cannot depend on the target launcher file being present: an
    # interrupted replacement is exactly the condition this path must repair.
    root = _validate_package_root_boundary(root)
    marker = _read_active_marker(root)
    if marker is None:
        return {"status": "none", "message": "No update recovery is required."}
    paths = _transaction_paths(root, marker["transaction_id"])
    journal = _load_json(paths["journal"], "update journal")
    helper_pid = journal.get("helper_pid")
    helper_identity = _parse_identity_record(
        journal.get("helper_identity"), description="helper"
    )
    updated_at = journal.get("updated_at")
    helper_is_recent = (
        isinstance(updated_at, (int, float))
        and not isinstance(updated_at, bool)
        and 0 <= time.time() - updated_at < 10 * 60
    )
    helper_is_owned = (
        _pid_is_running(helper_pid)
        if os.name != "nt"
        else helper_identity is not None
        and _pid_is_running(helper_pid, helper_identity)
    )
    if helper_is_recent and helper_is_owned:
        return {"status": "busy", "message": "A Mission Control update is still running."}
    state = journal.get("state")
    if state in {
        "backed_up",
        "applying",
        "checking",
        "awaiting_restart",
        "rolling_back",
        "rollback_failed",
    }:
        rollback_transaction(root, marker["transaction_id"], reason="recovered after interruption")
        return {"status": "recovered", "message": "The interrupted update was rolled back."}
    if state in {"activated", "waiting_for_launcher_exit", "backing_up", "staged", "activation_failed"}:
        try:
            paths["active"].unlink()
        except FileNotFoundError:
            pass
        _journal(paths, "abandoned", failure="interrupted before package modification")
        return {"status": "recovered", "message": "The interrupted update was safely abandoned."}
    if state in {"rolled_back", "complete", "abandoned"}:
        try:
            paths["active"].unlink()
        except FileNotFoundError:
            pass
        return {"status": "recovered", "message": f"Cleared completed update state ({state})."}
    raise TransactionError(f"cannot automatically recover update state: {state!r}")


def acknowledge_restart(root, transaction_id):
    """Acknowledge that the updated Tk launcher completed initialization."""
    paths = _transaction_paths(root, transaction_id)
    marker = _read_active_marker(paths["root"])
    if marker is None or marker["transaction_id"] != transaction_id:
        raise TransactionError("restart acknowledgement does not match an active update")
    journal = _load_json(paths["journal"], "update journal")
    if journal.get("state") != "awaiting_restart":
        raise TransactionError("update is not waiting for a restart acknowledgement")
    _atomic_write_json(
        paths["ack"],
        {"schema": 1, "transaction_id": transaction_id, "acknowledged_at": time.time()},
    )
    return True
