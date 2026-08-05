// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelRestoreRail, PanelVisibilityProvider } from "../components/PanelVisibility";
import { editorTelemetryFixture, flightTelemetryFixture } from "../telemetry/fixtures";
import { liveTelemetryStore } from "../telemetry/store";
import { TimeSystemProvider } from "../timeSystem";
import type { DeltaVBody, DeltaVPlan } from "./calculations";
import { PinnedDeltaVPlanPanel } from "./PinnedDeltaVPlanPanel";
import { DeltaVDraftProvider } from "./state";

const kerbin: DeltaVBody = {
  name: "Kerbin",
  parent: "Sun",
  semiMajorAxis: 13_599_840_256,
  gravitationalParameter: 3.5316e12,
  radius: 600_000,
  atmosphereDepth: 70_000,
  defaultParkingAltitude: 80_000,
  solidSurface: true,
  source: "stock",
};

const duna: DeltaVBody = {
  ...kerbin,
  name: "Duna",
  semiMajorAxis: 20_726_155_264,
  gravitationalParameter: 3.0136e11,
  radius: 320_000,
  atmosphereDepth: 50_000,
};

const plan: DeltaVPlan = {
  origin: kerbin,
  destination: duna,
  direction: "oneWay",
  legs: [
    { id: "segment-1-ascent", label: "Launch to Kerbin orbit", deltaV: 3_400, kind: "ascent", note: "Ascent allowance" },
    { id: "segment-1-primary-ejection", label: "Kerbin \u2192 Duna transfer", deltaV: 1_050, kind: "departure", note: "Transfer burn", transferArcId: "segment-1-primary", transferSource: "mechjeb" },
    { id: "segment-1-primary-capture", label: "Capture at Duna", deltaV: 250, kind: "capture", note: "Capture burn", transferArcId: "segment-1-primary" },
    { id: "segment-1-entry", label: "Atmospheric entry", deltaV: 0, kind: "deorbit", note: "Direct entry" },
    { id: "segment-1-landing", label: "Duna landing reserve", deltaV: 600, kind: "landing", note: "Landing reserve" },
  ],
  idealDeltaV: 5_300,
  nominalDeltaV: 5_300,
  marginDeltaV: 795,
  totalDeltaV: 6_095,
  landingDeltaV: 600,
  atmosphericAssistance: true,
  transferTime: 5_400,
  phaseAngle: 44,
  assumptions: [],
  outboundTransferSource: "mechjeb",
  returnTransferSource: null,
  transferTimeline: {
    "segment-1": {
      arcId: "segment-1-primary",
      direction: "segment-1",
      departureUT: 4_600,
      arrivalUT: 10_000,
      transferTime: 5_400,
      origin: "Kerbin",
      destination: "Duna",
    },
  },
};

function seedPinnedPlan(includeCompletionState = true) {
  localStorage.setItem("wmc-delta-v-library-v1", JSON.stringify({
    schemaVersion: 2,
    plans: [{
      id: "duna-plan",
      name: "Duna Survey",
      plan,
      draft: {
        schemaVersion: 1,
        customSteps: [],
        editingStopId: null,
        marginPercent: 15,
        nextStop: { id: "segment-2", bodyName: "", endpoint: "surface", parkingAltitude: 1_000, arrivalStrategy: { captureBeforeLanding: false, aerocapture: true, atmosphericLanding: true, assistedLandingReserve: 150 }, stayDurationDays: 1 },
        profileOpen: false,
        selectedPorkchopEvaluations: {},
        selectedTransferSolutions: {},
        start: { bodyName: "Kerbin", endpoint: "surface", parkingAltitude: 80_000 },
        stops: [],
        transferMode: "simple",
      },
      createdAt: "2026-07-21T00:00:00Z",
      updatedAt: "2026-07-21T00:00:00Z",
    }],
    assignments: [{
      id: "fixture-craft-duna-plan",
      planId: "duna-plan",
      saveFolder: "WMC Fixture Save",
      craftName: "Odyssey",
      anchorPartPersistentId: "1001",
      editorCraftPersistentId: "9001",
      lastVesselGuid: "11111111-2222-3333-4444-555555555555",
      ...(includeCompletionState ? { completedLegIds: [] } : {}),
      pinnedAt: "2026-07-21T00:00:00Z",
      updatedAt: "2026-07-21T00:00:00Z",
    }],
    legacyPinned: null,
  }));
}

