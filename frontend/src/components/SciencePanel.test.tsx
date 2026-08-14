// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flightTelemetryFixture } from "../telemetry/fixtures";
import type { ScienceLabTelemetry, TelemetryCommand, TelemetrySnapshot } from "../telemetry/types";
import { SettingsProvider, useSettings } from "../settings";
import { SciencePanel } from "./SciencePanel";
import { PanelVisibilityProvider } from "./PanelVisibility";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => localStorage.clear());

function renderPanel(snapshot: TelemetrySnapshot) {
  return render(<SettingsProvider><PanelVisibilityProvider><SciencePanel snapshot={snapshot} /></PanelVisibilityProvider></SettingsProvider>);
}

function SettingsStateProbe() {
  const settings = useSettings();
  return <output data-testid="settings-state">{settings.open ? settings.section : "closed"}</output>;
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

  it("replaces lab data with experiment detail without changing the content-slot height", () => {
    const { container } = renderPanel(flightTelemetryFixture);
    const baseline = container.querySelector(".sci-baseline-view") as HTMLDivElement;
    const detail = container.querySelector(".sci-experiment-view") as HTMLElement;
    const slot = container.querySelector(".sci-content-slot") as HTMLElement;
    const open = screen.getByRole("button", { name: "Open experiment detail" });

    expect(open.closest(".sci-banked")).toBeTruthy();
    expect(container.querySelector(".sci-details")).toBeNull();
    expect(baseline.hidden).toBe(false);
    expect(detail.hidden).toBe(true);
    expect(screen.getByLabelText("Science laboratories")).toBeTruthy();
    vi.spyOn(baseline, "getBoundingClientRect").mockReturnValue({ height: 214 } as DOMRect);

    fireEvent.click(open);
    expect(baseline.hidden).toBe(true);
    expect(detail.hidden).toBe(false);
    expect(slot.style.height).toBe("214px");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to lab data" }));

    fireEvent.click(screen.getByRole("button", { name: "Back to lab data" }));
    expect(baseline.hidden).toBe(false);
    expect(detail.hidden).toBe(true);
    expect(slot.style.height).toBe("");
    expect(document.activeElement).toBe(open);
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

  it("distinguishes a legacy DLL but omits a known-empty lab section", () => {
    const { rerender } = renderPanel({
      "context.mode": "flight",
      "sci.krpc.total": 0,
      "sci.krpc.count": 0,
    });
    expect(screen.getByText(/service update required/)).toBeTruthy();

    rerender(<SettingsProvider><PanelVisibilityProvider><SciencePanel snapshot={{
      "context.mode": "flight",
      "sci.krpc.total": 0,
      "sci.krpc.count": 0,
      "sci.krpc.labTelemetryAvailable": true,
      "sci.krpc.labs": [],
    }} /></PanelVisibilityProvider></SettingsProvider>);
    expect(screen.queryByText("No research labs aboard", { exact: true })).toBeNull();
    expect(screen.queryByLabelText("Science laboratories")).toBeNull();
    expect(screen.getByText("Recoverable", { exact: true })).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: "Open experiment detail" }));
    expect(screen.getByText((_, element) => element?.textContent === "12.0 / 7.0 tx")).toBeTruthy();
    expect(screen.getByText("Goo canister · 4 data", { exact: true })).toBeTruthy();
  });

  it("uses shared alarm defaults, deep-links Settings, and sends one manual alarm command", () => {
    localStorage.setItem("wmc-science-alarm-defaults-v1", JSON.stringify({
      provider: "stock",
      leadSeconds: 1800,
      kacAction: "pause_game",
    }));
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const { rerender } = render(<SettingsProvider><PanelVisibilityProvider><SciencePanel commandEnabled onSendCommand={onSendCommand} snapshot={flightTelemetryFixture} /></PanelVisibilityProvider><SettingsStateProbe /></SettingsProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Science alarm settings" }));
    expect(screen.getByTestId("settings-state").textContent).toBe("science-alarms");
    expect(screen.queryByRole("dialog", { name: "Alarm defaults" })).toBeNull();
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
    rerender(<SettingsProvider><PanelVisibilityProvider><SciencePanel
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
    /></PanelVisibilityProvider><SettingsStateProbe /></SettingsProvider>);
    expect(screen.getByText("Stock alarm set 30 minutes before estimated capacity.", { exact: true })).toBeTruthy();
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

  it("requires more than one stored science before enabling stock transmission", () => {
    const base = flightTelemetryFixture["sci.krpc.labs"]?.[0] as ScienceLabTelemetry;
    render(<PanelVisibilityProvider><SciencePanel commandEnabled onSendCommand={() => true} snapshot={{
      ...flightTelemetryFixture,
      "sci.krpc.labs": [{ ...base, scienceStored: 0.3 }],
    }} /></PanelVisibilityProvider>);

    expect(screen.getByRole("button", { name: "NEED MORE SCIENCE" }).hasAttribute("disabled")).toBe(true);
  });

  it("uses one context-aware stock research button with an explicit desired state", () => {
    const base = flightTelemetryFixture["sci.krpc.labs"]?.[0] as ScienceLabTelemetry;
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const { unmount } = render(<PanelVisibilityProvider><SciencePanel commandEnabled onSendCommand={onSendCommand} snapshot={flightTelemetryFixture} /></PanelVisibilityProvider>);

    fireEvent.click(screen.getByRole("button", { name: "STOP RESEARCH" }));
    expect(onSendCommand.mock.calls[0][0]).toMatchObject({
      type: "science.lab.research",
      labId: "42001:1",
      enabled: false,
    });
    unmount();

    render(<PanelVisibilityProvider><SciencePanel commandEnabled onSendCommand={onSendCommand} snapshot={{
      ...flightTelemetryFixture,
      "sci.krpc.labs": [{ ...base, researchEnabled: false, state: "stopped", sciencePerDay: 0 }],
    }} /></PanelVisibilityProvider>);
    fireEvent.click(screen.getByRole("button", { name: "START RESEARCH" }));
    expect(onSendCommand.mock.calls[1][0]).toMatchObject({
      type: "science.lab.research",
      labId: "42001:1",
      enabled: true,
    });
  });
});
