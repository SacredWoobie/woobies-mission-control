import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { representativeElectricityFixture } from "../electricityPlanner/fixtures";
import { PanelVisibilityProvider } from "./PanelVisibility";
import { EditorElectricityPanel } from "./EditorElectricityPanel";

function renderPanel() {
  return render(<PanelVisibilityProvider><EditorElectricityPanel snapshot={representativeElectricityFixture} /></PanelVisibilityProvider>);
}

describe("EditorElectricityPanel", () => {
  it("renders editor-only planning outputs and the conservative assumptions", () => {
    renderPanel();
    expect(screen.getByText("EDITOR ONLY · READ-ONLY")).toBeTruthy();
    expect(screen.getByText("Maximum central eclipse")).toBeTruthy();
    expect(screen.getByText(/Conservative maximum central eclipse/)).toBeTruthy();
    expect(screen.getByText(/This planner never changes KSP/)).toBeTruthy();
  });

  it("supports presets and bounded category drill-down without persistence", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Producers off" }));
    fireEvent.click(screen.getByRole("button", { name: /Solar/ }));
    const toggle = screen.getByRole("checkbox", { name: /OX-4L/ });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
  });

  it("makes unavailable analysis explicit", () => {
    render(<PanelVisibilityProvider><EditorElectricityPanel snapshot={{ ...representativeElectricityFixture, "editor.elec.status": "unavailable" }} /></PanelVisibilityProvider>);
    expect(screen.getByText(/Electricity analysis is unavailable/)).toBeTruthy();
  });
});
