// The field's crop rows, read ONCE from the whole field map, so only the
// weeds between the rows count.
//
// The rule the source photos taught: a crop row is a line of separate plants
// at a consistent spacing along it, and the rows stand at a consistent
// spacing across. Everything on such a line is taken for the crop. A weed
// strip along a tractor track is a line too, but a continuous or random one:
// its pieces are not crop-sized plants evenly spaced along it, so it never
// becomes a row. (Reading rows from where the green mass lines up, as the
// photo pass's profile fit does, took an orchard's weed strips for rows
// 1.5 m apart: the strips are most of the green between young trees.)
//
// In order:
//   1. read            the field in tiles at READ_MPP (about 4-6 cm), however
//                      large it is
//   2. plants          excess green, Otsu; 8-connected pieces; pieces closer
//                      than MERGE_GAP_M joined (a thin young crown breaks into
//                      several); compact joined blobs of plant size are the
//                      candidates, and crop-sized ones (by the area-weighted
//                      median) take part in the rows
//   3. direction       the angle that stacks the most plant area onto the
//                      fewest lines, and a quarter turn from it: both are
//                      read, and the rows are the way with the wider alleys
//                      (rows that bend smear their own stacking, while the
//                      trees across them still line up straight)
//   4. chains          each plant linked to the next one along that direction
//                      (mutual best link, a little sideways play), so a row
//                      that bends or drifts is followed plant to plant
//   5. along a chain   its typical gap; a plant that splits a gap into two
//                      wrong ones is between plants and dropped; the chain
//                      stands when most of its gaps are whole multiples of
//                      its spacing, and the chains share one spacing
//   6. across          the rows' typical spacing; a chain whose neighbours on
//                      both sides sit off that spacing is dropped (a line of
//                      weed patches in an alley is not a crop row); and the
//                      rows must hold most of the crop-sized green in their
//                      own extent, which chance lines among weeds never do
//   7. blocks          plants no row explains are read again, up to
//                      MAX_BLOCKS plantings at their own angles
//   8. bands           each row is the line through its own plants, as wide
//                      as a crop plant and at least ROW_BAND_PITCH_SHARE of
//                      the spacing, never more than MAX_BAND_SHARE
import type { LatLng2 } from "../geo";
import type { PhotoPixels } from "../photoScout/pattern";
import { fetchTileCached } from "../tileCache";
import { TILE_PX, mercatorPx, metresPerPixel } from "./mapRun";
import { ROW_BAND_PITCH_SHARE, type RowContext, type RowStatus, rowStatusOf } from "./rowFilter";

export type FieldRows = {
  /** The read frame: global Web Mercator pixels at zoom z are (left + x, top + y). */
  z: number; left: number; top: number; mpp: number;
  /** The rows and the crop plants on them, frame pixels. */
  ctx: RowContext;
  rows: number;
  spacingM: number;
  /** The typical spacing of the plants along a row. */
  seedSpacingM: number;
  directionDeg: number;
  blocks: number;
  /** "layout" when the rows come from the field's confirmed planting layout (layout/), else read here. */
  source?: "reader" | "layout";
  /** Layout rows: expected plant positions with no plant (frame pixels). */
  gaps?: { x: number; y: number; /** none: plainly bare ground (a skip); operator: marked "no crop". */ evidence?: "none" | "operator" }[];
  /** Layout rows: tree-sized green on no row (frame pixels), a row or block the layout does not cover yet. */
  unexplained?: { x: number; y: number; r: number }[];
};

