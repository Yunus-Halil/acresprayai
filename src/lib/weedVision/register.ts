// Aligning a photograph's plants to the orthomosaic.
//
// A plant found in a photo is carried to the ground by the camera's pose and a
// flat ground plane at one estimated height (frames.ts). The pose and the
// height are both a little wrong, so a photo's outlines land up to a metre off
// the plants on the map, and every outline from one photo is off the same way.
// The map is the reference the operator looks at, so the photo is aligned to
// it: at a few spots across the photo's footprint, the photo's vegetation is
// resampled onto the ground grid the outlines use and compared with the map's
// vegetation there (phase correlation of an excess-green image), giving the
// residual shift at each spot. A correction about the camera's nadir point is
// fitted to those spots and applied to every outline of that photo:
//   d = t + A (p - n) + (p - n) * (q . (p - n))
// A pose error moves everything together (t). A ground-height error moves a
// point in proportion to its distance from nadir (the scale in A); a heading
// error turns the footprint (the rotation in A); a tilted pose shears it. A
// field that slopes under the photo is a height error that grows across it,
// so the push away from nadir grows too: that is the q term, exact for a
// sloping plane. A shift and a scale alone left the outlines tens of
// centimetres off toward a photo's edges on a sloping field, which shows only
// when the map is zoomed in. Nine spots over a 3 x 3 grid carry the eight
// numbers with room to drop a spot that matched the wrong thing.
//
// Pure: the photo and the map are reached through samplers, so the maths is
// testable without a browser. lib/weedVision/alignToMap.ts supplies the real
// samplers.
import { type LatLngAlt, type Shot, type SourceFrameSet, fromEnu, pixelToGround, projectToFrame, toEnu } from "../sourceFrames/odm";
import type { FrameDetection } from "./frames";

/** An RGB sample, or null where there is no imagery. */
export type Rgb = [number, number, number] | null;
/** The photo at a pixel of the posed frame (cam.width wide). */
export type PhotoSampler = (u: number, v: number) => Rgb;
/** The orthomosaic at a ground position. */
export type MapSampler = (lat: number, lng: number) => Rgb;

export type PatchResult = { centre: [number, number]; shift: [number, number]; peak: number; valid: boolean; reason?: string };

/** The alignment model's version, kept on every aligned outline; an outline aligned under an older model is aligned again. */
export const ALIGNMENT_VERSION = 2;

export type Mat2 = [[number, number], [number, number]];

export type FrameAlignment = {
  /** Translation, metres east and north. */
  t: [number, number];
  /** The linear part about the nadir point, row-major [[ee, en], [ne, nn]]: d = t + A (p - nadir). */
  A: Mat2;
  /** The ground-slope term: the push away from nadir grows by q . (p - n) per metre (zero when not fitted). */
  q: [number, number];
  /** The mean scale in A (a ground-height correction), for the summary. */
  k: number;
  nadir: [number, number];
  /** Shift at the photo's centre, metres. */
  shiftM: number;
  patches: PatchResult[];
  usedPatches: number;
  /** Root-mean-square misfit of the model at the patches, metres. */
  rmsM: number;
  stepM: number;
  /** The original photo's long edge in pixels, when the aligner decoded it: what re-placing older outlines needs. */
  nativeLongEdge?: number;
};

export const PATCH_N = 128;
/** Patch centres as fractions of the posed frame: the centre first, then the rest of a 3 x 3 grid. */
export const PATCH_FRACTIONS: [number, number][] = [[0.5, 0.5], [0.2, 0.2], [0.5, 0.2], [0.8, 0.2], [0.2, 0.5], [0.8, 0.5], [0.2, 0.8], [0.5, 0.8], [0.8, 0.8]];
/** Shifts larger than this are rejected as a false match. */
export const MAX_SHIFT_M = 3;
/** A phase-correlation peak under this is not trusted. */
export const MIN_PEAK = 0.04;
/** A patch with more of its samples missing than this is skipped. */
export const MAX_MISSING = 0.3;
/** Largest entry of the linear part accepted (5 % scale, about 3 degrees of turn); beyond it the fit falls back to a simpler model. */
export const MAX_SCALE = 0.05;
/** Largest slope term accepted, per metre: a 10 % slope under a camera 60 m up is about 0.0017. */
export const MAX_TILT = 0.003;
/** A spot whose shift disagrees with the fit by more than this (and by more than OUTLIER_FACTOR x the median) is dropped. */
export const OUTLIER_MIN_M = 0.06;
export const OUTLIER_FACTOR = 3;
/** Resample-and-correlate passes per spot; each removes most of what the last one left. */
export const REFINE_ITERATIONS = 4;

