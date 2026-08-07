import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
  type PropsWithChildren,
} from "react";
import { PanelRailIcon } from "./PanelRailIcon";

export const panelLabels = {
  conn: "Datalink",
  clock: "Time & comms",
  asc: "Ascension",
  cons: "Consumables",
  heat: "Heat",
  elec: "Electricity",
  sci: "Science",
  stage: "Staging",
  target: "Target",
  overviewTransfers: "Transfer windows",
  overviewFleet: "Active vessels",
  overviewRoster: "Astronaut roster",
  overviewAlarms: "Upcoming alarms",
  flightNote: "Pinned note",
  flightOrbitPlan: "Resonant orbit plan",
  flightDeltaVPlan: "Mission Plan",
  editorDeltaVPlan: "Mission Plan",
} as const;

const panelRailDescriptions: Record<keyof typeof panelLabels, string> = {
  conn: "Datalink",
  clock: "Time & Communications",
  asc: "Ascension",
  cons: "Consumables",
  heat: "Heat Management",
  elec: "Electricity",
  sci: "Science",
  stage: "Staging Analysis",
  target: "Target",
  overviewTransfers: "Transfer Windows",
  overviewFleet: "Active Vessels",
  overviewRoster: "Astronaut Roster",
  overviewAlarms: "Upcoming Alarms",
  flightNote: "Pinned Note",
  flightOrbitPlan: "Resonant Orbit Plan",
  flightDeltaVPlan: "Mission Plan",
  editorDeltaVPlan: "Mission Plan",
};

export type DashboardPanelId = keyof typeof panelLabels;

const storageKey = "wmc-hidden-panels-v1";
const flightInPlacePanelIds = new Set<DashboardPanelId>([
  "asc", "cons", "heat", "elec", "sci", "stage", "target",
  "flightNote", "flightOrbitPlan", "flightDeltaVPlan",
]);
const panelOrder: DashboardPanelId[] = [
  "conn",
  "clock",
  "asc",
  "cons",
  "heat",
  "elec",
  "sci",
  "stage",
  "target",
  "overviewTransfers",
  "overviewFleet",
  "overviewRoster",
  "overviewAlarms",
  "flightNote",
  "flightOrbitPlan",
  "flightDeltaVPlan",
  "editorDeltaVPlan",
];

interface PanelVisibilityValue {
  availablePanels: ReadonlySet<DashboardPanelId>;
  centralizedRail: boolean;
  hiddenPanels: ReadonlySet<DashboardPanelId>;
  lastRestore: { id: DashboardPanelId; sequence: number } | null;
  autoCollapsePanel(id: DashboardPanelId): void;
  clearAutoCollapse(id: DashboardPanelId): void;
  hidePanel(id: DashboardPanelId): void;
  registerAvailablePanels(sourceId: string, panels: ReadonlySet<DashboardPanelId>): () => void;
  restorePanel(id: DashboardPanelId): void;
}

const fallbackVisibility: PanelVisibilityValue = {
  availablePanels: new Set<DashboardPanelId>(),
  centralizedRail: false,
  hiddenPanels: new Set<DashboardPanelId>(),
  lastRestore: null,
  autoCollapsePanel() {},
  clearAutoCollapse() {},
  hidePanel() {},
  registerAvailablePanels() { return () => {}; },
  restorePanel() {},
};
const PanelVisibilityContext = createContext<PanelVisibilityValue>(fallbackVisibility);

function initialHiddenPanels() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    const valid = Array.isArray(saved)
      ? saved.filter((id): id is DashboardPanelId => id in panelLabels)
      : [];
    const migrated = valid.filter((id) => !flightInPlacePanelIds.has(id));
    if (migrated.length !== valid.length) localStorage.setItem(storageKey, JSON.stringify(migrated));
    return new Set<DashboardPanelId>(migrated);
  } catch {
    return new Set<DashboardPanelId>();
  }
}

