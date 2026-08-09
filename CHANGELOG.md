# Changelog

All notable public changes will be recorded here.

## Unreleased

- Added save-persistent unexpected part-loss detection for stock and modded
  craft hardware. Normal staging, undocking, clamp release, EVA construction,
  and fairing jettison remain quiet; losses stay actionable until their branch
  is deliberately discarded, then remain visible in the focused DAMAGE history.
  The recorder reacts to vessel events and uses a low-frequency part-ID safety
  poll, avoiding full metadata and module scans during steady-state frames.
- Added authoritative broken-part monitoring for stock and modded deployable
  equipment, wheels, reaction wheels, and conservative mod failure signals.
  Damage raises Master Warning through a new `DAMAGE` annunciator and opens a
  focused report identifying the affected part groups. The new VesselDamage
  service performs a cached in-game PartModule scan, while older service sets
  retain the narrower stock kRPC fallback.
- Updated the dashboard feed and panel bridge runtime contract to kRPC 0.6.0
  with its required protobuf 7.35.1 Python runtime, coherent server-core
  preflight checks, and rebuilt custom-service compatibility versions.
- Migrated scene reads to kRPC 0.6's supported `game_scene` property while
  preserving the dashboard telemetry schema, ports, and control-safety
  boundaries.

## v0.5.1 - Contract deadlines and UI foundations

- Added authoritative live KSP deadlines to Active Contracts when the new
  read-only MissionOverview service API is available. Compact cards prioritize
  a low-noise time-remaining countdown, expanded briefings show the absolute
  due date, and older services continue to omit unavailable deadlines safely.
- Reconciled the dashboard CSS foundation across both active production
  stylesheets: repaired undefined custom-property references, promoted repeated
  exact palette values into shared semantic roles, and added a dependency-free
  CSS contract that prevents those roles from drifting back into raw literals.
- Raised the minimum dashboard text size to 8 px and moved operational copy off
  the low-contrast decorative slate role while preserving its use for borders,
  strokes, fills, and other intentionally receding non-text detail.
- Added GitHub continuous integration for the Python runtime suite and the
  locked frontend CSS, unit, type/build, Chrome, and Edge checks.

## v0.5.0 - Flight dashboard workspaces

- Corrected both Flight throttle readouts for mod-controlled engines when kRPC's
  vessel control reports zero despite active thrust; limiter-adjusted current
  versus available thrust now provides a source-backed fallback.
- Clipped every projected navball world layer to the spherical boundary so the
  moving sky, horizon, grid, and cardinal labels cannot bleed beyond the globe.
- Reshaped the navball aircraft marker to match KSP's connected wing-and-chevron
  silhouette, including its smaller centered reference dot.
- Rebalanced Flight staging columns so `Δv LIVE`, `Δv VAC`, and `TWR · LIVE`
  headings leave less unused width in TWR and more room for delta-v values.
- Consolidated inactive-scene identity and content-weighted program status into
  one header, expanded Active Vessels into a source-backed orbit, crew, and
  next-event briefing with three equal command actions, and added collapsible
  celestial-body groups ordered outward from the system primary with each moon
  immediately after its parent. The astronaut roster now keeps roster-wide
  status totals in the header while its count and readable table remain
  filterable.
- Repositioned the separate Upcoming Alarms and Active Contracts panels below
  the astronaut roster on wide inactive screens, bounded alarm overflow with an
  internal scroll, and added a contract focus mode that promotes a selected
  briefing into the full right column with a persistent contract rail, readable
  synopsis and objectives, collapsible flavor copy and technical conditions,
  due dates, rewards, and notes when KSP exposes those fields. `BACK`, Escape,
  and outside-click return paths restore the compact dashboard and selected
  contract focus;
  alarm countdowns now anchor the right edge after their source/type tags, and
  contract due dates use a larger high-contrast treatment.
- Removed panel hide and restore controls from the main inactive overview so
  Transfer Windows, Active Vessels, Astronaut Roster, Upcoming Alarms, and
  Active Contracts remain consistently available; celestial-body disclosures
  and contract focus controls are unchanged.
- Aligned the Resonant Orbit planner with the selected dashboard save context so
  pinned Editor plans remain associated with the active craft.
- Redesigned the pinned Editor Resonant Orbit plan as a compact constellation
  and carrier-orbit card, with the saved plan name and key maneuver facts in the
  body plus an `EDIT PLAN` header action that restores that exact plan.
