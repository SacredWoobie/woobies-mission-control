// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlightWorkspaceView, type FlightWorkspacePanel } from "./FlightWorkspaceView";

let resizeCallbacks: ResizeObserverCallback[] = [];
let electricityHeight = 100;

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); }
  disconnect() {}
  observe() {}
  unobserve() {}
}

function Probe({ id }: { id: string }) {
  const [count, setCount] = useState(0);
  return <button data-testid={`${id}-node`} onClick={() => setCount((value) => value + 1)} type="button">{id}:{count}</button>;
}

function rect(height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: 440,
    top: 0,
    width: 440,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
}

beforeEach(() => {
  resizeCallbacks = [];
  electricityHeight = 100;
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function measuredRect(this: HTMLElement) {
    const id = this.dataset.flightPanelHost;
    if (id === "elec") return rect(electricityHeight);
    if (id === "heat") return rect(80);
    if (id === "sci") return rect(90);
    if (id === "target") return rect(70);
    return rect(0);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const panels: FlightWorkspacePanel[] = [
  { content: <Probe id="elec" />, id: "elec" },
  { content: <Probe id="heat" />, id: "heat" },
  { content: <Probe id="sci" />, id: "sci" },
  { content: <Probe id="target" />, id: "target" },
];

function workspace(overrides: Partial<Parameters<typeof FlightWorkspaceView>[0]> = {}) {
  return (
    <FlightWorkspaceView
      active
      arrangement="side-by-side"
      hiddenPanels={new Set()}
      laneCount={2}
      laneWidth={440}
      panels={panels}
      rebalanceSequence={0}
      vesselIdentity="vessel-1"
      view="monitor"
      {...overrides}
    />
  );
}

describe("FlightWorkspaceView", () => {
  it("preserves flat panel identity, focus, state, and scroll through workspace transitions", () => {
    const view = render(workspace());
    const electricity = view.getByTestId("elec-node");
    const electricitySlot = electricity.closest<HTMLElement>("[data-flight-panel]");
    const heat = view.getByTestId("heat-node");
    fireEvent.click(electricity);
    expect(electricity.textContent).toBe("elec:1");
    electricity.focus();
    if (electricitySlot) electricitySlot.scrollTop = 37;
    expect(document.activeElement).toBe(electricity);
    expect(heat.closest<HTMLElement>("[data-flight-panel-host]")?.style.transform).toBe("translate(0px, 112px)");

    view.rerender(workspace({ arrangement: "stacked", laneCount: 3 }));
    expect(view.getByTestId("elec-node")).toBe(electricity);
    expect(document.activeElement).toBe(electricity);
    expect(electricitySlot?.scrollTop).toBe(37);
    view.rerender(workspace({ arrangement: "stacked", laneCount: 2 }));
    expect(view.getByTestId("elec-node")).toBe(electricity);
    expect(document.activeElement).toBe(electricity);
    expect(electricitySlot?.scrollTop).toBe(37);
    view.rerender(workspace({ arrangement: "stacked", laneCount: 2, rebalanceSequence: 1 }));
    expect(view.getByTestId("elec-node")).toBe(electricity);
    expect(document.activeElement).toBe(electricity);
    expect(electricitySlot?.scrollTop).toBe(37);

    view.rerender(workspace({ hiddenPanels: new Set(["elec"]) }));
    expect(view.getByTestId("elec-node")).toBe(electricity);
    expect(electricity.closest<HTMLElement>("[data-flight-panel-host]")?.style.display).toBe("none");
    view.rerender(workspace());
    expect(view.getByTestId("elec-node")).toBe(electricity);
    expect(electricity.textContent).toBe("elec:1");
    expect(electricitySlot?.scrollTop).toBe(37);

    view.rerender(workspace({ active: false }));
    expect(view.getByTestId("elec-node")).toBe(electricity);
    view.rerender(workspace());
    expect(view.getByTestId("elec-node")).toBe(electricity);
    expect(electricity.textContent).toBe("elec:1");
    expect(electricitySlot?.scrollTop).toBe(37);
  });

  it("recomputes coordinates but not assignment when a panel height changes", () => {
    const view = render(workspace());
    const heatHost = view.getByTestId("heat-node").closest<HTMLElement>("[data-flight-panel-host]");
    expect(heatHost?.style.transform).toBe("translate(0px, 112px)");
    electricityHeight = 140;
    act(() => resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)));
    expect(heatHost?.style.transform).toBe("translate(0px, 152px)");
  });
});
