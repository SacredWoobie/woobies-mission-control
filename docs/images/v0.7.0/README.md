# v0.7.0 release screenshots

Version 0.7.0 materially updates the Flight and Editor surfaces, so all five
curated images will be captured from the deterministic development dashboard
at the exact release candidate. The developer corner must remain closed and
absent from every image. Production-package acceptance remains a separate gate.

| Slot | Status | File | Source brief |
| --- | --- | --- | --- |
| 1 | pending | `space-center-overview.png` | 1920x889 Mission Control overview with program status, transfer windows, fleet, roster, alarms, and no development controls visible |
| 2 | pending | `active-contract-focus.png` | 1920x889 focused active contract showing deadline context and the full operational briefing |
| 3 | pending | `editor-craft-analysis.png` | 1920x889 Editor workspace showing the electricity scenario/readout, generated and consumed ledgers, staging, resources, and a representative pinned plan |
| 4 | pending | `flight-damage-monitor.png` | 1920x889 Flight MONITOR workspace showing the integrated instrument plate, actionable annunciators, and focused damage state |
| 5 | pending | `flight-plan-workspace.png` | 1920x889 Flight PLAN workspace showing the integrated instrument plate and pinned operational planning surfaces |

## Acceptance requirements

- Capture from the managed v0.7.0 development dashboard and deterministic
  fixture feed using a Chromium-family browser.
- Preserve the exact 1920x889 PNG dimensions; do not stretch a smaller content
  viewport without recording and visually verifying the transformation.
- Keep the developer corner closed, omit browser chrome, and verify there are
  no visible development controls, loading artifacts, clipped text, overlays,
  horizontal overflow, console errors, or unintended focus rings.
- Record the exact product commit, source scene/state, and SHA-256 for each
  approved PNG below before packaging.

| File | SHA-256 |
| --- | --- |
| `space-center-overview.png` | pending |
| `active-contract-focus.png` | pending |
| `editor-craft-analysis.png` | pending |
| `flight-damage-monitor.png` | pending |
| `flight-plan-workspace.png` | pending |

The publish script assigns these files to `.zz-01` through `.zz-05` so the
product ZIP, checksum, and corresponding-source archive remain first.
