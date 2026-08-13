// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { degradedElectricityFixture, denseElectricityFixture, missingElectricityFixture, representativeElectricityFixture } from "../electricityPlanner/fixtures";
import { PanelVisibilityProvider } from "./PanelVisibility";
import { EditorElectricityPanel } from "./EditorElectricityPanel";
import type { TelemetrySnapshot } from "../telemetry/types";

function renderPanel(snapshot: TelemetrySnapshot = representativeElectricityFixture) {
  return render(<PanelVisibilityProvider><EditorElectricityPanel snapshot={snapshot} /></PanelVisibilityProvider>);
}

afterEach(cleanup);

describe("EditorElectricityPanel", () => {
  it("renders the scenario rail, readout well, and always-open semantic ledgers", () => {
    const { container } = renderPanel(denseElectricityFixture);
    expect(container.querySelector(".editor-electricity-scenario-rail")).toBeTruthy();
    expect(container.querySelector(".editor-electricity-readout-well")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Electricity planner body" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Electricity planner orbital altitude (km)" })).toBeTruthy();
    expect(screen.getByText("Body-to-star distance")).toBeTruthy();
    expect(screen.getByText("Orbit period")).toBeTruthy();
    expect(screen.getByText("Longest eclipse")).toBeTruthy();
    expect(screen.getByText("Solar efficiency")).toBeTruthy();
    expect(screen.getByRole("meter", { name: /Battery charge/ })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Power generated" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Power consumed" })).toBeTruthy();
    expect(container.querySelector("details")).toBeNull();
    expect(screen.queryByRole("button", { name: "Backend defaults" })).toBeNull();
  });

  it("uses scoped all and none controls without assuming fixture component IDs", () => {
    renderPanel();
    const generated = screen.getByRole("region", { name: "Power generated" });
    const consumed = screen.getByRole("region", { name: "Power consumed" });
    const producer = generated.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const consumer = consumed.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(producer.checked).toBe(true);
    expect(consumer.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(producer.checked).toBe(false);
    expect(consumer.checked).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "All" })[1]);
    expect(consumer.checked).toBe(true);
  });

  it("stores altitude input in metres while presenting kilometres", () => {
    renderPanel();
    const altitude = screen.getByRole("spinbutton", { name: "Electricity planner orbital altitude (km)" }) as HTMLInputElement;
    fireEvent.change(altitude, { target: { value: "123" } });
    expect(altitude.value).toBe("123");
    expect(screen.getByText("Orbit period")).toBeTruthy();
  });

  it("reports full charge and a shadow survival assessment in operational text", () => {
    renderPanel();
    expect(screen.getByText("Fully charged")).toBeTruthy();
    expect(screen.getByText("Shadow assessment")).toBeTruthy();
    expect(screen.getByText(/HOLDS — Current reported charge survives/)).toBeTruthy();
    expect(screen.getByText(/Recurring orbit:/)).toBeTruthy();
  });

  it("keeps warming, degraded, retained, and unavailable branches explicit", () => {
    const { rerender } = renderPanel(missingElectricityFixture);
    expect(screen.getByText(/Reading craft electrical modules/)).toBeTruthy();
    rerender(<PanelVisibilityProvider><EditorElectricityPanel snapshot={degradedElectricityFixture} /></PanelVisibilityProvider>);
    expect(screen.getByText(/Dynamic Battery Storage reflection was unavailable/)).toBeTruthy();
    rerender(<PanelVisibilityProvider><EditorElectricityPanel snapshot={{ ...representativeElectricityFixture, "editor.elec.retained": true }} /></PanelVisibilityProvider>);
    expect(screen.getByText(/Retained analysis/)).toBeTruthy();
    rerender(<PanelVisibilityProvider><EditorElectricityPanel snapshot={{ ...representativeElectricityFixture, "editor.elec.status": "unavailable" }} /></PanelVisibilityProvider>);
    expect(screen.getByText(/Electricity analysis is unavailable/)).toBeTruthy();
  });
});
