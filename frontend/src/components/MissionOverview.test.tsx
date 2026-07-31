// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inactiveTelemetryFixture } from "../telemetry/fixtures";
import type { TelemetryCommand, TelemetrySnapshot } from "../telemetry/types";
import { MissionOverview } from "./MissionOverview";
import { PanelVisibilityProvider } from "./PanelVisibility";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  localStorage.clear();
});

function renderOverview(snapshot: TelemetrySnapshot = inactiveTelemetryFixture) {
  return render(<PanelVisibilityProvider><MissionOverview snapshot={snapshot} /></PanelVisibilityProvider>);
}

describe("MissionOverview", () => {
  it("filters and sorts the fleet and roster", () => {
    renderOverview();

    expect(screen.queryByText("READ ONLY", { exact: true })).toBeNull();
    expect(screen.getByText("1,284,650", { exact: true })).toBeTruthy();
    expect(screen.queryByText("KSC Flag", { exact: true })).toBeNull();
    expect(screen.queryByRole("group", { name: "Craft type filters" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filters 1" }));
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
    expect(within(fleet).getAllByText("Mun Surveyor", { exact: true }).length).toBeGreaterThan(0);
    expect(within(fleet).queryByText("Odyssey", { exact: true })).toBeNull();

    fireEvent.change(screen.getByLabelText("SOI"), { target: { value: "all" } });
    const probeFilter = screen.getByRole("button", { name: "Probe craft type filter" });
    const relayFilter = screen.getByRole("button", { name: "Relay craft type filter" });
    expect(probeFilter.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(probeFilter);
    fireEvent.click(relayFilter);
    expect(within(fleet).queryByText("Mun Surveyor", { exact: true })).toBeNull();
    expect(within(fleet).queryByText("Duna Relay 1", { exact: true })).toBeNull();
    expect(within(fleet).getByText("Odyssey", { exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enable all craft types" }));
    expect(within(fleet).getAllByText("Mun Surveyor", { exact: true }).length).toBeGreaterThan(0);

    const roster = screen.getByRole("heading", { name: "Astronaut roster" }).closest("section")!;
    expect(within(roster).queryByLabelText("Roster status")).toBeNull();
    fireEvent.click(within(roster).getByRole("button", { name: "Roster filters" }));
    fireEvent.change(within(roster).getByLabelText("Roster status"), { target: { value: "Dead" } });
    expect(within(roster).getByText("Valentina Kerman", { exact: true })).toBeTruthy();
    expect(within(roster).getByLabelText("Fallen Kerbonaut")).toBeTruthy();
    expect(within(roster).queryByText("Bill Kerman", { exact: true })).toBeNull();
  });

  it("keeps all nine craft-type controls available at a zero count", () => {
    renderOverview({
      ...inactiveTelemetryFixture,
      "overview.vessels": inactiveTelemetryFixture["overview.vessels"]?.filter((row) => row.type !== "Base"),
    });

    fireEvent.click(screen.getByRole("button", { name: "Filters 1" }));
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
    const roster = screen.getByRole("heading", { name: "Astronaut roster" }).closest("section")!;

    expect(within(alarms).getAllByText("Stock", { exact: true }).length).toBeGreaterThan(0);
    expect(within(alarms).getAllByText("KAC", { exact: true }).length).toBeGreaterThan(0);
    expect(within(alarms).queryByText("Date / Time", { exact: true })).toBeNull();
    expect(within(alarms).queryByText("Raw", { exact: true })).toBeNull();
    expect(within(alarms).getByText("Maneuver", { exact: true }).classList.contains("overview-alarm-type")).toBe(true);
    expect(within(alarms).getByText("SOI Change", { exact: true }).classList.contains("overview-alarm-type")).toBe(true);
    expect(within(alarms).getByRole("group", { name: "Alarm source" })).toBeTruthy();
    fireEvent.click(within(alarms).getByRole("button", { name: "Show KAC alarms" }));
    expect(within(alarms).getByText("Mun Surveyor SOI change", { exact: true })).toBeTruthy();
    expect(within(alarms).queryByText("Odyssey maneuver", { exact: true })).toBeNull();
    expect(within(alarms).getByRole("button", { name: "Show KAC alarms" }).getAttribute("aria-pressed")).toBe("true");
    expect(alarms.parentElement).toBe(roster.parentElement);
    expect(alarms.parentElement?.classList.contains("overview-data-grid")).toBe(true);
  });

  it("hides alarm source controls when no KAC alarm is registered", () => {
    renderOverview({
      ...inactiveTelemetryFixture,
      "overview.alarms": (inactiveTelemetryFixture["overview.alarms"] ?? []).filter((row) => row.source !== "KAC"),
    });

    const alarms = screen.getByRole("heading", { name: "Upcoming alarms" }).closest("section")!;
    expect(within(alarms).queryByRole("group", { name: "Alarm source" })).toBeNull();
    expect(within(alarms).queryByLabelText("Alarm source")).toBeNull();
    expect(within(alarms).getByText("Odyssey maneuver", { exact: true })).toBeTruthy();
  });

  it("hides alarm source controls when KAC is the only populated source", () => {
    renderOverview({
      ...inactiveTelemetryFixture,
      "overview.alarms": (inactiveTelemetryFixture["overview.alarms"] ?? []).filter((row) => row.source === "KAC"),
    });

    const alarms = screen.getByRole("heading", { name: "Upcoming alarms" }).closest("section")!;
    expect(within(alarms).queryByRole("group", { name: "Alarm source" })).toBeNull();
    expect(within(alarms).getByText("Mun Surveyor SOI change", { exact: true })).toBeTruthy();
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
    expect(document.querySelector(".overview-data-grid")).toBeTruthy();
  });

  it("shows useful contract completion rewards instead of internal contract types", () => {
    renderOverview();
    const contracts = screen.getByRole("heading", { name: "Active contracts" }).closest("section")!;

    expect(within(contracts).queryByText("Exploration", { exact: true })).toBeNull();
    expect(within(contracts).queryByText("Satellite", { exact: true })).toBeNull();
    expect(within(contracts).getAllByRole("generic", { name: "Completion rewards" })).toHaveLength(3);
    expect(within(contracts).getByText("+185,000", { exact: true })).toBeTruthy();
    expect(within(contracts).getByText("+22", { exact: true })).toBeTruthy();
    expect(within(contracts).getByText("+8", { exact: true })).toBeTruthy();
  });

  it("collapses true zero-state alarm and contract bodies", () => {
    renderOverview({
      ...inactiveTelemetryFixture,
      "overview.alarms": [],
      "overview.contracts": [],
    });
    const alarms = screen.getByRole("heading", { name: "Upcoming alarms" }).closest("section")!;
    const contracts = screen.getByRole("heading", { name: "Active contracts" }).closest("section")!;

    expect(within(alarms).getByText("0", { exact: true })).toBeTruthy();
    expect(within(contracts).getByText("0", { exact: true })).toBeTruthy();
    expect(alarms.querySelector(".overview-card-list")).toBeNull();
    expect(contracts.querySelector(".overview-card-list")).toBeNull();
    expect(within(alarms).queryByText("No upcoming alarms.", { exact: true })).toBeNull();
    expect(within(contracts).queryByText("No active contracts.", { exact: true })).toBeNull();
  });

  it("leaves a missing contract deadline silent", () => {
    renderOverview({
      ...inactiveTelemetryFixture,
      "overview.contracts": [{ title: "Evergreen relay coverage", type: "Satellite", deadline: null, fundsCompletion: 12_000 }],
    });
    const contracts = screen.getByRole("heading", { name: "Active contracts" }).closest("section")!;

    expect(within(contracts).getByText("Evergreen relay coverage", { exact: true })).toBeTruthy();
    expect(within(contracts).queryByText("NO DEADLINE", { exact: true })).toBeNull();
    expect(contracts.querySelector(".overview-contract-time")).toBeNull();
  });

  it("keeps populated Career panels as equal-width data-grid peers", () => {
    renderOverview();
    const dataGrid = document.querySelector(".overview-data-grid")!;
    const panelClasses = [...dataGrid.children].map((panel) => panel.className);

    expect(panelClasses).toEqual([
      expect.stringContaining("overview-fleet"),
      expect.stringContaining("overview-roster"),
      expect.stringContaining("overview-alarms"),
      expect.stringContaining("overview-contracts"),
    ]);
    expect(document.querySelector(".overview-side-stack")).toBeNull();
    expect(document.querySelector(".overview-section-head > div:first-child > span")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Select / }).length).toBeGreaterThan(0);
  });

  it("uses a grouped vessel index to drive one selected-vessel detail pane", () => {
    renderOverview();
    const fleet = screen.getByRole("heading", { name: "Active vessels" }).closest("section")!;
    const relay = within(fleet).getByRole("button", { name: "Select Duna Relay 1" });

    fireEvent.click(relay);

    expect(relay.getAttribute("aria-pressed")).toBe("true");
    const detail = fleet.querySelector<HTMLElement>(".overview-vessel-detail")!;
    const facts = detail.querySelector<HTMLElement>(".overview-vessel-facts")!;
    expect(detail.textContent).toContain("Duna Relay 1");
    expect(detail.textContent).toContain("Orbiting");
    expect(detail.textContent).not.toContain("Mission craft");
    expect(detail.textContent).not.toContain("0 crew");
    expect(within(facts).getByText("Apoapsis", { exact: true })).toBeTruthy();
    expect(within(facts).getByText("Periapsis", { exact: true })).toBeTruthy();
    expect(within(facts).getByText("Inclination", { exact: true })).toBeTruthy();
    expect(within(facts).getByText("Period", { exact: true })).toBeTruthy();
    expect(within(facts).getByText("Eccentricity", { exact: true })).toBeTruthy();
    expect(within(facts).queryByText("Status", { exact: true })).toBeNull();
    expect(within(facts).queryByText("SOI", { exact: true })).toBeNull();
    expect(within(facts).queryByText("Mission elapsed", { exact: true })).toBeNull();
    expect(within(facts).queryByText("Craft type", { exact: true })).toBeNull();

    fireEvent.click(within(fleet).getByRole("button", { name: "Filters 1" }));
    fireEvent.change(within(fleet).getByLabelText("SOI"), { target: { value: "Kerbin" } });
    expect(within(fleet).queryByRole("button", { name: "Select Duna Relay 1" })).toBeNull();
    expect(fleet.querySelector(".overview-vessel-detail")?.textContent).not.toContain("Duna Relay 1");
  });

  it("sends an identity-guarded vessel switch and shows a rejected result", () => {
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const view = render(
      <PanelVisibilityProvider>
        <MissionOverview commandEnabled onSendCommand={onSendCommand} snapshot={inactiveTelemetryFixture} />
      </PanelVisibilityProvider>,
    );
    const fleet = screen.getByRole("heading", { name: "Active vessels" }).closest("section")!;
    fireEvent.click(within(fleet).getByRole("button", { name: "Select Duna Relay 1" }));

    const switchButton = within(fleet).getByRole("button", { name: "Switch to Duna Relay 1" });
    fireEvent.click(switchButton);

    expect(onSendCommand).toHaveBeenCalledTimes(1);
    const command = onSendCommand.mock.calls[0][0];
    if (command.type !== "overview.vessel.switch") throw new Error("Unexpected vessel switch command");
    expect(command).toMatchObject({
      type: "overview.vessel.switch",
      objectId: "103",
      expectedName: "Duna Relay 1",
      expectedGuid: "mock-duna-relay-guid",
    });
    expect(command.requestId).toBeTruthy();
    expect(switchButton.textContent).toBe("SWITCHING…");
    expect(switchButton.hasAttribute("disabled")).toBe(true);

    view.rerender(
      <PanelVisibilityProvider>
        <MissionOverview commandEnabled onSendCommand={onSendCommand} snapshot={inactiveTelemetryFixture} switchResult={{
          type: "overview.vessel.switch.result",
          requestId: command.requestId,
          status: "error",
          message: "That vessel changed after it was selected.",
        }} />
      </PanelVisibilityProvider>,
    );

    expect(within(fleet).getByRole("alert").textContent).toContain("changed");
    expect(within(fleet).getByRole("button", { name: "Switch to Duna Relay 1" }).hasAttribute("disabled")).toBe(false);
  });

  it("acknowledges an accepted vessel switch and recovers if KSP never changes scenes", () => {
    vi.useFakeTimers();
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const view = render(
      <PanelVisibilityProvider>
        <MissionOverview commandEnabled onSendCommand={onSendCommand} snapshot={inactiveTelemetryFixture} />
      </PanelVisibilityProvider>,
    );
    const fleet = screen.getByRole("heading", { name: "Active vessels" }).closest("section")!;
    const switchButton = within(fleet).getByRole("button", { name: /^Switch to / });
    fireEvent.click(switchButton);
    const command = onSendCommand.mock.calls[0][0];
    if (command.type !== "overview.vessel.switch") throw new Error("Unexpected vessel switch command");

    view.rerender(
      <PanelVisibilityProvider>
        <MissionOverview commandEnabled onSendCommand={onSendCommand} snapshot={inactiveTelemetryFixture} switchResult={{
          type: "overview.vessel.switch.result",
          requestId: command.requestId,
          status: "accepted",
          message: "Switching to the selected vessel.",
        }} />
      </PanelVisibilityProvider>,
    );
    expect(switchButton.textContent).toBe("SWITCH REQUESTED");

    act(() => vi.advanceTimersByTime(12_000));
    expect(within(fleet).getByRole("alert").textContent).toContain("did not complete");
    expect(switchButton.hasAttribute("disabled")).toBe(false);
  });

  it("edits a vessel name and type in a detail-contained modal that locks the dashboard", () => {
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const view = render(
      <PanelVisibilityProvider>
        <MissionOverview commandEnabled onSendCommand={onSendCommand} snapshot={inactiveTelemetryFixture} />
      </PanelVisibilityProvider>,
    );
    const fleet = screen.getByRole("heading", { name: "Active vessels" }).closest("section")!;
    fireEvent.click(within(fleet).getByRole("button", { name: "Select Duna Relay 1" }));
    const editButton = within(fleet).getByRole("button", { name: "Edit Duna Relay 1" });

    editButton.focus();
    fireEvent.click(editButton);
    let dialog = screen.getByRole("dialog", { name: "Edit Duna Relay 1" });
    const detail = fleet.querySelector(".overview-vessel-detail")!;
    const nameInput = within(dialog).getByRole("textbox", { name: "Vessel name" });
    expect(detail.contains(dialog)).toBe(true);
    expect(document.querySelector(".overview-metrics")?.hasAttribute("inert")).toBe(true);
    expect(nameInput.getAttribute("value")).toBe("Duna Relay 1");
    expect(document.activeElement).toBe(nameInput);
    expect(within(dialog).getByRole("button", { name: "Relay" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(editButton);
    expect(document.querySelector(".overview-metrics")?.hasAttribute("inert")).toBe(false);

    fireEvent.click(editButton);
    dialog = screen.getByRole("dialog", { name: "Edit Duna Relay 1" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Vessel name" }), { target: { value: "Duna Relay Prime" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Probe" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "SAVE CHANGES" }));

    expect(onSendCommand).toHaveBeenCalledTimes(1);
    const command = onSendCommand.mock.calls[0][0];
    if (command.type !== "overview.vessel.edit") throw new Error("Unexpected vessel edit command");
    expect(command).toMatchObject({
      type: "overview.vessel.edit",
      objectId: "103",
      expectedName: "Duna Relay 1",
      expectedType: "Relay",
      expectedGuid: "mock-duna-relay-guid",
      newName: "Duna Relay Prime",
      newType: "Probe",
    });

    view.rerender(
      <PanelVisibilityProvider>
        <MissionOverview commandEnabled editResult={{
          type: "overview.vessel.edit.result",
          requestId: command.requestId,
          status: "accepted",
          message: "Saved Duna Relay Prime as Probe.",
          name: "Duna Relay Prime",
          vesselType: "Probe",
        }} onSendCommand={onSendCommand} snapshot={inactiveTelemetryFixture} />
      </PanelVisibilityProvider>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(fleet).getByRole("status").textContent).toContain("Duna Relay Prime as Probe");
    expect(document.querySelector(".overview-metrics")?.hasAttribute("inert")).toBe(false);
  });

  it("recovers the edit modal when KSP does not answer", () => {
    vi.useFakeTimers();
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    render(
      <PanelVisibilityProvider>
        <MissionOverview commandEnabled onSendCommand={onSendCommand} snapshot={inactiveTelemetryFixture} />
      </PanelVisibilityProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Edit / }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Relay" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "SAVE CHANGES" }));

    act(() => vi.advanceTimersByTime(12_000));
    expect(within(dialog).getByRole("alert").textContent).toContain("did not answer");
    expect(within(dialog).getByRole("button", { name: "SAVE CHANGES" }).hasAttribute("disabled")).toBe(false);
  });

  it("keeps the edit modal open when KSP rejects the guarded change", () => {
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const view = render(
      <PanelVisibilityProvider>
        <MissionOverview commandEnabled onSendCommand={onSendCommand} snapshot={inactiveTelemetryFixture} />
      </PanelVisibilityProvider>,
    );
    const editButton = screen.getByRole("button", { name: /^Edit / });
    fireEvent.click(editButton);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Relay" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "SAVE CHANGES" }));
    const command = onSendCommand.mock.calls[0][0];
    if (command.type !== "overview.vessel.edit") throw new Error("Unexpected vessel edit command");

    view.rerender(
      <PanelVisibilityProvider>
        <MissionOverview commandEnabled editResult={{
          type: "overview.vessel.edit.result",
          requestId: command.requestId,
          status: "error",
          message: "That vessel changed after it was selected.",
        }} onSendCommand={onSendCommand} snapshot={inactiveTelemetryFixture} />
      </PanelVisibilityProvider>,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain("changed");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close edit vessel dialog" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("warns exactly which Kerbals a termination will kill and sends their guarded roster", () => {
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const view = render(
      <PanelVisibilityProvider>
        <MissionOverview commandEnabled onSendCommand={onSendCommand} snapshot={inactiveTelemetryFixture} />
      </PanelVisibilityProvider>,
    );
    const fleet = screen.getByRole("heading", { name: "Active vessels" }).closest("section")!;
    fireEvent.click(within(fleet).getByRole("button", { name: "Select Odyssey" }));
    const terminateButton = within(fleet).getByRole("button", { name: "Terminate Odyssey" });

    terminateButton.focus();
    fireEvent.click(terminateButton);
    let dialog = screen.getByRole("dialog", { name: "Terminate Odyssey?" });
    const detail = fleet.querySelector(".overview-vessel-detail")!;
    expect(detail.contains(dialog)).toBe(true);
    expect(document.querySelector(".overview-metrics")?.hasAttribute("inert")).toBe(true);
    expect(within(dialog).getByText("The following Kerbals will be killed:", { exact: true })).toBeTruthy();
    for (const name of ["Jebediah Kerman", "Bill Kerman", "Bob Kerman"]) {
      expect(within(dialog).getByText(name, { exact: true })).toBeTruthy();
    }
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "CANCEL" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(terminateButton);

    fireEvent.click(terminateButton);
    dialog = screen.getByRole("dialog", { name: "Terminate Odyssey?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "TERMINATE VESSEL" }));

    expect(onSendCommand).toHaveBeenCalledTimes(1);
    const command = onSendCommand.mock.calls[0][0];
    if (command.type !== "overview.vessel.lifecycle") throw new Error("Unexpected vessel lifecycle command");
    expect(command).toMatchObject({
      action: "terminate",
      objectId: "101",
      expectedName: "Odyssey",
      expectedGuid: "mock-odyssey-guid",
      expectedRecoverable: false,
      expectedCrewNames: ["Jebediah Kerman", "Bill Kerman", "Bob Kerman"],
    });

    view.rerender(
      <PanelVisibilityProvider>
        <MissionOverview commandEnabled lifecycleResult={{
          type: "overview.vessel.lifecycle.result",
          requestId: command.requestId,
          action: "terminate",
          status: "accepted",
          message: "Terminated Odyssey.",
        }} onSendCommand={onSendCommand} snapshot={inactiveTelemetryFixture} />
      </PanelVisibilityProvider>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(fleet).getByRole("status").textContent).toContain("Terminated Odyssey");
    expect(document.querySelector(".overview-metrics")?.hasAttribute("inert")).toBe(false);
  });

  it("offers stock recovery in green and confirms the returning crew", () => {
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    render(
      <PanelVisibilityProvider>
        <MissionOverview commandEnabled onSendCommand={onSendCommand} snapshot={inactiveTelemetryFixture} />
      </PanelVisibilityProvider>,
    );
    const fleet = screen.getByRole("heading", { name: "Active vessels" }).closest("section")!;
    fireEvent.click(within(fleet).getByRole("button", { name: "Select KSC Survey Plane" }));
    const recoverButton = within(fleet).getByRole("button", { name: "Recover KSC Survey Plane" });
    expect(recoverButton.classList.contains("overview-recover-vessel")).toBe(true);
    fireEvent.click(recoverButton);

    const dialog = screen.getByRole("dialog", { name: "Recover KSC Survey Plane?" });
    expect(within(dialog).getByText("Crew returning safely", { exact: true })).toBeTruthy();
    expect(within(dialog).getByText("Valentina Kerman", { exact: true })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "RECOVER VESSEL" }));

    const command = onSendCommand.mock.calls[0][0];
    if (command.type !== "overview.vessel.lifecycle") throw new Error("Unexpected vessel lifecycle command");
    expect(command).toMatchObject({
      action: "recover",
      objectId: "107",
      expectedName: "KSC Survey Plane",
      expectedGuid: "mock-ksc-plane-guid",
      expectedRecoverable: true,
      expectedCrewNames: ["Valentina Kerman"],
    });
  });

  it("keeps the lifecycle modal open when KSP rejects the guarded action", () => {
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const view = render(
      <PanelVisibilityProvider>
        <MissionOverview commandEnabled onSendCommand={onSendCommand} snapshot={inactiveTelemetryFixture} />
      </PanelVisibilityProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select Odyssey" }));
    fireEvent.click(screen.getByRole("button", { name: "Terminate Odyssey" }));
    const dialog = screen.getByRole("dialog", { name: "Terminate Odyssey?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "TERMINATE VESSEL" }));
    const command = onSendCommand.mock.calls[0][0];
    if (command.type !== "overview.vessel.lifecycle") throw new Error("Unexpected vessel lifecycle command");

    view.rerender(
      <PanelVisibilityProvider>
        <MissionOverview commandEnabled lifecycleResult={{
          type: "overview.vessel.lifecycle.result",
          requestId: command.requestId,
          action: "terminate",
          status: "error",
          message: "That vessel's crew changed. Refresh the fleet and try again.",
        }} onSendCommand={onSendCommand} snapshot={inactiveTelemetryFixture} />
      </PanelVisibilityProvider>,
    );

    expect(screen.getByRole("dialog", { name: "Terminate Odyssey?" })).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain("crew changed");
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "TERMINATE VESSEL" }).hasAttribute("disabled")).toBe(false);
  });

  it("recovers the lifecycle modal when KSP does not answer", () => {
    vi.useFakeTimers();
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    render(
      <PanelVisibilityProvider>
        <MissionOverview commandEnabled onSendCommand={onSendCommand} snapshot={inactiveTelemetryFixture} />
      </PanelVisibilityProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select Odyssey" }));
    fireEvent.click(screen.getByRole("button", { name: "Terminate Odyssey" }));
    const dialog = screen.getByRole("dialog", { name: "Terminate Odyssey?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "TERMINATE VESSEL" }));

    act(() => vi.advanceTimersByTime(12_000));
    expect(within(dialog).getByRole("alert").textContent).toContain("did not answer");
    expect(within(dialog).getByRole("button", { name: "TERMINATE VESSEL" }).hasAttribute("disabled")).toBe(false);
  });

  it("terminates by exact connection object when the Python client exposes no GUID", () => {
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    render(
      <PanelVisibilityProvider>
        <MissionOverview commandEnabled onSendCommand={onSendCommand} snapshot={inactiveTelemetryFixture} />
      </PanelVisibilityProvider>,
    );
    const button = screen.getByRole("button", { name: "Terminate Duna Pathfinder" });
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "Terminate Duna Pathfinder?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "TERMINATE VESSEL" }));

    const command = onSendCommand.mock.calls[0][0];
    if (command.type !== "overview.vessel.lifecycle") throw new Error("Unexpected vessel lifecycle command");
    expect(command).toMatchObject({
      action: "terminate",
      objectId: "106",
      expectedName: "Duna Pathfinder",
      expectedRecoverable: false,
      expectedCrewNames: [],
    });
    expect(command.expectedGuid).toBeUndefined();
  });

  it("keeps terminate visible but disabled without matching service support", () => {
    renderOverview({
      ...inactiveTelemetryFixture,
      "overview.vesselTerminationAvailable": false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Select Odyssey" }));
    const button = screen.getByRole("button", { name: "Terminate Odyssey" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toContain("vessel-management service");
  });

  it("disables vessel switching when the dashboard command channel is unavailable", () => {
    renderOverview();
    const button = screen.getByRole("button", { name: /^Switch to / });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("keeps same-named vessels distinct using connection-scoped object IDs", () => {
    renderOverview({
      ...inactiveTelemetryFixture,
      "overview.vessels": [
        { objectId: "101", guid: "shared-guid", name: "Relay", type: "Relay", situation: "Orbiting", body: "Kerbin", met: 100, crewCount: 0, mission: true },
        { objectId: "202", guid: "shared-guid", name: "Relay", type: "Relay", situation: "Orbiting", body: "Kerbin", met: 200, crewCount: 0, mission: true },
      ],
    });
    const fleet = screen.getByRole("heading", { name: "Active vessels" }).closest("section")!;
    const relays = within(fleet).getAllByRole("button", { name: "Select Relay" });
    expect(fleet.querySelector(".overview-vessel-facts")).toBeNull();

    expect(relays[0].getAttribute("aria-pressed")).toBe("true");
    expect(relays[1].getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(relays[1]);
    expect(relays[0].getAttribute("aria-pressed")).toBe("false");
    expect(relays[1].getAttribute("aria-pressed")).toBe("true");
  });

  it("falls back to the first visible vessel when object identities change", () => {
    const firstSnapshot: TelemetrySnapshot = {
      ...inactiveTelemetryFixture,
      "overview.vessels": [
        { objectId: "101", name: "Alpha", type: "Relay", situation: "Orbiting", body: "Kerbin", met: 100, crewCount: 0, mission: true },
        { objectId: "202", name: "Beta", type: "Relay", situation: "Orbiting", body: "Kerbin", met: 200, crewCount: 0, mission: true },
      ],
    };
    const view = renderOverview(firstSnapshot);
    fireEvent.click(screen.getByRole("button", { name: "Select Beta" }));
    expect(screen.getByRole("button", { name: "Select Beta" }).getAttribute("aria-pressed")).toBe("true");

    view.rerender(
      <PanelVisibilityProvider>
        <MissionOverview snapshot={{
          ...firstSnapshot,
          "overview.vessels": [
            { ...firstSnapshot["overview.vessels"]![0], objectId: "303" },
            { ...firstSnapshot["overview.vessels"]![1], objectId: "404" },
          ],
        }} />
      </PanelVisibilityProvider>,
    );

    expect(screen.getByRole("button", { name: "Select Alpha" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Select Beta" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("omits period for an unbound vessel while retaining finite trajectory facts", () => {
    renderOverview({
      ...inactiveTelemetryFixture,
      "overview.vessels": [{
        guid: "escaping-probe",
        name: "Outbound Probe",
        type: "Probe",
        situation: "Escaping",
        body: "Kerbin",
        met: 4_200,
        crewCount: 0,
        mission: true,
        periapsisAltitude: 85_000,
        inclination: 2.4,
        period: 9_999,
        eccentricity: 1.2,
      }],
    });
    const fleet = screen.getByRole("heading", { name: "Active vessels" }).closest("section")!;
    const facts = fleet.querySelector<HTMLElement>(".overview-vessel-facts")!;

    expect(within(facts).getByText("Periapsis", { exact: true })).toBeTruthy();
    expect(within(facts).getByText("Inclination", { exact: true })).toBeTruthy();
    expect(within(facts).getByText("Eccentricity", { exact: true })).toBeTruthy();
    expect(within(facts).queryByText("Period", { exact: true })).toBeNull();
  });

  it("shows a status-grouped flat Kerbonaut table with assignments", () => {
    renderOverview();
    const roster = screen.getByRole("heading", { name: "Astronaut roster" }).closest("section")!;
    const table = within(roster).getByRole("table", { name: "Filtered Kerbonauts" });
    const jebRow = within(table).getByText("Jebediah Kerman", { exact: true }).closest("tr")!;
    const valentinaRow = within(table).getByText("Valentina Kerman", { exact: true }).closest("tr")!;

    expect(within(table).getByText("Assignment", { exact: true })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "Flights" }).textContent).toBe("FLTS");
    expect(jebRow.textContent).toContain("Odyssey");
    expect(jebRow.textContent).toContain("Pilot");
    expect(jebRow.textContent).toContain("8");
    expect(within(jebRow).getByLabelText("Orange suit")).toBeTruthy();
    expect(valentinaRow.textContent).toContain("\u2014");
    expect(within(valentinaRow).getByLabelText("Fallen Kerbonaut")).toBeTruthy();
    expect(within(roster).queryByText("Experience", { exact: true })).toBeNull();
    expect(within(roster).queryByRole("button", { name: "Select Valentina Kerman" })).toBeNull();
    expect(within(table).getByText("Assigned", { exact: true })).toBeTruthy();
    expect(within(table).getByText("Available", { exact: true })).toBeTruthy();
    expect(within(table).getByText("Dead", { exact: true })).toBeTruthy();

    fireEvent.click(within(roster).getByRole("button", { name: "Roster filters" }));
    fireEvent.change(within(roster).getByLabelText("Job"), { target: { value: "Engineer" } });
    expect(within(roster).queryByText("Valentina Kerman", { exact: true })).toBeNull();
  });

  it("collapses and restores the four optional overview panels with instrument icons", () => {
    const view = renderOverview();
    expect(screen.getByRole("heading", { name: "Woobie's Mission Control" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide Active vessels panel" }));
    expect(screen.queryByRole("heading", { name: "Active vessels" })).toBeNull();
    const fleetRestore = screen.getByRole("button", { name: "Active vessels" });
    expect(fleetRestore.querySelector(".panel-rail-icon-overviewFleet")).toBeTruthy();
    expect(view.container.querySelector(".overview-data-grid")?.className).toContain("without-fleet");
    fireEvent.click(fleetRestore);
    expect(screen.getByRole("heading", { name: "Active vessels" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide Transfer windows panel" }));
    expect(screen.queryByRole("heading", { name: "Transfer windows" })).toBeNull();
    expect(localStorage.getItem("wmc-hidden-panels-v1")).toContain("overviewTransfers");
    const transferRestore = screen.getByRole("button", { name: "Transfer windows" });
    expect(transferRestore.querySelector(".panel-rail-icon-overviewTransfers")).toBeTruthy();
    fireEvent.click(transferRestore);
    expect(screen.getByRole("heading", { name: "Transfer windows" })).toBeTruthy();

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
