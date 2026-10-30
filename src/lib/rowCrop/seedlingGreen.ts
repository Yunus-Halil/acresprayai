// Seedlings on bare soil, pale leaves included (the emergence variant's green, 2026-10-30).
//
// A corn seedling's leaf is a centimetre wide and, in sun, pale: lighter than the soil but only a little greener. A
// fixed green index (ExGR over the soil tile's level) catches its darker half and loses the sunlit half, and in the
// dim corners of a frame (lens vignetting) it loses whole seedlings. The camera also keeps colour at a quarter of the
// resolution of brightness, so a thin leaf's green is smeared into the soil around it. So green is judged per pixel
// against the soil right beside it, in brightness and in tint (G - (R + B) / 2, the green chroma), with hysteresis:
// - strong: tint over the local soil's by SEEDLING_GREEN.strongTint: a leaf for certain;
// - weak: tint over the soil's by weakTint, or brighter than the soil by brightOverSoil with paleTint of tint: joins
//   the mask only where it touches a strong pixel (the pale half of a leaf);
// - a pale seedling with no strong pixel at all is kept when it is big enough and part of it is brighter than its
//   soil with sproutTint of tint over the soil's.
// The local soil level: block means of the least green pixels (tint under the image's 10th percentile plus a spread),
// then a median over the blocks around, so a row of seedlings never raises its own soil level.
import type { PhotoPixels } from "../photoScout/pattern";

export const SEEDLING_GREEN = {
  blockPx: 16,
  /** Median window over blocks (odd). */
  soilWin: 9,
  soilTintPercentile: 0.1,
  soilTintSpread: 12,
  // Chosen by eye on photographs 54 and 60 (outputs/seedling-mask): at 14 / 6 / 22 the colour smear around each leaf
  // joined neighbouring seedlings; at 16 / 10 / 28 they stay apart and the pale corner seedlings are still caught.
  strongTint: 16,
  weakTint: 10,
  brightOverSoil: 28,
  paleTint: 3,
  /** A pale seedling with no strong pixel: at least this many pixels (photo pixels) ... */
  sproutMinPx: 12,
  /** ... with a part this much brighter than the soil and greener than it by sproutTint. */
  sproutBright: 30,
  sproutTint: 8,
};
export type SeedlingGreenOptions = typeof SEEDLING_GREEN;

function medianGrid(v: Float32Array, w: number, h: number, win: number): Float32Array {
  const out = new Float32Array(w * h), r = win >> 1, buf: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    buf.length = 0;
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) { const q = v[yy * w + xx]; if (Number.isFinite(q)) buf.push(q); }
    if (!buf.length) { out[y * w + x] = NaN; continue; }
    buf.sort((a, b) => a - b); out[y * w + x] = buf[buf.length >> 1];
  }
  return out;
}

/** The seedling mask at the photo's own pixel (1 = plant). */
export function seedlingMask(px: PhotoPixels, o: SeedlingGreenOptions = SEEDLING_GREEN): Uint8Array {
  const W = px.width, H = px.height, N = W * H, d = px.rgba;
  // Soil tint cut from the image's tint histogram (sampled).
  const hist = new Int32Array(256);
  for (let i = 0; i < N; i += 7) { const q = i * 4; hist[Math.max(0, Math.min(255, Math.round(d[q + 1] - (d[q] + d[q + 2]) / 2) + 128))]++; }
  let tot = 0; for (const v of hist) tot += v;
  let acc = 0, pT = 0; for (let t = 0; t < 256; t++) { acc += hist[t]; if (acc >= o.soilTintPercentile * tot) { pT = t - 128; break; } }
  const soilCut = pT + o.soilTintSpread;
  const B = o.blockPx, gw = Math.ceil(W / B), gh = Math.ceil(H / B);
  const bl = new Float32Array(gw * gh), bt = new Float32Array(gw * gh), bn = new Float32Array(gw * gh), ba = new Float32Array(gw * gh);
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / B) * gw;
    for (let x = 0; x < W; x++) {
      const q = (y * W + x) * 4, r = d[q], g = d[q + 1], b = d[q + 2], c = row + Math.floor(x / B), t = g - (r + b) / 2;
      ba[c]++;
      if (t >= soilCut) continue;
      bl[c] += 0.3 * r + 0.59 * g + 0.11 * b; bt[c] += t; bn[c]++;
    }
  }
  for (let c = 0; c < gw * gh; c++) { const ok = bn[c] >= 0.2 * ba[c]; bl[c] = ok ? bl[c] / bn[c] : NaN; bt[c] = ok ? bt[c] / bn[c] : NaN; }
  const soilL = medianGrid(bl, gw, gh, o.soilWin), soilT = medianGrid(bt, gw, gh, o.soilWin);

  // Per pixel: 1 strong, 2 weak, 4 sprout part.
  const cls = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / B) * gw;
    for (let x = 0; x < W; x++) {
      const c = row + Math.floor(x / B), sL = soilL[c], sT = soilT[c];
      if (!Number.isFinite(sL) || !Number.isFinite(sT)) continue;
      const i = y * W + x, q = i * 4, r = d[q], g = d[q + 1], b = d[q + 2];
      const dt = g - (r + b) / 2 - sT, dl = 0.3 * r + 0.59 * g + 0.11 * b - sL;
      if (dt > o.strongTint) cls[i] = 1;
      else if (dt > o.weakTint || (dl > o.brightOverSoil && dt > o.paleTint)) cls[i] = dl > o.sproutBright && dt > o.sproutTint ? 6 : 2;
    }
  }
  // Hysteresis: components of strong + weak; kept when they hold a strong pixel, or are a pale seedling.
  const mask = new Uint8Array(N), seen = new Uint8Array(N), stack: number[] = [], comp: number[] = [];
  for (let i0 = 0; i0 < N; i0++) {
    if (!cls[i0] || seen[i0]) continue;
    comp.length = 0; seen[i0] = 1; stack.push(i0);
    let strong = false, sprout = false;
    while (stack.length) {
      const p = stack.pop()!; comp.push(p);
      if (cls[p] & 1) strong = true; if (cls[p] & 4) sprout = true;
      const x = p % W, y = (p - x) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const qn = yy * W + xx; if (cls[qn] && !seen[qn]) { seen[qn] = 1; stack.push(qn); }
      }
    }
    if (strong || (sprout && comp.length >= o.sproutMinPx)) for (const p of comp) mask[p] = 1;
  }
  return mask;
}

/** A mask shrunk by f: a work pixel is plant when any of its f x f photo pixels is. */
export function shrinkMask(mask: Uint8Array, W: number, H: number, f: number): Uint8Array {
  if (f <= 1) return mask;
  const w = Math.floor(W / f), h = Math.floor(H / f), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let any = 0;
    for (let yy = 0; yy < f && !any; yy++) for (let xx = 0; xx < f; xx++) if (mask[(y * f + yy) * W + x * f + xx]) { any = 1; break; }
    out[y * w + x] = any;
  }
  return out;
}
