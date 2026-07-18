# Changelog

All notable public changes will be recorded here.

## v0.2.2 - Read-only Notes integration

- Added optional integration with zer0Kerbal's Notes mod through a responsive
  right-side drawer available in Flight, the VAB/SPH, and inactive KSP scenes.
- Defaulted to the active vessel's Ship Log while adding saved-note search,
  direct selection, previous/next cycling, and persisted dashboard favorites.
- Added a single independently selected, scrollable pinned-note flight panel
  and synchronized 8-18 px text-size controls with a 10 px reset.
- Added a persisted KSP installation selector to the Windows launcher so the
  telemetry feed can locate Notes without assuming a particular install path.
- Kept Notes files read-only, bounded displayed content to the latest 32 KiB,
  and rendered note text through text-only DOM operations.
- Added nested-note discovery, exact catalog-key selection, launcher and
  telemetry unit tests, a browser regression harness, and feature screenshots.
- Preserved all v0.2.1 dashboard, editor-planning, KSP service, and ESP32
  control-pad behavior when Notes is missing.

## v0.2.1 - Simplified Windows setup

- Added automatic first-run creation and repair of the isolated Python
  environment, removing the normal need to copy setup commands from the README.
- Added a non-blocking, cached GitHub release check to the launcher with manual
  refresh, a release-page link, and a control for disabling automatic checks.
- Added a packaged `QUICKSTART.txt` and made the automatic setup path primary in
  the README while retaining manual commands as a troubleshooting fallback.
- Continued to package the v0.2.0 KSP service DLLs without changing telemetry,
  dashboard schema, or in-game behavior.

## v0.2.0 - Editor craft planning

- Added MechJeb-backed stage analysis in the VAB and SPH with selectable
  reference body, altitude above sea level, and Mach.
- Displayed atmospheric and vacuum delta-v and initial TWR side by side in
  editor planning while preserving the compact flight condition toggle.
- Updated `KRPC.StageStats` to `0.2.0`, including corrected initial-TWR values
  and editor simulation lifecycle support.
- Rebuilt consumable rows and stage snapshots across launches, scene changes,
  dashboard reconnects, and reverts without showing stale pre-revert values.
- Added opt-in StageStats lifecycle tracing, a raw service probe, and browser
  and telemetry regression coverage for the diagnosed failure paths.

## v0.1.5 - Revert-safe staging analysis

- Invalidated the private `KRPC.StageStats` MechJeb-module cache when KSP
  replaces the active vessel or `MechJebCore`, including after Revert to Launch.
- Updated `KRPC.StageStats` to `0.1.2` and made the release tool reject older
  DLLs so a v0.1.5 package cannot silently reuse the revert-unsafe service.
- Rejected incomplete MechJeb stage arrays instead of relabeling the surviving
  rows by engine activation stage, which had disguised missing stages as S0/S4.
- Cleared the last staging snapshot when universal time rewinds and verified
  the stage count again after each multi-call snapshot to avoid cross-flight or
  mid-staging data mixes.

## v0.1.4 - Multi-burn consumables partition

- Split current-stage resources when multiple engine stages remain permanently
  attached and therefore share kRPC's decouple stage `-1`.
- Used stage-specific propellants to assign fuel tanks to their operational
  engine stage, preventing S2 and S0 stores from being combined.
- Assigned shared and stage-neutral stores by attachment-tree proximity so
  ElectricCharge, EnrichedUranium, DepletedFuel, and other non-propellants stay
  visible on the stage they physically belong to.
- Cached the inferred part ownership until the vessel or KSP stage changes to
  avoid repeating the topology walk on every resource poll.
- Prevented the Ascension altitude value and unit from wrapping onto separate
  lines by widening the readout and slightly reducing its type size.
- Refreshed MechJeb's asynchronous stage simulation before reading a complete
  delta-v snapshot, and retained the last valid snapshot through transient
  simulation updates.
- Updated `KRPC.StageStats` to `0.1.1`, with an every-frame keep-warm driver so
  MechJeb continues recomputing delta-v during burns and returns all stages.
- Mapped propulsive-only MechJeb results to the vessel's actual engine stages so
  non-contiguous stages such as S0, S2, and S4 keep their correct labels.
- Made the release tool reject the frozen `KRPC.StageStats` `0.1.0.0` binary so
  v0.1.4 cannot accidentally ship with the old service again.

## v0.1.3 - Current-stage consumables fix

- Corrected current-stage resource tracking after pure decoupler, separator, or
  fairing stages.
- Walked through empty decouple-stage groups and included resources on parts
  that remain attached through the final stage.
- Avoided kRPC's cumulative decouple-stage behavior, which excludes the
  never-decoupled stage `-1` resource group.

## v0.1.2 - KSP Recall consumables fix

- Restored filtering for KSP Recall's internal `StealBackMyFunds`,
  `RefundingForKSP111x`, and shorter `StealBack` bookkeeping resources.
- Normalized resource names before filtering so case and punctuation variations
  do not expose internal resources in the Consumables panel.
- Applied the filter consistently to vessel-total and current-stage telemetry.

## v0.1.1 - Widescreen layout

- Added a responsive layout for horizontal displays at 1440 pixels and wider.
- Simplified the Datalink panel by removing its redundant telemetry-source list.
- Combined Datalink, time, and communications into a five-cell widescreen strip.
- Added stable three-column mission stacks at 1600 pixels and wider.
- Used the space below Ascension for Consumables to reduce wasted height.
- Kept Staging and Target together so docking information remains in view.
- Preserved the v0.1.0 layout on narrower and vertical displays.
- Added an audited PowerShell release packager with optional draft GitHub
  Release creation.
- Fixed the unused-version check under Windows PowerShell 5.1.

## v0.1.0 - Initial public test release

- Prepared the project for its first public release.
- Separated dashboard telemetry from the ESP32 control-pad bridge.
- Added component discovery to the launcher.
- Added stored-science support through the VesselScience service.
- Corrected System Heat electricity, RTG, and transient generator reporting.
- Corrected MechJeb stage TWR reporting.
- Filtered KSP Recall's internal `StealBack` resource from consumables.
- Added adaptive altitude, apoapsis, and periapsis precision with exact-meter
  hover values.
- Added a compact reactor summary and a collapsed, scrollable per-reactor
  detail list with temperature and integrity alerts.
- Added `KSP_control.ino` firmware for the ESP32-WROOM-32 DevKit V1, with
  debounced inputs and safe fire-button startup behavior.
- Clarified that complete-release Python setup must be run from its `Dashboard`
  folder so the launcher can use the project-local virtual environment.
- Added project, version, author, GitHub, and license information to the
  launcher and dashboard.
- Added a screenshot-based README feature tour covering science, staging,
  thermal/electrical management, targeting, and docking alignment.
