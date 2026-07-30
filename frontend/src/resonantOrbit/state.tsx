import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { useSharedPlannerPersistence } from "../sharedPlannerPersistence";
import type { TelemetrySnapshot } from "../telemetry/types";
import { DISTANCE_UNITS, type DistanceUnit, type ResonantOrbitPlan } from "./calculations";

const LIBRARY_STORAGE_KEY = "wmc-prototype-resonant-library-v2";
const LEGACY_PLAN_STORAGE_KEY = "wmc-prototype-resonant-plan-v1";
const UNIT_STORAGE_KEY = "wmc-prototype-resonant-unit-v1";
const LEGACY_LIBRARY_KEYS = [LEGACY_PLAN_STORAGE_KEY];

export interface SavedPlanRecord {
  id: string;
  name: string;
  plan: ResonantOrbitPlan;
  releaseCount: number;
  saveFolder: string;
  useOcclusionModifiers: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PlanLibraryState {
  schemaVersion: 4;
  plans: SavedPlanRecord[];
  pinnedPlanId: string | null;
}

interface LegacyPinnedPlanState {
  plan: ResonantOrbitPlan;
  releaseCount: number;
  pinnedAt: string;
}

interface ResonantOrbitStateValue {
  activeSavedPlanId: string | null;
  deltaVDrawerOpen: boolean;
  drawerOpen: boolean;
  pinned: SavedPlanRecord | null;
  savedPlans: SavedPlanRecord[];
  unit: DistanceUnit;
  closeDrawer(): void;
  closeDeltaVDrawer(): void;
  deletePlan(id: string): void;
  linkPlansToSave(ids: string[], saveFolder: string): void;
  loadPlan(id: string): SavedPlanRecord | null;
  openDrawer(): void;
  openDeltaVDrawer(): void;
  pinPlan(id: string, saveFolder?: string): void;
  pinnedForTelemetry(snapshot?: TelemetrySnapshot | null): SavedPlanRecord | null;
  savePlan(
    plan: ResonantOrbitPlan,
    name: string,
    options?: { asNew?: boolean; saveFolder?: string; useOcclusionModifiers?: boolean },
  ): SaveResonantOrbitPlanResult;
  setReleaseCount(value: number): void;
  setUnit(unit: DistanceUnit): void;
  toggleDrawer(): void;
  toggleDeltaVDrawer(): void;
  unpinPlan(): void;
}

export type SaveResonantOrbitPlanResult =
  | { status: "created" | "updated"; id: string; name: string }
  | { status: "duplicate"; id: string; name: string };

function defaultPlanName(plan: ResonantOrbitPlan) {
  const ratio = plan.mode === "raise"
    ? `${plan.satelliteCount + 1}:${plan.satelliteCount}`
    : `${plan.satelliteCount - 1}:${plan.satelliteCount}`;
  return `${plan.body.name} ${ratio} ${plan.mode} orbit`;
}

function createPlanId() {
  try {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Fall back for older embedded browsers.
  }
  return `plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validBody(value: ResonantOrbitPlan["body"] | undefined) {
  return !!value
    && typeof value.name === "string"
    && finiteNumber(value.gravitationalParameter)
    && finiteNumber(value.radius)
    && finiteNumber(value.rotationPeriod)
    && finiteNumber(value.atmosphereDepth)
    && finiteNumber(value.sphereOfInfluence);
}

function validPlan(value: ResonantOrbitPlan | undefined) {
  return !!value
    && value.schemaVersion === 1
    && validBody(value.body)
    && Number.isInteger(value.satelliteCount)
    && value.satelliteCount >= 2
    && finiteNumber(value.targetAltitude)
    && (value.mode === "raise" || value.mode === "dive")
    && ["auto", "raise", "dive"].includes(value.requestedMode)
    && finiteNumber(value.resonanceRatio)
    && finiteNumber(value.finalPeriod)
    && finiteNumber(value.carrierPeriod)
    && finiteNumber(value.carrierApoapsis)
    && finiteNumber(value.carrierPeriapsis)
    && finiteNumber(value.injectionDeltaV)
    && finiteNumber(value.minimumLosAltitude)
    && finiteNumber(value.lineOfSightLength)
    && finiteNumber(value.synchronousAltitude)
    && finiteNumber(value.soiAltitude)
    && (value.releaseAt === "apoapsis" || value.releaseAt === "periapsis")
    && Array.isArray(value.warnings)
    && value.warnings.every((warning) =>
      typeof warning?.code === "string"
      && ["danger", "warning", "info"].includes(warning.level)
      && typeof warning.message === "string",
    );
}

function validPlanRecord(value: unknown): value is SavedPlanRecord {
  const record = value as Partial<SavedPlanRecord> | null;
  return !!record
    && typeof record.id === "string"
    && typeof record.name === "string"
    && validPlan(record.plan);
}

function normalizePlanRecord(record: SavedPlanRecord): SavedPlanRecord {
  return {
    ...record,
    releaseCount: finiteNumber(record.releaseCount)
      ? Math.max(0, Math.min(record.plan.satelliteCount, Math.floor(record.releaseCount)))
      : 0,
    saveFolder: typeof record.saveFolder === "string" ? record.saveFolder.trim() : "",
    useOcclusionModifiers: typeof record.useOcclusionModifiers === "boolean"
      ? record.useOcclusionModifiers
      : true,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
  };
}

function normalizeSharedLibrary(value: unknown): PlanLibraryState | null {
  const saved = value as Partial<PlanLibraryState> | null;
  if (saved?.schemaVersion !== 4 || !Array.isArray(saved.plans)) return null;
  const plans = saved.plans.filter(validPlanRecord).map(normalizePlanRecord);
  return {
    schemaVersion: 4,
    plans,
    pinnedPlanId: plans.some((record) => record.id === saved.pinnedPlanId)
      ? saved.pinnedPlanId ?? null
      : null,
  };
}

interface LoadedPlanLibrary {
  library: PlanLibraryState;
  persistOnMount: boolean;
}

function loadLibrary(): LoadedPlanLibrary {
  try {
    const saved = JSON.parse(localStorage.getItem(LIBRARY_STORAGE_KEY) ?? "null") as (Omit<PlanLibraryState, "schemaVersion"> & { schemaVersion?: number }) | null;
    if ((saved?.schemaVersion === 2 || saved?.schemaVersion === 3 || saved?.schemaVersion === 4) && Array.isArray(saved.plans)) {
      const plans = saved.plans.filter(validPlanRecord).map(normalizePlanRecord);
      return {
        library: {
          schemaVersion: 4,
          plans,
          pinnedPlanId: plans.some((record) => record.id === saved.pinnedPlanId) ? saved.pinnedPlanId : null,
        },
        persistOnMount: saved.plans.length === 0 || plans.length > 0,
      };
    }

    const legacy = JSON.parse(localStorage.getItem(LEGACY_PLAN_STORAGE_KEY) ?? "null") as LegacyPinnedPlanState | null;
    if (legacy && validPlan(legacy.plan)) {
      const timestamp = legacy.pinnedAt || new Date().toISOString();
      const record: SavedPlanRecord = {
        id: createPlanId(),
        name: defaultPlanName(legacy.plan),
        plan: legacy.plan,
        releaseCount: Math.max(0, Math.min(legacy.plan.satelliteCount, legacy.releaseCount || 0)),
        saveFolder: "",
        useOcclusionModifiers: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      return {
        library: { schemaVersion: 4, plans: [record], pinnedPlanId: record.id },
        persistOnMount: true,
      };
    }
  } catch {
    // Browser storage is optional; in-memory planning remains available.
  }
  return {
    library: { schemaVersion: 4, plans: [], pinnedPlanId: null },
    persistOnMount: false,
  };
}

function loadUnit(): DistanceUnit {
  try {
    const saved = localStorage.getItem(UNIT_STORAGE_KEY);
    if (saved && saved in DISTANCE_UNITS) return saved as DistanceUnit;
  } catch {
    // Browser storage is optional; in-memory planning remains available.
  }
  return "km";
}

const fallback: ResonantOrbitStateValue = {
  activeSavedPlanId: null,
  deltaVDrawerOpen: false,
  drawerOpen: false,
  pinned: null,
  savedPlans: [],
  unit: "km",
  closeDrawer() {},
  closeDeltaVDrawer() {},
  deletePlan() {},
  linkPlansToSave() {},
  loadPlan() { return null; },
  openDrawer() {},
  openDeltaVDrawer() {},
  pinPlan() {},
  pinnedForTelemetry() { return null; },
  savePlan() { return { status: "created", id: "", name: "" }; },
  setReleaseCount() {},
  setUnit() {},
  toggleDrawer() {},
  toggleDeltaVDrawer() {},
  unpinPlan() {},
};

const ResonantOrbitStateContext = createContext<ResonantOrbitStateValue>(fallback);

export function ResonantOrbitProvider({ children }: PropsWithChildren) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deltaVDrawerOpen, setDeltaVDrawerOpen] = useState(false);
  const [loadedLibrary] = useState(loadLibrary);
  const [library, setLibrary] = useState<PlanLibraryState>(loadedLibrary.library);
  const [activeSavedPlanId, setActiveSavedPlanId] = useState<string | null>(null);
  const [unit, setUnitState] = useState<DistanceUnit>(loadUnit);

  useSharedPlannerPersistence({
    allowInitialLocalWrite: loadedLibrary.persistOnMount,
    clearLocalKeys: LEGACY_LIBRARY_KEYS,
    localStorageKey: LIBRARY_STORAGE_KEY,
    normalize: normalizeSharedLibrary,
    onRemoteValue: setLibrary,
    section: "resonant",
    value: library,
  });

  const savePlan = useCallback((
    plan: ResonantOrbitPlan,
    requestedName: string,
    options?: { asNew?: boolean; saveFolder?: string; useOcclusionModifiers?: boolean },
  ): SaveResonantOrbitPlanResult => {
    const timestamp = new Date().toISOString();
    const target = options?.asNew
      ? undefined
      : library.plans.find((candidate) => candidate.id === activeSavedPlanId);
    const name = requestedName.trim() || defaultPlanName(plan);
    const saveFolder = target?.saveFolder || options?.saveFolder?.trim() || "";
    const duplicate = library.plans.find((candidate) => candidate.id !== target?.id
      && candidate.saveFolder === saveFolder
      && candidate.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) return { status: "duplicate", id: duplicate.id, name: duplicate.name };

    if (target) {
      const record: SavedPlanRecord = {
        ...target,
        name,
        plan,
        releaseCount: Math.min(target.releaseCount, plan.satelliteCount),
        useOcclusionModifiers: options?.useOcclusionModifiers ?? true,
        updatedAt: timestamp,
      };
      setLibrary((current) => ({
        ...current,
        plans: current.plans.map((candidate) => candidate.id === target.id ? record : candidate),
      }));
      return { status: "updated", id: target.id, name };
    }

    const id = createPlanId();
    const record: SavedPlanRecord = {
      id,
      name,
      plan,
      releaseCount: 0,
      saveFolder,
      useOcclusionModifiers: options?.useOcclusionModifiers ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    setLibrary((current) => ({ ...current, plans: [record, ...current.plans] }));
    setActiveSavedPlanId(id);
    return { status: "created", id, name };
  }, [activeSavedPlanId, library.plans]);

  const loadPlan = useCallback((id: string) => {
    const record = library.plans.find((candidate) => candidate.id === id) ?? null;
    if (record) setActiveSavedPlanId(record.id);
    return record;
  }, [library.plans]);

  const deletePlan = useCallback((id: string) => {
    setLibrary((current) => ({
      ...current,
      plans: current.plans.filter((record) => record.id !== id),
      pinnedPlanId: current.pinnedPlanId === id ? null : current.pinnedPlanId,
    }));
    setActiveSavedPlanId((current) => current === id ? null : current);
  }, []);

  const linkPlansToSave = useCallback((ids: string[], requestedSaveFolder: string) => {
    const saveFolder = requestedSaveFolder.trim();
    if (!saveFolder || ids.length === 0) return;
    const linkedIds = new Set(ids);
    setLibrary((current) => ({
      ...current,
      plans: current.plans.map((record) => linkedIds.has(record.id) && !record.saveFolder
        ? { ...record, saveFolder, updatedAt: new Date().toISOString() }
        : record),
    }));
  }, []);

  const pinPlan = useCallback((id: string, requestedSaveFolder = "") => {
    const saveFolder = requestedSaveFolder.trim();
    setLibrary((current) => ({
      ...current,
      plans: current.plans.map((record) => record.id === id && !record.saveFolder && saveFolder
        ? { ...record, saveFolder, updatedAt: new Date().toISOString() }
        : record),
      pinnedPlanId: current.plans.some((record) => record.id === id && (!saveFolder || !record.saveFolder || record.saveFolder === saveFolder))
        ? id
        : current.pinnedPlanId,
    }));
  }, []);

  const unpinPlan = useCallback(() => {
    setLibrary((current) => ({ ...current, pinnedPlanId: null }));
  }, []);

  const setReleaseCount = useCallback((value: number) => {
    setLibrary((current) => ({
      ...current,
      plans: current.plans.map((record) => {
        if (record.id !== current.pinnedPlanId) return record;
        return {
          ...record,
          releaseCount: Math.max(0, Math.min(record.plan.satelliteCount, value)),
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
  }, []);

  const setUnit = useCallback((next: DistanceUnit) => {
    setUnitState(next);
    try { localStorage.setItem(UNIT_STORAGE_KEY, next); } catch { /* optional preference */ }
  }, []);

  const pinned = useMemo(
    () => library.plans.find((record) => record.id === library.pinnedPlanId) ?? null,
    [library],
  );
  const pinnedForTelemetry = useCallback((snapshot?: TelemetrySnapshot | null) => {
    const saveFolder = typeof snapshot?.["game.saveFolder"] === "string"
      ? snapshot["game.saveFolder"].trim()
      : "";
    if (!pinned) return null;
    if (!saveFolder) return pinned.saveFolder ? null : pinned;
    return pinned.saveFolder === saveFolder ? pinned : null;
  }, [pinned]);

  const value = useMemo<ResonantOrbitStateValue>(() => ({
    activeSavedPlanId,
    deltaVDrawerOpen,
    drawerOpen,
    pinned,
    savedPlans: library.plans,
    unit,
    closeDrawer: () => setDrawerOpen(false),
    closeDeltaVDrawer: () => setDeltaVDrawerOpen(false),
    deletePlan,
    linkPlansToSave,
    loadPlan,
    openDrawer: () => { setDeltaVDrawerOpen(false); setDrawerOpen(true); },
    openDeltaVDrawer: () => { setDrawerOpen(false); setDeltaVDrawerOpen(true); },
    pinPlan,
    pinnedForTelemetry,
    savePlan,
    setReleaseCount,
    setUnit,
    toggleDrawer: () => setDrawerOpen((open) => {
      if (!open) setDeltaVDrawerOpen(false);
      return !open;
    }),
    toggleDeltaVDrawer: () => setDeltaVDrawerOpen((open) => {
      if (!open) setDrawerOpen(false);
      return !open;
    }),
    unpinPlan,
  }), [activeSavedPlanId, deletePlan, deltaVDrawerOpen, drawerOpen, library.plans, linkPlansToSave, loadPlan, pinPlan, pinned, pinnedForTelemetry, savePlan, setReleaseCount, setUnit, unit, unpinPlan]);

  return <ResonantOrbitStateContext.Provider value={value}>{children}</ResonantOrbitStateContext.Provider>;
}

export function useResonantOrbitState() {
  return useContext(ResonantOrbitStateContext);
}
