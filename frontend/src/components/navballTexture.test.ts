import { describe, expect, it } from "vitest";
import { makeNavballBasis } from "./navballGeometry";
import { navballTextureCoordinates, renderTexturedNavball } from "./navballTexture";

describe("textured navball projection", () => {
  it("maps the source texture cardinals and poles through the shared attitude basis", () => {
    expect(navballTextureCoordinates(makeNavballBasis(0, 0, 0), 0, 0)).toEqual({ u: .5, v: .5 });
    expect(navballTextureCoordinates(makeNavballBasis(90, 0, 0), 0, 0)).toEqual({ u: .75, v: .5 });
    expect(navballTextureCoordinates(makeNavballBasis(0, 90, 0), 0, 0)).toEqual({ u: .5, v: 0 });
    expect(navballTextureCoordinates(makeNavballBasis(0, -90, 0), 0, 0)).toEqual({ u: .5, v: 1 });
  });

  it("rotates the texture with roll and wraps equivalent headings", () => {
    const rolledTop = navballTextureCoordinates(makeNavballBasis(0, 0, 90), 0, 1);
    expect(rolledTop?.u).toBeCloseTo(.25, 10);
    expect(rolledTop?.v).toBeCloseTo(.5, 10);
    expect(navballTextureCoordinates(makeNavballBasis(360, 0, 0), 0, 0)?.u).toBeCloseTo(.5, 10);
  });

  it("keeps pixels outside the sphere transparent", () => {
    const texture = {
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]),
      width: 2,
      height: 1,
    };
    const output = renderTexturedNavball(texture, makeNavballBasis(0, 0, 0), 5);
    expect([...output.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(output[(2 * 5 + 2) * 4 + 3]).toBe(255);
  });

  it("interpolates continuously across the longitude seam", () => {
    const texture = {
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]),
      width: 2,
      height: 1,
    };
    const output = renderTexturedNavball(texture, makeNavballBasis(180, 0, 0), 3);
    expect([...output.slice((1 * 3 + 1) * 4, (1 * 3 + 1) * 4 + 4)]).toEqual([128, 0, 128, 255]);
  });
});
