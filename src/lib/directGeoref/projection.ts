// Direct photo georeferencing, part 2: from a pixel in ONE photograph to a place on the ground, with no orthomosaic.
//
// The camera is a pinhole at a known position, pointing in a known direction. A pixel defines a ray out of the lens;
// where that ray meets the ground is the pixel's ground position. The inverse (ground to pixel) is the same geometry
// run backwards, and both are exact for the model given. What is approximate is always a named input:
//
//   position     camera centre, latitude/longitude + height                      (RTK on the test flight: ~1-2 cm)
//   intrinsics   focal length fx, fy and principal point cx, cy, pixels           (from the file; see basis)
//   distortion   Brown k1 k2 k3 p1 p2, or null when the frame is already dewarped (see basis)
//   attitude     gimbal yaw / pitch / roll, degrees, world-referenced NED (DJI)
//   boresight    camera-to-gimbal correction rotation; identity unless calibrated
//   ground       a horizontal plane at a declared height, or a surface function (a DEM) in the same vertical datum
//
// Frames and conventions (all checked by the tests in src/test/directGeoref.test.ts):
//   pixels       continuous coordinates: the top-left corner of the image is (0, 0), the bottom-right corner is
//                (width, height), the centre of pixel (i, j) is (i + 0.5, j + 0.5). DJI writes the principal point
//                in this convention (5472 x 3648 gives 2736, 1824)
//   camera       x right, y down, z out of the lens (OpenCV)
//   gimbal body  x forward, y right, z down; camera z = body x, camera x = body y, camera y = body z
//   attitude     R_ned = Rz(yaw) Ry(pitch) Rx(roll), yaw clockwise from north, pitch -90 = straight down. At yaw 0 and
//                pitch -90 the top of the image faces north and its right faces east
//   world        local east-north-up metres about the camera's own ground point (the equirectangular tangent plane
//                odm.ts already uses: millimetres of error over a 60 m footprint)
import { fromEnu, toEnu, type LatLngAlt } from "../sourceFrames/odm";

export type V3 = [number, number, number];
/** 3x3, row-major. */
export type M3 = [number, number, number, number, number, number, number, number, number];

export type BrownDistortion = { k1: number; k2: number; k3: number; p1: number; p2: number };

export type Intrinsics = {
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  /** Null: the pixels are already undistorted (a pinhole). */
  distortion: BrownDistortion | null;
  /** Why these numbers can be used, in words. */
  basis: string;
};

/**
 * The order the three angles compose in. "ZYX" = Rz(yaw) Ry(pitch) Rx(roll), the aerospace Euler convention; at
 * pitch -90 it is in gimbal lock (roll spins the image about the optical axis, like yaw). "ZXY" = Rz(yaw) Rx(roll)
 * Ry(pitch), the order DJI's three-axis gimbals stack their motors (yaw, roll, pitch); there roll tips a nadir view
 * sideways. DJI does not document which one its XMP angles follow; they agree whenever roll is 0 (every straight-leg
 * frame of the test flight) and the turn frames decide between them (scripts/directGeoref/run.ts reports both).
 */
export type AngleOrder = "ZYX" | "ZXY";

export type Attitude = { yawDeg: number; pitchDeg: number; rollDeg: number; order?: AngleOrder; basis: string };

export type Boresight = { rotation: M3; basis: string };

export const IDENTITY: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const UNCALIBRATED_BORESIGHT: Boresight = {
  rotation: IDENTITY,
  basis: "identity: camera assumed aligned with the gimbal axes (no boresight calibration has been run)",
};

export type CameraPose = {
  lat: number;
  lng: number;
  /** Camera height in `datum`. */
  altM: number;
  datum: string;
  attitude: Attitude;
  boresight: Boresight;
  basis: string;
};

export type GroundModel =
  | { kind: "flat"; altM: number; datum: string; basis: string }
  | { kind: "surface"; altAt: (lat: number, lng: number) => number | null; datum: string; basis: string };

