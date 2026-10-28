// Automatic cultivated-block boundary inference for the Field Twin (Swardus Direct): where the planting ends,
// from the reconciled crop rows and trees, refined on what the photographs show at the edges. No one draws it.
//
// Three boundaries are kept apart and never substituted for one another:
//   cultivated   the inferred block, this module's output: evidence-based, with its uncertainty and failure cases
//   imagery      the ground the photographs cover (intelligence.ts imageryHull): where anything can be known at all
//   operational  a boundary the operator accepted or corrected (operationalBoundary): the only one an operation
//                may ever be limited by; an inferred boundary is never promoted to it automatically
//
// The method, in the order it runs:
//   1. Reliable rows: kept rows with enough observed trees and photographs, at the field's pitch. An outer row
//      whose offset from its neighbour is off the pitch is excluded (on the apricot field that row was the hedge).
//   2. Row geometry: the planting direction, the median row pitch, each row's first and last observed tree.
//   3. The row-aligned boundary: each row's strip reaches half a pitch across; its ends reach a margin beyond the
//      last trees. Without photographs the margin is half a plant spacing (the planter's own margin).
//   4. A concave baseline (morphological closing of the on-row trees) is computed for comparison, never used as
//      the boundary: it says how much the row geometry and a shape-only reading agree.
//   5. Photographs: from each row end and along each outer row, a probe walks outward over the evidence raster
//      and stops at the first ground that is not the field's own: another crop or dense cover, a road or track,
//      trees off the field's rows (a hedge, another planting), or ground no photograph saw. A probe that meets
//      nothing stops at a cap and says so.
//   6. Every vertex carries what stopped it and an uncertainty; the area carries the sum of them.
// Everything is deterministic for the same inputs and runs in milliseconds on a field of a thousand trees.
import { EV, type EvidenceClass, EVIDENCE_CLASSES, type EvidenceRaster, evidenceAt } from "./boundaryEvidence";
import { type LocalFrame, chainEdges, convexHull, localFrame, pointInRing, roundCorners } from "./intelligence";
import type { LatLngPair, TwinBundle } from "./types";

export type FieldPoint = [number, number];

/** What a vertex of the boundary stands on. */
export type BoundarySupport =
  /** A probe met a field edge in the photographs (see `stoppedBy`). */
  | "photographs"
  /** No photographs were read; the margin is the planting's own (half a spacing). */
  | "default"
  /** The photographs end here: the field may continue beyond, unseen. */
  | "coverage"
  /** The probe met nothing within its cap: the edge is further than the cap, or not visible. */
  | "cap"
  /** The probe met nothing, but most of this side met an edge at one distance: that edge is taken to continue
   * through here (a hedge between its crowns, another planting's row between the trees that were reconciled). */
  | "bridged";

export type BoundaryVertex = {
  along: number;
  across: number;
  /** Which part of the block the vertex belongs to: a row end (first or last along) or an outer side. */
  side: "end0" | "end1" | "side0" | "side1";
  /** The row the vertex stands on (its id), for the ends; the outer row for the sides. */
  rowId: number;
  support: BoundarySupport;
  stoppedBy: EvidenceClass | null;
  /** How far beyond the last tree (ends) or the row line (sides) the vertex sits, metres. */
  marginM: number;
  /** Half-width of the plausible range of this edge's position, metres. For coverage and cap: the margin itself
   * (the edge is at least here; how much further is unknown). */
  uncertaintyM: number;
};

export type BoundaryOptions = {
  /** Fewest observed trees and photographs for a row to count. */
  minTrees: number;
  minPhotos: number;
  /** An outer row further from its neighbour than this share of the median pitch is excluded. */
  pitchTolerance: number;
  /** The probes' step, metres (the evidence raster's cell at most). */
  stepM: number;
  /** Row ends: a probe gives up after this many row pitches beyond the last tree. */
  endCapPitches: number;
  /** Outer sides: after this many pitches beyond the row line. */
  sideCapPitches: number;
  /** Side probes every this many metres along the outer rows (the plant spacing by default). */
  probeEveryM: number | null;
  /** Vertices closer than this to the line between their neighbours are dropped (Douglas-Peucker), metres. */
  simplifyM: number;
  /** A probe's window across its direction, as a share of the row pitch (ends) or plant spacing (sides). */
  windowShare: number;
  /** Outer sides: an edge met by a probe bounds the probes within this many plant spacings of it. */
  sideReachSpacings: number;
};

export const BOUNDARY_DEFAULTS: BoundaryOptions = { minTrees: 4, minPhotos: 2, pitchTolerance: 0.15, stepM: 0.25, endCapPitches: 3, sideCapPitches: 1.5, probeEveryM: null, simplifyM: 0.3, windowShare: 0.7, sideReachSpacings: 6 };

export type BoundaryBaseline = { ringField: FieldPoint[]; areaM2: number };

