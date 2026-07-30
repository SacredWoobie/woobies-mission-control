import type { CelestialBodyTelemetry } from "../telemetry/types";
import { formatDistance } from "../formatting/numbers";

const STANDARD_GRAVITY = 9.80665;
const AEROCAPTURE_RESERVE_INCREMENT = 50;
const aerocaptureEstimateCache = new Map<string, AerocaptureEstimate>();

export type DeltaVSystem = "stock" | "opm";
export type MissionEndpoint = "surface" | "orbit";
export type MissionDirection = "oneWay" | "roundTrip";
export type ArrivalKey = "outbound" | "return";

export function deltaVSystemForCatalogNames(names: Iterable<string>): DeltaVSystem {
  const available = new Set(names);
  return ["Sarnus", "Urlum", "Neidon", "Plock"].some((name) => available.has(name)) ? "opm" : "stock";
}

export interface ArrivalStrategy {
  captureBeforeLanding: boolean;
  aerocapture: boolean;
  atmosphericLanding: boolean;
  assistedLandingReserve: number;
}

export interface CustomDeltaVStep {
  id: string;
  afterLegId: string;
  label: string;
  deltaV: number;
}

export interface DeltaVBody {
  name: string;
  parent: string;
  semiMajorAxis: number;
  orbitEpoch?: number;
  meanLongitudeAtEpoch?: number;
  gravitationalParameter: number;
  radius: number;
  rotationPeriod?: number;
  atmosphereDepth: number;
  defaultParkingAltitude: number;
  solidSurface: boolean;
  ascentBudget?: number;
  source: "stock" | "opm" | "live";
  parentGravitationalParameter?: number;
  atmosphereDensityAltitudes?: number[];
  atmosphereDensities?: number[];
}

export interface DeltaVLeg {
  id: string;
  label: string;
  deltaV: number;
  kind: "ascent" | "departure" | "transfer" | "capture" | "deorbit" | "landing" | "custom";
  note: string;
  arrival?: string;
  atmosphereAvailable?: boolean;
  destinationEndpoint?: MissionEndpoint;
  atmosphericAssist?: "direct-entry" | "aerocapture" | "landing";
  custom?: boolean;
  transferSource?: "modeled" | "mechjeb";
  transferArcId?: TransferArcId;
  departureUT?: number;
  arrivalUT?: number;
  arrivalVInfinity?: number;
  aerocapturePeriapsisAltitude?: number;
  aerocapturePeakDynamicPressure?: number;
  aerocaptureEstimateAvailable?: boolean;
}

export type TransferArcId = string;
export type TransferArcRouteLegId = string;

export interface LiveTransferRequest {
  origin: string;
  destination: string;
  originParkingAltitude: number;
  destinationParkingAltitude: number;
  optimizePoweredCapture: boolean;
}

export interface LiveTransferSolution extends LiveTransferRequest {
  arcId?: TransferArcId;
  requestId: string;
  fingerprint: string;
  departureUT: number;
  arrivalUT: number;
  transferTime: number;
  ejectionDeltaV: number;
  arrivalVInfinity: number;
  departureVInfinity?: [number, number, number];
  maneuverVectorSchema?: 1;
}

export interface TransferArcDescriptor extends LiveTransferRequest {
  id: TransferArcId;
  direction: string;
  routeLegId: TransferArcRouteLegId;
  label: string;
}

export interface TransferTimelineEntry {
  arcId: TransferArcId;
  direction: string;
  departureUT: number;
  arrivalUT: number;
  transferTime: number;
  origin: string;
  destination: string;
}

export interface TransferTimelineConstraint {
  earliestDepartureUT: number | null;
  departureUT: number | null;
  arrivalUT: number | null;
  conflict: boolean;
  message: string | null;
}

export interface DeltaVPlan {
  origin: DeltaVBody;
  destination: DeltaVBody;
  direction: MissionDirection;
  legs: DeltaVLeg[];
  idealDeltaV: number;
  nominalDeltaV: number;
  marginDeltaV: number;
  totalDeltaV: number;
  landingDeltaV: number;
  atmosphericAssistance: boolean;
  transferTime: number | null;
  phaseAngle: number | null;
  assumptions: string[];
  outboundTransferSource: "modeled" | "mechjeb";
  returnTransferSource: "modeled" | "mechjeb" | null;
  transferTimeline: Partial<Record<string, TransferTimelineEntry>>;
}

export interface SerialMissionLocation {
  bodyName: string;
  endpoint: MissionEndpoint;
  parkingAltitude: number;
}

export interface SerialMissionStop extends SerialMissionLocation {
  id: string;
  arrivalStrategy: ArrivalStrategy;
  /** Selected-calendar days spent at this stop before the next segment. */
  stayDurationDays?: number;
}

export interface SerialMissionRouteInput {
  system: DeltaVSystem;
  catalog?: DeltaVBody[];
  start: SerialMissionLocation;
  stops: SerialMissionStop[];
}

export interface SerialTransferTiming {
  segmentId: string;
  origin: string;
  destination: string;
  interplanetary: boolean;
  modeledTransferTime: number;
  preInterplanetaryTransferTime: number;
  postInterplanetaryTransferTime: number;
  localWindow?: {
    targetPhaseAngle: number;
    originEpoch: number;
    originMeanLongitudeAtEpoch: number;
    originMeanMotion: number;
    destinationEpoch: number;
    destinationMeanLongitudeAtEpoch: number;
    destinationMeanMotion: number;
  };
}

interface OneWayPlan {
  legs: DeltaVLeg[];
  transferTime: number | null;
  phaseAngle: number | null;
  selectedTransfer?: TransferTimelineEntry;
}

function muFromGee(radius: number, geeAsl: number) {
  return geeAsl * STANDARD_GRAVITY * radius ** 2;
}

function body(definition: DeltaVBody) {
  return definition;
}

const SUN_MU = 1.1723328e18;

const STOCK_PROFILE: DeltaVBody[] = [
  body({ name: "Moho", parent: "Sun", semiMajorAxis: 5_263_138_304, gravitationalParameter: 1.6860938e11, radius: 250_000, atmosphereDepth: 0, defaultParkingAltitude: 20_000, solidSurface: true, ascentBudget: 870, source: "stock" }),
  body({ name: "Eve", parent: "Sun", semiMajorAxis: 9_832_684_544, gravitationalParameter: 8.1717302e12, radius: 700_000, atmosphereDepth: 90_000, defaultParkingAltitude: 100_000, solidSurface: true, ascentBudget: 8_000, source: "stock" }),
  body({ name: "Gilly", parent: "Eve", semiMajorAxis: 31_500_000, gravitationalParameter: 8.2894498e6, radius: 13_000, atmosphereDepth: 0, defaultParkingAltitude: 10_000, solidSurface: true, ascentBudget: 30, source: "stock" }),
  body({ name: "Kerbin", parent: "Sun", semiMajorAxis: 13_599_840_256, gravitationalParameter: 3.5316e12, radius: 600_000, atmosphereDepth: 70_000, defaultParkingAltitude: 80_000, solidSurface: true, ascentBudget: 3_400, source: "stock" }),
  body({ name: "Mun", parent: "Kerbin", semiMajorAxis: 12_000_000, gravitationalParameter: 6.5138398e10, radius: 200_000, atmosphereDepth: 0, defaultParkingAltitude: 14_000, solidSurface: true, ascentBudget: 580, source: "stock" }),
  body({ name: "Minmus", parent: "Kerbin", semiMajorAxis: 47_000_000, gravitationalParameter: 1.7658e9, radius: 60_000, atmosphereDepth: 0, defaultParkingAltitude: 10_000, solidSurface: true, ascentBudget: 180, source: "stock" }),
  body({ name: "Duna", parent: "Sun", semiMajorAxis: 20_726_155_264, gravitationalParameter: 3.0136321e11, radius: 320_000, atmosphereDepth: 50_000, defaultParkingAltitude: 60_000, solidSurface: true, ascentBudget: 1_450, source: "stock" }),
  body({ name: "Ike", parent: "Duna", semiMajorAxis: 3_200_000, gravitationalParameter: 1.8568369e10, radius: 130_000, atmosphereDepth: 0, defaultParkingAltitude: 10_000, solidSurface: true, ascentBudget: 390, source: "stock" }),
  body({ name: "Dres", parent: "Sun", semiMajorAxis: 40_839_348_203, gravitationalParameter: 2.1484489e10, radius: 138_000, atmosphereDepth: 0, defaultParkingAltitude: 10_000, solidSurface: true, ascentBudget: 430, source: "stock" }),
  body({ name: "Jool", parent: "Sun", semiMajorAxis: 68_773_560_320, gravitationalParameter: 2.82528e14, radius: 6_000_000, atmosphereDepth: 200_000, defaultParkingAltitude: 210_000, solidSurface: false, source: "stock" }),
  body({ name: "Laythe", parent: "Jool", semiMajorAxis: 27_184_000, gravitationalParameter: 1.962e12, radius: 500_000, atmosphereDepth: 50_000, defaultParkingAltitude: 60_000, solidSurface: true, ascentBudget: 2_900, source: "stock" }),
  body({ name: "Vall", parent: "Jool", semiMajorAxis: 43_152_000, gravitationalParameter: 2.074815e11, radius: 300_000, atmosphereDepth: 0, defaultParkingAltitude: 15_000, solidSurface: true, ascentBudget: 860, source: "stock" }),
  body({ name: "Tylo", parent: "Jool", semiMajorAxis: 68_500_000, gravitationalParameter: 2.82528e12, radius: 600_000, atmosphereDepth: 0, defaultParkingAltitude: 30_000, solidSurface: true, ascentBudget: 2_270, source: "stock" }),
  body({ name: "Bop", parent: "Jool", semiMajorAxis: 128_500_000, gravitationalParameter: 2.4868349e9, radius: 65_000, atmosphereDepth: 0, defaultParkingAltitude: 10_000, solidSurface: true, ascentBudget: 220, source: "stock" }),
  body({ name: "Pol", parent: "Jool", semiMajorAxis: 179_890_000, gravitationalParameter: 7.2170208e8, radius: 44_000, atmosphereDepth: 0, defaultParkingAltitude: 10_000, solidSurface: true, ascentBudget: 130, source: "stock" }),
  body({ name: "Eeloo", parent: "Sun", semiMajorAxis: 90_118_820_000, gravitationalParameter: 7.4410815e10, radius: 210_000, atmosphereDepth: 0, defaultParkingAltitude: 10_000, solidSurface: true, ascentBudget: 620, source: "stock" }),
];

