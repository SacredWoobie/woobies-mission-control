import { useEffect, useMemo, useState, type ReactNode } from "react";
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

const defaultLiveEndpoint = "ws://127.0.0.1:8090";
const emptyTelemetry: TelemetrySnapshot = { "context.mode": "inactive" };
const datalinkPanel = new Set<DashboardPanelId>(["conn"]);
const normalFlightPanels = new Set<DashboardPanelId>(["clock", "asc", "cons", "heat", "elec", "sci", "stage"]);

function availableFlightPanels(snapshot: TelemetrySnapshot) {
  const panels = new Set(normalFlightPanels);
  if (snapshot["tar.name"]?.trim()) panels.add("target");
  if (snapshot["notes.pinned"]) panels.add("flightNote");
  return panels;
}

function connectionLabel(status: ReturnType<typeof useLiveConnectionStatus>["status"]) {
  if (status === "connecting") return "LINKING";
  if (status === "retrying") return "RETRYING";
  if (status === "linked") return "LINKED · AWAITING TELEMETRY";
  return "OFFLINE";
}

interface DashboardSurfaceProps {
  children?: ReactNode;
  datalink: ReactNode;
  datalinkConnected?: boolean;
  identity?: string;
  linkText: string;
  liveMessage?: string;
  liveWaiting?: boolean;
  mode: SceneMode;
  notesOpen: boolean;
  notesSnapshot: TelemetrySnapshot;
  onCloseNotes(): void;
}

function DashboardSurface({
  children,
  datalink,
  datalinkConnected = false,
  identity,
  linkText,
  liveMessage,
  liveWaiting = false,
  mode,
  notesOpen,
  notesSnapshot,
  onCloseNotes,
}: DashboardSurfaceProps) {
  const showHeader = mode !== "flight" || liveWaiting;
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
      <NotesContinuityPreview commandEnabled onClose={onCloseNotes} onSendCommand={(command) => liveTelemetryStore.send(command)} open={notesOpen} snapshot={notesSnapshot} />
      <PanelRestoreRail available={datalinkPanel} />
      <div className="wrap">
        <HideablePanelSlot id="conn"><div className="shared-datalink-slot">{datalink}</div></HideablePanelSlot>
        {showHeader && <div className="slice-status"><span><strong>{linkText}</strong>{identity && ` · ${identity}`}</span></div>}
        {liveWaiting ? (
          <section className="connection-state" aria-live="polite">
            <strong>{linkText}</strong>
            <span>{liveMessage}</span>
            <span>Waiting for the first valid Mission Control telemetry frame.</span>
          </section>
        ) : children}
      </div>
      <footer className="project-footer">Woobie's Mission Control · React dashboard · v0.3.0</footer>
    </section>
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
function LiveMissionOverview() { const snapshot = useLiveTelemetrySelector((state) => state.snapshot, overviewSnapshotsEqual); return snapshot?.["context.mode"] === "inactive" ? <MissionOverview snapshot={snapshot} /> : null; }

function LiveFlightDashboard() {
  const availability = useLiveFlightSnapshot(flightAvailabilitySnapshotsEqual);
  const available = useMemo(() => availableFlightPanels(availability ?? emptyTelemetry), [availability]);
  return <FlightDashboard
    ascension={<LiveAscensionPanel />}
    availablePanels={available}
    clock={<LiveClockPanel />}
    consumables={<LiveConsumablesPanel />}
    electricity={<LiveElectricityPanel />}
    heat={<LiveHeatPanel />}
    pinnedNote={availability?.["notes.pinnedPath"] ? <LivePinnedNotePanel /> : undefined}
    science={<LiveSciencePanel />}
    staging={<LiveStagingPanel />}
    target={availability?.["tar.name"]?.trim() ? <LiveTargetPanel /> : undefined}
  />;
}

function LiveEditorContextPanel() {
  const snapshot = useLiveTelemetrySelector((state) => state.snapshot, editorSnapshotsEqual);
  return snapshot?.["context.mode"] === "editor" ? <EditorContextPanel commandEnabled onSendCommand={(command: TelemetryCommand) => liveTelemetryStore.send(command)} snapshot={snapshot} /> : null;
}

function LiveEditorSummaryPanel() {
  const snapshot = useLiveTelemetrySelector((state) => state.snapshot, editorSummarySnapshotsEqual);
  return snapshot?.["context.mode"] === "editor" ? <EditorSummaryPanel snapshot={snapshot} /> : null;
}

function LiveDashboard({ notesOpen, onCloseNotes }: { notesOpen: boolean; onCloseNotes(): void }) {
  const connection = useLiveConnectionStatus();
  const headerSnapshot = useLiveTelemetrySelector((state) => state.snapshot, headerSnapshotsEqual);
  const notesSnapshot = useLiveTelemetrySelector((state) => state.snapshot, notesSnapshotsEqual);
  const mode = headerSnapshot?.["context.mode"] ?? "inactive";
  const waiting = headerSnapshot === null;
  const identity = mode === "flight" ? String(headerSnapshot?.["v.name"] ?? "Active vessel") : mode === "editor" ? String(headerSnapshot?.["editor.craftName"] ?? "Untitled craft") : undefined;
  const linkText = waiting ? connectionLabel(connection.status) : mode === "inactive" ? "MISSION CONTROL LINK" : mode === "editor" ? "EDITOR LINK" : "FLIGHT LINK";
  return <DashboardSurface
    datalink={<DatalinkPanel connectionStatus={connection.status} endpoint={connection.endpoint} sceneMode={mode} />}
    datalinkConnected={connection.status === "linked"}
    identity={identity}
    linkText={linkText}
    liveMessage={connection.message ?? connection.endpoint}
    liveWaiting={waiting}
    mode={mode}
    notesOpen={notesOpen}
    notesSnapshot={notesSnapshot ?? emptyTelemetry}
    onCloseNotes={onCloseNotes}
  >
    {mode === "flight" ? <LiveFlightDashboard /> : mode === "editor" ? <><LiveEditorContextPanel /><LiveEditorSummaryPanel /><div className="dashboard-slice"><LiveStagingPanel /></div></> : <LiveMissionOverview />}
  </DashboardSurface>;
}

export function App() {
  const [notesOpen, setNotesOpen] = useState(false);
  useEffect(() => {
    liveTelemetryStore.connect(defaultLiveEndpoint);
    return () => liveTelemetryStore.disconnect();
  }, []);
  return (
    <PanelVisibilityProvider>
      <main className={`app-shell ${notesOpen ? "notes-open" : ""}`}>
        <button aria-controls="notes-continuity-preview" aria-expanded={notesOpen} aria-label="Notes" className="notes-rail-tab panel-rail-button" onClick={() => setNotesOpen((open) => !open)} title="Open Notes" type="button"><PanelRailIcon name="notes" /></button>
        <LiveDashboard notesOpen={notesOpen} onCloseNotes={() => setNotesOpen(false)} />
      </main>
    </PanelVisibilityProvider>
  );
}
