// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flightTelemetryFixture } from "../telemetry/fixtures";
import type { TelemetrySnapshot } from "../telemetry/types";
import { TimeSystemProvider } from "../timeSystem";
import { AscensionPanel, resolveSasDisplay } from "./AscensionPanel";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function ascensionStat(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll(".stats-grid .stat"))
    .find((element) => element.querySelector(".label")?.textContent === label)
    ?.querySelector(".v")?.textContent;
}

describe("Ascension orbital formatting", () => {
  it("follows the selected Earth time system for long finite countdowns", () => {
    localStorage.setItem("wmc-time-system-v1", "earth");
    const snapshot: TelemetrySnapshot = {
      ...flightTelemetryFixture,
      "o.eccentricity": 0.5,
      "o.timeToAp": 2_400_000,
    };
    const view = render(
      <TimeSystemProvider>
        <AscensionPanel snapshot={snapshot} />
      </TimeSystemProvider>,
    );

    expect(ascensionStat(view.container, "T→Ap")).toBe("27d 18:40:00");
  });

  it("uses radial velocity to distinguish hyperbolic orbit states", () => {
    const base: TelemetrySnapshot = {
      ...flightTelemetryFixture,
      "o.eccentricity": 1.02,
      "o.timeToAp": 2_400_000,
      "o.timeToPe": 2_400,
      "o.period": 2_400_000,
      "v.verticalSpeed": -1,
    };
    const view = render(<AscensionPanel snapshot={base} />);
    expect(ascensionStat(view.container, "T→Ap")).toBe("∞");
    expect(ascensionStat(view.container, "T→Pe")).toBe("00:40:00");
    expect(ascensionStat(view.container, "Period")).toBe("—");

    view.rerender(<AscensionPanel snapshot={{ ...base, "v.verticalSpeed": 1 }} />);
    expect(ascensionStat(view.container, "T→Pe")).toBe("—");

    view.rerender(<AscensionPanel snapshot={{ ...base, "v.verticalSpeed": -0.01 }} />);
    expect(ascensionStat(view.container, "T→Pe")).toBe("NOW");

    view.rerender(<AscensionPanel snapshot={{ ...base, "v.verticalSpeed": undefined }} />);
    expect(ascensionStat(view.container, "T→Pe")).toBe("—");
  });
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
