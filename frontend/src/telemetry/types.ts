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
  twrStart?: number;
  twrEnd?: number;
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
  nominalTempK?: number;
  genKw?: number;
  remKw?: number;
  netKw?: number;
  hasRadiators?: boolean;
  producers?: HeatComponentTelemetry[];
  radiators?: HeatComponentTelemetry[];
  stateText?: string;
  timeToCriticalSeconds?: number;
  thermalCapacityKjPerK?: number;
}

export interface HeatComponentTelemetry {
  name: string;
  count?: number;
  fluxKw?: number;
  role?: string;
  moduleName?: string;
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

export type ReactorControlAction = "start" | "stop" | "start_charging" | "stop_charging";
export type ReactorChargeState = "off" | "charging" | "ready" | "running";

export interface ReactorTelemetry {
  index?: number;
  partId?: number;
  name: string;
  family?: "fission" | "fusion";
  hasIntegrity?: boolean;
  on: boolean;
  status?: string;
  ecPerSec?: number;
  ecMax?: number;
  coreTemp?: number;
  nominalTemp?: number;
  integrity?: number;
  fuel?: string;
  fuelKind?: "life" | "rate";
  fuelRate?: string;
  fuelLimitingResource?: string;
  throttle?: number;
  chargeState?: ReactorChargeState;
  chargePercent?: number;
  controlAction?: ReactorControlAction;
  controlAvailable?: boolean;
}

export interface ReactorControlResult {
  type: "reactor.control.result";
  requestId: string;
  index: number;
  action: ReactorControlAction;
  status: "accepted" | "error";
  message: string;
}

export type ElectricitySourceKind =
  | "reactor"
  | "solar"
  | "rtg"
  | "fuel-cell"
  | "other";

export interface ElectricitySourceTelemetry {
  kind: ElectricitySourceKind;
  label?: string;
  count?: number;
  activeCount?: number;
  outputEcPerSec?: number;
  maxEcPerSec?: number;
  state?: string;
  detail?: string;
  runtimeSeconds?: number;
  limitingResource?: string;
}

export interface SolarForecastTelemetry {
  phase: "sunlight" | "shadow";
  transitionInSeconds?: number;
  orbitSeconds?: number;
  shadowSeconds?: number;
  valid: boolean;
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

export type ScienceLabState =
  | "researching"
  | "science-full"
  | "no-data"
  | "no-scientist"
  | "insufficient-crew"
  | "stopped"
  | "stalled"
  | "unavailable";

export type ScienceLabEtaKind = ScienceLabState | "finite" | "depleted" | "full";

export interface ScienceLabTelemetry {
  id: string;
  title: string;
  dataStored?: number;
  dataCapacity?: number;
  scienceStored?: number;
  scienceCapacity?: number;
  calculatedSciencePerDay?: number;
  sciencePerDay?: number;
  scienceMultiplier?: number;
  crewCount?: number;
  scientistCount?: number;
  crewRequired?: number;
  scientistFactor?: number;
  converterAvailable?: boolean;
  researchEnabled?: boolean;
  operational?: boolean;
  converterStatus?: string;
  lastTimeFactor?: number;
  state: ScienceLabState;
  etaKind: ScienceLabEtaKind;
  etaSeconds?: number;
}

export type ScienceAlarmProviderPreference = "auto" | "kac" | "stock";
export type ScienceAlarmProvider = "kac" | "stock";
export type ScienceAlarmAction = "kill_warp" | "pause_game" | "message_only" | "do_nothing";

export interface ScienceAlarmResult {
  type: "science.alarm.create.result";
  requestId: string;
  labId: string;
  status: "accepted" | "error";
  message: string;
  provider?: ScienceAlarmProvider;
  triggerUT?: number;
  leadSeconds?: number;
}

export interface ScienceLabTransmitResult {
  type: "science.lab.transmit.result";
  requestId: string;
  labId: string;
  status: "accepted" | "error";
  message: string;
}

export interface ScienceLabResearchResult {
  type: "science.lab.research.result";
  requestId: string;
  labId: string;
  enabled: boolean;
  status: "accepted" | "error";
  message: string;
}

export interface OverviewVesselTelemetry {
  objectId?: string;
  guid?: string;
  name: string;
  type: string;
  situation: string;
  body: string;
  met: number;
  crewCount: number;
  crewNames?: string[];
  recoverable?: boolean;
  mission: boolean;
  apoapsisAltitude?: number;
  periapsisAltitude?: number;
  inclination?: number;
  period?: number;
  eccentricity?: number;
}

export interface OverviewVesselSwitchResult {
  type: "overview.vessel.switch.result";
  requestId: string;
  status: "accepted" | "error";
  message: string;
}

export interface OverviewVesselEditResult {
  type: "overview.vessel.edit.result";
  requestId: string;
  status: "accepted" | "error";
  message: string;
  name?: string;
  vesselType?: string;
}

export type OverviewVesselLifecycleAction = "recover" | "terminate";

export interface OverviewVesselLifecycleResult {
  type: "overview.vessel.lifecycle.result";
  requestId: string;
  action: OverviewVesselLifecycleAction;
  status: "accepted" | "error";
  message: string;
}

export interface OverviewCrewTelemetry {
  name: string;
  assignment?: string;
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
  fundsCompletion?: number;
  reputationCompletion?: number;
  scienceCompletion?: number;
}

export interface TransferWindowTelemetry {
  destination: string;
  departureUT?: number;
  arrivalUT?: number;
  transferTime?: number;
  ejectionDeltaV?: number;
  arrivalVInfinity?: number;
  calculatedTotal?: number;
  error?: string;
}

export interface OverviewCapabilities {
  funds: boolean;
  science: boolean;
  reputation: boolean;
  contracts: boolean;
}

export interface CelestialBodyTelemetry {
  name: string;
  parent?: string;
  semiMajorAxis?: number;
  parentGravitationalParameter?: number;
  orbitEpoch?: number;
  meanLongitudeAtEpoch?: number;
  gravitationalParameter: number;
  radius: number;
  rotationPeriod: number;
  atmosphereDepth: number;
  sphereOfInfluence: number;
  surfaceGravity?: number;
  solidSurface?: boolean;
  atmosphereDensityAltitudes?: number[];
  atmosphereDensities?: number[];
}

/**
 * Dashboard telemetry contract. The index signature also accepts additive
 * fields published by optional integrations and newer runtime builds.
 */
export interface TelemetrySnapshot {
  "context.mode": SceneMode;
  "flight.active"?: boolean;
  "krpc.throttle"?: number;
  "krpc.currentStage"?: number;
  "identity.available"?: boolean;
  "game.saveFolder"?: string;
  "v.name"?: string;
  "v.guid"?: string;
  "v.persistentId"?: string;
  "v.rootPartPersistentId"?: string;
  "v.partPersistentIds"?: string[];
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
  "overview.vesselTerminationAvailable"?: boolean;
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
  "mj.transfer.available"?: boolean;
  "mj.transfer.compatibilityReady"?: boolean;
  "mj.transfer.state"?: "idle" | "starting" | "running" | "cancelling" | "cancelled" | "completed" | "failed";
  "mj.transfer.progress"?: number;
  "mj.transfer.error"?: string;
  "mj.transfer.requestId"?: string;
  "mj.transfer.fingerprint"?: string;
  "mj.transfer.origin"?: string;
  "mj.transfer.destination"?: string;
  "mj.transfer.originParkingAltitude"?: number;
  "mj.transfer.optimizePoweredCapture"?: boolean;
  "mj.transfer.requestedAtUT"?: number;
  "mj.transfer.departureUT"?: number;
  "mj.transfer.arrivalUT"?: number;
  "mj.transfer.transferTime"?: number;
  "mj.transfer.ejectionDeltaV"?: number;
  "mj.transfer.arrivalVInfinity"?: number;
  "mj.transfer.calculatedTotal"?: number;
  "mj.transfer.departureVInfinityX"?: number | null;
  "mj.transfer.departureVInfinityY"?: number | null;
  "mj.transfer.departureVInfinityZ"?: number | null;
  "mj.transfer.maneuverVectorSchema"?: 0 | 1;
  "mj.transfer.detectedVersion"?: string;
  "mj.transfer.compatibilityTarget"?: string;
  "mj.transfer.windows.requestId"?: string;
  "mj.transfer.windows.state"?: "idle" | "queued" | "paused" | "running" | "cancelling" | "cancelled" | "completed" | "partial" | "failed";
  "mj.transfer.windows.origin"?: string;
  "mj.transfer.windows.originParkingAltitude"?: number;
  "mj.transfer.windows.optimizePoweredCapture"?: boolean;
  "mj.transfer.windows.activeDestination"?: string;
  "mj.transfer.windows.completedCount"?: number;
  "mj.transfer.windows.totalCount"?: number;
  "mj.transfer.windows.progress"?: number;
  "mj.transfer.windows.requestedAtUT"?: number;
  "mj.transfer.windows.refreshedAtUT"?: number;
  "mj.transfer.windows.results"?: TransferWindowTelemetry[];
  "mj.transfer.windows.pauseReason"?: string;
  "mj.transfer.windows.error"?: string;
  "mj.transfer.grid.requestId"?: string;
  "mj.transfer.grid.fingerprint"?: string;
  "mj.transfer.grid.dateSamples"?: number;
  "mj.transfer.grid.durationSamples"?: number;
  "mj.transfer.grid.departureUTs"?: number[];
  "mj.transfer.grid.transferTimes"?: number[];
  "mj.transfer.grid.costs"?: (number | null)[];
  "mj.transfer.grid.error"?: string;
  "mj.transfer.grid.bestDepartureIndex"?: number;
  "mj.transfer.grid.bestTransferTimeIndex"?: number;
  "mj.transfer.grid.published"?: boolean;
  "mj.transfer.evaluation.requestId"?: string;
  "mj.transfer.evaluation.fingerprint"?: string;
  "mj.transfer.evaluation.departureIndex"?: number;
  "mj.transfer.evaluation.transferTimeIndex"?: number;
  "mj.transfer.evaluation.departureUT"?: number;
  "mj.transfer.evaluation.arrivalUT"?: number;
  "mj.transfer.evaluation.transferTime"?: number;
  "mj.transfer.evaluation.ejectionDeltaV"?: number;
  "mj.transfer.evaluation.arrivalVInfinity"?: number;
  "mj.transfer.evaluation.rawCost"?: number;
  "mj.transfer.evaluation.departureVInfinityX"?: number;
  "mj.transfer.evaluation.departureVInfinityY"?: number;
  "mj.transfer.evaluation.departureVInfinityZ"?: number;
  "mj.transfer.evaluation.error"?: string;
  "mj.transfer.node.actionId"?: string;
  "mj.transfer.node.fingerprint"?: string;
  "mj.transfer.node.vesselGuid"?: string;
  "mj.transfer.node.state"?: "idle" | "previewing" | "ready" | "creating" | "created" | "executed" | "failed";
  "mj.transfer.node.error"?: string;
  "mj.transfer.node.nodeUT"?: number;
  "mj.transfer.node.deltaV"?: number;
  "mj.transfer.node.deltaVX"?: number;
  "mj.transfer.node.deltaVY"?: number;
  "mj.transfer.node.deltaVZ"?: number;
  "mj.transfer.node.apoapsisAltitude"?: number;
  "mj.transfer.node.periapsisAltitude"?: number;
  "mj.transfer.node.inclination"?: number;
  "mj.transfer.node.eccentricity"?: number;
  "mj.transfer.node.semiMajorAxis"?: number;
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
  "stage.count"?: number;
  "stage.currentKsp"?: number;
  "stage.activeKsp"?: number;
  "stage.unpoweredCount"?: number;
  "stage.totalBurnSeconds"?: number;
  "stage.staticPressureAtm"?: number;
  "stage.altitude"?: number;
  "stage.body"?: string;
  "stage.situation"?: string;
  "stage.throttle"?: number;
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
  "elec.sources"?: ElectricitySourceTelemetry[];
  "elec.totalGenEcPerSec"?: number;
  "elec.otherEcPerSec"?: number;
  "elec.otherCount"?: number;
  "elec.netEcPerSec"?: number;
  "elec.drawEcPerSec"?: number;
  "elec.flowState"?: "valid" | "calibrating" | "saturated" | "unavailable";
  "solar.count"?: number;
  "solar.outputEcPerSec"?: number;
  "solar.efficiency"?: number;
  "solar.forecast"?: SolarForecastTelemetry;
  "rtg.count"?: number;
  "rtg.outputEcPerSec"?: number;
  "fuelCell.count"?: number;
  "fuelCell.activeCount"?: number;
  "fuelCell.outputEcPerSec"?: number;
  "fuelCell.runtimeSeconds"?: number;
  "fuelCell.limitingResource"?: string;
  "sci.krpc.total"?: number;
  "sci.krpc.transmitTotal"?: number;
  "sci.krpc.count"?: number;
  "sci.krpc.experiments"?: ScienceExperimentTelemetry[];
  "sci.krpc.backend"?: string;
  "sci.krpc.labTelemetryAvailable"?: boolean;
  "sci.krpc.labDaySeconds"?: number;
  "sci.krpc.labCount"?: number;
  "sci.krpc.failedLabCount"?: number;
  "sci.krpc.malformedLabCount"?: number;
  "sci.krpc.labs"?: ScienceLabTelemetry[];
  "sci.alarmProviders"?: Record<ScienceAlarmProvider, boolean>;
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
  "editor.craftPersistentId"?: string;
  "editor.rootPartPersistentId"?: string;
  "editor.partPersistentIds"?: string[];
  "editor.facility"?: string;
  "editor.body"?: string;
  "editor.bodies"?: string[];
  "editor.altitude"?: number;
  "editor.mach"?: number;
  "editor.revision"?: number;
  "editor.analysisRevision"?: number;
  "editor.stable"?: boolean;
  "editor.rebuildDiagnosticsSchema"?: number;
  "editor.craftRevision"?: number;
  "editor.stageSequenceRevision"?: number;
  "editor.partSetRebuildRevision"?: number;
  "editor.partSetRebuildSupported"?: boolean;
  "editor.partSetRebuildError"?: string;
  "editor.simulationTrackingSupported"?: boolean;
  "editor.simulationTrackingError"?: string;
  "editor.simulationStartedRevision"?: number;
  "editor.simulationRevision"?: number;
  "editor.lastChange"?: string;
  "editor.stagingFingerprint"?: string;
  "editor.stagePartCounts"?: number[];
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
  "catalog.bodies"?: CelestialBodyTelemetry[];
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

export type MissionPlanningPersistenceSection =
  | "resonant"
  | "deltaVLibrary"
  | "deltaVDraft";

export type MissionPlanningPersistenceCommand =
  | {
    type: "mission.planning.persistence.get";
    requestId: string;
    section: MissionPlanningPersistenceSection;
  }
  | {
    type: "mission.planning.persistence.merge";
    requestId: string;
    section: MissionPlanningPersistenceSection;
    incoming: unknown;
    baseRevision: number;
  }
  | {
    type: "mission.planning.persistence.update";
    requestId: string;
    section: MissionPlanningPersistenceSection;
    value: unknown;
    baseRevision: number;
  };

export interface MissionPlanningPersistenceState {
  type: "mission.planning.persistence.state";
  requestId: string;
  section: MissionPlanningPersistenceSection;
  value: unknown;
  revision: number;
  status: "ok" | "merged" | "unchanged" | "updated" | "conflict" | "invalid" | "too_large" | "error";
  message: string;
}

export type TelemetryCommand =
  | { type: "editor.conditions"; body?: string; altitude?: number; mach?: number }
  | { type: "science.alarm.create"; requestId: string; labId: string; provider: ScienceAlarmProviderPreference; leadSeconds: 1800 | 3600; kacAction: ScienceAlarmAction }
  | { type: "science.lab.transmit"; requestId: string; labId: string }
  | { type: "science.lab.research"; requestId: string; labId: string; enabled: boolean }
  | { type: "overview.vessel.switch"; requestId: string; objectId: string; expectedName: string; expectedGuid?: string }
  | { type: "overview.vessel.edit"; requestId: string; objectId: string; expectedName: string; expectedType: string; newName: string; newType: string; expectedGuid?: string }
  | { type: "overview.vessel.lifecycle"; requestId: string; action: OverviewVesselLifecycleAction; objectId: string; expectedName: string; expectedRecoverable: boolean; expectedCrewNames: string[]; expectedGuid?: string }
  | { type: "reactor.control"; requestId: string; index: number; action: ReactorControlAction; expectedName: string; expectedFamily: "fission" | "fusion"; expectedPartId: number; expectedVesselGuid: string }
  | { type: "notes.select"; relativePath: string | null }
  | { type: "notes.pin"; relativePath: string | null }
  | { type: "notes.favorite"; relativePath: string; favorite: boolean }
  | { type: "mechjeb.transfer.start"; requestId: string; fingerprint: string; origin: string; destination: string; originParkingAltitude: number; optimizePoweredCapture: boolean; earliestDepartureUT?: number }
  | { type: "mechjeb.transfer.cancel"; requestId: string }
  | { type: "mechjeb.transfer.release"; requestId: string }
  | { type: "mechjeb.transfer.windows.refresh"; requestId: string; origin: string; originParkingAltitude: number; optimizePoweredCapture: boolean }
  | { type: "mechjeb.transfer.windows.cancel"; requestId: string }
  | { type: "mechjeb.transfer.grid.request"; requestId: string; fingerprint: string }
  | { type: "mechjeb.transfer.grid.ack"; requestId: string }
  | { type: "mechjeb.transfer.evaluate"; requestId: string; fingerprint: string; departureIndex: number; transferTimeIndex: number }
  | { type: "mechjeb.transfer.node.preview"; actionId: string; fingerprint: string; origin: string; plannedParkingAltitude: number; departureUT: number; expectedDeltaV: number; departureVInfinity: [number, number, number]; expectedVesselGuid: string }
  | { type: "mechjeb.transfer.node.create"; actionId: string; fingerprint: string; expectedVesselGuid: string }
  | MissionPlanningPersistenceCommand;

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
  twrStart?: number;
  twrEnd?: number;
  burnSeconds?: number;
}

export interface StageSummaryViewModel {
  currentKsp?: number;
  current?: StageViewModel;
  totalDeltaV?: number;
}
