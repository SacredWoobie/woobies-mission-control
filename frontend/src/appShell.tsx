import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren, type ReactNode } from "react";
import { dashboardFooter } from "./buildIdentity";
import { AscensionPanel } from "./components/AscensionPanel";
import { ConsumablesPanel } from "./components/ConsumablesPanel";
import { ElectricityPanel } from "./components/ElectricityPanel";
import { EditorContextPanel } from "./components/EditorContextPanel";
import { EditorElectricityPanel } from "./components/EditorElectricityPanel";
import { EditorSummaryPanel } from "./components/EditorSummaryPanel";
import { FlightDashboard } from "./components/FlightDashboard";
import { ClockPanel } from "./components/FlightStatusPanels";
import { DatalinkDrawer, type DatalinkEvent } from "./components/DatalinkDrawer";
import { FlightAnnunciator } from "./annunciator/FlightAnnunciator";
import { useFlightAnnunciator, type FlightAnnunciatorController } from "./annunciator/useFlightAnnunciator";
import { HeatPanel } from "./components/HeatPanel";
import { MissionOverview } from "./components/MissionOverview";
import { NotesContinuityPreview } from "./components/NotesContinuityPreview";
import { PanelRailIcon } from "./components/PanelRailIcon";
import {
  DashboardRail,
  HideablePanelSlot,
  PanelRestoreRail,
  PanelVisibilityProvider,
  usePanelVisibility,
  type DashboardPanelId,
} from "./components/PanelVisibility";
import { PinnedNotePanel } from "./components/PinnedNotePanel";
import { SciencePanel } from "./components/SciencePanel";
import { StagingPanel } from "./components/StagingPanel";
import { TargetPanel } from "./components/TargetPanel";
import { DeltaVTool } from "./deltaV/DeltaVTool";
import { PinnedDeltaVPlanPanel } from "./deltaV/PinnedDeltaVPlanPanel";
import { DeltaVDraftProvider, useDeltaVDraft } from "./deltaV/state";
import { PinnedResonantOrbitPanel } from "./resonantOrbit/PinnedResonantOrbitPanel";
import { ResonantOrbitProvider, useResonantOrbitState } from "./resonantOrbit/state";
import { ResonantOrbitTool } from "./resonantOrbit/ResonantOrbitTool";
import { usePlannerPersistenceStatus } from "./sharedPlannerPersistence";
import { SettingsDrawer, SettingsProvider, useSettings } from "./settings";
import { liveTelemetryStore } from "./telemetry/store";
import {
  ascensionSnapshotsEqual,
  clockSnapshotsEqual,
  consumablesSnapshotsEqual,
  editorSnapshotsEqual,
  editorElectricitySnapshotsEqual,
  editorSummarySnapshotsEqual,
  electricitySnapshotsEqual,
  flightAvailabilitySnapshotsEqual,
  headerSnapshotsEqual,
  heatSnapshotsEqual,
  notesSnapshotsEqual,
  overviewSnapshotsEqual,
  pinnedNoteSnapshotsEqual,
  scienceSnapshotsEqual,
  settingsSnapshotsEqual,
  stagingSnapshotsEqual,
  targetSnapshotsEqual,
} from "./telemetry/subscriptions";
import type { SceneMode, TelemetryCommand, TelemetrySnapshot } from "./telemetry/types";
import { shallowEqual, useLiveDiagnostics, useLiveTelemetrySelector } from "./telemetry/useLiveTelemetry";
import { TimeSystemProvider, useTimeSystem } from "./timeSystem";

export const DEFAULT_LIVE_ENDPOINT = "ws://127.0.0.1:8090";

const emptyTelemetry: TelemetrySnapshot = { "context.mode": "inactive" };
const normalFlightPanels = new Set<DashboardPanelId>(["asc", "cons", "heat", "elec", "sci", "stage"]);

