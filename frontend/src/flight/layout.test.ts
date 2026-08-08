import { describe, expect, it } from "vitest";
import {
  balanceContiguousPanelLanes,
  computeFlatFlightPanelLayout,
  computeFlightRegionGeometry,
  flightPanelOwner,
  lanesToPlacementMap,
} from "./layout";

describe("Flight workspace layout model", () => {
  it("defines fixed and per-view panel ownership", () => {
    expect(flightPanelOwner("asc")).toBe("fixed");
    expect(flightPanelOwner("stage")).toBe("fixed");
    expect(flightPanelOwner("elec")).toBe("monitor");
    expect(flightPanelOwner("target")).toBe("monitor");
    expect(flightPanelOwner("flightDeltaVPlan")).toBe("plan");
    expect(flightPanelOwner("flightNote")).toBe("plan");
    expect(flightPanelOwner("clock")).toBeUndefined();
  });

  it("resolves the worked width configurations from the v2.4 baseline", () => {
    expect(computeFlightRegionGeometry(1858)).toMatchObject({
      arrangement: "side-by-side",
      fixedContentWidth: 857,
      fixedRegionWidth: 873,
      laneCount: 2,
      laneWidth: 472.5,
      tabbedContentWidth: 957,
      tabbedRegionWidth: 973,
    });
    expect(computeFlightRegionGeometry(1018)).toMatchObject({
      arrangement: "stacked",
      fixedContentWidth: 1002,
      laneCount: 2,
      laneWidth: 495,
      tabbedContentWidth: 1002,
    });
    expect(computeFlightRegionGeometry(2498)).toMatchObject({
      arrangement: "side-by-side",
      fixedRegionWidth: 1150,
      laneCount: 2,
      laneWidth: 654,
    });
    expect(computeFlightRegionGeometry(1858, false)).toMatchObject({
      fixedRegionWidth: 0,
      laneCount: 3,
      tabbedRegionWidth: 1858,
    });
  });

  it("keeps region and lane geometry valid across responsive boundaries", () => {
    const boundaryWidths = [
      0, 1, 439, 440, 455, 456, 907, 908, 1359, 1360,
      1735, 1736, 1858, 2498, 3200,
    ];

    for (const wrapperWidth of boundaryWidths) {
      for (const hasVisibleFixedPanels of [true, false]) {
        const geometry = computeFlightRegionGeometry(wrapperWidth, hasVisibleFixedPanels);
        expect(geometry.fixedRegionWidth).toBeGreaterThanOrEqual(0);
        expect(geometry.tabbedRegionWidth).toBeGreaterThanOrEqual(0);
        expect(geometry.tabbedContentWidth).toBeGreaterThanOrEqual(0);
        expect(geometry.laneCount).toBeGreaterThanOrEqual(1);
        expect(geometry.laneCount).toBeLessThanOrEqual(3);
        expect(geometry.laneWidth).toBeGreaterThanOrEqual(0);
        expect(
          geometry.laneCount * geometry.laneWidth + (geometry.laneCount - 1) * 12,
        ).toBeCloseTo(geometry.tabbedContentWidth);

        if (!hasVisibleFixedPanels) {
          expect(geometry.fixedRegionWidth).toBe(0);
          expect(geometry.tabbedRegionWidth).toBe(wrapperWidth);
        } else if (geometry.arrangement === "side-by-side") {
          expect(geometry.fixedRegionWidth + 12 + geometry.tabbedRegionWidth).toBe(wrapperWidth);
        } else {
          expect(geometry.fixedRegionWidth).toBe(wrapperWidth);
          expect(geometry.tabbedRegionWidth).toBe(wrapperWidth);
        }

        if (geometry.laneCount > 1) expect(geometry.laneWidth).toBeGreaterThanOrEqual(440);
      }
    }

    expect(computeFlightRegionGeometry(1735)).toMatchObject({ arrangement: "stacked", laneCount: 3 });
    expect(computeFlightRegionGeometry(1736)).toMatchObject({ arrangement: "side-by-side", laneCount: 2 });
  });

  it("keeps balancing contiguous and emits placement rather than ownership", () => {
    const lanes = balanceContiguousPanelLanes(
      ["elec", "heat", "sci", "target"],
      { elec: 430, heat: 290, sci: 414, target: 384 },
      2,
    );
    expect(lanes).toEqual([["elec", "heat"], ["sci", "target"]]);
    expect(lanesToPlacementMap(lanes)).toEqual({
      elec: { index: 0, lane: 0 },
      heat: { index: 1, lane: 0 },
      sci: { index: 0, lane: 1 },
      target: { index: 1, lane: 1 },
    });
  });

  it("updates Y coordinates without changing frozen lane membership", () => {
    const placements = {
      elec: { index: 0, lane: 0 },
      heat: { index: 1, lane: 0 },
      sci: { index: 0, lane: 1 },
    };
    const before = computeFlatFlightPanelLayout(
      ["elec", "heat", "sci"], placements, { elec: 100, heat: 80, sci: 90 }, 2, 440,
    );
    const after = computeFlatFlightPanelLayout(
      ["elec", "heat", "sci"], placements, { elec: 140, heat: 80, sci: 90 }, 2, 440,
    );
    expect(before.positions.heat).toMatchObject({ lane: 0, x: 0, y: 112 });
    expect(after.positions.heat).toMatchObject({ lane: 0, x: 0, y: 152 });
    expect(after.positions.sci).toMatchObject({ lane: 1, x: 452, y: 0 });
    expect(after.height).toBe(before.height + 40);
  });
});
