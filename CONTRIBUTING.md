# Contributing

Woobie's Mission Control combines a Python 3.14 loopback runtime with a
React/TypeScript dashboard. Keep changes scoped, preserve the read-only mission
safety boundaries described in the README, and include enough validation for a
reviewer to reproduce the result.

## Local checks

Run the Python suite from the repository root with the project environment:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
```

Install and check the dashboard with Node.js 24 and the pnpm version declared in
`frontend/package.json`:

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs the CSS contract, Vitest suite, strict TypeScript/Vite build,
and Chrome/Edge browser compatibility suite. Use `pnpm test:css`,
`pnpm test:unit`, `pnpm build`, or `pnpm test:browser` for focused iteration,
but run the complete command before requesting review.

## Dashboard CSS changes

The tracked [dashboard UI/UX guidelines](docs/DASHBOARD_UI_GUIDELINES.md) are
the design authority. For palette or typography work:

1. Search both `frontend/src/styles.css` and
   `frontend/src/resonantOrbit/resonantOrbit.css`; both ship in production.
2. Reuse a semantic token only when its role matches. Before introducing a new
   token, audit every exact literal occurrence and name the token for the role
   shared by those selectors.
3. Keep the 8 px text floor and use `--slate-muted-text` or a stronger token for
   readable secondary copy. Reserve `--slate-dim` for non-text decoration.
4. Leave one-off gradients, alpha overlays, shadows, instrument/SVG geometry,
   and data-visualization endpoints local when no honest shared role exists.
5. Run `pnpm test:css`, then inspect deterministic Flight, Editor, and Mission
   Overview fixtures at the applicable `1920x889`, `1280x800`, and `1080x1920`
   viewports. Record overflow and distinguish fixture evidence from live KSP.

Do not use raw-literal counts, `!important` counts, or the absence of `rem` units
as automatic defect tests. Each can be legitimate; change it with selector-level
evidence and rendered review.

## Pull-request evidence

Summarize the affected behavior and report the exact local checks that passed.
For UI changes, include the scenes, states, viewports, overflow observations,
and browser families exercised. Note any manual or live-KSP acceptance still
outstanding rather than treating fixtures as equivalent.

GitHub Actions runs two read-only jobs on pull requests and pushes to `main`:
`Python runtime` and `Frontend and browser compatibility`. After the workflow's
first successful run on the default branch, repository administrators should
configure both job names as required branch-protection checks. The workflow
does not publish releases or modify a KSP installation.
