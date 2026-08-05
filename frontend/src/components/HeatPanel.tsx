import { useEffect, useState } from "react";
import { formatPercent, formatRateColumn, formatTemperature, isFiniteNumber } from "../formatting/numbers";
import type {
  HeatComponentTelemetry,
  HeatLoopControlAction,
  HeatLoopControlResult,
  TelemetryCommand,
  TelemetrySnapshot,
} from "../telemetry/types";
import {
  heatPanelIsIdle,
  heatStatusSummary,
  loopHeatEntity,
  rankHeatEntities,
  stockHeatEntity,
  type HeatEntity,
} from "./heatModel";
import { Panel } from "./Panel";

const HEAT_LOOP_MESSAGE_MS = 5_000;

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

function HeatEntityRow({ autoExpand, controlPending, entity, onControl }: {
  autoExpand: boolean;
  controlPending: boolean;
  entity: HeatEntity;
  onControl?: (entity: HeatEntity) => void;
}) {
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
  const showLoopControl = entity.kind === "loop" && Boolean(
    entity.radiatorState || entity.radiatorControlAvailable,
  );
  const canControl = Boolean(
    onControl
    && entity.radiatorControlAvailable
    && entity.radiatorControlAction
    && Number.isSafeInteger(entity.loopId)
    && entity.radiatorPartIds?.length,
  );
  const nonRetractable = entity.radiatorState === "online"
    && entity.radiatorControlAvailable === false
    && !entity.radiatorControlAction;
  const controlLabel = controlPending
    ? "APPLYING"
    : entity.radiatorControlAction === "start"
      ? "ACTIVATE"
      : entity.radiatorControlAction === "stop"
        ? "DEACTIVATE"
        : entity.radiatorState === "deploying"
          ? "DEPLOYING"
          : entity.radiatorState === "retracting"
            ? "RETRACTING"
            : entity.radiatorState === "broken"
              ? "DAMAGED"
              : nonRetractable
                ? "NON-RETRACTABLE"
                : "UNAVAILABLE";
  const controlTitle = entity.radiatorControlAction === "start"
    ? `Activate and extend all radiators in ${entity.name}`
    : entity.radiatorControlAction === "stop"
      ? `Deactivate and retract all radiators in ${entity.name}`
      : nonRetractable
        ? `${entity.name} radiators are active and cannot be retracted`
        : `${entity.name} radiators are ${entity.radiatorState ?? "unavailable"}`;

  return (
    <div className={`heat-entity ${entity.severity}${expanded ? " expanded" : ""}`}>
      <div className="heat-entity-summary">
        <button
          aria-expanded={hasDetails ? expanded : undefined}
          aria-label={hasDetails ? `${expanded ? "Collapse" : "Expand"} ${entity.name}` : undefined}
          className={`heat-entity-main${hasDetails ? " expandable" : ""}${showLoopControl ? " has-loop-control" : ""}`}
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
        {showLoopControl && (
          <button
            aria-label={controlTitle}
            className={`heat-loop-control ${entity.radiatorState ?? "unavailable"}${controlPending ? " pending" : ""}`}
            disabled={!canControl || controlPending}
            onClick={() => canControl && onControl?.(entity)}
            title={controlTitle}
            type="button"
          >{controlLabel}</button>
        )}
      </div>
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

export function HeatPanel({
  commandEnabled = false,
  controlResult,
  onSendCommand,
  snapshot,
}: {
  commandEnabled?: boolean;
  controlResult?: HeatLoopControlResult;
  onSendCommand?: (command: TelemetryCommand) => boolean;
  snapshot: TelemetrySnapshot;
}) {
  const [pending, setPending] = useState<{
    action: HeatLoopControlAction;
    loopId: number;
    requestId: string;
  } | null>(null);
  const [lastRequestId, setLastRequestId] = useState<string>();
  const [localError, setLocalError] = useState<string>();
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
  const result = controlResult?.requestId === lastRequestId
    ? controlResult
    : undefined;

  useEffect(() => {
    if (!pending) return;
    const entity = entities.find((candidate) => candidate.loopId === pending.loopId);
    if (!entity || entity.radiatorControlAction !== pending.action) setPending(null);
  }, [entities, pending]);

  useEffect(() => {
    if (
      pending
      && controlResult?.requestId === pending.requestId
      && controlResult.status === "error"
    ) setPending(null);
  }, [controlResult, pending]);

  useEffect(() => {
    if (!localError && !result) return;
    const visibleRequestId = lastRequestId;
    const timer = window.setTimeout(() => {
      setLocalError(undefined);
      setLastRequestId((current) => current === visibleRequestId ? undefined : current);
    }, HEAT_LOOP_MESSAGE_MS);
    return () => window.clearTimeout(timer);
  }, [lastRequestId, localError, result]);

  const sendControl = (entity: HeatEntity) => {
    const action = entity.radiatorControlAction;
    if (
      pending
      || !commandEnabled
      || !onSendCommand
      || !action
      || !Number.isSafeInteger(entity.loopId)
      || !entity.radiatorPartIds?.length
      || !snapshot["v.guid"]
    ) return;
    const requestId = `heat-loop-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const sent = onSendCommand({
      type: "heat.loop.control",
      requestId,
      loopId: entity.loopId!,
      action,
      expectedVesselGuid: snapshot["v.guid"],
      expectedRadiatorPartIds: [...entity.radiatorPartIds],
    });
    setLastRequestId(requestId);
    if (sent) {
      setPending({ action, loopId: entity.loopId!, requestId });
      setLocalError(undefined);
    } else {
      setLocalError("Radiator command was not sent because the telemetry link is unavailable.");
    }
  };

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
              controlPending={Boolean(pending && pending.loopId === entity.loopId)}
              entity={entity}
              key={entity.id}
              onControl={commandEnabled ? sendControl : undefined}
            />
          ))}
        </div>
      )}
      {(localError || result) && (
        <div className={`heat-command-result ${localError || result?.status === "error" ? "error" : "accepted"}`} role="status">
          {localError ?? result?.message}
        </div>
      )}
    </Panel>
  );
}
