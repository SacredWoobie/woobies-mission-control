import type {
  EditorElectricityBodyTelemetry,
  EditorElectricityComponentTelemetry,
  TelemetrySnapshot,
} from "../telemetry/types";

export type PlannerNumber = number | undefined;

export interface ElectricityScenario {
  bodyName?: string;
  /** Orbital altitude above the selected body's radius; it is never a staging condition. */
  altitudeMeters?: number;
  /** Multiplicative sunlight output assumption. Undefined intentionally preserves unknown solar output. */
  solarScale?: number;
}

export interface ElectricityPlan {
  generationEcPerSec: PlannerNumber;
  drawEcPerSec: PlannerNumber;
  netEcPerSec: PlannerNumber;
  orbitPeriodSeconds: PlannerNumber;
  batteryEnduranceSeconds: PlannerNumber;
  eclipseDurationSeconds: PlannerNumber;
  /** Checked, continuous non-solar production that remains available in shadow. */
  continuousNonSolarGenerationEcPerSec: PlannerNumber;
  /** Production minus draw while solar generation is unavailable. */
  shadowNetEcPerSec: PlannerNumber;
  /** Time until the reported charge is exhausted during the next eclipse. */
  nextEclipseShadowEnduranceSeconds: PlannerNumber;
  eclipseRequiredEc: PlannerNumber;
  eclipseMarginEc: PlannerNumber;
  /** Whether the currently reported charge holds through the next eclipse only. */
  nextEclipseHolds: boolean | undefined;
  /** Remaining shadow after charge depletion when the next eclipse will not hold. */
  darkBeforeSunlightSeconds: PlannerNumber;
  rechargeSeconds: PlannerNumber;
  recurringOrbitSustainable: boolean | undefined;
  solarScaleAssumption: PlannerNumber;
}

const finiteNonNegative = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const positive = (value: unknown): number | undefined => {
  const number = finiteNonNegative(value);
  return number !== undefined && number > 0 ? number : undefined;
};

export function findPlannerBody(
  bodies: readonly EditorElectricityBodyTelemetry[] | undefined,
  bodyName: string | undefined,
) {
  return bodies?.find((body) => body.bodyName === bodyName);
}

/** Uses authoritative editor body data when available; no stage altitude is consulted. */
export function defaultElectricityScenario(snapshot: TelemetrySnapshot): ElectricityScenario {
  const bodyName = snapshot["editor.body"];
  const body = findPlannerBody(snapshot["editor.elec.bodies"], bodyName);
  const atmosphereDepth = body?.authoritative ? finiteNonNegative(body.atmosphereDepth) : undefined;
  return {
    bodyName,
    altitudeMeters: atmosphereDepth === undefined ? undefined : atmosphereDepth + 10_000,
    solarScale: positive(body?.solarEfficiency),
  };
}

