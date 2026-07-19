export type SceneMode = "flight" | "editor" | "inactive";
export type StageCondition = "atmosphere" | "vacuum";

export interface StageTelemetryRow {
  index: number;
  ksp: number;
  dvAtmo?: number;
  dvVac?: number;
  twr?: number;
  twrAtmo?: number;
  twrVac?: number;
  burn?: number;
}

export interface NoteTelemetry {
  name: string;
  relativePath: string;
  modified: number;
  size: number;
  text: string;
  truncated: boolean;
}

export interface NoteCatalogEntry {
  name: string;
  relativePath: string;
  modified?: number;
  size?: number;
  isActiveLog: boolean;
  isFavorite: boolean;
}

export interface HeatLoopTelemetry {
  id: string;
  tempK?: number;
  genKw?: number;
  remKw?: number;
}

export interface StockHeatPartTelemetry {
  name: string;
  tempK?: number;
  maxTempK?: number;
  skinTempK?: number;
  maxSkinTempK?: number;
  utilization?: number;
  netW?: number;
}

export interface ReactorTelemetry {
  name: string;
  on: boolean;
  status?: string;
  ecPerSec?: number;
  ecMax?: number;
  coreTemp?: number;
  nominalTemp?: number;
  integrity?: number;
  fuel?: string;
  throttle?: number;
}

export interface ScienceExperimentTelemetry {
  title: string;
  value?: number;
  transmit?: number;
  data?: number;
  subjectId?: string;
  sourcePart?: string;
  sourceModule?: string;
  sourceKind?: string;
}

export interface OverviewVesselTelemetry {
  name: string;
  type: string;
  situation: string;
  body: string;
  met: number;
  crewCount: number;
  mission: boolean;
}

export interface OverviewCrewTelemetry {
  name: string;
  status: string;
  type: string;
  trait: string;
  experience: number;
  level: number;
  veteran: boolean;
  flightCount: number;
}

export interface OverviewAlarmTelemetry {
  title: string;
  type: string;
  time: number;
  source: "Stock" | "KAC";
  vessel?: string;
  notes?: string;
}

export interface OverviewContractTelemetry {
  title: string;
  type: string;
  deadline?: number | null;
}

export interface OverviewCapabilities {
  funds: boolean;
  science: boolean;
  reputation: boolean;
  contracts: boolean;
}

/**
 * Typed boundary for the proof-of-concept panels plus the v0.2.3 cross-scene
 * Notes guardrail. The index signature temporarily permits fields owned by
 * production panels that have not migrated.
 */
