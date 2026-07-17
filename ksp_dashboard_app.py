"""Modular launcher for the KSP dashboard and ESP32 control pad.

The launcher discovers the optional components beside this file. A component is
shown only when its Python script exists, so a distribution may include either
script or both:

  * telemetry_server.py -- dashboard telemetry WebSocket server
  * panel_bridge.py     -- ESP32 serial/kRPC control bridge

Each discovered component runs as an independent child process. Closing this
window stops every component that was started from it.

The launcher itself uses only the Python standard library. Each optional script
is responsible for its own dependencies.
"""

import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

import tkinter as tk
from tkinter import scrolledtext


HERE = Path(__file__).resolve().parent
DASHBOARD = HERE / "ksp_mission_dashboard.html"
PYTHON = sys.executable
APP_NAME = "Woobie's Mission Control"
APP_VERSION = "0.2.1"
APP_AUTHOR = "SacredWoobie"
PROJECT_URL = "https://github.com/SacredWoobie/woobies-mission-control"
LATEST_RELEASE_API = (
    "https://api.github.com/repos/SacredWoobie/"
    "woobies-mission-control/releases/latest"
)
UPDATE_CACHE_SECONDS = 24 * 60 * 60
UPDATE_TIMEOUT_SECONDS = 4
_VERSION_TAG = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")


def _default_update_state_path():
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "WoobiesMissionControl" / "update_state.json"
    return Path.home() / ".woobies-mission-control" / "update_state.json"


UPDATE_STATE_PATH = _default_update_state_path()

# Add future optional programs here. The GUI will expose a component only when
# its script is present beside this launcher.
COMPONENTS = (
    {
        "name": "feed",
        "title": "Dashboard feed (telemetry)",
        "script": "telemetry_server.py",
        "description": "Serves kRPC telemetry to the browser dashboard.",
        "dashboard": True,
    },
    {
        "name": "panel",
        "title": "Panel bridge (ESP32)",
        "script": "panel_bridge.py",
        "description": "Connects the ESP32 control pad to KSP through serial and kRPC.",
        "dashboard": False,
    },
)

# Prevent child processes from opening extra console windows on Windows.
CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def parse_version_tag(tag):
    """Return a comparable three-part version tuple, or ``None``."""
    if not isinstance(tag, str):
        return None
    match = _VERSION_TAG.fullmatch(tag.strip())
    if not match:
        return None
    return tuple(int(part) for part in match.groups())


def classify_release(current_version, latest_tag):
    """Classify *latest_tag* as current, available, or behind this build."""
    current = parse_version_tag(current_version)
    latest = parse_version_tag(latest_tag)
    if current is None or latest is None:
        raise ValueError("release versions must use vMAJOR.MINOR.PATCH")
    if latest > current:
        return "available"
    if latest < current:
        return "development"
    return "current"


def validate_release_payload(payload):
    """Validate and return the update fields used from a GitHub response."""
    if not isinstance(payload, dict):
        raise ValueError("GitHub returned an invalid release response")

    tag_name = payload.get("tag_name")
    html_url = payload.get("html_url")
    if parse_version_tag(tag_name) is None:
        raise ValueError("the latest release tag is not vMAJOR.MINOR.PATCH")
    if not isinstance(html_url, str):
        raise ValueError("the latest release does not have a web address")

    parsed = urllib.parse.urlparse(html_url)
    expected_path = "/sacredwoobie/woobies-mission-control/releases/"
    if (
        parsed.scheme != "https"
        or parsed.netloc.lower() != "github.com"
        or not parsed.path.lower().startswith(expected_path)
    ):
        raise ValueError("the latest release has an unexpected web address")

    return {"tag_name": tag_name.strip(), "html_url": html_url}


