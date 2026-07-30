// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateResonantOrbit, STOCK_BODIES } from "./calculations";
import { ResonantOrbitProvider } from "./state";
import { ResonantOrbitTool } from "./ResonantOrbitTool";

const savedPlan = calculateResonantOrbit({
  body: STOCK_BODIES.Duna,
  satelliteCount: 4,
  targetAltitude: 600_000,
  mode: "raise",
  useOcclusionModifiers: false,
});

describe("resonant orbit tool scene availability", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the planner available in inactive Mission Control scenes", () => {
    render(<ResonantOrbitProvider><ResonantOrbitTool mode="inactive" onOpen={vi.fn()} /></ResonantOrbitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Resonant orbit planner" }));
    expect(screen.getByRole("dialog", { name: "Resonant orbit planner" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Close resonant orbit planner" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Eric Meyer’s original calculator" }).getAttribute("href"))
      .toBe("https://meyerweb.com/eric/ksp/resonant-orbits/");
    expect(screen.getByRole("link", { name: "ResonantOrbitCalculator" }).getAttribute("href"))
      .toBe("https://github.com/linuxgurugamer/ResonantOrbitCalculator");
  });

  it("restores the saved LOS assumption and exposes update versus save-as actions", async () => {
    localStorage.setItem("wmc-resonant-library-v2", JSON.stringify({
      schemaVersion: 4,
      pinnedPlanId: null,
      plans: [{
        id: "saved-duna-ring",
        name: "Duna Relay Ring",
        plan: savedPlan,
        releaseCount: 0,
        saveFolder: "",
        useOcclusionModifiers: false,
        createdAt: "2026-07-19T00:00:00Z",
        updatedAt: "2026-07-19T00:00:00Z",
      }],
    }));
    const user = userEvent.setup();
    render(<ResonantOrbitProvider><ResonantOrbitTool mode="inactive" onOpen={vi.fn()} /></ResonantOrbitProvider>);

    await user.click(screen.getByRole("button", { name: "Resonant orbit planner" }));
    await user.click(screen.getByRole("button", { name: /LOAD SAVED PLANS/ }));
    await user.click(screen.getByRole("button", { name: "Load" }));
    await user.click(screen.getByText("Body data & signal assumptions"));

    expect((screen.getByRole("checkbox", { name: "CommNet occlusion modifiers" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: "UPDATE PLAN" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "SAVE AS NEW" })).toBeTruthy();
  });
});
