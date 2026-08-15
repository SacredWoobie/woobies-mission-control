import hashlib
import io
import json
import os
import stat
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path
from unittest import mock

import runtime_update as update


CONTRACT_BYTES = Path(update.__file__).with_name("runtime-update-contract.json").read_bytes()


def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()


def file_record(path, value):
    return {"path": path, "size": len(value), "sha256": digest_bytes(value)}


def install_manifest(version, commit, files, protocol=1, services=None):
    records = [file_record(path, value) for path, value in files.items()]
    return {
        "schema": 1,
        "product_version": version,
        "updater_protocol": protocol,
        "source_commit": commit,
        "services": services or [],
        "files": sorted(records, key=lambda item: item["path"].casefold()),
    }


def write_installation(root, version="1.0.0", commit="a" * 40, files=None):
    root = Path(root)
    files = files or {
        "Dashboard/ksp_dashboard_app.py": b"old launcher\n",
        "Dashboard/runtime_update.py": b"old update module\n",
        "Dashboard/runtime_update_helper.py": b"old helper\n",
        "Dashboard/runtime-update-contract.json": CONTRACT_BYTES,
        "Dashboard/Start KSP Dashboard.bat": b"old batch\r\n",
        "Dashboard/web/index.html": b"old index\n",
    }
    for relative, value in files.items():
        path = root / Path(relative)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value)
    manifest = install_manifest(version, commit, files)
    (root / update.INSTALL_MANIFEST_NAME).write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return manifest, files


