import type { NavballBasis } from "./navballGeometry";

export interface NavballTextureSource {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface SphereLookup {
  size: number;
  vectors: Float32Array;
}

const lookupCache = new Map<number, SphereLookup>();
const sphereRadiusRatio = 78 / 168;
const textureLongitudeOffset = .5;

function sphereLookup(size: number): SphereLookup {
  const cached = lookupCache.get(size);
  if (cached) return cached;

  const vectors = new Float32Array(size * size * 3);
  vectors.fill(Number.NaN);
  const center = size / 2;
  const radius = size * sphereRadiusRatio;
  for (let y = 0; y < size; y += 1) {
    const sy = (center - (y + .5)) / radius;
    for (let x = 0; x < size; x += 1) {
      const sx = (x + .5 - center) / radius;
      const radialSquared = sx * sx + sy * sy;
      if (radialSquared > 1) continue;
      const index = (y * size + x) * 3;
      vectors[index] = sx;
      vectors[index + 1] = sy;
      vectors[index + 2] = Math.sqrt(1 - radialSquared);
    }
  }
  const lookup = { size, vectors };
  lookupCache.set(size, lookup);
  return lookup;
}

function wrapped(value: number, extent: number) {
  return ((value % extent) + extent) % extent;
}

function coordinatesFromSphereVector(
  basis: NavballBasis,
  screenX: number,
  screenY: number,
  screenForward: number,
) {
  const worldX = basis.right[0] * screenX + basis.up[0] * screenY + basis.forward[0] * screenForward;
  const worldY = basis.right[1] * screenX + basis.up[1] * screenY + basis.forward[1] * screenForward;
  const worldZ = basis.right[2] * screenX + basis.up[2] * screenY + basis.forward[2] * screenForward;
  const longitude = Math.atan2(worldX, worldY);
  const latitude = Math.asin(Math.max(-1, Math.min(1, worldZ)));
  return {
    u: wrapped(longitude / (2 * Math.PI) + textureLongitudeOffset, 1),
    v: .5 - latitude / Math.PI,
  };
}

export function navballTextureCoordinates(
  basis: NavballBasis,
  screenX: number,
  screenY: number,
): { u: number; v: number } | null {
  const radialSquared = screenX * screenX + screenY * screenY;
  if (radialSquared > 1) return null;
  return coordinatesFromSphereVector(basis, screenX, screenY, Math.sqrt(1 - radialSquared));
}

function sampleBilinear(texture: NavballTextureSource, u: number, v: number, output: Uint8ClampedArray, outputIndex: number) {
  const sourceX = u * texture.width - .5;
  const sourceY = Math.max(0, Math.min(texture.height - 1, v * texture.height - .5));
  const x0 = Math.floor(sourceX);
  const y0 = Math.floor(sourceY);
  const x1 = x0 + 1;
  const y1 = Math.min(texture.height - 1, y0 + 1);
  const xWeight = sourceX - x0;
  const yWeight = sourceY - y0;
  const wrappedX0 = wrapped(x0, texture.width);
  const wrappedX1 = wrapped(x1, texture.width);
  const topLeft = (y0 * texture.width + wrappedX0) * 4;
  const topRight = (y0 * texture.width + wrappedX1) * 4;
  const bottomLeft = (y1 * texture.width + wrappedX0) * 4;
  const bottomRight = (y1 * texture.width + wrappedX1) * 4;

  for (let channel = 0; channel < 4; channel += 1) {
    const top = texture.data[topLeft + channel] * (1 - xWeight)
      + texture.data[topRight + channel] * xWeight;
    const bottom = texture.data[bottomLeft + channel] * (1 - xWeight)
      + texture.data[bottomRight + channel] * xWeight;
    output[outputIndex + channel] = top * (1 - yWeight) + bottom * yWeight;
  }
}

export function renderTexturedNavball(
  texture: NavballTextureSource,
  basis: NavballBasis,
  size: number,
  destination?: Uint8ClampedArray,
): Uint8ClampedArray {
  const lookup = sphereLookup(size);
  const requiredLength = size * size * 4;
  const output = destination?.length === requiredLength
    ? destination
    : new Uint8ClampedArray(requiredLength);
  output.fill(0);

  for (let pixel = 0; pixel < size * size; pixel += 1) {
    const lookupIndex = pixel * 3;
    const screenX = lookup.vectors[lookupIndex];
    if (!Number.isFinite(screenX)) continue;
    const coordinates = coordinatesFromSphereVector(
      basis,
      screenX,
      lookup.vectors[lookupIndex + 1],
      lookup.vectors[lookupIndex + 2],
    );
    sampleBilinear(texture, coordinates.u, coordinates.v, output, pixel * 4);
  }

  return output;
}
