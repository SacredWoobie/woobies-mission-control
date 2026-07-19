// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { flightTelemetryFixture } from "../telemetry/fixtures";
import { HeatPanel } from "./HeatPanel";

afterEach(cleanup);

describe("HeatPanel", () => {
  it("keeps System Heat in kilowatts", () => {
    render(<HeatPanel snapshot={{ ...flightTelemetryFixture, "heat.backend": "system_heat" }} />);
    expect(screen.getByText("System Heat · kW")).toBeTruthy();
    expect(screen.getAllByText(/kW/).length).toBeGreaterThan(2);
  });

  it("labels the stock fallback in watts and lists hottest parts", () => {
    render(<HeatPanel snapshot={{
      ...flightTelemetryFixture,
      "heat.backend": "stock",
      "heat.generatedW": 410.3,
      "heat.removedW": 203.1,
      "heat.netW": 207.2,
      "heat.parts": [{ name: "Advanced Nose Cone", skinTempK: 920, utilization: 92, netW: 125.4 }],
    }} />);
    expect(screen.getByText("Stock thermal · W")).toBeTruthy();
    expect(screen.getByText("Advanced Nose Cone")).toBeTruthy();
    expect(screen.getByText("92% limit")).toBeTruthy();
    expect(screen.getByText("410.3 W")).toBeTruthy();
  });
});