export type BoundaryResult = {
  /** The cultivated block, local metres (east, north) about the twin's origin, and in the field frame. */
  ring: FieldPoint[];
  ringField: FieldPoint[];
  ringLatLng: LatLngPair[];
  vertices: BoundaryVertex[];
  areaM2: number;
  /** Half-width of the area's plausible range: the sum over edges of length times the vertices' uncertainty. */
  uncertaintyM2: number;
  method: "rows and photographs" | "rows only";
  rowsUsed: number[];
  rowsExcluded: { id: number; reason: string }[];
  /** Diagnosed failure cases: what the boundary could not settle, in words. Empty when nothing was found. */
  failures: string[];
  stats: {
    rowPitchM: number;
    plantSpacingM: number;
    extentAlongM: number;
    extentAcrossM: number;
    endMarginM: { median: number; min: number; max: number };
    sideMarginM: { median: number; min: number; max: number };
    /** Share of vertices by support. */
    support: Record<BoundarySupport, number>;
    stoppedBy: Partial<Record<EvidenceClass, number>>;
    treesInside: number;
    /** Trees on the rows that stand in dense cover (wheat, a hedge) and were not used. */
    treesInCover: number;
    /** Trees trimmed from row ends as runs beyond a gap. */
    treesTrimmed: number;
    onRowTreesOutside: number;
    offRowTreesOutside: number;
    /** Shares of the block's ground by evidence class (null without photographs). */
    inside: Record<EvidenceClass, number> | null;
  };
  baselines: { rowAligned: BoundaryBaseline; concave: (BoundaryBaseline & { overlapShare: number }) | null };
  processingMs: number;
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const r2 = (x: number) => Math.round(x * 100) / 100;

export const polygonArea = (ring: FieldPoint[]) => Math.abs(ring.reduce((s, [x, y], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return s + x * y2 - x2 * y; }, 0)) / 2;

/** Douglas-Peucker on a closed ring, returning the kept indices (always at least 3). */
export function simplifyRing(ring: FieldPoint[], tolM: number): number[] {
  const n = ring.length;
  if (n <= 3) return ring.map((_, i) => i);
  const keep = new Uint8Array(n);
  // Anchor on the two points furthest apart, then recurse on both arcs.
  let a = 0, b = 0, bd = -1;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = (ring[i][0] - ring[j][0]) ** 2 + (ring[i][1] - ring[j][1]) ** 2; if (d > bd) { bd = d; a = i; b = j; } }
  keep[a] = keep[b] = 1;
  const dist = (p: FieldPoint, q: FieldPoint, r: FieldPoint) => { const dx = r[0] - q[0], dy = r[1] - q[1], L = dx * dx + dy * dy; if (!L) return Math.hypot(p[0] - q[0], p[1] - q[1]); const t = Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / L)); return Math.hypot(p[0] - q[0] - t * dx, p[1] - q[1] - t * dy); };
  const rec = (i0: number, i1: number) => {
    // Arc from i0 to i1 going forward (wrapping).
    let best = -1, bdist = tolM;
    for (let k = (i0 + 1) % n; k !== i1; k = (k + 1) % n) { const d = dist(ring[k], ring[i0], ring[i1]); if (d > bdist) { bdist = d; best = k; } }
    if (best >= 0) { keep[best] = 1; rec(i0, best); rec(best, i1); }
  };
  rec(a, b); rec(b, a);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  if (out.length < 3) { // a degenerate ring: keep the furthest third point
    let c = -1, cd = -1;
    for (let i = 0; i < n; i++) { if (keep[i]) continue; const d = dist(ring[i], ring[a], ring[b]); if (d > cd) { cd = d; c = i; } }
    if (c >= 0) { keep[c] = 1; out.length = 0; for (let i = 0; i < n; i++) if (keep[i]) out.push(i); }
  }
  return out;
}

type RowGeom = { id: number; across: number; a0: number; a1: number; trees: number; photos: number; /** Trees trimmed from the row's ends: runs beyond a gap that are too small to be the row itself. */ trimmed: { ids: number[]; end: "start" | "end"; gapM: number } | null };

/** Trees split into runs at gaps wider than `gapSpacings` plant spacings (sorted by along). */
function runsOf<T extends { along: number }>(trees: T[], S: number, gapSpacings: number): T[][] {
  const sorted = [...trees].sort((a, b) => a.along - b.along);
  const runs: T[][] = [];
  for (const t of sorted) {
    const last = runs[runs.length - 1];
    if (!last || t.along - last[last.length - 1].along > gapSpacings * S) runs.push([t]); else last.push(t);
  }
  return runs;
}

/**
 * The kept rows' geometry from the trees that stand on them (the bundle's line less its half-spacing margins when
 * a row has no trees). A row is a connected planting on one line: a run of trees at either end that lies beyond
 * a gap of more than 2.5 spacings is the row's own only if it sits on the row's line (within half a metre, not
 * drifting across by more than a metre); otherwise it is something else strung onto the line (on the apricot
 * field, another planting's rows crossing it at an angle) and is trimmed and reported. A run on the line stays
 * however small: missing trees make gaps, not ends.
 */
