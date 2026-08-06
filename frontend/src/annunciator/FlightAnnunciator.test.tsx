// @vitest-environment jsdom

import { useMemo, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { TelemetrySnapshot } from "../telemetry/types";
import {
  acknowledgeAnnunciator,
  createAnnunciatorState,
  evaluateAnnunciatorSnapshot,
  summarizeAnnunciator,
  type AnnunciatorRule,
  type AnnunciatorState,
} from "./engine";
import { fitAnnunciatorTokenCount, FlightAnnunciator } from "./FlightAnnunciator";

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

function activeState() {
  return evaluateAnnunciatorSnapshot(createAnnunciatorState(), [warningRule], snapshot, {
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
  }), [state]);
  return <FlightAnnunciator controller={controller} />;
}

describe("Flight annunciator surface", () => {
  afterEach(cleanup);

  it("acknowledges an unseen warning when its lamp opens the accessible history", async () => {
    const user = userEvent.setup();
    render(<Harness initialState={activeState()} />);
    const lamp = screen.getByRole("button", { name: /Master warning, unacknowledged/i });
    expect(lamp.className).toContain("blinking");
    expect(lamp.className).toContain("warning");

    await user.click(lamp);
    expect(screen.getByRole("dialog", { name: "Master caution history" })).toBeTruthy();
    expect(screen.getByText("Heat loop 1 is critical.")).toBeTruthy();
    expect(document.querySelector(".annunciator-lamp")?.className).toContain("steady");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(lamp);
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

  it("reserves room for an overflow marker while fitting whole tokens", () => {
    expect(fitAnnunciatorTokenCount(125, [40, 50, 45], 30, 5)).toBe(1);
    expect(fitAnnunciatorTokenCount(150, [40, 50, 45], 30, 5)).toBe(3);
    expect(fitAnnunciatorTokenCount(20, [40], 30, 5)).toBe(0);
  });
});
