// The field's planting layout: where every crop plant is supposed to stand.
//
// An orchard (or a vineyard, or any crop planted on a grid) is a lattice: rows
// a fixed distance apart, plants a fixed distance apart along each row. The
// row reader (fieldRows.ts) builds rows plant by plant from green blobs, and on
// real orchards that breaks where weeds touch the crowns and merge with them
// (2 of 5 orchard frames read no rows at all, 2026-10-19). This module instead
// takes the lattice as known, from the operator's three clicks (two
// neighbouring plants in one row, one in the next row) or from a proposal they
// accept, refines it against the whole field at once (hundreds of plants vote,
// so one merged clump or a missing tree cannot move it), and then walks every
// row plant by plant, following a row that drifts, to find each plant where it
// actually stands, how big its crown is, or that it is missing.
//
// What comes out is the app's FieldRows (lines, crop plants, band), so every
// consumer of the rows (the between-rows filter, Stage 1, the model runs that
// only look between the rows) uses it unchanged, plus the gaps. Pure: a raster
// in, a layout out; reading the map is layout/readLayout.ts.
import type { FieldRows } from "../fieldRows";
import { ROW_BAND_PITCH_SHARE } from "../rowFilter";

/** The field's green on a coarse grid. Global pixel at zoom z of raster pixel (x, y) is (left + x * scale, top + y * scale). */
export type LayoutRaster = {
  z: number; left: number; top: number; scale: number;
  /** Metres per raster pixel. */
  mpp: number;
  w: number; h: number;
  /** Green share of each raster pixel, 0 to 255. */
  green: Uint8Array;
  /** 1 inside the field. */
  inField: Uint8Array;
};

/** A lattice in raster pixels: plant (i, j) stands at o + i * along * u + j * (across * n + stagger * u), u at `angle`, n a quarter turn on. */
export type Lattice = { ox: number; oy: number; angle: number; along: number; across: number; stagger: number };

/**
 * What the evidence says about a plant at an expected position. The position itself proves nothing: a cultivated
 * tree, a young tree, a weed and a merged tangle can all stand there.
 *   confirmed  crown green at or over the planting's bar, a canopy of the planting's size, its edge found
 *   probable   green there, but small (a young tree, or a weed) or under the planting's bar
 *   ambiguous  the green did not end before the canopy cap: a crown merged with weeds or a neighbour
 *   operator   the operator said "crop"
 */
export type PlantState = "confirmed" | "probable" | "ambiguous" | "operator";
export type LayoutPlant = {
  x: number; y: number;
  /** Canopy radius, raster px: where the crown's edge was seen along most rays out of its centre, never past the planting's reach (canopyOf). The ring drawn. */
  r: number;
  /** The radius painted over for the model, raster px: the canopy, or the planting's typical one when the canopy merged with other green (so weeds in the tangle stay in view). Never more than r. */
  paint: number;
  row: number; i: number; /** The stretch of its row it belongs to. */ run: number; state: PlantState; /** Crown-scale green at the plant. */ g: number; /** Most rays out of the centre found no edge before the reach: the crown runs into weeds or a neighbour. */ merged: boolean;
};
/** An expected position with no plant placed: no visible evidence, some green under the bar, or the operator's "no crop". */
export type LayoutGap = { x: number; y: number; row: number; i: number; evidence: "none" | "some" | "operator"; g: number };

export type FittedLayout = {
  lattice: Lattice;
  /** The field's row spacing when rows were found between this lattice's rows: |across| / k. Else |across|. */
  rowPitch?: number;
  plants: LayoutPlant[];
  gaps: LayoutGap[];
  rows: number;
  /** Mean crown-scale green at the refined lattice's points: how well the lattice sits on the plants (0 to 1). */
  score: number;
  /** Share of the expected positions inside the rows' extent where a plant was found. */
  foundShare: number;
};

/** Bumped when the fitter changes, so rows read under an older fitter are read again. */
export const LAYOUT_VERSION = 3;

export const LAYOUT_PARAMS = {
  /** Crown-scale smoothing radius, as a share of the plant spacing. */
  crownShare: 0.2,
  /** Search around an expected position, as shares of the plant spacing (along) and the row spacing (across). */
  searchAlong: 0.3, searchAcross: 0.22,
  /**
   * Presence is judged at crown scale, in a box of this half-width (metres), not at the spacing's scale: a young 0.5 m
   * crown fills a fifth of a 1.4 m box and dropped out, which is how every second row of an orchard with alternating
   * younger rows was skipped (2026-10-19). A plant is there when that box is at least presentGreen green.
   */
  presenceRadiusM: 0.3,
  presentGreen: 0.3,
  /** The presence bar never goes under this, however pale the clicked plants. */
  anchorFloor: 0.08,
  /**
   * A plant is questioned ("probable") only when there is just a little green: a canopy under this share of the
   * planting's typical one, or crown-scale green under tinyGreen. Everything else green at its place is a crop; a
   * canopy that runs into other green is still a crop, only its extent is uncertain (merged).
   */
  tinyCrownShare: 0.5, tinyGreen: 0.15,
  /** A plant is re-centred on the green mass within this share of the plant spacing of its first estimate (nearer green weighing more), so the ring sits on the crown, not on the lattice point... */
  recentreShare: 0.35,
  /** ...and moves at most this far, metres: the verge weeds beside an edge row pulled its trees a metre sideways and the row failed the straightness test (DJI_0327). */
  recentreMaxM: 0.5,
  /** A plant the operator marks is looked for this far around the mark (metres): the mark may be on an expected position the tree stands beside. */
  anchorSearchM: 1.0,
  /** A finer spacing is taken when at least this share of its added positions hold a plant... */
  subdivideShare: 0.5,
  /** ...and the ground beside those plants (between the rows, or between plants when they stand apart) is less than this share as green. */
  alleyContrast: 0.6,
  /**
   * A row with no plant at all is stepped over this many times: the next row at the field's spacing is still looked
   * for (two: a block of young trees planted out of step with the lattice between two old blocks, or a track with a
   * verge, is two rows wide; what is found beyond must prove itself as a bridged stretch).
   */
  maxMissingRows: 2,
  /**
   * A stretch of row reached only by stepping over an empty row, or by the sweep, is not joined to the clicked planting:
   * across a track it may be another block whose trees happen to line up (two such rows on DJI_0320 and DJI_0327). It
   * stands only with at least this many plants, sitting on the layout's own line within these shares of the spacings.
   */
  bridgedMinPlants: 6, bridgedAcrossShare: 0.08, bridgedAlongShare: 0.15,
  /** ...and with crowns between these shares of the planting's typical crown: across a track, the edge row of a strip crop lines up but its plants are a third the size. */
  bridgedCrownMin: 0.5, bridgedCrownMax: 2,
  /**
   * Between two found rows, or two found plants on a row, the green is rows and plants until proven otherwise: the
   * gap is scanned for row lines (peaks of the green profile across) and plants (peaks along), with thresholds set
   * from what the found rows and plants read on this field, at these shares, never below the floors.
   */
  interiorRowShare: 0.15, interiorRowFloor: 0.05, interiorPlantShare: 0.25, interiorPlantFloor: 0.12,
  /** A peak counts only when it stands this many times above the lowest point between it and the next peak either side: a young row reads a fifth of an old one, a weedy alley has no valleys. */
  interiorProminence: 2,
  /** Row lines closer than this share of the row spacing are one row; plants closer than this share of the plant spacing are one plant. */
  interiorRowSeparation: 0.35, interiorPlantSeparation: 0.5,
  /** How much of the last plant's offset carries to the next expected position (a drifting row is followed). */
  driftKeep: 0.6,
  /** A row stands with at least this many plants... */
  minPlants: 3,
  /** ...found at this share of its expected positions between its first and last plant. */
  minRowShare: 0.4,
  /**
   * A crown ends where its ring of pixels is less green than this. Generous on purpose: a young, open crown is thin at
   * 8 cm a pixel, and a crown measured too small left its rim for the model to call a weed once the rows were painted
   * over (DJI_0301, 2026-10-19: rim detections 103 at 0.4, 44 at 0.12 against 33 unpainted; labelled weeds matched 217
   * either way; cost: 67 of 414 labelled weeds now inside the crop band, against 46 at 0.4).
   */
  crownEdgeGreen: 0.12,
  /**
   * The canopy is the green joined to the plant (raster green at least crownFillGreen) inside its cell: the ellipse of
   * the planting's half-spacings (half a spacing to the neighbour along the row, half a row spacing across, never more
   * than canopyReachShare of the smaller spacing). The plant is re-centred on that mass, at most crownMoveM from where
   * the search put it, and its ring encloses canopyPercentile of it. Before this (2026-10-19), the canopy was the
   * ring mean out of a centre that could stand on the crown's margin, and the ring sat beside the crown at the
   * planting's typical size.
   */
  crownFillGreen: 0.25, canopyPercentile: 0.95, canopyReachShare: 0.45, crownMoveM: 1.0,
  /** The canopy is "merged" when its green reaches the cell's edge in at least this share of canopyBins directions: a crown among weeds or against a neighbour; drawn dashed, painted over for the model at the planting's typical size. */
  canopyBins: 24, canopyMergedShare: 0.5,
  /** Second pass: a plant more than this share of the row spacing off its row's smoothed line jumped to a neighbour (a weed beside the tree)... */
  offLineShare: 0.08,
  /** ...and is looked for again in a strip this wide (share of the row spacing) and this long (share of the plant spacing) on the line. */
  reSearchAcross: 0.05, reSearchAlong: 0.15,
  /** The smoothed line: the median sideways offset of this many plants either side. */
  smoothPlants: 3,
  /** A row ends where two consecutive plants stop agreeing with the layout: the step between them turns more than this (degrees)... */
  segmentAngleDeg: 7,
  /** ...is off a whole number of plant spacings by more than this share... */
  segmentStepShare: 0.25,
  /** ...jumps sideways by more than this share of the row spacing... */
  segmentJumpShare: 0.1,
  /** ...or more than this many plants in a row are missing (the planting has ended). */
  segmentMaxMissing: 3,
  /** When the plants stand apart (soil between them), a row whose plants are joined by green all along is a strip, not plants. */
  stripShare: 0.6,
  /** A plant is accepted only this close to the layout (shares of the plant and row spacings), the layout re-fitted to the accepted plants as it grows. */
  maxOffAlong: 0.25, maxOffAcross: 0.15,
  /** Re-fit the layout to the accepted plants after this many more. */
  refitEvery: 30,
  /** A stretch of row stands when its own line runs within this many degrees of the layout... */
  runAngleDeg: 4,
  /** ...at least this share of its steps between neighbours is a whole number of plant spacings within runStepShare (0.35: plants are centred on their crowns, up to half a metre from their slots, so a step may be off by a metre)... */
  runRegularShare: 0.7, runStepShare: 0.35,
  /** ...and its plants sit within this share of the row spacing (root mean square) of its own line. */
  runLateralShare: 0.08,
};

