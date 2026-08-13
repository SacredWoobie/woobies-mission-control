import { describe, expect, it } from "vitest";
import {
  formatAlignmentAngle,
  formatAttitudeDegrees,
  formatDistance,
  formatDockingOffset,
  formatHeadingDegrees,
  formatMissionDuration,
  formatOrbitApoapsisCountdown,
  formatOrbitPeriapsisCountdown,
  formatOrbitPeriod,
  formatPressure,
  formatRateColumn,
  formatResourcePair,
  formatScienceColumn,
  formatScienceInline,
  formatStageDeltaV,
  formatTemperature,
  formatTwr,
} from "./numbers";

const thin = "\u2009";

describe("resource pairs", () => {
  it.each([
    [1_499, 1_500, "1,499 / 1,500"],
    [479, 1_500, "479 / 1,500"],
    [12_400, 20_000, "12.4k / 20.0k"],
    [0.004, 0.05, "0.004 / 0.050"],
    [10_000, 10_000, "10.0k / 10.0k"],
    [9_999, 9_999, "9,999 / 9,999"],
    [9_999.6, 9_999.6, "10.00k / 10.00k"],
    [999_999, 999_999, "1.00M / 1.00M"],
    [0.0000003, 0.05, "<0.0001 / 0.0500"],
  ])("formats %s / %s as one unit", (value, capacity, expected) => {
    expect(formatResourcePair(value, capacity).combined).toBe(expected);
  });

  it("never gives the two operands different formatting rules", () => {
    expect(formatResourcePair(479, 12_400)).toMatchObject({
      value: "0.5k",
      capacity: "12.4k",
      suffix: "k",
      decimals: 1,
    });
  });
});

describe("distance presets", () => {
  it.each([
    [999, `999${thin}m`],
    [1_000, `1.000${thin}km`],
    [100_000, `100.00${thin}km`],
    [1_000_000, `1.0000${thin}Mm`],
    [10_000_000, `10.00${thin}Mm`],
    [100_000_000, `100.0${thin}Mm`],
    [1_000_000_000, `1.000${thin}Gm`],
    [10_000_000_000, `10.00${thin}Gm`],
    [100_000_000_000, `100.0${thin}Gm`],
  ])("uses every exact live boundary: %s", (value, expected) => {
    expect(formatDistance(value, "live")).toBe(expected);
  });

  it.each([
    [999, `999${thin}m`],
    [1_000, `1.00${thin}km`],
    [100_000, `100.0${thin}km`],
    [1_000_000, `1.000${thin}Mm`],
    [10_000_000, `10.0${thin}Mm`],
    [100_000_000, `100${thin}Mm`],
    [1_000_000_000, `1.00${thin}Gm`],
    [10_000_000_000, `10.0${thin}Gm`],
    [100_000_000_000, `100${thin}Gm`],
  ])("uses every exact context boundary: %s", (value, expected) => {
    expect(formatDistance(value, "context")).toBe(expected);
  });

  it.each([
    [42_300, `42.3${thin}km`],
    [82_415.6, `82.4${thin}km`],
    [100_000, `100${thin}km`],
    [1_000_000, `1.00${thin}Mm`],
    [100_000_000, `100.0${thin}Mm`],
    [1_000_000_000, `1.00${thin}Gm`],
    [100_000_000_000, `100.0${thin}Gm`],
  ])("uses every exact plan boundary: %s", (value, expected) => {
    expect(formatDistance(value, "plan")).toBe(expected);
  });

  it("selects bands from magnitude while preserving the sign", () => {
    expect(formatDistance(-581_090, "live")).toBe(`-581.09${thin}km`);
    expect(formatDistance(-581_090, "context")).toBe(`-581.1${thin}km`);
  });

  it.each([
    [999.4, `999${thin}m`],
    [999.6, `1.000${thin}km`],
    [99_999.4, `99.999${thin}km`],
    [99_999.6, `100.00${thin}km`],
    [999_994, `999.99${thin}km`],
    [999_996, `1.0000${thin}Mm`],
    [9_999_940, `9.9999${thin}Mm`],
    [9_999_960, `10.00${thin}Mm`],
    [99_994_000, `99.99${thin}Mm`],
    [99_996_000, `100.0${thin}Mm`],
    [999_940_000, `999.9${thin}Mm`],
    [999_960_000, `1.000${thin}Gm`],
    [9_999_400_000, `9.999${thin}Gm`],
    [9_999_600_000, `10.00${thin}Gm`],
    [99_994_000_000, `99.99${thin}Gm`],
    [99_996_000_000, `100.0${thin}Gm`],
  ])("rolls live distance bands over after rounding: %s", (value, expected) => {
    expect(formatDistance(value, "live")).toBe(expected);
  });

  it("uses rollover-aware bands for compact distance presets and negative values", () => {
    expect(formatDistance(999.6, "context")).toBe(`1.00${thin}km`);
    expect(formatDistance(99_996, "context")).toBe(`100.0${thin}km`);
    expect(formatDistance(999_960, "context")).toBe(`1.000${thin}Mm`);
    expect(formatDistance(99_960, "plan")).toBe(`100${thin}km`);
    expect(formatDistance(999_600, "plan")).toBe(`1.00${thin}Mm`);
    expect(formatDistance(-999.6, "live")).toBe(`-1.000${thin}km`);
  });
});