- Redesigned the pinned Editor Mission Plan as a compact budget-versus-craft
  briefing and connected route rail, with explicit reserve or shortfall,
  larger coverage detail, assisted zero-burn steps, round-trip-aware route
  summaries, exact-plan editing, and bounded expansion for long routes.
- Consolidated Editor craft identity, wet mass, cost, and simulation conditions
  into one full-width header, removed the redundant Editor Link strip, and
  refocused Craft Summary as a dedicated resource inventory. Altitude and Mach
  remain directly editable without native increment/decrement controls.
- Reclaimed the empty Editor planning column for a full-width craft-analysis
  row with side-by-side staging and craft summary, repaired shared collapse
  chevrons, and made dense staging explain omitted stages while revealing and
  accessibly identifying the active stage.
- Reused that side-by-side staging and craft-summary row when a plan is pinned
  on wide Editor screens, keeping craft analysis compact beside its planning
  companion.
- Restored bounded staging and compact two-column resources in short-landscape
  Editor layouts so dense craft analysis stays within the viewport.
- Grouped Editor craft totals into higher-contrast Mass, Build, and Cost rails
  so the summary scans consistently in both wide and pinned layouts.
- Grouped distant powered stages behind an expandable range row when Flight
  staging grows tall; expanded rows scroll inside the table while the active
  and nearest stages remain visible by default.
- Tightened Heat radiator-status spacing and raised the wide Heat panel cap
  slightly so loop state controls sit closer to their temperature readouts.
- Reflowed Ascension's orbital-stat rail before narrow panels can truncate
  labels or telemetry values, while retaining the single-row proposal-target
  layouts.
- Made System Heat loop details an accordion: opening one loop collapses the
  previously expanded loop, preserving the bounded Heat Management footprint
  while retaining automatic expansion for a newly critical loop.

- Replaced the auto-hidden Datalink panel with a persistent utility-rail drawer
  containing browser-link status, endpoint and frame diagnostics, a bounded
  connection-event log, forced refresh, and explicit off/on controls. These
  controls affect only the dashboard WebSocket and leave Python, kRPC, and KSP
  running.

- Reworked Flight Ascension around a persistent attitude instrument, trajectory
  annunciator, dedicated SAS strip, width-safe prominent altitude, 2x2
  flight-speed grid, explanatory orbital-stat rail, and a centered
  telemetry-projected spherical navball with curved coordinates, a true horizon,
  and heading-aware cardinals.

- Simplified Flight Consumables to the authoritative vessel-total inventory,
  giving resource names and amount meters substantially more horizontal room,
  while incomplete or unavailable polls no longer present cached resource
  amounts as current.

- Reduced the fixed caution surface to an actionable 2x2 HEAT, REACTOR, COMMS,
  and POWER grid; dashboard-feed interruptions remain diagnostic history without
  relighting Master. Reactor detail now expands toward Electricity's existing
  height cap instead of inheriting the aggregate source ledger's height, then
  exposes a dedicated wheel- and keyboard-scrollable list for any overflow.

- Simplified the persistent Flight panel chrome by removing redundant
  Consumables and Staging header summaries, moved the Tools label to the top of
  the utility rail with a unified amber control treatment, and aligned System
  Heat loop temperature bars to shared columns.

- Restructured Flight around a persistent vessel-state region and switchable
  MONITOR and PLAN workspaces. Responsive lane placement, Rebalance, and panel
  restoration preserve mounted panel state while inactive or hidden panels
  leave layout and accessibility flow and suspend their telemetry updates.
- Added a software master caution and warning system with latched Flight safety
  episodes, feed/source-integrity monitoring, condition-state annunciation,
  and an accessible acknowledgement and history drawer.
- Replaced transient caution tokens with permanent HEAT, REACTOR, COMMS, and
  POWER indicators. New conditions illuminate red, individually acknowledged
  active conditions remain amber, cleared conditions rearm, and dashboard-feed
  diagnostics remain in history without lighting Master Caution.
- Replaced the Target panel's passive type label with a guarded `UNSET TARGET`
  control that revalidates the active vessel and exact selected kRPC object
  before clearing it in KSP.
- Replaced Flight panel hide-to-rail controls with compact, pointer-aware
  information rails. Fixed Ascension, Consumables, and Staging Analysis remain
  persistently expanded, while workspace panels collapse in place with useful
  status and native controls visible and mounted state preserved. Older
  hidden-Flight preferences migrate back into their owning workspace.
