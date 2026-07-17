# Repository guidance

## Purpose

Woobie's Mission Control is a local KSP dashboard plus an optional ESP32 control-panel bridge. The dashboard receives kRPC telemetry through a local WebSocket server. Three custom kRPC DLLs are built in the separate `Woobies-KRPC-Service-Builder` repository.

## Architecture and ownership

- `telemetry_server.py` owns the kRPC connection, scene detection, telemetry gathering, caches, reconnect behavior, dashboard WebSocket, and editor-condition commands.
- `ksp_mission_dashboard.html` owns presentation and browser rendering.
- `ksp_dashboard_app.py` launches optional components; it should not duplicate telemetry logic.
- `panel_bridge.py` is only for the ESP32 serial/kRPC control path. Do not modify it for dashboard-only telemetry or UI work.
- `firmware/KSP_control.ino` and `docs/CONTROL_PAD_PROTOCOL.md` belong to the hardware path.
- `tools/Publish-Release.ps1` packages and audits releases but does not build the service DLLs.

When a displayed field is wrong, trace it in this order: raw kRPC/service value, Python telemetry payload, browser WebSocket payload, then HTML renderer state.

## Local setup and run commands

Use Windows PowerShell from the repository root.

```powershell
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dashboard.txt
```

For the complete dashboard plus ESP32 environment:

```powershell
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Start with `Start KSP Dashboard.bat`, or run telemetry directly while debugging:

```powershell
.venv\Scripts\python.exe -u .\telemetry_server.py
```

## Engineering constraints

- Inspect and update from the current Git branch before editing. Do not base new work on stale chat attachments when the repository is available.
- Preserve the separation between dashboard telemetry and the ESP32 control bridge.
- Keep existing telemetry keys stable where practical; add explicit fields instead of silently changing semantics.
- Treat KSP scene transitions and reverts as lifecycle boundaries. Clear or replace cached vessel, resource, stage, and editor state deliberately.
- If code clears dynamically generated DOM, reset the JavaScript signature/cache that controls rebuilding it.
- Keep unavailable, pending, empty, and stale states distinguishable. Do not hide backend failures with front-end defaults.
- Preserve modded resources and planet packs. Never hard-code the stock body list or stock-only resources.
- Editor analysis must support VAB and SPH. Preserve Hangar Extender compatibility by relying on editor/craft state, not window geometry.
- Keep release versions coordinated across the launcher, dashboard footer,
  README, changelog, and packaging checks; update them only when the next
  release scope is accepted and its feature branch is stable.
- Preserve unrelated changes in a dirty worktree.

## Validation

After Python changes:

```powershell
.venv\Scripts\python.exe -m py_compile .\telemetry_server.py .\ksp_dashboard_app.py .\panel_bridge.py
```

For dashboard JavaScript, load the page with the browser console open and verify no exceptions. Inspect the WebSocket payload independently from the DOM.

Lifecycle changes should cover this manual KSP matrix where applicable:

1. Start in VAB and modify a craft.
2. Select Kerbin and an airless body; compare atmospheric/vacuum values.
3. Repeat in SPH.
4. Launch to a fresh flight.
5. Stage or burn briefly.
6. Revert to launch; verify consumables and staging repopulate.
7. Revert to editor, modify the craft, and relaunch.
8. Disconnect and reconnect the dashboard without restarting KSP.

State which tests were automated and which require the user's KSP installation. Do not claim an in-game pass from mocked data.

## Release boundaries

- The service builder must produce and verify all three DLLs before packaging.
- Run `tools\Publish-Release.ps1` without release creation first, then inspect and test the ZIP.
- Pushing a branch, opening a PR, creating a release, or publishing it requires explicit user direction.
- Do not publish a release with a known lifecycle regression unless the user
  explicitly accepts and documents the limitation.

## Review guidance

- Flag dashboard features that unnecessarily touch `panel_bridge.py`.
- Look for stale caches across `flight -> inactive/editor -> flight` transitions.
- Check that dynamic resource rows rebuild after `nullOutDashboard()` or equivalent DOM clearing.
- Check StageStats states independently: `available`, `complete`, `pending`, `count`, `currentKsp`, and `stages` must form a coherent snapshot or an explicit transition state.
- Treat compatibility with the released telemetry schema and external consumers as part of correctness.
