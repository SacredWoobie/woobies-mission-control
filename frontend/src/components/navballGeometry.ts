const degreesToRadians = Math.PI / 180;
const centerX = 84;
const centerY = 84;
const radius = 78;

export type Vector3 = readonly [number, number, number];

export interface NavballBasis {
  forward: Vector3;
  right: Vector3;
  up: Vector3;
}

export interface NavballGeometry {
  cardinals: readonly { label: string; x: number; y: number }[];
  grid: readonly { path: string; opacity: number }[];
  heading: number;
  horizonPath: string;
  northReferencePath: string;
  pitch: number;
  roll: number;
  skyPath: string;
}

function dot(a: Vector3, b: Vector3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function combine(a: Vector3, aScale: number, b: Vector3, bScale: number): Vector3 {
  return [
    a[0] * aScale + b[0] * bScale,
    a[1] * aScale + b[1] * bScale,
    a[2] * aScale + b[2] * bScale,
  ];
}

export function makeNavballBasis(heading: number, pitch: number, roll: number): NavballBasis {
  const headingRadians = heading * degreesToRadians;
  const pitchRadians = pitch * degreesToRadians;
  // kRPC reports positive roll as a right bank. An attitude indicator keeps
  // the aircraft fixed, so the world must rotate in the opposite direction.
  const rollRadians = roll === 0 ? 0 : -roll * degreesToRadians;
  const forward: Vector3 = [
    Math.sin(headingRadians) * Math.cos(pitchRadians),
    Math.cos(headingRadians) * Math.cos(pitchRadians),
    Math.sin(pitchRadians),
  ];
  const levelRight: Vector3 = [Math.cos(headingRadians), -Math.sin(headingRadians), 0];
  const levelUp = cross(levelRight, forward);
  return {
    forward,
    right: combine(levelRight, Math.cos(rollRadians), levelUp, Math.sin(rollRadians)),
    up: combine(levelRight, -Math.sin(rollRadians), levelUp, Math.cos(rollRadians)),
  };
}

export function projectNavballPoint(point: Vector3, basis: NavballBasis) {
  return {
    x: centerX + dot(point, basis.right) * radius,
    y: centerY - dot(point, basis.up) * radius,
    z: dot(point, basis.forward),
  };
}

function rimPoint(angle: number, basis: NavballBasis) {
  return combine(basis.right, Math.cos(angle), basis.up, -Math.sin(angle));
}

function curvePath(points: readonly Vector3[], basis: NavballBasis) {
  let path = "";
  let penDown = false;
  points.forEach((point) => {
    const projected = projectNavballPoint(point, basis);
    if (projected.z > .002) {
      path += `${penDown ? "L" : "M"}${projected.x.toFixed(1)} ${projected.y.toFixed(1)}`;
      penDown = true;
    } else {
      penDown = false;
    }
  });
  return path;
}

function latitudeRing(latitude: number, steps: number) {
  const points: Vector3[] = [];
  const latitudeRadians = latitude * degreesToRadians;
  const circleRadius = Math.cos(latitudeRadians);
  const height = Math.sin(latitudeRadians);
  for (let index = 0; index <= steps; index += 1) {
    const angle = index / steps * 2 * Math.PI;
    points.push([
      circleRadius * Math.sin(angle),
      circleRadius * Math.cos(angle),
      height,
    ]);
  }
  return points;
}

function halfMeridian(azimuth: number, steps: number) {
  const points: Vector3[] = [];
  const azimuthRadians = azimuth * degreesToRadians;
  const azimuthSin = Math.sin(azimuthRadians);
  const azimuthCos = Math.cos(azimuthRadians);
  for (let index = 0; index <= steps; index += 1) {
    const latitude = (-90 + 180 * index / steps) * degreesToRadians;
    points.push([
      azimuthSin * Math.cos(latitude),
      azimuthCos * Math.cos(latitude),
      Math.sin(latitude),
    ]);
  }
  return points;
}

function skyRegion(basis: NavballBasis) {
  const steps = 200;
  const horizon = latitudeRing(0, steps).slice(0, steps);
  const visible = horizon.map((point) => dot(point, basis.forward) > .002);
  if (!visible.some(Boolean)) {
    return dot([0, 0, 1], basis.forward) > 0
      ? "M6 84A78 78 0 1 1 162 84A78 78 0 1 1 6 84Z"
      : "";
  }

  let start = visible.indexOf(false);
  if (start === -1) start = 0;
  const arc: Vector3[] = [];
  for (let index = 0; index < steps; index += 1) {
    const ringIndex = (start + index) % steps;
    if (visible[ringIndex]) arc.push(horizon[ringIndex]);
    else if (arc.length) break;
  }
  if (arc.length < 2) return "";

  let path = "";
  arc.forEach((point, index) => {
    const projected = projectNavballPoint(point, basis);
    path += `${index ? "L" : "M"}${projected.x.toFixed(1)} ${projected.y.toFixed(1)}`;
  });

  const first = projectNavballPoint(arc[0], basis);
  const last = projectNavballPoint(arc[arc.length - 1], basis);
  const firstAngle = Math.atan2(first.y - centerY, first.x - centerX);
  const lastAngle = Math.atan2(last.y - centerY, last.x - centerX);
  let delta = firstAngle - lastAngle;
  while (delta < 0) delta += 2 * Math.PI;
  const sweep = rimPoint(lastAngle + delta / 2, basis)[2] > 0 ? 1 : 0;
  const span = sweep === 1 ? delta : 2 * Math.PI - delta;
  return `${path}A${radius} ${radius} 0 ${span > Math.PI ? 1 : 0} ${sweep} ${first.x.toFixed(1)} ${first.y.toFixed(1)}Z`;
}

function finite(value: number | undefined, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function buildNavballGeometry({
  heading: inputHeading,
  pitch: inputPitch,
  roll: inputRoll,
}: {
  heading?: number;
  pitch?: number;
  roll?: number;
}): NavballGeometry {
  const heading = ((finite(inputHeading) % 360) + 360) % 360;
  const pitch = Math.max(-90, Math.min(90, finite(inputPitch)));
  const roll = finite(inputRoll);
  const basis = makeNavballBasis(heading, pitch, roll);
  const grid: { path: string; opacity: number }[] = [];

  [-60, -30, 30, 60].forEach((latitude) => {
    const path = curvePath(latitudeRing(latitude, 140), basis);
    if (path) grid.push({ path, opacity: .13 });
  });
  for (let azimuth = 0; azimuth < 360; azimuth += 30) {
    const path = curvePath(halfMeridian(azimuth, 90), basis);
    if (path) grid.push({ path, opacity: azimuth % 90 === 0 ? .22 : .11 });
  }

  const cardinalPoints: readonly [string, Vector3][] = [
    ["N", [0, 1, 0]],
    ["E", [1, 0, 0]],
    ["S", [0, -1, 0]],
    ["W", [-1, 0, 0]],
  ];
  const cardinals = cardinalPoints.flatMap(([label, point]) => {
    const projected = projectNavballPoint(point, basis);
    return projected.z > .18
      ? [{ label, x: projected.x, y: projected.y - 4 }]
      : [];
  });

  return {
    cardinals,
    grid,
    heading,
    horizonPath: curvePath(latitudeRing(0, 200), basis),
    northReferencePath: curvePath(halfMeridian(0, 90), basis),
    pitch,
    roll,
    skyPath: skyRegion(basis),
  };
}
