import { useEffect, useMemo, useState } from "react";
import { FlightAnnunciator } from "./annunciator/FlightAnnunciator";
import { useFixtureFlightAnnunciator } from "./annunciator/useFlightAnnunciator";
import {
  availableFlightPanels,
  DashboardAppFrame,
  DashboardProviders,
  DashboardSurface,
  DEFAULT_LIVE_ENDPOINT,
  EditorWorkspace,
  LiveDashboard,
} from "./appShell";
import { AscensionPanel } from "./components/AscensionPanel";
import { ConsumablesPanel } from "./components/ConsumablesPanel";
import { DatalinkDrawer } from "./components/DatalinkDrawer";
import { DeveloperDrawer, type TelemetrySource } from "./components/DeveloperDrawer";
import { ElectricityPanel } from "./components/ElectricityPanel";
import { EditorContextPanel } from "./components/EditorContextPanel";
import { EditorElectricityPanel } from "./components/EditorElectricityPanel";
import { EditorSummaryPanel } from "./components/EditorSummaryPanel";
import { FlightDashboard } from "./components/FlightDashboard";
import { ClockPanel } from "./components/FlightStatusPanels";
import { HeatPanel } from "./components/HeatPanel";
import { MissionOverview } from "./components/MissionOverview";
import { PinnedNotePanel } from "./components/PinnedNotePanel";
import { SciencePanel } from "./components/SciencePanel";
import { StagingPanel } from "./components/StagingPanel";
import { TargetPanel } from "./components/TargetPanel";
import { PinnedDeltaVPlanPanel } from "./deltaV/PinnedDeltaVPlanPanel";
import { useDeltaVDraft } from "./deltaV/state";
import { PinnedResonantOrbitPanel } from "./resonantOrbit/PinnedResonantOrbitPanel";
import { useResonantOrbitState } from "./resonantOrbit/state";
import {
  editorTelemetryFixture,
  flightTelemetryFixture,
  inactiveTelemetryFixture,
} from "./telemetry/fixtures";
import { liveTelemetryStore } from "./telemetry/store";
import type { SceneMode, TelemetrySnapshot } from "./telemetry/types";

const fixtures: Record<SceneMode, TelemetrySnapshot> = {
  flight: flightTelemetryFixture,
  editor: editorTelemetryFixture,
  inactive: inactiveTelemetryFixture,
};

