import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type PropsWithChildren,
  type SetStateAction,
} from "react";
import { useSharedPlannerPersistence } from "../sharedPlannerPersistence";
import {
  bodyByName,
  type ArrivalStrategy,
  type CustomDeltaVStep,
  type DeltaVPlan,
  type LiveTransferSolution,
  type MissionEndpoint,
  type SerialMissionLocation,
  type SerialMissionStop,
} from "./calculations";
import type { PorkchopEvaluation } from "./PorkchopPlotModal";
import type { TelemetrySnapshot } from "../telemetry/types";

const DRAFT_STORAGE_KEY = "wmc-delta-v-draft-v1";
const LEGACY_DRAFT_STORAGE_KEY = "wmc-prototype-delta-v-draft-v1";
const LIBRARY_STORAGE_KEY = "wmc-delta-v-library-v1";
const LEGACY_LIBRARY_STORAGE_KEY = "wmc-prototype-delta-v-library-v1";

export type TransferPlanningMode = "simple" | "advanced";

export const DEFAULT_ARRIVAL: ArrivalStrategy = {
  captureBeforeLanding: false,
  aerocapture: true,
  atmosphericLanding: true,
  assistedLandingReserve: 150,
};

export interface MissionStartDraft extends SerialMissionLocation {}
export interface MissionStopDraft extends SerialMissionStop {}

export interface DeltaVDraftSnapshot {
  schemaVersion: 1;
  customSteps: CustomDeltaVStep[];
  editingStopId: string | null;
  marginPercent: number;
  nextStop: MissionStopDraft;
  profileOpen: boolean;
  selectedPorkchopEvaluations: Partial<Record<string, PorkchopEvaluation>>;
  selectedTransferSolutions: Partial<Record<string, LiveTransferSolution>>;
  start: MissionStartDraft;
  startLocked: boolean;
  stops: MissionStopDraft[];
  transferMode: TransferPlanningMode;
}

export interface SavedDeltaVPlanRecord {
  id: string;
  name: string;
  saveFolder: string;
  plan: DeltaVPlan;
  draft: DeltaVDraftSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface PinnedDeltaVPlanRecord extends SavedDeltaVPlanRecord {
  assignmentId: string | null;
  completedLegIds: string[];
  craftBound: boolean;
}

export interface DeltaVCraftIdentity {
  scene: "editor" | "flight";
  saveFolder: string;
  craftName: string;
  craftPersistentId: string;
  rootPartPersistentId: string;
  partPersistentIds: string[];
  vesselGuid?: string;
}

interface PinnedPlanAssignment {
  id: string;
  planId: string;
  saveFolder: string;
  craftName: string;
  anchorPartPersistentId: string;
  editorCraftPersistentId?: string;
  lastVesselGuid?: string;
  completedLegIds: string[];
  pinnedAt: string;
  updatedAt: string;
}

interface LegacyPinnedPlan {
  planId: string;
  completedLegIds: string[];
}

interface DeltaVPlanLibrary {
  schemaVersion: 2;
  plans: SavedDeltaVPlanRecord[];
  assignments: PinnedPlanAssignment[];
  legacyPinned: LegacyPinnedPlan | null;
}

export interface DeltaVDraftState {
  activeSavedPlanId: string | null;
  customSteps: CustomDeltaVStep[];
  draftHasContent: boolean;
  editingStopId: string | null;
  marginPercent: number;
  nextCustomStep: MutableRefObject<number>;
  nextMissionStop: MutableRefObject<number>;
  profileOpen: boolean;
  nextStop: MissionStopDraft;
  savedPlans: SavedDeltaVPlanRecord[];
  selectedPorkchopEvaluations: Partial<Record<string, PorkchopEvaluation>>;
  selectedTransferSolutions: Partial<Record<string, LiveTransferSolution>>;
  deletePlan(id: string): void;
  linkPlansToSave(ids: string[], saveFolder: string): void;
  loadPlan(id: string): void;
  pinPlan(id: string, snapshot?: TelemetrySnapshot | null): void;
  pinnedForTelemetry(snapshot?: TelemetrySnapshot | null): PinnedDeltaVPlanRecord | null;
  rememberPinnedCraft(snapshot?: TelemetrySnapshot | null): void;
  resetDraft(): void;
  resetRevision: number;
  savePlan(plan: DeltaVPlan, name: string, options?: { asNew?: boolean; saveFolder?: string }): SaveDeltaVPlanResult;
  setPinnedStepComplete(legId: string, complete: boolean, snapshot?: TelemetrySnapshot | null): void;
  setCustomSteps: Dispatch<SetStateAction<CustomDeltaVStep[]>>;
  setEditingStopId: Dispatch<SetStateAction<string | null>>;
  setMarginPercent: Dispatch<SetStateAction<number>>;
  setNextStop: Dispatch<SetStateAction<MissionStopDraft>>;
  setProfileOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedPorkchopEvaluations: Dispatch<SetStateAction<Partial<Record<string, PorkchopEvaluation>>>>;
  setSelectedTransferSolutions: Dispatch<SetStateAction<Partial<Record<string, LiveTransferSolution>>>>;
  setStart: Dispatch<SetStateAction<MissionStartDraft>>;
  setStartLocked: Dispatch<SetStateAction<boolean>>;
  setStops: Dispatch<SetStateAction<MissionStopDraft[]>>;
  setTransferMode: Dispatch<SetStateAction<TransferPlanningMode>>;
  start: MissionStartDraft;
  startLocked: boolean;
  stops: MissionStopDraft[];
  transferMode: TransferPlanningMode;
  transferRouteSignature: MutableRefObject<string>;
  unpinPlan(snapshot?: TelemetrySnapshot | null): void;
}

export type SaveDeltaVPlanResult =
  | { status: "created" | "updated"; id: string; name: string }
  | { status: "duplicate"; id: string; name: string };

const DeltaVDraftContext = createContext<DeltaVDraftState | null>(null);

function profileInitiallyOpen() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return !window.matchMedia("(orientation: landscape) and (min-width: 900px) and (max-height: 700px)").matches;
}

