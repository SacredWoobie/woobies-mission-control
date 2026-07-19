// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { inactiveTelemetryFixture } from "../telemetry/fixtures";
import type { TelemetrySnapshot } from "../telemetry/types";
import { MissionOverview } from "./MissionOverview";
import { PanelVisibilityProvider } from "./PanelVisibility";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderOverview(snapshot: TelemetrySnapshot = inactiveTelemetryFixture) {
  return render(<PanelVisibilityProvider><MissionOverview snapshot={snapshot} /></PanelVisibilityProvider>);
}

describe("MissionOverview", () => {
  it("filters and sorts the read-only fleet and roster", () => {
    renderOverview();

    expect(screen.queryByText("READ ONLY", { exact: true })).toBeNull();
    expect(screen.getByText("1,284,650", { exact: true })).toBeTruthy();
    expect(screen.queryByText("KSC Flag", { exact: true })).toBeNull();
    const craftTypes = screen.getByRole("group", { name: "Craft type filters" });
    const expectedTypes = ["Debris", "Probe", "Rover", "Lander", "Ship", "Station", "Base", "Plane", "Relay"];
    expect(within(craftTypes).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Enable all craft types",
      ...expectedTypes.map((type) => `${type} craft type filter`),
    ]);
    for (const type of expectedTypes) {
      expect(within(craftTypes).getByRole("button", { name: `${type} craft type filter` })).toBeTruthy();
    }
    expect(within(craftTypes).queryByRole("button", { name: "EVA craft type filter" })).toBeNull();
    expect(within(craftTypes).queryByRole("button", { name: "Space Object craft type filter" })).toBeNull();
    expect(screen.getByRole("button", { name: "Debris craft type filter" }).getAttribute("aria-pressed")).toBe("false");
    const fleet = screen.getByRole("heading", { name: "Active vessels" }).closest("section")!;
    expect(within(fleet).queryByText("Jebediah Kerman", { exact: true })).toBeNull();

    fireEvent.change(screen.getByLabelText("SOI"), { target: { value: "Mun" } });
    expect(screen.getByText("Mun Surveyor", { exact: true })).toBeTruthy();
    expect(screen.queryByText("Odyssey", { exact: true })).toBeNull();

    fireEvent.change(screen.getByLabelText("SOI"), { target: { value: "all" } });
    const probeFilter = screen.getByRole("button", { name: "Probe craft type filter" });
    const relayFilter = screen.getByRole("button", { name: "Relay craft type filter" });
    expect(probeFilter.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(probeFilter);
    fireEvent.click(relayFilter);
    expect(screen.queryByText("Mun Surveyor", { exact: true })).toBeNull();
    expect(screen.queryByText("Duna Relay 1", { exact: true })).toBeNull();
    expect(screen.getByText("Odyssey", { exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enable all craft types" }));
    expect(screen.getByText("Mun Surveyor", { exact: true })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Roster status"), { target: { value: "Dead" } });
    const roster = screen.getByRole("heading", { name: "Astronaut roster" }).closest("section")!;
    expect(within(roster).getByText("Valentina Kerman", { exact: false })).toBeTruthy();
    expect(within(roster).getByLabelText("Fallen Kerbonaut")).toBeTruthy();
    expect(within(roster).queryByText("Bill Kerman", { exact: true })).toBeNull();
  });

  it("keeps all nine craft-type controls available at a zero count", () => {
    renderOverview({
      ...inactiveTelemetryFixture,
      "overview.vessels": inactiveTelemetryFixture["overview.vessels"]?.filter((row) => row.type !== "Base"),
    });

    const baseFilter = screen.getByRole("button", { name: "Base craft type filter" });
    expect(within(baseFilter).getByText("0", { exact: true })).toBeTruthy();
  });

  it("keeps stock and KAC alarms together and source-filterable", () => {
    renderOverview({
      ...inactiveTelemetryFixture,
      "overview.alarms": [
        ...(inactiveTelemetryFixture["overview.alarms"] ?? []),
        { title: "Alarm", type: "Raw", time: 9_540_000, source: "KAC", vessel: "" },
      ],
    });
    const alarms = screen.getByRole("heading", { name: "Upcoming alarms" }).closest("section")!;

    expect(within(alarms).getAllByText("Stock", { exact: true }).length).toBeGreaterThan(0);
    expect(within(alarms).getAllByText("KAC", { exact: true }).length).toBeGreaterThan(0);
    expect(within(alarms).getByText("Date / Time", { exact: true })).toBeTruthy();
    expect(within(alarms).queryByText("Raw", { exact: true })).toBeNull();
    fireEvent.change(within(alarms).getByLabelText("Alarm source"), { target: { value: "KAC" } });
    expect(within(alarms).getByText("Mun Surveyor SOI change", { exact: true })).toBeTruthy();
    expect(within(alarms).queryByText("Odyssey maneuver", { exact: true })).toBeNull();
  });

  it("shows only save-mode-relevant program fields", () => {
    const scienceSave: TelemetrySnapshot = {
      ...inactiveTelemetryFixture,
      "overview.gameMode": "Science Sandbox",
      "overview.capabilities": { funds: false, science: true, reputation: false, contracts: false },
    };
    renderOverview(scienceSave);

    expect(screen.getByText("Science", { exact: true })).toBeTruthy();
    expect(screen.queryByText("Funds", { exact: true })).toBeNull();
    expect(screen.queryByText("Reputation", { exact: true })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Active contracts" })).toBeNull();
    expect(document.querySelector(".overview-secondary-grid")?.className).toBe("overview-secondary-grid");
  });

  it("collapses and restores the three optional overview panels with instrument icons", () => {
    const view = renderOverview();
    expect(screen.getByRole("heading", { name: "Woobie's Mission Control" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide Active vessels panel" }));
    expect(screen.queryByRole("heading", { name: "Active vessels" })).toBeNull();
    const fleetRestore = screen.getByRole("button", { name: "Active vessels" });
    expect(fleetRestore.querySelector(".panel-rail-icon-overviewFleet")).toBeTruthy();
    expect(view.container.querySelector(".overview-primary-grid")?.className).toContain("single");
    fireEvent.click(fleetRestore);
    expect(screen.getByRole("heading", { name: "Active vessels" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide Astronaut roster panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide Upcoming alarms panel" }));
    expect(screen.queryByRole("heading", { name: "Astronaut roster" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Upcoming alarms" })).toBeNull();
    expect(screen.getByRole("button", { name: "Astronaut roster" }).querySelector(".panel-rail-icon-overviewRoster")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upcoming alarms" }).querySelector(".panel-rail-icon-overviewAlarms")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Active contracts" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Woobie's Mission Control" })).toBeTruthy();
  });
});
