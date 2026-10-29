// Small plants on the soil at the photo's own pixel (mid-stage corn): the corn is every plant that has a leaf at least
// FINE.thickCm wide, with everything joined to it (pale sunlit leaf included); a seedling is a small plant piece that
// joins no corn, stands FINE.nearCornCm clear of it, sits on soil, and has a part brighter than that soil.
//
// Why the photo's own pixel: a grass seedling's blades are 2 to 5 mm wide, a pixel or two of a consumer drone photo at
// 0.5 cm. The reader's 1 cm work raster averages them into the soil. And why brightness first: the camera stores
// colour at a quarter of the resolution of brightness (JPEG chroma subsampling plus in-camera smoothing), so a 1 cm
// blade keeps its brightness but most of its green is smeared into the soil around it. A blade is found by standing
// brighter than its soil with a green tint, not by its green alone.
import type { PhotoPixels } from "../photoScout/pattern";

export const FINE = {
  /** Soil level: means of blocks of this many pixels, then the median over FINE.soilWin x FINE.soilWin blocks. */
  soilBlockPx: 8,
  soilWin: 9,
  /** Soil pixels: green tint under the image's 10th percentile of tint plus this spread. */
  soilTintPercentile: 0.1,
  soilTintSpread: 12,
  /** Plant: clearly greener than the soil (G - (R+B)/2 over the soil's) ... */
  greenOverSoil: 14,
  /** ... or brighter than the soil by this (0..255 luma) with this much green tint. */
  brightOverSoil: 40,
  brightTint: 5,
  /** A pale seedling: brighter than the soil by FINE.brightOverSoil and greener than the soil's own tint by this. */
  sproutTintOverSoil: 10,
  /** Corn is joined through anything this much brighter than the soil and greener than the soil's own tint (pale sunlit
   * leaf, a whitish midrib; not pale soil crust, which would carry the corn across the ground). */
  joinBrightOverSoil: 30,
  /** A plant with a leaf this wide is corn (a V8 corn leaf is 5 to 10 cm wide; a grass seedling's blade under 1 cm). */
  thickCm: 4,
  /** A seedling stands this far clear of the corn (closer, a leaf piece and a seedling look alike). */
  nearCornCm: 1.5,
  /** Seedling area, square centimetres: from this ... */
  minCm2: 2,
  /** ... to this (larger plants between the rows are judged by the reader's weed pass). */
  maxCm2: 20,
  /** A seedling has a part this much brighter than its soil (sunlit leaf; a dark green speck in shadow is not judged). */
  minPeakOverSoil: 25,
  /** At most this share of the ring around a seedling (1 to 4 pixels out) is plant: it sits on soil. */
  maxRingPlant: 0.15,
};

/** Development only: when `keep` is set, the last call leaves its per-pixel flags here (1 plant, 2 join, 4 corn, 32 near corn, 64 candidate). */
export const FINE_DEBUG: { keep: boolean; flag: Uint8Array | null } = { keep: false, flag: null };

export type FineSeedling = { x: number; y: number; areaPx: number };

/**
 * Small plants on the soil, in photo pixels. `judge(x, y)` (photo pixels) says whether a seedling there is judged
 * (the reader's rows stand there, the ground is not a verge, no larger weed holds it).
 */
