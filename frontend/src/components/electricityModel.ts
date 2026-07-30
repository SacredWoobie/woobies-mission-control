import { formatRateColumn, humanizeResourceName, isFiniteNumber } from "../formatting/numbers";
import type {
  ElectricitySourceKind,
  ElectricitySourceTelemetry,
  ReactorTelemetry,
  SolarForecastTelemetry,
  TelemetrySnapshot,
} from "../telemetry/types";

export type ElectricityTone = "ok" | "warn" | "danger" | "unknown";

export interface ElectricitySourceViewModel {
  kind: ElectricitySourceKind;
  label: string;
  count: number;
  activeCount?: number;
  outputEcPerSec?: number;
  maxEcPerSec?: number;
  state?: string;
  detail?: string;
  runtimeSeconds?: number;
  limitingResource?: string;
}

export interface ElectricityStatusViewModel {
  label: string;
  detail: string;
  tone: ElectricityTone;
}

export interface ElectricityViewModel {
  tier: 1 | 2 | 3;
  sources: ElectricitySourceViewModel[];
  primarySource?: ElectricitySourceViewModel;
  reactors: ReactorTelemetry[];
  generationEcPerSec?: number;
  drawEcPerSec?: number;
  netEcPerSec?: number;
  flowState: "valid" | "calibrating" | "saturated" | "unavailable";
  chargeCurrent?: number;
  chargeMaximum?: number;
  chargeFraction?: number;
  etaKind: "full" | "empty" | "steady" | "calibrating" | "unavailable";
  etaSeconds?: number;
  status: ElectricityStatusViewModel;
  solarForecast?: SolarForecastTelemetry;
}

const sourceOrder: ElectricitySourceKind[] = [
  "reactor",
  "rtg",
  "solar",
  "fuel-cell",
  "other",
];

const sourceLabels: Record<ElectricitySourceKind, string> = {
  reactor: "Reactors",
  solar: "Solar",
  rtg: "RTG",
  "fuel-cell": "Fuel cell",
  other: "Other",
};

function finiteOrUndefined(value: unknown) {
  return isFiniteNumber(value) ? value : undefined;
}

function sourceFromTelemetry(source: ElectricitySourceTelemetry): ElectricitySourceViewModel | null {
  if (!sourceOrder.includes(source.kind)) return null;
  const count = isFiniteNumber(source.count) ? Math.max(0, Math.floor(source.count)) : 0;
  const output = finiteOrUndefined(source.outputEcPerSec);
  if (count <= 0 && !(isFiniteNumber(output) && Math.abs(output) > 0.05)) return null;
  const limitingResource = source.limitingResource?.trim() || undefined;
  return {
    kind: source.kind,
    label: source.label?.trim() || sourceLabels[source.kind],
    count: Math.max(1, count),
    activeCount: finiteOrUndefined(source.activeCount),
    outputEcPerSec: output,
    maxEcPerSec: finiteOrUndefined(source.maxEcPerSec),
    state: source.state?.trim() || undefined,
    detail: source.detail?.trim()
      || (limitingResource ? `limited by ${humanizeResourceName(limitingResource)}` : undefined),
    runtimeSeconds: finiteOrUndefined(source.runtimeSeconds),
    limitingResource,
  };
}

