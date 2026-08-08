// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { editorTelemetryFixture } from "../telemetry/fixtures";
import { EditorSummaryPanel } from "./EditorSummaryPanel";

afterEach(cleanup);

describe("EditorSummaryPanel", () => {
  it("renders the focused craft resource inventory", () => {
    render(<EditorSummaryPanel snapshot={editorTelemetryFixture} />);

    expect(screen.getByRole("heading", { name: /Resource inventory/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Craft resource inventory" })).toBeTruthy();
    expect(screen.queryByText("18,742 kg", { exact: true })).toBeNull();
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

  it.each([
    ["missing amount", undefined, 100],
    ["missing capacity", 25, undefined],
    ["zero capacity", 0, 0],
  ])("does not announce %s as a valid zero", (_label, amount, capacity) => {
    render(<EditorSummaryPanel snapshot={{
      ...editorTelemetryFixture,
      "editor.res.names": ["ElectricCharge"],
      "editor.res[ElectricCharge]": amount,
      "editor.resMax[ElectricCharge]": capacity,
    }} />);

    const meter = screen.getByRole("img", { name: "Amount unavailable" });
    expect(meter.hasAttribute("aria-valuenow")).toBe(false);
    expect(meter.hasAttribute("aria-valuemin")).toBe(false);
    expect(meter.hasAttribute("aria-valuemax")).toBe(false);
    expect(meter.querySelector<HTMLElement>(".fill")?.style.width).toBe("0%");
    expect(meter.querySelector(".fill.low, .fill.mid, .fill.healthy")).toBeNull();
  });

  it("distinguishes a recalculation from an outdated StageStats service", () => {
    const view = render(<EditorSummaryPanel snapshot={{
      ...editorTelemetryFixture,
      "editor.analysisRevision": undefined,
      "editor.stable": false,
      "stage.pending": true,
    }} />);
    expect(screen.getByText("Recalculating resource totals…", { exact: true })).toBeTruthy();

    view.rerender(<EditorSummaryPanel snapshot={{
      ...editorTelemetryFixture,
      "editor.summaryAvailable": false,
    }} />);
    expect(screen.getByText(/Updated StageStats service required/)).toBeTruthy();
  });

  it("retains dimmed resource totals while the next revision is pending", () => {
    const { container } = render(<EditorSummaryPanel snapshot={{
      ...editorTelemetryFixture,
      "editor.revision": 8,
      "editor.analysisRevision": 7,
      "editor.stable": false,
      "stage.pending": true,
    }} />);

    expect(screen.getByText("Previous confirmed values — recalculating")).toBeTruthy();
    expect(screen.getByText("Liquid Fuel", { exact: true })).toBeTruthy();
    expect(container.querySelector("#editorSummary .editor-analysis-retained")).toBeTruthy();
    expect(screen.queryByText("Recalculating resource totals…")).toBeNull();
  });
});
