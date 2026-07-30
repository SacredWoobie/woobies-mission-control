// Calculation behavior adapted from the MIT-licensed Eric Meyer calculator
// and linuxgurugamer/ResonantOrbitCalculator lineage. See
// THIRD_PARTY_LICENSES.md in source and THIRD-PARTY/NOTICES.md in packages.

import { formatDistance as formatDistancePreset } from "../formatting/numbers";

const TAU = Math.PI * 2;
const ORBIT_TARGET_RADIUS_TOLERANCE_RATIO = 0.0005;
const MINIMUM_ORBIT_TARGET_TOLERANCE = 100;

export const DISTANCE_UNITS = {
  m: { factor: 1, inputDecimals: 1 },
  km: { factor: 1_000, inputDecimals: 3 },
  Mm: { factor: 1_000_000, inputDecimals: 6 },
  Gm: { factor: 1_000_000_000, inputDecimals: 9 },
} as const;

export type DistanceUnit = keyof typeof DISTANCE_UNITS;
export type ResonanceMode = "auto" | "raise" | "dive";
export type OrbitTargetState = "low" | "in-range" | "high" | "unavailable";

export interface OrbitTargetEvaluation {
  state: OrbitTargetState;
  tolerance: number;
}

export interface BodyDefinition {
  name: string;
  gravitationalParameter: number;
  radius: number;
  rotationPeriod: number;
  atmosphereDepth: number;
  sphereOfInfluence: number;
}

export interface PlanWarning {
  code: string;
  level: "danger" | "warning" | "info";
  message: string;
}

export interface ResonantOrbitPlan {
  schemaVersion: 1;
  body: BodyDefinition;
  satelliteCount: number;
  targetAltitude: number;
  mode: Exclude<ResonanceMode, "auto">;
  requestedMode: ResonanceMode;
  resonanceRatio: number;
  finalPeriod: number;
  carrierPeriod: number;
  carrierApoapsis: number;
  carrierPeriapsis: number;
  injectionDeltaV: number;
  minimumLosAltitude: number;
  lineOfSightLength: number;
  synchronousAltitude: number;
  soiAltitude: number;
  releaseAt: "apoapsis" | "periapsis";
  warnings: PlanWarning[];
}

export const STOCK_BODIES: Record<string, BodyDefinition> = {
  Kerbin: { name: "Kerbin", gravitationalParameter: 3.5316e12, radius: 600_000, rotationPeriod: 21_549.425, atmosphereDepth: 70_000, sphereOfInfluence: 84_159_286 },
  Mun: { name: "Mun", gravitationalParameter: 6.5138398e10, radius: 200_000, rotationPeriod: 138_984.38, atmosphereDepth: 0, sphereOfInfluence: 2_429_559.1 },
  Minmus: { name: "Minmus", gravitationalParameter: 1.7658e9, radius: 60_000, rotationPeriod: 40_400, atmosphereDepth: 0, sphereOfInfluence: 2_247_428.4 },
  Duna: { name: "Duna", gravitationalParameter: 3.0136321e11, radius: 320_000, rotationPeriod: 65_517.859, atmosphereDepth: 50_000, sphereOfInfluence: 47_921_949 },
  Jool: { name: "Jool", gravitationalParameter: 2.82528e14, radius: 6_000_000, rotationPeriod: 36_000, atmosphereDepth: 200_000, sphereOfInfluence: 2_455_985_200 },
};

function positive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be a positive finite number.`);
  return value;
}

function nonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be a non-negative finite number.`);
  return value;
}

export function orbitalPeriod(semiMajorAxis: number, gravitationalParameter: number) {
  return TAU * Math.sqrt(semiMajorAxis ** 3 / gravitationalParameter);
}

export function semiMajorAxisFromPeriod(period: number, gravitationalParameter: number) {
  return Math.cbrt(gravitationalParameter * (period / TAU) ** 2);
}

export function distanceFromUnit(value: number, unit: DistanceUnit) {
  return value * DISTANCE_UNITS[unit].factor;
}

export function distanceToUnit(meters: number, unit: DistanceUnit) {
  return meters / DISTANCE_UNITS[unit].factor;
}

export function formatDistance(meters: number, _unit?: DistanceUnit) {
  return formatDistancePreset(meters, "plan");
}

