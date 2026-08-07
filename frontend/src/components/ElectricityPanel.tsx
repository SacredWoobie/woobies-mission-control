import { useEffect, useRef, useState, type RefObject } from "react";
import {
  formatPercent,
  formatRateColumn,
  formatResourcePair,
  formatTemperature,
  formatTelemetryNumber,
  isFiniteNumber,
} from "../formatting/numbers";
import type {
  ReactorControlAction,
  ReactorControlResult,
  ReactorTelemetry,
  TelemetryCommand,
  TelemetrySnapshot,
} from "../telemetry/types";
import { Panel } from "./Panel";
import { resourceSeverity } from "./resourceMeter";
import {
  selectElectricity,
  type ElectricitySourceViewModel,
  type ElectricityViewModel,
} from "./electricityModel";

const REACTOR_CONTROL_MESSAGE_MS = 5_000;

function ecRate(value: number | undefined) {
  return formatRateColumn(value, "EC/s");
}

function throttlePercent(value: number | undefined) {
  return isFiniteNumber(value) ? `${formatTelemetryNumber(value)}%` : formatTelemetryNumber(value);
}

function compactDuration(seconds: number | undefined) {
  if (!isFiniteNumber(seconds)) return "—";
  const rounded = Math.max(0, Math.floor(seconds));
  const days = Math.floor(rounded / 86_400);
  const hours = Math.floor((rounded % 86_400) / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const remainder = rounded % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

function etaLabel(model: ElectricityViewModel) {
  if (model.etaKind === "full") {
    if (model.flowState === "saturated") return "battery full";
    return isFiniteNumber(model.etaSeconds) ? `full in ${compactDuration(model.etaSeconds)}` : "full";
  }
  if (model.etaKind === "empty") {
    if (model.flowState === "saturated") return "battery empty";
    return isFiniteNumber(model.etaSeconds) ? `empty in ${compactDuration(model.etaSeconds)}` : "empty";
  }
  if (model.etaKind === "steady") return "charge steady";
  if (model.etaKind === "calibrating") return "flow calibrating";
  return "flow unavailable";
}

function sourceDetail(source: ElectricitySourceViewModel) {
  if (source.kind === "reactor") {
    const online = source.activeCount ?? 0;
    const capacity = isFiniteNumber(source.maxEcPerSec) && source.maxEcPerSec > 0
      ? ` · max ${ecRate(source.maxEcPerSec)}`
      : "";
    return `${online} online of ${source.count}${capacity}`;
  }
  if (source.kind === "solar") {
    return [source.state, source.detail, `${source.count} panels`].filter(Boolean).join(" · ");
  }
  if (source.kind === "rtg") return `${source.count} units · constant`;
  if (source.kind === "fuel-cell") {
    const runtime = isFiniteNumber(source.runtimeSeconds)
      ? `runtime ${compactDuration(source.runtimeSeconds)}`
      : "";
    return [runtime, source.detail, `${source.activeCount ?? 0} active of ${source.count}`]
      .filter(Boolean)
      .join(" · ");
  }
  return source.detail ?? `${source.count} installed`;
}

function SourceRate({ value }: { value: number | undefined }) {
  const rendered = ecRate(value);
  const suffix = " EC/s";
  const amount = rendered.endsWith(suffix) ? rendered.slice(0, -suffix.length) : rendered;
  return (
    <strong className="ec-source-rate">
      <span>{amount}</span>
      <span>EC/s</span>
    </strong>
  );
}

function ChargeMeter({ model }: { model: ElectricityViewModel }) {
  const percent = isFiniteNumber(model.chargeFraction)
    ? Math.round(model.chargeFraction * 100)
    : 0;
  const severity = resourceSeverity(percent);
  const amount = (
    isFiniteNumber(model.chargeCurrent)
    && isFiniteNumber(model.chargeMaximum)
    && model.chargeMaximum > 0
  )
    ? formatResourcePair(model.chargeCurrent, model.chargeMaximum).combined.replace(" / ", "/")
    : "—";
  return (
    <div className="ec-meter">
      <span className="ec-meter-label">Charge</span>
      <div
        aria-label={isFiniteNumber(model.chargeFraction) ? `${percent}% electric charge remaining` : "Electric charge unavailable"}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={isFiniteNumber(model.chargeFraction) ? percent : undefined}
        className="ec-meter-track"
        role="meter"
      >
        <span
          className={`ec-charge-fill ${severity}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="ec-meter-value">{amount}</span>
    </div>
  );
}

function GenerationMeter({ model }: { model: ElectricityViewModel }) {
  const generation = model.generationEcPerSec ?? 0;
  const scale = Math.max(generation, model.drawEcPerSec ?? 0, 0.01);
  const marker = isFiniteNumber(model.drawEcPerSec)
    ? Math.max(0, Math.min(100, model.drawEcPerSec / scale * 100))
    : undefined;
  const netClass = isFiniteNumber(model.netEcPerSec)
    ? model.netEcPerSec < -0.05 ? "danger" : model.netEcPerSec > 0.05 ? "ok" : ""
    : "unknown";
  const netLabel = isFiniteNumber(model.netEcPerSec)
    ? `${model.netEcPerSec > 0.05 ? "+" : ""}${formatRateColumn(model.netEcPerSec, "net")}`
    : model.flowState === "calibrating" ? "calibrating" : "—";
  return (
    <div className="ec-meter ec-generation-meter">
      <span className="ec-meter-label">Gen</span>
      <div className={`ec-meter-track ${netClass === "danger" ? "deficit" : ""}`}>
        <span className="ec-generation-segments">
          {model.sources.map((source) => {
            const width = Math.max(0, (source.outputEcPerSec ?? 0) / scale * 100);
            return width > 0
              ? <span className={`ec-source-fill ${source.kind}`} key={source.kind} style={{ width: `${width}%` }} />
              : null;
          })}
        </span>
        {isFiniteNumber(marker) && <span className="ec-draw-marker" style={{ left: `calc(${marker}% - 1px)` }} />}
      </div>
      <span className={`ec-meter-value ${netClass}`}>{netLabel}</span>
    </div>
  );
}

function SourceLedger({
  generation,
  hidden,
  ledgerRef,
  onOpenReactors,
  reactorButtonRef,
  sources,
}: {
  generation: number | undefined;
  hidden: boolean;
  ledgerRef: RefObject<HTMLDivElement | null>;
  onOpenReactors?: () => void;
  reactorButtonRef?: RefObject<HTMLButtonElement | null>;
  sources: ElectricitySourceViewModel[];
}) {
  return (
    <div className="ec-source-ledger" aria-label="Electricity generation by source" hidden={hidden} ref={ledgerRef}>
      {sources.map((source) => {
        const idle = !isFiniteNumber(source.outputEcPerSec) || source.outputEcPerSec <= 0.05;
        const share = (
          isFiniteNumber(generation)
          && generation > 0
          && isFiniteNumber(source.outputEcPerSec)
          && source.outputEcPerSec > 0
        ) ? formatPercent(source.outputEcPerSec / generation * 100) : "—";
        const content = <>
            <span className={`ec-source-chip ${source.kind}`} />
            <span className="ec-source-copy">
              <strong>{source.label}</strong>
              <small>{sourceDetail(source)}</small>
            </span>
            <span className="ec-source-output">
              <SourceRate value={source.outputEcPerSec} />
              <small>{share}</small>
            </span>
          </>;
        return source.kind === "reactor" && onOpenReactors ? (
          <button
            aria-label="Open reactor detail"
            className={`ec-source-row ec-source-button ${idle ? "idle" : ""}`}
            key={source.kind}
            onClick={onOpenReactors}
            ref={reactorButtonRef}
            type="button"
          >
            {content}
            <span aria-hidden="true" className="ec-source-drill">›</span>
          </button>
        ) : (
          <div className={`ec-source-row ${idle ? "idle" : ""}`} key={source.kind}>
            {content}
            <span aria-hidden="true" className="ec-source-drill placeholder">›</span>
          </div>
        );
      })}
    </div>
  );
}

function ReactorDetail({
  commandEnabled,
  controlResult,
  detailOpen,
  onSendCommand,
  onClose,
  closeButtonRef,
  reactors,
  vesselGuid,
  warning,
}: {
  commandEnabled: boolean;
  controlResult?: ReactorControlResult;
  detailOpen: boolean;
  onSendCommand?: (command: TelemetryCommand) => boolean;
  onClose: () => void;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  reactors: ReactorTelemetry[];
  vesselGuid?: string;
  warning: boolean;
}) {
  const [pending, setPending] = useState<{
    action: ReactorControlAction;
    index: number;
    requestId: string;
  } | null>(null);
  const [lastRequestId, setLastRequestId] = useState<string>();
  const [localError, setLocalError] = useState<string>();

  useEffect(() => {
    if (!pending) return;
    const reactor = reactors.find((candidate) => candidate.index === pending.index);
    if (reactor && reactor.controlAction !== pending.action) setPending(null);
  }, [pending, reactors]);

  useEffect(() => {
    if (pending && controlResult?.requestId === pending.requestId && controlResult.status === "error") {
      setPending(null);
    }
  }, [controlResult, pending]);

  const result = controlResult?.requestId === lastRequestId ? controlResult : undefined;

  useEffect(() => {
    if (!localError && !result) return;
    const visibleRequestId = lastRequestId;
    const timer = window.setTimeout(() => {
      setLocalError(undefined);
      setLastRequestId((current) => current === visibleRequestId ? undefined : current);
    }, REACTOR_CONTROL_MESSAGE_MS);
    return () => window.clearTimeout(timer);
  }, [lastRequestId, localError, result]);

  if (reactors.length === 0) return null;
  const sendControl = (reactor: ReactorTelemetry, action: ReactorControlAction) => {
    if (
      pending
      || !commandEnabled
      || !onSendCommand
      || !Number.isSafeInteger(reactor.index)
      || !Number.isSafeInteger(reactor.partId)
      || !vesselGuid
    ) return;
    const requestId = `reactor-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const sent = onSendCommand({
      type: "reactor.control",
      requestId,
      index: reactor.index!,
      action,
      expectedName: reactor.name,
      expectedFamily: reactor.family ?? "fission",
      expectedPartId: reactor.partId!,
      expectedVesselGuid: vesselGuid,
    });
    setLastRequestId(requestId);
    if (sent) {
      setPending({ action, index: reactor.index!, requestId });
      setLocalError(undefined);
    } else {
      setLocalError("Reactor command was not sent because the telemetry link is unavailable.");
    }
  };
  return (
    <section aria-label="Reactor detail" className={`rx-detail-view ${warning ? "warn" : ""}`} hidden={!detailOpen}>
      <button
        aria-label="Back to power sources"
        className="rx-detail-back"
        onClick={onClose}
        ref={closeButtonRef}
        type="button"
      >
        <span aria-hidden="true">‹</span>
        <span>Reactors</span>
        <span>{reactors.length}</span>
      </button>
      <div aria-label="Reactor list" className="rx-scroll" role="region" tabIndex={0}><div className="rx-list">{reactors.map((reactor, index) => {
        const isFusion = reactor.family === "fusion";
        const hasIntegrity = reactor.hasIntegrity !== false;
        const tempWarn = (
          isFiniteNumber(reactor.coreTemp)
          && isFiniteNumber(reactor.nominalTemp)
          && reactor.coreTemp > reactor.nominalTemp * 1.05
        );
        const integrityWarn = hasIntegrity && isFiniteNumber(reactor.integrity) && reactor.integrity < 90;
        const fuelKind = reactor.fuelKind ?? (isFusion ? "rate" : "life");
        const stateLabel = reactor.chargeState === "charging"
          ? "Charging"
          : reactor.chargeState === "ready"
            ? "Ready"
            : reactor.on
              ? "On"
              : "Off";
        const action = reactor.controlAction;
        const actionTitle = action === "stop"
          ? `Shut down ${reactor.name}`
          : action === "start"
            ? `Start ${reactor.name}`
            : action === "stop_charging"
              ? `Pause startup charging for ${reactor.name}`
              : `Begin startup charging for ${reactor.name}`;
        const stateClass = reactor.on
          ? "on"
          : reactor.chargeState === "charging"
            ? "charging"
            : reactor.chargeState === "ready"
              ? "ready"
              : "off";
        const canControl = Boolean(
          commandEnabled
          && onSendCommand
          && vesselGuid
          && reactor.controlAvailable
          && action
          && Number.isSafeInteger(reactor.index)
          && Number.isSafeInteger(reactor.partId),
        );
        const isPending = pending?.index === reactor.index;
        const fuelTitle = [
          reactor.fuelLimitingResource ? `${reactor.fuelLimitingResource} limiting` : "",
          reactor.fuelRate ?? "",
        ].filter(Boolean).join(" · ") || reactor.fuel;
        return (
          <div className="rx-card" key={`${reactor.name}-${index}`}>
            <div className="rx-head">
              <span className="rx-name" title={reactor.name}>{reactor.name || "Unnamed reactor"}</span>
              {canControl ? (
                <button
                  aria-label={actionTitle}
                  className={`rx-state control ${stateClass} ${isPending ? "pending" : ""}`}
                  disabled={Boolean(pending)}
                  onClick={() => sendControl(reactor, action!)}
                  title={actionTitle}
                  type="button"
                >{isPending ? "Applying" : stateLabel}</button>
              ) : (
                <span className={`rx-state ${stateClass}`}>{stateLabel}</span>
              )}
            </div>
            {reactor.chargeState === "charging" && isFiniteNumber(reactor.chargePercent) && (
              <div className="rx-charge-row">
                <span>Startup charge</span>
                <div
                  aria-label={`${formatTelemetryNumber(reactor.chargePercent)}% startup charge`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={reactor.chargePercent}
                  className="rx-charge-track"
                  role="progressbar"
                >
                  <span className="rx-charge-fill" style={{ width: `${Math.max(0, Math.min(100, reactor.chargePercent))}%` }} />
                </div>
                <strong>{formatTelemetryNumber(reactor.chargePercent)}%</strong>
              </div>
            )}
            <div className="rx-stats">
              <div className="rx-stat"><label>Output</label><span className="rv">{ecRate(reactor.ecPerSec)}</span></div>
              <div className="rx-stat"><label>Core</label><span className={`rv ${tempWarn ? "warn" : ""}`}>{formatTemperature(reactor.coreTemp, true)}</span></div>
              {hasIntegrity ? (
                <div className="rx-stat"><label>Integrity</label><span className={`rv ${integrityWarn ? "warn" : ""}`}>{formatPercent(reactor.integrity)}</span></div>
              ) : (
                <div className="rx-stat"><label>Throttle</label><span className="rv">{throttlePercent(reactor.throttle)}</span></div>
              )}
              <div className="rx-stat"><label>{fuelKind === "rate" ? "Fuel rate" : "Life"}</label><span className="rv" title={fuelTitle}>{reactor.fuel?.trim() || "—"}</span></div>
            </div>
          </div>
        );
      })}</div></div>
      {(localError || result) && (
        <div className={`rx-command-result ${localError || result?.status === "error" ? "error" : "accepted"}`} role="status">
          {localError ?? result?.message}
        </div>
      )}
    </section>
  );
}

export function ElectricityPanel({
  commandEnabled = false,
  controlResult,
  onSendCommand,
  snapshot,
}: {
  commandEnabled?: boolean;
  controlResult?: ReactorControlResult;
  onSendCommand?: (command: TelemetryCommand) => boolean;
  snapshot: TelemetrySnapshot;
}) {
  const model = selectElectricity(snapshot);
  const [reactorDetailOpen, setReactorDetailOpen] = useState(false);
  const [sourceSlotHeight, setSourceSlotHeight] = useState<number>();
  const reactorButtonRef = useRef<HTMLButtonElement>(null);
  const reactorBackRef = useRef<HTMLButtonElement>(null);
  const sourceLedgerRef = useRef<HTMLDivElement>(null);
  const reactorDetailWasOpenRef = useRef(false);
  useEffect(() => {
    if (model.reactors.length === 0 && reactorDetailOpen) setReactorDetailOpen(false);
  }, [model.reactors.length, reactorDetailOpen]);
  useEffect(() => {
    if (reactorDetailOpen) {
      reactorBackRef.current?.focus();
    } else if (reactorDetailWasOpenRef.current) {
      reactorButtonRef.current?.focus();
    }
    reactorDetailWasOpenRef.current = reactorDetailOpen;
  }, [reactorDetailOpen]);
  const openReactorDetail = () => {
    const height = sourceLedgerRef.current?.getBoundingClientRect().height;
    setSourceSlotHeight(height && height > 0 ? height : undefined);
    setReactorDetailOpen(true);
  };
  const closeReactorDetail = () => {
    setReactorDetailOpen(false);
    setSourceSlotHeight(undefined);
  };
  const deficit = isFiniteNumber(model.netEcPerSec) && model.netEcPerSec < -0.05;
  const heroLabel = model.tier === 1
    ? "Stored charge"
    : model.tier === 2
      ? `${model.primarySource?.label ?? "Source"} output`
      : "Total generation";
  const heroValue = model.tier === 1
    ? (
      isFiniteNumber(model.chargeCurrent)
        ? `${formatResourcePair(model.chargeCurrent, model.chargeMaximum).value} EC`
        : "—"
    )
    : ecRate(model.generationEcPerSec);
  const chargePercent = isFiniteNumber(model.chargeCurrent) && isFiniteNumber(model.chargeMaximum) && model.chargeMaximum > 0
    ? Math.round(Math.max(0, Math.min(1, model.chargeCurrent / model.chargeMaximum)) * 100)
    : undefined;
  const railStatus = `${chargePercent === undefined ? "EC" : `${chargePercent}%`} · ${model.status.label}`;

  return (
    <Panel collapsible compact id="elec" tag={railStatus} title="Electricity">
      <div className={`ec-overview-card ${deficit || model.tier === 1 ? "warn" : ""}`}>
        <div className="ec-hero-row">
          <div>
            <span className="ec-label">{heroLabel}</span>
            <strong className={`ec-hero ${model.tier === 1 ? "stored" : ""}`}>{heroValue}</strong>
          </div>
          <div className="ec-status">
            <span className="ec-label">{model.tier === 1 ? "Generation" : model.reactors.length > 0 ? "Reactor condition" : "Condition"}</span>
            <strong className={model.status.tone}>{model.status.label}</strong>
            <small>{model.status.detail}</small>
          </div>
        </div>
        {model.tier > 1 && <GenerationMeter model={model} />}
        <ChargeMeter model={model} />
        <div className="ec-flow-caption">
          <span>{isFiniteNumber(model.drawEcPerSec) ? `draw ${ecRate(model.drawEcPerSec)}` : "draw unavailable"}</span>
          <span className={model.etaKind === "empty" ? "danger" : ""}>{etaLabel(model)}</span>
        </div>
      </div>
      {(model.tier === 3 || model.reactors.length > 0) && (
        <div className="ec-source-slot" style={sourceSlotHeight ? { height: `${sourceSlotHeight}px` } : undefined}>
          <SourceLedger
            generation={model.generationEcPerSec}
            hidden={reactorDetailOpen}
            ledgerRef={sourceLedgerRef}
            onOpenReactors={model.reactors.length > 0 ? openReactorDetail : undefined}
            reactorButtonRef={reactorButtonRef}
            sources={model.sources}
          />
          <ReactorDetail
            closeButtonRef={reactorBackRef}
            commandEnabled={commandEnabled}
            controlResult={controlResult}
            detailOpen={reactorDetailOpen}
            onClose={closeReactorDetail}
            onSendCommand={onSendCommand}
            reactors={model.reactors}
            vesselGuid={snapshot["v.guid"]}
            warning={model.status.tone === "danger"}
          />
        </div>
      )}
    </Panel>
  );
}
