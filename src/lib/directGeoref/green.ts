// Green patches in a photograph by rules alone: the vegetation index, the threshold, the cells, the components, and
// the split of a large patch into the plants it is made of. No model. This is the colour tier of the twin's weed
// pass (fieldTwin/build/weeds.ts) and the "other vegetation" scan; objects.ts' vegetationObjects is the plain form.
//
// Index: excess green minus excess red on chromaticity (ExGR, Meyer & Neto 2008), which drops straw and shadowed soil
// where plain ExG with Otsu's split paints half the soil green (weedVision/fieldRows.ts has the history).
// Threshold: fixed at zero ("exgr"), or relative to the soil around the plant ("exgr-soil"): the 25th percentile of
// the index in each tile of a few metres is that tile's soil, and a pixel is green when it stands `soilMargin` above
// it. A small plant in a 4 cm pixel is a blend of leaf and soil and sits just under zero; against its own soil it
// stands out. Shadowed soil is bluer and darker, its soil level lower, and the same margin holds.
// Split: a patch over `splitM2` (a strip of weeds under a drip line, two plants touching) is cut at the peaks of its
// distance transform (the centre of each plant is the cell furthest from the patch's edge), each cell going to the
// nearest peak: one object per plant, the same way in every photograph that sees it.
import { measureComponents } from "../photoScout/pattern";
import type { PhotoPixels } from "../photoScout/pattern";
import type { PixelObject } from "./objects";

export type GreenIndex = "exgr" | "exgr-soil" | "exg-otsu";

export type GreenOptions = {
  index: GreenIndex;
  /** Raster pixels per detection cell. */
  cellPx: number;
  /** A cell is green when at least this share of its pixels is. */
  cellGreenShare: number;
  /** Patches with fewer cells are specks. */
  minCells: number;
  /** exgr-soil: how far above the tile's soil level a pixel must stand, and the tile's size in raster pixels. */
  soilMargin: number;
  soilTilePx: number;
  /** exgr-soil: the threshold never falls below this (yellowing cover and straw stay out). */
  soilFloor: number;
  /** Metres per raster pixel (for splitM2 and the peak separation); 0 disables the split. */
  pixelM: number;
  /** A patch over this ground area is split at its distance-transform peaks; 0 never splits. */
  splitM2: number;
  /** Peaks closer than this are one plant, metres. */
  peakSepM: number;
  /** A patch of fewer than `smallCells` cells must stand `smallMargin` above its soil on average (a speck of noise
   * does not; a small plant does); 0 cells disables the rule. */
  smallCells: number;
  smallMargin: number;
};

export const GREEN_DEFAULTS: GreenOptions = { index: "exgr", cellPx: 2, cellGreenShare: 0.3, minCells: 3, soilMargin: 0.15, soilTilePx: 64, soilFloor: -0.1, pixelM: 0, splitM2: 0, peakSepM: 0.2, smallCells: 0, smallMargin: 0.25 };

const exgrOf = (r: number, g: number, b: number) => { const s = r + g + b; if (s <= 0) return -1; const rr = r / s, gg = g / s, bb = b / s; return 2 * gg - rr - bb - (1.4 * rr - gg); };
const exgOf = (r: number, g: number, b: number) => { const s = r + g + b; if (s <= 0) return -1; return (2 * g - r - b) / s; };

/** Otsu's split of values in [lo, hi] over 64 bins. */
function otsu(vals: Float32Array, n: number, lo: number, hi: number): number {
  const h = new Float64Array(64);
  for (let i = 0; i < n; i++) { const b = Math.max(0, Math.min(63, Math.floor(((vals[i] - lo) / (hi - lo)) * 64))); h[b]++; }
  let sum = 0; for (let i = 0; i < 64; i++) sum += i * h[i];
  let sumB = 0, wB = 0, best = -1, at = 0;
  for (let i = 0; i < 64; i++) { wB += h[i]; if (!wB) continue; const wF = n - wB; if (!wF) break; sumB += i * h[i]; const mB = sumB / wB, mF = (sum - sumB) / wF; const between = wB * wF * (mB - mF) ** 2; if (between > best) { best = between; at = i; } }
  return lo + ((at + 1) / 64) * (hi - lo);
}

