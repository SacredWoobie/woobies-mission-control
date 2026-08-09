import type { KeyboardEvent, ReactNode } from "react";
import type { FlightWorkspaceView } from "../flight/layout";

interface FlightControlPlateProps {
  activeView: FlightWorkspaceView;
  annunciator: ReactNode;
  onRebalance(): void;
  onSelectView(view: FlightWorkspaceView): void;
}

const WORKSPACE_VIEWS = ["monitor", "plan"] as const;

export function FlightControlPlate({
  activeView,
  annunciator,
  onRebalance,
  onSelectView,
}: FlightControlPlateProps) {
  const selectAdjacentView = (event: KeyboardEvent<HTMLButtonElement>, view: FlightWorkspaceView) => {
    let next: FlightWorkspaceView | undefined;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") next = view === "monitor" ? "plan" : "monitor";
    if (event.key === "Home") next = "monitor";
    if (event.key === "End") next = "plan";
    if (!next) return;
    event.preventDefault();
    onSelectView(next);
    document.getElementById(`flight-workspace-tab-${next}`)?.focus();
  };

  return (
    <div aria-label="Flight caution and workspace controls" className="flight-control-plate" role="group">
      {annunciator}
      <div className="flight-workspace-controls">
        <span aria-hidden="true" className="flight-control-divider" />
        <span className="flight-workspace-label">Workspace</span>
        <div
          aria-label="Flight workspace"
          className="flight-workspace-selector"
          data-active-view={activeView}
          role="tablist"
        >
          <span aria-hidden="true" className="flight-workspace-selection-indicator" />
          {WORKSPACE_VIEWS.map((view) => (
            <button
              aria-controls={`flight-workspace-panel-${view}`}
              aria-selected={activeView === view}
              id={`flight-workspace-tab-${view}`}
              key={view}
              onKeyDown={(event) => selectAdjacentView(event, view)}
              onClick={() => onSelectView(view)}
              role="tab"
              tabIndex={activeView === view ? 0 : -1}
              type="button"
            >
              {view.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          aria-label={`Rebalance ${activeView.toUpperCase()} workspace`}
          className="flight-workspace-rebalance"
          onClick={onRebalance}
          title={`Rebalance ${activeView.toUpperCase()} panels`}
          type="button"
        >
          ↻
        </button>
      </div>
    </div>
  );
}