export function formatDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "n/a";
  const rounded = Math.round(totalSeconds * 10) / 10;
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded - hours * 3600) / 60);
  const seconds = rounded - hours * 3600 - minutes * 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${seconds.toFixed(1).padStart(4, "0")}s`;
}

export function evaluateOrbitTarget(
  currentAltitude: number | undefined,
  targetAltitude: number,
  bodyRadius: number,
): OrbitTargetEvaluation {
  const tolerance = Math.max(
    MINIMUM_ORBIT_TARGET_TOLERANCE,
    Math.abs(bodyRadius + targetAltitude) * ORBIT_TARGET_RADIUS_TOLERANCE_RATIO,
  );
  if (currentAltitude === undefined || !Number.isFinite(currentAltitude)) {
    return { state: "unavailable", tolerance };
  }
  if (currentAltitude < targetAltitude - tolerance) return { state: "low", tolerance };
  if (currentAltitude > targetAltitude + tolerance) return { state: "high", tolerance };
  return { state: "in-range", tolerance };
}

export function calculateResonantOrbit(input: {
  body: BodyDefinition;
  satelliteCount: number;
  targetAltitude: number;
  mode: ResonanceMode;
  useOcclusionModifiers?: boolean;
  atmosphericOcclusion?: number;
  vacuumOcclusion?: number;
}): ResonantOrbitPlan {
  const body = input.body;
  const mu = positive(body.gravitationalParameter, "Gravitational parameter");
  const radius = positive(body.radius, "Equatorial radius");
  const rotationPeriod = positive(body.rotationPeriod, "Rotation period");
  const atmosphereDepth = nonNegative(body.atmosphereDepth, "Atmosphere depth");
  const sphereOfInfluence = positive(body.sphereOfInfluence, "Sphere of influence");
  const satelliteCount = input.satelliteCount;
  const targetAltitude = positive(input.targetAltitude, "Target altitude");
  if (!Number.isInteger(satelliteCount) || satelliteCount < 2 || satelliteCount > 99) throw new RangeError("Satellite count must be a whole number between 2 and 99.");
  if (targetAltitude >= sphereOfInfluence - radius) throw new RangeError("Target altitude must remain inside the body's sphere of influence.");

  const targetRadius = radius + targetAltitude;
  const finalPeriod = orbitalPeriod(targetRadius, mu);
  const raiseRatio = (satelliteCount + 1) / satelliteCount;
  const raiseAxis = semiMajorAxisFromPeriod(finalPeriod * raiseRatio, mu);
  const raiseApoapsis = 2 * raiseAxis - targetRadius - radius;
  const mode: "raise" | "dive" = input.mode === "auto"
    ? raiseApoapsis < sphereOfInfluence - radius ? "raise" : "dive"
    : input.mode;
  const resonanceRatio = mode === "raise" ? raiseRatio : (satelliteCount - 1) / satelliteCount;
  const carrierPeriod = finalPeriod * resonanceRatio;
  const carrierAxis = semiMajorAxisFromPeriod(carrierPeriod, mu);
  const alternateAltitude = 2 * carrierAxis - targetRadius - radius;
  const carrierApoapsis = mode === "raise" ? alternateAltitude : targetAltitude;
  const carrierPeriapsis = mode === "raise" ? targetAltitude : alternateAltitude;
  const circularSpeed = Math.sqrt(mu / targetRadius);
  const carrierSharedSpeed = Math.sqrt(mu * (2 / targetRadius - 1 / carrierAxis));
  const injectionDeltaV = Math.abs(circularSpeed - carrierSharedSpeed);
  const modifier = input.useOcclusionModifiers === false ? 1 : atmosphereDepth > 0 ? input.atmosphericOcclusion ?? 0.75 : input.vacuumOcclusion ?? 0.9;
  const minimumLosAltitude = satelliteCount >= 3 ? radius * modifier / Math.cos(Math.PI / satelliteCount) - radius : 0;
  const lineOfSightLength = 2 * targetRadius * Math.sin(Math.PI / satelliteCount);
  const synchronousAltitude = semiMajorAxisFromPeriod(rotationPeriod, mu) - radius;
  const soiAltitude = sphereOfInfluence - radius;
  const warnings: PlanWarning[] = [];
  if (carrierPeriapsis <= 0) warnings.push({ level: "danger", code: "impact", message: "Carrier periapsis intersects the body." });
  else if (carrierPeriapsis < atmosphereDepth) warnings.push({ level: "danger", code: "atmosphere", message: "Carrier periapsis is inside the atmosphere." });
  if (carrierApoapsis >= soiAltitude) warnings.push({ level: "danger", code: "soi", message: "Carrier apoapsis leaves the sphere of influence." });
  if (satelliteCount >= 3 && targetAltitude < minimumLosAltitude) warnings.push({ level: "warning", code: "los", message: "Target orbit is below the continuous line-of-sight estimate." });
  if (input.mode === "auto" && mode === "dive") warnings.push({ level: "info", code: "auto-dive", message: "Auto selected a dive orbit to remain inside the sphere of influence." });
  if (synchronousAltitude <= 0 || synchronousAltitude >= soiAltitude) warnings.push({ level: "info", code: "sync", message: "A stable synchronous orbit is unavailable inside this sphere of influence." });

  return {
    schemaVersion: 1,
    body: { ...body },
    satelliteCount,
    targetAltitude,
    mode,
    requestedMode: input.mode,
    resonanceRatio,
    finalPeriod,
    carrierPeriod,
    carrierApoapsis,
    carrierPeriapsis,
    injectionDeltaV,
    minimumLosAltitude,
    lineOfSightLength,
    synchronousAltitude,
    soiAltitude,
    releaseAt: mode === "raise" ? "periapsis" : "apoapsis",
    warnings,
  };
}
