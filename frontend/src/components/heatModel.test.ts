import { describe, expect, it } from "vitest";
import {
  heatPanelIsIdle,
  loopHeatEntity,
  rankHeatEntities,
  stockHeatEntity,
} from "./heatModel";

describe("heatModel", () => {
  it("keeps nominal loop order stable", () => {
    const entities = [
      loopHeatEntity({ id: "2", tempK: 300, nominalTempK: 1_000, netKw: 0 }),
      loopHeatEntity({ id: "1", tempK: 400, nominalTempK: 1_000, netKw: 0 }),
    ];
    expect(rankHeatEntities(entities).map((entity) => entity.name)).toEqual(["Loop 2", "Loop 1"]);
  });

  it("promotes attention states by severity and temperature ratio", () => {
    const entities = [
      loopHeatEntity({ id: "0", tempK: 200, nominalTempK: 1_000 }),
      loopHeatEntity({ id: "1", tempK: 650, nominalTempK: 1_000 }),
      loopHeatEntity({ id: "2", tempK: 950, nominalTempK: 1_000 }),
      loopHeatEntity({ id: "3", tempK: 400, nominalTempK: 1_000, hasRadiators: false }),
    ];
    expect(rankHeatEntities(entities).map((entity) => entity.name)).toEqual([
      "Loop 3",
      "Loop 2",
      "Loop 1",
      "Loop 0",
    ]);
  });

  it("derives signed loop flux when the direct value is absent", () => {
    const entity = loopHeatEntity({ id: "1", genKw: 60, remKw: 75 });
    expect(entity.netFlux).toBe(-15);
    expect(entity.stateText).toBe("cooling");
  });

  it("does not call a steady or cooling loop critical based on nominal temperature alone", () => {
    const steady = loopHeatEntity({
      id: "0",
      tempK: 345,
      nominalTempK: 300,
      netKw: 0,
    });
    const cooling = loopHeatEntity({
      id: "1",
      tempK: 795,
      nominalTempK: 800,
      netKw: -12,
    });

    expect(steady.severity).toBe("hot");
    expect(cooling.severity).toBe("hot");
  });

  it("reserves loop critical status for accumulating heat or an explicit hazard", () => {
    expect(loopHeatEntity({
      id: "0",
      tempK: 720,
      nominalTempK: 800,
      netKw: 0.06,
    }).severity).toBe("critical");
    expect(loopHeatEntity({
      id: "1",
      tempK: 400,
      nominalTempK: 800,
      netKw: 0,
      stateText: "Thermal runaway",
    }).severity).toBe("critical");
    expect(loopHeatEntity({
      id: "2",
      tempK: 400,
      nominalTempK: 800,
      netKw: 0,
      timeToCriticalSeconds: 240,
    }).severity).toBe("critical");
  });

  it("uses the worse stock core or skin ratio", () => {
    const entity = stockHeatEntity({
      name: "Part",
      tempK: 800,
      maxTempK: 2_000,
      skinTempK: 700,
      maxSkinTempK: 750,
      utilization: 40,
    }, 0);
    expect(entity.ratio).toBeCloseTo(700 / 750);
    expect(entity.currentK).toBe(700);
    expect(entity.secondaryTemperature).toEqual({ label: "core", tempK: 800 });
    expect(entity.severity).toBe("critical");
  });

  it("collapses all-nominal stock parts regardless of noisy flux", () => {
    const quiet = stockHeatEntity({ name: "Quiet", utilization: 10, netW: 0.5 }, 0);
    const active = stockHeatEntity({ name: "Active", utilization: 26, netW: 125 }, 1);
    expect(heatPanelIsIdle([quiet, active])).toBe(true);
  });

  it("keeps SystemHeat loops expanded while nominal but thermally active", () => {
    const steady = loopHeatEntity({ id: "0", tempK: 300, nominalTempK: 1_000, netKw: 0 });
    const active = loopHeatEntity({ id: "1", tempK: 300, nominalTempK: 1_000, netKw: 0.05 });
    expect(heatPanelIsIdle([steady])).toBe(true);
    expect(heatPanelIsIdle([active])).toBe(false);
  });
});
