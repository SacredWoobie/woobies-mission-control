# Dashboard UI/UX guidelines

This document is the design authority for Woobie's Mission Control dashboard.
It records the defaults established through the Flight, Editor, and Mission
Overview redesigns. These are defaults rather than a frozen pixel specification:
an exception is allowed when the task genuinely requires one, but the reason and
validation must be recorded in the active feature workstream.

The dashboard is an operational second screen. Prefer useful information,
legible state, and predictable interaction over visual novelty or maximum
density.

## Cross-dashboard standards

### Information hierarchy and telemetry integrity

- Put the information needed for the next decision first. Supporting context
  follows it; diagnostics and flavor text use progressive disclosure.
- Display only state supported by telemetry or a documented local calculation.
  Do not invent health indicators, availability dots, confidence, or graphical
  meaning merely to fill space.
- A graphic must communicate real state more quickly than the equivalent text.
  Decorative diagrams and illustrations do not belong in operational panels.
- Remove repeated counts, labels, units, captions, and restatements when the
  surrounding structure already provides the same meaning.
- Keep distinct concepts separate even when they share a field. Alarms and
  contracts both have dates, for example, but represent different jobs and
  remain separate surfaces.
- Distinguish loading, empty, unavailable, not applicable, service-offline, and
  error states. Never let absent optional telemetry look like a valid zero.
- Prefer complete terms over ambiguous abbreviations. When an abbreviation is
  necessary, keep units and condition labels explicit and provide the full
  meaning through nearby copy or accessible text.

### Typography and semantic color

- Operational titles, roles, deadlines, values, and decision text must remain
  readable in the actual browser. Use 10-12 px as the normal compact range;
  reserve 8-9 px text for truly secondary captions and metadata. Eight pixels
  is the absolute floor for rendered dashboard text; do not evade it with a
  shorthand declaration or a scene-specific stylesheet.
- Use `--slate-muted-text` or a stronger semantic text token for supporting
  information a user must read. `--slate-dim` is reserved for decorative
  borders, strokes, fills, and other non-text detail that can safely recede.
- Preserve the dashboard's semantic palette: cyan for active state and primary
  operational controls, amber for time-sensitive or emphasized values, green
  for available/success/recovery state, and red for warnings or destructive
  actions. Color is never the only carrier of meaning.
- Values in repeated rows align to shared tracks. Numbers, units, tags, and
  countdowns should scan vertically rather than drift with content length.
- Reformat numeric values through units and precision before truncating them.
  Do not ellipsize a number whose magnitude or unit affects a decision.

### CSS foundation and reuse

- `frontend/src/styles.css` owns the shared `:root` palette used by both active
  production stylesheets. `resonantOrbit/resonantOrbit.css` consumes those
  roles rather than defining a parallel palette.
- Name shared colors for their job, not their hue or the component that first
  needed them. Current reusable roles include primary/value/muted text,
  control surfaces, instrument surfaces, accent borders, success borders, and
  error text. Keep warning and destructive roles distinct even when their
  values are visually related.
- Promote a raw color only after checking every exact use across both active
  stylesheets and confirming one honest semantic role. Preserve local literals
  for gradients, alpha overlays, shadows, SVG/instrument geometry, and
  data-visualization endpoints when a global role would be misleading.
- Do not mechanically collapse near colors, replace all raw literals, or remove
  `!important`. Each can encode state, cascade, opacity, or instrument geometry;
  change it only with selector-level evidence and rendered review.
- `pnpm test:css` is the executable contract. It rejects undefined custom
  properties, direct reuse of migrated literals, undersized pixel text,
  low-contrast `--slate-dim` text, and regressions in selected semantic-token
  contrast pairs. Expand it incrementally when a new role is fully migrated;
  do not turn current literal counts into a brittle pass/fail target.

### Layout and responsive behavior

- Size header tracks according to their content. Equal-width metrics are not a
  default when one value needs materially more room than another.
