import { useState } from "react";
import {
  formatMissionDuration,
  formatSignalDelay,
  formatUniversalTime,
  isFiniteNumber,
} from "../telemetry/formatters";
import type { SceneMode, TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";

interface FlightStatusPanelsProps {
  connectionStatus: "offline" | "connecting" | "linked" | "retrying" | "fixture";
  endpoint: string;
  onDisconnect?(): void;
  sceneMode?: SceneMode;
  snapshot: TelemetrySnapshot;
}

export function DatalinkPanel({
  connectionStatus,
  endpoint,
  onDisconnect,
  sceneMode = "inactive",
}: Omit<FlightStatusPanelsProps, "snapshot">) {
  const sceneLabel = sceneMode === "flight" ? "FLIGHT" : sceneMode === "editor" ? "EDITOR" : "MISSION CONTROL";
  const label = connectionStatus === "fixture" ? `FIXTURE · ${sceneLabel}`
    : connectionStatus === "linked" ? `${sceneLabel} LINK`
      : connectionStatus === "connecting" ? "Linking"
        : connectionStatus === "retrying" ? "Retrying" : "Offline";
  const ledClass = connectionStatus === "linked" || connectionStatus === "fixture"
    ? "ok" : connectionStatus === "connecting" ? "wait" : connectionStatus === "retrying" ? "bad" : "";

  return (
    <Panel hideable id="conn" title="Datalink">
      <div className="datalink-row">
        <span className="label live">KRPC BRIDGE</span>
        <span className="label">{endpoint.replace(/^ws:\/\//, "")}</span>
        <span className="status"><span className={`led ${ledClass}`} />{label}</span>
        {onDisconnect && <button className="datalink-disconnect" onClick={onDisconnect} type="button">Disconnect</button>}
      </div>
    </Panel>
  );
}

export function ClockPanel({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const [kerbin, setKerbin] = useState(true);
  const ut = formatUniversalTime(snapshot["t.universalTime"], kerbin);
  const met = snapshot["v.missionTime"];
  const remoteTech = snapshot["rt.available"] === true;
  const remoteConnection = snapshot["rt.hasConnection"];
  const stockConnection = snapshot["comm.krpc.canCommunicate"];
  const connected = remoteTech ? remoteConnection : stockConnection;
  const strength = snapshot["comm.krpc.signalStrength"];
  const commText = connected === true
    ? `CONNECTED${!remoteTech && isFiniteNumber(strength) && strength > 0 ? ` · ${Math.round(strength * 100)}%` : ""}`
    : connected === false ? "NO SIGNAL" : "—";
  const delay = snapshot["rt.available"] === false
    ? "RemoteTech not installed"
    : remoteConnection === false ? "NO CONNECTION" : formatSignalDelay(snapshot["rt.signalDelay"]);

  return (
    <Panel hideable id="clock" title="Time & communications">
      <div className="clock-grid">
        <div className="clockcell">
          <div className="label">Universal Time <button className="calendar-toggle" onClick={() => setKerbin((value) => !value)} type="button">[{kerbin ? "KERBIN" : "EARTH"}]</button></div>
          <div className="big">{ut.big}</div>
          <div className="sub">{ut.sub || "awaiting link"}</div>
        </div>
        <div className="clockcell met-cell">
          <div className="label">Mission Elapsed</div>
          <div className="big">T+ {formatMissionDuration(met, kerbin)}</div>
          <div className="sub">{isFiniteNumber(met) ? (met < 1 ? "on pad" : "in flight") : "not launched"}</div>
        </div>
      </div>
      <div className="comms-strip">
        <div className="cs-cell">
          <span className="label">Comms link</span>
          <span className="cs-status"><span className={`led2 ${connected === true ? "ok" : connected === false ? "bad" : ""}`} />{commText}</span>
        </div>
        <div className="cs-cell">
          <span className="label">Signal delay <span className="label-muted">(RemoteTech via kRPC)</span></span>
          <span className="cs-val">{delay}</span>
        </div>
      </div>
    </Panel>
  );
}