function rowGeometry(twin: TwinBundle, fr: LocalFrame, excludeTrees: Set<number> = new Set()): RowGeom[] {
  const S = twin.field.plantSpacingM, half = S / 2;
  const byRow = new Map<number, { id: number; along: number; across: number }[]>();
  for (const t of twin.trees) {
    if (t.rowId == null || excludeTrees.has(t.id)) continue;
    const [al, ac] = fr.toField(...fr.toLocal(t.lat, t.lng));
    (byRow.get(t.rowId) ?? byRow.set(t.rowId, []).get(t.rowId)!).push({ id: t.id, along: al, across: ac });
  }
  const out: RowGeom[] = [];
  for (const r of twin.rows) {
    if (!r.kept || r.line.length < 2) continue;
    const trees = byRow.get(r.id);
    if (trees && trees.length) {
      let runs = runsOf(trees, S, 2.5);
      let trimmed: RowGeom["trimmed"] = null;
      const trimmedIds: number[] = [];
      let end: "start" | "end" = "start", gapM = 0;
      // The row's line is its largest run; an end run off that line is peeled, repeatedly.
      const bulk = runs.reduce((a, b) => (b.length > a.length ? b : a));
      const lineAcross = median(bulk.map(t => t.across));
      const onLine = (run: typeof bulk) => { const ac = run.map(t => t.across); return Math.abs(median(ac) - lineAcross) <= 0.5 && Math.max(...ac) - Math.min(...ac) <= 1; };
      for (;;) {
        if (runs.length < 2) break;
        const first = runs[0], last = runs[runs.length - 1];
        if (first !== bulk && !onLine(first)) { trimmedIds.push(...first.map(t => t.id)); end = "start"; gapM = runs[1][0].along - first[first.length - 1].along; runs = runs.slice(1); continue; }
        if (last !== bulk && !onLine(last)) { trimmedIds.push(...last.map(t => t.id)); end = "end"; gapM = last[0].along - runs[runs.length - 2][runs[runs.length - 2].length - 1].along; runs = runs.slice(0, -1); continue; }
        break;
      }
      if (trimmedIds.length) trimmed = { ids: trimmedIds, end, gapM };
      const kept = runs.flat();
      out.push({ id: r.id, across: median(kept.map(t => t.across)), a0: Math.min(...kept.map(t => t.along)), a1: Math.max(...kept.map(t => t.along)), trees: kept.length, photos: r.photos, trimmed });
    } else {
      const ends = r.line.map(([lat, lng]) => fr.toField(...fr.toLocal(lat, lng)));
      out.push({ id: r.id, across: ends.reduce((s, p) => s + p[1], 0) / ends.length, a0: Math.min(...ends.map(p => p[0])) + half, a1: Math.max(...ends.map(p => p[0])) - half, trees: r.trees, photos: r.photos, trimmed: null });
    }
  }
  return out.sort((p, q) => p.across - q.across);
}

type Probe = { marginM: number; support: BoundarySupport; stoppedBy: EvidenceClass | null };

/**
 * Walk outward from (along, across) in direction (dx, dy) (a unit vector in the field frame) over the evidence,
 * `halfWindow` metres wide across the walk, and stop at the first step whose window is mostly not the field's
 * own ground. The field's own ground is soil and canopy. Returns the distance walked and what stopped it.
 */
function probe(ev: EvidenceRaster | null, along: number, across: number, dx: number, dy: number, halfWindow: number, minM: number, capM: number, stepM: number, defaultM: number): Probe {
  if (!ev) return { marginM: defaultM, support: "default", stoppedBy: null };
  const wx = -dy, wy = dx;
  const nw = Math.max(1, Math.round(halfWindow / ev.cellM));
  const count = [0, 0, 0, 0, 0, 0];
  for (let d = stepM; d <= capM + 1e-9; d += stepM) {
    count.fill(0);
    let n = 0;
    for (let k = -nw; k <= nw; k++) {
      const off = (k * halfWindow) / nw;
      count[evidenceAt(ev, along + d * dx + off * wx, across + d * dy + off * wy)]++;
      n++;
    }
    const field = count[EV.soil] + count[EV.canopy];
    if (d < minM) continue;
    if (field * 2 >= n) continue;
    // Stopped: by the commonest non-field class in the window.
    let best = EV.unseen, bn = -1;
    for (const k of [EV.cover, EV.road, EV.foreign, EV.unseen]) if (count[k] > bn) { bn = count[k]; best = k; }
    const stoppedBy = EVIDENCE_CLASSES[best];
    return { marginM: Math.max(0, d - stepM), support: best === EV.unseen ? "coverage" : "photographs", stoppedBy };
  }
  return { marginM: capM, support: "cap", stoppedBy: null };
}

/** Supports from the firmest to the weakest. */
const SUPPORT_RANK: Record<BoundarySupport, number> = { photographs: 0, bridged: 1, coverage: 2, cap: 3, default: 4 };
const uncertaintyOf = (p: Probe, cellM: number): number => (p.support === "photographs" ? Math.max(0.5, 2 * cellM) : p.support === "default" ? p.marginM / 2 : p.marginM);
/** Share of a side's probes that must have met an edge for the capped ones between them to be bridged. */
const BRIDGE_SHARE = 0.5;

