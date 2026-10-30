// Test mode (2026-10-30): photographs WITHOUT a position in their header placed by matching them to each other.
//
// Every photograph is shrunk to a small grey picture, tapered at its own edges, and phase-correlated against every
// other one at the four quarter turns (free: a quarter turn of the square canvas is a re-indexing of its spectrum),
// then at a few small angles around the best turn. A pair that matches gives the second photograph's turn and shift
// relative to the first. The turns are solved first (a spanning tree of the strongest pairs, then averaged), the
// shifts second (least squares over every kept pair, the worst pairs dropped while they disagree), and the largest
// group of joined photographs is kept. Nothing here knows where the field is on the earth:
//
// - the scale comes from the crop's rows: the continuous-row reader measures the row pitch in pixels on a few
//   photographs and the operator's row spacing turns it into metres per pixel;
// - the camera is assumed: looking straight down, a 24 mm-equivalent lens, no lens distortion;
// - north is the first photograph's top edge, and the field sits at a stand-in origin (STAND_IN_ORIGIN).
//
// The result is a DJI-like header per photograph (position, height, gimbal yaw, pitch -90), so the rest of the
// build (the soil ties and the camera fit, rows, weeds, the bundle) runs exactly as on a flight with GPS.
import { fft2, type Spectrum, correlate } from "../../directGeoref/fft";
import type { DjiPhotoMeta } from "../../directGeoref/metadata";
import type { PhotoPixels } from "../../photoScout/pattern";
import { type RowCropStage, readRowCrop } from "../../rowCrop/readRowCrop";
import { fromEnu } from "../../sourceFrames/odm";
import { type BuildHooks, type PhotoSource, checkCancelled } from "./types";

/** Where a matched field is put: not a place, a stand-in near 0, 0 (the map hides its surroundings). */
export const STAND_IN_ORIGIN = { lat: 0.001, lng: 0.001 };
/** The lens assumed when the header holds none: 24 mm equivalent (a DJI Mavic 3 / Air 3 class wide camera). */
export const ASSUMED_FOCAL_35MM = 24;

export const MATCH_DEFAULTS = {
  /** Correlation canvas, cells a side (power of two); the photograph's long side fills it. */
  n: 256,
  /** Weakest correlation peak a quarter-turn match may have to be refined and kept. */
  minPeak: 0.06,
  /** Fewest shared ground (share of a photograph) a kept pair implies. */
  minOverlap: 0.2,
  /** Fine turns tried around the best quarter turn, degrees. */
  fineDeg: [-3, -2, -1, 1, 2, 3],
  /** Taper width at a photograph's edges, share of its side. */
  taper: 0.15,
  /** A pair whose turn disagrees with the solved turns by more is dropped, degrees. */
  maxTurnResidualDeg: 3,
  /** A pair whose shift disagrees with the solved positions by more is dropped, canvas cells (and 4 x the median). */
  maxShiftResidual: 2,
};
/** Scale readings within this share of each other agree. */
export const SCALE_AGREEMENT = 0.05;
export type MatchOptions = Partial<typeof MATCH_DEFAULTS>;

/** A photograph shrunk for matching: luma, the canvas's long side at most n. */
export type Thumb = { name: string; width: number; height: number; grey: Float32Array };

/** One matched pair: b's content is a's turned by `turnDeg` and moved by (dx, dy) canvas cells (see `solvePlacement`). */
export type MatchedPair = { a: string; b: string; turnDeg: number; dx: number; dy: number; peak: number; secondRatio: number; overlap: number };

export type Pose = { phi: number; x: number; y: number };

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const wrapPi = (a: number) => { let v = a % (2 * Math.PI); if (v > Math.PI) v -= 2 * Math.PI; if (v < -Math.PI) v += 2 * Math.PI; return v; };