/** The pixel the field is read at: fine enough for a young tree, coarse enough to read a large field in tiles. */
export const READ_MPP = 0.04;
/** Raster tiles: this many pixels owned, plus the overlap read on each side. */
export const READ_TILE_PX = 3072;
export const READ_OVERLAP_PX = 160;
/** Pieces smaller than this are specks. */
export const MIN_PIECE_M2 = 0.004;
/** Pieces closer than this are one plant. */
export const MERGE_GAP_M = 0.15;
/** Candidates: joined blobs at least this big (about 25 cm across)... */
export const MIN_PLANT_AREA_M2 = 0.05;
/** ...no longer than this times their width (a strip is longer)... */
export const MAX_PLANT_ELONGATION = 2.5;
/** ...and no wider than this. */
export const MAX_PLANT_RADIUS_M = 5;
/** Crop-sized: at least this share of the field's typical crop plant (the area-weighted median). */
export const MIN_ROW_SIZE_SHARE = 0.3;
/** A link may run at most this far sideways of the row direction (degrees), and at most this share of a gap. */
export const LINK_ANGLE_DEG = 12;
export const LINK_ACROSS_SHARE = 0.3;
/** A link spans at most this many gaps (two trees missing). */
export const LINK_MAX_GAPS = 3.3;
/** A gap is a whole number of spacings within this share. */
export const GAP_TOL = 0.15;
/** A chain stands when at least this share of its gaps are whole. */
export const MIN_WHOLE_GAPS = 0.7;
export const MIN_PLANTS_PER_ROW = 4;
/** A planting has at least this many rows: two short lines can line up by chance. */
export const MIN_ROWS = 3;
/** A chain's spacing agrees with its planting's within this share. */
export const SEED_SPACING_TOL = 0.25;
/** A row is a whole number of row spacings from a neighbour within this share. */
export const ROW_SPACING_TOL = 0.2;
export const MIN_ROW_SPACING_M = 1;
/** The band never takes more than this share of the spacing: the alleys stay. */
export const MAX_BAND_SHARE = 0.35;
export const MAX_BLOCKS = 3;
/** A planting's rows hold at least this share of the crop-sized green within their own extent: a real one explains its area, chance lines among weeds do not. */
export const MIN_EXPLAINED_SHARE = 0.5;
/** Another planting is looked for while plants no row explains carry at least this share of the crop-sized area. */
export const MIN_LEFTOVER_SHARE = 0.2;

/** A blob with its raw pixel sums, so pieces join by adding. Coordinates in frame pixels. */
export type Blob = { x: number; y: number; area: number; r: number; elong: number; n: number; sx: number; sy: number; sxx: number; syy: number; sxy: number };

const excessGreen = (r: number, g: number, b: number) => { const s = r + g + b; return s > 0 ? (2 * g - r - b) / s : 0; };

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
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; at = i; }
  }
  return lo + ((at + 1) / 64) * (hi - lo);
}

/**
 * Which index the vegetation mask is cut from.
 *   exgr      excess green minus excess red on chromaticity (3g - 2.4r - b), cut at zero: a fixed bar that needs no
 *             second class in the picture. Meyer & Neto 2008 measured it at 0.88 against 0.53 for ExG + Otsu on soil
 *             with residue and straw; Otsu assumes two balanced classes and paints half the soil green on a scene that
 *             is mostly lit ground, which is how a grassed olive orchard phase-locked the lattice onto the sward
 *             (docs/research/olive-orchard-fitter-trial.md). The default since 2026-10-21.
 *   exg-otsu  excess green with Otsu's split clamped to [0.06, 0.25]: what ran before, kept for comparison.
 */
export type VegetationIndex = "exgr" | "exg-otsu";
export const VEGETATION_INDEX: VegetationIndex = "exgr";
/** Excess green minus excess red on chromaticity; -1 for a pixel with no colour. */
const excessGreenRed = (r: number, g: number, b: number) => { const s = r + g + b; if (s <= 0) return -1; const rr = r / s, gg = g / s, bb = b / s; return 2 * gg - rr - bb - (1.4 * rr - gg); };

/** Green pixels (transparent ones never). */
export function vegetationMask(px: PhotoPixels, index: VegetationIndex = VEGETATION_INDEX): Uint8Array {
  const n = px.width * px.height;
  const mask = new Uint8Array(n);
  if (index === "exgr") {
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (px.rgba[o + 3] === 0) continue;
      mask[i] = excessGreenRed(px.rgba[o], px.rgba[o + 1], px.rgba[o + 2]) > 0 ? 1 : 0;
    }
    return mask;
  }
  const g = new Float32Array(n), vals = new Float32Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (px.rgba[o + 3] === 0) { g[i] = -1; continue; }
    g[i] = excessGreen(px.rgba[o], px.rgba[o + 1], px.rgba[o + 2]);
    vals[m++] = g[i];
  }
  const t = Math.min(0.25, Math.max(0.06, m ? otsu(vals, m, -0.2, 0.8) : 0.1));
  for (let i = 0; i < n; i++) mask[i] = g[i] > t ? 1 : 0;
  return mask;
}

