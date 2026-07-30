import { describe, expect, it } from "vitest";
import { STOCK_BODIES, calculateResonantOrbit, evaluateOrbitTarget, formatDistance } from "./calculations";

describe("resonant orbit calculations", () => {
  it("matches the published three-satellite Minmus example", () => {
    const plan = calculateResonantOrbit({ body: STOCK_BODIES.Minmus, satelliteCount: 3, targetAltitude: 100_000, mode: "raise" });
    expect(plan.finalPeriod).toBeCloseTo(9_569.5, 0);
    expect(plan.carrierPeriod).toBeCloseTo(12_759.3, 0);
    expect(plan.carrierApoapsis).toBeCloseTo(167_652.4, -2);
    expect(plan.carrierPeriapsis).toBe(100_000);
    expect(plan.releaseAt).toBe("periapsis");
  });

  it("uses the shared plan distance preset instead of authoring units", () => {
    expect(formatDistance(167_652.4321, "km")).toBe("168\u2009km");
    expect(formatDistance(100_000, "km")).toBe("100\u2009km");
    expect(formatDistance(2_000_000, "Mm")).toBe("2.00\u2009Mm");
  });

  it("uses a tight orbital-radius tolerance for live target guidance", () => {
    const target = 2_500_000;
    const radius = STOCK_BODIES.Kerbin.radius;
    const evaluation = evaluateOrbitTarget(target, target, radius);

    expect(evaluation.tolerance).toBe(1_550);
    expect(evaluation.state).toBe("in-range");
    expect(evaluateOrbitTarget(target - evaluation.tolerance - 1, target, radius).state).toBe("low");
    expect(evaluateOrbitTarget(target + evaluation.tolerance + 1, target, radius).state).toBe("high");
    expect(evaluateOrbitTarget(undefined, target, radius).state).toBe("unavailable");
  });

  it("keeps at least a 100 meter target tolerance around small bodies", () => {
    expect(evaluateOrbitTarget(100_000, 100_000, STOCK_BODIES.Minmus.radius).tolerance).toBe(100);
  });
});
