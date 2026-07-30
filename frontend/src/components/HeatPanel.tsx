import { useEffect, useState } from "react";
import { formatPercent, formatRateColumn, formatTemperature, isFiniteNumber } from "../formatting/numbers";
import type { HeatComponentTelemetry, TelemetrySnapshot } from "../telemetry/types";
import {
  heatPanelIsIdle,
  heatStatusSummary,
  loopHeatEntity,
  rankHeatEntities,
  stockHeatEntity,
  type HeatEntity,
} from "./heatModel";
import { Panel } from "./Panel";

function formatSignedRate(value: number | undefined, unit: "kW" | "W") {
  if (!isFiniteNumber(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatRateColumn(value, unit)}`;
}

function formatHeatTime(seconds: number | undefined) {
  if (!isFiniteNumber(seconds) || seconds < 0) return "";
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function componentLabel(component: HeatComponentTelemetry) {
  const count = isFiniteNumber(component.count) && component.count > 1
    ? ` ×${Math.round(component.count)}`
    : "";
  return `${component.name}${count}`;
}

function HeatComponentRow({ component, fallbackUnit }: {
  component: HeatComponentTelemetry;
  fallbackUnit: "kW" | "W";
}) {
  return (
    <div className="heat-component-row">
      <span className="heat-component-copy">
        <span>{componentLabel(component)}</span>
        {component.role && <small>{component.role}</small>}
      </span>
      <strong className={(component.fluxKw ?? 0) < 0 ? "cooling" : "warming"}>
        {formatSignedRate(component.fluxKw, fallbackUnit)}
      </strong>
    </div>
  );
}

function HeatEntityRow({ autoExpand, entity }: { autoExpand: boolean; entity: HeatEntity }) {
  const hasDetails = entity.kind === "loop"
    && Boolean(entity.components)
    && ((entity.components?.producers.length ?? 0) + (entity.components?.radiators.length ?? 0) > 0);
  const [expanded, setExpanded] = useState(autoExpand && hasDetails);

  useEffect(() => {
    if (autoExpand && hasDetails) setExpanded(true);
  }, [autoExpand, hasDetails]);

  const unit = entity.kind === "loop" ? "kW" : "W";
  const ratioPercent = isFiniteNumber(entity.ratio) ? Math.max(0, entity.ratio * 100) : 0;
  const displayPercent = Math.min(100, ratioPercent);
  const state = entity.severity === "no-radiators"
    ? "no radiators"
    : formatHeatTime(entity.timeToCriticalSeconds) || entity.stateText || "";
  const primaryTemperature = `${formatTemperature(entity.currentK)}/${formatTemperature(entity.limitK)} K`;
  const subline = entity.kind === "part"
    ? entity.secondaryTemperature
      ? `${entity.secondaryTemperature.label} ${formatTemperature(entity.secondaryTemperature.tempK)} K`
      : ""
    : entity.componentSummary
      || [
        isFiniteNumber(entity.generatedFlux) ? `${formatRateColumn(entity.generatedFlux, "kW")} generated` : "",
        isFiniteNumber(entity.removedFlux) ? `${formatRateColumn(entity.removedFlux, "kW")} removed` : "",
      ].filter(Boolean).join(" · ");

  return (
    <div className={`heat-entity ${entity.severity}${expanded ? " expanded" : ""}`}>
      <button
        aria-expanded={hasDetails ? expanded : undefined}
        aria-label={hasDetails ? `${expanded ? "Collapse" : "Expand"} ${entity.name}` : undefined}
        className={`heat-entity-main${hasDetails ? " expandable" : ""}`}
        disabled={!hasDetails}
        onClick={() => hasDetails && setExpanded((current) => !current)}
        type="button"
      >
        <span className="heat-caret" aria-hidden="true">{hasDetails ? (expanded ? "⌄" : "›") : ""}</span>
        <span className="heat-severity-rail" aria-hidden="true" />
        <span className="heat-entity-copy">
          <span className="heat-entity-topline">
            <strong title={entity.name}>{entity.name}</strong>
            <span className="heat-temperature-track" aria-hidden="true">
              <span style={{ width: `${displayPercent}%` }} />
            </span>
            <span className="heat-temperature-value">{primaryTemperature}</span>
            {entity.kind === "loop" && (
              <span className={`heat-net-flux ${(entity.netFlux ?? 0) > 0 ? "warming" : (entity.netFlux ?? 0) < 0 ? "cooling" : ""}`}>
                {formatSignedRate(entity.netFlux, unit)}
              </span>
            )}
            {entity.kind === "part" && (
              <span className="heat-ratio-value">{formatPercent(isFiniteNumber(entity.ratio) ? ratioPercent : undefined)}</span>
            )}
          </span>
          <span className="heat-entity-subline">
            <span>{subline}</span>
            {entity.kind === "loop" && <span>{state}</span>}
          </span>
        </span>
      </button>
      {hasDetails && expanded && (
        <div className="heat-component-list">
          {entity.components?.producers.map((component, index) => (
            <HeatComponentRow component={component} fallbackUnit="kW" key={`producer-${component.name}-${index}`} />
          ))}
          {entity.components?.radiators.map((component, index) => (
            <HeatComponentRow component={component} fallbackUnit="kW" key={`radiator-${component.name}-${index}`} />
          ))}
        </div>
      )}
    </div>
  );
}

export function HeatPanel({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const backend = snapshot["heat.backend"];
  const stock = backend === "stock";
  const entities = rankHeatEntities(stock
    ? (snapshot["heat.parts"] ?? []).map(stockHeatEntity)
    : (snapshot["heat.loops"] ?? []).map(loopHeatEntity));
  const status = heatStatusSummary(entities);
  const idle = heatPanelIsIdle(entities);
  const autoExpandedId = entities.find((entity) => (
    entity.severity === "critical" || entity.severity === "no-radiators"
  ))?.id;

  return (
    <Panel
      hideable
      id="heat"
      title="Heat Management"
      tag={entities.length > 0 ? (
        <span className={`heat-heading-status ${status.severity}`}>
          <span>{status.noun}</span>
          <span aria-hidden="true">·</span>
          <strong>{status.label}</strong>
        </span>
      ) : backend ? "NO THERMAL DATA" : "THERMAL TELEMETRY"}
    >
      {entities.length === 0 && <p className="empty-state heat-empty">No thermal entities detected.</p>}
      {idle && (
        <div className="heat-idle-state">
          <span className="heat-severity-rail" aria-hidden="true" />
          <span>All {stock ? "parts" : "loops"} within nominal range</span>
          <strong>NOMINAL</strong>
        </div>
      )}
      {!idle && entities.length > 0 && (
        <div className={`heat-entity-list ${stock ? "stock" : "system-heat"}`}>
          {entities.map((entity) => (
            <HeatEntityRow
              autoExpand={entity.id === autoExpandedId}
              entity={entity}
              key={entity.id}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}