const OPM_BODIES: DeltaVBody[] = [
  body({ name: "Sarnus", parent: "Sun", semiMajorAxis: 125_798_522_368, gravitationalParameter: muFromGee(5_300_000, 0.298), radius: 5_300_000, atmosphereDepth: 580_000, defaultParkingAltitude: 600_000, solidSurface: false, source: "opm" }),
  body({ name: "Hale", parent: "Sarnus", semiMajorAxis: 10_488_231, gravitationalParameter: muFromGee(6_000, 0.0023), radius: 6_000, atmosphereDepth: 0, defaultParkingAltitude: 8_000, solidSurface: true, ascentBudget: 40, source: "opm" }),
  body({ name: "Ovok", parent: "Sarnus", semiMajorAxis: 12_169_413, gravitationalParameter: muFromGee(26_000, 0.002), radius: 26_000, atmosphereDepth: 0, defaultParkingAltitude: 10_000, solidSurface: true, ascentBudget: 70, source: "opm" }),
  body({ name: "Eeloo", parent: "Sarnus", semiMajorAxis: 19_105_978, gravitationalParameter: 7.4410815e10, radius: 210_000, atmosphereDepth: 0, defaultParkingAltitude: 10_000, solidSurface: true, ascentBudget: 620, source: "opm" }),
  body({ name: "Slate", parent: "Sarnus", semiMajorAxis: 42_592_946, gravitationalParameter: muFromGee(540_000, 0.692), radius: 540_000, atmosphereDepth: 0, defaultParkingAltitude: 45_000, solidSurface: true, ascentBudget: 1_460, source: "opm" }),
  body({ name: "Tekto", parent: "Sarnus", semiMajorAxis: 97_355_304, gravitationalParameter: muFromGee(280_000, 0.2503), radius: 280_000, atmosphereDepth: 95_000, defaultParkingAltitude: 120_000, solidSurface: true, ascentBudget: 2_600, source: "opm" }),
  body({ name: "Urlum", parent: "Sun", semiMajorAxis: 254_317_012_787, gravitationalParameter: muFromGee(2_177_000, 0.257), radius: 2_177_000, atmosphereDepth: 325_000, defaultParkingAltitude: 350_000, solidSurface: false, source: "opm" }),
  body({ name: "Polta", parent: "Urlum", semiMajorAxis: 11_727_895, gravitationalParameter: muFromGee(220_000, 0.19), radius: 220_000, atmosphereDepth: 0, defaultParkingAltitude: 20_000, solidSurface: true, ascentBudget: 460, source: "opm" }),
  body({ name: "Priax", parent: "Urlum", semiMajorAxis: 11_727_895, gravitationalParameter: muFromGee(74_000, 0.063), radius: 74_000, atmosphereDepth: 0, defaultParkingAltitude: 20_000, solidSurface: true, ascentBudget: 100, source: "opm" }),
  body({ name: "Wal", parent: "Urlum", semiMajorAxis: 67_553_668, gravitationalParameter: muFromGee(370_000, 0.37), radius: 370_000, atmosphereDepth: 0, defaultParkingAltitude: 35_000, solidSurface: true, ascentBudget: 1_390, source: "opm" }),
  body({ name: "Tal", parent: "Wal", semiMajorAxis: 3_109_163, gravitationalParameter: muFromGee(22_000, 0.045), radius: 22_000, atmosphereDepth: 0, defaultParkingAltitude: 15_000, solidSurface: true, ascentBudget: 260, source: "opm" }),
  body({ name: "Neidon", parent: "Sun", semiMajorAxis: 409_355_191_706, gravitationalParameter: muFromGee(2_145_000, 0.314), radius: 2_145_000, atmosphereDepth: 260_000, defaultParkingAltitude: 280_000, solidSurface: false, source: "opm" }),
  body({ name: "Thatmo", parent: "Neidon", semiMajorAxis: 32_300_895, gravitationalParameter: muFromGee(286_000, 0.232), radius: 286_000, atmosphereDepth: 35_000, defaultParkingAltitude: 45_000, solidSurface: true, ascentBudget: 450, source: "opm" }),
  body({ name: "Nissee", parent: "Neidon", semiMajorAxis: 487_743_514, gravitationalParameter: muFromGee(30_000, 0.045), radius: 30_000, atmosphereDepth: 0, defaultParkingAltitude: 10_000, solidSurface: true, ascentBudget: 360, source: "opm" }),
  body({ name: "Plock", parent: "Sun", semiMajorAxis: 535_833_706_086, gravitationalParameter: muFromGee(189_000, 0.148), radius: 189_000, atmosphereDepth: 0, defaultParkingAltitude: 10_000, solidSurface: true, ascentBudget: 900, source: "opm" }),
  body({ name: "Karen", parent: "Plock", semiMajorAxis: 2_457_800, gravitationalParameter: muFromGee(85_050, 0.066), radius: 85_050, atmosphereDepth: 0, defaultParkingAltitude: 10_000, solidSurface: true, ascentBudget: 550, source: "opm" }),
];

export function bodiesForSystem(system: DeltaVSystem) {
  const stock = system === "opm"
    ? STOCK_PROFILE.filter((candidate) => candidate.name !== "Eeloo")
    : STOCK_PROFILE;
  return [...stock, ...(system === "opm" ? OPM_BODIES : [])];
}

function derivedParkingAltitude(body: Pick<DeltaVBody, "atmosphereDepth" | "radius">) {
  if (body.atmosphereDepth > 0) {
    const clearance = Math.max(10_000, Math.min(25_000, body.radius * 0.01));
    return Math.ceil((body.atmosphereDepth + clearance) / 1_000) * 1_000;
  }
  const clearance = Math.max(10_000, Math.min(30_000, body.radius * 0.05));
  return Math.ceil(clearance / 1_000) * 1_000;
}

function syntheticAtmosphereCurve(atmosphereDepth: number, surfaceGravity: number) {
  if (atmosphereDepth <= 0) return { altitudes: [] as number[], densities: [] as number[] };
  const surfaceDensity = 1.225 * Math.max(0.02, Math.min(5, surfaceGravity / STANDARD_GRAVITY));
  const scaleHeight = atmosphereDepth / 12;
  const altitudes = Array.from({ length: 33 }, (_, index) => atmosphereDepth * index / 32);
  const densities = altitudes.map((altitude, index) => index === 32 ? 0 : surfaceDensity * Math.exp(-altitude / scaleHeight));
  return { altitudes, densities };
}

function estimatedAscentBudget(bodyDefinition: DeltaVBody, surfaceGravity: number) {
  const orbitalSpeed = circularSpeed(
    bodyDefinition.gravitationalParameter,
    bodyDefinition.radius + bodyDefinition.defaultParkingAltitude,
  );
  const rotationalCredit = 2 * Math.PI * bodyDefinition.radius / Math.max(1, bodyDefinition.rotationPeriod ?? Number.POSITIVE_INFINITY);
  if (bodyDefinition.atmosphereDepth <= 0) {
    return Math.ceil(Math.max(20, orbitalSpeed * 1.1 - rotationalCredit) / 10) * 10;
  }
  const surfaceDensity = bodyDefinition.atmosphereDensities?.[0] ?? 0;
  const atmosphereFactor = 1
    + Math.min(1.6, 0.45 * Math.sqrt(Math.max(0, surfaceDensity) / 1.225))
    + Math.min(0.35, 0.5 * bodyDefinition.atmosphereDepth / bodyDefinition.radius);
  return Math.ceil(Math.max(50, orbitalSpeed * atmosphereFactor + surfaceGravity * 45 - rotationalCredit) / 50) * 50;
}

/** Convert the live kRPC body catalog into the planner's system-agnostic model. */
export function bodiesFromTelemetry(liveBodies: CelestialBodyTelemetry[]): DeltaVBody[] {
  const usable = liveBodies.filter((candidate) =>
    typeof candidate.parent === "string" && candidate.parent.length > 0
    && typeof candidate.semiMajorAxis === "number" && Number.isFinite(candidate.semiMajorAxis) && candidate.semiMajorAxis > 0
    && Number.isFinite(candidate.gravitationalParameter) && candidate.gravitationalParameter > 0
    && Number.isFinite(candidate.radius) && candidate.radius > 0,
  );
  if (usable.length === 0) return [];

  const knownSystem = deltaVSystemForCatalogNames(usable.map((candidate) => candidate.name));
  const known = bodiesForSystem(knownSystem);
  return usable.map((candidate) => {
    const curated = known.find((profile) => profile.name === candidate.name && profile.parent === candidate.parent);
    const surfaceGravity = typeof candidate.surfaceGravity === "number" && Number.isFinite(candidate.surfaceGravity) && candidate.surfaceGravity > 0
      ? candidate.surfaceGravity
      : candidate.gravitationalParameter / candidate.radius ** 2;
    const receivedAtmosphere = Array.isArray(candidate.atmosphereDensityAltitudes)
      && Array.isArray(candidate.atmosphereDensities)
      && candidate.atmosphereDensityAltitudes.length >= 2
      && candidate.atmosphereDensityAltitudes.length === candidate.atmosphereDensities.length;
    const atmosphere = receivedAtmosphere
      ? { altitudes: [...candidate.atmosphereDensityAltitudes!], densities: [...candidate.atmosphereDensities!] }
      : syntheticAtmosphereCurve(candidate.atmosphereDepth, surfaceGravity);
    const result: DeltaVBody = {
      name: candidate.name,
      parent: candidate.parent!,
      semiMajorAxis: candidate.semiMajorAxis!,
      orbitEpoch: candidate.orbitEpoch,
      meanLongitudeAtEpoch: candidate.meanLongitudeAtEpoch,
      parentGravitationalParameter: candidate.parentGravitationalParameter,
      gravitationalParameter: candidate.gravitationalParameter,
      radius: candidate.radius,
      rotationPeriod: candidate.rotationPeriod,
      atmosphereDepth: Math.max(0, candidate.atmosphereDepth),
      defaultParkingAltitude: curated?.defaultParkingAltitude ?? derivedParkingAltitude(candidate),
      solidSurface: candidate.solidSurface ?? true,
      source: curated?.source ?? "live",
      atmosphereDensityAltitudes: atmosphere.altitudes,
      atmosphereDensities: atmosphere.densities,
    };
    result.ascentBudget = curated?.ascentBudget
      ?? (result.solidSurface ? estimatedAscentBudget(result, surfaceGravity) : undefined);
    return result;
  }).sort((left, right) => left.semiMajorAxis - right.semiMajorAxis || left.name.localeCompare(right.name));
}

