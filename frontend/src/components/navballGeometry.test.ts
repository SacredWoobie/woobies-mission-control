import { describe, expect, it } from "vitest";
import {
  buildNavballGeometry,
  makeNavballBasis,
  projectNavballPoint,
} from "./navballGeometry";

describe("spherical navball geometry", () => {
  it("builds the expected north-facing world basis and projection", () => {
    const basis = makeNavballBasis(0, 0, 0);
    expect(basis.forward).toEqual([0, 1, 0]);
    expect(basis.right).toEqual([1, 0, 0]);
    basis.up.forEach((coordinate, index) => expect(coordinate).toBeCloseTo([0, 0, 1][index]));
    expect(projectNavballPoint([0, 1, 0], basis)).toEqual({ x: 84, y: 84, z: 1 });
  });

  it("matches the supplied level-north reference attitude", () => {
    const geometry = buildNavballGeometry({ heading: 0, pitch: 0, roll: 0 });
    expect(geometry.grid).toHaveLength(9);
    expect(geometry.horizonPath).not.toBe("");
    expect(geometry.skyPath).not.toBe("");
    expect(geometry.cardinals).toEqual([{ label: "N", x: 84, y: 80 }]);
  });

  it("matches the supplied 45-degree eastward ascent reference attitude", () => {
    const geometry = buildNavballGeometry({ heading: 90, pitch: 45, roll: 0 });
    expect(geometry.grid).toHaveLength(15);
    expect(geometry.cardinals.map(({ label }) => label)).toEqual(["E"]);
    expect(geometry.skyPath.endsWith("Z")).toBe(true);
  });

  it("renders a complete sky hemisphere when pointed straight up", () => {
    const geometry = buildNavballGeometry({ heading: 0, pitch: 90, roll: 0 });
    expect(geometry.skyPath).toBe("M6 84A78 78 0 1 1 162 84A78 78 0 1 1 6 84Z");
    expect(geometry.horizonPath).toBe("");
    expect(geometry.cardinals).toHaveLength(0);
  });

  it("matches the supplied current-attitude cardinal visibility", () => {
    const geometry = buildNavballGeometry({ heading: 284, pitch: -1, roll: -105 });
    expect(geometry.cardinals.map(({ label }) => label)).toEqual(["N", "W"]);
    expect(geometry.heading).toBe(284);
    expect(geometry.pitch).toBe(-1);
    expect(geometry.roll).toBe(-105);
  });

  it("normalizes heading and clamps pitch before projection", () => {
    expect(buildNavballGeometry({ heading: -76, pitch: 120, roll: 0 })).toMatchObject({
      heading: 284,
      pitch: 90,
    });
  });
});
