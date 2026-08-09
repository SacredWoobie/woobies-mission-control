// @vitest-environment jsdom

import { useMemo, useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { TelemetrySnapshot } from "../telemetry/types";
import {
  acknowledgeAnnunciator,
  acknowledgeAnnunciatorSubsystem,
  createAnnunciatorState,
  evaluateAnnunciatorSnapshot,
  summarizeAnnunciator,
  type AnnunciatorRule,
  type AnnunciatorState,
} from "./engine";
import { FlightAnnunciator } from "./FlightAnnunciator";

const snapshot: TelemetrySnapshot = { "context.mode": "flight" };
const warningRule: AnnunciatorRule = {
  ruleId: "test-warning",
  sourceId: "test",
  subsystem: "HEAT",
  defaultTier: "warning",
  activationDwellMs: 0,
  evaluate: () => ({
    kind: "known",
    complete: true,
    observations: [{ instanceId: "loop-1", message: "Heat loop 1 is critical.", state: "active" }],
  }),
};
const powerRule: AnnunciatorRule = {
  ...warningRule,
  ruleId: "test-power",
  sourceId: "resources",
  subsystem: "POWER",
  defaultTier: "caution",
  evaluate: () => ({
    kind: "known",
    complete: true,
    observations: [{ instanceId: "vessel-electric-charge", message: "Electric charge is low.", state: "active" }],
  }),
};
const damageRule: AnnunciatorRule = {
  ...warningRule,
  ruleId: "test-damage",
  sourceId: "damage",
  subsystem: "DAMAGE",
  evaluate: () => ({
    kind: "known",
    complete: true,
    observations: [{ instanceId: "radiator:large-folding", message: "2 damaged radiators: Large Folding Radiator.", state: "active" }],
  }),
};

function activeState() {
  return evaluateAnnunciatorSnapshot(createAnnunciatorState(), [warningRule], snapshot, {
    missionTime: 123,
    nowMs: 1_000,
    vesselIdentity: "vessel-a",
  });
}

function multipleActiveState() {
  return evaluateAnnunciatorSnapshot(createAnnunciatorState(), [warningRule, powerRule], snapshot, {
    missionTime: 123,
    nowMs: 1_000,
    vesselIdentity: "vessel-a",
  });
}

function damageActiveState() {
  return evaluateAnnunciatorSnapshot(createAnnunciatorState(), [damageRule], snapshot, {
    missionTime: 123,
    nowMs: 1_000,
    vesselIdentity: "vessel-a",
  });
}

function Harness({ initialState }: { initialState: AnnunciatorState }) {
  const [state, setState] = useState(initialState);
  const controller = useMemo(() => ({
    state,
    summary: summarizeAnnunciator(state),
    acknowledge: () => setState((current) => acknowledgeAnnunciator(current)),
    acknowledgeSubsystem: (subsystem: string) => setState((current) => acknowledgeAnnunciatorSubsystem(current, subsystem)),
  }), [state]);
  return <FlightAnnunciator controller={controller} />;
}

describe("Flight annunciator surface", () => {
  afterEach(cleanup);

  it("acknowledges an unseen warning when its lamp opens the accessible history", async () => {
    const user = userEvent.setup();
    render(<Harness initialState={activeState()} />);
    const lamp = screen.getByRole("button", { name: /Master warning, unacknowledged/i });
    expect(lamp.className).toContain("unacknowledged");
    expect(lamp.className).toContain("warning");
    expect(screen.getByRole("button", { name: "HEAT new warning. Acknowledge." }).className).toContain("new");

    await user.click(lamp);
    expect(screen.getByRole("dialog", { name: "Master caution history" })).toBeTruthy();
    expect(screen.getByText("Heat loop 1 is critical.")).toBeTruthy();
    expect(document.querySelector(".annunciator-lamp")?.className).toContain("dark");
    expect(document.querySelector(".annunciator-indicator.acknowledged")?.getAttribute("aria-label")).toBe("HEAT warning acknowledged and still active");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(lamp);
  });

  it("keeps five fixed indicators in compact order and acknowledges only the selected subsystem", async () => {
    const user = userEvent.setup();
    render(<Harness initialState={multipleActiveState()} />);
    const group = screen.getByRole("group", { name: "Flight alert indicators" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "HEAT", "REACTOR", "COMMS", "POWER", "DAMAGE",
    ]);
    expect(within(group).getByRole("button", { name: "REACTOR clear" }).hasAttribute("disabled")).toBe(true);
    expect(within(group).getByRole("button", { name: "COMMS clear" }).className).toContain("clear");

    await user.click(within(group).getByRole("button", { name: "HEAT new warning. Acknowledge." }));
    expect(within(group).getByRole("button", { name: "HEAT warning acknowledged and still active" }).className).toContain("acknowledged");
    expect(within(group).getByRole("button", { name: "POWER new caution. Acknowledge." }).className).toContain("new");
    expect(screen.getByRole("button", { name: /Master caution, unacknowledged/i })).toBeTruthy();

    await user.click(within(group).getByRole("button", { name: "POWER new caution. Acknowledge." }));
    expect(screen.getByRole("button", { name: /Master caution clear/i })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "POWER caution acknowledged and still active" }).className).toContain("acknowledged");
  });

  it("acknowledges DAMAGE and opens a focused damaged-parts report", async () => {
    const user = userEvent.setup();
    render(<Harness initialState={damageActiveState()} />);
    const damage = screen.getByRole("button", { name: "DAMAGE new warning. Acknowledge and show damaged parts." });

    await user.click(damage);
    expect(screen.getByRole("dialog", { name: "Damage report" })).toBeTruthy();
    expect(screen.getByText("2 damaged radiators: Large Folding Radiator.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close damage report" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "DAMAGE warning acknowledged. Show damaged parts." })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Master caution clear/i })).toBeTruthy();
    expect(document.activeElement).toBe(damage);
  });

  it("keeps the dark lamp operable for cleared history", async () => {
    const clearRule: AnnunciatorRule = {
      ...warningRule,
      evaluate: () => ({
        kind: "known",
        complete: true,
        observations: [{ instanceId: "loop-1", state: "clear" }],
      }),
    };
    let state = activeState();
    state = evaluateAnnunciatorSnapshot(state, [clearRule], snapshot, {
      missionTime: 124,
      nowMs: 2_000,
      vesselIdentity: "vessel-a",
    });
    state = evaluateAnnunciatorSnapshot(state, [clearRule], snapshot, {
      missionTime: 127,
      nowMs: 5_000,
      vesselIdentity: "vessel-a",
    });
    state = acknowledgeAnnunciator(state);
    const user = userEvent.setup();
    render(<Harness initialState={state} />);

    await user.click(screen.getByRole("button", { name: /Master caution clear/i }));
    expect(screen.getByRole("heading", { name: "Cleared 1" })).toBeTruthy();
    expect(screen.getByText(/duration/)).toBeTruthy();
  });

});