/** The closed shape of the on-row trees: a disc of radius R grown and shrunk again (morphological closing) on a raster, traced to a ring. Null with too few trees. */
export function concaveBaseline(treesField: FieldPoint[], radiusM: number, cellM = 0.5): BoundaryBaseline | null {
  if (treesField.length < 3) return null;
  const pad = radiusM + 2 * cellM;
  const x0 = Math.min(...treesField.map(p => p[0])) - pad, y0 = Math.min(...treesField.map(p => p[1])) - pad;
  const W = Math.ceil((Math.max(...treesField.map(p => p[0])) + pad - x0) / cellM), H = Math.ceil((Math.max(...treesField.map(p => p[1])) + pad - y0) / cellM);
  const r = Math.ceil(radiusM / cellM), rr = radiusM * radiusM;
  const disc: [number, number][] = [];
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if ((di * cellM) ** 2 + (dj * cellM) ** 2 <= rr) disc.push([di, dj]);
  const grown = new Uint8Array(W * H);
  for (const [x, y] of treesField) {
    const i = Math.floor((x - x0) / cellM), j = Math.floor((y - y0) / cellM);
    for (const [di, dj] of disc) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < W && jj < H) grown[jj * W + ii] = 1; }
  }
  // Shrink: a cell stays only when its whole disc is grown.
  const closed = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!grown[j * W + i]) continue;
    let ok = true;
    for (const [di, dj] of disc) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H || !grown[jj * W + ii]) { ok = false; break; } }
    closed[j * W + i] = ok ? 1 : 0;
  }
  // The largest 4-connected component, then its outer edges chained into a ring.
  const comp = new Int32Array(W * H).fill(-1);
  let bestComp = -1, bestN = 0, nComp = 0;
  const stack: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (!closed[s] || comp[s] >= 0) continue;
    let n = 0;
    stack.length = 0; stack.push(s); comp[s] = nComp;
    while (stack.length) {
      const c = stack.pop()!; n++;
      const i = c % W, j = (c - i) / W;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue; const q = jj * W + ii; if (closed[q] && comp[q] < 0) { comp[q] = nComp; stack.push(q); } }
    }
    if (n > bestN) { bestN = n; bestComp = nComp; }
    nComp++;
  }
  if (bestComp < 0) return null;
  const edges: [FieldPoint, FieldPoint][] = [];
  const corner = (i: number, j: number): FieldPoint => [x0 + i * cellM, y0 + j * cellM];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (comp[j * W + i] !== bestComp) continue;
    const isIn = (ii: number, jj: number) => ii >= 0 && jj >= 0 && ii < W && jj < H && comp[jj * W + ii] === bestComp;
    if (!isIn(i + 1, j)) edges.push([corner(i + 1, j), corner(i + 1, j + 1)]);
    if (!isIn(i - 1, j)) edges.push([corner(i, j + 1), corner(i, j)]);
    if (!isIn(i, j + 1)) edges.push([corner(i + 1, j + 1), corner(i, j + 1)]);
    if (!isIn(i, j - 1)) edges.push([corner(i, j), corner(i + 1, j)]);
  }
  const rings = chainEdges(edges);
  if (!rings.length) return null;
  const smooth = roundCorners(rings[0], 2);
  const keep = simplifyRing(smooth, cellM * 0.6);
  const ringField = keep.map(k => smooth[k]);
  return { ringField, areaM2: polygonArea(ringField) };
}

/** Share of a raster sample of `a` that is also inside `b` and the reverse, combined as intersection over union. */
function overlapShare(a: FieldPoint[], b: FieldPoint[], cellM = 1): number {
  const pts = [...a, ...b];
  const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
  let both = 0, either = 0;
  for (let y = y0 + cellM / 2; y < y1; y += cellM) for (let x = x0 + cellM / 2; x < x1; x += cellM) {
    const ia = pointInRing(x, y, a), ib = pointInRing(x, y, b);
    if (ia && ib) both++;
    if (ia || ib) either++;
  }
  return either ? both / either : 0;
}

/**
 * Step 1: the rows the boundary may stand on. Kept rows with enough observed trees and photographs; then an outer
 * row whose offset from its neighbour is off the planting's pitch is excluded (a hedge, a stray line of trees).
 * With an evidence raster the exclusion says what the photographs show along that row. `excludeTrees` are trees
 * found standing in dense cover (see inferBoundary); they count for nothing here.
 */
export function reliableRows(twin: TwinBundle, evidence: EvidenceRaster | null = null, options: Partial<BoundaryOptions> = {}, excludeTrees: Set<number> = new Set(), fr: LocalFrame = localFrame(twin)): { rows: RowGeom[]; excluded: { id: number; reason: string }[]; pitch: number; /** Trees trimmed from row ends (ids), by row. */ trimmed: { rowId: number; ids: number[]; end: "start" | "end"; gapM: number }[] } {
  const o = { ...BOUNDARY_DEFAULTS, ...options };
  const geoms = rowGeometry(twin, fr, excludeTrees);
  const excluded: { id: number; reason: string }[] = [];
  let rows = geoms.filter(g => {
    if (g.trees < o.minTrees) { excluded.push({ id: g.id, reason: `${g.trees} reliable observed trees (${o.minTrees} needed)` }); return false; }
    if (g.photos < o.minPhotos) { excluded.push({ id: g.id, reason: `seen in ${g.photos} photograph (${o.minPhotos} needed)` }); return false; }
    return true;
  });
  const gaps = rows.slice(1).map((r, i) => r.across - rows[i].across);
  const pitch = gaps.length ? median(gaps) : twin.field.rowSpacingM;
  for (const end of ["first", "last"] as const) {
    while (rows.length >= 3) {
      const r = end === "first" ? rows[0] : rows[rows.length - 1], nb = end === "first" ? rows[1] : rows[rows.length - 2];
      const gap = Math.abs(r.across - nb.across);
      if (Math.abs(gap - pitch) <= o.pitchTolerance * pitch) break;
      let why = `${r2(gap)} m from row ${nb.id} against a ${r2(pitch)} m pitch`;
      if (evidence) {
        const count = [0, 0, 0, 0, 0, 0];
        for (let a = r.a0; a <= r.a1; a += 1) count[evidenceAt(evidence, a, r.across)]++;
        const total = count.reduce((s, v) => s + v, 0);
        const other = count[EV.cover] + count[EV.foreign] + count[EV.road];
        if (total && other * 2 >= total) why += `; the photographs show a hedge, another planting or a track along ${Math.round((100 * other) / total)} % of its line`;
      }
      excluded.push({ id: r.id, reason: `outer row off the pitch: ${why}` });
      rows = end === "first" ? rows.slice(1) : rows.slice(0, -1);
    }
  }
  const trimmed = geoms.filter(g => g.trimmed).map(g => ({ rowId: g.id, ...g.trimmed! }));
  return { rows, excluded, pitch, trimmed };
}

