import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AscensionPanel } from "./components/AscensionPanel";
import { ConsumablesPanel } from "./components/ConsumablesPanel";
import { DeveloperDrawer, type TelemetrySource } from "./components/DeveloperDrawer";
import { ElectricityPanel } from "./components/ElectricityPanel";
import { EditorContextPanel } from "./components/EditorContextPanel";
import { EditorSummaryPanel } from "./components/EditorSummaryPanel";
import { FlightDashboard } from "./components/FlightDashboard";
import { ClockPanel, DatalinkPanel } from "./components/FlightStatusPanels";
import { HeatPanel } from "./components/HeatPanel";
import { NotesContinuityPreview } from "./components/NotesContinuityPreview";
import { MissionOverview } from "./components/MissionOverview";
import { PanelRailIcon } from "./components/PanelRailIcon";
import { HideablePanelSlot, PanelRestoreRail, PanelVisibilityProvider, usePanelVisibility, type DashboardPanelId } from "./components/PanelVisibility";
import { PinnedNotePanel } from "./components/PinnedNotePanel";
import { SciencePanel } from "./components/SciencePanel";
import { StagingPanel } from "./components/StagingPanel";
import { TargetPanel } from "./components/TargetPanel";
import {
  editorTelemetryFixture,
  flightTelemetryFixture,
  inactiveTelemetryFixture,
} from "./telemetry/fixtures";
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

const fixtures: Record<SceneMode, TelemetrySnapshot> = {
  flight: flightTelemetryFixture,
  editor: editorTelemetryFixture,
  inactive: inactiveTelemetryFixture,
};

const releaseDashboard = import.meta.env.PROD;
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
  notesCommandEnabled?: boolean;
  notesOpen: boolean;
  notesSnapshot: TelemetrySnapshot;
  onCloseNotes(): void;
  onSendNotesCommand?(command: TelemetryCommand): boolean;
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
  notesCommandEnabled = false,
  notesOpen,
  notesSnapshot,
  onCloseNotes,
  onSendNotesCommand = () => false,
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
      <NotesContinuityPreview commandEnabled={notesCommandEnabled} onClose={onCloseNotes} onSendCommand={onSendNotesCommand} open={notesOpen} snapshot={notesSnapshot} />
      <PanelRestoreRail available={datalinkPanel} />
      <div className="wrap">
        <HideablePanelSlot id="conn"><div className="shared-datalink-slot">{datalink}</div></HideablePanelSlot>
        {showHeader && <div className="slice-status"><span><strong>{linkText}</strong>{identity && ` · ${identity}`}</span></div>}
        {liveWaiting ? (
          <section className="connection-state" aria-live="polite"><strong>{linkText}</strong><span>{liveMessage}</span><span>{releaseDashboard ? "Waiting for the first valid Mission Control telemetry frame." : "Live telemetry replaces fixtures only after a valid snapshot arrives."}</span></section>
        ) : children}
      </div>
      <footer className="project-footer">Woobie's Mission Control · React dashboard · v0.3.0 development</footer>
    </section>
  );
}