/** The green mask of a photograph under the chosen index and threshold. */
export function greenMask(px: PhotoPixels, o: GreenOptions): Uint8Array { return greenMaskWithExcess(px, o).mask; }

/** The mask, and each pixel's index above its threshold (the soil level plus the margin for exgr-soil). */
export function greenMaskWithExcess(px: PhotoPixels, o: GreenOptions): { mask: Uint8Array; excess: Float32Array } {
  const { width: W, height: H } = px, N = W * H;
  const mask = new Uint8Array(N);
  const excess = new Float32Array(N);
  if (o.index === "exgr") {
    for (let i = 0; i < N; i++) { const q = i * 4; if (px.rgba[q + 3] === 0) continue; const v = exgrOf(px.rgba[q], px.rgba[q + 1], px.rgba[q + 2]); excess[i] = v; mask[i] = v > 0 ? 1 : 0; }
    return { mask, excess };
  }
  const idx = new Float32Array(N);
  if (o.index === "exg-otsu") {
    const vals = new Float32Array(N);
    let m = 0;
    for (let i = 0; i < N; i++) { const q = i * 4; if (px.rgba[q + 3] === 0) { idx[i] = -1; continue; } idx[i] = exgOf(px.rgba[q], px.rgba[q + 1], px.rgba[q + 2]); vals[m++] = idx[i]; }
    const t = Math.min(0.25, Math.max(0.06, m ? otsu(vals, m, -0.2, 0.8) : 0.1));
    for (let i = 0; i < N; i++) { excess[i] = idx[i] - t; mask[i] = idx[i] > t ? 1 : 0; }
    return { mask, excess };
  }
  // exgr-soil: the index everywhere, the soil level per tile (25th percentile from a 256-bin histogram over
  // [-0.5, 0.5]), smoothed over the 3 x 3 neighbouring tiles, interpolated between tile centres.
  for (let i = 0; i < N; i++) { const q = i * 4; idx[i] = px.rgba[q + 3] === 0 ? NaN : exgrOf(px.rgba[q], px.rgba[q + 1], px.rgba[q + 2]); }
  const T = Math.max(16, o.soilTilePx), TW = Math.ceil(W / T), TH = Math.ceil(H / T);
  const soil = new Float32Array(TW * TH).fill(NaN);
  const hist = new Int32Array(256);
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    hist.fill(0);
    let n = 0;
    for (let y = ty * T; y < Math.min(H, ty * T + T); y++) for (let x = tx * T; x < Math.min(W, tx * T + T); x++) { const v = idx[y * W + x]; if (Number.isNaN(v)) continue; hist[Math.max(0, Math.min(255, Math.floor((v + 0.5) * 256)))]++; n++; }
    if (n < 16) continue;
    let acc = 0, bin = 0;
    for (; bin < 256; bin++) { acc += hist[bin]; if (acc >= 0.25 * n) break; }
    soil[ty * TW + tx] = bin / 256 - 0.5;
  }
  const smooth = new Float32Array(TW * TH);
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = tx + dx, yy = ty + dy; if (xx < 0 || yy < 0 || xx >= TW || yy >= TH) continue; const v = soil[yy * TW + xx]; if (!Number.isNaN(v)) { s += v; n++; } }
    smooth[ty * TW + tx] = n ? s / n : -0.24;
  }
  for (let y = 0; y < H; y++) {
    const fy = Math.max(0, Math.min(TH - 1, (y + 0.5) / T - 0.5)), y0 = Math.floor(fy), y1 = Math.min(TH - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < W; x++) {
      const v = idx[y * W + x];
      if (Number.isNaN(v)) continue;
      const fx = Math.max(0, Math.min(TW - 1, (x + 0.5) / T - 0.5)), x0 = Math.floor(fx), x1 = Math.min(TW - 1, x0 + 1), wx = fx - x0;
      const level = (1 - wy) * ((1 - wx) * smooth[y0 * TW + x0] + wx * smooth[y0 * TW + x1]) + wy * ((1 - wx) * smooth[y1 * TW + x0] + wx * smooth[y1 * TW + x1]);
      excess[y * W + x] = v - level;
      mask[y * W + x] = v > Math.max(o.soilFloor, level + o.soilMargin) ? 1 : 0;
    }
  }
  return { mask, excess };
}

