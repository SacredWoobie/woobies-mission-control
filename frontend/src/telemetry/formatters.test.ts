import { describe, expect, it } from "vitest";
import {
  formatDuration,
  humanizeResourceName,
} from "./formatters";

describe("telemetry formatters", () => {
  it("formats burn time and readable resource names", () => {
    expect(formatDuration(3723)).toBe("01:02:03");
    expect(humanizeResourceName("ElectricCharge")).toBe("Electric Charge");
  });
});