export function bodyByName(system: DeltaVSystem, name: string) {
  return bodiesForSystem(system).find((candidate) => candidate.name === name);
}

function catalogFor(input: { system: DeltaVSystem; catalog?: DeltaVBody[] }) {
  return input.catalog && input.catalog.length > 0 ? input.catalog : bodiesForSystem(input.system);
}

export function minimumParkingAltitude(body: DeltaVBody) {
  return Math.max(1_000, body.atmosphereDepth + 1_000);
}

function positive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be a positive finite number.`);
  return value;
}

function nonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be a non-negative finite number.`);
  return value;
}

function circularSpeed(mu: number, radius: number) {
  return Math.sqrt(mu / radius);
}

function hyperbolicBurn(bodyDefinition: DeltaVBody, parkingAltitude: number, velocityAtInfinity: number) {
  const radius = bodyDefinition.radius + positive(parkingAltitude, `${bodyDefinition.name} parking altitude`);
  const circular = circularSpeed(bodyDefinition.gravitationalParameter, radius);
  const escape = Math.sqrt(2 * bodyDefinition.gravitationalParameter / radius);
  return Math.sqrt(escape ** 2 + Math.max(0, velocityAtInfinity) ** 2) - circular;
}

function poweredLandingComponents(bodyDefinition: DeltaVBody, parkingAltitude: number) {
  const apoapsis = bodyDefinition.radius + positive(parkingAltitude, `${bodyDefinition.name} parking altitude`);
  const periapsis = bodyDefinition.radius;
  const semiMajorAxis = (apoapsis + periapsis) / 2;
  const circular = circularSpeed(bodyDefinition.gravitationalParameter, apoapsis);
  const transferAtApoapsis = Math.sqrt(bodyDefinition.gravitationalParameter * (2 / apoapsis - 1 / semiMajorAxis));
  const transferAtSurface = Math.sqrt(bodyDefinition.gravitationalParameter * (2 / periapsis - 1 / semiMajorAxis));
  return { deorbit: Math.max(0, circular - transferAtApoapsis), descent: transferAtSurface };
}

function poweredLanding(bodyDefinition: DeltaVBody, parkingAltitude: number) {
  const components = poweredLandingComponents(bodyDefinition, parkingAltitude);
  return components.deorbit + components.descent;
}

function atmosphericDeorbitBurn(bodyDefinition: DeltaVBody, parkingAltitude: number) {
  const apoapsis = bodyDefinition.radius + positive(parkingAltitude, `${bodyDefinition.name} parking altitude`);
  const entryAltitude = Math.min(bodyDefinition.atmosphereDepth * 0.25, Math.max(0, parkingAltitude - 1_000));
  const periapsis = bodyDefinition.radius + entryAltitude;
  const semiMajorAxis = (apoapsis + periapsis) / 2;
  const circular = circularSpeed(bodyDefinition.gravitationalParameter, apoapsis);
  const transferAtApoapsis = Math.sqrt(bodyDefinition.gravitationalParameter * (2 / apoapsis - 1 / semiMajorAxis));
  return Math.max(0, circular - transferAtApoapsis);
}

export interface AerocaptureEstimate {
  available: boolean;
  reserveDeltaV: number;
  periapsisAltitude?: number;
  peakDynamicPressure?: number;
}

function atmosphereDensityAt(bodyDefinition: DeltaVBody, altitude: number) {
  if (altitude < 0 || altitude >= bodyDefinition.atmosphereDepth) return 0;
  let altitudes = bodyDefinition.atmosphereDensityAltitudes;
  let densities = bodyDefinition.atmosphereDensities;
  if (!altitudes || !densities || altitudes.length < 2 || altitudes.length !== densities.length) {
    const synthetic = syntheticAtmosphereCurve(
      bodyDefinition.atmosphereDepth,
      bodyDefinition.gravitationalParameter / bodyDefinition.radius ** 2,
    );
    altitudes = synthetic.altitudes;
    densities = synthetic.densities;
  }
  let upper = altitudes.findIndex((sampleAltitude) => sampleAltitude >= altitude);
  if (upper <= 0) return Math.max(0, densities[0] ?? 0);
  if (upper < 0) upper = altitudes.length - 1;
  const lower = upper - 1;
  const span = Math.max(1e-9, altitudes[upper] - altitudes[lower]);
  const fraction = Math.max(0, Math.min(1, (altitude - altitudes[lower]) / span));
  const lowerDensity = Math.max(1e-30, densities[lower] ?? 0);
  const upperDensity = Math.max(1e-30, densities[upper] ?? 0);
  return Math.exp(Math.log(lowerDensity) + (Math.log(upperDensity) - Math.log(lowerDensity)) * fraction);
}

/**
 * Estimate a density-curve periapsis from arrival speed, then reserve the
 * apoapsis burn that raises periapsis to the requested circular orbit.
 */
function calculateAerocaptureEstimate(
  bodyDefinition: DeltaVBody,
  parkingAltitude: number,
  velocityAtInfinity: number,
): AerocaptureEstimate {
  if (bodyDefinition.atmosphereDepth <= 0 || parkingAltitude <= bodyDefinition.atmosphereDepth) {
    return { available: false, reserveDeltaV: 0 };
  }
  const mu = bodyDefinition.gravitationalParameter;
  const arrivalSpeedAtTop = Math.sqrt(Math.max(0, velocityAtInfinity) ** 2 + 2 * mu / (bodyDefinition.radius + bodyDefinition.atmosphereDepth));
  const targetDynamicPressure = Math.max(500, Math.min(5_000, 5_000 * (2_500 / Math.max(1, arrivalSpeedAtTop)) ** 2));
  let lowerAltitude = 0;
  let upperAltitude = bodyDefinition.atmosphereDepth;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const altitude = (lowerAltitude + upperAltitude) / 2;
    const radius = bodyDefinition.radius + altitude;
    const speed = Math.sqrt(Math.max(0, velocityAtInfinity) ** 2 + 2 * mu / radius);
    const dynamicPressure = 0.5 * atmosphereDensityAt(bodyDefinition, altitude) * speed ** 2;
    if (dynamicPressure > targetDynamicPressure) lowerAltitude = altitude;
    else upperAltitude = altitude;
  }
  const periapsisAltitude = upperAltitude;
  const periapsisRadius = bodyDefinition.radius + periapsisAltitude;
  const apoapsisRadius = bodyDefinition.radius + parkingAltitude;
  const transferAxis = (periapsisRadius + apoapsisRadius) / 2;
  const circularSpeedAtApoapsis = circularSpeed(mu, apoapsisRadius);
  const speedAtApoapsis = Math.sqrt(mu * (2 / apoapsisRadius - 1 / transferAxis));
  const rawReserve = Math.max(0, circularSpeedAtApoapsis - speedAtApoapsis);
  return {
    available: true,
    reserveDeltaV: rawReserve > 0 ? Math.max(AEROCAPTURE_RESERVE_INCREMENT, Math.ceil(rawReserve / AEROCAPTURE_RESERVE_INCREMENT) * AEROCAPTURE_RESERVE_INCREMENT) : 0,
    periapsisAltitude,
    peakDynamicPressure: targetDynamicPressure,
  };
}

export function estimateAerocapture(
  bodyDefinition: DeltaVBody,
  parkingAltitude: number,
  velocityAtInfinity: number,
): AerocaptureEstimate {
  const key = [
    bodyDefinition.name,
    bodyDefinition.gravitationalParameter,
    bodyDefinition.radius,
    bodyDefinition.atmosphereDepth,
    bodyDefinition.atmosphereDensities?.length ?? 0,
    Math.round(parkingAltitude),
    Math.round(Math.max(0, velocityAtInfinity) * 10) / 10,
  ].join("|");
  const cached = aerocaptureEstimateCache.get(key);
  if (cached) return cached;
  const estimate = calculateAerocaptureEstimate(bodyDefinition, parkingAltitude, velocityAtInfinity);
  aerocaptureEstimateCache.set(key, estimate);
  return estimate;
}

function hohmann(originRadius: number, destinationRadius: number, parentMu: number) {
  const transferAxis = (originRadius + destinationRadius) / 2;
  const originCircular = circularSpeed(parentMu, originRadius);
  const destinationCircular = circularSpeed(parentMu, destinationRadius);
  const originTransfer = Math.sqrt(parentMu * (2 / originRadius - 1 / transferAxis));
  const destinationTransfer = Math.sqrt(parentMu * (2 / destinationRadius - 1 / transferAxis));
  const transferTime = Math.PI * Math.sqrt(transferAxis ** 3 / parentMu);
  const phaseAngle = (Math.PI - Math.sqrt(parentMu / destinationRadius ** 3) * transferTime) * 180 / Math.PI;
  return {
    originVelocityChange: Math.abs(originTransfer - originCircular),
    destinationVelocityChange: Math.abs(destinationCircular - destinationTransfer),
    transferTime,
    phaseAngle: ((phaseAngle % 360) + 360) % 360,
  };
}

