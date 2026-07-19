// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flightTelemetryFixture } from "../telemetry/fixtures";
import type { TelemetrySnapshot } from "../telemetry/types";
import { AscensionPanel, resolveSasDisplay } from "./AscensionPanel";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Ascension SAS source display", () => {
  it("gives active Smart A.S.S. precedence over a stock SAS pulse", () => {
    expect(resolveSasDisplay({
      "context.mode": "flight",
      "krpc.sas": true,
      "krpc.sasMode": "SASMode.prograde",
      "mj.sasActive": true,
      "mj.sasMode": "SmartASSAutopilotMode.orbit_retrograde",
    })).toEqual({ mode: "ORBIT RETROGRADE", source: "mj" });
  });

  it("debounces a brief handoff away from Smart A.S.S. and then shows stock SAS", () => {
    const smartAss: TelemetrySnapshot = {
      ...flightTelemetryFixture,
      "krpc.sas": false,
      "mj.sasActive": true,
      "mj.sasMode": "SmartASSAutopilotMode.orbit_prograde",
    };
    const stock: TelemetrySnapshot = {
      ...flightTelemetryFixture,
      "krpc.sas": true,
      "krpc.sasMode": "SASMode.maneuver",
      "mj.sasActive": false,
      "mj.sasMode": "SmartASSAutopilotMode.off",
    };
    const view = render(<AscensionPanel snapshot={smartAss} />);
    expect(view.container.querySelector(".sas-box .label")?.textContent).toBe("Smart A.S.S (MechJeb)");
    expect(view.container.querySelector(".sas-val")?.textContent).toBe("ORBIT PROGRADE");

    view.rerender(<AscensionPanel snapshot={stock} />);
    act(() => vi.advanceTimersByTime(749));
    expect(view.container.querySelector(".sas-box .label")?.textContent).toBe("Smart A.S.S (MechJeb)");
    expect(view.container.querySelector(".sas-val")?.textContent).toBe("ORBIT PROGRADE");

    act(() => vi.advanceTimersByTime(1));
    expect(view.container.querySelector(".sas-box .label")?.textContent).toBe("SAS");
    expect(view.container.querySelector(".sas-val")?.textContent).toBe("MANEUVER");
  });
});
