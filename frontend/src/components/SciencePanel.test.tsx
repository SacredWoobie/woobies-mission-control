// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flightTelemetryFixture } from "../telemetry/fixtures";
import type { ScienceLabTelemetry, TelemetryCommand, TelemetrySnapshot } from "../telemetry/types";
import { SciencePanel } from "./SciencePanel";
import { PanelVisibilityProvider } from "./PanelVisibility";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => localStorage.clear());

function renderPanel(snapshot: TelemetrySnapshot) {
  return render(<PanelVisibilityProvider><SciencePanel snapshot={snapshot} /></PanelVisibilityProvider>);
}

describe("SciencePanel", () => {
  it("uses the Electricity-style overview and accessible lab meters", () => {
    const { container } = renderPanel(flightTelemetryFixture);

    expect(screen.getByText("42.7", { exact: true })).toBeTruthy();
    expect(screen.getByText("3 experiments · 19.4 by transmit", { exact: true })).toBeTruthy();
    expect(screen.getByText("RESEARCHING", { exact: true })).toBeTruthy();
    expect(screen.getByText("53.0", { exact: true })).toBeTruthy();
    expect(screen.getByText("full in 9d 4h", { exact: true })).toBeTruthy();
    expect(container.querySelector('[role="meter"][aria-label*="data 97% full"]')).toBeTruthy();
    expect(container.querySelector('[role="meter"][aria-label*="science 0% full"]')).toBeTruthy();
  });

  it("shows the cap-blocked guidance only for a full lab", () => {
    const base = flightTelemetryFixture["sci.krpc.labs"]?.[0] as ScienceLabTelemetry;
    renderPanel({
      ...flightTelemetryFixture,
      "sci.krpc.labs": [{
        ...base,
        scienceStored: 500,
        sciencePerDay: 0,
        state: "science-full",
        etaKind: "full",
        etaSeconds: 0,
      }],
    });

    expect(screen.getByText("SCIENCE FULL", { exact: true })).toBeTruthy();
    expect(screen.getByText("transmit science to resume", { exact: true })).toBeTruthy();
    expect(screen.getByText("0.0", { exact: true })).toBeTruthy();
  });

  it("renders multiple labs with stable independent status cards", () => {
    const base = flightTelemetryFixture["sci.krpc.labs"]?.[0] as ScienceLabTelemetry;
    renderPanel({
      ...flightTelemetryFixture,
      "sci.krpc.labCount": 2,
      "sci.krpc.labs": [
        base,
        { ...base, id: "second", title: "MPL-LG-2", state: "no-data", etaKind: "no-data", dataStored: 0, sciencePerDay: 0 },
      ],
    });

    expect(screen.getByText("NO DATA", { exact: true })).toBeTruthy();
    expect(screen.getAllByText(/sci\/day/)).toHaveLength(2);
    expect(screen.getByLabelText("Science laboratories").children).toHaveLength(2);
  });

  it("does not confuse a legacy DLL with a vessel that has no labs", () => {
    const { rerender } = renderPanel({
      "context.mode": "flight",
      "sci.krpc.total": 0,
      "sci.krpc.count": 0,
    });
    expect(screen.getByText(/service update required/)).toBeTruthy();

    rerender(<PanelVisibilityProvider><SciencePanel snapshot={{
      "context.mode": "flight",
      "sci.krpc.total": 0,
      "sci.krpc.count": 0,
      "sci.krpc.labTelemetryAvailable": true,
      "sci.krpc.labs": [],
    }} /></PanelVisibilityProvider>);
    expect(screen.getByText("No research labs aboard", { exact: true })).toBeTruthy();
  });

  it("preserves fixed experiment-column precision and source metadata", () => {
    renderPanel({
      "context.mode": "flight",
      "sci.krpc.total": 12,
      "sci.krpc.transmitTotal": 7,
      "sci.krpc.count": 1,
      "sci.krpc.labTelemetryAvailable": true,
      "sci.krpc.labs": [],
      "sci.krpc.experiments": [{
        title: "Mystery Goo",
        value: 12,
        transmit: 7,
        data: 4,
        sourcePart: "Goo canister",
      }],
    });

    expect(screen.getByText((_, element) => element?.textContent === "12.0 / 7.0 tx")).toBeTruthy();
    expect(screen.getByText("Goo canister · 4 data", { exact: true })).toBeTruthy();
  });

  it("persists alarm defaults and sends one manual alarm command", () => {
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const { rerender } = render(<PanelVisibilityProvider><SciencePanel commandEnabled onSendCommand={onSendCommand} snapshot={flightTelemetryFixture} /></PanelVisibilityProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Science alarm settings" }));
    const dialog = screen.getByRole("dialog", { name: "Alarm defaults" });
    expect(within(dialog).getByRole("button", { name: "AUTO" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(dialog).getByRole("button", { name: "1 HOUR" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(dialog).getByRole("button", { name: "KILL WARP" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "STOCK" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "30 MIN" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "PAUSE GAME" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "SAVE DEFAULTS" }));

    expect(JSON.parse(localStorage.getItem("wmc-science-alarm-defaults-v1") ?? "null")).toEqual({
      provider: "stock",
      leadSeconds: 1800,
      kacAction: "pause_game",
    });
    fireEvent.click(screen.getByRole("button", { name: "SET ALARM" }));
    expect(onSendCommand).toHaveBeenCalledTimes(1);
    expect(onSendCommand.mock.calls[0][0]).toMatchObject({
      type: "science.alarm.create",
      labId: "42001:1",
      provider: "stock",
      leadSeconds: 1800,
      kacAction: "pause_game",
    });
    const sentCommand = onSendCommand.mock.calls[0][0];
    if (sentCommand.type !== "science.alarm.create") throw new Error("Expected a science alarm command.");
    const requestId = sentCommand.requestId;
    rerender(<PanelVisibilityProvider><SciencePanel
      alarmResult={{
        type: "science.alarm.create.result",
        requestId,
        labId: "42001:1",
        status: "accepted",
        message: "Stock alarm set 30 minutes before estimated capacity.",
        provider: "stock",
        triggerUT: 10_000,
        leadSeconds: 1800,
      }}
      commandEnabled
      onSendCommand={onSendCommand}
      snapshot={flightTelemetryFixture}
    /></PanelVisibilityProvider>);
    expect(screen.getByRole("status").textContent).toContain("Stock alarm set");
  });

  it("disables alarm creation when the lab has no finite ETA", () => {
    const base = flightTelemetryFixture["sci.krpc.labs"]?.[0] as ScienceLabTelemetry;
    render(<PanelVisibilityProvider><SciencePanel commandEnabled onSendCommand={() => true} snapshot={{
      ...flightTelemetryFixture,
      "sci.krpc.labs": [{ ...base, etaKind: "stopped", etaSeconds: undefined }],
    }} /></PanelVisibilityProvider>);

    expect(screen.getByRole("button", { name: "SET ALARM" }).hasAttribute("disabled")).toBe(true);
  });

  it("invokes stock Transmit Science for the selected lab and clears feedback", () => {
    vi.useFakeTimers();
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const { rerender } = render(<PanelVisibilityProvider><SciencePanel commandEnabled onSendCommand={onSendCommand} snapshot={flightTelemetryFixture} /></PanelVisibilityProvider>);

    fireEvent.click(screen.getByRole("button", { name: "TRANSMIT SCIENCE" }));
    const sentCommand = onSendCommand.mock.calls[0][0];
    expect(sentCommand).toMatchObject({
      type: "science.lab.transmit",
      labId: "42001:1",
    });
    if (sentCommand.type !== "science.lab.transmit") throw new Error("Expected a science lab transmit command.");

    rerender(<PanelVisibilityProvider><SciencePanel
      commandEnabled
      onSendCommand={onSendCommand}
      snapshot={flightTelemetryFixture}
      transmitResult={{
        type: "science.lab.transmit.result",
        requestId: sentCommand.requestId,
        labId: sentCommand.labId,
        status: "accepted",
        message: "Transmit Science invoked for lab.",
      }}
    /></PanelVisibilityProvider>);
    expect(screen.getByRole("status").textContent).toContain("Transmit Science invoked");
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("disables Transmit Science when the selected lab has no stored science", () => {
    const base = flightTelemetryFixture["sci.krpc.labs"]?.[0] as ScienceLabTelemetry;
    render(<PanelVisibilityProvider><SciencePanel commandEnabled onSendCommand={() => true} snapshot={{
      ...flightTelemetryFixture,
      "sci.krpc.labs": [{ ...base, scienceStored: 0 }],
    }} /></PanelVisibilityProvider>);

    expect(screen.getByRole("button", { name: "TRANSMIT SCIENCE" }).hasAttribute("disabled")).toBe(true);
  });
});