function idealHohmann(input: {
  originRadius: number;
  destinationRadius: number;
  parentMu: number;
  originBody: DeltaVBody;
  destinationBody: DeltaVBody;
  originAltitude: number;
  destinationAltitude: number;
}) {
  const transfer = hohmann(input.originRadius, input.destinationRadius, input.parentMu);
  return {
    ...transfer,
    arrivalVInfinity: transfer.destinationVelocityChange,
    departureBurn: hyperbolicBurn(input.originBody, input.originAltitude, transfer.originVelocityChange),
    captureBurn: hyperbolicBurn(input.destinationBody, input.destinationAltitude, transfer.destinationVelocityChange),
  };
}

function parkingOrbitAdjustment(bodyDefinition: DeltaVBody, requestedAltitude: number) {
  if (requestedAltitude === bodyDefinition.defaultParkingAltitude) return 0;
  const transfer = hohmann(
    bodyDefinition.radius + bodyDefinition.defaultParkingAltitude,
    bodyDefinition.radius + requestedAltitude,
    bodyDefinition.gravitationalParameter,
  );
  return transfer.originVelocityChange + transfer.destinationVelocityChange;
}

function formatReferenceAltitude(altitude: number) {
  return formatDistance(altitude, "plan");
}

function parentMu(parent: string, catalog: DeltaVBody[]) {
  const definition = catalog.find((candidate) => candidate.name === parent);
  if (definition) return definition.gravitationalParameter;
  const child = catalog.find((candidate) => candidate.parent === parent && candidate.parentGravitationalParameter);
  if (child?.parentGravitationalParameter) return child.parentGravitationalParameter;
  if (parent === "Sun") return SUN_MU;
  throw new RangeError(`Missing parent body data for ${parent}.`);
}

function parentBody(definition: DeltaVBody, catalog: DeltaVBody[]) {
  return catalog.find((candidate) => candidate.name === definition.parent);
}

function primaryBody(definition: DeltaVBody, catalog: DeltaVBody[]) {
  let current = definition;
  while (parentBody(current, catalog)) {
    const next = parentBody(current, catalog)!;
    current = next;
  }
  return current;
}

function pathToPrimary(definition: DeltaVBody, catalog: DeltaVBody[]) {
  const path: DeltaVBody[] = [];
  let current = definition;
  while (parentBody(current, catalog)) {
    path.push(current);
    const next = parentBody(current, catalog)!;
    current = next;
  }
  return path;
}

function parkingAltitudeFor(definition: DeltaVBody, endpointBody: DeltaVBody, requestedAltitude: number) {
  return definition.name === endpointBody.name ? requestedAltitude : definition.defaultParkingAltitude;
}

function poweredArrivalFor(destination: DeltaVBody, destinationEndpoint: MissionEndpoint, strategy: ArrivalStrategy) {
  const atmosphereAvailable = destination.atmosphereDepth > 0;
  const captureRequired = destinationEndpoint === "orbit" || !atmosphereAvailable || strategy.captureBeforeLanding;
  return !atmosphereAvailable || (captureRequired && !strategy.aerocapture);
}

function normalizeRadians(value: number) {
  const turn = 2 * Math.PI;
  return ((value % turn) + turn) % turn;
}

function localTransferWindowFor(
  origin: DeltaVBody,
  destination: DeltaVBody,
  catalog: DeltaVBody[],
  phaseAngle: number | null,
): SerialTransferTiming["localWindow"] {
  if (
    origin.parent !== destination.parent
    || phaseAngle === null
    || origin.orbitEpoch === undefined
    || origin.meanLongitudeAtEpoch === undefined
    || destination.orbitEpoch === undefined
    || destination.meanLongitudeAtEpoch === undefined
  ) return undefined;
  const mu = parentMu(origin.parent, catalog);
  return {
    targetPhaseAngle: phaseAngle * Math.PI / 180,
    originEpoch: origin.orbitEpoch,
    originMeanLongitudeAtEpoch: origin.meanLongitudeAtEpoch,
    originMeanMotion: Math.sqrt(mu / origin.semiMajorAxis ** 3),
    destinationEpoch: destination.orbitEpoch,
    destinationMeanLongitudeAtEpoch: destination.meanLongitudeAtEpoch,
    destinationMeanMotion: Math.sqrt(mu / destination.semiMajorAxis ** 3),
  };
}

/** Earliest recurring ideal local Hohmann window at or after a stop is available. */
export function nextRecurringLocalDepartureUT(timing: SerialTransferTiming, earliestDepartureUT: number) {
  const window = timing.localWindow;
  if (!window || !Number.isFinite(earliestDepartureUT)) return earliestDepartureUT;
  const originLongitude = window.originMeanLongitudeAtEpoch
    + window.originMeanMotion * (earliestDepartureUT - window.originEpoch);
  const destinationLongitude = window.destinationMeanLongitudeAtEpoch
    + window.destinationMeanMotion * (earliestDepartureUT - window.destinationEpoch);
  const currentPhase = normalizeRadians(destinationLongitude - originLongitude);
  const relativeRate = window.destinationMeanMotion - window.originMeanMotion;
  if (Math.abs(relativeRate) < Number.EPSILON) return earliestDepartureUT;
  const wait = relativeRate > 0
    ? normalizeRadians(window.targetPhaseAngle - currentPhase) / relativeRate
    : normalizeRadians(currentPhase - window.targetPhaseAngle) / -relativeRate;
  return earliestDepartureUT + (wait < 0.001 ? 0 : wait);
}

export interface TransferArcRouteInput {
  system: DeltaVSystem;
  catalog?: DeltaVBody[];
  originName: string;
  destinationName: string;
  originParkingAltitude: number;
  destinationParkingAltitude: number;
  destinationEndpoint: MissionEndpoint;
  outboundArrival: ArrivalStrategy;
}

export interface TransferArcsRouteInput extends TransferArcRouteInput {
  direction: MissionDirection;
  returnEndpoint: MissionEndpoint;
  returnArrival: ArrivalStrategy;
}

function transferArcForOneWay(input: {
  catalog: DeltaVBody[];
  origin: DeltaVBody;
  destination: DeltaVBody;
  originParkingAltitude: number;
  destinationParkingAltitude: number;
  destinationEndpoint: MissionEndpoint;
  arrivalStrategy: ArrivalStrategy;
  direction: string;
}): TransferArcDescriptor | null {
  const { catalog, origin, destination, direction } = input;
  if (origin.name === destination.name) return null;

  const finalArrivalPowered = poweredArrivalFor(destination, input.destinationEndpoint, input.arrivalStrategy);
  if (origin.parent === destination.parent) {
    // MechJeb porkchops are reserved for transfers between planetary systems.
    // Sibling moons share a primary and recur frequently enough for the planner's
    // ideal Hohmann model; exposing a full porkchop here adds precision without
    // materially improving the mission-level decision.
    if (catalog.some((candidate) => candidate.name === origin.parent)) return null;
    const id = `${direction}-transfer` as TransferArcId;
    return {
      id,
      direction,
      routeLegId: `${direction}-ejection`,
      label: `${origin.name} to ${destination.name}`,
      origin: origin.name,
      destination: destination.name,
      originParkingAltitude: input.originParkingAltitude,
      destinationParkingAltitude: input.destinationParkingAltitude,
      optimizePoweredCapture: finalArrivalPowered,
    };
  }

  const originPrimary = primaryBody(origin, catalog);
  const destinationPrimary = primaryBody(destination, catalog);
  if (originPrimary.name === destinationPrimary.name) return null;
  const id = `${direction}-solar-transfer` as TransferArcId;
  return {
    id,
    direction,
    routeLegId: `${direction}-primary-ejection`,
    label: `${originPrimary.name} to ${destinationPrimary.name}`,
    origin: originPrimary.name,
    destination: destinationPrimary.name,
    originParkingAltitude: parkingAltitudeFor(originPrimary, origin, input.originParkingAltitude),
    destinationParkingAltitude: parkingAltitudeFor(destinationPrimary, destination, input.destinationParkingAltitude),
    optimizePoweredCapture: destination.name === destinationPrimary.name ? finalArrivalPowered : true,
  };
}

/** All dated primary transfer arcs that MechJeb can solve for this route. */
export function transferArcsForRoute(input: TransferArcsRouteInput): TransferArcDescriptor[] {
  const catalog = catalogFor(input);
  const origin = catalog.find((candidate) => candidate.name === input.originName);
  const destination = catalog.find((candidate) => candidate.name === input.destinationName);
  if (!origin || !destination) return [];

  const outbound = transferArcForOneWay({
    catalog,
    origin,
    destination,
    originParkingAltitude: input.originParkingAltitude,
    destinationParkingAltitude: input.destinationParkingAltitude,
    destinationEndpoint: input.destinationEndpoint,
    arrivalStrategy: input.outboundArrival,
    direction: "outbound",
  });
  const arcs = outbound ? [outbound] : [];
  if (input.direction === "roundTrip") {
    const inbound = transferArcForOneWay({
      catalog,
      origin: destination,
      destination: origin,
      originParkingAltitude: input.destinationParkingAltitude,
      destinationParkingAltitude: input.originParkingAltitude,
      destinationEndpoint: input.returnEndpoint,
      arrivalStrategy: input.returnArrival,
      direction: "return",
    });
    if (inbound) arcs.push(inbound);
  }
  return arcs;
}

/** All dated primary transfer arcs for an ordered start-and-stops route. */
export function transferArcsForSerialRoute(input: SerialMissionRouteInput): TransferArcDescriptor[] {
  const catalog = catalogFor(input);
  let origin = catalog.find((candidate) => candidate.name === input.start.bodyName);
  let originParkingAltitude = input.start.parkingAltitude;
  if (!origin) return [];

  const arcs: TransferArcDescriptor[] = [];
  for (const stop of input.stops) {
    const destination = catalog.find((candidate) => candidate.name === stop.bodyName);
    if (!destination) return [];
    const arc = transferArcForOneWay({
      catalog,
      origin,
      destination,
      originParkingAltitude,
      destinationParkingAltitude: stop.parkingAltitude,
      destinationEndpoint: stop.endpoint,
      arrivalStrategy: stop.arrivalStrategy,
      direction: stop.id,
    });
    if (arc) arcs.push(arc);
    origin = destination;
    originParkingAltitude = stop.parkingAltitude;
  }
  return arcs;
}

