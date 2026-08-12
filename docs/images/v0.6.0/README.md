# v0.6.0 release screenshots

Version 0.6.0 updates Flight telemetry and adds persistent vessel-damage and
unexpected part-loss reporting. Its curated gallery retains four visually
current v0.5.1 captures and refreshes the Flight Monitor slot with a managed
mock-server Chrome capture showing the DAMAGE annunciator and focused report.

| Slot | Status | File | Source brief |
| --- | --- | --- | --- |
| 1 | approved | `space-center-overview.png` | Reused unchanged from v0.5.1; live Career overview with program status, transfer windows, fleet, roster, alarms, and contract countdown |
| 2 | approved | `active-contract-focus.png` | Reused unchanged from v0.5.1; focused deadline-bearing contract with absolute KSP due date |
| 3 | approved | `editor-craft-analysis.png` | Reused unchanged from v0.5.1; craft header, dense staging, resource inventory, and pinned plan visible |
| 4 | approved | `flight-damage-monitor.png` | Production dashboard at 1920x889 driven by the managed mock server in Chrome; DAMAGE annunciator, two active damaged-part groups, and recorded cleared part loss visible |
| 5 | approved | `flight-plan-workspace.png` | Reused unchanged from v0.5.1; Plan workspace selected with pinned operational planning visible |

## Acceptance record

The four reused files remain true 1920x889 PNGs and retain their accepted
v0.5.1 bytes. Slot four was captured from the v0.6.0 production dashboard in
Chrome with no development corner control and no browser console warnings or
errors. The Chrome capture was losslessly re-encoded as a true PNG and scaled
from the extension's 1905x882 content viewport to the required 1920x889 release
dimensions.

| File | SHA-256 |
| --- | --- |
| `space-center-overview.png` | `02EFE8520EE3011863DBCFFBE3C9BD46F42A4D843C5D6C38F94DA206E3FF55A9` |
| `active-contract-focus.png` | `3514FC9806861EC37619C4E068AFAB412CBE07E16592246052CD6126E02BF71C` |
| `editor-craft-analysis.png` | `B467D02F6FE83546AF10D474EFCDC687FB2C8C91072EB9F70F8A6F5B0E1A670B` |
| `flight-damage-monitor.png` | `E3AC686CB7D1C84DD34F4A84EC28383B1C0B566018F6862576B15D03D3540AAD` |
| `flight-plan-workspace.png` | `35305BFAF03A75FEB04D617706CCCDD42F126E4B0F3733A218C91942379AACAE` |

The publish script assigns these files to `.zz-01` through `.zz-05` so the
product ZIP, checksum, and corresponding-source archive remain first.