// ---------------------------------------------------------------- the raster

/** Fill a polygon (even-odd, raster pixel coordinates) into a mask. */
export function fillPolygon(mask: Uint8Array, w: number, h: number, poly: [number, number][]): void {
  for (let y = 0; y < h; y++) {
    const yc = y + 0.5, xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[j];
      if ((y1 > yc) !== (y2 > yc)) xs.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(w - 1, Math.floor(xs[k + 1] - 0.5)); x++) mask[y * w + x] ^= 1;
    }
  }
}

/** The raster from a green mask (1 = green) at zoom z, frame origin (left, top), block-averaged by k. */
export function rasterFromMask(mask: Uint8Array, mw: number, mh: number, k: number, z: number, left: number, top: number, maskMpp: number, rings: [number, number][][]): LayoutRaster {
  const w = Math.ceil(mw / k), h = Math.ceil(mh / k);
  const sum = new Uint32Array(w * h), cnt = new Uint32Array(w * h);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) { const c = Math.floor(y / k) * w + Math.floor(x / k); cnt[c]++; sum[c] += mask[y * mw + x]; }
  const green = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) green[i] = cnt[i] ? Math.round((255 * sum[i]) / cnt[i]) : 0;
  const inField = new Uint8Array(w * h);
  // Rings arrive in global pixels at zoom z.
  for (const r of rings) fillPolygon(inField, w, h, r.map(([X, Y]) => [(X - left) / k, (Y - top) / k]));
  return { z, left, top, scale: k, mpp: maskMpp * k, w, h, green, inField };
}

/** Mean green (0 to 1) in the square of half-side r around each pixel, from an integral image. */
export function boxMean(r: LayoutRaster, rad: number): Float32Array {
  const { w, h, green } = r;
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += green[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  const out = new Float32Array(w * h);
  const R = Math.max(1, Math.round(rad));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
    const s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
    out[y * w + x] = s / ((x1 - x0) * (y1 - y0) * 255);
  }
  return out;
}

// ---------------------------------------------------------------- the lattice

export const basis = (L: Lattice) => {
  const ux = Math.cos(L.angle), uy = Math.sin(L.angle), nx = -uy, ny = ux;
  return { ux, uy, nx, ny, e1: [L.along * ux, L.along * uy] as const, e2: [L.across * nx + L.stagger * ux, L.across * ny + L.stagger * uy] as const };
};
export const latticePoint = (L: Lattice, i: number, j: number): [number, number] => {
  const { e1, e2 } = basis(L);
  return [L.ox + i * e1[0] + j * e2[0], L.oy + i * e1[1] + j * e2[1]];
};

/** The (i, j) range whose points can fall inside a w x h raster. */
function indexRange(L: Lattice, w: number, h: number): { i0: number; i1: number; j0: number; j1: number } {
  const { e1, e2 } = basis(L);
  const det = e1[0] * e2[1] - e1[1] * e2[0];
  const ij = (x: number, y: number) => { const dx = x - L.ox, dy = y - L.oy; return [(dx * e2[1] - dy * e2[0]) / det, (e1[0] * dy - e1[1] * dx) / det]; };
  const c = [ij(0, 0), ij(w, 0), ij(0, h), ij(w, h)];
  return { i0: Math.floor(Math.min(...c.map(q => q[0]))) - 1, i1: Math.ceil(Math.max(...c.map(q => q[0]))) + 1, j0: Math.floor(Math.min(...c.map(q => q[1]))) - 1, j1: Math.ceil(Math.max(...c.map(q => q[1]))) + 1 };
}

/** Mean crown-scale green at the lattice points inside the field, within `near` raster pixels of (cx, cy) when given. */
export function latticeScore(L: Lattice, G: Float32Array, r: LayoutRaster, near?: { cx: number; cy: number; radius: number }): number {
  const { i0, i1, j0, j1 } = indexRange(L, r.w, r.h);
  let s = 0, n = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const [x, y] = latticePoint(L, i, j);
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= r.w || yi >= r.h || !r.inField[yi * r.w + xi]) continue;
    if (near && Math.hypot(x - near.cx, y - near.cy) > near.radius) continue;
    s += G[yi * r.w + xi]; n++;
  }
  return n ? s / n : 0;
}

/** The lattice the three clicks describe (raster pixels): a and b neighbours in one row, c in the next row. */
export function latticeFromClicks(a: [number, number], b: [number, number], c: [number, number]): Lattice | null {
  const along = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(along > 0)) return null;
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
  const dx = c[0] - a[0], dy = c[1] - a[1];
  const across = dx * nx + dy * ny;
  if (Math.abs(across) < 0.25 * along) return null; // the third plant must be in another row
  const st = dx * ux + dy * uy;
  const stagger = ((st % along) + along) % along;
  return { ox: a[0], oy: a[1], angle, along, across, stagger };
}

/**
 * The lattice refined against the whole field: first which of the clicked distances are one spacing (a click may
 * skip a plant or a row), then angle, spacings, stagger and origin by coordinate descent on the mean crown-scale
 * green at the lattice points.
 */
export function refineLattice(L0: Lattice, G: Float32Array, r: LayoutRaster): { lattice: Lattice; score: number } {
  // Scored near the clicks (about 8 plants and 5 rows each way): a second planting elsewhere in the field must not pull it.
  const near = { cx: L0.ox, cy: L0.oy, radius: 8 * Math.max(L0.along, Math.abs(L0.across)) };
  const latticeScoreNear = (L: Lattice) => latticeScore(L, G, r, near);
  // The spacing the clicks gave is kept here (finer spacings are tested afterwards by subdividedLattices, on presence,
  // never on mean greenness: a lattice that skips every fainter row is greener on average and used to win).
  let L = L0, S = latticeScoreNear(L0);
  for (const scale of [1, 0.5, 0.25]) {
    const steps: [keyof Lattice, number][] = [
      ["angle", (0.5 * scale * Math.PI) / 180], ["along", 0.01 * scale * L.along], ["across", 0.01 * scale * Math.abs(L.across)],
      ["stagger", 0.04 * scale * L.along], ["ox", 0.04 * scale * L.along], ["oy", 0.04 * scale * L.along],
    ];
    for (let pass = 0; pass < 6; pass++) {
      let improved = false;
      for (const [k, d] of steps) {
        for (const dir of [1, -1]) {
          for (let n = 1; n <= 8; n++) {
            const cand = { ...L, [k]: (L[k] as number) + dir * d * n };
            const s = latticeScoreNear(cand);
            if (s > S + 1e-6) { L = cand; S = s; improved = true; } else break;
          }
        }
      }
      if (!improved) break;
    }
  }
  return { lattice: L, score: S };
}

// ---------------------------------------------------------------- the plants

/** The planting's reach around a plant: how far a canopy may be measured along the row (half the plant spacing) and across (half the row spacing), raster px, capped. */
export type CanopyReach = { along: number; across: number; angle: number };
export function canopyReach(L: Lattice): CanopyReach {
  const cap = LAYOUT_PARAMS.canopyReachShare * Math.min(L.along, Math.abs(L.across));
  return { along: Math.max(2, Math.min(cap, 0.5 * L.along)), across: Math.max(2, Math.min(cap, 0.5 * Math.abs(L.across))), angle: L.angle };
}

/**
 * The canopy around a plant: the green joined to it (raster green at least crownFillGreen, flood-filled from the plant,
 * or from the greenest pixel within presenceRadiusM when the plant stands on a pale one) inside its cell, the ellipse
 * of the planting's half-spacings around the expected position, so a neighbour's crown is cut off at the mid-plane.
 * The plant is re-centred on that mass (at most crownMoveM from where it stood: a crown stands beside its slot, and
 * the search box found only its margin), and the radius encloses canopyPercentile of it. Merged when the mass reaches
 * the cell's edge in at least canopyMergedShare of canopyBins directions: a crown among weeds or against a neighbour.
 */
