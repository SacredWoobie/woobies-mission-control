import {
  formatPercent,
  formatRateColumn,
  formatResourcePair,
  formatTemperature,
  formatTelemetryNumber,
  isFiniteNumber,
} from "../formatting/numbers";
import type { ReactorTelemetry, TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";
import { resourceSeverity } from "./resourceMeter";
import {
  selectElectricity,
  type ElectricitySourceViewModel,
  type ElectricityViewModel,
} from "./electricityModel";

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
  sources,
}: {
  generation: number | undefined;
  sources: ElectricitySourceViewModel[];
}) {
  return (
    <div className="ec-source-ledger" aria-label="Electricity generation by source">
      {sources.map((source) => {
        const idle = !isFiniteNumber(source.outputEcPerSec) || source.outputEcPerSec <= 0.05;
        const share = (
          isFiniteNumber(generation)
          && generation > 0
          && isFiniteNumber(source.outputEcPerSec)
          && source.outputEcPerSec > 0
        ) ? formatPercent(source.outputEcPerSec / generation * 100) : "—";
        return (
          <div className={`ec-source-row ${idle ? "idle" : ""}`} key={source.kind}>
            <span className={`ec-source-chip ${source.kind}`} />
            <span className="ec-source-copy">
              <strong>{source.label}</strong>
              <small>{sourceDetail(source)}</small>
            </span>
            <span className="ec-source-output">
              <strong>{ecRate(source.outputEcPerSec)}</strong>
              <small>{share}</small>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ReactorDetail({
  reactors,
  warning,
}: {
  reactors: ReactorTelemetry[];
  warning: boolean;
}) {
  if (reactors.length === 0) return null;
  return (
    <details className={`rx-details ${warning ? "warn" : ""}`}>
      <summary><span>Reactor detail</span><span>{reactors.length}</span></summary>
      <div className="rx-scroll"><div className="rx-list">{reactors.map((reactor, index) => {
        const isFusion = reactor.family === "fusion";
        const hasIntegrity = reactor.hasIntegrity !== false;
        const tempWarn = (
          isFiniteNumber(reactor.coreTemp)
          && isFiniteNumber(reactor.nominalTemp)
          && reactor.coreTemp > reactor.nominalTemp * 1.05
        );
        const integrityWarn = hasIntegrity && isFiniteNumber(reactor.integrity) && reactor.integrity < 90;
        const fuelKind = reactor.fuelKind ?? (isFusion ? "rate" : "life");
        const fuelTitle = [
          reactor.fuelLimitingResource ? `${reactor.fuelLimitingResource} limiting` : "",
          reactor.fuelRate ?? "",
        ].filter(Boolean).join(" · ") || reactor.fuel;
        return (
          <div className="rx-card" key={`${reactor.name}-${index}`}>
            <div className="rx-head">
              <span className="rx-name" title={reactor.name}>{reactor.name || "Unnamed reactor"}</span>
              <span className={`rx-state ${reactor.on ? "on" : "off"}`}>{reactor.on ? "On" : "Off"}</span>
            </div>
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
    </details>
  );
}

export function ElectricityPanel({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const model = selectElectricity(snapshot);
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

  return (
    <Panel hideable id="elec" title="Electricity">
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
      {model.tier === 3 && (
        <SourceLedger generation={model.generationEcPerSec} sources={model.sources} />
      )}
      <ReactorDetail reactors={model.reactors} warning={model.status.tone === "danger"} />
    </Panel>
  );
}