/** A pixel is shadow when its brightness is under this share of the picture's mean brightness. */
export const SHADOW_SHARE = 0.55;
/**
 * Shadow pixels (transparent ones never): darker than SHADOW_SHARE of the picture's mean brightness. A crown casts a
 * shadow beside it and holds shadow inside it; a mown sward casts none, so shadow is a crown's witness where colour is
 * not (olive canopy against grass). Used by the planting layout's crown vote (layout/plantingLayout.ts, crownVote).
 */
export function shadowMask(px: PhotoPixels): Uint8Array {
  const n = px.width * px.height;
  const luma = new Float32Array(n);
  let sum = 0, m = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (px.rgba[o + 3] === 0) { luma[i] = -1; continue; }
    luma[i] = 0.299 * px.rgba[o] + 0.587 * px.rgba[o + 1] + 0.114 * px.rgba[o + 2];
    sum += luma[i]; m++;
  }
  const bar = m ? (SHADOW_SHARE * sum) / m : 0;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = luma[i] >= 0 && luma[i] < bar ? 1 : 0;
  return mask;
}

function finish(b: Pick<Blob, "n" | "sx" | "sy" | "sxx" | "syy" | "sxy">, extent?: number): Blob {
  const cx = b.sx / b.n, cy = b.sy / b.n;
  const vxx = b.sxx / b.n - cx * cx + 1 / 12, vyy = b.syy / b.n - cy * cy + 1 / 12, vxy = b.sxy / b.n - cx * cy;
  const tr = vxx + vyy, root = Math.sqrt(Math.max(0, (tr * tr) / 4 - (vxx * vyy - vxy * vxy)));
  const l1 = tr / 2 + root, l2 = Math.max(1e-9, tr / 2 - root);
  return { ...b, x: cx, y: cy, area: b.n, r: Math.max(extent ?? 0, Math.sqrt(b.n / Math.PI)), elong: Math.sqrt(l1 / l2) };
}

/**
 * 8-connected pieces of the mask, in frame pixels (the raster's own plus ox, oy). With `core`, only pieces
 * whose centre lies in the owned square [x0, x1) x [y0, y1) of the frame are returned.
 */
export function piecesOf(mask: Uint8Array, w: number, h: number, ox = 0, oy = 0, core?: { x0: number; y0: number; x1: number; y1: number }, minPx = 1): Blob[] {
  const seen = new Uint8Array(w * h);
  const out: Blob[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    seen[s] = 1; stack.push(s);
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i - x) / w;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (n < minPx) continue;
    const cx = sx / n + ox, cy = sy / n + oy;
    if (core && (cx < core.x0 || cx >= core.x1 || cy < core.y0 || cy >= core.y1)) continue;
    // The sums in frame pixels: sum (x + ox) = sx + n ox, sum (x + ox)^2 = sxx + 2 ox sx + n ox^2.
    out.push(finish({ n, sx: sx + n * ox, sy: sy + n * oy, sxx: sxx + 2 * ox * sx + n * ox * ox, syy: syy + 2 * oy * sy + n * oy * oy, sxy: sxy + ox * sy + oy * sx + n * ox * oy }));
  }
  return out;
}