export function canopyOf(r: LayoutRaster, x0: number, y0: number, reach: CanopyReach): { x: number; y: number; radius: number; merged: boolean } {
  const P = LAYOUT_PARAMS, fill = P.crownFillGreen * 255;
  const ca = Math.cos(reach.angle), sa = Math.sin(reach.angle);
  const capAt = (dx: number, dy: number) => { const al = dx * ca + dy * sa, ac = -dx * sa + dy * ca, d = Math.hypot(dx, dy); if (!d) return Math.min(reach.along, reach.across); const u = al / d, v = ac / d; return 1 / Math.sqrt((u * u) / (reach.along * reach.along) + (v * v) / (reach.across * reach.across)); };
  const g = (x: number, y: number) => (x < 0 || y < 0 || x >= r.w || y >= r.h ? -1 : r.green[y * r.w + x]);
  let sx = Math.round(x0), sy = Math.round(y0);
  if (g(sx, sy) < fill) {
    const R = Math.ceil(P.presenceRadiusM / r.mpp);
    let best = -1;
    for (let yy = sy - R; yy <= sy + R; yy++) for (let xx = sx - R; xx <= sx + R; xx++) { if (Math.hypot(xx - x0, yy - y0) > R) continue; const v = g(xx, yy); if (v > best) { best = v; sx = xx; sy = yy; } }
    if (best < fill) return { x: x0, y: y0, radius: 1, merged: false };
  }
  const seen = new Set<number>([sy * r.w + sx]), stack = [sy * r.w + sx], xs: number[] = [], ys: number[] = [];
  const hit = new Uint8Array(P.canopyBins);
  while (stack.length) {
    const idx = stack.pop()!, x = idx % r.w, y = (idx - x) / r.w, dx = x - x0, dy = y - y0;
    const cap = capAt(dx, dy), d = Math.hypot(dx, dy);
    if (d > cap || r.green[idx] < fill) continue;
    xs.push(x); ys.push(y);
    if (d >= cap - 1.5) hit[((Math.floor((Math.atan2(dy, dx) / (2 * Math.PI)) * P.canopyBins) % P.canopyBins) + P.canopyBins) % P.canopyBins] = 1;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= r.w || yy >= r.h) continue; const j = yy * r.w + xx; if (!seen.has(j)) { seen.add(j); stack.push(j); } }
  }
  let cx = xs.reduce((a, v) => a + v, 0) / xs.length, cy = ys.reduce((a, v) => a + v, 0) / ys.length;
  const maxPx = P.crownMoveM / r.mpp, moved = Math.hypot(cx - x0, cy - y0);
  if (moved > maxPx) { cx = x0 + ((cx - x0) * maxPx) / moved; cy = y0 + ((cy - y0) * maxPx) / moved; }
  const dists = xs.map((x, i) => Math.hypot(x - cx, ys[i] - cy)).sort((p, q) => p - q);
  const radius = Math.max(1, dists[Math.min(dists.length - 1, Math.floor(P.canopyPercentile * (dists.length - 1)))] + 0.5);
  let hits = 0; for (const h of hit) hits += h;
  return { x: cx, y: cy, radius, merged: hits / P.canopyBins >= P.canopyMergedShare };
}

const median = (v: number[]) => { const t = [...v].sort((a, b) => a - b); return t.length ? t[t.length >> 1] : 0; };

/**
 * The spacing is the field's strongest clue, and the true spacing is the finest one at which plants keep appearing:
 * the clicks may have skipped a plant along the row or a row across (the rows between may be younger, smaller trees).
 * Tested on presence at crown scale near the clicks, with the ground beside the added positions checked to be bare:
 * a weed strip along an alley is green all along, a row of plants is not. A finer spacing along changes the lattice;
 * rows found between the rows become lattices of their own (same spacing, offset by the found row and phase), so an
 * interplanted row that is not in step with its neighbours is still followed.
 */
export function subdividedLattices(L: Lattice, GF: Float32Array, r: LayoutRaster, near: { cx: number; cy: number; radius: number }, separate: boolean, presentGreen = LAYOUT_PARAMS.presentGreen): { main: Lattice; derived: Lattice[] } {
  const P = LAYOUT_PARAMS;
  const g = (x: number, y: number) => { const xi = Math.round(x), yi = Math.round(y); return xi < 0 || yi < 0 || xi >= r.w || yi >= r.h || !r.inField[yi * r.w + xi] ? -1 : GF[yi * r.w + xi]; };
  const inNear = (x: number, y: number) => Math.hypot(x - near.cx, y - near.cy) <= near.radius;
  const present = (x: number, y: number) => g(x, y) >= presentGreen;
  let main = L;
  // Along: a plant between every two plants that are there.
  {
    const { ux, uy } = basis(main);
    const iR = Math.ceil(near.radius / main.along) + 1, jR = Math.ceil(near.radius / Math.abs(main.across)) + 1;
    const on: number[] = [], beside: number[] = [];
    for (let j = -jR; j <= jR; j++) for (let i = -iR; i <= iR; i++) {
      const [x, y] = latticePoint(main, i + 0.5, j);
      if (!inNear(x, y)) continue;
      const [ax, ay] = latticePoint(main, i, j), [bx, by] = latticePoint(main, i + 1, j);
      if (!present(ax, ay) || !present(bx, by)) continue;
      const v = g(x, y);
      if (v < 0) continue;
      const q = 0.25 * main.along;
      on.push(v); beside.push(Math.max(g(x - q * ux, y - q * uy), g(x + q * ux, y + q * uy)));
    }
    const share = on.filter(v => v >= presentGreen).length / Math.max(1, on.length);
    if (on.length >= 6 && share >= P.subdivideShare && median(beside) < P.alleyContrast * median(on)) main = { ...main, along: main.along / 2, stagger: main.stagger % (main.along / 2) };
  }
  // Across: rows between two rows that are there, two or three per spacing; the finest that holds everywhere wins.
  const derived: Lattice[] = [];
  const { ux, uy, nx, ny, e2 } = basis(main);
  const iR = Math.ceil(near.radius / main.along) + 1, jR = Math.ceil(near.radius / Math.abs(main.across)) + 1;
  for (const k of [3, 2]) {
    const found: Lattice[] = [];
    for (let m = 1; m < k; m++) {
      let best: { lattice: Lattice; present: number } | null = null;
      for (let step = 0; step < 16; step++) {
        const phi = (step / 16 - 0.5) * main.along;
        const dx = (m / k) * e2[0] + phi * ux, dy = (m / k) * e2[1] + phi * uy;
        const on: number[] = [], alley: number[] = [], apart: number[] = [];
        const a = Math.abs(main.across) / (2 * k), h = main.along / 2;
        for (let j = -jR; j <= jR; j++) for (let i = -iR; i <= iR; i++) {
          const [lx, ly] = latticePoint(main, i, j);
          const x = lx + dx, y = ly + dy;
          if (!inNear(x, y)) continue;
          // Between two rows that are there: a plant on this row and one on the next, at this plant or its neighbours.
          const rowHas = (jj: number) => [-1, 0, 1].some(di => { const [qx, qy] = latticePoint(main, i + di, jj); return present(qx, qy); });
          if (!rowHas(j) || !rowHas(j + 1)) continue;
          const v = g(x, y);
          if (v < 0) continue;
          on.push(v);
          alley.push(Math.max(g(x + a * nx, y + a * ny), g(x - a * nx, y - a * ny)));
          apart.push(Math.max(g(x + h * ux, y + h * uy), g(x - h * ux, y - h * uy)));
        }
        if (on.length < 6) continue;
        const share = on.filter(v => v >= presentGreen).length / on.length;
        const mOn = median(on);
        if (share < P.subdivideShare || median(alley) >= P.alleyContrast * mOn || (separate && median(apart) >= P.alleyContrast * mOn)) continue;
        if (!best || share > best.present) best = { lattice: { ...main, ox: main.ox + dx, oy: main.oy + dy }, present: share };
      }
      if (!best) break;
      found.push(best.lattice);
    }
    if (found.length === k - 1) { derived.push(...found); break; }
  }
  return { main, derived };
}
/** The field's row spacing from a subdivision: the lattice's, divided by the rows found between. */
const rowPitchOf = (main: Lattice, derived: Lattice[]) => Math.abs(main.across) / (derived.length + 1);

/** Lattice positions near the origin that hold a plant, nearest first: where growth starts. */
export function seedsFor(L: Lattice, GF: Float32Array, r: LayoutRaster, near: { cx: number; cy: number; radius: number }, n = 3, presentGreen = LAYOUT_PARAMS.presentGreen): [number, number][] {
  const iR = Math.ceil(near.radius / L.along) + 1, jR = Math.ceil(near.radius / Math.abs(L.across)) + 1;
  const out: { i: number; j: number; d: number }[] = [];
  for (let j = -jR; j <= jR; j++) for (let i = -iR; i <= iR; i++) {
    const [x, y] = latticePoint(L, i, j);
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= r.w || yi >= r.h || !r.inField[yi * r.w + xi] || GF[yi * r.w + xi] < presentGreen) continue;
    out.push({ i, j, d: Math.hypot(x - L.ox, y - L.oy) });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, n).map(q => [q.i, q.j]);
}

