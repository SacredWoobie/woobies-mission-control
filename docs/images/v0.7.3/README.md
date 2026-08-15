# v0.7.3 release screenshots

Version 0.7.3 materially updates portrait Mission Control and Editor layouts,
adds Catppuccin Mocha, and adds the optional KSP2 Pre-Alpha Style NavBall.
These five compositions must be captured from the exact release candidate
without a visible pointer. Production-package acceptance remains a separate
gate proving fixture and development controls are absent.

| Slot | Status | File | Source brief |
| --- | --- | --- | --- |
| 1 | not ready | `mission-overview-catppuccin-portrait.png` | 1080x1729 portrait Mission Overview in Catppuccin Mocha showing the full-height Active Vessels column and the roster/contracts/alarms stack |
| 2 | not ready | `editor-catppuccin-portrait.png` | 1080x1729 portrait Editor in Catppuccin Mocha showing Sim Conditions followed by Staging Analysis, bounded Resource Inventory, and Electricity |
| 3 | not ready | `flight-ksp2-navball.png` | 1920x889 Flight fixture with the optional KSP2 navball active, its line work clear, and the complete operational instrument plate visible |
| 4 | not ready | `flight-settings-visual-options.png` | 1920x889 Flight fixture with Settings open to the persistent theme and navball options while Catppuccin Mocha and the KSP2 navball are selected |
| 5 | not ready | `mission-overview-roster-transfers.png` | 1920x889 Mission Overview showing the 2x2 roster badge summary and larger blue transfer destinations without repeated departure captions |

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
| `mission-overview-catppuccin-portrait.png` | pending |
| `editor-catppuccin-portrait.png` | pending |
| `flight-ksp2-navball.png` | pending |
| `flight-settings-visual-options.png` | pending |
| `mission-overview-roster-transfers.png` | pending |

The publish script assigns these files to `.zz-01` through `.zz-05` so the
product ZIP, checksum, and corresponding-source archive remain first.
