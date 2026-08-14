import { useCallback, useEffect, useState } from "react";
import { useResonantOrbitState } from "../resonantOrbit/state";
import type { SceneMode, TelemetrySnapshot } from "../telemetry/types";
import { DeltaVPlanner } from "./DeltaVPlanner";
import { DeltaVDraftProvider, useDeltaVDraft, useOptionalDeltaVDraft } from "./state";
import { useDialogFocus } from "./useDialogFocus";

function DeltaVDrawer({ mode, snapshot }: { mode: SceneMode; snapshot?: TelemetrySnapshot | null }) {
  const { closeDeltaVDrawer, deltaVDrawerOpen, unit } = useResonantOrbitState();
  const { draftHasContent, resetDraft, resetRevision, savedPlans } = useDeltaVDraft();
  const currentSaveFolder = typeof snapshot?.["game.saveFolder"] === "string" ? snapshot["game.saveFolder"].trim() : "";
  const currentSavePlanCount = savedPlans.filter((record) => record.saveFolder === currentSaveFolder).length;
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [savedPlansOpen, setSavedPlansOpen] = useState(false);
  const [saveTarget, setSaveTarget] = useState<HTMLDivElement | null>(null);
  const closeAssumptions = useCallback(() => setAssumptionsOpen(false), []);
  const closeResetConfirmation = useCallback(() => setResetConfirmationOpen(false), []);
  const closeSavedPlans = useCallback(() => setSavedPlansOpen(false), []);
  const assumptionsDialogRef = useDialogFocus<HTMLElement>(assumptionsOpen, closeAssumptions);
  const resetDialogRef = useDialogFocus<HTMLElement>(resetConfirmationOpen, closeResetConfirmation);
  const drawerDialogRef = useDialogFocus<HTMLElement>(deltaVDrawerOpen, closeDeltaVDrawer);
  const confirmReset = useCallback(() => {
    resetDraft();
    setResetConfirmationOpen(false);
  }, [resetDraft]);

  useEffect(() => {
    if (!deltaVDrawerOpen) {
      setAssumptionsOpen(false);
      setResetConfirmationOpen(false);
      setSavedPlansOpen(false);
    }
  }, [deltaVDrawerOpen]);

  if (!deltaVDrawerOpen) return null;
  return <>
    <div aria-hidden="true" className="resonant-drawer-backdrop" onMouseDown={closeDeltaVDrawer} />
    <aside aria-label="Delta-v planner" aria-modal="true" className="resonant-drawer delta-v-drawer" id="delta-v-drawer" ref={drawerDialogRef} role="dialog" tabIndex={-1}>
      <header>
        <div><h2>Delta-V Mission Planner</h2><p>Build an idealized mission budget from the live KSP body catalog without changing the active craft.</p></div>
        <div className="delta-v-header-controls">
          <div className="delta-v-save-slot" ref={setSaveTarget} />
          <div aria-label="Plan tools" className="delta-v-header-actions" role="group">
            <span className="delta-v-header-actions-heading">PLAN TOOLS</span>
            <div className="delta-v-header-action-buttons">
              <button aria-haspopup="dialog" aria-label="Load saved plans" className="delta-v-saved-plans-button" onClick={() => setSavedPlansOpen(true)} title="Load saved plans" type="button"><span>SAVED PLANS</span><strong>{currentSavePlanCount}</strong></button>
              <button aria-haspopup="dialog" aria-label="Reset current plan" className="delta-v-reset-button" disabled={!draftHasContent} onClick={() => setResetConfirmationOpen(true)} title={draftHasContent ? "Clear the current draft and start a new plan" : "The current draft is already empty"} type="button">RESET</button>
              <button aria-label="Model assumptions and limits" className="delta-v-assumptions-button" onClick={() => setAssumptionsOpen(true)} title="Model assumptions and limits" type="button">MODEL</button>
              <button aria-label="Close delta-v planner" onClick={closeDeltaVDrawer} type="button">×</button>
            </div>
          </div>
        </div>
      </header>
      {resetConfirmationOpen && <div className="delta-v-modal-backdrop" onMouseDown={closeResetConfirmation}>
        <section aria-labelledby="delta-v-reset-title" aria-modal="true" className="delta-v-modal delta-v-reset-modal" onMouseDown={(event) => event.stopPropagation()} ref={resetDialogRef} role="dialog" tabIndex={-1}>
          <header><div><span>START A NEW PLAN</span><h3 id="delta-v-reset-title">Reset current draft?</h3></div><button aria-label="Close reset confirmation" onClick={closeResetConfirmation} type="button">×</button></header>
          <p>This clears the working route, custom steps, transfer selections, and unsaved changes. Saved plans, pinned craft assignments, and completed mission steps remain available.</p>
          <footer className="delta-v-reset-actions"><button onClick={closeResetConfirmation} type="button">KEEP CURRENT PLAN</button><button onClick={confirmReset} type="button">RESET CURRENT DRAFT</button></footer>
        </section>
      </div>}
      {assumptionsOpen && <div className="delta-v-modal-backdrop" onMouseDown={closeAssumptions}>
        <section aria-labelledby="delta-v-assumptions-title" aria-modal="true" className="delta-v-modal" onMouseDown={(event) => event.stopPropagation()} ref={assumptionsDialogRef} role="dialog" tabIndex={-1}>
          <header><div><span>PLANNING MODEL</span><h3 id="delta-v-assumptions-title">Model assumptions and limits</h3></div><button aria-label="Close model assumptions" onClick={closeAssumptions} type="button">×</button></header>
          <ul>
            <li>Connected planning includes every non-star body exposed through KSP and kRPC, including Stock and conventional Kopernicus planet packs. The offline fallback contains the curated Stock and OPM profiles.</li>
            <li>Custom gravity, atmosphere, or multi-star mechanics not represented by the standard KSP body APIs may require manual route steps.</li>
            <li>Transfers assume coplanar circular parking orbits, patched-conic Hohmann transfers, and ideal impulsive burns. Simple mode dates interplanetary transfers with MechJeb; Advanced mode enables its porkchop selection.</li>
            <li>Inclination changes, plane matching, midcourse corrections, and finite-burn losses are excluded unless entered as custom steps. Off-ideal interplanetary timing is represented only when a MechJeb porkchop solution is selected.</li>
            <li>Each destination stay delays later transfer searches by the entered number of selected-calendar days: 6-hour Kerbin days or 24-hour Earth days.</li>
            <li>Same-parent moon transfers use the next recurring coplanar circular Hohmann window when the live body catalog provides orbital phase. Older or incomplete catalogs retain an ideal coast-time estimate after the entered stay.</li>
            <li>Stock and OPM surface ascent values use curated planning allowances to each body's reference parking orbit. Other Kopernicus bodies use a generic gravity-and-atmosphere estimate at their derived reference orbit. Selecting another altitude adds an ideal two-burn Hohmann orbit adjustment; actual ascent performance still depends on the vehicle and profile.</li>
            <li>Powered landing values are ideal lower bounds and exclude terrain, hover, steering, and finite-burn losses.</li>
            <li>Aerocapture uses the body's live density curve and arrival speed to choose an approximate periapsis at a speed-scaled target between 0.5 and 5 kPa. It then rounds the burn that raises that periapsis into the selected parking orbit up to the next 50 m/s.</li>
            <li>The aerocapture estimate is a planning heuristic, not a simulated atmospheric pass; it does not model drag area, lift, atmospheric rotation, guidance, heating limits, or craft orientation. Editor and Flight craft resources only provide an advisory thermal-protection check.</li>
            <li>Capture-first atmospheric landings include a deorbit burn from parking orbit to an entry periapsis modeled at 25% of the atmosphere depth.</li>
            <li>Custom route steps are user-supplied estimates included in both the nominal budget and percentage planning margin.</li>
          </ul>
        </section>
      </div>}
      <div className="resonant-drawer-body delta-v-drawer-body"><DeltaVPlanner mode={mode} onCloseSavedPlans={closeSavedPlans} resetRevision={resetRevision} saveTarget={saveTarget} savedPlansOpen={savedPlansOpen} snapshot={snapshot} unit={unit} /></div>
      <footer className="delta-v-footer"><span>Calculations are read-only · a pinned Flight plan can explicitly create one validated maneuver node</span></footer>
    </aside>
  </>;
}

