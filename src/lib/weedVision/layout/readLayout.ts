// The planting layout on the real map: the field read into a coarse green
// raster (the row reader's own tiles and zoom), the operator's plantings
// (three points each) fitted on it, and the result as the field's rows.
//
// A planting is saved as three places on the ground: a plant, its neighbour
// along the row and a plant in the next row. After a fit they are replaced by
// the refined lattice's own three points, so the next scan of the field starts
// from the refined layout and needs no clicks.
import { type LatLng2 } from "../../geo";
import type { PhotoPixels } from "../../photoScout/pattern";
import { type FieldRows, fieldReadPlan, vegetationMask } from "../fieldRows";
import { latLngOfPx, mercatorPx } from "../mapRun";
import { drawMapRect } from "../twoStage/stage1";
import { type FittedLayout, type Lattice, type LayoutRaster, boxMean, fillPolygon, fitLayoutAll, latticeFromClicks, latticeIndex, latticePoint, layoutsToFieldRows, mergeLayouts } from "./plantingLayout";

export type LayoutBlock = { points: [LatLng2, LatLng2, LatLng2] };
/** The operator's word on one expected position: a crop there, or none. */
export type PositionVerdict = { lat: number; lng: number; crop: boolean; at?: string };
export type PlantingLayout = { version: 1; blocks: LayoutBlock[]; confirmedAt: string | null; verdicts?: PositionVerdict[] };

/** The field's rows from its planting layout, with what the layout says about the field. */
/** A fit this thin is not trusted as the planting: fewer rows or a lower share of the expected plants found. */
export const MIN_TRUSTED_ROWS = 3, MIN_TRUSTED_FOUND = 0.6;

export type LayoutRows = FieldRows & {
  source: "layout";
  gaps: { x: number; y: number }[];
  /** Tree-sized green on no row: a row or a planting the layout does not cover yet. */
  unexplained: { x: number; y: number; r: number }[];
};

/** Raster pixels per map metre target: 8 cm, coarse enough for a large field, fine enough for a young tree's crown. */
export const LAYOUT_MPP = 0.08;

/** The field read into a layout raster. `draw` stands in for the browser in tests. */
export async function readLayoutRaster(input: {
  rings: LatLng2[][]; tile: (z: number, x: number, y: number) => string; maxNative: number; lat: number;
  onProgress?: (f: number) => void; signal?: AbortSignal; draw?: (tile: (z: number, x: number, y: number) => string, z: number, gx: number, gy: number, w: number, h: number, signal?: AbortSignal) => Promise<PhotoPixels | null>;
}): Promise<LayoutRaster | null> {
  const plan = fieldReadPlan(input.rings, input.maxNative, input.lat);
  if (!plan) return null;
  const k = Math.max(1, Math.round(LAYOUT_MPP / plan.mpp));
  const w = Math.ceil(plan.width / k), h = Math.ceil(plan.height / k);
  const sum = new Uint32Array(w * h), cnt = new Uint32Array(w * h);
  const draw = input.draw ?? drawMapRect;
  for (let n = 0; n < plan.tiles.length; n++) {
    if (input.signal?.aborted) return null;
    const t = plan.tiles[n];
    const tw = t.x1 - t.x0, th = t.y1 - t.y0;
    const px = await draw(input.tile, plan.z, plan.left + t.x0, plan.top + t.y0, tw, th, input.signal);
    if (px) {
      const m = vegetationMask(px);
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        if (px.rgba[(y * tw + x) * 4 + 3] === 0) continue;
        const c = Math.floor((t.y0 + y) / k) * w + Math.floor((t.x0 + x) / k);
        cnt[c]++; sum[c] += m[y * tw + x];
      }
    }
    input.onProgress?.((n + 1) / plan.tiles.length);
    await new Promise(res => setTimeout(res, 0));
  }
  const green = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) green[i] = cnt[i] ? Math.round((255 * sum[i]) / cnt[i]) : 0;
  const inField = new Uint8Array(w * h);
  for (const ring of input.rings) fillPolygon(inField, w, h, ring.map(q => { const [X, Y] = mercatorPx(q.lat, q.lng, plan.z); return [(X - plan.left) / k, (Y - plan.top) / k] as [number, number]; }));
  return { z: plan.z, left: plan.left, top: plan.top, scale: k, mpp: plan.mpp * k, w, h, green, inField };
}