- Let components reflow from their own available width. Prefer container-owned
  breakpoints for panel internals and viewport breakpoints for scene structure.
- Avoid document-level horizontal overflow at every supported size. Preserve
  legibility before trying to eliminate all vertical scrolling.
- Treat `1920x889`, `1280x800`, and `1080x1920` as the standard browser review
  matrix. Wide landscape and portrait should normally fit their core scene
  without document scrolling. Short landscape may use a documented vertical
  fallback when internal containment would make the interface less readable.
- Dense lists and detailed readers should scroll inside a bounded region while
  their heading and primary controls remain visible. Do not shrink text or
  controls merely to avoid a scrollbar.
- Use `scrollbar-gutter: stable` only when preventing a real alignment shift is
  worth the permanent lane. Do not leave a visibly empty scrollbar strip beside
  content that usually fits.
- Preserve useful space. Empty columns, duplicated banners, redundant rails,
  and decorative cards should not displace operational information.

### Disclosure and focused work

- Keep primary scene sections available. Collapse subordinate groups or detail,
  not the surfaces required to understand the scene.
- When detail cannot remain readable inline, promote it into a focused reader
  with a persistent selection rail rather than stretching a small accordion.
- Default to one expanded item at a time when simultaneous comparison is not
  part of the task. Opening a new item closes the previous detail.
- Focused and modal surfaces provide an explicit Back or Close control, close
  on Escape, and close on an outside click when doing so cannot discard unsaved
  work. Interactions inside the surface must not trigger click-away handling.
- Preserve the selected item, component state, relevant scroll position, and
  return focus whenever the user changes views or dismisses temporary detail.

### Controls, actions, and safety

- Controls that form one action group use the same height and, where practical,
  the same width. Align them on one row until responsive layout requires a
  deliberate reflow.
- Separate action rows vertically from the readouts above them. Controls should
  look actionable rather than like another telemetry row.
- Use compact fine-pointer controls only when their labels remain legible.
  Coarse-pointer layouts retain at least the established 44 px rail and 36 px
  control targets.
- Primary, secondary, recovery, and destructive actions remain visually
  distinct. Destructive actions require explicit confirmation and current
  identity/state revalidation; disabled actions explain why they are disabled.
- Calculations and previews remain read-only. Maneuver creation continues to
  require a fresh preview and separate confirmation, and Mission Control never
  executes the burn.

### Accessibility and state preservation

- Use semantic headings, tables, tabs, dialogs, lists, buttons, meters, and
  expanded/selected/current states. Every icon-only control has an accessible
  name.
- Keyboard navigation, focus trapping, Escape behavior, focus restoration, and
  reduced-motion behavior are part of the interaction, not later polish.
- A responsive rearrangement must not remount a stateful panel merely to place
  it elsewhere. Placement is layout metadata; ownership remains stable.
- Hidden or inactive Flight workspace panels remain mounted but inert: they
  leave layout, measurement, accessibility, tab order, and telemetry
  subscription work until visible again.
- Fixtures are deterministic development evidence, not live-KSP acceptance.
  Documentation and workstream records must say which source was observed.

## Scene contracts

### Flight

- Ascension, Consumables, and Staging Analysis form the persistent vessel-state
  region. They remain expanded across both workspaces.
- MONITOR owns Electricity, Heat Management, Science, and Target. PLAN owns
  Mission Plan and pinned planning/reference companions. Empty PLAN remains
  discoverable.
- Workspace panels collapse in place to compact information rails. Their useful
  status and native controls remain visible; they are not duplicated in a
  restore rail.
- Lane assignment and responsive arrangement preserve panel DOM identity,
  component state, focus, and internal scroll. Inactive views suspend panel
  telemetry work and resume from the current snapshot.
- The fixed Master Caution surface reports vessel-wide actionable conditions.
  Feed diagnostics remain in history without masquerading as a vessel warning.
- Long staging inventories group distant powered stages before introducing
  internal scrolling, while keeping the current and nearest stages visible.
  Electricity, Heat, and Science details remain bounded and use one-at-a-time
  drill-in where appropriate.

