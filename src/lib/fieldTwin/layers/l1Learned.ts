// L1, the learned green view (2026-11-18): the green a photograph's own plants show, learned from that photograph.
// An option, OFF by default (LAYERS.learnedGreen): with it off nothing here runs and every read is as before.
//
//   in:   the photograph's pixels; the mask L2 reads with the fixed thresholds (the strictest whole-frame bar,
//         rowCrop/seedlingGreen.ts SEEDLING_GREEN, or corn-v1.0's on a photograph read as bands: cornV1PlantCache)
//   out:  `cache`  a seedling cache whose mask is the learned view's (L2 reads it in place of the fixed one)
//         `record` what was learned: the two colours with their spread, the samples, how much is green
//         `score`  per pixel, how much closer it stands to the corn colour than to the soil colour (in spreads)
//
// 1. The strict pass: L2's first pass over the fixed mask (no cores). Its strongest marks (the greenest pieces at least
//    half a typical plant across, at most LEARNED_GREEN.sure of them) are the sure plants; the mask's pixels over each
//    are the corn samples. Soil samples: pixels at least `soilAwayPlants` typical plants from any green of that mask.
// 2. Two colours, each a Gaussian over (r / s, g / s, ln s), s = r + g + b (the tint without the brightness, and the
//    brightness): its mean and covariance, fitted twice more on the `trim` share of its samples nearest it, so the odd
//    weed among the sure plants, or a dark seedling the strict bar missed among the soil, does not set it.
// 3. A pixel's score: how much more likely the corn colour makes it than the soil colour, each with its own spread
//    (the log of the ratio of the two Gaussians: half the squared distance to the soil minus half the squared distance
//    to the corn, each in that colour's spreads, plus half the log of the soil's spread volume over the corn's).
//    Positive: the corn's. The volume term is the size of each spread: without it (the plain difference of the two
//    distances, `scoreRule: "distance"`, the first rule tried) a tight soil colour and a wide corn colour put most of
//    the soil closer to the corn (53.JPG: 42 % of the photograph green, against 7.6 % for the fixed bar; no label read).
// 4. The learned mask: a pixel is weak green where it is the corn's (score > 0) and within `weakCorn` spreads of it,
//    strong green where it is within `strongCorn` spreads and the corn makes it `strongRatio` times as likely; a piece of
//    weak and strong green is kept when it holds a strong pixel (the same hysteresis the fixed mask uses). A pixel far
//    from both colours (a white stone, a deep shadow) is far from the corn too, so it is not green.
import type { PhotoPixels } from "../../photoScout/pattern";
import { GREEN_POINTS, plantPointsFromGreen } from "../../rowCrop/greenPoints";
import { type SeedlingCache, sharedSeedlingMask } from "../../rowCrop/seedlingGreen";

export const LEARNED_GREEN = {
  /** The sure plants: at most this many of the strict pass's marks, the greenest first ... */
  sure: 300,
  /** ... of those at least this share of the typical plant across (a speck's mean green is a few pixels' noise). */
  sureMinSize: 0.5,
  /** Corn samples: the strict mask's pixels within this many of a sure plant's sizes of its centre, at most `perPlant`. */
  sureReach: 0.75, perPlant: 64,
  /** Soil samples: at least this many typical plants from any green of the strict mask; at most `soilSamples`. */
  soilAwayPlants: 2, soilSamples: 20000,
  /** Each colour is fitted three times, the last two on this share of its samples nearest the fit before. */
  trim: 0.9,
  /** The learned mask (spreads, Mahalanobis): strong within `strongCorn` of the corn where the corn makes the pixel
   * `strongRatio` times as likely as the soil does; weak within `weakCorn` where it is the corn's at all. Set before any
   * score: 2.5 and 3.5 spreads hold about 90 % and 99 % of a three-dimensional Gaussian's own samples. */
  strongCorn: 2.5, strongRatio: 10, weakCorn: 3.5,
  /** "likelihood": the score of step 3; "distance": the plain difference of the two distances (kept runnable only). */
  scoreRule: "likelihood" as "likelihood" | "distance",
  /** Fewer corn samples than this (a photograph with almost no plant): no learned view, the fixed mask stands. */
  minCornSamples: 200,
};
export type LearnedGreenOptions = typeof LEARNED_GREEN;

