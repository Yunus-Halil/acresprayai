// The tree rows of an orchard (or any widely spaced row planting), read once
// for the whole field from the map, so only the weeds BETWEEN the rows count.
//
// The photo pass's row reader is built for row crops: rows under a metre
// apart, plants at seed spacing. In an orchard the trees stand metres apart
// and the weeds grow in lines along the tractor tracks between them, which
// that reader can take for the crop rows, hiding exactly the weeds that
// matter. Here the trees are found as what they are on the map (large,
// compact green crowns: weeds and weed strips are thin and vanish when the
// green is shrunk by 30 cm), lines are fitted through them (the direction
// that stacks the most trees on the fewest lines), and each row is a band as
// wide as a crown. A weed inside a crown is the tree; a weed in a band is on
// the tree row; anything else is between the rows.
//
// The field is read at about 7 to 12 cm a pixel, plenty for crowns a metre or
// more across. Pure functions on pixels; readFieldTreeRows does the drawing.
import type { LatLng2 } from "../geo";
import type { PhotoPixels } from "../photoScout/pattern";
import { fetchTileCached } from "../tileCache";
import { TILE_PX, mercatorPx, metresPerPixel } from "./mapRun";
import type { RowStatus } from "./rowFilter";

/** A tree crown, raster pixels. */
export type Tree = { x: number; y: number; r: number };
export type RowLine = { x1: number; y1: number; x2: number; y2: number };

export type TreeRows = {
  /** The raster: global Web Mercator pixels at zoom z are (left + x, top + y). */
  z: number; left: number; top: number; mpp: number;
  /** The trees that stand on a row. */
  trees: Tree[];
  lines: RowLine[];
  /** Half-width of a row's band, pixels. */
  bandPx: number;
  spacingM: number;
  directionDeg: number;
  treeRadiusM: number;
};

/** Shrinking the green by this much removes weeds and weed strips and keeps crowns. */
export const ERODE_M = 0.3;
export const MIN_CROWN_RADIUS_M = 0.45;
export const MAX_CROWN_RADIUS_M = 6;
export const MAX_ELONGATION = 3;
/** Trees closer than this across the row direction are on one row. */
export const ROW_GAP_M = 0.8;
export const MIN_TREES_PER_ROW = 3;
/** Rows closer than this are a row crop, not trees: left to the photo pass. */
export const MIN_ROW_SPACING_M = 2;
/** The band never takes more than this share of the row spacing: the alleys stay. */
export const MAX_BAND_SHARE = 0.35;
export const BAND_MARGIN_M = 0.25;

/** Excess green on chromaticity: plants high, soil and shadow low. */
export const excessGreen = (r: number, g: number, b: number) => { const s = r + g + b; return s > 0 ? (2 * g - r - b) / s : 0; };

/** Otsu's threshold over values in [lo, hi], 64 bins. */
function otsu(values: Float32Array, n: number, lo: number, hi: number): number {
  const bins = new Float64Array(64);
  for (let i = 0; i < n; i++) { const v = values[i]; if (v >= lo && v <= hi) bins[Math.min(63, Math.floor(((v - lo) / (hi - lo)) * 64))]++; }
  let total = 0, sum = 0;
  for (let i = 0; i < 64; i++) { total += bins[i]; sum += i * bins[i]; }
  let wB = 0, sumB = 0, best = 0, at = 0;
  for (let i = 0; i < 64; i++) {
    wB += bins[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * bins[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; at = i; }
  }
  return lo + ((at + 1) / 64) * (hi - lo);
}

/** Green pixels of the raster (transparent ones never). */
export function vegetationMask(px: PhotoPixels): Uint8Array {
  const n = px.width * px.height;
  const g = new Float32Array(n);
  let m = 0;
  const vals = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (px.rgba[o + 3] === 0) { g[i] = -1; continue; }
    g[i] = excessGreen(px.rgba[o], px.rgba[o + 1], px.rgba[o + 2]);
    vals[m++] = g[i];
  }
  const t = Math.min(0.25, Math.max(0.06, m ? otsu(vals, m, -0.2, 0.8) : 0.1));
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = g[i] > t ? 1 : 0;
  return mask;
}

/** Chamfer (3-4) distance of every mask pixel to the nearest non-mask pixel, in pixels. */
export function distanceInside(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
  }
  for (let i = 0; i < w * h; i++) d[i] /= 3;
  return d;
}

