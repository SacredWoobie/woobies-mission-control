# v0.5.0 release screenshots

Version 0.5.0 materially changes all three dashboard scenes, so its curated
gallery uses fresh dashboard captures rather than reusing prior-release images.

| Slot | Status | File | Source brief |
| --- | --- | --- | --- |
| 1 | captured | `space-center-overview.png` | Deterministic inactive fixture at 1920x889; compact Active Contracts, fleet, roster, alarms, and transfer windows visible |
| 2 | captured | `active-contract-focus.png` | Same inactive fixture and viewport; one contract focused with the rail, synopsis, objectives, conditions, due date, and rewards visible |
| 3 | captured | `editor-craft-analysis.png` | Deterministic Editor fixture at 1920x889; craft header, dense staging, resource inventory, and pinned plan visible |
| 4 | captured | `flight-monitor.png` | Deterministic Flight fixture at 1920x889; Ascension/navball, staging, consumables, Master Caution, and Monitor workspace visible |
| 5 | captured | `flight-plan-workspace.png` | Same Flight fixture and viewport; Plan workspace selected with pinned operational planning visible |

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

Captured from clean local feature candidate `ff226ad` using the deterministic
development fixtures. The development drawer was closed and its corner tab was
hidden. All files are 1920x889 PNGs and remain pending final visual approval:

| File | SHA-256 |
| --- | --- |
| `space-center-overview.png` | `D3A459FD565FECD30C003EB28BB3665F441319A19295E35DD469E48ACD405285` |
| `active-contract-focus.png` | `CF85AF654ABC83E0AB1C109E14C118FD36DAAC078CBC7CD9AA53DC1FBC41EE4F` |
| `editor-craft-analysis.png` | `F2538B076C244C3CBE82D66A6000068E67C514D1231FC64C73DAADD9A11D6687` |
| `flight-monitor.png` | `7CEB2B38C01642917F30684C6CACAF136672503752F8DFC18FDB02B25C715118` |
| `flight-plan-workspace.png` | `757B63181F59A39764DF635718105615396550B4EF3C888B750AD1FE652274FF` |
