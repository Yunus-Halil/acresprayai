// Direct photo georeferencing, part 6: calibrate the camera from the flight's own overlap.
//
// The header gives the gimbal's angles, not the camera's: the sensor can sit a degree or two off the gimbal axes, and
// the principal point can sit off the image centre. Neither is in the file. Both act the same way on a near-nadir
// photo: every ground point shifts by a constant amount IN THE CAMERA'S FRAME, so legs flown in opposite directions
// are shifted in opposite directions on the ground. On the apricot flight (2026-10-26) that showed as soil and
// plants doubled 1.9 m apart between neighbouring opposite legs, measured independently from soil texture.
//
// The fix is the one any photogrammetry suite applies (boresight / self-calibration), reduced to four numbers for
// the whole flight instead of a full bundle adjustment:
//   tiltAcrossDeg  rotation about the camera's y axis: shifts the ground across the image (x)
//   tiltAlongDeg   rotation about the camera's x axis: shifts the ground along the image (y)
//   spinDeg        rotation about the optical axis
//   groundOffsetM  the effective ground plane against the take-off height at the flight's centre (also absorbs a
//                  focal-length scale error, which is indistinguishable from height in near-nadir photos)
//   slopeEast/North the ground plane's rise per metre east and north: a field is rarely level over 150 m, and a
//                  height difference dh between neighbouring legs 22 m apart shifts their ground by 22 x dh / 36 m.
//                  A tilted plane is still a plane, so the four-corner homography stays exact
// Each candidate is scored by consensus: how many green patches from different photographs land within `inlierM`
// of each other. Consensus, not least squares, so wrong matches and plants standing above the soil cannot drag the
// answer; the camera positions are not touched (RTK already puts them within centimetres).
import { toEnu } from "../sourceFrames/odm";
import { TAKEOFF_DATUM } from "./frame";
import { applyHomography, homographyFrom4, type P2 } from "./homography";
import type { PixelObject } from "./objects";
import { type Boresight, type GeorefFrame, type M3, frameCorners, mulM } from "./projection";

export type Calibration = {
  tiltAcrossDeg: number; tiltAlongDeg: number; spinDeg: number; groundOffsetM: number;
  /** Metres of rise per metre east / north of `origin`. */
  slopeEast: number; slopeNorth: number;
  origin: { lat: number; lng: number } | null;
};
export const NO_CALIBRATION: Calibration = { tiltAcrossDeg: 0, tiltAlongDeg: 0, spinDeg: 0, groundOffsetM: 0, slopeEast: 0, slopeNorth: 0, origin: null };

const rad = (d: number) => (d * Math.PI) / 180;