export function fineSeedlings(px: PhotoPixels, gsdM: number, judge: (x: number, y: number) => boolean, rejected?: { x: number; y: number; why: string }[]): { seedlings: FineSeedling[]; cornShare: number } {
  const W = px.width, H = px.height, N = W * H, d = px.rgba;
  const cm = (c: number) => c / 100 / gsdM; // centimetres to pixels

  // 1. Local levels of luma and green tint over every pixel (what the corn is told from: sunlit soil does not stand out
  // against them), and a second tint level from soil pixels only: in a closing canopy the ground around a seedling is
  // mostly corn, and a tint level taken over everything is corn's, hiding a pale seedling's green. Soil is the least green: tint under the image's
  // FINE.soilTintPercentile plus FINE.soilTintSpread. Block means of soil pixels, then a median over the blocks around.
  const hist = new Int32Array(256);
  for (let i = 0; i < N; i += 7) { const o = i * 4; hist[Math.max(0, Math.min(255, Math.round(d[o + 1] - (d[o] + d[o + 2]) / 2) + 128))]++; }
  let acc = 0, tot = 0; for (const v of hist) tot += v;
  let pT = 0; for (let t = 0; t < 256; t++) { acc += hist[t]; if (acc >= FINE.soilTintPercentile * tot) { pT = t - 128; break; } }
  const soilCut = pT + FINE.soilTintSpread;
  const B = FINE.soilBlockPx, gw = Math.ceil(W / B), gh = Math.ceil(H / B);
  const bl = new Float32Array(gw * gh), bc = new Float32Array(gw * gh), bn = new Float32Array(gw * gh), ba = new Float32Array(gw * gh), bca = new Float32Array(gw * gh);
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / B) * gw;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, r = d[o], g = d[o + 1], b = d[o + 2], c = row + Math.floor(x / B), t = g - (r + b) / 2;
      ba[c]++; bl[c] += 0.3 * r + 0.59 * g + 0.11 * b; bca[c] += t;
      if (t >= soilCut) continue;
      bc[c] += t; bn[c]++;
    }
  }
  for (let c = 0; c < gw * gh; c++) { bl[c] /= ba[c]; bca[c] /= ba[c]; bc[c] = bn[c] >= 0.2 * ba[c] ? bc[c] / bn[c] : NaN; }
  const soilL = medianGrid(bl, gw, gh, FINE.soilWin), soilCa = medianGrid(bca, gw, gh, FINE.soilWin), soilC = medianGrid(bc, gw, gh, FINE.soilWin);

  // 2. Per pixel: brightness and tint over the soil (clamped to a byte), and the plant / join masks.
  const dL = new Int8Array(N);
  const PLANT = 1, JOIN = 2, CORN = 4, SEEN = 8, NEAR_H = 16, NEAR = 32, CAND = 64;
  const flag = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    const gy = Math.min(gh - 1.0001, Math.max(0, (y + 0.5) / B - 0.5)), y0 = Math.floor(gy), ty = gy - y0;
    for (let x = 0; x < W; x++) {
      const gx = Math.min(gw - 1.0001, Math.max(0, (x + 0.5) / B - 0.5)), x0 = Math.floor(gx), tx = gx - x0;
      const c00 = y0 * gw + x0, c01 = c00 + 1, c10 = c00 + gw, c11 = c10 + 1;
      const sL = (soilL[c00] * (1 - tx) + soilL[c01] * tx) * (1 - ty) + (soilL[c10] * (1 - tx) + soilL[c11] * tx) * ty;
      const sC = (soilC[c00] * (1 - tx) + soilC[c01] * tx) * (1 - ty) + (soilC[c10] * (1 - tx) + soilC[c11] * tx) * ty;
      const sCa = (soilCa[c00] * (1 - tx) + soilCa[c01] * tx) * (1 - ty) + (soilCa[c10] * (1 - tx) + soilCa[c11] * tx) * ty;
      const i = y * W + x, o = i * 4, r = d[o], g = d[o + 1], b = d[o + 2];
      const l = Math.max(-127, Math.min(127, Math.round(0.3 * r + 0.59 * g + 0.11 * b - sL)));
      const tint = g - (r + b) / 2, t = tint - sCa;
      dL[i] = l;
      const plant = t > FINE.greenOverSoil || (l > FINE.brightOverSoil && t > FINE.brightTint);
      // A pale seedling: bright over the soil, with a green tint over the soil's own (not over the corn's).
      const sprout = l > FINE.brightOverSoil && tint - sC > FINE.sproutTintOverSoil;
      flag[i] = (plant ? PLANT | JOIN | CAND : 0) | (sprout ? CAND : 0) | (l > FINE.joinBrightOverSoil && tint - sC > 0 ? JOIN : 0);
    }
  }

  // 3. Corn: every joined component holding a plant pixel whose k x k square is all plant (a leaf k pixels wide).
  const k = Math.max(3, Math.round(cm(FINE.thickCm)) | 1), half = (k - 1) >> 1;
  const colRun = new Uint16Array(W), hOk = new Uint8Array(W);
  for (let y = 0; y < H; y++) {
    let run = 0;
    hOk.fill(0);
    for (let x = 0; x < W; x++) { run = flag[y * W + x] & PLANT ? run + 1 : 0; if (run >= k) hOk[x - half] = 1; }
    for (let x = 0; x < W; x++) {
      colRun[x] = hOk[x] ? colRun[x] + 1 : 0;
      if (colRun[x] >= k) { const i = (y - half) * W + x; if (!(flag[i] & CORN)) { spanFill(flag, W, H, i, JOIN, CORN); } }
    }
  }
  let cornN = 0; for (let i = 0; i < N; i++) if (flag[i] & CORN) cornN++;

  // 4. Near the corn: any corn within r pixels (a square window), by running counts along rows then columns.
  const r = Math.max(1, Math.round(cm(FINE.nearCornCm)));
  for (let y = 0; y < H; y++) {
    let cnt = 0;
    for (let x = -r; x < W + r; x++) {
      const xa = x + r; if (xa < W && (flag[y * W + xa] & (CORN | PLANT)) === (CORN | PLANT)) cnt++;
      const xs = x - r - 1; if (xs >= 0 && (flag[y * W + xs] & (CORN | PLANT)) === (CORN | PLANT)) cnt--;
      if (x >= 0 && x < W && cnt > 0) flag[y * W + x] |= NEAR_H;
    }
  }
  const colCnt = new Int32Array(W);
  for (let y = -r; y < H + r; y++) {
    const ya = y + r, ys = y - r - 1;
    if (ya < H) for (let x = 0; x < W; x++) if (flag[ya * W + x] & NEAR_H) colCnt[x]++;
    if (ys >= 0) for (let x = 0; x < W; x++) if (flag[ys * W + x] & NEAR_H) colCnt[x]--;
    if (y >= 0 && y < H) for (let x = 0; x < W; x++) if (colCnt[x] > 0) flag[y * W + x] |= NEAR;
  }

  // 5. Candidates: plant pixels that are not corn, as 8-connected components.
  const minPx = Math.max(4, Math.round(cm(1) * cm(1) * FINE.minCm2)), maxPx = Math.round(cm(1) * cm(1) * FINE.maxCm2);
  const out: FineSeedling[] = [];
  const stack = new Int32Array(Math.max(1024, maxPx * 8));
  const pix = new Int32Array(maxPx + 1);
  for (let i0 = 0; i0 < N; i0++) {
    if ((flag[i0] & (CAND | CORN | SEEN)) !== CAND) continue;
    // Flood the component; keep its first maxPx + 1 pixels (more means too large, but the rest is still marked).
    let top = 0, n = 0, edge = false, near = false, peak = -128, sx = 0, sy = 0;
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    flag[i0] |= SEEN; stack[top++] = i0;
    let overflow: number[] | null = null;
    while (top || (overflow && overflow.length)) {
      const i = top ? stack[--top] : overflow!.pop()!;
      if (n <= maxPx) pix[n] = i;
      n++;
      const x = i % W, y = (i - x) / W;
      sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      if (flag[i] & NEAR) near = true;
      if (dL[i] > peak) peak = dL[i];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx; if ((flag[j] & (CAND | CORN | SEEN)) !== CAND) continue;
        flag[j] |= SEEN;
        if (top < stack.length) stack[top++] = j; else (overflow ??= []).push(j);
      }
    }
    const why = n < minPx ? "small" : n > maxPx ? "large" : edge ? "edge" : near ? "near corn" : peak < FINE.minPeakOverSoil ? "dark" : null;
    if (why) { if (rejected && n >= minPx) rejected.push({ x: sx / n, y: sy / n, why }); continue; }
    // On soil: the ring 2..4 pixels out holds little plant.
    let ringN = 0, ringP = 0;
    const bw = x1 - x0 + 9, bh = y1 - y0 + 9, box = new Uint8Array(bw * bh);
    for (let q = 0; q < n; q++) { const i = pix[q], x = i % W, y = (i - x) / W; box[(y - y0 + 4) * bw + (x - x0 + 4)] = 1; }
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      if (box[by * bw + bx]) continue;
      let dmin = 9;
      for (let ey = Math.max(0, by - 4); ey <= Math.min(bh - 1, by + 4); ey++) for (let ex = Math.max(0, bx - 4); ex <= Math.min(bw - 1, bx + 4); ex++) if (box[ey * bw + ex]) dmin = Math.min(dmin, Math.max(Math.abs(ex - bx), Math.abs(ey - by)));
      if (dmin < 2 || dmin > 4) continue;
      const x = x0 - 4 + bx, y = y0 - 4 + by; if (x < 0 || y < 0 || x >= W || y >= H) continue;
      ringN++; if (flag[y * W + x] & (PLANT | CORN)) ringP++;
    }
    if (ringN && ringP / ringN > FINE.maxRingPlant) { rejected?.push({ x: sx / n, y: sy / n, why: "ring" }); continue; }
    const cx = sx / n, cy = sy / n;
    if (!judge(cx, cy)) continue;
    out.push({ x: cx, y: cy, areaPx: n });
  }
  if (FINE_DEBUG.keep) FINE_DEBUG.flag = flag;
  return { seedlings: out, cornShare: cornN / N };
}