/**
 * Trees on the rows that stand in dense cover: the ground around the crown (half a metre to two metres out) is
 * mostly cover in the photographs. A real orchard tree has an alley of soil around it; a "tree" the reconciliation
 * strung into a wheat field, or a hedge tree, does not. Returns their ids.
 */
export function treesInCover(twin: TwinBundle, evidence: EvidenceRaster, fr: LocalFrame = localFrame(twin), share = 0.7): Set<number> {
  const out = new Set<number>();
  for (const t of twin.trees) {
    if (t.rowId == null) continue;
    const [al, ac] = fr.toField(...fr.toLocal(t.lat, t.lng));
    const r0 = t.crownRadiusM + 0.5, r1 = t.crownRadiusM + 2;
    let cover = 0, n = 0;
    for (let k = 0; k < 24; k++) for (const rr of [r0, (r0 + r1) / 2, r1]) {
      const th = (k * Math.PI) / 12;
      const c = evidenceAt(evidence, al + rr * Math.cos(th), ac + rr * Math.sin(th));
      if (c === EV.unseen) continue;
      n++;
      if (c === EV.cover || c === EV.foreign) cover++;
    }
    if (n >= 24 && cover / n >= share) out.add(t.id);
  }
  return out;
}

/**
 * The cultivated block of a twin. With an evidence raster the row ends and the outer sides are refined on the
 * photographs; without one the boundary is the rows' own geometry with half-spacing margins, every vertex
 * marked "default". Null when the twin has no reliable row.
 */