function legacySources(snapshot: TelemetrySnapshot, reactors: ReactorTelemetry[]) {
  const sources: ElectricitySourceViewModel[] = [];
  if (reactors.length > 0) {
    sources.push({
      kind: "reactor",
      label: sourceLabels.reactor,
      count: reactors.length,
      activeCount: reactors.filter((reactor) => reactor.on).length,
      outputEcPerSec: reactors.reduce((sum, reactor) => sum + (finiteOrUndefined(reactor.ecPerSec) ?? 0), 0),
      maxEcPerSec: reactors.reduce((sum, reactor) => sum + (finiteOrUndefined(reactor.ecMax) ?? 0), 0),
    });
  }

  const solarCount = finiteOrUndefined(snapshot["solar.count"]) ?? 0;
  if (solarCount > 0) {
    const efficiency = finiteOrUndefined(snapshot["solar.efficiency"]);
    sources.push({
      kind: "solar",
      label: sourceLabels.solar,
      count: Math.floor(solarCount),
      outputEcPerSec: finiteOrUndefined(snapshot["solar.outputEcPerSec"]),
      state: efficiency === undefined ? undefined : efficiency > 0.01 ? "Sunlit" : "Shadow",
      detail: efficiency === undefined ? undefined : `${Math.round(efficiency * 100)}% efficiency`,
    });
  }

  const rtgCount = finiteOrUndefined(snapshot["rtg.count"]) ?? 0;
  if (rtgCount > 0) {
    sources.push({
      kind: "rtg",
      label: sourceLabels.rtg,
      count: Math.floor(rtgCount),
      activeCount: Math.floor(rtgCount),
      outputEcPerSec: finiteOrUndefined(snapshot["rtg.outputEcPerSec"]),
      state: "Constant",
    });
  }

  const fuelCellCount = finiteOrUndefined(snapshot["fuelCell.count"]) ?? 0;
  if (fuelCellCount > 0) {
    const limitingResource = typeof snapshot["fuelCell.limitingResource"] === "string"
      ? snapshot["fuelCell.limitingResource"].trim()
      : "";
    sources.push({
      kind: "fuel-cell",
      label: sourceLabels["fuel-cell"],
      count: Math.floor(fuelCellCount),
      activeCount: finiteOrUndefined(snapshot["fuelCell.activeCount"]),
      outputEcPerSec: finiteOrUndefined(snapshot["fuelCell.outputEcPerSec"]),
      state: (finiteOrUndefined(snapshot["fuelCell.activeCount"]) ?? 0) > 0 ? "Running" : "Offline",
      runtimeSeconds: finiteOrUndefined(snapshot["fuelCell.runtimeSeconds"]),
      limitingResource: limitingResource || undefined,
      detail: limitingResource ? `limited by ${humanizeResourceName(limitingResource)}` : undefined,
    });
  }

  const otherOutput = finiteOrUndefined(snapshot["elec.otherEcPerSec"]);
  const otherCount = finiteOrUndefined(snapshot["elec.otherCount"]) ?? 0;
  if (otherCount > 0 || (isFiniteNumber(otherOutput) && Math.abs(otherOutput) > 0.05)) {
    sources.push({
      kind: "other",
      label: sourceLabels.other,
      count: Math.max(1, Math.floor(otherCount)),
      outputEcPerSec: otherOutput,
      detail: otherCount > 0 ? `${Math.floor(otherCount)} installed` : "alternators and other generators",
    });
  }
  return sources;
}

function reactorStatus(reactors: ReactorTelemetry[]): ElectricityStatusViewModel {
  const online = reactors.filter((reactor) => reactor.on).length;
  let hot = 0;
  let damaged = 0;
  let readable = 0;
  let maximumRatio = 0;
  reactors.forEach((reactor) => {
    if (
      isFiniteNumber(reactor.coreTemp)
      && isFiniteNumber(reactor.nominalTemp)
      && reactor.nominalTemp > 0
    ) {
      const ratio = reactor.coreTemp / reactor.nominalTemp;
      readable += 1;
      maximumRatio = Math.max(maximumRatio, ratio);
      if (ratio > 1.05) hot += 1;
    }
    if (isFiniteNumber(reactor.integrity) && reactor.integrity < 90) damaged += 1;
  });

  if (hot || damaged) {
    return {
      label: hot && damaged ? "REACTOR ALERT" : hot ? "HIGH TEMP" : "DAMAGED",
      detail: [
        hot ? `${hot} above temperature band` : "",
        damaged ? `${damaged} below 90% integrity` : "",
      ].filter(Boolean).join(" · "),
      tone: "danger",
    };
  }
  if (online === 0) {
    return { label: "SHUTDOWN", detail: `0 of ${reactors.length} online`, tone: "unknown" };
  }
  if (online < reactors.length) {
    return {
      label: "DEGRADED",
      detail: `${online} of ${reactors.length} online`,
      tone: "warn",
    };
  }
  if (readable === reactors.length) {
    return {
      label: "NOMINAL",
      detail: `max ${Math.round(maximumRatio * 100)}% nominal temp`,
      tone: "ok",
    };
  }
  return {
    label: "UNKNOWN",
    detail: readable
      ? `${readable} of ${reactors.length} temperatures available`
      : "temperature unavailable",
    tone: "unknown",
  };
}

