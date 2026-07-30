import { useMemo, useState } from "react";
import { formatMissionUT } from "../deltaV/PorkchopPlotModal";
import type { TelemetryCommand, TelemetrySnapshot, TransferWindowTelemetry } from "../telemetry/types";
import { isKerbinTime, useTimeSystem } from "../timeSystem";
import { usePanelVisibility } from "./PanelVisibility";

function formatMinuteDuration(seconds: number, kerbin: boolean) {
  const totalMinutes = Math.max(1, Math.ceil(Math.abs(seconds) / 60));
  const minutesPerDay = (kerbin ? 6 : 24) * 60;
  const daysPerYear = kerbin ? 426 : 365;
  const minutesPerYear = minutesPerDay * daysPerYear;
  let remaining = totalMinutes;
  const years = Math.floor(remaining / minutesPerYear);
  remaining -= years * minutesPerYear;
  const days = Math.floor(remaining / minutesPerDay);
  remaining -= days * minutesPerDay;
  const hours = Math.floor(remaining / 60);
  const minutes = remaining % 60;
  const parts = [];
  if (years > 0) parts.push(`${years}y`);
  if (days > 0 || years > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0 || years > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

export function formatTransferWindowCountdown(
  departureUT: number,
  currentUT: number,
  kerbin: boolean,
) {
  const difference = departureUT - currentUT;
  if (!Number.isFinite(difference)) return "Unknown";
  if (difference === 0) return "NOW";
  const duration = formatMinuteDuration(difference, kerbin);
  return difference > 0 ? `T\u2212 ${duration}` : `${duration} overdue`;
}

function validDeparture(row: TransferWindowTelemetry) {
  return typeof row.departureUT === "number" && Number.isFinite(row.departureUT);
}

export function TransferWindowsPanel({
  commandEnabled = false,
  onSendCommand = () => false,
  snapshot,
}: {
  commandEnabled?: boolean;
  onSendCommand?(command: TelemetryCommand): boolean;
  snapshot: TelemetrySnapshot;
}) {
  const { hidePanel } = usePanelVisibility();
  const { system } = useTimeSystem();
  const kerbin = isKerbinTime(system);
  const [sendError, setSendError] = useState("");
  const state = snapshot["mj.transfer.windows.state"] ?? "idle";
  const requestId = snapshot["mj.transfer.windows.requestId"] ?? "";
  const origin = snapshot["mj.transfer.windows.origin"] || "Kerbin";
  const currentUT = typeof snapshot["t.universalTime"] === "number"
    && Number.isFinite(snapshot["t.universalTime"])
    ? snapshot["t.universalTime"]
    : null;
  const rows = useMemo(() => (
    [...(snapshot["mj.transfer.windows.results"] ?? [])].sort((left, right) => {
      if (validDeparture(left) && validDeparture(right)) {
        return left.departureUT! - right.departureUT!;
      }
      if (validDeparture(left)) return -1;
      if (validDeparture(right)) return 1;
      return left.destination.localeCompare(right.destination);
    })
  ), [snapshot]);
  const serviceReady = snapshot["mj.transfer.available"] === true
    && snapshot["mj.transfer.compatibilityReady"] === true;
  const active = ["queued", "paused", "running", "cancelling"].includes(state);
  const expired = currentUT !== null && rows.some((row) => validDeparture(row) && row.departureUT! < currentUT);
  const completedCount = snapshot["mj.transfer.windows.completedCount"] ?? rows.length;
  const totalCount = snapshot["mj.transfer.windows.totalCount"] ?? rows.length;
  const activeDestination = snapshot["mj.transfer.windows.activeDestination"];
  const progress = snapshot["mj.transfer.windows.progress"] ?? 0;
  const statusText = state === "paused"
    ? snapshot["mj.transfer.windows.pauseReason"] || "Waiting for the interactive mission planner."
    : state === "cancelling"
      ? "Cancelling transfer-window refresh..."
      : active
        ? `${activeDestination ? `Calculating ${origin} \u2192 ${activeDestination}` : "Preparing transfer windows"} \u00b7 ${completedCount}/${totalCount} \u00b7 ${progress}%`
        : "";

  const refresh = () => {
    const nextRequestId = globalThis.crypto?.randomUUID?.()
      ?? `windows-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setSendError("");
    if (!onSendCommand({
      type: "mechjeb.transfer.windows.refresh",
      requestId: nextRequestId,
      origin: "Kerbin",
      originParkingAltitude: 80_000,
      optimizePoweredCapture: true,
    })) {
      setSendError("Unable to start the refresh because Mission Control is not linked.");
    }
  };
  const cancel = () => {
    if (!requestId) return;
    setSendError("");
    if (!onSendCommand({ type: "mechjeb.transfer.windows.cancel", requestId })) {
      setSendError("Unable to cancel the refresh because Mission Control is not linked.");
    }
  };

  return <section className="overview-section overview-transfer-windows">
    <header className="overview-section-head">
      <h2>Transfer windows</h2>
      <div className="overview-section-actions">
        <strong>{rows.length}</strong>
        <button aria-label="Hide Transfer windows panel" className="panel-hide-button" onClick={() => hidePanel("overviewTransfers")} title="Hide panel" type="button">{"\u2039"}</button>
      </div>
    </header>
    <div className="transfer-window-body">
      <div className="transfer-window-toolbar">
        <div>
          <span>ORIGIN</span>
          <strong>{origin}</strong>
          <small>Best MechJeb departure across installed primary planets</small>
        </div>
        {active
          ? <button disabled={!commandEnabled || state === "cancelling"} onClick={cancel} type="button">Cancel refresh</button>
          : <button disabled={!commandEnabled || !serviceReady} onClick={refresh} type="button">{expired ? "Refresh expired windows" : rows.length ? "Refresh windows" : "Calculate windows"}</button>}
        {statusText && <p aria-live="polite" className="transfer-window-status">{statusText}</p>}
      </div>
      {rows.length > 0 ? <div className="overview-transfer-grid">
        {rows.map((row) => <article className={`overview-transfer-card ${row.error ? "error" : ""}`} key={row.destination}>
          <div className="overview-transfer-route">
            <strong>
              <span className="overview-transfer-origin">{origin} {"\u2192"} </span>
              <span className="overview-transfer-destination">{row.destination}</span>
            </strong>
            <span>{validDeparture(row) ? formatMissionUT(row.departureUT!, kerbin) : row.error || "No solution returned"}</span>
          </div>
          <div className="overview-transfer-countdown">
            <strong>{validDeparture(row) && currentUT !== null ? formatTransferWindowCountdown(row.departureUT!, currentUT, kerbin) : validDeparture(row) ? "UNKNOWN" : "UNAVAILABLE"}</strong>
            <span>{row.error ? "CALCULATION FAILED" : "BEST UPCOMING DEPARTURE"}</span>
          </div>
        </article>)}
      </div> : <p className="overview-empty">{
        !serviceReady
          ? "The WoobiesMechJeb transfer service is unavailable."
          : active
            ? "Transfer windows will appear as each planet finishes."
            : "Calculate windows to build a minute-accurate departure countdown board."
      }</p>}
    </div>
    {(sendError || snapshot["mj.transfer.windows.error"]) && <p className="overview-service-warning" role="alert"><strong>Transfer-window refresh failed</strong><span>{sendError || snapshot["mj.transfer.windows.error"]}</span></p>}
  </section>;
}
