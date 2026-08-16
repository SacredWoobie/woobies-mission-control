import { useEffect, useState } from "react";
import {
  DashboardAppFrame,
  DashboardProviders,
  LiveDashboard,
  resolveLiveEndpoint,
} from "./appShell";
import { liveTelemetryStore } from "./telemetry/store";

function ProductionDashboardApp() {
  const [notesOpen, setNotesOpen] = useState(false);
  const [liveEndpoint] = useState(resolveLiveEndpoint);

  useEffect(() => {
    liveTelemetryStore.connect(liveEndpoint);
    return () => liveTelemetryStore.disconnect();
  }, [liveEndpoint]);

  return (
    <DashboardAppFrame notesOpen={notesOpen}>
      <LiveDashboard
        endpointDraft={liveEndpoint}
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