export function inferBoundary(twin: TwinBundle, evidence: EvidenceRaster | null = null, options: Partial<BoundaryOptions> = {}): BoundaryResult | null {
  const t0 = now();
  const o = { ...BOUNDARY_DEFAULTS, ...options };
  const fr = localFrame(twin);
  const S = twin.field.plantSpacingM;
  const failures: string[] = [];

  // 1. Reliable crop objects and rows.
  const unreliable = evidence ? treesInCover(twin, evidence, fr) : new Set<number>();
  const { rows, excluded: rowsExcluded, pitch, trimmed } = reliableRows(twin, evidence, o, unreliable, fr);
  if (!rows.length) return null;
  const halfPitch = pitch / 2, halfS = S / 2;
  const cellM = evidence?.cellM ?? o.stepM;
  const stepM = Math.min(o.stepM, cellM);

  // 3 and 5. Row ends: a probe from each row's last tree, along the row, in a window the row's strip wide.
  const vertices: BoundaryVertex[] = [];
  const endCap = o.endCapPitches * pitch, sideCap = o.sideCapPitches * pitch;
  const endWin = o.windowShare * halfPitch, sideWin = o.windowShare * halfS;
  const ends0: BoundaryVertex[] = [], ends1: BoundaryVertex[] = [];
  // A row whose probe meets nothing within the cap may simply be short (trees missing at its end): it is walked
  // again as far as its neighbouring rows' ends plus a pitch, and only a probe that meets nothing there is capped.
  const endProbe = (r: RowGeom, i: number, dir: -1 | 1): Probe => {
    const from = dir < 0 ? r.a0 : r.a1;
    const first = probe(evidence, from, r.across, dir, 0, endWin, 0, endCap, stepM, halfS);
    if (first.support !== "cap") return first;
    const further = Math.max(0, ...[rows[i - 1], rows[i + 1]].filter(Boolean).map(q => (dir < 0 ? from - q.a0 : q.a1 - from)));
    if (further <= 0) return first;
    return probe(evidence, from, r.across, dir, 0, endWin, 0, Math.max(endCap, further + pitch), stepM, halfS);
  };
  rows.forEach((r, i) => {
    const p0 = endProbe(r, i, -1), p1 = endProbe(r, i, 1);
    ends0.push({ along: r.a0 - p0.marginM, across: r.across, side: "end0", rowId: r.id, support: p0.support, stoppedBy: p0.stoppedBy, marginM: p0.marginM, uncertaintyM: uncertaintyOf(p0, cellM) });
    ends1.push({ along: r.a1 + p1.marginM, across: r.across, side: "end1", rowId: r.id, support: p1.support, stoppedBy: p1.stoppedBy, marginM: p1.marginM, uncertaintyM: uncertaintyOf(p1, cellM) });
  });
  // Outer sides: probes along the outer rows, across them, every plant spacing; medians of three against speckle.
  const sideOf = (r: RowGeom, dir: -1 | 1, side: "side0" | "side1"): BoundaryVertex[] => {
    const every = o.probeEveryM ?? S;
    const n = Math.max(2, Math.round((r.a1 - r.a0) / every) + 1);
    const raw: { along: number; p: Probe }[] = [];
    for (let k = 0; k < n; k++) {
      const along = r.a0 + ((r.a1 - r.a0) * k) / (n - 1);
      raw.push({ along, p: probe(evidence, along, r.across, 0, dir, sideWin, 0, sideCap, stepM, halfPitch) });
    }
    // An edge feature met by any probe within a few plant spacings bounds its neighbours too (a row of trees of
    // another planting whose crowns were only partly reconciled, a hedge with gaps between its crowns): each probe
    // takes the nearest stop within `sideReachSpacings` plant spacings, then a median of three against speckle.
    // Without photographs every margin is the default.
    const reach = Math.max(1, Math.round((o.sideReachSpacings * S) / every));
    const nearest = raw.map((_, k) => { let best = raw[k]; for (let q = Math.max(0, k - reach); q <= Math.min(n - 1, k + reach); q++) if (raw[q].p.marginM < best.p.marginM) best = raw[q]; return best; });
    // Where most of the side met an edge in the photographs, that edge continues through the capped stretches
    // between (bridged, with the gap between the cap and the edge as the uncertainty).
    const met = nearest.filter(y => y.p.support === "photographs").map(y => y.p.marginM);
    const consensus = met.length >= BRIDGE_SHARE * n ? median(met) : null;
    return raw.map((x, k) => {
      const trio = [nearest[Math.max(0, k - 1)], nearest[k], nearest[Math.min(n - 1, k + 1)]];
      const m = median(trio.map(y => y.p.marginM));
      const src = trio.find(y => y.p.marginM === m) ?? nearest[k];
      if (src.p.support === "cap" && consensus != null && consensus < m) return { along: x.along, across: r.across + dir * consensus, side, rowId: r.id, support: "bridged" as const, stoppedBy: null, marginM: consensus, uncertaintyM: m - consensus };
      return { along: x.along, across: r.across + dir * m, side, rowId: r.id, support: src.p.support, stoppedBy: src.p.stoppedBy, marginM: m, uncertaintyM: uncertaintyOf(src.p, cellM) };
    });
  };
  const side0 = sideOf(rows[0], -1, "side0");
  const side1 = sideOf(rows[rows.length - 1], 1, "side1");
  // The ring: along side0 forward, up the last ends, back along side1, down the first ends. The side probes stand
  // on the outer rows' tree spans; the end vertices of the outer rows close the corners.
  // A corner joins a row end and an outer side: it stands on the weaker of the two.
  const corner = (v: BoundaryVertex, side: BoundaryVertex, along: number, across: number): BoundaryVertex => {
    const weak = SUPPORT_RANK[side.support] > SUPPORT_RANK[v.support] ? side : v;
    return { ...weak, along, across };
  };
  const ringV: BoundaryVertex[] = [
    corner(ends0[0], side0[0], ends0[0].along, side0[0].across),
    ...side0,
    corner(ends1[0], side0[side0.length - 1], ends1[0].along, side0[side0.length - 1].across),
    ...ends1.slice(1, -1),
    corner(ends1[ends1.length - 1], side1[side1.length - 1], ends1[ends1.length - 1].along, side1[side1.length - 1].across),
    ...side1.slice().reverse(),
    corner(ends0[ends0.length - 1], side1[0], ends0[ends0.length - 1].along, side1[0].across),
    ...ends0.slice(1, -1).reverse(),
  ];
  // Simplified on geometry, but a vertex where the support changes is always kept: the edge colours and the
  // uncertainty are per vertex, and a straight side half seen and half bridged must stay two edges.
  const keepSet = new Set(simplifyRing(ringV.map(v => [v.along, v.across] as FieldPoint), o.simplifyM));
  for (let i = 0; i < ringV.length; i++) { const p = ringV[(i + ringV.length - 1) % ringV.length], q = ringV[(i + 1) % ringV.length]; if (ringV[i].support !== p.support || ringV[i].support !== q.support) keepSet.add(i); }
  const kept = [...keepSet].sort((a, b) => a - b).map(k => ringV[k]);
  vertices.push(...kept);
  const ringField = kept.map(v => [v.along, v.across] as FieldPoint);
  const ring = ringField.map(([al, ac]) => fr.fromField(al, ac));
  const ringLatLng = ring.map(([e, n]) => fr.toLatLng(e, n));
  const areaM2 = polygonArea(ringField);
  let uncertaintyM2 = 0;
  for (let i = 0; i < kept.length; i++) { const a = kept[i], b = kept[(i + 1) % kept.length]; uncertaintyM2 += Math.hypot(a.along - b.along, a.across - b.across) * ((a.uncertaintyM + b.uncertaintyM) / 2); }

  // Baselines.
  const rowAlignedRing: FieldPoint[] = [];
  rows.forEach((r, i) => { const lo = i === 0 ? r.across - halfPitch : (r.across + rows[i - 1].across) / 2, hi = i === rows.length - 1 ? r.across + halfPitch : (r.across + rows[i + 1].across) / 2; rowAlignedRing.push([r.a0 - halfS, lo], [r.a0 - halfS, hi]); });
  const right: FieldPoint[] = [];
  rows.forEach((r, i) => { const lo = i === 0 ? r.across - halfPitch : (r.across + rows[i - 1].across) / 2, hi = i === rows.length - 1 ? r.across + halfPitch : (r.across + rows[i + 1].across) / 2; right.push([r.a1 + halfS, lo], [r.a1 + halfS, hi]); });
  const rowAligned = { ringField: [...rowAlignedRing, ...right.reverse()], areaM2: 0 };
  rowAligned.areaM2 = polygonArea(rowAligned.ringField);
  const rowIds = new Set(rows.map(r => r.id));
  const onRowField: FieldPoint[] = [], offRowField: FieldPoint[] = [];
  const trimmedAll = new Set(trimmed.flatMap(t => t.ids));
  for (const t of twin.trees) { if (unreliable.has(t.id)) continue; const p = fr.toField(...fr.toLocal(t.lat, t.lng)); (t.rowId != null && rowIds.has(t.rowId) && !trimmedAll.has(t.id) ? onRowField : offRowField).push(p); }
  const concaveRaw = concaveBaseline(onRowField, 0.6 * pitch);
  const concave = concaveRaw ? { ...concaveRaw, overlapShare: overlapShare(concaveRaw.ringField, ringField) } : null;

  // Diagnostics.
  const support: Record<BoundarySupport, number> = { photographs: 0, default: 0, coverage: 0, cap: 0, bridged: 0 };
  const stoppedBy: Partial<Record<EvidenceClass, number>> = {};
  for (const v of kept) { support[v.support]++; if (v.stoppedBy) stoppedBy[v.stoppedBy] = (stoppedBy[v.stoppedBy] ?? 0) + 1; }
  for (const k of Object.keys(support) as BoundarySupport[]) support[k] /= kept.length || 1;
  const treesInside = onRowField.filter(p => pointInRing(p[0], p[1], ringField)).length;
  const onRowTreesOutside = onRowField.length - treesInside;
  const offRowTreesOutside = offRowField.filter(p => !pointInRing(p[0], p[1], ringField)).length;
  let inside: Record<EvidenceClass, number> | null = null;
  if (evidence) {
    const count: Record<EvidenceClass, number> = { unseen: 0, soil: 0, canopy: 0, cover: 0, road: 0, foreign: 0 };
    let n = 0;
    const x0 = Math.min(...ringField.map(p => p[0])), x1 = Math.max(...ringField.map(p => p[0])), y0 = Math.min(...ringField.map(p => p[1])), y1 = Math.max(...ringField.map(p => p[1]));
    const step = Math.max(evidence.cellM, 0.5);
    for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) { if (!pointInRing(x, y, ringField)) continue; count[EVIDENCE_CLASSES[evidenceAt(evidence, x, y)]]++; n++; }
    inside = count;
    for (const k of EVIDENCE_CLASSES) inside[k] = n ? count[k] / n : 0;
  }
  const endMargins = [...ends0, ...ends1].map(v => v.marginM), sideMargins = [...side0, ...side1].map(v => v.marginM);
  const capped = [...ends0, ...ends1, ...side0, ...side1].filter(v => v.support === "cap");
  const limited = [...ends0, ...ends1, ...side0, ...side1].filter(v => v.support === "coverage");
  const bridged = [...side0, ...side1].filter(v => v.support === "bridged");
  if (evidence) {
    if (capped.length) failures.push(`${capped.length} probe${capped.length > 1 ? "s" : ""} met no edge within the cap (${[...new Set(capped.map(v => v.side === "end0" || v.side === "end1" ? `row ${v.rowId} ${v.side === "end0" ? "start" : "end"}` : v.side === "side0" ? "first side" : "last side"))].join(", ")}): the boundary there is the cap, not an observed edge`);
    if (bridged.length) failures.push(`${bridged.length} side probe${bridged.length > 1 ? "s" : ""} met no edge; the edge most of that side met is taken to continue through (bridged, ${[...new Set(bridged.map(v => (v.side === "side0" ? "first side" : "last side")))].join(", ")})`);
    if (limited.length) failures.push(`${limited.length} probe${limited.length > 1 ? "s" : ""} reached the end of the photographs (${[...new Set(limited.map(v => v.side))].join(", ")}): the block may continue beyond, unseen`);
    if (inside && inside.cover > 0.02) failures.push(`${Math.round(100 * inside.cover)} % of the block's ground reads as dense cover in the photographs: a neighbouring crop or sward may be included`);
    if (inside && inside.road > 0.02) failures.push(`${Math.round(100 * inside.road)} % of the block's ground reads as road or track`);
    if (inside && inside.unseen > 0.01) failures.push(`${Math.round(100 * inside.unseen)} % of the block's ground was seen by no photograph`);
  } else {
    failures.push("no photographs were read: every margin is the planting's own half spacing (default), unverified against the ground");
  }
  if (unreliable.size) failures.push(`${unreliable.size} tree${unreliable.size > 1 ? "s" : ""} on the field's rows stand in dense cover in the photographs (wheat, a hedge): not used, and the rows' ends were taken from the trees before them`);
  for (const t of trimmed) if (rowIds.has(t.rowId)) failures.push(`row ${t.rowId}: ${t.ids.length} tree${t.ids.length > 1 ? "s" : ""} at its ${t.end} lie beyond a gap of ${t.gapM.toFixed(0)} m and off the row's line: not taken as the row's end (another planting's trees crossing it)`);
  if (onRowTreesOutside) failures.push(`${onRowTreesOutside} tree${onRowTreesOutside > 1 ? "s" : ""} on the field's rows stand outside the boundary: a missing crop area`);
  if (offRowTreesOutside >= 10) failures.push(`${offRowTreesOutside} trees off the field's rows stand outside the boundary: a hedge or another planting borders the block and is not included`);
  for (const x of rowsExcluded) failures.push(`row ${x.id} excluded: ${x.reason}`);
  if (concave && concave.overlapShare < 0.85) failures.push(`the concave baseline of the trees overlaps the boundary by only ${Math.round(100 * concave.overlapShare)} %`);

  return {
    ring, ringField, ringLatLng, vertices, areaM2, uncertaintyM2,
    method: evidence ? "rows and photographs" : "rows only",
    rowsUsed: rows.map(r => r.id), rowsExcluded, failures,
    stats: {
      rowPitchM: pitch, plantSpacingM: S,
      extentAlongM: Math.max(...ringField.map(p => p[0])) - Math.min(...ringField.map(p => p[0])), extentAcrossM: Math.max(...ringField.map(p => p[1])) - Math.min(...ringField.map(p => p[1])),
      endMarginM: { median: median(endMargins), min: Math.min(...endMargins), max: Math.max(...endMargins) },
      sideMarginM: { median: median(sideMargins), min: Math.min(...sideMargins), max: Math.max(...sideMargins) },
      support, stoppedBy, treesInside, treesInCover: unreliable.size, treesTrimmed: trimmedAll.size, onRowTreesOutside, offRowTreesOutside, inside,
    },
    baselines: { rowAligned, concave },
    processingMs: now() - t0,
  };
}

