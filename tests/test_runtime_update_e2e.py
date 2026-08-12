import json
import os
import subprocess
import tempfile
import time
import unittest
import venv
from pathlib import Path

import runtime_update as update
from tests.test_runtime_update import install_manifest, make_update_archive, write_installation


ROOT = Path(__file__).resolve().parents[1]
CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


@unittest.skipUnless(os.name == "nt", "external self-update acceptance is Windows-specific")
class WindowsRuntimeUpdateAcceptanceTests(unittest.TestCase):
    def test_first_updater_build_can_complete_a_synthetic_successor_update(self):
        """Prove the first updater without inventing a public successor release."""
        with tempfile.TemporaryDirectory() as directory:
            sandbox = Path(directory)
            package = sandbox / "installed package with spaces"
            dashboard = package / "Dashboard"
            dashboard.mkdir(parents=True)

            venv.EnvBuilder(with_pip=False, clear=True).create(dashboard / ".venv")
            python = dashboard / ".venv" / "Scripts" / "python.exe"
            self.assertTrue(python.is_file())
            (dashboard / ".venv" / "preserved.txt").write_bytes(b"venv sentinel")

            updater_source = (ROOT / "runtime_update.py").read_bytes()
            helper_source = (ROOT / "runtime_update_helper.py").read_bytes()
            check_batch = (
                "@echo off\r\n"
                "if /I not \"%~1\"==\"--check\" exit /b 2\r\n"
                "\"%~dp0.venv\\Scripts\\python.exe\" "
                "\"%~dp0runtime_update_helper.py\" status \"%~dp0..\" "
                "--transaction-token \"%WMC_UPDATE_TRANSACTION%\"\r\n"
                "exit /b %ERRORLEVEL%\r\n"
            ).encode("utf-8")
            restart_app = (
                "import os\n"
                "import time\n"
                "from pathlib import Path\n"
                "import runtime_update\n"
                "root = Path(__file__).resolve().parent.parent\n"
                "token = os.environ['WMC_UPDATE_TRANSACTION']\n"
                "runtime_update.acknowledge_restart(root, token)\n"
                "(root / 'restart-observed.txt').write_text("
                "token + ':' + str(os.getpid()), encoding='utf-8')\n"
                "time.sleep(1.5)\n"
            ).encode("utf-8")

            current_files = {
                "Dashboard/ksp_dashboard_app.py": b"# synthetic predecessor launcher\n",
                "Dashboard/runtime_update.py": updater_source,
                "Dashboard/runtime_update_helper.py": helper_source,
                "Dashboard/Start KSP Dashboard.bat": check_batch,
                "Dashboard/web/index.html": b"synthetic predecessor\n",
            }
            current_manifest, _ = write_installation(
                package,
                version="1.0.0",
                commit="a" * 40,
                files=current_files,
            )
            target_files = {
                **current_files,
                "Dashboard/ksp_dashboard_app.py": restart_app,
                "Dashboard/web/index.html": b"synthetic successor\n",
                "QUICKSTART.txt": b"synthetic successor instructions\n",
            }
            target_manifest = install_manifest("1.1.0", "b" * 40, target_files)
            archive = sandbox / "synthetic-successor.zip"
            make_update_archive(archive, target_manifest, target_files)

            user_files = {
                package / "README.md": b"preserved readme",
                package / "unknown-user-file.txt": b"preserved unknown file",
                dashboard / "mission_control_setup.log": b"preserved log",
            }
            for path, value in user_files.items():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(value)
            live_ksp = sandbox / "live-ksp" / "GameData" / "sentinel.dll"
            live_ksp.parent.mkdir(parents=True)
            live_ksp.write_bytes(b"live KSP sentinel")
            live_ksp_hash = update.sha256_file(live_ksp)

            staged = update.stage_transaction(package, archive)
            launcher = subprocess.Popen(
                [str(python), "-c", "import time; time.sleep(0.5)"],
                creationflags=CREATE_NO_WINDOW,
            )
            try:
                helper_pid = update.activate_transaction(
                    package,
                    staged["transaction_id"],
                    launcher_pid=launcher.pid,
                    python_executable=python,
                )
                paths = update._transaction_paths(package, staged["transaction_id"])
                deadline = time.monotonic() + 45
                state = None
                while time.monotonic() < deadline:
                    if paths["journal"].is_file():
                        state = json.loads(
                            paths["journal"].read_text(encoding="utf-8")
                        ).get("state")
                        if state == "complete":
                            break
                    if not update._pid_is_running(helper_pid) and state != "complete":
                        break
                    time.sleep(0.1)
                if state != "complete":
                    log = (
                        paths["log"].read_text(encoding="utf-8", errors="replace")
                        if paths["log"].is_file()
                        else "no helper log"
                    )
                    self.fail(f"external updater stopped in state {state!r}:\n{log}")
            finally:
                if launcher.poll() is None:
                    launcher.terminate()
                launcher.wait(timeout=5)

            self.assertNotEqual(current_manifest, target_manifest)
            self.assertEqual(
                update.load_install_manifest(package, verify_files=True),
                target_manifest,
            )
            restart_token, restart_pid_text = (
                package / "restart-observed.txt"
            ).read_text(encoding="utf-8").split(":", 1)
            self.assertEqual(restart_token, staged["transaction_id"])
            self.assertEqual(
                (dashboard / ".venv" / "preserved.txt").read_bytes(),
                b"venv sentinel",
            )
            for path, value in user_files.items():
                self.assertEqual(path.read_bytes(), value)
            self.assertEqual(update.sha256_file(live_ksp), live_ksp_hash)
            self.assertTrue(paths["backup"].is_dir())
            self.assertFalse(paths["active"].exists())
            self.assertIn(
                "runtime update completed",
                paths["log"].read_text(encoding="utf-8").casefold(),
            )
            restart_pid = int(restart_pid_text)
            restart_deadline = time.monotonic() + 5
            while update._pid_is_running(restart_pid) and time.monotonic() < restart_deadline:
                time.sleep(0.05)
            self.assertFalse(update._pid_is_running(restart_pid))

    def test_forced_external_helper_termination_is_recovered_on_next_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            sandbox = Path(directory)
            package = sandbox / "interruptible installed package"
            dashboard = package / "Dashboard"
            dashboard.mkdir(parents=True)
            venv.EnvBuilder(with_pip=False, clear=True).create(dashboard / ".venv")
            python = dashboard / ".venv" / "Scripts" / "python.exe"

            updater_source = (ROOT / "runtime_update.py").read_bytes()
            production_helper = (ROOT / "runtime_update_helper.py").read_bytes()
            interruptible_helper = b"""\
import argparse
import time
from pathlib import Path
import runtime_update as update

parser = argparse.ArgumentParser()
parser.add_argument('command')
parser.add_argument('root', type=Path)
parser.add_argument('transaction_id')
parser.add_argument('--launcher-pid', type=int, required=True)
args = parser.parse_args()
paths = update._transaction_paths(args.root, args.transaction_id)
real_copy = update._copy_verified
triggered = False

def interruptible_copy(source, destination, *copy_args, **copy_kwargs):
    global triggered
    result = real_copy(source, destination, *copy_args, **copy_kwargs)
    try:
        Path(source).resolve().relative_to(paths['stage'])
    except ValueError:
        return result
    if not triggered:
        triggered = True
        (paths['transaction_root'] / 'kill-ready.txt').write_text(
            'target replacement completed', encoding='utf-8'
        )
        time.sleep(30)
    return result

update._copy_verified = interruptible_copy
update.apply_transaction(
    args.root, args.transaction_id, launcher_pid=args.launcher_pid
)
"""
            current_files = {
                "Dashboard/ksp_dashboard_app.py": b"old launcher\n",
                "Dashboard/runtime_update.py": updater_source,
                "Dashboard/runtime_update_helper.py": interruptible_helper,
                "Dashboard/Start KSP Dashboard.bat": b"@echo off\r\nexit /b 0\r\n",
                "Dashboard/web/index.html": b"old dashboard\n",
            }
            current_manifest, _ = write_installation(
                package,
                version="1.0.0",
                commit="a" * 40,
                files=current_files,
            )
            target_files = {
                **current_files,
                "Dashboard/ksp_dashboard_app.py": b"new launcher\n",
                "Dashboard/runtime_update_helper.py": production_helper,
                "Dashboard/Start KSP Dashboard.bat": b"@echo off\r\nexit /b 0\r\n",
                "Dashboard/web/index.html": b"new dashboard\n",
            }
            target_manifest = install_manifest("1.1.0", "b" * 40, target_files)
            archive = sandbox / "interrupted-successor.zip"
            make_update_archive(archive, target_manifest, target_files)
            staged = update.stage_transaction(package, archive)
            paths = update._transaction_paths(package, staged["transaction_id"])

            user_file = package / "unknown-user-file.txt"
            user_file.write_bytes(b"preserve me")
            live_ksp = sandbox / "live-ksp" / "GameData" / "sentinel.dll"
            live_ksp.parent.mkdir(parents=True)
            live_ksp.write_bytes(b"never mutate live KSP")
            live_ksp_hash = update.sha256_file(live_ksp)

            launcher = subprocess.Popen(
                [str(python), "-c", "import time; time.sleep(0.4)"],
                creationflags=CREATE_NO_WINDOW,
            )
            helper_pid = None
            try:
                helper_pid = update.activate_transaction(
                    package,
                    staged["transaction_id"],
                    launcher_pid=launcher.pid,
                    python_executable=python,
                )
                deadline = time.monotonic() + 20
                while (
                    not (paths["transaction_root"] / "kill-ready.txt").is_file()
                    and time.monotonic() < deadline
                ):
                    if not update._pid_is_running(helper_pid):
                        break
                    time.sleep(0.02)
                self.assertTrue(
                    (paths["transaction_root"] / "kill-ready.txt").is_file(),
                    paths["log"].read_text(encoding="utf-8", errors="replace")
                    if paths["log"].is_file()
                    else "helper exited before its interruption point",
                )
                os.kill(helper_pid, 15)
                stop_deadline = time.monotonic() + 5
                while update._pid_is_running(helper_pid) and time.monotonic() < stop_deadline:
                    time.sleep(0.05)
                self.assertFalse(update._pid_is_running(helper_pid))
            finally:
                if launcher.poll() is None:
                    launcher.terminate()
                launcher.wait(timeout=5)
                if helper_pid is not None and update._pid_is_running(helper_pid):
                    os.kill(helper_pid, 15)

            self.assertEqual(
                json.loads(paths["journal"].read_text(encoding="utf-8"))["state"],
                "applying",
            )
            self.assertEqual(
                (package / "Dashboard/ksp_dashboard_app.py").read_bytes(),
                b"new launcher\n",
            )

            recovered = update.recover_pending_update(package)
            self.assertEqual(recovered["status"], "recovered")
            self.assertEqual(update.load_install_manifest(package), current_manifest)
            for relative, value in current_files.items():
                self.assertEqual((package / Path(relative)).read_bytes(), value)
            self.assertEqual(user_file.read_bytes(), b"preserve me")
            self.assertEqual(update.sha256_file(live_ksp), live_ksp_hash)
            self.assertFalse(paths["active"].exists())


if __name__ == "__main__":
    unittest.main()