export function circularOrbitSeconds(body: EditorElectricityBodyTelemetry | undefined, altitudeMeters: unknown): PlannerNumber {
  const radius = positive(body?.radius);
  const mu = positive(body?.gravitationalParameter);
  const altitude = finiteNonNegative(altitudeMeters);
  if (!body?.authoritative || radius === undefined || mu === undefined || altitude === undefined) return undefined;
  const orbitRadius = radius + altitude;
  const seconds = 2 * Math.PI * Math.sqrt((orbitRadius ** 3) / mu);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export function maximumCentralEclipseSeconds(
  body: EditorElectricityBodyTelemetry | undefined,
  altitudeMeters: unknown,
): PlannerNumber {
  const period = circularOrbitSeconds(body, altitudeMeters);
  const radius = positive(body?.radius);
  const altitude = finiteNonNegative(altitudeMeters);
  if (period === undefined || radius === undefined || altitude === undefined) return undefined;
  const ratio = Math.max(0, Math.min(1, radius / (radius + altitude)));
  const eclipse = period * Math.asin(ratio) / Math.PI;
  return Number.isFinite(eclipse) && eclipse >= 0 ? eclipse : undefined;
}

export function surfaceDarknessSeconds(body: EditorElectricityBodyTelemetry | undefined): PlannerNumber {
  const period = positive(body?.rotationPeriod);
  return body?.authoritative && period !== undefined ? period / 2 : undefined;
}

function selectedComponents(
  components: readonly EditorElectricityComponentTelemetry[],
  included: Readonly<Record<string, boolean>>,
) {
  return components.filter((component) => included[component.stableId] ?? component.defaultIncluded);
}

/** Returns a component's checked rate under the supplied solar scenario. */
export function effectiveComponentRate(
  component: EditorElectricityComponentTelemetry,
  scenario: Pick<ElectricityScenario, "solarScale">,
): PlannerNumber {
  const rate = finiteNonNegative(component.referenceEcPerSec);
  if (!component.valueKnown || rate === undefined) return undefined;
  if (!component.solarScaled) return rate;
  const solarScale = positive(scenario.solarScale);
  return solarScale === undefined ? undefined : rate * solarScale;
}

function roleTotal(
  components: readonly EditorElectricityComponentTelemetry[],
  role: "producer" | "consumer",
  scenario: ElectricityScenario,
): PlannerNumber {
  let total = 0;
  for (const component of components) {
    if (component.role !== role) continue;
    const rate = effectiveComponentRate(component, scenario);
    if (rate === undefined) return undefined;
    total += rate;
  }
  return Number.isFinite(total) ? total : undefined;
}

export function calculateElectricityPlan(input: {
  components: readonly EditorElectricityComponentTelemetry[];
  included: Readonly<Record<string, boolean>>;
  currentEc?: number;
  maxEc?: number;
  body?: EditorElectricityBodyTelemetry;
  scenario: ElectricityScenario;
}): ElectricityPlan {
  // Zero is the wire sentinel for unresolved star/luminosity data, not a
  // confidently known zero-sunlight environment.
  const solarScale = positive(input.scenario.solarScale);
  const selected = selectedComponents(input.components, input.included);
  const generation = roleTotal(selected, "producer", input.scenario);
  const draw = roleTotal(selected, "consumer", input.scenario);
  const continuousProducers = selected.filter((component) => component.role === "producer" && component.continuous);
  const solarGeneration = roleTotal(continuousProducers.filter((component) => component.solarScaled), "producer", input.scenario);
  const continuousNonSolarGeneration = roleTotal(
    continuousProducers.filter((component) => !component.solarScaled),
    "producer",
    input.scenario,
  );
  const net = generation === undefined || draw === undefined ? undefined : generation - draw;
  const currentEc = finiteNonNegative(input.currentEc);
  const maxEc = finiteNonNegative(input.maxEc);
  const eclipse = maximumCentralEclipseSeconds(input.body, input.scenario.altitudeMeters);
  const shadowNet = continuousNonSolarGeneration === undefined || draw === undefined
    ? undefined : continuousNonSolarGeneration - draw;
  const eclipseRequired = eclipse === undefined || shadowNet === undefined
    ? undefined : Math.max(0, -shadowNet) * eclipse;
  const margin = currentEc === undefined || eclipseRequired === undefined ? undefined : currentEc - eclipseRequired;
  const nextEclipseShadowEndurance = currentEc === undefined || shadowNet === undefined || shadowNet >= 0
    ? undefined : currentEc / -shadowNet;
  const nextEclipseHolds = shadowNet !== undefined && shadowNet >= 0
    ? true
    : margin === undefined ? undefined : margin >= 0;
  const darkBeforeSunlight = nextEclipseHolds === false && eclipse !== undefined && nextEclipseShadowEndurance !== undefined
    ? Math.max(0, eclipse - nextEclipseShadowEndurance)
    : undefined;
  const endurance = currentEc === undefined || net === undefined || net >= 0 ? undefined : currentEc / -net;
  const recharge = currentEc === undefined || maxEc === undefined || net === undefined || net <= 0
    ? undefined : Math.max(0, maxEc - currentEc) / net;

  const period = circularOrbitSeconds(input.body, input.scenario.altitudeMeters);
  const recurringOrbitSustainable = period === undefined || eclipse === undefined || draw === undefined
    || solarGeneration === undefined || continuousNonSolarGeneration === undefined
    ? undefined
    : (continuousNonSolarGeneration * period) + (solarGeneration * (period - eclipse)) >= draw * period;

  return {
    generationEcPerSec: generation,
    drawEcPerSec: draw,
    netEcPerSec: net,
    orbitPeriodSeconds: period,
    batteryEnduranceSeconds: endurance,
    eclipseDurationSeconds: eclipse,
    continuousNonSolarGenerationEcPerSec: continuousNonSolarGeneration,
    shadowNetEcPerSec: shadowNet,
    nextEclipseShadowEnduranceSeconds: nextEclipseShadowEndurance,
    eclipseRequiredEc: eclipseRequired,
    eclipseMarginEc: margin,
    nextEclipseHolds,
    darkBeforeSunlightSeconds: darkBeforeSunlight,
    rechargeSeconds: recharge,
    recurringOrbitSustainable,
    solarScaleAssumption: solarScale,
  };
}