/**
 * Modeled coast-time components for each serial segment. Interplanetary arcs
 * are dated by MechJeb; local climbs, descents, and same-system Hohmann legs
 * advance the endpoint timeline without requiring another porkchop.
 */
export function serialTransferTimingsForRoute(input: SerialMissionRouteInput): SerialTransferTiming[] {
  const catalog = catalogFor(input);
  let origin = catalog.find((candidate) => candidate.name === input.start.bodyName);
  let originEndpoint = input.start.endpoint;
  let originParkingAltitude = input.start.parkingAltitude;
  if (!origin) return [];

  const timings: SerialTransferTiming[] = [];
  for (const stop of input.stops) {
    const destination = catalog.find((candidate) => candidate.name === stop.bodyName);
    if (!destination) return [];
    const originPrimary = primaryBody(origin, catalog);
    const destinationPrimary = primaryBody(destination, catalog);
    const interplanetary = originPrimary.name !== destinationPrimary.name;
    if (interplanetary) {
      const climb = climbToPrimary(origin, originParkingAltitude, catalog, `${stop.id}-timing-out`);
      const descent = descendFromPrimary(destination, stop.parkingAltitude, catalog, `${stop.id}-timing-in`);
      timings.push({
        segmentId: stop.id,
        origin: origin.name,
        destination: destination.name,
        interplanetary: true,
        modeledTransferTime: climb.transferTime + descent.transferTime,
        preInterplanetaryTransferTime: climb.transferTime,
        postInterplanetaryTransferTime: descent.transferTime,
      });
    } else {
      const transfer = calculateOneWay({
        origin,
        destination,
        originEndpoint,
        destinationEndpoint: stop.endpoint,
        originParkingAltitude,
        destinationParkingAltitude: stop.parkingAltitude,
        arrivalStrategy: stop.arrivalStrategy,
        catalog,
        idPrefix: `${stop.id}-timing`,
        arrival: stop.id,
      });
      timings.push({
        segmentId: stop.id,
        origin: origin.name,
        destination: destination.name,
        interplanetary: false,
        modeledTransferTime: transfer.transferTime ?? 0,
        preInterplanetaryTransferTime: 0,
        postInterplanetaryTransferTime: 0,
        localWindow: localTransferWindowFor(origin, destination, catalog, transfer.phaseAngle),
      });
    }

    origin = destination;
    originEndpoint = stop.endpoint;
    originParkingAltitude = stop.parkingAltitude;
  }
  return timings;
}

/** Compatibility wrapper for callers that only need the outbound request. */
export function liveTransferRequestFor(input: TransferArcRouteInput): LiveTransferRequest | null {
  const [outbound] = transferArcsForRoute({
    ...input,
    direction: "oneWay",
    returnEndpoint: "orbit",
    returnArrival: input.outboundArrival,
  });
  if (!outbound) return null;
  const { origin, destination, originParkingAltitude, destinationParkingAltitude, optimizePoweredCapture } = outbound;
  return { origin, destination, originParkingAltitude, destinationParkingAltitude, optimizePoweredCapture };
}

export function earliestDownstreamDepartureUT(arrivalUT: number | null | undefined, stayDurationSeconds: number) {
  nonNegative(stayDurationSeconds, "Stay duration");
  if (arrivalUT === null || arrivalUT === undefined || !Number.isFinite(arrivalUT)) return null;
  return arrivalUT + stayDurationSeconds;
}

export function transferTimelineConstraint(
  upstream: Pick<LiveTransferSolution, "arrivalUT"> | undefined,
  stayDurationSeconds: number,
  downstream?: Pick<LiveTransferSolution, "departureUT" | "arrivalUT">,
): TransferTimelineConstraint {
  const earliestDepartureUT = earliestDownstreamDepartureUT(upstream?.arrivalUT, stayDurationSeconds);
  const departureUT = downstream?.departureUT ?? null;
  const arrivalUT = downstream?.arrivalUT ?? null;
  const conflict = earliestDepartureUT !== null && departureUT !== null && departureUT < earliestDepartureUT;
  return {
    earliestDepartureUT,
    departureUT,
    arrivalUT,
    conflict,
    message: conflict ? "Timeline conflict—choose another downstream transfer window." : null,
  };
}

function matchingLiveSolution(
  solution: LiveTransferSolution | undefined,
  request: LiveTransferRequest,
  arcId: TransferArcId,
  allowAnyWindow = false,
) {
  if (!solution) return undefined;
  const altitudeMatches = (left: number, right: number) => Math.abs(left - right) < 0.01;
  return (!solution.arcId || solution.arcId === arcId)
    && solution.origin === request.origin
    && solution.destination === request.destination
    && altitudeMatches(solution.originParkingAltitude, request.originParkingAltitude)
    && altitudeMatches(solution.destinationParkingAltitude, request.destinationParkingAltitude)
    // A user-selected point remains the same physical trajectory if the arrival
    // strategy changes. Its v-infinity can be reused to recompute a powered
    // capture even when the original grid optimized for aerocapture.
    && (allowAnyWindow || solution.optimizePoweredCapture === request.optimizePoweredCapture)
    ? solution
    : undefined;
}

function timelineEntry(solution: LiveTransferSolution, arcId: TransferArcId, direction: string): TransferTimelineEntry {
  return {
    arcId,
    direction,
    departureUT: solution.departureUT,
    arrivalUT: solution.arrivalUT,
    transferTime: solution.transferTime,
    origin: solution.origin,
    destination: solution.destination,
  };
}

function climbToPrimary(
  endpointBody: DeltaVBody,
  endpointAltitude: number,
  catalog: DeltaVBody[],
  idPrefix: string,
) {
  const legs: DeltaVLeg[] = [];
  let transferTime = 0;
  let phaseAngle: number | null = null;
  for (const child of pathToPrimary(endpointBody, catalog)) {
    const parent = catalog.find((candidate) => candidate.name === child.parent);
    if (!parent) continue;
    const childAltitude = parkingAltitudeFor(child, endpointBody, endpointAltitude);
    const parentAltitude = parent.defaultParkingAltitude;
    const parentTransfer = idealHohmann({
      originRadius: child.semiMajorAxis,
      destinationRadius: parent.radius + parentAltitude,
      parentMu: parent.gravitationalParameter,
      originBody: child,
      destinationBody: parent,
      originAltitude: childAltitude,
      destinationAltitude: parentAltitude,
    });
    legs.push({ id: `${idPrefix}-${child.name}-escape`, label: `${child.name} → ${parent.name} transfer`, deltaV: parentTransfer.departureBurn, kind: "departure", note: `Injection toward ${parent.name}` });
    legs.push({
      id: `${idPrefix}-${child.name}-${parent.name}`,
      label: `${formatReferenceAltitude(parentAltitude)} Capture at ${parent.name}`,
      deltaV: parentTransfer.captureBurn,
      kind: "capture",
      note: `Powered capture into the ${formatReferenceAltitude(parentAltitude)} ${parent.name} parking orbit`,
      arrivalVInfinity: parentTransfer.arrivalVInfinity,
    });
    transferTime += parentTransfer.transferTime;
    phaseAngle ??= parentTransfer.phaseAngle;
  }
  return { legs, transferTime, phaseAngle };
}

function descendFromPrimary(
  endpointBody: DeltaVBody,
  endpointAltitude: number,
  catalog: DeltaVBody[],
  idPrefix: string,
) {
  const legs: DeltaVLeg[] = [];
  let transferTime = 0;
  let phaseAngle: number | null = null;
  const path = pathToPrimary(endpointBody, catalog).reverse();
  for (const child of path) {
    const parent = catalog.find((candidate) => candidate.name === child.parent);
    if (!parent) continue;
    const parentAltitude = parent.defaultParkingAltitude;
    const childAltitude = parkingAltitudeFor(child, endpointBody, endpointAltitude);
    const parentTransfer = idealHohmann({
      originRadius: parent.radius + parentAltitude,
      destinationRadius: child.semiMajorAxis,
      parentMu: parent.gravitationalParameter,
      originBody: parent,
      destinationBody: child,
      originAltitude: parentAltitude,
      destinationAltitude: childAltitude,
    });
    legs.push({ id: `${idPrefix}-${parent.name}-${child.name}`, label: `${parent.name} → ${child.name} transfer`, deltaV: parentTransfer.departureBurn, kind: "departure", note: `Injection toward ${child.name}` });
    legs.push({
      id: `${idPrefix}-${child.name}-capture`,
      label: `${formatReferenceAltitude(childAltitude)} Capture at ${child.name}`,
      deltaV: parentTransfer.captureBurn,
      kind: "capture",
      note: `Powered capture into the ${formatReferenceAltitude(childAltitude)} parking orbit`,
      arrivalVInfinity: parentTransfer.arrivalVInfinity,
    });
    transferTime += parentTransfer.transferTime;
    phaseAngle = parentTransfer.phaseAngle;
  }
  return { legs, transferTime, phaseAngle };
}