/**
 * The planting grown from the clicked plants outward, neighbour by neighbour. A lattice position is looked at only
 * next to a plant already accepted; its expected place is the lattice point moved by its accepted neighbours' own
 * offsets (a drifting row is followed); a plant is accepted there when crown-scale green is present in a small box
 * and, for plants that stand apart, when there is soil between it and its neighbour along the row (a weed strip is
 * green all along). Missing plants are carried along a row up to segmentMaxMissing in a row and become gaps only
 * between plants. Growth stops where the planting stops: at a block edge, a track, another planting at another angle.
 */
/** The operator's clicked plants: lattice position and place, taken as plants whatever the green there. */
export type Anchor = { i: number; j: number; x: number; y: number };
/** `rowBar`: a lower presence bar for the rows the operator marked (by lattice row), the planting's own bar elsewhere. */
/** `trace`: the fate of every expected position looked at, by "i,j": accepted, or why not (audits). */
export type GrowOptions = { anchors?: Anchor[]; /** Positions the operator marked "no crop": never a plant, whatever grows there. */ noCrop?: Anchor[]; rowBar?: Map<number, number>; trace?: Map<string, string> };

export function growPlants(L0: Lattice, G: Float32Array, r: LayoutRaster, seeds: [number, number][], separate: boolean, opts: GrowOptions = {}): { plants: LayoutPlant[]; gaps: LayoutGap[]; rows: number; foundShare: number; lattice: Lattice } {
  const P = LAYOUT_PARAMS;
  const barOf = (j: number) => opts.rowBar?.get(j) ?? P.presentGreen;
  let L = L0;
  const { ux, uy, nx, ny } = basis(L0);
  const sa = P.reSearchAlong * 1.6 * L.along, sc = P.reSearchAcross * 2.5 * Math.abs(L.across);
  const reach = canopyReach(L);
  const key = (i: number, j: number) => `${i},${j}`;
  const plant = new Map<string, { x: number; y: number; g: number }>();
  const missing = new Map<string, number>(); // positions looked at and found empty, with how many empties in a row lead to them
  const resid = (i: number, j: number): [number, number] | null => {
    const q = plant.get(key(i, j));
    if (!q) return null;
    const [lx, ly] = latticePoint(L, i, j);
    return [q.x - lx, q.y - ly];
  };
  const note = (i: number, j: number, why: string) => { if (opts.trace && !opts.trace.get(key(i, j))?.startsWith("accepted")) opts.trace.set(key(i, j), why); };
  const noCrop = new Set((opts.noCrop ?? []).map(a => key(a.i, a.j)));
  /**
   * A plant re-centred on the green mass around its first estimate (the mean of the green within recentreShare of
   * the plant spacing, three times): the search box around the expected position clips a crown wider than the box
   * or off to one side, and the ring then sat on the lattice point rather than on the tree.
   */
  const recentre = (x0: number, y0: number): [number, number] => {
    const R = P.recentreShare * L.along;
    let x = x0, y = y0;
    for (let it = 0; it < 3; it++) {
      let sx = 0, sy = 0, sw = 0;
      const ya = Math.max(0, Math.floor(y - R)), yb = Math.min(r.h - 1, Math.ceil(y + R)), xa = Math.max(0, Math.floor(x - R)), xb = Math.min(r.w - 1, Math.ceil(x + R));
      for (let yy = ya; yy <= yb; yy++) for (let xx = xa; xx <= xb; xx++) {
        const dd = Math.hypot(xx - x, yy - y);
        if (dd > R) continue;
        const w = r.green[yy * r.w + xx] * (1 - dd / R); // the crown's own mass weighs most
        if (!w) continue;
        sx += xx * w; sy += yy * w; sw += w;
      }
      if (!sw) break;
      const nx2 = sx / sw, ny2 = sy / sw;
      const moved = Math.hypot(nx2 - x, ny2 - y);
      x = nx2; y = ny2;
      if (moved < 0.5) break;
    }
    // Never further from the first estimate than recentreMaxM: a neighbouring clump must not pull it away.
    const maxPx = P.recentreMaxM / r.mpp;
    const d = Math.hypot(x - x0, y - y0);
    if (d > maxPx) return [x0 + ((x - x0) * maxPx) / d, y0 + ((y - y0) * maxPx) / d];
    return [x, y];
  };
  const look = (i: number, j: number): { x: number; y: number; g: number; seen?: number } | null => {
    if (noCrop.has(key(i, j))) { const [lx, ly] = latticePoint(L, i, j); note(i, j, "operator: no crop here"); return { x: lx, y: ly, g: -1, seen: -2 }; }
    const [lx, ly] = latticePoint(L, i, j);
    const near: [number, number][] = [];
    for (const [di, dj] of [[-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [0, 1]]) { const v = resid(i + di, j + dj); if (v) near.push(v); }
    const ox = near.length ? near.reduce((a, v) => a + v[0], 0) / near.length : 0, oy = near.length ? near.reduce((a, v) => a + v[1], 0) / near.length : 0;
    const ex = lx + ox, ey = ly + oy;
    // An expected position just outside the field (within a third of the plant spacing) is still looked at: a tree at
    // the field's edge has its crown inside while its lattice point can fall outside (DJI_0301: three labelled trees
    // at the frame's edge were never examined).
    const inside = (x: number, y: number) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < r.w && yi < r.h && r.inField[yi * r.w + xi] === 1; };
    const reach = 0.33 * L.along;
    if (!inside(ex, ey) && ![[reach, 0], [-reach, 0], [0, reach], [0, -reach]].some(([a, c]) => inside(ex + a * ux + c * nx, ey + a * uy + c * ny))) { note(i, j, "outside the field"); return null; }
    // The greenest spot in the search box; a crown wider than the box is a plateau of equally green spots, so the
    // plant is put at the centre of the spots within a tenth of the best, not at the first of them.
    let bg = -1;
    const cells: [number, number, number][] = [];
    for (let a = -sa; a <= sa; a += 1) for (let c = -sc; c <= sc; c += 1) {
      const x = Math.round(ex + a * ux + c * nx), y = Math.round(ey + a * uy + c * ny);
      if (x < 0 || y < 0 || x >= r.w || y >= r.h) continue;
      const g = G[y * r.w + x];
      cells.push([x, y, g]);
      if (g > bg) bg = g;
    }
    if (bg < barOf(j)) { note(i, j, `not present: crown green ${bg.toFixed(2)} under the bar ${barOf(j).toFixed(2)}`); return { x: ex, y: ey, g: -1, seen: bg }; }
    let bx = 0, by = 0, bn = 0;
    for (const [x, y, g] of cells) if (g >= 0.9 * bg) { bx += x; by += y; bn++; }
    bx /= bn; by /= bn;
    [bx, by] = recentre(bx, by);
    // Close to the layout itself, not only to the neighbours: a row may not turn into another planting.
    const offA = (bx - lx) * ux + (by - ly) * uy, offC = (bx - lx) * nx + (by - ly) * ny;
    if (Math.abs(offA) > P.maxOffAlong * L.along || Math.abs(offC) > P.maxOffAcross * Math.abs(L.across)) { note(i, j, `off the layout: ${(offA * r.mpp).toFixed(2)} m along, ${(offC * r.mpp).toFixed(2)} m across (limits ${(P.maxOffAlong * L.along * r.mpp).toFixed(2)}, ${(P.maxOffAcross * Math.abs(L.across) * r.mpp).toFixed(2)})`); return { x: ex, y: ey, g: -1, seen: bg }; }
    if (separate) {
      for (const di of [-1, 1]) {
        const q = plant.get(key(i + di, j));
        if (!q) continue;
        const mx = Math.round((q.x + bx) / 2), my = Math.round((q.y + by) / 2);
        if (mx >= 0 && my >= 0 && mx < r.w && my < r.h && G[my * r.w + mx] > P.stripShare * Math.min(bg, q.g)) { note(i, j, `green all the way to the neighbour (a strip): ${G[my * r.w + mx].toFixed(2)} between`); return { x: ex, y: ey, g: -1, seen: bg }; }
      }
    }
    return { x: bx, y: by, g: bg };
  };
  // i, j, empties in a row leading here along the row, rows stepped over to reach here across (0 along the row),
  // 1 when reached by stepping over an empty row or by the sweep (bridged: not joined to the clicked planting).
  const queue: [number, number, number, number, number][] = [];
  const seen = new Set<string>();
  for (const [i, j] of seeds) { queue.push([i, j, 0, 0, 0]); seen.add(key(i, j)); }
  const gapAt = new Map<string, { x: number; y: number; seen: number }>();
  const bridged = new Set<string>();
  let sinceRefit = 0;
  const accept = (i: number, j: number, q: { x: number; y: number; g: number }, b: number) => {
    plant.set(key(i, j), q);
    if (b) bridged.add(key(i, j));
    if (++sinceRefit >= P.refitEvery) {
      sinceRefit = 0;
      L = latticeFromPlants([...plant.entries()].map(([k, v]) => { const [a, b] = k.split(",").map(Number); return { i: a, j: b, x: v.x, y: v.y }; }), L);
    }
  };
  // The clicked plants first: in the map as plants, their neighbours queued, whatever the green there. The plant is
  // looked for around the mark (the mark may be an expected position the tree stands beside: a tree refused for
  // standing too far off its slot, then marked "a crop" by the operator, got its canopy measured on bare soil).
  for (const a of opts.anchors ?? []) {
    const k = key(a.i, a.j);
    const R = P.anchorSearchM / r.mpp;
    let bx = a.x, by = a.y, bg = -1;
    for (let yy = Math.max(0, Math.floor(a.y - R)); yy <= Math.min(r.h - 1, Math.ceil(a.y + R)); yy++) for (let xx = Math.max(0, Math.floor(a.x - R)); xx <= Math.min(r.w - 1, Math.ceil(a.x + R)); xx++) {
      if ((xx - a.x) ** 2 + (yy - a.y) ** 2 > R * R) continue;
      const v = G[yy * r.w + xx];
      if (v > bg) { bg = v; bx = xx; by = yy; }
    }
    if (bg >= P.anchorFloor) [bx, by] = recentre(bx, by);
    else { bx = a.x; by = a.y; }
    plant.set(k, { x: bx, y: by, g: Math.max(bg, barOf(a.j)) });
    seen.add(k);
    for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const kk = key(a.i + di, a.j + dj); if (!seen.has(kk)) { seen.add(kk); queue.push([a.i + di, a.j + dj, 0, dj ? 1 : 0, 0]); } }
  }
  const grow = () => {
    while (queue.length) {
      const [i, j, empties, across, b] = queue.shift()!;
      const q = look(i, j);
      if (!q) continue;
      // Entering a row from the next one: a neighbour along this row must also hold a plant on the layout.
      if (across && q.g >= 0 && ![-1, 1].some(di => { const v = look(i + di, j); return v != null && v.g >= 0; })) { seen.delete(key(i, j)); continue; }
      if (q.g < 0) {
        missing.set(key(i, j), empties + 1);
        gapAt.set(key(i, j), { x: q.x, y: q.y, seen: q.seen ?? 0 });
        if (across) {
          // A row with nothing here is stepped over: the field's spacing says where the next one stands.
          if (across <= P.maxMissingRows) for (const dj of [-1, 1]) { const k = key(i, j + dj); if (!seen.has(k)) { seen.add(k); queue.push([i, j + dj, 0, across + 1, 1]); } }
          continue;
        }
        if (empties + 1 > P.segmentMaxMissing) continue;
        for (const di of [-1, 1]) { const k = key(i + di, j); if (!seen.has(k)) { seen.add(k); queue.push([i + di, j, empties + 1, 0, b]); } }
        continue;
      }
      accept(i, j, q, b);
      for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const k = key(i + di, j + dj);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push([i + di, j + dj, 0, dj ? 1 : 0, b]);
      }
    }
  };
  grow();
  // The sweep: a planting does not stop in the middle of a field. Every expected position within two rows and three
  // plants of an accepted plant that growth never reached (behind a gap, behind a missed row) is looked at too, and
  // growth goes on from whatever it finds, until nothing more is found.
  for (let round = 0; round < 6; round++) {
    const todo: [number, number][] = [];
    for (const k of plant.keys()) {
      const [pi, pj] = k.split(",").map(Number);
      for (let dj = -2; dj <= 2; dj++) for (let di = -3; di <= 3; di++) {
        const kk = key(pi + di, pj + dj);
        if (seen.has(kk)) continue;
        seen.add(kk);
        todo.push([pi + di, pj + dj]);
      }
    }
    let added = 0;
    for (const [i, j] of todo) {
      const q = look(i, j);
      if (!q) continue;
      if (q.g < 0) { gapAt.set(key(i, j), { x: q.x, y: q.y, seen: q.seen ?? 0 }); continue; }
      // On its own in the field it is a weed; with a plant beside it along the row, or one in the next row in step, it is the planting.
      const company = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([di, dj]) => plant.has(key(i + di, j + dj)));
      if (!company) { note(i, j, "green on its own: no plant beside it along the row or in the next row"); seen.delete(key(i, j)); continue; }
      accept(i, j, q, 1);
      added++;
      for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const kk = key(i + di, j + dj); if (!seen.has(kk)) { seen.add(kk); queue.push([i + di, j + dj, 0, dj ? 1 : 0, 1]); } }
    }
    grow();
    if (!added) break;
  }
  // ---- The interior: rows on both sides and green between them means rows between them. Every gap between two
  // found rows is scanned across for row lines, every row line along for plants; every stretch between two found
  // plants on a row is scanned along. Found at the lattice's own pitch, a plant joins the lattice; a row at another
  // pitch (a younger block planted between) stands on its own.
  const freeRows: { j: number; plants: { x: number; y: number; g: number }[] }[] = [];
  {
    const { ux, uy, nx, ny } = basis(L);
    const g = (x: number, y: number) => { const xi = Math.round(x), yi = Math.round(y); return xi < 0 || yi < 0 || xi >= r.w || yi >= r.h || !r.inField[yi * r.w + xi] ? -1 : G[yi * r.w + xi]; };
    const alongOf = (x: number, y: number) => (x - L.ox) * ux + (y - L.oy) * uy, acrossOf = (x: number, y: number) => (x - L.ox) * nx + (y - L.oy) * ny;
    const at = (t: number, c: number): [number, number] => [L.ox + t * ux + c * nx, L.oy + t * uy + c * ny];
    const profile = (f: (s: number) => number, s0: number, s1: number): Float32Array => {
      const n = Math.max(0, Math.floor(s1 - s0));
      const raw = new Float32Array(n);
      for (let k = 0; k < n; k++) raw[k] = f(s0 + k);
      const out = new Float32Array(n);
      for (let k = 0; k < n; k++) { let a = 0, m = 0; for (let d = -1; d <= 1; d++) { const v = raw[k + d]; if (v !== undefined && v >= 0) { a += v; m++; } } out[k] = m ? a / m : -1; }
      return out;
    };
    const peaks = (pr: Float32Array, threshold: number, separation: number): number[] => {
      const cand: number[] = [];
      for (let k = 1; k < pr.length - 1; k++) if (pr[k] >= threshold && pr[k] >= pr[k - 1] && pr[k] > pr[k + 1]) cand.push(k);
      cand.sort((a, b) => pr[b] - pr[a]);
      const kept: number[] = [];
      for (const k of cand) if (kept.every(q => Math.abs(q - k) >= separation)) kept.push(k);
      kept.sort((a, b) => a - b);
      // Prominence: the lowest point between a peak and its neighbours (or the ends) is well below it.
      return kept.filter((k, n) => {
        const lo = n ? kept[n - 1] : 0, hi = n + 1 < kept.length ? kept[n + 1] : pr.length - 1;
        let vl = Infinity, vr = Infinity;
        for (let q = lo; q < k; q++) if (pr[q] >= 0) vl = Math.min(vl, pr[q]);
        for (let q = k + 1; q <= hi; q++) if (pr[q] >= 0) vr = Math.min(vr, pr[q]);
        return pr[k] >= P.interiorProminence * Math.max(vl === Infinity ? 0 : vl, vr === Infinity ? 0 : vr);
      });
    };
    type RowInfo = { j: number; across: number; t0: number; t1: number; reading: number; plantG: number[] };
    const byJ = new Map<number, { i: number; x: number; y: number; g: number }[]>();
    for (const [k, v] of plant) { const [i, j] = k.split(",").map(Number); (byJ.get(j) ?? byJ.set(j, []).get(j)!).push({ i, ...v }); }
    // Only a row that has earned its place bounds a gap: joined to the clicked planting with enough plants, or a
    // bridged stretch long enough to stand on its own (a short stretch across a track, dropped later, must not
    // "explain" the gap up to it).
    const established = ([j, ps]: [number, { i: number }[]]) => { const joined = ps.filter(q => !bridged.has(key(q.i, j))).length; return joined >= P.minPlants || ps.length >= P.bridgedMinPlants; };
    const rowsInfo: RowInfo[] = [...byJ.entries()].filter(established).map(([j, ps]) => {
      const across = median(ps.map(q => acrossOf(q.x, q.y)));
      const ts = ps.map(q => alongOf(q.x, q.y)), t0 = Math.min(...ts), t1 = Math.max(...ts);
      const pr = profile(t => g(...at(t, across)), t0, t1);
      let a = 0, m = 0; for (const v of pr) if (v >= 0) { a += v; m++; }
      return { j, across, t0, t1, reading: m ? a / m : 0, plantG: ps.map(q => q.g) };
    }).sort((a, b) => a.j - b.j);
    const plantsOnLine = (c: number, t0: number, t1: number, threshold: number) => {
      const pr = profile(t => g(...at(t, c)), t0, t1);
      const ks = peaks(pr, threshold, P.interiorPlantSeparation * L.along);
      // Where the planting's plants stand apart, a row has soil between its plants: a weed strip along the line
      // has peaks too, but no valleys between them.
      if (separate && ks.length >= 2) {
        const on = ks.map(k => pr[k]), between: number[] = [];
        for (let n = 1; n < ks.length; n++) { let m = Infinity; for (let q = ks[n - 1]; q <= ks[n]; q++) if (pr[q] >= 0) m = Math.min(m, pr[q]); if (m < Infinity) between.push(m); }
        if (between.length && median(between) >= P.stripShare * median(on)) return [];
      }
      // The plant at a peak is the greenest spot a little either side of the line, so a row that bends is followed.
      return ks.map(k => {
        let best = { x: 0, y: 0, g: -1 };
        for (let d = -0.1 * Math.abs(L.across); d <= 0.1 * Math.abs(L.across); d += 1) { const [x, y] = at(t0 + k, c + d); const v = g(x, y); if (v > best.g) best = { x, y, g: v }; }
        const [rx, ry] = recentre(best.x, best.y);
        return { ...best, x: rx, y: ry };
      });
    };
    // (a) Between found rows.
    for (let n = 0; n + 1 < rowsInfo.length; n++) {
      const A = rowsInfo[n], B = rowsInfo[n + 1];
      if (B.j - A.j < 2) continue;
      const lo = Math.min(A.across, B.across) + P.interiorRowSeparation * Math.abs(L.across), hi = Math.max(A.across, B.across) - P.interiorRowSeparation * Math.abs(L.across);
      if (hi <= lo) continue;
      const t0 = Math.min(A.t0, B.t0), t1 = Math.max(A.t1, B.t1);
      const rowThreshold = Math.max(P.interiorRowFloor, P.interiorRowShare * median([A.reading, B.reading]));
      const plantThreshold = Math.max(P.interiorPlantFloor, P.interiorPlantShare * median([...A.plantG, ...B.plantG]));
      const across = profile(c => { let a = 0, m = 0; for (let t = t0; t <= t1; t += 2) { const v = g(...at(t, c)); if (v >= 0) { a += v; m++; } } return m ? a / m : -1; }, lo, hi);
      let rowsInGap = 0;
      for (const k of peaks(across, rowThreshold, P.interiorRowSeparation * Math.abs(L.across))) {
        const c = lo + k;
        const found = plantsOnLine(c, t0, t1, plantThreshold);
        if (found.length < P.minPlants) continue;
        const jEst = c / L.across, jNear = Math.round(jEst);
        // On the lattice's own row and in step with it, the plants join the lattice; else the row stands on its own.
        const mapped: [number, typeof found[number]][] = [];
        if (Math.abs(jEst - jNear) <= 0.3 && !byJ.has(jNear)) {
          for (const q of found) {
            const iEst = (alongOf(q.x, q.y) - jNear * L.stagger) / L.along, iNear = Math.round(iEst);
            if (Math.abs(iEst - iNear) <= 0.3 && !plant.has(key(iNear, jNear)) && !noCrop.has(key(iNear, jNear))) mapped.push([iNear, q]);
          }
        }
        if (mapped.length >= 0.7 * found.length) { for (const [iNear, q] of mapped) { plant.set(key(iNear, jNear), q); bridged.delete(key(iNear, jNear)); } }
        else freeRows.push({ j: jEst, plants: found });
        rowsInGap++;
      }
      // The gap explained by rows: what lay beyond it was not reached across an empty row after all.
      if (rowsInGap) {
        const aJoined = byJ.get(A.j)!.some(q => !bridged.has(key(q.i, A.j))), bJoined = byJ.get(B.j)!.some(q => !bridged.has(key(q.i, B.j)));
        for (const [k] of plant) { const [, jj] = k.split(",").map(Number); if ((aJoined && jj >= B.j) || (bJoined && jj <= A.j)) bridged.delete(k); }
      }
    }
    // (b) Between found plants on a row.
    for (const R of rowsInfo) {
      const ps = byJ.get(R.j)!.sort((a, b) => a.i - b.i);
      const plantThreshold = Math.max(P.interiorPlantFloor, P.interiorPlantShare * median(R.plantG));
      // A plant filled into a stretch reached across an empty row is as unproven as the stretch.
      const rowBridged = ps.every(q => bridged.has(key(q.i, R.j)));
      for (let n = 0; n + 1 < ps.length; n++) {
        const a = ps[n], b = ps[n + 1];
        if (b.i - a.i < 2) continue;
        const ta = alongOf(a.x, a.y), tb = alongOf(b.x, b.y), ca = acrossOf(a.x, a.y), cb = acrossOf(b.x, b.y);
        const pr = profile(t => { const f = (t - ta) / Math.max(1, tb - ta); return g(...at(t, ca + f * (cb - ca))); }, ta + 0.3 * L.along, tb - 0.3 * L.along);
        for (const k of peaks(pr, plantThreshold, P.interiorPlantSeparation * L.along)) {
          const t = ta + 0.3 * L.along + k, f = (t - ta) / Math.max(1, tb - ta), c = ca + f * (cb - ca);
          const iEst = (t - R.j * L.stagger) / L.along, iNear = Math.round(iEst);
          if (iNear <= a.i || iNear >= b.i || plant.has(key(iNear, R.j)) || noCrop.has(key(iNear, R.j))) continue;
          let best = { x: 0, y: 0, g: -1 };
          for (let d = -0.1 * Math.abs(L.across); d <= 0.1 * Math.abs(L.across); d += 1) { const [x, y] = at(t, c + d); const v = g(x, y); if (v > best.g) best = { x, y, g: v }; }
          if (best.g < plantThreshold) continue;
          // Soil between it and its neighbours along the row, where the plants stand apart.
          if (separate && [a, b].some(nb => { const mx = Math.round((nb.x + best.x) / 2), my = Math.round((nb.y + best.y) / 2); return mx >= 0 && my >= 0 && mx < r.w && my < r.h && G[my * r.w + mx] > P.stripShare * Math.min(best.g, nb.g); })) continue;
          const [rx, ry] = recentre(best.x, best.y); plant.set(key(iNear, R.j), { ...best, x: rx, y: ry }); if (rowBridged) bridged.add(key(iNear, R.j));
        }
      }
    }
  }
  // Rows from what grew: runs of plants along each row, with the gaps between them; short runs dropped.
  const byRow = new Map<number, number[]>();
  for (const k of plant.keys()) { const [i, j] = k.split(",").map(Number); (byRow.get(j) ?? byRow.set(j, []).get(j)!).push(i); }
  const plants: LayoutPlant[] = [], gaps: LayoutGap[] = [];
  let rows = 0, expected = 0, found = 0, run = 0;
  // The planting's typical crown, from the plants joined to the clicked ones whose canopy edge was found.
  const canopies = new Map<string, { x: number; y: number; radius: number; merged: boolean }>();
  const canopyAt = (k: string, x: number, y: number) => { let c = canopies.get(k); if (!c) { c = canopyOf(r, x, y, reach); canopies.set(k, c); } return c; };
  const typicalCrown = median([...plant.entries()].filter(([k, q]) => !bridged.has(k) && !canopyAt(k, q.x, q.y).merged).map(([k]) => canopies.get(k)!.radius));
  const anchorKeys = new Set((opts.anchors ?? []).map(a => key(a.i, a.j)));
  // The ring is the measured canopy; what is painted over for the model is the typical crown when the canopy merged with other green (weeds in the tangle stay in view).
  const paintOf = (c: { radius: number; merged: boolean }) => (c.merged && typicalCrown > 0 ? Math.min(typicalCrown, c.radius) : c.radius);
  const stateOf = (k: string, q: { x: number; y: number; g: number }, _j: number): { state: PlantState; x: number; y: number; radius: number; paint: number; merged: boolean } => {
    const c = canopyAt(k, q.x, q.y);
    const radius = c.radius, paint = paintOf(c), at = { x: c.x, y: c.y, merged: c.merged };
    // The operator's plant is drawn at least half the planting's typical size: a ring on a pixel of green covers nothing.
    if (anchorKeys.has(k)) return { state: "operator", ...at, radius: Math.max(radius, 0.5 * typicalCrown), paint: Math.max(paint, 0.5 * typicalCrown) };
    const tiny = q.g < P.tinyGreen || (typicalCrown > 0 && c.radius < P.tinyCrownShare * typicalCrown);
    if (tiny) return { state: "probable", ...at, radius, paint };
    // Merged and weak: a tangle of green with no crown in it, or a crown among weeds; the operator decides.
    if (c.merged && q.g < P.presentGreen) return { state: "ambiguous", ...at, radius, paint, merged: true };
    return { state: "confirmed", ...at, radius, paint };
  };
  const gapEvidence = (k: string): LayoutGap["evidence"] => { const seen = gapAt.get(k)?.seen ?? 0; return seen === -2 ? "operator" : seen >= P.anchorFloor ? "some" : "none"; };
  for (const [j, is] of byRow) {
    is.sort((a, b) => a - b);
    let cur: number[] = [is[0]];
    let irregular = "";
    const regular = (is2: number[]): boolean => {
      // The stretch's own line through its plants, its direction against the layout's, and how evenly it steps.
      const pts = is2.map(i => plant.get(key(i, j))!);
      const mx = pts.reduce((a, q) => a + q.x, 0) / pts.length, my = pts.reduce((a, q) => a + q.y, 0) / pts.length;
      let sxx = 0, syy = 0, sxy = 0;
      for (const q of pts) { sxx += (q.x - mx) ** 2; syy += (q.y - my) ** 2; sxy += (q.x - mx) * (q.y - my); }
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      let turn = Math.abs(th - L.angle) % Math.PI;
      if (turn > Math.PI / 2) turn = Math.PI - turn;
      if (turn > (P.runAngleDeg * Math.PI) / 180) { irregular = `turned ${((turn * 180) / Math.PI).toFixed(1)} degrees from the layout`; return false; }
      const vx = -Math.sin(th), vy = Math.cos(th);
      const rms = Math.sqrt(pts.reduce((a, q) => a + ((q.x - mx) * vx + (q.y - my) * vy) ** 2, 0) / pts.length);
      if (rms > P.runLateralShare * Math.abs(L.across)) { irregular = `plants ${(rms * r.mpp).toFixed(2)} m off their line on average (limit ${(P.runLateralShare * Math.abs(L.across) * r.mpp).toFixed(2)})`; return false; }
      let ok = 0, steps = 0;
      for (let k = 1; k < is2.length; k++) {
        const a = pts[k - 1], b = pts[k], d = Math.hypot(b.x - a.x, b.y - a.y), n2 = is2[k] - is2[k - 1];
        steps++;
        if (Math.abs(d - n2 * L.along) <= P.runStepShare * L.along) ok++;
      }
      if (!(steps > 0 && ok / steps >= P.runRegularShare)) { irregular = `only ${ok} of ${steps} steps a whole number of spacings`; return false; }
      return true;
    };
    /** A bridged stretch: every plant reached by stepping over a row or by the sweep. It must sit tightly on the layout's own line. */
    const bridgedOk = (is2: number[]): boolean => {
      if (!is2.every(i => bridged.has(key(i, j)))) return true;
      if (is2.length < P.bridgedMinPlants) return false;
      if (typicalCrown > 0) {
        const crown = median(is2.map(i => { const q = plant.get(key(i, j))!; return canopyAt(key(i, j), q.x, q.y).radius; }));
        if (crown < P.bridgedCrownMin * typicalCrown || crown > P.bridgedCrownMax * typicalCrown) return false;
      }
      const { ux, uy, nx, ny } = basis(L);
      const offs = is2.map(i => { const q = plant.get(key(i, j))!; const [lx, ly] = latticePoint(L, i, j); return [Math.abs((q.x - lx) * ux + (q.y - ly) * uy), Math.abs((q.x - lx) * nx + (q.y - ly) * ny)]; });
      return median(offs.map(o => o[0])) <= P.bridgedAlongShare * L.along && median(offs.map(o => o[1])) <= P.bridgedAcrossShare * Math.abs(L.across);
    };
    const flush = () => {
      const n = cur.length;
      const okReg = n >= P.minPlants && regular(cur), okBr = okReg && bridgedOk(cur);
      if (!okReg) for (const i of cur) note(i, j, n < P.minPlants ? `in a stretch of only ${n} plant${n === 1 ? "" : "s"}` : `in a stretch that does not run straight and evenly: ${irregular}`);
      else if (!okBr) for (const i of cur) note(i, j, "in a stretch reached across an empty row that did not prove itself (plants, line, crown size)");
      if (okBr) {
        const span = cur[n - 1] - cur[0] + 1;
        if (n / span < P.minRowShare) for (const i of cur) note(i, j, "in a stretch with too few plants for its length");
        if (n / span >= P.minRowShare) {
          rows++; run++; expected += span; found += n;
          for (let i = cur[0]; i <= cur[n - 1]; i++) {
            const q = plant.get(key(i, j));
            if (q) { const st = stateOf(key(i, j), q, j); plants.push({ x: st.x, y: st.y, r: st.radius, paint: st.paint, row: j, i, run, state: st.state, g: q.g, merged: st.merged }); opts.trace?.set(key(i, j), `accepted (crown green ${q.g.toFixed(2)}, ${st.state})`); }
            else { const g = gapAt.get(key(i, j)); const [lx, ly] = latticePoint(L, i, j); gaps.push({ x: g?.x ?? lx, y: g?.y ?? ly, row: j, i, evidence: gapEvidence(key(i, j)), g: Math.max(0, g?.seen ?? 0) }); }
          }
        }
      }
    };
    for (let k = 1; k < is.length; k++) {
      if (is[k] - is[k - 1] - 1 > P.segmentMaxMissing) { flush(); cur = []; }
      cur.push(is[k]);
    }
    flush();
  }
  for (const fr of freeRows) {
    // A row at another pitch still runs straight at the lattice's angle, its plants on their line, stepping evenly.
    const pts = fr.plants;
    if (pts.length < P.minPlants) continue;
    const mx = pts.reduce((a, q) => a + q.x, 0) / pts.length, my = pts.reduce((a, q) => a + q.y, 0) / pts.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const q of pts) { sxx += (q.x - mx) ** 2; syy += (q.y - my) ** 2; sxy += (q.x - mx) * (q.y - my); }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let turn = Math.abs(th - L.angle) % Math.PI;
    if (turn > Math.PI / 2) turn = Math.PI - turn;
    if (turn > (P.runAngleDeg * Math.PI) / 180) continue;
    const vx = -Math.sin(th), vy = Math.cos(th);
    const rms = Math.sqrt(pts.reduce((a, q) => a + ((q.x - mx) * vx + (q.y - my) * vy) ** 2, 0) / pts.length);
    if (rms > P.runLateralShare * Math.abs(L.across)) continue;
    const ux2 = Math.cos(th), uy2 = Math.sin(th);
    const ts = pts.map(q => q.x * ux2 + q.y * uy2).sort((a, b) => a - b);
    let ok = 0;
    for (let n = 1; n < ts.length; n++) { const d = ts[n] - ts[n - 1], k = Math.max(1, Math.round(d / L.along)); if (Math.abs(d - k * L.along) <= P.runStepShare * L.along) ok++; }
    if (ok / (ts.length - 1) < P.runRegularShare) continue;
    rows++; run++; expected += fr.plants.length; found += fr.plants.length;
    fr.plants.forEach((q, k) => { const c = canopyOf(r, q.x, q.y, reach); plants.push({ x: c.x, y: c.y, r: c.radius, paint: paintOf(c), row: fr.j, i: k, run, state: c.merged ? "ambiguous" : "probable", g: q.g, merged: c.merged }); });
  }
  return { plants, gaps, rows, foundShare: expected ? found / expected : 0, lattice: L };
}