export function availableFlightPanels(snapshot: TelemetrySnapshot, resonantPlanPinned = false, deltaVPlanPinned = false) {
  const panels = new Set(normalFlightPanels);
  if (snapshot["tar.name"]?.trim()) panels.add("target");
  if (snapshot["notes.pinned"]) panels.add("flightNote");
  if (resonantPlanPinned) panels.add("flightOrbitPlan");
  if (deltaVPlanPinned) panels.add("flightDeltaVPlan");
  return panels;
}

function connectionLabel(status: ReturnType<typeof useLiveDiagnostics>["status"]) {
  if (status === "connecting") return "LINKING";
  if (status === "retrying") return "RETRYING";
  if (status === "linked") return "LINKED · AWAITING TELEMETRY";
  return "OFFLINE";
}

function PlannerPersistenceIndicator() {
  const state = usePlannerPersistenceStatus();
  const label = state.status === "shared"
    ? "PLANS · SHARED FILE"
    : state.status === "syncing"
      ? "PLANS · SYNCING"
      : state.status === "error"
        ? "PLANS · STORAGE ERROR"
        : "PLANS · LOCAL UNTIL LINKED";
  return (
    <span
      className={`planner-persistence-status is-${state.status}`}
      title={state.message}
      aria-live={state.status === "error" ? "assertive" : "polite"}
    >
      {label}
    </span>
  );
}

export function DashboardProviders({ children }: PropsWithChildren) {
  return (
    <TimeSystemProvider>
      <SettingsProvider>
        <ResonantOrbitProvider>
          <DeltaVDraftProvider>{children}</DeltaVDraftProvider>
        </ResonantOrbitProvider>
      </SettingsProvider>
    </TimeSystemProvider>
  );
}

export function DashboardAppFrame({ children, notesOpen }: PropsWithChildren<{ notesOpen: boolean }>) {
  return (
    <PanelVisibilityProvider centralizedRail>
      <main className={`app-shell ${notesOpen ? "notes-open" : ""}`}>{children}</main>
    </PanelVisibilityProvider>
  );
}

interface DashboardSurfaceProps {
  children?: ReactNode;
  datalink(open: boolean, onClose: () => void): ReactNode;
  effectiveEndpoint?: string;
  footerLabel: "Development" | "Production";
  identity?: string;
  linkText: string;
  liveMessage?: string;
  liveWaiting?: boolean;
  mode: SceneMode;
  notesCommandEnabled?: boolean;
  notesOpen: boolean;
  notesSnapshot: TelemetrySnapshot;
  onCloseNotes(): void;
  onSetNotesOpen(open: boolean): void;
  onSendNotesCommand?(command: TelemetryCommand): boolean;
  settingsSnapshot?: TelemetrySnapshot;
  waitingMessage?: string;
}