function transferBetweenParkingOrbits(
  origin: DeltaVBody,
  destination: DeltaVBody,
  originAltitude: number,
  destinationAltitude: number,
  catalog: DeltaVBody[],
  idPrefix: string,
  finalArrivalPowered: boolean,
  liveSolution?: LiveTransferSolution,
  allowAnyLiveWindow = false,
): OneWayPlan {
  if (origin.name === destination.name) return { legs: [], transferTime: null, phaseAngle: null };

  if (destination.parent === origin.name || origin.parent === destination.name) {
    const parent = destination.parent === origin.name ? origin : destination;
    const outward = parent.name === origin.name;
    const transfer = idealHohmann({
      originRadius: outward ? parent.radius + originAltitude : origin.semiMajorAxis,
      destinationRadius: outward ? destination.semiMajorAxis : parent.radius + destinationAltitude,
      parentMu: parent.gravitationalParameter,
      originBody: origin,
      destinationBody: destination,
      originAltitude,
      destinationAltitude,
    });
    return {
      legs: [
        {
          id: `${idPrefix}-ejection`,
          label: `${origin.name} → ${destination.name} transfer`,
          deltaV: transfer.departureBurn,
          kind: "departure",
          note: `${parent.name}-frame Hohmann injection and coast`,
          transferSource: "modeled",
        },
        {
          id: `${idPrefix}-capture`,
          label: `${formatReferenceAltitude(destinationAltitude)} Capture at ${destination.name}`,
          deltaV: transfer.captureBurn,
          kind: "capture",
          note: `Powered capture into the ${formatReferenceAltitude(destinationAltitude)} parking orbit`,
          transferSource: "modeled",
          arrivalVInfinity: transfer.arrivalVInfinity,
        },
      ],
      transferTime: transfer.transferTime,
      phaseAngle: transfer.phaseAngle,
    };
  }

  if (origin.parent === destination.parent) {
    const arcId = `${idPrefix}-transfer` as TransferArcId;
    const live = matchingLiveSolution(liveSolution, {
      origin: origin.name,
      destination: destination.name,
      originParkingAltitude: originAltitude,
      destinationParkingAltitude: destinationAltitude,
      optimizePoweredCapture: finalArrivalPowered,
    }, arcId, allowAnyLiveWindow);
    const transfer = idealHohmann({
      originRadius: origin.semiMajorAxis,
      destinationRadius: destination.semiMajorAxis,
      parentMu: parentMu(origin.parent, catalog),
      originBody: origin,
      destinationBody: destination,
      originAltitude,
      destinationAltitude,
    });
    const departureBurn = live?.ejectionDeltaV ?? transfer.departureBurn;
    const captureBurn = live ? hyperbolicBurn(destination, destinationAltitude, live.arrivalVInfinity) : transfer.captureBurn;
    const transferSource = live ? "mechjeb" as const : "modeled" as const;
    return {
      legs: [
        { id: `${idPrefix}-ejection`, label: `${origin.name} → ${destination.name} transfer`, deltaV: departureBurn, kind: "departure", note: live ? "MechJeb ejection followed by porkchop coast" : `${origin.parent}-frame Hohmann injection and coast`, transferSource, transferArcId: arcId, ...(live ? { departureUT: live.departureUT, arrivalUT: live.arrivalUT } : {}) },
        {
          id: `${idPrefix}-capture`,
          label: `${formatReferenceAltitude(destinationAltitude)} Capture at ${destination.name}`,
          deltaV: captureBurn,
          kind: "capture",
          note: live
            ? `Powered capture into the ${formatReferenceAltitude(destinationAltitude)} parking orbit from MechJeb arrival v-infinity`
            : `Powered capture into the ${formatReferenceAltitude(destinationAltitude)} parking orbit`,
          transferSource,
          transferArcId: arcId,
          arrivalVInfinity: live?.arrivalVInfinity ?? transfer.arrivalVInfinity,
          ...(live ? { departureUT: live.departureUT, arrivalUT: live.arrivalUT } : {}),
        },
      ],
      transferTime: live?.transferTime ?? transfer.transferTime,
      phaseAngle: transfer.phaseAngle,
      ...(live ? { selectedTransfer: timelineEntry(live, arcId, idPrefix) } : {}),
    };
  }

  const originPrimary = primaryBody(origin, catalog);
  const destinationPrimary = primaryBody(destination, catalog);
  const climb = climbToPrimary(origin, originAltitude, catalog, `${idPrefix}-out`);
  const legs = [...climb.legs];
  let transferTime: number | null = climb.transferTime || null;
  let phaseAngle: number | null = climb.phaseAngle;
  let selectedPrimaryTransfer: TransferTimelineEntry | undefined;

  if (originPrimary.name !== destinationPrimary.name) {
    const arcId = `${idPrefix}-solar-transfer` as TransferArcId;
    const primaryOriginAltitude = parkingAltitudeFor(originPrimary, origin, originAltitude);
    const primaryDestinationAltitude = parkingAltitudeFor(destinationPrimary, destination, destinationAltitude);
    const poweredPrimaryArrival = destination.name === destinationPrimary.name ? finalArrivalPowered : true;
    const live = matchingLiveSolution(liveSolution, {
      origin: originPrimary.name,
      destination: destinationPrimary.name,
      originParkingAltitude: primaryOriginAltitude,
      destinationParkingAltitude: primaryDestinationAltitude,
      optimizePoweredCapture: poweredPrimaryArrival,
    }, arcId, allowAnyLiveWindow);
    const transfer = idealHohmann({
      originRadius: originPrimary.semiMajorAxis,
      destinationRadius: destinationPrimary.semiMajorAxis,
      parentMu: parentMu(originPrimary.parent, catalog),
      originBody: originPrimary,
      destinationBody: destinationPrimary,
      originAltitude: primaryOriginAltitude,
      destinationAltitude: primaryDestinationAltitude,
    });
    const departureBurn = live?.ejectionDeltaV ?? transfer.departureBurn;
    const captureBurn = live ? hyperbolicBurn(destinationPrimary, primaryDestinationAltitude, live.arrivalVInfinity) : transfer.captureBurn;
    const transferSource = live ? "mechjeb" as const : "modeled" as const;
    legs.push({ id: `${idPrefix}-primary-ejection`, label: `${originPrimary.name} → ${destinationPrimary.name} transfer`, deltaV: departureBurn, kind: "departure", note: live ? "MechJeb ejection followed by porkchop coast" : "Kerbol-frame Hohmann injection and coast", transferSource, transferArcId: arcId, ...(live ? { departureUT: live.departureUT, arrivalUT: live.arrivalUT } : {}) });
    legs.push({
      id: `${idPrefix}-primary-capture`,
      label: `${formatReferenceAltitude(primaryDestinationAltitude)} Capture at ${destinationPrimary.name}`,
      deltaV: captureBurn,
      kind: "capture",
      note: live
        ? `Powered capture into the ${formatReferenceAltitude(primaryDestinationAltitude)} parking orbit from MechJeb arrival v-infinity`
        : `Powered capture into the ${formatReferenceAltitude(primaryDestinationAltitude)} parking orbit`,
      transferSource,
      transferArcId: arcId,
      arrivalVInfinity: live?.arrivalVInfinity ?? transfer.arrivalVInfinity,
      ...(live ? { departureUT: live.departureUT, arrivalUT: live.arrivalUT } : {}),
    });
    if (live) selectedPrimaryTransfer = timelineEntry(live, arcId, idPrefix);
    transferTime = (transferTime ?? 0) + (live?.transferTime ?? transfer.transferTime);
    phaseAngle = transfer.phaseAngle;
  }

  const descent = descendFromPrimary(destination, destinationAltitude, catalog, `${idPrefix}-in`);
  legs.push(...descent.legs);
  if (descent.transferTime) transferTime = (transferTime ?? 0) + descent.transferTime;
  if (originPrimary.name === destinationPrimary.name && descent.phaseAngle !== null) phaseAngle = descent.phaseAngle;
  return {
    legs,
    transferTime,
    phaseAngle,
    ...(selectedPrimaryTransfer ? { selectedTransfer: selectedPrimaryTransfer } : {}),
  };
}