function DeltaVToolContent({ mode, onOpen, snapshot }: { mode: SceneMode; onOpen(): void; snapshot?: TelemetrySnapshot | null }) {
  const { deltaVDrawerOpen, toggleDeltaVDrawer } = useResonantOrbitState();
  function toggle() {
    if (!deltaVDrawerOpen) onOpen();
    toggleDeltaVDrawer();
  }
  return <>
    <button
      aria-controls="delta-v-drawer"
      aria-expanded={deltaVDrawerOpen}
      aria-label="Delta-v planner"
      className="delta-v-rail-tab dashboard-tool-button panel-rail-button"
      onClick={toggle}
      title="Open Delta-V Mission Planner"
      type="button"
    >
      <span aria-hidden="true" className="panel-rail-label">Delta-V Planner</span>
      <span className="delta-v-rail-icon" aria-hidden="true"><b>Δv</b><small>PLAN</small></span>
    </button>
    <DeltaVDrawer mode={mode} snapshot={snapshot} />
  </>;
}

export function DeltaVTool({ mode = "inactive", onOpen, snapshot }: { mode?: SceneMode; onOpen(): void; snapshot?: TelemetrySnapshot | null }) {
  const existingProvider = useOptionalDeltaVDraft();
  if (existingProvider) return <DeltaVToolContent mode={mode} onOpen={onOpen} snapshot={snapshot} />;
  return <DeltaVDraftProvider><DeltaVToolContent mode={mode} onOpen={onOpen} snapshot={snapshot} /></DeltaVDraftProvider>;
}