export function DashboardSurface({
  children,
  datalink,
  effectiveEndpoint,
  footerLabel,
  identity,
  linkText,
  liveMessage,
  liveWaiting = false,
  mode,
  notesCommandEnabled = false,
  notesOpen,
  notesSnapshot,
  onCloseNotes,
  onSetNotesOpen,
  onSendNotesCommand = () => false,
  settingsSnapshot,
  waitingMessage = "Waiting for the first valid Mission Control telemetry frame.",
}: DashboardSurfaceProps) {
  const showHeader = liveWaiting;
  const [datalinkOpen, setDatalinkOpen] = useState(false);
  const { closeDeltaVDrawer, closeDrawer } = useResonantOrbitState();
  const { hiddenPanels, restoreAllHiddenPanels } = usePanelVisibility();
  const { system: timeSystem, setSystem: setTimeSystem } = useTimeSystem();
  const plannerPersistence = usePlannerPersistenceStatus();
  const {
    closeSettings,
    open: settingsOpen,
    openSettings,
    scienceAlarmSettings,
    section: settingsSection,
    selectSection,
    themeId,
    updateTheme,
    updateScienceAlarmSettings,
  } = useSettings();
  const dashboardSettingsSnapshot = settingsSnapshot ?? notesSnapshot;
  const closeDatalink = useCallback(() => setDatalinkOpen(false), []);
  const closeOtherTools = useCallback(() => {
    onCloseNotes();
    closeDrawer();
    closeDeltaVDrawer();
  }, [closeDeltaVDrawer, closeDrawer, onCloseNotes]);
  const toggleDatalink = useCallback(() => {
    setDatalinkOpen((current) => {
      if (!current) {
        closeOtherTools();
        closeSettings();
      }
      return !current;
    });
  }, [closeOtherTools, closeSettings]);
  const toggleSettings = useCallback(() => {
    if (settingsOpen) {
      closeSettings();
      return;
    }
    closeOtherTools();
    closeDatalink();
    openSettings(settingsSection);
  }, [closeDatalink, closeOtherTools, closeSettings, openSettings, settingsOpen, settingsSection]);

  useEffect(() => {
    if (!settingsOpen) return;
    closeOtherTools();
    closeDatalink();
  }, [closeDatalink, closeOtherTools, settingsOpen]);

  return (
    <section className={`dashboard-surface ${mode === "flight" ? "flight-mode" : mode === "editor" ? "editor-mode" : "inactive-mode"}`}>
      <SettingsDrawer
        buildLabel={footerLabel}
        effectiveEndpoint={effectiveEndpoint}
        hiddenPanelCount={hiddenPanels.size}
        onClose={closeSettings}
        onRestoreHiddenPanels={restoreAllHiddenPanels}
        onScienceAlarmSettingsChange={updateScienceAlarmSettings}
        onSectionChange={selectSection}
        onSetTimeSystem={setTimeSystem}
        onSetTheme={updateTheme}
        open={settingsOpen}
        scienceAlarmProviders={dashboardSettingsSnapshot["sci.alarmProviders"]}
        scienceAlarmSettings={scienceAlarmSettings}
        section={settingsSection}
        telemetry={{
          capabilities: dashboardSettingsSnapshot["dashboard.capabilities"],
          effectiveEndpoint,
          persistenceStatus: plannerPersistence.status,
        }}
        themeId={themeId}
        timeSystem={timeSystem}
      />
      <NotesContinuityPreview commandEnabled={notesCommandEnabled} onClose={onCloseNotes} onSendCommand={onSendNotesCommand} open={notesOpen} snapshot={notesSnapshot} />
      {datalink(datalinkOpen, closeDatalink)}
      <DashboardRail
        datalinkButton={<DatalinkRailButton onToggle={toggleDatalink} open={datalinkOpen} />}
        notesButton={<NotesRailButton onOpen={() => { closeDatalink(); closeSettings(); }} open={notesOpen} setOpen={onSetNotesOpen} />}
        settingsButton={<SettingsRailButton onToggle={toggleSettings} open={settingsOpen} />}
        tools={(
          <>
            <ResonantOrbitTool mode={mode} onOpen={() => { onCloseNotes(); closeDatalink(); closeSettings(); }} snapshot={notesSnapshot} />
            <DeltaVTool mode={mode} onOpen={() => { onCloseNotes(); closeDatalink(); closeSettings(); }} snapshot={notesSnapshot} />
          </>
        )}
      />
      <div className="wrap">
        {showHeader && <div className="slice-status"><span><strong>{linkText}</strong>{identity && ` · ${identity}`}</span></div>}
        {liveWaiting ? (
          <section className="connection-state" aria-live="polite">
            <strong>{linkText}</strong>
            <span>{liveMessage}</span>
            <span>{waitingMessage}</span>
          </section>
        ) : children}
      </div>
      <footer className="project-footer">
        <span>{dashboardFooter(footerLabel)}</span>
        <PlannerPersistenceIndicator />
      </footer>
    </section>
  );
}

