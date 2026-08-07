import type { TelemetrySnapshot } from "./types";

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every(
      (value, index) => valuesEqual(value, right[index]),
    );
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = Object.keys(leftRecord);
    return keys.length === Object.keys(rightRecord).length && keys.every(
      (key) => valuesEqual(leftRecord[key], rightRecord[key]),
    );
  }
  return false;
}

function fieldsEqual(
  left: TelemetrySnapshot | null,
  right: TelemetrySnapshot | null,
  keys: string[],
) {
  if (left === right) return true;
  if (!left || !right) return false;
  return keys.every((key) => valuesEqual(left[key], right[key]));
}

export function headerSnapshotsEqual(
  left: TelemetrySnapshot | null,
  right: TelemetrySnapshot | null,
) {
  return fieldsEqual(left, right, [
    "context.mode", "v.name", "editor.craftName", "identity.available", "game.saveFolder",
    "v.guid", "v.persistentId", "v.rootPartPersistentId", "v.partPersistentIds",
    "editor.craftPersistentId", "editor.rootPartPersistentId", "editor.partPersistentIds",
  ]);
}

export function consumablesSnapshotsEqual(
  left: TelemetrySnapshot | null,
  right: TelemetrySnapshot | null,
) {
  const names = new Set([
    ...((left?.["res.names"] as string[] | undefined) ?? []),
    ...((right?.["res.names"] as string[] | undefined) ?? []),
  ].filter((name) => name !== "ElectricCharge"));
  const keys = ["context.mode", "res.names", "res.stageKnown"];
  names.forEach((name) => keys.push(
    `r.resource[${name}]`,
    `r.resourceMax[${name}]`,
    `r.resourceCurrent[${name}]`,
    `r.resourceCurrentMax[${name}]`,
  ));
  return fieldsEqual(left, right, keys);
}

export function stagingSnapshotsEqual(
  left: TelemetrySnapshot | null,
  right: TelemetrySnapshot | null,
) {
  return fieldsEqual(left, right, [
    "context.mode",
    "krpc.throttle",
    "stage.available",
    "stage.complete",
    "stage.pending",
    "editor.revision",
    "editor.analysisRevision",
    "editor.stable",
    "editor.rebuildDiagnosticsSchema",
    "editor.craftRevision",
    "editor.stageSequenceRevision",
    "editor.partSetRebuildRevision",
    "editor.partSetRebuildSupported",
    "editor.partSetRebuildError",
    "editor.simulationTrackingSupported",
    "editor.simulationTrackingError",
    "editor.simulationStartedRevision",
    "editor.simulationRevision",
    "editor.stagingFingerprint",
    "editor.stagePartCounts",
    "stage.currentKsp",
    "stage.stages",
    "stage.totalDvAtmo",
    "stage.totalDvVac",
  ]);
}

export function editorSnapshotsEqual(
  left: TelemetrySnapshot | null,
  right: TelemetrySnapshot | null,
) {
  return fieldsEqual(left, right, [
    "context.mode",
    "editor.craftName",
    "editor.facility",
    "editor.body",
    "editor.bodies",
    "editor.altitude",
    "editor.mach",
    "editor.revision",
    "editor.stable",
    "stage.available",
    "stage.pending",
  ]);
}

export function editorSummarySnapshotsEqual(
  left: TelemetrySnapshot | null,
  right: TelemetrySnapshot | null,
) {
  const names = new Set([
    ...((left?.["editor.res.names"] as string[] | undefined) ?? []),
    ...((right?.["editor.res.names"] as string[] | undefined) ?? []),
  ]);
  const keys = [
    "context.mode",
    "editor.revision",
    "editor.analysisRevision",
    "editor.stable",
    "editor.summaryAvailable",
    "editor.partCount",
    "editor.crewCapacity",
    "editor.stageCount",
    "editor.wetMass",
    "editor.dryMass",
    "editor.resourceMass",
    "editor.totalCost",
    "editor.dryCost",
    "editor.resourceCost",
    "editor.res.names",
    "stage.pending",
  ];
  names.forEach((name) => keys.push(
    `editor.res[${name}]`,
    `editor.resMax[${name}]`,
  ));
  return fieldsEqual(left, right, keys);
}

export function notesSnapshotsEqual(
  left: TelemetrySnapshot | null,
  right: TelemetrySnapshot | null,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  const keys = new Set([
    "context.mode", "v.name", "identity.available", "game.saveFolder",
    "v.guid", "v.persistentId", "v.rootPartPersistentId", "v.partPersistentIds",
    "editor.craftPersistentId", "editor.rootPartPersistentId", "editor.partPersistentIds",
  ]);
  [...Object.keys(left), ...Object.keys(right)].forEach((key) => {
    if (key.startsWith("notes.")) keys.add(key);
  });
  return fieldsEqual(left, right, [...keys]);
}

