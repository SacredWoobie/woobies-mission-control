// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { flightTelemetryFixture } from "../telemetry/fixtures";
import type { TelemetrySnapshot } from "../telemetry/types";
import { ElectricityPanel } from "./ElectricityPanel";
import { PanelVisibilityProvider } from "./PanelVisibility";

afterEach(cleanup);

function renderPanel(snapshot: TelemetrySnapshot) {
  return render(
    <PanelVisibilityProvider>
      <ElectricityPanel snapshot={snapshot} />
    </PanelVisibilityProvider>,
  );
}

describe("ElectricityPanel", () => {
  it("shows the automatic source ledger and no By source control", () => {
    const { container } = renderPanel(flightTelemetryFixture);

    expect(screen.queryByText("By source", { exact: true })).toBeNull();
    expect(screen.getByLabelText("Electricity generation by source")).toBeTruthy();
    expect(screen.getByText("Reactors", { exact: true })).toBeTruthy();
    expect(screen.getByText("RTG", { exact: true })).toBeTruthy();
    expect(screen.getByText("Solar", { exact: true })).toBeTruthy();
    expect(screen.getByText("Other", { exact: true })).toBeTruthy();
    expect(screen.getByText("DEGRADED", { exact: true })).toBeTruthy();
    expect(container.querySelector('[role="meter"][aria-label="83% electric charge remaining"]')).toBeTruthy();
    expect(container.querySelector(".ec-charge-fill.healthy")).toBeTruthy();
  });

  it("hides the ledger for a single source family", () => {
    renderPanel({
      "context.mode": "flight",
      "r.resource[ElectricCharge]": 1_820,
      "r.resourceMax[ElectricCharge]": 2_000,
      "elec.totalGenEcPerSec": 2.4,
      "elec.netEcPerSec": 1.6,
      "elec.drawEcPerSec": 0.8,
      "elec.flowState": "valid",
      "elec.reactors": [],
      "solar.count": 6,
      "solar.outputEcPerSec": 2.4,
      "solar.efficiency": 0.94,
      "rtg.count": 0,
    });

    expect(screen.getByText("Solar output", { exact: true })).toBeTruthy();
    expect(screen.getByText("SUNLIT", { exact: true })).toBeTruthy();
    expect(screen.queryByLabelText("Electricity generation by source")).toBeNull();
    expect(screen.getByText("full in 1m 52s", { exact: true })).toBeTruthy();
  });

  it("uses the depletion layout when the craft has batteries but no generators", () => {
    const { container } = renderPanel({
      "context.mode": "flight",
      "r.resource[ElectricCharge]": 640,
      "r.resourceMax[ElectricCharge]": 2_000,
      "elec.netEcPerSec": -0.35,
      "elec.drawEcPerSec": 0.35,
      "elec.flowState": "valid",
      "elec.reactors": [],
      "solar.count": 0,
      "rtg.count": 0,
    });

    expect(screen.getByText("Stored charge", { exact: true })).toBeTruthy();
    expect(screen.getByText("NONE", { exact: true })).toBeTruthy();
    expect(screen.getByText("empty in 30m 28s", { exact: true })).toBeTruthy();
    expect(container.querySelector(".ec-charge-fill.mid")).toBeTruthy();
    expect(container.querySelector(".ec-generation-meter")).toBeNull();
  });

  it("uses the consumables warning color at critically low charge", () => {
    const { container } = renderPanel({
      "context.mode": "flight",
      "r.resource[ElectricCharge]": 100,
      "r.resourceMax[ElectricCharge]": 1_000,
      "elec.netEcPerSec": -1,
      "elec.drawEcPerSec": 1,
      "elec.flowState": "valid",
      "elec.reactors": [],
      "solar.count": 0,
      "rtg.count": 0,
    });

    expect(container.querySelector(".ec-charge-fill.low")).toBeTruthy();
  });

  it("labels saturated full storage without inventing draw", () => {
    renderPanel({
      "context.mode": "flight",
      "r.resource[ElectricCharge]": 1_000,
      "r.resourceMax[ElectricCharge]": 1_000,
      "elec.totalGenEcPerSec": 0.3,
      "elec.flowState": "saturated",
      "elec.reactors": [],
      "solar.count": 2,
      "solar.outputEcPerSec": 0.3,
      "solar.efficiency": 0.36,
      "rtg.count": 0,
    });

    expect(screen.getByText("draw unavailable", { exact: true })).toBeTruthy();
    expect(screen.getByText("battery full", { exact: true })).toBeTruthy();
    expect(screen.queryByText("draw 0.3 EC/s", { exact: true })).toBeNull();
  });

  it("formats charge as one pair and rounds reactor integrity", () => {
    renderPanel({
      ...flightTelemetryFixture,
      "r.resource[ElectricCharge]": 1_499,
      "r.resourceMax[ElectricCharge]": 1_500,
      "elec.reactors": [{
        name: "Test reactor",
        on: true,
        ecPerSec: 12,
        coreTemp: 2_400,
        nominalTemp: 3_000,
        integrity: 99.99999237060547,
        fuel: "10y",
      }],
    });

    expect(screen.getByText("1,499/1,500", { exact: true })).toBeTruthy();
    expect(screen.getByText("2,400 K", { exact: true })).toBeTruthy();
    expect(screen.getByText("100%", { exact: true })).toBeTruthy();
  });
});