/** Pieces closer than MERGE_GAP_M joined into plants (union-find on a grid); a joined plant's radius covers all its pieces. */
export function joinPieces(pieces: Blob[], mpp: number): Blob[] {
  const gap = MERGE_GAP_M / mpp;
  const parent = pieces.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const maxR = pieces.reduce((m, p) => Math.max(m, p.r), 0);
  const cell = Math.max(8, 2 * maxR + gap);
  const grid = new Map<string, number[]>();
  pieces.forEach((p, i) => { const k = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  pieces.forEach((p, i) => {
    const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const j of grid.get(`${gx + dx}:${gy + dy}`) ?? []) {
        if (j <= i) continue;
        const q = pieces[j];
        if (Math.hypot(p.x - q.x, p.y - q.y) - p.r - q.r <= gap) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
      }
    }
  });
  const groups = new Map<number, Blob[]>();
  pieces.forEach((p, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(p); });
  const out: Blob[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) { out.push(g[0]); continue; }
    const sum = g.reduce((a, p) => ({ n: a.n + p.n, sx: a.sx + p.sx, sy: a.sy + p.sy, sxx: a.sxx + p.sxx, syy: a.syy + p.syy, sxy: a.sxy + p.sxy }), { n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 });
    const cx = sum.sx / sum.n, cy = sum.sy / sum.n;
    out.push(finish(sum, Math.max(...g.map(p => Math.hypot(p.x - cx, p.y - cy) + p.r))));
  }
  return out;
}

/** The blobs that can be crop plants: compact and of plant size. */
export function plantCandidates(blobs: Blob[], mpp: number): Blob[] {
  const minPx = MIN_PLANT_AREA_M2 / (mpp * mpp), maxR = MAX_PLANT_RADIUS_M / mpp;
  return blobs.filter(b => b.area >= minPx && b.r <= maxR && b.elong <= MAX_PLANT_ELONGATION);
}

/** The plants of a raster: pieces, joined, candidates. */
export function plantsOfPixels(px: PhotoPixels, mpp: number): Blob[] {
  return plantCandidates(joinPieces(piecesOf(vegetationMask(px), px.width, px.height, 0, 0, undefined, Math.max(1, MIN_PIECE_M2 / (mpp * mpp))), mpp), mpp);
}

const median = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** The area-weighted median area: the size of the plant that carries half the green. */
function weightedMedianArea(c: Blob[]): number {
  const a = c.map(b => b.area).sort((x, y) => x - y);
  const half = a.reduce((s, v) => s + v, 0) / 2;
  let acc = 0;
  for (const v of a) { acc += v; if (acc >= half) return v; }
  return a[a.length - 1] ?? 0;
}

/** How strongly direction theta stacks the plants' area onto lines. */
function stacking(c: Blob[], theta: number, binPx: number): number {
  const nx = -Math.sin(theta), ny = Math.cos(theta);
  const bins = new Map<number, number>();
  for (const b of c) { const k = Math.floor((b.x * nx + b.y * ny) / binPx); bins.set(k, (bins.get(k) ?? 0) + b.area); }
  let s = 0;
  for (const a of bins.values()) s += a * a;
  return s;
}

function bestDirection(c: Blob[], mpp: number): { theta: number; score: number } {
  const binPx = 0.3 / mpp;
  let best = 0, bestS = -1;
  for (let d = 0; d < 180; d++) { const s = stacking(c, (d * Math.PI) / 180, binPx); if (s > bestS) { bestS = s; best = d; } }
  let theta = (best * Math.PI) / 180;
  for (let d = best - 1; d <= best + 1.001; d += 0.1) { const th = (d * Math.PI) / 180, s = stacking(c, th, binPx); if (s > bestS) { bestS = s; theta = th; } }
  return { theta, score: bestS };
}

type Chain = { members: Blob[]; step: number; offset: number; t0: number; t1: number };

/** A grid over the plants for neighbour queries. */
function gridOf(c: Blob[], cell: number): (i: number) => number[] {
  const grid = new Map<string, number[]>();
  c.forEach((p, i) => { const k = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  return (i: number) => {
    const p = c[i], gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell), out: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of grid.get(`${gx + dx}:${gy + dy}`) ?? []) if (j !== i) out.push(j);
    return out;
  };
}

