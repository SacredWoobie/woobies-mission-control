import {
  formatResourceAmount,
  humanizeResourceName,
  isFiniteNumber,
} from "../telemetry/formatters";
import type { TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";
import { resourceSeverity } from "./resourceMeter";

function formatMass(value: unknown) {
  if (!isFiniteNumber(value)) return "—";
  const kilograms = value * 1_000;
  return `${kilograms.toLocaleString("en-US", {
    maximumFractionDigits: 1,
  })} kg`;
}

function formatFunds(value: unknown) {
  return isFiniteNumber(value)
    ? `√${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : "—";
}

function formatCount(value: unknown) {
  return isFiniteNumber(value) ? Math.max(0, Math.round(value)).toLocaleString("en-US") : "—";
}

function SummaryValue({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="editor-summary-value">
      <span className="label">{label}</span>
      <strong>{value}</strong>
      {note && <span className="editor-summary-note">{note}</span>}
    </div>
  );
}

export function EditorSummaryPanel({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const available = snapshot["editor.summaryAvailable"];
  const calculating = snapshot["editor.stable"] === false || snapshot["stage.pending"] === true;
  const names = Array.isArray(snapshot["editor.res.names"])
    ? snapshot["editor.res.names"].filter((name): name is string => typeof name === "string")
    : [];

  return (
    <Panel id="editorSummary" title="Craft summary" tag="VAB · SPH · build totals">
      {calculating ? (
        <p className="editor-summary-state wait">Recalculating craft totals…</p>
      ) : available === false ? (
        <p className="editor-summary-state bad">
          Updated StageStats service required · install the new DLL and restart KSP
        </p>
      ) : available !== true ? (
        <p className="editor-summary-state">Awaiting editor craft summary…</p>
      ) : (
        <>
          <div className="editor-summary-grid">
            <SummaryValue label="Wet mass" value={formatMass(snapshot["editor.wetMass"])} />
            <SummaryValue label="Dry mass" value={formatMass(snapshot["editor.dryMass"])} />
            <SummaryValue label="Resource mass" value={formatMass(snapshot["editor.resourceMass"])} />
            <SummaryValue label="Parts" value={formatCount(snapshot["editor.partCount"])} />
            <SummaryValue label="Stages" value={formatCount(snapshot["editor.stageCount"])} />
            <SummaryValue label="Crew capacity" value={formatCount(snapshot["editor.crewCapacity"])} />
            <SummaryValue label="Total cost" value={formatFunds(snapshot["editor.totalCost"])} />
            <SummaryValue label="Resource cost" value={formatFunds(snapshot["editor.resourceCost"])} />
          </div>
          <div className="editor-resource-head">
            <span className="label">Resources aboard</span>
            <span>{names.length} {names.length === 1 ? "type" : "types"}</span>
          </div>
          {names.length === 0 ? (
            <p className="editor-resources-empty">No stored resources on this craft.</p>
          ) : (
            <div className="editor-resource-list">
              {names.map((name) => {
                const amount = snapshot[`editor.res[${name}]`];
                const maximum = snapshot[`editor.resMax[${name}]`];
                const current = isFiniteNumber(amount) ? amount : undefined;
                const capacity = isFiniteNumber(maximum) ? maximum : undefined;
                const percent = capacity && capacity > 0 && current !== undefined
                  ? Math.max(0, Math.min(100, Math.round(current / capacity * 100)))
                  : 0;
                const severity = resourceSeverity(percent);
                return (
                  <div className="editor-resource-row" key={name}>
                    <span title={name}>{humanizeResourceName(name)}</span>
                    <div
                      aria-label={`${percent}% full`}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={percent}
                      className="editor-resource-meter"
                      role="meter"
                    >
                      <span className={`fill ${severity}`} style={{ width: `${percent}%` }} />
                    </div>
                    <span className="editor-resource-amount">
                      {formatResourceAmount(current, capacity)}
                      <small>/ {formatResourceAmount(capacity, capacity)}</small>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