function calculateOneWay(input: {
  origin: DeltaVBody;
  destination: DeltaVBody;
  originEndpoint: MissionEndpoint;
  destinationEndpoint: MissionEndpoint;
  originParkingAltitude: number;
  destinationParkingAltitude: number;
  arrivalStrategy: ArrivalStrategy;
  catalog: DeltaVBody[];
  idPrefix: string;
  arrival: string;
  liveTransferSolution?: LiveTransferSolution;
  allowAnyLiveWindow?: boolean;
}): OneWayPlan {
  const {
    origin, destination, originEndpoint, destinationEndpoint, originParkingAltitude,
    destinationParkingAltitude, arrivalStrategy, catalog, idPrefix, arrival,
  } = input;
  const legs: DeltaVLeg[] = [];
  if (originEndpoint === "surface") {
    if (!origin.solidSurface) throw new RangeError(`${origin.name} does not have a landable surface.`);
    if (origin.ascentBudget === undefined) throw new RangeError(`No ascent planning allowance is available for ${origin.name}.`);
    const referenceAltitude = origin.defaultParkingAltitude;
    const isSameBodySurfaceToOrbit = origin.name === destination.name && destinationEndpoint === "orbit";
    const ascentTargetAltitude = isSameBodySurfaceToOrbit ? destinationParkingAltitude : originParkingAltitude;
    const adjustmentDeltaV = parkingOrbitAdjustment(origin, ascentTargetAltitude);
    const allowanceSource = origin.source === "live" ? "Generic gravity-and-atmosphere estimate" : "Curated ascent allowance";
    legs.push({
      id: `${idPrefix}-ascent`,
      label: `${origin.name} surface → ${formatReferenceAltitude(isSameBodySurfaceToOrbit ? ascentTargetAltitude : referenceAltitude)} orbit`,
      deltaV: origin.ascentBudget + (isSameBodySurfaceToOrbit ? adjustmentDeltaV : 0),
      kind: "ascent",
      note: isSameBodySurfaceToOrbit && adjustmentDeltaV > 0.01
        ? `${allowanceSource} to the ${formatReferenceAltitude(referenceAltitude)} reference orbit plus ${formatDeltaV(adjustmentDeltaV)} for an ideal two-burn adjustment to the planned ${formatReferenceAltitude(ascentTargetAltitude)} orbit`
        : `${allowanceSource} to the ${formatReferenceAltitude(referenceAltitude)} reference orbit`,
    });
    if (!isSameBodySurfaceToOrbit && adjustmentDeltaV > 0.01) {
      const direction = ascentTargetAltitude > referenceAltitude ? "Raise" : "Lower";
      legs.push({
        id: `${idPrefix}-ascent-orbit-adjustment`,
        label: `${direction} ${origin.name} parking orbit to ${formatReferenceAltitude(ascentTargetAltitude)}`,
        deltaV: adjustmentDeltaV,
        kind: "ascent",
        note: `Ideal two-burn Hohmann adjustment from ${formatReferenceAltitude(referenceAltitude)} to ${formatReferenceAltitude(ascentTargetAltitude)}`,
      });
    }
  }

  const atmosphereAvailable = destination.atmosphereDepth > 0;
  const captureRequired = destinationEndpoint === "orbit" || !atmosphereAvailable || arrivalStrategy.captureBeforeLanding;
  const finalArrivalPowered = poweredArrivalFor(destination, destinationEndpoint, arrivalStrategy);
  const transfer = transferBetweenParkingOrbits(origin, destination, originParkingAltitude, destinationParkingAltitude, catalog, idPrefix, finalArrivalPowered, input.liveTransferSolution, input.allowAnyLiveWindow);
  legs.push(...transfer.legs);

  for (let index = legs.length - 1; index >= 0; index -= 1) {
    const leg = legs[index];
    if (leg.kind !== "capture" || !leg.label.endsWith(`Capture at ${destination.name}`)) continue;
    const aerocaptureEstimate = atmosphereAvailable && captureRequired && arrivalStrategy.aerocapture
      ? estimateAerocapture(destination, destinationParkingAltitude, leg.arrivalVInfinity ?? 0)
      : undefined;
    legs[index] = {
      ...leg,
      arrival,
      atmosphereAvailable,
      destinationEndpoint,
      ...(atmosphereAvailable && !captureRequired
        ? { label: `Direct atmospheric arrival at ${destination.name}`, deltaV: 0, note: "Skip parking-orbit capture and continue directly to entry", atmosphericAssist: "direct-entry" as const }
        : atmosphereAvailable && arrivalStrategy.aerocapture
          ? aerocaptureEstimate?.available
            ? {
              deltaV: aerocaptureEstimate.reserveDeltaV,
              note: `Reference aerocapture at ${Math.round((aerocaptureEstimate.periapsisAltitude ?? 0) / 100) / 10} km; raise periapsis into the ${Math.round(destinationParkingAltitude / 100) / 10} km parking orbit`,
              atmosphericAssist: "aerocapture" as const,
              aerocapturePeriapsisAltitude: aerocaptureEstimate.periapsisAltitude,
              aerocapturePeakDynamicPressure: aerocaptureEstimate.peakDynamicPressure,
              aerocaptureEstimateAvailable: true,
            }
            : {
              deltaV: leg.deltaV,
              note: "Reference vehicle could not close a safe aerocapture; retain the powered-capture reserve",
              atmosphericAssist: "aerocapture" as const,
              aerocaptureEstimateAvailable: false,
            }
          : {}),
    };
    break;
  }

  if (destinationEndpoint === "surface") {
    if (!destination.solidSurface) throw new RangeError(`${destination.name} does not have a landable surface.`);
    const assisted = arrivalStrategy.atmosphericLanding && atmosphereAvailable;
    const continuingFromDestinationOrbit = origin.name === destination.name && originEndpoint === "orbit";
    const landingOrbitAltitude = continuingFromDestinationOrbit ? originParkingAltitude : destinationParkingAltitude;
    const separateDeorbit = continuingFromDestinationOrbit || atmosphereAvailable && arrivalStrategy.captureBeforeLanding;
    let landing = assisted ? arrivalStrategy.assistedLandingReserve : poweredLanding(destination, landingOrbitAltitude);
    if (separateDeorbit) {
      const poweredComponents = poweredLandingComponents(destination, landingOrbitAltitude);
      const deorbit = assisted ? atmosphericDeorbitBurn(destination, landingOrbitAltitude) : poweredComponents.deorbit;
      landing = assisted ? arrivalStrategy.assistedLandingReserve : poweredComponents.descent;
      legs.push({
        id: `${idPrefix}-deorbit`,
        label: `Deorbit at ${destination.name}`,
        deltaV: deorbit,
        kind: "deorbit",
        note: assisted ? "Lower periapsis from parking orbit into the atmosphere" : "Lower periapsis from parking orbit toward the surface",
      });
    }
    legs.push({
      id: `${idPrefix}-landing`,
      label: assisted && atmosphereAvailable
        ? `${destination.name} entry → surface`
        : separateDeorbit
          ? `${destination.name} descent → surface`
          : atmosphereAvailable && !arrivalStrategy.captureBeforeLanding
            ? `${destination.name} entry → surface`
            : `${destination.name} orbit → surface`,
      deltaV: landing,
      kind: "landing",
      note: assisted ? "Atmospheric braking/chutes; assisted landing reserve only" : "Ideal impulsive powered descent",
      arrival,
      atmosphereAvailable,
      destinationEndpoint,
      ...(assisted ? { atmosphericAssist: "landing" as const } : {}),
    });
  }
  return {
    legs,
    transferTime: transfer.transferTime,
    phaseAngle: transfer.phaseAngle,
    ...(transfer.selectedTransfer ? { selectedTransfer: transfer.selectedTransfer } : {}),
  };
}

function insertCustomSteps(baseLegs: DeltaVLeg[], customSteps: CustomDeltaVStep[]) {
  const stepsByAnchor = new Map<string, CustomDeltaVStep[]>();
  customSteps.forEach((step) => {
    const existing = stepsByAnchor.get(step.afterLegId) ?? [];
    existing.push(step);
    stepsByAnchor.set(step.afterLegId, existing);
  });
  const result: DeltaVLeg[] = [];
  const inserted = new Set<string>();
  const appendAfter = (anchorId: string) => {
    for (const step of stepsByAnchor.get(anchorId) ?? []) {
      if (inserted.has(step.id)) continue;
      inserted.add(step.id);
      result.push({
        id: step.id,
        label: step.label.trim() || "Custom maneuver",
        deltaV: step.deltaV,
        kind: "custom",
        note: "User-entered planning estimate",
        custom: true,
      });
      appendAfter(step.id);
    }
  };
  baseLegs.forEach((leg) => {
    result.push(leg);
    appendAfter(leg.id);
  });
  return result;
}

export function calculateDeltaVPlan(input: {
  system: DeltaVSystem;
  catalog?: DeltaVBody[];
  originName: string;
  destinationName: string;
  originEndpoint: MissionEndpoint;
  destinationEndpoint: MissionEndpoint;
  returnEndpoint: MissionEndpoint;
  direction: MissionDirection;
  originParkingAltitude: number;
  destinationParkingAltitude: number;
  outboundArrival: ArrivalStrategy;
  returnArrival: ArrivalStrategy;
  customSteps?: CustomDeltaVStep[];
  marginPercent: number;
  liveTransferSolution?: LiveTransferSolution;
  selectedTransferSolutions?: Partial<Record<ArrivalKey, LiveTransferSolution>>;
}): DeltaVPlan {
  const catalog = catalogFor(input);
  const origin = catalog.find((candidate) => candidate.name === input.originName);
  const destination = catalog.find((candidate) => candidate.name === input.destinationName);
  if (!origin || !destination) throw new RangeError("Choose an origin and destination from the active system profile.");
  positive(input.originParkingAltitude, "Origin parking altitude");
  positive(input.destinationParkingAltitude, "Destination parking altitude");
  const originMinimumParkingAltitude = minimumParkingAltitude(origin);
  const destinationMinimumParkingAltitude = minimumParkingAltitude(destination);
  if (input.originParkingAltitude < originMinimumParkingAltitude) {
    throw new RangeError(`Origin parking altitude for ${origin.name} must be at least ${originMinimumParkingAltitude} m.`);
  }
  if (input.destinationParkingAltitude < destinationMinimumParkingAltitude) {
    throw new RangeError(`Destination parking altitude for ${destination.name} must be at least ${destinationMinimumParkingAltitude} m.`);
  }
  nonNegative(input.outboundArrival.assistedLandingReserve, "Outbound assisted landing reserve");
  nonNegative(input.returnArrival.assistedLandingReserve, "Return assisted landing reserve");
  (input.customSteps ?? []).forEach((step) => nonNegative(step.deltaV, `Custom step ${step.label || step.id}`));
  nonNegative(input.marginPercent, "Planning margin");
  if (input.marginPercent > 100) throw new RangeError("Planning margin must not exceed 100%.");

  const selectedOutbound = input.selectedTransferSolutions?.outbound;
  const outbound = calculateOneWay({
    ...input,
    origin,
    destination,
    arrivalStrategy: input.outboundArrival,
    arrival: "outbound",
    catalog,
    idPrefix: "outbound",
    liveTransferSolution: selectedOutbound ?? input.liveTransferSolution,
    allowAnyLiveWindow: selectedOutbound !== undefined,
  });
  const baseLegs = [...outbound.legs];
  let inbound: OneWayPlan | undefined;
  if (input.direction === "roundTrip") {
    const selectedReturn = input.selectedTransferSolutions?.return;
    inbound = calculateOneWay({
      ...input,
      origin: destination,
      destination: origin,
      originEndpoint: input.destinationEndpoint,
      destinationEndpoint: input.returnEndpoint,
      originParkingAltitude: input.destinationParkingAltitude,
      destinationParkingAltitude: input.originParkingAltitude,
      arrivalStrategy: input.returnArrival,
      arrival: "return",
      catalog,
      idPrefix: "return",
      liveTransferSolution: selectedReturn,
      allowAnyLiveWindow: selectedReturn !== undefined,
    });
    baseLegs.push(...inbound.legs);
  }

  const legs = insertCustomSteps(baseLegs, input.customSteps ?? []);

  const nominalDeltaV = legs.reduce((sum, leg) => sum + leg.deltaV, 0);
  const idealDeltaV = nominalDeltaV;
  const marginDeltaV = nominalDeltaV * input.marginPercent / 100;
  const landingDeltaV = legs.filter((leg) => leg.kind === "deorbit" || leg.kind === "landing").reduce((sum, leg) => sum + leg.deltaV, 0);
  const atmosphericAssistance = legs.some((leg) => leg.atmosphericAssist !== undefined);
  const atmosphericDeorbit = legs.some((leg) => leg.kind === "deorbit" && leg.note.includes("atmosphere"));
  const outboundTransferSource = outbound.legs.some((leg) => leg.transferSource === "mechjeb") ? "mechjeb" : "modeled";
  const returnTransferSource = input.direction === "roundTrip"
    ? inbound?.legs.some((leg) => leg.transferSource === "mechjeb") ? "mechjeb" : "modeled"
    : null;
  const transferTimeline: Partial<Record<ArrivalKey, TransferTimelineEntry>> = {};
  if (outbound.selectedTransfer) transferTimeline.outbound = outbound.selectedTransfer;
  if (inbound?.selectedTransfer) transferTimeline.return = inbound.selectedTransfer;
  return {
    origin,
    destination,
    direction: input.direction,
    legs,
    idealDeltaV,
    nominalDeltaV,
    marginDeltaV,
    totalDeltaV: nominalDeltaV + marginDeltaV,
    landingDeltaV,
    atmosphericAssistance,
    transferTime: outbound.transferTime,
    phaseAngle: outbound.phaseAngle,
    assumptions: [
      "Coplanar, circular starting orbits and ideal impulsive burns.",
      outboundTransferSource === "mechjeb" && returnTransferSource === "mechjeb"
        ? "The selected outbound and return primary transfers use read-only MechJeb porkchop solutions; local moon legs remain planner estimates."
        : outboundTransferSource === "mechjeb"
        ? "The outbound primary transfer uses a read-only MechJeb porkchop solution; local moon legs and any unselected return remain planner estimates."
        : returnTransferSource === "mechjeb"
        ? "The return primary transfer uses a read-only MechJeb porkchop solution; the outbound and local moon legs remain planner estimates."
        : "Transfer figures use patched-conic Hohmann planning; inclination and correction burns are excluded.",
      atmosphericAssistance
        ? `Selected atmospheric steps may use direct entry, aerocapture, atmospheric braking and/or parachutes; aerocapture periapses use the live density curve and a speed-scaled 0.5â€“5 kPa target, then round the periapsis-raising burn up to ${AEROCAPTURE_RESERVE_INCREMENT} m/s.`
        : "Powered landing is an ideal lower bound; terrain, finite-burn and hover losses are excluded.",
      "Surface ascent values are planning-map allowances to each body's reference parking orbit and depend on the vehicle and ascent profile; selecting another altitude adds an ideal two-burn Hohmann orbit adjustment.",
      "Connected body data supports Stock and conventional Kopernicus systems exposed through kRPC; custom gravity, atmosphere, or multi-star mechanics outside those APIs may require manual route steps.",
      ...(atmosphericDeorbit ? ["Capture-first atmospheric landings include a deorbit burn targeting an entry periapsis at 25% of the modeled atmosphere depth."] : []),
      ...(legs.some((leg) => leg.custom) ? ["Custom route steps are user-entered estimates and are included in the nominal total and planning margin."] : []),
    ],
    outboundTransferSource,
    returnTransferSource,
    transferTimeline,
  };
}

