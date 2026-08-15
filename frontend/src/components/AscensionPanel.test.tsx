// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flightTelemetryFixture } from "../telemetry/fixtures";
import type { TelemetrySnapshot } from "../telemetry/types";
import { TimeSystemProvider } from "../timeSystem";
import { NAVBALL_STYLE_STORAGE_KEY } from "../navballStyle";
import { SettingsProvider } from "../settings";
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

    expect(ascensionStat(view.container, "T → AP")).toBe("27d 18:40:00");
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
    expect(ascensionStat(view.container, "T → AP")).toBe("∞");
    expect(ascensionStat(view.container, "T → PE")).toBe("00:40:00");
    expect(ascensionStat(view.container, "Period")).toBe("—");

    view.rerender(<AscensionPanel snapshot={{ ...base, "v.verticalSpeed": 1 }} />);
    expect(ascensionStat(view.container, "T → PE")).toBe("—");

    view.rerender(<AscensionPanel snapshot={{ ...base, "v.verticalSpeed": -0.01 }} />);
    expect(ascensionStat(view.container, "T → PE")).toBe("NOW");

    view.rerender(<AscensionPanel snapshot={{ ...base, "v.verticalSpeed": undefined }} />);
    expect(ascensionStat(view.container, "T → PE")).toBe("—");
  });
});