- Replaced Electricity's separate Reactor Detail footer with an in-place
  Reactors drill-in that temporarily replaces the power-source ledger at the
  same measured height, keeps multi-reactor detail internally scrollable, and
  returns focus to the Reactors source row when closed.
- Moved Experiment Detail into Science's banked-data row and made it replace
  lab data inside the same bounded, internally scrolling content slot, keeping
  panel height stable and returning focus to its trigger when closed.
- Set wide-layout maximum heights for Electricity and Heat Management,
  aligned every source's numeric output against a shared `EC/s` unit column,
  and capped expanded Heat loops inside an internally scrolling list.

## v0.4.4 - Launcher usability fixes

- Kept every launcher control reachable on laptop-height displays with a
  scrollable controls pane and an independently resizable Mission Log.
- Explain when an extracted Mission Control release was placed inside KSP's
  `GameData`, where KSP can load its packaged service DLLs as duplicates, and
  direct the user to move the complete release folder outside `GameData`.
- Stage corresponding-source release assets under the established `.zz-00`
  name so the normal product ZIP remains first without a post-upload rename.

## v0.4.3 - Flight systems and science operations

- Made Flight transfer-readiness details collapsible while keeping the live
  readiness state visible in the compact header.
- Corrected Flight docking-port targets to show the target vessel name and the
  selected port part's relative speed instead of a generic port label with no
  speed value.
- Let surface-start Delta-V plans choose their launch parking altitude directly
  in the starting step instead of requiring a redundant same-body orbit stop.
- Reworked the Flight science panel to match the dashboard's newer instrument
  styling, with a recoverable-science overview and one compact status card per
  onboard research laboratory; vessels without labs omit the non-actionable
  laboratory section entirely.
- Added stock-compatible laboratory telemetry for stored data and science,
  crew and scientist readiness, current science production, and a decay-aware
  estimate of when each active lab will reach its science capacity.
- Added one-shot lab-capacity alarms with saved 30- or 60-minute lead defaults;
  automatic provider selection prefers Kerbal Alarm Clock and falls back to
  KSP's stock alarm manager, with configurable KAC alarm actions.
- Added a per-lab control that invokes KSP's stock `Transmit Science` action
  for accumulated lab science only; stored experiment data is never included.
- Added a context-aware per-lab `Start Research` / `Stop Research` control that
  invokes the selected converter's matching stock PAW action.
- Fixed engine alternator generation remaining falsely elevated after a burn
  followed immediately by time warp.
- Tightened the wide Flight status columns to their content like Mission
  Control's program metrics while reserving enough room for long Universal and
  Mission Elapsed times. Signal Delay now disappears when RemoteTech is not the
  active communications provider.
- Populate Flight's current-stage consumable resources from StageStats when the
  installed kRPC core does not expose the active stage directly.
- Prevent rapidly changing reactor output from appearing as a transient
  `Other` electricity source by reconciling per-source reads between two total
  generation samples.
- Kept the launcher in a truthful startup state until the dashboard loopback is
  reachable, and shortened only the dashboard's initial connection retry so a
  server that becomes ready between attempts links without an extra two-second
  wait.
- Added solar generation and exposure telemetry for
  `ModuleCurvedSolarPanel`, covering Near Future Solar curved arrays and other
  installed parts that use the same module alongside stock solar panels.
- Added Far Future Technologies fusion reactors to Electricity telemetry and
  reactor details, including demand-scaled output, temperature, throttle, and
  remaining life based on the limiting fuel and the combined burn from other
  reactors sharing it. Exact per-resource rates remain available as detail, and
  fission-only core integrity is not fabricated.
- Added guarded reactor controls to Reactor Detail. Fission reactors can be
  started or stopped, while Far Future fusion reactors expose their native
  off, startup-charging, ready, and running phases with context-sensitive
  controls and live startup-charge progress.
- Added a context-sensitive control to each System Heat loop that safely
  activates and extends all registered radiators, or deactivates and retracts
  them when the loop is fully online. Commands revalidate the active vessel,
  loop membership, and current aggregate action before calling KSP's native
  radiator controls. Active radiators without a native retract or shutdown
  action are identified as non-retractable; older services and stock thermal
  fallback remain display-only.

## v0.4.2 - Mission Control vessel management

