// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { editorTelemetryFixture } from "../telemetry/fixtures";
import { EditorSummaryPanel } from "./EditorSummaryPanel";

afterEach(cleanup);

describe("EditorSummaryPanel", () => {
  it("renders craft mass, build counts, cost, and resource totals", () => {
    render(<EditorSummaryPanel snapshot={editorTelemetryFixture} />);

    expect(screen.getByText("18,742 kg", { exact: true })).toBeTruthy();
    expect(screen.getByText("31", { exact: true })).toBeTruthy();
    expect(screen.getByText("√42,580", { exact: true })).toBeTruthy();
    expect(screen.getByText("Liquid Fuel", { exact: true })).toBeTruthy();
    const fullMeters = screen.getAllByRole("meter", { name: "100% full" });
    expect(fullMeters).toHaveLength(4);
    expect(fullMeters.every((meter) => meter.querySelector(".fill.healthy"))).toBe(true);
  });

  it("uses the flight consumables severity colors", () => {
    render(<EditorSummaryPanel snapshot={{
      ...editorTelemetryFixture,
      "editor.res[ElectricCharge]": 15,
      "editor.resMax[ElectricCharge]": 100,
      "editor.res[LiquidFuel]": 40,
      "editor.resMax[LiquidFuel]": 100,
    }} />);

    expect(screen.getByRole("meter", { name: "15% full" }).querySelector(".fill.low")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "40% full" }).querySelector(".fill.mid")).toBeTruthy();
  });

  it("distinguishes a recalculation from an outdated StageStats service", () => {
    const view = render(<EditorSummaryPanel snapshot={{
      ...editorTelemetryFixture,
      "editor.stable": false,
      "stage.pending": true,
    }} />);
    expect(screen.getByText("Recalculating craft totals…", { exact: true })).toBeTruthy();

    view.rerender(<EditorSummaryPanel snapshot={{
      ...editorTelemetryFixture,
      "editor.summaryAvailable": false,
    }} />);
    expect(screen.getByText(/Updated StageStats service required/)).toBeTruthy();
  });
});
