import { formatTelemetryNumber, isFiniteNumber } from "../telemetry/formatters";
import type { TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";

export function SciencePanel({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const total = snapshot["sci.krpc.total"];
  const transmit = snapshot["sci.krpc.transmitTotal"];
  const rows = snapshot["sci.krpc.experiments"] ?? [];
  const count = snapshot["sci.krpc.count"] ?? rows.length;
  const location = [snapshot["v.body"], snapshot["v.situationString"], snapshot["v.biome"]].filter((item) => typeof item === "string" && item.trim() && item !== "null").join(" · ");
  const summary = isFiniteNumber(total)
    ? count ? `${formatTelemetryNumber(total)} science recoverable · ${formatTelemetryNumber(transmit)} by transmit` : "no science aboard"
    : "awaiting kRPC link";
  return (
    <Panel hideable id="sci" title="Science" tag="Stored aboard">
      <div className="sci-total"><span className="label">Science recoverable</span><span className={`sci-value ${!isFiniteNumber(total) ? "blocked" : ""}`}>{summary}</span><span className="sci-sub">{count} experiment{count === 1 ? "" : "s"} aboard{isFiniteNumber(snapshot["career.science"]) ? ` · ${formatTelemetryNumber(snapshot["career.science"])} science banked at KSC` : ""}</span></div>
      {location && <div className="sci-loc">{location}</div>}
      {rows.length > 0 && <details className="sci-details"><summary>Experiment detail ({rows.length})</summary><div className="sci-list">{rows.map((row, index) => <div className="sl-row" key={`${row.title}-${index}`}><span className="t" title={row.title}>{row.title}</span><span className="v">{formatTelemetryNumber(row.value)} <span className="label-muted">/ {formatTelemetryNumber(row.transmit)} tx</span></span></div>)}</div></details>}
    </Panel>
  );
}
