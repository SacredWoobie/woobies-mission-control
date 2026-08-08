// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TelemetrySnapshot } from "../telemetry/types";
import { PinnedResonantOrbitPanel } from "./PinnedResonantOrbitPanel";
import { STOCK_BODIES, calculateResonantOrbit } from "./calculations";
import { ResonantOrbitProvider, useResonantOrbitState } from "./state";

function DrawerState() {
  const { activeSavedPlanId, drawerOpen } = useResonantOrbitState();
  return <><output data-testid="drawer-state">{drawerOpen ? "open" : "closed"}</output><output data-testid="active-plan">{activeSavedPlanId ?? "none"}</output></>;
}

describe("pinned resonant orbit panel", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it("restores a locally pinned plan into the Flight panel", () => {
    const plan = calculateResonantOrbit({ body: STOCK_BODIES.Minmus, satelliteCount: 3, targetAltitude: 100_000, mode: "raise" });
    localStorage.setItem("wmc-prototype-resonant-plan-v1", JSON.stringify({ plan, releaseCount: 1, pinnedAt: "2026-07-19T00:00:00Z" }));
    const snapshot = {
      "context.mode": "flight",
      "v.body": "Minmus",
      "o.ApA": plan.carrierApoapsis,
      "o.PeA": plan.carrierPeriapsis,
    } as TelemetrySnapshot;

    render(<ResonantOrbitProvider><PinnedResonantOrbitPanel snapshot={snapshot} /></ResonantOrbitProvider>);
    expect(screen.getByText("Minmus 4:3 raise orbit")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.textContent === "168\u2009km")).toBeTruthy();
    expect(screen.getAllByText("IN RANGE")).toHaveLength(2);
    expect(screen.queryByText(/^NOW /)).toBeNull();
    expect(screen.getByLabelText("Target Ap in range").title).toContain("tolerance ±");
    expect(screen.getByText("1 / 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark satellite released" })).toBeTruthy();
    expect(screen.getByText("Release at periapsis")).toBeTruthy();
  });

  it("marks live carrier endpoints low or high outside their target tolerances", () => {
    const plan = calculateResonantOrbit({ body: STOCK_BODIES.Kerbin, satelliteCount: 3, targetAltitude: 2_500_000, mode: "raise" });
    localStorage.setItem("wmc-prototype-resonant-plan-v1", JSON.stringify({ plan, releaseCount: 0, pinnedAt: "2026-07-19T00:00:00Z" }));
    const snapshot = {
      "context.mode": "flight",
      "v.body": "Kerbin",
      "o.ApA": plan.carrierApoapsis - 3_000,
      "o.PeA": plan.carrierPeriapsis + 2_000,
    } as TelemetrySnapshot;

    render(<ResonantOrbitProvider><PinnedResonantOrbitPanel snapshot={snapshot} /></ResonantOrbitProvider>);

    expect(screen.getByText("LOW")).toBeTruthy();
    expect(screen.getByText("HIGH")).toBeTruthy();
    expect(screen.getByLabelText("Target Ap low")).toBeTruthy();
    expect(screen.getByLabelText("Target Pe high")).toBeTruthy();
  });

  it("renders the Editor plan card and opens the pinned record for editing", () => {
    const plan = calculateResonantOrbit({ body: STOCK_BODIES.Duna, satelliteCount: 4, targetAltitude: 600_000, mode: "raise" });
    localStorage.setItem("wmc-resonant-library-v2", JSON.stringify({
      schemaVersion: 2,
      pinnedPlanId: "editor-plan",
      plans: [{ id: "editor-plan", name: "Duna Editor Relay", plan, releaseCount: 0, createdAt: "2026-07-19T00:00:00Z", updatedAt: "2026-07-19T00:00:00Z" }],
    }));

    const view = render(
      <ResonantOrbitProvider>
        <PinnedResonantOrbitPanel scene="editor" />
        <DrawerState />
      </ResonantOrbitProvider>,
    );

    expect(view.container.querySelector("#editorOrbitPlan")).toBeTruthy();
    expect(screen.getByText("Resonant Orbit Plan")).toBeTruthy();
    expect(screen.getByText("Duna Editor Relay")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("Satellites")).toBeTruthy();
    expect(screen.getByText("Duna")).toBeTruthy();
    expect(screen.getByText("Carrier Ap")).toBeTruthy();
    expect(screen.getByText("Carrier Pe")).toBeTruthy();
    expect(screen.getByText("Resonance")).toBeTruthy();
    expect(screen.getByText("5:4 raise")).toBeTruthy();
    expect(screen.getByText("Injection Δv")).toBeTruthy();
    expect(screen.getByText("Carrier period")).toBeTruthy();
    expect(screen.getByText("Release at")).toBeTruthy();
    expect(screen.getByText("Profile nominal")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide Duna Editor Relay panel" })).toBeNull();
    expect(screen.queryByText("Saved")).toBeNull();
    expect(screen.queryByText("Deployment tracking")).toBeNull();
    expect(screen.queryByText("0 / 4")).toBeNull();
    expect(screen.queryByText("Release at apoapsis")).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark previous satellite" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark satellite released" })).toBeNull();

    expect(screen.getByTestId("drawer-state").textContent).toBe("closed");
    expect(screen.getByTestId("active-plan").textContent).toBe("none");
    expect(screen.queryByRole("button", { name: "Open planner" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit plan" }));
    expect(screen.getByTestId("drawer-state").textContent).toBe("open");
    expect(screen.getByTestId("active-plan").textContent).toBe("editor-plan");
  });

  it("names the warning reasons in the Editor status footer", () => {
    const warningPlan = calculateResonantOrbit({ body: STOCK_BODIES.Kerbin, satelliteCount: 3, targetAltitude: 100_000, mode: "raise" });
    localStorage.setItem("wmc-resonant-library-v2", JSON.stringify({
      schemaVersion: 4,
      pinnedPlanId: "warning-plan",
      plans: [{ id: "warning-plan", name: "Kerbin warning", plan: warningPlan, releaseCount: 0, saveFolder: "", useOcclusionModifiers: true, createdAt: "", updatedAt: "" }],
    }));

    render(<ResonantOrbitProvider><PinnedResonantOrbitPanel scene="editor" /></ResonantOrbitProvider>);
    expect(screen.getByText("Review plan — No continuous LOS")).toBeTruthy();

    cleanup();
    const conflictPlan = calculateResonantOrbit({ body: STOCK_BODIES.Kerbin, satelliteCount: 3, targetAltitude: 100_000, mode: "dive" });
    localStorage.setItem("wmc-resonant-library-v2", JSON.stringify({
      schemaVersion: 4,
      pinnedPlanId: "conflict-plan",
      plans: [{ id: "conflict-plan", name: "Kerbin conflict", plan: conflictPlan, releaseCount: 0, saveFolder: "", useOcclusionModifiers: true, createdAt: "", updatedAt: "" }],
    }));
    render(<ResonantOrbitProvider><PinnedResonantOrbitPanel scene="editor" /></ResonantOrbitProvider>);
    expect(screen.getByText("Plan conflict — PE impact · No continuous LOS")).toBeTruthy();
  });

  it("does not show a pinned plan while a different game save is active", () => {
    const plan = calculateResonantOrbit({ body: STOCK_BODIES.Duna, satelliteCount: 4, targetAltitude: 600_000, mode: "raise" });
    localStorage.setItem("wmc-resonant-library-v2", JSON.stringify({
      schemaVersion: 3,
      pinnedPlanId: "save-a-plan",
      plans: [{ id: "save-a-plan", name: "Save A Relay", plan, releaseCount: 0, saveFolder: "Save A", createdAt: "2026-07-19T00:00:00Z", updatedAt: "2026-07-19T00:00:00Z" }],
    }));
    const saveB = { "context.mode": "editor", "game.saveFolder": "Save B" } as TelemetrySnapshot;

    const view = render(<ResonantOrbitProvider><PinnedResonantOrbitPanel scene="editor" snapshot={saveB} /></ResonantOrbitProvider>);

    expect(view.container.querySelector("#editorOrbitPlan")).toBeNull();
    expect(screen.queryByText("Save A Relay")).toBeNull();
  });
});
