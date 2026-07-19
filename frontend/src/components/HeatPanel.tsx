import { formatRate, isFiniteNumber } from "../telemetry/formatters";
import type { StockHeatPartTelemetry, TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";

function stockSeverity(part: StockHeatPartTelemetry) {
  if (!isFiniteNumber(part.utilization)) return "";
  if (part.utilization >= 90) return " danger";
  if (part.utilization >= 75) return " warn";
  return "";
}

function HeatSummary({ generated, removed, net, unit, available }: {
  generated?: number;
  removed?: number;
  net?: number;
  unit: "kW" | "W";
  available: boolean;
}) {
  const value = (input: number | undefined) => available ? formatRate(input, unit) : "—";
  return <div className="heat-strip">
    <div className="cs-cell"><span className="label">Generated</span><span className="cs-val">{value(generated)}</span></div>
    <div className="cs-cell"><span className="label">Removed</span><span className="cs-val">{value(removed)}</span></div>
    <div className="cs-cell"><span className="label">Net</span><span className="cs-val">{value(net)}</span></div>
  </div>;
}

export function HeatPanel({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const backend = snapshot["heat.backend"];
  const stock = backend === "stock";
  const loops = snapshot["heat.loops"] ?? [];
  const parts = snapshot["heat.parts"] ?? [];
  const available = stock ? parts.length > 0 : loops.length > 0;

  return (
    <Panel
      hideable
      id="heat"
      title="Heat Management"
      tag={stock ? "Stock thermal · W" : backend === "system_heat" ? "System Heat · kW" : "Thermal telemetry"}
    >
      <HeatSummary
        available={available}
        generated={stock ? snapshot["heat.generatedW"] : snapshot["heat.generatedKw"]}
        removed={stock ? snapshot["heat.removedW"] : snapshot["heat.removedKw"]}
        net={stock ? snapshot["heat.netW"] : snapshot["heat.netKw"]}
        unit={stock ? "W" : "kW"}
      />
      {!stock && <div className="heat-loops">{loops.map((loop) =>
        <div className="hl-row" key={loop.id}>
          <span className="t">Loop {loop.id}</span>
          <span className="v">{isFiniteNumber(loop.tempK) ? `${Math.round(loop.tempK)} K` : "—"}</span>
          <span className="v">{formatRate(loop.genKw, "kW")} / {formatRate(loop.remKw, "kW")}</span>
        </div>
      )}</div>}
      {stock && <div className="heat-loops stock-heat-parts">{parts.map((part, index) =>
        <div className={`hl-row stock-heat-row${stockSeverity(part)}`} key={`${part.name}-${index}`}>
          <span className="t" title={part.name}>{part.name}</span>
          <span className="v">{isFiniteNumber(part.utilization) ? `${Math.round(part.utilization)}% limit` : "—"}</span>
          <span className="v">{isFiniteNumber(part.skinTempK) ? `${Math.round(part.skinTempK)} K skin` : "—"}</span>
          <span className="v">{formatRate(part.netW, "W")}</span>
        </div>
      )}</div>}
    </Panel>
  );
}
