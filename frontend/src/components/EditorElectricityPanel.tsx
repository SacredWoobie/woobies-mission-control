import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { formatDistance } from "../formatting/numbers";
import { calculateElectricityPlan, effectiveComponentRate, findPlannerBody } from "../electricityPlanner/model";
import { applyElectricityPlannerRoleInclusion, reconcileElectricityPlannerSession, type ElectricityPlannerSession } from "../electricityPlanner/state";
import type { EditorElectricityComponentTelemetry, TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";

function number(value: number | undefined, digits = 2) {
  return value === undefined ? "Unavailable" : value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function signedRate(value: number | undefined) {
  if (value === undefined) return "Unavailable";
  return `${value > 0 ? "+" : ""}${number(value)} EC/s`;
}

/** Deliberately compact for the planner's at-a-glance operational readouts. */
function duration(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "Unavailable";
  const seconds = Math.max(0, Math.round(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

function groupedComponents(components: readonly EditorElectricityComponentTelemetry[]) {
  const rows = new Map<string, EditorElectricityComponentTelemetry[]>();
  for (const component of components) {
    const row = rows.get(component.category) ?? [];
    row.push(component);
    rows.set(component.category, row);
  }
  return [...rows.entries()];
}

function Meter({ current, maximum }: { current?: number; maximum?: number }) {
  const known = current !== undefined && maximum !== undefined && maximum > 0;
  return <meter
    aria-label={known ? `Battery charge ${number(current, 0)} of ${number(maximum, 0)} EC` : "Battery charge unavailable"}
    className="editor-electricity-battery-meter"
    max={known ? maximum : undefined}
    min={known ? 0 : undefined}
    value={known ? Math.min(Math.max(current ?? 0, 0), maximum ?? 1) : undefined}
  />;
}

function RateBar({ label, rate, scale }: { label: string; rate: number | undefined; scale: number | undefined }) {
  const percent = rate === undefined || scale === undefined || scale <= 0 ? 0 : Math.min(100, (rate / scale) * 100);
  return <div className="editor-electricity-rate-bar" style={{ "--electricity-rate-percent": `${percent}%` } as CSSProperties}>
    <span>{label}</span><strong>{number(rate)} EC/s</strong><i aria-hidden="true" />
  </div>;
}

function ShadowAssessment({ plan }: { plan: ReturnType<typeof calculateElectricityPlan> }) {
  const holds = plan.nextEclipseHolds;
  const outcome = holds === undefined ? "Shadow assessment unavailable"
    : holds ? "HOLDS — Current reported charge survives the next longest eclipse."
      : `DOES NOT HOLD — Battery runs out ${duration(plan.darkBeforeSunlightSeconds)} before sunlight.`;
  const endurance = plan.shadowNetEcPerSec === undefined ? "Unavailable"
    : plan.shadowNetEcPerSec >= 0 ? "No depletion in shadow"
      : duration(plan.nextEclipseShadowEnduranceSeconds);
  return <section className="editor-electricity-shadow-assessment" aria-label="Shadow assessment">
    <h3>Shadow assessment</h3>
    <p><strong>{outcome}</strong></p>
    <dl>
      <div><dt>Net without solar</dt><dd>{signedRate(plan.shadowNetEcPerSec)}</dd></div>
      <div><dt>Shadow endurance</dt><dd>{endurance}</dd></div>
      {holds === false && <div><dt>Dark before sunlight</dt><dd>{duration(plan.darkBeforeSunlightSeconds)}</dd></div>}
      {holds !== true && <div><dt>Required for eclipse</dt><dd>{number(plan.eclipseRequiredEc, 0)} EC</dd></div>}
    </dl>
  </section>;
}

export function EditorElectricityPanel({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const [session, setSession] = useState<ElectricityPlannerSession>();
  const components = snapshot["editor.elec.components"] ?? [];
  const status = snapshot["editor.elec.status"];
  const pending = snapshot["editor.elec.pending"] === true;

  useEffect(() => setSession((current) => reconcileElectricityPlannerSession(current, snapshot)), [snapshot]);

  const scenario = session?.scenario;
  const plannerScenario = scenario ?? { bodyName: snapshot["editor.body"] };
  const body = findPlannerBody(snapshot["editor.elec.bodies"], plannerScenario.bodyName);
  const plan = useMemo(() => calculateElectricityPlan({
    components, included: session?.includedByStableId ?? {}, currentEc: snapshot["editor.elec.currentEc"],
    maxEc: snapshot["editor.elec.maxEc"], body, scenario: plannerScenario,
  }), [body, components, plannerScenario, session?.includedByStableId, snapshot]);
  const unavailable = status === "unavailable";
  const retained = snapshot["editor.elec.retained"] === true;
  const incomplete = components.some((component) => !component.valueKnown);
  const scale = plan.generationEcPerSec === undefined || plan.drawEcPerSec === undefined
    ? undefined : Math.max(plan.generationEcPerSec, plan.drawEcPerSec);
  const full = snapshot["editor.elec.currentEc"] !== undefined && snapshot["editor.elec.maxEc"] !== undefined
    && snapshot["editor.elec.currentEc"] >= snapshot["editor.elec.maxEc"];
  const chargeCopy = full ? "Fully charged"
    : plan.netEcPerSec === undefined ? "Charge outlook unavailable"
      : plan.netEcPerSec < 0 ? `Depletes in ${duration(plan.batteryEnduranceSeconds)}`
        : plan.netEcPerSec > 0 ? `Recharges in ${duration(plan.rechargeSeconds)}`
          : "No depletion or recharge";
  const verdict = plan.netEcPerSec === undefined ? "Electrical balance unavailable"
    : plan.netEcPerSec < 0 ? "Power deficit" : plan.netEcPerSec > 0 ? "Charging" : "Balanced";

  const setScenario = (change: Partial<NonNullable<ElectricityPlannerSession["scenario"]>>) => {
    setSession((current) => current ? { ...current, scenario: { ...current.scenario, ...change } } : current);
  };
  const toggleComponent = (component: EditorElectricityComponentTelemetry) => {
    setSession((current) => {
      if (!current) return current;
      const included = current.includedByStableId[component.stableId] ?? component.defaultIncluded;
      return { ...current, includedByStableId: { ...current.includedByStableId, [component.stableId]: !included } };
    });
  };
  const setRole = (role: "producer" | "consumer", inclusion: "all" | "none") => {
    setSession((current) => current ? applyElectricityPlannerRoleInclusion(current, components, role, inclusion) : current);
  };

  return <Panel id="editorElectricity" className="editor-electricity-panel" title="Electricity planner" tag="EDITOR ONLY · READ-ONLY">
    {status === undefined ? <p className="editor-electricity-state">Awaiting editor electricity planner telemetry…</p>
      : pending || status === "warming" ? <p className="editor-electricity-state wait">Reading craft electrical modules… retained values are not assumed current.</p>
        : unavailable ? <p className="editor-electricity-state bad">Electricity analysis is unavailable. Install the updated control service and reopen the editor.</p>
          : status === "empty" ? <p className="editor-electricity-state">No electrical producers or consumers were reported for this craft.</p>
            : <>
              {(status === "degraded" || retained || incomplete) && <p className="editor-electricity-state wait">{status === "degraded" ? snapshot["editor.elec.degradedReason"] || "Stock fallback is incomplete." : retained ? "Retained analysis; waiting for the current craft." : "Some component output is unknown; totals remain conservative."}</p>}
              <div className="editor-electricity-planner-zones">
                <section className="editor-electricity-scenario-rail" aria-label="Electricity planner scenario">
                  <h3>Scenario</h3>
                  <label className="editor-electricity-body-control">Body<select aria-label="Electricity planner body" onChange={(event) => {
                    const selectedBody = findPlannerBody(snapshot["editor.elec.bodies"], event.target.value);
                    setScenario({ bodyName: event.target.value, solarScale: selectedBody?.solarEfficiency });
                  }} value={plannerScenario.bodyName ?? ""}>{(snapshot["editor.elec.bodies"] ?? []).map((candidate) => <option key={candidate.bodyName} value={candidate.bodyName}>{candidate.bodyName}</option>)}</select></label>
                  <label className="editor-electricity-altitude-control">Orbit altitude <span className="editor-electricity-input-unit"><input aria-label="Electricity planner orbital altitude (km)" min={0} onChange={(event) => setScenario({ altitudeMeters: event.target.value === "" ? undefined : Number(event.target.value) * 1000 })} step={1} type="number" value={plannerScenario.altitudeMeters === undefined ? "" : plannerScenario.altitudeMeters / 1000} /><small>km ASL</small></span></label>
                  <dl className="editor-electricity-scenario-derived"><div><dt>Body-to-star distance</dt><dd>{formatDistance(body?.solarDistance, "plan")}</dd></div><div><dt>Orbit period</dt><dd>{duration(plan.orbitPeriodSeconds)}</dd></div><div><dt>Longest eclipse</dt><dd>{duration(plan.eclipseDurationSeconds)}</dd></div><div><dt>Solar efficiency</dt><dd>{plan.solarScaleAssumption === undefined ? "Unavailable" : `${number(plan.solarScaleAssumption * 100, 1)}%`}</dd></div></dl>
                </section>
                <section className="editor-electricity-readout-well" aria-label="Electrical plan readout">
                  <h3>Electrical plan</h3>
                  <p className="editor-electricity-net-headline"><strong>{signedRate(plan.netEcPerSec)}</strong><span>{verdict}</span></p>
                  <p className="editor-electricity-charge-copy">{chargeCopy}</p>
                  <div className="editor-electricity-rate-bars" aria-label="Generation and consumption compared on a shared scale"><RateBar label="Generated" rate={plan.generationEcPerSec} scale={scale} /><RateBar label="Consumed" rate={plan.drawEcPerSec} scale={scale} /></div>
                  <div className="editor-electricity-storage"><span>Battery</span><Meter current={snapshot["editor.elec.currentEc"]} maximum={snapshot["editor.elec.maxEc"]} /><strong>{number(snapshot["editor.elec.currentEc"], 0)} / {number(snapshot["editor.elec.maxEc"], 0)} EC</strong></div>
                  <ShadowAssessment plan={plan} />
                  <p className="editor-electricity-recurring-orbit">Recurring orbit: <strong>{plan.recurringOrbitSustainable === undefined ? "Unavailable" : plan.recurringOrbitSustainable ? "Sustainable" : "Deficit"}</strong></p>
                </section>
              </div>
              <div className="editor-electricity-ledgers" aria-label="Electrical producer and consumer ledgers">
                <PowerLedger components={components.filter((component) => component.role === "producer")} included={session?.includedByStableId ?? {}} label="Power generated" onSetRole={setRole} onToggle={toggleComponent} scenario={plannerScenario} />
                <PowerLedger components={components.filter((component) => component.role === "consumer")} included={session?.includedByStableId ?? {}} label="Power consumed" onSetRole={setRole} onToggle={toggleComponent} scenario={plannerScenario} />
              </div>
              <p className="editor-electricity-assumption editor-electricity-assumption-note">Conservative maximum central eclipse · circular orbit. This planner is session-only and never changes KSP or module state.</p>
            </>}
  </Panel>;
}

function PowerLedger({ components, included, label, onSetRole, onToggle, scenario }: {
  components: readonly EditorElectricityComponentTelemetry[]; included: Readonly<Record<string, boolean>>; label: string;
  onSetRole(role: "producer" | "consumer", inclusion: "all" | "none"): void; onToggle(component: EditorElectricityComponentTelemetry): void;
  scenario: ElectricityPlannerSession["scenario"];
}) {
  const role = components[0]?.role ?? (label === "Power generated" ? "producer" : "consumer");
  const enabled = components.filter((component) => included[component.stableId] ?? component.defaultIncluded).length;
  return <section className="editor-electricity-ledger" aria-label={label}>
    <header><div><h3>{label}</h3><p>{enabled} enabled / {components.length} total</p></div><div className="editor-electricity-ledger-actions" role="group" aria-label={`${label} inclusion controls`}><button onClick={() => onSetRole(role, "all")} type="button">All</button><button onClick={() => onSetRole(role, "none")} type="button">None</button></div></header>
    {components.length === 0 ? <p>No components reported.</p> : groupedComponents(components).map(([category, categoryComponents]) => <section className="editor-electricity-ledger-group" key={category}><h4>{category}</h4><ul>{categoryComponents.map((component) => {
      const checked = included[component.stableId] ?? component.defaultIncluded;
      const rate = effectiveComponentRate(component, scenario);
      return <li className="editor-electricity-component" key={component.stableId}><label><input checked={checked} onChange={() => onToggle(component)} type="checkbox" /><span><strong>{component.partTitle}</strong><small>{component.moduleName}</small></span><output>{rate === undefined ? "Rate unavailable" : `${number(rate)} EC/s`}</output></label></li>;
    })}</ul></section>)}</section>;
}
