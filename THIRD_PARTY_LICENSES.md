# Third-party notices

Woobie's Mission Control includes or adapts the third-party software listed
below. These notices apply to the identified components, not to the project as
a whole.

## React, React DOM, and Scheduler

- React 19.2.7
- React DOM 19.2.7
- Scheduler 0.27.0
- Source: <https://github.com/facebook/react>
- License: MIT

```text
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Resonant Orbit Calculator lineage

Mission Control's resonant-orbit calculation behavior is adapted from:

- Eric Meyer's original Resonant Orbit Calculator:
  <https://meyerweb.com/eric/ksp/resonant-orbits/>
- linuxgurugamer/ResonantOrbitCalculator, reviewed at commit
  `09da28df5422f8d060d1a03a9c9a391f01a01351`:
  <https://github.com/linuxgurugamer/ResonantOrbitCalculator>
- License: MIT

Eric Meyer's calculator identifies Eric Meyer as its provider and states that
it is offered under the MIT License. The LinuxGuruGamer repository reproduces
the following notice:

```text
MIT License

Copyright (c) 2018

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## KRPC.WoobiesMechJeb

The distributed `KRPC.WoobiesMechJeb.dll` is Woobie's modified fork of
[Genhis/KRPC.MechJeb](https://github.com/Genhis/KRPC.MechJeb), based on
upstream release v0.7.1 at commit
`398bc337492c5f725c83ab1aac85c32a1c0349ea`.

The fork is licensed under `GPL-3.0-only`. Its complete GPL license and
provenance notice are distributed beside the DLL, and its corresponding source
archive is attached to the Mission Control release.

[MechJeb 2](https://github.com/MuMech/MechJeb2) is a separately installed
runtime integration. It is not bundled with Mission Control. Mission Control
and KRPC.WoobiesMechJeb are not affiliated with or endorsed by the MechJeb or
upstream KRPC.MechJeb maintainers.
