import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlightPanelHost } from "./FlightPanelHost";
import {
  balanceContiguousPanelLanes,
  computeFlatFlightPanelLayout,
  lanesToPlacementMap,
  type FlightLayoutArrangement,
  type FlightLayoutPanelId,
  type FlightPanelPlacement,
  type FlightWorkspaceView as FlightWorkspaceViewName,
} from "./layout";

export interface FlightWorkspacePanel {
  content: ReactNode;
  id: FlightLayoutPanelId;
}

interface AssignmentCache {
  requestKey: string;
  placements: Partial<Record<FlightLayoutPanelId, FlightPanelPlacement>>;
}

interface FlightWorkspaceViewProps {
  active: boolean;
  arrangement: FlightLayoutArrangement;
  hiddenPanels: ReadonlySet<string>;
  laneCount: number;
  laneWidth: number;
  panels: readonly FlightWorkspacePanel[];
  rebalanceSequence: number;
  vesselIdentity: string;
  view: FlightWorkspaceViewName;
}

function sameHeights(
  left: Readonly<Partial<Record<FlightLayoutPanelId, number>>>,
  right: Readonly<Partial<Record<FlightLayoutPanelId, number>>>,
) {
  const leftIds = Object.keys(left) as FlightLayoutPanelId[];
  const rightIds = Object.keys(right) as FlightLayoutPanelId[];
  return leftIds.length === rightIds.length && leftIds.every((id) => left[id] === right[id]);
}

export function FlightWorkspaceView({
  active,
  arrangement,
  hiddenPanels,
  laneCount,
  laneWidth,
  panels,
  rebalanceSequence,
  vesselIdentity,
  view,
}: FlightWorkspaceViewProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const [heights, setHeights] = useState<Partial<Record<FlightLayoutPanelId, number>>>({});
  const [assignment, setAssignment] = useState<AssignmentCache>({ requestKey: "", placements: {} });
  const panelIds = useMemo(() => panels.map(({ id }) => id), [panels]);
  const visibleIds = panelIds.filter((id) => !hiddenPanels.has(id));
  const availabilitySignature = panelIds.join("|");
  const visibleSignature = visibleIds.join("|");
  const contextKey = `${view}:${vesselIdentity}:${arrangement}:${laneCount}:${availabilitySignature}:${visibleSignature}`;
  const requestKey = `${contextKey}:rebalance-${rebalanceSequence}`;
  const currentPlacements = assignment.requestKey === requestKey
    ? assignment.placements
    : lanesToPlacementMap(balanceContiguousPanelLanes(visibleIds, heights, laneCount));
  const layout = computeFlatFlightPanelLayout(visibleIds, currentPlacements, heights, laneCount, laneWidth);

  useLayoutEffect(() => {
    if (!active || !sectionRef.current) return undefined;
    const section = sectionRef.current;
    const measure = () => {
      const nextHeights: Partial<Record<FlightLayoutPanelId, number>> = {};
      section.querySelectorAll<HTMLElement>("[data-flight-panel-host]").forEach((host) => {
        const id = host.dataset.flightPanelHost as FlightLayoutPanelId | undefined;
        if (id && !hiddenPanels.has(id)) nextHeights[id] = host.getBoundingClientRect().height;
      });
      setHeights((current) => sameHeights(current, nextHeights) ? current : nextHeights);
      setAssignment((current) => current.requestKey === requestKey
        ? current
        : {
          placements: lanesToPlacementMap(
            balanceContiguousPanelLanes(visibleIds, nextHeights, laneCount),
          ),
          requestKey,
        });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    section.querySelectorAll<HTMLElement>("[data-flight-panel-host]").forEach((host) => {
      if (!hiddenPanels.has(host.dataset.flightPanelHost ?? "")) observer.observe(host);
    });
    return () => observer.disconnect();
  }, [active, hiddenPanels, laneCount, requestKey, visibleSignature]);

  const emptyMessage = panels.length === 0
    ? "Nothing is pinned to PLAN yet. Pin a mission plan, orbit plan, or mission note to keep it here."
    : "All panels in this workspace are hidden. Restore one from the dashboard rail.";

  return (
    <section
      aria-hidden={!active}
      aria-labelledby={`flight-workspace-tab-${view}`}
      className="flight-workspace-view"
      data-flight-workspace-view={view}
      hidden={!active}
      id={`flight-workspace-panel-${view}`}
      inert={!active}
      ref={sectionRef}
      role="tabpanel"
      style={{ height: visibleIds.length > 0 ? layout.height : undefined }}
    >
      {panels.map(({ content, id }) => (
        <FlightPanelHost
          active={active}
          id={id}
          key={id}
          position={layout.positions[id]}
          visible={!hiddenPanels.has(id)}
          width={laneWidth}
        >
          <div className={`flight-panel-slot flight-panel-slot-${id}`} data-flight-panel={id}>
            {content}
          </div>
        </FlightPanelHost>
      ))}
      {active && visibleIds.length === 0 && (
        <div className="flight-workspace-empty" role="status">{emptyMessage}</div>
      )}
    </section>
  );
}