/** The typical gap between neighbouring plants along theta: each plant's nearest neighbour ahead within the link cone. */
function typicalGap(c: Blob[], theta: number, mpp: number): number {
  const ux = Math.cos(theta), uy = Math.sin(theta);
  const tan = Math.tan((LINK_ANGLE_DEG * Math.PI) / 180);
  // Neighbours within 15 m: a wider cell only makes the query slower.
  const near = gridOf(c, 15 / mpp);
  const d: number[] = [];
  c.forEach((p, i) => {
    let best = Infinity;
    for (const j of near(i)) {
      const q = c[j];
      const along = (q.x - p.x) * ux + (q.y - p.y) * uy;
      if (along <= 0) continue;
      const across = Math.abs(-(q.x - p.x) * uy + (q.y - p.y) * ux);
      if (across <= tan * along && along < best) best = along;
    }
    if (best < Infinity) d.push(best);
  });
  return median(d);
}

/** Plants linked into chains along theta: each to its best plant ahead, kept when that plant's best behind is it. */
function chainsOf(c: Blob[], theta: number, step0: number): Blob[][] {
  const ux = Math.cos(theta), uy = Math.sin(theta);
  const tan = Math.tan((LINK_ANGLE_DEG * Math.PI) / 180);
  const near = gridOf(c, Math.max(4, step0 * LINK_MAX_GAPS));
  // The cost of a link: how far from a whole number of gaps it lands, how far sideways, and how many gaps it skips.
  const cost = (i: number, j: number, dir: 1 | -1): number => {
    const p = c[i], q = c[j];
    const along = dir * ((q.x - p.x) * ux + (q.y - p.y) * uy);
    if (along < 0.4 * step0 || along > LINK_MAX_GAPS * step0) return Infinity;
    const across = Math.abs(-(q.x - p.x) * uy + (q.y - p.y) * ux);
    if (across > Math.max(LINK_ACROSS_SHARE * step0, tan * along)) return Infinity;
    const k = Math.max(1, Math.round(along / step0));
    return Math.abs(along - k * step0) / step0 + across / step0 + 0.35 * (k - 1);
  };
  const best = (i: number, dir: 1 | -1) => { let b = -1, bc = Infinity; for (const j of near(i)) { const v = cost(i, j, dir); if (v < bc) { bc = v; b = j; } } return b; };
  const ahead = c.map((_, i) => best(i, 1)), behind = c.map((_, i) => best(i, -1));
  const next = c.map((_, i) => (ahead[i] >= 0 && behind[ahead[i]] === i ? ahead[i] : -1));
  const hasPrev = new Set(next.filter(j => j >= 0));
  const chains: Blob[][] = [];
  c.forEach((_, i) => {
    if (hasPrev.has(i)) return;
    const chain: Blob[] = [];
    for (let k = i, guard = 0; k >= 0 && guard <= c.length; k = next[k], guard++) chain.push(c[k]);
    chains.push(chain);
  });
  return chains;
}

/** A chain checked along: plants that split a gap into two wrong ones dropped, then its spacing and how many gaps are whole. */
function checkAlong(members: Blob[], theta: number, step0: number): { members: Blob[]; step: number; whole: number } {
  const ux = Math.cos(theta), uy = Math.sin(theta);
  let m = [...members];
  const tOf = (b: Blob) => b.x * ux + b.y * uy;
  const isWhole = (g: number, s: number) => { const k = Math.round(g / s); return k >= 1 && k <= 3 && Math.abs(g - k * s) <= GAP_TOL * s; };
  let step = step0;
  for (let pass = 0; pass < 3; pass++) {
    const gaps = m.slice(1).map((b, i) => tOf(b) - tOf(m[i]));
    const singles = gaps.filter(g => g <= 1.5 * step0 && g >= 0.5 * step0);
    step = singles.length ? median(singles) : step0;
    // Between plants: both neighbouring gaps wrong, their sum whole.
    const drop = new Set<number>();
    for (let i = 1; i < m.length - 1; i++) {
      const a = gaps[i - 1], b = gaps[i];
      if (!isWhole(a, step) && !isWhole(b, step) && isWhole(a + b, step) && !drop.has(i - 1)) drop.add(i);
    }
    if (!drop.size) break;
    m = m.filter((_, i) => !drop.has(i));
  }
  const gaps = m.slice(1).map((b, i) => tOf(b) - tOf(m[i]));
  const whole = gaps.length ? gaps.filter(g => isWhole(g, step)).length / gaps.length : 0;
  return { members: m, step, whole };
}

