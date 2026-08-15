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

The v0.7.4 release manifest selects:

| Service | Release |
| --- | --- |
| WoobiesControlStats | 0.2.21 |
| KRPC.StageStats | 0.2.10 |
| KRPC.SystemHeat | 0.2.11 |
| KRPC.WoobiesMechJeb | 0.8.10 |

The previous v0.6.1 through v0.7.3 release contracts remain frozen in
their matching `tools/Release-Pack-v*.psd1` files. The selected v0.7.4 contract is recorded in
`tools/Release-Manifest.psd1` and frozen in
`tools/Release-Pack-v0.7.4.psd1`.
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
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Publish-Release.ps1 -Version 0.7.4 -GameDataPath $serviceGameData -SkipReleaseImages
```

The switch is rejected when `-CreateDraftRelease` is present. After all five
screenshots are approved, run the final package command without the switch:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Publish-Release.ps1 -Version 0.7.4 -GameDataPath $serviceGameData
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
- creates the full ZIP, checksum, generated build information, and release
  notes;
- writes `WMC-INSTALL-MANIFEST.json` into the full package and creates one
  universal `.zz-90-runtime-update.zip` plus `.sha256` sidecar containing only
  the product-managed runtime, legal notices, and packaged DLL repair copies;
- stages five curated standalone screenshot assets using names that sort after
  the ZIP and checksum in GitHub's release asset list;
- audits both ZIPs for exact manifest membership, hashes, missing files, and
  forbidden source/build artifacts; applies the shared
  `runtime-update-contract.json` path and archive-size limits; and requires the
  update ZIP to be smaller than the full package.

The end-user package contains the compiled `Dashboard\web` directory, never
the frontend source, Node.js, Vite, pnpm, tests, or developer fixtures.
The updater-managed manifest deliberately excludes `.venv`, launcher/setup
logs, README and gallery files, local application data, and unknown files.
Those remain user-owned. The package's four `GameData` service folders are
managed repair copies; the updater never follows the launcher's selected KSP
path or writes live KSP `GameData`.

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
- run the deterministic two-version updater acceptance fixture: verify a
  successful update and restart acknowledgement, cancellation without package
  mutation, rejection of mutable/tampered/wrong-host assets, rollback after a
  locked file or injected mid-apply failure, recovery after helper termination,
  PID-reuse-safe launcher/helper identity, complete owned component-tree
  shutdown, preservation of `.venv`/settings/logs/unknown files, and an
  unchanged disposable live-KSP sentinel tree;
- follow the current release's `docs/images/<version>/README.md` for the
  approved screenshot set, source briefs, exact dimensions, and hashes.

The first updater-capable public release cannot update from an older package,
because those packages do not contain the trusted helper or install manifest.
Install that release once through the normal full ZIP. Before it is published,
the synthetic predecessor/current-candidate fixture is the required proof that
its shipped updater can perform the future transaction. Version 0.7.0 is the
first public successor, so its acceptance must add one real v0.6.1-to-v0.7.0
managed-update smoke in a disposable package tree. Do not point production code
at a test channel or allow the updater to touch live KSP.

Version 0.7.4 reuses the five approved v0.7.3 curated captures by explicit user
decision. Follow `docs/images/v0.7.3/README.md`; all five source images remain
true 1080x1785 portrait PNGs with no visible pointer. The developer corner
control must remain hidden, and the clean packaged runtime must be validated
separately without fixtures or development-only controls. Older releases retain
their original approved screenshot sets.

## 5. Create a private draft release

After committing, pushing, and confirming that `main` matches `origin/main`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Publish-Release.ps1 -Version 0.7.4 -GameDataPath $serviceGameData -CreateDraftRelease
```

This creates a draft GitHub Release and uploads the ZIP, checksum, GPL source
archive, runtime-update ZIP and checksum, and five curated screenshots. The
screenshot filenames use a `.zz-01` through `.zz-05` suffix and the updater uses
`.zz-90`, so `Woobies-Mission-Control-v0.7.4.zip` remains the first release
asset. Review the draft, its generated notes, asset ordering, source archive,
update manifests/checksums, and final screenshots before publishing it.

GitHub immutable releases must be enabled for the repository before this
command will create a draft. This is a deliberate manual repository-setting
decision; the script verifies the setting but never enables it. Attach every
asset while the release is a draft, then publish it. After publication, verify
through the GitHub API that the stable release reports `immutable: true`, both
runtime-update assets report `state: uploaded` and `sha256:` digests, and the
launcher sees the same canonical tag and asset names. If any check fails, the
launcher must retain its manual **View release** fallback and must not install.
