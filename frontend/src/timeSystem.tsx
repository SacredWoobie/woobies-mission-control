import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";

export type TimeSystem = "kerbin" | "earth";

interface TimeSystemState {
  system: TimeSystem;
  setSystem(system: TimeSystem): void;
  toggleSystem(): void;
}

const STORAGE_KEY = "wmc-time-system-v1";
const defaultState: TimeSystemState = {
  system: "kerbin",
  setSystem: () => undefined,
  toggleSystem: () => undefined,
};

function initialSystem(): TimeSystem {
  if (typeof localStorage === "undefined") return "kerbin";
  try {
    return localStorage.getItem(STORAGE_KEY) === "earth" ? "earth" : "kerbin";
  } catch {
    return "kerbin";
  }
}

export function TimeSystemProvider({ children }: PropsWithChildren) {
  const [system, setSystem] = useState<TimeSystem>(initialSystem);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, system);
    } catch {
      // Storage is optional; the shared in-memory preference still works.
    }
  }, [system]);
  const value = useMemo<TimeSystemState>(() => ({
    system,
    setSystem,
    toggleSystem: () => setSystem((current) => current === "kerbin" ? "earth" : "kerbin"),
  }), [system]);
  return <TimeSystemContext.Provider value={value}>{children}</TimeSystemContext.Provider>;
}

const TimeSystemContext = createContext<TimeSystemState>(defaultState);

export function useTimeSystem() {
  return useContext(TimeSystemContext);
}

export function isKerbinTime(system: TimeSystem) {
  return system === "kerbin";
}
