import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FlightPanelHost } from "../flight/FlightPanelHost";
import { FlightWorkspaceView, type FlightWorkspacePanel } from "../flight/FlightWorkspaceView";
import {
  computeFlightRegionGeometry,
  flightFixedPanelIds,
  flightMonitorPanelIds,
  flightPanelOwner,
  flightPlanPanelIds,
  type FlightLayoutPanelId,
  type FlightWorkspaceView as FlightWorkspaceViewName,
} from "../flight/layout";
import { FlightControlPlate } from "./FlightControlPlate";
import { PanelRestoreRail, usePanelVisibility, type DashboardPanelId } from "./PanelVisibility";

interface FlightDashboardProps {
  ascension: ReactNode;
  annunciator: ReactNode;
  availablePanels: ReadonlySet<DashboardPanelId>;
  clock: ReactNode;
  consumables: ReactNode;
  electricity: ReactNode;
  heat: ReactNode;
  pinnedDeltaVPlan?: ReactNode;
  pinnedNote?: ReactNode;
  pinnedOrbitPlan?: ReactNode;
  science: ReactNode;
  staging: ReactNode;
  target?: ReactNode;
  vesselIdentity?: string;
}

type WorkspaceStyle = CSSProperties & {
  "--flight-fixed-region-width": string;
  "--flight-tabbed-region-width": string;
};

export function FlightDashboard({
  ascension,
  annunciator,
  availablePanels,
  clock,
  consumables,
  electricity,
  heat,
  pinnedDeltaVPlan,
  pinnedNote,
  pinnedOrbitPlan,
  science,
  staging,
  target,
  vesselIdentity = "unknown-vessel",
}: FlightDashboardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const { hiddenPanels, lastRestore } = usePanelVisibility();
  const [activeView, setActiveView] = useState<FlightWorkspaceViewName>("monitor");
  const [wrapperWidth, setWrapperWidth] = useState(() => (
    typeof window === "undefined" ? 0 : window.innerWidth
  ));
  const [rebalanceSequence, setRebalanceSequence] = useState<Record<FlightWorkspaceViewName, number>>({
    monitor: 0,
    plan: 0,
  });
  const panelCandidates = useMemo(() => {
    const candidates = new Map<FlightLayoutPanelId, ReactNode>([
      ["asc", ascension],
      ["cons", consumables],
      ["stage", staging],
      ["elec", electricity],
      ["heat", heat],
      ["sci", science],
    ]);
    if (target) candidates.set("target", target);
    if (pinnedDeltaVPlan) candidates.set("flightDeltaVPlan", pinnedDeltaVPlan);
    if (pinnedOrbitPlan) candidates.set("flightOrbitPlan", pinnedOrbitPlan);
    if (pinnedNote) candidates.set("flightNote", pinnedNote);
    return candidates;
  }, [ascension, consumables, electricity, heat, pinnedDeltaVPlan, pinnedNote, pinnedOrbitPlan, science, staging, target]);
  const visibleFixedIds = flightFixedPanelIds.filter((id) => panelCandidates.has(id) && !hiddenPanels.has(id));
  const geometry = computeFlightRegionGeometry(wrapperWidth, visibleFixedIds.length > 0);
  const panelFor = (id: FlightLayoutPanelId): FlightWorkspacePanel | undefined => {
    const content = panelCandidates.get(id);
    return content ? { content, id } : undefined;
  };
  const monitorPanels = flightMonitorPanelIds.map(panelFor).filter((panel): panel is FlightWorkspacePanel => !!panel);
  const planPanels = flightPlanPanelIds.map(panelFor).filter((panel): panel is FlightWorkspacePanel => !!panel);
  const style: WorkspaceStyle = {
    "--flight-fixed-region-width": `${geometry.fixedRegionWidth}px`,
    "--flight-tabbed-region-width": `${geometry.tabbedRegionWidth}px`,
  };

  useLayoutEffect(() => {
    if (!boardRef.current) return undefined;
    const board = boardRef.current;
    const measure = () => {
      const width = board.getBoundingClientRect().width;
      if (width > 0) setWrapperWidth((current) => current === width ? current : width);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!lastRestore) return;
    const owner = flightPanelOwner(lastRestore.id);
    if (owner === "monitor" || owner === "plan") setActiveView(owner);
  }, [lastRestore]);

  const renderFixedPanel = (id: typeof flightFixedPanelIds[number]) => {
    const content = panelCandidates.get(id);
    if (!content) return null;
    return (
      <FlightPanelHost active id={id} key={id} layout="flow" visible={!hiddenPanels.has(id)}>
        <div className={`flight-panel-slot flight-panel-slot-${id}`} data-flight-panel={id}>
          {content}
        </div>
      </FlightPanelHost>
    );
  };

  return (
    <>
      <PanelRestoreRail available={availablePanels} />
      <div
        className="flight-workspace-shell"
        data-arrangement={geometry.arrangement}
        data-fixed-empty={visibleFixedIds.length === 0}
        ref={boardRef}
        style={style}
      >
        <div className="status-strip">{clock}</div>
        <FlightControlPlate
          activeView={activeView}
          annunciator={annunciator}
          onRebalance={() => setRebalanceSequence((current) => ({
              ...current,
              [activeView]: current[activeView] + 1,
            }))}
          onSelectView={setActiveView}
        />
        <section
          aria-label="Persistent vessel state"
          className="flight-fixed-region"
          data-bottom-layout={geometry.fixedContentWidth >= 800 ? "two-up" : "stacked"}
          data-flight-region="fixed"
          hidden={visibleFixedIds.length === 0}
        >
          {renderFixedPanel("asc")}
          <div className="flight-fixed-bottom-row">
            {renderFixedPanel("cons")}
            {renderFixedPanel("stage")}
          </div>
        </section>
        <section aria-label="Flight workspaces" className="flight-tabbed-region" data-flight-region="tabbed">
          <FlightWorkspaceView
            active={activeView === "monitor"}
            arrangement={geometry.arrangement}
            hiddenPanels={hiddenPanels}
            laneCount={geometry.laneCount}
            laneWidth={geometry.laneWidth}
            panels={monitorPanels}
            rebalanceSequence={rebalanceSequence.monitor}
            vesselIdentity={vesselIdentity}
            view="monitor"
          />
          <FlightWorkspaceView
            active={activeView === "plan"}
            arrangement={geometry.arrangement}
            hiddenPanels={hiddenPanels}
            laneCount={geometry.laneCount}
            laneWidth={geometry.laneWidth}
            panels={planPanels}
            rebalanceSequence={rebalanceSequence.plan}
            vesselIdentity={vesselIdentity}
            view="plan"
          />
        </section>
      </div>
    </>
  );
}
