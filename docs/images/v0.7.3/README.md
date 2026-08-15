# v0.7.3 release screenshots

Version 0.7.3 materially updates portrait Mission Control and Editor layouts,
adds Catppuccin Mocha, and adds the optional KSP2 Pre-Alpha Style NavBall.
These five compositions must be captured from the exact release candidate
without a visible pointer. Production-package acceptance remains a separate
gate proving fixture and development controls are absent.

| Slot | Status | File | Source brief |
| --- | --- | --- | --- |
| 1 | captured | `mission-overview-catppuccin-portrait.png` | 1080x1785 portrait Mission Overview in Catppuccin Mocha showing the full-height Active Vessels column and the roster/contracts/alarms stack |
| 2 | captured | `editor-catppuccin-portrait.png` | 1080x1785 portrait Editor in Catppuccin Mocha showing Sim Conditions followed by Staging Analysis, bounded Resource Inventory, and Electricity |
| 3 | captured | `flight-ksp2-navball.png` | 1080x1785 portrait Flight fixture with the optional KSP2 navball active, its line work clear, and the complete operational instrument plate visible |
| 4 | captured | `flight-settings-visual-options.png` | 1080x1785 portrait Flight fixture with Settings open to the persistent theme and navball options while Catppuccin Mocha and the KSP2 navball are selected |
| 5 | captured | `mission-overview-roster-transfers.png` | 1080x1785 portrait Mission Overview in the default theme showing the 2x2 roster badge summary and larger blue transfer destinations without repeated departure captions |

## Acceptance requirements

- Capture from the managed v0.7.3 release worktree development dashboard and
  deterministic fixture feed using a Chromium-family browser.
- Preserve each source brief's exact CSS viewport and device scale factor 1;
  do not resize or stretch an image.
- Hide the pointer outside the captured viewport before each capture.
- Keep the developer corner closed; omit browser chrome and verify no visible
  development controls, loading
  artifacts, clipped text, overlays, horizontal overflow, console errors, or
  unintended focus rings.
- Record the exact release commit, source scene/state, and SHA-256 for each
  approved PNG before final package assembly.

| File | SHA-256 |
| --- | --- |
| `mission-overview-catppuccin-portrait.png` | `2674B5F3198CAE0123832C46C7532CC85D6F29DE6FBC0824D7E1D78A9A8DB6FD` |
| `editor-catppuccin-portrait.png` | `222B819563F08E46C45903262B9AAE2ED14A5C38BF629E7839A2DD305C81B94D` |
| `flight-ksp2-navball.png` | `402AFC9E1DEDE5F565F91B176AFE4C020618C9B6D72C5E711FC5FC8ED9E94CE2` |
| `flight-settings-visual-options.png` | `32D21220321476BE5EB2E0EFC36953D9EA2D75037CB16D7A1338F95D196607D3` |
| `mission-overview-roster-transfers.png` | `41019D8C757CEBD28DDBDC417325E80329F24E325F95876B4D4B740769C99A91` |

The publish script assigns these files to `.zz-01` through `.zz-05` so the
product ZIP, checksum, and corresponding-source archive remain first.

Capture authority: committed v0.7.3 release-prep source `b2f7ee4`. Chrome was
held at a 1080x1785 CSS viewport with device scale factor 1. Its captured frames
were decoded and PNG-encoded without resizing; every committed file has the
exact dimensions and digest above.
