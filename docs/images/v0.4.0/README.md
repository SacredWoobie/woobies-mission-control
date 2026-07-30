# v0.4.0 release screenshot brief

Capture these images only from the final production release candidate. Do not
use the prototype package, development controls, mock-only labels, browser
chrome, desktop notifications, personal save names, or transient error states.

Use the same representative Stock craft and save where practical, keep the
dashboard at 100% browser zoom, and use a full-size Chrome window so the
ChatGPT-in-Chrome popup does not change the dashboard layout. Check every frame
at full resolution for stale versions, clipped drawers, unintended scrollbars,
and identifying information.

For each row, Codex supplies the exact KSP scene, craft/state, and dashboard
arrangement. The user prepares that state and confirms it is ready; Codex then
captures and inspects the image before changing the row to `captured`. A shot
does not become `approved` until both parties are satisfied with it.

| Order | Status | Documentation filename | Required content |
| --- | --- | --- | --- |
| 1 | not ready | `flight-dashboard-mission-planning.png` | Flight dashboard with healthy live telemetry, the mission-planning rail controls, useful staging rows, and non-alarm heat/electricity data. |
| 2 | not ready | `delta-v-planner.png` | Delta-V planner with a credible multi-leg route, transfer-window details, totals, and a pinned plan visible behind or beside the drawer. |
| 3 | not ready | `resonant-orbit-planner.png` | Resonant Orbit planner with target Ap/Pe guidance, LOS context, and the required source links visible. |
| 4 | not ready | `editor-vab-mission-plan.png` | VAB/SPH craft summary and staging analysis with a craft-bound saved plan; show both atmospheric and vacuum values without warnings caused by fixture gaps. |
| 5 | not ready | `launcher-service-repair.png` | v0.4.0 launcher showing all four selected services current after legacy `KRPC.MechJeb.dll` migration and repair. |

The release assets derived from these captures must use the established
`.zz-01` through `.zz-05` suffixes so the normal release ZIP sorts first.
Retain the full-resolution originals in this directory and optimize only copies
if GitHub or README rendering requires it.