/** The lattice that best maps (i, j) to the plants' places, by least squares: x = ox + i e1x + j e2x, the same for y. */
export function latticeFromPlants(pts: { i: number; j: number; x: number; y: number }[], prev: Lattice): Lattice {
  if (pts.length < 6) return prev;
  // Normal equations for [1 i j] -> x and -> y.
  let n = 0, si = 0, sj = 0, sii = 0, sjj = 0, sij = 0, sx = 0, six = 0, sjx = 0, sy = 0, siy = 0, sjy = 0;
  for (const q of pts) { n++; si += q.i; sj += q.j; sii += q.i * q.i; sjj += q.j * q.j; sij += q.i * q.j; sx += q.x; six += q.i * q.x; sjx += q.j * q.x; sy += q.y; siy += q.i * q.y; sjy += q.j * q.y; }
  const A = [[n, si, sj], [si, sii, sij], [sj, sij, sjj]];
  const solve = (b: number[]): number[] | null => {
    const m = A.map((row, k) => [...row, b[k]]);
    for (let c = 0; c < 3; c++) {
      let piv = c; for (let r2 = c + 1; r2 < 3; r2++) if (Math.abs(m[r2][c]) > Math.abs(m[piv][c])) piv = r2;
      if (Math.abs(m[piv][c]) < 1e-9) return null;
      [m[c], m[piv]] = [m[piv], m[c]];
      for (let r2 = 0; r2 < 3; r2++) if (r2 !== c) { const f = m[r2][c] / m[c][c]; for (let k = c; k < 4; k++) m[r2][k] -= f * m[c][k]; }
    }
    return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
  };
  const X = solve([sx, six, sjx]), Y = solve([sy, siy, sjy]);
  if (!X || !Y) return prev;
  const e1 = [X[1], Y[1]], e2 = [X[2], Y[2]];
  const along = Math.hypot(e1[0], e1[1]);
  if (!(along > 0)) return prev;
  const angle = Math.atan2(e1[1], e1[0]);
  const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
  const across = e2[0] * nx + e2[1] * ny, stagger = e2[0] * ux + e2[1] * uy;
  // Only small corrections are taken: the fit cannot turn the layout into another one.
  if (Math.abs(along - prev.along) > 0.1 * prev.along || Math.abs(Math.abs(across) - Math.abs(prev.across)) > 0.1 * Math.abs(prev.across) || Math.abs(angle - prev.angle) > (3 * Math.PI) / 180) return prev;
  return { ox: X[0], oy: Y[0], angle, along, across, stagger };
}