/** A colour as learned: the Gaussian over (r / s, g / s, ln s), and the same mean as an RGB colour for the eye. */
export type LearnedColour = { mean: [number, number, number]; cov: number[]; rgb: [number, number, number]; spread: [number, number, number]; samples: number };
export type LearnedRecord = {
  strictMarks: number; sure: number; sureMinGreen: number | null; typicalPx: number;
  corn: LearnedColour; soil: LearnedColour;
  /** The two colours' distance apart, in the corn's spreads and in the soil's; the score's rule. */
  apart: { inCorn: number; inSoil: number }; scoreRule: "likelihood" | "distance";
  /** Share of the photograph green: the fixed mask's and the learned mask's. */
  fixedShare: number; learnedShare: number;
  /** The sure plants (photo pixels) and every 10th soil sample, for the inspector. */
  surePoints: [number, number][]; soilPoints: [number, number][];
  ms: number;
};
export type LearnedView = { cache: SeedlingCache; record: LearnedRecord; score: Float32Array; strong: Uint8Array };

const feat = (r: number, g: number, b: number, out: Float64Array, k: number) => { const s = r + g + b + 3; out[k] = (r + 1) / s; out[k + 1] = (g + 1) / s; out[k + 2] = Math.log(s); };

/** Mean and covariance of n 3-vectors (only those `use` marks), with a small floor on the diagonal. */
function fit(F: Float64Array, n: number, use: Uint8Array | null) {
  const m = [0, 0, 0], C = [0, 0, 0, 0, 0, 0, 0, 0, 0]; let c = 0;
  for (let i = 0; i < n; i++) { if (use && !use[i]) continue; c++; for (let a = 0; a < 3; a++) m[a] += F[i * 3 + a]; }
  for (let a = 0; a < 3; a++) m[a] /= Math.max(1, c);
  for (let i = 0; i < n; i++) { if (use && !use[i]) continue; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a * 3 + b] += (F[i * 3 + a] - m[a]) * (F[i * 3 + b] - m[b]); }
  for (let k = 0; k < 9; k++) C[k] /= Math.max(1, c - 1);
  C[0] += 1e-7; C[4] += 1e-7; C[8] += 1e-5;
  return { m, C, c };
}
const det3 = (C: number[]) => C[0] * (C[4] * C[8] - C[5] * C[7]) - C[1] * (C[3] * C[8] - C[5] * C[6]) + C[2] * (C[3] * C[7] - C[4] * C[6]);
function inv3(C: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = C, A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g, det = a * A + b * B + c * Cc;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, Cc / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
const maha2 = (x0: number, x1: number, x2: number, m: number[], P: number[]) => { const d0 = x0 - m[0], d1 = x1 - m[1], d2 = x2 - m[2]; return d0 * (P[0] * d0 + P[1] * d1 + P[2] * d2) + d1 * (P[3] * d0 + P[4] * d1 + P[5] * d2) + d2 * (P[6] * d0 + P[7] * d1 + P[8] * d2); };

/** A colour fitted three times, the last two on the `trim` share nearest the fit before. */
function learnColour(F: Float64Array, n: number, trim: number) {
  let g = fit(F, n, null);
  const d = new Float64Array(n), use = new Uint8Array(n);
  for (let pass = 0; pass < 2; pass++) {
    const P = inv3(g.C); for (let i = 0; i < n; i++) d[i] = maha2(F[i * 3], F[i * 3 + 1], F[i * 3 + 2], g.m, P);
    const cut = Float64Array.from(d).sort()[Math.min(n - 1, Math.floor(trim * n))];
    for (let i = 0; i < n; i++) use[i] = d[i] <= cut ? 1 : 0;
    g = fit(F, n, use);
  }
  return g;
}
function colourOf(g: { m: number[]; C: number[]; c: number }): LearnedColour {
  const s = Math.exp(g.m[2]), r = g.m[0] * s - 1, gg = g.m[1] * s - 1, b = s - r - gg - 3;
  const r3 = (x: number) => Math.round(x * 1e6) / 1e6;
  return { mean: [r3(g.m[0]), r3(g.m[1]), r3(g.m[2])], cov: g.C.map(x => Math.round(x * 1e9) / 1e9), rgb: [Math.round(r), Math.round(gg), Math.round(b)], spread: [r3(Math.sqrt(g.C[0])), r3(Math.sqrt(g.C[4])), r3(Math.sqrt(g.C[8]))], samples: g.c };
}

/** The learned green view of a photograph, from the mask L2 reads with the fixed thresholds; null when too few corn samples. */
export function learnedGreenView(px: PhotoPixels, fixed: SeedlingCache, o: LearnedGreenOptions = LEARNED_GREEN): LearnedView | null {
  const t0 = Date.now(), W = px.width, H = px.height, N = W * H, d = px.rgba;
  // 1. The strict pass: L2's first pass over the fixed mask, no cores.
  const strict = plantPointsFromGreen(px, GREEN_POINTS, fixed, null), full = sharedSeedlingMask(fixed, px), T = strict.typicalPx;
  const L = strict.look!, idx = strict.points.map((_, i) => i).filter(i => Number.isFinite(L.green[i]) && Number.isFinite(L.sizePx[i]) && L.sizePx[i] >= o.sureMinSize * T);
  idx.sort((a, b) => L.green[b] - L.green[a]);
  const sure = idx.slice(0, o.sure);
  const cornF: number[] = [];
  for (const i of sure) {
    const p = strict.points[i], h = Math.max(1, Math.ceil(o.sureReach * L.sizePx[i])), st = Math.max(1, Math.floor((2 * h + 1) / Math.sqrt(o.perPlant)));
    for (let y = Math.max(0, Math.round(p.y) - h); y <= Math.min(H - 1, Math.round(p.y) + h); y += st) for (let x = Math.max(0, Math.round(p.x) - h); x <= Math.min(W - 1, Math.round(p.x) + h); x += st) {
      if (!full[y * W + x]) continue; const q = (y * W + x) * 4; cornF.push(d[q], d[q + 1], d[q + 2]);
    }
  }
  const nc = cornF.length / 3; if (nc < o.minCornSamples) return null;
  // Soil: blocks of 8 px; a block is green when any pixel of the strict mask is; the distance to a green block (chamfer).
  const B = 8, gw = Math.ceil(W / B), gh = Math.ceil(H / B), dist = new Float32Array(gw * gh).fill(1e9);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (full[y * W + x]) dist[((y / B) | 0) * gw + ((x / B) | 0)] = 0;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let v = dist[y * gw + x]; if (x) v = Math.min(v, dist[y * gw + x - 1] + 1); if (y) v = Math.min(v, dist[(y - 1) * gw + x] + 1); if (x && y) v = Math.min(v, dist[(y - 1) * gw + x - 1] + 1.414); if (y && x < gw - 1) v = Math.min(v, dist[(y - 1) * gw + x + 1] + 1.414); dist[y * gw + x] = v; }
  for (let y = gh - 1; y >= 0; y--) for (let x = gw - 1; x >= 0; x--) { let v = dist[y * gw + x]; if (x < gw - 1) v = Math.min(v, dist[y * gw + x + 1] + 1); if (y < gh - 1) v = Math.min(v, dist[(y + 1) * gw + x] + 1); if (x < gw - 1 && y < gh - 1) v = Math.min(v, dist[(y + 1) * gw + x + 1] + 1.414); if (y < gh - 1 && x) v = Math.min(v, dist[(y + 1) * gw + x - 1] + 1.414); dist[y * gw + x] = v; }
  const away = (o.soilAwayPlants * T) / B, step = Math.max(1, Math.round(Math.sqrt(N / (4 * o.soilSamples))));
  const far: number[] = [];
  for (let y = step >> 1; y < H; y += step) for (let x = step >> 1; x < W; x += step) if (dist[((y / B) | 0) * gw + ((x / B) | 0)] >= away) far.push(y * W + x);
  const every = Math.max(1, Math.ceil(far.length / o.soilSamples)), soilAt = far.filter((_, k) => k % every === 0), ns = soilAt.length;
  if (ns < o.minCornSamples) return null;
  // 2. The two colours.
  const Fc = new Float64Array(nc * 3), Fs = new Float64Array(ns * 3);
  for (let i = 0; i < nc; i++) feat(cornF[i * 3], cornF[i * 3 + 1], cornF[i * 3 + 2], Fc, i * 3);
  soilAt.forEach((p, i) => { const q = p * 4; feat(d[q], d[q + 1], d[q + 2], Fs, i * 3); });
  const gc = learnColour(Fc, nc, o.trim), gs = learnColour(Fs, ns, o.trim), Pc = inv3(gc.C), Ps = inv3(gs.C);
  // 3. Every pixel's score; 4. the learned mask (hysteresis, as the fixed mask).
  const score = new Float32Array(N), cls = new Uint8Array(N), f = new Float64Array(3);
  const sw = o.weakCorn * o.weakCorn, ss = o.strongCorn * o.strongCorn, byL = o.scoreRule === "likelihood";
  const halfLogVol = 0.5 * Math.log(det3(gs.C) / det3(gc.C)), strongAt = byL ? Math.log(o.strongRatio) : 1;
  for (let i = 0; i < N; i++) {
    const q = i * 4; feat(d[q], d[q + 1], d[q + 2], f, 0);
    const zc2 = maha2(f[0], f[1], f[2], gc.m, Pc), zs2 = maha2(f[0], f[1], f[2], gs.m, Ps), sc = byL ? 0.5 * (zs2 - zc2) + halfLogVol : Math.sqrt(zs2) - Math.sqrt(zc2);
    score[i] = sc;
    if (sc > 0 && zc2 <= sw) cls[i] = zc2 <= ss && sc >= strongAt ? 1 : 2;
  }
  const mask = new Uint8Array(N), strong = new Uint8Array(N), stack = new Int32Array(N), comp: number[] = [];
  let green = 0, fixedGreen = 0;
  for (let i = 0; i < N; i++) if (full[i]) fixedGreen++;
  for (let i0 = 0; i0 < N; i0++) {
    if (!cls[i0] || cls[i0] & 8) continue;
    comp.length = 0; let top = 0, has = false; stack[top++] = i0; cls[i0] |= 8;
    while (top) {
      const p = stack[--top]; comp.push(p); if ((cls[p] & 7) === 1) has = true;
      const x = p % W, y = (p - x) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const k = yy * W + xx; if (cls[k] && !(cls[k] & 8)) { cls[k] |= 8; stack[top++] = k; } }
    }
    if (has) for (const p of comp) { mask[p] = 1; green++; if ((cls[p] & 7) === 1) strong[p] = 1; }
  }
  const corn = colourOf(gc), soil = colourOf(gs);
  const apart = { inCorn: Math.round(Math.sqrt(maha2(gs.m[0], gs.m[1], gs.m[2], gc.m, Pc)) * 100) / 100, inSoil: Math.round(Math.sqrt(maha2(gc.m[0], gc.m[1], gc.m[2], gs.m, Ps)) * 100) / 100 };
  const record: LearnedRecord = {
    strictMarks: strict.points.length, sure: sure.length, sureMinGreen: sure.length ? Math.round(L.green[sure[sure.length - 1]] * 1000) / 1000 : null, typicalPx: Math.round(T * 10) / 10,
    corn, soil, apart, scoreRule: o.scoreRule, fixedShare: fixedGreen / N, learnedShare: green / N,
    surePoints: sure.map(i => [Math.round(strict.points[i].x), Math.round(strict.points[i].y)]), soilPoints: soilAt.filter((_, k) => k % 10 === 0).map(p => [p % W, (p / W) | 0]),
    ms: Date.now() - t0,
  };
  // The cache L2 reads: the fixed one's soil levels (nothing in L2 reads them), the learned mask.
  return { cache: { px, options: fixed.options, levels: fixed.levels, mask }, record, score, strong };
}
