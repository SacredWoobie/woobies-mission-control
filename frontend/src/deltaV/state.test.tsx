// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TelemetrySnapshot } from "../telemetry/types";
import type { DeltaVPlan } from "./calculations";
import type { PorkchopEvaluation } from "./PorkchopPlotModal";
import { DeltaVDraftProvider, useDeltaVDraft } from "./state";

const body = {
  name: "Kerbin",
  parent: "Sun",
  semiMajorAxis: 13_599_840_256,
  gravitationalParameter: 3.5316e12,
  radius: 600_000,
  atmosphereDepth: 70_000,
  defaultParkingAltitude: 80_000,
  solidSurface: true,
  source: "stock" as const,
};

function plan(label: string): DeltaVPlan {
  return {
    origin: body,
    destination: { ...body, name: label },
    direction: "oneWay",
    legs: [{ id: "burn", label: `${label} burn`, deltaV: 1_000, kind: "departure", note: "Test" }],
    idealDeltaV: 1_000,
    nominalDeltaV: 1_000,
    marginDeltaV: 100,
    totalDeltaV: 1_100,
    landingDeltaV: 0,
    atmosphericAssistance: false,
    transferTime: 0,
    phaseAngle: null,
    assumptions: [],
    outboundTransferSource: "modeled",
    returnTransferSource: null,
    transferTimeline: {},
  };
}

const draft = {
  schemaVersion: 1 as const,
  customSteps: [],
  editingStopId: null,
  marginPercent: 10,
  nextStop: {
    id: "segment-1",
    bodyName: "",
    endpoint: "surface" as const,
    parkingAltitude: 1_000,
    arrivalStrategy: { captureBeforeLanding: false, aerocapture: true, atmosphericLanding: true, assistedLandingReserve: 150 },
    stayDurationDays: 1,
  },
  profileOpen: false,
  selectedPorkchopEvaluations: {},
  selectedTransferSolutions: {},
  start: { bodyName: "Kerbin", endpoint: "surface" as const, parkingAltitude: 80_000 },
  startLocked: true,
  stops: [],
  transferMode: "simple" as const,
};

function identity(
  name: string,
  guid: string,
  root: string,
  parts: string[],
): TelemetrySnapshot {
  return {
    "context.mode": "flight",
    "identity.available": true,
    "game.saveFolder": "Docking Tests",
    "v.name": name,
    "v.guid": guid,
    "v.persistentId": root,
    "v.rootPartPersistentId": root,
    "v.partPersistentIds": parts,
  };
}

const mothership = identity("Mothership", "mother-guid", "100", ["100", "101"]);
const lander = identity("Lander", "lander-guid", "200", ["200", "201"]);
const docked = identity("Combined", "mother-guid", "100", ["100", "101", "200", "201"]);
const undockedLander = identity("Lander", "new-lander-guid", "200", ["200", "201"]);

function record(id: string, name: string) {
  return {
    id,
    name,
    saveFolder: "Docking Tests",
    plan: plan(name),
    draft,
    createdAt: "2026-07-22T00:00:00Z",
    updatedAt: "2026-07-22T00:00:00Z",
  };
}

function assignment(id: string, planId: string, anchor: string, guid: string) {
  return {
    id,
    planId,
    saveFolder: "Docking Tests",
    craftName: id,
    anchorPartPersistentId: anchor,
    lastVesselGuid: guid,
    completedLegIds: [],
    pinnedAt: "2026-07-22T00:00:00Z",
    updatedAt: "2026-07-22T00:00:00Z",
  };
}