/** Whether the plants stand apart along the row (soil between neighbours), judged at the lattice's own points near its origin. */
export function plantsStandApart(L: Lattice, G: Float32Array, r: LayoutRaster): boolean {
  const on: number[] = [], mid: number[] = [];
  for (let j = -2; j <= 2; j++) for (let i = -6; i <= 6; i++) {
    const [x, y] = latticePoint(L, i, j), [x2, y2] = latticePoint(L, i + 0.5, j);
    const a = Math.round(x), b = Math.round(y), c = Math.round(x2), d = Math.round(y2);
    if (a < 0 || b < 0 || a >= r.w || b >= r.h || c < 0 || d < 0 || c >= r.w || d >= r.h) continue;
    on.push(G[b * r.w + a]); mid.push(G[d * r.w + c]);
  }
  const med = (v: number[]) => { const t = [...v].sort((p, q) => p - q); return t[t.length >> 1] ?? 0; };
  return on.length >= 5 && med(mid) < 0.5 * med(on);
}

/**
 * The whole fit: the lattice refined near the clicks on spacing-scale green (smooth, for the descent), the finest
 * spacing at which plants keep appearing taken, then each lattice grown from the plants nearest its origin, with
 * presence judged at crown scale. The first result is the clicked planting (what a save keeps); the rest are rows
 * found between its rows.
 */