type Block = { rows: Chain[]; theta: number; spacing: number; step: number; band: number };

/** Each row's nearest neighbour on either side, among the rows beside it along the field. */
function neighbourGaps(rows: Chain[], slack: number): { left: number; right: number }[] {
  return rows.map(r => {
    let left = Infinity, right = Infinity;
    for (const q of rows) {
      if (q === r || q.t1 < r.t0 - slack || q.t0 > r.t1 + slack) continue;
      const d = q.offset - r.offset;
      if (d > 0 && d < right) right = d;
      if (d < 0 && -d < left) left = -d;
    }
    return { left, right };
  });
}

/** One planting's rows along theta, or null when they fail the spacing checks. */
function rowsAlong(c: Blob[], theta: number, mpp: number): Block | null {
  const step0 = typicalGap(c, theta, mpp);
  if (!(step0 > 0)) return null;
  const nx = -Math.sin(theta), ny = Math.cos(theta), ux = Math.cos(theta), uy = Math.sin(theta);
  let rows: Chain[] = [];
  for (const raw of chainsOf(c, theta, step0)) {
    if (raw.length < MIN_PLANTS_PER_ROW) continue;
    const a = checkAlong(raw, theta, step0);
    if (a.members.length < MIN_PLANTS_PER_ROW || a.whole < MIN_WHOLE_GAPS) continue;
    const ts = a.members.map(b => b.x * ux + b.y * uy);
    rows.push({ members: a.members, step: a.step, offset: median(a.members.map(b => b.x * nx + b.y * ny)), t0: Math.min(...ts), t1: Math.max(...ts) });
  }
  // One planting, one spacing along.
  const refStep = median(rows.map(r => r.step));
  rows = rows.filter(r => Math.abs(r.step - refStep) <= SEED_SPACING_TOL * refStep);
  if (rows.length < MIN_ROWS) return null;
  // Across: kept when a neighbour on either side is a whole number of row spacings away.
  for (let pass = 0; pass < 3; pass++) {
    const sides = neighbourGaps(rows, refStep);
    const spacing = median(sides.flatMap(s => [s.left, s.right]).filter(Number.isFinite));
    if (!(spacing > 0)) return null;
    const isWhole = (d: number) => { if (!Number.isFinite(d)) return false; const k = Math.round(d / spacing); return k >= 1 && k <= 2 && Math.abs(d - k * spacing) <= ROW_SPACING_TOL * spacing; };
    const kept = rows.filter((_, i) => isWhole(sides[i].left) || isWhole(sides[i].right));
    if (kept.length === rows.length) break;
    rows = kept;
    if (rows.length < MIN_ROWS) return null;
  }
  const spacing = median(neighbourGaps(rows, refStep).map(s => Math.min(s.left, s.right)).filter(Number.isFinite));
  if (spacing * mpp < MIN_ROW_SPACING_M) return null;
  // The rows explain their area: most of the crop-sized green within their extent is on them.
  const t0 = Math.min(...rows.map(r => r.t0)), t1 = Math.max(...rows.map(r => r.t1));
  const o0 = Math.min(...rows.map(r => r.offset)) - spacing / 2, o1 = Math.max(...rows.map(r => r.offset)) + spacing / 2;
  const inside = c.filter(b => { const t = b.x * ux + b.y * uy, o = b.x * nx + b.y * ny; return t >= t0 && t <= t1 && o >= o0 && o <= o1; });
  const members = new Set(rows.flatMap(r => r.members));
  const insideArea = inside.reduce((s, b) => s + b.area, 0), onArea = inside.filter(b => members.has(b)).reduce((s, b) => s + b.area, 0);
  if (!(insideArea > 0) || onArea < MIN_EXPLAINED_SHARE * insideArea) return null;
  const plantR = median(rows.flatMap(r => r.members.map(m => m.r)));
  const band = Math.min(Math.max(plantR, ROW_BAND_PITCH_SHARE * spacing), MAX_BAND_SHARE * spacing);
  return { rows, theta, spacing, step: refStep, band };
}