// ---------------------------------------------------------------- FFT

/** In-place iterative radix-2 FFT of length n (a power of two). */
function fft1d(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** 2-D FFT of an n x n row-major complex array, in place. */
function fft2d(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
  const r = new Float64Array(n), c = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) { r[x] = re[y * n + x]; c[x] = im[y * n + x]; }
    fft1d(r, c, inverse);
    for (let x = 0; x < n; x++) { re[y * n + x] = r[x]; im[y * n + x] = c[x]; }
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) { r[y] = re[y * n + x]; c[y] = im[y * n + x]; }
    fft1d(r, c, inverse);
    for (let y = 0; y < n; y++) { re[y * n + x] = r[y]; im[y * n + x] = c[y]; }
  }
}

/**
 * Phase correlation: the shift (dx, dy) in grid cells such that p(i) ~ o(i + d), with a sub-cell
 * parabolic refinement, and the normalised peak height (1 for identical images, near 0 for no match).
 */
export function phaseCorrelate(p: Float64Array, o: Float64Array, n: number): { dx: number; dy: number; peak: number } {
  const pr = Float64Array.from(p), pi = new Float64Array(n * n);
  const or = Float64Array.from(o), oi = new Float64Array(n * n);
  fft2d(pr, pi, n, false);
  fft2d(or, oi, n, false);
  // conj(P) * O, normalised to unit magnitude. The lowest frequencies are left out: the taper is the same in
  // both images, and at those frequencies it agrees with itself at zero shift, which pulls the peak toward zero.
  const rr = new Float64Array(n * n), ri = new Float64Array(n * n);
  const LOW = 2;
  for (let i = 0; i < n * n; i++) {
    const fx = i % n, fy = Math.floor(i / n);
    const wx = Math.min(fx, n - fx), wy = Math.min(fy, n - fy);
    if (wx * wx + wy * wy <= LOW * LOW) continue;
    const a = pr[i] * or[i] + pi[i] * oi[i];
    const b = pr[i] * oi[i] - pi[i] * or[i];
    const m = Math.hypot(a, b) || 1;
    rr[i] = a / m; ri[i] = b / m;
  }
  fft2d(rr, ri, n, true);
  let best = 0, bv = -Infinity;
  for (let i = 0; i < n * n; i++) if (rr[i] > bv) { bv = rr[i]; best = i; }
  const bx = best % n, by = Math.floor(best / n);
  const at = (x: number, y: number) => rr[((y + n) % n) * n + ((x + n) % n)];
  const sub = (m: number, c: number, q: number) => { const den = m - 2 * c + q; return Math.abs(den) > 1e-12 ? (0.5 * (m - q)) / den : 0; };
  const fx = sub(at(bx - 1, by), bv, at(bx + 1, by));
  const fy = sub(at(bx, by - 1), bv, at(bx, by + 1));
  const wrap = (v: number) => (v > n / 2 ? v - n : v);
  return { dx: wrap(bx) + fx, dy: wrap(by) + fy, peak: bv };
}

// ---------------------------------------------------------------- sampling

/** Excess green on chromaticity: vegetation high, soil low; null stays null. */
export function exg(c: Rgb): number | null {
  if (!c) return null;
  const s = c[0] + c[1] + c[2];
  if (s <= 0) return 0;
  return (2 * c[1] - c[0] - c[2]) / s;
}

