import { describe, expect, it } from "vitest";
import {
  selectConsumables,
  selectStages,
  selectStageSummary,
  selectThrottleFraction,
} from "./selectors";
import type { TelemetrySnapshot } from "./types";

describe("selectConsumables", () => {
  it("uses production ordering, preserves mod order, and hides zero-capacity rows", () => {
    const snapshot: TelemetrySnapshot = {
      "context.mode": "flight",
      "res.names": ["ModB", "LiquidFuel", "ModA", "ElectricCharge", "EmptyMod"],
      "r.resourceMax[ElectricCharge]": 100,
      "r.resourceMax[LiquidFuel]": 50,
      "r.resourceMax[ModB]": 20,
      "r.resourceMax[ModA]": 10,
      "r.resourceMax[EmptyMod]": 0,
    };

    expect(selectConsumables(snapshot).map((resource) => resource.name)).toEqual([
      "LiquidFuel",
      "ModB",
      "ModA",
    ]);
  });
});

describe("selectThrottleFraction", () => {
  it("uses commanded throttle when kRPC reports it", () => {
    expect(selectThrottleFraction({
      "context.mode": "flight",
      "krpc.throttle": 0.42,
      "v.thrust": 900,
      "v.availableThrust": 1000,
    })).toBe(0.42);
  });

  it("recovers the visible throttle from active thrust when control reports zero", () => {
    expect(selectThrottleFraction({
      "context.mode": "flight",
      "krpc.throttle": 0,
      "v.thrust": 550_716,
      "v.availableThrust": 550_723,
    })).toBeCloseTo(1, 4);
  });

  it("keeps a real zero when the vessel is not producing thrust", () => {
    expect(selectThrottleFraction({
      "context.mode": "flight",
      "krpc.throttle": 0,
      "v.thrust": 0,
      "v.availableThrust": 550_723,
    })).toBe(0);
  });
});

describe("staging selectors", () => {
  const snapshot: TelemetrySnapshot = {
    "context.mode": "flight",
    "stage.currentKsp": 3,
    "stage.totalDvAtmo": 1000,
    "stage.totalDvVac": 1200,
    "stage.stages": [
      { index: 0, ksp: 1, dvAtmo: 0.4, dvVac: 0.7, twrAtmo: 1, twrVac: 1.1 },
      { index: 1, ksp: 2, dvAtmo: 500, dvVac: 600, twrAtmo: 1.2, twrVac: 1.3 },
      { index: 2, ksp: 3, dvAtmo: 0, dvVac: 0, twrAtmo: 0, twrVac: 0 },
    ],
  };

  it("filters rows using the active flight condition and the production threshold", () => {
    expect(selectStages(snapshot, "atmosphere").map((stage) => stage.ksp)).toEqual([2]);
    expect(selectStages(snapshot, "vacuum").map((stage) => stage.ksp)).toEqual([1, 2]);
  });

  it("uses the nearest remaining propulsive row when the raw stage is unpowered", () => {
    expect(selectStageSummary(snapshot, "atmosphere")).toEqual({
      currentKsp: 2,
      current: {
        ksp: 2,
        deltaVAtmosphere: 500,
        deltaVVacuum: 600,
        twrAtmosphere: 1.2,
        twrVacuum: 1.3,
        twrStart: 1.2,
        twrEnd: 1.2,
        burnSeconds: undefined,
      },
      totalDeltaV: 1000,
    });
  });

  it("keeps a stage in editor mode when either condition is propulsive", () => {
    expect(
      selectStages({ ...snapshot, "context.mode": "editor" }, "atmosphere").map(
        (stage) => stage.ksp,
      ),
    ).toEqual([1, 2]);
  });

  it("pins the editor stage-visibility boundary at greater than 0.5 m/s", () => {
    const boundary: TelemetrySnapshot = {
      "context.mode": "editor",
      "stage.stages": [
        { index: 0, ksp: 0, dvAtmo: 0.5, dvVac: 0.5 },
        { index: 1, ksp: 1, dvAtmo: 0.5001, dvVac: 0 },
        { index: 2, ksp: 2, dvAtmo: 0, dvVac: 0.5001 },
        { index: 3, ksp: 3, dvAtmo: 0.4, dvVac: 0.7 },
      ],
    };

    expect(selectStages(boundary).map((stage) => stage.ksp)).toEqual([1, 2, 3]);
  });
});
