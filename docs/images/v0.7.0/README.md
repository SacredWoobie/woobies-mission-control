# v0.7.0 release screenshots

Version 0.7.0 materially updates the Flight and Editor surfaces, so all five
curated images will be captured from the deterministic development dashboard
at the exact release candidate. The developer corner must remain closed and
absent from every image. Production-package acceptance remains a separate gate.

| Slot | Status | File | Source brief |
| --- | --- | --- | --- |
| 1 | approved | `space-center-overview.png` | 1920x889 inactive fixture with program status, transfer windows, fleet, roster, alarms, and the contract list |
| 2 | approved | `active-contract-focus.png` | 1920x889 inactive fixture with Explore Duna selected and its deadline, rewards, briefing, and objectives visible |
| 3 | approved | `editor-craft-analysis.png` | 1920x889 Editor fixture with electricity scenario/readout and ledgers, staging, resources, and both pinned plans |
| 4 | approved | `flight-damage-monitor.png` | 1920x889 Flight MONITOR fixture with the integrated instrument plate and focused active/recorded damage report |
| 5 | approved | `flight-plan-workspace.png` | 1920x889 Flight PLAN fixture with the instrument plate, mission plan, resonant-orbit plan, and pinned note |

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
| `space-center-overview.png` | `F9D2F509C877E107BBC29A03A7B32FBFADD7647D5DF5476C22049F673F7EB9E2` |
| `active-contract-focus.png` | `FC5049E05A79A43B3668CE0B64FD42D84CE4D8ED06E43C5C762F4B7F5407C9E3` |
| `editor-craft-analysis.png` | `E256C9FFDEB23B99E89F567C43A8CF6542B8E6D756F9146908DFCC87F2592C72` |
| `flight-damage-monitor.png` | `F41A9ED86F286B9C020132D2F96A45DB91AEB9B246FED879F8E93CBF5C7056EA` |
| `flight-plan-workspace.png` | `3ECB659B4523759503FEA31CCDD89073DA20550C3B84B800E9D349904C1BF5FE` |

The publish script assigns these files to `.zz-01` through `.zz-05` so the
product ZIP, checksum, and corresponding-source archive remain first.

Capture authority: clean release commit `35e876740d41e22b7c717e95ad12339fd81b5a1c`
using deterministic fixtures in Chromium at a 1920x889 CSS viewport. The
developer drawer was closed with its tab at computed opacity zero; each scene
reported a 1920x889 document with no horizontal overflow, and the browser log
contained no warnings or errors. The browser's JPEG capture bytes were
mechanically re-encoded as true PNG without resizing, then signature,
dimensions, and hashes were verified.
