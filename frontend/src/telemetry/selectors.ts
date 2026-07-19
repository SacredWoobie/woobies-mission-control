import type {
  ConsumableViewModel,
  ResourceAmount,
  StageCondition,
  StageSummaryViewModel,
  StageViewModel,
  TelemetrySnapshot,
} from "./types";

const resourceDisplayOrder = [
  "ElectricCharge",
  "MonoPropellant",
  "LiquidFuel",
  "Oxidizer",
  "SolidFuel",
  "XenonGas",
  "ArgonGas",
  "LqdHydrogen",
  "LqdOxygen",
  "Lithium",
  "EnrichedUranium",
  "DepletedFuel",
  "Ablator",
  "Ore",
  "IntakeAir",
] as const;

const preferredResources = new Set<string>(resourceDisplayOrder);

function numberField(snapshot: TelemetrySnapshot, key: string) {
  const value = snapshot[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resourceAmount(
  snapshot: TelemetrySnapshot,
  currentKey: string,
  maximumKey: string,
): ResourceAmount {
  const current = numberField(snapshot, currentKey);
  const maximum = numberField(snapshot, maximumKey);
  const fraction =
    current !== undefined && maximum !== undefined && maximum > 0
      ? Math.max(0, Math.min(1, current / maximum))
      : undefined;

  return { current, maximum, fraction };
}

export function selectConsumables(snapshot: TelemetrySnapshot): ConsumableViewModel[] {
  const names = Array.isArray(snapshot["res.names"]) ? snapshot["res.names"] : [];
  const ordered = [
    ...resourceDisplayOrder.filter((name) => names.includes(name)),
    ...names.filter((name) => !preferredResources.has(name)),
  ];

  return ordered
    .map((name) => ({
      name,
      vessel: resourceAmount(
        snapshot,
        `r.resource[${name}]`,
        `r.resourceMax[${name}]`,
      ),
      stage: resourceAmount(
        snapshot,
        `r.resourceCurrent[${name}]`,
        `r.resourceCurrentMax[${name}]`,
      ),
    }))
    .filter((resource) => (resource.vessel.maximum ?? 0) > 0);
}

function allStageRows(snapshot: TelemetrySnapshot): StageViewModel[] {
  const stages = snapshot["stage.stages"];
  if (!Array.isArray(stages)) return [];

  return stages.map((stage) => ({
    ksp: stage.ksp,
    deltaVAtmosphere: stage.dvAtmo,
    deltaVVacuum: stage.dvVac,
    twrAtmosphere: stage.twrAtmo ?? stage.twr,
    twrVacuum: stage.twrVac ?? stage.twr,
    burnSeconds: stage.burn,
  }));
}

function hasPropulsion(stage: StageViewModel, condition?: StageCondition) {
  if (condition === "atmosphere") return (stage.deltaVAtmosphere ?? 0) > 0.5;
  if (condition === "vacuum") return (stage.deltaVVacuum ?? 0) > 0.5;
  return (stage.deltaVAtmosphere ?? 0) > 0.5 || (stage.deltaVVacuum ?? 0) > 0.5;
}

export function selectStages(
  snapshot: TelemetrySnapshot,
  condition?: StageCondition,
): StageViewModel[] {
  const effectiveCondition = snapshot["context.mode"] === "editor" ? undefined : condition;
  return allStageRows(snapshot)
    .filter((stage) => hasPropulsion(stage, effectiveCondition))
    .sort((left, right) => left.ksp - right.ksp);
}

export function selectStageSummary(
  snapshot: TelemetrySnapshot,
  condition: StageCondition,
): StageSummaryViewModel {
  const rows = selectStages(snapshot, condition);
  const rawCurrent = snapshot["stage.currentKsp"];
  const currentKsp =
    typeof rawCurrent === "number" && Number.isFinite(rawCurrent)
      ? Math.round(rawCurrent)
      : undefined;
  const current =
    currentKsp === undefined
      ? rows.reduce<StageViewModel | undefined>(
          (highest, stage) => (!highest || stage.ksp > highest.ksp ? stage : highest),
          undefined,
        )
      : rows.find((stage) => stage.ksp === currentKsp);
  const totalKey = condition === "vacuum" ? "stage.totalDvVac" : "stage.totalDvAtmo";

  return {
    currentKsp: currentKsp ?? current?.ksp,
    current,
    totalDeltaV: numberField(snapshot, totalKey),
  };
}
