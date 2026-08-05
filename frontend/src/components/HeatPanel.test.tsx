// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flightTelemetryFixture } from "../telemetry/fixtures";
import type { HeatLoopControlResult, TelemetryCommand } from "../telemetry/types";
import { HeatPanel } from "./HeatPanel";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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

  it("shows an inactive settled loop as NOMINAL", () => {
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

    expect(screen.getAllByText("NOMINAL")).toHaveLength(2);
    expect(screen.queryByText("1 HOT")).toBeNull();
    expect(screen.queryByText("1 CRITICAL")).toBeNull();
    expect(screen.getByText("All loops within nominal range")).toBeTruthy();
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
    expect(screen.getAllByText("NOMINAL")).toHaveLength(2);
    expect(screen.queryByText("1 HOT")).toBeNull();
  });

  it("sends a guarded stop command when every loop radiator is online", () => {
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    render(<HeatPanel commandEnabled onSendCommand={onSendCommand} snapshot={{
      ...flightTelemetryFixture,
      "heat.backend": "system_heat",
      "heat.loops": [{
        id: "17",
        tempK: 300,
        nominalTempK: 800,
        netKw: 0,
        radiatorCount: 2,
        radiatorPartIds: [902, 411],
        radiatorState: "online",
        radiatorControlAction: "stop",
        radiatorControlAvailable: true,
      }],
    }} />);

    fireEvent.click(screen.getByRole("button", { name: "Deactivate and retract all radiators in Loop 17" }));
    expect(onSendCommand).toHaveBeenCalledOnce();
    expect(onSendCommand.mock.calls[0][0]).toMatchObject({
      type: "heat.loop.control",
      loopId: 17,
      action: "stop",
      expectedVesselGuid: flightTelemetryFixture["v.guid"],
      expectedRadiatorPartIds: [902, 411],
    });
    expect(screen.getByText("APPLYING")).toBeTruthy();
  });

  it("offers activation for a partial loop and disables transitional controls", () => {
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const view = render(<HeatPanel commandEnabled onSendCommand={onSendCommand} snapshot={{
      ...flightTelemetryFixture,
      "heat.backend": "system_heat",
      "heat.loops": [{
        id: "3",
        tempK: 300,
        nominalTempK: 800,
        netKw: 0,
        radiatorPartIds: [8, 9],
        radiatorState: "partial",
        radiatorControlAction: "start",
        radiatorControlAvailable: true,
      }],
    }} />);

    fireEvent.click(screen.getByRole("button", { name: "Activate and extend all radiators in Loop 3" }));
    expect(onSendCommand.mock.calls[0][0]).toMatchObject({ action: "start", loopId: 3 });

    view.rerender(<HeatPanel commandEnabled onSendCommand={onSendCommand} snapshot={{
      ...flightTelemetryFixture,
      "heat.backend": "system_heat",
      "heat.loops": [{
        id: "4",
        tempK: 300,
        nominalTempK: 800,
        netKw: 0,
        radiatorPartIds: [10],
        radiatorState: "deploying",
        radiatorControlAvailable: false,
      }],
    }} />);
    expect((screen.getByRole("button", { name: "Loop 4 radiators are deploying" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("labels active radiators without a shutdown action as non-retractable", () => {
    render(<HeatPanel commandEnabled onSendCommand={vi.fn()} snapshot={{
      ...flightTelemetryFixture,
      "heat.backend": "system_heat",
      "heat.loops": [{
        id: "0",
        tempK: 300,
        nominalTempK: 800,
        netKw: -500,
        radiatorPartIds: [8, 9],
        radiatorState: "online",
        radiatorControlAvailable: false,
      }],
    }} />);

    const control = screen.getByRole("button", { name: "Loop 0 radiators are active and cannot be retracted" });
    expect(control.textContent).toBe("NON-RETRACTABLE");
    expect((control as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps older services and stock fallback display-only", () => {
    const view = render(<HeatPanel commandEnabled onSendCommand={vi.fn()} snapshot={{
      ...flightTelemetryFixture,
      "heat.backend": "system_heat",
      "heat.loops": [{ id: "0", tempK: 400, nominalTempK: 800, netKw: 0.1 }],
    }} />);
    expect(screen.queryByText("ACTIVATE")).toBeNull();
    expect(screen.queryByText("DEACTIVATE")).toBeNull();

    view.rerender(<HeatPanel commandEnabled onSendCommand={vi.fn()} snapshot={{
      ...flightTelemetryFixture,
      "heat.backend": "stock",
      "heat.parts": [{ name: "Radiator panel", tempK: 300, maxTempK: 1_200, utilization: 25 }],
    }} />);
    expect(screen.queryByText("ACTIVATE")).toBeNull();
    expect(screen.queryByText("DEACTIVATE")).toBeNull();
  });

  it("clears a pending command when its loop disappears", () => {
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const controllableSnapshot = {
      ...flightTelemetryFixture,
      "heat.backend": "system_heat" as const,
      "heat.loops": [{
        id: "6",
        tempK: 300,
        nominalTempK: 800,
        netKw: 0,
        radiatorPartIds: [606],
        radiatorState: "offline" as const,
        radiatorControlAction: "start" as const,
        radiatorControlAvailable: true,
      }],
    };
    const view = render(<HeatPanel commandEnabled onSendCommand={onSendCommand} snapshot={controllableSnapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "Activate and extend all radiators in Loop 6" }));
    expect(screen.getByText("APPLYING")).toBeTruthy();

    view.rerender(<HeatPanel commandEnabled onSendCommand={onSendCommand} snapshot={{
      ...flightTelemetryFixture,
      "heat.backend": "stock",
      "heat.loops": [],
      "heat.parts": [{ name: "Radiator panel", tempK: 300, maxTempK: 1_200, utilization: 25 }],
    }} />);
    view.rerender(<HeatPanel commandEnabled onSendCommand={onSendCommand} snapshot={controllableSnapshot} />);

    expect(screen.getByText("ACTIVATE")).toBeTruthy();
    expect(screen.queryByText("APPLYING")).toBeNull();
  });

  it("removes a loop command result after five seconds", () => {
    vi.useFakeTimers();
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const snapshot = {
      ...flightTelemetryFixture,
      "heat.backend": "system_heat" as const,
      "heat.loops": [{
        id: "1",
        tempK: 300,
        nominalTempK: 800,
        netKw: 0,
        radiatorPartIds: [55],
        radiatorState: "offline" as const,
        radiatorControlAction: "start" as const,
        radiatorControlAvailable: true,
      }],
    };
    const view = render(<HeatPanel commandEnabled onSendCommand={onSendCommand} snapshot={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "Activate and extend all radiators in Loop 1" }));
    const command = onSendCommand.mock.calls[0][0];
    if (command.type !== "heat.loop.control") throw new Error("Expected a heat loop control command.");
    const requestId = command.requestId;
    const result: HeatLoopControlResult = {
      type: "heat.loop.control.result",
      requestId,
      loopId: 1,
      action: "start",
      status: "accepted",
      message: "Radiators are extending and activating.",
    };
    view.rerender(<HeatPanel commandEnabled controlResult={result} onSendCommand={onSendCommand} snapshot={snapshot} />);

    expect(screen.getByText(result.message)).toBeTruthy();
    act(() => vi.advanceTimersByTime(4_999));
    expect(screen.getByText(result.message)).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText(result.message)).toBeNull();
  });

  it("renders a compact unavailable state when no backend has thermal entities", () => {
    render(<HeatPanel snapshot={{ ...flightTelemetryFixture, "heat.backend": undefined, "heat.loops": [] }} />);
    expect(screen.getByText("THERMAL TELEMETRY")).toBeTruthy();
    expect(screen.getByText("No thermal entities detected.")).toBeTruthy();
  });
});