export interface TelemetrySnapshot {
  "context.mode": SceneMode;
  "flight.active"?: boolean;
  "krpc.throttle"?: number;
  "krpc.currentStage"?: number;
  "v.name"?: string;
  "v.body"?: string;
  "v.missionTime"?: number;
  "v.altitude"?: number;
  "v.verticalSpeed"?: number;
  "v.surfaceSpeed"?: number;
  "v.geeForce"?: number;
  "v.orbitalVelocity"?: number;
  "v.situationString"?: string;
  "v.biome"?: string;
  "t.universalTime"?: number;
  "overview.scene"?: string;
  "overview.gameMode"?: string;
  "overview.readOnly"?: boolean;
  "overview.capabilities"?: OverviewCapabilities;
  "overview.funds"?: number;
  "overview.science"?: number;
  "overview.reputation"?: number;
  "overview.contractCounts"?: Record<"active" | "offered" | "completed" | "failed", number>;
  "overview.contracts"?: OverviewContractTelemetry[];
  "overview.vessels"?: OverviewVesselTelemetry[];
  "overview.vesselsTruncated"?: boolean;
  "overview.roster"?: OverviewCrewTelemetry[];
  "overview.rosterAvailable"?: boolean;
  "overview.alarms"?: OverviewAlarmTelemetry[];
  "overview.alarmProviders"?: Record<"stock" | "kac", string>;
  "overview.refreshSeconds"?: Record<string, number>;
  "n.heading"?: number;
  "n.pitch"?: number;
  "n.roll"?: number;
  "o.ApA"?: number;
  "o.PeA"?: number;
  "o.timeToAp"?: number;
  "o.timeToPe"?: number;
  "o.inclination"?: number;
  "o.eccentricity"?: number;
  "o.period"?: number;
  "krpc.sas"?: boolean;
  "krpc.sasMode"?: string;
  "mj.sasActive"?: boolean;
  "mj.sasMode"?: string;
  "rt.available"?: boolean;
  "rt.hasConnection"?: boolean;
  "rt.signalDelay"?: number | null;
  "comm.krpc.canCommunicate"?: boolean;
  "comm.krpc.signalStrength"?: number;
  "res.names"?: string[];
  "res.stageKnown"?: boolean;
  "res.stageResourceStage"?: number;
  "res.stageActivationStage"?: number;
  "stage.available"?: boolean;
  "stage.complete"?: boolean;
  "stage.pending"?: boolean;
  "stage.currentKsp"?: number;
  "stage.stages"?: StageTelemetryRow[];
  "stage.totalDvAtmo"?: number;
  "stage.totalDvVac"?: number;
  "heat.generatedKw"?: number;
  "heat.removedKw"?: number;
  "heat.netKw"?: number;
  "heat.loops"?: HeatLoopTelemetry[];
  "heat.backend"?: "system_heat" | "stock";
  "heat.generatedW"?: number;
  "heat.removedW"?: number;
  "heat.netW"?: number;
  "heat.parts"?: StockHeatPartTelemetry[];
  "elec.reactors"?: ReactorTelemetry[];
  "elec.totalGenEcPerSec"?: number;
  "elec.otherEcPerSec"?: number;
  "solar.count"?: number;
  "solar.outputEcPerSec"?: number;
  "solar.efficiency"?: number;
  "rtg.count"?: number;
  "rtg.outputEcPerSec"?: number;
  "sci.krpc.total"?: number;
  "sci.krpc.transmitTotal"?: number;
  "sci.krpc.count"?: number;
  "sci.krpc.experiments"?: ScienceExperimentTelemetry[];
  "sci.krpc.backend"?: string;
  "career.science"?: number;
  "tar.name"?: string;
  "tar.type"?: string;
  "tar.distance"?: number;
  "tar.o.relativeVelocity"?: number;
  "tar.o.velocity"?: number;
  "tar.o.ApA"?: number;
  "tar.o.PeA"?: number;
  "tar.o.inclination"?: number;
  "dock.x"?: number;
  "dock.y"?: number;
  "dock.axial"?: number;
  "dock.ax"?: number;
  "dock.ay"?: number;
  "editor.craftName"?: string;
  "editor.facility"?: string;
  "editor.body"?: string;
  "editor.bodies"?: string[];
  "editor.altitude"?: number;
  "editor.mach"?: number;
  "editor.revision"?: number;
  "editor.stable"?: boolean;
  "editor.summaryAvailable"?: boolean;
  "editor.partCount"?: number;
  "editor.crewCapacity"?: number;
  "editor.stageCount"?: number;
  "editor.wetMass"?: number;
  "editor.dryMass"?: number;
  "editor.resourceMass"?: number;
  "editor.totalCost"?: number;
  "editor.dryCost"?: number;
  "editor.resourceCost"?: number;
  "editor.res.names"?: string[];
  "notes.available"?: boolean;
  "notes.activeFound"?: boolean;
  "notes.message"?: string;
  "notes.active"?: NoteTelemetry | null;
  "notes.selected"?: NoteTelemetry | null;
  "notes.selectedPath"?: string;
  "notes.selectionMode"?: "active" | "browse";
  "notes.pinned"?: NoteTelemetry | null;
  "notes.pinnedPath"?: string;
  "notes.catalog"?: NoteCatalogEntry[];
  "notes.catalogTruncated"?: boolean;
  [key: string]: unknown;
}

export type TelemetryCommand =
  | { type: "editor.conditions"; body?: string; altitude?: number; mach?: number }
  | { type: "notes.select"; relativePath: string | null }
  | { type: "notes.pin"; relativePath: string | null }
  | { type: "notes.favorite"; relativePath: string; favorite: boolean };

export interface ResourceAmount {
  current?: number;
  maximum?: number;
  fraction?: number;
}

export interface ConsumableViewModel {
  name: string;
  vessel: ResourceAmount;
  stage: ResourceAmount;
}

export interface StageViewModel {
  ksp: number;
  deltaVAtmosphere?: number;
  deltaVVacuum?: number;
  twrAtmosphere?: number;
  twrVacuum?: number;
  burnSeconds?: number;
}

export interface StageSummaryViewModel {
  currentKsp?: number;
  current?: StageViewModel;
  totalDeltaV?: number;
}
