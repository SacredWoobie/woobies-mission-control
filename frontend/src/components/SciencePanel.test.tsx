// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { flightTelemetryFixture } from "../telemetry/fixtures";
import type { ScienceLabTelemetry, TelemetrySnapshot } from "../telemetry/types";
import { SciencePanel } from "./SciencePanel";
import { PanelVisibilityProvider } from "./PanelVisibility";

afterEach(cleanup);

function renderPanel(snapshot: TelemetrySnapshot) {
  return render(<PanelVisibilityProvider><SciencePanel snapshot={snapshot} /></PanelVisibilityProvider>);
}

describe("SciencePanel", () => {
  it("uses the Electricity-style overview and accessible lab meters", () => {
    const { container } = renderPanel(flightTelemetryFixture);

    expect(screen.getByText("42.7", { exact: true })).toBeTruthy();
    expect(screen.getByText("3 experiments · 19.4 by transmit", { exact: true })).toBeTruthy();
    expect(screen.getByText("RESEARCHING", { exact: true })).toBeTruthy();
    expect(screen.getByText("53.0", { exact: true })).toBeTruthy();
    expect(screen.getByText("full in 9d 4h", { exact: true })).toBeTruthy();
    expect(container.querySelector('[role="meter"][aria-label*="data 97% full"]')).toBeTruthy();
    expect(container.querySelector('[role="meter"][aria-label*="science 0% full"]')).toBeTruthy();
  });

  it("shows the cap-blocked guidance only for a full lab", () => {
    const base = flightTelemetryFixture["sci.krpc.labs"]?.[0] as ScienceLabTelemetry;
    renderPanel({
      ...flightTelemetryFixture,
      "sci.krpc.labs": [{
        ...base,
        scienceStored: 500,
        sciencePerDay: 0,
        state: "science-full",
        etaKind: "full",
        etaSeconds: 0,
      }],
    });

    expect(screen.getByText("SCIENCE FULL", { exact: true })).toBeTruthy();
    expect(screen.getByText("transmit science to resume", { exact: true })).toBeTruthy();
    expect(screen.getByText("0.0", { exact: true })).toBeTruthy();
  });

  it("renders multiple labs with stable independent status cards", () => {
    const base = flightTelemetryFixture["sci.krpc.labs"]?.[0] as ScienceLabTelemetry;
    renderPanel({
      ...flightTelemetryFixture,
      "sci.krpc.labCount": 2,
      "sci.krpc.labs": [
        base,
        { ...base, id: "second", title: "MPL-LG-2", state: "no-data", etaKind: "no-data", dataStored: 0, sciencePerDay: 0 },
      ],
    });

    expect(screen.getByText("NO DATA", { exact: true })).toBeTruthy();
    expect(screen.getAllByText(/sci\/day/)).toHaveLength(2);
    expect(screen.getByLabelText("Science laboratories").children).toHaveLength(2);
  });

  it("does not confuse a legacy DLL with a vessel that has no labs", () => {
    const { rerender } = renderPanel({
      "context.mode": "flight",
      "sci.krpc.total": 0,
      "sci.krpc.count": 0,
    });
    expect(screen.getByText(/service update required/)).toBeTruthy();

    rerender(<PanelVisibilityProvider><SciencePanel snapshot={{
      "context.mode": "flight",
      "sci.krpc.total": 0,
      "sci.krpc.count": 0,
      "sci.krpc.labTelemetryAvailable": true,
      "sci.krpc.labs": [],
    }} /></PanelVisibilityProvider>);
    expect(screen.getByText("No research labs aboard", { exact: true })).toBeTruthy();
  });

  it("preserves fixed experiment-column precision and source metadata", () => {
    renderPanel({
      "context.mode": "flight",
      "sci.krpc.total": 12,
      "sci.krpc.transmitTotal": 7,
      "sci.krpc.count": 1,
      "sci.krpc.labTelemetryAvailable": true,
      "sci.krpc.labs": [],
      "sci.krpc.experiments": [{
        title: "Mystery Goo",
        value: 12,
        transmit: 7,
        data: 4,
        sourcePart: "Goo canister",
      }],
    });

    expect(screen.getByText((_, element) => element?.textContent === "12.0 / 7.0 tx")).toBeTruthy();
    expect(screen.getByText("Goo canister · 4 data", { exact: true })).toBeTruthy();
  });
});
