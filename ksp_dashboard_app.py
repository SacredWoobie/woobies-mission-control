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

import csv
import hashlib
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, font as tkfont, messagebox, scrolledtext, ttk


HERE = Path(__file__).resolve().parent
DASHBOARD = HERE / "ksp_mission_dashboard.html"
PYTHON = sys.executable
APP_NAME = "Woobie's Mission Control"
APP_VERSION = "0.2.3"
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


def _default_settings_path():
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "WoobiesMissionControl" / "settings.json"
    return Path.home() / ".woobies-mission-control" / "settings.json"


SETTINGS_PATH = _default_settings_path()

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

PACKAGED_GAMEDATA = HERE.parent / "GameData"
CHANGELOG_CANDIDATES = (HERE / "CHANGELOG.md", HERE.parent / "CHANGELOG.md")
SERVICE_DLLS = (
    ("KRPC.StageStats", "Stage statistics"),
    ("KRPC.SystemHeat", "System Heat / electricity"),
    ("KRPC.VesselScience", "Stored science"),
)

THEME = {
    "bg": "#080b11",
    "panel": "#0f151f",
    "panel_2": "#0b1019",
    "input": "#060a0f",
    "rule": "#1c2735",
    "rule_bright": "#2a3a4e",
    "amber": "#ffb454",
    "amber_dim": "#a9762f",
    "cyan": "#4ec9e0",
    "slate": "#7d8ba0",
    "slate_dim": "#4a5568",
    "green": "#7ee787",
    "warn": "#ff6b5b",
    "button": "#12202c",
    "button_hover": "#173040",
}
UI_FONT_FAMILY = "Consolas"
UI_FONT = (UI_FONT_FAMILY, 9)
UI_FONT_BOLD = (UI_FONT_FAMILY, 9, "bold")


def choose_ui_font_family(available_families):
    """Choose the first available dashboard-style monospaced font."""
    available = {str(name).casefold(): str(name) for name in available_families}
    for candidate in ("Cascadia Mono", "Cascadia Code", "Consolas", "Courier New"):
        match = available.get(candidate.casefold())
        if match:
            return match
    return "TkFixedFont"


def calculate_initial_window_size(
    screen_width,
    screen_height,
    requested_width,
    requested_height,
):
    """Return a roomy launcher size clamped for the current display."""
    available_width = max(640, int(screen_width) - 80)
    available_height = max(520, int(screen_height) - 120)
    desired_width = max(960, int(requested_width) + 24)
    desired_height = max(820, int(requested_height) + 12)
    return min(desired_width, available_width), min(
        desired_height, available_height
    )


def configure_dashboard_theme(root):
    """Apply a standard-library ttk theme inspired by the dashboard."""
    global UI_FONT_FAMILY, UI_FONT, UI_FONT_BOLD
    UI_FONT_FAMILY = choose_ui_font_family(tkfont.families(root))
    UI_FONT = (UI_FONT_FAMILY, 9)
    UI_FONT_BOLD = (UI_FONT_FAMILY, 9, "bold")
    root.configure(background=THEME["bg"])
    root.option_add("*Font", UI_FONT)
    style = ttk.Style(root)
    style.theme_use("clam")
    style.configure(".", font=UI_FONT)
    style.configure("TFrame", background=THEME["panel"])
    style.configure("Shell.TFrame", background=THEME["bg"])
    style.configure(
        "Card.TFrame",
        background=THEME["panel_2"],
        bordercolor=THEME["rule_bright"],
        borderwidth=1,
        relief="solid",
    )
    style.configure("CardInner.TFrame", background=THEME["panel_2"])
    style.configure(
        "TLabel", background=THEME["panel"], foreground=THEME["slate"]
    )
    style.configure(
        "Shell.TLabel", background=THEME["bg"], foreground=THEME["slate"]
    )
    style.configure(
        "Title.TLabel",
        background=THEME["bg"],
        foreground=THEME["cyan"],
        font=(UI_FONT_FAMILY, 13, "bold"),
    )
    style.configure(
        "Version.TLabel",
        background=THEME["bg"],
        foreground=THEME["amber"],
        font=UI_FONT_BOLD,
    )
    style.configure(
        "Card.TLabel", background=THEME["panel_2"], foreground=THEME["slate"]
    )
    style.configure(
        "CardTitle.TLabel",
        background=THEME["panel_2"],
        foreground=THEME["cyan"],
        font=UI_FONT_BOLD,
    )
    style.configure(
        "DialogTitle.TLabel",
        background=THEME["panel"],
        foreground=THEME["cyan"],
        font=(UI_FONT_FAMILY, 13, "bold"),
    )
    style.configure(
        "Amber.TLabel", background=THEME["panel"], foreground=THEME["amber"]
    )
    style.configure(
        "Link.TLabel", background=THEME["panel"], foreground=THEME["cyan"]
    )
    style.configure(
        "TLabelframe",
        background=THEME["panel"],
        bordercolor=THEME["rule"],
        lightcolor=THEME["rule"],
        darkcolor=THEME["rule"],
        borderwidth=1,
        relief="solid",
    )
    style.configure(
        "TLabelframe.Label",
        background=THEME["bg"],
        foreground=THEME["cyan"],
        font=UI_FONT_BOLD,
        padding=(5, 1),
    )
    style.configure(
        "TButton",
        background=THEME["button"],
        foreground=THEME["cyan"],
        bordercolor="#24485a",
        lightcolor="#24485a",
        darkcolor="#24485a",
        borderwidth=1,
        relief="solid",
        padding=(9, 5),
        focuscolor=THEME["cyan"],
    )
    style.map(
        "TButton",
        background=[("active", THEME["button_hover"]), ("pressed", "#0e2029")],
        foreground=[("disabled", THEME["slate_dim"])],
        bordercolor=[("active", "#3a6f86"), ("disabled", THEME["rule"])],
    )
    style.configure(
        "Accent.TButton",
        background="#241c0d",
        foreground=THEME["amber"],
        bordercolor=THEME["amber_dim"],
    )
    style.map("Accent.TButton", background=[("active", "#332713")])
    style.configure(
        "TCheckbutton",
        background=THEME["bg"],
        foreground=THEME["slate"],
        indicatorbackground=THEME["input"],
        indicatorforeground=THEME["cyan"],
        padding=(2, 3),
    )
    style.map(
        "TCheckbutton",
        background=[("active", THEME["bg"])],
        foreground=[("active", THEME["cyan"])],
        indicatorbackground=[("selected", THEME["cyan"])],
    )
    style.configure(
        "Panel.TCheckbutton",
        background=THEME["panel"],
        foreground=THEME["slate"],
    )
    style.map("Panel.TCheckbutton", background=[("active", THEME["panel"])])
    style.configure(
        "TEntry",
        fieldbackground=THEME["input"],
        foreground=THEME["amber"],
        insertcolor=THEME["cyan"],
        bordercolor=THEME["rule_bright"],
        lightcolor=THEME["rule_bright"],
        darkcolor=THEME["rule_bright"],
        padding=(7, 5),
    )
    style.map(
        "TEntry",
        bordercolor=[("focus", THEME["cyan"])],
        lightcolor=[("focus", THEME["cyan"])],
        darkcolor=[("focus", THEME["cyan"])],
    )
    return style