const toRaster = (r: LayoutRaster, q: LatLng2): [number, number] => { const [X, Y] = mercatorPx(q.lat, q.lng, r.z); return [(X - r.left) / r.scale, (Y - r.top) / r.scale]; };
const toLatLng = (r: LayoutRaster, x: number, y: number): LatLng2 => latLngOfPx(r.left + x * r.scale, r.top + y * r.scale, r.z);

/** Tree-sized green blobs (crown-scale green over half) with no row line within the band: what the layout does not cover. */
export function unexplainedGreen(r: LayoutRaster, rows: FieldRows, fits: FittedLayout[]): { x: number; y: number; r: number }[] {
  if (!fits.length || !rows.ctx.crops.length) return [];
  const along = fits.reduce((a, f) => a + f.lattice.along, 0) / fits.length;
  const G = boxMean(r, 0.15 * along);
  const radii = rows.ctx.crops.map(c => c.r / r.scale).sort((a, b) => a - b);
  const crownR = Math.max(2, radii[radii.length >> 1]);
  const minArea = 0.5 * Math.PI * crownR * crownR;
  const seen = new Uint8Array(r.w * r.h);
  const out: { x: number; y: number; r: number }[] = [];
  const near = (x: number, y: number) => rows.ctx.lines.some(l => {
    const ax = l.x1 / r.scale, ay = l.y1 / r.scale, bx = l.x2 / r.scale, by = l.y2 / r.scale, b = (l.band ?? rows.ctx.bandPx) / r.scale;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= b + crownR;
  });
  for (let s = 0; s < r.w * r.h; s++) {
    if (seen[s] || G[s] < 0.5 || !r.inField[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let n = 0, sx = 0, sy = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % r.w, y = (i - x) / r.w;
      n++; sx += x; sy += y;
      for (const j of [i - 1, i + 1, i - r.w, i + r.w]) {
        if (j < 0 || j >= r.w * r.h || seen[j] || G[j] < 0.5) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === r.w - 1)) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    if (n < minArea) continue;
    const cx = sx / n, cy = sy / n;
    if (near(cx, cy)) continue;
    out.push({ x: cx * r.scale, y: cy * r.scale, r: Math.sqrt(n / Math.PI) * r.scale });
  }
  return out;
}

/** The plantings fitted on the raster; the rows (or null when none grew) and the plantings refined, to be saved. */
/**
 * Two sets of clicks describe the same planting when their lattices agree in direction and plant spacing, and their
 * row pitches are the same or one is half the other (the operator marked an interplanted row, whose next row is at
 * half the pitch). The planting is then fitted on the finer pitch, so every marked tree lands on its own row.
 */
function sameLattice(a: Lattice, b: Lattice): boolean {
  let turn = Math.abs(a.angle - b.angle) % Math.PI;
  if (turn > Math.PI / 2) turn = Math.PI - turn;
  const ratio = Math.abs(a.across) / Math.abs(b.across);
  const pitchOk = [1, 2, 0.5].some(k => Math.abs(ratio - k) < 0.15 * k);
  return turn < (5 * Math.PI) / 180 && Math.abs(a.along - b.along) < 0.15 * a.along && pitchOk;
}

export function fitPlantingLayout(r: LayoutRaster, layout: PlantingLayout): { rows: LayoutRows | null; blocks: LayoutBlock[]; fits: FittedLayout[]; reason: string | null } {
  const fits: FittedLayout[] = [];
  const blocks: LayoutBlock[] = [];
  // Clicks on the same planting (a row it missed, say) are its anchors, not a planting of their own.
  const groups: { L0: Lattice; clicks: [number, number][]; blocks: LayoutBlock[] }[] = [];
  let bad = 0;
  for (const b of layout.blocks) {
    const pts = b.points.map(q => toRaster(r, q));
    const L0 = latticeFromClicks(pts[0], pts[1], pts[2]);
    if (!L0) { bad++; continue; }
    const g = groups.find(x => sameLattice(x.L0, L0));
    if (g) { g.clicks.push(...pts); g.blocks.push(b); if (Math.abs(L0.across) < 0.75 * Math.abs(g.L0.across)) g.L0 = L0; } else groups.push({ L0, clicks: pts, blocks: [b] });
  }
  // Each verdict goes with the planting whose lattice it sits nearest to.
  const verdictsOf = new Map<number, { x: number; y: number; crop: boolean }[]>();
  for (const v of layout.verdicts ?? []) {
    const [x, y] = toRaster(r, v);
    let best = -1, bestD = Infinity;
    groups.forEach((grp, n) => { const [i, j] = latticeIndex(grp.L0, x, y); const [px, py] = latticePoint(grp.L0, i, j); const dd = Math.hypot(px - x, py - y); if (dd < bestD) { bestD = dd; best = n; } });
    if (best >= 0) (verdictsOf.get(best) ?? verdictsOf.set(best, []).get(best)!).push({ x, y, crop: v.crop });
  }
  for (const [n, grp] of groups.entries()) {
    const all = fitLayoutAll(grp.L0, r, grp.clicks, undefined, verdictsOf.get(n) ?? []);
    const f = all[0];
    fits.push(...all);
    for (const b of grp.blocks) {
    // Saved as the refined lattice's own points near the original first click.
    const ij = (() => {
      const { lattice: L } = f;
      const ux = Math.cos(L.angle), uy = Math.sin(L.angle), nx = -uy, ny = ux;
      const e1 = [L.along * ux, L.along * uy], e2 = [L.across * nx + L.stagger * ux, L.across * ny + L.stagger * uy];
      const det = e1[0] * e2[1] - e1[1] * e2[0];
      const [x, y] = toRaster(r, b.points[0]);
      const dx = x - L.ox, dy = y - L.oy;
      return [Math.round((dx * e2[1] - dy * e2[0]) / det), Math.round((e1[0] * dy - e1[1] * dx) / det)];
    })();
    const p0 = latticePoint(f.lattice, ij[0], ij[1]), p1 = latticePoint(f.lattice, ij[0] + 1, ij[1]), p2 = latticePoint(f.lattice, ij[0], ij[1] + 1);
    blocks.push({ points: [toLatLng(r, ...p0), toLatLng(r, ...p1), toLatLng(r, ...p2)] });
    }
  }
  const merged = mergeLayouts(fits);
  const base = layoutsToFieldRows(fits, r);
  const why = !layout.blocks.length ? "no trees marked" : bad === layout.blocks.length ? "the third tree of each marking must be in the next row, not the same one"
    : !base ? "no row grew from the marked trees: the three trees must be a tree, its neighbour in the same row, and a tree in the next row" : null;
  if (!base) return { rows: null, blocks, fits: merged, reason: why };
  return { rows: { ...base, unexplained: unexplainedGreen(r, base, merged) }, blocks, fits: merged, reason: bad ? `${bad} marking${bad === 1 ? " was" : "s were"} skipped: the third tree must be in the next row` : null };
}

/** A planting proposed from rows the reader found: two neighbouring plants on one row and the nearest plant on another. */
export function proposeFromRows(rows: FieldRows): LayoutBlock | null {
  const crops = rows.ctx.crops;
  if (crops.length < 3 || !(rows.seedSpacingM > 0)) return null;
  const step = rows.seedSpacingM / rows.mpp, across = rows.spacingM / rows.mpp;
  const th = (rows.directionDeg * Math.PI) / 180, ux = Math.cos(th), uy = Math.sin(th);
  const cx = crops.reduce((a, c) => a + c.x, 0) / crops.length, cy = crops.reduce((a, c) => a + c.y, 0) / crops.length;
  const sorted = [...crops].sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  for (const a of sorted.slice(0, 20)) {
    const b = crops.find(c => { const d = Math.hypot(c.x - a.x, c.y - a.y), al = Math.abs((c.x - a.x) * ux + (c.y - a.y) * uy); return Math.abs(d - step) < 0.3 * step && al > 0.9 * d; });
    if (!b) continue;
    // The nearest plant in the next row: one row spacing across (within a fifth), at most half a plant spacing along.
    const c = crops
      .filter(q => { const ac = Math.abs(-(q.x - a.x) * uy + (q.y - a.y) * ux), al = Math.abs((q.x - a.x) * ux + (q.y - a.y) * uy); return Math.abs(ac - across) < 0.2 * across && al <= 0.5 * step; })
      .sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0];
    if (!c) continue;
    const ll = (x: number, y: number) => latLngOfPx(rows.left + x, rows.top + y, rows.z);
    return { points: [ll(a.x, a.y), ll(b.x, b.y), ll(c.x, c.y)] };
  }
  return null;
}
