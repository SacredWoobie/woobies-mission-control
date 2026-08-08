# Mission Control dashboard frontend

This directory contains the production React/TypeScript dashboard and its
development-only fixtures. Vite is a build and local-development tool; release
users receive only the compiled files under `Dashboard/web`.

Dashboard changes follow the tracked
[Dashboard UI/UX guidelines](../docs/DASHBOARD_UI_GUIDELINES.md). Those rules
are the default for information hierarchy, responsive composition, typography,
scrolling, disclosure, accessibility, and telemetry-backed state. Record any
deliberate exception and its acceptance evidence in the active workstream.

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

Open `http://127.0.0.1:5174/`.

## Fixtures and live telemetry

Development starts in deterministic fixture mode. The left-side developer
drawer switches among Flight, Editor, and inactive Mission Control scenes or
connects to live KSP telemetry at `ws://127.0.0.1:8090`. On a mouse-equipped
browser its collapsed `DEV` tab stays hidden until the pointer reaches the
upper-left corner or keyboard focus reaches the tab. Touch and coarse-pointer
devices keep the tab visible.

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

This runs the CSS contract, Vitest, strict TypeScript/Vite production build,
and the maintained Chrome/Edge compatibility suite. Use the narrower commands
while iterating:

```powershell
pnpm test:css
pnpm test:unit
pnpm build
pnpm test:browser
```

The CSS contract reads both production stylesheets without network access. It
checks custom-property declarations and references, prevents migrated palette
values from drifting back into raw literals, enforces the 8 px operational text
floor, keeps the low-contrast `--slate-dim` role out of text colors, and checks
selected semantic text tokens against the panel background. When adding a
shared token, audit the exact literal across both stylesheets and add it to the
contract only after every compatible use is migrated. Keep local gradients,
alpha overlays, shadows, SVG/instrument colors, and data-visualization endpoints
local when they do not share one honest role.

The repository wrapper also audits the production result for development-only
UI:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Build-Frontend.ps1 -InstallDependencies
```

Add `-StageRuntimeWeb` when testing the root Python launcher and telemetry
server together; it refreshes the ignored root `web` directory from `dist`.

Production builds start in Live KSP mode, omit fixture payloads and the
developer drawer, and use relative assets so the Python telemetry process can
serve them from `http://127.0.0.1:8090/`.

Generated `node_modules`, `dist`, `.dev`, and coverage directories are ignored.

Pull requests and pushes to `main` run the same locked frontend check plus the
Python runtime suite in `.github/workflows/ci.yml`. A green local build is useful
iteration evidence; the CI run is the shared merge evidence. After the workflow
first succeeds on the default branch, repository administrators should make
both job names required in branch protection as described in
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

## UI review matrix

Use deterministic fixtures to exercise the complete visual state before live
KSP acceptance. Every dashboard UI change should cover the affected entries in
this matrix:

| Review | Required evidence |
| --- | --- |
| Wide landscape | Inspect at `1920x889`; record document and bounded-panel overflow. |
| Short landscape | Inspect at `1280x800`; keep controls and operational copy readable and document any intentional vertical fallback. |
| Portrait | Inspect at `1080x1920`; confirm scene order, reflow, and no horizontal overflow. |
| Content stress | Exercise dense rows, long labels, empty/loading/error states, offline services, and missing optional fields. |
| Interaction | Verify keyboard navigation, focus restoration, Escape and click-away behavior, disclosure state, and accessible names. |
| Data authority | State whether evidence came from fixtures or live KSP; fixtures never count as live acceptance. |

Measure the rendered browser rather than inferring fit from CSS alone. Run
focused component tests during iteration, then the full frontend suite, strict
TypeScript build, and relevant browser cases before the feature is called
ready. The maintained automated browser matrix is Chrome and Edge. Firefox is
not a release gate because the local Playwright Firefox runtime repeatedly
fails before page creation; record any separate Firefox acceptance as optional
manual evidence rather than blocking the dashboard build.
