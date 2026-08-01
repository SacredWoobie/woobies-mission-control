import { formatScienceColumn, formatScienceInline, isFiniteNumber } from "../formatting/numbers";
import type { ScienceExperimentTelemetry, TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";
import { selectScience, type ScienceLabViewModel } from "./scienceModel";

function capacityPair(current: number | undefined, capacity: number | undefined) {
  if (!isFiniteNumber(current) || !isFiniteNumber(capacity)) return "—";
  const compact = (value: number) => Math.abs(value) >= 100
    ? Math.round(value).toLocaleString("en-US")
    : formatScienceInline(value);
  return `${compact(current)} / ${compact(capacity)}`;
}

function LabMeter({
  capacity,
  current,
  fraction,
  kind,
  label,
  title,
}: {
  capacity: number | undefined;
  current: number | undefined;
  fraction: number | undefined;
  kind: "data" | "science";
  label: string;
  title: string;
}) {
  const percent = isFiniteNumber(fraction) ? Math.round(fraction * 100) : 0;
  return (
    <div className="sci-lab-meter">
      <span className="sci-meter-label">{label}</span>
      <div
        aria-label={isFiniteNumber(fraction) ? `${title} ${label.toLowerCase()} ${percent}% full` : `${title} ${label.toLowerCase()} unavailable`}
        aria-valuemax={isFiniteNumber(capacity) ? capacity : undefined}
        aria-valuemin={0}
        aria-valuenow={isFiniteNumber(current) ? current : undefined}
        className="sci-meter-track"
        role="meter"
      >
        <span className={`sci-meter-fill ${kind}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="sci-meter-value">{capacityPair(current, capacity)}</span>
    </div>
  );
}

function LabCard({ lab }: { lab: ScienceLabViewModel }) {
  return (
    <article className={`sci-lab-card ${lab.tone}`}>
      <header className="sci-lab-head">
        <div className="sci-lab-identity">
          <span className="sci-label sci-lab-title" title={lab.title}>Lab · {lab.title}</span>
          <strong className="sci-lab-rate">{formatScienceColumn(lab.sciencePerDay)} <small>sci/day</small></strong>
        </div>
        <div className="sci-lab-status">
          <span className="sci-label">Status</span>
          <strong>{lab.statusLabel}</strong>
          <small>{lab.crewLabel}</small>
        </div>
      </header>
      <LabMeter capacity={lab.dataCapacity} current={lab.dataStored} fraction={lab.dataFraction} kind="data" label="Data" title={lab.title} />
      <LabMeter capacity={lab.scienceCapacity} current={lab.scienceStored} fraction={lab.scienceFraction} kind="science" label="Science" title={lab.title} />
      <footer className="sci-lab-caption">
        <span>{lab.activityLabel}</span>
        <span>{lab.guidance}</span>
      </footer>
    </article>
  );
}

function experimentSource(row: ScienceExperimentTelemetry) {
  return [
    row.sourcePart?.trim(),
    isFiniteNumber(row.data) ? `${formatScienceInline(row.data)} data` : "",
  ].filter(Boolean).join(" · ");
}

export function SciencePanel({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const model = selectScience(snapshot);
  const summary = isFiniteNumber(model.recoverable)
    ? formatScienceInline(model.recoverable)
    : "awaiting kRPC link";
  return (
    <Panel hideable id="sci" title="Science">
      <div className="sci-overview-card">
        <div className="sci-overview-row">
          <div className="sci-overview-hero">
            <span className="sci-label">Recoverable</span>
            <strong className={!isFiniteNumber(model.recoverable) ? "blocked" : ""}>{summary}</strong>
            <small>{model.experimentCount} experiment{model.experimentCount === 1 ? "" : "s"} · {formatScienceInline(model.transmit)} by transmit</small>
          </div>
          <div className="sci-location">
            <span className="sci-label">Location</span>
            <strong>{model.locationPrimary || "—"}</strong>
            <small>{model.locationDetail || "location unavailable"}</small>
          </div>
        </div>
        {isFiniteNumber(model.banked) && <div className="sci-banked">{formatScienceInline(model.banked)} science banked at KSC</div>}
      </div>

      {model.labTelemetryAvailable ? (
        model.labs.length > 0
          ? <div className="sci-lab-list" aria-label="Science laboratories">{model.labs.map((lab) => <LabCard key={lab.id} lab={lab} />)}</div>
          : <div className="sci-lab-empty">No research labs aboard</div>
      ) : (
        <div className="sci-lab-empty unavailable">Lab telemetry unavailable · service update required</div>
      )}

      {model.experiments.length > 0 && (
        <details className="sci-details">
          <summary><span>Experiment detail</span><span>{model.experiments.length}</span></summary>
          <div className="sci-list">{model.experiments.map((row, index) => {
            const source = experimentSource(row);
            return (
              <div className="sl-row" key={`${row.title}-${row.subjectId ?? index}`}>
                <span className="sl-copy"><span className="t" title={row.title}>{row.title}</span>{source && <small>{source}</small>}</span>
                <span className="v">{formatScienceColumn(row.value)} <span className="label-muted">/ {formatScienceColumn(row.transmit)} tx</span></span>
              </div>
            );
          })}</div>
        </details>
      )}
    </Panel>
  );
}
