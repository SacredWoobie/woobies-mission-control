import { describe, expect, it } from "vitest";
import {
  formatDeltaV,
  formatDuration,
  humanizeResourceName,
} from "./formatters";

describe("telemetry formatters", () => {
  it("keeps compatibility exports backed by the central module", () => {
    expect(formatDeltaV(999.9)).toBe("1,000");
    expect(formatDeltaV(1200)).toBe("1,200");
  });

  it("formats burn time and readable resource names", () => {
    expect(formatDuration(3723)).toBe("01:02:03");
    expect(humanizeResourceName("ElectricCharge")).toBe("Electric Charge");
  });
});
