// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SCIENCE_ALARM_SETTINGS,
  SCIENCE_ALARM_SETTINGS_KEY,
  SettingsProvider,
  normalizeScienceAlarmSettings,
  useSettings,
} from "./state";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function Harness() {
  const settings = useSettings();
  return <>
    <output data-testid="open">{String(settings.open)}</output>
    <output data-testid="section">{settings.section}</output>
    <output data-testid="alarm">{JSON.stringify(settings.scienceAlarmSettings)}</output>
    <button onClick={() => settings.openSettings("science-alarms")} type="button">Open alarms</button>
    <button onClick={() => settings.updateScienceAlarmSettings({ provider: "stock", leadSeconds: 1800, kacAction: "pause_game" })} type="button">Set alarm</button>
    <button onClick={settings.closeSettings} type="button">Close</button>
  </>;
}

describe("settings state", () => {
  it("normalizes malformed or partial science alarm storage to the exact defaults", () => {
    expect(normalizeScienceAlarmSettings({ provider: "bogus", leadSeconds: 999, kacAction: "bogus" })).toEqual(DEFAULT_SCIENCE_ALARM_SETTINGS);
    expect(normalizeScienceAlarmSettings({ provider: "stock", leadSeconds: 1800, kacAction: "message_only" })).toEqual({
      provider: "stock",
      leadSeconds: 1800,
      kacAction: "message_only",
    });
  });

  it("keeps the section session-local and persists alarm updates immediately", () => {
    render(<SettingsProvider><Harness /></SettingsProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Open alarms" }));
    expect(screen.getByTestId("open").textContent).toBe("true");
    expect(screen.getByTestId("section").textContent).toBe("science-alarms");

    fireEvent.click(screen.getByRole("button", { name: "Set alarm" }));
    expect(JSON.parse(localStorage.getItem(SCIENCE_ALARM_SETTINGS_KEY) ?? "null")).toEqual({
      provider: "stock",
      leadSeconds: 1800,
      kacAction: "pause_game",
    });
    expect(screen.getByTestId("alarm").textContent).toContain('"provider":"stock"');

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByTestId("open").textContent).toBe("false");
    expect(screen.getByTestId("section").textContent).toBe("science-alarms");
  });

  it("falls back safely when local storage contains invalid JSON", () => {
    localStorage.setItem(SCIENCE_ALARM_SETTINGS_KEY, "{not-json");
    render(<SettingsProvider><Harness /></SettingsProvider>);
    expect(screen.getByTestId("alarm").textContent).toBe(JSON.stringify(DEFAULT_SCIENCE_ALARM_SETTINGS));
  });

  it("does not throw when browser storage is unavailable", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    render(<SettingsProvider><Harness /></SettingsProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Set alarm" }));
    expect(screen.getByTestId("alarm").textContent).toContain('"provider":"stock"');
    setItem.mockRestore();
  });
});
