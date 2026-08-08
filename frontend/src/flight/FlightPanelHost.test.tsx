// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { liveTelemetryStore, type LiveTelemetryState } from "../telemetry/store";
import { useLiveTelemetrySelector } from "../telemetry/useLiveTelemetry";
import { FlightPanelHost } from "./FlightPanelHost";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function StatefulProbe() {
  const [count, setCount] = useState(0);
  const frameCount = useLiveTelemetrySelector((state) => state.frameCount);
  return (
    <div data-testid="probe">
      <button onClick={() => setCount((value) => value + 1)} type="button">State {count}</button>
      <span data-testid="frame">{frameCount}</span>
      <div data-testid="scroll" style={{ height: 10, overflow: "auto" }}><div style={{ height: 100 }} /></div>
    </div>
  );
}

describe("FlightPanelHost", () => {
  it("retains its child node, local state, and scroll while becoming inert", () => {
    const view = render(<FlightPanelHost active id="elec" visible><StatefulProbe /></FlightPanelHost>);
    const node = view.getByTestId("probe");
    const scroll = view.getByTestId("scroll");
    fireEvent.click(view.getByRole("button", { name: "State 0" }));
    scroll.scrollTop = 37;

    view.rerender(<FlightPanelHost active={false} id="elec" visible><StatefulProbe /></FlightPanelHost>);
    const host = view.container.querySelector('[data-flight-panel-host="elec"]');
    expect(view.getByTestId("probe")).toBe(node);
    expect(host?.getAttribute("aria-hidden")).toBe("true");
    expect(host?.hasAttribute("inert")).toBe(true);

    view.rerender(<FlightPanelHost active id="elec" visible><StatefulProbe /></FlightPanelHost>);
    expect(view.getByTestId("probe")).toBe(node);
    expect(view.getByRole("button", { name: "State 1" })).toBeTruthy();
    expect(scroll.scrollTop).toBe(37);
  });

  it("suspends nested live selectors and resumes from the current snapshot", () => {
    let storeState = { ...liveTelemetryStore.getSnapshot(), frameCount: 1 } as LiveTelemetryState;
    const listeners = new Set<() => void>();
    vi.spyOn(liveTelemetryStore, "getSnapshot").mockImplementation(() => storeState);
    vi.spyOn(liveTelemetryStore, "subscribe").mockImplementation((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });

    const view = render(<FlightPanelHost active id="elec" visible><StatefulProbe /></FlightPanelHost>);
    expect(view.getByTestId("frame").textContent).toBe("1");
    expect(listeners.size).toBe(1);

    view.rerender(<FlightPanelHost active={false} id="elec" visible><StatefulProbe /></FlightPanelHost>);
    expect(listeners.size).toBe(0);
    storeState = { ...storeState, frameCount: 9 };
    act(() => listeners.forEach((listener) => listener()));
    expect(view.getByTestId("frame").textContent).toBe("1");

    view.rerender(<FlightPanelHost active id="elec" visible><StatefulProbe /></FlightPanelHost>);
    expect(listeners.size).toBe(1);
    expect(view.getByTestId("frame").textContent).toBe("9");
  });
});
