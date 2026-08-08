import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isFiniteNumber } from "../formatting/numbers";
import { STOCK_BODIES } from "../resonantOrbit/calculations";
import type { TelemetryCommand, TelemetrySnapshot } from "../telemetry/types";

interface EditorContextPanelProps {
  commandEnabled: boolean;
  onSendCommand(command: Extract<TelemetryCommand, { type: "editor.conditions" }>): boolean;
  snapshot: TelemetrySnapshot;
}

const autoRecalculateDelayMs = 150;

function finiteNonnegativeOrUndefined(value: string) {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function formatMass(value: unknown) {
  if (!isFiniteNumber(value)) return "—";
  return `${(value * 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })} kg`;
}

function formatFunds(value: unknown) {
  return isFiniteNumber(value)
    ? `√${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : "—";
}

function formatCount(value: unknown) {
  return isFiniteNumber(value) ? Math.max(0, Math.round(value)).toLocaleString("en-US") : "—";
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
  const autoRecalculateTimeout = useRef<number | null>(null);
  const bodies = useMemo(() => {
    const reported = snapshot["editor.bodies"];
    const values = Array.isArray(reported) ? reported.filter((value): value is string => typeof value === "string") : [];
    return telemetryBody && !values.includes(telemetryBody) ? [telemetryBody, ...values] : values;
  }, [snapshot, telemetryBody]);
  const vacuumAltitude = useMemo(() => {
    const liveBody = Array.isArray(snapshot["catalog.bodies"])
      ? snapshot["catalog.bodies"].find((candidate) => candidate.name === body)
      : undefined;
    const stockBody = STOCK_BODIES[body as keyof typeof STOCK_BODIES];
    const atmosphereDepth = liveBody?.atmosphereDepth ?? stockBody?.atmosphereDepth;
    return isFiniteNumber(atmosphereDepth) ? Math.max(0, Math.ceil(atmosphereDepth)) : undefined;
  }, [body, snapshot]);

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

  function setAltitudePreset(value: number) {
    setAltitude(String(value));
    markDirty();
  }

  const submit = useCallback((force = false) => {
    if (autoRecalculateTimeout.current !== null) {
      window.clearTimeout(autoRecalculateTimeout.current);
      autoRecalculateTimeout.current = null;
    }
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
    autoRecalculateTimeout.current = window.setTimeout(() => {
      autoRecalculateTimeout.current = null;
      submit(false);
    }, autoRecalculateDelayMs);
    return () => {
      if (autoRecalculateTimeout.current !== null) {
        window.clearTimeout(autoRecalculateTimeout.current);
        autoRecalculateTimeout.current = null;
      }
    };
  }, [commandEnabled, conditionsValid, dirty, submit, unavailable]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit(false);
  }

  const statusClass = unavailable ? "bad" : calculating || sentAtRevision !== null ? "wait" : "ok";
  const statusText = !commandEnabled
    ? "Fixture telemetry · controls require a live link"
    : unavailable
      ? "MechJeb core required on this craft"
      : calculating
        ? "Recalculating…"
        : sentAtRevision !== null
          ? "Recalculating…"
          : "Analysis current";
  const craftName = String(snapshot["editor.craftName"] ?? "Untitled Space Craft");
  const facility = String(snapshot["editor.facility"] ?? "EDITOR");
  const partCount = formatCount(snapshot["editor.partCount"]);
  const stageCount = formatCount(snapshot["editor.stageCount"]);
  const seatCount = formatCount(snapshot["editor.crewCapacity"]);
  const numericAltitude = finiteNonnegativeOrUndefined(altitude);

  return (
    <section aria-labelledby="editor-craft-name" className="editor-overview" id="editorContext">
      <div className="editor-overview-summary">
        <div className="editor-overview-craft">
          <span className="label">Craft</span>
          <h1 className="editor-craft" id="editor-craft-name">{craftName}</h1>
          <span className="editor-craft-meta">{facility} · {partCount} parts · {stageCount} stages · {seatCount} seats</span>
        </div>
        <div className="editor-overview-metric mass">
          <span className="label">Wet mass</span>
          <strong>{formatMass(snapshot["editor.wetMass"])}</strong>
          <small>Dry {formatMass(snapshot["editor.dryMass"])} · resources {formatMass(snapshot["editor.resourceMass"])}</small>
        </div>
        <div className="editor-overview-metric cost">
          <span className="label">Cost</span>
          <strong>{formatFunds(snapshot["editor.totalCost"])}</strong>
          <small>{formatFunds(snapshot["editor.resourceCost"])} in resources</small>
        </div>
      </div>
      <div className="editor-sim-conditions">
        <span className="editor-sim-title">Sim conditions</span>
        <label className="editor-sim-control body">
          <span>Body</span>
          <select
            aria-label="Reference body"
            onChange={(event) => { setBody(event.target.value); markDirty(); }}
            onKeyDown={onKeyDown}
            value={body}
          >
            {bodies.length === 0 && <option value={body}>{body || "—"}</option>}
            {bodies.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="editor-sim-control altitude">
          <span>Alt ASL</span>
          <input
            aria-label="Altitude ASL (m)"
            min={0}
            onChange={(event) => { setAltitude(event.target.value); markDirty(); }}
            onKeyDown={onKeyDown}
            step={100}
            type="number"
            value={altitude}
          />
          <small>m</small>
        </label>
        <label className="editor-sim-control mach">
          <span>Mach</span>
          <input
            aria-label="Mach"
            min={0}
            onChange={(event) => { setMach(event.target.value); markDirty(); }}
            onKeyDown={onKeyDown}
            step={0.1}
            type="number"
            value={mach}
          />
        </label>
        <div aria-label="Altitude presets" className="editor-altitude-presets" role="group">
          <button aria-pressed={numericAltitude === 0} onClick={() => setAltitudePreset(0)} type="button">Sea level</button>
          <button aria-pressed={numericAltitude === 18_000} onClick={() => setAltitudePreset(18_000)} type="button">18 km</button>
          <button aria-pressed={vacuumAltitude !== undefined && numericAltitude === vacuumAltitude} disabled={vacuumAltitude === undefined} onClick={() => vacuumAltitude !== undefined && setAltitudePreset(vacuumAltitude)} type="button">Vacuum</button>
        </div>
        <div className="editor-sim-feedback">
          <span aria-live="polite" className={`editor-state ${statusClass}`}>{statusText}</span>
          <span className="editor-recalculation-note">Changes recalculate automatically after a brief pause</span>
        </div>
        <button className="editor-recalculate" disabled={!commandEnabled || unavailable || !conditionsValid} onClick={() => submit(true)} type="button">Recalculate now</button>
      </div>
    </section>
  );
}
