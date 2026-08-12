import { useEffect, useMemo, useState } from "react";
import { calculateElectricityPlan, findPlannerBody } from "../electricityPlanner/model";
import { applyElectricityPlannerPreset, reconcileElectricityPlannerSession, type ElectricityPlannerPreset, type ElectricityPlannerSession } from "../electricityPlanner/state";
import type { EditorElectricityComponentTelemetry, TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";

function number(value: number | undefined, digits = 2) {
  return value === undefined ? "Unavailable" : value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function duration(value: number | undefined) {
  if (value === undefined) return "Unavailable";
  if (value < 60) return `${number(value, 0)} s`;
  if (value < 3600) return `${number(value / 60, 1)} min`;
  return `${number(value / 3600, 1)} h`;
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

export function EditorElectricityPanel({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const [session, setSession] = useState<ElectricityPlannerSession>();
  const components = snapshot["editor.elec.components"] ?? [];
  const status = snapshot["editor.elec.status"];
  const pending = snapshot["editor.elec.pending"] === true;

  useEffect(() => {
    setSession((current) => reconcileElectricityPlannerSession(current, snapshot));
  }, [snapshot]);

  const scenario = session?.scenario;
  const plannerScenario = scenario ?? { bodyName: snapshot["editor.body"] };
  const body = findPlannerBody(snapshot["editor.elec.bodies"], plannerScenario.bodyName);
  const plan = useMemo(() => calculateElectricityPlan({
    components,
    included: session?.includedByStableId ?? {},
    currentEc: snapshot["editor.elec.currentEc"],
    maxEc: snapshot["editor.elec.maxEc"],
    body,
    scenario: plannerScenario,
  }), [body, components, plannerScenario, session?.includedByStableId, snapshot]);
  const unavailable = status === "unavailable";
  const retained = snapshot["editor.elec.retained"] === true;
  const incomplete = components.some((component) => !component.valueKnown);

  const preset = (value: ElectricityPlannerPreset) => {
    if (!session) return;
    setSession(applyElectricityPlannerPreset(session, components, value, snapshot));
  };
  const setScenario = (change: Partial<NonNullable<ElectricityPlannerSession["scenario"]>>) => {
    setSession((current) => current ? { ...current, scenario: { ...current.scenario, ...change } } : current);
  };
  const toggleComponent = (component: EditorElectricityComponentTelemetry) => {
    const included = session?.includedByStableId[component.stableId] ?? component.defaultIncluded;
    setSession((current) => current ? {
      ...current,
      includedByStableId: { ...current.includedByStableId, [component.stableId]: !included },
    } : current);
  };
  const depletion = plan.netEcPerSec !== undefined && plan.netEcPerSec >= 0
    ? "No depletion"
    : duration(plan.batteryEnduranceSeconds);

  return (
    <Panel id="editorElectricity" className="editor-electricity-panel" title="Electricity planner" tag="EDITOR ONLY · READ-ONLY">
      {status === undefined ? <p className="editor-electricity-state">Awaiting editor electricity planner telemetry…</p>
        : pending || status === "warming" ? <p className="editor-electricity-state wait">Reading craft electrical modules… retained values are not assumed current.</p>
        : unavailable ? <p className="editor-electricity-state bad">Electricity analysis is unavailable. Install the updated control service and reopen the editor.</p>
          : status === "empty" ? <p className="editor-electricity-state">No electrical producers or consumers were reported for this craft.</p>
            : (
              <>
                {(status === "degraded" || retained || incomplete) && <p className="editor-electricity-state wait">{status === "degraded" ? snapshot["editor.elec.degradedReason"] || "Stock fallback is incomplete." : retained ? "Retained analysis; waiting for the current craft." : "Some component output is unknown; totals remain conservative."}</p>}
                <div className="editor-electricity-metrics" aria-label="Electrical plan summary">
                  <Metric label="Generation" value={`${number(plan.generationEcPerSec)} EC/s`} />
                  <Metric label="Draw" value={`${number(plan.drawEcPerSec)} EC/s`} />
                  <Metric label="Net" value={`${number(plan.netEcPerSec)} EC/s`} tone={plan.netEcPerSec !== undefined && plan.netEcPerSec < 0 ? "bad" : "ok"} />
                  <Metric label="Storage" value={`${number(snapshot["editor.elec.currentEc"], 0)} / ${number(snapshot["editor.elec.maxEc"], 0)} EC`} />
                </div>
                <div className="editor-electricity-controls">
                  <label>Body<select aria-label="Electricity planner body" onChange={(event) => {
                    const selectedBody = findPlannerBody(snapshot["editor.elec.bodies"], event.target.value);
                    setScenario({ bodyName: event.target.value, solarScale: selectedBody?.solarEfficiency });
                  }} value={plannerScenario.bodyName ?? ""}>{(snapshot["editor.elec.bodies"] ?? []).map((candidate) => <option key={candidate.bodyName} value={candidate.bodyName}>{candidate.bodyName}</option>)}</select></label>
                  <label>Orbit altitude<input aria-label="Electricity planner orbital altitude (m)" min={0} onChange={(event) => setScenario({ altitudeMeters: event.target.value === "" ? undefined : Number(event.target.value) })} step={1000} type="number" value={plannerScenario.altitudeMeters ?? ""} /><small>m ASL</small></label>
                  <div className="editor-electricity-presets" aria-label="Planner presets" role="group">
                    <button onClick={() => preset("backend-defaults")} type="button">Backend defaults</button><button onClick={() => preset("all-included")} type="button">All included</button><button onClick={() => preset("producers-off")} type="button">Producers off</button><button onClick={() => preset("reset")} type="button">Reset</button>
                  </div>
                </div>
                <div className="editor-electricity-operational" aria-label="Electrical endurance comparison">
                  <Metric label="Battery depletion" value={depletion} tone={plan.netEcPerSec !== undefined && plan.netEcPerSec < 0 ? "bad" : "ok"} />
                  <Metric label="Time in eclipse" value={duration(plan.eclipseDurationSeconds)} />
                  <Metric label="Solar efficiency" value={plan.solarScaleAssumption === undefined ? "Unavailable" : `${number(plan.solarScaleAssumption * 100, 1)}%`} />
                </div>
                <div className="editor-electricity-assessment">
                  <Metric label="Required EC" value={`${number(plan.eclipseRequiredEc, 0)} EC`} />
                  <Metric label="Eclipse margin" value={`${number(plan.eclipseMarginEc, 0)} EC`} tone={plan.eclipseMarginEc !== undefined && plan.eclipseMarginEc < 0 ? "bad" : "ok"} />
                  <Metric label="Recharge" value={duration(plan.rechargeSeconds)} />
                  <Metric label="Recurring orbit" value={plan.recurringOrbitSustainable === undefined ? "Unavailable" : plan.recurringOrbitSustainable ? "Sustainable" : "Deficit"} tone={plan.recurringOrbitSustainable === false ? "bad" : "ok"} />
                </div>
                <p className="editor-electricity-assumption">Conservative maximum central eclipse · circular orbit · solar output scaled to {plan.solarScaleAssumption === undefined ? "unknown illumination" : `${number(plan.solarScaleAssumption * 100, 1)}% efficiency at ${plannerScenario.bodyName ?? "the selected body"}`}. This planner never changes KSP or module state.</p>
                <div className="editor-electricity-ledgers" aria-label="Electrical producers and consumers">
                  <PowerLedger components={components.filter((component) => component.role === "producer")} included={session?.includedByStableId ?? {}} label="Power Generated" onToggle={toggleComponent} rate={plan.generationEcPerSec} />
                  <PowerLedger components={components.filter((component) => component.role === "consumer")} included={session?.includedByStableId ?? {}} label="Power Consumed" onToggle={toggleComponent} rate={plan.drawEcPerSec} />
                </div>
              </>
            )}
    </Panel>
  );
}

function PowerLedger({ components, included, label, onToggle, rate }: {
  components: readonly EditorElectricityComponentTelemetry[];
  included: Readonly<Record<string, boolean>>;
  label: "Power Generated" | "Power Consumed";
  onToggle(component: EditorElectricityComponentTelemetry): void;
  rate: number | undefined;
}) {
  const enabled = components.filter((component) => included[component.stableId] ?? component.defaultIncluded).length;
  return (
    <details className="editor-electricity-ledger">
      <summary><span>{label}</span><strong>{number(rate)} EC/s</strong><small>{enabled}/{components.length} included</small></summary>
      <div className="editor-electricity-ledger-body">
        {components.length === 0 ? <p>No components reported.</p> : groupedComponents(components).map(([category, categoryComponents]) => (
          <section className="editor-electricity-ledger-group" key={category}>
            <h3>{category}</h3>
            {categoryComponents.map((component) => {
              const checked = included[component.stableId] ?? component.defaultIncluded;
              return <label className="editor-electricity-component" key={component.stableId}><input checked={checked} onChange={() => onToggle(component)} type="checkbox" /><span><strong>{component.partTitle}</strong><small>{component.moduleName} · {component.valueKnown ? `${number(component.referenceEcPerSec)} EC/s reference` : "rate unknown"}</small></span></label>;
            })}
          </section>
        ))}
      </div>
    </details>
  );
}

function Metric({ label, tone, value }: { label: string; tone?: "ok" | "bad"; value: string }) {
  return <div className={`editor-electricity-metric${tone ? ` ${tone}` : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}
