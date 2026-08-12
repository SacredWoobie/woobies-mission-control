export type DistancePreset = "live" | "context" | "plan";

export interface FormattedPair {
  value: string;
  capacity: string;
  combined: string;
  suffix: "" | "k" | "M" | "G";
  decimals: number;
}

export const VACUUM_PRESSURE_ATM = 0.005;
export const RADIAL_VELOCITY_EPSILON = 0.05;

const THIN_SPACE = "\u2009";
const UNAVAILABLE = "\u2014";

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeRoundedZero(value: number, decimals: number) {
  return Object.is(Number(value.toFixed(decimals)), -0) ? 0 : value;
}

function fixed(
  value: number,
  decimals: number,
  useGrouping = true,
) {
  return normalizeRoundedZero(value, decimals).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping,
  });
}

function adaptive(value: number, maximumDecimals: number) {
  const normalized = normalizeRoundedZero(value, maximumDecimals);
  return normalized.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maximumDecimals,
  });
}

function resourceScale(magnitude: number) {
  if (magnitude >= 1e9) return 1e9;
  if (magnitude >= 1e6) return 1e6;
  if (magnitude >= 1e4) return 1e3;
  return 1;
}

function resourceSuffix(scale: number): FormattedPair["suffix"] {
  if (scale === 1e9) return "G";
  if (scale === 1e6) return "M";
  if (scale === 1e3) return "k";
  return "";
}

function resourceDecimals(high: number) {
  return high < 10 ? 2 : high < 100 ? 1 : 0;
}

function roundsToZero(value: number, scale: number, decimals: number) {
  return value !== 0 && Number((value / scale).toFixed(decimals)) === 0;
}

function resourceOperand(
  value: number | undefined,
  scale: number,
  decimals: number,
  suffix: FormattedPair["suffix"],
) {
  if (!isFiniteNumber(value)) return UNAVAILABLE;
  if (roundsToZero(value, scale, decimals)) {
    const floor = 10 ** -decimals * scale;
    return value < 0
      ? `>${fixed(-floor / scale, decimals, false)}${suffix}`
      : `<${fixed(floor / scale, decimals, false)}${suffix}`;
  }
  return `${fixed(value / scale, decimals)}${suffix}`;
}

/**
 * Formats stored/capacity values as one display unit. Both operands always use
 * the same scale, decimal count, and suffix.
 */
export function formatResourcePair(
  value: number | undefined,
  capacity: number | undefined,
): FormattedPair {
  const operands = [value, capacity].filter(isFiniteNumber);
  if (operands.length === 0) {
    return {
      value: UNAVAILABLE,
      capacity: UNAVAILABLE,
      combined: `${UNAVAILABLE} / ${UNAVAILABLE}`,
      suffix: "",
      decimals: 0,
    };
  }

  const highRaw = Math.max(...operands.map((operand) => Math.abs(operand)));
  let scale = resourceScale(highRaw);
  let high = highRaw / scale;
  let decimals = resourceDecimals(high);

  const roundedRaw = Number(high.toFixed(decimals)) * scale;
  const roundedScale = resourceScale(Math.abs(roundedRaw));
  if (roundedScale !== scale) {
    scale = roundedScale;
    high = highRaw / scale;
    decimals = resourceDecimals(high);
  }

  const precisionBound = decimals + 2;
  while (
    decimals < precisionBound
    && operands.some((operand) => roundsToZero(operand, scale, decimals))
  ) {
    decimals += 1;
  }

  const suffix = resourceSuffix(scale);
  const formattedValue = resourceOperand(value, scale, decimals, suffix);
  const formattedCapacity = resourceOperand(capacity, scale, decimals, suffix);
  return {
    value: formattedValue,
    capacity: formattedCapacity,
    combined: `${formattedValue} / ${formattedCapacity}`,
    suffix,
    decimals,
  };
}

export function formatStageDeltaV(value: number | undefined) {
  return isFiniteNumber(value) ? fixed(value, 0) : UNAVAILABLE;
}

export function formatRateColumn(value: number | undefined, unit: string) {
  return isFiniteNumber(value) ? `${fixed(value, 1)} ${unit}` : UNAVAILABLE;
}

export function formatTemperature(value: number | undefined, includeUnit = false) {
  if (!isFiniteNumber(value)) return UNAVAILABLE;
  const rendered = fixed(value, 0);
  return includeUnit ? `${rendered} K` : rendered;
}