/** A thumbnail from decoded pixels: box-averaged luma, long side at most `n` - 2 cells. */
export function thumbOf(name: string, px: PhotoPixels, n: number): { thumb: Thumb; factor: number } {
  const k = Math.max(1, Math.ceil(Math.max(px.width, px.height) / (n - 2)));
  const W = Math.floor(px.width / k), H = Math.floor(px.height / k), grey = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let yy = 0; yy < k; yy++) { let o = ((y * k + yy) * px.width + x * k) * 4; for (let xx = 0; xx < k; xx++, o += 4) s += 0.299 * px.rgba[o] + 0.587 * px.rgba[o + 1] + 0.114 * px.rgba[o + 2]; }
    grey[y * W + x] = s / (k * k);
  }
  return { thumb: { name, width: W, height: H, grey }, factor: k };
}

/** The thumbnail on an n x n canvas, its centre on cell (n/2, n/2), turned by `turn` radians (clockwise on screen), tapered at its own edges, mean removed. */
function canvasSpectrum(t: Thumb, n: number, turn: number, taper: number): Spectrum {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  const cx = (t.width - 1) / 2, cy = (t.height - 1) / 2, c = Math.cos(turn), s = Math.sin(turn);
  const tx = Math.max(1, taper * t.width), ty = Math.max(1, taper * t.height);
  const ramp = (d: number, w: number) => (d >= w ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * d) / w));
  const val = new Float64Array(n * n), wt = new Float64Array(n * n);
  let sw = 0, sv = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    // Canvas offset q from the centre shows the thumbnail at R(-turn) q.
    const qx = x - n / 2, qy = y - n / 2;
    const u = c * qx + s * qy + cx, v = -s * qx + c * qy + cy;
    if (u < 0 || v < 0 || u > t.width - 1 || v > t.height - 1) continue;
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0, x1 = Math.min(t.width - 1, x0 + 1), y1 = Math.min(t.height - 1, y0 + 1);
    const g = t.grey;
    const p = (g[y0 * t.width + x0] * (1 - fx) + g[y0 * t.width + x1] * fx) * (1 - fy) + (g[y1 * t.width + x0] * (1 - fx) + g[y1 * t.width + x1] * fx) * fy;
    const w = ramp(Math.min(u, t.width - 1 - u), tx) * ramp(Math.min(v, t.height - 1 - v), ty);
    val[y * n + x] = p; wt[y * n + x] = w; sw += w; sv += w * p;
  }
  const mean = sw > 0 ? sv / sw : 0;
  for (let k = 0; k < n * n; k++) re[k] = wt[k] > 0 ? (val[k] - mean) * wt[k] : 0;
  fft2(re, im, n);
  return { re, im, n };
}

/** The spectrum of the same canvas turned by q quarter turns: F'(k) = F(R^-1 k), indices mod n (exact for a square canvas centred on n/2). */
function quarterTurned(S: Spectrum, q: number): Spectrum {
  const n = S.n, qq = ((q % 4) + 4) % 4;
  if (qq === 0) return S;
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) {
    // R(90 deg) takes (x, y) to (-y, x); its inverse takes (u, v) to (v, -u).
    let su = u, sv = v;
    for (let i = 0; i < qq; i++) { const t = su; su = sv; sv = (n - t) % n; }
    re[v * n + u] = S.re[sv * n + su]; im[v * n + u] = S.im[sv * n + su];
  }
  return { re, im, n };
}

/** Shared ground of a's rectangle and b's, b turned by `turn` and centred at -d in a's canvas cells (share of a's area). */
export function overlapShare(wa: number, ha: number, wb: number, hb: number, turn: number, dx: number, dy: number): number {
  const c = Math.cos(turn), s = Math.sin(turn);
  // b's corners in a's canvas: content at a-offset p sits in b's canvas at p + d, i.e. b-offset R(-turn)(p + d); so a b-offset q is at R(turn) q - d.
  let poly: [number, number][] = [[-wb / 2, -hb / 2], [wb / 2, -hb / 2], [wb / 2, hb / 2], [-wb / 2, hb / 2]].map(([x, y]) => [c * x - s * y - dx, s * x + c * y - dy] as [number, number]);
  const clip = (keep: (p: [number, number]) => number) => {
    const out: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const P = poly[i], Q = poly[(i + 1) % poly.length], kp = keep(P), kq = keep(Q);
      if (kp >= 0) out.push(P);
      if ((kp >= 0) !== (kq >= 0)) { const t = kp / (kp - kq); out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); }
    }
    poly = out;
  };
  clip(p => p[0] + wa / 2); clip(p => wa / 2 - p[0]); clip(p => p[1] + ha / 2); clip(p => ha / 2 - p[1]);
  let area = 0;
  for (let i = 0; i < poly.length; i++) { const P = poly[i], Q = poly[(i + 1) % poly.length]; area += P[0] * Q[1] - Q[0] * P[1]; }
  return Math.abs(area) / 2 / (wa * ha);
}