def make_update_archive(path, target_manifest, target_files, *, update_manifest_changes=None):
    install_bytes = (
        json.dumps(target_manifest, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    payload = {
        **{f"payload/{name}": value for name, value in target_files.items()},
        f"payload/{update.INSTALL_MANIFEST_NAME}": install_bytes,
    }
    update_manifest = {
        "schema": 1,
        "product_version": target_manifest["product_version"],
        "source_commit": target_manifest["source_commit"],
        "compatible_updater_protocols": [1],
        "services": target_manifest["services"],
        "files": sorted(
            (file_record(name, value) for name, value in payload.items()),
            key=lambda item: item["path"].casefold(),
        ),
    }
    if update_manifest_changes:
        update_manifest.update(update_manifest_changes)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            update.UPDATE_MANIFEST_NAME,
            json.dumps(update_manifest, indent=2, sort_keys=True) + "\n",
        )
        for name, value in payload.items():
            archive.writestr(name, value)
    return update_manifest


def activate_staged_for_test(root, transaction_id):
    paths = update._transaction_paths(root, transaction_id)
    update._atomic_write_json(
        paths["active"], {"schema": 1, "transaction_id": transaction_id}
    )
    update._journal(paths, "activated", launcher_pid=None, helper_pid=None)
    return paths


class ReleaseValidationTests(unittest.TestCase):
    def valid_payload(self, version="1.1.0", immutable=True):
        tag = f"v{version}"
        archive_name, checksum_name = update.update_asset_names(version)
        return {
            "tag_name": tag,
            "html_url": (
                "https://github.com/SacredWoobie/"
                f"woobies-mission-control/releases/tag/{tag}"
            ),
            "draft": False,
            "prerelease": False,
            "immutable": immutable,
            "body": "Release notes",
            "assets": [
                {
                    "name": archive_name,
                    "size": 100,
                    "state": "uploaded",
                    "digest": "sha256:" + "a" * 64,
                    "browser_download_url": (
                        "https://github.com/SacredWoobie/woobies-mission-control/"
                        f"releases/download/{tag}/{archive_name}"
                    ),
                },
                {
                    "name": checksum_name,
                    "size": 103,
                    "state": "uploaded",
                    "digest": "sha256:" + "b" * 64,
                    "browser_download_url": (
                        "https://github.com/SacredWoobie/woobies-mission-control/"
                        f"releases/download/{tag}/{checksum_name}"
                    ),
                },
            ],
        }

    def test_accepts_exact_immutable_stable_release_assets(self):
        release = update.validate_release_payload(self.valid_payload())
        archive, checksum = update.select_update_assets(release)
        self.assertTrue(release["immutable"])
        self.assertTrue(archive["name"].endswith("runtime-update.zip"))
        self.assertTrue(checksum["name"].endswith("runtime-update.zip.sha256"))

        # The normalized value is safe to persist for display and can be
        # validated again without dropping the API digests.
        cached = update.validate_release_payload(release)
        cached_archive, _cached_checksum = update.select_update_assets(cached)
        self.assertEqual(cached_archive["sha256"], "a" * 64)

    def test_mutable_release_remains_readable_but_not_installable(self):
        release = update.validate_release_payload(self.valid_payload(immutable=False))
        with self.assertRaisesRegex(update.ReleaseValidationError, "mutable"):
            update.select_update_assets(release)

    def test_first_updater_release_can_report_current_without_fake_successor(self):
        release = update.validate_release_payload(
            self.valid_payload(version="1.0.0", immutable=True)
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            dashboard = root / "Dashboard"
            write_installation(root, version="1.0.0")
            offer = update.assess_release_offer(release, "1.0.0", dashboard)
        self.assertFalse(offer["installable"])
        self.assertIn("not newer", offer["reason"])

    def test_rejects_prerelease_wrong_owner_and_duplicate_asset_names(self):
        payload = self.valid_payload()
        payload["prerelease"] = True
        with self.assertRaises(update.ReleaseValidationError):
            update.validate_release_payload(payload)

        payload = self.valid_payload()
        payload["html_url"] = payload["html_url"].replace("SacredWoobie", "attacker")
        with self.assertRaises(update.ReleaseValidationError):
            update.validate_release_payload(payload)

        payload = self.valid_payload()
        payload["assets"].append(dict(payload["assets"][0]))
        with self.assertRaisesRegex(update.ReleaseValidationError, "duplicate"):
            update.validate_release_payload(payload)

    def test_rejects_noncanonical_tag_and_unfinished_asset(self):
        payload = self.valid_payload()
        payload["tag_name"] = "v01.1.0"
        payload["html_url"] = payload["html_url"].replace("v1.1.0", "v01.1.0")
        for asset in payload["assets"]:
            asset["browser_download_url"] = asset["browser_download_url"].replace(
                "v1.1.0", "v01.1.0"
            )
        with self.assertRaisesRegex(update.ReleaseValidationError, "canonical"):
            update.validate_release_payload(payload)

        payload = self.valid_payload()
        payload["assets"][0]["state"] = "starter"
        with self.assertRaisesRegex(update.ReleaseValidationError, "fully uploaded"):
            update.validate_release_payload(payload)

    def test_download_requires_api_digest_sidecar_and_exact_sizes(self):
        archive_bytes = b"verified update bytes"
        archive_name, checksum_name = update.update_asset_names("1.1.0")
        checksum_bytes = f"{digest_bytes(archive_bytes)}  {archive_name}\n".encode()
        payload = self.valid_payload()
        payload["assets"][0]["size"] = len(archive_bytes)
        payload["assets"][0]["digest"] = "sha256:" + digest_bytes(archive_bytes)
        payload["assets"][1]["size"] = len(checksum_bytes)
        payload["assets"][1]["digest"] = "sha256:" + digest_bytes(checksum_bytes)
        release = update.validate_release_payload(payload)

        responses = {
            archive_name: archive_bytes,
            checksum_name: checksum_bytes,
        }

        class Response(io.BytesIO):
            def __init__(self, value, url):
                super().__init__(value)
                self._url = url
                self.headers = {"Content-Length": str(len(value))}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                self.close()
                return False

            def geturl(self):
                return self._url

        def opener(request, timeout):
            del timeout
            name = request.full_url.rsplit("/", 1)[-1]
            self.assertIn(name, responses)
            return Response(responses[name], request.full_url)

        with tempfile.TemporaryDirectory() as directory:
            path = update.download_verified_update(release, directory, opener=opener)
            self.assertEqual(path.read_bytes(), archive_bytes)

            responses[checksum_name] = (
                f"{'0' * 64}  {archive_name}\n".encode()
            )
            release["assets"][1]["size"] = len(responses[checksum_name])
            release["assets"][1]["sha256"] = digest_bytes(responses[checksum_name])
            with self.assertRaisesRegex(update.ReleaseValidationError, "published checksum"):
                update.download_verified_update(release, directory, opener=opener)

            def off_host_opener(request, timeout):
                del timeout
                name = request.full_url.rsplit("/", 1)[-1]
                return Response(responses[name], "https://attacker.example/payload")

            with self.assertRaisesRegex(update.ReleaseValidationError, "unexpected host"):
                update.download_verified_update(
                    release, directory, opener=off_host_opener
                )


class ManifestAndArchiveTests(unittest.TestCase):
    def test_managed_surface_excludes_state_gallery_readme_and_venv(self):
        accepted = (
            "Dashboard/runtime_update.py",
            "Dashboard/runtime-update-contract.json",
            "Dashboard/web/assets/index-abc.js",
            "Dashboard/web/assets/ksp2-navball.png",
            "GameData/KRPC.StageStats/KRPC.StageStats.dll",
            "SOURCE/KRPC.WoobiesMechJeb-1.0.0-source.zip",
            "THIRD-PARTY/NOTICES.md",
        )
        rejected = (
            "Dashboard/.venv/Scripts/python.exe",
            "Dashboard/launcher_error.log",
            "docs/images/v1.0.0/screenshot.png",
            "README.md",
            "../outside.txt",
            "Dashboard/web/assets/CON.js",
        )
        for path in accepted:
            self.assertTrue(update.is_allowed_managed_path(path), path)
        for path in rejected:
            self.assertFalse(update.is_allowed_managed_path(path), path)

    def test_shared_contract_is_the_runtime_limit_and_allowlist_authority(self):
        contract = json.loads(CONTRACT_BYTES)

        self.assertEqual(
            update.MAX_UPDATE_DOWNLOAD_BYTES,
            contract["limits"]["download_bytes"],
        )
        self.assertEqual(
            update.MAX_ARCHIVE_ENTRIES,
            contract["limits"]["archive_entries"],
        )
        self.assertEqual(
            update.MAX_ARCHIVE_FILE_BYTES,
            contract["limits"]["archive_file_bytes"],
        )
        self.assertEqual(
            update.MAX_ARCHIVE_EXPANDED_BYTES,
            contract["limits"]["archive_expanded_bytes"],
        )
        for path in contract["root_managed_files"]:
            self.assertTrue(update.is_allowed_managed_path(path), path)

    def test_archive_and_target_manifest_must_match_exactly(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target_files = {"Dashboard/ksp_dashboard_app.py": b"new\n"}
            target = install_manifest("1.1.0", "b" * 40, target_files)
            archive = root / "update.zip"
            make_update_archive(archive, target, target_files)
            update_manifest, install = update.inspect_update_archive(archive)
            self.assertEqual(install, target)
            self.assertEqual(update_manifest["product_version"], "1.1.0")

            with zipfile.ZipFile(archive, "a") as unsafe:
                unsafe.writestr("payload/unknown.txt", b"surprise")
            with self.assertRaisesRegex(update.ArchiveValidationError, "do not match"):
                update.inspect_update_archive(archive)

    def test_rejects_traversal_case_collisions_and_payload_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target_files = {"Dashboard/ksp_dashboard_app.py": b"new\n"}
            target = install_manifest("1.1.0", "b" * 40, target_files)

            traversal = root / "traversal.zip"
            make_update_archive(traversal, target, target_files)
            with zipfile.ZipFile(traversal, "a") as archive:
                archive.writestr("../escape.txt", b"escape")
            with self.assertRaises(update.ArchiveValidationError):
                update.inspect_update_archive(traversal)

            collision = root / "collision.zip"
            make_update_archive(collision, target, target_files)
            with zipfile.ZipFile(collision, "a") as archive:
                archive.writestr("PAYLOAD/dashboard/KSP_DASHBOARD_APP.PY", b"collision")
            with self.assertRaisesRegex(update.ArchiveValidationError, "collision"):
                update.inspect_update_archive(collision)

            tampered = root / "tampered.zip"
            make_update_archive(tampered, target, target_files)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with zipfile.ZipFile(tampered, "a") as archive:
                    archive.writestr(
                        "payload/Dashboard/ksp_dashboard_app.py", b"tampered"
                    )
            with self.assertRaises(update.ArchiveValidationError):
                update.inspect_update_archive(tampered)

    def test_rejects_link_entries_and_expansion_limits(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target_files = {"Dashboard/ksp_dashboard_app.py": b"new launcher\n"}
            target = install_manifest("1.1.0", "b" * 40, target_files)

            linked = root / "linked.zip"
            make_update_archive(linked, target, target_files)
            link_info = zipfile.ZipInfo("payload/link")
            link_info.create_system = 3
            link_info.external_attr = (stat.S_IFLNK | 0o777) << 16
            with zipfile.ZipFile(linked, "a") as archive:
                archive.writestr(link_info, "target")
            with self.assertRaisesRegex(update.ArchiveValidationError, "link"):
                update.inspect_update_archive(linked)

            limited = root / "limited.zip"
            make_update_archive(limited, target, target_files)
            with mock.patch.object(update, "MAX_ARCHIVE_EXPANDED_BYTES", 4):
                with self.assertRaisesRegex(
                    update.ArchiveValidationError, "safe limit"
                ):
                    update.inspect_update_archive(limited)


class TransactionTests(unittest.TestCase):
    def target(self):
        files = {
            "Dashboard/ksp_dashboard_app.py": b"new launcher\n",
            "Dashboard/runtime_update.py": b"new update module\n",
            "Dashboard/runtime_update_helper.py": b"new helper\n",
            "Dashboard/runtime-update-contract.json": CONTRACT_BYTES,
            "Dashboard/Start KSP Dashboard.bat": b"new batch\r\n",
            "Dashboard/web/assets/index-new.js": b"new bundle\n",
            "Dashboard/web/index.html": b"new index\n",
        }
        return install_manifest("1.1.0", "b" * 40, files), files

    def stage(self, root):
        current, current_files = write_installation(root)
        target, target_files = self.target()
        archive = Path(root) / "candidate-update.zip"
        make_update_archive(archive, target, target_files)
        staged = update.stage_transaction(root, archive)
        return current, current_files, target, target_files, staged

    def test_success_converges_managed_tree_and_preserves_user_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            live_ksp = Path(directory) / "live-ksp" / "GameData" / "sentinel.dll"
            live_ksp.parent.mkdir(parents=True)
            live_ksp.write_bytes(b"live KSP must remain unchanged")
            live_ksp_hash = update.sha256_file(live_ksp)
            current, _old_files, target, target_files, staged = self.stage(root)
            del current
            user_files = {
                "Dashboard/.venv/user-marker.txt": b"venv state",
                "Dashboard/mission_control_setup.log": b"user log",
                "README.md": b"local readme",
                "custom-user-file.txt": b"unknown file",
            }
            for relative, value in user_files.items():
                path = root / Path(relative)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(value)

            activate_staged_for_test(root, staged["transaction_id"])
            backup = update.apply_transaction(
                root,
                staged["transaction_id"],
                health_check=lambda _paths: None,
                restart_required=False,
            )

            self.assertTrue(backup.is_dir())
            self.assertEqual(update.load_install_manifest(root, verify_files=True), target)
            for relative, value in target_files.items():
                self.assertEqual((root / Path(relative)).read_bytes(), value)
            self.assertFalse((root / "Dashboard/web/assets/index-old.js").exists())
            for relative, value in user_files.items():
                self.assertEqual((root / Path(relative)).read_bytes(), value)
            self.assertEqual(update.sha256_file(live_ksp), live_ksp_hash)
            self.assertFalse((root / update.UPDATE_DIRECTORY_NAME / update.ACTIVE_TRANSACTION_NAME).exists())

    def test_failure_after_apply_restores_exact_preupdate_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            current, old_files, _target, _target_files, staged = self.stage(root)
            modified = root / "Dashboard/web/index.html"
            modified.write_bytes(b"locally modified index\n")
            unknown = root / "Dashboard/custom.txt"
            unknown.write_bytes(b"unknown")
            activate_staged_for_test(root, staged["transaction_id"])

            def fail_health(_paths):
                raise update.TransactionError("injected post-apply failure")

            with self.assertRaisesRegex(update.TransactionError, "injected"):
                update.apply_transaction(
                    root,
                    staged["transaction_id"],
                    health_check=fail_health,
                    restart_required=False,
                )
            self.assertEqual(update.load_install_manifest(root), current)
            for relative, value in old_files.items():
                expected = b"locally modified index\n" if relative == "Dashboard/web/index.html" else value
                self.assertEqual((root / Path(relative)).read_bytes(), expected)
            self.assertEqual(unknown.read_bytes(), b"unknown")
            self.assertFalse((root / "Dashboard/web/assets/index-new.js").exists())
            self.assertFalse((root / update.UPDATE_DIRECTORY_NAME / update.ACTIVE_TRANSACTION_NAME).exists())

    def test_interrupted_apply_is_rolled_back_on_next_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            current, _old_files, _target, target_files, staged = self.stage(root)
            paths = activate_staged_for_test(root, staged["transaction_id"])
            plan = update._validate_plan(paths)
            update._prepare_backup(paths, plan)
            update._journal(paths, "applying", helper_pid=None)
            destination = root / "Dashboard/ksp_dashboard_app.py"
            destination.unlink()

            result = update.recover_pending_update(root)
            self.assertEqual(result["status"], "recovered")
            self.assertEqual(update.load_install_manifest(root), current)
            self.assertEqual(destination.read_bytes(), b"old launcher\n")

    def test_mid_apply_copy_failure_rolls_back_every_changed_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            current, old_files, _target, _target_files, staged = self.stage(root)
            paths = activate_staged_for_test(root, staged["transaction_id"])
            real_copy = update._copy_verified
            target_copy_count = 0

            def fail_during_target_copy(source, destination, *args, **kwargs):
                nonlocal target_copy_count
                source = Path(source)
                try:
                    source.relative_to(paths["stage"])
                except ValueError:
                    pass
                else:
                    target_copy_count += 1
                    if target_copy_count == 3:
                        raise PermissionError("injected locked target")
                return real_copy(source, destination, *args, **kwargs)

            with mock.patch.object(update, "_copy_verified", fail_during_target_copy):
                with self.assertRaisesRegex(PermissionError, "locked target"):
                    update.apply_transaction(
                        root,
                        staged["transaction_id"],
                        health_check=lambda _paths: None,
                        restart_required=False,
                    )
            self.assertEqual(update.load_install_manifest(root), current)
            for relative, value in old_files.items():
                self.assertEqual((root / Path(relative)).read_bytes(), value)

    @unittest.skipUnless(os.name == "nt", "Windows sharing locks are platform-specific")
    def test_windows_read_shared_lock_rolls_back_without_rewriting_unchanged_file(self):
        import ctypes
        from ctypes import wintypes

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            current, old_files, _target, _target_files, staged = self.stage(root)
            activate_staged_for_test(root, staged["transaction_id"])
            locked_path = root / "Dashboard/web/index.html"

            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.CreateFileW.argtypes = (
                wintypes.LPCWSTR,
                wintypes.DWORD,
                wintypes.DWORD,
                wintypes.LPVOID,
                wintypes.DWORD,
                wintypes.DWORD,
                wintypes.HANDLE,
            )
            kernel32.CreateFileW.restype = wintypes.HANDLE
            kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
            kernel32.CloseHandle.restype = wintypes.BOOL
            handle = kernel32.CreateFileW(
                str(locked_path),
                0x80000000,  # GENERIC_READ
                0x00000001,  # FILE_SHARE_READ, but not write/delete
                None,
                3,  # OPEN_EXISTING
                0x00000080,  # FILE_ATTRIBUTE_NORMAL
                None,
            )
            invalid_handle = wintypes.HANDLE(-1).value
            if handle == invalid_handle:
                self.skipTest(f"could not create Windows test lock: {ctypes.get_last_error()}")
            try:
                with self.assertRaises(OSError):
                    update.apply_transaction(
                        root,
                        staged["transaction_id"],
                        health_check=lambda _paths: None,
                        restart_required=False,
                    )
            finally:
                kernel32.CloseHandle(handle)

            self.assertEqual(update.load_install_manifest(root), current)
            for relative, value in old_files.items():
                self.assertEqual((root / Path(relative)).read_bytes(), value)
            self.assertFalse((root / "Dashboard/web/assets/index-new.js").exists())

    def test_restart_acknowledgement_is_required_before_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            _current, _old, target, _new, staged = self.stage(root)
            paths = activate_staged_for_test(root, staged["transaction_id"])

            def restart(transaction_paths):
                journal = json.loads(
                    transaction_paths["journal"].read_text(encoding="utf-8")
                )
                self.assertEqual(journal["state"], "awaiting_restart")
                update.acknowledge_restart(root, staged["transaction_id"])

            update.apply_transaction(
                root,
                staged["transaction_id"],
                health_check=lambda _paths: None,
                restart=restart,
            )
            self.assertEqual(update.load_install_manifest(root, verify_files=True), target)
            journal = json.loads(paths["journal"].read_text(encoding="utf-8"))
            self.assertEqual(journal["state"], "complete")
            self.assertTrue(paths["ack"].is_file())

    def test_restart_failure_restores_preupdate_package(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            current, old_files, _target, _new, staged = self.stage(root)
            activate_staged_for_test(root, staged["transaction_id"])

            def fail_restart(_paths):
                raise update.TransactionError("restart never acknowledged")

            with self.assertRaisesRegex(update.TransactionError, "never acknowledged"):
                update.apply_transaction(
                    root,
                    staged["transaction_id"],
                    health_check=lambda _paths: None,
                    restart=fail_restart,
                )
            self.assertEqual(update.load_install_manifest(root), current)
            for relative, value in old_files.items():
                self.assertEqual((root / Path(relative)).read_bytes(), value)

    def test_modified_updater_critical_file_forces_manual_full_package(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            write_installation(root)
            (root / "Dashboard/runtime_update.py").write_bytes(b"modified")
            target, target_files = self.target()
            archive = root / "candidate-update.zip"
            make_update_archive(archive, target, target_files)
            with self.assertRaisesRegex(update.InstallationError, "full package"):
                update.stage_transaction(root, archive)

    def test_target_missing_updater_critical_file_forces_manual_package(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            write_installation(root)
            target, target_files = self.target()
            del target_files["Dashboard/runtime_update_helper.py"]
            target = install_manifest("1.1.0", "b" * 40, target_files)
            archive = root / "candidate-update.zip"
            make_update_archive(archive, target, target_files)
            with self.assertRaisesRegex(update.InstallationError, "updater-critical"):
                update.stage_transaction(root, archive)

    def test_new_managed_path_never_overwrites_an_unknown_user_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            write_installation(root)
            collision = root / "Dashboard/new_module.py"
            collision.write_bytes(b"user-owned file")
            target, target_files = self.target()
            target_files["Dashboard/new_module.py"] = b"product file"
            target = install_manifest("1.1.0", "b" * 40, target_files)
            archive = root / "candidate-update.zip"
            make_update_archive(archive, target, target_files)

            with self.assertRaisesRegex(update.InstallationError, "user-owned"):
                update.stage_transaction(root, archive)
            self.assertEqual(collision.read_bytes(), b"user-owned file")

    def test_user_file_created_after_staging_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            current, _old, _target, _new, staged = self.stage(root)
            collision = root / "Dashboard/web/assets/index-new.js"
            collision.parent.mkdir(parents=True, exist_ok=True)
            collision.write_bytes(b"appeared after staging")
            activate_staged_for_test(root, staged["transaction_id"])

            with self.assertRaisesRegex(update.TransactionError, "appeared"):
                update.apply_transaction(
                    root,
                    staged["transaction_id"],
                    health_check=lambda _paths: None,
                    restart_required=False,
                )
            self.assertEqual(update.load_install_manifest(root), current)
            self.assertEqual(collision.read_bytes(), b"appeared after staging")

    def test_failed_helper_spawn_can_be_retried_from_a_clean_helper_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            _current, _old, _target, _new, staged = self.stage(root)
            fake_python = root / "python.exe"
            fake_python.write_bytes(b"fixture")
            paths = update._transaction_paths(root, staged["transaction_id"])

            with mock.patch.object(
                update.subprocess, "Popen", side_effect=OSError("spawn denied")
            ):
                with self.assertRaisesRegex(OSError, "spawn denied"):
                    update.activate_transaction(
                        root,
                        staged["transaction_id"],
                        launcher_pid=os.getpid(),
                        python_executable=fake_python,
                    )
            self.assertFalse(paths["active"].exists())
            self.assertFalse(paths["helper"].exists())
            self.assertEqual(
                json.loads(paths["journal"].read_text(encoding="utf-8"))["state"],
                "activation_failed",
            )

            class FakeHandle:
                def Close(self):
                    return None

            class FakeProcess:
                pid = 424242
                returncode = None
                _handle = FakeHandle()

            with mock.patch.object(
                update.subprocess, "Popen", return_value=FakeProcess()
            ):
                helper_pid = update.activate_transaction(
                    root,
                    staged["transaction_id"],
                    launcher_pid=os.getpid(),
                    python_executable=fake_python,
                )
            self.assertEqual(helper_pid, 424242)
            self.assertTrue(paths["active"].is_file())
            self.assertTrue((paths["helper"] / "runtime_update.py").is_file())
            paths["active"].unlink()

    def test_activation_refuses_managed_changes_made_after_review(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            _current, _old, _target, _new, staged = self.stage(root)
            (root / "Dashboard/web/index.html").write_bytes(b"changed after review")
            fake_python = root / "python.exe"
            fake_python.write_bytes(b"fixture")

            with self.assertRaisesRegex(update.InstallationError, "after update review"):
                update.activate_transaction(
                    root,
                    staged["transaction_id"],
                    launcher_pid=os.getpid(),
                    python_executable=fake_python,
                )

    def test_corrupt_active_marker_type_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            write_installation(root)
            marker = root / update.UPDATE_DIRECTORY_NAME / update.ACTIVE_TRANSACTION_NAME
            marker.mkdir(parents=True)
            status = update.pending_update_status(root)
            self.assertTrue(status["pending"])
            self.assertEqual(status["state"], "invalid")

    def test_check_status_is_read_only_and_token_scoped(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            _current, _old, _target, _new, staged = self.stage(root)
            paths = activate_staged_for_test(root, staged["transaction_id"])
            update._journal(paths, "awaiting_restart", helper_pid=None)

            ordinary = update.pending_update_status(root)
            helper = update.pending_update_status(root, staged["transaction_id"])
            self.assertTrue(ordinary["pending"])
            self.assertFalse(helper["pending"])
            self.assertEqual(
                json.loads(paths["active"].read_text(encoding="utf-8"))["transaction_id"],
                staged["transaction_id"],
            )

    def test_stale_helper_pid_does_not_block_recovery_forever(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            current, _old, _target, _new, staged = self.stage(root)
            paths = activate_staged_for_test(root, staged["transaction_id"])
            plan = update._validate_plan(paths)
            update._prepare_backup(paths, plan)
            helper_identity = (
                update._windows_process_identity(os.getpid())
                if os.name == "nt"
                else None
            )
            update._journal(
                paths,
                "applying",
                helper_pid=os.getpid(),
                helper_identity=update._identity_record(helper_identity),
            )

            busy = update.recover_pending_update(root)
            self.assertEqual(busy["status"], "busy")

            journal = json.loads(paths["journal"].read_text(encoding="utf-8"))
            journal["updated_at"] = 0
            update._atomic_write_json(paths["journal"], journal)
            recovered = update.recover_pending_update(root)
            self.assertEqual(recovered["status"], "recovered")
            self.assertEqual(update.load_install_manifest(root), current)

    @unittest.skipUnless(os.name == "nt", "process identity is Windows-specific")
    def test_pid_reuse_identity_never_matches_or_signals_an_unrelated_process(self):
        identity = update._windows_process_identity(os.getpid())
        reused = update.WindowsProcessIdentity(
            pid=identity.pid,
            creation_time=identity.creation_time + 1,
            executable=identity.executable,
        )

        self.assertTrue(update._pid_is_running(os.getpid(), identity))
        self.assertFalse(update._pid_is_running(os.getpid(), reused))
        update._wait_for_pid_exit(os.getpid(), 0.01, reused)
        update._terminate_restarted_process(os.getpid())
        self.assertTrue(update._pid_is_running(os.getpid(), identity))

    def test_next_launch_retries_a_previous_incomplete_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "package"
            root.mkdir()
            current, _old, _target, target_files, staged = self.stage(root)
            paths = activate_staged_for_test(root, staged["transaction_id"])
            plan = update._validate_plan(paths)
            update._prepare_backup(paths, plan)
            changed = root / "Dashboard/ksp_dashboard_app.py"
            changed.write_bytes(target_files["Dashboard/ksp_dashboard_app.py"])
            update._journal(paths, "applying", helper_pid=None)

            with mock.patch.object(
                update, "_copy_verified", side_effect=PermissionError("still locked")
            ):
                with self.assertRaisesRegex(update.TransactionError, "incomplete"):
                    update.rollback_transaction(
                        root, staged["transaction_id"], reason="injected interruption"
                    )
            self.assertEqual(
                json.loads(paths["journal"].read_text(encoding="utf-8"))["state"],
                "rollback_failed",
            )

            recovered = update.recover_pending_update(root)
            self.assertEqual(recovered["status"], "recovered")
            self.assertEqual(update.load_install_manifest(root), current)
            self.assertEqual(changed.read_bytes(), b"old launcher\n")


if __name__ == "__main__":
    unittest.main()