// ------------------------------------------------------------------------------------------------------------------
// The bundle's boundary record and the operator's state.
// ------------------------------------------------------------------------------------------------------------------

/** What a bundle carries: the inferred block with its evidence, never an operational boundary. */
export type TwinBoundary = {
  version: 1;
  cultivated: {
    ring: LatLngPair[];
    vertices: Pick<BoundaryVertex, "support" | "stoppedBy" | "marginM" | "uncertaintyM" | "side" | "rowId">[];
    areaM2: number;
    uncertaintyM2: number;
    method: BoundaryResult["method"];
    rowsUsed: number[];
    rowsExcluded: { id: number; reason: string }[];
    failures: string[];
    stats: BoundaryResult["stats"];
    processingMs: number;
  };
  baselines: { rowAligned: { ring: LatLngPair[]; areaM2: number }; concave: { ring: LatLngPair[]; areaM2: number; overlapShare: number } | null };
  /** The evidence raster, run-length encoded (boundaryEvidence.ts), or null when no photographs were read. */
  evidence: import("./boundaryEvidence").EncodedEvidence | null;
};

/** A bundle record from a result (lat/lng rings, the raster encoded by the caller). */
export function toTwinBoundary(r: BoundaryResult, fr: LocalFrame, evidence: TwinBoundary["evidence"]): TwinBoundary {
  const ll = (ringField: FieldPoint[]): LatLngPair[] => ringField.map(([al, ac]) => { const [e, n] = fr.fromField(al, ac); const [lat, lng] = fr.toLatLng(e, n); return [+lat.toFixed(8), +lng.toFixed(8)]; });
  return {
    version: 1,
    cultivated: {
      ring: r.ringLatLng.map(([lat, lng]) => [+lat.toFixed(8), +lng.toFixed(8)]),
      vertices: r.vertices.map(v => ({ support: v.support, stoppedBy: v.stoppedBy, marginM: r2(v.marginM), uncertaintyM: r2(v.uncertaintyM), side: v.side, rowId: v.rowId })),
      areaM2: Math.round(r.areaM2), uncertaintyM2: Math.round(r.uncertaintyM2), method: r.method, rowsUsed: r.rowsUsed, rowsExcluded: r.rowsExcluded, failures: r.failures, stats: r.stats, processingMs: Math.round(r.processingMs),
    },
    baselines: { rowAligned: { ring: ll(r.baselines.rowAligned.ringField), areaM2: Math.round(r.baselines.rowAligned.areaM2) }, concave: r.baselines.concave ? { ring: ll(r.baselines.concave.ringField), areaM2: Math.round(r.baselines.concave.areaM2), overlapShare: r2(r.baselines.concave.overlapShare) } : null },
    evidence,
  };
}