/** Every pair of thumbnails tried; the ones that match, with their turn and shift. */
export async function matchPairs(thumbs: Thumb[], options: MatchOptions = {}, hooks: BuildHooks = {}): Promise<MatchedPair[]> {
  const o = { ...MATCH_DEFAULTS, ...options };
  const n = o.n, t0 = Date.now();
  const base = thumbs.map(t => canvasSpectrum(t, n, 0, o.taper));
  const out: MatchedPair[] = [];
  const total = (thumbs.length * (thumbs.length - 1)) / 2;
  let done = 0;
  for (let j = 1; j < thumbs.length; j++) {
    const turned = [base[j], quarterTurned(base[j], 1), quarterTurned(base[j], 2), quarterTurned(base[j], 3)];
    for (let i = 0; i < j; i++) {
      checkCancelled(hooks.signal);
      let best = { q: 0, r: correlate(base[i], turned[0]) };
      for (let q = 1; q < 4; q++) { const r = correlate(base[i], turned[q]); if (r.peak > best.r.peak) best = { q, r }; }
      done++;
      if (done % 50 === 0) { hooks.onProgress?.({ stage: "matching", done, total, message: `${out.length} overlapping pairs`, elapsedMs: Date.now() - t0 }); await new Promise(r => setTimeout(r, 0)); }
      if (best.r.peak < o.minPeak) continue;
      // Fine turns around the quarter turn, then a parabola through the best three.
      const at = new Map<number, ReturnType<typeof correlate>>([[0, best.r]]);
      for (const f of o.fineDeg) at.set(f, correlate(base[i], canvasSpectrum(thumbs[j], n, rad(best.q * 90 + f), o.taper)));
      const steps = [...at.keys()].sort((a, b) => a - b);
      let bf = 0;
      for (const f of steps) if (at.get(f)!.peak > at.get(bf)!.peak) bf = f;
      let turnFine = bf;
      const k = steps.indexOf(bf);
      if (k > 0 && k < steps.length - 1) {
        const ym = at.get(steps[k - 1])!.peak, y0 = at.get(bf)!.peak, yp = at.get(steps[k + 1])!.peak, h = steps[k + 1] - bf, d = ym - 2 * y0 + yp;
        if (d < 0) turnFine = bf + (0.5 * h * (ym - yp)) / d;
      }
      const turnDeg = best.q * 90 + turnFine;
      const r = Math.abs(turnFine - bf) > 1e-6 ? correlate(base[i], canvasSpectrum(thumbs[j], n, rad(turnDeg), o.taper)) : at.get(bf)!;
      const overlap = overlapShare(thumbs[i].width, thumbs[i].height, thumbs[j].width, thumbs[j].height, rad(turnDeg), r.dx, r.dy);
      if (r.peak < o.minPeak || overlap < o.minOverlap) continue;
      out.push({ a: thumbs[i].name, b: thumbs[j].name, turnDeg, dx: r.dx, dy: r.dy, peak: r.peak, secondRatio: r.secondRatio, overlap });
    }
  }
  hooks.onProgress?.({ stage: "matching", done: total, total, message: `${out.length} overlapping pairs`, elapsedMs: Date.now() - t0 });
  return out;
}

