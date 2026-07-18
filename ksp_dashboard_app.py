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
import ctypes
import hashlib
import json
import os
import queue
import re
import shutil
import socket
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
APP_VERSION = "0.2.4"
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
SERVICE_TESTED_VERSIONS = {
    "KRPC.StageStats": "0.2.0",
    "KRPC.SystemHeat": "0.2.0",
    "KRPC.VesselScience": "0.1.0",
}
KSP_TESTED_VERSION = "1.12.5"
CORE_DLL_LOCATIONS = {
    "KRPC.dll": Path("kRPC") / "KRPC.dll",
    "KRPC.MechJeb.dll": Path("kRPC") / "KRPC.MechJeb.dll",
    "MechJeb2.dll": Path("MechJeb2") / "Plugins" / "MechJeb2.dll",
    "KRPC.StageStats.dll": Path("KRPC.StageStats") / "KRPC.StageStats.dll",
    "KRPC.SystemHeat.dll": Path("KRPC.SystemHeat") / "KRPC.SystemHeat.dll",
    "KRPC.VesselScience.dll": (
        Path("KRPC.VesselScience") / "KRPC.VesselScience.dll"
    ),
}
KRPC_ADDRESS = "127.0.0.1"
KRPC_RPC_PORT = 50000
KRPC_STREAM_PORT = 50001
DASHBOARD_FEED_PORT = 8090
KRPC_CONNECTED_EVENT = "WOOBIE_EVENT:KRPC_CONNECTED"
KRPC_RETRY_EXHAUSTED_EVENT = "WOOBIE_EVENT:KRPC_RETRY_EXHAUSTED"
KRPC_SETTINGS_PATH = Path("kRPC") / "PluginData" / "settings.cfg"
KRPC_SERVICE_ATTRIBUTES = (
    ("space_center", "SpaceCenter"),
    ("mech_jeb", "MechJeb"),
    ("stage_stats", "StageStats"),
    ("system_heat", "SystemHeat"),
    ("vessel_science", "VesselScience"),
)
KSP_PREREQUISITES = (
    {
        "key": "krpc",
        "title": "kRPC",
        "relative_path": Path("kRPC") / "KRPC.dll",
        "tested_version": "0.5.4",
        "required": True,
    },
    {
        "key": "krpc_mechjeb",
        "title": "KRPC.MechJeb",
        "relative_path": Path("kRPC") / "KRPC.MechJeb.dll",
        "tested_version": "0.7.1",
        "required": False,
    },
    {
        "key": "mechjeb",
        "title": "MechJeb 2",
        "relative_path": Path("MechJeb2") / "Plugins" / "MechJeb2.dll",
        "tested_version": "2.14.3.0",
        "required": False,
    },
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


def read_windows_file_version(path):
    """Return a Windows DLL's fixed file version without loading the assembly."""
    if os.name != "nt":
        return None
    path = Path(path)
    if not path.is_file():
        return None

    class VSFixedFileInfo(ctypes.Structure):
        _fields_ = [
            ("signature", ctypes.c_uint32),
            ("struct_version", ctypes.c_uint32),
            ("file_version_ms", ctypes.c_uint32),
            ("file_version_ls", ctypes.c_uint32),
            ("product_version_ms", ctypes.c_uint32),
            ("product_version_ls", ctypes.c_uint32),
            ("file_flags_mask", ctypes.c_uint32),
            ("file_flags", ctypes.c_uint32),
            ("file_os", ctypes.c_uint32),
            ("file_type", ctypes.c_uint32),
            ("file_subtype", ctypes.c_uint32),
            ("file_date_ms", ctypes.c_uint32),
            ("file_date_ls", ctypes.c_uint32),
        ]

    try:
        library = ctypes.WinDLL("version", use_last_error=True)
        get_size = library.GetFileVersionInfoSizeW
        get_size.argtypes = [ctypes.c_wchar_p, ctypes.c_void_p]
        get_size.restype = ctypes.c_uint32
        get_info = library.GetFileVersionInfoW
        get_info.argtypes = [
            ctypes.c_wchar_p,
            ctypes.c_uint32,
            ctypes.c_uint32,
            ctypes.c_void_p,
        ]
        get_info.restype = ctypes.c_int
        query_value = library.VerQueryValueW
        query_value.argtypes = [
            ctypes.c_void_p,
            ctypes.c_wchar_p,
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.POINTER(ctypes.c_uint32),
        ]
        query_value.restype = ctypes.c_int

        size = get_size(str(path), None)
        if not size:
            return None
        buffer = ctypes.create_string_buffer(size)
        if not get_info(str(path), 0, size, buffer):
            return None
        value_pointer = ctypes.c_void_p()
        value_length = ctypes.c_uint32()
        if not query_value(
            buffer, "\\", ctypes.byref(value_pointer), ctypes.byref(value_length)
        ):
            return None
        fixed = ctypes.cast(
            value_pointer, ctypes.POINTER(VSFixedFileInfo)
        ).contents
        if fixed.signature != 0xFEEF04BD:
            return None
        parts = (
            fixed.file_version_ms >> 16,
            fixed.file_version_ms & 0xFFFF,
            fixed.file_version_ls >> 16,
            fixed.file_version_ls & 0xFFFF,
        )
        return ".".join(str(part) for part in parts)
    except (AttributeError, OSError, ValueError):
        return None


def read_avc_version(path):
    """Return a dotted version from a KSP-AVC JSON file, if available."""
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8-sig"))
        version = payload["VERSION"]
        parts = [version[name] for name in ("MAJOR", "MINOR", "PATCH")]
        if "BUILD" in version:
            parts.append(version["BUILD"])
        if not all(isinstance(part, int) and part >= 0 for part in parts):
            return None
        return ".".join(str(part) for part in parts)
    except (OSError, KeyError, TypeError, ValueError):
        return None


def _version_tuple(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d+(?:\.\d+)+", value):
        return None
    parts = [int(part) for part in value.split(".")]
    while len(parts) > 1 and parts[-1] == 0:
        parts.pop()
    return tuple(parts)


def versions_equivalent(left, right):
    """Compare dotted versions while ignoring insignificant trailing zeroes."""
    left_parts = _version_tuple(left)
    right_parts = _version_tuple(right)
    return left_parts is not None and left_parts == right_parts


def compare_versions(left, right):
    """Return -1, 0, or 1 for dotted versions, or ``None`` if unparseable."""
    left_parts = _version_tuple(left)
    right_parts = _version_tuple(right)
    if left_parts is None or right_parts is None:
        return None
    length = max(len(left_parts), len(right_parts))
    left_parts += (0,) * (length - len(left_parts))
    right_parts += (0,) * (length - len(right_parts))
    return (left_parts > right_parts) - (left_parts < right_parts)


def read_ksp_version(ksp_root):
    """Read the installed KSP version from stable local release artifacts."""
    root = Path(ksp_root)
    candidates = (
        (root / "readme.txt", re.compile(r"(?im)^Version\s+(\d+\.\d+\.\d+)")),
        (
            root / "KSP.log",
            re.compile(
                r"Kerbal Space Program\s+-\s+(\d+\.\d+\.\d+)(?:\.\d+)?"
            ),
        ),
    )
    for path, pattern in candidates:
        try:
            with path.open("r", encoding="utf-8-sig", errors="ignore") as stream:
                sample = stream.read(64 * 1024)
        except OSError:
            continue
        match = pattern.search(sample)
        if match:
            return match.group(1)
    return None


def ksp_installation_inventory(ksp_root_value):
    """Validate the selected KSP root and report its tested-version status."""
    if isinstance(ksp_root_value, os.PathLike):
        ksp_root_value = os.fspath(ksp_root_value)
    root = resolve_ksp_root(ksp_root_value)
    if root is None:
        return {
            "status": "unconfigured",
            "root": None,
            "version": None,
            "missing": [],
        }
    required_paths = (
        ("KSP_x64.exe", root / "KSP_x64.exe"),
        ("GameData\\Squad", root / "GameData" / "Squad"),
    )
    missing = [label for label, path in required_paths if not path.exists()]
    version = read_ksp_version(root)
    if missing:
        status = "invalid"
    elif version is None:
        status = "unknown_version"
    elif versions_equivalent(version, KSP_TESTED_VERSION):
        status = "current"
    else:
        status = "untested"
    return {
        "status": status,
        "root": root,
        "version": version,
        "missing": missing,
    }


def dll_layout_inventory(ksp_root_value):
    """Find duplicate or misplaced Mission Control-related DLLs in GameData."""
    if isinstance(ksp_root_value, os.PathLike):
        ksp_root_value = os.fspath(ksp_root_value)
    root = resolve_ksp_root(ksp_root_value)
    if root is None:
        return {"status": "unconfigured", "issues": [], "matches": {}}
    game_data = root / "GameData"
    wanted = {name.casefold(): name for name in CORE_DLL_LOCATIONS}
    matches = {name: [] for name in CORE_DLL_LOCATIONS}
    try:
        for directory, child_directories, filenames in os.walk(game_data):
            child_directories[:] = [
                name
                for name in child_directories
                if name.casefold() not in {"plugindata", "__macosx"}
            ]
            for filename in filenames:
                canonical_name = wanted.get(filename.casefold())
                if canonical_name is not None:
                    matches[canonical_name].append(Path(directory) / filename)
    except OSError as exc:
        return {
            "status": "error",
            "issues": [],
            "matches": matches,
            "error": str(exc),
        }

    issues = []
    for filename, relative_path in CORE_DLL_LOCATIONS.items():
        expected = game_data / relative_path
        found = matches[filename]
        expected_key = os.path.normcase(str(expected.resolve()))
        canonical_found = any(
            os.path.normcase(str(path.resolve())) == expected_key for path in found
        )
        extra = [
            path
            for path in found
            if os.path.normcase(str(path.resolve())) != expected_key
        ]
        if extra:
            issues.append(
                {
                    "filename": filename,
                    "kind": "duplicate" if canonical_found else "misplaced",
                    "expected": expected,
                    "found": found,
                }
            )
    return {
        "status": "issues" if issues else "current",
        "issues": issues,
        "matches": matches,
    }


def prerequisite_inventory(ksp_root_value, version_reader=read_windows_file_version):
    """Describe installed kRPC and MechJeb prerequisites without loading DLLs."""
    if isinstance(ksp_root_value, os.PathLike):
        ksp_root_value = os.fspath(ksp_root_value)
    root = resolve_ksp_root(ksp_root_value)
    inventory = []
    for definition in KSP_PREREQUISITES:
        target = (
            root / "GameData" / definition["relative_path"]
            if root is not None
            else None
        )
        installed_version = None
        if root is None:
            status = "unconfigured"
        elif target is None or not target.is_file():
            status = "missing"
        else:
            if definition["key"] == "krpc":
                installed_version = read_avc_version(
                    root / "GameData" / "kRPC" / "kRPC.version"
                )
            if installed_version is None:
                installed_version = version_reader(target)
            if installed_version is None:
                status = "unknown_version"
            elif versions_equivalent(
                installed_version, definition["tested_version"]
            ):
                status = "current"
            else:
                status = "untested"
        inventory.append(
            {
                **definition,
                "target": target,
                "installed_version": installed_version,
                "status": status,
            }
        )
    return inventory


def _parse_config_nodes(text):
    """Parse the small ConfigNode subset used by kRPC's settings file."""
    document = {"name": None, "values": {}, "children": []}
    stack = [document]
    pending_name = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("//"):
            continue
        if line.endswith("{") and line != "{":
            pending_name = line[:-1].strip()
            line = "{"
        if line == "{":
            if not pending_name:
                raise ValueError("ConfigNode opening brace has no node name")
            node = {"name": pending_name, "values": {}, "children": []}
            stack[-1]["children"].append(node)
            stack.append(node)
            pending_name = None
        elif line == "}":
            if len(stack) == 1:
                raise ValueError("ConfigNode has an unmatched closing brace")
            stack.pop()
            pending_name = None
        elif "=" in line:
            key, value = (part.strip() for part in line.split("=", 1))
            stack[-1]["values"].setdefault(key, []).append(value)
            pending_name = None
        else:
            pending_name = line
    if len(stack) != 1:
        raise ValueError("ConfigNode has an unclosed node")
    return document


def _child_nodes(node, name):
    return [child for child in node["children"] if child["name"] == name]


def _node_value(node, name, default=None):
    values = node["values"].get(name, [])
    return values[-1] if values else default


def _config_bool(value):
    if isinstance(value, str) and value.lower() in {"true", "false"}:
        return value.lower() == "true"
    return None


def parse_krpc_settings(text):
    """Return the server endpoints and launch flags from kRPC settings text."""
    document = _parse_config_nodes(text)
    configurations = _child_nodes(document, "KRPCConfiguration")
    if not configurations:
        raise ValueError("KRPCConfiguration node not found")
    configuration = configurations[0]
    server_groups = _child_nodes(configuration, "servers")
    servers = []
    if server_groups:
        for server_node in _child_nodes(server_groups[0], "Item"):
            settings_nodes = _child_nodes(server_node, "settings")
            settings = {}
            if settings_nodes:
                for item in _child_nodes(settings_nodes[0], "Item"):
                    key = _node_value(item, "key")
                    value = _node_value(item, "value")
                    if key is not None and value is not None:
                        settings[key] = value
            try:
                rpc_port = int(settings.get("rpc_port", ""))
                stream_port = int(settings.get("stream_port", ""))
            except ValueError:
                rpc_port = None
                stream_port = None
            servers.append(
                {
                    "name": _node_value(server_node, "name", "Unnamed server"),
                    "address": settings.get("address"),
                    "rpc_port": rpc_port,
                    "stream_port": stream_port,
                }
            )
    return {
        "auto_start": _config_bool(
            _node_value(configuration, "autoStartServers")
        ),
        "auto_accept": _config_bool(
            _node_value(configuration, "autoAcceptConnections")
        ),
        "servers": servers,
    }


def krpc_configuration_inventory(ksp_root_value):
    """Inspect kRPC's persisted endpoint settings in the selected GameData."""
    if isinstance(ksp_root_value, os.PathLike):
        ksp_root_value = os.fspath(ksp_root_value)
    root = resolve_ksp_root(ksp_root_value)
    if root is None:
        return {"status": "unconfigured", "path": None, "server": None}
    game_data = root / "GameData"
    krpc_dll = game_data / "kRPC" / "KRPC.dll"
    path = game_data / KRPC_SETTINGS_PATH
    if not krpc_dll.is_file():
        return {"status": "missing", "path": path, "server": None}
    if not path.is_file():
        return {
            "status": "not_initialized",
            "path": path,
            "server": {
                "name": "Default Server",
                "address": KRPC_ADDRESS,
                "rpc_port": KRPC_RPC_PORT,
                "stream_port": KRPC_STREAM_PORT,
            },
            "auto_start": None,
            "auto_accept": None,
        }
    try:
        parsed = parse_krpc_settings(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, ValueError) as exc:
        return {
            "status": "invalid",
            "path": path,
            "server": None,
            "error": str(exc),
        }
    if not parsed["servers"]:
        return {
            "status": "invalid",
            "path": path,
            "server": None,
            "auto_start": parsed["auto_start"],
            "auto_accept": parsed["auto_accept"],
            "error": "No kRPC server definitions were found.",
        }
    expected = next(
        (
            server
            for server in parsed["servers"]
            if server["address"] == KRPC_ADDRESS
            and server["rpc_port"] == KRPC_RPC_PORT
            and server["stream_port"] == KRPC_STREAM_PORT
        ),
        None,
    )
    return {
        "status": "current" if expected is not None else "custom",
        "path": path,
        "server": expected or parsed["servers"][0],
        "servers": parsed["servers"],
        "auto_start": parsed["auto_start"],
        "auto_accept": parsed["auto_accept"],
    }


def installation_recommendations(ksp_installation, dll_layout):
    """Build repair guidance for KSP identity and related DLL layout issues."""
    recommendations = []
    status = ksp_installation.get("status")
    if status == "invalid":
        missing = ", ".join(ksp_installation.get("missing", []))
        recommendations.append(
            {
                "key": "ksp.installation",
                "title": "Selected KSP installation",
                "observed": f"Required KSP files or folders are missing: {missing}",
                "expected": "The KSP 1 installation containing KSP_x64.exe and GameData\\Squad",
                "fix": (
                    "Select the main Kerbal Space Program folder, not GameData "
                    "itself or a mod-staging folder."
                ),
            }
        )
    elif status == "unknown_version":
        recommendations.append(
            {
                "key": "ksp.version",
                "title": "Kerbal Space Program version",
                "observed": "KSP is present, but its version could not be read",
                "expected": f"Tested KSP version {KSP_TESTED_VERSION}",
                "fix": (
                    "Verify the KSP installation through Steam or restore its "
                    "readme.txt. Mission Control can continue, but compatibility "
                    "cannot be confirmed."
                ),
            }
        )
    elif status == "untested":
        recommendations.append(
            {
                "key": "ksp.version",
                "title": "Kerbal Space Program version",
                "observed": f"Installed version {ksp_installation.get('version')}",
                "expected": f"Tested KSP version {KSP_TESTED_VERSION}",
                "fix": (
                    f"Use KSP {KSP_TESTED_VERSION} for the known-good baseline, "
                    "preferably in a separate backed-up KSP instance. Other "
                    "versions may work but are not validated by Mission Control."
                ),
            }
        )

    if dll_layout.get("status") == "error":
        recommendations.append(
            {
                "key": "dll.layout",
                "title": "GameData DLL layout",
                "observed": "GameData could not be scanned completely",
                "expected": "One DLL in each documented canonical location",
                "fix": (
                    "Check GameData permissions and refresh the compatibility "
                    "status before relying on the installed-mod results."
                ),
            }
        )
    for issue in dll_layout.get("issues", []):
        root = ksp_installation.get("root")
        game_data = root / "GameData" if root is not None else None

        def display_path(path):
            try:
                return str(path.relative_to(game_data))
            except (TypeError, ValueError):
                return str(path)

        found = "; ".join(display_path(path) for path in issue["found"])
        recommendations.append(
            {
                "key": f"dll.layout.{issue['filename']}",
                "title": f"{issue['filename']} DLL layout",
                "observed": f"{issue['kind'].title()} copy or copies: {found}",
                "expected": display_path(issue["expected"]),
                "fix": (
                    "Close KSP, use CKAN to reinstall the owning mod when "
                    "possible, and remove stale duplicate or extra-nested copies "
                    "only after confirming they are not the active installation."
                ),
            }
        )
    return recommendations


def probe_krpc_connection(connector=None):
    """Open a short-lived kRPC connection and report registered services."""
    if connector is None:
        import krpc

        connector = krpc.connect
    connection = connector(name="Woobie's Mission Control Connection Test")
    try:
        try:
            server_version = connection.krpc.get_status().version
        except Exception:
            server_version = None
        services = {}
        for attribute, _title in KRPC_SERVICE_ATTRIBUTES:
            try:
                getattr(connection, attribute)
            except Exception:
                services[attribute] = False
            else:
                services[attribute] = True
        return {"server_version": server_version, "services": services}
    finally:
        close = getattr(connection, "close", None)
        if callable(close):
            close()


def expected_krpc_services(prerequisites, services):
    """Return registered service attributes expected from installed DLLs."""
    expected = {"space_center": "SpaceCenter"}
    prerequisite_statuses = {
        item["key"]: item["status"] for item in prerequisites
    }
    if prerequisite_statuses.get("krpc_mechjeb") not in {
        None,
        "missing",
        "unconfigured",
    }:
        expected["mech_jeb"] = "MechJeb"
    service_attributes = {
        "KRPC.StageStats": ("stage_stats", "StageStats"),
        "KRPC.SystemHeat": ("system_heat", "SystemHeat"),
        "KRPC.VesselScience": ("vessel_science", "VesselScience"),
    }
    for item in services:
        attribute_and_title = service_attributes.get(item["folder"])
        if attribute_and_title and item.get("target_hash") is not None:
            expected[attribute_and_title[0]] = attribute_and_title[1]
    return expected


def live_connection_recommendations(state):
    """Build suggested actions from the most recent live kRPC result."""
    status = state.get("status")
    if status not in {"failed", "retry_exhausted", "service_issue"}:
        return []
    if status == "service_issue":
        missing = ", ".join(state.get("missing_services", [])) or "unknown"
        return [
            {
                "key": "krpc.live.services",
                "title": "Live kRPC service registration",
                "observed": f"Connected, but these services were unavailable: {missing}",
                "expected": "Every service whose DLL is installed should be registered",
                "fix": (
                    "Restart KSP after any DLL change, test the connection again, "
                    "and inspect KSP.log for assembly-load or kRPC service errors."
                ),
            }
        ]
    detail = state.get("error") or "The component exhausted its connection attempts"
    return [
        {
            "key": "krpc.live.connection",
            "title": "Live kRPC connection",
            "observed": detail,
            "expected": (
                f"A running local kRPC server on RPC {KRPC_RPC_PORT} with "
                f"stream port {KRPC_STREAM_PORT}"
            ),
            "fix": (
                "Start KSP and load a save; the main menu is not enough because "
                "kRPC stops its servers when no game is loaded. Confirm the "
                "server is running and accepting connections, then use Test "
                "connection. Mission Control tools stop after 10 attempts "
                "instead of retrying forever."
            ),
        }
    ]


def prerequisite_recommendations(inventory, configuration):
    """Build human-readable, read-only repair guidance for prerequisite issues."""
    recommendations = []
    for item in inventory:
        status = item["status"]
        if status in {"current", "unconfigured"}:
            continue
        key = item["key"]
        title = item["title"]
        tested = item["tested_version"]
        installed = item["installed_version"]
        optional_note = (
            " This integration is optional and only affects MechJeb staging "
            "features."
            if not item["required"]
            else ""
        )
        if status == "missing":
            observed = "Not installed"
            if key == "krpc":
                fix = (
                    f"Install kRPC {tested} through CKAN or the official kRPC "
                    "release, then start KSP and load a save once so kRPC can "
                    "create its server settings."
                )
            elif key == "krpc_mechjeb":
                fix = (
                    f"Use CKAN to reinstall the complete kRPC {KSP_PREREQUISITES[0]['tested_version']} "
                    f"package. Its GameData\\kRPC folder should include "
                    f"KRPC.MechJeb {tested}."
                )
            else:
                fix = (
                    f"Use CKAN to install MechJeb 2 {tested} for the tested "
                    "staging integration."
                )
        elif status == "unknown_version":
            observed = "Installed, but version metadata could not be read"
            if key == "krpc_mechjeb":
                fix = (
                    f"Use CKAN to reinstall kRPC {KSP_PREREQUISITES[0]['tested_version']}; "
                    f"the complete package includes the tested KRPC.MechJeb "
                    f"{tested} DLL."
                )
            else:
                package = "kRPC" if key == "krpc" else "MechJeb 2"
                fix = (
                    f"Use CKAN to reinstall {package} {tested} so its version "
                    "metadata and DLLs come from one known package."
                )
        else:
            observed = f"Installed version {installed}"
            direction = compare_versions(installed, tested)
            action = "downgrade" if direction == 1 else "update"
            if direction is None or direction == 0:
                action = "switch"
            if key == "krpc_mechjeb":
                fix = (
                    f"For the tested combination, use CKAN to reinstall kRPC "
                    f"{KSP_PREREQUISITES[0]['tested_version']}. The complete kRPC "
                    f"package supplies KRPC.MechJeb {tested}."
                )
            else:
                package = "kRPC" if key == "krpc" else "MechJeb 2"
                fix = (
                    f"For known-good compatibility, use CKAN to {action} "
                    f"{package} to {tested}. Other versions may work, but "
                    "Mission Control has not validated this installed version."
                )
        recommendations.append(
            {
                "key": f"{key}.version",
                "title": f"{title} prerequisite",
                "observed": observed,
                "expected": f"Tested version {tested}",
                "fix": fix + optional_note,
            }
        )

    config_status = configuration.get("status")
    server = configuration.get("server")
    if config_status == "custom" and server is not None:
        recommendations.append(
            {
                "key": "krpc.server",
                "title": "kRPC server endpoint",
                "observed": (
                    f"Address {server.get('address') or 'unknown'}, RPC "
                    f"{server.get('rpc_port')}, Stream {server.get('stream_port')}"
                ),
                "expected": (
                    f"Address {KRPC_ADDRESS}, RPC {KRPC_RPC_PORT}, Stream "
                    f"{KRPC_STREAM_PORT}"
                ),
                "fix": (
                    "Open kRPC inside KSP, edit the server used by Mission "
                    f"Control, and restore the expected values. Port "
                    f"{DASHBOARD_FEED_PORT} is reserved for Mission Control's "
                    "browser telemetry feed and must not be assigned to kRPC."
                ),
            }
        )
    elif config_status == "invalid":
        recommendations.append(
            {
                "key": "krpc.server",
                "title": "kRPC server settings",
                "observed": "The saved PluginData/settings.cfg could not be read",
                "expected": (
                    f"A local server using RPC {KRPC_RPC_PORT} and Stream "
                    f"{KRPC_STREAM_PORT}"
                ),
                "fix": (
                    "Open kRPC inside KSP and recreate or resave its Default "
                    "Server with the expected values. Avoid hand-editing the "
                    "settings file while KSP is running."
                ),
            }
        )

    if configuration.get("auto_start") is False:
        recommendations.append(
            {
                "key": "krpc.auto_start",
                "title": "kRPC automatic server start",
                "observed": "Disabled",
                "expected": "Enabled for hands-off Mission Control startup",
                "fix": (
                    "Enable automatic server start in kRPC, or load a KSP save "
                    "and start the kRPC server manually before starting Mission "
                    "Control. The server does not run at KSP's main menu."
                ),
            }
        )
    if configuration.get("auto_accept") is False:
        recommendations.append(
            {
                "key": "krpc.auto_accept",
                "title": "kRPC automatic connection acceptance",
                "observed": "Disabled",
                "expected": "Enabled for hands-off Mission Control startup",
                "fix": (
                    "Enable automatic connection acceptance in kRPC, or approve "
                    "each Mission Control client connection inside KSP."
                ),
            }
        )
    return recommendations


def service_inventory(
    ksp_root_value,
    packaged_gamedata=PACKAGED_GAMEDATA,
    version_reader=read_windows_file_version,
):
    """Assess installed service DLLs independently from packaged repair copies."""
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
        tested_version = SERVICE_TESTED_VERSIONS[folder]
        installed_version = (
            version_reader(target) if target_hash is not None else None
        )
        if root is None:
            status = "unconfigured"
        elif target_hash is None:
            status = "missing"
        elif source_hash is not None and source_hash == target_hash:
            status = "current"
        elif versions_equivalent(installed_version, tested_version):
            status = (
                "current_different"
                if source_hash is not None
                else "current_package_missing"
            )
        elif installed_version is not None:
            comparison = compare_versions(installed_version, tested_version)
            status = "outdated" if comparison == -1 else "version_mismatch"
        elif source_hash is None:
            status = "unverified_package_missing"
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
                "tested_version": tested_version,
                "installed_version": installed_version,
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
        item
        for item in inventory
        if item["source_hash"] is not None
        and item["source_hash"] != item["target_hash"]
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


def tcp_port_open(address, port, timeout=0.15):
    """Return whether a TCP listener accepts connections at an endpoint."""
    try:
        with socket.create_connection((address, port), timeout=timeout):
            return True
    except OSError:
        return False


def local_tcp_port_available(port, address=KRPC_ADDRESS):
    """Return whether a local TCP port can be bound by the dashboard feed."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            probe.bind((address, port))
        return True
    except OSError:
        return False


def component_preflight(
    ksp_root_value,
    component_name,
    port_open=tcp_port_open,
    dashboard_port_available=local_tcp_port_available,
):
    """Return actionable errors and warnings before a kRPC component starts."""
    if isinstance(ksp_root_value, os.PathLike):
        ksp_root_value = os.fspath(ksp_root_value)
    root = resolve_ksp_root(ksp_root_value)
    errors = []
    warnings = []
    ksp_installation = ksp_installation_inventory(ksp_root_value)
    dll_layout = dll_layout_inventory(ksp_root_value)
    inventory = prerequisite_inventory(ksp_root_value)
    configuration = krpc_configuration_inventory(ksp_root_value)

    if root is None:
        warnings.append(
            "No KSP folder is selected, so kRPC prerequisites could not be verified."
        )
    else:
        if ksp_installation["status"] == "invalid":
            errors.append(
                "The selected folder is not a complete KSP 1 installation. "
                "Missing: " + ", ".join(ksp_installation["missing"]) + "."
            )
        elif ksp_installation["status"] == "untested":
            warnings.append(
                f"KSP {ksp_installation['version']} is installed; Mission Control "
                f"is tested with KSP {KSP_TESTED_VERSION}."
            )
        elif ksp_installation["status"] == "unknown_version":
            warnings.append(
                "The selected KSP version could not be read; compatibility is "
                "unverified."
            )
        if dll_layout["status"] == "issues":
            warnings.append(
                f"GameData contains {len(dll_layout['issues'])} duplicate or "
                "misplaced core DLL issue(s); review the suggested fixes."
            )
        elif dll_layout["status"] == "error":
            warnings.append(
                "GameData could not be scanned completely for duplicate DLLs."
            )

        krpc_item = next(item for item in inventory if item["key"] == "krpc")
        if krpc_item["status"] == "missing":
            errors.append(
                "kRPC is missing from the selected KSP GameData folder. Install "
                "kRPC 0.5.4 before starting this component."
            )

        status = configuration["status"]
        server = configuration.get("server")
        if status == "custom" and server is not None:
            endpoint = (
                f"RPC {server.get('rpc_port')} and Stream "
                f"{server.get('stream_port')}"
            )
            if (
                server.get("rpc_port") == DASHBOARD_FEED_PORT
                or server.get("stream_port") == DASHBOARD_FEED_PORT
            ):
                errors.append(
                    f"kRPC is configured for {endpoint}. Mission Control reserves "
                    f"port {DASHBOARD_FEED_PORT} for its browser telemetry feed and "
                    f"expects kRPC on RPC {KRPC_RPC_PORT} / Stream "
                    f"{KRPC_STREAM_PORT}. Restore those kRPC server values and try "
                    "again."
                )
            else:
                errors.append(
                    f"kRPC is configured for {endpoint} at "
                    f"{server.get('address') or 'an unknown address'}. Mission "
                    f"Control currently expects {KRPC_ADDRESS}, RPC {KRPC_RPC_PORT} "
                    f"/ Stream {KRPC_STREAM_PORT}. Restore those values and try "
                    "again."
                )
        elif status == "invalid":
            errors.append(
                "Mission Control could not read kRPC's PluginData/settings.cfg. "
                "Open kRPC in KSP, verify its Default Server configuration, save "
                "it, and refresh this status."
            )

        if status in {"current", "not_initialized"}:
            if not port_open(KRPC_ADDRESS, KRPC_RPC_PORT):
                warnings.append(
                    f"kRPC is not listening on {KRPC_ADDRESS}:{KRPC_RPC_PORT} yet. "
                    "Load a KSP save (the main menu is not enough). The component "
                    "will try 10 times over about 20 seconds, then stop and "
                    "recommend the live connection test."
                )
            if configuration.get("auto_start") is False:
                warnings.append(
                    "kRPC automatic server start is off; load a save and start "
                    "its server manually inside KSP."
                )
            if configuration.get("auto_accept") is False:
                warnings.append(
                    "kRPC automatic connection acceptance is off; approve the "
                    "Mission Control client inside KSP."
                )

    if component_name == "feed" and not dashboard_port_available(
        DASHBOARD_FEED_PORT
    ):
        server_uses_feed_port = (
            configuration.get("status") == "custom"
            and configuration.get("server") is not None
            and DASHBOARD_FEED_PORT
            in {
                configuration["server"].get("rpc_port"),
                configuration["server"].get("stream_port"),
            }
        )
        if not server_uses_feed_port:
            errors.append(
                f"Dashboard telemetry port {DASHBOARD_FEED_PORT} is already in "
                "use. Stop the other dashboard feed or program using that port, "
                "then try again."
            )
    return {
        "errors": errors,
        "warnings": warnings,
        "ksp_installation": ksp_installation,
        "dll_layout": dll_layout,
        "inventory": inventory,
        "configuration": configuration,
    }


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
        self.krpc_test_queue = queue.Queue()
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
        self.prerequisite_fix_dialog = None
        self.prerequisite_fix_items = []
        self.krpc_test_generation = 0
        self.krpc_test_checking = False
        self.live_krpc_state = {"status": "not_tested"}

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

        prerequisites = ttk.Frame(
            settings_frame, style="Card.TFrame", padding=(14, 12)
        )
        prerequisites.pack(fill="x", padx=9, pady=(2, 8))
        prerequisite_header = ttk.Frame(
            prerequisites, style="CardInner.TFrame"
        )
        prerequisite_header.pack(fill="x", pady=(0, 6))
        ttk.Label(
            prerequisite_header,
            text="KSP & KRPC COMPATIBILITY",
            anchor="w",
            style="CardTitle.TLabel",
        ).pack(side="left")
        self.prerequisite_summary = ttk.Label(
            prerequisite_header,
            text="Checking...",
            foreground=THEME["slate_dim"],
            anchor="e",
            style="Card.TLabel",
        )
        self.prerequisite_summary.pack(side="right")

        ksp_version_row = ttk.Frame(prerequisites, style="CardInner.TFrame")
        ksp_version_row.pack(fill="x", pady=2)
        ttk.Label(
            ksp_version_row,
            text="Kerbal Space Program",
            anchor="w",
            style="Card.TLabel",
        ).pack(side="left", fill="x", expand=True)
        self.ksp_version_status = ttk.Label(
            ksp_version_row,
            text="Checking...",
            width=32,
            anchor="e",
            style="Card.TLabel",
        )
        self.ksp_version_status.pack(side="right")

        dll_layout_row = ttk.Frame(prerequisites, style="CardInner.TFrame")
        dll_layout_row.pack(fill="x", pady=2)
        ttk.Label(
            dll_layout_row,
            text="Core DLL layout",
            anchor="w",
            style="Card.TLabel",
        ).pack(side="left", fill="x", expand=True)
        self.dll_layout_status = ttk.Label(
            dll_layout_row,
            text="Checking...",
            width=32,
            anchor="e",
            style="Card.TLabel",
        )
        self.dll_layout_status.pack(side="right")

        self.prerequisite_status_labels = {}
        for definition in KSP_PREREQUISITES:
            row = ttk.Frame(prerequisites, style="CardInner.TFrame")
            row.pack(fill="x", pady=2)
            ttk.Label(
                row,
                text=definition["title"],
                anchor="w",
                style="Card.TLabel",
            ).pack(side="left", fill="x", expand=True)
            status = ttk.Label(
                row,
                text="Checking...",
                width=32,
                anchor="e",
                style="Card.TLabel",
            )
            status.pack(side="right")
            self.prerequisite_status_labels[definition["key"]] = status

        server_row = ttk.Frame(prerequisites, style="CardInner.TFrame")
        server_row.pack(fill="x", pady=2)
        ttk.Label(
            server_row,
            text="kRPC server configuration",
            anchor="w",
            style="Card.TLabel",
        ).pack(side="left", fill="x", expand=True)
        self.krpc_configuration_status = ttk.Label(
            server_row,
            text="Checking...",
            width=32,
            anchor="e",
            style="Card.TLabel",
        )
        self.krpc_configuration_status.pack(side="right")

        connection_row = ttk.Frame(prerequisites, style="CardInner.TFrame")
        connection_row.pack(fill="x", pady=2)
        ttk.Label(
            connection_row,
            text="Live kRPC connection",
            anchor="w",
            style="Card.TLabel",
        ).pack(side="left", fill="x", expand=True)
        self.krpc_test_button = ttk.Button(
            connection_row,
            text="Test connection",
            command=self._start_krpc_connection_test,
        )
        self.krpc_test_button.pack(side="right", padx=(7, 0))
        self.krpc_connection_status = ttk.Label(
            connection_row,
            text="Not tested",
            width=32,
            anchor="e",
            style="Card.TLabel",
        )
        self.krpc_connection_status.pack(side="right")

        prerequisite_buttons = ttk.Frame(
            prerequisites, style="CardInner.TFrame"
        )
        prerequisite_buttons.pack(fill="x", pady=(10, 0))
        self.prerequisite_refresh_button = ttk.Button(
            prerequisite_buttons,
            text="Refresh all status",
            command=self._refresh_all_ksp_status,
        )
        self.prerequisite_refresh_button.pack(side="left")
        self.prerequisite_fix_button = ttk.Button(
            prerequisite_buttons,
            text="Review fixes",
            command=self._show_prerequisite_fixes,
            style="Accent.TButton",
        )

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
                width=44,
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
            text="Refresh all status",
            command=self._refresh_all_ksp_status,
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
        self._drain_krpc_test_queue()
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
                text=(
                    "Choose the KSP folder to verify kRPC and mods, maintain "
                    "services, and enable Notes."
                ),
                foreground=THEME["slate_dim"],
            )
        if hasattr(self, "service_status_labels"):
            self._refresh_all_ksp_status()

    def _refresh_all_ksp_status(self):
        self._refresh_prerequisite_status()
        self._refresh_service_status()

    def _refresh_prerequisite_status(self):
        root = resolve_ksp_root(self.ksp_root_var.get())
        ksp_installation = ksp_installation_inventory(self.ksp_root_var.get())
        dll_layout = dll_layout_inventory(self.ksp_root_var.get())
        ksp_status = ksp_installation["status"]
        if ksp_status == "unconfigured":
            ksp_text, ksp_color = "KSP folder required", THEME["slate_dim"]
        elif ksp_status == "invalid":
            ksp_text, ksp_color = "Not a complete KSP 1 install", THEME["warn"]
        elif ksp_status == "current":
            ksp_text = f"{ksp_installation['version']} tested"
            ksp_color = THEME["green"]
        elif ksp_status == "untested":
            ksp_text = f"{ksp_installation['version']} - untested"
            ksp_color = THEME["amber"]
        else:
            ksp_text, ksp_color = "Installed - version unknown", THEME["amber"]
        self.ksp_version_status.config(text=ksp_text, foreground=ksp_color)

        layout_status = dll_layout["status"]
        if layout_status == "unconfigured":
            layout_text, layout_color = "KSP folder required", THEME["slate_dim"]
        elif layout_status == "issues":
            issue_count = len(dll_layout["issues"])
            layout_text = f"{issue_count} duplicate/misplaced issue(s)"
            layout_color = THEME["warn"]
        elif layout_status == "error":
            layout_text, layout_color = "Scan incomplete", THEME["amber"]
        else:
            layout_text, layout_color = "No duplicate core DLLs", THEME["green"]
        self.dll_layout_status.config(text=layout_text, foreground=layout_color)

        inventory = prerequisite_inventory(self.ksp_root_var.get())
        for item in inventory:
            status = item["status"]
            version = item["installed_version"]
            if status == "unconfigured":
                text, color = "KSP folder required", THEME["slate_dim"]
            elif status == "missing":
                qualifier = "required" if item["required"] else "staging only"
                text, color = f"Missing - {qualifier}", THEME["warn"]
            elif status == "current":
                text, color = f"{item['tested_version']} tested", THEME["green"]
            elif status == "untested":
                text, color = f"{version} - untested", THEME["amber"]
            else:
                text, color = "Installed - version unknown", THEME["amber"]
            self.prerequisite_status_labels[item["key"]].config(
                text=text, foreground=color
            )

        configuration = krpc_configuration_inventory(self.ksp_root_var.get())
        config_status = configuration["status"]
        server = configuration.get("server")
        if config_status == "unconfigured":
            config_text, config_color = "KSP folder required", THEME["slate_dim"]
        elif config_status == "missing":
            config_text, config_color = "kRPC not installed", THEME["warn"]
        elif config_status == "not_initialized":
            config_text = f"Defaults expected: {KRPC_RPC_PORT} / {KRPC_STREAM_PORT}"
            config_color = THEME["amber"]
        elif config_status == "invalid":
            config_text, config_color = "Could not read settings", THEME["warn"]
        else:
            config_text = (
                f"RPC {server['rpc_port']} / stream {server['stream_port']}"
            )
            flags = []
            if configuration.get("auto_start") is False:
                flags.append("auto-start off")
            if configuration.get("auto_accept") is False:
                flags.append("auto-accept off")
            if flags:
                config_text += " - " + ", ".join(flags)
            config_color = (
                THEME["green"]
                if config_status == "current" and not flags
                else THEME["amber"]
            )
        self.krpc_configuration_status.config(
            text=config_text, foreground=config_color
        )
        self._refresh_live_krpc_status()
        self.prerequisite_fix_items = (
            installation_recommendations(ksp_installation, dll_layout)
            + prerequisite_recommendations(inventory, configuration)
            + live_connection_recommendations(self.live_krpc_state)
        )
        if self.prerequisite_fix_items:
            self.prerequisite_fix_button.config(
                text=f"Review fixes ({len(self.prerequisite_fix_items)})"
            )
            if not self.prerequisite_fix_button.winfo_manager():
                self.prerequisite_fix_button.pack(side="left", padx=(6, 0))
        elif self.prerequisite_fix_button.winfo_manager():
            self.prerequisite_fix_button.pack_forget()

        statuses = {item["key"]: item["status"] for item in inventory}
        optional_attention = any(
            statuses.get(key) in {"missing", "untested", "unknown_version"}
            for key in ("krpc_mechjeb", "mechjeb")
        )
        if root is None:
            summary_text, summary_color = "Choose a KSP folder", THEME["slate_dim"]
        elif ksp_status == "invalid":
            summary_text, summary_color = "Wrong KSP folder", THEME["warn"]
        elif layout_status == "issues":
            summary_text, summary_color = "DLL layout needs attention", THEME["warn"]
        elif statuses.get("krpc") == "missing":
            summary_text, summary_color = "kRPC required", THEME["warn"]
        elif config_status in {"custom", "invalid"}:
            summary_text, summary_color = "Setup needs attention", THEME["warn"]
        elif statuses.get("krpc") in {"untested", "unknown_version"}:
            summary_text, summary_color = "kRPC version untested", THEME["amber"]
        elif config_status == "not_initialized":
            summary_text, summary_color = "kRPC not initialized", THEME["amber"]
        elif optional_attention:
            summary_text, summary_color = "Core ready; check staging mods", THEME["amber"]
        elif (
            configuration.get("auto_start") is False
            or configuration.get("auto_accept") is False
        ):
            summary_text, summary_color = "Manual kRPC action needed", THEME["amber"]
        else:
            summary_text, summary_color = "Prerequisites tested", THEME["green"]
        self.prerequisite_summary.config(
            text=summary_text, foreground=summary_color
        )

    def _refresh_live_krpc_status(self):
        status = self.live_krpc_state.get("status", "not_tested")
        if status == "testing":
            text, color = "Testing...", THEME["amber"]
        elif status == "connected":
            version = self.live_krpc_state.get("server_version")
            suffix = f" - server {version}" if version else ""
            text, color = f"Connected{suffix}", THEME["green"]
        elif status == "runtime_connected":
            text, color = "Connected through running tool", THEME["green"]
        elif status == "service_issue":
            count = len(self.live_krpc_state.get("missing_services", []))
            text, color = f"Connected - {count} service issue(s)", THEME["amber"]
        elif status == "retry_exhausted":
            text, color = "Startup timed out - test connection", THEME["amber"]
        elif status == "failed":
            text, color = "Connection failed - review/test", THEME["amber"]
        else:
            text, color = "Not tested", THEME["slate_dim"]
        self.krpc_connection_status.config(text=text, foreground=color)

    def _start_krpc_connection_test(self):
        if self.krpc_test_checking:
            return
        self.krpc_test_generation += 1
        generation = self.krpc_test_generation
        self.krpc_test_checking = True
        self.live_krpc_state = {"status": "testing"}
        self.krpc_test_button.config(state="disabled")
        self._refresh_live_krpc_status()

        def worker():
            try:
                result = probe_krpc_connection()
            except Exception as exc:
                self.krpc_test_queue.put((generation, "error", str(exc)))
            else:
                self.krpc_test_queue.put((generation, "result", result))

        threading.Thread(target=worker, daemon=True).start()

    def _drain_krpc_test_queue(self):
        try:
            while True:
                generation, kind, payload = self.krpc_test_queue.get_nowait()
                if generation != self.krpc_test_generation:
                    continue
                self.krpc_test_checking = False
                self.krpc_test_button.config(state="normal")
                if kind == "error":
                    self.live_krpc_state = {
                        "status": "failed",
                        "error": payload,
                    }
                    self._enqueue(
                        "preflight", f"live kRPC connection test failed: {payload}"
                    )
                else:
                    prerequisites = prerequisite_inventory(
                        self.ksp_root_var.get()
                    )
                    services = service_inventory(self.ksp_root_var.get())
                    expected = expected_krpc_services(prerequisites, services)
                    missing = [
                        title
                        for attribute, title in expected.items()
                        if not payload["services"].get(attribute, False)
                    ]
                    self.live_krpc_state = {
                        "status": "service_issue" if missing else "connected",
                        "server_version": payload.get("server_version"),
                        "missing_services": missing,
                    }
                    if missing:
                        self._enqueue(
                            "preflight",
                            "live kRPC test connected, but services were missing: "
                            + ", ".join(missing),
                        )
                    else:
                        self._enqueue(
                            "preflight", "live kRPC connection and services passed."
                        )
                self._refresh_prerequisite_status()
        except queue.Empty:
            pass
        self.root.after(100, self._drain_krpc_test_queue)

    def _show_prerequisite_fixes(self):
        self._refresh_prerequisite_status()
        if not self.prerequisite_fix_items:
            messagebox.showinfo(
                "kRPC prerequisites",
                "No prerequisite mismatches need attention.",
                parent=self.root,
            )
            return
        if (
            self.prerequisite_fix_dialog is not None
            and self.prerequisite_fix_dialog.winfo_exists()
        ):
            self.prerequisite_fix_dialog.lift()
            self.prerequisite_fix_dialog.focus_set()
            return

        dialog = tk.Toplevel(self.root)
        self.prerequisite_fix_dialog = dialog
        dialog.title("Suggested kRPC prerequisite fixes")
        dialog.transient(self.root)
        dialog.resizable(True, True)
        dialog.configure(background=THEME["bg"])
        dialog.protocol("WM_DELETE_WINDOW", self._close_prerequisite_fixes)

        frame = ttk.Frame(dialog, padding=(18, 16))
        frame.pack(fill="both", expand=True)
        ttk.Label(
            frame,
            text="KRPC SETUP RECOMMENDATIONS",
            style="DialogTitle.TLabel",
        ).pack(anchor="w")
        ttk.Label(
            frame,
            text=(
                "Mission Control found the following differences in the "
                "selected KSP installation. These are recommendations only; "
                "no third-party files will be changed."
            ),
            foreground=THEME["slate"],
            justify="left",
            wraplength=700,
        ).pack(fill="x", pady=(4, 10))

        details = scrolledtext.ScrolledText(
            frame,
            width=86,
            height=24,
            wrap="word",
            state="normal",
            font=UI_FONT,
            background=THEME["input"],
            foreground=THEME["slate"],
            insertbackground=THEME["cyan"],
            selectbackground="#24485a",
            selectforeground="#eef3f8",
            borderwidth=0,
            relief="flat",
            padx=10,
            pady=9,
        )
        details.pack(fill="both", expand=True)
        details.tag_configure(
            "issue",
            foreground=THEME["amber"],
            font=(UI_FONT_FAMILY, 11, "bold"),
        )
        details.tag_configure("label", foreground=THEME["cyan"])
        details.tag_configure("note", foreground=THEME["slate_dim"])
        for index, item in enumerate(self.prerequisite_fix_items, start=1):
            details.insert("end", f"{index}. {item['title']}\n", "issue")
            details.insert("end", "Observed: ", "label")
            details.insert("end", item["observed"] + "\n")
            details.insert("end", "Mission Control expects: ", "label")
            details.insert("end", item["expected"] + "\n")
            details.insert("end", "Suggested fix: ", "label")
            details.insert("end", item["fix"] + "\n\n")
        details.insert(
            "end",
            "Close KSP before changing mod versions through CKAN or replacing "
            "GameData files. Refresh the prerequisite status afterward.",
            "note",
        )
        details.config(state="disabled")
        details.yview_moveto(0)

        buttons = ttk.Frame(frame)
        buttons.pack(fill="x", pady=(10, 0))
        ttk.Button(
            buttons,
            text="Close",
            width=10,
            command=self._close_prerequisite_fixes,
        ).pack(side="right")

        dialog.update_idletasks()
        width = min(780, max(620, dialog.winfo_reqwidth()))
        height = min(600, max(440, dialog.winfo_reqheight()))
        x = self.root.winfo_rootx() + max(0, (self.root.winfo_width() - width) // 2)
        y = self.root.winfo_rooty() + max(0, (self.root.winfo_height() - height) // 2)
        dialog.geometry(f"{width}x{height}+{x}+{y}")
        dialog.focus_set()

    def _close_prerequisite_fixes(self):
        dialog = self.prerequisite_fix_dialog
        self.prerequisite_fix_dialog = None
        if dialog is not None:
            dialog.destroy()

    def _refresh_service_status(self):
        root = resolve_ksp_root(self.ksp_root_var.get())
        inventory = service_inventory(self.ksp_root_var.get())
        counts = {}
        for item in inventory:
            status = item["status"]
            counts[status] = counts.get(status, 0) + 1
            version = item["installed_version"]
            package_available = item["source_hash"] is not None
            if status == "unconfigured":
                text, color = "KSP folder required", THEME["slate_dim"]
            elif status == "current":
                text, color = f"v{item['tested_version']} current", THEME["green"]
            elif status == "current_package_missing":
                text = f"v{version} current - not in package"
                color = THEME["amber"]
            elif status == "current_different":
                text = f"v{version} current - package build differs"
                color = THEME["amber"]
            elif status == "unverified_package_missing":
                text = "Installed - not in package; version unverified"
                color = THEME["amber"]
            elif status == "missing":
                suffix = "repair ready" if package_available else "not in package"
                text, color = f"Missing - {suffix}", THEME["warn"]
            elif status == "outdated":
                suffix = "repair ready" if package_available else "not in package"
                text, color = f"v{version} outdated - {suffix}", THEME["warn"]
            elif status == "version_mismatch":
                suffix = "repair ready" if package_available else "not in package"
                text, color = f"v{version} mismatch - {suffix}", THEME["warn"]
            else:
                text, color = "Different build - repair ready", THEME["warn"]
            self.service_status_labels[item["folder"]].config(
                text=text, foreground=color
            )

        needs_install = sum(
            item["source_hash"] is not None
            and item["source_hash"] != item["target_hash"]
            for item in inventory
        )
        package_missing = sum(item["source_hash"] is None for item in inventory)
        installed_issues = sum(
            item["status"]
            in {"missing", "outdated", "version_mismatch", "different"}
            for item in inventory
        )
        installed_current = sum(
            item["status"]
            in {"current", "current_package_missing", "current_different"}
            for item in inventory
        )
        if root is None:
            summary_text = "Choose a KSP folder"
            summary_color = THEME["slate_dim"]
        elif installed_issues and package_missing:
            summary_text = (
                f"{installed_issues} installed service issue(s); package incomplete"
            )
            summary_color = THEME["warn"]
        elif installed_issues:
            summary_text = f"{installed_issues} installed service repair(s) ready"
            summary_color = THEME["warn"]
        elif package_missing:
            summary_text = (
                "Installed services current; package incomplete"
                if installed_current == len(inventory)
                else "Installed services present; package incomplete"
            )
            summary_color = THEME["amber"]
        elif counts.get("current_different", 0):
            summary_text = "Installed versions current; package builds differ"
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
            if item["source_hash"] is not None
            and item["source_hash"] != item["target_hash"]
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
            + ("install" if item["target_hash"] is None else "replace")
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
        previous_root = self.settings.get("ksp_root", "")
        self.settings["ksp_root"] = str(root) if root is not None else ""
        self.ksp_root_var.set(self.settings["ksp_root"])
        try:
            save_settings(self.settings, self.settings_path)
        except OSError as exc:
            self._enqueue("launcher", f"couldn't save KSP folder: {exc}")
            return False
        if self.settings["ksp_root"] != previous_root:
            self.live_krpc_state = {"status": "not_tested"}
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
                if KRPC_CONNECTED_EVENT in line:
                    self.live_krpc_state = {"status": "runtime_connected"}
                    self._refresh_prerequisite_status()
                    continue
                if KRPC_RETRY_EXHAUSTED_EVENT in line:
                    self.live_krpc_state = {
                        "status": "retry_exhausted",
                        "error": "A Mission Control tool exhausted 10 connection attempts",
                    }
                    self._refresh_prerequisite_status()
                    continue
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
            elif re.fullmatch(r"!\[[^]]*\]\([^)]+\)", stripped):
                continue
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

        preflight = component_preflight(
            self.ksp_root_var.get(), backend.name
        )
        for warning in preflight["warnings"]:
            self._enqueue("preflight", warning)
        if preflight["errors"]:
            details = "\n\n".join(preflight["errors"])
            self._enqueue(
                "preflight", "start blocked: " + " ".join(preflight["errors"])
            )
            messagebox.showerror(
                "kRPC setup needs attention",
                details,
                parent=self.root,
            )
            self._refresh_all_ksp_status()
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
