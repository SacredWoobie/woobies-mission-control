import { useEffect, useState } from "react";
import {
  DashboardAppFrame,
  DashboardProviders,
  DEFAULT_LIVE_ENDPOINT,
  LiveDashboard,
} from "./appShell";
import { liveTelemetryStore } from "./telemetry/store";

function ProductionDashboardApp() {
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    liveTelemetryStore.connect(DEFAULT_LIVE_ENDPOINT);
    return () => liveTelemetryStore.disconnect();
  }, []);

  return (
    <DashboardAppFrame notesOpen={notesOpen}>
      <LiveDashboard
        endpointDraft={DEFAULT_LIVE_ENDPOINT}
        footerLabel="Production"
        notesOpen={notesOpen}
        onCloseNotes={() => setNotesOpen(false)}
        onSetNotesOpen={setNotesOpen}
      />
    </DashboardAppFrame>
  );
}

export function App() {
  return (
    <DashboardProviders>
      <ProductionDashboardApp />
    </DashboardProviders>
  );
}
