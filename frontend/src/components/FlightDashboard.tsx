import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { balanceContiguousPanelLanes } from "../flight/layout";
import { HideablePanelSlot, PanelRestoreRail, usePanelVisibility, type DashboardPanelId } from "./PanelVisibility";

export type FlightPanelRegion = "primary" | "health" | "operations" | "reference";

const flightPanelRegions: Record<FlightPanelRegion, readonly DashboardPanelId[]> = {
  primary: ["asc"],
  operations: ["stage", "target"],
  health: ["cons", "heat", "elec", "sci"],
  reference: ["flightNote", "flightOrbitPlan", "flightDeltaVPlan"],
};

const wideFlightLayoutQuery = "(min-width: 1800px)";
const flightFlowOrder: readonly DashboardPanelId[] = [
  "elec",
  "heat",
  "sci",
  "stage",
  "target",
  "flightOrbitPlan",
  "flightNote",
  "flightDeltaVPlan",
];

export function flightPanelRegion(id: DashboardPanelId): FlightPanelRegion | undefined {
  return (Object.entries(flightPanelRegions) as Array<[FlightPanelRegion, readonly DashboardPanelId[]]>)
    .find(([, ids]) => ids.includes(id))?.[0];
}

export function cascadeFlightPanels(
  ids: readonly DashboardPanelId[],
  heights: Readonly<Partial<Record<DashboardPanelId, number>>>,
  laneCount = 3,
  fillHeight?: number,
): DashboardPanelId[][] {
  return balanceContiguousPanelLanes(ids, heights, laneCount, fillHeight);
}

function sameLanes(left: readonly (readonly DashboardPanelId[])[], right: readonly (readonly DashboardPanelId[])[]) {
  return left.length === right.length
    && left.every((lane, index) => lane.join("|") === right[index]?.join("|"));
}

interface FlightDashboardProps {
  ascension: ReactNode;
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
}

export function FlightDashboard({
  ascension,
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
}: FlightDashboardProps) {
  const { hiddenPanels } = usePanelVisibility();
  const panelCandidates = new Map<DashboardPanelId, ReactNode>([
    ["asc", ascension],
    ["cons", consumables],
    ["heat", heat],
    ["elec", electricity],
    ["sci", science],
    ["stage", staging],
  ]);
  if (target) panelCandidates.set("target", target);
  if (pinnedNote) panelCandidates.set("flightNote", pinnedNote);
  if (pinnedOrbitPlan) panelCandidates.set("flightOrbitPlan", pinnedOrbitPlan);
  if (pinnedDeltaVPlan) panelCandidates.set("flightDeltaVPlan", pinnedDeltaVPlan);

  const visibleFlowIds = flightFlowOrder.filter((id) => panelCandidates.has(id) && !hiddenPanels.has(id));
  const flowSignature = visibleFlowIds.join("|");
  const [wideLayout, setWideLayout] = useState(() => (
    typeof window !== "undefined" && window.matchMedia?.(wideFlightLayoutQuery).matches
  ));
  const [balancedLayout, setBalancedLayout] = useState<{
    signature: string;
    lanes: DashboardPanelId[][];
  }>(() => ({ signature: "", lanes: cascadeFlightPanels(visibleFlowIds, {}) }));
  const balancedGridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = window.matchMedia?.(wideFlightLayoutQuery);
    if (!query) return undefined;
    const update = () => setWideLayout(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const visibleLanes = balancedLayout.signature === flowSignature
    ? balancedLayout.lanes
    : cascadeFlightPanels(visibleFlowIds, {});

  useLayoutEffect(() => {
    if (!wideLayout || !balancedGridRef.current) return;
    const grid = balancedGridRef.current;
    const measure = () => {
      const measuredHeights: Partial<Record<DashboardPanelId, number>> = {};
      grid.querySelectorAll<HTMLElement>("[data-flight-panel]").forEach((slot) => {
        const id = slot.dataset.flightPanel as DashboardPanelId | undefined;
        if (id && id !== "asc") measuredHeights[id] = slot.getBoundingClientRect().height;
      });
      const primaryHeight = grid
        .querySelector<HTMLElement>('[data-flight-region="primary"]')
        ?.getBoundingClientRect().height;
      const lanes = cascadeFlightPanels(visibleFlowIds, measuredHeights, 3, primaryHeight);
      setBalancedLayout((current) => (
        current.signature === flowSignature && sameLanes(current.lanes, lanes)
          ? current
          : { signature: flowSignature, lanes }
      ));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    grid.querySelectorAll<HTMLElement>("[data-flight-panel]").forEach((slot) => observer.observe(slot));
    return () => observer.disconnect();
  }, [flowSignature, wideLayout]);

  const renderPanel = (id: DashboardPanelId) => {
    const content = panelCandidates.get(id);
    if (!content || hiddenPanels.has(id)) return null;
    return (
      <div
        className={`flight-panel-slot flight-panel-slot-${id}`}
        data-flight-panel={id}
        key={id}
      >
        <HideablePanelSlot id={id}>{content}</HideablePanelSlot>
      </div>
    );
  };

  const renderRegion = (region: FlightPanelRegion) => {
    const panels = flightPanelRegions[region].map(renderPanel).filter(Boolean);
    if (panels.length === 0) return null;
    if (region === "health") {
      return (
        <div
          className="flight-region flight-region-health"
          data-flight-region="health"
          key={region}
        >
          <div className="flight-health-lane flight-health-lane-resources">
            {(["cons", "heat"] as const).map(renderPanel)}
          </div>
          <div className="flight-health-lane flight-health-lane-systems">
            {(["elec", "sci"] as const).map(renderPanel)}
          </div>
        </div>
      );
    }
    return (
      <div
        className={`flight-region flight-region-${region}`}
        data-flight-region={region}
        key={region}
      >
        {panels}
      </div>
    );
  };

  const flightPanels = wideLayout ? (
    <div className="flight-grid flight-grid-balanced" ref={balancedGridRef}>
      <div className="flight-region flight-region-primary" data-flight-region="primary">
        {renderPanel("asc")}
        {renderPanel("cons")}
      </div>
      {visibleLanes.map((lane, index) => (
        <div className="flight-flow-lane" data-flight-lane={index} key={index}>
          {lane.map(renderPanel)}
        </div>
      ))}
    </div>
  ) : (
    <div className="flight-grid">
      {(["primary", "operations", "health", "reference"] as const).map(renderRegion)}
    </div>
  );

  return (
    <>
      <PanelRestoreRail available={availablePanels} />
      <div className="status-strip">{clock}</div>
      {flightPanels}
    </>
  );
}