export function formatTwr(value: number | undefined) {
  return isFiniteNumber(value) ? fixed(value, 2) : UNAVAILABLE;
}

export function formatPercent(value: number | undefined, includeUnit = true) {
  if (!isFiniteNumber(value)) return UNAVAILABLE;
  const rendered = fixed(value, 0);
  return includeUnit ? `${rendered}%` : rendered;
}

export function formatScienceColumn(value: number | undefined) {
  return isFiniteNumber(value) ? fixed(value, 1) : UNAVAILABLE;
}

export function formatScienceInline(value: number | undefined) {
  return isFiniteNumber(value) ? adaptive(value, 1) : UNAVAILABLE;
}

function distanceBand(
  magnitude: number,
  preset: DistancePreset,
): { scale: number; decimals: number; unit: "m" | "km" | "Mm" | "Gm" } {
  if (preset === "live") {
    if (magnitude < 1e3) return { scale: 1, decimals: 0, unit: "m" };
    if (magnitude < 1e5) return { scale: 1e3, decimals: 3, unit: "km" };
    if (magnitude < 1e6) return { scale: 1e3, decimals: 2, unit: "km" };
    if (magnitude < 1e7) return { scale: 1e6, decimals: 4, unit: "Mm" };
    if (magnitude < 1e8) return { scale: 1e6, decimals: 2, unit: "Mm" };
    if (magnitude < 1e9) return { scale: 1e6, decimals: 1, unit: "Mm" };
    if (magnitude < 1e10) return { scale: 1e9, decimals: 3, unit: "Gm" };
    if (magnitude < 1e11) return { scale: 1e9, decimals: 2, unit: "Gm" };
    return { scale: 1e9, decimals: 1, unit: "Gm" };
  }

  if (preset === "context") {
    if (magnitude < 1e3) return { scale: 1, decimals: 0, unit: "m" };
    if (magnitude < 1e5) return { scale: 1e3, decimals: 2, unit: "km" };
    if (magnitude < 1e6) return { scale: 1e3, decimals: 1, unit: "km" };
    if (magnitude < 1e7) return { scale: 1e6, decimals: 3, unit: "Mm" };
    if (magnitude < 1e8) return { scale: 1e6, decimals: 1, unit: "Mm" };
    if (magnitude < 1e9) return { scale: 1e6, decimals: 0, unit: "Mm" };
    if (magnitude < 1e10) return { scale: 1e9, decimals: 2, unit: "Gm" };
    if (magnitude < 1e11) return { scale: 1e9, decimals: 1, unit: "Gm" };
    return { scale: 1e9, decimals: 0, unit: "Gm" };
  }

  if (magnitude < 1e5) return { scale: 1e3, decimals: 1, unit: "km" };
  if (magnitude < 1e6) return { scale: 1e3, decimals: 0, unit: "km" };
  if (magnitude < 1e8) return { scale: 1e6, decimals: 2, unit: "Mm" };
  if (magnitude < 1e9) return { scale: 1e6, decimals: 1, unit: "Mm" };
  if (magnitude < 1e11) return { scale: 1e9, decimals: 2, unit: "Gm" };
  return { scale: 1e9, decimals: 1, unit: "Gm" };
}

function displayDistanceBand(
  magnitude: number,
  preset: DistancePreset,
) {
  let band = distanceBand(magnitude, preset);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const roundedMagnitude = Number(fixed(magnitude / band.scale, band.decimals, false)) * band.scale;
    const roundedBand = distanceBand(roundedMagnitude, preset);
    if (
      roundedBand.scale === band.scale
      && roundedBand.decimals === band.decimals
      && roundedBand.unit === band.unit
    ) {
      return band;
    }
    band = roundedBand;
  }
  return band;
}

export function formatDistance(
  meters: number | undefined,
  preset: DistancePreset,
) {
  if (!isFiniteNumber(meters)) return UNAVAILABLE;
  const band = displayDistanceBand(Math.abs(meters), preset);
  return `${fixed(meters / band.scale, band.decimals)}${THIN_SPACE}${band.unit}`;
}

export function formatDockingOffset(meters: number | undefined) {
  return isFiniteNumber(meters) ? `${fixed(meters, 1)}${THIN_SPACE}m` : UNAVAILABLE;
}

export function formatAlignmentAngle(degrees: number | undefined) {
  return isFiniteNumber(degrees) ? `${fixed(degrees, 1)}\u00b0` : UNAVAILABLE;
}