/** Zero-mean, Hann-windowed image of an n x n set of values with missing ones; null when too many are missing or it is flat. */
export function prepare(values: (number | null)[], n: number): Float64Array | null {
  let sum = 0, count = 0;
  for (const v of values) if (v != null) { sum += v; count++; }
  if (count < n * n * (1 - MAX_MISSING)) return null;
  const mean = sum / count;
  let varSum = 0;
  const out = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (n - 1));
    for (let x = 0; x < n; x++) {
      const v = values[y * n + x];
      const d = v == null ? 0 : v - mean;
      varSum += d * d;
      out[y * n + x] = d * wy * (0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (n - 1)));
    }
  }
  return varSum / count > 1e-6 ? out : null;
}

// ---------------------------------------------------------------- fitting

type Patch = { centre: [number, number]; shift: [number, number]; peak: number };
type Fit = { t: [number, number]; A: Mat2; q: [number, number]; k: number; rmsM: number };
type Model = "t" | "ts" | "affine" | "tilt";

const predict = (c: [number, number], nadir: [number, number], t: [number, number], A: Mat2, q: [number, number] = [0, 0]): [number, number] => {
  const re = c[0] - nadir[0], rn = c[1] - nadir[1];
  const push = q[0] * re + q[1] * rn;
  return [t[0] + A[0][0] * re + A[0][1] * rn + push * re, t[1] + A[1][0] * re + A[1][1] * rn + push * rn];
};
const residual = (p: Patch, nadir: [number, number], f: { t: [number, number]; A: Mat2; q: [number, number] }) => {
  const [pe, pn] = predict(p.centre, nadir, f.t, f.A, f.q);
  return Math.hypot(pe - p.shift[0], pn - p.shift[1]);
};

/**
 * Weighted least squares for d = t + A (c - n) + (c - n)(q . (c - n)); unknowns by model: translation (2),
 * + one scale (3), + the full linear part (6), + the slope term (8). Offsets are taken in units of the
 * spots' spread so the equations stay well conditioned.
 */
function fitModel(patches: Patch[], nadir: [number, number], model: Model): Fit | null {
  if (!patches.length) return null;
  const nu = { t: 2, ts: 3, affine: 6, tilt: 8 }[model];
  const L = Math.max(1, ...patches.map(p => Math.hypot(p.centre[0] - nadir[0], p.centre[1] - nadir[1])));
  const N = Array.from({ length: nu }, () => new Array<number>(nu).fill(0)), b = new Array<number>(nu).fill(0);
  for (const p of patches) {
    const u = (p.centre[0] - nadir[0]) / L, v = (p.centre[1] - nadir[1]) / L, w = p.peak || 1e-6;
    const full = { e: [1, 0, u, v, 0, 0, u * u, u * v], n: [0, 1, 0, 0, u, v, u * v, v * v] };
    const rowE = model === "t" ? [1, 0] : model === "ts" ? [1, 0, u] : full.e.slice(0, nu);
    const rowN = model === "t" ? [0, 1] : model === "ts" ? [0, 1, v] : full.n.slice(0, nu);
    for (const [r, y] of [[rowE, p.shift[0]], [rowN, p.shift[1]]] as [number[], number][]) {
      for (let a = 0; a < nu; a++) { b[a] += w * r[a] * y; for (let c = 0; c < nu; c++) N[a][c] += w * r[a] * r[c]; }
    }
  }
  const x = solveN(N, b);
  if (!x) return null;
  const t: [number, number] = [x[0], x[1]];
  const A: Mat2 = model === "t" ? [[0, 0], [0, 0]] : model === "ts" ? [[x[2] / L, 0], [0, x[2] / L]] : [[x[2] / L, x[3] / L], [x[4] / L, x[5] / L]];
  const q: [number, number] = model === "tilt" ? [x[6] / (L * L), x[7] / (L * L)] : [0, 0];
  if (Math.max(Math.abs(A[0][0]), Math.abs(A[0][1]), Math.abs(A[1][0]), Math.abs(A[1][1])) > MAX_SCALE) return null;
  if (Math.max(Math.abs(q[0]), Math.abs(q[1])) > MAX_TILT) return null;
  const f = { t, A, q };
  const rmsM = Math.sqrt(patches.reduce((s, p) => s + residual(p, nadir, f) ** 2, 0) / patches.length);
  return { t, A, q, k: (A[0][0] + A[1][1]) / 2, rmsM };
}