/** The boresight rotation (camera ray -> gimbal-reported camera frame) for these angles. */
export function boresightOf(c: Calibration, basis: string): Boresight {
  const a = rad(c.tiltAlongDeg), b = rad(c.tiltAcrossDeg), g = rad(c.spinDeg);
  const Rx: M3 = [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const Ry: M3 = [Math.cos(b), 0, Math.sin(b), 0, 1, 0, -Math.sin(b), 0, Math.cos(b)];
  const Rz: M3 = [Math.cos(g), -Math.sin(g), 0, Math.sin(g), Math.cos(g), 0, 0, 0, 1];
  return { rotation: mulM(Rz, mulM(Ry, Rx)), basis };
}

/** A copy of the frame with the calibration applied (boresight + ground plane). */
export function applyCalibration(f: GeorefFrame, c: Calibration, basis: string): GeorefFrame {
  if (f.ground.kind !== "flat") throw new Error("calibration is estimated against a flat ground plane");
  const pose = { ...f.pose, boresight: boresightOf(c, basis) };
  const base = f.ground.altM + c.groundOffsetM;
  const sloped = (c.slopeEast !== 0 || c.slopeNorth !== 0) && c.origin;
  if (!sloped) return { ...f, pose, ground: { ...f.ground, altM: base, basis: `${f.ground.basis}; plane moved ${c.groundOffsetM >= 0 ? "+" : ""}${c.groundOffsetM.toFixed(2)} m by the overlap calibration` } };
  const o = { lat: c.origin!.lat, lng: c.origin!.lng, altM: 0 };
  return {
    ...f, pose,
    ground: {
      kind: "surface", datum: f.ground.datum,
      altAt: (lat, lng) => { const e = toEnu({ lat, lng, altM: 0 }, o); return base + c.slopeEast * e[0] + c.slopeNorth * e[1]; },
      basis: `ground plane fitted to this flight's overlap: ${c.groundOffsetM >= 0 ? "+" : ""}${c.groundOffsetM.toFixed(2)} m against take-off at the flight centre, rising ${(c.slopeEast * 100).toFixed(1)} % east and ${(c.slopeNorth * 100).toFixed(1)} % north`,
    },
  };
}

export type CalibrationInput = { frame: GeorefFrame; objects: PixelObject[] };

export type CalibrateOptions = {
  /** Two patches from different photographs closer than this agree, metres. */
  inlierM?: number;
  /** Patch sizes used, square metres at the frame centre (small and medium: near the soil, well localised). */
  minAreaM2?: number;
  maxAreaM2?: number;
  /** Search half-ranges and the coarse step. */
  tiltRangeDeg?: number;
  spinRangeDeg?: number;
  groundRangeM?: number;
  /** Half-range of each slope, metres per metre (0 = keep the ground level). */
  slopeRange?: number;
};
export const CALIBRATE_DEFAULTS: Required<CalibrateOptions> = { inlierM: 0.25, minAreaM2: 0.01, maxAreaM2: 0.5, tiltRangeDeg: 3, spinRangeDeg: 2, groundRangeM: 3, slopeRange: 0 };

export type CalibrationResult = {
  calibration: Calibration;
  /** Agreement score before and after: patch pairs from different photographs within inlierM, each weighted 0-1 by closeness. */
  agreeingBefore: number;
  agreeingAfter: number;
  patchesUsed: number;
  frames: number;
};

/**
 * Search the four numbers that make the photographs agree best. Every frame must use the flat take-off ground (the
 * calibration is relative to it). Coordinate descent over a coarse grid, then two refinements at a quarter step.
 */
export function calibrateFromOverlap(input: CalibrationInput[], opts: CalibrateOptions = {}): CalibrationResult {
  const o = { ...CALIBRATE_DEFAULTS, ...opts };
  const usable = input.filter(x => x.frame.ground.kind === "flat" && x.frame.ground.datum === TAKEOFF_DATUM);
  if (!usable.length) throw new Error("no frames on the flat take-off ground to calibrate");
  const origin = { lat: usable.reduce((s, x) => s + x.frame.pose.lat, 0) / usable.length, lng: usable.reduce((s, x) => s + x.frame.pose.lng, 0) / usable.length, altM: 0 };
  // Patches by size at the nominal pixel (height / focal); the edge-cut ones are out (their centroid is truncated).
  const pts = usable.map(x => {
    const gsd = x.frame.pose.altM / x.frame.intrinsics.fx;
    return x.objects.filter(p => !p.touchesEdge && p.areaPx * gsd * gsd >= o.minAreaM2 && p.areaPx * gsd * gsd <= o.maxAreaM2).map(p => [p.u, p.v] as P2);
  });
  const patchesUsed = pts.reduce((s, p) => s + p.length, 0);

  const score = (c: Calibration): number => {
    // Per frame the flat-ground map is a homography: four ray casts, then every patch in microseconds.
    const cell = o.inlierM;
    const grid = new Map<string, { f: number; x: number; y: number }[]>();
    const placed: { f: number; x: number; y: number }[] = [];
    usable.forEach((x, fi) => {
      const g = applyCalibration(x.frame, c, "");
      const corners = frameCorners(g);
      if (!corners) return;
      const off = toEnu({ lat: g.pose.lat, lng: g.pose.lng, altM: 0 }, origin);
      const { width: w, height: h } = g.intrinsics;
      const H = homographyFrom4([[0, 0], [w, 0], [w, h], [0, h]], corners.map(k => [k.eastM + off[0], k.northM + off[1]] as P2));
      if (!H) return;
      for (const [u, v] of pts[fi]) {
        const [px, py] = applyHomography(H, u, v);
        const q = { f: fi, x: px, y: py };
        placed.push(q);
        const key = `${Math.floor(px / cell)},${Math.floor(py / cell)}`;
        (grid.get(key) ?? grid.set(key, []).get(key)!).push(q);
      }
    });
    // Each patch counts once per other photograph it agrees with, weighted by how closely (a Gaussian of the
    // distance, sigma = inlierM / 2.5): a hard count is flat over a whole search step, the weight is not.
    let n = 0;
    const k2 = 1 / (2 * (cell / 2.5) ** 2);
    const bestBy = new Map<number, number>();
    for (const p of placed) {
      const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
      bestBy.clear();
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const q of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (q.f === p.f) continue;
          const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
          if (d2 <= cell * cell && d2 < (bestBy.get(q.f) ?? Infinity)) bestBy.set(q.f, d2);
        }
      }
      for (const d2 of bestBy.values()) n += Math.exp(-d2 * k2);
    }
    return n;
  };

  const before = score(NO_CALIBRATION);
  let best: Calibration = { ...NO_CALIBRATION, origin: { lat: origin.lat, lng: origin.lng } }, bestScore = before;
  type Key = "tiltAcrossDeg" | "tiltAlongDeg" | "spinDeg" | "groundOffsetM" | "slopeEast" | "slopeNorth";
  const dims: { key: Key; range: number; step: number }[] = [
    { key: "tiltAcrossDeg", range: o.tiltRangeDeg, step: 0.1 },
    { key: "tiltAlongDeg", range: o.tiltRangeDeg, step: 0.1 },
    { key: "spinDeg", range: o.spinRangeDeg, step: 0.1 },
    { key: "groundOffsetM", range: o.groundRangeM, step: 0.1 },
    ...(o.slopeRange > 0 ? [{ key: "slopeEast" as const, range: o.slopeRange, step: 0.0025 }, { key: "slopeNorth" as const, range: o.slopeRange, step: 0.0025 }] : []),
  ];
  const sweep = (key: Key, lo: number, hi: number, step: number) => {
    for (let v = lo; v <= hi + 1e-9; v += step) {
      const c = { ...best, [key]: Math.round(v * 1e5) / 1e5 };
      const s = score(c);
      if (s > bestScore) { bestScore = s; best = c; }
    }
  };
  for (let round = 0; round < 3; round++) for (const d of dims) sweep(d.key, -d.range, d.range, d.step);
  for (const refine of [4, 16]) for (const d of dims) {
    const st = d.step / refine;
    sweep(d.key, best[d.key] - d.step, best[d.key] + d.step, st);
  }
  // Tilt and ground height trade off along a diagonal valley; one pass of one-number sweeps stops partway down it.
  // Polish: repeat fine sweeps of every number until a whole round improves nothing.
  for (let round = 0; round < 40; round++) {
    const before = bestScore;
    for (const d of dims) { const st = d.step / 16; sweep(d.key, best[d.key] - 4 * st, best[d.key] + 4 * st, st); }
    if (bestScore <= before) break;
  }
  return { calibration: best, agreeingBefore: before, agreeingAfter: bestScore, patchesUsed, frames: usable.length };
}
