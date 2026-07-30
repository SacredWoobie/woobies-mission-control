import { isFiniteNumber } from "../telemetry/formatters";
import type {
  HeatComponentTelemetry,
  HeatLoopTelemetry,
  StockHeatPartTelemetry,
} from "../telemetry/types";

export type HeatSeverity = "nominal" | "hot" | "critical" | "no-radiators";
export type HeatEntityKind = "loop" | "part";

export interface HeatEntity {
  id: string;
  kind: HeatEntityKind;
  name: string;
  severity: HeatSeverity;
  ratio?: number;
  currentK?: number;
  limitK?: number;
  secondaryTemperature?: {
    label: "core" | "skin";
    tempK: number;
  };
  netFlux?: number;
  generatedFlux?: number;
  removedFlux?: number;
  components?: {
    producers: HeatComponentTelemetry[];
    radiators: HeatComponentTelemetry[];
  };
  componentSummary?: string;
  stateText?: string;
  timeToCriticalSeconds?: number;
}

const HOT_RATIO = 0.6;
const CRITICAL_RATIO = 0.9;

function finiteRatio(current: unknown, limit: unknown) {
  return isFiniteNumber(current) && isFiniteNumber(limit) && limit > 0
    ? Math.max(0, current / limit)
    : undefined;
}

function stockSeverityFor(ratio: number | undefined): HeatSeverity {
  if (isFiniteNumber(ratio) && ratio >= CRITICAL_RATIO) return "critical";
  if (isFiniteNumber(ratio) && ratio >= HOT_RATIO) return "hot";
  return "nominal";
}

function loopSeverityFor(
  loop: HeatLoopTelemetry,
  ratio: number | undefined,
  netFlux: number | undefined,
): HeatSeverity {
  if (loop.hasRadiators === false) return "no-radiators";

  const explicitCriticalState = typeof loop.stateText === "string"
    && /critical|runaway/i.test(loop.stateText);
  const approachingCritical = isFiniteNumber(loop.timeToCriticalSeconds)
    && loop.timeToCriticalSeconds >= 0
    && loop.timeToCriticalSeconds <= 300;
  const accumulatingNearNominal = isFiniteNumber(ratio)
    && ratio >= CRITICAL_RATIO
    && isFiniteNumber(netFlux)
    && netFlux > 0.05;

  if (explicitCriticalState || approachingCritical || accumulatingNearNominal) return "critical";
  if (isFiniteNumber(ratio) && ratio >= HOT_RATIO) return "hot";
  return "nominal";
}

function componentCount(components: HeatComponentTelemetry[] | undefined) {
  return (components ?? []).reduce((total, component) => (
    total + (isFiniteNumber(component.count) && component.count > 0 ? component.count : 1)
  ), 0);
}

function loopComponentSummary(loop: HeatLoopTelemetry) {
  const labels: string[] = [];
  const producerCount = componentCount(loop.producers);
  const radiatorCount = componentCount(loop.radiators);
  if (producerCount > 0) labels.push(`${producerCount} ${producerCount === 1 ? "producer" : "producers"}`);
  if (radiatorCount > 0) labels.push(`${radiatorCount} ${radiatorCount === 1 ? "radiator" : "radiators"}`);
  return labels.join(" · ");
}

function loopState(loop: HeatLoopTelemetry, netFlux: number | undefined) {
  if (typeof loop.stateText === "string" && loop.stateText.trim()) return loop.stateText.trim();
  if (!isFiniteNumber(netFlux) || Math.abs(netFlux) < 0.05) return "steady";
  return netFlux > 0 ? "warming" : "cooling";
}