export function EditorWorkspace({ context, electricity, snapshot, staging, summary }: { context: ReactNode; electricity: ReactNode; snapshot?: TelemetrySnapshot; staging: ReactNode; summary: ReactNode }) {
  const { pinnedForTelemetry: pinnedOrbitForTelemetry } = useResonantOrbitState();
  const { pinnedForTelemetry } = useDeltaVDraft();
  const pinnedOrbit = pinnedOrbitForTelemetry(snapshot);
  const pinnedDeltaV = pinnedForTelemetry(snapshot);
  const hasPlanningCompanion = Boolean(pinnedOrbit || pinnedDeltaV);
  const available = useMemo(() => new Set<DashboardPanelId>(pinnedDeltaV ? ["editorDeltaVPlan"] : []), [pinnedDeltaV]);
  return (
    <>
      <PanelRestoreRail available={available} />
      <div className={`editor-workspace${hasPlanningCompanion ? " has-planning-companion" : " no-planning-companion"}`}>
        {context}
        <div className="editor-workspace-content">
          <div className="editor-workspace-column editor-workspace-primary">
            {electricity}
            <div className="editor-analysis-pair"><div className="dashboard-slice editor-staging-slice">{staging}</div>{summary}</div>
          </div>
          <div className="editor-workspace-column editor-workspace-secondary">
            {pinnedOrbit && <div className="dashboard-slice editor-orbit-plan-slice"><PinnedResonantOrbitPanel scene="editor" snapshot={snapshot} /></div>}
            {pinnedDeltaV && <HideablePanelSlot id="editorDeltaVPlan"><div className="dashboard-slice editor-delta-v-plan-slice"><PinnedDeltaVPlanPanel scene="editor" snapshot={snapshot} /></div></HideablePanelSlot>}
          </div>
        </div>
      </div>
    </>
  );
}

function useLiveFlightSnapshot(equality: (left: TelemetrySnapshot | null, right: TelemetrySnapshot | null) => boolean) {
  return useLiveTelemetrySelector((state) => state.snapshot, equality);
}

function LiveAscensionPanel() { const snapshot = useLiveFlightSnapshot(ascensionSnapshotsEqual); return snapshot?.["context.mode"] === "flight" ? <AscensionPanel snapshot={snapshot} /> : null; }
function LiveClockPanel() { const snapshot = useLiveFlightSnapshot(clockSnapshotsEqual); return snapshot?.["context.mode"] === "flight" ? <ClockPanel snapshot={snapshot} /> : null; }
function LiveConsumablesPanel() { const snapshot = useLiveFlightSnapshot(consumablesSnapshotsEqual); return snapshot?.["context.mode"] === "flight" ? <ConsumablesPanel snapshot={snapshot} /> : null; }
function LiveElectricityPanel() {
  const liveState = useLiveTelemetrySelector(
    (state) => ({ controlResult: state.reactorControlResult, snapshot: state.snapshot }),
    (left, right) => electricitySnapshotsEqual(left.snapshot, right.snapshot)
      && left.controlResult === right.controlResult,
  );
  return liveState.snapshot?.["context.mode"] === "flight"
    ? <ElectricityPanel commandEnabled controlResult={liveState.controlResult} onSendCommand={(command) => liveTelemetryStore.send(command)} snapshot={liveState.snapshot} />
    : null;
}
function LiveHeatPanel() {
  const liveState = useLiveTelemetrySelector(
    (state) => ({ controlResult: state.heatLoopControlResult, snapshot: state.snapshot }),
    (left, right) => heatSnapshotsEqual(left.snapshot, right.snapshot)
      && left.controlResult === right.controlResult,
  );
  return liveState.snapshot?.["context.mode"] === "flight"
    ? <HeatPanel commandEnabled controlResult={liveState.controlResult} onSendCommand={(command) => liveTelemetryStore.send(command)} snapshot={liveState.snapshot} />
    : null;
}
function LiveSciencePanel() {
  const liveState = useLiveTelemetrySelector(
    (state) => ({
      alarmResult: state.scienceAlarmResult,
      researchResult: state.scienceLabResearchResult,
      snapshot: state.snapshot,
      transmitResult: state.scienceLabTransmitResult,
    }),
    (left, right) => scienceSnapshotsEqual(left.snapshot, right.snapshot)
      && left.alarmResult === right.alarmResult
      && left.researchResult === right.researchResult
      && left.transmitResult === right.transmitResult,
  );
  return liveState.snapshot?.["context.mode"] === "flight"
    ? <SciencePanel alarmResult={liveState.alarmResult} commandEnabled onSendCommand={(command) => liveTelemetryStore.send(command)} researchResult={liveState.researchResult} snapshot={liveState.snapshot} transmitResult={liveState.transmitResult} />
    : null;
}
function LiveStagingPanel() { const snapshot = useLiveFlightSnapshot(stagingSnapshotsEqual); return snapshot && snapshot["context.mode"] !== "inactive" ? <StagingPanel snapshot={snapshot} /> : null; }
function LiveTargetPanel() {
  const liveState = useLiveTelemetrySelector(
    (state) => ({ clearResult: state.targetClearResult, snapshot: state.snapshot, status: state.status }),
    (left, right) => targetSnapshotsEqual(left.snapshot, right.snapshot)
      && left.clearResult === right.clearResult
      && left.status === right.status,
  );
  return liveState.snapshot?.["context.mode"] === "flight" && liveState.snapshot["tar.name"]?.trim()
    ? <TargetPanel clearResult={liveState.clearResult} commandEnabled={liveState.status === "linked"} onSendCommand={(command) => liveTelemetryStore.send(command)} snapshot={liveState.snapshot} />
    : null;
}
function LivePinnedNotePanel() { const snapshot = useLiveFlightSnapshot(pinnedNoteSnapshotsEqual); return snapshot?.["context.mode"] === "flight" && snapshot["notes.pinned"] ? <PinnedNotePanel commandEnabled onSendCommand={(command) => liveTelemetryStore.send(command)} snapshot={snapshot} /> : null; }
function LiveMissionOverview() {
  const liveState = useLiveTelemetrySelector(
    (state) => ({
      editResult: state.overviewVesselEditResult,
      lifecycleResult: state.overviewVesselLifecycleResult,
      snapshot: state.snapshot,
      switchResult: state.overviewVesselSwitchResult,
    }),
    (left, right) => overviewSnapshotsEqual(left.snapshot, right.snapshot)
      && left.editResult === right.editResult
      && left.lifecycleResult === right.lifecycleResult
      && left.switchResult === right.switchResult,
  );
  return liveState.snapshot?.["context.mode"] === "inactive"
    ? <MissionOverview commandEnabled editResult={liveState.editResult} lifecycleResult={liveState.lifecycleResult} onSendCommand={(command) => liveTelemetryStore.send(command)} snapshot={liveState.snapshot} switchResult={liveState.switchResult} />
    : null;
}