/** Conjugate gradients on the pairs' graph Laplacian (one coordinate), the anchor held at 0. */
function solveLaplacian(nNodes: number, edges: { i: number; j: number; w: number; m: number }[], anchor: number): Float64Array {
  const apply = (x: Float64Array, y: Float64Array) => {
    y.fill(0);
    for (const e of edges) { const d = e.w * (x[e.j] - x[e.i]); y[e.j] += d; y[e.i] -= d; }
    y[anchor] += 1e6 * x[anchor];
  };
  const b = new Float64Array(nNodes);
  for (const e of edges) { b[e.j] += e.w * e.m; b[e.i] -= e.w * e.m; }
  const x = new Float64Array(nNodes), r = Float64Array.from(b), p = Float64Array.from(b), Ap = new Float64Array(nNodes);
  let rr = r.reduce((s, v) => s + v * v, 0);
  for (let it = 0; it < 4 * nNodes + 50 && rr > 1e-12; it++) {
    apply(p, Ap);
    const pAp = p.reduce((s, v, k) => s + v * Ap[k], 0);
    if (pAp <= 0) break;
    const a = rr / pAp;
    for (let k = 0; k < nNodes; k++) { x[k] += a * p[k]; r[k] -= a * Ap[k]; }
    const rr2 = r.reduce((s, v) => s + v * v, 0);
    for (let k = 0; k < nNodes; k++) p[k] = r[k] + (rr2 / rr) * p[k];
    rr = rr2;
  }
  return x;
}

export type PlacementSolve = { poses: Map<string, Pose>; kept: MatchedPair[]; dropped: { pair: MatchedPair; why: string }[]; unjoined: string[] };

/**
 * Turns and positions of the photographs from the matched pairs, in canvas cells, the largest joined group only.
 * Model: a ground point at canvas offset p of photograph a is at mosaic position t_a + R(phi_a) p; a pair (a, b,
 * turn, d) says phi_b = phi_a + turn and t_b = t_a - R(phi_a) d.
 */