export type GeorefFrame = { name: string; intrinsics: Intrinsics; pose: CameraPose; ground: GroundModel };

export type GroundPoint = {
  lat: number;
  lng: number;
  /** Height of the ground point, same datum as the camera. */
  altM: number;
  /** Metres east and north of the point straight below the camera. */
  eastM: number;
  northM: number;
  /** Straight-line distance from the lens, metres. */
  rangeM: number;
  /** Angle between the ray and straight down, degrees. */
  offNadirDeg: number;
};

export class GeorefError extends Error {}

// ------------------------------------------------------------------------------------------------------------------
// Rotations
// ------------------------------------------------------------------------------------------------------------------

const rad = (d: number) => (d * Math.PI) / 180;

export function mulM(a: M3, b: M3): M3 {
  const o = new Array(9).fill(0) as M3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
export const mulV = (m: M3, v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export const mulTV = (m: M3, v: V3): V3 => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];

/** Body (x forward, y right, z down) to north-east-down: Rz(yaw) Ry(pitch) Rx(roll), or Rz Rx Ry for "ZXY". */
export function nedFromBody(yawDeg: number, pitchDeg: number, rollDeg: number, order: AngleOrder = "ZYX"): M3 {
  const cy = Math.cos(rad(yawDeg)), sy = Math.sin(rad(yawDeg));
  const cp = Math.cos(rad(pitchDeg)), sp = Math.sin(rad(pitchDeg));
  const cr = Math.cos(rad(rollDeg)), sr = Math.sin(rad(rollDeg));
  const Rz: M3 = [cy, -sy, 0, sy, cy, 0, 0, 0, 1];
  const Ry: M3 = [cp, 0, sp, 0, 1, 0, -sp, 0, cp];
  const Rx: M3 = [1, 0, 0, 0, cr, -sr, 0, sr, cr];
  return order === "ZYX" ? mulM(Rz, mulM(Ry, Rx)) : mulM(Rz, mulM(Rx, Ry));
}

/** Camera (x right, y down, z optical) to gimbal body (x forward, y right, z down). */
const BODY_FROM_CAMERA: M3 = [0, 0, 1, 1, 0, 0, 0, 1, 0];
/** North-east-down to east-north-up. */
const ENU_FROM_NED: M3 = [0, 1, 0, 1, 0, 0, 0, 0, -1];

/** The rotation taking a camera-frame direction to local east-north-up. */
export function enuFromCamera(att: Attitude, boresight: Boresight = UNCALIBRATED_BORESIGHT): M3 {
  return mulM(ENU_FROM_NED, mulM(nedFromBody(att.yawDeg, att.pitchDeg, att.rollDeg, att.order ?? "ZYX"), mulM(BODY_FROM_CAMERA, boresight.rotation)));
}

// ------------------------------------------------------------------------------------------------------------------
// Lens
// ------------------------------------------------------------------------------------------------------------------

export function distortNormalised(d: BrownDistortion, x: number, y: number): [number, number] {
  const r2 = x * x + y * y;
  const radial = 1 + d.k1 * r2 + d.k2 * r2 * r2 + d.k3 * r2 * r2 * r2;
  return [x * radial + 2 * d.p1 * x * y + d.p2 * (r2 + 2 * x * x), y * radial + d.p1 * (r2 + 2 * y * y) + 2 * d.p2 * x * y];
}

/**
 * Inverse of distortNormalised: OpenCV's fixed-point start (divide out the radial term), then Newton steps on the
 * forward model with a numerical Jacobian, which converge where the fixed point stalls (strong barrel lenses near
 * the corners). Null when the model has no inverse there (a polynomial pushed past its fold, outside the radius it
 * was calibrated over): better no ray than a wrong one.
 */
export function undistortNormalised(d: BrownDistortion, xd: number, yd: number): [number, number] | null {
  let x = xd, y = yd;
  for (let i = 0; i < 10; i++) {
    const r2 = x * x + y * y;
    const radial = 1 + d.k1 * r2 + d.k2 * r2 * r2 + d.k3 * r2 * r2 * r2;
    x = (xd - (2 * d.p1 * x * y + d.p2 * (r2 + 2 * x * x))) / radial;
    y = (yd - (d.p1 * (r2 + 2 * y * y) + 2 * d.p2 * x * y)) / radial;
  }
  const h = 1e-7;
  for (let i = 0; i < 20; i++) {
    const [fx, fy] = distortNormalised(d, x, y);
    const ex = fx - xd, ey = fy - yd;
    if (Math.abs(ex) < 1e-14 && Math.abs(ey) < 1e-14) break;
    const [ax, ay] = distortNormalised(d, x + h, y), [bx, by] = distortNormalised(d, x, y + h);
    const j11 = (ax - fx) / h, j21 = (ay - fy) / h, j12 = (bx - fx) / h, j22 = (by - fy) / h;
    const det = j11 * j22 - j12 * j21;
    if (Math.abs(det) < 1e-12) break;
    x -= (j22 * ex - j12 * ey) / det;
    y -= (-j21 * ex + j11 * ey) / det;
  }
  const [cx, cy] = distortNormalised(d, x, y);
  return Math.hypot(cx - xd, cy - yd) < 1e-10 ? [x, y] : null;
}

/** Pixel to a camera-frame ray (z = 1); null where the lens model cannot be inverted. */
export function pixelRay(k: Intrinsics, u: number, v: number): V3 | null {
  const x = (u - k.cx) / k.fx, y = (v - k.cy) / k.fy;
  if (!k.distortion) return [x, y, 1];
  const xy = undistortNormalised(k.distortion, x, y);
  return xy ? [xy[0], xy[1], 1] : null;
}

// ------------------------------------------------------------------------------------------------------------------
// Pixel <-> ground
// ------------------------------------------------------------------------------------------------------------------

/** Local ENU about the camera's ground point; the camera itself sits at (0, 0, altM). */
const cameraOrigin = (p: CameraPose): LatLngAlt => ({ lat: p.lat, lng: p.lng, altM: 0 });

/** The ray of pixel (u, v) in local east-north-up, unnormalised; null where the lens model cannot be inverted. */
export function worldRay(f: GeorefFrame, u: number, v: number): V3 | null {
  const r = pixelRay(f.intrinsics, u, v);
  return r ? mulV(enuFromCamera(f.pose.attitude, f.pose.boresight), r) : null;
}

function sameDatum(f: GeorefFrame) {
  if (f.ground.datum !== f.pose.datum) throw new GeorefError(`ground heights are in "${f.ground.datum}" but the camera height is in "${f.pose.datum}"`);
}

/**
 * Where the ray of pixel (u, v) meets the ground, or null when it never does (pointing at or above the horizon).
 * A surface ground is intersected by fixed-point iteration from the flat answer under the camera: converges for any
 * surface whose slope is less steep than the ray (every near-nadir frame over farmland).
 */
export function pixelToGround(f: GeorefFrame, u: number, v: number): GroundPoint | null {
  sameDatum(f);
  const d = worldRay(f, u, v);
  if (!d || d[2] >= -1e-9) return null;
  const C: V3 = [0, 0, f.pose.altM];
  const origin = cameraOrigin(f.pose);
  const hit = (groundAlt: number): V3 | null => {
    const t = (groundAlt - C[2]) / d[2];
    return t > 0 ? [C[0] + t * d[0], C[1] + t * d[1], groundAlt] : null;
  };
  let P: V3 | null;
  if (f.ground.kind === "flat") {
    P = hit(f.ground.altM);
  } else {
    const below = f.ground.altAt(f.pose.lat, f.pose.lng);
    if (below == null) return null;
    P = hit(below);
    for (let i = 0; P && i < 50; i++) {
      const ll = fromEnu(P, origin);
      const h = f.ground.altAt(ll.lat, ll.lng);
      if (h == null) return null;
      const next = hit(h);
      if (!next) return null;
      const moved = Math.hypot(next[0] - P[0], next[1] - P[1]);
      P = next;
      if (moved < 1e-4) break;
    }
  }
  if (!P) return null;
  const ll = fromEnu(P, origin);
  const range = Math.hypot(P[0], P[1], P[2] - C[2]);
  return {
    lat: ll.lat, lng: ll.lng, altM: P[2], eastM: P[0], northM: P[1], rangeM: range,
    offNadirDeg: (Math.acos(Math.min(1, (C[2] - P[2]) / range)) * 180) / Math.PI,
  };
}

export type PixelHit = { u: number; v: number; inside: boolean; depthM: number };

/** Where a ground point lands in the photograph, or null when it is behind the camera. */
export function groundToPixel(f: GeorefFrame, lat: number, lng: number, altM: number): PixelHit | null {
  const X = toEnu({ lat, lng, altM }, cameraOrigin(f.pose));
  const rel: V3 = [X[0], X[1], X[2] - f.pose.altM];
  const c = mulTV(enuFromCamera(f.pose.attitude, f.pose.boresight), rel);
  if (c[2] <= 1e-9) return null;
  let x = c[0] / c[2], y = c[1] / c[2];
  if (f.intrinsics.distortion) [x, y] = distortNormalised(f.intrinsics.distortion, x, y);
  const u = f.intrinsics.fx * x + f.intrinsics.cx, v = f.intrinsics.fy * y + f.intrinsics.cy;
  return { u, v, depthM: c[2], inside: u >= 0 && v >= 0 && u <= f.intrinsics.width && v <= f.intrinsics.height };
}

/** Ground metres per pixel at (u, v): the square root of the ground area one pixel covers there. */
export function groundSampleAt(f: GeorefFrame, u: number, v: number): number | null {
  const a = pixelToGround(f, u, v), b = pixelToGround(f, u + 1, v), c = pixelToGround(f, u, v + 1);
  if (!a || !b || !c) return null;
  const ex = b.eastM - a.eastM, ey = b.northM - a.northM, fx = c.eastM - a.eastM, fy = c.northM - a.northM;
  return Math.sqrt(Math.abs(ex * fy - ey * fx));
}

/** The four image corners on the ground, clockwise from the top-left. Null when a corner misses the ground. */
export function frameCorners(f: GeorefFrame): GroundPoint[] | null {
  const { width: w, height: h } = f.intrinsics;
  const out: GroundPoint[] = [];
  for (const [u, v] of [[0, 0], [w, 0], [w, h], [0, h]] as const) {
    const g = pixelToGround(f, u, v);
    if (!g) return null;
    out.push(g);
  }
  return out;
}

/**
 * The image border on the ground, clockwise from the top-left, `perEdge` points per edge. With distortion or a
 * surface ground the border is not four straight lines, which is why it is sampled rather than joined corner to corner.
 */
export function frameFootprint(f: GeorefFrame, perEdge = 8): GroundPoint[] | null {
  const { width: w, height: h } = f.intrinsics;
  const pts: [number, number][] = [];
  for (let i = 0; i < perEdge; i++) pts.push([(w * i) / perEdge, 0]);
  for (let i = 0; i < perEdge; i++) pts.push([w, (h * i) / perEdge]);
  for (let i = 0; i < perEdge; i++) pts.push([w - (w * i) / perEdge, h]);
  for (let i = 0; i < perEdge; i++) pts.push([0, h - (h * i) / perEdge]);
  const out: GroundPoint[] = [];
  for (const [u, v] of pts) {
    const g = pixelToGround(f, u, v);
    if (!g) return null;
    out.push(g);
  }
  return out;
}

/** The camera centre in local ENU about a ground origin (for multi-view work). */
export function cameraCentreIn(f: GeorefFrame, origin: { lat: number; lng: number }): V3 {
  return toEnu({ lat: f.pose.lat, lng: f.pose.lng, altM: f.pose.altM }, { lat: origin.lat, lng: origin.lng, altM: 0 });
}
