# Release process

Woobie's Mission Control has two independent build streams:

1. The main repository builds and tests the Python launcher/telemetry code and
   the React dashboard.
2. `Woobies-KRPC-Service-Builder` builds and archives each kRPC service DLL
   independently.

The release package combines those streams only after both have been selected
and verified. Releasing the dashboard does not rebuild an unchanged DLL.

## 1. Select service releases

In the sibling `Woobies-KRPC-Service-Builder` repository, build only a service
whose source actually changed:

```powershell
.\Build-WoobiesControlStats.bat
.\Build-StageStats.bat
.\Build-SystemHeat.bat
```

Each successful service release is kept under
`releases\<service>\v<version>`. These archives are local build artifacts and
are intentionally ignored by Git. Update `Release-Set.psd1` to select the
versions for Mission Control, then stage exactly that set:

```powershell
.\Stage-Selected-Releases.bat
```

For Mission Control v0.3.0, the selected set is:

| Service | Release |
| --- | --- |
| WoobiesControlStats | 0.2.1 |
| KRPC.StageStats | 0.2.1 |
| KRPC.SystemHeat | 0.2.0 |

The matching contract is also recorded in `tools/Release-Manifest.psd1`.
Versioned names are retained in the builder archives; the assembled KSP
`GameData` folders use each service's canonical DLL filename as required by
KSP and kRPC.

## 2. Verify source and frontend

From `woobies-mission-control`:

```powershell
python -m unittest discover -s tests -p "test_*.py"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Build-Frontend.ps1 -InstallDependencies
```

The frontend command performs a frozen pnpm install, runs Vitest, type-checks
TypeScript, builds with Vite, and rejects known development-only controls in
the production bundle. `frontend/node_modules`, `frontend/dist`, coverage,
runtime logs, and release output remain local and ignored.

## 3. Assemble the release without publishing

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Publish-Release.ps1 -Version 0.3.0
```

The packager:

- rebuilds and verifies the React production bundle;
- validates the launcher, changelog, package version, and service manifest;
- checks each staged DLL's assembly version and SHA-256;
- creates an unpacked allowlisted package under `release-output`;
- creates the ZIP, checksum, generated build information, and release notes;
- audits the ZIP for missing files and forbidden source/build artifacts.

The end-user package contains the compiled `Dashboard\web` directory, never
the frontend source, Node.js, Vite, pnpm, tests, or developer fixtures.

## 4. Acceptance test the unpacked package

Before creating a GitHub draft:

- extract or copy the staged package to a clean folder;
- confirm first-run choices 1 through 4 and arrow-key navigation;
- verify Dashboard-only setup does not install `pyserial`;
- verify deferred ESP32 setup adds `pyserial` later;
- use the launcher to install/repair only the three selected DLLs;
- load a save and test Mission Control, VAB/SPH, and Flight in landscape and
  portrait browser windows;
- verify Notes, KAC/stock alarms, stock/System Heat selection, reconnects,
  collapsed panels, and launcher update/preflight behavior as applicable.

The current launcher screenshot is stored with the v0.3.0 documentation. If
the launcher changes after acceptance testing, refresh that image before the
draft release is created so the README does not preserve a stale window.

## 5. Create a private draft release

After committing, pushing, and confirming that `main` matches `origin/main`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Publish-Release.ps1 -Version 0.3.0 -CreateDraftRelease
```

This creates a draft GitHub Release and uploads the ZIP and checksum. Review
the draft, its generated notes, and final screenshots before publishing it.