describe("fixed column quantities", () => {
  it("keeps staging delta-v whole and grouped", () => {
    expect(formatStageDeltaV(561.62)).toBe("562");
    expect(formatStageDeltaV(1_928.7)).toBe("1,929");
    expect(formatStageDeltaV(12_400)).toBe("12,400");
  });

  it("keeps rates, TWR, temperature, and science columns stable", () => {
    expect(formatRateColumn(3, "EC/s")).toBe("3.0 EC/s");
    expect(formatRateColumn(-0.0001, "kW")).toBe("0.0 kW");
    expect(formatTwr(0.7139)).toBe("0.71");
    expect(formatTemperature(2_400, true)).toBe("2,400 K");
    expect(formatScienceColumn(12)).toBe("12.0");
    expect(formatScienceInline(12)).toBe("12");
  });

  it("keeps docking quantities in their fixed narrow-regime format", () => {
    expect(formatDockingOffset(0.84)).toBe(`0.8${thin}m`);
    expect(formatDockingOffset(-0.0001)).toBe(`0.0${thin}m`);
    expect(formatAlignmentAngle(-0.0001)).toBe("0.0\u00b0");
    expect(formatHeadingDegrees(4.6)).toBe("005");
    expect(formatAttitudeDegrees(4.6, true)).toBe("+5");
    expect(formatAttitudeDegrees(-0.0001)).toBe("0");
  });
});

describe("durations and orbit semantics", () => {
  it("renders long finite durations in the selected time system", () => {
    expect(formatMissionDuration(2_400_000, false)).toBe("27d 18:40:00");
    expect(formatMissionDuration(2_400_000, true)).toBe("111d 00:40:00");
  });

  it("distinguishes hyperbolic apoapsis, periapsis, and period", () => {
    expect(formatOrbitApoapsisCountdown(2_400_000, 1.02)).toBe("\u221e");
    expect(formatOrbitPeriapsisCountdown(2_400, 1.02, -1)).toBe("00:40:00");
    expect(formatOrbitPeriapsisCountdown(2_400, 1.02, 1)).toBe("\u2014");
    expect(formatOrbitPeriapsisCountdown(2_400, 1.02, -0.01)).toBe("NOW");
    expect(formatOrbitPeriapsisCountdown(2_400, 1.02, undefined)).toBe("\u2014");
    expect(formatOrbitPeriod(2_400, 1.02)).toBe("\u2014");
  });
});

describe("pressure", () => {
  it("uses one shared vacuum threshold", () => {
    expect(formatPressure(0.003)).toBe("vacuum");
    expect(formatPressure(0.004999)).toBe("vacuum");
    expect(formatPressure(0.005)).toBe("0.005 atm");
    expect(formatPressure(0.0236)).toBe("0.024 atm");
  });
});
