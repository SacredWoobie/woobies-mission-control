import type { ReactNode } from "react";
import { HideablePanelSlot, PanelRestoreRail, usePanelVisibility, type DashboardPanelId } from "./PanelVisibility";

interface FlightDashboardProps {
  ascension: ReactNode;
  availablePanels: ReadonlySet<DashboardPanelId>;
  clock: ReactNode;
  consumables: ReactNode;
  electricity: ReactNode;
  heat: ReactNode;
  pinnedNote?: ReactNode;
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
  pinnedNote,
  science,
  staging,
  target,
}: FlightDashboardProps) {
  const { hiddenPanels } = usePanelVisibility();
  const hasLeft = !hiddenPanels.has("asc") || !hiddenPanels.has("cons");
  const hasSystems = !hiddenPanels.has("heat") || !hiddenPanels.has("elec") || !hiddenPanels.has("sci");
  const hasMission = !hiddenPanels.has("stage") || (!!target && !hiddenPanels.has("target")) || (!!pinnedNote && !hiddenPanels.has("flightNote"));
  const columnCount = Number(hasLeft) + Number(hasSystems) + Number(hasMission);
  const layoutClasses = [
    `flight-columns-${Math.max(1, columnCount)}`,
    !hasLeft ? "no-left-column" : "",
    !hasSystems ? "no-systems-column" : "",
    !hasMission ? "no-mission-column" : "",
    hiddenPanels.has("asc") ? "asc-hidden" : "",
  ].filter(Boolean).join(" ");
  return (
    <>
      <PanelRestoreRail available={availablePanels} />
      <div className={`status-strip ${hiddenPanels.has("clock") ? "clock-hidden" : ""}`}>
        <HideablePanelSlot id="clock">{clock}</HideablePanelSlot>
      </div>
      <div className={`flight-grid ${layoutClasses}`}>
        <HideablePanelSlot id="asc">{ascension}</HideablePanelSlot>
        <div className="deck">
          {!hiddenPanels.has("cons") && <div className="wide-column wide-left">
            <HideablePanelSlot id="cons">{consumables}</HideablePanelSlot>
          </div>}
          {hasSystems && <div className="wide-column wide-systems">
            <HideablePanelSlot id="heat">{heat}</HideablePanelSlot>
            <HideablePanelSlot id="elec">{electricity}</HideablePanelSlot>
            <HideablePanelSlot id="sci">{science}</HideablePanelSlot>
          </div>}
          {hasMission && <div className="wide-column wide-mission">
            <HideablePanelSlot id="stage">{staging}</HideablePanelSlot>
            {target && <HideablePanelSlot id="target">{target}</HideablePanelSlot>}
            {pinnedNote && <HideablePanelSlot id="flightNote">{pinnedNote}</HideablePanelSlot>}
          </div>}
        </div>
      </div>
    </>
  );
}