export function calculateSerialDeltaVPlan(input: SerialMissionRouteInput & {
  customSteps?: CustomDeltaVStep[];
  marginPercent: number;
  selectedTransferSolutions?: Partial<Record<string, LiveTransferSolution>>;
}): DeltaVPlan {
  const catalog = catalogFor(input);
  const origin = catalog.find((candidate) => candidate.name === input.start.bodyName);
  if (!origin) throw new RangeError("Choose a valid mission start from the active system profile.");
  if (input.stops.length === 0) throw new RangeError("Add at least one next stop to calculate a mission route.");
  if (new Set(input.stops.map((stop) => stop.id)).size !== input.stops.length) {
    throw new RangeError("Mission stop IDs must be unique.");
  }

  const validateLocation = (body: DeltaVBody, parkingAltitude: number, label: string) => {
    positive(parkingAltitude, `${label} parking altitude`);
    const minimum = minimumParkingAltitude(body);
    if (parkingAltitude < minimum) {
      throw new RangeError(`${label} parking altitude for ${body.name} must be at least ${minimum} m.`);
    }
  };
  validateLocation(origin, input.start.parkingAltitude, "Start");
  (input.customSteps ?? []).forEach((step) => nonNegative(step.deltaV, `Custom step ${step.label || step.id}`));
  nonNegative(input.marginPercent, "Planning margin");
  if (input.marginPercent > 100) throw new RangeError("Planning margin must not exceed 100%.");

  const baseLegs: DeltaVLeg[] = [];
  const transferTimeline: Partial<Record<string, TransferTimelineEntry>> = {};
  const transferSources: Array<"modeled" | "mechjeb"> = [];
  let transferTime: number | null = null;
  let phaseAngle: number | null = null;
  let currentBody = origin;
  let currentEndpoint = input.start.endpoint;
  let currentParkingAltitude = input.start.parkingAltitude;

  for (const [index, stop] of input.stops.entries()) {
    const destination = catalog.find((candidate) => candidate.name === stop.bodyName);
    if (!destination) throw new RangeError(`Choose a valid body for stop ${index + 1}.`);
    validateLocation(destination, stop.parkingAltitude, `Stop ${index + 1}`);
    nonNegative(stop.arrivalStrategy.assistedLandingReserve, `Stop ${index + 1} assisted landing reserve`);
    const selectedSolution = input.selectedTransferSolutions?.[stop.id];
    const segment = calculateOneWay({
      origin: currentBody,
      destination,
      originEndpoint: currentEndpoint,
      destinationEndpoint: stop.endpoint,
      originParkingAltitude: currentParkingAltitude,
      destinationParkingAltitude: stop.parkingAltitude,
      arrivalStrategy: stop.arrivalStrategy,
      catalog,
      idPrefix: stop.id,
      arrival: stop.id,
      liveTransferSolution: selectedSolution,
      allowAnyLiveWindow: selectedSolution !== undefined,
    });
    baseLegs.push(...segment.legs);
    if (segment.transferTime !== null) transferTime = (transferTime ?? 0) + segment.transferTime;
    if (phaseAngle === null && segment.phaseAngle !== null) phaseAngle = segment.phaseAngle;
    if (segment.selectedTransfer) transferTimeline[stop.id] = segment.selectedTransfer;
    transferSources.push(segment.legs.some((leg) => leg.transferSource === "mechjeb") ? "mechjeb" : "modeled");
    currentBody = destination;
    currentEndpoint = stop.endpoint;
    currentParkingAltitude = stop.parkingAltitude;
  }

  const destination = currentBody;
  const legs = insertCustomSteps(baseLegs, input.customSteps ?? []);
  const nominalDeltaV = legs.reduce((sum, leg) => sum + leg.deltaV, 0);
  const idealDeltaV = nominalDeltaV;
  const marginDeltaV = nominalDeltaV * input.marginPercent / 100;
  const landingDeltaV = legs.filter((leg) => leg.kind === "deorbit" || leg.kind === "landing").reduce((sum, leg) => sum + leg.deltaV, 0);
  const atmosphericAssistance = legs.some((leg) => leg.atmosphericAssist !== undefined);
  const atmosphericDeorbit = legs.some((leg) => leg.kind === "deorbit" && leg.note.includes("atmosphere"));
  const selectedCount = transferSources.filter((source) => source === "mechjeb").length;

  return {
    origin,
    destination,
    direction: "oneWay",
    legs,
    idealDeltaV,
    nominalDeltaV,
    marginDeltaV,
    totalDeltaV: nominalDeltaV + marginDeltaV,
    landingDeltaV,
    atmosphericAssistance,
    transferTime,
    phaseAngle,
    assumptions: [
      "Coplanar, circular starting orbits and ideal impulsive burns.",
      selectedCount
        ? `${selectedCount} selected primary transfer${selectedCount === 1 ? " uses" : "s use"} read-only MechJeb porkchop solutions; unselected transfers and local moon legs remain planner estimates.`
        : "Transfer figures use patched-conic Hohmann planning; inclination and correction burns are excluded.",
      atmosphericAssistance
        ? `Selected atmospheric steps may use direct entry, aerocapture, atmospheric braking and/or parachutes; aerocapture periapses use the live density curve and a speed-scaled 0.5â€“5 kPa target, then round the periapsis-raising burn up to ${AEROCAPTURE_RESERVE_INCREMENT} m/s.`
        : "Powered landing is an ideal lower bound; terrain, finite-burn and hover losses are excluded.",
      "Surface ascent values are planning-map allowances to each body's reference parking orbit and depend on the vehicle and ascent profile; selecting another altitude adds an ideal two-burn Hohmann orbit adjustment.",
      "Connected body data supports Stock and conventional Kopernicus systems exposed through kRPC; custom gravity, atmosphere, or multi-star mechanics outside those APIs may require manual route steps.",
      ...(atmosphericDeorbit ? ["Capture-first atmospheric landings include a deorbit burn targeting an entry periapsis at 25% of the modeled atmosphere depth."] : []),
      ...(legs.some((leg) => leg.custom) ? ["Custom route steps are user-entered estimates and are included in the nominal total and planning margin."] : []),
    ],
    outboundTransferSource: transferSources[0] ?? "modeled",
    returnTransferSource: null,
    transferTimeline,
  };
}

export function formatDeltaV(value: number) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value))} m/s`;
}

export function formatTransferDuration(seconds: number | null, kerbin = true) {
  if (seconds === null || !Number.isFinite(seconds)) return "Local operation";
  const secondsPerDay = (kerbin ? 6 : 24) * 60 * 60;
  const secondsPerYear = (kerbin ? 426 : 365) * secondsPerDay;
  const years = Math.floor(seconds / secondsPerYear);
  const days = Math.floor((seconds - years * secondsPerYear) / secondsPerDay);
  const hours = Math.floor((seconds - years * secondsPerYear - days * secondsPerDay) / 3600);
  return [years ? `${years}y` : "", days ? `${days}d` : "", `${hours}h`].filter(Boolean).join(" ");
}