/** The lattice position nearest a place. */
export function latticeIndex(L: Lattice, x: number, y: number): [number, number] {
  const { e1, e2 } = basis(L);
  const det = e1[0] * e2[1] - e1[1] * e2[0];
  const dx = x - L.ox, dy = y - L.oy;
  return [Math.round((dx * e2[1] - dy * e2[0]) / det), Math.round((e1[0] * dy - e1[1] * dx) / det)];
}

/**
 * The whole fit. `clicks` are the operator's plants (raster pixels): they are plants whatever the green there, and
 * the rows they stand in get a presence bar set from how green they are (half the palest click in that row, never
 * under `anchorFloor`), so a row of pale young trees marked by the operator is followed, not skipped. The bar is
 * lowered only on those rows: lowered for the whole planting it let weed clumps into rows, which then failed the
 * straightness check and were dropped whole (DJI_0301: 98 trees to 89).
 */
/** The operator's word on a position (raster px): a crop there, or none. */
export type Verdict = { x: number; y: number; crop: boolean };

export function fitLayoutAll(L0: Lattice, r: LayoutRaster, clicks: [number, number][] = [], trace?: Map<string, string>, verdicts: Verdict[] = []): FittedLayout[] {
  const P = LAYOUT_PARAMS;
  const G = boxMean(r, P.crownShare * L0.along);
  const GF = boxMean(r, P.presenceRadiusM / r.mpp);
  const gAt = (x: number, y: number) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < r.w && yi < r.h ? GF[yi * r.w + xi] : 0; };
  const presentGreen = P.presentGreen;
  const { lattice: refined, score } = refineLattice(L0, G, r);
  const near = { cx: refined.ox, cy: refined.oy, radius: 8 * Math.max(refined.along, Math.abs(refined.across)) };
  const sub = subdividedLattices(refined, GF, r, near, plantsStandApart(refined, GF, r), presentGreen);
  let main = sub.main;
  // A spacing corrected along the row means the lattice was refined at the wrong scale: refined again at the right one,
  // and whether the plants stand apart is judged at the right one too (at twice the spacing, the plant between
  // two plants reads as green between them).
  if (main.along !== refined.along) main = refineLattice(main, boxMean(r, P.crownShare * main.along), r).lattice;
  const derived = sub.derived.map(L => ({ ...L, along: main.along, across: main.across, angle: main.angle }));
  const separate = plantsStandApart(main, GF, r);
  const rowPitch = rowPitchOf(main, derived);
  const out: FittedLayout[] = [];
  for (const L of [main, ...derived]) {
    const toAnchor = ([x, y]: [number, number]): Anchor => { const [i, j] = latticeIndex(L, x, y); return { i, j, x, y }; };
    const anchors: Anchor[] = L === main ? [...clicks, ...verdicts.filter(v => v.crop).map(v => [v.x, v.y] as [number, number])].map(toAnchor) : [];
    const noCrop: Anchor[] = L === main ? verdicts.filter(v => !v.crop).map(v => toAnchor([v.x, v.y])) : [];
    const rowBar = new Map<number, number>();
    for (const a of anchors) { const bar = Math.min(P.presentGreen, Math.max(P.anchorFloor, 0.5 * gAt(a.x, a.y))); rowBar.set(a.j, Math.min(rowBar.get(a.j) ?? P.presentGreen, bar)); }
    const seeds = seedsFor(L, GF, r, near, 3, presentGreen);
    if (!seeds.length && !anchors.length) continue;
    out.push({ score, rowPitch, ...growPlants(L, GF, r, seeds, separate, { anchors, noCrop, rowBar, trace: L === main ? trace : undefined }) });
  }
  return out.length ? out : [{ score, rowPitch, lattice: main, plants: [], gaps: [], rows: 0, foundShare: 0 }];
}

