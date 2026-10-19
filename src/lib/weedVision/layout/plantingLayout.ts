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

export type LayoutPlant = { x: number; y: number; r: number; row: number; i: number; /** The stretch of its row it belongs to. */ run: number };
export type LayoutGap = { x: number; y: number; row: number; i: number };

export type FittedLayout = {
  lattice: Lattice;
  plants: LayoutPlant[];
  gaps: LayoutGap[];
  rows: number;
  /** Mean crown-scale green at the refined lattice's points: how well the lattice sits on the plants (0 to 1). */
  score: number;
  /** Share of the expected positions inside the rows' extent where a plant was found. */
  foundShare: number;
};

export const LAYOUT_PARAMS = {
  /** Crown-scale smoothing radius, as a share of the plant spacing. */
  crownShare: 0.2,
  /** Search around an expected position, as shares of the plant spacing (along) and the row spacing (across). */
  searchAlong: 0.3, searchAcross: 0.22,
  /** A plant is there when crown-scale green reaches this share (DJI_0301: 91 of 104 labelled trees found at 0.15 against 80 at 0.3, no more unmatched plants). */
  presentGreen: 0.15,
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
  refitEvery: 60,
  /** A stretch of row stands when its own line runs within this many degrees of the layout... */
  runAngleDeg: 4,
  /** ...at least this share of its steps between neighbours is a whole number of plant spacings within runStepShare... */
  runRegularShare: 0.7, runStepShare: 0.2,
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
  let best = L0, bestS = -1;
  for (const ka of [1, 2, 3]) for (const kc of [1, 2]) {
    const L = { ...L0, along: L0.along / ka, across: L0.across / kc, stagger: L0.stagger % (L0.along / ka) };
    if (Math.abs(L.along) * r.mpp < 0.3 || Math.abs(L.across) * r.mpp < 0.5) continue;
    const s = latticeScoreNear(L);
    if (s > bestS) { bestS = s; best = L; }
  }
  let L = best, S = bestS;
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

/** A plant's crown radius: out from its centre until a ring of pixels is less green than crownEdgeGreen. */
function crownRadius(r: LayoutRaster, x: number, y: number, rmax: number): number {
  let last = 1;
  for (let rad = 1; rad <= rmax; rad++) {
    let g = 0, n = 0;
    const steps = Math.max(8, Math.round(2 * Math.PI * rad));
    for (let k = 0; k < steps; k++) {
      const a = (2 * Math.PI * k) / steps, xi = Math.round(x + rad * Math.cos(a)), yi = Math.round(y + rad * Math.sin(a));
      if (xi < 0 || yi < 0 || xi >= r.w || yi >= r.h) continue;
      g += r.green[yi * r.w + xi] / 255; n++;
    }
    if (!n || g / n < LAYOUT_PARAMS.crownEdgeGreen) return Math.max(1, rad - 0.5);
    last = rad;
  }
  return last;
}

/**
 * The planting grown from the clicked plants outward, neighbour by neighbour. A lattice position is looked at only
 * next to a plant already accepted; its expected place is the lattice point moved by its accepted neighbours' own
 * offsets (a drifting row is followed); a plant is accepted there when crown-scale green is present in a small box
 * and, for plants that stand apart, when there is soil between it and its neighbour along the row (a weed strip is
 * green all along). Missing plants are carried along a row up to segmentMaxMissing in a row and become gaps only
 * between plants. Growth stops where the planting stops: at a block edge, a track, another planting at another angle.
 */
export function growPlants(L0: Lattice, G: Float32Array, r: LayoutRaster, seeds: [number, number][], separate: boolean): { plants: LayoutPlant[]; gaps: LayoutGap[]; rows: number; foundShare: number; lattice: Lattice } {
  const P = LAYOUT_PARAMS;
  let L = L0;
  const { ux, uy, nx, ny } = basis(L0);
  const sa = P.reSearchAlong * 1.6 * L.along, sc = P.reSearchAcross * 2.5 * Math.abs(L.across);
  const rmax = Math.max(2, Math.round(0.45 * Math.min(L.along, Math.abs(L.across))));
  const key = (i: number, j: number) => `${i},${j}`;
  const plant = new Map<string, { x: number; y: number; g: number }>();
  const missing = new Map<string, number>(); // positions looked at and found empty, with how many empties in a row lead to them
  const resid = (i: number, j: number): [number, number] | null => {
    const q = plant.get(key(i, j));
    if (!q) return null;
    const [lx, ly] = latticePoint(L, i, j);
    return [q.x - lx, q.y - ly];
  };
  const look = (i: number, j: number): { x: number; y: number; g: number } | null => {
    const [lx, ly] = latticePoint(L, i, j);
    const near: [number, number][] = [];
    for (const [di, dj] of [[-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [0, 1]]) { const v = resid(i + di, j + dj); if (v) near.push(v); }
    const ox = near.length ? near.reduce((a, v) => a + v[0], 0) / near.length : 0, oy = near.length ? near.reduce((a, v) => a + v[1], 0) / near.length : 0;
    const ex = lx + ox, ey = ly + oy;
    const xi = Math.round(ex), yi = Math.round(ey);
    if (xi < 0 || yi < 0 || xi >= r.w || yi >= r.h || !r.inField[yi * r.w + xi]) return null;
    let bx = ex, by = ey, bg = -1;
    for (let a = -sa; a <= sa; a += 1) for (let c = -sc; c <= sc; c += 1) {
      const x = Math.round(ex + a * ux + c * nx), y = Math.round(ey + a * uy + c * ny);
      if (x < 0 || y < 0 || x >= r.w || y >= r.h) continue;
      const g = G[y * r.w + x];
      if (g > bg) { bg = g; bx = x; by = y; }
    }
    if (bg < P.presentGreen) return { x: ex, y: ey, g: -1 };
    // Close to the layout itself, not only to the neighbours: a row may not turn into another planting.
    const offA = (bx - lx) * ux + (by - ly) * uy, offC = (bx - lx) * nx + (by - ly) * ny;
    if (Math.abs(offA) > P.maxOffAlong * L.along || Math.abs(offC) > P.maxOffAcross * Math.abs(L.across)) return { x: ex, y: ey, g: -1 };
    if (separate) {
      for (const di of [-1, 1]) {
        const q = plant.get(key(i + di, j));
        if (!q) continue;
        const mx = Math.round((q.x + bx) / 2), my = Math.round((q.y + by) / 2);
        if (mx >= 0 && my >= 0 && mx < r.w && my < r.h && G[my * r.w + mx] > P.stripShare * Math.min(bg, q.g)) return { x: ex, y: ey, g: -1 };
      }
    }
    return { x: bx, y: by, g: bg };
  };
  const queue: [number, number, number, number][] = []; // i, j, empties in a row leading here (along the row), 1 when reached across rows
  const seen = new Set<string>();
  for (const [i, j] of seeds) { queue.push([i, j, 0, 0]); seen.add(key(i, j)); }
  const gapAt = new Map<string, { x: number; y: number }>();
  let sinceRefit = 0;
  while (queue.length) {
    const [i, j, empties, across] = queue.shift()!;
    const q = look(i, j);
    if (!q) continue;
    // Entering a row from the next one: a neighbour along this row must also hold a plant on the layout.
    if (across && q.g >= 0 && ![-1, 1].some(di => { const v = look(i + di, j); return v != null && v.g >= 0; })) { seen.delete(key(i, j)); continue; }
    if (q.g < 0) {
      missing.set(key(i, j), empties + 1);
      gapAt.set(key(i, j), { x: q.x, y: q.y });
      if (empties + 1 > P.segmentMaxMissing || across) continue;
      for (const di of [-1, 1]) { const k = key(i + di, j); if (!seen.has(k)) { seen.add(k); queue.push([i + di, j, empties + 1, 0]); } }
      continue;
    }
    plant.set(key(i, j), q);
    if (++sinceRefit >= P.refitEvery) {
      sinceRefit = 0;
      L = latticeFromPlants([...plant.entries()].map(([k, v]) => { const [a, b] = k.split(",").map(Number); return { i: a, j: b, x: v.x, y: v.y }; }), L);
    }
    for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const k = key(i + di, j + dj);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push([i + di, j + dj, 0, dj ? 1 : 0]);
    }
  }
  // Rows from what grew: runs of plants along each row, with the gaps between them; short runs dropped.
  const byRow = new Map<number, number[]>();
  for (const k of plant.keys()) { const [i, j] = k.split(",").map(Number); (byRow.get(j) ?? byRow.set(j, []).get(j)!).push(i); }
  const plants: LayoutPlant[] = [], gaps: LayoutGap[] = [];
  let rows = 0, expected = 0, found = 0, run = 0;
  for (const [j, is] of byRow) {
    is.sort((a, b) => a - b);
    let cur: number[] = [is[0]];
    const regular = (is2: number[]): boolean => {
      // The stretch's own line through its plants, its direction against the layout's, and how evenly it steps.
      const pts = is2.map(i => plant.get(key(i, j))!);
      const mx = pts.reduce((a, q) => a + q.x, 0) / pts.length, my = pts.reduce((a, q) => a + q.y, 0) / pts.length;
      let sxx = 0, syy = 0, sxy = 0;
      for (const q of pts) { sxx += (q.x - mx) ** 2; syy += (q.y - my) ** 2; sxy += (q.x - mx) * (q.y - my); }
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      let turn = Math.abs(th - L.angle) % Math.PI;
      if (turn > Math.PI / 2) turn = Math.PI - turn;
      if (turn > (P.runAngleDeg * Math.PI) / 180) return false;
      const vx = -Math.sin(th), vy = Math.cos(th);
      const rms = Math.sqrt(pts.reduce((a, q) => a + ((q.x - mx) * vx + (q.y - my) * vy) ** 2, 0) / pts.length);
      if (rms > P.runLateralShare * Math.abs(L.across)) return false;
      let ok = 0, steps = 0;
      for (let k = 1; k < is2.length; k++) {
        const a = pts[k - 1], b = pts[k], d = Math.hypot(b.x - a.x, b.y - a.y), n2 = is2[k] - is2[k - 1];
        steps++;
        if (Math.abs(d - n2 * L.along) <= P.runStepShare * L.along) ok++;
      }
      return steps > 0 && ok / steps >= P.runRegularShare;
    };
    const flush = () => {
      const n = cur.length;
      if (n >= P.minPlants && regular(cur)) {
        const span = cur[n - 1] - cur[0] + 1;
        if (n / span >= P.minRowShare) {
          rows++; run++; expected += span; found += n;
          for (let i = cur[0]; i <= cur[n - 1]; i++) {
            const q = plant.get(key(i, j));
            if (q) plants.push({ x: q.x, y: q.y, r: crownRadius(r, q.x, q.y, rmax), row: j, i, run });
            else { const g = gapAt.get(key(i, j)); const [lx, ly] = latticePoint(L, i, j); gaps.push({ x: g?.x ?? lx, y: g?.y ?? ly, row: j, i }); }
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

/** The whole fit: refine near the clicks, then grow the planting from them. */
export function fitLayout(L0: Lattice, r: LayoutRaster): FittedLayout {
  const G = boxMean(r, LAYOUT_PARAMS.crownShare * L0.along);
  const { lattice, score } = refineLattice(L0, G, r);
  const G2 = Math.abs(lattice.along - L0.along) > 0.05 * L0.along ? boxMean(r, LAYOUT_PARAMS.crownShare * lattice.along) : G;
  // The seeds: the lattice positions nearest the three clicks (the refined origin may have moved by a plant).
  const { e1, e2 } = basis(lattice);
  const det = e1[0] * e2[1] - e1[1] * e2[0];
  const ij = (x: number, y: number): [number, number] => { const dx = x - lattice.ox, dy = y - lattice.oy; return [Math.round((dx * e2[1] - dy * e2[0]) / det), Math.round((e1[0] * dy - e1[1] * dx) / det)]; };
  const [b0, b1] = [L0.ox + L0.along * Math.cos(L0.angle), L0.oy + L0.along * Math.sin(L0.angle)];
  const c0 = latticePoint(L0, 0, 1);
  const seeds = [ij(L0.ox, L0.oy), ij(b0, b1), ij(c0[0], c0[1])];
  const t = growPlants(lattice, G2, r, seeds, plantsStandApart(lattice, G2, r));
  return { score, ...t };
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
export function layoutToFieldRows(f: FittedLayout, r: LayoutRaster): (FieldRows & { source: "layout"; gaps: { x: number; y: number }[] }) | null {
  if (!f.rows) return null;
  const k = r.scale;
  const spacing = Math.abs(f.lattice.across) * k, step = f.lattice.along * k;
  const radii = f.plants.map(p => p.r * k).sort((a, b) => a - b);
  const plantR = radii[radii.length >> 1] ?? 0;
  const band = Math.min(Math.max(plantR, ROW_BAND_PITCH_SHARE * spacing), 0.35 * spacing);
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
    ctx: { lines, crops: f.plants.map(p => ({ x: p.x * k, y: p.y * k, r: p.r * k })), bandPx: band, gsdM: mppFrame },
    rows: f.rows, spacingM: spacing * mppFrame, seedSpacingM: step * mppFrame,
    directionDeg: ((((f.lattice.angle * 180) / Math.PI) % 180) + 180) % 180, blocks: 1,
    source: "layout", gaps: f.gaps.map(g => ({ x: g.x * k, y: g.y * k })),
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