/** The operator's word on the boundary, kept outside the bundle (the app stores it per twin). */
export type OperationalBoundaryState = {
  /** The ring the operator accepted or corrected, or null while the inferred boundary stands unverified. */
  ring: LatLngPair[] | null;
  source: "accepted" | "corrected" | null;
  at: string | null;
};

export const NO_OPERATIONAL_BOUNDARY: OperationalBoundaryState = { ring: null, source: null, at: null };

/**
 * The only boundary an operation may be limited by: one the operator accepted or corrected. The inferred
 * cultivated block is never returned here, whatever its support, so a spray plan cannot pick it up by accident.
 */
export function operationalBoundary(state: OperationalBoundaryState | null | undefined): LatLngPair[] | null {
  if (!state || !state.ring || !state.source || state.ring.length < 3) return null;
  return state.ring;
}

/** The cultivated block as local metres from a bundle's record (the engine's ring, or the operator's correction when given). */
export function cultivatedRing(twin: TwinBundle, fr: LocalFrame = localFrame(twin), corrected: LatLngPair[] | null = null): FieldPoint[] | null {
  const ring = corrected ?? twin.boundary?.cultivated.ring ?? null;
  if (!ring || ring.length < 3) return null;
  return ring.map(([lat, lng]) => fr.toLocal(lat, lng));
}

/** Check that a ring from storage is usable: three or more finite latitude/longitude pairs. */
export function validRing(ring: unknown): ring is LatLngPair[] {
  return Array.isArray(ring) && ring.length >= 3 && ring.every(p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
}

export { convexHull };
