// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResonantOrbitTool } from "../resonantOrbit/ResonantOrbitTool";
import { ResonantOrbitProvider } from "../resonantOrbit/state";
import { DeltaVTool } from "./DeltaVTool";
import { catalogBodiesEqual } from "./DeltaVPlanner";
import { PinnedDeltaVPlanPanel } from "./PinnedDeltaVPlanPanel";
import { DeltaVDraftProvider } from "./state";
import { liveTelemetryStore, type LiveTelemetryState } from "../telemetry/store";
import { editorTelemetryFixture } from "../telemetry/fixtures";

describe("live body catalog comparison", () => {
  const body = {
    name: "Duna",
    parent: "Sun",
    semiMajorAxis: 20_726_155_264,
    gravitationalParameter: 3.0136321e11,
    radius: 320_000,
    rotationPeriod: 65_517.9,
    atmosphereDepth: 50_000,
    sphereOfInfluence: 47_921_949,
    atmosphereDensityAltitudes: [0, 50_000],
    atmosphereDensities: [0.067, 0],
  };

  it("invalidates memoized bodies when physical catalog values change", () => {
    expect(catalogBodiesEqual([body], [{ ...body }])).toBe(true);
    expect(catalogBodiesEqual([body], [{ ...body, gravitationalParameter: body.gravitationalParameter * 2 }])).toBe(false);
    expect(catalogBodiesEqual([body], [{ ...body, parent: "Jool" }])).toBe(false);
    expect(catalogBodiesEqual([body], [{ ...body, atmosphereDensities: [0.1, 0] }])).toBe(false);
  });
});

function seedLockedStartDraft(
  storageKey = "wmc-delta-v-draft-v1",
) {
  localStorage.setItem(storageKey, JSON.stringify({
    schemaVersion: 1,
    customSteps: [],
    editingStopId: null,
    marginPercent: 15,
    nextStop: {
      id: "segment-1",
      bodyName: "",
      endpoint: "surface",
      parkingAltitude: 1_000,
      arrivalStrategy: { captureBeforeLanding: false, aerocapture: true, atmosphericLanding: true, assistedLandingReserve: 150 },
      stayDurationDays: 1,
    },
    profileOpen: true,
    selectedPorkchopEvaluations: {},
    selectedTransferSolutions: {},
    start: { bodyName: "Kerbin", endpoint: "surface", parkingAltitude: 80_000 },
    startLocked: true,
    stops: [],
    transferMode: "simple",
  }));
}

