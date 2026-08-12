import { describe, expect, it } from "vitest";
import { calculateElectricityPlan, circularOrbitSeconds, defaultElectricityScenario, maximumCentralEclipseSeconds, surfaceDarknessSeconds } from "./model";
import { denseElectricityFixture, degradedElectricityFixture, missingElectricityFixture, representativeElectricityFixture } from "./fixtures";
import { applyElectricityPlannerPreset, plannerCraftKey, reconcileElectricityPlannerSession } from "./state";

const components = representativeElectricityFixture["editor.elec.components"]!;

describe("editor electricity planner model", () => {
  const body = representativeElectricityFixture["editor.elec.bodies"]![0];

  it("uses circular-orbit and maximum-central-eclipse formulas without non-finite output", () => {
    const period = circularOrbitSeconds(body, 80_000)!;
    expect(period).toBeCloseTo(1_875, -1);
    expect(maximumCentralEclipseSeconds(body, 80_000)!).toBeGreaterThan(0);
    expect(surfaceDarknessSeconds(body)).toBe(10_800);
    expect(circularOrbitSeconds(body, Number.NaN)).toBeUndefined();
    expect(maximumCentralEclipseSeconds({ ...body, radius: 0 }, 80_000)).toBeUndefined();
  });

  it("calculates power, battery, eclipse and recurring-orbit values with a declared solar assumption", () => {
    const plan = calculateElectricityPlan({ components, included: {}, currentEc: 300, maxEc: 500, body, scenario: { bodyName: "Kerbin", altitudeMeters: 80_000, solarScale: 1 } });
    expect(plan.generationEcPerSec).toBeCloseTo(2.8);
    expect(plan.drawEcPerSec).toBe(0.5);
    expect(plan.netEcPerSec).toBeCloseTo(2.3);
    expect(plan.rechargeSeconds).toBeCloseTo(200 / 2.3);
    expect(plan.eclipseRequiredEc).toBe(0);
    expect(plan.recurringOrbitSustainable).toBe(true);
    expect(plan.solarScaleAssumption).toBe(1);
  });

  it("credits non-solar generation during eclipse battery sizing", () => {
    const plan = calculateElectricityPlan({
      components,
      included: {},
      currentEc: 300,
      maxEc: 500,
      body,
      scenario: { bodyName: "Kerbin", altitudeMeters: 80_000, solarScale: 1 },
    });
    expect(plan.eclipseRequiredEc).toBeCloseTo(
      Math.max(0, 0.5 - 0.8) * plan.eclipseDurationSeconds!,
    );
  });

  it("does not credit conditional non-solar producers during eclipse", () => {
    const conditional = components.map((component) => component.stableId === "rtg-a"
      ? { ...component, continuous: false }
      : component);
    const plan = calculateElectricityPlan({
      components: conditional,
      included: {},
      currentEc: 300,
      maxEc: 500,
      body,
      scenario: { bodyName: "Kerbin", altitudeMeters: 80_000, solarScale: 1 },
    });
    expect(plan.eclipseRequiredEc).toBeCloseTo(0.5 * plan.eclipseDurationSeconds!);
  });

  it("propagates unknown modules and solar assumptions rather than treating them as zero", () => {
    const unknown = calculateElectricityPlan({ components: [{ ...components[0], valueKnown: false }], included: {}, scenario: { solarScale: 1 } });
    expect(unknown.generationEcPerSec).toBeUndefined();
    const unknownSolar = calculateElectricityPlan({ components: [components[0]], included: {}, scenario: {} });
    expect(unknownSolar.generationEcPerSec).toBeUndefined();
    expect(unknownSolar.netEcPerSec).toBeUndefined();
  });

  it("defaults from authoritative body atmosphere rather than staging altitude", () => {
    const scenario = defaultElectricityScenario({ ...representativeElectricityFixture, "stage.altitude": 123 });
    expect(scenario.altitudeMeters).toBe(80_000);
    expect(scenario.solarScale).toBe(0.962);
  });

  it("treats the zero body-efficiency sentinel as unavailable sunlight", () => {
    const zeroEfficiencyBody = { ...body, solarEfficiency: 0 };
    const snapshot = { ...representativeElectricityFixture, "editor.elec.bodies": [zeroEfficiencyBody] };
    expect(defaultElectricityScenario(snapshot).solarScale).toBeUndefined();
    const plan = calculateElectricityPlan({
      components: [components[0]], included: {}, body: zeroEfficiencyBody,
      scenario: { bodyName: "Kerbin", altitudeMeters: 80_000, solarScale: 0 },
    });
    expect(plan.solarScaleAssumption).toBeUndefined();
    expect(plan.generationEcPerSec).toBeUndefined();
  });

  it("keeps representative, dense, missing, and degraded telemetry states distinct", () => {
    expect(representativeElectricityFixture["editor.elec.status"]).toBe("ready");
    expect(denseElectricityFixture["editor.elec.components"]).toHaveLength(48);
    expect(missingElectricityFixture["editor.elec.pending"]).toBe(true);
    expect(degradedElectricityFixture["editor.elec.degradedReason"]).toContain("reflection");
  });
});

describe("editor electricity planner session state", () => {
  it("keys state to save and craft, reconciles stable components, and clears cross-craft toggles", () => {
    const first = reconcileElectricityPlannerSession(undefined, representativeElectricityFixture);
    const changed = { ...first, includedByStableId: { ...first.includedByStableId, "panel-a": false } };
    const revised = reconcileElectricityPlannerSession(changed, { ...representativeElectricityFixture, "editor.elec.revision": 9, "editor.elec.components": [...representativeElectricityFixture["editor.elec.components"]!, { ...representativeElectricityFixture["editor.elec.components"]![0], stableId: "panel-b", defaultIncluded: true }] });
    expect(revised.includedByStableId).toMatchObject({ "panel-a": false, "panel-b": true });
    const otherCraft = reconcileElectricityPlannerSession(revised, { ...representativeElectricityFixture, "editor.elec.craftPersistentId": "craft-2" });
    expect(otherCraft.includedByStableId["panel-a"]).toBe(true);
    expect(plannerCraftKey(representativeElectricityFixture)).toBe("Planner fixture save:craft-1");
  });

  it("applies backend defaults, all included, producers off, and reset without persistence", () => {
    const state = reconcileElectricityPlannerSession(undefined, representativeElectricityFixture);
    expect(applyElectricityPlannerPreset(state, components, "all-included", representativeElectricityFixture).includedByStableId).toEqual({ "panel-a": true, "rtg-a": true, "probe-a": true });
    expect(applyElectricityPlannerPreset(state, components, "producers-off", representativeElectricityFixture).includedByStableId).toEqual({ "panel-a": false, "rtg-a": false, "probe-a": true });
    expect(applyElectricityPlannerPreset(state, components, "backend-defaults", representativeElectricityFixture).includedByStableId).toEqual(state.includedByStableId);
    expect(applyElectricityPlannerPreset({ ...state, scenario: { altitudeMeters: 1 } }, components, "reset", representativeElectricityFixture).scenario.altitudeMeters).toBe(80_000);
  });
});
