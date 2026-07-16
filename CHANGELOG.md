# Changelog

All notable public changes will be recorded here.

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
- Mapped propulsive-only MechJeb results to the vessel's actual engine stages so
  non-contiguous stages such as S0, S2, and S4 keep their correct labels.

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
