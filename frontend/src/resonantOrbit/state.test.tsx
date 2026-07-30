// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PinnedResonantOrbitPanel } from "./PinnedResonantOrbitPanel";
import type { TelemetrySnapshot } from "../telemetry/types";
import { STOCK_BODIES, calculateResonantOrbit } from "./calculations";
import { ResonantOrbitProvider, useResonantOrbitState, type SaveResonantOrbitPlanResult } from "./state";

const plan = calculateResonantOrbit({
  body: STOCK_BODIES.Duna,
  satelliteCount: 4,
  targetAltitude: 600_000,
  mode: "raise",
});

function LibraryHarness() {
  const {
    activeSavedPlanId,
    deletePlan,
    linkPlansToSave,
    pinPlan,
    pinnedForTelemetry,
    savedPlans,
    savePlan,
  } = useResonantOrbitState();
  const [lastResult, setLastResult] = useState<SaveResonantOrbitPlanResult | null>(null);
  const first = savedPlans[0];
  const saveA = { "context.mode": "editor", "game.saveFolder": "Save A" } as TelemetrySnapshot;
  const saveB = { "context.mode": "editor", "game.saveFolder": "Save B" } as TelemetrySnapshot;
  return <>
    <span>Saved count {savedPlans.length}</span>
    <button onClick={() => setLastResult(savePlan(plan, "Duna Relay Ring", { useOcclusionModifiers: false }))} type="button">Save test plan</button>
    <button onClick={() => setLastResult(savePlan(plan, "Save A Relay", { saveFolder: "Save A" }))} type="button">Save linked plan</button>
    <button onClick={() => setLastResult(savePlan(plan, "Updated Relay Ring", { useOcclusionModifiers: true }))} type="button">Update active plan</button>
    <button onClick={() => setLastResult(savePlan(plan, "Duna Relay Ring Copy", { asNew: true, useOcclusionModifiers: true }))} type="button">Save duplicate name</button>
    <button onClick={() => setLastResult(savePlan(plan, "Duna Relay Ring Copy", { asNew: true, useOcclusionModifiers: true }))} type="button">Save as new</button>
    <button disabled={!first} onClick={() => first && linkPlansToSave([first.id], "Save A")} type="button">Link first plan</button>
    <button disabled={!first} onClick={() => first && pinPlan(first.id, "Save A")} type="button">Pin first plan</button>
    <button disabled={!first} onClick={() => first && deletePlan(first.id)} type="button">Delete first plan</button>
    <output data-testid="first-save">{first?.saveFolder || "UNLINKED"}</output>
    <output data-testid="first-name">{first?.name || "NONE"}</output>
    <output data-testid="first-occlusion">{first ? String(first.useOcclusionModifiers) : "NONE"}</output>
    <output data-testid="active-plan">{activeSavedPlanId ?? "NONE"}</output>
    <output data-testid="save-result">{lastResult?.status ?? "NONE"}</output>
    <output data-testid="save-a-pin">{pinnedForTelemetry(saveA)?.name || "NONE"}</output>
    <output data-testid="save-b-pin">{pinnedForTelemetry(saveB)?.name || "NONE"}</output>
  </>;
}

