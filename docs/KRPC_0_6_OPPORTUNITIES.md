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
3. **Managed streaming spike.** Measure kRPC 0.6's TCP_NODELAY and transport
   improvements, then compare managed streams with polling for the hottest 4 Hz
   signals. Adopt only where it lowers latency or load without making scene
   transitions and reconnects less reliable.
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
- Benchmark stream changes through scene transitions, reconnects, reverts, and
  missing-service states before replacing proven polling paths.
