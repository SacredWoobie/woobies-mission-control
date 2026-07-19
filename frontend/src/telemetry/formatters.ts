export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatSi(value: number | undefined, decimalPlaces = 1) {
  if (!isFiniteNumber(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute >= 1e9) return `${(value / 1e9).toFixed(decimalPlaces)}G`;
  if (absolute >= 1e6) return `${(value / 1e6).toFixed(decimalPlaces)}M`;
  if (absolute >= 1e3) return `${(value / 1e3).toFixed(decimalPlaces)}k`;
  return value.toFixed(decimalPlaces);
}

export function formatResourceAmount(
  value: number | undefined,
  maximum: number | undefined,
) {
  if (!isFiniteNumber(value)) return "—";
  const scale = isFiniteNumber(maximum) ? Math.abs(maximum) : Math.abs(value);
  const decimalPlaces =
    scale < 0.01 ? 3 :
    scale < 0.1 ? 2 :
    scale < 10 ? 1 : 0;
  return formatSi(value, decimalPlaces);
}

export function formatDeltaV(value: number | undefined) {
  if (!isFiniteNumber(value)) return "—";
  const decimalPlaces = Math.abs(value) >= 1000 ? 0 : 1;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  });
}

export function formatDuration(seconds: number | undefined) {
  if (!isFiniteNumber(seconds)) return "—";
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const remainder = Math.floor(clamped % 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function formatMissionDuration(seconds: number | undefined, kerbin = true) {
  if (!isFiniteNumber(seconds)) return "—";
  let remaining = Math.max(0, seconds);
  const secondsPerDay = kerbin ? 21_600 : 86_400;
  const days = Math.floor(remaining / secondsPerDay);
  remaining -= days * secondsPerDay;
  const base = formatDuration(remaining);
  return days > 0 ? `${days}d ${base}` : base;
}

export function formatCountdown(seconds: number | undefined, kerbin = true) {
  if (!isFiniteNumber(seconds)) return "—";
  return seconds >= 1e6 ? "∞" : formatMissionDuration(seconds, kerbin);
}

export function formatDistance(value: number | undefined) {
  if (!isFiniteNumber(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute >= 1e6) return `${(value / 1e6).toFixed(2)}\u2009Mm`;
  if (absolute >= 1e3) return `${(value / 1e3).toFixed(absolute >= 1e4 ? 1 : 2)}\u2009km`;
  return `${value.toFixed(0)}\u2009m`;
}

export function formatAscensionDistance(value: number | undefined) {
  if (!isFiniteNumber(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute < 1e3) return `${value.toFixed(0)}\u2009m`;
  if (absolute < 1e6) return `${(value / 1e3).toFixed(absolute < 1e5 ? 3 : 2)}\u2009km`;
  if (absolute < 1e9) {
    const decimals = absolute < 1e7 ? 4 : absolute < 1e8 ? 2 : 1;
    return `${(value / 1e6).toFixed(decimals)}\u2009Mm`;
  }
  const decimals = absolute < 1e10 ? 3 : absolute < 1e11 ? 2 : 1;
  return `${(value / 1e9).toFixed(decimals)}\u2009Gm`;
}

export function formatSpeed(value: number | undefined) {
  return isFiniteNumber(value) ? `${value.toFixed(1)}\u2009m/s` : "—";
}

export function formatDegrees(value: number | undefined) {
  return isFiniteNumber(value) ? `${value.toFixed(2)}°` : "—";
}

export function formatTelemetryNumber(value: number | undefined) {
  return isFiniteNumber(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: 1 })
    : "—";
}

export function formatRate(value: number | undefined, unit: string) {
  const formatted = formatTelemetryNumber(value);
  return formatted === "—" ? formatted : `${formatted} ${unit}`;
}

export function formatSignalDelay(value: number | null | undefined) {
  if (!isFiniteNumber(value)) return "—";
  if (value < 1) return `${Math.round(value * 1000)} ms`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function formatUniversalTime(seconds: number | undefined, kerbin = true) {
  if (!isFiniteNumber(seconds)) return { big: "—", sub: "" };
  const secondsPerDay = kerbin ? 21_600 : 86_400;
  const daysPerYear = kerbin ? 426 : 365;
  const secondsPerYear = secondsPerDay * daysPerYear;
  let remaining = Math.max(0, seconds);
  const year = Math.floor(remaining / secondsPerYear);
  remaining -= year * secondsPerYear;
  const day = Math.floor(remaining / secondsPerDay);
  remaining -= day * secondsPerDay;
  return {
    big: `Y${year + 1} · D${day + 1}`,
    sub: `${formatMissionDuration(remaining, kerbin)} · UT ${Math.floor(seconds).toLocaleString("en-US")}`,
  };
}

export function humanizeResourceName(name: string) {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}