/** One planting among the plants: read along the best-stacking direction and a quarter turn from it; the rows are the way with the wider alleys. */
function readBlock(c: Blob[], mpp: number): Block | null {
  if (c.length < MIN_ROWS * MIN_PLANTS_PER_ROW) return null;
  const { theta } = bestDirection(c, mpp);
  const main = rowsAlong(c, theta, mpp);
  const other = rowsAlong(c, theta + Math.PI / 2, mpp);
  if (main && other) return other.spacing > main.spacing ? other : main;
  return main ?? other;
}

function distToSegment(px: number, py: number, l: { x1: number; y1: number; x2: number; y2: number }): number {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - l.x1) * dx + (py - l.y1) * dy) / len2)) : 0;
  return Math.hypot(px - (l.x1 + t * dx), py - (l.y1 + t * dy));
}

/** A row's line: through its own plants in order, and half a gap past each end. */
function rowLines(r: Chain, theta: number, band: number): RowContext["lines"] {
  const ux = Math.cos(theta), uy = Math.sin(theta);
  const m = [...r.members].sort((a, b) => (a.x * ux + a.y * uy) - (b.x * ux + b.y * uy));
  const lines: RowContext["lines"] = [];
  for (let i = 1; i < m.length; i++) lines.push({ x1: m[i - 1].x, y1: m[i - 1].y, x2: m[i].x, y2: m[i].y, band });
  const h = r.step / 2, a = m[0], z = m[m.length - 1];
  lines.push({ x1: a.x - h * ux, y1: a.y - h * uy, x2: a.x, y2: a.y, band });
  lines.push({ x1: z.x, y1: z.y, x2: z.x + h * ux, y2: z.y + h * uy, band });
  return lines;
}

type RowsResult = Omit<FieldRows, "z" | "left" | "top" | "mpp">;

/** The field's rows from its plants (frame pixels), or null when no evenly spaced rows of evenly spaced plants are there. */
export function fieldRowsFromPlants(plants: Blob[], mpp: number): RowsResult | null {
  const ref = weightedMedianArea(plants);
  let left = plants.filter(b => b.area >= MIN_ROW_SIZE_SHARE * ref);
  const total = left.reduce((s, b) => s + b.area, 0);
  const blocks: Block[] = [];
  for (let k = 0; k < MAX_BLOCKS; k++) {
    const b = readBlock(left, mpp);
    if (!b) break;
    blocks.push(b);
    const lines = b.rows.flatMap(r => rowLines(r, b.theta, b.band));
    const members = new Set(b.rows.flatMap(r => r.members));
    left = left.filter(p => !members.has(p) && !lines.some(l => distToSegment(p.x, p.y, l) <= b.band));
    if (left.reduce((s, p) => s + p.area, 0) < MIN_LEFTOVER_SHARE * total) break;
  }
  if (!blocks.length) return null;
  const main = blocks.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));
  const lines = blocks.flatMap(b => b.rows.flatMap(r => rowLines(r, b.theta, b.band)));
  const crops = blocks.flatMap(b => b.rows.flatMap(r => r.members.map(m => ({ x: m.x, y: m.y, r: m.r }))));
  return {
    ctx: { lines, crops, bandPx: main.band, gsdM: mpp },
    rows: blocks.reduce((s, b) => s + b.rows.length, 0),
    spacingM: main.spacing * mpp, seedSpacingM: main.step * mpp,
    directionDeg: (((main.theta * 180) / Math.PI) % 180 + 180) % 180,
    blocks: blocks.length,
  };
}

/** The field's rows from one raster's pixels. */
export function fieldRowsFromPixels(px: PhotoPixels, mpp: number): RowsResult | null {
  return fieldRowsFromPlants(plantsOfPixels(px, mpp), mpp);
}

/** Where a place stands against the field's rows. */
export function fieldRowStatusAt(rows: FieldRows, p: LatLng2): RowStatus {
  const [X, Y] = mercatorPx(p.lat, p.lng, rows.z);
  return rowStatusOf(rows.ctx, X - rows.left, Y - rows.top);
}