function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/**
 * Split one component's cells at the peaks of its distance transform. `cells` are indices into the W x H cell
 * raster. Returns groups of cell indices (one group when the patch has one peak).
 */
export function splitAtPeaks(cells: number[], W: number, minSepCells: number): number[][] {
  if (cells.length < 4) return [cells];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cells) { const x = c % W, y = (c - x) / W; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const bw = maxX - minX + 3, bh = maxY - minY + 3;
  const inside = new Uint8Array(bw * bh);
  for (const c of cells) { const x = c % W - minX + 1, y = (c - (c % W)) / W - minY + 1; inside[y * bw + x] = 1; }
  // Chamfer 3-4 distance to the nearest outside cell, two passes.
  const INF = 1e6;
  const dt = new Float32Array(bw * bh);
  for (let i = 0; i < bw * bh; i++) dt[i] = inside[i] ? INF : 0;
  for (let y = 1; y < bh; y++) for (let x = 1; x < bw; x++) { const i = y * bw + x; if (!inside[i]) continue; dt[i] = Math.min(dt[i], dt[i - 1] + 3, dt[i - bw] + 3, dt[i - bw - 1] + 4, x + 1 < bw ? dt[i - bw + 1] + 4 : INF); }
  for (let y = bh - 2; y >= 0; y--) for (let x = bw - 2; x >= 0; x--) { const i = y * bw + x; if (!inside[i]) continue; dt[i] = Math.min(dt[i], dt[i + 1] + 3, dt[i + bw] + 3, dt[i + bw + 1] + 4, x > 0 ? dt[i + bw - 1] + 4 : INF); }
  // Peaks: cells no lower than their 8 neighbours, taken highest first, each suppressing the others within minSep.
  const cand: { i: number; d: number }[] = [];
  for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
    const i = y * bw + x;
    if (!inside[i]) continue;
    const d = dt[i];
    let top = true;
    for (let dy = -1; dy <= 1 && top; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; if (dt[i + dy * bw + dx] > d) { top = false; break; } }
    if (top) cand.push({ i, d });
  }
  cand.sort((a, b) => b.d - a.d);
  const peaks: number[] = [];
  const sep2 = minSepCells * minSepCells;
  for (const c of cand) {
    const x = c.i % bw, y = (c.i - x) / bw;
    if (peaks.some(p => { const px = p % bw, py = (p - px) / bw; return (px - x) ** 2 + (py - y) ** 2 < sep2; })) continue;
    peaks.push(c.i);
  }
  if (peaks.length <= 1) return [cells];
  // Each cell to the nearest peak by a multi-source breadth-first growth inside the patch.
  const owner = new Int32Array(bw * bh).fill(-1);
  let queue: number[] = [];
  peaks.forEach((p, k) => { owner[p] = k; queue.push(p); });
  while (queue.length) {
    const next: number[] = [];
    for (const i of queue) {
      const x = i % bw, y = (i - x) / bw, k = owner[i];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue; const j = yy * bw + xx; if (!inside[j] || owner[j] >= 0) continue; owner[j] = k; next.push(j); }
    }
    queue = next;
  }
  const groups: number[][] = peaks.map(() => []);
  for (const c of cells) { const x = c % W - minX + 1, y = (c - (c % W)) / W - minY + 1; const k = owner[y * bw + x]; groups[k < 0 ? 0 : k].push(c); }
  return groups.filter(g => g.length);
}

/**
 * Green patches in a (possibly downsized) photograph, as objects in the original frame's pixels. `toOriginal` is
 * original pixels per raster pixel (4 for a quarter-size decode). `exclude` (one byte per raster pixel) marks ground
 * cut out of the mask first. `keep`, when given, judges each connected patch BEFORE it is split: a patch it refuses
 * is dropped whole.
 */
