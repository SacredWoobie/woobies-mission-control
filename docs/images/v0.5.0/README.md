# v0.5.0 release screenshots

Version 0.5.0 materially changes all three dashboard scenes, so its curated
gallery uses fresh dashboard captures rather than reusing prior-release images.

| Slot | Status | File | Source brief |
| --- | --- | --- | --- |
| 1 | not ready | `space-center-overview.png` | Deterministic inactive fixture at 1920x889; compact Active Contracts, fleet, roster, alarms, and transfer windows visible |
| 2 | not ready | `active-contract-focus.png` | Same inactive fixture and viewport; one contract focused with the rail, synopsis, objectives, conditions, due date, and rewards visible |
| 3 | not ready | `editor-craft-analysis.png` | Deterministic Editor fixture at 1920x889; craft header, dense staging, resource inventory, and pinned plan visible |
| 4 | not ready | `flight-monitor.png` | Deterministic Flight fixture at 1920x889; Ascension/navball, staging, consumables, Master Caution, and Monitor workspace visible |
| 5 | not ready | `flight-plan-workspace.png` | Same Flight fixture and viewport; Plan workspace selected with pinned operational planning visible |

## Capture contract

- Capture the final production-equivalent dashboard styling from the clean
  release candidate. Development fixtures may supply deterministic telemetry.
- Keep the pointer away from the upper-left corner so the development-only
  `DEV` tab remains hidden. The tab and drawer must not appear in an image.
- Use a fresh browser profile or verify zoom is 100%, viewport is exactly
  1920x889 CSS pixels, no drawer or dialog is open unless named by the brief,
  and the document has no horizontal overflow.
- Do not crop away dashboard edges or add decorative browser chrome. Preserve
  the full-resolution PNG and verify its dimensions after capture.
- Record the accepted file SHA-256 values here before the draft release. The
  release pack and publish script use the filenames above in `.zz-01` through
  `.zz-05` order so the product ZIP remains first.

## Acceptance record

Pending clean-candidate capture and approval.
