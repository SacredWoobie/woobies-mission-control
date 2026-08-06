import {
  formatAlignmentAngle,
  formatDistance,
  formatDockingOffset,
  formatInclination,
  formatSpeed,
  isFiniteNumber,
} from "../formatting/numbers";
import { useEffect, useState } from "react";
import type { TargetClearResult, TelemetryCommand, TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";

type TargetClearCommand = Extract<TelemetryCommand, { type: "target.clear" }>;

function DockingIndicator({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const ax = snapshot["dock.ax"];
  const ay = snapshot["dock.ay"];
  const x = snapshot["dock.x"];
  const y = snapshot["dock.y"];
  const available = [ax, ay, x, y].some(isFiniteNumber);
  if (!available) return null;
  const center = 110;
  const radius = 70;
  const markerX = Math.max(center - radius, Math.min(center + radius, center + (ay ?? 0) * 3));
  const markerY = Math.max(80 - radius, Math.min(80 + radius, 80 - (ax ?? 0) * 3));
  const aligned = isFiniteNumber(ax) && isFiniteNumber(ay) && Math.abs(ax) < 1.5 && Math.abs(ay) < 1.5;
  return (
    <div className="dock-wrap"><svg aria-label={aligned ? "Docking ports aligned" : "Docking alignment indicator"} className={`dock-svg ${aligned ? "aligned" : ""}`} viewBox="0 0 220 160"><circle className="dock-ring" cx="110" cy="80" r="70" /><circle className="dock-ring" cx="110" cy="80" r="38.5" /><circle className="dock-ring bright" cx="110" cy="80" r="6" /><line className="dock-axis" x1="40" x2="180" y1="80" y2="80" /><line className="dock-axis" x1="110" x2="110" y1="10" y2="150" /><line className="dock-vector" x1="110" x2={markerX} y1="80" y2={markerY} /><circle className="dock-marker" cx={markerX} cy={markerY} r="7" /><circle className="dock-marker-dot" cx={markerX} cy={markerY} r="1.5" /><text x="6" y="14">X {formatDockingOffset(x)} · Y {formatDockingOffset(y)}</text><text className="dock-status" x="6" y="154">{aligned ? "ALIGNED" : `ALIGN: ${formatAlignmentAngle(ax)}/${formatAlignmentAngle(ay)}`}</text></svg></div>
  );
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="stat"><span className="label">{label}</span><span className="v">{value}</span></div>; }

export function TargetPanel({
  clearResult,
  commandEnabled = false,
  onSendCommand,
  snapshot,
}: {
  clearResult?: TargetClearResult;
  commandEnabled?: boolean;
  onSendCommand?: (command: TargetClearCommand) => boolean;
  snapshot: TelemetrySnapshot;
}) {
  const name = snapshot["tar.name"]?.trim();
  const targetObjectId = snapshot["tar.objectId"]?.trim();
  const targetType = snapshot["tar.type"]?.trim().toLowerCase();
  const vesselGuid = snapshot["v.guid"]?.trim();
  const validTargetType = targetType === "body" || targetType === "dockingport" || targetType === "vessel"
    ? targetType
    : undefined;
  const [pendingRequestId, setPendingRequestId] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; status: "accepted" | "error" } | null>(null);

  useEffect(() => {
    if (!pendingRequestId || clearResult?.requestId !== pendingRequestId) return;
    setFeedback({ message: clearResult.message, status: clearResult.status });
    setPendingRequestId("");
  }, [clearResult, pendingRequestId]);

  useEffect(() => {
    if (!pendingRequestId) return;
    const timer = globalThis.setTimeout(() => {
      setFeedback({ message: "The target-clear request did not receive a response.", status: "error" });
      setPendingRequestId("");
    }, 10_000);
    return () => globalThis.clearTimeout(timer);
  }, [pendingRequestId]);

  useEffect(() => {
    if (!feedback) return;
    const timer = globalThis.setTimeout(() => setFeedback(null), 10_000);
    return () => globalThis.clearTimeout(timer);
  }, [feedback]);

  if (!name) return null;

  const canClear = Boolean(
    commandEnabled
    && onSendCommand
    && vesselGuid
    && targetObjectId
    && validTargetType,
  );
  const clearTarget = () => {
    if (!canClear || pendingRequestId || !vesselGuid || !targetObjectId || !validTargetType) return;
    const requestId = globalThis.crypto?.randomUUID?.()
      ?? `target-clear-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sent = onSendCommand!({
      type: "target.clear",
      requestId,
      expectedVesselGuid: vesselGuid,
      expectedTargetObjectId: targetObjectId,
      expectedTargetName: name,
      expectedTargetType: validTargetType,
    });
    setFeedback(null);
    if (sent) setPendingRequestId(requestId);
    else setFeedback({ message: "The dashboard command link is unavailable.", status: "error" });
  };

  return (
    <Panel
      headingActions={<button className="target-clear-button" disabled={!canClear || Boolean(pendingRequestId)} onClick={clearTarget} type="button">{pendingRequestId ? "UNSETTING…" : "UNSET TARGET"}</button>}
      hideable
      id="target"
      title="Target"
    >
      {feedback && <div className={`target-command-feedback ${feedback.status}`} role={feedback.status === "error" ? "alert" : "status"}>{feedback.message}</div>}
      <div className="tgt-name">{name}</div><div className="tgt-grid"><Stat label="Distance" value={formatDistance(snapshot["tar.distance"], "context")} /><Stat label="Relative speed" value={formatSpeed(snapshot["tar.o.relativeVelocity"])} /><Stat label="Inclination" value={formatInclination(snapshot["tar.o.inclination"])} /><Stat label="Apoapsis" value={formatDistance(snapshot["tar.o.ApA"], "live")} /><Stat label="Periapsis" value={formatDistance(snapshot["tar.o.PeA"], "live")} /><Stat label="Orbital speed" value={formatSpeed(snapshot["tar.o.velocity"])} /></div><DockingIndicator snapshot={snapshot} />
    </Panel>
  );
}