function FixtureFlightDashboard({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const available = useMemo(() => availableFlightPanels(snapshot), [snapshot]);
  return <FlightDashboard
    ascension={<AscensionPanel snapshot={snapshot} />}
    availablePanels={available}
    clock={<ClockPanel snapshot={snapshot} />}
    consumables={<ConsumablesPanel snapshot={snapshot} />}
    electricity={<ElectricityPanel snapshot={snapshot} />}
    heat={<HeatPanel snapshot={snapshot} />}
    pinnedNote={snapshot["notes.pinned"] ? <PinnedNotePanel commandEnabled={false} onSendCommand={() => false} snapshot={snapshot} /> : undefined}
    science={<SciencePanel snapshot={snapshot} />}
    staging={<StagingPanel snapshot={snapshot} />}
    target={snapshot["tar.name"]?.trim() ? <TargetPanel snapshot={snapshot} /> : undefined}
  />;
}

function FixtureDashboard({ mode, notesOpen, onCloseNotes }: { mode: SceneMode; notesOpen: boolean; onCloseNotes(): void }) {
  const snapshot = fixtures[mode];
  const identity = mode === "flight" ? String(snapshot["v.name"] ?? "Active vessel") : mode === "editor" ? String(snapshot["editor.craftName"] ?? "Untitled craft") : undefined;
  return <DashboardSurface datalink={<DatalinkPanel connectionStatus="fixture" endpoint="deterministic fixtures" sceneMode={mode} />} identity={identity} linkText={`FIXTURE · ${mode}`} mode={mode} notesOpen={notesOpen} notesSnapshot={snapshot} onCloseNotes={onCloseNotes}>
    {mode === "flight" ? <FixtureFlightDashboard snapshot={snapshot} /> : mode === "editor" ? <><EditorContextPanel commandEnabled={false} onSendCommand={() => false} snapshot={snapshot} /><EditorSummaryPanel snapshot={snapshot} /><div className="dashboard-slice"><StagingPanel snapshot={snapshot} /></div></> : <MissionOverview snapshot={snapshot} />}
  </DashboardSurface>;
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

function LiveDatalinkPanel({ mode }: { mode: SceneMode }) {
  const connection = useLiveConnectionStatus();
  return <DatalinkPanel connectionStatus={connection.status} endpoint={connection.endpoint} onDisconnect={releaseDashboard ? undefined : () => liveTelemetryStore.disconnect()} sceneMode={mode} />;
}

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
  return snapshot?.["context.mode"] === "editor" ? <EditorContextPanel commandEnabled onSendCommand={(command) => liveTelemetryStore.send(command)} snapshot={snapshot} /> : null;
}

function LiveEditorSummaryPanel() {
  const snapshot = useLiveTelemetrySelector((state) => state.snapshot, editorSummarySnapshotsEqual);
  return snapshot?.["context.mode"] === "editor" ? <EditorSummaryPanel snapshot={snapshot} /> : null;
}

function LiveDashboard({ endpointDraft, notesOpen, onCloseNotes }: { endpointDraft: string; notesOpen: boolean; onCloseNotes(): void }) {
  const connection = useLiveConnectionStatus();
  const headerSnapshot = useLiveTelemetrySelector((state) => state.snapshot, headerSnapshotsEqual);
  const notesSnapshot = useLiveTelemetrySelector((state) => state.snapshot, notesSnapshotsEqual);
  const mode = headerSnapshot?.["context.mode"] ?? "inactive";
  const waiting = headerSnapshot === null;
  const identity = mode === "flight" ? String(headerSnapshot?.["v.name"] ?? "Active vessel") : mode === "editor" ? String(headerSnapshot?.["editor.craftName"] ?? "Untitled craft") : undefined;
  const linkText = waiting ? connectionLabel(connection.status) : mode === "inactive" ? "MISSION CONTROL LINK" : mode === "editor" ? "EDITOR LINK" : "FLIGHT LINK";
  return <DashboardSurface datalink={<LiveDatalinkPanel mode={mode} />} datalinkConnected={connection.status === "linked"} identity={identity} linkText={linkText} liveMessage={(connection.message ?? connection.endpoint) || endpointDraft} liveWaiting={waiting} mode={mode} notesCommandEnabled notesOpen={notesOpen} notesSnapshot={notesSnapshot ?? emptyTelemetry} onCloseNotes={onCloseNotes} onSendNotesCommand={(command) => liveTelemetryStore.send(command)}>
    {mode === "flight" ? <LiveFlightDashboard /> : mode === "editor" ? <><LiveEditorContextPanel /><LiveEditorSummaryPanel /><div className="dashboard-slice"><LiveStagingPanel /></div></> : <LiveMissionOverview />}
  </DashboardSurface>;
}

function ReleaseDashboardApp() {
  const [notesOpen, setNotesOpen] = useState(false);
  useEffect(() => {
    liveTelemetryStore.connect(defaultLiveEndpoint);
    return () => liveTelemetryStore.disconnect();
  }, []);
  return <PanelVisibilityProvider><main className={`app-shell ${notesOpen ? "notes-open" : ""}`}><button aria-controls="notes-continuity-preview" aria-expanded={notesOpen} aria-label="Notes" className="notes-rail-tab panel-rail-button" onClick={() => setNotesOpen((open) => !open)} title="Open Notes" type="button"><PanelRailIcon name="notes" /></button><LiveDashboard endpointDraft={defaultLiveEndpoint} notesOpen={notesOpen} onCloseNotes={() => setNotesOpen(false)} /></main></PanelVisibilityProvider>;
}

function DevelopmentDashboardApp() {
  const [fixtureMode, setFixtureMode] = useState<SceneMode>("flight");
  const [source, setSource] = useState<TelemetrySource>("fixtures");
  const [endpoint, setEndpoint] = useState(defaultLiveEndpoint);
  const [notesOpen, setNotesOpen] = useState(false);
  useEffect(() => () => liveTelemetryStore.disconnect(), []);
  function connectLive() { const target = endpoint.trim() || defaultLiveEndpoint; setEndpoint(target); liveTelemetryStore.disconnect(); setSource("live"); liveTelemetryStore.connect(target); }
  function disconnectLive() { setSource("live"); liveTelemetryStore.disconnect(); }
  function useFixtures() { liveTelemetryStore.disconnect(); setSource("fixtures"); }
  return <PanelVisibilityProvider><main className={`app-shell ${notesOpen ? "notes-open" : ""}`}><DeveloperDrawer endpoint={endpoint} fixtureMode={fixtureMode} onConnectLive={connectLive} onDisconnectLive={disconnectLive} onEndpointChange={setEndpoint} onFixtureModeChange={setFixtureMode} onUseFixtures={useFixtures} source={source} /><button aria-controls="notes-continuity-preview" aria-expanded={notesOpen} aria-label="Notes" className="notes-rail-tab panel-rail-button" onClick={() => setNotesOpen((open) => !open)} title="Open Notes" type="button"><PanelRailIcon name="notes" /></button>{source === "fixtures" ? <FixtureDashboard mode={fixtureMode} notesOpen={notesOpen} onCloseNotes={() => setNotesOpen(false)} /> : <LiveDashboard endpointDraft={endpoint} notesOpen={notesOpen} onCloseNotes={() => setNotesOpen(false)} />}</main></PanelVisibilityProvider>;
}

export function App() {
  return releaseDashboard ? <ReleaseDashboardApp /> : <DevelopmentDashboardApp />;
}