describe("resonant orbit plan library", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it("filters malformed saved plans before rendering", () => {
    localStorage.setItem("wmc-resonant-library-v2", JSON.stringify({
      schemaVersion: 3,
      pinnedPlanId: null,
      plans: [
        { id: "valid", name: "Valid relay", plan, releaseCount: 0, saveFolder: "Save A", createdAt: "", updatedAt: "" },
        { id: "broken", name: "Broken relay", plan: { schemaVersion: 1 }, releaseCount: 0, saveFolder: "Save A", createdAt: "", updatedAt: "" },
      ],
    }));

    render(<ResonantOrbitProvider><LibraryHarness /></ResonantOrbitProvider>);

    expect(screen.getByText("Saved count 1")).toBeTruthy();
    expect(screen.getByTestId("first-occlusion").textContent).toBe("true");
    expect(JSON.parse(localStorage.getItem("wmc-resonant-library-v2") ?? "null").schemaVersion).toBe(4);
  });

  it("reads the pre-release library key and writes the production key", () => {
    localStorage.setItem("wmc-prototype-resonant-library-v2", JSON.stringify({
      schemaVersion: 4,
      pinnedPlanId: null,
      plans: [
        { id: "prototype-plan", name: "Recovered relay", plan, releaseCount: 0, saveFolder: "", createdAt: "", updatedAt: "" },
      ],
    }));

    render(<ResonantOrbitProvider><LibraryHarness /></ResonantOrbitProvider>);

    expect(screen.getByText("Saved count 1")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("wmc-resonant-library-v2") ?? "null").plans[0].name).toBe("Recovered relay");
  });

  it("does not overwrite an unreadable saved-plan library on mount", () => {
    localStorage.setItem("wmc-resonant-library-v2", "{not valid json");

    render(<ResonantOrbitProvider><LibraryHarness /></ResonantOrbitProvider>);

    expect(screen.getByText("Saved count 0")).toBeTruthy();
    expect(localStorage.getItem("wmc-resonant-library-v2")).toBe("{not valid json");
  });

  it("saves multiple-plan metadata and pins a selected record", async () => {
    const user = userEvent.setup();
    render(<ResonantOrbitProvider><LibraryHarness /><PinnedResonantOrbitPanel snapshot={{ "context.mode": "editor", "game.saveFolder": "Save A" } as TelemetrySnapshot} /></ResonantOrbitProvider>);

    await user.click(screen.getByRole("button", { name: "Save test plan" }));
    expect(screen.getByText("Saved count 1")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("wmc-resonant-library-v2") ?? "null").plans[0].name).toBe("Duna Relay Ring");
    expect(screen.getByTestId("first-save").textContent).toBe("UNLINKED");

    await user.click(screen.getByRole("button", { name: "Pin first plan" }));
    expect(screen.getAllByText("Duna Relay Ring").length).toBeGreaterThan(0);
    expect(screen.getByText("0 / 4")).toBeTruthy();
    expect(screen.getByTestId("first-save").textContent).toBe("Save A");
    expect(screen.getByTestId("save-a-pin").textContent).toBe("Duna Relay Ring");
    expect(screen.getByTestId("save-b-pin").textContent).toBe("NONE");

    await user.click(screen.getByRole("button", { name: "Delete first plan" }));
    expect(screen.getByText("Saved count 0")).toBeTruthy();
    expect(screen.queryByText("Duna Relay Ring")).toBeNull();
  });

  it("migrates version-two records as recoverable unlinked plans", () => {
    localStorage.setItem("wmc-resonant-library-v2", JSON.stringify({
      schemaVersion: 2,
      pinnedPlanId: null,
      plans: [{ id: "legacy-library-plan", name: "Legacy relay", plan, releaseCount: 0, createdAt: "2026-07-19T00:00:00Z", updatedAt: "2026-07-19T00:00:00Z" }],
    }));

    render(<ResonantOrbitProvider><LibraryHarness /></ResonantOrbitProvider>);

    expect(screen.getByTestId("first-save").textContent).toBe("UNLINKED");
    const migrated = JSON.parse(localStorage.getItem("wmc-resonant-library-v2") ?? "null");
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.plans[0].useOcclusionModifiers).toBe(true);
  });

  it("stores new records against the save that created them", async () => {
    const user = userEvent.setup();
    render(<ResonantOrbitProvider><LibraryHarness /></ResonantOrbitProvider>);

    await user.click(screen.getByRole("button", { name: "Save linked plan" }));

    expect(screen.getByTestId("first-save").textContent).toBe("Save A");
    expect(JSON.parse(localStorage.getItem("wmc-resonant-library-v2") ?? "null").plans[0].saveFolder).toBe("Save A");
  });

  it("updates the active record, supports save-as, and rejects duplicate names within a save", async () => {
    const user = userEvent.setup();
    render(<ResonantOrbitProvider><LibraryHarness /></ResonantOrbitProvider>);

    await user.click(screen.getByRole("button", { name: "Save test plan" }));
    expect(screen.getByTestId("save-result").textContent).toBe("created");
    expect(screen.getByTestId("active-plan").textContent).not.toBe("NONE");
    expect(screen.getByTestId("first-occlusion").textContent).toBe("false");

    await user.click(screen.getByRole("button", { name: "Update active plan" }));
    expect(screen.getByText("Saved count 1")).toBeTruthy();
    expect(screen.getByTestId("save-result").textContent).toBe("updated");
    expect(screen.getByTestId("first-name").textContent).toBe("Updated Relay Ring");
    expect(screen.getByTestId("first-occlusion").textContent).toBe("true");

    await user.click(screen.getByRole("button", { name: "Save as new" }));
    expect(screen.getByText("Saved count 2")).toBeTruthy();
    expect(screen.getByTestId("save-result").textContent).toBe("created");

    await user.click(screen.getByRole("button", { name: "Save duplicate name" }));
    expect(screen.getByText("Saved count 2")).toBeTruthy();
    expect(screen.getByTestId("save-result").textContent).toBe("duplicate");
  });
});
