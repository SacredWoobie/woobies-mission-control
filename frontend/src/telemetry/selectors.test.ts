import { describe, expect, it } from "vitest";
import { selectConsumables, selectStages, selectStageSummary } from "./selectors";
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
      "ElectricCharge",
      "LiquidFuel",
      "ModB",
      "ModA",
    ]);
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

  it("keeps a known zero-propulsion current stage number without borrowing another row", () => {
    expect(selectStageSummary(snapshot, "atmosphere")).toEqual({
      currentKsp: 3,
      current: undefined,
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
});
