// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TelemetrySnapshot } from "../telemetry/types";
import { ClockPanel } from "./FlightStatusPanels";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const stockSnapshot: TelemetrySnapshot = {
  "context.mode": "flight",
  "t.universalTime": 12_345,
  "v.body": "Kerbin",
  "v.missionTime": 30,
  "v.name": "Signal Test",
  "v.situationString": "Orbiting",
  "comm.krpc.canCommunicate": true,
  "comm.krpc.signalStrength": 0.42,
};

describe("ClockPanel communications", () => {
  it("omits signal delay when RemoteTech is not reported", () => {
    const { container } = render(<ClockPanel snapshot={stockSnapshot} />);

    expect(screen.queryByText("Signal delay", { exact: true })).toBeNull();
    expect(screen.getByText(/CONNECTED/).textContent).toContain("42%");
    expect(container.querySelector(".flight-context-grid")?.classList.contains("remote-tech")).toBe(false);
    expect(container.querySelectorAll(".flight-context-identity, .clockcell, .cs-cell")).toHaveLength(4);
  });

  it("omits signal delay when RemoteTech reports that it is unavailable", () => {
    render(<ClockPanel snapshot={{ ...stockSnapshot, "rt.available": false }} />);

    expect(screen.queryByText("Signal delay", { exact: true })).toBeNull();
  });

  it("shows RemoteTech signal delay when RemoteTech is active", () => {
    const { container } = render(<ClockPanel snapshot={{
      ...stockSnapshot,
      "rt.available": true,
      "rt.hasConnection": true,
      "rt.signalDelay": 0.083,
    }} />);

    expect(screen.getByText("Signal delay", { exact: true })).toBeTruthy();
    expect(screen.getByText("83 ms", { exact: true })).toBeTruthy();
    expect(container.querySelector(".flight-context-grid")?.classList.contains("remote-tech")).toBe(true);
    expect(container.querySelectorAll(".flight-context-identity, .clockcell, .cs-cell")).toHaveLength(5);
  });

  it("keeps the delay cell when an active RemoteTech link is disconnected", () => {
    render(<ClockPanel snapshot={{
      ...stockSnapshot,
      "rt.available": true,
      "rt.hasConnection": false,
      "rt.signalDelay": null,
    }} />);

    expect(screen.getByText("Signal delay", { exact: true })).toBeTruthy();
    expect(screen.getByText("NO CONNECTION", { exact: true })).toBeTruthy();
  });
});