function Harness({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const {
    pinPlan,
    pinnedForTelemetry,
    rememberPinnedCraft,
    setPinnedStepComplete,
    unpinPlan,
  } = useDeltaVDraft();
  const pinned = pinnedForTelemetry(snapshot);
  useEffect(() => rememberPinnedCraft(snapshot), [rememberPinnedCraft, snapshot]);
  return <>
    <output aria-label="active plan">{pinned?.name ?? "NONE"}</output>
    <output aria-label="completed steps">{pinned?.completedLegIds.join(",") ?? ""}</output>
    <button onClick={() => pinPlan("shared-plan", snapshot)} type="button">Pin shared</button>
    <button onClick={() => unpinPlan(snapshot)} type="button">Unpin</button>
    <button disabled={!pinned} onClick={() => setPinnedStepComplete("burn", true, snapshot)} type="button">Complete</button>
  </>;
}

function renderHarness(snapshot: TelemetrySnapshot) {
  return render(<DeltaVDraftProvider><Harness snapshot={snapshot} /></DeltaVDraftProvider>);
}

const selectedSolution = {
  arcId: "segment-1",
  requestId: "porkchop-request",
  fingerprint: "porkchop-fingerprint",
  origin: "Kerbin",
  destination: "Moho",
  originParkingAltitude: 80_000,
  destinationParkingAltitude: 50_000,
  optimizePoweredCapture: true,
  departureUT: 1_000_000,
  arrivalUT: 2_000_000,
  transferTime: 1_000_000,
  ejectionDeltaV: 1_200,
  arrivalVInfinity: 900,
};

const selectedEvaluation: PorkchopEvaluation = {
  requestId: selectedSolution.requestId,
  fingerprint: selectedSolution.fingerprint,
  departureIndex: 3,
  transferTimeIndex: 4,
  departureUT: selectedSolution.departureUT,
  arrivalUT: selectedSolution.arrivalUT,
  transferTime: selectedSolution.transferTime,
  ejectionDeltaV: selectedSolution.ejectionDeltaV,
  arrivalVInfinity: selectedSolution.arrivalVInfinity,
  rawCost: 2_100,
};

function LibraryRevisionHarness() {
  const {
    activeSavedPlanId,
    loadPlan,
    pinnedForTelemetry,
    resetDraft,
    savedPlans,
    savePlan,
    selectedTransferSolutions,
    setSelectedPorkchopEvaluations,
    setSelectedTransferSolutions,
  } = useDeltaVDraft();
  const [lastStatus, setLastStatus] = useState("");
  const saved = savedPlans.find((candidate) => candidate.id === "saved-plan") ?? savedPlans[0];
  const pinned = pinnedForTelemetry(mothership);
  const act = (result: ReturnType<typeof savePlan>) => setLastStatus(result.status);
  return <>
    <output aria-label="saved count">{savedPlans.length}</output>
    <output aria-label="active saved plan">{activeSavedPlanId ?? "NONE"}</output>
    <output aria-label="pinned plan after reset">{pinned?.name ?? "NONE"}</output>
    <output aria-label="last save status">{lastStatus}</output>
    <output aria-label="saved solutions">{Object.keys(saved?.draft.selectedTransferSolutions ?? {}).join(",")}</output>
    <output aria-label="saved evaluations">{Object.keys(saved?.draft.selectedPorkchopEvaluations ?? {}).join(",")}</output>
    <output aria-label="current solutions">{Object.keys(selectedTransferSolutions).join(",")}</output>
    <button onClick={() => loadPlan("saved-plan")} type="button">Load saved</button>
    <button onClick={resetDraft} type="button">Reset working draft</button>
    <button onClick={() => {
      setSelectedTransferSolutions({ "segment-1": selectedSolution });
      setSelectedPorkchopEvaluations({ "segment-1": selectedEvaluation });
    }} type="button">Choose porkchop</button>
    <button onClick={() => {
      setSelectedTransferSolutions({});
      setSelectedPorkchopEvaluations({});
    }} type="button">Clear porkchop</button>
    <button onClick={() => act(savePlan(plan("Updated Moho"), "MOHO Scan"))} type="button">Update saved</button>
    <button onClick={() => act(savePlan(plan("Duplicate"), "moho scan", { asNew: true, saveFolder: "Docking Tests" }))} type="button">Duplicate name</button>
    <button onClick={() => act(savePlan(plan("Copy"), "MOHO Scan Copy", { asNew: true, saveFolder: "Docking Tests" }))} type="button">Save copy</button>
  </>;
}

describe("craft-scoped delta-v plan assignments", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("keeps valid saved plans when another record is malformed", () => {
    localStorage.setItem("wmc-prototype-delta-v-library-v1", JSON.stringify({
      schemaVersion: 2,
      plans: [
        record("saved-plan", "Valid plan"),
        { ...record("broken-plan", "Broken plan"), draft: { schemaVersion: 1 } },
      ],
      assignments: [],
      legacyPinned: null,
    }));

    render(<DeltaVDraftProvider><LibraryRevisionHarness /></DeltaVDraftProvider>);

    expect(screen.getByLabelText("saved count").textContent).toBe("1");
  });

  it("does not overwrite an unreadable saved-plan library on mount", () => {
    localStorage.setItem("wmc-prototype-delta-v-library-v1", "{not valid json");

    render(<DeltaVDraftProvider><LibraryRevisionHarness /></DeltaVDraftProvider>);

    expect(screen.getByLabelText("saved count").textContent).toBe("0");
    expect(localStorage.getItem("wmc-prototype-delta-v-library-v1")).toBe("{not valid json");
  });

  it("keeps the dockee plan active and restores each plan after undock", async () => {
    localStorage.setItem("wmc-prototype-delta-v-library-v1", JSON.stringify({
      schemaVersion: 2,
      plans: [record("mother-plan", "Duna Mothership"), record("lander-plan", "Duna Lander")],
      assignments: [
        assignment("mother-assignment", "mother-plan", "100", "mother-guid"),
        assignment("lander-assignment", "lander-plan", "200", "lander-guid"),
      ],
      legacyPinned: null,
    }));

    const view = renderHarness(mothership);
    expect(screen.getByLabelText("active plan").textContent).toBe("Duna Mothership");
    view.rerender(<DeltaVDraftProvider><Harness snapshot={docked} /></DeltaVDraftProvider>);
    expect(screen.getByLabelText("active plan").textContent).toBe("Duna Mothership");
    view.rerender(<DeltaVDraftProvider><Harness snapshot={undockedLander} /></DeltaVDraftProvider>);
    expect(screen.getByLabelText("active plan").textContent).toBe("Duna Lander");
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("wmc-prototype-delta-v-library-v1") ?? "null");
      expect(stored.assignments.find((value: { id: string }) => value.id === "lander-assignment").lastVesselGuid).toBe("new-lander-guid");
    });
  });

  it("uses the incoming plan only as a fallback when the dockee has no plan", () => {
    localStorage.setItem("wmc-prototype-delta-v-library-v1", JSON.stringify({
      schemaVersion: 2,
      plans: [record("lander-plan", "Duna Lander")],
      assignments: [assignment("lander-assignment", "lander-plan", "200", "lander-guid")],
      legacyPinned: null,
    }));

    renderHarness(docked);
    expect(screen.getByLabelText("active plan").textContent).toBe("Duna Lander");
  });

  it("keeps completion isolated when the same saved plan is pinned to two craft", async () => {
    localStorage.setItem("wmc-prototype-delta-v-library-v1", JSON.stringify({
      schemaVersion: 2,
      plans: [record("shared-plan", "Shared Duna Plan")],
      assignments: [
        assignment("mother-assignment", "shared-plan", "100", "mother-guid"),
        assignment("lander-assignment", "shared-plan", "200", "lander-guid"),
      ],
      legacyPinned: null,
    }));

    const view = renderHarness(mothership);
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    expect(screen.getByLabelText("completed steps").textContent).toBe("burn");
    view.rerender(<DeltaVDraftProvider><Harness snapshot={lander} /></DeltaVDraftProvider>);
    expect(screen.getByLabelText("active plan").textContent).toBe("Shared Duna Plan");
    expect(screen.getByLabelText("completed steps").textContent).toBe("");
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("wmc-prototype-delta-v-library-v1") ?? "null");
      expect(stored.plans[0].completedLegIds).toBeUndefined();
      expect(stored.assignments[0].completedLegIds).toEqual(["burn"]);
      expect(stored.assignments[1].completedLegIds).toEqual([]);
    });
  });

  it("preserves a v1 global pin as unassigned until the user explicitly pins it", () => {
    localStorage.setItem("wmc-prototype-delta-v-library-v1", JSON.stringify({
      schemaVersion: 1,
      plans: [{ ...record("shared-plan", "Legacy Duna Plan"), completedLegIds: ["burn"] }],
      pinnedPlanId: "shared-plan",
    }));

    renderHarness(mothership);
    expect(screen.getByLabelText("active plan").textContent).toBe("NONE");
    fireEvent.click(screen.getByRole("button", { name: "Pin shared" }));
    expect(screen.getByLabelText("active plan").textContent).toBe("Legacy Duna Plan");
    expect(screen.getByLabelText("completed steps").textContent).toBe("burn");
  });

  it("links an unscoped saved plan to the craft save when it is pinned", async () => {
    localStorage.setItem("wmc-prototype-delta-v-library-v1", JSON.stringify({
      schemaVersion: 2,
      plans: [{ ...record("shared-plan", "Unlinked Duna Plan"), saveFolder: "" }],
      assignments: [],
      legacyPinned: null,
    }));

    renderHarness(mothership);
    fireEvent.click(screen.getByRole("button", { name: "Pin shared" }));
    expect(screen.getByLabelText("active plan").textContent).toBe("Unlinked Duna Plan");
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("wmc-prototype-delta-v-library-v1") ?? "null");
      expect(stored.plans[0].saveFolder).toBe("Docking Tests");
      expect(stored.assignments[0].saveFolder).toBe("Docking Tests");
    });
  });

  it("updates the loaded plan with its porkchop selection and rejects duplicate names", () => {
    localStorage.setItem("wmc-prototype-delta-v-library-v1", JSON.stringify({
      schemaVersion: 2,
      plans: [record("saved-plan", "MOHO Scan")],
      assignments: [],
      legacyPinned: null,
    }));
    render(<DeltaVDraftProvider><LibraryRevisionHarness /></DeltaVDraftProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Load saved" }));
    expect(screen.getByLabelText("active saved plan").textContent).toBe("saved-plan");
    fireEvent.click(screen.getByRole("button", { name: "Choose porkchop" }));
    fireEvent.click(screen.getByRole("button", { name: "Update saved" }));
    expect(screen.getByLabelText("last save status").textContent).toBe("updated");
    expect(screen.getByLabelText("saved count").textContent).toBe("1");
    expect(screen.getByLabelText("saved solutions").textContent).toBe("segment-1");
    expect(screen.getByLabelText("saved evaluations").textContent).toBe("segment-1");
    fireEvent.click(screen.getByRole("button", { name: "Clear porkchop" }));
    expect(screen.getByLabelText("current solutions").textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Load saved" }));
    expect(screen.getByLabelText("current solutions").textContent).toBe("segment-1");

    fireEvent.click(screen.getByRole("button", { name: "Duplicate name" }));
    expect(screen.getByLabelText("last save status").textContent).toBe("duplicate");
    expect(screen.getByLabelText("saved count").textContent).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "Save copy" }));
    expect(screen.getByLabelText("last save status").textContent).toBe("created");
    expect(screen.getByLabelText("saved count").textContent).toBe("2");
  });

  it("resets only the working draft while preserving saved and pinned plan state", async () => {
    localStorage.setItem("wmc-prototype-delta-v-library-v1", JSON.stringify({
      schemaVersion: 2,
      plans: [record("saved-plan", "MOHO Scan")],
      assignments: [assignment("saved-assignment", "saved-plan", "100", "mother-guid")],
      legacyPinned: null,
    }));
    render(<DeltaVDraftProvider><LibraryRevisionHarness /></DeltaVDraftProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Load saved" }));
    expect(screen.getByLabelText("active saved plan").textContent).toBe("saved-plan");
    expect(screen.getByLabelText("pinned plan after reset").textContent).toBe("MOHO Scan");
    fireEvent.click(screen.getByRole("button", { name: "Reset working draft" }));

    expect(screen.getByLabelText("active saved plan").textContent).toBe("NONE");
    expect(screen.getByLabelText("saved count").textContent).toBe("1");
    expect(screen.getByLabelText("pinned plan after reset").textContent).toBe("MOHO Scan");
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("wmc-prototype-delta-v-library-v1") ?? "null");
      expect(stored.plans).toHaveLength(1);
      expect(stored.assignments).toHaveLength(1);
      expect(stored.assignments[0].planId).toBe("saved-plan");
    });
  });
});
