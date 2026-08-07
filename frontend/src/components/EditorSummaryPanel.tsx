import {
  formatResourcePair,
  humanizeResourceName,
  isFiniteNumber,
} from "../formatting/numbers";
import type { TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";
import { resourceSeverity } from "./resourceMeter";
import { useEditorAnalysisStatus } from "./useEditorAnalysisStatus";

function EditorSummaryContent({ names, snapshot }: { names: string[]; snapshot: TelemetrySnapshot }) {
  return (
    <div aria-label="Craft resource inventory" className="editor-summary-content" role="group">
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
    </div>
  );
}

export function EditorSummaryPanel({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const names = Array.isArray(snapshot["editor.res.names"])
    ? snapshot["editor.res.names"].filter((name): name is string => typeof name === "string")
    : [];
  const available = snapshot["editor.summaryAvailable"];
  const {
    pending,
    retained,
    staleLabel,
  } = useEditorAnalysisStatus(snapshot);
  const retainedSummary = retained && available === true;

  return (
    <Panel id="editorSummary" title="Resource inventory" tag={`${names.length} ${names.length === 1 ? "type" : "types"} · vessel totals`}>
      {pending && !retainedSummary ? (
        <p className="editor-summary-state wait">Recalculating resource totals…</p>
      ) : available === false ? (
        <p className="editor-summary-state bad">
          Updated StageStats service required · install the new DLL and restart KSP
        </p>
      ) : available !== true ? (
        <p className="editor-summary-state">Awaiting editor resource inventory…</p>
      ) : (
        <>
          {retainedSummary && (
            <div aria-live="polite" className="editor-analysis-status wait">
              {staleLabel}
            </div>
          )}
          <div
            aria-busy={pending}
            className={`editor-summary-content-shell${retainedSummary ? " editor-analysis-retained" : ""}`}
          >
            <EditorSummaryContent names={names} snapshot={snapshot} />
          </div>
        </>
      )}
    </Panel>
  );
}
