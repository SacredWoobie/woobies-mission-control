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
| 1 | captured | `space-center-overview.png` | Space Center program overview with live Career data, transfer windows, active vessels, roster, alarms, and contracts. |
| 2 | captured | `resonant-orbit-planner.png` | Resonant Orbit planner configured for three satellites at a 2,000 km circular Kerbin orbit, with target Ap/Pe guidance, LOS context, and source links visible. |
| 3 | captured | `delta-v-planner.png` | Delta-V planner for a credible Kerbin-to-Sarnus orbit mission, with transfer-window details, route legs, and totals visible. |
| 4 | captured | `editor-vab-mission-plan.png` | VAB/SPH craft summary and staging analysis with the three-satellite resonant-orbit plan pinned to the craft; show atmospheric and vacuum values without fixture warnings. |
| 5 | captured | `flight-dashboard-mission-planning.png` | Flight dashboard with the Sarnus mission plan pinned, healthy live telemetry, useful staging rows, and non-alarm heat/electricity data. |

The release assets derived from these captures must use the established
`.zz-01` through `.zz-05` suffixes so the normal release ZIP sorts first.
Retain the full-resolution originals in this directory and optimize only copies
if GitHub or README rendering requires it. Launcher migration and service-repair
acceptance remain required release evidence, but are documented separately
rather than occupying a product-gallery screenshot.

## Supplemental documentation captures

These images support README/wiki documentation but are not part of the five
ordered `.zz-01` through `.zz-05` GitHub release-gallery assets.

| Status | Documentation filename | Required content |
| --- | --- | --- |
| captured | `delta-v-porkchop-selection.png` | Advanced Kerbin-to-Sarnus porkchop selector with the live MechJeb grid, selected departure/arrival solution, and evaluation readouts visible. |
| captured | `delta-v-round-trip-plan.png` | Advanced Kerbin-to-Sarnus round-trip budget with the setup collapsed and the calculated loiter, return window, and Kerbin aerocapture visible. |