class CheckXControl(ttk.Frame):
    """A compact Boolean control with a DPI-stable drawn check or X."""

    def __init__(self, parent, variable, text, command, panel=False):
        frame_style = "TFrame" if panel else "Shell.TFrame"
        label_style = "TLabel" if panel else "Shell.TLabel"
        surface = THEME["panel"] if panel else THEME["bg"]
        super().__init__(parent, style=frame_style, takefocus=True)
        self.variable = variable
        self.command = command
        self.indicator = tk.Canvas(
            self,
            width=18,
            height=18,
            background=surface,
            highlightthickness=0,
            borderwidth=0,
            cursor="hand2",
        )
        self.indicator.pack(side="left", padx=(3, 6))
        self.label = ttk.Label(
            self,
            text=text,
            style=label_style,
            cursor="hand2",
        )
        self.label.pack(side="left")
        for widget in (self, self.indicator, self.label):
            widget.bind("<Button-1>", self._toggle)
        self.bind("<space>", self._toggle)
        self.bind("<Return>", self._toggle)
        self.bind("<FocusIn>", lambda _event: self._draw(focused=True))
        self.bind("<FocusOut>", lambda _event: self._draw(focused=False))
        self.variable.trace_add("write", lambda *_args: self._draw())
        self._draw()

    def _toggle(self, _event=None):
        self.focus_set()
        self.variable.set(not self.variable.get())
        self.command()
        return "break"

    def _draw(self, focused=False):
        canvas = self.indicator
        canvas.delete("all")
        selected = self.variable.get()
        outline = THEME["cyan"] if selected else THEME["amber_dim"]
        if focused:
            outline = THEME["amber"]
        canvas.create_rectangle(2, 2, 16, 16, outline=outline, width=1)
        if selected:
            canvas.create_line(
                5,
                9,
                8,
                12,
                14,
                5,
                fill=THEME["green"],
                width=2,
                capstyle="round",
                joinstyle="round",
            )
        else:
            canvas.create_line(
                6,
                6,
                12,
                12,
                fill=THEME["warn"],
                width=2,
                capstyle="round",
            )
            canvas.create_line(
                12,
                6,
                6,
                12,
                fill=THEME["warn"],
                width=2,
                capstyle="round",
            )


def _default_backup_root():
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "WoobiesMissionControl" / "dll_backups"
    return Path.home() / ".woobies-mission-control" / "dll_backups"


DLL_BACKUP_ROOT = _default_backup_root()


def find_changelog_path(candidates=CHANGELOG_CANDIDATES):
    """Return the first packaged or source-tree changelog, if available."""
    for candidate in candidates:
        path = Path(candidate)
        if path.is_file():
            return path.resolve()
    return None


def load_changelog(path=None):
    """Load the UTF-8 changelog or return an empty string on read failure."""
    path = Path(path) if path is not None else find_changelog_path()
    if path is None:
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def extract_version_changelog(changelog, version):
    """Return one Markdown version section, including its heading."""
    if not isinstance(changelog, str) or not changelog.strip():
        return ""
    pattern = re.compile(
        rf"(?ms)^## v{re.escape(version)}[^\r\n]*\r?\n"
        rf".*?(?=^## v\d|\Z)"
    )
    match = pattern.search(changelog)
    return match.group(0).strip() if match else ""