function FixtureFlightDashboard({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const annunciator = useFixtureFlightAnnunciator(snapshot);
  const { pinnedForTelemetry: pinnedOrbitForTelemetry } = useResonantOrbitState();
  const { pinnedForTelemetry } = useDeltaVDraft();
  const pinnedOrbit = pinnedOrbitForTelemetry(snapshot);
  const pinnedDeltaV = pinnedForTelemetry(snapshot);
  const available = useMemo(() => availableFlightPanels(snapshot, !!pinnedOrbit, !!pinnedDeltaV), [pinnedDeltaV, pinnedOrbit, snapshot]);
  return (
    <FlightDashboard
      ascension={<AscensionPanel snapshot={snapshot} />}
      availablePanels={available}
      clock={<ClockPanel annunciator={<FlightAnnunciator controller={annunciator} />} snapshot={snapshot} />}
      consumables={<ConsumablesPanel snapshot={snapshot} />}
      electricity={<ElectricityPanel snapshot={snapshot} />}
      heat={<HeatPanel snapshot={snapshot} />}
      pinnedNote={snapshot["notes.pinned"] ? <PinnedNotePanel commandEnabled={false} onSendCommand={() => false} snapshot={snapshot} /> : undefined}
      pinnedDeltaVPlan={pinnedDeltaV ? <PinnedDeltaVPlanPanel snapshot={snapshot} /> : undefined}
      pinnedOrbitPlan={pinnedOrbit ? <PinnedResonantOrbitPanel snapshot={snapshot} /> : undefined}
      science={<SciencePanel snapshot={snapshot} />}
      staging={<StagingPanel snapshot={snapshot} />}
      target={snapshot["tar.name"]?.trim() ? <TargetPanel snapshot={snapshot} /> : undefined}
      vesselIdentity={String(snapshot["v.persistentId"] ?? snapshot["v.guid"] ?? snapshot["v.name"] ?? "fixture-vessel")}
    />
  );
}

function FixtureDashboard({ mode, notesOpen, onCloseNotes, onSetNotesOpen }: { mode: SceneMode; notesOpen: boolean; onCloseNotes(): void; onSetNotesOpen(open: boolean): void }) {
  const snapshot = fixtures[mode];
  const identity = mode === "flight" ? String(snapshot["v.name"] ?? "Active vessel") : mode === "editor" ? String(snapshot["editor.craftName"] ?? "Untitled craft") : undefined;
  return (
    <DashboardSurface
      datalink={(open, onClose) => <DatalinkDrawer connectionStatus="fixture" endpoint="deterministic fixtures" onClose={onClose} open={open} sceneMode={mode} />}
      footerLabel="Development"
      identity={identity}
      linkText={`FIXTURE · ${mode}`}
      mode={mode}
      notesOpen={notesOpen}
      notesSnapshot={snapshot}
      onCloseNotes={onCloseNotes}
      onSetNotesOpen={onSetNotesOpen}
    >
      {mode === "flight"
        ? <FixtureFlightDashboard snapshot={snapshot} />
        : mode === "editor"
          ? (
            <EditorWorkspace
              context={<EditorContextPanel commandEnabled={false} onSendCommand={() => false} snapshot={snapshot} />}
              electricity={<EditorElectricityPanel snapshot={snapshot} />}
              snapshot={snapshot}
              staging={<StagingPanel snapshot={snapshot} />}
              summary={<EditorSummaryPanel snapshot={snapshot} />}
            />
          )
          : <MissionOverview snapshot={snapshot} />}
    </DashboardSurface>
  );
}

function DevelopmentDashboardApp() {
  const [fixtureMode, setFixtureMode] = useState<SceneMode>("flight");
  const [source, setSource] = useState<TelemetrySource>("fixtures");
  const [endpoint, setEndpoint] = useState(DEFAULT_LIVE_ENDPOINT);
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => () => liveTelemetryStore.disconnect(), []);

  function connectLive() {
    const target = endpoint.trim() || DEFAULT_LIVE_ENDPOINT;
    setEndpoint(target);
    liveTelemetryStore.disconnect();
    setSource("live");
    liveTelemetryStore.connect(target);
  }

  function disconnectLive() {
    setSource("live");
    liveTelemetryStore.disconnect();
  }

  function useFixtures() {
    liveTelemetryStore.disconnect();
    setSource("fixtures");
  }

  return (
    <DashboardAppFrame notesOpen={notesOpen}>
      <DeveloperDrawer
        endpoint={endpoint}
        fixtureMode={fixtureMode}
        onConnectLive={connectLive}
        onDisconnectLive={disconnectLive}
        onEndpointChange={setEndpoint}
        onFixtureModeChange={setFixtureMode}
        onUseFixtures={useFixtures}
        source={source}
      />
      {source === "fixtures" ? (
        <FixtureDashboard
          mode={fixtureMode}
          notesOpen={notesOpen}
          onCloseNotes={() => setNotesOpen(false)}
          onSetNotesOpen={setNotesOpen}
        />
      ) : (
        <LiveDashboard
          endpointDraft={endpoint}
          footerLabel="Development"
          notesOpen={notesOpen}
          onCloseNotes={() => setNotesOpen(false)}
          onSetNotesOpen={setNotesOpen}
          waitingMessage="Live telemetry replaces fixtures only after a valid snapshot arrives."
        />
      )}
    </DashboardAppFrame>
  );
}

export function App() {
  return (
    <DashboardProviders>
      <DevelopmentDashboardApp />
    </DashboardProviders>
  );
}
