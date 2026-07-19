import { useEffect, useState } from "react";
import type { SceneMode } from "../telemetry/types";
import { useLiveDiagnostics } from "../telemetry/useLiveTelemetry";

export type TelemetrySource = "fixtures" | "live";

interface DeveloperDrawerProps {
  endpoint: string;
  fixtureMode: SceneMode;
  source: TelemetrySource;
  onConnectLive(): void;
  onDisconnectLive(): void;
  onEndpointChange(endpoint: string): void;
  onFixtureModeChange(mode: SceneMode): void;
  onUseFixtures(): void;
}

export function DeveloperDrawer({
  endpoint,
  fixtureMode,
  onConnectLive,
  onDisconnectLive,
  onEndpointChange,
  onFixtureModeChange,
  onUseFixtures,
  source,
}: DeveloperDrawerProps) {
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const diagnostics = useLiveDiagnostics();

  useEffect(() => {
    if (!open || source !== "live") return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [open, source]);

  const frameAge = diagnostics.lastFrameAt === null
    ? "—"
    : `${Math.max(0, (clock - diagnostics.lastFrameAt) / 1_000).toFixed(1)} s`;

  return (
    <div className={`dev-drawer-shell ${open ? "open" : ""}`}>
      <button
        aria-controls="dashboard-dev-controls"
        aria-expanded={open}
        className="dev-drawer-tab"
        onClick={() => setOpen((current) => !current)}
        title="Dashboard developer controls"
        type="button"
      >
        DEV
      </button>
      {open && (
        <aside className="dev-drawer" id="dashboard-dev-controls" aria-label="Dashboard developer controls">
          <header>
            <div>
              <strong>Dashboard developer controls</strong>
              <span>Development only · v0.2.3 baseline</span>
            </div>
            <button aria-label="Close dashboard developer controls" onClick={() => setOpen(false)} type="button">×</button>
          </header>

          <div className="dev-control-group">
            <span className="dev-control-label">Telemetry source</span>
            <div className="dev-source-picker">
              <button aria-pressed={source === "fixtures"} onClick={onUseFixtures} type="button">Fixtures</button>
              <button aria-pressed={source === "live"} onClick={onConnectLive} type="button">Live KSP</button>
            </div>
          </div>

          {source === "fixtures" && (
            <div className="dev-control-group">
              <span className="dev-control-label">Scene fixture</span>
              <div className="fixture-picker" aria-label="Telemetry fixture">
                {(["flight", "editor", "inactive"] as const).map((candidate) => (
                  <button
                    aria-pressed={candidate === fixtureMode}
                    className={candidate === fixtureMode ? "active" : ""}
                    key={candidate}
                    onClick={() => onFixtureModeChange(candidate)}
                    type="button"
                  >
                    {candidate}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="dev-control-group">
            <label className="dev-control-label" htmlFor="live-telemetry-endpoint">Live endpoint</label>
            <input
              id="live-telemetry-endpoint"
              onChange={(event) => onEndpointChange(event.target.value)}
              spellCheck={false}
              type="text"
              value={endpoint}
            />
            <div className="dev-connection-actions">
              <button className="dev-connect-button" onClick={onConnectLive} type="button">
                {source === "live" && diagnostics.status !== "offline" ? "Reconnect" : "Connect"}
              </button>
              <button
                className="dev-disconnect-button"
                disabled={source !== "live" || diagnostics.status === "offline"}
                onClick={onDisconnectLive}
                type="button"
              >
                Disconnect
              </button>
            </div>
          </div>

          <footer>
            <div className="dev-status-line">
              <span className={`dev-status-dot ${diagnostics.status}`} />
              {source === "fixtures" ? "Fixture data" : diagnostics.status}
            </div>
            {source === "live" && (
              <dl className="dev-diagnostics">
                <div><dt>Frames</dt><dd>{diagnostics.frameCount}</dd></div>
                <div><dt>Frame age</dt><dd>{frameAge}</dd></div>
                <div><dt>Endpoint</dt><dd>{diagnostics.endpoint || endpoint}</dd></div>
                {diagnostics.message && <div><dt>Last event</dt><dd>{diagnostics.message}</dd></div>}
              </dl>
            )}
          </footer>
        </aside>
      )}
    </div>
  );
}
