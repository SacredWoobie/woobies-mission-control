import { useCallback, useEffect, useMemo, useState } from "react";
import type { TelemetryCommand, TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";

interface EditorContextPanelProps {
  commandEnabled: boolean;
  onSendCommand(command: Extract<TelemetryCommand, { type: "editor.conditions" }>): boolean;
  snapshot: TelemetrySnapshot;
}

const autoRecalculateDelayMs = 500;

function finiteNonnegativeOrUndefined(value: string) {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export function EditorContextPanel({
  commandEnabled,
  onSendCommand,
  snapshot,
}: EditorContextPanelProps) {
  const telemetryBody = String(snapshot["editor.body"] ?? "");
  const telemetryAltitude = String(snapshot["editor.altitude"] ?? 0);
  const telemetryMach = String(snapshot["editor.mach"] ?? 0);
  const [body, setBody] = useState(telemetryBody);
  const [altitude, setAltitude] = useState(telemetryAltitude);
  const [mach, setMach] = useState(telemetryMach);
  const [dirty, setDirty] = useState(false);
  const [sentAtRevision, setSentAtRevision] = useState<number | null>(null);
  const bodies = useMemo(() => {
    const reported = snapshot["editor.bodies"];
    const values = Array.isArray(reported) ? reported.filter((value): value is string => typeof value === "string") : [];
    return telemetryBody && !values.includes(telemetryBody) ? [telemetryBody, ...values] : values;
  }, [snapshot, telemetryBody]);

  const revision = typeof snapshot["editor.revision"] === "number"
    ? snapshot["editor.revision"]
    : null;
  const calculating = snapshot["stage.pending"] === true || snapshot["editor.stable"] === false;
  const unavailable = snapshot["stage.available"] === false;
  const altitudeValue = finiteNonnegativeOrUndefined(altitude);
  const machValue = finiteNonnegativeOrUndefined(mach);
  const conditionsValid = body.length > 0 && altitudeValue !== undefined && machValue !== undefined;
  const requestSettled = sentAtRevision !== null && revision !== null && revision !== sentAtRevision && !calculating;

  useEffect(() => {
    if (dirty || sentAtRevision !== null) return;
    setBody(telemetryBody);
    setAltitude(telemetryAltitude);
    setMach(telemetryMach);
  }, [dirty, sentAtRevision, telemetryAltitude, telemetryBody, telemetryMach]);

  useEffect(() => {
    if (requestSettled) setSentAtRevision(null);
  }, [requestSettled]);

  function markDirty() {
    setDirty(true);
    setSentAtRevision(null);
  }

  const submit = useCallback((force = false) => {
    if (!commandEnabled || unavailable || !conditionsValid) return;
    const command: Extract<TelemetryCommand, { type: "editor.conditions" }> = {
      type: "editor.conditions",
      ...(force || body !== telemetryBody ? { body } : {}),
      ...(force || altitudeValue !== Number(telemetryAltitude) ? { altitude: altitudeValue } : {}),
      ...(force || machValue !== Number(telemetryMach) ? { mach: machValue } : {}),
    };
    if (!force && Object.keys(command).length === 1) {
      setDirty(false);
      return;
    }
    if (onSendCommand(command)) {
      setDirty(false);
      setSentAtRevision(revision);
    }
  }, [altitudeValue, body, commandEnabled, conditionsValid, machValue, onSendCommand, revision, telemetryAltitude, telemetryBody, telemetryMach, unavailable]);

  useEffect(() => {
    if (!dirty || !commandEnabled || unavailable || !conditionsValid) return;
    const timeout = window.setTimeout(() => submit(false), autoRecalculateDelayMs);
    return () => window.clearTimeout(timeout);
  }, [commandEnabled, conditionsValid, dirty, submit, unavailable]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit(false);
  }

  const statusClass = unavailable ? "bad" : calculating || sentAtRevision !== null ? "wait" : "ok";
  const statusText = !commandEnabled
    ? "Fixture telemetry · connect live to send conditions"
    : unavailable
      ? "MechJeb core required on this craft"
      : calculating
        ? "Recalculating…"
        : sentAtRevision !== null
          ? "Recalculating…"
          : "Analysis current";

  return (
    <Panel id="editorContext" title="Craft analysis" tag="VAB · SPH · MechJeb simulation">
      <div className="editor-head">
        <div>
          <div className="label">Craft</div>
          <div className="editor-craft">{String(snapshot["editor.craftName"] ?? "Untitled Space Craft")}</div>
        </div>
        <div className="editor-facility">{String(snapshot["editor.facility"] ?? "EDITOR")}</div>
      </div>
      <div className="editor-controls">
        <label className="editor-control">
          <span className="label">Reference body</span>
          <select
            onChange={(event) => { setBody(event.target.value); markDirty(); }}
            onKeyDown={onKeyDown}
            value={body}
          >
            {bodies.length === 0 && <option value={body}>{body || "—"}</option>}
            {bodies.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="editor-control">
          <span className="label">Altitude ASL (m)</span>
          <input
            min={0}
            onChange={(event) => { setAltitude(event.target.value); markDirty(); }}
            onKeyDown={onKeyDown}
            step={100}
            type="number"
            value={altitude}
          />
        </label>
        <label className="editor-control">
          <span className="label">Mach</span>
          <input
            min={0}
            onChange={(event) => { setMach(event.target.value); markDirty(); }}
            onKeyDown={onKeyDown}
            step={0.1}
            type="number"
            value={mach}
          />
        </label>
        <button disabled={!commandEnabled || unavailable || !conditionsValid} onClick={() => submit(true)} type="button">Recalculate</button>
      </div>
      <div aria-live="polite" className={`editor-state ${statusClass}`}>{statusText}</div>
    </Panel>
  );
}