export function loopHeatEntity(loop: HeatLoopTelemetry): HeatEntity {
  const ratio = finiteRatio(loop.tempK, loop.nominalTempK);
  const netFlux = isFiniteNumber(loop.netKw)
    ? loop.netKw
    : isFiniteNumber(loop.genKw) && isFiniteNumber(loop.remKw)
      ? loop.genKw - loop.remKw
      : undefined;
  const components = loop.producers || loop.radiators
    ? { producers: loop.producers ?? [], radiators: loop.radiators ?? [] }
    : undefined;

  return {
    id: `loop-${loop.id}`,
    kind: "loop",
    name: `Loop ${loop.id}`,
    severity: loopSeverityFor(loop, ratio, netFlux),
    ratio,
    currentK: loop.tempK,
    limitK: loop.nominalTempK,
    netFlux,
    generatedFlux: loop.genKw,
    removedFlux: loop.remKw,
    components,
    componentSummary: loopComponentSummary(loop),
    stateText: loopState(loop, netFlux),
    timeToCriticalSeconds: loop.timeToCriticalSeconds,
  };
}

export function stockHeatEntity(part: StockHeatPartTelemetry, index: number): HeatEntity {
  const coreRatio = finiteRatio(part.tempK, part.maxTempK);
  const skinRatio = finiteRatio(part.skinTempK, part.maxSkinTempK);
  const reportedRatio = isFiniteNumber(part.utilization) ? Math.max(0, part.utilization / 100) : undefined;
  const ratio = Math.max(coreRatio ?? -1, skinRatio ?? -1, reportedRatio ?? -1);
  const normalizedRatio = ratio >= 0 ? ratio : undefined;
  const skinIsLimiting = isFiniteNumber(skinRatio)
    && (!isFiniteNumber(coreRatio) || skinRatio >= coreRatio)
    && isFiniteNumber(part.skinTempK)
    && isFiniteNumber(part.maxSkinTempK);
  const currentK = skinIsLimiting ? part.skinTempK : part.tempK;
  const limitK = skinIsLimiting ? part.maxSkinTempK : part.maxTempK;
  const secondaryLabel = skinIsLimiting ? "core" : "skin";
  const secondaryTemp = skinIsLimiting ? part.tempK : part.skinTempK;

  return {
    id: `part-${part.name}-${index}`,
    kind: "part",
    name: part.name,
    severity: stockSeverityFor(normalizedRatio),
    ratio: normalizedRatio,
    currentK,
    limitK,
    secondaryTemperature: isFiniteNumber(secondaryTemp)
      ? { label: secondaryLabel, tempK: secondaryTemp }
      : undefined,
    netFlux: part.netW,
  };
}

function severityRank(severity: HeatSeverity) {
  if (severity === "no-radiators") return 3;
  if (severity === "critical") return 2;
  if (severity === "hot") return 1;
  return 0;
}

export function rankHeatEntities(entities: HeatEntity[]) {
  const hasAttentionState = entities.some((entity) => entity.severity !== "nominal");
  if (!hasAttentionState) return entities;
  return entities
    .map((entity, index) => ({ entity, index }))
    .sort((left, right) => (
      severityRank(right.entity.severity) - severityRank(left.entity.severity)
      || (right.entity.ratio ?? -1) - (left.entity.ratio ?? -1)
      || left.index - right.index
    ))
    .map(({ entity }) => entity);
}

export function heatPanelIsIdle(entities: HeatEntity[]) {
  return entities.length > 0 && entities.every((entity) => (
    entity.severity === "nominal"
    && (
      entity.kind === "part"
      || !isFiniteNumber(entity.netFlux)
      || Math.abs(entity.netFlux) < 0.05
    )
  ));
}

export function heatStatusSummary(entities: HeatEntity[]) {
  const noun = entities[0]?.kind === "part"
    ? `${entities.length} ${entities.length === 1 ? "part" : "parts"}`
    : `${entities.length} ${entities.length === 1 ? "loop" : "loops"}`;
  const worst = rankHeatEntities(entities)[0];
  if (!worst || worst.severity === "nominal") return { noun, label: "NOMINAL", severity: "nominal" as const };
  if (worst.severity === "no-radiators") return { noun, label: "NO RADIATORS", severity: worst.severity };
  const count = entities.filter((entity) => entity.severity === worst.severity).length;
  return {
    noun,
    label: `${count} ${worst.severity.toUpperCase()}`,
    severity: worst.severity,
  };
}
