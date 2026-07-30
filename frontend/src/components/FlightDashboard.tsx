import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  if (laneCount <= 0) return [];
  const lanes = Array.from({ length: laneCount }, () => [] as DashboardPanelId[]);
  if (ids.length === 0) return lanes;

  const panelHeights = ids.map((id) => Math.max(1, heights[id] ?? 1));
  if (Number.isFinite(fillHeight) && (fillHeight ?? 0) > 0) {
    let laneIndex = 0;
    let laneHeight = 0;
    ids.forEach((id, index) => {
      const heightWithGap = panelHeights[index] + (lanes[laneIndex].length > 0 ? 12 : 0);
      if (
        lanes[laneIndex].length > 0
        && laneIndex < laneCount - 1
        && laneHeight + heightWithGap > fillHeight!
      ) {
        laneIndex += 1;
        laneHeight = 0;
      }
      lanes[laneIndex].push(id);
      laneHeight += panelHeights[index] + (lanes[laneIndex].length > 1 ? 12 : 0);
    });
    return lanes;
  }

  const prefixHeights = [0];
  panelHeights.forEach((height) => prefixHeights.push(prefixHeights[prefixHeights.length - 1] + height));
  const segmentHeight = (start: number, end: number) => (
    prefixHeights[end] - prefixHeights[start] + Math.max(0, end - start - 1) * 12
  );
  const usedLaneCount = Math.min(laneCount, ids.length);
  const bestMaximum = Array.from(
    { length: usedLaneCount + 1 },
    () => Array.from({ length: ids.length + 1 }, () => Number.POSITIVE_INFINITY),
  );
  const bestSquaredTotal = Array.from(
    { length: usedLaneCount + 1 },
    () => Array.from({ length: ids.length + 1 }, () => Number.POSITIVE_INFINITY),
  );
  const previousCut = Array.from(
    { length: usedLaneCount + 1 },
    () => Array.from({ length: ids.length + 1 }, () => -1),
  );
  bestMaximum[0][0] = 0;
  bestSquaredTotal[0][0] = 0;

  for (let usedLanes = 1; usedLanes <= usedLaneCount; usedLanes += 1) {
    for (let end = usedLanes; end <= ids.length; end += 1) {
      for (let start = usedLanes - 1; start < end; start += 1) {
        if (!Number.isFinite(bestMaximum[usedLanes - 1][start])) continue;
        const height = segmentHeight(start, end);
        const candidateMaximum = Math.max(bestMaximum[usedLanes - 1][start], height);
        const candidateSquaredTotal = bestSquaredTotal[usedLanes - 1][start] + height ** 2;
        if (
          candidateMaximum < bestMaximum[usedLanes][end]
          || (
            candidateMaximum === bestMaximum[usedLanes][end]
            && candidateSquaredTotal < bestSquaredTotal[usedLanes][end]
          )
        ) {
          bestMaximum[usedLanes][end] = candidateMaximum;
          bestSquaredTotal[usedLanes][end] = candidateSquaredTotal;
          previousCut[usedLanes][end] = start;
        }
      }
    }
  }

  let end = ids.length;
  for (let lane = usedLaneCount - 1; lane >= 0; lane -= 1) {
    const start = previousCut[lane + 1][end];
    lanes[lane] = ids.slice(start, end);
    end = start;
  }
  return lanes;
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