/** The richest model the spots support with room to spare: the slope term from six spots, the linear part from four, a scale from three, a shift below. */
function fitBest(patches: Patch[], nadir: [number, number]): Fit | null {
  const n = patches.length;
  const order: Model[] = n >= 6 ? ["tilt", "affine", "ts", "t"] : n >= 4 ? ["affine", "ts", "t"] : n >= 3 ? ["ts", "t"] : ["t"];
  for (const m of order) { const f = fitModel(patches, nadir, m); if (f) return f; }
  return null;
}

/**
 * Fit the alignment to the matched spots, dropping the worst spot while it
 * disagrees with the rest (a spot that locked onto the wrong plant or the
 * neighbouring row), never below three spots.
 */
export function fitAlignment<P extends Patch>(patches: P[], nadir: [number, number]): (Fit & { used: P[] }) | null {
  let used = [...patches];
  let fit = fitBest(used, nadir);
  while (fit && used.length > 3) {
    const f = fit;
    const res = used.map(p => residual(p, nadir, f));
    const sorted = [...res].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const worst = res.indexOf(sorted[sorted.length - 1]);
    if (res[worst] <= Math.max(OUTLIER_MIN_M, OUTLIER_FACTOR * median)) break;
    used = used.filter((_, i) => i !== worst);
    fit = fitBest(used, nadir);
  }
  return fit ? { ...fit, used } : null;
}

/** Gaussian elimination with partial pivoting; null when singular. */
function solveN(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

// ---------------------------------------------------------------- the photo

export type AlignInput = {
  set: SourceFrameSet;
  shot: Shot;
  /** The ground-plane height the outlines were placed with. */
  altM: number;
  photoAt: PhotoSampler;
  mapAt: MapSampler;
  /** Ground metres between samples; the map's pixel size is a good choice. */
  stepM: number;
  n?: number;
};

/** The ENU (east, north) of a ground point on the plane. */
const enuOf = (set: SourceFrameSet, p: { lat: number; lng: number }, altM: number): [number, number] => {
  const e = toEnu({ lat: p.lat, lng: p.lng, altM }, set.reference);
  return [e[0], e[1]];
};

/** Patch centres on the ground, ENU: the ground under the frame's centre and its four quarters. */
export function patchCentres(set: SourceFrameSet, shot: Shot, altM: number): [number, number][] {
  const cam = set.cameras[shot.cameraKey];
  const out: [number, number][] = [];
  for (const [fu, fv] of PATCH_FRACTIONS) {
    const g = pixelToGround(set, shot, fu * cam.width, fv * cam.height, altM);
    if (g) out.push(enuOf(set, g, altM));
  }
  return out;
}

/** Align one photo to the map. Null when no spot of the photo could be matched with confidence. */
export function alignPhoto(input: AlignInput): FrameAlignment | null {
  const { set, shot, altM, stepM } = input;
  const n = input.n ?? PATCH_N;
  const cam = set.cameras[shot.cameraKey];
  const nadir = enuOf(set, shot.centre, altM);
  const up = altM - set.reference.altM;
  const patches: PatchResult[] = [];
  for (const c of patchCentres(set, shot, altM)) {
    // Row index y grows northward, column x eastward.
    const at = (x: number, y: number): [number, number] => [c[0] + (x - n / 2) * stepM, c[1] + (y - n / 2) * stepM];
    const mapVals: (number | null)[] = new Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const [e, no] = at(x, y);
      const g = fromEnu([e, no, up], set.reference);
      mapVals[y * n + x] = exg(input.mapAt(g.lat, g.lng));
    }
    const o = prepare(mapVals, n);
    if (!o) { patches.push({ centre: c, shift: [0, 0], peak: 0, valid: false, reason: "map has no usable texture here" }); continue; }
    // The photo resampled at the current estimate, the remainder correlated, until it is under half a sample.
    const shift: [number, number] = [0, 0];
    let peak = 0, ok = true;
    for (let iter = 0; iter < REFINE_ITERATIONS; iter++) {
      const photoVals: (number | null)[] = new Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const [e, no] = at(x, y);
        const g = fromEnu([e - shift[0], no - shift[1], up], set.reference);
        const pr = projectToFrame(set, shot, g as LatLngAlt);
        photoVals[y * n + x] = pr && pr.inside ? exg(input.photoAt(pr.u, pr.v)) : null;
      }
      const p = prepare(photoVals, n);
      if (!p) { ok = false; break; }
      const r = phaseCorrelate(p, o, n);
      peak = r.peak;
      if (r.peak < MIN_PEAK) break;
      shift[0] += r.dx * stepM; shift[1] += r.dy * stepM;
      if (Math.hypot(shift[0], shift[1]) > MAX_SHIFT_M) break;
      if (Math.hypot(r.dx, r.dy) < 0.5) break;
    }
    if (!ok) { patches.push({ centre: c, shift: [0, 0], peak: 0, valid: false, reason: "photo has no usable texture here" }); continue; }
    const mag = Math.hypot(shift[0], shift[1]);
    const valid = peak >= MIN_PEAK && mag <= MAX_SHIFT_M;
    patches.push({ centre: c, shift, peak, valid, reason: valid ? undefined : peak < MIN_PEAK ? "weak match" : "shift too large" });
  }
  const fit = fitAlignment(patches.filter(p => p.valid), nadir);
  if (!fit) return null;
  // Spots the fit set aside are reported as such.
  for (const p of patches) if (p.valid && !fit.used.includes(p)) { p.valid = false; p.reason = "disagreed with the other spots"; }
  const centreShift = predict(patches[0]?.centre ?? nadir, nadir, fit.t, fit.A, fit.q);
  void cam;
  return { t: fit.t, A: fit.A, q: fit.q, k: fit.k, nadir, shiftM: Math.hypot(centreShift[0], centreShift[1]), patches, usedPatches: fit.used.length, rmsM: fit.rmsM, stepM };
}