/** The clicked planting alone (tests and callers that want one lattice). */
export function fitLayout(L0: Lattice, r: LayoutRaster): FittedLayout {
  return fitLayoutAll(L0, r)[0];
}

// ---------------------------------------------------------------- several plantings in one field

/**
 * Several plantings fitted in one field (one per set of clicks): a plant belongs to one of them. Where stretches of
 * rows from different plantings claim the same plants (within a third of the smaller plant spacing), the stretch with
 * fewer plants gives way. Run ids are made unique across plantings.
 */
export function mergeLayouts(fits: FittedLayout[]): FittedLayout[] {
  type Run = { f: number; run: number; plants: LayoutPlant[] };
  const runs: Run[] = [];
  fits.forEach((fit, f) => {
    const by = new Map<number, LayoutPlant[]>();
    for (const p of fit.plants) (by.get(p.run) ?? by.set(p.run, []).get(p.run)!).push(p);
    for (const [run, plants] of by) runs.push({ f, run, plants });
  });
  const drop = new Set<Run>();
  for (const a of runs) for (const b of runs) {
    if (a === b || a.f === b.f || drop.has(a) || drop.has(b)) continue;
    const tol = Math.min(fits[a.f].lattice.along, fits[b.f].lattice.along) / 3;
    const shared = a.plants.filter(p => b.plants.some(q => Math.hypot(p.x - q.x, p.y - q.y) <= tol)).length;
    if (!shared) continue;
    drop.add(a.plants.length < b.plants.length ? a : b);
  }
  let next = 0;
  return fits.map((fit, f) => {
    const keep = runs.filter(r => r.f === f && !drop.has(r));
    const ids = new Map(keep.map(r => [r.run, ++next]));
    const plants = fit.plants.filter(p => ids.has(p.run)).map(p => ({ ...p, run: ids.get(p.run)! }));
    const rowsKept = new Set(keep.map(r => r.plants[0].row));
    const gaps = fit.gaps.filter(g => rowsKept.has(g.row));
    return { ...fit, plants, gaps, rows: keep.length };
  });
}

// ---------------------------------------------------------------- as the app's rows

/** The fitted layout as FieldRows in the raster's frame (zoom z, origin left, top), with its gaps. */
/** The crop band each side of a row line between the crowns, metres. */
export const LAYOUT_BAND_M = 0.5;

export function layoutToFieldRows(f: FittedLayout, r: LayoutRaster): (FieldRows & { source: "layout"; gaps: { x: number; y: number }[] }) | null {
  if (!f.rows) return null;
  const k = r.scale;
  const mppFrame0 = r.mpp / k;
  const spacing = (f.rowPitch ?? Math.abs(f.lattice.across)) * k, step = f.lattice.along * k;
  // The crop band along the row line, between the crowns: the trunk line, LAYOUT_BAND_M each side, never wider than
  // the row filter's minimum share of the pitch. The crowns themselves are the plant discs. A band as wide as the
  // crown radius (1.07 m on DJI_0301) took 63 of 414 labelled weeds standing on bare soil between trees for crop;
  // 0.5 m takes 28, and keeps 97 of 104 labelled trees on a row.
  const band = Math.min(Math.max(LAYOUT_BAND_M / mppFrame0, ROW_BAND_PITCH_SHARE * spacing * 0.5), 0.35 * spacing);
  const { ux, uy } = basis(f.lattice);
  const byRow = new Map<number, LayoutPlant[]>();
  for (const p of f.plants) (byRow.get(p.run) ?? byRow.set(p.run, []).get(p.run)!).push(p);
  const lines: FieldRows["ctx"]["lines"] = [];
  for (const ps of byRow.values()) {
    const m = [...ps].sort((a, b) => a.i - b.i).map(p => ({ x: p.x * k, y: p.y * k }));
    for (let i = 1; i < m.length; i++) lines.push({ x1: m[i - 1].x, y1: m[i - 1].y, x2: m[i].x, y2: m[i].y, band });
    const h = step / 2, a = m[0], z = m[m.length - 1];
    lines.push({ x1: a.x - h * ux, y1: a.y - h * uy, x2: a.x, y2: a.y, band });
    lines.push({ x1: z.x, y1: z.y, x2: z.x + h * ux, y2: z.y + h * uy, band });
  }
  const mppFrame = r.mpp / k;
  return {
    z: r.z, left: r.left, top: r.top, mpp: mppFrame,
    ctx: { lines, crops: f.plants.map(p => ({ x: p.x * k, y: p.y * k, r: p.r * k, paint: p.paint * k, state: p.state, uncertain: p.merged })), bandPx: band, gsdM: mppFrame },
    rows: f.rows, spacingM: spacing * mppFrame, seedSpacingM: step * mppFrame,
    directionDeg: ((((f.lattice.angle * 180) / Math.PI) % 180) + 180) % 180, blocks: 1,
    source: "layout", gaps: f.gaps.map(g => ({ x: g.x * k, y: g.y * k, evidence: g.evidence })),
  };
}

/** Several plantings' rows as one FieldRows (each line keeps its own planting's band), with all their gaps. */
export function layoutsToFieldRows(fits: FittedLayout[], r: LayoutRaster): (FieldRows & { source: "layout"; gaps: { x: number; y: number }[] }) | null {
  const parts = mergeLayouts(fits).map(f => layoutToFieldRows(f, r)).filter((x): x is NonNullable<typeof x> => !!x);
  if (!parts.length) return null;
  const main = parts.reduce((a, b) => (b.ctx.crops.length > a.ctx.crops.length ? b : a));
  return {
    ...main,
    ctx: { ...main.ctx, lines: parts.flatMap(p => p.ctx.lines), crops: parts.flatMap(p => p.ctx.crops) },
    rows: parts.reduce((s, p) => s + p.rows, 0), blocks: parts.length,
    gaps: parts.flatMap(p => p.gaps),
  };
}
