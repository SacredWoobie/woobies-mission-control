import { useEffect, useMemo, type PropsWithChildren, type ReactNode } from "react";
import { dashboardFooter } from "./buildIdentity";
import { AscensionPanel } from "./components/AscensionPanel";
import { ConsumablesPanel } from "./components/ConsumablesPanel";
import { ElectricityPanel } from "./components/ElectricityPanel";
import { EditorContextPanel } from "./components/EditorContextPanel";
import { EditorSummaryPanel } from "./components/EditorSummaryPanel";
import { FlightDashboard } from "./components/FlightDashboard";
import { ClockPanel, DatalinkPanel } from "./components/FlightStatusPanels";
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
import { liveTelemetryStore } from "./telemetry/store";
import {
  ascensionSnapshotsEqual,
  clockSnapshotsEqual,
  consumablesSnapshotsEqual,
  editorSnapshotsEqual,
  editorSummarySnapshotsEqual,
  electricitySnapshotsEqual,
  flightAvailabilitySnapshotsEqual,
  headerSnapshotsEqual,
  heatSnapshotsEqual,
  notesSnapshotsEqual,
  overviewSnapshotsEqual,
  pinnedNoteSnapshotsEqual,
  scienceSnapshotsEqual,
  stagingSnapshotsEqual,
  targetSnapshotsEqual,
} from "./telemetry/subscriptions";
import type { SceneMode, TelemetryCommand, TelemetrySnapshot } from "./telemetry/types";
import { useLiveConnectionStatus, useLiveTelemetrySelector } from "./telemetry/useLiveTelemetry";
import { TimeSystemProvider } from "./timeSystem";

export const DEFAULT_LIVE_ENDPOINT = "ws://127.0.0.1:8090";

const emptyTelemetry: TelemetrySnapshot = { "context.mode": "inactive" };
const datalinkPanel = new Set<DashboardPanelId>(["conn"]);
const normalFlightPanels = new Set<DashboardPanelId>(["asc", "cons", "heat", "elec", "sci", "stage"]);

export function availableFlightPanels(snapshot: TelemetrySnapshot, resonantPlanPinned = false, deltaVPlanPinned = false) {
  const panels = new Set(normalFlightPanels);
  if (snapshot["tar.name"]?.trim()) panels.add("target");
  if (snapshot["notes.pinned"]) panels.add("flightNote");
  if (resonantPlanPinned) panels.add("flightOrbitPlan");
  if (deltaVPlanPinned) panels.add("flightDeltaVPlan");
  return panels;
}

function connectionLabel(status: ReturnType<typeof useLiveConnectionStatus>["status"]) {
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
      <ResonantOrbitProvider>
        <DeltaVDraftProvider>{children}</DeltaVDraftProvider>
      </ResonantOrbitProvider>
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
  datalink: ReactNode;
  datalinkConnected?: boolean;
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
  waitingMessage?: string;
}