function defaultParkingAltitude(bodyName: string, fallback: number) {
  return bodyByName("stock", bodyName)?.defaultParkingAltitude ?? fallback;
}

function defaultStart(): MissionStartDraft {
  return {
    bodyName: "Kerbin",
    endpoint: "surface" as MissionEndpoint,
    parkingAltitude: defaultParkingAltitude("Kerbin", 80_000),
  };
}

function defaultNextStop(id = "segment-1", bodyName = ""): MissionStopDraft {
  return {
    id,
    bodyName,
    endpoint: "surface" as MissionEndpoint,
    parkingAltitude: bodyName ? defaultParkingAltitude(bodyName, 14_000) : 1_000,
    arrivalStrategy: { ...DEFAULT_ARRIVAL },
    stayDurationDays: 1,
  };
}

function normalizedStop(value: Partial<MissionStopDraft>, fallbackId: string): MissionStopDraft {
  const bodyName = typeof value.bodyName === "string" ? value.bodyName : "";
  const arrival = value.arrivalStrategy;
  return {
    id: typeof value.id === "string" && value.id ? value.id : fallbackId,
    bodyName,
    endpoint: value.endpoint === "orbit" ? "orbit" : "surface",
    parkingAltitude: typeof value.parkingAltitude === "number" && Number.isFinite(value.parkingAltitude)
      ? value.parkingAltitude
      : defaultParkingAltitude(bodyName, 1_000),
    arrivalStrategy: {
      ...DEFAULT_ARRIVAL,
      ...(arrival && typeof arrival === "object" ? arrival : {}),
    },
    stayDurationDays: typeof value.stayDurationDays === "number" && Number.isFinite(value.stayDurationDays)
      ? Math.max(0, value.stayDurationDays)
      : 1,
  };
}

function defaultDraft(): DeltaVDraftSnapshot {
  return {
    schemaVersion: 1,
    customSteps: [],
    editingStopId: null,
    marginPercent: 15,
    nextStop: defaultNextStop(),
    profileOpen: profileInitiallyOpen(),
    selectedPorkchopEvaluations: {},
    selectedTransferSolutions: {},
    start: defaultStart(),
    startLocked: false,
    stops: [],
    transferMode: "simple",
  };
}

function draftHasMeaningfulContent(draft: DeltaVDraftSnapshot) {
  const initialStart = defaultStart();
  return draft.startLocked
    || draft.customSteps.length > 0
    || draft.stops.length > 0
    || Boolean(draft.nextStop.bodyName)
    || draft.start.bodyName !== initialStart.bodyName
    || draft.start.endpoint !== initialStart.endpoint
    || draft.start.parkingAltitude !== initialStart.parkingAltitude
    || draft.marginPercent !== 15
    || draft.transferMode !== "simple"
    || Object.keys(draft.selectedPorkchopEvaluations).length > 0
    || Object.keys(draft.selectedTransferSolutions).length > 0;
}

function normalizeDraftSnapshot(value: unknown): DeltaVDraftSnapshot | null {
  const stored = value as Partial<DeltaVDraftSnapshot> | null;
  if (stored?.schemaVersion !== 1 || !stored.start || !Array.isArray(stored.stops) || !stored.nextStop) return null;
  return {
    schemaVersion: 1,
    customSteps: Array.isArray(stored.customSteps) ? stored.customSteps : [],
    editingStopId: typeof stored.editingStopId === "string" ? stored.editingStopId : null,
    marginPercent: typeof stored.marginPercent === "number" && Number.isFinite(stored.marginPercent) ? stored.marginPercent : 15,
    nextStop: normalizedStop(stored.nextStop, "segment-1"),
    profileOpen: typeof stored.profileOpen === "boolean" ? stored.profileOpen : profileInitiallyOpen(),
    selectedPorkchopEvaluations: stored.selectedPorkchopEvaluations && typeof stored.selectedPorkchopEvaluations === "object" ? stored.selectedPorkchopEvaluations : {},
    selectedTransferSolutions: stored.selectedTransferSolutions && typeof stored.selectedTransferSolutions === "object" ? stored.selectedTransferSolutions : {},
    start: {
      bodyName: typeof stored.start.bodyName === "string" ? stored.start.bodyName : "Kerbin",
      endpoint: stored.start.endpoint === "orbit" ? "orbit" : "surface",
      parkingAltitude: typeof stored.start.parkingAltitude === "number" ? stored.start.parkingAltitude : defaultParkingAltitude("Kerbin", 80_000),
    },
    startLocked: typeof stored.startLocked === "boolean"
      ? stored.startLocked
      : stored.stops.length > 0 || Boolean(stored.nextStop.bodyName),
    stops: stored.stops.map((stop, index) => normalizedStop(stop, `segment-${index + 1}`)),
    transferMode: stored.transferMode === "advanced" ? "advanced" : "simple",
  };
}

