import { createContext, useContext, type CSSProperties, type PropsWithChildren } from "react";
import type { FlightLayoutPanelId, FlightPanelPosition } from "./layout";

const FlightPanelActivityContext = createContext(true);

export function useFlightPanelActivity() {
  return useContext(FlightPanelActivityContext);
}

interface FlightPanelHostProps extends PropsWithChildren {
  active: boolean;
  id: FlightLayoutPanelId;
  layout?: "flat" | "flow";
  position?: Pick<FlightPanelPosition, "x" | "y">;
  visible: boolean;
  width?: number;
}

export function FlightPanelHost({
  active,
  children,
  id,
  layout = "flat",
  position,
  visible,
  width,
}: FlightPanelHostProps) {
  const participating = active && visible;
  const style: CSSProperties = {
    display: participating ? "block" : "none",
    position: layout === "flat" ? "absolute" : "relative",
    transform: layout === "flat" ? `translate(${position?.x ?? 0}px, ${position?.y ?? 0}px)` : undefined,
    width,
  };

  return (
    <div
      aria-hidden={!participating}
      data-flight-panel-host={id}
      inert={!participating}
      style={style}
    >
      <FlightPanelActivityContext.Provider value={participating}>
        {children}
      </FlightPanelActivityContext.Provider>
    </div>
  );
}
