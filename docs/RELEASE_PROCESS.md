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
.\Build-WoobiesMechJeb.bat
```

Each successful service release is kept under
`releases\<service>\v<version>`. These archives are local build artifacts and
are intentionally ignored by Git. Update `Release-Set.psd1` to select the
versions for Mission Control, then stage exactly that set:

```powershell
.\Stage-Selected-Releases.bat
```

The v0.5.1 release manifest selects:

| Service | Release |
| --- | --- |
| WoobiesControlStats | 0.2.7 |
| KRPC.StageStats | 0.2.7 |
| KRPC.SystemHeat | 0.2.9 |
| KRPC.WoobiesMechJeb | 0.8.6 |

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

Assemble only from the clean merged release-candidate commit. Do not use a
dirty feature checkout as package provenance.

If the canonical service-builder checkout is intentionally parked on an older
release line, point the packager at a separately verified selected-service
staging tree. `Verify-Release.ps1` must pass in that service checkout first:

```powershell
$serviceGameData = "C:\path\to\verified-service-builder\dist\GameData"
```

Before the screenshot session, build an internal acceptance package without
image assets:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Publish-Release.ps1 -Version 0.5.1 -GameDataPath $serviceGameData -SkipReleaseImages
```

The switch is rejected when `-CreateDraftRelease` is present. After all five
screenshots are approved, run the final package command without the switch:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Publish-Release.ps1 -Version 0.5.1 -GameDataPath $serviceGameData
```

The packager:

- rebuilds and verifies the React production bundle;
- validates the launcher, changelog, package version, and service manifest;
- checks each staged DLL's assembly version and SHA-256;
- copies required per-service licenses and provenance notices beside each DLL;
- verifies and packages the GPL corresponding-source archive and stages it as
  a separate release asset;
- packages the consolidated third-party software notices;
- creates an unpacked allowlisted package under `release-output`;
- creates the ZIP, checksum, generated build information, and release notes;
- stages five curated standalone screenshot assets using names that sort after
  the ZIP and checksum in GitHub's release asset list;
- audits the ZIP for missing files and forbidden source/build artifacts.

The end-user package contains the compiled `Dashboard\web` directory, never
the frontend source, Node.js, Vite, pnpm, tests, or developer fixtures.

## 4. Acceptance test the unpacked package

Before creating a GitHub draft:

- extract or copy the staged package to a clean folder;
- confirm first-run choices 1 through 4 and arrow-key navigation;
- verify Dashboard-only setup does not install `pyserial`;
- verify deferred ESP32 setup adds `pyserial` later;
- use the launcher to install/repair only the four selected DLLs and verify
  that an old `GameData\kRPC\KRPC.MechJeb.dll` is backed up and removed;
- load a save and test Mission Control, VAB/SPH, and Flight in landscape and
  portrait browser windows;
- verify Notes, KAC/stock alarms, stock/System Heat selection, reconnects,
  collapsed panels, planner persistence, transfer preview/confirmation, and
  launcher update/preflight behavior as applicable;
- follow `docs/images/v0.5.1/README.md` for the screenshot set and
  its source briefs.

Version 0.5.1 refreshes the Mission Control overview and focused-contract images
from accepted live telemetry. The unchanged Editor, Flight Monitor, and Flight
Plan Workspace captures are reused from v0.5.0 and the v0.5.1 copies are encoded
as true PNG files. The development corner control must remain hidden in every
release image.

## 5. Create a private draft release

After committing, pushing, and confirming that `main` matches `origin/main`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Publish-Release.ps1 -Version 0.5.1 -GameDataPath $serviceGameData -CreateDraftRelease
```

This creates a draft GitHub Release and uploads the ZIP, checksum, GPL source
archive, and five curated screenshots. The screenshot filenames use a `.zz-01`
through `.zz-05` suffix so `Woobies-Mission-Control-v0.5.1.zip` remains the
first release asset. Review the draft, its generated notes, asset ordering,
source archive, and final screenshots before publishing it.
