// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flightTelemetryFixture } from "../telemetry/fixtures";
import type { TelemetryCommand, TelemetrySnapshot } from "../telemetry/types";
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

function openReactorDetail() {
  fireEvent.click(screen.getByRole("button", { name: "Open reactor detail" }));
  return screen.getByRole("region", { name: "Reactor detail" });
}

describe("ElectricityPanel", () => {
  it("replaces the source ledger with a deliberately expanded reactor detail slot", () => {
    const { container } = renderPanel(flightTelemetryFixture);

    expect(screen.queryByText("By source", { exact: true })).toBeNull();
    const ledger = container.querySelector(".ec-source-ledger") as HTMLDivElement;
    const detail = container.querySelector(".rx-detail-view") as HTMLElement;
    const slot = container.querySelector(".ec-source-slot") as HTMLElement;
    const panel = container.querySelector("#elec") as HTMLElement;
    expect(ledger.hidden).toBe(false);
    expect(detail.hidden).toBe(true);
    expect(panel.classList.contains("reactor-detail-open")).toBe(false);
    expect(within(ledger).getByText("Reactors", { exact: true })).toBeTruthy();
    expect(within(ledger).getByText("RTG", { exact: true })).toBeTruthy();
    expect(within(ledger).getByText("Solar", { exact: true })).toBeTruthy();
    expect(within(ledger).getByText("Other", { exact: true })).toBeTruthy();
    expect([...ledger.querySelectorAll(".ec-source-rate > span:last-child")].map((unit) => unit.textContent)).toEqual([
      "EC/s", "EC/s", "EC/s", "EC/s",
    ]);
    expect(ledger.querySelectorAll(".ec-source-drill")).toHaveLength(4);
    expect(ledger.querySelectorAll(".ec-source-drill.placeholder")).toHaveLength(3);
    expect(screen.getByText("DEGRADED", { exact: true })).toBeTruthy();
    expect(container.querySelector('[role="meter"][aria-label="83% electric charge remaining"]')).toBeTruthy();
    expect(container.querySelector(".ec-charge-fill.healthy")).toBeTruthy();

    const open = screen.getByRole("button", { name: "Open reactor detail" });
    fireEvent.click(open);
    expect(ledger.hidden).toBe(true);
    expect(detail.hidden).toBe(false);
    expect(panel.classList.contains("reactor-detail-open")).toBe(true);
    expect(slot.classList.contains("detail-open")).toBe(true);
    expect(slot.style.height).toBe("");
    const reactorList = screen.getByRole("region", { name: "Reactor list" });
    expect(reactorList.tabIndex).toBe(0);
    expect(reactorList.querySelectorAll(".rx-card")).toHaveLength(2);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to power sources" }));
    expect(screen.queryByRole("button", { name: "Open reactor detail" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to power sources" }));
    expect(ledger.hidden).toBe(false);
    expect(detail.hidden).toBe(true);
    expect(panel.classList.contains("reactor-detail-open")).toBe(false);
    expect(slot.classList.contains("detail-open")).toBe(false);
    expect(document.activeElement).toBe(open);
  });

  it("renders every individual reactor when the source ledger has one aggregate row", () => {
    const baseReactors = flightTelemetryFixture["elec.reactors"] ?? [];
    const snapshot: TelemetrySnapshot = {
      ...flightTelemetryFixture,
      "elec.otherEcPerSec": 0,
      "elec.reactors": [
        ...baseReactors,
        { ...baseReactors[0], name: "Third onboard reactor", partId: 42013 },
      ],
      "rtg.count": 0,
      "rtg.outputEcPerSec": 0,
      "solar.count": 0,
      "solar.outputEcPerSec": 0,
    };
    const { container } = renderPanel(snapshot);

    expect(container.querySelectorAll(".ec-source-row")).toHaveLength(1);
    openReactorDetail();
    expect(screen.getByRole("region", { name: "Reactor list" }).querySelectorAll(".rx-card")).toHaveLength(3);
    expect(screen.getByText("Third onboard reactor")).toBeTruthy();
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
    openReactorDetail();

    expect(screen.getByText("1,499/1,500", { exact: true })).toBeTruthy();
    expect(screen.getByText("2,400 K", { exact: true })).toBeTruthy();
    expect(screen.getByText("100%", { exact: true })).toBeTruthy();
  });

  it("shows legacy fusion fuel rate without fission integrity", () => {
    renderPanel({
      ...flightTelemetryFixture,
      "elec.reactors": [{
        name: "FX-2 Fusion Reactor",
        family: "fusion",
        hasIntegrity: false,
        on: true,
        ecPerSec: 100,
        ecMax: 4_000,
        coreTemp: 1_600,
        nominalTemp: 1_600,
        fuel: "0.00000027 u/s",
        throttle: 2.5,
      }],
    });
    openReactorDetail();

    expect(screen.getByText("FX-2 Fusion Reactor", { exact: true })).toBeTruthy();
    expect(screen.getByText("Throttle", { exact: true })).toBeTruthy();
    expect(screen.getByText("2.5%", { exact: true })).toBeTruthy();
    expect(screen.getByText("Fuel rate", { exact: true })).toBeTruthy();
    expect(screen.getByText("0.00000027 u/s", { exact: true })).toBeTruthy();
    expect(screen.queryByText("Integrity", { exact: true })).toBeNull();
  });

  it("shows fusion fuel life with limiting fuel and rate detail", () => {
    renderPanel({
      ...flightTelemetryFixture,
      "elec.reactors": [{
        name: "FX-2 Fusion Reactor",
        family: "fusion",
        hasIntegrity: false,
        on: true,
        ecPerSec: 4_000,
        coreTemp: 1_600,
        nominalTemp: 1_600,
        fuel: "112y 4d 3h 2m",
        fuelKind: "life",
        fuelRate: "LqdDeuterium 0.0000109 u/s",
        fuelLimitingResource: "LqdDeuterium",
        throttle: 100,
      }],
    });
    openReactorDetail();

    expect(screen.getByText("Life", { exact: true })).toBeTruthy();
    const life = screen.getByText("112y 4d 3h 2m", { exact: true });
    expect(life.getAttribute("title")).toBe(
      "LqdDeuterium limiting · LqdDeuterium 0.0000109 u/s",
    );
    expect(screen.queryByText("Integrity", { exact: true })).toBeNull();
  });

  it("starts fusion charging from off and reports charging progress", () => {
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const snapshot: TelemetrySnapshot = {
      ...flightTelemetryFixture,
      "v.guid": "vessel-guid",
      "elec.reactors": [{
        index: 3,
        partId: 303,
        name: "FX-2 Fusion Reactor",
        family: "fusion",
        hasIntegrity: false,
        on: false,
        chargeState: "off",
        chargePercent: 12.5,
        controlAction: "start_charging",
        controlAvailable: true,
        fuel: "112y",
      }],
    };
    const { rerender } = render(
      <PanelVisibilityProvider>
        <ElectricityPanel commandEnabled onSendCommand={onSendCommand} snapshot={snapshot} />
      </PanelVisibilityProvider>,
    );

    openReactorDetail();
    fireEvent.click(screen.getByRole("button", { name: "Begin startup charging for FX-2 Fusion Reactor" }));
    expect(onSendCommand).toHaveBeenCalledOnce();
    expect(onSendCommand.mock.calls[0][0]).toMatchObject({
      type: "reactor.control",
      index: 3,
      action: "start_charging",
      expectedName: "FX-2 Fusion Reactor",
      expectedFamily: "fusion",
      expectedPartId: 303,
      expectedVesselGuid: "vessel-guid",
    });

    rerender(
      <PanelVisibilityProvider>
        <ElectricityPanel commandEnabled onSendCommand={onSendCommand} snapshot={{
          ...snapshot,
          "elec.reactors": [{
            ...snapshot["elec.reactors"]![0],
            chargeState: "charging",
            chargePercent: 37.5,
            controlAction: "stop_charging",
          }],
        }} />
      </PanelVisibilityProvider>,
    );
    expect(screen.getByRole("button", { name: "Pause startup charging for FX-2 Fusion Reactor" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "37.5% startup charge" }).getAttribute("aria-valuenow")).toBe("37.5");
    expect(screen.getByText("37.5%", { exact: true })).toBeTruthy();
  });

  it("uses ready and running states for fusion ignition and shutdown", () => {
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const base: TelemetrySnapshot = {
      ...flightTelemetryFixture,
      "v.guid": "vessel-guid",
      "elec.reactors": [{
        index: 0,
        partId: 101,
        name: "FX-2 Fusion Reactor",
        family: "fusion",
        hasIntegrity: false,
        on: false,
        chargeState: "ready",
        chargePercent: 100,
        controlAction: "start",
        controlAvailable: true,
        fuel: "112y",
      }],
    };
    const { rerender } = render(
      <PanelVisibilityProvider>
        <ElectricityPanel commandEnabled onSendCommand={onSendCommand} snapshot={base} />
      </PanelVisibilityProvider>,
    );

    openReactorDetail();
    fireEvent.click(screen.getByRole("button", { name: "Start FX-2 Fusion Reactor" }));
    expect(onSendCommand.mock.calls[0][0]).toMatchObject({ action: "start" });

    rerender(
      <PanelVisibilityProvider>
        <ElectricityPanel commandEnabled onSendCommand={onSendCommand} snapshot={{
          ...base,
          "elec.reactors": [{
            ...base["elec.reactors"]![0],
            on: true,
            chargeState: "running",
            chargePercent: 0,
            controlAction: "stop",
          }],
        }} />
      </PanelVisibilityProvider>,
    );
    expect(screen.getByRole("button", { name: "Shut down FX-2 Fusion Reactor" })).toBeTruthy();
  });

  it("turns an offline fission reactor on through the guarded command", () => {
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    render(
      <PanelVisibilityProvider>
        <ElectricityPanel commandEnabled onSendCommand={onSendCommand} snapshot={{
          ...flightTelemetryFixture,
          "v.guid": "vessel-guid",
          "elec.reactors": [{
            index: 1,
            partId: 202,
            name: "MX-1 Fission Reactor",
            family: "fission",
            on: false,
            controlAction: "start",
            controlAvailable: true,
            fuel: "59y",
          }],
        }} />
      </PanelVisibilityProvider>,
    );

    openReactorDetail();
    fireEvent.click(screen.getByRole("button", { name: "Start MX-1 Fission Reactor" }));
    expect(onSendCommand.mock.calls[0][0]).toMatchObject({
      type: "reactor.control",
      index: 1,
      action: "start",
      expectedFamily: "fission",
      expectedPartId: 202,
      expectedVesselGuid: "vessel-guid",
    });
  });

  it("dismisses a reactor control result after five seconds", () => {
    vi.useFakeTimers();
    try {
      const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
      const snapshot: TelemetrySnapshot = {
        ...flightTelemetryFixture,
        "v.guid": "vessel-guid",
        "elec.reactors": [{
          index: 1,
          partId: 202,
          name: "MX-1 Fission Reactor",
          family: "fission",
          on: true,
          controlAction: "stop",
          controlAvailable: true,
          fuel: "59y",
        }],
      };
      const { rerender } = render(
        <PanelVisibilityProvider>
          <ElectricityPanel commandEnabled onSendCommand={onSendCommand} snapshot={snapshot} />
        </PanelVisibilityProvider>,
      );

      openReactorDetail();
      fireEvent.click(screen.getByRole("button", { name: "Shut down MX-1 Fission Reactor" }));
      const request = onSendCommand.mock.calls[0][0];
      if (request.type !== "reactor.control") throw new Error("Expected a reactor command.");
      rerender(
        <PanelVisibilityProvider>
          <ElectricityPanel
            commandEnabled
            controlResult={{
              type: "reactor.control.result",
              requestId: request.requestId,
              index: request.index,
              action: request.action,
              status: "accepted",
              message: "Reactor shutdown accepted.",
            }}
            onSendCommand={onSendCommand}
            snapshot={snapshot}
          />
        </PanelVisibilityProvider>,
      );

      expect(screen.getByText("Reactor shutdown accepted.")).toBeTruthy();
      act(() => vi.advanceTimersByTime(4_999));
      expect(screen.getByText("Reactor shutdown accepted.")).toBeTruthy();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByText("Reactor shutdown accepted.")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