function loadDraft(): DeltaVDraftSnapshot {
  try {
    return normalizeDraftSnapshot(
      JSON.parse(
        localStorage.getItem(DRAFT_STORAGE_KEY)
        ?? localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY)
        ?? "null",
      ),
    ) ?? defaultDraft();
  } catch {
    return defaultDraft();
  }
}

function createPlanId() {
  try {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Fall back for older embedded browsers.
  }
  return `delta-v-plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validLocation(value: Partial<SerialMissionLocation> | null | undefined) {
  return !!value
    && typeof value.bodyName === "string"
    && (value.endpoint === "surface" || value.endpoint === "orbit")
    && finiteNumber(value.parkingAltitude);
}

function validStop(value: Partial<MissionStopDraft> | null | undefined) {
  const arrival = value?.arrivalStrategy;
  return !!value
    && typeof value.id === "string"
    && validLocation(value)
    && !!arrival
    && typeof arrival.captureBeforeLanding === "boolean"
    && typeof arrival.aerocapture === "boolean"
    && typeof arrival.atmosphericLanding === "boolean"
    && finiteNumber(arrival.assistedLandingReserve)
    && (value.stayDurationDays === undefined || finiteNumber(value.stayDurationDays));
}

function validCustomStep(value: Partial<CustomDeltaVStep> | null | undefined) {
  return !!value
    && typeof value.id === "string"
    && typeof value.afterLegId === "string"
    && typeof value.label === "string"
    && finiteNumber(value.deltaV);
}

function validTransferSolution(value: unknown) {
  const solution = value as Partial<LiveTransferSolution> | null;
  return !!solution
    && typeof solution.requestId === "string"
    && typeof solution.fingerprint === "string"
    && typeof solution.origin === "string"
    && typeof solution.destination === "string"
    && finiteNumber(solution.originParkingAltitude)
    && finiteNumber(solution.destinationParkingAltitude)
    && typeof solution.optimizePoweredCapture === "boolean"
    && finiteNumber(solution.departureUT)
    && finiteNumber(solution.arrivalUT)
    && finiteNumber(solution.transferTime)
    && finiteNumber(solution.ejectionDeltaV)
    && finiteNumber(solution.arrivalVInfinity);
}

function validEvaluation(value: unknown) {
  const evaluation = value as Partial<PorkchopEvaluation> | null;
  return !!evaluation
    && typeof evaluation.requestId === "string"
    && typeof evaluation.fingerprint === "string"
    && Number.isInteger(evaluation.departureIndex)
    && Number.isInteger(evaluation.transferTimeIndex)
    && finiteNumber(evaluation.departureUT)
    && finiteNumber(evaluation.arrivalUT)
    && finiteNumber(evaluation.transferTime)
    && finiteNumber(evaluation.ejectionDeltaV)
    && finiteNumber(evaluation.arrivalVInfinity)
    && finiteNumber(evaluation.rawCost);
}

function validPlanRecord(value: unknown): value is SavedDeltaVPlanRecord {
  const record = value as Partial<SavedDeltaVPlanRecord> | null;
  const plan = record?.plan;
  const draft = record?.draft;
  return !!record
    && typeof record.id === "string"
    && typeof record.name === "string"
    && !!plan
    && typeof plan.origin?.name === "string"
    && typeof plan.destination?.name === "string"
    && (plan.direction === "oneWay" || plan.direction === "roundTrip")
    && Array.isArray(plan.legs)
    && plan.legs.every((leg) =>
      typeof leg?.id === "string"
      && typeof leg.label === "string"
      && typeof leg.note === "string"
      && finiteNumber(leg.deltaV)
      && ["ascent", "departure", "transfer", "capture", "deorbit", "landing", "custom"].includes(leg.kind),
    )
    && finiteNumber(plan.nominalDeltaV)
    && finiteNumber(plan.marginDeltaV)
    && finiteNumber(plan.totalDeltaV)
    && Array.isArray(plan.assumptions)
    && !!draft
    && draft.schemaVersion === 1
    && validLocation(draft.start)
    && validStop(draft.nextStop)
    && Array.isArray(draft.stops)
    && draft.stops.every(validStop)
    && Array.isArray(draft.customSteps)
    && draft.customSteps.every(validCustomStep)
    && !!draft.selectedPorkchopEvaluations
    && typeof draft.selectedPorkchopEvaluations === "object"
    && Object.values(draft.selectedPorkchopEvaluations).every((entry) => entry === undefined || validEvaluation(entry))
    && !!draft.selectedTransferSolutions
    && typeof draft.selectedTransferSolutions === "object"
    && Object.values(draft.selectedTransferSolutions).every((entry) => entry === undefined || validTransferSolution(entry));
}

function normalizedCompletedLegIds(plan: DeltaVPlan, value: unknown) {
  if (!Array.isArray(value)) return [];
  const validIds = new Set(plan.legs.map((leg) => leg.id));
  return [...new Set(value.filter((id): id is string => typeof id === "string" && validIds.has(id)))];
}

function normalizedPlanRecord(value: unknown): SavedDeltaVPlanRecord | null {
  if (!validPlanRecord(value)) return null;
  return {
    id: value.id,
    name: value.name,
    saveFolder: typeof value.saveFolder === "string" ? value.saveFolder.trim() : "",
    plan: value.plan,
    draft: {
      ...value.draft,
      startLocked: typeof value.draft.startLocked === "boolean"
        ? value.draft.startLocked
        : value.draft.stops.length > 0 || Boolean(value.draft.nextStop.bodyName),
    },
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

interface LoadedDeltaVLibrary {
  library: DeltaVPlanLibrary;
  persistOnMount: boolean;
}

function loadLibrary(): LoadedDeltaVLibrary {
  try {
    const stored = JSON.parse(
      localStorage.getItem(LIBRARY_STORAGE_KEY)
      ?? localStorage.getItem(LEGACY_LIBRARY_STORAGE_KEY)
      ?? "null",
    ) as {
      schemaVersion?: number;
      plans?: unknown[];
      assignments?: unknown[];
      legacyPinned?: unknown;
      pinnedPlanId?: unknown;
    } | null;
    if ((stored?.schemaVersion === 1 || stored?.schemaVersion === 2) && Array.isArray(stored.plans)) {
      const plans = stored.plans.map(normalizedPlanRecord).filter((record): record is SavedDeltaVPlanRecord => record !== null);
      const plansById = new Map(plans.map((record) => [record.id, record]));
      if (stored.schemaVersion === 1) {
        const pinnedPlanId = typeof stored.pinnedPlanId === "string" && plansById.has(stored.pinnedPlanId)
          ? stored.pinnedPlanId
          : null;
        const legacySource = pinnedPlanId
          ? stored.plans.find((value) => (value as { id?: unknown } | null)?.id === pinnedPlanId) as { completedLegIds?: unknown } | undefined
          : undefined;
        return {
          library: {
            schemaVersion: 2,
            plans,
            assignments: [],
            legacyPinned: pinnedPlanId ? {
              planId: pinnedPlanId,
              completedLegIds: normalizedCompletedLegIds(plansById.get(pinnedPlanId)!.plan, legacySource?.completedLegIds),
            } : null,
          },
          persistOnMount: stored.plans.length === 0 || plans.length > 0,
        };
      }

      const assignments = (Array.isArray(stored.assignments) ? stored.assignments : []).flatMap((value) => {
        const assignment = value as Partial<PinnedPlanAssignment> | null;
        const plan = typeof assignment?.planId === "string" ? plansById.get(assignment.planId) : undefined;
        if (!assignment || !plan || typeof assignment.id !== "string"
          || typeof assignment.saveFolder !== "string" || !assignment.saveFolder
          || typeof assignment.anchorPartPersistentId !== "string" || !assignment.anchorPartPersistentId) return [];
        return [{
          id: assignment.id,
          planId: plan.id,
          saveFolder: assignment.saveFolder,
          craftName: typeof assignment.craftName === "string" ? assignment.craftName : "",
          anchorPartPersistentId: assignment.anchorPartPersistentId,
          editorCraftPersistentId: typeof assignment.editorCraftPersistentId === "string" ? assignment.editorCraftPersistentId : undefined,
          lastVesselGuid: typeof assignment.lastVesselGuid === "string" ? assignment.lastVesselGuid : undefined,
          completedLegIds: normalizedCompletedLegIds(plan.plan, assignment.completedLegIds),
          pinnedAt: typeof assignment.pinnedAt === "string" ? assignment.pinnedAt : "",
          updatedAt: typeof assignment.updatedAt === "string" ? assignment.updatedAt : "",
        }];
      });
      const legacy = stored.legacyPinned as Partial<LegacyPinnedPlan> | null;
      const legacyPlan = typeof legacy?.planId === "string" ? plansById.get(legacy.planId) : undefined;
      return {
        library: {
          schemaVersion: 2,
          plans,
          assignments,
          legacyPinned: legacyPlan ? {
            planId: legacyPlan.id,
            completedLegIds: normalizedCompletedLegIds(legacyPlan.plan, legacy?.completedLegIds),
          } : null,
        },
        persistOnMount: stored.plans.length === 0 || plans.length > 0,
      };
    }
  } catch {
    // Browser storage is optional; in-memory planning remains available.
  }
  return {
    library: { schemaVersion: 2, plans: [], assignments: [], legacyPinned: null },
    persistOnMount: false,
  };
}

function normalizeSharedLibrary(value: unknown): DeltaVPlanLibrary | null {
  const stored = value as {
    schemaVersion?: number;
    plans?: unknown[];
    assignments?: unknown[];
    legacyPinned?: unknown;
  } | null;
  if (stored?.schemaVersion !== 2 || !Array.isArray(stored.plans)) return null;
  const plans = stored.plans
    .map(normalizedPlanRecord)
    .filter((record): record is SavedDeltaVPlanRecord => record !== null);
  const plansById = new Map(plans.map((record) => [record.id, record]));
  const assignments = (Array.isArray(stored.assignments) ? stored.assignments : []).flatMap((value) => {
    const assignment = value as Partial<PinnedPlanAssignment> | null;
    const plan = typeof assignment?.planId === "string" ? plansById.get(assignment.planId) : undefined;
    if (!assignment || !plan || typeof assignment.id !== "string"
      || typeof assignment.saveFolder !== "string" || !assignment.saveFolder
      || typeof assignment.anchorPartPersistentId !== "string" || !assignment.anchorPartPersistentId) return [];
    return [{
      id: assignment.id,
      planId: plan.id,
      saveFolder: assignment.saveFolder,
      craftName: typeof assignment.craftName === "string" ? assignment.craftName : "",
      anchorPartPersistentId: assignment.anchorPartPersistentId,
      editorCraftPersistentId: typeof assignment.editorCraftPersistentId === "string" ? assignment.editorCraftPersistentId : undefined,
      lastVesselGuid: typeof assignment.lastVesselGuid === "string" ? assignment.lastVesselGuid : undefined,
      completedLegIds: normalizedCompletedLegIds(plan.plan, assignment.completedLegIds),
      pinnedAt: typeof assignment.pinnedAt === "string" ? assignment.pinnedAt : "",
      updatedAt: typeof assignment.updatedAt === "string" ? assignment.updatedAt : "",
    }];
  });
  const legacy = stored.legacyPinned as Partial<LegacyPinnedPlan> | null;
  const legacyPlan = typeof legacy?.planId === "string" ? plansById.get(legacy.planId) : undefined;
  return {
    schemaVersion: 2,
    plans,
    assignments,
    legacyPinned: legacyPlan ? {
      planId: legacyPlan.id,
      completedLegIds: normalizedCompletedLegIds(legacyPlan.plan, legacy?.completedLegIds),
    } : null,
  };
}

function telemetryText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function telemetryIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(telemetryText).filter(Boolean))];
}

export function deltaVCraftIdentity(snapshot?: TelemetrySnapshot | null): DeltaVCraftIdentity | null {
  if (!snapshot || snapshot["identity.available"] !== true) return null;
  const scene = snapshot["context.mode"];
  const saveFolder = telemetryText(snapshot["game.saveFolder"]);
  if (scene === "editor") {
    const craftPersistentId = telemetryText(snapshot["editor.craftPersistentId"]);
    const rootPartPersistentId = telemetryText(snapshot["editor.rootPartPersistentId"]);
    const partPersistentIds = telemetryIds(snapshot["editor.partPersistentIds"]);
    if (!saveFolder || !craftPersistentId || !rootPartPersistentId || !partPersistentIds.includes(rootPartPersistentId)) return null;
    return {
      scene,
      saveFolder,
      craftName: telemetryText(snapshot["editor.craftName"]),
      craftPersistentId,
      rootPartPersistentId,
      partPersistentIds,
    };
  }
  if (scene === "flight") {
    const craftPersistentId = telemetryText(snapshot["v.persistentId"]);
    const rootPartPersistentId = telemetryText(snapshot["v.rootPartPersistentId"]);
    const vesselGuid = telemetryText(snapshot["v.guid"]);
    const partPersistentIds = telemetryIds(snapshot["v.partPersistentIds"]);
    if (!saveFolder || !craftPersistentId || !rootPartPersistentId || !vesselGuid || !partPersistentIds.includes(rootPartPersistentId)) return null;
    return {
      scene,
      saveFolder,
      craftName: telemetryText(snapshot["v.name"]),
      craftPersistentId,
      rootPartPersistentId,
      partPersistentIds,
      vesselGuid,
    };
  }
  return null;
}

function assignmentPriority(assignment: PinnedPlanAssignment, identity: DeltaVCraftIdentity) {
  let priority = 0;
  if (identity.scene === "flight" && assignment.lastVesselGuid === identity.vesselGuid) priority += 100;
  if (identity.scene === "editor" && assignment.editorCraftPersistentId === identity.craftPersistentId) priority += 30;
  if (assignment.anchorPartPersistentId === identity.rootPartPersistentId) priority += 10;
  return priority;
}

function selectAssignment(library: DeltaVPlanLibrary, identity: DeltaVCraftIdentity | null) {
  if (!identity) return null;
  const memberIds = new Set(identity.partPersistentIds);
  return library.assignments
    .filter((assignment) => assignment.saveFolder === identity.saveFolder
      && memberIds.has(assignment.anchorPartPersistentId)
      && library.plans.some((plan) => plan.id === assignment.planId))
    .sort((left, right) => assignmentPriority(right, identity) - assignmentPriority(left, identity)
      || Date.parse(right.pinnedAt || "1970-01-01") - Date.parse(left.pinnedAt || "1970-01-01")
      || left.id.localeCompare(right.id))[0] ?? null;
}

function resolvedPinnedPlan(library: DeltaVPlanLibrary, snapshot?: TelemetrySnapshot | null): PinnedDeltaVPlanRecord | null {
  const identity = deltaVCraftIdentity(snapshot);
  const assignment = selectAssignment(library, identity);
  if (assignment) {
    const record = library.plans.find((plan) => plan.id === assignment.planId);
    if (record) return { ...record, assignmentId: assignment.id, completedLegIds: assignment.completedLegIds, craftBound: true };
  }
  if (!identity && library.legacyPinned) {
    const record = library.plans.find((plan) => plan.id === library.legacyPinned?.planId);
    if (record) return { ...record, assignmentId: null, completedLegIds: library.legacyPinned.completedLegIds, craftBound: false };
  }
  return null;
}

function nextCounter(prefix: string, values: string[], fallback: number) {
  return Math.max(fallback, ...values.map((value) => Number(value.match(new RegExp(`^${prefix}-(\\d+)$`))?.[1] ?? 0) + 1));
}

function clonedDraft(draft: DeltaVDraftSnapshot): DeltaVDraftSnapshot {
  const cloned = JSON.parse(JSON.stringify(draft)) as DeltaVDraftSnapshot;
  return {
    ...cloned,
    selectedPorkchopEvaluations: cloned.selectedPorkchopEvaluations ?? {},
    selectedTransferSolutions: cloned.selectedTransferSolutions ?? {},
    startLocked: typeof cloned.startLocked === "boolean"
      ? cloned.startLocked
      : cloned.stops.length > 0 || Boolean(cloned.nextStop.bodyName),
  };
}

function defaultPlanName(draft: DeltaVDraftSnapshot, plan: DeltaVPlan) {
  const route = [draft.start.bodyName, ...draft.stops.map((stop) => stop.bodyName)];
  if (!draft.editingStopId && draft.nextStop.bodyName) route.push(draft.nextStop.bodyName);
  const visibleRoute = route.filter(Boolean);
  return `${visibleRoute.length > 1 ? visibleRoute.join(" → ") : `${plan.origin.name} → ${plan.destination.name}`} mission`;
}

export function DeltaVDraftProvider({ children }: PropsWithChildren) {
  const [seed] = useState(loadDraft);
  const [start, setStart] = useState<MissionStartDraft>(seed.start);
  const [startLocked, setStartLocked] = useState(seed.startLocked);
  const [stops, setStops] = useState<MissionStopDraft[]>(seed.stops);
  const [nextStop, setNextStop] = useState<MissionStopDraft>(seed.nextStop);
  const [editingStopId, setEditingStopId] = useState<string | null>(seed.editingStopId);
  const [customSteps, setCustomSteps] = useState<CustomDeltaVStep[]>(seed.customSteps);
  const nextCustomStep = useRef(nextCounter("custom", seed.customSteps.map((step) => step.id), 1));
  const nextMissionStop = useRef(nextCounter("segment", [...seed.stops.map((stop) => stop.id), seed.nextStop.id], 2));
  const [marginPercent, setMarginPercent] = useState(seed.marginPercent);
  const [transferMode, setTransferMode] = useState<TransferPlanningMode>(seed.transferMode);
  const [profileOpen, setProfileOpen] = useState(seed.profileOpen);
  const [selectedPorkchopEvaluations, setSelectedPorkchopEvaluations] = useState<Partial<Record<string, PorkchopEvaluation>>>(seed.selectedPorkchopEvaluations);
  const [selectedTransferSolutions, setSelectedTransferSolutions] = useState<Partial<Record<string, LiveTransferSolution>>>(seed.selectedTransferSolutions);
  const [loadedLibrary] = useState(loadLibrary);
  const [library, setLibrary] = useState<DeltaVPlanLibrary>(loadedLibrary.library);
  const [activeSavedPlanId, setActiveSavedPlanId] = useState<string | null>(null);
  const [resetRevision, setResetRevision] = useState(0);
  const transferRouteSignature = useRef("");

  const draft = useMemo<DeltaVDraftSnapshot>(() => ({
    schemaVersion: 1,
    customSteps,
    editingStopId,
    marginPercent,
    nextStop,
    profileOpen,
    selectedPorkchopEvaluations,
    selectedTransferSolutions,
    start,
    startLocked,
    stops,
    transferMode,
  }), [customSteps, editingStopId, marginPercent, nextStop, profileOpen, selectedPorkchopEvaluations, selectedTransferSolutions, start, startLocked, stops, transferMode]);
  const draftHasContent = activeSavedPlanId !== null || draftHasMeaningfulContent(draft);

  useSharedPlannerPersistence({
    clearLocalKeys: [LEGACY_DRAFT_STORAGE_KEY],
    localStorageKey: DRAFT_STORAGE_KEY,
    normalize: normalizeDraftSnapshot,
    onRemoteValue: (restored) => {
      setStart(restored.start);
      setStartLocked(restored.startLocked);
      setStops(restored.stops);
      setNextStop(restored.nextStop);
      setEditingStopId(restored.editingStopId);
      setCustomSteps(restored.customSteps);
      setMarginPercent(restored.marginPercent);
      setTransferMode(restored.transferMode);
      setProfileOpen(restored.profileOpen);
      setSelectedPorkchopEvaluations(restored.selectedPorkchopEvaluations);
      setSelectedTransferSolutions(restored.selectedTransferSolutions);
    },
    section: "deltaVDraft",
    value: draft,
  });

  useSharedPlannerPersistence({
    allowInitialLocalWrite: loadedLibrary.persistOnMount,
    clearLocalKeys: [LEGACY_LIBRARY_STORAGE_KEY],
    localStorageKey: LIBRARY_STORAGE_KEY,
    normalize: normalizeSharedLibrary,
    onRemoteValue: setLibrary,
    section: "deltaVLibrary",
    value: library,
  });

  const savePlan = useCallback((plan: DeltaVPlan, requestedName: string, options?: { asNew?: boolean; saveFolder?: string }): SaveDeltaVPlanResult => {
    const timestamp = new Date().toISOString();
    const target = options?.asNew ? undefined : library.plans.find((candidate) => candidate.id === activeSavedPlanId);
    const name = requestedName.trim() || defaultPlanName(draft, plan);
    const saveFolder = target?.saveFolder || options?.saveFolder?.trim() || "";
    const duplicate = library.plans.find((candidate) => candidate.id !== target?.id
      && candidate.saveFolder === saveFolder
      && candidate.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) return { status: "duplicate", id: duplicate.id, name: duplicate.name };

    if (target) {
      const record: SavedDeltaVPlanRecord = {
        ...target,
        name,
        saveFolder,
        plan,
        draft: clonedDraft(draft),
        updatedAt: timestamp,
      };
      setLibrary((current) => ({
        ...current,
        plans: current.plans.map((candidate) => candidate.id === target.id ? record : candidate),
        assignments: current.assignments.map((assignment) => assignment.planId === target.id
          ? { ...assignment, completedLegIds: normalizedCompletedLegIds(plan, assignment.completedLegIds) }
          : assignment),
        legacyPinned: current.legacyPinned?.planId === target.id
          ? { ...current.legacyPinned, completedLegIds: normalizedCompletedLegIds(plan, current.legacyPinned.completedLegIds) }
          : current.legacyPinned,
      }));
      return { status: "updated", id: target.id, name };
    }

    const id = createPlanId();
    const record: SavedDeltaVPlanRecord = {
      id,
      name,
      saveFolder,
      plan,
      draft: clonedDraft(draft),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    setLibrary((current) => ({ ...current, plans: [record, ...current.plans] }));
    setActiveSavedPlanId(id);
    return { status: "created", id, name };
  }, [activeSavedPlanId, draft, library.plans]);

  const deletePlan = useCallback((id: string) => {
    setLibrary((current) => ({
      ...current,
      plans: current.plans.filter((record) => record.id !== id),
      assignments: current.assignments.filter((assignment) => assignment.planId !== id),
      legacyPinned: current.legacyPinned?.planId === id ? null : current.legacyPinned,
    }));
    setActiveSavedPlanId((current) => current === id ? null : current);
  }, []);

  const linkPlansToSave = useCallback((ids: string[], requestedSaveFolder: string) => {
    const saveFolder = requestedSaveFolder.trim();
    if (!saveFolder || ids.length === 0) return;
    const selectedIds = new Set(ids);
    setLibrary((current) => ({
      ...current,
      plans: current.plans.map((record) => selectedIds.has(record.id) && !record.saveFolder
        ? { ...record, saveFolder }
        : record),
    }));
  }, []);

  const pinPlan = useCallback((id: string, snapshot?: TelemetrySnapshot | null) => {
    const identity = deltaVCraftIdentity(snapshot);
    setLibrary((current) => {
      const plan = current.plans.find((record) => record.id === id);
      if (!plan) return current;
      if (!identity) {
        const completedLegIds = current.legacyPinned?.planId === id
          ? current.legacyPinned.completedLegIds
          : [];
        return { ...current, legacyPinned: { planId: id, completedLegIds } };
      }

      const timestamp = new Date().toISOString();
      const selected = selectAssignment(current, identity);
      const sameAnchor = current.assignments.find((assignment) => assignment.saveFolder === identity.saveFolder
        && assignment.anchorPartPersistentId === identity.rootPartPersistentId);
      const existing = selected ?? sameAnchor;
      const seededCompletion = existing?.planId === id
        ? existing.completedLegIds
        : current.legacyPinned?.planId === id
          ? current.legacyPinned.completedLegIds
          : [];
      const assignment: PinnedPlanAssignment = {
        id: existing?.id ?? `delta-v-assignment-${createPlanId()}`,
        planId: id,
        saveFolder: identity.saveFolder,
        craftName: identity.craftName,
        anchorPartPersistentId: existing?.anchorPartPersistentId ?? identity.rootPartPersistentId,
        editorCraftPersistentId: identity.scene === "editor"
          ? identity.craftPersistentId
          : existing?.editorCraftPersistentId,
        lastVesselGuid: identity.scene === "flight"
          ? identity.vesselGuid
          : existing?.lastVesselGuid,
        completedLegIds: seededCompletion,
        pinnedAt: existing?.pinnedAt ?? timestamp,
        updatedAt: existing?.planId === id ? existing.updatedAt : timestamp,
      };
      return {
        ...current,
        plans: current.plans.map((record) => record.id === id && !record.saveFolder
          ? { ...record, saveFolder: identity.saveFolder }
          : record),
        assignments: existing
          ? current.assignments.map((candidate) => candidate.id === existing.id ? assignment : candidate)
          : [...current.assignments, assignment],
        legacyPinned: null,
      };
    });
  }, []);

  const unpinPlan = useCallback((snapshot?: TelemetrySnapshot | null) => {
    const identity = deltaVCraftIdentity(snapshot);
    setLibrary((current) => {
      const assignment = selectAssignment(current, identity);
      if (assignment) return { ...current, assignments: current.assignments.filter((candidate) => candidate.id !== assignment.id) };
      if (!identity && current.legacyPinned) return { ...current, legacyPinned: null };
      return current;
    });
  }, []);

  const setPinnedStepComplete = useCallback((legId: string, complete: boolean, snapshot?: TelemetrySnapshot | null) => {
    const identity = deltaVCraftIdentity(snapshot);
    setLibrary((current) => {
      const assignment = selectAssignment(current, identity);
      const planId = assignment?.planId ?? (!identity ? current.legacyPinned?.planId : undefined);
      const plan = current.plans.find((record) => record.id === planId);
      if (!plan?.plan.legs.some((leg) => leg.id === legId)) return current;
      const sourceIds = assignment?.completedLegIds ?? current.legacyPinned?.completedLegIds ?? [];
      const completed = new Set(sourceIds);
      if (complete) completed.add(legId);
      else completed.delete(legId);
      const completedLegIds = [...completed];
      if (completedLegIds.length === sourceIds.length
        && completedLegIds.every((value, index) => value === sourceIds[index])) return current;
      if (assignment) {
        const timestamp = new Date().toISOString();
        return {
          ...current,
          assignments: current.assignments.map((candidate) => candidate.id === assignment.id
            ? { ...candidate, completedLegIds, updatedAt: timestamp }
            : candidate),
        };
      }
      return { ...current, legacyPinned: { planId: plan.id, completedLegIds } };
    });
  }, []);

  const pinnedForTelemetry = useCallback(
    (snapshot?: TelemetrySnapshot | null) => resolvedPinnedPlan(library, snapshot),
    [library],
  );

  const rememberPinnedCraft = useCallback((snapshot?: TelemetrySnapshot | null) => {
    const identity = deltaVCraftIdentity(snapshot);
    if (identity?.scene !== "flight") return;
    setLibrary((current) => {
      const assignment = selectAssignment(current, identity);
      if (!assignment || assignment.lastVesselGuid === identity.vesselGuid) return current;
      return {
        ...current,
        assignments: current.assignments.map((candidate) => candidate.id === assignment.id
          ? { ...candidate, craftName: identity.craftName, lastVesselGuid: identity.vesselGuid }
          : candidate),
      };
    });
  }, []);

  const loadPlan = useCallback((id: string) => {
    const record = library.plans.find((candidate) => candidate.id === id);
    if (!record) return;
    const restored = clonedDraft(record.draft);
    setStart(restored.start);
    setStartLocked(restored.startLocked);
    setStops(restored.stops);
    setNextStop(restored.nextStop);
    setEditingStopId(restored.editingStopId);
    setCustomSteps(restored.customSteps);
    setMarginPercent(restored.marginPercent);
    setTransferMode(restored.transferMode);
    setProfileOpen(restored.profileOpen);
    setSelectedPorkchopEvaluations(restored.selectedPorkchopEvaluations);
    setSelectedTransferSolutions(restored.selectedTransferSolutions);
    setActiveSavedPlanId(record.id);
    nextCustomStep.current = nextCounter("custom", restored.customSteps.map((step) => step.id), 1);
    nextMissionStop.current = nextCounter("segment", [...restored.stops.map((stop) => stop.id), restored.nextStop.id], 2);
    transferRouteSignature.current = "";
  }, [library.plans]);

  const resetDraft = useCallback(() => {
    const fresh = defaultDraft();
    setStart(fresh.start);
    setStartLocked(fresh.startLocked);
    setStops(fresh.stops);
    setNextStop(fresh.nextStop);
    setEditingStopId(fresh.editingStopId);
    setCustomSteps(fresh.customSteps);
    setMarginPercent(fresh.marginPercent);
    setTransferMode(fresh.transferMode);
    setProfileOpen(fresh.profileOpen);
    setSelectedPorkchopEvaluations(fresh.selectedPorkchopEvaluations);
    setSelectedTransferSolutions(fresh.selectedTransferSolutions);
    setActiveSavedPlanId(null);
    nextCustomStep.current = 1;
    nextMissionStop.current = 2;
    transferRouteSignature.current = "";
    setResetRevision((current) => current + 1);
  }, []);

  const value = useMemo<DeltaVDraftState>(() => ({
    activeSavedPlanId,
    customSteps,
    deletePlan,
    draftHasContent,
    editingStopId,
    linkPlansToSave,
    loadPlan,
    marginPercent,
    nextCustomStep,
    nextMissionStop,
    nextStop,
    pinPlan,
    pinnedForTelemetry,
    profileOpen,
    rememberPinnedCraft,
    resetDraft,
    resetRevision,
    savedPlans: library.plans,
    savePlan,
    setPinnedStepComplete,
    selectedPorkchopEvaluations,
    selectedTransferSolutions,
    setCustomSteps,
    setEditingStopId,
    setMarginPercent,
    setNextStop,
    setProfileOpen,
    setSelectedPorkchopEvaluations,
    setSelectedTransferSolutions,
    setStart,
    setStartLocked,
    setStops,
    setTransferMode,
    start,
    startLocked,
    stops,
    transferMode,
    transferRouteSignature,
    unpinPlan,
  }), [activeSavedPlanId, customSteps, deletePlan, draftHasContent, editingStopId, library.plans, linkPlansToSave, loadPlan, marginPercent, nextStop, pinPlan, pinnedForTelemetry, profileOpen, rememberPinnedCraft, resetDraft, resetRevision, savePlan, selectedPorkchopEvaluations, selectedTransferSolutions, setPinnedStepComplete, start, startLocked, stops, transferMode, unpinPlan]);

  return <DeltaVDraftContext.Provider value={value}>{children}</DeltaVDraftContext.Provider>;
}

export function useOptionalDeltaVDraft() {
  return useContext(DeltaVDraftContext);
}

export function useDeltaVDraft() {
  const state = useOptionalDeltaVDraft();
  if (!state) throw new Error("useDeltaVDraft must be used within DeltaVDraftProvider.");
  return state;
}
