import type { SceneMode, TelemetrySnapshot } from "../telemetry/types";
import { ResonantOrbitDrawer } from "./ResonantOrbitDrawer";
import { useResonantOrbitState } from "./state";

export function ResonantOrbitTool({ mode, onOpen, snapshot }: { mode: SceneMode; onOpen(): void; snapshot?: TelemetrySnapshot }) {
  const { drawerOpen, toggleDrawer } = useResonantOrbitState();
  function toggle() {
    if (!drawerOpen) onOpen();
    toggleDrawer();
  }
  return (
    <>
      <button
        aria-controls="resonant-orbit-drawer"
        aria-expanded={drawerOpen}
        aria-label="Resonant orbit planner"
        className="resonant-rail-tab dashboard-tool-button panel-rail-button"
        onClick={toggle}
        title="Open Resonant Orbit Planner"
        type="button"
      >
        <span aria-hidden="true" className="panel-rail-label">Resonant Orbit Planner</span>
        <span className="resonant-rail-icon" aria-hidden="true"><i /></span>
      </button>
      <ResonantOrbitDrawer mode={mode} snapshot={snapshot} />
    </>
  );
}