export function PanelVisibilityProvider({
  centralizedRail = false,
  children,
}: PropsWithChildren<{ centralizedRail?: boolean }>) {
  const [preferenceHiddenPanels, setPreferenceHiddenPanels] = useState(initialHiddenPanels);
  const [autoHiddenPanels, setAutoHiddenPanels] = useState(() => new Set<DashboardPanelId>());
  const [availablePanelSources, setAvailablePanelSources] = useState(
    () => new Map<string, ReadonlySet<DashboardPanelId>>(),
  );
  const [lastRestore, setLastRestore] = useState<PanelVisibilityValue["lastRestore"]>(null);

  const persist = useCallback((next: Set<DashboardPanelId>) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      // Persistence is a convenience; private browsing can legitimately deny it.
    }
  }, []);

  const hiddenPanels = useMemo(() => new Set([
    ...preferenceHiddenPanels,
    ...autoHiddenPanels,
  ]), [autoHiddenPanels, preferenceHiddenPanels]);
  const availablePanels = useMemo(() => {
    const combined = new Set<DashboardPanelId>();
    availablePanelSources.forEach((panels) => panels.forEach((id) => combined.add(id)));
    return combined;
  }, [availablePanelSources]);

  const registerAvailablePanels = useCallback((
    sourceId: string,
    panels: ReadonlySet<DashboardPanelId>,
  ) => {
    setAvailablePanelSources((current) => {
      if (current.get(sourceId) === panels) return current;
      const next = new Map(current);
      next.set(sourceId, panels);
      return next;
    });
    return () => {
      setAvailablePanelSources((current) => {
        if (!current.has(sourceId)) return current;
        const next = new Map(current);
        next.delete(sourceId);
        return next;
      });
    };
  }, []);

  const autoCollapsePanel = useCallback((id: DashboardPanelId) => {
    setAutoHiddenPanels((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);

  const clearAutoCollapse = useCallback((id: DashboardPanelId) => {
    setAutoHiddenPanels((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const hidePanel = useCallback((id: DashboardPanelId) => {
    setPreferenceHiddenPanels((current) => {
      if (flightInPlacePanelIds.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      persist(next);
      return next;
    });
  }, [persist]);

  const restorePanel = useCallback((id: DashboardPanelId) => {
    setPreferenceHiddenPanels((current) => {
      const next = new Set(current);
      next.delete(id);
      persist(next);
      return next;
    });
    setAutoHiddenPanels((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setLastRestore((current) => ({ id, sequence: (current?.sequence ?? 0) + 1 }));
  }, [persist]);

  const value = useMemo<PanelVisibilityValue>(() => ({
    availablePanels,
    centralizedRail,
    hiddenPanels,
    lastRestore,
    autoCollapsePanel,
    clearAutoCollapse,
    hidePanel,
    registerAvailablePanels,
    restorePanel,
  }), [
    autoCollapsePanel,
    availablePanels,
    centralizedRail,
    clearAutoCollapse,
    hiddenPanels,
    hidePanel,
    lastRestore,
    registerAvailablePanels,
    restorePanel,
  ]);

  return (
    <PanelVisibilityContext.Provider value={value}>
      {children}
    </PanelVisibilityContext.Provider>
  );
}

export function usePanelVisibility() {
  return useContext(PanelVisibilityContext);
}

export function HideablePanelSlot({
  children,
  id,
}: PropsWithChildren<{ id: DashboardPanelId }>) {
  const { hiddenPanels } = usePanelVisibility();
  return hiddenPanels.has(id) ? null : children;
}

export function PanelRestoreRail({ available }: { available: ReadonlySet<DashboardPanelId> }) {
  const sourceId = useId();
  const {
    centralizedRail,
    hiddenPanels,
    registerAvailablePanels,
    restorePanel,
  } = usePanelVisibility();
  useEffect(() => {
    if (!centralizedRail) return;
    return registerAvailablePanels(sourceId, available);
  }, [available, centralizedRail, registerAvailablePanels, sourceId]);
  if (centralizedRail) return null;

  const datalinkHidden = hiddenPanels.has("conn") && available.has("conn");
  const visibleTabs = panelOrder.filter((id) => id !== "conn" && !flightInPlacePanelIds.has(id) && hiddenPanels.has(id) && available.has(id));
  if (!datalinkHidden && visibleTabs.length === 0) return null;

  return (
    <>
      {datalinkHidden && (
        <button aria-label={panelLabels.conn} className="datalink-rail-tab panel-rail-button" onClick={() => restorePanel("conn")} title={`Restore ${panelLabels.conn}`} type="button">
          <span aria-hidden="true" className="panel-rail-label">{panelRailDescriptions.conn}</span>
          <PanelRailIcon name="conn" />
        </button>
      )}
      {visibleTabs.length > 0 && (
        <nav aria-label="Hidden dashboard panels" className="panel-restore-rail">
          {visibleTabs.map((id) => (
            <button aria-label={panelLabels[id]} className={`panel-rail-button panel-rail-button-${id}`} key={id} onClick={() => restorePanel(id)} title={`Restore ${panelLabels[id]}`} type="button">
              <span aria-hidden="true" className="panel-rail-label">{panelRailDescriptions[id]}</span>
              <PanelRailIcon name={id} />
            </button>
          ))}
        </nav>
      )}
    </>
  );
}

export function DashboardRail({
  notesButton,
  tools,
}: {
  notesButton: ReactNode;
  tools: ReactNode;
}) {
  const { availablePanels, hiddenPanels, restorePanel } = usePanelVisibility();
  const visibleTabs = panelOrder.filter((id) => !flightInPlacePanelIds.has(id) && hiddenPanels.has(id) && availablePanels.has(id));

  return (
    <nav aria-label="Dashboard controls" className="dashboard-rail">
      <div aria-label="Tools" className="dashboard-rail-tools" role="group">
        <div aria-hidden="true" className="dashboard-rail-section-label"><span>Tools</span></div>
        {visibleTabs.map((id) => (
          <button
            aria-label={panelLabels[id]}
            className={`panel-rail-button panel-rail-button-${id}${id === "conn" ? " datalink-rail-tab" : ""}`}
            key={id}
            onClick={() => restorePanel(id)}
            title={`Restore ${panelLabels[id]}`}
            type="button"
          >
            <span aria-hidden="true" className="panel-rail-label">{panelRailDescriptions[id]}</span>
            <PanelRailIcon name={id} />
          </button>
        ))}
        {notesButton}
        {tools}
      </div>
    </nav>
  );
}
