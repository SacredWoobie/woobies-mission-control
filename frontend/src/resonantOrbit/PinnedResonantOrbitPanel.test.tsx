// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TelemetrySnapshot } from "../telemetry/types";
import { PinnedResonantOrbitPanel } from "./PinnedResonantOrbitPanel";
import { STOCK_BODIES, calculateResonantOrbit } from "./calculations";
import { ResonantOrbitProvider, useResonantOrbitState } from "./state";

function DrawerState() {
  const { drawerOpen } = useResonantOrbitState();
  return <output data-testid="drawer-state">{drawerOpen ? "open" : "closed"}</output>;
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

  it("renders Editor design guidance without Flight deployment controls", () => {
    const plan = calculateResonantOrbit({ body: STOCK_BODIES.Duna, satelliteCount: 4, targetAltitude: 600_000, mode: "raise" });
    localStorage.setItem("wmc-prototype-resonant-library-v2", JSON.stringify({
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
    expect(screen.getByText("DESIGN").parentElement?.classList.contains("resonant-editor-guidance")).toBe(true);
    expect(screen.getByText("Duna Editor Relay")).toBeTruthy();
    expect(screen.getByText(/4 satellites at 600 km final altitude/)).toBeTruthy();
    expect(screen.getByText("Calculated profile nominal")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide Duna Editor Relay panel" })).toBeNull();
    expect(screen.queryByText("Deployment tracking")).toBeNull();
    expect(screen.queryByText("0 / 4")).toBeNull();
    expect(screen.queryByText("Release at apoapsis")).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark previous satellite" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark satellite released" })).toBeNull();

    expect(screen.getByTestId("drawer-state").textContent).toBe("closed");
    fireEvent.click(screen.getByRole("button", { name: "Open planner" }));
    expect(screen.getByTestId("drawer-state").textContent).toBe("open");
  });

  it("does not show a pinned plan while a different game save is active", () => {
    const plan = calculateResonantOrbit({ body: STOCK_BODIES.Duna, satelliteCount: 4, targetAltitude: 600_000, mode: "raise" });
    localStorage.setItem("wmc-prototype-resonant-library-v2", JSON.stringify({
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