describe("delta-v planner drawer", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    localStorage.clear();
    seedLockedStartDraft();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
  });

  it("opens directly from its own side-rail button", () => {
    localStorage.clear();
    render(<ResonantOrbitProvider><ResonantOrbitTool mode="inactive" onOpen={() => undefined} /><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    expect(screen.getByRole("button", { name: "Resonant orbit planner" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delta-v planner" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    expect(screen.getByRole("heading", { name: "Delta-V Mission Planner" })).toBeTruthy();
    expect(screen.queryByText("Total mission budget")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Stock + OPM" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Start" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Next stop" })).toBeNull();
    const launchParkingAltitude = screen.getByRole("spinbutton", { name: "Launch parking altitude" }) as HTMLInputElement;
    expect(launchParkingAltitude.value).toBe("80");
    const addNextStop = screen.getByRole("button", { name: /Add next stop/ }) as HTMLButtonElement;
    expect(addNextStop.disabled).toBe(false);
    expect((screen.getByRole("button", { name: "RESET PLAN" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Offline fallback.*Kerbin surface.*80.0.*km parking orbit$/)).toBeTruthy();
    expect(screen.queryByText("Body model")).toBeNull();
    expect(screen.queryByText("Transfer time")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Add at least one next stop");

    fireEvent.click(addNextStop);
    expect(screen.queryByRole("combobox", { name: "Start" })).toBeNull();
    const nextStop = screen.getByRole("combobox", { name: "Next stop" }) as HTMLSelectElement;
    expect(nextStop.value).toBe("");
    expect(nextStop.selectedOptions[0]?.textContent).toBe("Choose next body…");
    expect((screen.getByRole("button", { name: /Add next stop/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(nextStop, { target: { value: "Duna" } });
    expect(screen.queryByRole("spinbutton", { name: "Next stop parking altitude" })).toBeNull();
    fireEvent.click(screen.getAllByRole("radio", { name: "Parking orbit" })[0]);
    expect(screen.getByRole("spinbutton", { name: "Next stop parking altitude" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));
    expect((screen.getByRole("combobox", { name: "Next stop" }) as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("list", { name: "Committed mission stops" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit stop 1" }).closest(".delta-v-leg")?.textContent).toContain("Capture at Duna");
  });

  it("reads a pre-release working draft from its legacy key", () => {
    localStorage.clear();
    seedLockedStartDraft("wmc-prototype-delta-v-draft-v1");

    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));

    expect(screen.queryByRole("combobox", { name: "Start" })).toBeNull();
    expect(localStorage.getItem("wmc-delta-v-draft-v1")).not.toBeNull();
  });

  it("opens model assumptions from the drawer header", () => {
    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    const opener = screen.getByRole("button", { name: "MODEL ASSUMPTIONS & LIMITS" });
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByRole("dialog", { name: "Model assumptions and limits" })).toBeTruthy();
    expect(screen.getByText(/patched-conic Hohmann transfers/)).toBeTruthy();
    const close = screen.getByRole("button", { name: "Close model assumptions" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Model assumptions and limits" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Delta-V Mission Planner" })).toBeTruthy();
    expect(document.activeElement).toBe(opener);
  });

  it("defaults the setup closed at constrained landscape heights", () => {
    localStorage.clear();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    expect(screen.getByRole("button", { name: /SYSTEM PROFILE & MISSION SETUP/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("preserves the mission draft when drawers close or switch tools", () => {
    render(<ResonantOrbitProvider><ResonantOrbitTool mode="inactive" onOpen={() => undefined} /><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Eve" } });
    fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));
    expect((screen.getByRole("combobox", { name: "Next stop" }) as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });
    fireEvent.click(screen.getByRole("radio", { name: "Parking orbit" }));
    fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));
    expect((screen.getByRole("combobox", { name: "Next stop" }) as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByRole("spinbutton", { name: /Planning margin/ }), { target: { value: "27" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Add custom step after/ })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: /Custom step/ }), { target: { value: "Rendezvous" } });

    fireEvent.click(screen.getByRole("button", { name: "Close delta-v planner" }));
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    expect((screen.getByRole("combobox", { name: "Next stop" }) as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("list", { name: "Committed mission stops" })).toBeNull();
    expect(screen.getByRole("region", { name: "Delta-v route breakdown" }).textContent).toContain("Eve");
    expect(screen.getByRole("region", { name: "Delta-v route breakdown" }).textContent).toContain("Duna");
    expect(screen.getByRole("button", { name: "Edit stop 1" }).closest(".delta-v-leg")?.textContent).toContain("Eve entry → surface");
    expect(screen.getByRole("button", { name: "Edit stop 2" }).closest(".delta-v-leg")?.textContent).toContain("Capture at Duna");
    expect((screen.getByRole("spinbutton", { name: /Planning margin/ }) as HTMLInputElement).value).toBe("27");
    expect((screen.getByRole("textbox", { name: /Custom step/ }) as HTMLInputElement).value).toBe("Rendezvous");

    fireEvent.click(screen.getByRole("button", { name: "Close delta-v planner" }));
    fireEvent.click(screen.getByRole("button", { name: "Resonant orbit planner" }));
    fireEvent.click(screen.getByRole("button", { name: "Close resonant orbit planner" }));
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    expect((screen.getByRole("combobox", { name: "Next stop" }) as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Edit stop 2" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: /Custom step/ }) as HTMLInputElement).value).toBe("Rendezvous");
    expect(screen.getAllByRole("button", { name: "Close delta-v planner" })).toHaveLength(1);
  });

  it("resets the current draft without deleting saved plans", () => {
    render(<ResonantOrbitProvider><DeltaVTool mode="inactive" onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });
    fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /Planning margin/ }), { target: { value: "27" } });
    const planName = screen.getByRole("textbox", { name: "Delta-v plan name" });
    expect(planName.closest(".delta-v-drawer > header")).toBeTruthy();
    fireEvent.change(planName, { target: { value: "Duna Reset Safety" } });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    const reset = screen.getByRole("button", { name: "RESET PLAN" }) as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Update plan" })).toBeTruthy();
    fireEvent.click(reset);
    const confirmation = screen.getByRole("dialog", { name: "Reset current draft?" });
    expect(confirmation.textContent).toContain("Saved plans, pinned craft assignments, and completed mission steps remain available.");
    fireEvent.click(screen.getByRole("button", { name: "KEEP CURRENT PLAN" }));
    expect(screen.getByRole("button", { name: "Edit stop 1" })).toBeTruthy();

    fireEvent.click(reset);
    fireEvent.click(screen.getByRole("button", { name: "RESET CURRENT DRAFT" }));
    expect(screen.queryByRole("dialog", { name: "Reset current draft?" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Start" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Next stop" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Committed mission stops" })).toBeNull();
    expect((screen.getByRole("spinbutton", { name: /Planning margin/ }) as HTMLInputElement).value).toBe("15");
    expect(reset.disabled).toBe(true);

    const loadPlans = screen.getByRole("button", { name: "Load saved plans" });
    expect(loadPlans.textContent).toContain("1");
    fireEvent.click(loadPlans);
    expect(screen.getByRole("dialog", { name: "Saved Delta-V plans" }).textContent).toContain("Duna Reset Safety");
  });

  it("saves, pins, and restores a delta-v mission across a page remount", () => {
    const renderPlanner = () => render(<ResonantOrbitProvider><DeltaVDraftProvider><DeltaVTool mode="editor" onOpen={() => undefined} snapshot={editorTelemetryFixture} /><PinnedDeltaVPlanPanel scene="editor" snapshot={editorTelemetryFixture} /></DeltaVDraftProvider></ResonantOrbitProvider>);
    const view = renderPlanner();
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });
    expect(screen.queryByRole("spinbutton", { name: "Stay at Duna" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Kerbin" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Stay at Duna" }), { target: { value: "4" } });
    expect(screen.queryByRole("spinbutton", { name: "Stay at Kerbin" })).toBeNull();
    expect(screen.queryByText(/Dashboard calendar:/)).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Delta-v plan name" }), { target: { value: "Duna Survey" } });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(screen.getByRole("button", { name: "Update plan" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update plan" }));
    expect(screen.getByRole("status").textContent).toBe("Updated Duna Survey");
    fireEvent.click(screen.getByRole("button", { name: "Save as new" }));
    expect(screen.getByRole("alert").textContent).toContain("already exists");

    const loadPlans = screen.getByRole("button", { name: /Load saved plans/ });
    expect(loadPlans.closest("header")).toBeTruthy();
    expect(loadPlans.closest(".delta-v-controls")).toBeNull();
    loadPlans.focus();
    fireEvent.click(loadPlans);
    expect(screen.getByRole("dialog", { name: "Saved Delta-V plans" }).textContent).toContain("Duna Survey");
    expect(screen.getAllByRole("button", { name: "Load" })).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close saved plans" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Saved Delta-V plans" })).toBeNull();
    expect(document.activeElement).toBe(loadPlans);
    fireEvent.click(loadPlans);
    fireEvent.click(screen.getByRole("button", { name: "Pin to Editor craft" }));
    expect(view.container.querySelector("#editorDeltaVPlan .delta-v-pinned-identity strong")?.textContent).toBe("Duna Survey");
    expect(screen.getAllByText("Kerbin → Duna transfer").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Close saved plans" }));

    view.unmount();
    renderPlanner();
    expect(document.querySelector("#editorDeltaVPlan .delta-v-pinned-identity strong")?.textContent).toBe("Duna Survey");
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    expect((screen.getByRole("combobox", { name: "Next stop" }) as HTMLSelectElement).value).toBe("Kerbin");
    expect((screen.getByRole("spinbutton", { name: "Stay at Duna" }) as HTMLInputElement).value).toBe("4");
    expect(screen.queryByRole("spinbutton", { name: "Stay at Kerbin" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Load saved plans/ }));
    expect(screen.getByRole("dialog", { name: "Saved Delta-V plans" }).textContent).toContain("Duna Survey");
  });

  it("dismisses saved-plan notices after seven seconds", () => {
    vi.useFakeTimers();
    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });
    fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Delta-v plan name" }), { target: { value: "Timed notice" } });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(screen.getByRole("status").textContent).toBe("Saved Timed notice");

    act(() => vi.advanceTimersByTime(6_999));
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("defaults saved plans to the active game save and groups the all-saves view", async () => {
    const renderPlanner = () => render(<ResonantOrbitProvider><DeltaVDraftProvider><DeltaVTool mode="editor" onOpen={() => undefined} snapshot={editorTelemetryFixture} /></DeltaVDraftProvider></ResonantOrbitProvider>);
    const view = renderPlanner();
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Delta-v plan name" }), { target: { value: "Fixture Save Plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    await waitFor(() => {
      const library = JSON.parse(localStorage.getItem("wmc-delta-v-library-v1") ?? "null");
      expect(library.plans[0].saveFolder).toBe("WMC Fixture Save");
    });
    view.unmount();

    const library = JSON.parse(localStorage.getItem("wmc-delta-v-library-v1") ?? "null");
    library.plans.push({
      ...library.plans[0],
      id: "other-save-plan",
      name: "Other Save Plan",
      saveFolder: "Other Career",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    });
    library.plans.push({
      ...library.plans[0],
      id: "unlinked-plan",
      name: "Unlinked Plan",
      saveFolder: "",
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z",
    });
    localStorage.setItem("wmc-delta-v-library-v1", JSON.stringify(library));

    renderPlanner();
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.click(screen.getByRole("button", { name: "Load saved plans" }));
    const dialog = screen.getByRole("dialog", { name: "Saved Delta-V plans" });
    const allSaves = screen.getByRole("checkbox", { name: "LOAD FROM ALL SAVES" }) as HTMLInputElement;

    expect(allSaves.checked).toBe(false);
    expect(dialog.textContent).toContain("Fixture Save Plan");
    expect(dialog.textContent).not.toContain("Other Save Plan");

    fireEvent.click(allSaves);
    expect(dialog.textContent).toContain("Fixture Save Plan");
    expect(dialog.textContent).toContain("Other Save Plan");
    expect(dialog.textContent).toContain("Unlinked Plan");
    expect([...dialog.querySelectorAll(".delta-v-plan-library-group h4")].map((heading) => heading.textContent)).toEqual([
      "UNLINKED",
      "Other Career",
      "WMC Fixture Save",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "LINK ALL TO WMC Fixture Save" }));
    expect(dialog.textContent).not.toContain("UNLINKED");
    fireEvent.click(allSaves);
    expect(dialog.textContent).toContain("Fixture Save Plan");
    expect(dialog.textContent).toContain("Unlinked Plan");
    expect(dialog.textContent).not.toContain("Other Save Plan");
    await waitFor(() => {
      const linkedLibrary = JSON.parse(localStorage.getItem("wmc-delta-v-library-v1") ?? "null");
      expect(linkedLibrary.plans.find((record: { id: string }) => record.id === "unlinked-plan").saveFolder).toBe("WMC Fixture Save");
      expect(linkedLibrary.plans.find((record: { id: string }) => record.id === "other-save-plan").saveFolder).toBe("Other Career");
    });
  });

  it("offers to recover unlinked plans directly from an empty current-save view", async () => {
    const renderPlanner = () => render(<ResonantOrbitProvider><DeltaVDraftProvider><DeltaVTool mode="editor" onOpen={() => undefined} snapshot={editorTelemetryFixture} /></DeltaVDraftProvider></ResonantOrbitProvider>);
    const initial = renderPlanner();
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Delta-v plan name" }), { target: { value: "Unlinked Plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("wmc-delta-v-library-v1") ?? "null").plans).toHaveLength(1));
    initial.unmount();
    const unlinkedLibrary = JSON.parse(localStorage.getItem("wmc-delta-v-library-v1") ?? "null");
    unlinkedLibrary.plans[0].saveFolder = "";
    localStorage.setItem("wmc-delta-v-library-v1", JSON.stringify(unlinkedLibrary));

    renderPlanner();
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.click(screen.getByRole("button", { name: "Load saved plans" }));

    const recovery = screen.getByRole("button", { name: "LINK 1 UNLINKED PLAN TO WMC Fixture Save" });
    fireEvent.click(recovery);
    expect(screen.getByRole("dialog", { name: "Saved Delta-V plans" }).textContent).toContain("Unlinked Plan");
    await waitFor(() => {
      const library = JSON.parse(localStorage.getItem("wmc-delta-v-library-v1") ?? "null");
      expect(library.plans[0].saveFolder).toBe("WMC Fixture Save");
    });
  });

  it("rejects a parking orbit inside the atmosphere", () => {
    localStorage.clear();
    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.click(screen.getByRole("radio", { name: "Parking orbit" }));
    const originAltitude = screen.getByRole("spinbutton", { name: "Start parking altitude" });
    fireEvent.change(originAltitude, { target: { value: "10" } });

    expect(document.getElementById("start-parking-altitude-help")?.textContent).toBe("Minimum valid orbit is 71.0\u2009km");
    expect(originAltitude.getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByText("Total mission budget")).toBeNull();
    expect(screen.queryByRole("button", { name: "Calculate ideal windows" })).toBeNull();

    fireEvent.change(originAltitude, { target: { value: "71" } });
    expect(originAltitude.getAttribute("aria-invalid")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });
    expect(screen.getByText("Total mission budget")).toBeTruthy();
  });

  it("rejects a surface launch parking orbit inside the atmosphere", () => {
    localStorage.clear();
    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));

    const originAltitude = screen.getByRole("spinbutton", { name: "Launch parking altitude" });
    fireEvent.change(originAltitude, { target: { value: "10" } });
    expect(document.getElementById("launch-parking-altitude-help")?.textContent).toBe("Minimum valid orbit is 71.0\u2009km");
    expect(originAltitude.getAttribute("aria-invalid")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });

    expect(screen.queryByText("Total mission budget")).toBeNull();
    expect(screen.queryByRole("button", { name: "Calculate ideal windows" })).toBeNull();
  });

  it("lets a surface start choose its launch parking orbit without a same-body stop", () => {
    localStorage.clear();
    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));

    const altitude = screen.getByRole("spinbutton", { name: "Launch parking altitude" });
    fireEvent.change(altitude, { target: { value: "100" } });
    expect(screen.getByText(/Offline fallback.*Kerbin surface.*100.*km parking orbit$/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });

    expect(screen.getByText("Total mission budget")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit stop 1" })).toBeNull();
  });

  it("collapses the mission profile into a compact route summary", () => {
    localStorage.clear();
    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    const profileToggle = screen.getByRole("button", { name: /SYSTEM PROFILE & MISSION SETUP/ });

    expect(profileToggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Start" })).toBeTruthy();
    fireEvent.click(profileToggle);

    expect(profileToggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("combobox", { name: "Start" })).toBeNull();
    expect(profileToggle.textContent).toContain("Offline fallback");
    expect(profileToggle.textContent).toContain("Kerbin surface");
    expect(profileToggle.textContent).not.toContain("Mun surface");
    expect(screen.queryByRole("region", { name: "Delta-v route breakdown" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Add at least one next stop");
  });

  it("places atmospheric choices on the affected route steps", () => {
    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });
    fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Kerbin" } });
    fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));

    expect(screen.getByText("Direct atmospheric arrival at Kerbin")).toBeTruthy();
    const captureFirst = screen.getAllByRole("checkbox", { name: "Capture orbit before landing" }).at(-1)!;
    expect((captureFirst as HTMLInputElement).checked).toBe(false);
    fireEvent.click(captureFirst);

    expect(screen.getByText(/Capture at Kerbin$/)).toBeTruthy();
    expect(screen.getByText("Deorbit at Kerbin")).toBeTruthy();
    expect((screen.getAllByRole("checkbox", { name: "Aerobrake capture" }).at(-1) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("spinbutton", { name: "Aerocapture circularization reserve" })).toBeNull();
    expect(screen.getByText(/Capture at Kerbin$/).closest("article")?.textContent).toMatch(/Reference aerocapture|powered-capture reserve/);
    const aerobrakingAdvisories = screen.getByText("Aerobraking is craft-dependent.").closest(".delta-v-leg-advisories");
    expect(aerobrakingAdvisories?.textContent).toContain("Thermal Protection Recommended");
    expect(aerobrakingAdvisories?.querySelectorAll("small")).toHaveLength(2);
    expect((screen.getAllByRole("checkbox", { name: "Atmospheric descent + chutes" }).at(-1) as HTMLInputElement).checked).toBe(true);
    expect((screen.getAllByRole("spinbutton", { name: "Arrival assisted landing reserve" }).at(-1) as HTMLInputElement).value).toBe("150");
  });

  it("warns when an editor craft has no detected thermal protection", () => {
    vi.spyOn(liveTelemetryStore, "getSnapshot").mockReturnValue({
      endpoint: "ws://127.0.0.1:8090", frameCount: 1, lastFrameAt: Date.now(), status: "linked",
      snapshot: { "context.mode": "editor", "editor.summaryAvailable": true, "editor.res.names": [] },
    });
    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });
    fireEvent.click(screen.getByRole("radio", { name: "Parking orbit" }));

    expect(screen.getByText("No thermal protection detected. Aerobraking may be risky.")).toBeTruthy();
    expect(screen.queryByText("Thermal Protection Recommended")).toBeNull();
  });

  it("suppresses the advisory when the referenced craft carries ablator", () => {
    vi.spyOn(liveTelemetryStore, "getSnapshot").mockReturnValue({
      endpoint: "ws://127.0.0.1:8090", frameCount: 1, lastFrameAt: Date.now(), status: "linked",
      snapshot: {
        "context.mode": "editor",
        "editor.summaryAvailable": true,
        "editor.res.names": ["Ablator"],
        "editor.resMax[Ablator]": 200,
      },
    });
    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });
    fireEvent.click(screen.getByRole("radio", { name: "Parking orbit" }));

    expect(screen.queryByText("No thermal protection detected. Aerobraking may be risky.")).toBeNull();
    expect(screen.queryByText("Thermal Protection Recommended")).toBeNull();
    expect(screen.getByText("Aerobraking is craft-dependent.")).toBeTruthy();
  });

  it("switches from sequential ideal planning to persistent per-leg porkchops", () => {
    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });

    expect((screen.getByRole("radio", { name: "Simple" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("button", { name: "PORKCHOP" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Advanced" }));
    expect(screen.getByRole("button", { name: "PORKCHOP" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Calculate ideal windows" })).toBeNull();
    expect(screen.getByText(/Advanced: per-leg porkchops/)).toBeTruthy();
    expect(screen.getByText("User-selected reserve")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close delta-v planner" }));
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    expect((screen.getByRole("radio", { name: "Advanced" }) as HTMLInputElement).checked).toBe(true);
  });

  it("adds and edits a custom estimate between route steps", () => {
    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Mun" } });
    fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add custom step after Kerbin surface → 80.0\u2009km orbit" }));

    const name = screen.getByRole("textbox", { name: "Custom step 2 name" });
    fireEvent.change(name, { target: { value: "Rendezvous" } });
    const estimate = screen.getByRole("spinbutton", { name: "Rendezvous estimate" });
    fireEvent.change(estimate, { target: { value: "250" } });

    expect((name as HTMLInputElement).value).toBe("Rendezvous");
    expect((estimate as HTMLInputElement).value).toBe("250");
    expect(screen.getByRole("button", { name: "Remove Rendezvous" })).toBeTruthy();
  });

  it("starts an explicit read-only MechJeb search for an eligible ideal transfer", () => {
    const telemetryState = {
      endpoint: "ws://127.0.0.1:8090",
      frameCount: 1,
      lastFrameAt: Date.now(),
      status: "linked" as const,
      snapshot: {
        "context.mode": "inactive" as const,
        "mj.transfer.available": true,
        "mj.transfer.compatibilityReady": true,
        "mj.transfer.state": "idle" as const,
      },
    };
    vi.spyOn(liveTelemetryStore, "getSnapshot").mockReturnValue(telemetryState);
    const send = vi.spyOn(liveTelemetryStore, "send").mockReturnValue(true);

    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });
    const calculateWindows = screen.getByRole("button", { name: "Calculate ideal windows" });
    expect(screen.getByText("MISSION ROUTE").closest("header")?.contains(calculateWindows)).toBe(true);
    expect(screen.queryByRole("region", { name: "MechJeb transfer calculation" })).toBeNull();
    fireEvent.click(calculateWindows);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "mechjeb.transfer.start",
      origin: "Kerbin",
      destination: "Duna",
      originParkingAltitude: 80_000,
      optimizePoweredCapture: false,
    }));
    expect(screen.getByText(/CALCULATING 1\/1/)).toBeTruthy();
  });

  it("dates every interplanetary leg in sequence and advances across local Hohmann legs", async () => {
    const listeners: Array<() => void> = [];
    let telemetryState: LiveTelemetryState = {
      endpoint: "ws://127.0.0.1:8090",
      frameCount: 1,
      lastFrameAt: Date.now(),
      status: "linked",
      snapshot: { "context.mode": "inactive", "mj.transfer.available": true, "mj.transfer.compatibilityReady": true, "mj.transfer.state": "idle" },
    };
    vi.spyOn(liveTelemetryStore, "getSnapshot").mockImplementation(() => telemetryState);
    vi.spyOn(liveTelemetryStore, "subscribe").mockImplementation((listener) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1).length > 0;
    });
    const send = vi.spyOn(liveTelemetryStore, "send").mockReturnValue(true);
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce("jool-outbound").mockReturnValueOnce("kerbin-return") });

    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    const addOrbitStop = (bodyName: string) => {
      fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: bodyName } });
      const parkingChoices = screen.getAllByRole("radio", { name: "Parking orbit" });
      const builderParking = parkingChoices.at(-1)!;
      if (!(builderParking as HTMLInputElement).checked) fireEvent.click(builderParking);
      fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));
    };
    addOrbitStop("Jool");
    addOrbitStop("Laythe");
    addOrbitStop("Vall");
    addOrbitStop("Jool");
    addOrbitStop("Kerbin");

    expect(screen.queryAllByRole("button", { name: "PORKCHOP" })).toHaveLength(0);
    fireEvent.click(screen.getByRole("radio", { name: "Advanced" }));
    expect(screen.getAllByRole("button", { name: "PORKCHOP" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: "Simple" }));
    fireEvent.click(screen.getByRole("button", { name: "Calculate ideal windows" }));
    const outboundStart = send.mock.calls.map(([command]) => command).find((command) => command.type === "mechjeb.transfer.start");
    if (!outboundStart || outboundStart.type !== "mechjeb.transfer.start") throw new Error("Expected the Jool outbound request.");

    telemetryState = {
      ...telemetryState,
      frameCount: 2,
      snapshot: {
        "context.mode": "inactive",
        "mj.transfer.available": true,
        "mj.transfer.compatibilityReady": true,
        "mj.transfer.state": "completed",
        "mj.transfer.requestId": "jool-outbound",
        "mj.transfer.fingerprint": outboundStart.fingerprint,
        "mj.transfer.departureUT": 1_000_000,
        "mj.transfer.arrivalUT": 2_000_000,
        "mj.transfer.transferTime": 1_000_000,
        "mj.transfer.ejectionDeltaV": 2_100,
        "mj.transfer.arrivalVInfinity": 2_300,
        "mj.transfer.departureVInfinityX": 321,
        "mj.transfer.departureVInfinityY": -654,
        "mj.transfer.departureVInfinityZ": 987,
        "mj.transfer.maneuverVectorSchema": 1,
      },
    };
    await act(async () => listeners.forEach((listener) => listener()));
    await waitFor(() => expect(send.mock.calls.filter(([command]) => command.type === "mechjeb.transfer.start")).toHaveLength(2));
    const returnStart = send.mock.calls.map(([command]) => command).filter((command) => command.type === "mechjeb.transfer.start").at(-1);
    if (!returnStart || returnStart.type !== "mechjeb.transfer.start") throw new Error("Expected the Kerbin return request.");
    expect(returnStart).toMatchObject({ requestId: "kerbin-return", origin: "Jool", destination: "Kerbin" });
    expect(returnStart.earliestDepartureUT).toBeGreaterThan(2_000_000);
    expect(screen.getAllByText("HOHMANN").length).toBeGreaterThan(0);

    const returnDepartureUT = Number(returnStart.earliestDepartureUT) + 1_000;
    telemetryState = {
      ...telemetryState,
      frameCount: 3,
      snapshot: {
        "context.mode": "inactive",
        "mj.transfer.available": true,
        "mj.transfer.compatibilityReady": true,
        "mj.transfer.state": "completed",
        "mj.transfer.requestId": "kerbin-return",
        "mj.transfer.fingerprint": returnStart.fingerprint,
        "mj.transfer.departureUT": returnDepartureUT,
        "mj.transfer.arrivalUT": returnDepartureUT + 1_000_000,
        "mj.transfer.transferTime": 1_000_000,
        "mj.transfer.ejectionDeltaV": 2_800,
        "mj.transfer.arrivalVInfinity": 1_900,
        "mj.transfer.departureVInfinityX": -123,
        "mj.transfer.departureVInfinityY": 456,
        "mj.transfer.departureVInfinityZ": -789,
        "mj.transfer.maneuverVectorSchema": 1,
      },
    };
    await act(async () => listeners.forEach((listener) => listener()));
    await waitFor(() => expect(screen.getByRole("button", { name: "Recalculate ideal windows" })).toBeTruthy());
    const routeHeader = screen.getByText("MISSION ROUTE").closest("header");
    expect(routeHeader?.contains(screen.getByRole("button", { name: "Recalculate ideal windows" }))).toBe(true);
    expect(screen.queryByText("INTERPLANETARY WINDOWS")).toBeNull();
    expect(routeHeader?.textContent).toContain("First departY1");
    expect(routeHeader?.textContent).toMatch(/Final arriveY\d+/);
    expect(routeHeader?.textContent).toMatch(/Mission time\d+d \d+h/);
    expect(screen.getByRole("heading", { name: "Kerbin round trip" })).toBeTruthy();
    expect(screen.getByText(/5 mission stops · 0 surface stops ·/)).toBeTruthy();
    expect(screen.getByText("No surface stops")).toBeTruthy();
    expect(screen.getByText("Ideal phase")).toBeTruthy();
    expect(screen.getAllByText("CALCULATED STAY").length).toBeGreaterThan(0);
    expect(screen.getByText(/window wait/)).toBeTruthy();
    expect(screen.getByText(/Capture at Kerbin/).closest(".delta-v-leg")?.querySelector(".delta-v-leg-timeline")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    const savedSolutions = Object.values(
      JSON.parse(localStorage.getItem("wmc-delta-v-library-v1") ?? "null").plans[0].draft.selectedTransferSolutions,
    );
    expect(savedSolutions).toEqual(expect.arrayContaining([
      expect.objectContaining({ departureVInfinity: [321, -654, 987], maneuverVectorSchema: 1 }),
      expect.objectContaining({ departureVInfinity: [-123, 456, -789], maneuverVectorSchema: 1 }),
    ]));
  });

  it("keeps sequential calculation in Simple and exposes eligible porkchops in Advanced", () => {
    vi.spyOn(liveTelemetryStore, "getSnapshot").mockReturnValue({
      endpoint: "ws://127.0.0.1:8090", frameCount: 1, lastFrameAt: Date.now(), status: "linked",
      snapshot: { "context.mode": "flight", "mj.transfer.available": true, "mj.transfer.compatibilityReady": true, "mj.transfer.state": "idle" },
    });
    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });
    expect(screen.getByRole("button", { name: "Calculate ideal windows" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Advanced" }));

    expect(screen.queryByRole("button", { name: "Calculate ideal windows" })).toBeNull();
    expect(screen.getByRole("button", { name: "PORKCHOP" })).toBeTruthy();
  });

  it("opens a porkchop plot from the modeled transfer route step", () => {
    vi.spyOn(liveTelemetryStore, "getSnapshot").mockReturnValue({
      endpoint: "ws://127.0.0.1:8090", frameCount: 1, lastFrameAt: Date.now(), status: "linked",
      snapshot: { "context.mode": "editor", "mj.transfer.available": true, "mj.transfer.compatibilityReady": true, "mj.transfer.state": "idle" },
    });
    const send = vi.spyOn(liveTelemetryStore, "send").mockReturnValue(true);
    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });
    fireEvent.click(screen.getByRole("radio", { name: "Advanced" }));
    const opener = screen.getByRole("button", { name: "PORKCHOP" });
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByRole("dialog", { name: "Kerbin to Duna porkchop plot" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close porkchop plot" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate porkchop plot" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "mechjeb.transfer.start",
      origin: "Kerbin",
      destination: "Duna",
    }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Kerbin to Duna porkchop plot" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Delta-V Mission Planner" })).toBeTruthy();
    expect(document.activeElement).toBe(opener);
  });

  it("preserves a selected porkchop transfer when the drawer closes", async () => {
    const listeners: Array<() => void> = [];
    let telemetryState: LiveTelemetryState = {
      endpoint: "ws://127.0.0.1:8090",
      frameCount: 1,
      lastFrameAt: Date.now(),
      status: "linked",
      snapshot: { "context.mode": "editor", "mj.transfer.available": true, "mj.transfer.compatibilityReady": true, "mj.transfer.state": "idle" },
    };
    vi.spyOn(liveTelemetryStore, "getSnapshot").mockImplementation(() => telemetryState);
    vi.spyOn(liveTelemetryStore, "subscribe").mockImplementation((listener) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1).length > 0;
    });
    const send = vi.spyOn(liveTelemetryStore, "send").mockReturnValue(true);
    vi.stubGlobal("crypto", { randomUUID: () => "persisted-transfer" });

    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} snapshot={editorTelemetryFixture} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });
    fireEvent.click(screen.getByRole("radio", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: "PORKCHOP" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate porkchop plot" }));
    const startCommand = send.mock.calls.map(([command]) => command).find((command) => command.type === "mechjeb.transfer.start");
    if (!startCommand || startCommand.type !== "mechjeb.transfer.start") throw new Error("Expected a transfer request.");

    telemetryState = {
      ...telemetryState,
      frameCount: 2,
      snapshot: {
        "context.mode": "editor",
        "mj.transfer.available": true,
        "mj.transfer.compatibilityReady": true,
        "mj.transfer.state": "completed",
        "mj.transfer.requestId": "persisted-transfer",
        "mj.transfer.fingerprint": startCommand.fingerprint,
        "mj.transfer.departureUT": 1_000_000,
        "mj.transfer.arrivalUT": 2_000_000,
        "mj.transfer.transferTime": 1_000_000,
        "mj.transfer.ejectionDeltaV": 1_050,
        "mj.transfer.arrivalVInfinity": 620,
        "mj.transfer.grid.published": true,
        "mj.transfer.grid.requestId": "persisted-transfer",
        "mj.transfer.grid.fingerprint": startCommand.fingerprint,
        "mj.transfer.grid.dateSamples": 1,
        "mj.transfer.grid.durationSamples": 1,
        "mj.transfer.grid.departureUTs": [1_000_000],
        "mj.transfer.grid.transferTimes": [1_000_000],
        "mj.transfer.grid.costs": [1_670],
        "mj.transfer.grid.bestDepartureIndex": 0,
        "mj.transfer.grid.bestTransferTimeIndex": 0,
        "mj.transfer.evaluation.requestId": "persisted-transfer",
        "mj.transfer.evaluation.fingerprint": startCommand.fingerprint,
        "mj.transfer.evaluation.departureIndex": 0,
        "mj.transfer.evaluation.transferTimeIndex": 0,
        "mj.transfer.evaluation.departureUT": 1_000_000,
        "mj.transfer.evaluation.arrivalUT": 2_000_000,
        "mj.transfer.evaluation.transferTime": 1_000_000,
        "mj.transfer.evaluation.ejectionDeltaV": 1_050,
        "mj.transfer.evaluation.arrivalVInfinity": 620,
        "mj.transfer.evaluation.rawCost": 1_670,
      },
    };
    await act(async () => listeners.forEach((listener) => listener()));
    const useTransfer = await screen.findByRole("button", { name: "Use this transfer" });
    await waitFor(() => expect((useTransfer as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(useTransfer);
    expect(screen.getAllByText("MECHJEB").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));
    expect((screen.getByRole("combobox", { name: "Next stop" }) as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Edit stop 1" })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("MECHJEB").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Kerbin" } });
    fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));
    expect((screen.getByRole("combobox", { name: "Next stop" }) as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Edit stop 2" })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("MECHJEB").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Remove stop 2" }));
    await waitFor(() => expect(screen.getAllByText("MECHJEB").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("checkbox", { name: "Capture orbit before landing" }));
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "Capture orbit before landing" }) as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByRole("checkbox", { name: "Aerobrake capture" }));
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "Aerobrake capture" }) as HTMLInputElement).checked).toBe(false));
    await waitFor(() => expect(screen.getAllByText("MECHJEB").length).toBeGreaterThan(0));
    expect(screen.getByText("1,050 m/s")).toBeTruthy();
    expect(screen.getByText(/Capture at Duna$/).closest("article")?.textContent).not.toContain("0 m/s");

    fireEvent.click(screen.getByRole("button", { name: "PORKCHOP" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate porkchop plot" })).toBeTruthy());
    expect(screen.queryByText("SELECTED")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Generate porkchop plot" }));
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "mechjeb.transfer.start",
      optimizePoweredCapture: true,
    }));
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Close delta-v planner" }));
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    expect(screen.getAllByText("MECHJEB").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Depart Y1, D47/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Edit stop 1" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Edit stop" }), { target: { value: "Eve" } });
    fireEvent.click(screen.getByRole("button", { name: "Update stop" }));
    await waitFor(() => expect(screen.queryAllByText("MECHJEB")).toHaveLength(0));
  });

  it("applies a selected point and unlocks the next serial porkchop", async () => {
    const listeners: Array<() => void> = [];
    let telemetryState: LiveTelemetryState = {
      endpoint: "ws://127.0.0.1:8090",
      frameCount: 1,
      lastFrameAt: Date.now(),
      status: "linked",
      snapshot: { "context.mode": "inactive", "mj.transfer.available": true, "mj.transfer.compatibilityReady": true, "mj.transfer.state": "idle" },
    };
    vi.spyOn(liveTelemetryStore, "getSnapshot").mockImplementation(() => telemetryState);
    vi.spyOn(liveTelemetryStore, "subscribe").mockImplementation((listener) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1).length > 0;
    });
    const send = vi.spyOn(liveTelemetryStore, "send").mockReturnValue(true);
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce("outbound-request").mockReturnValueOnce("return-request") });

    render(<ResonantOrbitProvider><DeltaVTool onOpen={() => undefined} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Delta-v planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Duna" } });
    fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));
    expect((screen.getByRole("combobox", { name: "Next stop" }) as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByRole("combobox", { name: "Next stop" }), { target: { value: "Kerbin" } });
    fireEvent.click(screen.getByRole("button", { name: /Add next stop/ }));
    expect((screen.getByRole("combobox", { name: "Next stop" }) as HTMLSelectElement).value).toBe("");
    fireEvent.click(screen.getByRole("radio", { name: "Advanced" }));
    const initialPorkchopButtons = screen.getAllByRole("button", { name: "PORKCHOP" });
    expect(initialPorkchopButtons).toHaveLength(2);
    fireEvent.click(initialPorkchopButtons[0]);
    fireEvent.click(screen.getByRole("button", { name: "Generate porkchop plot" }));
    const outboundStart = send.mock.calls.map(([command]) => command).find((command) => command.type === "mechjeb.transfer.start");
    if (!outboundStart || outboundStart.type !== "mechjeb.transfer.start") throw new Error("Expected an outbound transfer request.");

    telemetryState = {
      ...telemetryState,
      frameCount: 2,
      snapshot: {
        "context.mode": "inactive",
        "mj.transfer.available": true,
        "mj.transfer.compatibilityReady": true,
        "mj.transfer.state": "completed",
        "mj.transfer.requestId": "outbound-request",
        "mj.transfer.fingerprint": outboundStart.fingerprint,
        "mj.transfer.departureUT": 1_000_000,
        "mj.transfer.arrivalUT": 2_000_000,
        "mj.transfer.transferTime": 1_000_000,
        "mj.transfer.ejectionDeltaV": 1_050,
        "mj.transfer.arrivalVInfinity": 620,
        "mj.transfer.grid.published": true,
        "mj.transfer.grid.requestId": "outbound-request",
        "mj.transfer.grid.fingerprint": outboundStart.fingerprint,
        "mj.transfer.grid.dateSamples": 1,
        "mj.transfer.grid.durationSamples": 1,
        "mj.transfer.grid.departureUTs": [1_000_000],
        "mj.transfer.grid.transferTimes": [1_000_000],
        "mj.transfer.grid.costs": [1_670],
        "mj.transfer.grid.bestDepartureIndex": 0,
        "mj.transfer.grid.bestTransferTimeIndex": 0,
        "mj.transfer.evaluation.requestId": "outbound-request",
        "mj.transfer.evaluation.fingerprint": outboundStart.fingerprint,
        "mj.transfer.evaluation.departureIndex": 0,
        "mj.transfer.evaluation.transferTimeIndex": 0,
        "mj.transfer.evaluation.departureUT": 1_000_000,
        "mj.transfer.evaluation.arrivalUT": 2_000_000,
        "mj.transfer.evaluation.transferTime": 1_000_000,
        "mj.transfer.evaluation.ejectionDeltaV": 1_050,
        "mj.transfer.evaluation.arrivalVInfinity": 620,
        "mj.transfer.evaluation.rawCost": 1_670,
      },
    };
    await act(async () => listeners.forEach((listener) => listener()));
    const useTransfer = await screen.findByRole("button", { name: "Use this transfer" });
    await waitFor(() => expect((useTransfer as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(useTransfer);

    expect(screen.getByText("1,050 m/s")).toBeTruthy();
    const updatedPorkchopButtons = screen.getAllByRole("button", { name: "PORKCHOP" });
    expect(updatedPorkchopButtons).toHaveLength(2);
    expect(updatedPorkchopButtons[0].closest("article")?.textContent).toContain("Kerbin → Duna transfer");
    expect(updatedPorkchopButtons[0].closest("article")?.textContent).toContain("1,050 m/s");
    expect((screen.getByRole("spinbutton", { name: "Stay at Duna" }) as HTMLInputElement).value).toBe("1");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Stay at Duna" }), { target: { value: "3" } });
    fireEvent.click(updatedPorkchopButtons[1]);
    expect(screen.getByText(/Departures begin after the preceding arrival and stay/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Generate porkchop plot" }));

    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "mechjeb.transfer.start",
      requestId: "return-request",
      origin: "Duna",
      destination: "Kerbin",
      earliestDepartureUT: 2_064_800,
    }));

    const returnStart = send.mock.calls.map(([command]) => command).find((command) => command.type === "mechjeb.transfer.start" && command.requestId === "return-request");
    if (!returnStart || returnStart.type !== "mechjeb.transfer.start") throw new Error("Expected a return transfer request.");
    telemetryState = {
      ...telemetryState,
      frameCount: 3,
      snapshot: {
        "context.mode": "inactive",
        "mj.transfer.available": true,
        "mj.transfer.compatibilityReady": true,
        "mj.transfer.state": "completed",
        "mj.transfer.requestId": "return-request",
        "mj.transfer.fingerprint": returnStart.fingerprint,
        "mj.transfer.departureUT": 2_100_000,
        "mj.transfer.arrivalUT": 3_100_000,
        "mj.transfer.transferTime": 1_000_000,
        "mj.transfer.ejectionDeltaV": 900,
        "mj.transfer.arrivalVInfinity": 580,
        "mj.transfer.grid.published": true,
        "mj.transfer.grid.requestId": "return-request",
        "mj.transfer.grid.fingerprint": returnStart.fingerprint,
        "mj.transfer.grid.dateSamples": 1,
        "mj.transfer.grid.durationSamples": 1,
        "mj.transfer.grid.departureUTs": [2_100_000],
        "mj.transfer.grid.transferTimes": [1_000_000],
        "mj.transfer.grid.costs": [1_480],
        "mj.transfer.grid.bestDepartureIndex": 0,
        "mj.transfer.grid.bestTransferTimeIndex": 0,
        "mj.transfer.evaluation.requestId": "return-request",
        "mj.transfer.evaluation.fingerprint": returnStart.fingerprint,
        "mj.transfer.evaluation.departureIndex": 0,
        "mj.transfer.evaluation.transferTimeIndex": 0,
        "mj.transfer.evaluation.departureUT": 2_100_000,
        "mj.transfer.evaluation.arrivalUT": 3_100_000,
        "mj.transfer.evaluation.transferTime": 1_000_000,
        "mj.transfer.evaluation.ejectionDeltaV": 900,
        "mj.transfer.evaluation.arrivalVInfinity": 580,
        "mj.transfer.evaluation.rawCost": 1_480,
      },
    };
    await act(async () => listeners.forEach((listener) => listener()));
    const useReturnTransfer = await screen.findByRole("button", { name: "Use this transfer" });
    await waitFor(() => expect((useReturnTransfer as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(useReturnTransfer);

    await waitFor(() => expect(screen.queryByText("INCOMPLETE")).toBeNull());
    expect((screen.getByRole("button", { name: "Save plan" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Stay at Duna" }), { target: { value: "10" } });

    await waitFor(() => {
      const transferButtons = screen.getAllByRole("button", { name: "PORKCHOP" });
      expect(transferButtons[0].closest("article")?.textContent).toContain("1,050 m/s");
      expect(transferButtons[1].closest("article")?.textContent).toContain("INCOMPLETE");
      expect(transferButtons[1].closest("article")?.textContent).not.toContain("900 m/s");
    });
    expect(screen.getByText("Total mission budget").parentElement?.textContent).toContain("INCOMPLETE");
    expect(screen.getByText("Nominal route").parentElement?.textContent).toContain("INCOMPLETE");
    expect(screen.getByText("Margin").parentElement?.textContent).toContain("INCOMPLETE");
    expect((screen.getByRole("button", { name: "Save plan" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
