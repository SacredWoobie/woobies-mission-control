// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inactiveTelemetryFixture } from "../telemetry/fixtures";
import type { TelemetrySnapshot } from "../telemetry/types";
import { TimeSystemProvider } from "../timeSystem";
import { MissionOverview } from "./MissionOverview";
import { PanelVisibilityProvider } from "./PanelVisibility";
import { formatTransferWindowCountdown } from "./TransferWindowsPanel";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderOverview(
  snapshot: TelemetrySnapshot = inactiveTelemetryFixture,
  onSendCommand = vi.fn(() => true),
) {
  return {
    onSendCommand,
    view: render(
      <TimeSystemProvider>
        <PanelVisibilityProvider>
          <MissionOverview commandEnabled onSendCommand={onSendCommand} snapshot={snapshot} />
        </PanelVisibilityProvider>
      </TimeSystemProvider>,
    ),
  };
}

describe("TransferWindowsPanel", () => {
  it("sorts best departures, stays full-width, and omits seconds", () => {
    const { view } = renderOverview();
    const panel = screen.getByRole("heading", { name: "Transfer windows" }).closest("section")!;
    const cards = [...panel.querySelectorAll(".overview-transfer-card")];

    expect(cards.map((card) => card.textContent?.split("BEST")[0])).toEqual([
      expect.stringContaining("Kerbin \u2192 Moho"),
      expect.stringContaining("Kerbin \u2192 Duna"),
      expect.stringContaining("Kerbin \u2192 Dres"),
      expect.stringContaining("Kerbin \u2192 Neidon"),
      expect.stringContaining("Kerbin \u2192 Urlum"),
      expect.stringContaining("Kerbin \u2192 Eve"),
      expect.stringContaining("Kerbin \u2192 Jool"),
      expect.stringContaining("Kerbin \u2192 Plock"),
      expect.stringContaining("Kerbin \u2192 Sarnus"),
    ]);
    expect(panel.parentElement).toBe(view.container.querySelector(".overview-command-grid"));
    expect(panel.parentElement?.parentElement).toBe(view.container.querySelector(".mission-overview"));
    expect(panel.closest(".overview-primary-grid, .overview-side-stack")).toBeNull();
    expect(panel.querySelector(".transfer-window-toolbar")?.parentElement).toBe(panel.querySelector(".transfer-window-body"));
    expect(panel.querySelector(".overview-transfer-grid")?.parentElement).toBe(panel.querySelector(".transfer-window-body"));
    expect(cards.every((card) => card.querySelector(".overview-transfer-origin")?.textContent === "Kerbin \u2192 ")).toBe(true);
    expect(cards.map((card) => card.querySelector(".overview-transfer-destination")?.textContent)).toEqual([
      "Moho",
      "Duna",
      "Dres",
      "Neidon",
      "Urlum",
      "Eve",
      "Jool",
      "Plock",
      "Sarnus",
    ]);
    expect(within(panel).getAllByText(/T\u2212/).every((node) => !/\d{2}:\d{2}:\d{2}/.test(node.textContent ?? ""))).toBe(true);
  });

  it("uses minute resolution with the selected Kerbin or Earth calendar", () => {
    const currentUT = 1_000;
    renderOverview({
      ...inactiveTelemetryFixture,
      "t.universalTime": currentUT,
      "mj.transfer.windows.results": [{ destination: "Duna", departureUT: currentUT + 21_600 }],
    });

    const panel = screen.getByRole("heading", { name: "Transfer windows" }).closest("section")!;
    expect(within(panel).getByText("T\u2212 1d 0h 0m", { exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Time system: Kerbin" }));
    expect(within(panel).getByText("T\u2212 6h 0m", { exact: true })).toBeTruthy();
    expect(formatTransferWindowCountdown(1_059, 1_000, true)).toBe("T\u2212 1m");
    expect(formatTransferWindowCountdown(1_000, 1_000, true)).toBe("NOW");
    expect(formatTransferWindowCountdown(940, 1_000, true)).toBe("1m overdue");
  });

  it("does not invent a countdown when universal time is unavailable", () => {
    renderOverview({
      ...inactiveTelemetryFixture,
      "t.universalTime": undefined,
      "mj.transfer.windows.results": [{ destination: "Duna", departureUT: 10_000_000 }],
    });

    const panel = screen.getByRole("heading", { name: "Transfer windows" }).closest("section")!;
    expect(within(panel).getByText("UNKNOWN", { exact: true })).toBeTruthy();
    expect(within(panel).queryByText(/T\u2212/)).toBeNull();
  });

  it("sends refresh and matching cancel commands", () => {
    const ready: TelemetrySnapshot = {
      ...inactiveTelemetryFixture,
      "mj.transfer.windows.requestId": "",
      "mj.transfer.windows.state": "idle",
      "mj.transfer.windows.results": [],
    };
    const refresh = renderOverview(ready);
    fireEvent.click(screen.getByRole("button", { name: "Calculate windows" }));
    expect(refresh.onSendCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: "mechjeb.transfer.windows.refresh",
      origin: "Kerbin",
      originParkingAltitude: 80_000,
      optimizePoweredCapture: true,
    }));
    cleanup();

    const cancel = renderOverview({
      ...ready,
      "mj.transfer.windows.requestId": "windows-active",
      "mj.transfer.windows.state": "running",
      "mj.transfer.windows.activeDestination": "Duna",
      "mj.transfer.windows.completedCount": 0,
      "mj.transfer.windows.totalCount": 7,
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel refresh" }));
    expect(cancel.onSendCommand).toHaveBeenCalledWith({
      type: "mechjeb.transfer.windows.cancel",
      requestId: "windows-active",
    });
  });
});
