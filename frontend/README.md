# Mission Control dashboard frontend

This directory contains the production React/TypeScript dashboard and its
development-only fixtures. Vite is a build and local-development tool; release
users receive only the compiled files under `Dashboard/web`.

## Development server

From the repository root:

```powershell
.\scripts\dashboard-dev.ps1 start
.\scripts\dashboard-dev.ps1 open
.\scripts\dashboard-dev.ps1 status
.\scripts\dashboard-dev.ps1 logs
.\scripts\dashboard-dev.ps1 stop
```

The controller records only its own process ID, process start time, and logs
under ignored `frontend/.dev`. It will not stop an unrelated Node process.

The initial dependency install can also be run directly:

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173/`.

## Fixtures and live telemetry

Development starts in deterministic fixture mode. The left-side developer
drawer switches among Flight, Editor, and inactive Mission Control scenes or
connects to live KSP telemetry at `ws://127.0.0.1:8090`.

For an end-to-end feed without KSP:

```powershell
python .\scripts\mock_telemetry_server.py --drop-every 4
```

Use `ws://127.0.0.1:8091` in the developer drawer. The mock cycles through
populated scenes; `--drop-every 4` exercises reconnect behavior. Use
`--scenes editor` to hold the VAB/SPH fixture.

To test the compiled production dashboard instead of Vite, double-click
`tools\Mock Mission Control.bat`. That controller serves both the dashboard and
the same populated telemetry on the production loopback port `8090`.

## Verification and production build

```powershell
pnpm check
```

This runs Vitest, TypeScript checking, and the Vite production build. The
repository wrapper also audits the result for development-only UI:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Build-Frontend.ps1 -InstallDependencies
```

Add `-StageRuntimeWeb` when testing the root Python launcher and telemetry
server together; it refreshes the ignored root `web` directory from `dist`.

Production builds start in Live KSP mode, omit fixture payloads and the
developer drawer, and use relative assets so the Python telemetry process can
serve them from `http://127.0.0.1:8090/`.

Generated `node_modules`, `dist`, `.dev`, and coverage directories are ignored.