def should_show_changelog(state, version=APP_VERSION, changelog_available=True):
    """Return whether this launcher version should show What's New once."""
    if not changelog_available or not isinstance(state, dict):
        return False
    if state.get("show_changelog_on_update", True) is False:
        return False
    return state.get("last_changelog_version") != version


def sha256_file(path):
    """Return the lowercase SHA-256 digest for *path*."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def service_inventory(ksp_root_value, packaged_gamedata=PACKAGED_GAMEDATA):
    """Describe packaged and installed Mission Control service DLLs."""
    if isinstance(ksp_root_value, os.PathLike):
        ksp_root_value = os.fspath(ksp_root_value)
    root = resolve_ksp_root(ksp_root_value)
    packaged_gamedata = Path(packaged_gamedata).resolve()
    inventory = []
    for folder, title in SERVICE_DLLS:
        relative_path = Path(folder) / f"{folder}.dll"
        source = packaged_gamedata / relative_path
        target = root / "GameData" / relative_path if root is not None else None
        source_hash = sha256_file(source) if source.is_file() else None
        target_hash = (
            sha256_file(target)
            if target is not None and target.is_file()
            else None
        )
        if root is None:
            status = "unconfigured"
        elif source_hash is None:
            status = "package_missing"
        elif target_hash is None:
            status = "missing"
        elif source_hash == target_hash:
            status = "current"
        else:
            status = "different"
        inventory.append(
            {
                "folder": folder,
                "title": title,
                "relative_path": relative_path,
                "source": source,
                "target": target,
                "source_hash": source_hash,
                "target_hash": target_hash,
                "status": status,
            }
        )
    return inventory


def running_ksp_processes(tasklist_runner=None):
    """Return supported KSP process names currently running on Windows."""
    if os.name != "nt":
        return []
    if tasklist_runner is None:
        def tasklist_runner():
            result = subprocess.run(
                ["tasklist", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                check=False,
                creationflags=CREATE_NO_WINDOW,
            )
            if result.returncode != 0:
                raise OSError("tasklist could not enumerate running processes")
            return result.stdout
    try:
        output = tasklist_runner()
        rows = csv.reader(output.splitlines())
        names = {
            row[0].strip().lower()
            for row in rows
            if row and row[0].strip()
        }
    except (OSError, csv.Error) as exc:
        raise RuntimeError(
            "Unable to verify whether KSP is running; no DLLs were changed."
        ) from exc
    return [
        name
        for name in ("KSP_x64.exe", "KSP.exe")
        if name.lower() in names
    ]


class ServiceRollbackError(RuntimeError):
    """Raised when an install fails and automatic restoration is incomplete."""


def install_service_dlls(
    ksp_root_value,
    packaged_gamedata=PACKAGED_GAMEDATA,
    backup_root=DLL_BACKUP_ROOT,
    running_process_provider=running_ksp_processes,
):
    """Install missing or changed service DLLs with backup and rollback."""
    if isinstance(ksp_root_value, os.PathLike):
        ksp_root_value = os.fspath(ksp_root_value)
    root = resolve_ksp_root(ksp_root_value)
    if root is None:
        raise ValueError("Choose a valid KSP folder before installing services.")

    running = running_process_provider()
    if running:
        raise RuntimeError(
            "Close KSP before installing service DLLs. Running: "
            + ", ".join(running)
        )

    inventory = service_inventory(root, packaged_gamedata)
    missing_sources = [item for item in inventory if item["source_hash"] is None]
    if missing_sources:
        names = ", ".join(item["folder"] for item in missing_sources)
        raise FileNotFoundError(f"Packaged service DLLs are missing: {names}")

    changes = [
        item for item in inventory if item["status"] in {"missing", "different"}
    ]
    if not changes:
        return {"installed": [], "backup_dir": None}

    game_data = (root / "GameData").resolve()
    for item in changes:
        target = item["target"]
        if target is None or not target.resolve().is_relative_to(game_data):
            raise ValueError(f"Unsafe service destination: {target}")

    stamp = (
        time.strftime("%Y%m%d-%H%M%S")
        + f"-{time.time_ns() % 1_000_000_000:09d}-{os.getpid()}"
    )
    backup_dir = Path(backup_root).resolve() / stamp
    prior_files = {}
    staged_files = []
    changed_targets = []

    try:
        for item in changes:
            target = item["target"]
            relative_path = item["relative_path"]
            prior_files[target] = target.is_file()
            if target.is_file():
                backup = backup_dir / relative_path
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, backup)

            target.parent.mkdir(parents=True, exist_ok=True)
            staged = target.with_name(target.name + ".woobie-install.tmp")
            staged_files.append(staged)
            shutil.copy2(item["source"], staged)
            if sha256_file(staged) != item["source_hash"]:
                raise OSError(f"Copy verification failed for {item['folder']}")

        for item, staged in zip(changes, staged_files):
            os.replace(staged, item["target"])
            changed_targets.append(item["target"])
            if sha256_file(item["target"]) != item["source_hash"]:
                raise OSError(f"Install verification failed for {item['folder']}")
    except Exception as install_error:
        rollback_errors = []
        for staged in staged_files:
            try:
                staged.unlink(missing_ok=True)
            except OSError as exc:
                rollback_errors.append(f"temporary cleanup {staged}: {exc}")
        for target in reversed(changed_targets):
            relative_path = target.relative_to(game_data)
            backup = backup_dir / relative_path
            try:
                if prior_files[target]:
                    if not backup.is_file():
                        raise FileNotFoundError(f"backup not found at {backup}")
                    shutil.copy2(backup, target)
                elif not prior_files[target]:
                    target.unlink(missing_ok=True)
            except OSError as exc:
                rollback_errors.append(f"restore {target}: {exc}")
        if rollback_errors:
            details = "\n".join(f"- {item}" for item in rollback_errors)
            raise ServiceRollbackError(
                f"Installation failed: {install_error}\n\n"
                "Automatic rollback was incomplete. Manual restoration may "
                f"be required.\nBackups: {backup_dir}\n\n{details}"
            ) from install_error
        raise

    return {
        "installed": [item["folder"] for item in changes],
        "backup_dir": backup_dir if backup_dir.is_dir() else None,
    }


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


def load_settings(path=SETTINGS_PATH):
    """Load launcher settings, returning safe defaults on any error."""
    try:
        settings = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {"ksp_root": ""}
    if not isinstance(settings, dict):
        return {"ksp_root": ""}
    root = settings.get("ksp_root")
    return {"ksp_root": root.strip() if isinstance(root, str) else ""}


def save_settings(settings, path=SETTINGS_PATH):
    """Atomically save user-selected launcher settings."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(settings, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def resolve_ksp_root(value):
    """Return a validated KSP root containing GameData, or ``None``."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        candidate = Path(os.path.expandvars(value.strip())).expanduser().resolve()
        if candidate.is_dir() and (candidate / "GameData").is_dir():
            return candidate
    except (OSError, RuntimeError):
        pass
    return None


def telemetry_environment(ksp_root_value):
    """Return the child-process environment override for telemetry."""
    root = resolve_ksp_root(ksp_root_value)
    return {"WOOBIE_KSP_ROOT": str(root)} if root is not None else {}


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

    def __init__(self, name, script, log, environment_provider=None):
        self.name = name
        self.script = Path(script)
        self.argv = [PYTHON, "-u", str(self.script)]
        self.log = log
        self.environment_provider = environment_provider
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
            child_environment = os.environ.copy()
            if self.environment_provider is not None:
                child_environment.update(self.environment_provider())
            self.proc = subprocess.Popen(
                self.argv,
                cwd=str(HERE),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                creationflags=CREATE_NO_WINDOW,
                env=child_environment,
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
    def __init__(self, root, update_state_path=UPDATE_STATE_PATH,
                 settings_path=SETTINGS_PATH):
        self.root = root
        self.log_queue = queue.Queue()
        self.update_queue = queue.Queue()
        self.backends = []
        self.backend_rows = []
        self.update_state_path = Path(update_state_path)
        self.update_state = load_update_state(self.update_state_path)
        self.settings_path = Path(settings_path)
        self.settings = load_settings(self.settings_path)
        self.update_generation = 0
        self.update_checking = False
        self.latest_release_url = None
        self.changelog_path = find_changelog_path()
        self.changelog_dialog = None

        self.style = configure_dashboard_theme(root)
        root.title(f"{APP_NAME} v{APP_VERSION}")
        root.protocol("WM_DELETE_WINDOW", self._on_close)

        header = ttk.Frame(root, style="Shell.TFrame")
        header.pack(fill="x", padx=14, pady=(14, 4))
        ttk.Label(
            header,
            text=APP_NAME.upper(),
            anchor="w",
            style="Title.TLabel",
        ).pack(side="left")
        ttk.Label(
            header, text=f"  //  v{APP_VERSION}", style="Version.TLabel"
        ).pack(side="left")
        ttk.Button(header, text="ABOUT", width=9, command=self._show_about).pack(
            side="right"
        )

        update_bar = ttk.Frame(root, style="Shell.TFrame")
        update_bar.pack(fill="x", padx=14, pady=(2, 7))
        self.update_status = ttk.Label(
            update_bar,
            text="Update status: waiting",
            foreground=THEME["slate_dim"],
            anchor="w",
            style="Shell.TLabel",
        )
        self.update_status.pack(side="left", fill="x", expand=True)
        self.view_release_button = ttk.Button(
            update_bar,
            text="View release",
            state="disabled",
            command=self._open_latest_release,
        )
        self.view_release_button.pack(side="right", padx=(4, 0))
        self.changelog_button = ttk.Button(
            update_bar,
            text="Changelog",
            state="normal" if self.changelog_path is not None else "disabled",
            command=lambda: self._show_changelog(current_version_only=False),
        )
        self.changelog_button.pack(side="right", padx=(4, 0))
        self.check_updates_button = ttk.Button(
            update_bar,
            text="Check now",
            command=lambda: self._start_update_check(use_cache=False),
        )
        self.check_updates_button.pack(side="right", padx=(4, 0))
        self.check_updates_var = tk.BooleanVar(
            value=self.update_state.get("check_enabled", True) is not False
        )
        self.check_updates_control = CheckXControl(
            update_bar,
            self.check_updates_var,
            "AUTOMATIC UPDATE CHECKS",
            self._toggle_automatic_updates,
        )
        self.check_updates_control.pack(side="right", padx=(6, 0))

        settings_frame = ttk.LabelFrame(root, text="KSP INSTALLATION")
        settings_controls = ttk.Frame(settings_frame)
        settings_controls.pack(fill="x", padx=8, pady=(8, 2))
        ttk.Label(
            settings_controls, text="KSP FOLDER", width=12, anchor="w"
        ).pack(
            side="left"
        )
        self.ksp_root_var = tk.StringVar(value=self.settings.get("ksp_root", ""))
        self.ksp_root_entry = ttk.Entry(
            settings_controls, textvariable=self.ksp_root_var
        )
        self.ksp_root_entry.pack(side="left", fill="x", expand=True, padx=(0, 6))
        self.ksp_root_entry.bind("<Return>", self._commit_ksp_root)
        self.ksp_root_entry.bind("<FocusOut>", self._commit_ksp_root)
        ttk.Button(
            settings_controls, text="Browse...", command=self._browse_ksp_root
        ).pack(side="right")
        self.ksp_root_status = ttk.Label(
            settings_frame,
            anchor="w",
            justify="left",
            foreground=THEME["slate_dim"],
        )
        self.ksp_root_status.pack(fill="x", padx=9, pady=(0, 4))

        services = ttk.Frame(
            settings_frame, style="Card.TFrame", padding=(14, 12)
        )
        services.pack(fill="x", padx=9, pady=(2, 8))
        services_header = ttk.Frame(services, style="CardInner.TFrame")
        services_header.pack(fill="x", pady=(0, 6))
        ttk.Label(
            services_header,
            text="MISSION CONTROL KSP SERVICES",
            anchor="w",
            style="CardTitle.TLabel",
        ).pack(side="left")
        self.service_summary = ttk.Label(
            services_header,
            text="Checking...",
            foreground=THEME["slate_dim"],
            anchor="e",
            style="Card.TLabel",
        )
        self.service_summary.pack(side="right")

        self.service_status_labels = {}
        for folder, title in SERVICE_DLLS:
            row = ttk.Frame(services, style="CardInner.TFrame")
            row.pack(fill="x", pady=2)
            ttk.Label(row, text=title, anchor="w", style="Card.TLabel").pack(
                side="left", fill="x", expand=True
            )
            status = ttk.Label(
                row,
                text="Checking...",
                width=20,
                anchor="e",
                style="Card.TLabel",
            )
            status.pack(side="right")
            self.service_status_labels[folder] = status

        service_buttons = ttk.Frame(services, style="CardInner.TFrame")
        service_buttons.pack(fill="x", pady=(10, 0))
        self.install_services_button = ttk.Button(
            service_buttons,
            text="Install / Repair",
            state="disabled",
            command=self._install_or_repair_services,
            style="Accent.TButton",
        )
        self.install_services_button.pack(side="left")
        ttk.Button(
            service_buttons,
            text="Refresh status",
            command=self._refresh_service_status,
        ).pack(side="left", padx=(6, 0))
        self.open_gamedata_button = ttk.Button(
            service_buttons,
            text="Open GameData",
            state="disabled",
            command=self._open_gamedata,
        )
        self.open_gamedata_button.pack(side="right")
        self.open_packaged_dlls_button = ttk.Button(
            service_buttons,
            text="Open Packaged DLLs",
            state="normal" if PACKAGED_GAMEDATA.is_dir() else "disabled",
            command=self._open_packaged_dlls,
        )
        self.open_packaged_dlls_button.pack(side="right", padx=(0, 6))
        self._refresh_ksp_root_status()

        components = discover_components()
        if components:
            for component in components:
                self._add_component(component)
        else:
            empty = ttk.LabelFrame(root, text="COMPONENTS")
            empty.pack(fill="x", padx=14, pady=6)
            ttk.Label(
                empty,
                text="No supported Python components were found beside this launcher.",
                anchor="w",
            ).pack(fill="x", padx=10, pady=12)

        settings_frame.pack(fill="x", padx=14, pady=6)

        log_frame = ttk.LabelFrame(root, text="MISSION LOG")
        log_frame.pack(fill="both", expand=True, padx=14, pady=(6, 12))
        self.logbox = scrolledtext.ScrolledText(
            log_frame,
            height=10,
            state="disabled",
            wrap="word",
            font=UI_FONT,
            background=THEME["input"],
            foreground=THEME["amber"],
            insertbackground=THEME["cyan"],
            selectbackground="#24485a",
            selectforeground="#eef3f8",
            borderwidth=0,
            relief="flat",
            padx=8,
            pady=7,
        )
        self.logbox.pack(fill="both", expand=True, padx=7, pady=7)

        self._apply_initial_window_geometry()

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
        self.root.after(700, self._maybe_show_changelog)

    def _apply_initial_window_geometry(self):
        self.root.update_idletasks()
        width, height = calculate_initial_window_size(
            self.root.winfo_screenwidth(),
            self.root.winfo_screenheight(),
            self.root.winfo_reqwidth(),
            self.root.winfo_reqheight(),
        )
        self.root.minsize(min(900, width), min(640, height))
        x = max(0, (self.root.winfo_screenwidth() - width) // 2)
        y = max(0, (self.root.winfo_screenheight() - height) // 3)
        self.root.geometry(f"{width}x{height}+{x}+{y}")

    def _add_component(self, component):
        script = HERE / component["script"]
        environment_provider = (
            self._telemetry_environment if component["name"] == "feed" else None
        )
        backend = Backend(
            component["name"], script, self._enqueue, environment_provider
        )

        frame = ttk.LabelFrame(self.root, text=component["title"].upper())
        frame.pack(fill="x", padx=14, pady=6)

        controls = ttk.Frame(frame)
        controls.pack(fill="x", padx=8, pady=(8, 2))

        status = ttk.Label(
            controls,
            text="\u25cb stopped",
            foreground=THEME["slate_dim"],
            width=14,
            anchor="w",
        )
        status.pack(side="left")

        button = ttk.Button(
            controls,
            text="Start",
            width=9,
            command=lambda be=backend, opens=component["dashboard"]: self._toggle(
                be, opens
            ),
        )
        button.pack(side="left", padx=4)

        if component["dashboard"] and DASHBOARD.is_file():
            ttk.Button(
                controls,
                text="Open dashboard",
                command=self._open_dashboard,
            ).pack(side="left", padx=4)

        ttk.Label(
            frame,
            text=component["description"],
            foreground=THEME["slate"],
            anchor="w",
            justify="left",
        ).pack(fill="x", padx=9, pady=(0, 8))

        self.backends.append(backend)
        self.backend_rows.append((backend, status, button))

    def _telemetry_environment(self):
        return telemetry_environment(self.ksp_root_var.get())

    def _refresh_ksp_root_status(self):
        raw = self.ksp_root_var.get().strip()
        root = resolve_ksp_root(raw)
        if root is not None:
            notes_variants = (
                root / "GameData" / "Notes" / "Plugins" / "PluginData" / "notes",
                root / "GameData" / "notes" / "Plugins" / "PluginData" / "notes",
            )
            notes_installed = any(path.is_dir() for path in notes_variants)
            text = "KSP folder ready"
            if notes_installed:
                text += " - Notes mod detected"
            else:
                text += " - Notes mod not detected (optional)"
            self.ksp_root_status.config(text=text, foreground=THEME["green"])
        elif raw:
            self.ksp_root_status.config(
                text="Choose the KSP folder that contains GameData.",
                foreground=THEME["warn"],
            )
        else:
            self.ksp_root_status.config(
                text="Optional: configure this to enable the Notes ship-log drawer.",
                foreground=THEME["slate_dim"],
            )
        if hasattr(self, "service_status_labels"):
            self._refresh_service_status()

    def _refresh_service_status(self):
        root = resolve_ksp_root(self.ksp_root_var.get())
        inventory = service_inventory(self.ksp_root_var.get())
        presentation = {
            "unconfigured": ("KSP folder required", THEME["slate_dim"]),
            "package_missing": ("Not in this package", THEME["warn"]),
            "missing": ("Missing", THEME["warn"]),
            "different": ("Repair available", THEME["amber"]),
            "current": ("Current", THEME["green"]),
        }
        counts = {}
        for item in inventory:
            counts[item["status"]] = counts.get(item["status"], 0) + 1
            text, color = presentation[item["status"]]
            self.service_status_labels[item["folder"]].config(
                text=text, foreground=color
            )

        needs_install = counts.get("missing", 0) + counts.get("different", 0)
        package_missing = counts.get("package_missing", 0)
        if root is None:
            summary_text = "Choose a KSP folder"
            summary_color = THEME["slate_dim"]
        elif package_missing:
            summary_text = "Package incomplete"
            summary_color = THEME["warn"]
        elif needs_install:
            summary_text = f"{needs_install} service update(s) ready"
            summary_color = THEME["amber"]
        else:
            summary_text = "All services current"
            summary_color = THEME["green"]
        self.service_summary.config(text=summary_text, foreground=summary_color)
        self.install_services_button.config(
            text=(
                f"Install / Repair ({needs_install})"
                if needs_install
                else "Install / Repair"
            ),
            state=(
                "normal"
                if root is not None and needs_install and not package_missing
                else "disabled"
            ),
        )
        self.open_gamedata_button.config(
            state="normal" if root is not None else "disabled"
        )

    def _install_or_repair_services(self):
        if not self._save_ksp_root():
            return
        inventory = service_inventory(self.ksp_root_var.get())
        changes = [
            item
            for item in inventory
            if item["status"] in {"missing", "different"}
        ]
        if not changes:
            messagebox.showinfo(
                "KSP services",
                "All packaged Mission Control service DLLs are already current.",
                parent=self.root,
            )
            return

        action_lines = "\n".join(
            f"  - {item['title']}: "
            + ("install" if item["status"] == "missing" else "replace")
            for item in changes
        )
        confirmed = messagebox.askyesno(
            "Install / Repair KSP services",
            "Close Kerbal Space Program before continuing.\n\n"
            "The launcher will make these changes:\n"
            f"{action_lines}\n\n"
            "Existing DLLs will be backed up. No other GameData files "
            "will be changed.\n\nContinue?",
            parent=self.root,
            icon="warning",
        )
        if not confirmed:
            return

        try:
            result = install_service_dlls(self.ksp_root_var.get())
        except PermissionError as exc:
            self._enqueue("services", f"install denied: {exc}")
            messagebox.showerror(
                "KSP services",
                "Windows denied access to the KSP GameData folder. Check the "
                "folder permissions or run the launcher as administrator.",
                parent=self.root,
            )
            return
        except (OSError, ValueError, RuntimeError) as exc:
            self._enqueue("services", f"install failed: {exc}")
            messagebox.showerror("KSP services", str(exc), parent=self.root)
            self._refresh_service_status()
            return

        self._refresh_service_status()
        installed = ", ".join(result["installed"])
        backup = result["backup_dir"]
        details = f"Installed and verified: {installed}."
        if backup is not None:
            details += f"\n\nBackups: {backup}"
        self._enqueue("services", details.replace("\n\n", " "))
        messagebox.showinfo("KSP services", details, parent=self.root)

    def _open_gamedata(self):
        root = resolve_ksp_root(self.ksp_root_var.get())
        if root is None:
            return
        self._open_folder(root / "GameData", "GameData")

    def _open_packaged_dlls(self):
        self._open_folder(PACKAGED_GAMEDATA, "packaged DLLs")

    def _open_folder(self, path, description):
        path = Path(path)
        if not path.is_dir():
            self._enqueue("services", f"{description} folder not found at {path}")
            return
        try:
            if os.name == "nt":
                os.startfile(path)
            else:
                webbrowser.open(path.as_uri())
        except OSError as exc:
            self._enqueue("services", f"couldn't open {description}: {exc}")

    def _save_ksp_root(self):
        raw = self.ksp_root_var.get().strip()
        root = resolve_ksp_root(raw)
        if raw and root is None:
            self._refresh_ksp_root_status()
            return False
        self.settings["ksp_root"] = str(root) if root is not None else ""
        self.ksp_root_var.set(self.settings["ksp_root"])
        try:
            save_settings(self.settings, self.settings_path)
        except OSError as exc:
            self._enqueue("launcher", f"couldn't save KSP folder: {exc}")
            return False
        self._refresh_ksp_root_status()
        return True

    def _commit_ksp_root(self, _event=None):
        self._save_ksp_root()

    def _browse_ksp_root(self):
        current = resolve_ksp_root(self.ksp_root_var.get())
        selected = filedialog.askdirectory(
            parent=self.root,
            title="Select the Kerbal Space Program folder",
            initialdir=str(current or HERE),
            mustexist=True,
        )
        if not selected:
            return
        self.ksp_root_var.set(selected)
        self._save_ksp_root()

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
            cached_app_version = self.update_state.get("app_version")
            if (
                isinstance(cached_app_version, str)
                and cached_app_version != APP_VERSION
            ):
                self._enqueue(
                    "updates",
                    f"launcher changed from v{cached_app_version} to "
                    f"v{APP_VERSION}; bypassing the 24-hour cache.",
                )

        self.update_generation += 1
        generation = self.update_generation
        self.update_checking = True
        self.update_status.config(
            text="Checking GitHub for updates...", foreground=THEME["slate"]
        )
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
                        foreground=THEME["slate_dim"],
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
                foreground=THEME["cyan"],
            )
            self._enqueue(
                "updates",
                f"{tag_name} is available; use View release to review it.",
            )
        elif status == "development":
            self.update_status.config(
                text=f"Development build—newer than published {tag_name}",
                foreground=THEME["amber"],
            )
        else:
            self.update_status.config(
                text=f"Mission Control is up to date ({tag_name})",
                foreground=THEME["green"],
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
        self.update_status.config(
            text="Automatic update checks are off",
            foreground=THEME["slate_dim"],
        )

    def _save_update_state(self):
        try:
            save_update_state(self.update_state, self.update_state_path)
        except OSError as exc:
            self._enqueue("updates", f"couldn't save update preferences: {exc}")

    def _maybe_show_changelog(self):
        changelog = load_changelog(self.changelog_path)
        current_notes = extract_version_changelog(changelog, APP_VERSION)
        if should_show_changelog(
            self.update_state,
            APP_VERSION,
            changelog_available=bool(current_notes),
        ):
            self._show_changelog(current_version_only=True)

    def _show_changelog(self, current_version_only=False):
        changelog = load_changelog(self.changelog_path)
        if not changelog:
            messagebox.showerror(
                "Changelog",
                "The changelog is not available in this package.",
                parent=self.root,
            )
            return

        current_notes = extract_version_changelog(changelog, APP_VERSION)
        content = current_notes if current_version_only and current_notes else changelog
        heading = (
            f"What's new in v{APP_VERSION}"
            if current_version_only and current_notes
            else "Mission Control changelog"
        )

        if self.changelog_dialog is not None:
            try:
                if self.changelog_dialog.winfo_exists():
                    self._populate_changelog(heading, content)
                    self.changelog_dialog.deiconify()
                    self.changelog_dialog.lift()
                    self.changelog_dialog.focus_set()
                    return
            except tk.TclError:
                self.changelog_dialog = None

        dialog = tk.Toplevel(self.root)
        self.changelog_dialog = dialog
        dialog.title(f"Changelog - {APP_NAME}")
        dialog.transient(self.root)
        dialog.geometry("720x520")
        dialog.minsize(580, 380)
        dialog.configure(background=THEME["bg"])

        body = ttk.Frame(dialog, padding=(16, 14))
        body.pack(fill="both", expand=True, padx=1, pady=1)
        self.changelog_heading = ttk.Label(
            body,
            text=heading,
            anchor="w",
            style="DialogTitle.TLabel",
        )
        self.changelog_heading.pack(fill="x", pady=(0, 8))

        self.changelog_text = scrolledtext.ScrolledText(
            body,
            wrap="word",
            state="disabled",
            font=UI_FONT,
            background=THEME["input"],
            foreground=THEME["amber"],
            insertbackground=THEME["cyan"],
            selectbackground="#24485a",
            selectforeground="#eef3f8",
            borderwidth=1,
            relief="solid",
            padx=10,
            pady=8,
        )
        self.changelog_text.pack(fill="both", expand=True)
        self.changelog_text.tag_configure(
            "heading",
            font=(UI_FONT_FAMILY, 11, "bold"),
            foreground=THEME["cyan"],
            spacing1=8,
            spacing3=4,
        )
        self.changelog_text.tag_configure(
            "bullet",
            foreground=THEME["amber"],
            lmargin1=10,
            lmargin2=28,
            spacing3=3,
        )

        footer = ttk.Frame(body)
        footer.pack(fill="x", pady=(10, 0))
        self.show_changelog_var = tk.BooleanVar(
            value=self.update_state.get("show_changelog_on_update", True) is not False
        )
        CheckXControl(
            footer,
            self.show_changelog_var,
            "SHOW WHAT'S NEW AFTER FUTURE UPDATES",
            self._toggle_changelog_on_update,
            panel=True,
        ).pack(side="left")
        ttk.Button(
            footer, text="Close", width=9, command=self._close_changelog
        ).pack(side="right")

        dialog.protocol("WM_DELETE_WINDOW", self._close_changelog)
        self._populate_changelog(heading, content)

        self.update_state["last_changelog_version"] = APP_VERSION
        self.update_state.setdefault("show_changelog_on_update", True)
        self._save_update_state()

        dialog.update_idletasks()
        x = self.root.winfo_rootx() + max(
            0, (self.root.winfo_width() - dialog.winfo_width()) // 2
        )
        y = self.root.winfo_rooty() + max(
            0, (self.root.winfo_height() - dialog.winfo_height()) // 2
        )
        dialog.geometry(f"{dialog.winfo_width()}x{dialog.winfo_height()}+{x}+{y}")
        dialog.grab_set()
        dialog.focus_set()

    def _populate_changelog(self, heading, content):
        self.changelog_heading.config(text=heading)
        widget = self.changelog_text
        widget.config(state="normal")
        widget.delete("1.0", "end")
        for line in content.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                widget.insert("end", stripped.lstrip("# ") + "\n", "heading")
            elif stripped.startswith("- "):
                widget.insert("end", "\u2022 " + stripped[2:] + "\n", "bullet")
            else:
                widget.insert("end", line + "\n")
        widget.config(state="disabled")
        widget.yview_moveto(0)

    def _toggle_changelog_on_update(self):
        self.update_state["show_changelog_on_update"] = self.show_changelog_var.get()
        self._save_update_state()

    def _close_changelog(self):
        dialog = self.changelog_dialog
        self.changelog_dialog = None
        if dialog is not None:
            dialog.destroy()

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
        dialog.configure(background=THEME["bg"])

        body = ttk.Frame(dialog, padding=(18, 16))
        body.pack(fill="both", expand=True, padx=1, pady=1)
        ttk.Label(
            body,
            text=APP_NAME.upper(),
            style="DialogTitle.TLabel",
        ).pack(anchor="w")
        ttk.Label(
            body, text=f"Version {APP_VERSION}", style="Amber.TLabel"
        ).pack(anchor="w", pady=(2, 10))
        ttk.Label(body, text=f"Created by {APP_AUTHOR}").pack(anchor="w")
        ttk.Label(body, text="Released under the MIT License").pack(anchor="w")

        link = ttk.Label(
            body,
            text=PROJECT_URL,
            cursor="hand2",
            style="Link.TLabel",
        )
        link.pack(anchor="w", pady=(10, 12))
        link.bind("<Button-1>", lambda _event: self._open_project_page())

        buttons = ttk.Frame(body)
        buttons.pack(fill="x")
        ttk.Button(
            buttons, text="Open GitHub", command=self._open_project_page
        ).pack(side="left")
        ttk.Button(buttons, text="Close", width=8, command=dialog.destroy).pack(
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
                status.config(text="\u25cf running", foreground=THEME["green"])
                button.config(text="Stop")
            else:
                status.config(
                    text="\u25cb stopped", foreground=THEME["slate_dim"]
                )
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
