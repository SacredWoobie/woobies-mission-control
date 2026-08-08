import {
  formatMissionDuration,
  formatPercent,
  formatSignalDelay,
  formatUniversalTime,
  isFiniteNumber,
} from "../telemetry/formatters";
import type { ReactNode } from "react";
import type { TelemetrySnapshot } from "../telemetry/types";
import { isKerbinTime, useTimeSystem } from "../timeSystem";
import { Panel } from "./Panel";

export function ClockPanel({ annunciator, snapshot }: { annunciator?: ReactNode; snapshot: TelemetrySnapshot }) {
  const { system, toggleSystem } = useTimeSystem();
  const kerbin = isKerbinTime(system);
  const ut = formatUniversalTime(snapshot["t.universalTime"], kerbin);
  const met = snapshot["v.missionTime"];
  const remoteTech = snapshot["rt.available"] === true;
  const remoteConnection = snapshot["rt.hasConnection"];
  const stockConnection = snapshot["comm.krpc.canCommunicate"];
  const connected = remoteTech ? remoteConnection : stockConnection;
  const strength = snapshot["comm.krpc.signalStrength"];
  const commText = connected === true
    ? `CONNECTED${!remoteTech && isFiniteNumber(strength) && strength > 0 ? ` · ${formatPercent(strength * 100)}` : ""}`
    : connected === false ? "NO SIGNAL" : "—";
  const delay = remoteConnection === false ? "NO CONNECTION" : formatSignalDelay(snapshot["rt.signalDelay"]);
  const vesselName = String(snapshot["v.name"] ?? "Active vessel");
  const vesselBody = String(snapshot["v.body"] ?? "Unknown body");
  const situation = String(snapshot["v.situationString"] ?? "Situation unknown");

  return (
    <Panel id="clock" title="Flight context">
      <div className={`flight-context-grid ${remoteTech ? "remote-tech" : ""}`}>
        <div className="flight-context-identity">
          <span className="label">Active vessel</span>
          <strong>{vesselName}</strong>
          <span>{vesselBody} · {situation}</span>
        </div>
        <div className="clock-grid">
          <div className="clockcell">
            <div className="label">Universal Time <button aria-label={`Time system: ${kerbin ? "Kerbin" : "Earth"}`} className="calendar-toggle" onClick={toggleSystem} type="button">[{kerbin ? "KERBIN" : "EARTH"}]</button></div>
            <div className="clock-primary-row">
              <div className="big">{ut.big}</div>
              <div className="sub">{ut.sub || "awaiting link"}</div>
            </div>
          </div>
          <div className="clockcell met-cell">
            <div className="label">Mission Elapsed</div>
            <div className="big">T+ {formatMissionDuration(met, kerbin)}</div>
            <div className="sub">{isFiniteNumber(met) ? (met < 1 ? "on pad" : "in flight") : "not launched"}</div>
          </div>
        </div>
        <div className={`comms-strip ${remoteTech ? "remote-tech" : ""}`}>
          <div className="cs-cell">
            <span className="label">Comms link</span>
            <span className="cs-status"><span className={`led2 ${connected === true ? "ok" : connected === false ? "bad" : ""}`} />{commText}</span>
          </div>
          {remoteTech && <div className="cs-cell">
            <span className="label">Signal delay</span>
            <span className="cs-val">{delay}</span>
          </div>}
        </div>
        {annunciator}
      </div>
    </Panel>
  );
}
