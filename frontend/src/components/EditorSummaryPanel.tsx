import type { ReactNode } from "react";
import {
  formatResourcePair,
  humanizeResourceName,
  isFiniteNumber,
} from "../formatting/numbers";
import type { TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";
import { resourceSeverity } from "./resourceMeter";
import { useEditorAnalysisStatus } from "./useEditorAnalysisStatus";

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

function SummaryGroup({ children, label, type }: { children: ReactNode; label: string; type: "mass" | "build" | "cost" }) {
  return (
    <div aria-label={`${label} summary`} className={`editor-summary-group ${type}`} role="group">
      <span className="editor-summary-group-label">{label}</span>
      <div className="editor-summary-group-values">{children}</div>
    </div>
  );
}

function EditorSummaryContent({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const names = Array.isArray(snapshot["editor.res.names"])
    ? snapshot["editor.res.names"].filter((name): name is string => typeof name === "string")
    : [];

  return (
    <>
      <div className="editor-summary-groups">
        <SummaryGroup label="Mass" type="mass">
          <SummaryValue label="Wet" value={formatMass(snapshot["editor.wetMass"])} />
          <SummaryValue label="Dry" value={formatMass(snapshot["editor.dryMass"])} />
          <SummaryValue label="Resources" value={formatMass(snapshot["editor.resourceMass"])} />
        </SummaryGroup>
        <SummaryGroup label="Build" type="build">
          <SummaryValue label="Parts" value={formatCount(snapshot["editor.partCount"])} />
          <SummaryValue label="Stages" value={formatCount(snapshot["editor.stageCount"])} />
          <SummaryValue label="Crew" value={formatCount(snapshot["editor.crewCapacity"])} />
        </SummaryGroup>
        <SummaryGroup label="Cost" type="cost">
          <SummaryValue label="Total" value={formatFunds(snapshot["editor.totalCost"])} />
          <SummaryValue label="Resources" value={formatFunds(snapshot["editor.resourceCost"])} />
        </SummaryGroup>
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
            const formatted = formatResourcePair(current, capacity);
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
                  {formatted.value}
                  <small>/ {formatted.capacity}</small>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export function EditorSummaryPanel({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const available = snapshot["editor.summaryAvailable"];
  const {
    pending,
    retained,
    staleLabel,
  } = useEditorAnalysisStatus(snapshot);
  const retainedSummary = retained && available === true;

  return (
    <Panel id="editorSummary" title="Craft summary" tag="VAB · SPH · build totals">
      {pending && !retainedSummary ? (
        <p className="editor-summary-state wait">Recalculating craft totals…</p>
      ) : available === false ? (
        <p className="editor-summary-state bad">
          Updated StageStats service required · install the new DLL and restart KSP
        </p>
      ) : available !== true ? (
        <p className="editor-summary-state">Awaiting editor craft summary…</p>
      ) : (
        <>
          {retainedSummary && (
            <div aria-live="polite" className="editor-analysis-status wait">
              {staleLabel}
            </div>
          )}
          <div
            aria-busy={pending}
            className={`editor-summary-content${retainedSummary ? " editor-analysis-retained" : ""}`}
          >
            <EditorSummaryContent snapshot={snapshot} />
          </div>
        </>
      )}
    </Panel>
  );
}
