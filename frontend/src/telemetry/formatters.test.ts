import { describe, expect, it } from "vitest";
import {
  formatDeltaV,
  formatDuration,
  formatResourceAmount,
  formatSi,
  humanizeResourceName,
} from "./formatters";

describe("telemetry formatters", () => {
  it("matches compact resource and delta-v presentation", () => {
    expect(formatSi(1250, 0)).toBe("1k");
    expect(formatDeltaV(999.9)).toBe("999.9");
    expect(formatDeltaV(1200)).toBe("1,200");
  });

  it("formats burn time and readable resource names", () => {
    expect(formatDuration(3723)).toBe("01:02:03");
    expect(humanizeResourceName("ElectricCharge")).toBe("Electric Charge");
  });

  it("preserves meaningful precision for fractional resource capacities", () => {
    expect(formatResourceAmount(0, 0.4)).toBe("0.0");
    expect(formatResourceAmount(0.4, 0.4)).toBe("0.4");
    expect(formatResourceAmount(0.004, 0.008)).toBe("0.004");
    expect(formatResourceAmount(45, 50)).toBe("45");
  });
});