/** A ground point moved by the alignment. */
export function alignPoint(set: SourceFrameSet, altM: number, a: FrameAlignment, p: { lat: number; lng: number }): { lat: number; lng: number } {
  const [e, n] = enuOf(set, p, altM);
  const [de, dn] = predict([e, n], a.nadir, a.t, a.A, a.q);
  const e2 = e + de, n2 = n + dn;
  const g = fromEnu([e2, n2, altM - set.reference.altM], set.reference);
  return { lat: g.lat, lng: g.lng };
}

/** Whether a detection was aligned under the current model. */
export const isAligned = (d: FrameDetection): boolean => d.alignment?.v === ALIGNMENT_VERSION;

/** Every outline of a photo moved onto the map. Detections already aligned under the current model are returned unchanged; anything else must be passed in its unaligned place. */
export function applyAlignment(set: SourceFrameSet, altM: number, a: FrameAlignment | null, dets: FrameDetection[]): FrameDetection[] {
  if (!a) return dets;
  // Areas scale with the determinant of the linear part, lengths with its root.
  const det = (1 + a.A[0][0]) * (1 + a.A[1][1]) - a.A[0][1] * a.A[1][0];
  const s = Math.sqrt(Math.max(det, 0.5));
  return dets.map(d => {
    if (isAligned(d)) return d;
    return {
      ...d,
      ring: d.ring ? d.ring.map(p => alignPoint(set, altM, a, p)) : null,
      centre: d.centre ? alignPoint(set, altM, a, d.centre) : null,
      gsdM: d.gsdM != null ? d.gsdM * s : null,
      areaM2: d.areaM2 != null ? d.areaM2 * s * s : null,
      diameterM: d.diameterM != null ? d.diameterM * s : null,
      alignment: { v: ALIGNMENT_VERSION, shiftM: a.shiftM, k: a.k, patches: a.usedPatches, rmsM: a.rmsM },
    };
  });
}
