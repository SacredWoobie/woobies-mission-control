// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  editorTelemetryFixture,
  flightTelemetryFixture,
} from "../telemetry/fixtures";
import type { TelemetrySnapshot } from "../telemetry/types";
import { StagingPanel } from "./StagingPanel";

afterEach(cleanup);

describe("StagingPanel", () => {
  it("shows both Flight delta-v conditions and only powered stages", () => {
    const { container } = render(<StagingPanel snapshot={flightTelemetryFixture} />);

    expect(screen.getByText("Total Δv · vacuum")).toBeTruthy();
    expect(screen.getByText("Δv current")).toBeTruthy();
    expect(screen.getByText("Δv vac")).toBeTruthy();
    expect(screen.getByText("TWR · Kerbin")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "CURRENT" })).toBeNull();
    expect(screen.queryByRole("button", { name: "VACUUM" })).toBeNull();
    expect(screen.getByText("S0")).toBeTruthy();
    expect(screen.getByText("S2")).toBeTruthy();
    expect(screen.queryByText("S1")).toBeNull();
    expect(screen.getByText("1 unpowered stage hidden")).toBeTruthy();
    expect(container.querySelector(".st-row.cur .sname")?.textContent).toBe("S2");
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
    expect(container.querySelector(".stage-table.editor")).toBeTruthy();
    expect(container.querySelector(".flight-stage-hero")).toBeNull();
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
