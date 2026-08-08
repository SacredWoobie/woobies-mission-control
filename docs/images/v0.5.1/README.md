# v0.5.1 release screenshots

Version 0.5.1 materially changes the live Active Contracts deadline hierarchy.
Its curated gallery uses two accepted live Career captures and reuses the three
unchanged v0.5.0 Editor and Flight captures. The v0.5.1 copies are losslessly
encoded as true PNG files; older gallery files retain their historical bytes.

| Slot | Status | File | Source brief |
| --- | --- | --- | --- |
| 1 | approved | `space-center-overview.png` | Live Career save at 1920x889; program overview visible with one compact contract countdown and two deadline-silent contracts |
| 2 | approved | `active-contract-focus.png` | Same live session and viewport; deadline-bearing contract expanded with absolute KSP due date and UT in the briefing facts |
| 3 | approved | `editor-craft-analysis.png` | Reused visually unchanged from v0.5.0; craft header, dense staging, resource inventory, and pinned plan visible |
| 4 | approved | `flight-monitor.png` | Reused visually unchanged from v0.5.0; Ascension/navball, staging, consumables, Master Caution, and Monitor workspace visible |
| 5 | approved | `flight-plan-workspace.png` | Reused visually unchanged from v0.5.0; Plan workspace selected with pinned operational planning visible |

## Acceptance record

The first two images were captured from the accepted live Career session using
the production dashboard at merged feature head `a9f4927`. The user accepted
both compact and expanded states; the browser console contained no warnings or
errors. All five files are 1920x889 PNGs.

| File | SHA-256 |
| --- | --- |
| `space-center-overview.png` | `02EFE8520EE3011863DBCFFBE3C9BD46F42A4D843C5D6C38F94DA206E3FF55A9` |
| `active-contract-focus.png` | `3514FC9806861EC37619C4E068AFAB412CBE07E16592246052CD6126E02BF71C` |
| `editor-craft-analysis.png` | `B467D02F6FE83546AF10D474EFCDC687FB2C8C91072EB9F70F8A6F5B0E1A670B` |
| `flight-monitor.png` | `C6F3AA8D354CE7A6DE50C1D0EEFD4D354BB8C5AEE5E51482D37E6A33645C3049` |
| `flight-plan-workspace.png` | `35305BFAF03A75FEB04D617706CCCDD42F126E4B0F3733A218C91942379AACAE` |

The publish script assigns these files to `.zz-01` through `.zz-05` so the
product ZIP, checksum, and corresponding-source archive remain first.