export function solvePlacement(names: string[], pairs: MatchedPair[], options: MatchOptions = {}): PlacementSolve {
  const o = { ...MATCH_DEFAULTS, ...options };
  const idx = new Map(names.map((nm, k) => [nm, k]));
  let edges = pairs.filter(p => idx.has(p.a) && idx.has(p.b));
  const dropped: PlacementSolve["dropped"] = [];
  const largest = (es: MatchedPair[]) => {
    const par = names.map((_, k) => k);
    const f = (x: number): number => (par[x] === x ? x : (par[x] = f(par[x])));
    for (const e of es) par[f(idx.get(e.a)!)] = f(idx.get(e.b)!);
    const size = new Map<number, number>();
    for (let k = 0; k < names.length; k++) size.set(f(k), (size.get(f(k)) ?? 0) + 1);
    let root = 0, bestN = 0;
    for (const [r, s] of size) if (s > bestN) { bestN = s; root = r; }
    return new Set(names.filter((_, k) => f(k) === root));
  };
  let group = largest(edges);
  let phi = new Map<string, number>(), pos = new Map<string, [number, number]>();
  for (let round = 0; round < 6; round++) {
    edges = edges.filter(e => group.has(e.a) && group.has(e.b));
    const members = names.filter(nm => group.has(nm));
    // Turns: a spanning tree of the strongest pairs, then each photograph's turn averaged over all its pairs.
    phi = new Map([[members[0], 0]]);
    const byPeak = [...edges].sort((x, y) => y.peak - x.peak);
    for (let grew = true; grew;) {
      grew = false;
      for (const e of byPeak) {
        if (phi.has(e.a) && !phi.has(e.b)) { phi.set(e.b, phi.get(e.a)! + rad(e.turnDeg)); grew = true; }
        else if (phi.has(e.b) && !phi.has(e.a)) { phi.set(e.a, phi.get(e.b)! - rad(e.turnDeg)); grew = true; }
      }
    }
    for (let it = 0; it < 30; it++) {
      for (const m of members.slice(1)) {
        let sx = 0, sy = 0;
        for (const e of edges) {
          const est = e.b === m ? phi.get(e.a)! + rad(e.turnDeg) : e.a === m ? phi.get(e.b)! - rad(e.turnDeg) : null;
          if (est == null) continue;
          sx += e.peak * Math.cos(est); sy += e.peak * Math.sin(est);
        }
        if (sx || sy) phi.set(m, Math.atan2(sy, sx));
      }
    }
    const turnBad = edges.filter(e => Math.abs(deg(wrapPi(phi.get(e.b)! - phi.get(e.a)! - rad(e.turnDeg)))) > o.maxTurnResidualDeg);
    // Shifts: least squares over every pair, each coordinate on its own.
    const local = new Map(members.map((m, k) => [m, k]));
    const lin = edges.map(e => {
      const pa = phi.get(e.a)!, c = Math.cos(pa), s = Math.sin(pa);
      return { i: local.get(e.a)!, j: local.get(e.b)!, w: e.peak, mx: -(c * e.dx - s * e.dy), my: -(s * e.dx + c * e.dy) };
    });
    const X = solveLaplacian(members.length, lin.map(l => ({ i: l.i, j: l.j, w: l.w, m: l.mx })), 0);
    const Y = solveLaplacian(members.length, lin.map(l => ({ i: l.i, j: l.j, w: l.w, m: l.my })), 0);
    pos = new Map(members.map((m, k) => [m, [X[k], Y[k]]]));
    const res = lin.map(l => Math.hypot(X[l.j] - X[l.i] - l.mx, Y[l.j] - Y[l.i] - l.my));
    const sorted = [...res].sort((a, b) => a - b), med = sorted.length ? sorted[sorted.length >> 1] : 0;
    const limit = Math.max(o.maxShiftResidual, 4 * med);
    // Drop the worst offender of each kind per round (one bad pair bends its neighbours' residuals too).
    let worst = -1;
    for (let k = 0; k < res.length; k++) if (res[k] > limit && (worst < 0 || res[k] > res[worst])) worst = k;
    const worstTurn = turnBad.sort((x, y) => Math.abs(wrapPi(phi.get(y.b)! - phi.get(y.a)! - rad(y.turnDeg))) - Math.abs(wrapPi(phi.get(x.b)! - phi.get(x.a)! - rad(x.turnDeg))))[0];
    if (!worstTurn && worst < 0) break;
    const kill = new Set<MatchedPair>();
    if (worstTurn) { kill.add(worstTurn); dropped.push({ pair: worstTurn, why: "its turn disagrees with the others" }); }
    if (worst >= 0 && !kill.has(edges[worst])) { kill.add(edges[worst]); dropped.push({ pair: edges[worst], why: `its shift disagrees with the others by ${res[worst].toFixed(1)} cells` }); }
    edges = edges.filter(e => !kill.has(e));
    group = largest(edges);
  }
  const poses = new Map<string, Pose>();
  for (const m of names) if (group.has(m) && phi.has(m) && pos.has(m)) poses.set(m, { phi: phi.get(m)!, x: pos.get(m)![0], y: pos.get(m)![1] });
  return { poses, kept: edges.filter(e => poses.has(e.a) && poses.has(e.b)), dropped, unjoined: names.filter(m => !poses.has(m)) };
}

/** The pixel size of a JPEG from its frame header (SOF), walking the markers; null when not found in the bytes given. */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    if (m === 0xda) return null;
    i += 2 + len;
  }
  return null;
}