/** Tree crowns: the green that survives shrinking by ERODE_M, as compact blobs of crown size. */
export function findTrees(px: PhotoPixels, mpp: number): Tree[] {
  const { width: w, height: h } = px;
  const mask = vegetationMask(px);
  const dist = distanceInside(mask, w, h);
  const erode = Math.max(1, ERODE_M / mpp);
  const label = new Int32Array(w * h);
  const out: Tree[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let s = 0; s < w * h; s++) {
    if (label[s] || dist[s] < erode) continue;
    next++;
    label[s] = next; stack.push(s);
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, maxD = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i - x) / w;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; if (dist[i] > maxD) maxD = dist[i];
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && !label[j] && dist[j] >= erode) { label[j] = next; stack.push(j); }
      }
    }
    const cx = sx / n, cy = sy / n;
    const vxx = sxx / n - cx * cx, vyy = syy / n - cy * cy, vxy = sxy / n - cx * cy;
    const tr = vxx + vyy, det = vxx * vyy - vxy * vxy;
    const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const elong = l2 > 1e-9 ? Math.sqrt(l1 / l2) : Infinity;
    // The crown's radius: the shrunk blob's equivalent radius plus what was shrunk off, at least its deepest point.
    const r = Math.max(maxD, Math.sqrt(n / Math.PI) + erode);
    const rM = r * mpp;
    if (rM >= MIN_CROWN_RADIUS_M && rM <= MAX_CROWN_RADIUS_M && elong <= MAX_ELONGATION) out.push({ x: cx, y: cy, r });
  }
  return out;
}

const median = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** Trees grouped into rows across direction theta: rows of at least MIN_TREES_PER_ROW, by offset. */
function rowsAt(trees: Tree[], theta: number, gapPx: number): { offset: number; members: Tree[] }[] {
  const nx = -Math.sin(theta), ny = Math.cos(theta);
  const sorted = trees.map(t => ({ t, o: t.x * nx + t.y * ny })).sort((a, b) => a.o - b.o);
  const groups: { offset: number; members: Tree[] }[] = [];
  let cur: typeof sorted = [];
  const flush = () => { if (cur.length >= MIN_TREES_PER_ROW) groups.push({ offset: median(cur.map(c => c.o)), members: cur.map(c => c.t) }); cur = []; };
  for (const s of sorted) { if (cur.length && s.o - cur[cur.length - 1].o > gapPx) flush(); cur.push(s); }
  flush();
  return groups;
}

/** How strongly direction theta stacks the trees onto lines: the sum of squared counts per offset bin. */
function stacking(trees: Tree[], theta: number, binPx: number): number {
  const nx = -Math.sin(theta), ny = Math.cos(theta);
  const bins = new Map<number, number>();
  for (const t of trees) { const k = Math.floor((t.x * nx + t.y * ny) / binPx); bins.set(k, (bins.get(k) ?? 0) + 1); }
  let s = 0;
  for (const c of bins.values()) s += c * c;
  return s;
}

/** The tree rows through the crowns, or null when the trees do not stand in rows metres apart. */
export function fitTreeRows(trees: Tree[], mpp: number): Omit<TreeRows, "z" | "left" | "top" | "mpp"> | null {
  if (trees.length < 2 * MIN_TREES_PER_ROW) return null;
  const binPx = 0.4 / mpp, gapPx = ROW_GAP_M / mpp;
  const score = (th: number) => stacking(trees, th, binPx);
  let best = 0, bestS = -1;
  for (let d = 0; d < 180; d++) { const s = score((d * Math.PI) / 180); if (s > bestS) { bestS = s; best = d; } }
  let theta = (best * Math.PI) / 180;
  for (let d = best - 1; d <= best + 1; d += 0.1) { const th = (d * Math.PI) / 180, s = score(th); if (s > bestS) { bestS = s; theta = th; } }
  // A grid planting stacks almost as well across: the rows are the way with the wider alleys.
  const spacingOf = (g: { offset: number }[]) => median(g.slice(1).map((r, i) => r.offset - g[i].offset));
  let rows = rowsAt(trees, theta, gapPx);
  const across = theta + Math.PI / 2;
  if (score(across) >= 0.9 * bestS) {
    const other = rowsAt(trees, across, gapPx);
    if (other.length >= 2 && spacingOf(other) > spacingOf(rows) * 1.1) { theta = across; rows = other; }
  }
  if (rows.length < 2) return null;
  const spacingPx = spacingOf(rows);
  if (spacingPx * mpp < MIN_ROW_SPACING_M) return null;
  const dx = Math.cos(theta), dy = Math.sin(theta), nx = -dy, ny = dx;
  const onRows = rows.flatMap(r => r.members);
  const treeR = median(onRows.map(t => t.r));
  const lines: RowLine[] = rows.map(r => {
    const along = r.members.map(t => t.x * dx + t.y * dy).sort((a, b) => a - b);
    const step = median(along.slice(1).map((a, i) => a - along[i])) || treeR * 2;
    const a0 = along[0] - step / 2, a1 = along[along.length - 1] + step / 2;
    return { x1: a0 * dx + r.offset * nx, y1: a0 * dy + r.offset * ny, x2: a1 * dx + r.offset * nx, y2: a1 * dy + r.offset * ny };
  });
  const bandPx = Math.min(treeR + BAND_MARGIN_M / mpp, MAX_BAND_SHARE * spacingPx);
  return { trees: onRows, lines, bandPx, spacingM: spacingPx * mpp, directionDeg: ((theta * 180) / Math.PI + 360) % 180, treeRadiusM: treeR * mpp };
}