function LiveFlightDashboard({ annunciator }: { annunciator: FlightAnnunciatorController }) {
  const availability = useLiveFlightSnapshot(flightAvailabilitySnapshotsEqual);
  const { pinnedForTelemetry: pinnedOrbitForTelemetry } = useResonantOrbitState();
  const { pinnedForTelemetry } = useDeltaVDraft();
  const pinnedOrbit = pinnedOrbitForTelemetry(availability);
  const pinnedDeltaV = pinnedForTelemetry(availability);
  const available = useMemo(() => availableFlightPanels(availability ?? emptyTelemetry, !!pinnedOrbit, !!pinnedDeltaV), [availability, pinnedDeltaV, pinnedOrbit]);
  return (
    <FlightDashboard
      ascension={<LiveAscensionPanel />}
      annunciator={<FlightAnnunciator controller={annunciator} />}
      availablePanels={available}
      clock={<LiveClockPanel />}
      consumables={<LiveConsumablesPanel />}
      electricity={<LiveElectricityPanel />}
      heat={<LiveHeatPanel />}
      pinnedNote={availability?.["notes.pinnedPath"] ? <LivePinnedNotePanel /> : undefined}
      pinnedDeltaVPlan={pinnedDeltaV ? <PinnedDeltaVPlanPanel /> : undefined}
      pinnedOrbitPlan={pinnedOrbit ? <PinnedResonantOrbitPanel /> : undefined}
      science={<LiveSciencePanel />}
      staging={<LiveStagingPanel />}
      target={availability?.["tar.name"]?.trim() ? <LiveTargetPanel /> : undefined}
      vesselIdentity={String(availability?.["v.persistentId"] ?? availability?.["v.guid"] ?? availability?.["v.name"] ?? "unknown-vessel")}
    />
  );
}

