import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ksp_dashboard_app as app


class DllInstallRepairTests(unittest.TestCase):
    def make_layout(self, root):
        ksp_root = root / "KSP"
        package = root / "package" / "GameData"
        (ksp_root / "GameData").mkdir(parents=True)
        for index, (folder, _title) in enumerate(app.SERVICE_DLLS):
            source = package / folder / f"{folder}.dll"
            source.parent.mkdir(parents=True)
            source.write_bytes(f"packaged-{index}".encode("ascii"))
        return ksp_root, package

    def test_inventory_distinguishes_current_different_and_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ksp_root, package = self.make_layout(root)
            first, second, _third = app.SERVICE_DLLS
            first_source = package / first[0] / f"{first[0]}.dll"
            first_target = ksp_root / "GameData" / first[0] / f"{first[0]}.dll"
            first_target.parent.mkdir(parents=True)
            first_target.write_bytes(first_source.read_bytes())
            second_target = (
                ksp_root / "GameData" / second[0] / f"{second[0]}.dll"
            )
            second_target.parent.mkdir(parents=True)
            second_target.write_bytes(b"older-build")

            statuses = {
                item["folder"]: item["status"]
                for item in app.service_inventory(ksp_root, package)
            }
            self.assertEqual(statuses[first[0]], "current")
            self.assertEqual(statuses[second[0]], "different")
            self.assertEqual(statuses[app.SERVICE_DLLS[2][0]], "missing")

    def test_install_updates_only_needed_dlls_and_creates_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ksp_root, package = self.make_layout(root)
            unchanged_folder = app.SERVICE_DLLS[0][0]
            changed_folder = app.SERVICE_DLLS[1][0]
            unchanged_source = (
                package / unchanged_folder / f"{unchanged_folder}.dll"
            )
            unchanged_target = (
                ksp_root
                / "GameData"
                / unchanged_folder
                / f"{unchanged_folder}.dll"
            )
            unchanged_target.parent.mkdir(parents=True)
            unchanged_target.write_bytes(unchanged_source.read_bytes())
            changed_target = (
                ksp_root / "GameData" / changed_folder / f"{changed_folder}.dll"
            )
            changed_target.parent.mkdir(parents=True)
            changed_target.write_bytes(b"previous-copy")
            backup_root = root / "backups"

            result = app.install_service_dlls(
                ksp_root,
                package,
                backup_root,
                running_process_provider=lambda: [],
            )

            self.assertNotIn(unchanged_folder, result["installed"])
            self.assertIn(changed_folder, result["installed"])
            self.assertIn(app.SERVICE_DLLS[2][0], result["installed"])
            self.assertEqual(
                changed_target.read_bytes(),
                (package / changed_folder / f"{changed_folder}.dll").read_bytes(),
            )
            backup = (
                result["backup_dir"]
                / changed_folder
                / f"{changed_folder}.dll"
            )
            self.assertEqual(backup.read_bytes(), b"previous-copy")
            self.assertFalse(
                (result["backup_dir"] / unchanged_folder).exists()
            )

    def test_running_ksp_blocks_all_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ksp_root, package = self.make_layout(root)
            with self.assertRaisesRegex(RuntimeError, "Close KSP"):
                app.install_service_dlls(
                    ksp_root,
                    package,
                    root / "backups",
                    running_process_provider=lambda: ["KSP_x64.exe"],
                )
            self.assertFalse(
                (ksp_root / "GameData" / app.SERVICE_DLLS[0][0]).exists()
            )

    def test_process_parser_detects_only_supported_ksp_executables(self):
        output = (
            '"explorer.exe","100","Console","1","10,000 K"\n'
            '"KSP_x64.exe","200","Console","1","2,000,000 K"\n'
            '"NotKSP.exe","300","Console","1","20,000 K"\n'
        )
        self.assertEqual(
            app.running_ksp_processes(lambda: output),
            ["KSP_x64.exe"],
        )

    def test_mid_install_failure_restores_every_original_dll(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ksp_root, package = self.make_layout(root)
            originals = {}
            for index, (folder, _title) in enumerate(app.SERVICE_DLLS):
                target = ksp_root / "GameData" / folder / f"{folder}.dll"
                target.parent.mkdir(parents=True)
                originals[target] = f"original-{index}".encode("ascii")
                target.write_bytes(originals[target])

            real_replace = app.os.replace
            replace_calls = [0]

            def fail_second_replace(source, target):
                replace_calls[0] += 1
                if replace_calls[0] == 2:
                    raise OSError("injected replacement failure")
                return real_replace(source, target)

            with mock.patch.object(
                app.os, "replace", side_effect=fail_second_replace
            ):
                with self.assertRaisesRegex(OSError, "injected"):
                    app.install_service_dlls(
                        ksp_root,
                        package,
                        root / "backups",
                        running_process_provider=lambda: [],
                    )

            for target, original in originals.items():
                self.assertEqual(target.read_bytes(), original)
            self.assertFalse(
                list((ksp_root / "GameData").rglob("*.woobie-install.tmp"))
            )

    def test_rollback_failure_reports_manual_restoration_requirement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ksp_root, package = self.make_layout(root)
            for index, (folder, _title) in enumerate(app.SERVICE_DLLS):
                target = ksp_root / "GameData" / folder / f"{folder}.dll"
                target.parent.mkdir(parents=True)
                target.write_bytes(f"original-{index}".encode("ascii"))

            backup_root = (root / "backups").resolve()
            game_data = (ksp_root / "GameData").resolve()
            real_replace = app.os.replace
            real_copy2 = app.shutil.copy2
            replace_calls = [0]

            def fail_second_replace(source, target):
                replace_calls[0] += 1
                if replace_calls[0] == 2:
                    raise OSError("injected replacement failure")
                return real_replace(source, target)

            def fail_backup_restore(source, target, *args, **kwargs):
                source = Path(source).resolve()
                target = Path(target).resolve()
                if source.is_relative_to(backup_root) and target.is_relative_to(
                    game_data
                ):
                    raise OSError("injected restoration failure")
                return real_copy2(source, target, *args, **kwargs)

            with mock.patch.object(
                app.os, "replace", side_effect=fail_second_replace
            ), mock.patch.object(
                app.shutil, "copy2", side_effect=fail_backup_restore
            ):
                with self.assertRaises(app.ServiceRollbackError) as caught:
                    app.install_service_dlls(
                        ksp_root,
                        package,
                        backup_root,
                        running_process_provider=lambda: [],
                    )

            message = str(caught.exception)
            self.assertIn("rollback was incomplete", message)
            self.assertIn("Manual restoration may be required", message)
            self.assertIn(str(backup_root), message)


if __name__ == "__main__":
    unittest.main()
