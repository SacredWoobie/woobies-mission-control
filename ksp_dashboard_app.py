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

import os
import queue
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

import tkinter as tk
from tkinter import scrolledtext


HERE = Path(__file__).resolve().parent
DASHBOARD = HERE / "ksp_mission_dashboard.html"
PYTHON = sys.executable
APP_NAME = "Woobie's Mission Control"
APP_VERSION = "0.1.5"
APP_AUTHOR = "SacredWoobie"
PROJECT_URL = "https://github.com/SacredWoobie/woobies-mission-control"

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
    def __init__(self, root):
        self.root = root
        self.log_queue = queue.Queue()
        self.backends = []
        self.backend_rows = []

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
        self._refresh()

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