### Editor

- Craft identity, mass, cost, build counts, and simulation conditions live in
  one full-width overview above the workspace columns. Do not restore a
  redundant Editor Link strip.
- Reference body, altitude, Mach, and presets remain directly editable and
  legible; numeric inputs do not need native spinner buttons.
- Without a pinned planning companion, Craft Analysis spans the workspace and
  Staging plus Resource Inventory share the row beneath it. Pinned plans retain
  a compact secondary planning column without starving the primary analysis.
- Eight powered stages fit before staging begins internal scrolling. Dense
  layouts keep the active stage visible and explain grouped or omitted stages.
- Pinned Resonant Orbit and Mission Plan panels are operational briefings, not
  miniature editors. They show identity, key status, budget or orbit facts, and
  an `EDIT PLAN` action that restores the exact saved record.
- Route identity stays concise: endpoints for a single destination, a stop
  count for multi-stop missions, and an explicit round-trip label for returning
  missions.

### Mission Overview

- Transfer Windows, Active Vessels, Astronaut Roster, Upcoming Alarms, and
  Active Contracts remain available on the main page. They do not use panel
  hide buttons or a restore rail.
- The identity and program-status header uses content-weighted tracks so Funds,
  Science, Reputation, and especially Contracts receive the room their content
  needs. Narrow layouts reflow instead of silently truncating status.
- Active Vessels groups celestial bodies by the live body hierarchy: primary
  planets sort outward from the system star and each moon follows its parent.
  Body groups are independent disclosure controls with thin, dimensional gray
  headings, white text, and vertically centered chevrons.
- The selected-vessel briefing uses only useful source-backed orbit, crew, and
  next-event data. It does not add decorative orbit art, ungrounded crew dots,
  or duplicate crew totals. Switch, Edit, and Recover/Terminate controls form a
  separated, equal-sized action row.
- The Astronaut Roster keeps Assigned, Available, and Memorial totals in its
  header while preserving readable Name, Role, Level, Assignment, and Flights
  columns in the table.
- Upcoming Alarms remains distinct from Active Contracts. Alarm identity,
  source/type tags, and countdown use aligned tracks, with countdowns anchored
  on the right; alarm overflow scrolls inside the panel.
- Compact contract rows show title and due state. Selecting one promotes Active
  Contracts into the right-side rail-and-reader workspace with readable
  synopsis, rewards, objectives, optional briefing, and technical detail. Only
  one contract is focused at a time; Back, Escape, and outside click restore the
  compact overview.

## Design and verification checklist

Before calling dashboard UI work complete:

1. Confirm the first glance answers the scene's primary user question and that
   every visual element communicates real information.
2. Remove redundant copy and verify required secondary text remains readable in
   Chrome rather than relying only on declared CSS sizes. Run `pnpm test:css`
   before rendered review so undefined tokens, migrated literals, the 8 px text
   floor, and selected contrast contracts fail early.
3. Exercise normal, dense, long-label, loading, empty, unavailable, offline,
   error, and missing-optional-field fixtures applicable to the change.
4. Inspect `1920x889`, `1280x800`, and `1080x1920`; measure document and panel
   overflow and record any intentional short-landscape exception.
5. Verify repeated tracks align, controls remain usable, and scrollbars appear
   only where their interaction or alignment benefit is intentional.
6. Test mouse, keyboard, Escape, click-away, focus trapping/restoration,
   expanded/selected semantics, and reduced motion where applicable.
7. Run focused component tests, the full frontend suite, strict TypeScript and
   production build, and the relevant browser compatibility matrix.
8. Validate with deterministic fixtures first, then record live KSP evidence
   separately when the feature depends on live behavior.
9. Record any deliberate deviation from this guide, its reason, viewports, and
   acceptance evidence in the active workstream before PR readiness.
10. Refresh public screenshots and wiki pages from the clean release candidate,
    not from an intermediate dirty feature worktree.