/** A header for a photograph placed by matching: nadir, the assumed lens, at the pose's place on the stand-in plane. */
export function matchedMeta(pose: Pose, size: { width: number; height: number }, cellOriginalPx: number, gsdM: number): DjiPhotoMeta {
  const diag = Math.hypot(size.width, size.height);
  const focalPx = (ASSUMED_FOCAL_35MM / 43.27) * diag;
  // Mosaic cells to metres: x is east, y (down the screen) is south; the first photograph's top edge is north.
  const metres = cellOriginalPx * gsdM;
  const ll = fromEnu([pose.x * metres, -pose.y * metres, 0], { ...STAND_IN_ORIGIN, altM: 0 });
  // The photograph's top edge points to R(phi)(0, -1) = (sin phi, -cos phi) on the screen: east sin phi, north cos phi.
  let yaw = deg(pose.phi) % 360; if (yaw > 180) yaw -= 360; if (yaw < -180) yaw += 360;
  return {
    make: null, model: "placed by matching (no position in the file)", width: size.width, height: size.height, focalMm: null, focal35Mm: ASSUMED_FOCAL_35MM, capturedAt: null,
    lat: ll.lat, lng: ll.lng, positionSource: null, absoluteAltitudeM: null, relativeAltitudeM: gsdM * focalPx,
    gimbalYawDeg: yaw, gimbalPitchDeg: -90, gimbalRollDeg: 0, flightYawDeg: null, flightPitchDeg: null, flightRollDeg: null,
    speedNorthMs: null, speedEastMs: null, speedDownMs: null, calibratedFocalPx: focalPx, opticalCenterX: size.width / 2, opticalCenterY: size.height / 2,
    dewarpFlag: null, dewarpData: null, rtkFlag: null, rtkStdLonM: null, rtkStdLatM: null, rtkStdHgtM: null,
  };
}

export type MatchPlacementResult = {
  metas: Map<string, DjiPhotoMeta>;
  refused: { name: string; reason: string }[];
  /** The pairs the placement rests on, and the ones dropped with the reason. */
  pairs: MatchedPair[];
  dropped: PlacementSolve["dropped"];
  report: {
    photographs: number; placed: number; pairsTried: number; pairsMatched: number; pairsKept: number; pairsDropped: number;
    /** Metres per original pixel, from the rows, and the readings it is the median of. */
    gsdM: number; gsdReadings: number[]; scaleAgreedBy: number; scaleReadBy: number; rowSpacingM: number;
    altitudeM: number; canvas: number; ms: number;
  };
  notes: string[];
};

/**
 * Place photographs with no position in their header. `decodeDown` is the build's decode factor (the decode is
 * cached by the photo sources, so the later stages do not pay for it again).
 */
