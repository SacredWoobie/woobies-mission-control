// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  editorTelemetryFixture,
  flightTelemetryFixture,
} from "../telemetry/fixtures";
import type { TelemetrySnapshot } from "../telemetry/types";
import { StagingPanel } from "./StagingPanel";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("StagingPanel", () => {
  it("shows both Flight delta-v conditions and only powered stages", () => {
    const { container } = render(<StagingPanel snapshot={flightTelemetryFixture} />);

    expect(screen.getByText("Total Δv · vacuum")).toBeTruthy();
    expect(screen.getByText("Δv LIVE").getAttribute("title")).toBe("Delta-v at live flight conditions");
    expect(screen.getByText("Δv VAC").getAttribute("title")).toBe("Delta-v in vacuum");
    expect(screen.getByText("TWR · LIVE").getAttribute("title")).toBe("Full-throttle TWR at live body gravity (Kerbin)");
    expect(screen.queryByRole("button", { name: "CURRENT" })).toBeNull();
    expect(screen.queryByRole("button", { name: "VACUUM" })).toBeNull();
    expect(screen.getByText("S0")).toBeTruthy();
    expect(screen.getByText("S2")).toBeTruthy();
    expect(screen.queryByText("S1")).toBeNull();
    expect(screen.getByText("1 unpowered stage hidden")).toBeTruthy();
    expect(container.querySelector(".st-row.cur .sname")?.textContent).toBe("S2");
    expect(container.querySelector("#stage > h2 .tag")).toBeNull();
  });

  it("uses the live vessel throttle instead of the slower staging snapshot", () => {
    render(<StagingPanel snapshot={{
      ...flightTelemetryFixture,
      "krpc.throttle": 0.42,
      "stage.throttle": 0.9,
    }} />);

    expect(screen.getByText("throttle 42%", { exact: true })).toBeTruthy();
  });

  it("recovers the KSP throttle gauge from active thrust when control reports zero", () => {
    render(<StagingPanel snapshot={{
      ...flightTelemetryFixture,
      "krpc.throttle": 0,
      "v.thrust": 550_716,
      "v.availableThrust": 550_723,
      "stage.throttle": 0,
    }} />);

    expect(screen.getByText("throttle 100%", { exact: true })).toBeTruthy();
  });

  it("groups distant powered stages and expands them inside a bounded row region", () => {
    const stages = [0, 2, 3, 5, 6, 8, 9].map((ksp, index) => ({
      index,
      ksp,
      dvAtmo: 200 + index * 100,
      dvVac: 250 + index * 100,
      twrAtmo: 0.8 + index * 0.2,
      burn: 20 + index,
    }));
    const { container } = render(<StagingPanel snapshot={{
      ...flightTelemetryFixture,
      "stage.activeKsp": 9,
      "stage.currentKsp": 9,
      "stage.count": 10,
      "stage.unpoweredCount": 3,
      "stage.stages": stages,
    }} />);

    const expand = screen.getByRole("button", { name: "Expand 3 earlier powered stages, S0 through S3" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("S0–S3")).toBeTruthy();
    expect(Array.from(container.querySelectorAll(".flight-stage-rows .sname"), (node) => node.textContent)).toEqual([
      "S5", "S6", "S8", "S9",
    ]);

    fireEvent.click(expand);
    expect(screen.getByRole("button", { name: "Collapse 3 earlier powered stages, S0 through S3" }).getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".stage-table.flight.expanded .flight-stage-rows")).toBeTruthy();
    expect(container.querySelectorAll(".flight-stage-rows .sname")).toHaveLength(7);
  });

  it("collapses a one-stage Flight craft and applies surface TWR danger narrowly", () => {
    const stage = flightTelemetryFixture["stage.stages"]?.[0];
    const snapshot: TelemetrySnapshot = {
      ...flightTelemetryFixture,
      "v.situationString": "Pre Launch",
      "stage.situation": "Pre Launch",
      "stage.currentKsp": 0,
      "stage.activeKsp": 0,
      "stage.count": 2,
      "stage.unpoweredCount": 1,
      "stage.stages": stage ? [{
        ...stage,
        ksp: 0,
        twrStart: 0.71,
        twrEnd: 1.05,
      }] : [],
    };

    const { container } = render(<StagingPanel snapshot={snapshot} />);

    expect(container.querySelector(".flight-stage-single")).toBeTruthy();
    expect(container.querySelector(".stage-table.flight")).toBeNull();
    expect(screen.getByText("0.71→1.05").classList.contains("danger")).toBe(true);
    expect(screen.getByText("1 unpowered stage hidden")).toBeTruthy();
  });

  it("keeps the Editor staging table and full-duration formatting", () => {
    const { container } = render(<StagingPanel snapshot={editorTelemetryFixture} />);

    expect(screen.getByText("Editor staging analysis")).toBeTruthy();
    expect(screen.getByText("Δv Atmo")).toBeTruthy();
    expect(screen.getByText("Δv Vac")).toBeTruthy();
    expect(screen.getByText("00:00:42")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Editor stage performance" });
    expect(table.getAttribute("tabindex")).toBe("0");
    expect(screen.getAllByRole("row")).toHaveLength(9);
    expect(screen.getByRole("row", { name: "Current stage S9" }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("2 non-propulsive stages omitted")).toBeTruthy();
    expect(container.querySelector(".stage-table.editor")).toBe(table);
    expect(container.querySelector(".flight-stage-hero")).toBeNull();
    expect(container.querySelector("#stage > h2 .tag")).toBeTruthy();
  });

  it("retains and unmistakably marks the previous editor analysis", () => {
    const snapshot: TelemetrySnapshot = {
      ...editorTelemetryFixture,
      "editor.revision": 8,
      "editor.analysisRevision": 7,
      "editor.stable": false,
      "stage.pending": true,
    };

    const { container } = render(<StagingPanel snapshot={snapshot} />);

    expect(screen.getByText("Previous confirmed values — recalculating")).toBeTruthy();
    expect(container.querySelector(".stage-table.editor.editor-analysis-retained")).toBeTruthy();
    expect(container.querySelector(".stage-table.editor .st-row.cur")).toBeNull();
    expect(container.querySelector('.stage-table.editor [aria-current="step"]')).toBeNull();
    expect(container.querySelector(".stage-table.editor .sname")?.textContent).toBe("S0");
    expect(screen.queryByText("Calculating staging simulation…")).toBeNull();
  });

  it("keeps the calculating and unavailable states when retention is invalid", () => {
    const pending = render(<StagingPanel snapshot={{
      ...editorTelemetryFixture,
      "editor.analysisRevision": undefined,
      "editor.stable": false,
      "stage.pending": true,
      "stage.stages": undefined,
    }} />);
    expect(screen.getByText("Calculating staging simulation…")).toBeTruthy();
    expect(screen.queryByText(/Previous confirmed values/)).toBeNull();

    pending.rerender(<StagingPanel snapshot={{
      ...editorTelemetryFixture,
      "editor.analysisRevision": undefined,
      "stage.available": false,
      "stage.pending": false,
      "stage.stages": undefined,
    }} />);
    expect(screen.getByText("Staging simulation is not available.")).toBeTruthy();
    expect(screen.queryByText(/Previous confirmed values/)).toBeNull();
  });

  it("shows elapsed time after three seconds and resets it for a second edit", () => {
    vi.useFakeTimers();
    const snapshot: TelemetrySnapshot = {
      ...editorTelemetryFixture,
      "editor.revision": 8,
      "editor.analysisRevision": 7,
      "editor.stable": false,
      "stage.pending": true,
    };
    const view = render(<StagingPanel snapshot={snapshot} />);

    act(() => vi.advanceTimersByTime(2_999));
    expect(screen.getByText("Previous confirmed values — recalculating")).toBeTruthy();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("Previous confirmed values — recalculating (3s)")).toBeTruthy();

    view.rerender(<StagingPanel snapshot={{ ...snapshot, "editor.revision": 9 }} />);
    expect(screen.getByText("Previous confirmed values — recalculating")).toBeTruthy();
    expect(screen.queryByText(/recalculating \(3s\)/)).toBeNull();

    view.rerender(<StagingPanel snapshot={{
      ...snapshot,
      "editor.revision": 9,
      "editor.analysisRevision": 9,
      "editor.stable": true,
      "stage.pending": false,
    }} />);
    expect(screen.queryByText(/Previous confirmed values/)).toBeNull();
  });

  it("shares the 0.005 atm vacuum threshold with column dimming", () => {
    const snapshot: TelemetrySnapshot = {
      ...flightTelemetryFixture,
      "stage.staticPressureAtm": 0.003,
    };
    const view = render(<StagingPanel snapshot={snapshot} />);

    expect(screen.getByText("vacuum", { exact: true })).toBeTruthy();
    expect(view.container.querySelector(".st-head span:nth-child(2)")?.classList.contains("dim")).toBe(true);

    view.rerender(<StagingPanel snapshot={{ ...snapshot, "stage.staticPressureAtm": 0.005 }} />);
    expect(screen.getByText("0.005 atm", { exact: true })).toBeTruthy();
    expect(view.container.querySelector(".st-head span:nth-child(2)")?.classList.contains("dim")).toBe(false);
  });
});