export function greenPatches(px: PhotoPixels, toOriginal: number, opts: Partial<GreenOptions> = {}, keep?: (patch: PixelObject) => boolean, exclude?: Uint8Array | null): PixelObject[] {
  const o = { ...GREEN_DEFAULTS, ...opts };
  const { mask, excess } = greenMaskWithExcess(px, o);
  // Ground the caller knows is not a weed's (the crowns): cut out of the mask, so a patch running into a crown ends
  // at the crown's edge instead of going with it.
  if (exclude) for (let i = 0; i < mask.length; i++) if (exclude[i]) mask[i] = 0;
  const k = o.cellPx, W = Math.floor(px.width / k), H = Math.floor(px.height / k);
  const cells = new Uint8Array(W * H);
  const bar = o.cellGreenShare * k * k;
  if (k === 1) cells.set(mask);
  else for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    let n = 0;
    for (let y = cy * k; y < cy * k + k; y++) for (let x = cx * k; x < cx * k + k; x++) n += mask[y * px.width + x];
    if (n >= bar) cells[cy * W + cx] = 1;
  }
  const { blobs, labels } = measureComponents(cells, W, H, o.minCells);
  let members: number[][] = blobs.map(() => []);
  for (let i = 0; i < labels.length; i++) if (labels[i]) members[labels[i] - 1].push(i);
  // A small patch must stand well above its soil: the mean of its pixels' excess over the threshold level.
  if (o.smallCells > 0) {
    const meanExcess = (m: number[]) => { let s = 0, n = 0; for (const c of m) { const cx = c % W, cy = (c - cx) / W; for (let y = cy * k; y < cy * k + k; y++) for (let x = cx * k; x < cx * k + k; x++) { s += excess[y * px.width + x]; n++; } } return n ? s / n : 0; };
    members = members.filter(m => m.length >= o.smallCells || meanExcess(m) >= o.smallMargin);
  }
  const s = k * toOriginal;
  const own = new Int32Array(W * H).fill(-1);
  /** An object from a group of cells whose `own` entries carry `gi` (the hull from the boundary cells' corners). */
  const objectOf = (g: number[], gi: number, id: number): PixelObject => {
    let sx = 0, sy = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const corners: [number, number][] = [];
    for (const c of g) {
      const x = c % W, y = (c - x) / W;
      sx += x; sy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      const same = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < W && yy < H && own[yy * W + xx] === gi;
      if (same(x - 1, y) && same(x + 1, y) && same(x, y - 1) && same(x, y + 1)) continue;
      corners.push([x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]);
    }
    return { id, u: (sx / g.length + 0.5) * s, v: (sy / g.length + 0.5) * s, hull: convexHull(corners).map(([x, y]) => [x * s, y * s] as [number, number]), cells: g.length, areaPx: g.length * s * s, touchesEdge: minX === 0 || minY === 0 || maxX === W - 1 || maxY === H - 1 };
  };
  // The caller's judgement on each whole patch, before any split.
  if (keep) {
    members.forEach((m, mi) => { for (const c of m) own[c] = mi; });
    members = members.filter((m, mi) => keep(objectOf(m, mi, mi + 1)));
    own.fill(-1);
  }
  // Large patches are split at their peaks.
  const cellM = o.pixelM * k;
  const groups: number[][] = [];
  const splitCells = o.splitM2 > 0 && cellM > 0 ? o.splitM2 / (cellM * cellM) : Infinity;
  for (const m of members) {
    if (m.length > splitCells) groups.push(...splitAtPeaks(m, W, Math.max(2, Math.round(o.peakSepM / cellM)))); else groups.push(m);
  }
  groups.forEach((g, gi) => { for (const c of g) own[c] = gi; });
  const out: PixelObject[] = [];
  groups.forEach((g, gi) => { if (g.length >= o.minCells) out.push(objectOf(g, gi, out.length + 1)); });
  return out;
}
