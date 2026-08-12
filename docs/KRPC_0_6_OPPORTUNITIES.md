# kRPC 0.6 follow-on opportunities

This backlog preserves useful kRPC 0.6 capabilities discovered during the
compatibility audit. They are deliberately not part of the compatibility-only
migration. Each item should be designed and accepted as a separate feature
after the 0.6 runtime and rebuilt service cohort pass live KSP validation.

## Recommended sequence

1. **Capability-aware diagnostics and stock staging cross-checks.** Use the
   corrected `GetServices` scene/deprecation metadata to explain exactly which
   service procedures are available in the current scene. Evaluate the new
   stock `Control.CurrentStage`, `Vessel.Stages`, `StageAt`, and per-stage
   delta-v, TWR, burn, mass, thrust, and resource APIs as a fallback and
   cross-check for StageStats. Keep StageStats where its editor behavior,
   provenance, or MechJeb integration remains stronger.
2. **Closest-approach target planning.** Evaluate
   `Orbit.NextClosestApproach`/`ClosestApproaches` for target and maneuver
   panels, including UT, separation, positions, velocities, relative vectors,
   and relative speed. Preserve explicit reference-frame labeling and the
   existing read-only preview plus separate-confirmation maneuver boundary.
3. **Managed streaming spike — completed, no promotion.** A measurement-only
   spike compared one explicitly rate-limited 4 Hz packed Flight-core stream
   with the existing pull path. It removed the repeated client RPCs and reduced
   client cycle time, but median combined kRPC server update time increased and
   KSP simulation throughput did not improve. Keep the proven demand-gated
   polling path for this cohort; any future reconsideration requires fresh
   evidence from the then-current code rather than reusing the discarded spike.
4. **Richer vehicle-health telemetry.** Consider acceleration, surface
   prograde/retrograde, aerodynamic force/torque/lift/drag, engine flameout,
   parachute safety state, vessel loaded/packed state, and part crew for focused
   flight diagnostics rather than indiscriminate payload growth.
5. **Alarm and overview refinement.** Revisit Kerbal Alarm Clock and inactive
   overview integration after capability diagnostics can distinguish installed,
   registered, scene-valid, and deprecated procedures.

## Guardrails

- Do not use the new game-scene setter, autopilot, launch, physics-range, warp,
  or direct vessel-control APIs. Mission Control calculations and previews stay
  read-only; creating one maneuver node continues to require a fresh preview
  and a separate confirmation.
- Treat stock staging data as a fallback/cross-check until editor and flight
  behavior are compared live against StageStats and MechJeb.
- Add telemetry fields additively and version any changed custom service API.
- Do not promote the completed managed-stream experiment from this cohort. Any
  future stream design must again prove lower total server work and better KSP
  simulation—not only fewer client RPCs—through scene transitions, reconnects,
  reverts, idle demand, and missing-service states.