describe("Ascension information hierarchy", () => {
  it("renders the live vessel throttle as a percentage and meter fill", () => {
    const view = render(<AscensionPanel snapshot={{
      ...flightTelemetryFixture,
      "krpc.throttle": 0.42,
    }} />);

    expect(view.container.querySelector(".thr-pct")?.textContent).toBe("42%");
    expect(view.container.querySelector(".thr-track")?.getAttribute("aria-valuenow")).toBe("42");
    expect((view.container.querySelector(".thr-fill") as HTMLElement | null)?.style.height).toBe("42%");
  });

  it("recovers the KSP throttle gauge from active thrust when control reports zero", () => {
    const view = render(<AscensionPanel snapshot={{
      ...flightTelemetryFixture,
      "krpc.throttle": 0,
      "v.thrust": 550_716,
      "v.availableThrust": 550_723,
    }} />);

    expect(view.container.querySelector(".thr-pct")?.textContent).toBe("100%");
    expect(view.container.querySelector(".thr-track")?.getAttribute("aria-valuenow")).toBe("100");
  });

  it("separates attitude and flight-state readouts and adds target speed only when present", () => {
    const targetSnapshot: TelemetrySnapshot = {
      ...flightTelemetryFixture,
      "tar.name": "Kerbin",
      "tar.o.relativeVelocity": 12.4,
    };
    const view = render(<AscensionPanel snapshot={targetSnapshot} />);

    expect(view.container.querySelector(".attitude-strip")?.textContent).toContain("HDG");
    expect(view.container.querySelector(".navball-stage .navball")).not.toBeNull();
    expect(view.container.querySelectorAll(".navball .nav-spherical-grid path")).toHaveLength(16);
    expect(view.container.querySelector(".navball .nav-spherical-horizon")).not.toBeNull();
    expect(view.container.querySelector(".navball .nav-sphere-rim")).not.toBeNull();
    const clippedWorld = view.container.querySelector(".navball .nav-sphere-world");
    expect(clippedWorld?.getAttribute("clip-path")).toMatch(/^url\(#navball-clip-/);
    expect(clippedWorld?.querySelector(".nav-sphere-sky")).not.toBeNull();
    expect(clippedWorld?.querySelector(".nav-spherical-grid")).not.toBeNull();
    expect(clippedWorld?.querySelector(".nav-cardinals")).not.toBeNull();
    expect(clippedWorld?.contains(view.container.querySelector(".nav-sphere-rim"))).toBe(false);
    expect(view.container.querySelector(".navball .aircraft")?.getAttribute("d")).toBe("M52 84 H71 L84 95 L97 84 H116");
    expect(view.container.querySelector(".navball .aircraft-dot")?.getAttribute("r")).toBe("2");
    expect(view.container.querySelector(".altitude-hero")?.textContent).toContain("Altitude");
    expect(view.container.querySelector(".asc-speed-grid")?.textContent).toContain("Vertical speed");
    expect(view.container.querySelector(".asc-speed-grid.has-target")?.textContent).toContain("Target relative");
    expect(view.container.querySelector(".asc-speed-grid.has-target")?.textContent).toContain("Kerbin");
    expect(view.container.querySelectorAll(".orbit-rail .stat")).toHaveLength(7);
    expect(view.container.querySelector("svg.spark")).toBeNull();

    view.rerender(<AscensionPanel snapshot={{ ...targetSnapshot, "tar.name": "" }} />);
    expect(view.container.querySelector(".asc-speed-grid.has-target")).toBeNull();
    expect(view.container.textContent).not.toContain("Target relative");
  });

  it("renders the supplied texture only when the optional navball style is selected", () => {
    localStorage.setItem(NAVBALL_STYLE_STORAGE_KEY, '"ksp2-pre-alpha"');
    const view = render(<SettingsProvider><AscensionPanel snapshot={flightTelemetryFixture} /></SettingsProvider>);
    const textured = view.container.querySelector(".navball-textured");
    expect(textured?.getAttribute("role")).toBe("img");
    expect(textured?.getAttribute("aria-label")).toContain("KSP2 pre-alpha style navball");
    expect(textured?.querySelector("canvas")).not.toBeNull();
    expect(textured?.querySelector(".aircraft")?.getAttribute("d")).toBe("M52 84 H71 L84 95 L97 84 H116");
    expect(view.container.querySelector(".nav-sphere-world")).toBeNull();
  });

  it("retains the standard awaiting-telemetry instrument for either style", () => {
    localStorage.setItem(NAVBALL_STYLE_STORAGE_KEY, '"ksp2-pre-alpha"');
    const view = render(<SettingsProvider><AscensionPanel snapshot={{
      ...flightTelemetryFixture,
      "n.pitch": undefined,
    }} /></SettingsProvider>);
    expect(view.container.querySelector(".navball-textured")).toBeNull();
    expect(view.container.querySelector("svg[aria-label='Attitude indicator awaiting telemetry']")).not.toBeNull();
  });

  it("surfaces trajectory context and explains open-orbit values without adding RCS", () => {
    const view = render(<AscensionPanel snapshot={{
      ...flightTelemetryFixture,
      "v.body": "Sarnus",
      "v.situationString": "Escaping",
      "v.verticalSpeed": 1,
      "o.eccentricity": 1.2,
    }} />);

    expect(view.container.querySelector(".asc-trajectory")?.textContent).toBe("HYPERBOLIC · ESCAPING SARNUS");
    expect(view.container.querySelector(".orbit-rail")?.textContent).toContain("never — escape");
    expect(view.container.querySelector(".orbit-rail")?.textContent).toContain("passed");
    expect(view.container.querySelector(".orbit-rail")?.textContent).toContain("open orbit");
    expect(view.container.textContent).not.toContain("RCS");
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
    expect(view.container.querySelector(".sas-box .label")?.textContent).toBe("SAS");
    expect(view.container.querySelector(".sas-val")?.textContent).toBe("ORBIT PROGRADE");

    view.rerender(<AscensionPanel snapshot={stock} />);
    act(() => vi.advanceTimersByTime(749));
    expect(view.container.querySelector(".sas-box .label")?.textContent).toBe("SAS");
    expect(view.container.querySelector(".sas-val")?.textContent).toBe("ORBIT PROGRADE");

    act(() => vi.advanceTimersByTime(1));
    expect(view.container.querySelector(".sas-box .label")?.textContent).toBe("SAS");
    expect(view.container.querySelector(".sas-val")?.textContent).toBe("MANEUVER");
  });
});
