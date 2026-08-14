// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PanelVisibilityProvider, usePanelVisibility } from "./PanelVisibility";

function Harness() {
  const { autoCollapsePanel, hiddenPanels, restoreAllHiddenPanels } = usePanelVisibility();
  return <>
    <output data-testid="hidden-count">{hiddenPanels.size}</output>
    <button onClick={() => autoCollapsePanel("sci")} type="button">Auto collapse science</button>
    <button onClick={restoreAllHiddenPanels} type="button">Restore all</button>
  </>;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("PanelVisibilityProvider bulk restore", () => {
  it("clears preference and transient hidden panels without resetting unrelated settings", () => {
    localStorage.setItem("wmc-hidden-panels-v1", JSON.stringify(["editorDeltaVPlan"]));
    localStorage.setItem("wmc-science-alarm-defaults-v1", "keep-alarm-settings");
    localStorage.setItem("wmc-theme-v1", "keep-theme");
    localStorage.setItem("wmc-resonant-library-v2", "keep-plans");

    render(<PanelVisibilityProvider><Harness /></PanelVisibilityProvider>);
    expect(screen.getByTestId("hidden-count").textContent).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Auto collapse science" }));
    expect(screen.getByTestId("hidden-count").textContent).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "Restore all" }));
    expect(screen.getByTestId("hidden-count").textContent).toBe("0");
    expect(JSON.parse(localStorage.getItem("wmc-hidden-panels-v1") ?? "null")).toEqual([]);
    expect(localStorage.getItem("wmc-science-alarm-defaults-v1")).toBe("keep-alarm-settings");
    expect(localStorage.getItem("wmc-theme-v1")).toBe("keep-theme");
    expect(localStorage.getItem("wmc-resonant-library-v2")).toBe("keep-plans");
  });
});
