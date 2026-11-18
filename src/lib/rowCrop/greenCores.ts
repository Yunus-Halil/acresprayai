// The vivid cores of a photograph's green (2026-11-17): where plants touch and one piece of green holds several of
// them, each plant still shows as a core of stronger, more saturated green. Off by default (cornV1.ts CORN_CORES).
//
//   green  = (2g - r - b) / (r + g + b), kept where it is above GREEN_CORES.greenMin
//   vivid  = saturation x green on those pixels (0 elsewhere), saturation = (max - min) / max
//   cores  = vivid blurred fine less vivid blurred wide, negatives to zero (Gaussian blurs)
//   a core = a local peak of that, at or over a share of the photograph's strongest
//
// Measured on one hand-labelled photograph (corn-benchmark TOUCH-2.md and TOUCH-3.md); nothing here tells corn from
// another plant.
import type { PhotoPixels } from "../photoScout/pattern";

export const GREEN_CORES = {
  /** A pixel is green for the cores when (2g - r - b) / (r + g + b) is above this. */
  greenMin: 0.06,
  /** A blur is cut at this many of its standard deviations. */
  cutSigmas: 3,
};

export type GreenCore = { x: number; y: number; /** Its strength as a share of the photograph's strongest core. */ s: number; /** Its strength as measured. */ v: number };

/** Saturation times greenness per pixel, 0 where the pixel is not green. */
export function vividGreen(px: PhotoPixels, greenMin = GREEN_CORES.greenMin): Float32Array {
  const n = px.width * px.height, d = px.rgba, out = new Float32Array(n);
  for (let i = 0, q = 0; i < n; i++, q += 4) {
    const r = d[q], g = d[q + 1], b = d[q + 2], sum = r + g + b; if (!sum) continue;
    const gr = (2 * g - r - b) / sum; if (gr <= greenMin) continue;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); out[i] = ((mx - mn) / mx) * gr;
  }
  return out;
}

/** A Gaussian blur, standard deviation `sigma` pixels, cut at GREEN_CORES.cutSigmas of them; the photograph's edge is
 * repeated outward. `tmp` (the photograph's size) is scratch. */
export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number, tmp = new Float32Array(w * h)): Float32Array {
  const r = Math.max(1, Math.ceil(GREEN_CORES.cutSigmas * sigma)), k = new Float32Array(2 * r + 1); let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const line = new Float32Array(w + 2 * r), some = new Int32Array(w + 2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w; for (let x = 0; x < w; x++) line[x + r] = src[o + x];
    for (let x = 0; x < r; x++) { line[x] = src[o]; line[w + r + x] = src[o + w - 1]; }
    // Where no pixel under the blur holds anything the answer is 0: most of a photograph of plants on soil.
    for (let x = 0; x < line.length; x++) some[x + 1] = some[x] + (line[x] !== 0 ? 1 : 0);
    if (!some[line.length]) { tmp.fill(0, o, o + w); continue; }
    for (let x = 0; x < w; x++) { if (some[x + k.length] === some[x]) { tmp[o + x] = 0; continue; } let a = 0; for (let j = 0; j < k.length; j++) a += k[j] * line[x + j]; tmp[o + x] = a; }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let j = -r; j <= r; j++) { const yy = Math.min(h - 1, Math.max(0, y + j)) * w, kk = k[j + r]; for (let x = 0; x < w; x++) out[o + x] += kk * tmp[yy + x]; }
  }
  return out;
}

/** The cores view: `vivid` blurred at `fine` pixels less `vivid` blurred at `wide`, negatives to zero; and its highest value. */
export function coresView(vivid: Float32Array, w: number, h: number, fine: number, wide: number): { strength: Float32Array; top: number } {
  const tmp = new Float32Array(w * h), a = gaussianBlur(vivid, w, h, fine, tmp), b = gaussianBlur(vivid, w, h, wide, tmp);
  let top = 0; for (let i = 0; i < w * h; i++) { const v = a[i] - b[i]; a[i] = v > 0 ? v : 0; if (a[i] > top) top = a[i]; }
  return { strength: a, top };
}

/** The local peaks of a cores view at or over `share` of its highest value: a pixel no lower than its eight
 * neighbours (of equal neighbours the first in reading order). */
export function corePeaks(strength: Float32Array, w: number, h: number, top: number, share: number): GreenCore[] {
  const out: GreenCore[] = [], a = strength, lowest = share * top; if (!(top > 0)) return out;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, v = a[i]; if (v < lowest || !(v > 0)) continue;
    if (a[i - w - 1] >= v || a[i - w] >= v || a[i - w + 1] >= v || a[i - 1] >= v || a[i + 1] > v || a[i + w - 1] > v || a[i + w] > v || a[i + w + 1] > v) continue;
    out.push({ x, y, s: v / top, v });
  }
  return out;
}

/** The cores of a photograph: blur sizes in its own pixels. */
export function greenCores(px: PhotoPixels, fine: number, wide: number, share: number): GreenCore[] {
  const { strength, top } = coresView(vividGreen(px), px.width, px.height, fine, wide);
  return corePeaks(strength, px.width, px.height, top, share);
}
