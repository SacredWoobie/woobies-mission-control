// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlannerPersistenceStatus, useSharedPlannerPersistence } from "./sharedPlannerPersistence";
import { liveTelemetryStore, type MissionPlanningPersistenceListener } from "./telemetry/store";

interface TestLibrary {
  schemaVersion: 4;
  plans: { id: string; updatedAt: string }[];
  pinnedPlanId: string | null;
}

function normalize(value: unknown): TestLibrary | null {
  const candidate = value as TestLibrary | null;
  return candidate?.schemaVersion === 4 && Array.isArray(candidate.plans)
    ? candidate
    : null;
}

function Harness() {
  const [value, setValue] = useState<TestLibrary>({
    schemaVersion: 4,
    plans: [{ id: "chrome", updatedAt: "2026-07-29T12:00:00Z" }],
    pinnedPlanId: null,
  });
  const status = usePlannerPersistenceStatus();
  useSharedPlannerPersistence({
    localStorageKey: "test-planner-library",
    normalize,
    onRemoteValue: setValue,
    section: "resonant",
    value,
  });
  return (
    <>
      <output>{value.plans.map((plan) => plan.id).join(",")}</output>
      <output data-testid="status">{status.status}</output>
      <button
        type="button"
        onClick={() => setValue((current) => ({
          ...current,
          plans: [...current.plans, { id: "local-edit", updatedAt: "2026-07-29T12:02:00Z" }],
        }))}
      >
        Edit
      </button>
    </>
  );
}

describe("shared planner persistence", () => {
  let persistenceListener: MissionPlanningPersistenceListener | undefined;

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(liveTelemetryStore, "getSnapshot").mockReturnValue({
      endpoint: "ws://127.0.0.1:8090",
      frameCount: 0,
      lastFrameAt: null,
      snapshot: null,
      status: "linked",
    });
    vi.spyOn(liveTelemetryStore, "subscribe").mockImplementation(() => () => false);
    vi.spyOn(liveTelemetryStore, "subscribeMissionPlanningPersistence").mockImplementation((listener) => {
      persistenceListener = listener;
      return () => false;
    });
    vi.spyOn(liveTelemetryStore, "mergeMissionPlanningPersistence").mockReturnValue(true);
    vi.spyOn(liveTelemetryStore, "updateMissionPlanningPersistence").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("merges a browser library, removes its local copy, and revisions later updates", () => {
    localStorage.setItem("test-planner-library", "browser copy");
    render(<Harness />);
    expect(liveTelemetryStore.mergeMissionPlanningPersistence).toHaveBeenCalledWith(
      expect.any(String),
      "resonant",
      expect.objectContaining({ plans: [expect.objectContaining({ id: "chrome" })] }),
      0,
    );

    act(() => persistenceListener?.({
      type: "mission.planning.persistence.state",
      requestId: vi.mocked(liveTelemetryStore.mergeMissionPlanningPersistence).mock.calls[0][0],
      section: "resonant",
      revision: 4,
      value: {
        schemaVersion: 4,
        plans: [
          { id: "firefox", updatedAt: "2026-07-29T12:01:00Z" },
          { id: "chrome", updatedAt: "2026-07-29T12:00:00Z" },
        ],
        pinnedPlanId: null,
      },
      status: "merged",
      message: "Section merged.",
    }));

    expect(screen.getByText("firefox,chrome")).toBeTruthy();
    expect(localStorage.getItem("test-planner-library")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(liveTelemetryStore.updateMissionPlanningPersistence).toHaveBeenCalledWith(
      expect.any(String),
      "resonant",
      expect.objectContaining({
        plans: expect.arrayContaining([expect.objectContaining({ id: "local-edit" })]),
      }),
      4,
    );
  });

  it("keeps the newer shared value and surfaces an optimistic-write conflict", () => {
    render(<Harness />);
    const mergeRequest = vi.mocked(liveTelemetryStore.mergeMissionPlanningPersistence).mock.calls[0][0];
    act(() => persistenceListener?.({
      type: "mission.planning.persistence.state",
      requestId: mergeRequest,
      section: "resonant",
      revision: 1,
      value: {
        schemaVersion: 4,
        plans: [{ id: "chrome", updatedAt: "2026-07-29T12:00:00Z" }],
        pinnedPlanId: null,
      },
      status: "unchanged",
      message: "Merge did not change the section.",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const updateRequest = vi.mocked(liveTelemetryStore.updateMissionPlanningPersistence).mock.calls[0][0];
    act(() => persistenceListener?.({
      type: "mission.planning.persistence.state",
      requestId: updateRequest,
      section: "resonant",
      revision: 2,
      value: {
        schemaVersion: 4,
        plans: [{ id: "firefox-newer", updatedAt: "2026-07-29T12:03:00Z" }],
        pinnedPlanId: null,
      },
      status: "conflict",
      message: "The section changed after the supplied base revision.",
    }));

    expect(screen.getByText("firefox-newer")).toBeTruthy();
    expect(screen.getByTestId("status").textContent).toBe("error");
  });
});