- Refined the Space Center and Tracking Station overview with deduplicated
  vessel/roster details, optional save-wide orbital facts, conditional alarm
  and crew markers, collision-safe vessel selection, a flat assignment-aware
  crew roster, guarded one-click switching to a selected vessel, compact zero
  states and program metrics, silent defaults for raw alarms and missing
  deadlines, and a guarded detail-pane editor for vessel names and craft types.
- Added contextual vessel recovery or termination from the selected-vessel
  detail. Recovery uses KSP's stock recoverability rule; termination requires
  WoobiesControlStats 0.2.3, an explicit destructive confirmation, and a named
  warning for every aboard Kerbal who will be killed. Both actions revalidate
  the vessel identity, recovery state, and exact crew roster before acting.
  Termination passes the selected kRPC vessel object directly to the service,
  retaining collision-safe identity when the pinned Python client omits GUIDs.
- Made an empty transfer-window board calculate automatically once MechJeb is
  available, wait without taking over an existing transfer-planning job, and
  moved the manual calculate, refresh, and cancel control into the section
  header so installed planet packs have more room for destination cards.

## v0.4.1 - Faster, resilient editor calculations

- Retained the previous confirmed VAB/SPH staging analysis and craft totals
  during same-craft recalculation, with explicit stale labeling and hard
  invalidation across craft, scene, empty-craft, and MechJeb-core boundaries.
- Added StageStats 0.2.6 editor rebuild diagnostics so staging-sequence changes
  schedule MechJeb's normal PartSet rebuild before a fresh analysis can be
  confirmed, including the terminal decoupler-only stage case.
- Accelerated editor condition changes with one atomic body/altitude/Mach
  update, compact whole-table stage snapshots, safe craft-summary reuse, and a
  shorter coalescing delay while preserving MechJeb completion safeguards.
- Added StageStats 0.2.7 exact editor-job generations so completed atmosphere
  and vacuum simulations can publish immediately; ambiguous or incompatible
  MechJeb states retain the conservative timed confirmation path.

## v0.4.0 - Mission planning and flight engineering

- Added integrated mission-planning workspaces for transfer windows, selected
  transfer details, resonant-orbit deployment, and vessel delta-v planning.
- Added a MechJeb-backed porkchop calculator with explicit preview and
  confirmation steps before Mission Control creates a maneuver node. The
  dashboard never executes nodes, warps, steers, stages, or changes throttle.
- Enabled Simple ideal-transfer plans to retain MechJeb's departure vector for
  the same safe maneuver preview and confirmation workflow used by selected
  porkchop transfers.
- Prevented a reloaded or reconnected dashboard from offering node creation
  against a maneuver preview owned by an expired browser session.
- Added persistent planner drafts, saved plans, vessel assignments, and
  resonant-orbit records with revision checks, bounded storage, backup recovery,
  and cross-tab merge behavior.
- Expanded the Flight and VAB/SPH staging views with authoritative KSP stage
  numbers, start-to-burnout TWR ranges, total burn duration, flight conditions,
  and compatibility fallbacks for older service responses.
- Expanded System Heat loop details with nominal temperature, net flux,
  radiator state, and grouped producer/radiator components.
- Corrected System Heat status so settled or cooling loops at their nominal
  operating temperature are not mislabeled as hot; active warming and explicit
  hazards still surface.
- Added calibrated ElectricCharge net-flow and draw estimates that account for
  the telemetry collector's slower resource cadence and full/empty saturation.
- Stabilized the Flight electricity layout by suppressing physically invalid
  negative "Other" generation remainders caused by sequential source sampling.
- Moved the Mission Plan progress and Undo Last controls out of the narrow
  delta-v comparison card so completed-step actions remain readable in Flight.
- Hardened the production loopback server with exact host/origin validation,
  content security policy, bounded commands and queues, per-WebSocket sessions,
  and a shared persisted planning controller.
- Replaced the upstream `KRPC.MechJeb.dll` bridge with
  `KRPC.WoobiesMechJeb` 0.8.6, Woobie's GPLv3-compatible fork targeting
  MechJeb 2.15.3. The launcher backs up and removes the superseded bridge during
  service repair.
- Updated the selected service set to WoobiesControlStats 0.2.1,
  KRPC.StageStats 0.2.5, KRPC.SystemHeat 0.2.2, and
  KRPC.WoobiesMechJeb 0.8.6.
- Added release packaging contracts for exact service hashes, GPL source and
  notice delivery, consolidated third-party attribution, and five ordered
  v0.4.0 screenshot slots.

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
