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
// residual shift at each spot. A shift plus a scale about the camera's nadir
// point is fitted to those spots (a ground-height error moves a point in
// proportion to its distance from nadir; a pose error moves everything
// together) and applied to every outline of that photo.
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

export type FrameAlignment = {
  /** Translation, metres east and north. */
  t: [number, number];
  /** Scale about the nadir point (a ground-height correction): d = t + k (p - nadir). */
  k: number;
  nadir: [number, number];
  /** Shift at the photo's centre, metres. */
  shiftM: number;
  patches: PatchResult[];
  usedPatches: number;
  /** Root-mean-square misfit of the model at the patches, metres. */
  rmsM: number;
  stepM: number;
};

export const PATCH_N = 128;
/** Patch centres as fractions of the posed frame: the centre and the four quarters. */
export const PATCH_FRACTIONS: [number, number][] = [[0.5, 0.5], [0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]];
/** Shifts larger than this are rejected as a false match. */
export const MAX_SHIFT_M = 3;
/** A phase-correlation peak under this is not trusted. */
export const MIN_PEAK = 0.04;
/** A patch with more of its samples missing than this is skipped. */
export const MAX_MISSING = 0.3;
export const MAX_SCALE = 0.05;
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

/** Least squares for d = t + k (c - nadir) over the patches; translation only below three patches. */
export function fitAlignment(patches: { centre: [number, number]; shift: [number, number]; peak: number }[], nadir: [number, number]): { t: [number, number]; k: number; rmsM: number } | null {
  if (!patches.length) return null;
  const w = patches.map(p => p.peak);
  const W = w.reduce((s, v) => s + v, 0) || 1;
  const mean: [number, number] = [patches.reduce((s, p, i) => s + w[i] * p.shift[0], 0) / W, patches.reduce((s, p, i) => s + w[i] * p.shift[1], 0) / W];
  let t = mean, k = 0;
  if (patches.length >= 3) {
    // Unknowns te, tn, k. Normal equations from rows [1,0,re] and [0,1,rn] per patch, weighted.
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    patches.forEach((p, i) => {
      const re = p.centre[0] - nadir[0], rn = p.centre[1] - nadir[1], wi = w[i];
      const rows: [number[], number][] = [[[1, 0, re], p.shift[0]], [[0, 1, rn], p.shift[1]]];
      for (const [r, y] of rows) {
        for (let a = 0; a < 3; a++) { b[a] += wi * r[a] * y; for (let c = 0; c < 3; c++) A[a][c] += wi * r[a] * r[c]; }
      }
    });
    const sol = solve3(A, b);
    if (sol && Math.abs(sol[2]) <= MAX_SCALE) { t = [sol[0], sol[1]]; k = sol[2]; }
  }
  const misfit = patches.map(p => {
    const pe = t[0] + k * (p.centre[0] - nadir[0]), pn = t[1] + k * (p.centre[1] - nadir[1]);
    return (pe - p.shift[0]) ** 2 + (pn - p.shift[1]) ** 2;
  });
  return { t, k, rmsM: Math.sqrt(misfit.reduce((s, v) => s + v, 0) / misfit.length) };
}

function solve3(A: number[][], b: number[]): number[] | null {
  const m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
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
  const used = patches.filter(p => p.valid);
  const fit = fitAlignment(used, nadir);
  if (!fit) return null;
  const centreShift = [fit.t[0] + fit.k * ((patches[0]?.centre[0] ?? nadir[0]) - nadir[0]), fit.t[1] + fit.k * ((patches[0]?.centre[1] ?? nadir[1]) - nadir[1])];
  void cam;
  return { t: fit.t, k: fit.k, nadir, shiftM: Math.hypot(centreShift[0], centreShift[1]), patches, usedPatches: used.length, rmsM: fit.rmsM, stepM };
}

/** A ground point moved by the alignment. */
export function alignPoint(set: SourceFrameSet, altM: number, a: FrameAlignment, p: { lat: number; lng: number }): { lat: number; lng: number } {
  const [e, n] = enuOf(set, p, altM);
  const e2 = e + a.t[0] + a.k * (e - a.nadir[0]);
  const n2 = n + a.t[1] + a.k * (n - a.nadir[1]);
  const g = fromEnu([e2, n2, altM - set.reference.altM], set.reference);
  return { lat: g.lat, lng: g.lng };
}

/** Every outline of a photo moved onto the map. Detections already aligned are returned unchanged. */
export function applyAlignment(set: SourceFrameSet, altM: number, a: FrameAlignment | null, dets: FrameDetection[]): FrameDetection[] {
  if (!a) return dets;
  const s = 1 + a.k;
  return dets.map(d => {
    if (d.alignment) return d;
    return {
      ...d,
      ring: d.ring ? d.ring.map(p => alignPoint(set, altM, a, p)) : null,
      centre: d.centre ? alignPoint(set, altM, a, d.centre) : null,
      gsdM: d.gsdM != null ? d.gsdM * s : null,
      areaM2: d.areaM2 != null ? d.areaM2 * s * s : null,
      diameterM: d.diameterM != null ? d.diameterM * s : null,
      alignment: { shiftM: a.shiftM, k: a.k, patches: a.usedPatches, rmsM: a.rmsM },
    };
  });
}
