# Woobie's Mission Control

Current release: **v0.1.5**

A modular mission dashboard and optional ESP32 control-pad bridge for Kerbal
Space Program 1, powered by [kRPC](https://krpc.github.io/krpc/).

The browser dashboard displays live flight, orbit, resources, communications,
science, thermal, electrical, target, and MechJeb stage-analysis data. The
physical control-pad bridge is a separate process and is not required to use the
dashboard.

This is an unofficial community project and is not affiliated with or endorsed
by the developers or publishers of Kerbal Space Program or any supported mod.

## Dashboard preview

<p align="center">
  <img src="docs/images/dashboard-overview.png" width="760" alt="Woobie's Mission Control dashboard showing orbital telemetry, resources, science, staging, thermal management, electrical generation, and target information">
</p>

The dashboard is designed for a secondary display and keeps flight, vessel,
and mission-support data visible in one browser window. Sections whose optional
KSP integrations are not installed remain unobtrusive or show unavailable data.

## Components

| Component | Files | Purpose |
| --- | --- | --- |
| Launcher | `Start KSP Dashboard.bat`, `ksp_dashboard_app.py` | Shows controls only for the optional Python components installed beside it. |
| Dashboard | `telemetry_server.py`, `ksp_mission_dashboard.html` | Sends kRPC telemetry to the self-contained browser dashboard. |
| Control pad | `panel_bridge.py` | Connects an ESP32 serial control pad to staging, abort, and the stage-lock indicator. |
| KSP services | Release DLLs installed under `GameData` | Adds System Heat/electricity, MechJeb stage statistics, and stored-science data to kRPC. |

You may install only the pieces you want. For example, if `panel_bridge.py` is
not beside the launcher, the launcher will not show control-pad information or
a control-pad start button.

## Current feature set

- Flight and orbit instruments, navball, throttle, clocks, and sparklines
- Vessel-total and current-stage resources
- MechJeb atmospheric/vacuum delta-v, TWR, and burn-time staging analysis
- Stock CommNet data with optional RemoteTech signal delay
- Recoverable and transmittable science, including science-container contents
- System Heat loop temperatures, generation, rejection, and net heat
- Electrical output by reactor, solar, RTG, and other generation sources
- Target-vessel and docking-alignment information
- Notes panel showing recent files from the Notes mod (zer0Kerbal/Notes)
- Optional ESP32 stage/abort control with local arm/safe gates

## Feature tour

### Science and staging

![Science tracking and MechJeb staging analysis](docs/images/science-and-staging.png)

The science panel totals recoverable and transmittable science aboard the active
vessel, including experiments moved into stock science containers. It also
reports experiment count, biome, situation, and career science already banked
at the KSC. The staging panel presents atmospheric or vacuum delta-v, TWR, burn
time, throttle, and a per-stage breakdown using MechJeb simulation data.

Stored-science reporting uses `KRPC.VesselScience`. Full staging analysis uses
MechJeb 2, KRPC.MechJeb, and `KRPC.StageStats`.

### Thermal and electrical management

![System Heat and electrical-generation monitoring](docs/images/thermal-and-electricity.png)

Monitor System Heat generation, rejection, net load, and individual loop
temperature. Electrical reporting separates reactors, solar panels, RTGs, and
other producers such as alternators and fuel cells. The compact reactor summary
shows fleet status at a glance, while its collapsed detail list provides
per-reactor temperature, output, integrity, and fuel information when needed.

These panels use `KRPC.SystemHeat`; the values available depend on the installed
System Heat and electrical-part mods.

### Target and docking alignment

![Target information and docking-port alignment display](docs/images/docking-alignment.png)

With a vessel or docking port selected as the in-game target, the dashboard
shows distance, relative motion, target orbit, and inclination. For docking-port
targets, the alignment display plots lateral and angular error around a centered
reference so corrections are easy to judge. Confirm the intended target and
controlling docking port in KSP before relying on the display for final contact.

## Compatibility status

The versions below are either known from the current development instance or
still need confirmation before release.

| Software/mod | Status |
| --- | --- |
| Kerbal Space Program 1 | `1.12.5` |
| Python | `3.14` |
| kRPC KSP mod/server | `0.5.4` |
| Python `krpc` package | `0.5.4` |
| Python `websockets` package | `16.0` |
| Python `pyserial` package | `3.5`, for the ESP32 panel only |
| MechJeb 2 | `2.14.3.0` |
| KRPC.MechJeb | `0.7.1` |
| KRPC.SystemHeat service | `0.2.0` |
| KRPC.StageStats service | `0.1.2` |
| KRPC.VesselScience service | `0.1.0` |
| System Heat | `0.9.1` |
| Near Future Electrical | `2.0.8` |
| Near Future Electrical Core | `2.0.1` |
| Near Future Electrical Decaying RTGs | `2.0.1` |
| Dynamic Battery Storage | `2.3.7.0` |
| RemoteTech | Optional; exposed by base kRPC `0.5.4` |

## Installation

### 1. Install the KSP-side dependencies

Install kRPC and the mods required for the dashboard features you plan to use.
Do not copy KSP's own assemblies or third-party mod DLLs from another person's
installation.

The release package contains only this project's three service DLLs:

- `KRPC.SystemHeat.dll`
- `KRPC.StageStats.dll`
- `KRPC.VesselScience.dll`

Copy each provided service folder into your KSP `GameData` folder. The intended
layout uses `KRPC.SystemHeat`, `KRPC.StageStats`, and `KRPC.VesselScience` as the
folder names, with the matching DLL inside each folder.

The release DLLs are optimized deterministic builds without PDB files or
embedded local build paths.

### 2. Choose your PC-side components

Keep the launcher and whichever components you want in the same normal folder
outside KSP's `GameData` directory.

For the dashboard, keep:

- `Start KSP Dashboard.bat`
- `ksp_dashboard_app.py`
- `telemetry_server.py`
- `ksp_mission_dashboard.html`

For the ESP32 control pad, also keep:

- `panel_bridge.py`
- `firmware/KSP_control.ino` when programming or modifying the panel

### 3. Create a Python environment

Choose the folder that contains `Start KSP Dashboard.bat` and the requirements
files:

- In the complete release ZIP, this is the extracted `Dashboard` folder—not the
  package's top-level folder.
- In a source checkout, this is the repository root.

Open Command Prompt or PowerShell in that folder and run:

```bat
py -3.14 -m venv .venv
```

Install only the dependencies for the component you want:

```bat
rem Dashboard only
.venv\Scripts\python.exe -m pip install -r requirements-dashboard.txt

rem ESP32 panel only
.venv\Scripts\python.exe -m pip install -r requirements-panel.txt

rem Everything
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

The launcher automatically uses `.venv` when that folder is beside
`Start KSP Dashboard.bat`.

### 4. Start KSP and the tools

1. Start KSP and enable its kRPC server.
2. Load or launch a vessel.
3. Double-click `Start KSP Dashboard.bat`.
4. Start the dashboard feed, the panel bridge, or both.
5. Starting the dashboard feed opens the dashboard automatically when the HTML
   file is present.

The telemetry server listens only on `127.0.0.1:8090` by default.

## ESP32 control pad

The panel bridge uses a 115200-baud serial connection and recognizes common
CP210x and CH340 USB-to-serial adapters. If more than one candidate device is
connected, set `SERIAL_PORT` near the top of `panel_bridge.py`; the program will
not guess between multiple devices.

Firmware, pin assignments, wiring, debounce behavior, and the serial protocol
are documented in
[`docs/CONTROL_PAD_PROTOCOL.md`](docs/CONTROL_PAD_PROTOCOL.md). The tested
controller is an ESP32-WROOM-32 DevKit V1, selected as `DOIT ESP32 DEVKIT V1`
in Arduino IDE.

## Network and safety notes

- Keep the telemetry server bound to `127.0.0.1` unless you intentionally need
  another device on your trusted local network to view it.
- The WebSocket feed is read-only but has no authentication or encryption. Do
  not expose port 8090 to the internet or an untrusted network.
- The ESP32 bridge can stage a vessel and activate the abort action group. Test
  the panel on a disposable craft and verify the arm/safe behavior before using
  it on an important mission.
- Runtime logs such as `launcher_error.log` may include local file paths. They
  are excluded from Git and should not be attached to a public issue without
  reviewing them first.

## Troubleshooting

### The launcher shows no component buttons

Make sure `telemetry_server.py` and/or `panel_bridge.py` is in the same folder as
`ksp_dashboard_app.py`. Only installed components are displayed.

### The dashboard says it is offline

Confirm that the dashboard feed is running, KSP's kRPC server is enabled, and
no other program is using port 8090.

### A dashboard section is blank

Optional sections require their corresponding KSP mod and service DLL. Missing
optional integrations should leave the relevant section blank without stopping
the rest of the dashboard.

### Notes panel says folder not found

The Notes panel reads text files from
`GameData/Notes/Plugins/PluginData/notes`.

This integration assumes the dashboard is started from `KSP_ROOT/Dashboard`.

### The ESP32 is not found

Check Windows Device Manager for the control pad's COM port. Set, for example,
`SERIAL_PORT = "COM5"` near the top of `panel_bridge.py`, using the actual port
shown on your computer.

## Known limitations

- Windows is the currently documented launcher platform. The Python scripts can
  run on other platforms, but equivalent launch instructions are not yet tested.
- Docking alignment depends on the vessel's controlling docking port and should
  be validated against the navball before relying on it.
- Exact compatibility ranges will remain provisional until the version table
  above is completed and the release is tested from a clean installation.

## Maintainer release process

The repository includes `tools/Publish-Release.ps1` for assembling and checking
the complete Windows release package. It does not build the three kRPC service
DLLs; run the separate service builder and its release verification first.

The default folder arrangement is:

```text
Documents\
|-- woobies-mission-control\
`-- Woobies-KRPC-Service-Builder\
```

With that arrangement, the script finds the verified DLLs under the sibling
builder's `dist\GameData` folder. A different location can be supplied with
`-GameDataPath`.

From a clean, up-to-date `main` checkout, first create and audit the package
without changing anything on GitHub:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Publish-Release.ps1 -Version 0.1.5
```

The script writes the ZIP, SHA-256 checksum, and generated release notes to the
ignored `release-output` folder. Inspect and test that ZIP before continuing.

To let the script create the tag and a **draft** GitHub Release, use a Git clone
of this repository and install [Git for Windows](https://git-scm.com/download/win)
and [GitHub CLI](https://cli.github.com/). They can also be installed from
PowerShell with:

```powershell
winget install --id Git.Git -e
winget install --id GitHub.cli -e
```

Open a new PowerShell window after installation, authenticate once with
`gh auth login`, and then rerun:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Publish-Release.ps1 -Version 0.1.5 -CreateDraftRelease
```

The release remains private as a draft until it is reviewed and published on
GitHub. Credentials are managed by GitHub CLI and are never stored in the
repository.

## Contributing and issue reports

When reporting a problem, include the KSP version, installed mod versions,
Python version, the component that was running, and a short sanitized log. Do
not upload save files or logs containing information you do not want public.

## License

This project is released under the MIT License. See [`LICENSE`](LICENSE).

Created by **SacredWoobie**.
