import { describe, expect, it } from "vitest";
import { calculateElectricityPlan, circularOrbitSeconds, defaultElectricityScenario, effectiveComponentRate, maximumCentralEclipseSeconds, surfaceDarknessSeconds } from "./model";
import { denseElectricityFixture, degradedElectricityFixture, missingElectricityFixture, representativeElectricityFixture } from "./fixtures";
import { applyElectricityPlannerPreset, applyElectricityPlannerRoleInclusion, plannerCraftKey, reconcileElectricityPlannerSession } from "./state";

const components = representativeElectricityFixture["editor.elec.components"]!;
const panelId = components.find((component) => component.solarScaled)!.stableId;
const rtgId = components.find((component) => component.category === "RTG")!.stableId;

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
    const plan = calculateElectricityPlan({ components, included: {}, currentEc: 1_000, maxEc: 1_200, body, scenario: { bodyName: "Kerbin", altitudeMeters: 80_000, solarScale: 0.962 } });
    expect(plan.generationEcPerSec).toBeCloseTo(3.9);
    expect(plan.drawEcPerSec).toBeCloseTo(1.31);
    expect(plan.netEcPerSec).toBeCloseTo(2.59);
    expect(plan.orbitPeriodSeconds).toBeCloseTo(1_875, -1);
    expect(plan.rechargeSeconds).toBeCloseTo(200 / 2.59);
    expect(plan.eclipseRequiredEc).toBeCloseTo(0.56 * plan.eclipseDurationSeconds!);
    expect(plan.continuousNonSolarGenerationEcPerSec).toBe(0.75);
    expect(plan.shadowNetEcPerSec).toBeCloseTo(-0.56);
    expect(plan.nextEclipseShadowEnduranceSeconds).toBeCloseTo(1_000 / 0.56);
    expect(plan.nextEclipseHolds).toBe(true);
    expect(plan.darkBeforeSunlightSeconds).toBeUndefined();
    expect(plan.recurringOrbitSustainable).toBe(false);
    expect(plan.solarScaleAssumption).toBe(0.962);
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
      Math.max(0, 1.31 - 0.75) * plan.eclipseDurationSeconds!,
    );
  });

  it("does not credit conditional non-solar producers during eclipse", () => {
    const conditional = components.map((component) => component.stableId === rtgId
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
    expect(plan.eclipseRequiredEc).toBeCloseTo(1.31 * plan.eclipseDurationSeconds!);
    expect(plan.continuousNonSolarGenerationEcPerSec).toBe(0);
    expect(plan.shadowNetEcPerSec).toBeCloseTo(-1.31);
  });

  it("reports next-eclipse endurance and failure time from current reported charge", () => {
    const plan = calculateElectricityPlan({
      components,
      included: { [rtgId]: false },
      currentEc: 10,
      body,
      scenario: { bodyName: "Kerbin", altitudeMeters: 80_000, solarScale: 1 },
    });
    expect(plan.shadowNetEcPerSec).toBeCloseTo(-1.31);
    expect(plan.nextEclipseShadowEnduranceSeconds).toBeCloseTo(10 / 1.31);
    expect(plan.eclipseRequiredEc).toBeGreaterThan(10);
    expect(plan.nextEclipseHolds).toBe(false);
    expect(plan.darkBeforeSunlightSeconds).toBeCloseTo(plan.eclipseDurationSeconds! - (10 / 1.31));
  });

  it("treats a zero shadow deficit as holding without inventing a finite endurance", () => {
    const balanced = components.map((component) => component.stableId === rtgId
      ? { ...component, referenceEcPerSec: 1.31 }
      : component);
    const plan = calculateElectricityPlan({
      components: balanced,
      included: {},
      currentEc: 0,
      body,
      scenario: { bodyName: "Kerbin", altitudeMeters: 80_000, solarScale: 1 },
    });
    expect(plan.shadowNetEcPerSec).toBe(0);
    expect(plan.eclipseRequiredEc).toBe(0);
    expect(plan.nextEclipseHolds).toBe(true);
    expect(plan.nextEclipseShadowEnduranceSeconds).toBeUndefined();
    expect(plan.darkBeforeSunlightSeconds).toBeUndefined();
  });

  it("recognizes continuous shadow surplus without requiring a current-charge report", () => {
    const plan = calculateElectricityPlan({
      components: components.map((component) => component.stableId === rtgId ? { ...component, referenceEcPerSec: 2 } : component),
      included: {},
      body,
      scenario: { bodyName: "Kerbin", altitudeMeters: 80_000, solarScale: 1 },
    });
    expect(plan.shadowNetEcPerSec).toBeGreaterThan(0);
    expect(plan.eclipseMarginEc).toBeUndefined();
    expect(plan.nextEclipseHolds).toBe(true);
  });

  it("propagates unknown modules and solar assumptions rather than treating them as zero", () => {
    const unknown = calculateElectricityPlan({ components: [{ ...components[0], valueKnown: false }], included: {}, scenario: { solarScale: 1 } });
    expect(unknown.generationEcPerSec).toBeUndefined();
    expect(effectiveComponentRate({ ...components[1], valueKnown: false }, { solarScale: 1 })).toBeUndefined();
    expect(effectiveComponentRate({ ...components[1], referenceEcPerSec: undefined }, { solarScale: 1 })).toBeUndefined();
    const unknownSolar = calculateElectricityPlan({ components: [components[0]], included: {}, scenario: {} });
    expect(unknownSolar.generationEcPerSec).toBeUndefined();
    expect(unknownSolar.netEcPerSec).toBeUndefined();
    expect(effectiveComponentRate(components[0], {})).toBeUndefined();
    expect(effectiveComponentRate(components.find((component) => component.stableId === rtgId)!, {})).toBe(0.75);
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
    const changed = { ...first, includedByStableId: { ...first.includedByStableId, [panelId]: false } };
    const revised = reconcileElectricityPlannerSession(changed, { ...representativeElectricityFixture, "editor.elec.revision": 9, "editor.elec.components": [...representativeElectricityFixture["editor.elec.components"]!, { ...representativeElectricityFixture["editor.elec.components"]![0], stableId: "panel-b", defaultIncluded: true }] });
    expect(revised.includedByStableId).toMatchObject({ [panelId]: false, "panel-b": true });
    const otherCraft = reconcileElectricityPlannerSession(revised, { ...representativeElectricityFixture, "editor.elec.craftPersistentId": "craft-2" });
    expect(otherCraft.includedByStableId[panelId]).toBe(true);
    expect(plannerCraftKey(representativeElectricityFixture)).toBe("Planner fixture save:craft-1");
  });

  it("applies backend defaults, all included, producers off, and reset without persistence", () => {
    const state = reconcileElectricityPlannerSession(undefined, representativeElectricityFixture);
    expect(Object.values(applyElectricityPlannerPreset(state, components, "all-included", representativeElectricityFixture).includedByStableId)).toEqual(components.map(() => true));
    expect(applyElectricityPlannerPreset(state, components, "producers-off", representativeElectricityFixture).includedByStableId).toEqual(Object.fromEntries(components.map((component) => [component.stableId, component.role === "producer" ? false : component.defaultIncluded])));
    expect(applyElectricityPlannerPreset(state, components, "backend-defaults", representativeElectricityFixture).includedByStableId).toEqual(state.includedByStableId);
    expect(applyElectricityPlannerPreset({ ...state, scenario: { altitudeMeters: 1 } }, components, "reset", representativeElectricityFixture).scenario.altitudeMeters).toBe(80_000);
  });

  it("scopes ALL and NONE to one role while preserving the other role and scenario", () => {
    const state = {
      ...reconcileElectricityPlannerSession(undefined, representativeElectricityFixture),
      includedByStableId: { ...reconcileElectricityPlannerSession(undefined, representativeElectricityFixture).includedByStableId, [panelId]: false },
      scenario: { bodyName: "Kerbin", altitudeMeters: 123_456, solarScale: 0.9 },
    };
    const producersAll = applyElectricityPlannerRoleInclusion(state, components, "producer", "all");
    expect(producersAll.includedByStableId).toEqual(Object.fromEntries(components.map((component) => [component.stableId, component.role === "producer" ? true : component.defaultIncluded])));
    expect(producersAll.scenario).toEqual(state.scenario);
    const consumersNone = applyElectricityPlannerRoleInclusion(producersAll, components, "consumer", "none");
    expect(consumersNone.includedByStableId).toEqual(Object.fromEntries(components.map((component) => [component.stableId, component.role === "producer"])));
    expect(consumersNone.scenario).toEqual(state.scenario);
  });
});