function distToSegment(px: number, py: number, l: RowLine): number {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - l.x1) * dx + (py - l.y1) * dy) / len2)) : 0;
  return Math.hypot(px - (l.x1 + t * dx), py - (l.y1 + t * dy));
}

/** Where a point (raster pixels) stands: in a crown, on a tree row's band, or between the rows. */
export function treeRowStatusPx(rows: Pick<TreeRows, "trees" | "lines" | "bandPx">, x: number, y: number): RowStatus {
  for (const t of rows.trees) if (Math.hypot(x - t.x, y - t.y) <= t.r) return "on-crop";
  for (const l of rows.lines) if (distToSegment(x, y, l) <= rows.bandPx) return "on-row";
  return "off-row";
}

/** Where a place stands against the field's tree rows. */
export function treeRowStatusAt(rows: TreeRows, p: LatLng2): RowStatus {
  const [X, Y] = mercatorPx(p.lat, p.lng, rows.z);
  return treeRowStatusPx(rows, X - rows.left, Y - rows.top);
}

// ---------------------------------------------------------------- browser

/** Raster sizes are kept under this many pixels a side. */
export const MAX_RASTER_PX = 4096;
/** The finest pixel the trees are read at. */
export const TREE_READ_MPP = 0.07;

/** The field's tree rows, read from the map's tiles; null when the browser cannot draw or there are no tree rows. */
export async function readFieldTreeRows(input: { rings: LatLng2[][]; tile: (z: number, x: number, y: number) => string; maxNative: number; lat: number; signal?: AbortSignal }): Promise<TreeRows | null> {
  const pts = input.rings.flat();
  if (!pts.length || typeof createImageBitmap === "undefined") return null;
  let z = Math.min(Math.floor(input.maxNative), 22);
  while (z > 14 && metresPerPixel(input.lat, z) < TREE_READ_MPP) z--;
  const extent = (zz: number) => {
    const p = pts.map(q => mercatorPx(q.lat, q.lng, zz));
    const xs = p.map(v => v[0]), ys = p.map(v => v[1]);
    return { left: Math.floor(Math.min(...xs)), top: Math.floor(Math.min(...ys)), right: Math.ceil(Math.max(...xs)), bottom: Math.ceil(Math.max(...ys)) };
  };
  let e = extent(z);
  while (z > 14 && (e.right - e.left > MAX_RASTER_PX || e.bottom - e.top > MAX_RASTER_PX)) { z--; e = extent(z); }
  const w = e.right - e.left, h = e.bottom - e.top;
  if (w < 8 || h < 8) return null;
  const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = (canvas as HTMLCanvasElement).getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  if (!ctx) return null;
  const jobs: Promise<void>[] = [];
  for (let ty = Math.floor(e.top / TILE_PX); ty <= Math.floor((e.bottom - 1) / TILE_PX); ty++) {
    for (let tx = Math.floor(e.left / TILE_PX); tx <= Math.floor((e.right - 1) / TILE_PX); tx++) {
      jobs.push(fetchTileCached(input.tile(z, tx, ty), { signal: input.signal })
        .then(b => createImageBitmap(b))
        .then(bmp => { ctx.drawImage(bmp, tx * TILE_PX - e.left, ty * TILE_PX - e.top); bmp.close?.(); })
        .catch(() => { /* a missing tile stays transparent */ }));
    }
  }
  await Promise.all(jobs);
  if (input.signal?.aborted) return null;
  const px: PhotoPixels = { width: w, height: h, rgba: ctx.getImageData(0, 0, w, h).data };
  const mpp = metresPerPixel(input.lat, z);
  // Let the page breathe before the arithmetic.
  await new Promise(r => setTimeout(r, 0));
  const fit = fitTreeRows(findTrees(px, mpp), mpp);
  return fit ? { ...fit, z, left: e.left, top: e.top, mpp } : null;
}
