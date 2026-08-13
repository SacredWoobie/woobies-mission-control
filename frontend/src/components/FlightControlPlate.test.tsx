// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlightWorkspaceView } from "../flight/layout";
import { FlightControlPlate } from "./FlightControlPlate";

afterEach(cleanup);

function renderControlledPlate(initialView: FlightWorkspaceView = "monitor") {
  const onRebalance = vi.fn();
  function ControlledPlate() {
    const [activeView, setActiveView] = useState<FlightWorkspaceView>(initialView);
    return <FlightControlPlate
      activeView={activeView}
      annunciator={<span>Master caution</span>}
      onRebalance={onRebalance}
      onSelectView={setActiveView}
    />;
  }
  render(<ControlledPlate />);
  return { onRebalance };
}

function tab(view: FlightWorkspaceView) {
  return screen.getByRole("tab", { name: view.toUpperCase() });
}

function key(tabElement: HTMLElement, value: string) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: value });
  fireEvent(tabElement, event);
  expect(event.defaultPrevented).toBe(true);
}

describe("FlightControlPlate", () => {
  it("exposes a roving workspace tablist with active panel contracts", () => {
    renderControlledPlate();

    expect(screen.getByRole("group", { name: "Flight caution and workspace controls" })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Flight workspace" })).toBeTruthy();
    expect(screen.getByText("Workspace", { exact: true })).toBeTruthy();
    expect(tab("monitor").getAttribute("aria-controls")).toBe("flight-workspace-panel-monitor");
    expect(tab("monitor").getAttribute("aria-selected")).toBe("true");
    expect(tab("monitor").tabIndex).toBe(0);
    expect(tab("plan").getAttribute("aria-controls")).toBe("flight-workspace-panel-plan");
    expect(tab("plan").getAttribute("aria-selected")).toBe("false");
    expect(tab("plan").tabIndex).toBe(-1);
  });

  it("selects PLAN when its tab is clicked", () => {
    const onSelectView = vi.fn();
    render(<FlightControlPlate activeView="monitor" annunciator={null} onRebalance={vi.fn()} onSelectView={onSelectView} />);

    fireEvent.click(tab("plan"));
    expect(onSelectView).toHaveBeenCalledWith("plan");
  });

  it("moves selection and focus with Arrow keys, Home, and End", () => {
    renderControlledPlate();

    tab("monitor").focus();
    key(tab("monitor"), "ArrowRight");
    expect(tab("plan").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("plan"));

    key(tab("plan"), "ArrowLeft");
    expect(tab("monitor").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("monitor"));

    key(tab("monitor"), "End");
    expect(tab("plan").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("plan"));

    key(tab("plan"), "Home");
    expect(tab("monitor").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("monitor"));
  });

  it("labels and rebalances the active workspace", () => {
    const { onRebalance } = renderControlledPlate("plan");
    const rebalance = screen.getByRole("button", { name: "Rebalance PLAN workspace" });

    expect(rebalance.getAttribute("title")).toBe("Rebalance PLAN panels");
    fireEvent.click(rebalance);
    expect(onRebalance).toHaveBeenCalledOnce();
  });
});
