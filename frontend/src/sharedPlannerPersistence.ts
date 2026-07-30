import { useEffect, useRef, useSyncExternalStore } from "react";
import { liveTelemetryStore } from "./telemetry/store";
import type {
  MissionPlanningPersistenceSection,
  MissionPlanningPersistenceState,
} from "./telemetry/types";

type SectionStatus = "local" | "syncing" | "shared" | "error";

interface StatusRecord {
  message: string;
  status: SectionStatus;
}

const sectionStatuses = new Map<MissionPlanningPersistenceSection, StatusRecord>();
const statusListeners = new Set<() => void>();
const NO_LOCAL_KEYS: string[] = [];

function publishStatus(
  section: MissionPlanningPersistenceSection,
  status: SectionStatus,
  message: string,
) {
  const previous = sectionStatuses.get(section);
  if (previous?.status === status && previous.message === message) return;
  sectionStatuses.set(section, { status, message });
  statusListeners.forEach((listener) => listener());
}

function aggregateStatus(): StatusRecord {
  const records = [...sectionStatuses.values()];
  return records.find((record) => record.status === "error")
    ?? records.find((record) => record.status === "syncing")
    ?? (records.length > 0 && records.every((record) => record.status === "shared")
      ? { status: "shared", message: "Planner data is stored in the shared Mission Control file." }
      : { status: "local", message: "Planner data will sync when the dashboard feed connects." });
}

let aggregateSnapshot = aggregateStatus();

function statusSnapshot() {
  const next = aggregateStatus();
  if (
    next.status !== aggregateSnapshot.status
    || next.message !== aggregateSnapshot.message
  ) {
    aggregateSnapshot = next;
  }
  return aggregateSnapshot;
}

export function usePlannerPersistenceStatus() {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    statusSnapshot,
    statusSnapshot,
  );
}

interface SharedPlannerPersistenceOptions<T> {
  allowInitialLocalWrite?: boolean;
  clearLocalKeys?: string[];
  localStorageKey: string;
  normalize(value: unknown): T | null;
  onRemoteValue(value: T): void;
  section: MissionPlanningPersistenceSection;
  value: T;
}

let requestSequence = 0;

function requestId(section: MissionPlanningPersistenceSection, operation: string) {
  requestSequence += 1;
  return `planner-${section}-${operation}-${Date.now()}-${requestSequence}`;
}