function LiveEditorContextPanel() {
  const snapshot = useLiveTelemetrySelector((state) => state.snapshot, editorSnapshotsEqual);
  return snapshot?.["context.mode"] === "editor" ? <EditorContextPanel commandEnabled onSendCommand={(command) => liveTelemetryStore.send(command)} snapshot={snapshot} /> : null;
}

function LiveEditorSummaryPanel() {
  const snapshot = useLiveTelemetrySelector((state) => state.snapshot, editorSummarySnapshotsEqual);
  return snapshot?.["context.mode"] === "editor" ? <EditorSummaryPanel snapshot={snapshot} /> : null;
}

function LiveEditorElectricityPanel() {
  const snapshot = useLiveTelemetrySelector((state) => state.snapshot, editorElectricitySnapshotsEqual);
  return snapshot?.["context.mode"] === "editor" ? <EditorElectricityPanel snapshot={snapshot} /> : null;
}

interface LiveDashboardProps {
  endpointDraft: string;
  footerLabel: "Development" | "Production";
  notesOpen: boolean;
  onCloseNotes(): void;
  onSetNotesOpen(open: boolean): void;
  waitingMessage?: string;
}

export function LiveDashboard({
  endpointDraft,
  footerLabel,
  notesOpen,
  onCloseNotes,
  onSetNotesOpen,
  waitingMessage,
}: LiveDashboardProps) {
  const connection = useLiveDiagnostics();
  const [datalinkEvents, setDatalinkEvents] = useState<DatalinkEvent[]>([]);
  const datalinkEventId = useRef(0);
  const lastConnectionEvent = useRef("");
  const recordDatalinkEvent = useCallback((message: string, status: DatalinkEvent["status"]) => {
    setDatalinkEvents((current) => [{ at: Date.now(), id: ++datalinkEventId.current, message, status }, ...current].slice(0, 12));
  }, []);
  const annunciatorInput = useLiveTelemetrySelector((state) => ({
    connectionState: state.status,
    frameCount: state.frameCount,
    lastFrameAt: state.lastFrameAt,
    snapshot: state.snapshot,
  }), shallowEqual);
  const annunciator = useFlightAnnunciator({ ...annunciatorInput, watchdog: true });
  const headerSnapshot = useLiveTelemetrySelector((state) => state.snapshot, headerSnapshotsEqual);
  const notesSnapshot = useLiveTelemetrySelector((state) => state.snapshot, notesSnapshotsEqual);
  const settingsSnapshot = useLiveTelemetrySelector((state) => state.snapshot, settingsSnapshotsEqual);
  const mode = headerSnapshot?.["context.mode"] ?? "inactive";
  const waiting = headerSnapshot === null;
  const identity = mode === "flight" ? String(headerSnapshot?.["v.name"] ?? "Active vessel") : mode === "editor" ? String(headerSnapshot?.["editor.craftName"] ?? "Untitled craft") : undefined;
  const linkText = waiting ? connectionLabel(connection.status) : mode === "inactive" ? "MISSION CONTROL LINK" : mode === "editor" ? "EDITOR LINK" : "FLIGHT LINK";
  const connectionEndpoint = connection.endpoint || endpointDraft;

  useEffect(() => {
    const key = `${connection.status}|${connection.message ?? ""}`;
    if (lastConnectionEvent.current === key) return;
    lastConnectionEvent.current = key;
    const text = connection.status === "linked"
      ? "Browser telemetry socket linked."
      : connection.status === "connecting"
        ? "Opening browser telemetry socket."
        : connection.status === "retrying"
          ? connection.message || "Link dropped; automatic retry scheduled."
          : "Datalink is off.";
    recordDatalinkEvent(text, connection.status);
  }, [connection.message, connection.status, recordDatalinkEvent]);

  const refreshDatalink = useCallback(() => {
    recordDatalinkEvent("Manual connection refresh requested.", connection.status);
    liveTelemetryStore.disconnect();
    liveTelemetryStore.connect(connectionEndpoint);
  }, [connection.status, connectionEndpoint, recordDatalinkEvent]);

  const toggleDatalink = useCallback(() => {
    if (connection.status === "offline") {
      recordDatalinkEvent("Manual datalink start requested.", "connecting");
      liveTelemetryStore.connect(connectionEndpoint);
    } else {
      recordDatalinkEvent("Manual datalink stop requested.", "offline");
      liveTelemetryStore.disconnect();
    }
  }, [connection.status, connectionEndpoint, recordDatalinkEvent]);

  return (
    <DashboardSurface
      datalink={(open, onClose) => (
        <DatalinkDrawer
          connectionStatus={connection.status}
          endpoint={connectionEndpoint}
          events={datalinkEvents}
          frameCount={connection.frameCount}
          lastFrameAt={connection.lastFrameAt}
          message={connection.message}
          onClose={onClose}
          onRefresh={refreshDatalink}
          onToggle={toggleDatalink}
          open={open}
          sceneMode={mode}
        />
      )}
      effectiveEndpoint={connectionEndpoint}
      footerLabel={footerLabel}
      identity={identity}
      linkText={linkText}
      liveMessage={(connection.message ?? connection.endpoint) || endpointDraft}
      liveWaiting={waiting}
      mode={mode}
      notesCommandEnabled
      notesOpen={notesOpen}
      notesSnapshot={notesSnapshot ?? emptyTelemetry}
      onCloseNotes={onCloseNotes}
      onSetNotesOpen={onSetNotesOpen}
      onSendNotesCommand={(command) => liveTelemetryStore.send(command)}
      settingsSnapshot={settingsSnapshot ?? emptyTelemetry}
      waitingMessage={waitingMessage}
    >
      {mode === "flight"
        ? <LiveFlightDashboard annunciator={annunciator} />
        : mode === "editor"
          ? <EditorWorkspace context={<LiveEditorContextPanel />} electricity={<LiveEditorElectricityPanel />} snapshot={headerSnapshot ?? undefined} staging={<LiveStagingPanel />} summary={<LiveEditorSummaryPanel />} />
          : <LiveMissionOverview />}
    </DashboardSurface>
  );
}