export async function placeByMatching(photos: PhotoSource[], opts: { rowSpacingM: number; decodeDown: number; stage?: RowCropStage; match?: MatchOptions }, hooks: BuildHooks = {}): Promise<MatchPlacementResult> {
  const t0 = Date.now();
  const o = { ...MATCH_DEFAULTS, ...opts.match };
  const refused: MatchPlacementResult["refused"] = [];
  const thumbs: Thumb[] = [];
  const info = new Map<string, { size: { width: number; height: number }; cellOriginalPx: number }>();
  const decoded: { name: string; photo: PhotoSource; ratio: number }[] = [];
  for (const [i, p] of photos.entries()) {
    checkCancelled(hooks.signal);
    hooks.onProgress?.({ stage: "matching", done: i, total: photos.length, message: `shrinking ${p.name}`, elapsedMs: Date.now() - t0 });
    let px: PhotoPixels, size: { width: number; height: number } | null;
    try { px = await p.decode(opts.decodeDown); size = jpegSize(await p.header()); } catch (e) { refused.push({ name: p.name, reason: `could not decode: ${(e as Error).message}` }); continue; }
    size ??= { width: px.width * opts.decodeDown, height: px.height * opts.decodeDown };
    const ratio = size.width / px.width;
    const { thumb, factor } = thumbOf(p.name, px, o.n);
    thumbs.push(thumb);
    info.set(p.name, { size, cellOriginalPx: ratio * factor });
    decoded.push({ name: p.name, photo: p, ratio });
  }
  if (thumbs.length < 2) throw new Error("fewer than two photographs could be read: nothing to match");
  const pairs = await matchPairs(thumbs, o, hooks);
  const solve = solvePlacement(thumbs.map(t => t.name), pairs, o);
  for (const nm of solve.unjoined) refused.push({ name: nm, reason: "did not overlap the largest group of photographs" });
  if (solve.poses.size < 2) throw new Error(`no two photographs overlap (${pairs.length} matching pairs among ${thumbs.length} photographs): a twin without GPS needs photographs from one flight with overlap`);

  // The scale, from the rows on up to ten placed photographs spread through the flight, both stage variants each:
  // a reading can lock on a half or a double of the pitch (or on a verge), so the scale is the reading most
  // photographs agree on (within SCALE_AGREEMENT), not a plain median.
  const placed = decoded.filter(d => solve.poses.has(d.name));
  const pick = placed.length <= 10 ? placed : Array.from({ length: 10 }, (_, k) => placed[Math.round((k * (placed.length - 1)) / 9)]);
  const readings: { name: string; gsdM: number }[] = [];
  for (const [k, d] of pick.entries()) {
    checkCancelled(hooks.signal);
    hooks.onProgress?.({ stage: "matching", done: k, total: pick.length, message: `measuring the row pitch on ${d.name}`, elapsedMs: Date.now() - t0 });
    const px = await d.photo.decode(opts.decodeDown);
    for (const stage of opts.stage ? [opts.stage] : (["mid", "establishment"] as RowCropStage[])) {
      const r = readRowCrop(px, { gsdM: null, defaultSpacingM: opts.rowSpacingM, spacingsM: [opts.rowSpacingM], stage });
      if (r.pitchM != null && Number.isFinite(r.gsdM) && r.gsdM > 0) readings.push({ name: d.name, gsdM: r.gsdM / d.ratio });
    }
    await new Promise(r => setTimeout(r, 0));
  }
  if (!readings.length) throw new Error("no crop rows could be measured in the photographs, so their scale is unknown: a twin without GPS takes its scale from the row spacing");
  const agreeing = (g: number) => readings.filter(r => Math.abs(r.gsdM / g - 1) <= SCALE_AGREEMENT);
  const support = (g: number) => new Set(agreeing(g).map(r => r.name)).size;
  const centre = readings.reduce((best, r) => (support(r.gsdM) > support(best.gsdM) ? r : best), readings[0]);
  const cluster = agreeing(centre.gsdM).map(r => r.gsdM).sort((a, b) => a - b);
  const gsdM = cluster[cluster.length >> 1];
  const agreedBy = support(centre.gsdM), readBy = new Set(readings.map(r => r.name)).size;
  const metas = new Map<string, DjiPhotoMeta>();
  for (const [nm, pose] of solve.poses) { const inf = info.get(nm)!; metas.set(nm, matchedMeta(pose, inf.size, inf.cellOriginalPx, gsdM)); }
  const anyMeta = metas.values().next().value as DjiPhotoMeta;
  const spread = cluster.length > 1 ? (cluster[cluster.length - 1] - cluster[0]) / gsdM : 0;
  const notes = [
    `placed without GPS: ${solve.poses.size} of ${photos.length} photographs joined by matching them to each other (${solve.kept.length} overlapping pairs)`,
    `scale from the rows: ${(gsdM * 100).toFixed(2)} cm a pixel, agreed by ${agreedBy} of the ${readBy} photographs whose rows were measured (within ${(spread * 100).toFixed(1)} % of each other), taking the rows to be ${(opts.rowSpacingM * 100).toFixed(1)} cm apart`,
    "camera assumed: straight down, 24 mm-equivalent lens, no lens distortion; height worked out from the scale",
    "not on the earth: north is the first photograph's top edge and the field sits at a stand-in place, so the map shows no surroundings",
  ];
  return {
    metas, refused, notes, pairs: solve.kept, dropped: solve.dropped,
    report: {
      photographs: photos.length, placed: solve.poses.size, pairsTried: (thumbs.length * (thumbs.length - 1)) / 2, pairsMatched: pairs.length, pairsKept: solve.kept.length, pairsDropped: solve.dropped.length,
      gsdM, gsdReadings: readings.map(r => r.gsdM), scaleAgreedBy: agreedBy, scaleReadBy: readBy, rowSpacingM: opts.rowSpacingM, altitudeM: anyMeta.relativeAltitudeM ?? 0, canvas: o.n, ms: Date.now() - t0,
    },
  };
}