function sameValue(left: unknown, right: unknown) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function useSharedPlannerPersistence<T>({
  allowInitialLocalWrite = true,
  clearLocalKeys = NO_LOCAL_KEYS,
  localStorageKey,
  normalize,
  onRemoteValue,
  section,
  value,
}: SharedPlannerPersistenceOptions<T>) {
  const valueRef = useRef(value);
  const normalizeRef = useRef(normalize);
  const onRemoteValueRef = useRef(onRemoteValue);
  const revisionRef = useRef(0);
  const hydratedRef = useRef(false);
  const linkedRef = useRef(false);
  const requestSentRef = useRef(false);
  const inFlightRef = useRef<string | null>(null);
  const pendingRef = useRef<T | null>(null);
  const submittedValueRef = useRef<T | null>(null);
  const remoteValueRef = useRef<T | null>(null);
  const firstLocalWriteRef = useRef(true);
  const flushRef = useRef<() => void>(() => {});

  valueRef.current = value;
  normalizeRef.current = normalize;
  onRemoteValueRef.current = onRemoteValue;

  useEffect(() => {
    const clearBrowserCopies = () => {
      try {
        localStorage.removeItem(localStorageKey);
        clearLocalKeys.forEach((key) => localStorage.removeItem(key));
      } catch {
        // Shared persistence remains authoritative when browser storage is blocked.
      }
    };

    const applyRemote = (event: MissionPlanningPersistenceState) => {
      const normalized = normalizeRef.current(event.value);
      if (!normalized) {
        publishStatus(section, "error", `Planner storage returned invalid ${section} data.`);
        return false;
      }
      remoteValueRef.current = normalized;
      if (!sameValue(valueRef.current, normalized)) {
        onRemoteValueRef.current(normalized);
      }
      return true;
    };

    flushRef.current = () => {
      if (!linkedRef.current || !hydratedRef.current || inFlightRef.current) return;
      const pending = pendingRef.current;
      if (!pending) return;
      pendingRef.current = null;
      const id = requestId(section, "update");
      const sent = liveTelemetryStore.updateMissionPlanningPersistence(
        id,
        section,
        pending,
        revisionRef.current,
      );
      if (!sent) {
        pendingRef.current = pending;
        requestSentRef.current = false;
        publishStatus(section, "local", "Planner changes will sync when the dashboard feed reconnects.");
        return;
      }
      inFlightRef.current = id;
      submittedValueRef.current = pending;
      publishStatus(section, "syncing", "Saving planner data to the shared Mission Control file.");
    };

    const startSync = () => {
      if (!linkedRef.current || requestSentRef.current || inFlightRef.current) return;
      requestSentRef.current = true;
      if (hydratedRef.current) {
        pendingRef.current = valueRef.current;
        flushRef.current();
        return;
      }
      const id = requestId(section, "merge");
      if (!liveTelemetryStore.mergeMissionPlanningPersistence(
        id,
        section,
        valueRef.current,
        revisionRef.current,
      )) {
        requestSentRef.current = false;
        publishStatus(section, "local", "Planner data will sync when the dashboard feed connects.");
        return;
      }
      inFlightRef.current = id;
      submittedValueRef.current = valueRef.current;
      publishStatus(section, "syncing", "Merging this browser's planner data into the shared file.");
    };

    const unsubscribeConnection = liveTelemetryStore.subscribe(() => {
      const linked = liveTelemetryStore.getSnapshot().status === "linked";
      if (linked === linkedRef.current) return;
      linkedRef.current = linked;
      if (!linked) {
        requestSentRef.current = false;
        inFlightRef.current = null;
        publishStatus(section, "local", "Planner changes will sync when the dashboard feed reconnects.");
        return;
      }
      startSync();
    });

    const unsubscribePersistence = liveTelemetryStore.subscribeMissionPlanningPersistence((event) => {
      if (event.section !== section) return;
      const ownResponse = event.requestId === inFlightRef.current;
      if (ownResponse) inFlightRef.current = null;

      if (event.status === "conflict") {
        revisionRef.current = event.revision;
        hydratedRef.current = true;
        pendingRef.current = null;
        applyRemote(event);
        clearBrowserCopies();
        publishStatus(
          section,
          "error",
          "Planner data changed in another browser. Its newer version was kept; repeat your edit if needed.",
        );
        return;
      }
      if (!["ok", "merged", "unchanged", "updated"].includes(event.status)) {
        publishStatus(section, "error", event.message || "Planner storage could not be updated.");
        return;
      }

      revisionRef.current = event.revision;
      hydratedRef.current = true;
      requestSentRef.current = true;
      const hasNewerLocalValue = ownResponse && pendingRef.current !== null;
      if (!hasNewerLocalValue && !applyRemote(event)) return;
      clearBrowserCopies();
      publishStatus(section, "shared", "Planner data is stored in the shared Mission Control file.");
      if (pendingRef.current !== null) queueMicrotask(() => flushRef.current());
    });

    linkedRef.current = liveTelemetryStore.getSnapshot().status === "linked";
    startSync();
    return () => {
      unsubscribeConnection();
      unsubscribePersistence();
      flushRef.current = () => {};
    };
  }, [clearLocalKeys, localStorageKey, section]);

  useEffect(() => {
    const remoteValue = remoteValueRef.current;
    if (remoteValue && sameValue(value, remoteValue)) {
      remoteValueRef.current = null;
      return;
    }
    if (linkedRef.current && hydratedRef.current) {
      pendingRef.current = value;
      flushRef.current();
      return;
    }
    if (
      linkedRef.current
      && inFlightRef.current
      && !sameValue(value, submittedValueRef.current)
    ) {
      pendingRef.current = value;
    }
    if (firstLocalWriteRef.current) {
      firstLocalWriteRef.current = false;
      if (!allowInitialLocalWrite) return;
    }
    try {
      localStorage.setItem(localStorageKey, JSON.stringify(value));
    } catch {
      publishStatus(section, "error", "Planner data could not be stored in this browser or the shared file.");
    }
  }, [allowInitialLocalWrite, localStorageKey, section, value]);
}