export function formatHeadingDegrees(value: number | undefined) {
  if (!isFiniteNumber(value)) return "---";
  const normalized = ((value % 360) + 360) % 360;
  return fixed(normalized, 0, false).padStart(3, "0");
}

export function formatAttitudeDegrees(
  value: number | undefined,
  showPositiveSign = false,
) {
  if (!isFiniteNumber(value)) return "--";
  const rendered = fixed(value, 0, false);
  return showPositiveSign && Number(rendered) > 0 ? `+${rendered}` : rendered;
}

export function formatSpeed(value: number | undefined) {
  return isFiniteNumber(value) ? `${fixed(value, 1)}${THIN_SPACE}m/s` : UNAVAILABLE;
}

export function formatInclination(value: number | undefined) {
  return isFiniteNumber(value) ? `${fixed(value, 2)}\u00b0` : UNAVAILABLE;
}

export function formatEccentricity(value: number | undefined) {
  return isFiniteNumber(value) ? fixed(value, 4) : UNAVAILABLE;
}

export function formatPressure(value: number | undefined) {
  if (!isFiniteNumber(value)) return "current conditions";
  if (value < VACUUM_PRESSURE_ATM) return "vacuum";
  return `${fixed(value, value < 0.1 ? 3 : 2)} atm`;
}

export function formatDuration(seconds: number | undefined) {
  if (!isFiniteNumber(seconds)) return UNAVAILABLE;
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const remainder = Math.floor(clamped % 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function formatMissionDuration(seconds: number | undefined, kerbin = true) {
  if (!isFiniteNumber(seconds)) return UNAVAILABLE;
  let remaining = Math.max(0, seconds);
  const secondsPerDay = kerbin ? 21_600 : 86_400;
  const days = Math.floor(remaining / secondsPerDay);
  remaining -= days * secondsPerDay;
  const base = formatDuration(remaining);
  return days > 0 ? `${days}d ${base}` : base;
}

export function formatOrbitApoapsisCountdown(
  seconds: number | undefined,
  eccentricity: number | undefined,
  kerbin = true,
) {
  return isFiniteNumber(eccentricity) && eccentricity >= 1
    ? "\u221e"
    : formatMissionDuration(seconds, kerbin);
}

export function formatOrbitPeriapsisCountdown(
  seconds: number | undefined,
  eccentricity: number | undefined,
  radialVelocity: number | undefined,
  kerbin = true,
) {
  if (!isFiniteNumber(eccentricity) || eccentricity < 1) {
    return formatMissionDuration(seconds, kerbin);
  }
  if (!isFiniteNumber(radialVelocity)) return UNAVAILABLE;
  if (Math.abs(radialVelocity) <= RADIAL_VELOCITY_EPSILON) return "NOW";
  return radialVelocity < -RADIAL_VELOCITY_EPSILON
    ? formatMissionDuration(seconds, kerbin)
    : UNAVAILABLE;
}

export function formatOrbitPeriod(
  seconds: number | undefined,
  eccentricity: number | undefined,
  kerbin = true,
) {
  return isFiniteNumber(eccentricity) && eccentricity >= 1
    ? UNAVAILABLE
    : formatMissionDuration(seconds, kerbin);
}

export function formatSignalDelay(value: number | null | undefined) {
  if (!isFiniteNumber(value)) return UNAVAILABLE;
  if (value < 1) return `${Math.round(value * 1000)} ms`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function formatUniversalTime(seconds: number | undefined, kerbin = true) {
  if (!isFiniteNumber(seconds)) return { big: UNAVAILABLE, sub: "" };
  const secondsPerDay = kerbin ? 21_600 : 86_400;
  const daysPerYear = kerbin ? 426 : 365;
  const secondsPerYear = secondsPerDay * daysPerYear;
  let remaining = Math.max(0, seconds);
  const year = Math.floor(remaining / secondsPerYear);
  remaining -= year * secondsPerYear;
  const day = Math.floor(remaining / secondsPerDay);
  remaining -= day * secondsPerDay;
  return {
    big: `Y${year + 1} \u00b7 D${day + 1}`,
    sub: `${formatMissionDuration(remaining, kerbin)} \u00b7 UT ${fixed(Math.floor(seconds), 0)}`,
  };
}

export function formatTelemetryNumber(value: number | undefined) {
  return isFiniteNumber(value) ? adaptive(value, 1) : UNAVAILABLE;
}

export function humanizeResourceName(name: string) {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}