function renderPanel(scene: "editor" | "flight") {
  const snapshot = scene === "editor"
    ? { ...editorTelemetryFixture, "stage.totalDvVac": 5_500 }
    : { ...flightTelemetryFixture, "stage.totalDvVac": 5_500, "t.universalTime": 1_000 };
  return render(
    <TimeSystemProvider>
      <PanelVisibilityProvider>
        <DeltaVDraftProvider>
          <PinnedDeltaVPlanPanel scene={scene} snapshot={snapshot} />
        </DeltaVDraftProvider>
      </PanelVisibilityProvider>
    </TimeSystemProvider>,
  );
}

describe("pinned delta-v Mission Plan", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows every editor step, total budget, and a staging shortfall", () => {
    seedPinnedPlan(false);
    renderPanel("editor");

    expect(screen.getByRole("heading", { name: /Mission Plan/ })).toBeTruthy();
    expect(screen.getByText("Duna Survey", { exact: true })).toBeTruthy();
    expect(screen.queryByText("PINNED TO THIS CRAFT", { exact: true })).toBeNull();
    expect(screen.getByLabelText("Mission plan steps").children).toHaveLength(5);
    expect(screen.getByText("Atmospheric entry", { exact: true })).toBeTruthy();
    expect(screen.getAllByText("6,095 m/s", { exact: true })).toHaveLength(1);
    expect(screen.getByText("595 m/s", { exact: true })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Craft does not cover this plan");
    expect(screen.queryByRole("button", { name: /Mark .* complete/ })).toBeNull();
    expect(document.body.textContent).toContain("Kerbin \u2192 Duna");
    expect(screen.getByLabelText("Mission delta-v overview").children).toHaveLength(2);
    expect(document.body.textContent).toContain("VAC \u0394v");
    expect(document.body.textContent).not.toMatch(/[ÃÂâ]/);
  });

  it("shows flight burn dates and countdowns, then persists completed steps", async () => {
    seedPinnedPlan();
    renderPanel("flight");

    expect(screen.queryByText("TRANSFER READINESS", { exact: true })).toBeNull();
    expect(screen.getByText("LAUNCH TARGET", { exact: true })).toBeTruthy();
    expect(screen.getByText((_, element) => element?.textContent === "80.0\u2009km circular")).toBeTruthy();
    expect(screen.getByText("0.0\u00b0 equatorial", { exact: true })).toBeTruthy();
    expect(screen.getByText("Aim \u22642.0\u00b0 \u00b7 now 0.43\u00b0", { exact: true })).toBeTruthy();
    expect(screen.getAllByText("T\u2212 1h", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText("Launch step may already be complete", { exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark launch complete" }));

    await waitFor(() => expect(screen.getByLabelText("Remaining mission plan steps").textContent).not.toContain("Launch to Kerbin orbit"));
    expect(screen.queryByText("LAUNCH TARGET", { exact: true })).toBeNull();
    expect(screen.getByText("TRANSFER READINESS", { exact: true })).toBeTruthy();
    expect(screen.getByText("Calculate and save this ideal transfer before checking the maneuver.", { exact: true })).toBeTruthy();
    expect(document.body.textContent).not.toContain("porkchop");
    expect(screen.getByText("1 / 5 steps", { exact: true })).toBeTruthy();
    expect(screen.getAllByText("2,185 m/s", { exact: true })).toHaveLength(1);
    expect(screen.getByText("SURPLUS", { exact: true })).toBeTruthy();
    await waitFor(() => expect(JSON.parse(localStorage.getItem("wmc-delta-v-library-v1") ?? "null").assignments[0].completedLegIds).toEqual(["segment-1-ascent"]));

    const undo = screen.getByRole("button", { name: "Undo last" });
    expect(undo.closest(".delta-v-pinned-progress")).toBeTruthy();
    expect(undo.closest('[aria-label="Mission delta-v overview"]')).toBeNull();
    fireEvent.click(undo);
    expect(screen.getByText("Launch to Kerbin orbit", { exact: true })).toBeTruthy();
  });

  it("collapses transfer readiness while keeping its live status visible", () => {
    seedPinnedPlan();
    const library = JSON.parse(localStorage.getItem("wmc-delta-v-library-v1") ?? "null");
    library.assignments[0].completedLegIds = ["segment-1-ascent"];
    localStorage.setItem("wmc-delta-v-library-v1", JSON.stringify(library));

    renderPanel("flight");

    const collapse = screen.getByRole("button", { name: "Collapse transfer readiness" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    expect(collapse.textContent).toBe("HOLD\u25be");
    expect(screen.getByText("HOLD", { exact: true })).toBeTruthy();
    expect(screen.getByText("Target orbit", { exact: true })).toBeTruthy();

    fireEvent.click(collapse);

    const expand = screen.getByRole("button", { name: "Expand transfer readiness" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(expand.textContent).toBe("HOLD\u25c2");
    expect(screen.getByText("HOLD", { exact: true })).toBeTruthy();
    expect(screen.queryByText("Target orbit", { exact: true })).toBeNull();

    fireEvent.click(expand);
    expect(screen.getByRole("button", { name: "Collapse transfer readiness" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Target orbit", { exact: true })).toBeTruthy();
  });

  it("describes a legacy Simple transfer as ideal when its maneuver vector is missing", () => {
    seedPinnedPlan();
    const library = JSON.parse(localStorage.getItem("wmc-delta-v-library-v1") ?? "null");
    library.assignments[0].completedLegIds = ["segment-1-ascent"];
    library.plans[0].draft.selectedTransferSolutions["segment-1"] = {
      arcId: "segment-1-primary",
      requestId: "legacy-ideal",
      fingerprint: "Kerbin|Duna|80000|ideal",
      origin: "Kerbin",
      destination: "Duna",
      originParkingAltitude: 80_000,
      destinationParkingAltitude: 60_000,
      optimizePoweredCapture: false,
      departureUT: 4_600,
      arrivalUT: 10_000,
      transferTime: 5_400,
      ejectionDeltaV: 1_050,
      arrivalVInfinity: 700,
    };
    localStorage.setItem("wmc-delta-v-library-v1", JSON.stringify(library));

    renderPanel("flight");

    expect(screen.getByText("Recalculate and update this ideal transfer to enable maneuver creation.", { exact: true })).toBeTruthy();
    expect(document.body.textContent).not.toContain("porkchop");
  });

  it("restores the collapsed panel as Mission Plan with a distinct icon", () => {
    localStorage.setItem("wmc-hidden-panels-v1", JSON.stringify(["flightDeltaVPlan"]));
    render(<PanelVisibilityProvider><PanelRestoreRail available={new Set(["flightDeltaVPlan"])} /></PanelVisibilityProvider>);

    const restore = screen.getByRole("button", { name: "Mission Plan" });
    expect(restore.querySelector(".panel-rail-icon-flightDeltaVPlan")).toBeTruthy();
    expect(restore.getAttribute("title")).toBe("Restore Mission Plan");
  });

  it("uses the complete live feed for staging when a narrow supplied snapshot is stale", () => {
    seedPinnedPlan();
    vi.spyOn(liveTelemetryStore, "getSnapshot").mockReturnValue({
      endpoint: "ws://127.0.0.1:8090",
      frameCount: 1,
      lastFrameAt: Date.now(),
      status: "linked",
      snapshot: {
        ...editorTelemetryFixture,
        "stage.available": true,
        "stage.pending": false,
        "stage.complete": true,
        "stage.totalDvVac": 8_012.8,
      },
    });
    vi.spyOn(liveTelemetryStore, "subscribe").mockReturnValue(() => false);

    renderPanel("editor");

    expect(screen.getByText("8,013 m/s", { exact: true })).toBeTruthy();
    expect(screen.getByText("SURPLUS", { exact: true })).toBeTruthy();
    expect(screen.queryByText("Unavailable", { exact: true })).toBeNull();
  });

  it("checks orbit readiness, previews the active-orbit burn, and confirms node creation", async () => {
    seedPinnedPlan();
    const library = JSON.parse(localStorage.getItem("wmc-delta-v-library-v1") ?? "null");
    library.assignments[0].completedLegIds = ["segment-1-ascent"];
    library.plans[0].draft.transferMode = "advanced";
    library.plans[0].draft.selectedTransferSolutions["segment-1"] = {
      arcId: "segment-1-primary",
      requestId: "duna-selected",
      fingerprint: "Kerbin|Duna|80000|selected",
      origin: "Kerbin",
      destination: "Duna",
      originParkingAltitude: 80_000,
      destinationParkingAltitude: 60_000,
      optimizePoweredCapture: true,
      departureUT: 4_600,
      arrivalUT: 10_000,
      transferTime: 5_400,
      ejectionDeltaV: 1_050,
      arrivalVInfinity: 700,
      departureVInfinity: [321, -654, 987],
      maneuverVectorSchema: 1,
    };
    localStorage.setItem("wmc-delta-v-library-v1", JSON.stringify(library));

    const baseSnapshot = {
      ...flightTelemetryFixture,
      "identity.available": true,
      "game.saveFolder": "WMC Fixture Save",
      "v.guid": "11111111-2222-3333-4444-555555555555",
      "v.rootPartPersistentId": "1001",
      "v.partPersistentIds": ["1001", "1002"],
      "v.body": "Kerbin",
      "o.ApA": 82_000,
      "o.PeA": 78_000,
      "o.inclination": .7,
      "o.eccentricity": .01,
      "o.period": 1_800,
      "t.universalTime": 1_000,
      "stage.totalDvVac": 5_500,
    };
    let liveState = {
      endpoint: "ws://127.0.0.1:8090",
      frameCount: 1,
      lastFrameAt: Date.now(),
      status: "linked" as const,
      snapshot: baseSnapshot,
    };
    const listeners = new Set<() => void>();
    vi.spyOn(liveTelemetryStore, "getSnapshot").mockImplementation(() => liveState);
    vi.spyOn(liveTelemetryStore, "subscribe").mockImplementation((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    const send = vi.spyOn(liveTelemetryStore, "send").mockReturnValue(true);

    const panel = renderPanel("flight");

    expect(screen.getByText((_, element) => element?.textContent === "80.0\u2009km circular")).toBeTruthy();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "B" &&
          element.textContent === "82.0\u2009km \u00d7 78.0\u2009km",
      ),
    ).toBeTruthy();
    expect(screen.getByText("0.70\u00b0", { exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check maneuver" }));
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "mechjeb.transfer.node.preview",
      origin: "Kerbin",
      departureVInfinity: [321, -654, 987],
      expectedVesselGuid: "11111111-2222-3333-4444-555555555555",
    }));
    const firstPreview = send.mock.calls.at(-1)?.[0];
    if (!firstPreview || firstPreview.type !== "mechjeb.transfer.node.preview") throw new Error("Expected the first maneuver preview.");
    expect(firstPreview.actionId).not.toBe("duna-plan:segment-1-primary-ejection");
    expect(screen.getByRole("button", { name: "Checking\u2026" })).toBeTruthy();

    liveState = {
      ...liveState,
      frameCount: 2,
      snapshot: {
        ...baseSnapshot,
        "mj.transfer.node.actionId": firstPreview.actionId,
        "mj.transfer.node.fingerprint": "Kerbin|Duna|80000|selected",
        "mj.transfer.node.vesselGuid": "11111111-2222-3333-4444-555555555555",
        "mj.transfer.node.state": "ready",
        "mj.transfer.node.nodeUT": 4_550,
        "mj.transfer.node.deltaV": 1_075,
      },
    };
    await act(async () => listeners.forEach((listener) => listener()));

    expect(screen.getByText("Active-orbit burn", { exact: true })).toBeTruthy();
    expect(screen.getByText("1,075 m/s", { exact: true })).toBeTruthy();
    panel.unmount();
    renderPanel("flight");
    expect(screen.queryByRole("button", { name: "Create KSP node" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check maneuver" }));
    const secondPreview = send.mock.calls.at(-1)?.[0];
    if (!secondPreview || secondPreview.type !== "mechjeb.transfer.node.preview") throw new Error("Expected the second maneuver preview.");
    expect(secondPreview.actionId).not.toBe(firstPreview.actionId);
    liveState = {
      ...liveState,
      frameCount: 3,
      snapshot: {
        ...liveState.snapshot,
        "mj.transfer.node.actionId": secondPreview.actionId,
      },
    };
    await act(async () => listeners.forEach((listener) => listener()));

    fireEvent.click(screen.getByRole("button", { name: "Create KSP node" }));
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "mechjeb.transfer.node.create",
      actionId: secondPreview.actionId,
      expectedVesselGuid: "11111111-2222-3333-4444-555555555555",
    }));

    liveState = {
      ...liveState,
      frameCount: 4,
      snapshot: {
        ...liveState.snapshot,
        "mj.transfer.node.state": "created",
      },
    };
    await act(async () => listeners.forEach((listener) => listener()));

    expect(screen.getByText("NODE CREATED", { exact: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark transfer complete" })).toBeTruthy();
    liveState = {
      ...liveState,
      frameCount: 5,
      snapshot: {
        ...liveState.snapshot,
        "mj.transfer.node.state": "executed",
      },
    };
    await act(async () => listeners.forEach((listener) => listener()));

    expect(screen.getByText("BURN PASSED", { exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark transfer complete" }));
    await waitFor(() => expect(screen.queryByText("TRANSFER READINESS", { exact: true })).toBeNull());
  });

  it("starts a long flight route collapsed while keeping transfer readiness visible", () => {
    seedPinnedPlan();
    const library = JSON.parse(localStorage.getItem("wmc-delta-v-library-v1") ?? "null");
    library.plans[0].plan.legs = Array.from({ length: 10 }, (_, index) => ({
      ...plan.legs[index % plan.legs.length],
      id: `long-route-${index + 1}`,
      label: `Long route step ${index + 1}`,
      ...(index === 0 ? {
        kind: "departure",
        transferArcId: "segment-1-primary",
        transferSource: "mechjeb",
      } : {}),
    }));
    localStorage.setItem("wmc-delta-v-library-v1", JSON.stringify(library));

    renderPanel("flight");

    expect(screen.queryByText("PINNED TO THIS CRAFT", { exact: true })).toBeNull();
    expect(screen.getByText("TRANSFER READINESS", { exact: true })).toBeTruthy();
    expect(screen.queryByLabelText("Remaining mission plan steps")).toBeNull();
    const showAll = screen.getByRole("button", { name: "Show all 10 mission steps" });
    expect(showAll.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(showAll);
    expect(screen.getByLabelText("Remaining mission plan steps").children).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Collapse mission steps" }));
    expect(screen.queryByLabelText("Remaining mission plan steps")).toBeNull();
  });
});
