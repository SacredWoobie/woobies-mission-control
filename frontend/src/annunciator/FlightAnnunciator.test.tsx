// @vitest-environment jsdom

import { useMemo, useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { DamageLossEventTelemetry, TelemetrySnapshot } from "../telemetry/types";
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

const persistedLossEvents: DamageLossEventTelemetry[] = [{
  eventId: "lost-fin-1",
  partId: 77,
  name: "Booster Fin",
  kind: "wing",
  state: "cleared",
  occurrenceUt: 500,
  occurrenceMet: 42,
  clearedUt: 510,
  clearReason: "intentional_separation",
  cause: "joint_break",
}];

function Harness({
  initialState,
  damageLossEvents = persistedLossEvents,
  damageLossStatus = "known",
}: {
  initialState: AnnunciatorState;
  damageLossEvents?: DamageLossEventTelemetry[];
  damageLossStatus?: "known" | "unavailable" | "incomplete" | "loading";
}) {
  const [state, setState] = useState(initialState);
  const controller = useMemo(() => ({
    state,
    summary: summarizeAnnunciator(state),
    damageLossStatus,
    damageLossEvents,
    acknowledge: () => setState((current) => acknowledgeAnnunciator(current)),
    acknowledgeSubsystem: (subsystem: string) => setState((current) => acknowledgeAnnunciatorSubsystem(current, subsystem)),
  }), [damageLossEvents, damageLossStatus, state]);
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
    const damage = screen.getByRole("button", { name: "DAMAGE new warning. Acknowledge and show affected craft parts." });

    await user.click(damage);
    expect(screen.getByRole("dialog", { name: "Damage report" })).toBeTruthy();
    expect(screen.getByText("2 damaged radiators: Large Folding Radiator.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Recorded part loss 1" })).toBeTruthy();
    expect(screen.getByText("Booster Fin")).toBeTruthy();
    expect(screen.getByText(/branch intentionally separated/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close damage report" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "DAMAGE warning acknowledged. Show affected craft parts." })).toBeTruthy();
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

  it("keeps recorded loss history discoverable after DAMAGE clears", async () => {
    const user = userEvent.setup();
    render(<Harness initialState={activeState()} />);
    const damage = screen.getByRole("button", {
      name: "DAMAGE clear. Show recorded part-loss history.",
    });
    expect(damage.hasAttribute("disabled")).toBe(false);
    await user.click(damage);
    expect(screen.getByRole("dialog", { name: "Damage report" })).toBeTruthy();
    expect(screen.getByText("Booster Fin")).toBeTruthy();
  });

  it("opens the focused DAMAGE report from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness initialState={damageActiveState()} />);
    await user.tab();
    await user.tab();
    expect(document.activeElement?.textContent).toBe("DAMAGE");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Damage report" })).toBeTruthy();
  });

  it.each([
    ["loading", "Recorded loss history is loading from the KSP save."],
    ["incomplete", "Recorded loss history is incomplete."],
    ["unavailable", "Recorded loss history requires WoobiesControlStats 0.2.11 or newer."],
  ] as const)("explains %s loss-history coverage", async (status, message) => {
    const user = userEvent.setup();
    render(<Harness damageLossEvents={[]} damageLossStatus={status} initialState={damageActiveState()} />);
    await user.click(screen.getByRole("button", { name: /DAMAGE new warning/ }));
    expect(screen.getByText(message)).toBeTruthy();
  });

  it("renders known empty and mixed active/cleared persisted loss history", async () => {
    const user = userEvent.setup();
    const activeLoss: DamageLossEventTelemetry = {
      ...persistedLossEvents[0],
      eventId: "active-antenna",
      partId: 88,
      name: "F-RA Relay Antenna Feed",
      kind: "antenna",
      state: "active",
      clearedUt: undefined,
      clearReason: undefined,
    };
    const { unmount } = render(
      <Harness damageLossEvents={[]} initialState={damageActiveState()} />,
    );
    await user.click(screen.getByRole("button", { name: /DAMAGE new warning/ }));
    expect(screen.getByText("No part-loss events recorded for this vessel.")).toBeTruthy();
    unmount();

    render(<Harness damageLossEvents={[activeLoss, ...persistedLossEvents]} initialState={damageActiveState()} />);
    await user.click(screen.getByRole("button", { name: /DAMAGE new warning/ }));
    expect(screen.getByRole("heading", { name: "Recorded part loss 2" })).toBeTruthy();
    expect(screen.getByText("Active loss")).toBeTruthy();
    expect(screen.getByText(/branch intentionally separated/i)).toBeTruthy();
  });

});