function sourceStatus(
  sources: ElectricitySourceViewModel[],
  netEcPerSec: number | undefined,
): ElectricityStatusViewModel {
  if (sources.length === 0) {
    return { label: "NONE", detail: "no sources aboard", tone: "danger" };
  }
  if (isFiniteNumber(netEcPerSec) && netEcPerSec < -0.05) {
    return { label: "DEFICIT", detail: `${formatRateColumn(Math.abs(netEcPerSec), "EC/s")} short`, tone: "danger" };
  }
  const fuelCell = sources.find((source) => source.kind === "fuel-cell");
  if (fuelCell) {
    const running = (fuelCell.activeCount ?? 0) > 0;
    return {
      label: running ? "RUNNING" : "OFFLINE",
      detail: fuelCell.detail ?? `${fuelCell.activeCount ?? 0} of ${fuelCell.count} active`,
      tone: running ? "ok" : "warn",
    };
  }
  const solar = sources.find((source) => source.kind === "solar");
  if (sources.length === 1 && solar) {
    return {
      label: solar.state?.toUpperCase() || "SOLAR",
      detail: solar.detail ?? `${solar.count} panels`,
      tone: solar.state?.toLowerCase() === "shadow" ? "unknown" : "ok",
    };
  }
  const rtg = sources.find((source) => source.kind === "rtg");
  if (sources.length === 1 && rtg) {
    return { label: "CONSTANT", detail: `${rtg.count} units`, tone: "ok" };
  }
  if (sources.length > 0) {
    return {
      label: isFiniteNumber(netEcPerSec) && netEcPerSec > 0.05 ? "SURPLUS" : "GENERATING",
      detail: `${sources.length} source families`,
      tone: "ok",
    };
  }
  return { label: "UNKNOWN", detail: "source status unavailable", tone: "unknown" };
}

export function selectElectricity(snapshot: TelemetrySnapshot): ElectricityViewModel {
  const reactors = Array.isArray(snapshot["elec.reactors"]) ? snapshot["elec.reactors"] : [];
  const normalizedSources = Array.isArray(snapshot["elec.sources"])
    ? snapshot["elec.sources"]
      .map(sourceFromTelemetry)
      .filter((source): source is ElectricitySourceViewModel => source !== null)
    : legacySources(snapshot, reactors);
  const sources = [...normalizedSources].sort(
    (left, right) => sourceOrder.indexOf(left.kind) - sourceOrder.indexOf(right.kind),
  );
  const tier = sources.length === 0 ? 1 : sources.length === 1 ? 2 : 3;
  const chargeCurrent = finiteOrUndefined(snapshot["r.resource[ElectricCharge]"]);
  const chargeMaximum = finiteOrUndefined(snapshot["r.resourceMax[ElectricCharge]"]);
  const chargeFraction = (
    isFiniteNumber(chargeCurrent)
    && isFiniteNumber(chargeMaximum)
    && chargeMaximum > 0
  ) ? Math.max(0, Math.min(1, chargeCurrent / chargeMaximum)) : undefined;
  const sourceGeneration = sources.reduce(
    (sum, source) => sum + (finiteOrUndefined(source.outputEcPerSec) ?? 0),
    0,
  );
  const generationEcPerSec = finiteOrUndefined(snapshot["elec.totalGenEcPerSec"])
    ?? (sources.length > 0 ? sourceGeneration : 0);
  const netEcPerSec = finiteOrUndefined(snapshot["elec.netEcPerSec"]);
  const drawEcPerSec = finiteOrUndefined(snapshot["elec.drawEcPerSec"])
    ?? (
      isFiniteNumber(netEcPerSec) && isFiniteNumber(generationEcPerSec)
        ? Math.max(0, generationEcPerSec - netEcPerSec)
        : undefined
    );
  const flowState = snapshot["elec.flowState"] ?? (
    isFiniteNumber(netEcPerSec) ? "valid" : "unavailable"
  );

  let etaKind: ElectricityViewModel["etaKind"] = "unavailable";
  let etaSeconds: number | undefined;
  if (flowState === "calibrating") {
    etaKind = "calibrating";
  } else if (flowState === "valid" && isFiniteNumber(netEcPerSec)) {
    if (Math.abs(netEcPerSec) <= 0.05) {
      etaKind = "steady";
    } else if (
      netEcPerSec > 0
      && isFiniteNumber(chargeCurrent)
      && isFiniteNumber(chargeMaximum)
    ) {
      etaKind = "full";
      etaSeconds = Math.max(0, chargeMaximum - chargeCurrent) / netEcPerSec;
    } else if (netEcPerSec < 0 && isFiniteNumber(chargeCurrent)) {
      etaKind = "empty";
      etaSeconds = Math.max(0, chargeCurrent) / Math.abs(netEcPerSec);
    }
  } else if (flowState === "saturated") {
    if (chargeFraction === 1) etaKind = "full";
    else if (chargeFraction === 0) etaKind = "empty";
  }

  return {
    tier,
    sources,
    primarySource: sources.length === 1 ? sources[0] : undefined,
    reactors,
    generationEcPerSec,
    drawEcPerSec,
    netEcPerSec,
    flowState,
    chargeCurrent,
    chargeMaximum,
    chargeFraction,
    etaKind,
    etaSeconds,
    status: reactors.length > 0 ? reactorStatus(reactors) : sourceStatus(sources, netEcPerSec),
    solarForecast: snapshot["solar.forecast"],
  };
}
