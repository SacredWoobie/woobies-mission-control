import { formatRate, isFiniteNumber } from "../telemetry/formatters";
import type { ReactorTelemetry, TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";

function ecRate(value: number | undefined) { return formatRate(value, "EC/s"); }

function reactorCondition(reactors: ReactorTelemetry[]) {
  let hot = 0;
  let damaged = 0;
  let readable = 0;
  let maximumRatio = 0;
  reactors.forEach((reactor) => {
    if (isFiniteNumber(reactor.coreTemp) && isFiniteNumber(reactor.nominalTemp) && reactor.nominalTemp > 0) {
      const ratio = reactor.coreTemp / reactor.nominalTemp;
      readable += 1;
      maximumRatio = Math.max(maximumRatio, ratio);
      if (ratio > 1.05) hot += 1;
    }
    if (isFiniteNumber(reactor.integrity) && reactor.integrity < 90) damaged += 1;
  });
  if (hot || damaged) return { className: "warn", label: hot && damaged ? `${hot + damaged} ALERTS` : hot ? (hot === 1 ? "HIGH TEMP" : `${hot} HIGH TEMP`) : (damaged === 1 ? "DAMAGED" : `${damaged} DAMAGED`), sub: [hot ? `${hot} above temp band` : "", damaged ? `${damaged} below 90% integrity` : ""].filter(Boolean).join(" · ") };
  if (readable === reactors.length) return { className: "ok", label: "NOMINAL", sub: `max ${Math.round(maximumRatio * 100)}% nominal temp` };
  return { className: "unknown", label: "UNKNOWN", sub: readable ? `${readable} of ${reactors.length} temperatures available` : "temperature unavailable" };
}

export function ElectricityPanel({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const reactors = snapshot["elec.reactors"];
  const confirmedReactors = reactors ?? [];
  const online = confirmedReactors.filter((reactor) => reactor.on).length;
  const output = confirmedReactors.reduce((sum, reactor) => sum + (reactor.ecPerSec ?? 0), 0);
  const capacity = confirmedReactors.reduce((sum, reactor) => sum + (reactor.ecMax ?? 0), 0);
  const condition = reactorCondition(confirmedReactors);
  const hasSolar = (snapshot["solar.count"] ?? 0) > 0;
  const hasRtg = (snapshot["rtg.count"] ?? 0) > 0;
  const hasOther = (snapshot["elec.otherEcPerSec"] ?? 0) > .05;
  const hasSources = hasSolar || hasRtg || hasOther;

  return (
    <Panel hideable id="elec" title="Electricity" tag="By source">
      {isFiniteNumber(snapshot["elec.totalGenEcPerSec"]) && <div className="heat-strip ec-total-strip"><div className="cs-cell"><span className="label">Total generation</span><span className="cs-val">{ecRate(snapshot["elec.totalGenEcPerSec"])}</span></div></div>}
      {confirmedReactors.length > 0 ? <>
        <div className="rx-summary">
          <div className="cs-cell"><span className="label">Reactors</span><span className="cs-val">{confirmedReactors.length} aboard</span><span className="rx-summary-sub">{online} online</span></div>
          <div className="cs-cell"><span className="label">Reactor output</span><span className="cs-val">{ecRate(output)}</span><span className="rx-summary-sub">{capacity > 0 ? `max ${ecRate(capacity)}` : "capacity unavailable"}</span></div>
          <div className="cs-cell"><span className="label">Condition</span><span className={`cs-val rx-condition ${condition.className}`}>{condition.label}</span><span className="rx-summary-sub">{condition.sub}</span></div>
        </div>
        <details className={`rx-details ${condition.className === "warn" ? "warn" : ""}`}>
          <summary><span>Reactor detail</span><span>{confirmedReactors.length}</span></summary>
          <div className="rx-scroll"><div className="rx-list">{confirmedReactors.map((reactor, index) => {
            const tempWarn = isFiniteNumber(reactor.coreTemp) && isFiniteNumber(reactor.nominalTemp) && reactor.coreTemp > reactor.nominalTemp * 1.05;
            const integrityWarn = isFiniteNumber(reactor.integrity) && reactor.integrity < 90;
            return <div className="rx-card" key={`${reactor.name}-${index}`}><div className="rx-head"><span className="rx-name" title={reactor.name}>{reactor.name || "Unnamed reactor"}</span><span className={`rx-state ${reactor.on ? "on" : "off"}`}>{reactor.on ? "On" : "Off"}</span></div><div className="rx-stats"><div className="rx-stat"><label>Output</label><span className="rv">{ecRate(reactor.ecPerSec)}</span></div><div className="rx-stat"><label>Core</label><span className={`rv ${tempWarn ? "warn" : ""}`}>{isFiniteNumber(reactor.coreTemp) ? `${Math.round(reactor.coreTemp)} K` : "—"}</span></div><div className="rx-stat"><label>Integrity</label><span className={`rv ${integrityWarn ? "warn" : ""}`}>{isFiniteNumber(reactor.integrity) ? `${reactor.integrity}%` : "—"}</span></div><div className="rx-stat"><label>Life</label><span className="rv" title={reactor.fuel}>{reactor.fuel?.trim() || "—"}</span></div></div></div>;
          })}</div></div>
        </details>
      </> : reactors && <div className="rx-empty">No reactors aboard</div>}
      {hasSources && <div className="solar-strip">
        {hasSolar && <><div className="cs-cell"><span className="label">Solar output</span><span className="cs-val">{ecRate(snapshot["solar.outputEcPerSec"])}</span></div><div className="cs-cell"><span className="label">Solar efficiency</span><span className="cs-val">{isFiniteNumber(snapshot["solar.efficiency"]) ? `${Math.round(snapshot["solar.efficiency"] * 100)}%` : "—"}</span></div></>}
        {hasRtg && <div className="cs-cell"><span className="label">RTG output</span><span className="cs-val">{ecRate(snapshot["rtg.outputEcPerSec"])}</span></div>}
        {hasOther && <div className="cs-cell"><span className="label">All other</span><span className="cs-val">{ecRate(snapshot["elec.otherEcPerSec"])}</span></div>}
      </div>}
    </Panel>
  );
}
