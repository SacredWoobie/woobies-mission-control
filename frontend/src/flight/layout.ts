import type { DashboardPanelId } from "../components/PanelVisibility";

export const FLIGHT_LAYOUT_GAP = 12;
export const FLIGHT_REGION_PADDING = 8;
export const FLIGHT_MIN_LANE_WIDTH = 440;
export const FLIGHT_FIXED_REGION_FLOOR = 816;
export const FLIGHT_FIXED_REGION_MAX = 1150;
export const FLIGHT_FIXED_FRACTION = 0.47;
export const FLIGHT_SIDE_BY_SIDE_MIN = 1736;

export type FlightWorkspaceView = "monitor" | "plan";
export type FlightLayoutArrangement = "side-by-side" | "stacked";

export const flightFixedPanelIds = ["asc", "cons", "stage"] as const satisfies readonly DashboardPanelId[];
export const flightMonitorPanelIds = ["elec", "heat", "sci", "target"] as const satisfies readonly DashboardPanelId[];
export const flightPlanPanelIds = ["flightDeltaVPlan", "flightOrbitPlan", "flightNote"] as const satisfies readonly DashboardPanelId[];

export type FlightFixedPanelId = typeof flightFixedPanelIds[number];
export type FlightMonitorPanelId = typeof flightMonitorPanelIds[number];
export type FlightPlanPanelId = typeof flightPlanPanelIds[number];
export type FlightLayoutPanelId = FlightFixedPanelId | FlightMonitorPanelId | FlightPlanPanelId;
export type FlightPanelOwner = "fixed" | FlightWorkspaceView;

export interface FlightPanelDefinition {
  id: FlightLayoutPanelId;
  owner: FlightPanelOwner;
  priority: number;
}

export const flightPanelRegistry: readonly FlightPanelDefinition[] = [
  ...flightFixedPanelIds.map((id, priority) => ({ id, owner: "fixed" as const, priority })),
  ...flightMonitorPanelIds.map((id, priority) => ({ id, owner: "monitor" as const, priority })),
  ...flightPlanPanelIds.map((id, priority) => ({ id, owner: "plan" as const, priority })),
];

const panelDefinitions = new Map(flightPanelRegistry.map((definition) => [definition.id, definition]));

export function flightPanelOwner(id: DashboardPanelId): FlightPanelOwner | undefined {
  return panelDefinitions.get(id as FlightLayoutPanelId)?.owner;
}

export interface FlightRegionGeometry {
  arrangement: FlightLayoutArrangement;
  fixedContentWidth: number;
  fixedRegionWidth: number;
  laneCount: number;
  laneWidth: number;
  tabbedContentWidth: number;
  tabbedRegionWidth: number;
}

