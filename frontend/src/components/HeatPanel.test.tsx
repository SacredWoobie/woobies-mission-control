// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { flightTelemetryFixture } from "../telemetry/fixtures";
import { HeatPanel } from "./HeatPanel";

afterEach(cleanup);

describe("HeatPanel", () => {
  it("ranks SystemHeat loops, uses native units, and auto-expands one critical loop", () => {
    render(<HeatPanel snapshot={{ ...flightTelemetryFixture, "heat.backend": "system_heat" }} />);

    expect(screen.getByText("3 loops")).toBeTruthy();
    expect(screen.getByText("1 CRITICAL")).toBeTruthy();
    expect(screen.getByText("771/800 K")).toBeTruthy();
    expect(screen.getByText("+60.0 kW")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse Loop 1" })).toBeTruthy();
    expect(screen.getByText("Reactor")).toBeTruthy();
    expect(screen.getByText("Drill ×2")).toBeTruthy();
    expect(screen.getByText("Radiator ×4")).toBeTruthy();
    expect(screen.getAllByText("producer").length).toBeGreaterThan(0);
    expect(screen.getByText("radiator")).toBeTruthy();
  });

  it("lets an operator collapse and reopen component detail", () => {
    render(<HeatPanel snapshot={{ ...flightTelemetryFixture, "heat.backend": "system_heat" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Loop 1" }));
    expect(screen.queryByText("Reactor")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand Loop 1" }));
    expect(screen.getByText("Reactor")).toBeTruthy();
  });

  it("uses the limiting stock temperature channel and omits the flux column", () => {
    render(<HeatPanel snapshot={{
      ...flightTelemetryFixture,
      "heat.backend": "stock",
      "heat.parts": [{
        name: "Advanced Nose Cone",
        tempK: 620,
        maxTempK: 2_400,
        skinTempK: 920,
        maxSkinTempK: 1_000,
        utilization: 92,
        netW: 125.4,
      }],
    }} />);

    expect(screen.getByText("1 part")).toBeTruthy();
    expect(screen.getByText("1 CRITICAL")).toBeTruthy();
    expect(screen.getByText("Advanced Nose Cone")).toBeTruthy();
    expect(screen.getByText("920/1,000 K")).toBeTruthy();
    expect(screen.getByText("core 620 K")).toBeTruthy();
    expect(screen.getByText("92%")).toBeTruthy();
    expect(screen.queryByText("125.4 W")).toBeNull();
  });

  it("collapses an idle stock fallback to one nominal line", () => {
    render(<HeatPanel snapshot={{
      ...flightTelemetryFixture,
      "heat.backend": "stock",
      "heat.parts": [
        {
          name: "Ambient fuel tank",
          tempK: 300,
          maxTempK: 2_000,
          skinTempK: 295,
          maxSkinTempK: 2_000,
          utilization: 15,
          netW: 0,
        },
      ],
    }} />);

    expect(screen.getByText("1 part")).toBeTruthy();
    expect(screen.getAllByText("NOMINAL").length).toBeGreaterThan(0);
    expect(screen.getByText("All parts within nominal range")).toBeTruthy();
    expect(screen.queryByText("Ambient fuel tank")).toBeNull();
  });

  it("collapses an all-green stock list even when parts report live heat flux", () => {
    render(<HeatPanel snapshot={{
      ...flightTelemetryFixture,
      "heat.backend": "stock",
      "heat.parts": [
        {
          name: "Radioisotope Thermoelectric Generator",
          tempK: 306,
          maxTempK: 1_200,
          utilization: 26,
          netW: 75,
        },
        {
          name: "Liquid Fuel Tank",
          tempK: 327,
          maxTempK: 2_000,
          utilization: 16,
          netW: -22,
        },
      ],
    }} />);

    expect(screen.getByText("2 parts")).toBeTruthy();
    expect(screen.getByText("All parts within nominal range")).toBeTruthy();
    expect(screen.queryByText("Radioisotope Thermoelectric Generator")).toBeNull();
    expect(screen.queryByText("Liquid Fuel Tank")).toBeNull();
  });

  it("surfaces an explicit missing-radiator condition without inferring it from zero rejection", () => {
    render(<HeatPanel snapshot={{
      ...flightTelemetryFixture,
      "heat.backend": "system_heat",
      "heat.loops": [{
        id: "4",
        tempK: 350,
        nominalTempK: 900,
        genKw: 12,
        remKw: 0,
        netKw: 12,
        hasRadiators: false,
      }],
    }} />);

    expect(screen.getByText("NO RADIATORS")).toBeTruthy();
    expect(screen.getByText("no radiators")).toBeTruthy();
  });

  it("shows an inactive warm loop as HOT rather than CRITICAL", () => {
    render(<HeatPanel snapshot={{
      ...flightTelemetryFixture,
      "heat.backend": "system_heat",
      "heat.loops": [{
        id: "0",
        tempK: 345,
        nominalTempK: 300,
        genKw: 0,
        remKw: 0,
        netKw: 0,
      }],
    }} />);

    expect(screen.getByText("1 HOT")).toBeTruthy();
    expect(screen.queryByText("1 CRITICAL")).toBeNull();
    expect(screen.getByText("steady")).toBeTruthy();
  });

  it("keeps an installed zero-flux integrated radiator out of the missing-radiator state", () => {
    render(<HeatPanel snapshot={{
      ...flightTelemetryFixture,
      "heat.backend": "system_heat",
      "heat.loops": [{
        id: "0",
        tempK: 288,
        nominalTempK: 288,
        genKw: 0,
        remKw: 0,
        netKw: 0,
        hasRadiators: true,
        producers: [{
          name: "MN-1 SNAK Fission Reactor",
          role: "producer",
          count: 1,
          fluxKw: 0,
        }],
        radiators: [{
          name: "MN-1 SNAK Fission Reactor",
          role: "radiator",
          count: 1,
          fluxKw: 0,
        }],
      }],
    }} />);

    expect(screen.queryByText("NO RADIATORS")).toBeNull();
    expect(screen.getByText("1 HOT")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand Loop 0" }));
    expect(screen.getAllByText("MN-1 SNAK Fission Reactor")).toHaveLength(2);
    expect(screen.getByText("radiator")).toBeTruthy();
  });

  it("renders a compact unavailable state when no backend has thermal entities", () => {
    render(<HeatPanel snapshot={{ ...flightTelemetryFixture, "heat.backend": undefined, "heat.loops": [] }} />);
    expect(screen.getByText("THERMAL TELEMETRY")).toBeTruthy();
    expect(screen.getByText("No thermal entities detected.")).toBeTruthy();
  });
});
