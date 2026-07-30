# v0.4.0 release screenshot brief

Capture these images only from the final production release candidate. Do not
use the prototype package, development controls, mock-only labels, browser
chrome, desktop notifications, personal save names, or transient error states.

Use the same representative Stock craft and save where practical, keep the
dashboard at 100% browser zoom, and capture at a wide desktop viewport large
enough to preserve the intended multi-column layout. Check every frame at full
resolution for stale versions, clipped drawers, unintended scrollbars, and
identifying information.

| Order | Documentation filename | Required content |
| --- | --- | --- |
| 1 | `flight-dashboard-mission-planning.png` | Flight dashboard with healthy live telemetry, the mission-planning rail controls, useful staging rows, and non-alarm heat/electricity data. |
| 2 | `delta-v-planner.png` | Delta-V planner with a credible multi-leg route, transfer-window details, totals, and a pinned plan visible behind or beside the drawer. |
| 3 | `resonant-orbit-planner.png` | Resonant Orbit planner with target Ap/Pe guidance, LOS context, and the required source links visible. |
| 4 | `editor-vab-mission-plan.png` | VAB/SPH craft summary and staging analysis with a craft-bound saved plan; show both atmospheric and vacuum values without warnings caused by fixture gaps. |
| 5 | `launcher-service-repair.png` | v0.4.0 launcher showing all four selected services current after legacy `KRPC.MechJeb.dll` migration and repair. |

The release assets derived from these captures must use the established
`.zz-01` through `.zz-05` suffixes so the normal release ZIP sorts first.
Retain the full-resolution originals in this directory and optimize only copies
if GitHub or README rendering requires it.
