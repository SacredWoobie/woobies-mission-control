# Changelog

All notable public changes will be recorded here.

## Unreleased

## v0.3.0 - React dashboard and Mission Control overview

![Woobie's Mission Control v0.3.0 flight dashboard](https://raw.githubusercontent.com/SacredWoobie/woobies-mission-control/main/docs/images/v0.3.0/flight-dashboard-landscape.png)

- Replaced the production dashboard surface with the compiled React flight,
  editor, standby, Notes, and panel-visibility implementation.
- Replaced the inactive Standby view with a read-only Mission Control overview:
  save-mode-aware program totals, filterable/sortable tracked vessels and
  astronaut roster, active contracts, and one time-sorted Stock/Kerbal Alarm
  Clock alarm list with source badges.
- Updated WoobiesControlStats to 0.2.1 as the single stock-game extension DLL,
  combining complete-roster, stored-science, and stock-thermal kRPC services
  while keeping the existing API names stable.
- Added a scene-safe Kerbal Alarm Clock bootstrap to WoobiesControlStats. It
  waits for KAC's API and then retries the official kRPC KAC bridge initializer,
  correcting the upstream one-shot startup race without replacing its API or
  adding a hard dependency on KAC.
- Relabeled KAC's internal Raw alarm type as Date / Time in Mission Control and
  increased alarm-row typography without enlarging the separate contract cards.
- Kept Upcoming Alarms to one standard overview column on wide layouts even
  when contracts are not relevant to the current save mode.
- Added automatic stock heat monitoring in watts when System Heat is absent,
  unavailable, or has no active vessel loops; System Heat stays in kilowatts.
- Added an informational launcher scan for the SystemHeat plugin DLL and capped
  landscape vessel/roster tables so alarms remain in the first screenful.
- Extended vessel/roster table caps to portrait layouts, removed the redundant
  Read Only banner badge, and replaced the single craft-type dropdown with a
  KSP-style multi-select icon strip with per-type tracked-object counts.
- Kept debris available to the vessel tracker but defaulted its craft-type
  toggle off, including after switching to the All tracked objects scope.
- Increased the portrait vessel/roster table cap and fixed the tracker contract
  to Debris, Probes, Rovers, Landers, Ships, Stations, Bases, Planes, and
  Relays. Unsupported KSP object categories are omitted at collection time,
  while all nine filter buttons remain visible even at a zero count.
- Added persistent Mission Control collapse controls for Active Vessels,
  Astronaut Roster, and Upcoming Alarms with rocket, suited-Kerbonaut, and
  twin-bell alarm-clock restore icons. The banner, program totals, and active
  contracts remain fixed.
- Added a safe installer migration that backs up and removes superseded
  KRPC.MissionOverview and KRPC.VesselScience DLLs before the consolidated DLL
  is loaded, preventing duplicate kRPC service registrations.
- Split overview collection into independent cached polling tiers, with only
  game time updating at dashboard frame rate and fleet scans automatically
  slowing from 5 toward 30 seconds as tracked-object counts grow.
- Replaced tall text restore tabs with compact square instrument icons for
  flight panels and Notes, keeping a thumbtacked pinned-note icon last.
- Added the VAB/SPH Craft Summary backed by the updated StageStats service.
- Versioned the Craft Summary service changes as KRPC.StageStats 0.2.1 while
  retaining the published SystemHeat 0.2.0 binary.
- Served compiled dashboard files and WebSocket telemetry from the same local
  `127.0.0.1:8090` endpoint; Node.js and Vite remain development-only.
- Kept the complete v0.2.4 launcher compatibility preflight, service repair,
  connection test, bounded retry, update/changelog, and panel-bridge behavior.
- Removed the bundled v0.2.4 HTML dashboard; published prior releases remain
  the rollback source without adding dead files to the 0.3.0 package.
- Retained the ESP32 control-pad firmware source alongside the unchanged panel
  bridge while removing the superseded prototype batch launchers.
- Added a four-choice first-run setup menu with arrow-key or numbered selection,
  component-specific dependency installs, and deferred Setup actions in the
  launcher for components skipped initially. Dashboard-only setup no longer
  installs `pyserial`.
- Added a managed developer mock that serves the compiled dashboard and the
  populated Flight, VAB/SPH, and Mission Control telemetry fixtures together on
  the production loopback port, including interactive Editor and Notes commands.
- Rebuilt the release pipeline around a versioned service manifest, frozen
  frontend install, production-only bundle audit, curated package allowlist,
  unpacked acceptance folder, ZIP checksum, and generated build information.
- Replaced the legacy documentation captures with current v0.3.0 Flight,
  Mission Control, VAB/SPH, Notes, and launcher screenshots while retaining
  additional focused and portrait references for the project wiki.

## v0.2.4 - KSP & kRPC compatibility preflight

![Woobie's Mission Control v0.2.4 launcher compatibility preflight](https://raw.githubusercontent.com/SacredWoobie/woobies-mission-control/main/docs/images/v0.2.4-compatibility/launcher-preflight.png)

- Added read-only launcher checks for the installed kRPC, KRPC.MechJeb, and
  MechJeb 2 versions, distinguishing tested, untested, missing, and unknown
  versions without treating optional staging integrations as core failures.
- Added validation of kRPC's saved address, RPC port, stream port, automatic
  server start, and automatic connection acceptance settings.
- Added a conditional **Review fixes** launcher button that explains each
  observed prerequisite mismatch, the tested or required value, and a suggested
  correction such as restoring kRPC ports or selecting the tested MechJeb build
  through CKAN.
- Separated installed Mission Control service health from packaged repair-copy
  availability: current installed versions remain an amber informational state
  when absent from the package, while missing, outdated, mismatched, or damaged
  installed DLLs are reported in red.
- Added start-time guards for missing base kRPC, unsupported kRPC endpoints, and
  an occupied dashboard telemetry port, while preserving wait-and-retry startup
  when KSP or the correctly configured kRPC server is not running yet.
- Added KSP installation identity and version validation plus a GameData scan
  for duplicate or misplaced core kRPC, MechJeb, and Mission Control DLLs.
- Added a non-blocking live kRPC connection test that checks the responding
  server and confirms registration of services expected from installed DLLs.
- Bounded dashboard-feed and panel-bridge kRPC startup/reconnect behavior to 10
  attempts over about 20 seconds. Exhaustion stops the tool, turns the live
  status amber, and recommends running the connection test.
- Clarified connection guidance throughout the launcher and documentation that
  a KSP save must be loaded because kRPC keeps its servers stopped at the main
  menu.
- Added targeted WinError 10061 guidance explaining that kRPC uses RPC 50000 /
  Stream 50001 and Mission Control reserves port 8090 for its browser feed.

## v0.2.3 - Guided KSP service maintenance

- Added SHA-256 status checks for the packaged Mission Control KSP
  service DLLs, with clear Current, Missing, and Repair available states.
- Added a confirmed Install / Repair workflow that refuses to run while KSP is
  open, backs up existing DLLs, stages and verifies replacements, and limits
  changes to the allowlisted service paths.
- Added adjacent shortcuts for opening the selected KSP `GameData` destination
  and the packaged service-DLL source folder for optional manual copying.
- Made launcher-version changes bypass a still-fresh 24-hour release-check
  cache while continuing to respect the automatic-update preference.
- Added an optional once-per-version What's New window and an always-available
  Changelog button in the launcher.
- Added a dependency-free ttk visual theme using the dashboard's dark panels,
  cyan headings, amber values, status colors, and monospaced typography.
- Prioritized the frequently used dashboard-feed and panel-bridge controls
  above the lower-frequency KSP installation and service-maintenance section.
- Made initial window sizing screen-aware, added explicit Cascadia-to-Consolas
  font fallback, and reused the drawn check/X control in the changelog viewer.
- Added failure-injection coverage for install rollback and a prominent manual
  restoration warning when Windows prevents automatic rollback from completing.

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