/** Fill the 4-connected region of pixels carrying `through`, marking them `mark`, by spans (a small stack). */
function spanFill(flag: Uint8Array, W: number, H: number, start: number, through: number, mark: number) {
  const st: number[] = [start];
  while (st.length) {
    const i = st.pop()!; const y = Math.floor(i / W); let x = i - y * W;
    if (!(flag[i] & through) || flag[i] & mark) continue;
    while (x > 0 && flag[y * W + x - 1] & through && !(flag[y * W + x - 1] & mark)) x--;
    let upOpen = false, downOpen = false;
    for (; x < W; x++) {
      const j = y * W + x; if (!(flag[j] & through) || flag[j] & mark) break;
      flag[j] |= mark;
      if (y > 0) { const u = j - W, ok = !!(flag[u] & through) && !(flag[u] & mark); if (ok && !upOpen) st.push(u); upOpen = ok; }
      if (y < H - 1) { const v = j + W, ok = !!(flag[v] & through) && !(flag[v] & mark); if (ok && !downOpen) st.push(v); downOpen = ok; }
    }
  }
}

/**
 * Median of a grid over a win x win window, NaN (no soil in the block) left out; a cell with no value in its window
 * takes one from a window three times wider, else the median of every value.
 */
function medianGrid(a: Float32Array, w: number, h: number, win: number): Float32Array {
  const out = new Float32Array(w * h), buf = new Float32Array(9 * win * win);
  const at = (x: number, y: number, r: number): number => {
    let n = 0;
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) { const v = a[yy * w + xx]; if (v === v) buf[n++] = v; }
    if (!n) return NaN;
    return buf.subarray(0, n).sort()[n >> 1];
  };
  const all = Array.from(a).filter(v => v === v).sort((u, v) => u - v), fallback = all.length ? all[all.length >> 1] : 0;
  const r = (win - 1) >> 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = at(x, y, r);
    if (v !== v) v = at(x, y, 3 * r + 1);
    out[y * w + x] = v === v ? v : fallback;
  }
  return out;
}