function clamp(minimum: number, value: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function flightLaneCount(contentWidth: number) {
  return clamp(1, Math.floor((Math.max(0, contentWidth) + FLIGHT_LAYOUT_GAP) / (FLIGHT_MIN_LANE_WIDTH + FLIGHT_LAYOUT_GAP)), 3);
}

export function computeFlightRegionGeometry(
  wrapperWidth: number,
  hasVisibleFixedPanels = true,
): FlightRegionGeometry {
  const width = Math.max(0, wrapperWidth);
  const arrangement: FlightLayoutArrangement = width >= FLIGHT_SIDE_BY_SIDE_MIN
    ? "side-by-side"
    : "stacked";
  const fixedRegionWidth = !hasVisibleFixedPanels
    ? 0
    : arrangement === "side-by-side"
      ? clamp(FLIGHT_FIXED_REGION_FLOOR, Math.round(width * FLIGHT_FIXED_FRACTION), FLIGHT_FIXED_REGION_MAX)
      : width;
  const tabbedRegionWidth = arrangement === "side-by-side" && hasVisibleFixedPanels
    ? Math.max(0, width - fixedRegionWidth - FLIGHT_LAYOUT_GAP)
    : width;
  const fixedContentWidth = Math.max(0, fixedRegionWidth - 2 * FLIGHT_REGION_PADDING);
  const tabbedContentWidth = Math.max(0, tabbedRegionWidth - 2 * FLIGHT_REGION_PADDING);
  const laneCount = flightLaneCount(tabbedContentWidth);
  const laneWidth = Math.max(
    0,
    (tabbedContentWidth - (laneCount - 1) * FLIGHT_LAYOUT_GAP) / laneCount,
  );

  return {
    arrangement,
    fixedContentWidth,
    fixedRegionWidth,
    laneCount,
    laneWidth,
    tabbedContentWidth,
    tabbedRegionWidth,
  };
}

export interface FlightPanelPlacement {
  index: number;
  lane: number;
}

export interface FlightPanelPosition extends FlightPanelPlacement {
  x: number;
  y: number;
}

export interface FlatFlightPanelLayout<T extends string> {
  height: number;
  positions: Partial<Record<T, FlightPanelPosition>>;
}

export function balanceContiguousPanelLanes<T extends string>(
  ids: readonly T[],
  heights: Readonly<Partial<Record<T, number>>>,
  laneCount = 3,
  fillHeight?: number,
): T[][] {
  if (laneCount <= 0) return [];
  const lanes = Array.from({ length: laneCount }, () => [] as T[]);
  if (ids.length === 0) return lanes;

  const panelHeights = ids.map((id) => Math.max(1, heights[id] ?? 1));
  if (Number.isFinite(fillHeight) && (fillHeight ?? 0) > 0) {
    let laneIndex = 0;
    let laneHeight = 0;
    ids.forEach((id, index) => {
      const heightWithGap = panelHeights[index] + (lanes[laneIndex].length > 0 ? FLIGHT_LAYOUT_GAP : 0);
      if (
        lanes[laneIndex].length > 0
        && laneIndex < laneCount - 1
        && laneHeight + heightWithGap > fillHeight!
      ) {
        laneIndex += 1;
        laneHeight = 0;
      }
      lanes[laneIndex].push(id);
      laneHeight += panelHeights[index] + (lanes[laneIndex].length > 1 ? FLIGHT_LAYOUT_GAP : 0);
    });
    return lanes;
  }

  const prefixHeights = [0];
  panelHeights.forEach((height) => prefixHeights.push(prefixHeights[prefixHeights.length - 1] + height));
  const segmentHeight = (start: number, end: number) => (
    prefixHeights[end] - prefixHeights[start] + Math.max(0, end - start - 1) * FLIGHT_LAYOUT_GAP
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

export function lanesToPlacementMap<T extends string>(lanes: readonly (readonly T[])[]) {
  const placements: Partial<Record<T, FlightPanelPlacement>> = {};
  lanes.forEach((ids, lane) => ids.forEach((id, index) => {
    placements[id] = { index, lane };
  }));
  return placements;
}

export function computeFlatFlightPanelLayout<T extends string>(
  ids: readonly T[],
  placements: Readonly<Partial<Record<T, FlightPanelPlacement>>>,
  heights: Readonly<Partial<Record<T, number>>>,
  laneCount: number,
  laneWidth: number,
): FlatFlightPanelLayout<T> {
  const lanes = Array.from({ length: Math.max(1, laneCount) }, () => [] as T[]);
  ids.forEach((id) => {
    const placement = placements[id];
    if (placement && placement.lane >= 0 && placement.lane < lanes.length) lanes[placement.lane].push(id);
  });
  lanes.forEach((lane) => lane.sort((left, right) => placements[left]!.index - placements[right]!.index));

  const positions: Partial<Record<T, FlightPanelPosition>> = {};
  let height = 0;
  lanes.forEach((idsInLane, lane) => {
    let y = 0;
    idsInLane.forEach((id, index) => {
      positions[id] = { ...placements[id]!, lane, x: lane * (laneWidth + FLIGHT_LAYOUT_GAP), y };
      y += Math.max(0, heights[id] ?? 0) + (index < idsInLane.length - 1 ? FLIGHT_LAYOUT_GAP : 0);
    });
    height = Math.max(height, y);
  });
  return { height, positions };
}