export function DashboardSurface({
  children,
  datalink,
  datalinkConnected = false,
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
  waitingMessage = "Waiting for the first valid Mission Control telemetry frame.",
}: DashboardSurfaceProps) {
  const showHeader = mode === "editor" || liveWaiting;
  const { autoCollapsePanel, clearAutoCollapse } = usePanelVisibility();

  useEffect(() => {
    if (!datalinkConnected) {
      clearAutoCollapse("conn");
      return;
    }
    autoCollapsePanel("conn");
    return () => clearAutoCollapse("conn");
  }, [autoCollapsePanel, clearAutoCollapse, datalinkConnected]);

  return (
    <section className={`dashboard-surface ${mode === "editor" ? "editor-mode" : mode === "inactive" ? "inactive-mode" : ""}`}>
      <NotesContinuityPreview commandEnabled={notesCommandEnabled} onClose={onCloseNotes} onSendCommand={onSendNotesCommand} open={notesOpen} snapshot={notesSnapshot} />
      <DashboardRail
        notesButton={<NotesRailButton open={notesOpen} setOpen={onSetNotesOpen} />}
        tools={(
          <>
            <ResonantOrbitTool mode={mode} onOpen={onCloseNotes} />
            <DeltaVTool mode={mode} onOpen={onCloseNotes} snapshot={notesSnapshot} />
          </>
        )}
      />
      <PanelRestoreRail available={datalinkPanel} />
      <div className="wrap">
        <HideablePanelSlot id="conn"><div className="shared-datalink-slot">{datalink}</div></HideablePanelSlot>
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

export function EditorWorkspace({ context, snapshot, staging, summary }: { context: ReactNode; snapshot?: TelemetrySnapshot; staging: ReactNode; summary: ReactNode }) {
  const { pinnedForTelemetry: pinnedOrbitForTelemetry } = useResonantOrbitState();
  const { pinnedForTelemetry } = useDeltaVDraft();
  const pinnedOrbit = pinnedOrbitForTelemetry(snapshot);
  const pinnedDeltaV = pinnedForTelemetry(snapshot);
  const available = useMemo(() => new Set<DashboardPanelId>(pinnedDeltaV ? ["editorDeltaVPlan"] : []), [pinnedDeltaV]);
  return (
    <>
      <PanelRestoreRail available={available} />
      <div className="editor-workspace">
        <div className="editor-workspace-column editor-workspace-primary">
          {context}
          <div className="dashboard-slice editor-staging-slice">{staging}</div>
          {summary}
        </div>
        <div className="editor-workspace-column editor-workspace-secondary">
          {pinnedOrbit && <div className="dashboard-slice editor-orbit-plan-slice"><PinnedResonantOrbitPanel scene="editor" snapshot={snapshot} /></div>}
          {pinnedDeltaV && <HideablePanelSlot id="editorDeltaVPlan"><div className="dashboard-slice editor-delta-v-plan-slice"><PinnedDeltaVPlanPanel scene="editor" snapshot={snapshot} /></div></HideablePanelSlot>}
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
function LiveElectricityPanel() { const snapshot = useLiveFlightSnapshot(electricitySnapshotsEqual); return snapshot?.["context.mode"] === "flight" ? <ElectricityPanel snapshot={snapshot} /> : null; }
function LiveHeatPanel() { const snapshot = useLiveFlightSnapshot(heatSnapshotsEqual); return snapshot?.["context.mode"] === "flight" ? <HeatPanel snapshot={snapshot} /> : null; }
function LiveSciencePanel() { const snapshot = useLiveFlightSnapshot(scienceSnapshotsEqual); return snapshot?.["context.mode"] === "flight" ? <SciencePanel snapshot={snapshot} /> : null; }
function LiveStagingPanel() { const snapshot = useLiveFlightSnapshot(stagingSnapshotsEqual); return snapshot && snapshot["context.mode"] !== "inactive" ? <StagingPanel snapshot={snapshot} /> : null; }
function LiveTargetPanel() { const snapshot = useLiveFlightSnapshot(targetSnapshotsEqual); return snapshot?.["context.mode"] === "flight" && snapshot["tar.name"]?.trim() ? <TargetPanel snapshot={snapshot} /> : null; }
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

function LiveFlightDashboard() {
  const availability = useLiveFlightSnapshot(flightAvailabilitySnapshotsEqual);
  const { pinnedForTelemetry: pinnedOrbitForTelemetry } = useResonantOrbitState();
  const { pinnedForTelemetry } = useDeltaVDraft();
  const pinnedOrbit = pinnedOrbitForTelemetry(availability);
  const pinnedDeltaV = pinnedForTelemetry(availability);
  const available = useMemo(() => availableFlightPanels(availability ?? emptyTelemetry, !!pinnedOrbit, !!pinnedDeltaV), [availability, pinnedDeltaV, pinnedOrbit]);
  return (
    <FlightDashboard
      ascension={<LiveAscensionPanel />}
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

interface LiveDashboardProps {
  allowDisconnect?: boolean;
  endpointDraft: string;
  footerLabel: "Development" | "Production";
  notesOpen: boolean;
  onCloseNotes(): void;
  onSetNotesOpen(open: boolean): void;
  waitingMessage?: string;
}

export function LiveDashboard({
  allowDisconnect = false,
  endpointDraft,
  footerLabel,
  notesOpen,
  onCloseNotes,
  onSetNotesOpen,
  waitingMessage,
}: LiveDashboardProps) {
  const connection = useLiveConnectionStatus();
  const headerSnapshot = useLiveTelemetrySelector((state) => state.snapshot, headerSnapshotsEqual);
  const notesSnapshot = useLiveTelemetrySelector((state) => state.snapshot, notesSnapshotsEqual);
  const mode = headerSnapshot?.["context.mode"] ?? "inactive";
  const waiting = headerSnapshot === null;
  const identity = mode === "flight" ? String(headerSnapshot?.["v.name"] ?? "Active vessel") : mode === "editor" ? String(headerSnapshot?.["editor.craftName"] ?? "Untitled craft") : undefined;
  const linkText = waiting ? connectionLabel(connection.status) : mode === "inactive" ? "MISSION CONTROL LINK" : mode === "editor" ? "EDITOR LINK" : "FLIGHT LINK";
  return (
    <DashboardSurface
      datalink={(
        <DatalinkPanel
          connectionStatus={connection.status}
          endpoint={connection.endpoint}
          onDisconnect={allowDisconnect ? () => liveTelemetryStore.disconnect() : undefined}
          sceneMode={mode}
        />
      )}
      datalinkConnected={connection.status === "linked"}
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
      waitingMessage={waitingMessage}
    >
      {mode === "flight"
        ? <LiveFlightDashboard />
        : mode === "editor"
          ? <EditorWorkspace context={<LiveEditorContextPanel />} snapshot={headerSnapshot ?? undefined} staging={<LiveStagingPanel />} summary={<LiveEditorSummaryPanel />} />
          : <LiveMissionOverview />}
    </DashboardSurface>
  );
}

function NotesRailButton({ open, setOpen }: { open: boolean; setOpen(value: boolean): void }) {
  const { closeDeltaVDrawer, closeDrawer } = useResonantOrbitState();
  return (
    <button
      aria-controls="notes-continuity-preview"
      aria-expanded={open}
      aria-label="Notes"
      className="notes-rail-tab panel-rail-button"
      onClick={() => {
        if (!open) {
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
