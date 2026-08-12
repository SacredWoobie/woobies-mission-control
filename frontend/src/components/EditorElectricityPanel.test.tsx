// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { representativeElectricityFixture } from "../electricityPlanner/fixtures";
import { PanelVisibilityProvider } from "./PanelVisibility";
import { EditorElectricityPanel } from "./EditorElectricityPanel";
import type { TelemetrySnapshot } from "../telemetry/types";

function renderPanel(snapshot: TelemetrySnapshot = representativeElectricityFixture) {
  return render(<PanelVisibilityProvider><EditorElectricityPanel snapshot={snapshot} /></PanelVisibilityProvider>);
}

afterEach(cleanup);

describe("EditorElectricityPanel", () => {
  it("renders editor-only planning outputs and the conservative assumptions", () => {
    renderPanel();
    expect(screen.getByText("EDITOR ONLY · READ-ONLY")).toBeTruthy();
    expect(screen.getByText("Battery depletion")).toBeTruthy();
    expect(screen.getByText("Time in eclipse")).toBeTruthy();
    expect(screen.getByText("Solar efficiency")).toBeTruthy();
    expect(screen.getByText("96.2%")).toBeTruthy();
    expect(screen.getByText("Power Generated")).toBeTruthy();
    expect(screen.getByText("Power Consumed")).toBeTruthy();
    expect(screen.getByText(/Conservative maximum central eclipse/)).toBeTruthy();
    expect(screen.getByText(/This planner never changes KSP/)).toBeTruthy();
  });

  it("supports presets and separate generated/consumed drill-downs without persistence", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Producers off" }));
    fireEvent.click(screen.getByText("Power Generated"));
    const toggle = screen.getByRole("checkbox", { name: /OX-4L/ });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    expect((toggle as HTMLInputElement).checked).toBe(true);
  });

  it("makes unavailable analysis explicit", () => {
    render(<PanelVisibilityProvider><EditorElectricityPanel snapshot={{ ...representativeElectricityFixture, "editor.elec.status": "unavailable" }} /></PanelVisibilityProvider>);
    expect(screen.getByText(/Electricity analysis is unavailable/)).toBeTruthy();
  });

  it("shows unresolved body illumination as unavailable rather than zero percent", () => {
    const body = representativeElectricityFixture["editor.elec.bodies"]![0];
    renderPanel({ ...representativeElectricityFixture, "editor.elec.bodies": [{ ...body, solarEfficiency: 0 }] });
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("0.0%")).toBeNull();
  });
});