export function clockSnapshotsEqual(left: TelemetrySnapshot | null, right: TelemetrySnapshot | null) {
  return fieldsEqual(left, right, ["context.mode", "t.universalTime", "v.name", "v.body", "v.situationString", "v.missionTime", "rt.available", "rt.hasConnection", "rt.signalDelay", "comm.krpc.canCommunicate", "comm.krpc.signalStrength"]);
}

export function ascensionSnapshotsEqual(left: TelemetrySnapshot | null, right: TelemetrySnapshot | null) {
  return fieldsEqual(left, right, ["context.mode", "krpc.throttle", "krpc.sas", "krpc.sasMode", "n.heading", "n.pitch", "n.roll", "v.body", "v.altitude", "v.verticalSpeed", "v.surfaceSpeed", "v.orbitalVelocity", "o.ApA", "o.PeA", "o.timeToAp", "o.timeToPe", "o.inclination", "o.eccentricity", "o.period", "mj.sasActive", "mj.sasMode", "tar.name", "tar.o.relativeVelocity"]);
}

export function heatSnapshotsEqual(left: TelemetrySnapshot | null, right: TelemetrySnapshot | null) {
  return fieldsEqual(left, right, [
    "context.mode", "heat.backend",
    "heat.generatedKw", "heat.removedKw", "heat.netKw", "heat.loops",
    "heat.generatedW", "heat.removedW", "heat.netW", "heat.parts",
  ]);
}

export function electricitySnapshotsEqual(left: TelemetrySnapshot | null, right: TelemetrySnapshot | null) {
  return fieldsEqual(left, right, [
    "context.mode",
    "v.guid",
    "elec.reactors",
    "elec.sources",
    "elec.totalGenEcPerSec",
    "elec.otherEcPerSec",
    "elec.otherCount",
    "elec.netEcPerSec",
    "elec.drawEcPerSec",
    "elec.flowState",
    "solar.count",
    "solar.outputEcPerSec",
    "solar.efficiency",
    "solar.forecast",
    "rtg.count",
    "rtg.outputEcPerSec",
    "fuelCell.count",
    "fuelCell.activeCount",
    "fuelCell.outputEcPerSec",
    "fuelCell.runtimeSeconds",
    "fuelCell.limitingResource",
    "r.resource[ElectricCharge]",
    "r.resourceMax[ElectricCharge]",
  ]);
}

export function scienceSnapshotsEqual(left: TelemetrySnapshot | null, right: TelemetrySnapshot | null) {
  return fieldsEqual(left, right, ["context.mode", "sci.krpc.total", "sci.krpc.transmitTotal", "sci.krpc.count", "sci.krpc.experiments", "sci.krpc.labTelemetryAvailable", "sci.krpc.labDaySeconds", "sci.krpc.labCount", "sci.krpc.labs", "sci.alarmProviders", "career.science", "v.body", "v.situationString", "v.biome"]);
}

export function targetSnapshotsEqual(left: TelemetrySnapshot | null, right: TelemetrySnapshot | null) {
  return fieldsEqual(left, right, ["context.mode", "v.guid", "tar.name", "tar.type", "tar.objectId", "tar.distance", "tar.o.relativeVelocity", "tar.o.velocity", "tar.o.ApA", "tar.o.PeA", "tar.o.inclination", "dock.x", "dock.y", "dock.axial", "dock.ax", "dock.ay"]);
}

export function pinnedNoteSnapshotsEqual(left: TelemetrySnapshot | null, right: TelemetrySnapshot | null) {
  return fieldsEqual(left, right, ["context.mode", "notes.pinned", "notes.pinnedPath"]);
}

export function flightAvailabilitySnapshotsEqual(left: TelemetrySnapshot | null, right: TelemetrySnapshot | null) {
  return fieldsEqual(left, right, [
    "context.mode", "tar.name", "notes.pinnedPath", "identity.available", "game.saveFolder",
    "v.name", "v.guid", "v.persistentId", "v.rootPartPersistentId", "v.partPersistentIds",
  ]);
}

export function overviewSnapshotsEqual(left: TelemetrySnapshot | null, right: TelemetrySnapshot | null) {
  return fieldsEqual(left, right, [
    "context.mode", "t.universalTime", "overview.scene", "overview.gameMode",
    "overview.readOnly", "overview.capabilities", "overview.funds",
    "overview.science", "overview.reputation", "overview.contractCounts",
    "overview.contracts", "overview.vessels", "overview.vesselsTruncated",
    "overview.roster", "overview.rosterAvailable", "overview.alarms",
    "overview.alarmProviders", "mj.transfer.available",
    "mj.transfer.compatibilityReady", "mj.transfer.windows.requestId",
    "mj.transfer.windows.state", "mj.transfer.windows.origin",
    "mj.transfer.windows.activeDestination", "mj.transfer.windows.completedCount",
    "mj.transfer.windows.totalCount", "mj.transfer.windows.progress",
    "mj.transfer.windows.refreshedAtUT", "mj.transfer.windows.results",
    "mj.transfer.windows.pauseReason", "mj.transfer.windows.error",
  ]);
}