def fetch_latest_release(opener=urllib.request.urlopen, timeout=UPDATE_TIMEOUT_SECONDS):
    """Fetch and validate the latest stable public GitHub release."""
    request = urllib.request.Request(
        LATEST_RELEASE_API,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": f"Woobies-Mission-Control/{APP_VERSION}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with opener(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return validate_release_payload(payload)


def load_update_state(path=UPDATE_STATE_PATH):
    """Load cached update state, returning an empty state on any error."""
    try:
        state = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    return state if isinstance(state, dict) else {}


def save_update_state(state, path=UPDATE_STATE_PATH):
    """Atomically save update preferences and the last successful result."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(state, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def get_fresh_cached_release(state, now=None, max_age=UPDATE_CACHE_SECONDS):
    """Return a validated cached release if it is recent enough."""
    if not isinstance(state, dict):
        return None
    if state.get("app_version") != APP_VERSION:
        return None
    checked_at = state.get("last_checked")
    if not isinstance(checked_at, (int, float)):
        return None
    if now is None:
        now = time.time()
    age = now - checked_at
    if age < 0 or age > max_age:
        return None
    try:
        return validate_release_payload(state)
    except ValueError:
        return None


def discover_components(directory=HERE):
    """Return component definitions whose scripts exist in *directory*."""
    directory = Path(directory)
    return [
        component
        for component in COMPONENTS
        if (directory / component["script"]).is_file()
    ]


class Backend:
    """One independently managed child process."""

    def __init__(self, name, script, log):
        self.name = name
        self.script = Path(script)
        self.argv = [PYTHON, "-u", str(self.script)]
        self.log = log
        self.proc = None

    def running(self):
        return self.proc is not None and self.proc.poll() is None

    def start(self):
        if self.running():
            return False
        if not self.script.is_file():
            self.log(self.name, f"ERROR: {self.script.name} is no longer available.")
            return False

        self.log(self.name, "starting...")
        try:
            self.proc = subprocess.Popen(
                self.argv,
                cwd=str(HERE),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                creationflags=CREATE_NO_WINDOW,
            )
        except Exception as exc:
            self.log(self.name, f"FAILED to start: {exc}")
            self.proc = None
            return False

        threading.Thread(target=self._pump, daemon=True).start()
        return True

    def _pump(self):
        """Relay child output into the GUI log pane."""
        process = self.proc
        if process is None:
            return
        try:
            if process.stdout is not None:
                for line in process.stdout:
                    self.log(self.name, line.rstrip())
            return_code = process.wait()
        except Exception as exc:
            self.log(self.name, f"log reader stopped: {exc}")
            return_code = process.poll()
        self.log(self.name, f"exited (code {return_code}).")

    def stop(self):
        if not self.running():
            return
        self.log(self.name, "stopping...")
        try:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.log(self.name, "did not stop in time; terminating forcefully.")
                self.proc.kill()
                self.proc.wait(timeout=2)
        except Exception as exc:
            self.log(self.name, f"error while stopping: {exc}")


class App:
    def __init__(self, root, update_state_path=UPDATE_STATE_PATH):
        self.root = root
        self.log_queue = queue.Queue()
        self.update_queue = queue.Queue()
        self.backends = []
        self.backend_rows = []
        self.update_state_path = Path(update_state_path)
        self.update_state = load_update_state(self.update_state_path)
        self.update_generation = 0
        self.update_checking = False
        self.latest_release_url = None

        root.title(f"{APP_NAME} v{APP_VERSION}")
        root.minsize(600, 360)
        root.protocol("WM_DELETE_WINDOW", self._on_close)

        header = tk.Frame(root)
        header.pack(fill="x", padx=10, pady=(10, 2))
        tk.Label(
            header,
            text=f"{APP_NAME}  v{APP_VERSION}",
            anchor="w",
            font=("TkDefaultFont", 11, "bold"),
        ).pack(side="left")
        tk.Button(header, text="About", width=8, command=self._show_about).pack(
            side="right"
        )

        update_bar = tk.Frame(root)
        update_bar.pack(fill="x", padx=10, pady=(2, 4))
        self.update_status = tk.Label(
            update_bar,
            text="Update status: waiting",
            fg="#666",
            anchor="w",
        )
        self.update_status.pack(side="left", fill="x", expand=True)
        self.view_release_button = tk.Button(
            update_bar,
            text="View release",
            state="disabled",
            command=self._open_latest_release,
        )
        self.view_release_button.pack(side="right", padx=(4, 0))
        self.check_updates_button = tk.Button(
            update_bar,
            text="Check now",
            command=lambda: self._start_update_check(use_cache=False),
        )
        self.check_updates_button.pack(side="right", padx=(4, 0))
        self.check_updates_var = tk.BooleanVar(
            value=self.update_state.get("check_enabled", True) is not False
        )
        tk.Checkbutton(
            update_bar,
            text="Check automatically",
            variable=self.check_updates_var,
            command=self._toggle_automatic_updates,
        ).pack(side="right", padx=(4, 0))

        components = discover_components()
        if components:
            for component in components:
                self._add_component(component)
        else:
            empty = tk.LabelFrame(root, text="Components")
            empty.pack(fill="x", padx=10, pady=6)
            tk.Label(
                empty,
                text="No supported Python components were found beside this launcher.",
                anchor="w",
            ).pack(fill="x", padx=10, pady=12)

        log_frame = tk.LabelFrame(root, text="Log")
        log_frame.pack(fill="both", expand=True, padx=10, pady=6)
        self.logbox = scrolledtext.ScrolledText(
            log_frame,
            height=12,
            state="disabled",
            wrap="word",
            font=("Consolas", 9),
        )
        self.logbox.pack(fill="both", expand=True, padx=6, pady=6)

        if components:
            names = ", ".join(component["script"] for component in components)
            self._enqueue("launcher", f"available components: {names}")

        self._drain_log()
        self._drain_update_queue()
        self._refresh()
        if self.check_updates_var.get():
            self.root.after(300, lambda: self._start_update_check(use_cache=True))
        else:
            self.update_status.config(text="Automatic update checks are off")

    def _add_component(self, component):
        script = HERE / component["script"]
        backend = Backend(component["name"], script, self._enqueue)

        frame = tk.LabelFrame(self.root, text=component["title"])
        frame.pack(fill="x", padx=10, pady=6)

        controls = tk.Frame(frame)
        controls.pack(fill="x", padx=8, pady=(8, 2))

        status = tk.Label(
            controls,
            text="\u25cb stopped",
            fg="#888",
            width=14,
            anchor="w",
        )
        status.pack(side="left")

        button = tk.Button(
            controls,
            text="Start",
            width=9,
            command=lambda be=backend, opens=component["dashboard"]: self._toggle(
                be, opens
            ),
        )
        button.pack(side="left", padx=4)

        if component["dashboard"] and DASHBOARD.is_file():
            tk.Button(
                controls,
                text="Open dashboard",
                command=self._open_dashboard,
            ).pack(side="left", padx=4)

        tk.Label(
            frame,
            text=component["description"],
            fg="#555",
            anchor="w",
            justify="left",
        ).pack(fill="x", padx=9, pady=(0, 8))

        self.backends.append(backend)
        self.backend_rows.append((backend, status, button))

    def _enqueue(self, source, message):
        self.log_queue.put(f"[{source}] {message}")

    def _drain_log(self):
        try:
            while True:
                line = self.log_queue.get_nowait()
                self.logbox.configure(state="normal")
                self.logbox.insert("end", line + "\n")
                self.logbox.see("end")
                self.logbox.configure(state="disabled")
        except queue.Empty:
            pass
        self.root.after(100, self._drain_log)

    def _start_update_check(self, use_cache):
        if self.update_checking:
            return

        if use_cache:
            cached = get_fresh_cached_release(self.update_state)
            if cached is not None:
                self._apply_release_status(cached)
                return

        self.update_generation += 1
        generation = self.update_generation
        self.update_checking = True
        self.update_status.config(text="Checking GitHub for updates…", fg="#666")
        self.check_updates_button.config(state="disabled")

        def worker():
            try:
                release = fetch_latest_release()
            except Exception as exc:
                self.update_queue.put((generation, "error", str(exc)))
            else:
                self.update_queue.put((generation, "release", release))

        threading.Thread(target=worker, daemon=True).start()

    def _drain_update_queue(self):
        try:
            while True:
                generation, result_type, result = self.update_queue.get_nowait()
                if generation != self.update_generation:
                    continue

                self.update_checking = False
                self.check_updates_button.config(state="normal")
                if result_type == "release":
                    self.update_state.update(result)
                    self.update_state["app_version"] = APP_VERSION
                    self.update_state["last_checked"] = time.time()
                    self.update_state["check_enabled"] = self.check_updates_var.get()
                    self._save_update_state()
                    self._apply_release_status(result)
                else:
                    self.update_status.config(
                        text="Couldn’t check for updates (offline is OK)",
                        fg="#666",
                    )
                    self._enqueue("updates", f"update check unavailable: {result}")
        except queue.Empty:
            pass
        self.root.after(100, self._drain_update_queue)

    def _apply_release_status(self, release):
        tag_name = release["tag_name"]
        self.latest_release_url = release["html_url"]
        self.view_release_button.config(state="normal")

        status = classify_release(APP_VERSION, tag_name)
        if status == "available":
            self.update_status.config(
                text=f"Update available: {tag_name}",
                fg="#1a5fb4",
            )
            self._enqueue(
                "updates",
                f"{tag_name} is available; use View release to review it.",
            )
        elif status == "development":
            self.update_status.config(
                text=f"Development build—newer than published {tag_name}",
                fg="#8a6d1d",
            )
        else:
            self.update_status.config(
                text=f"Mission Control is up to date ({tag_name})",
                fg="#2a8a3a",
            )

    def _toggle_automatic_updates(self):
        enabled = self.check_updates_var.get()
        self.update_state["check_enabled"] = enabled
        self._save_update_state()

        if enabled:
            self._start_update_check(use_cache=True)
            return

        self.update_generation += 1
        self.update_checking = False
        self.check_updates_button.config(state="normal")
        self.update_status.config(text="Automatic update checks are off", fg="#666")

    def _save_update_state(self):
        try:
            save_update_state(self.update_state, self.update_state_path)
        except OSError as exc:
            self._enqueue("updates", f"couldn't save update preferences: {exc}")

    def _open_latest_release(self):
        if not self.latest_release_url:
            return
        try:
            webbrowser.open(self.latest_release_url)
        except Exception as exc:
            self._enqueue("updates", f"couldn't open the release page: {exc}")

    def _toggle(self, backend, open_dashboard):
        if backend.running():
            backend.stop()
            return

        started = backend.start()
        if started and open_dashboard and DASHBOARD.is_file():
            self.root.after(1500, self._open_dashboard)

    def _open_dashboard(self):
        if not DASHBOARD.is_file():
            self._enqueue("launcher", f"dashboard file not found at {DASHBOARD}")
            return
        try:
            webbrowser.open(DASHBOARD.as_uri() + "?autoconnect=1")
        except Exception as exc:
            self._enqueue("launcher", f"couldn't open browser: {exc}")

    def _open_project_page(self):
        try:
            webbrowser.open(PROJECT_URL)
        except Exception as exc:
            self._enqueue("launcher", f"couldn't open GitHub: {exc}")

    def _show_about(self):
        dialog = tk.Toplevel(self.root)
        dialog.title(f"About {APP_NAME}")
        dialog.transient(self.root)
        dialog.resizable(False, False)

        body = tk.Frame(dialog, padx=18, pady=16)
        body.pack(fill="both", expand=True)
        tk.Label(
            body,
            text=APP_NAME,
            font=("TkDefaultFont", 13, "bold"),
        ).pack(anchor="w")
        tk.Label(body, text=f"Version {APP_VERSION}").pack(anchor="w", pady=(2, 10))
        tk.Label(body, text=f"Created by {APP_AUTHOR}").pack(anchor="w")
        tk.Label(body, text="Released under the MIT License").pack(anchor="w")

        link = tk.Label(
            body,
            text=PROJECT_URL,
            fg="#1a5fb4",
            cursor="hand2",
        )
        link.pack(anchor="w", pady=(10, 12))
        link.bind("<Button-1>", lambda _event: self._open_project_page())

        buttons = tk.Frame(body)
        buttons.pack(fill="x")
        tk.Button(buttons, text="Open GitHub", command=self._open_project_page).pack(
            side="left"
        )
        tk.Button(buttons, text="Close", width=8, command=dialog.destroy).pack(
            side="right"
        )

        dialog.update_idletasks()
        x = self.root.winfo_rootx() + max(
            0, (self.root.winfo_width() - dialog.winfo_width()) // 2
        )
        y = self.root.winfo_rooty() + max(
            0, (self.root.winfo_height() - dialog.winfo_height()) // 2
        )
        dialog.geometry(f"+{x}+{y}")
        dialog.grab_set()
        dialog.focus_set()

    def _refresh(self):
        for backend, status, button in self.backend_rows:
            if backend.running():
                status.config(text="\u25cf running", fg="#2a8a3a")
                button.config(text="Stop")
            else:
                status.config(text="\u25cb stopped", fg="#888")
                button.config(text="Start")
        self.root.after(500, self._refresh)

    def _on_close(self):
        for backend in self.backends:
            backend.stop()
        self.root.destroy()


def _fatal(_exc):
    import traceback

    traceback_text = traceback.format_exc()
    try:
        (HERE / "launcher_error.log").write_text(traceback_text, encoding="utf-8")
    except Exception:
        pass

    try:
        import tkinter.messagebox as messagebox

        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("KSP component launcher failed", traceback_text)
        root.destroy()
    except Exception:
        print(traceback_text)


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        _fatal(exc)