/** How the field is read: the zoom whose pixel is nearest READ_MPP (not finer than the map has), the extent, and the tiles. */
export function fieldReadPlan(rings: LatLng2[][], maxNative: number, lat: number): { z: number; left: number; top: number; width: number; height: number; mpp: number; tiles: { x0: number; y0: number; x1: number; y1: number }[] } | null {
  const pts = rings.flat();
  if (!pts.length) return null;
  let z = Math.min(Math.floor(maxNative), 23);
  while (z > 14 && metresPerPixel(lat, z) * 1.4 < READ_MPP) z--;
  const p = pts.map(q => mercatorPx(q.lat, q.lng, z));
  const xs = p.map(v => v[0]), ys = p.map(v => v[1]);
  const left = Math.floor(Math.min(...xs)), top = Math.floor(Math.min(...ys));
  const width = Math.ceil(Math.max(...xs)) - left, height = Math.ceil(Math.max(...ys)) - top;
  if (width < 8 || height < 8) return null;
  const tiles: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let y0 = 0; y0 < height; y0 += READ_TILE_PX) for (let x0 = 0; x0 < width; x0 += READ_TILE_PX) tiles.push({ x0, y0, x1: Math.min(width, x0 + READ_TILE_PX), y1: Math.min(height, y0 + READ_TILE_PX) });
  return { z, left, top, width, height, mpp: metresPerPixel(lat, z), tiles };
}

/** The field's rows, read from the map's tiles; null when the browser cannot draw or no rows were found. */
export async function readFieldRows(input: { rings: LatLng2[][]; tile: (z: number, x: number, y: number) => string; maxNative: number; lat: number; onProgress?: (fraction: number) => void; signal?: AbortSignal }): Promise<FieldRows | null> {
  const plan = fieldReadPlan(input.rings, input.maxNative, input.lat);
  if (!plan || typeof createImageBitmap === "undefined") return null;
  const { z, mpp } = plan;
  const minPx = Math.max(1, MIN_PIECE_M2 / (mpp * mpp));
  const pieces: Blob[] = [];
  for (let i = 0; i < plan.tiles.length; i++) {
    if (input.signal?.aborted) return null;
    const t = plan.tiles[i];
    // The owned square plus the overlap, in global map pixels.
    const gx = plan.left + t.x0 - READ_OVERLAP_PX, gy = plan.top + t.y0 - READ_OVERLAP_PX;
    const w = t.x1 - t.x0 + 2 * READ_OVERLAP_PX, h = t.y1 - t.y0 + 2 * READ_OVERLAP_PX;
    const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = (canvas as HTMLCanvasElement).getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    if (!ctx) return null;
    const jobs: Promise<void>[] = [];
    for (let ty = Math.floor(gy / TILE_PX); ty <= Math.floor((gy + h - 1) / TILE_PX); ty++) {
      for (let tx = Math.floor(gx / TILE_PX); tx <= Math.floor((gx + w - 1) / TILE_PX); tx++) {
        jobs.push(fetchTileCached(input.tile(z, tx, ty), { signal: input.signal })
          .then(b => createImageBitmap(b))
          .then(bmp => { ctx.drawImage(bmp, tx * TILE_PX - gx, ty * TILE_PX - gy); bmp.close?.(); })
          .catch(() => { /* a missing tile stays transparent */ }));
      }
    }
    await Promise.all(jobs);
    if (input.signal?.aborted) return null;
    const px: PhotoPixels = { width: w, height: h, rgba: ctx.getImageData(0, 0, w, h).data };
    // Pieces in frame pixels (the field's top-left is 0, 0), each kept by the tile whose own square holds its centre.
    pieces.push(...piecesOf(vegetationMask(px), w, h, t.x0 - READ_OVERLAP_PX, t.y0 - READ_OVERLAP_PX, t, minPx));
    input.onProgress?.((0.9 * (i + 1)) / plan.tiles.length);
    await new Promise(res => setTimeout(res, 0));
  }
  const fit = fieldRowsFromPlants(plantCandidates(joinPieces(pieces, mpp), mpp), mpp);
  return fit ? { ...fit, z, left: plan.left, top: plan.top, mpp } : null;
}
