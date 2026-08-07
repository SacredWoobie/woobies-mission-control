import { useEffect, useState } from "react";
import { useDialogFocus } from "../deltaV/useDialogFocus";
import type { ConnectionStatus } from "../telemetry/client";
import type { SceneMode } from "../telemetry/types";

export interface DatalinkEvent {
  at: number;
  id: number;
  message: string;
  status: ConnectionStatus | "fixture";
}

export interface DatalinkDrawerProps {
  connectionStatus: ConnectionStatus | "fixture";
  endpoint: string;
  events?: readonly DatalinkEvent[];
  frameCount?: number;
  lastFrameAt?: number | null;
  message?: string;
  onClose(): void;
  onRefresh?(): void;
  onToggle?(): void;
  open: boolean;
  sceneMode?: SceneMode;
}

function sceneLabel(mode: SceneMode) {
  if (mode === "flight") return "FLIGHT";
  if (mode === "editor") return "EDITOR";
  return "MISSION CONTROL";
}

function statusLabel(status: DatalinkDrawerProps["connectionStatus"]) {
  if (status === "fixture") return "FIXTURE FEED";
  if (status === "linked") return "LINKED";
  if (status === "connecting") return "LINKING";
  if (status === "retrying") return "RETRYING";
  return "DATALINK OFF";
}

function ageLabel(at: number | null | undefined, now: number) {
  if (!at) return "No telemetry received";
  const seconds = Math.max(0, Math.floor((now - at) / 1_000));
  if (seconds < 1) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function eventTime(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function DatalinkDrawer({
  connectionStatus,
  endpoint,
  events = [],
  frameCount = 0,
  lastFrameAt,
  message,
  onClose,
  onRefresh,
  onToggle,
  open,
  sceneMode = "inactive",
}: DatalinkDrawerProps) {
  const dialogRef = useDialogFocus<HTMLElement>(open, onClose);
  const [now, setNow] = useState(Date.now());
  const active = connectionStatus !== "offline";
  const ledClass = connectionStatus === "linked" || connectionStatus === "fixture"
    ? "ok" : connectionStatus === "connecting" ? "wait" : connectionStatus === "retrying" ? "bad" : "";

  useEffect(() => {
    if (!open) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [open]);

  if (!open) return null;
  return <>
    <div aria-hidden="true" className="resonant-drawer-backdrop" onMouseDown={onClose} />
    <aside aria-label="Datalink controls" aria-modal="true" className="resonant-drawer datalink-drawer" id="datalink-drawer" ref={dialogRef} role="dialog" tabIndex={-1}>
      <header>
        <div><span>TELEMETRY · CONNECTION</span><h2>Datalink</h2><p>Browser link to the local Mission Control telemetry service.</p></div>
        <button aria-label="Close Datalink drawer" onClick={onClose} type="button">×</button>
      </header>
      <div className="resonant-drawer-body datalink-drawer-body">
        <section className={`datalink-status-card is-${connectionStatus}`}>
          <div className="datalink-status-primary"><span className={`led ${ledClass}`} /><div><span className="label">LINK STATE</span><strong>{statusLabel(connectionStatus)}</strong></div></div>
          <span className="datalink-scene">{sceneLabel(sceneMode)}</span>
          {message && <p>{message}</p>}
        </section>

        <section className="datalink-diagnostics" aria-label="Connection diagnostics">
          <div><span className="label">ENDPOINT</span><strong title={endpoint}>{endpoint.replace(/^ws:\/\//, "") || "Not configured"}</strong></div>
          <div><span className="label">TRANSPORT</span><strong>Browser WebSocket</strong></div>
          <div><span className="label">FRAMES THIS SESSION</span><strong>{frameCount.toLocaleString()}</strong></div>
          <div><span className="label">LAST TELEMETRY</span><strong>{ageLabel(lastFrameAt, now)}</strong></div>
        </section>

        <section className="datalink-controls" aria-label="Datalink controls">
          <button disabled={!onRefresh} onClick={onRefresh} type="button"><span>REFRESH CONNECTION</span><small>Close and immediately reopen the browser telemetry link.</small></button>
          <button className={active ? "power-off" : "power-on"} disabled={!onToggle} onClick={onToggle} type="button"><span>{active ? "TURN DATALINK OFF" : "TURN DATALINK ON"}</span><small>{active ? "Pause this dashboard's telemetry connection." : "Connect this dashboard to the configured endpoint."}</small></button>
        </section>

        <section className="datalink-event-section">
          <div className="datalink-section-heading"><span>RECENT LINK EVENTS</span><strong>{events.length}</strong></div>
          {events.length ? <ol className="datalink-event-log" aria-label="Recent connection events">
            {events.map((event) => <li className={`is-${event.status}`} key={event.id}><time dateTime={new Date(event.at).toISOString()}>{eventTime(event.at)}</time><span>{event.message}</span></li>)}
          </ol> : <p className="datalink-event-empty">No connection transitions recorded in this dashboard session.</p>}
        </section>
      </div>
      <footer><span>These controls affect only this browser's telemetry socket. The Python service, kRPC server, and KSP keep running.</span></footer>
    </aside>
  </>;
}
