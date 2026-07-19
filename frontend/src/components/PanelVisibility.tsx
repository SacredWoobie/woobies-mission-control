import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
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
  overviewFleet: "Active vessels",
  overviewRoster: "Astronaut roster",
  overviewAlarms: "Upcoming alarms",
  flightNote: "Pinned note",
} as const;

export type DashboardPanelId = keyof typeof panelLabels;

const storageKey = "wmc-hidden-panels-v1";
const panelOrder: DashboardPanelId[] = [
  "clock",
  "asc",
  "cons",
  "heat",
  "elec",
  "sci",
  "stage",
  "target",
  "overviewFleet",
  "overviewRoster",
  "overviewAlarms",
  "flightNote",
];

interface PanelVisibilityValue {
  hiddenPanels: ReadonlySet<DashboardPanelId>;
  autoCollapsePanel(id: DashboardPanelId): void;
  clearAutoCollapse(id: DashboardPanelId): void;
  hidePanel(id: DashboardPanelId): void;
  restorePanel(id: DashboardPanelId): void;
}

const fallbackVisibility: PanelVisibilityValue = {
  hiddenPanels: new Set<DashboardPanelId>(),
  autoCollapsePanel() {},
  clearAutoCollapse() {},
  hidePanel() {},
  restorePanel() {},
};
const PanelVisibilityContext = createContext<PanelVisibilityValue>(fallbackVisibility);

function initialHiddenPanels() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return new Set<DashboardPanelId>(
      Array.isArray(saved)
        ? saved.filter((id): id is DashboardPanelId => id in panelLabels)
        : [],
    );
  } catch {
    return new Set<DashboardPanelId>();
  }
}

export function PanelVisibilityProvider({ children }: PropsWithChildren) {
  const [preferenceHiddenPanels, setPreferenceHiddenPanels] = useState(initialHiddenPanels);
  const [autoHiddenPanels, setAutoHiddenPanels] = useState(() => new Set<DashboardPanelId>());

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
  }, [persist]);

  const value = useMemo<PanelVisibilityValue>(() => ({
    hiddenPanels,
    autoCollapsePanel,
    clearAutoCollapse,
    hidePanel,
    restorePanel,
  }), [autoCollapsePanel, clearAutoCollapse, hiddenPanels, hidePanel, restorePanel]);

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
  const { hiddenPanels, restorePanel } = usePanelVisibility();
  const datalinkHidden = hiddenPanels.has("conn") && available.has("conn");
  const visibleTabs = panelOrder.filter((id) => id !== "conn" && hiddenPanels.has(id) && available.has(id));
  if (!datalinkHidden && visibleTabs.length === 0) return null;

  return (
    <>
      {datalinkHidden && (
        <button aria-label={panelLabels.conn} className="datalink-rail-tab panel-rail-button" onClick={() => restorePanel("conn")} title={`Restore ${panelLabels.conn}`} type="button">
          <PanelRailIcon name="conn" />
        </button>
      )}
      {visibleTabs.length > 0 && (
        <nav aria-label="Hidden dashboard panels" className="panel-restore-rail">
          {visibleTabs.map((id) => (
            <button aria-label={panelLabels[id]} className={`panel-rail-button panel-rail-button-${id}`} key={id} onClick={() => restorePanel(id)} title={`Restore ${panelLabels[id]}`} type="button">
              <PanelRailIcon name={id} />
            </button>
          ))}
        </nav>
      )}
    </>
  );
}
