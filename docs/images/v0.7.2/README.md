# v0.7.2 release screenshots

Version 0.7.2 materially updates Settings, dashboard themes, integration
visibility, and Delta-V plan management. These five compositions were approved
in deterministic development fixtures and must be recaptured from the exact
release candidate without a visible pointer. Production-package acceptance is
a separate gate and must prove fixture/development controls are absent.

| Slot | Status | File | Source brief |
| --- | --- | --- | --- |
| 1 | captured | `flight-mission-control-dark.png` | 1920x889 Flight fixture in Mission Control Dark with the complete instrument plate and operational panels |
| 2 | captured | `editor-green-phosphor.png` | 1920x889 Editor fixture in Green Phosphor with electricity, staging, resources, and pinned plans |
| 3 | captured | `mission-overview-warm-crt.png` | 1920x889 Mission Overview fixture in Warm CRT with program status, transfer windows, fleet, roster, alarms, and contracts |
| 4 | captured | `mission-overview-settings-daylight.png` | 1920x889 Mission Overview in Daylight Console with Settings open to Appearance and all four theme cards visible |
| 5 | captured | `delta-v-planner-daylight.png` | 1920x889 Daylight Console Delta-V planner with the loaded Kerbin-to-Duna route, separated plan tools, and mission-wide transfer mode |

## Acceptance requirements

- Capture from the managed v0.7.2 release worktree development dashboard and
  deterministic fixture feed using a Chromium-family browser.
- Preserve a true 1920x889 PNG viewport; do not resize or stretch the image.
- Hide the pointer outside the captured viewport before each capture.
- Keep the developer corner closed, omit browser chrome, and verify there are
  no visible development controls, loading artifacts, clipped text, overlays,
  horizontal overflow, console errors, or unintended focus rings.
- Record the exact release commit, source scene/state, and SHA-256 for each
  approved PNG before package assembly.

| File | SHA-256 |
| --- | --- |
| `flight-mission-control-dark.png` | `C91074BCBC88D3F054394BF3B269F205A4DE719B13ABA83700A75805794E6056` |
| `editor-green-phosphor.png` | `CEA3A4778D917E6845CB6F4C370734E5A7C6323F37945626BD3D9B55F90CB04A` |
| `mission-overview-warm-crt.png` | `9AF113B2260B9C5DD5DAD463B386D7553ADEDED12E975EE332562A3C44687B19` |
| `mission-overview-settings-daylight.png` | `64CB2BAAC9F5419602DB0D46C4D773B84715C68D7CE783252AB4F0ED6AA70F19` |
| `delta-v-planner-daylight.png` | `6CC90E56BA7C08E1C07BE10BB309F8063639359729AE7FFD2D842F3BDC0E20E9` |

The publish script assigns these files to `.zz-01` through `.zz-05` so the
product ZIP, checksum, and corresponding-source archive remain first.

Capture authority: pending the committed v0.7.2 release candidate.
