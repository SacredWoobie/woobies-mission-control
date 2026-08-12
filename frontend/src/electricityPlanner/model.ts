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
  batteryEnduranceSeconds: PlannerNumber;
  eclipseDurationSeconds: PlannerNumber;
  eclipseRequiredEc: PlannerNumber;
  eclipseMarginEc: PlannerNumber;
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
    solarScale: 1,
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

function roleTotal(
  components: readonly EditorElectricityComponentTelemetry[],
  role: "producer" | "consumer",
  solarScale: number | undefined,
): PlannerNumber {
  let total = 0;
  for (const component of components) {
    if (component.role !== role) continue;
    const rate = finiteNonNegative(component.referenceEcPerSec);
    if (!component.valueKnown || rate === undefined) return undefined;
    if (component.solarScaled && solarScale === undefined) return undefined;
    total += rate * (component.solarScaled ? solarScale! : 1);
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
  const solarScale = finiteNonNegative(input.scenario.solarScale);
  const selected = selectedComponents(input.components, input.included);
  const generation = roleTotal(selected, "producer", solarScale);
  const draw = roleTotal(selected, "consumer", solarScale);
  const net = generation === undefined || draw === undefined ? undefined : generation - draw;
  const currentEc = finiteNonNegative(input.currentEc);
  const maxEc = finiteNonNegative(input.maxEc);
  const eclipse = maximumCentralEclipseSeconds(input.body, input.scenario.altitudeMeters);
  const eclipseRequired = draw === undefined || eclipse === undefined ? undefined : draw * eclipse;
  const margin = currentEc === undefined || eclipseRequired === undefined ? undefined : currentEc - eclipseRequired;
  const endurance = currentEc === undefined || net === undefined || net >= 0 ? undefined : currentEc / -net;
  const recharge = currentEc === undefined || maxEc === undefined || net === undefined || net <= 0
    ? undefined : Math.max(0, maxEc - currentEc) / net;

  const period = circularOrbitSeconds(input.body, input.scenario.altitudeMeters);
  const solarGeneration = roleTotal(selected.filter((component) => component.solarScaled), "producer", solarScale);
  const nonSolarGeneration = roleTotal(selected.filter((component) => !component.solarScaled), "producer", solarScale);
  const recurringOrbitSustainable = period === undefined || eclipse === undefined || draw === undefined
    || solarGeneration === undefined || nonSolarGeneration === undefined
    ? undefined
    : (nonSolarGeneration * period) + (solarGeneration * (period - eclipse)) >= draw * period;

  return {
    generationEcPerSec: generation,
    drawEcPerSec: draw,
    netEcPerSec: net,
    batteryEnduranceSeconds: endurance,
    eclipseDurationSeconds: eclipse,
    eclipseRequiredEc: eclipseRequired,
    eclipseMarginEc: margin,
    rechargeSeconds: recharge,
    recurringOrbitSustainable,
    solarScaleAssumption: solarScale,
  };
}