function DatalinkRailButton({ onToggle, open }: { onToggle(): void; open: boolean }) {
  return (
    <button
      aria-controls="datalink-drawer"
      aria-expanded={open}
      aria-label="Datalink"
      className="datalink-rail-tab dashboard-tool-button panel-rail-button"
      onClick={onToggle}
      title="Open Datalink controls"
      type="button"
    >
      <span aria-hidden="true" className="panel-rail-label">Datalink</span>
      <PanelRailIcon name="conn" />
    </button>
  );
}

function NotesRailButton({ onOpen, open, setOpen }: { onOpen(): void; open: boolean; setOpen(value: boolean): void }) {
  const { closeDeltaVDrawer, closeDrawer } = useResonantOrbitState();
  return (
    <button
      aria-controls="notes-continuity-preview"
      aria-expanded={open}
      aria-label="Notes"
      className="notes-rail-tab panel-rail-button"
      onClick={() => {
        if (!open) {
          onOpen();
          closeDrawer();
          closeDeltaVDrawer();
        }
        setOpen(!open);
      }}
      title="Open Notes"
      type="button"
    >
      <span aria-hidden="true" className="panel-rail-label">Notes</span>
      <PanelRailIcon name="notes" />
    </button>
  );
}

function SettingsRailButton({ onToggle, open }: { onToggle(): void; open: boolean }) {
  return (
    <button
      aria-controls="settings-drawer"
      aria-expanded={open}
      aria-label="Settings"
      className="settings-rail-tab dashboard-tool-button panel-rail-button"
      onClick={onToggle}
      title="Open Settings"
      type="button"
    >
      <span aria-hidden="true" className="panel-rail-label">Settings</span>
      <PanelRailIcon name="settings" />
    </button>
  );
}
