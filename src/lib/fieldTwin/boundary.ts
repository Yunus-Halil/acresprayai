// Automatic cultivated-block boundary inference for the Field Twin (Swardus Direct): where the planting ends,
// from the reconciled crop rows and trees, refined on what the photographs show at the edges. No one draws it.
//
// Three boundaries are kept apart and never substituted for one another:
//   cultivated   the inferred block, this module's output: evidence-based, with its uncertainty and failure cases
//   imagery      the ground the photographs cover (imageCoverage here, imageryHull in intelligence.ts): where
//                anything can be known at all
//   operational  a boundary the operator accepted or corrected (operationalBoundary): the only one an operation
//                may ever be limited by; an inferred boundary is never promoted to it automatically
//
// The method, in the order it runs:
//   1. Reliable rows: kept rows with enough observed trees and photographs. Rows are grouped into blocks (a gap of
//      more than 2.5 pitches, or spans along the rows that barely overlap, separate two blocks); the blocks are
//      scored against each other on row support, crop density, photograph support and share of the field, and the
//      best one is the field; the others are reported, never merged. Then an outer row whose offset from its
//      neighbour is off the pitch is excluded (on the apricot field that row was the hedge).
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
//   7. Image coverage: the ground seen by one photograph and by two or more, as polygons, kept beside the block.
//   8. Stability: the inference is run again under a fixed set of parameter variants; how far each vertex moves
//      is its stability.
//   9. Confidence: per vertex from row support, what the photographs showed, the views over it, the agreement of
//      the candidates and its stability; overall as a length-weighted lower quantile, never a mean, so one
//      unsupported side cannot hide behind three good ones. Failure cases are reported as codes with details.
// Everything is deterministic for the same inputs and runs well under a second on a field of a thousand trees.
import { EV, type EvidenceClass, EVIDENCE_CLASSES, type EvidenceMeasures, type EvidenceRaster, type EvidenceTree, classifyEvidence, evidenceAt } from "./boundaryEvidence";
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
  /** 0 to 1 (see `confidenceOf`): set by `inferBoundary`, 0 before scoring. */
  confidence: number;
  /** The confidence's parts: row geometry, photographic evidence, views, agreement of the candidates, stability. */
  scores: { g: number; e: number; v: number; a: number; s: number } | null;
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
  /** Without photographs: the margin beyond the last trees as a share of the plant spacing, and beyond the outer
   * rows as a share of the row pitch (the planter's own half). */
  defaultMarginShare: number;
  /** Rows further apart than this many pitches belong to different blocks. */
  componentGapPitches: number;
  /** Rows whose spans along the rows overlap by less than this share of the shorter span belong to different blocks. */
  componentOverlapShare: number;
  /** Run the fixed parameter ensemble for the stability score (off inside the ensemble itself). */
  ensemble: boolean;
};

export const BOUNDARY_DEFAULTS: BoundaryOptions = { minTrees: 4, minPhotos: 2, pitchTolerance: 0.15, stepM: 0.25, endCapPitches: 3, sideCapPitches: 1.5, probeEveryM: null, simplifyM: 0.3, windowShare: 0.7, sideReachSpacings: 6, defaultMarginShare: 0.5, componentGapPitches: 2.5, componentOverlapShare: 0.2, ensemble: true };

/** The fixed ensemble the stability score is measured over: each a small, plausible change of one rule. */
export const STABILITY_VARIANTS: Partial<BoundaryOptions>[] = [
  { windowShare: 0.6 }, { windowShare: 0.8 },
  { pitchTolerance: 0.12 }, { pitchTolerance: 0.18 },
  { sideReachSpacings: 4 }, { sideReachSpacings: 8 },
  { defaultMarginShare: 0.45 }, { defaultMarginShare: 0.55 },
  { endCapPitches: 2.5, sideCapPitches: 1.25 }, { endCapPitches: 3.5, sideCapPitches: 1.75 },
];

export const BOUNDARY_FAILURE_CODES = [
  "NO_PHOTOGRAPHS", "INSUFFICIENT_ROW_SUPPORT", "INSUFFICIENT_CROP_SUPPORT", "MULTIPLE_COMPETING_BLOCKS", "ADJACENT_CULTIVATED_BLOCK_DETECTED",
  "LOW_IMAGE_EDGE_SUPPORT", "BOUNDARY_EXTENDS_BEYOND_IMAGE_COVERAGE", "SPARSE_OR_IRREGULAR_PLANTING", "HIGH_PARAMETER_INSTABILITY", "CAMERA_ALIGNMENT_UNCERTAIN", "FOREIGN_GROUND_INSIDE",
] as const;
export type BoundaryFailureCode = (typeof BOUNDARY_FAILURE_CODES)[number];
/** A diagnosed failure case as data: the code decides how the product presents the boundary; the detail says why. */
export type BoundaryFailure = { code: BoundaryFailureCode; detail: string };

export type BoundaryConfidence = {
  /** The length-weighted 20th percentile of the edges' confidence: conservative by construction. */
  overall: number;
  /** The length-weighted mean, for comparison only. */
  mean: number;
  level: "high" | "medium" | "low";
  /** Anything but high: the product shows "Review boundary". */
  review: boolean;
};
export const CONFIDENCE_WEIGHTS = { geometry: 0.3, evidence: 0.25, views: 0.2, agreement: 0.15, stability: 0.1 } as const;
export const CONFIDENCE_LEVELS = { high: 0.75, medium: 0.5 } as const;

export type BoundaryBaseline = { ringField: FieldPoint[]; areaM2: number };

/** The ground the photographs saw, as polygons: by one photograph and by two or more. Image coverage, not the field. */
export type CoveragePolygons = {
  cellM: number;
  along0: number;
  across0: number;
  width: number;
  height: number;
  /** Photographs whose footprint holds each cell's centre (0 where none). */
  views: Uint8Array;
  anyView: (BoundaryBaseline & { cells: number }) | null;
  twoPlusViews: (BoundaryBaseline & { cells: number }) | null;
  /** Square metres seen by at least one photograph, and by at least two. */
  areaM2: number;
  twoPlusAreaM2: number;
  /** Mean views over the seen ground. */
  meanViews: number;
};

export type BoundaryStability = {
  variants: number;
  areaMinM2: number;
  areaMaxM2: number;
  /** How far each vertex of the boundary moves under the worst variant (nearest distance to that variant's ring), metres. */
  perVertexShiftM: number[];
  medianShiftM: number;
  maxShiftM: number;
};

/** A block of rows: the chosen one is the field, the others are neighbouring plantings at the same row direction. */
export type BoundaryComponent = {
  rows: number[]; trees: number; score: number; chosen: boolean; acrossM: [number, number];
  parts: { r: number; d: number; c: number; p: number };
  /** What separated this block from the one before it (by across): a gap of rows, spans that barely overlap, or ground between the rows that is not the field's own. */
  separatedBy: "gap" | "overlap" | "ground" | null;
};
export const COMPONENT_WEIGHTS = { rows: 0.35, density: 0.25, confidence: 0.2, share: 0.2 } as const;

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
  /** The same as data, by code. */
  failureModes: BoundaryFailure[];
  /** Trees on the used rows the engine did not count as the field's: standing in dense cover, or trimmed from a row's end. */
  excludedTrees: { inCover: number[]; trimmed: number[] };
  confidence: BoundaryConfidence;
  coverage: CoveragePolygons;
  stability: BoundaryStability | null;
  components: BoundaryComponent[];
  stats: {
    rowPitchM: number;
    plantSpacingM: number;
    extentAlongM: number;
    extentAcrossM: number;
    endMarginM: { median: number; min: number; max: number };
    sideMarginM: { median: number; min: number; max: number };
    /** Share of vertices by support. */
    support: Record<BoundarySupport, number>;
    /** Share of the boundary's length by the support of its edges (an edge takes the weaker of its two vertices). */
    lengthBySupport: Record<BoundarySupport, number>;
    stoppedBy: Partial<Record<EvidenceClass, number>>;
    treesInside: number;
    /** Trees on the rows that stand in dense cover (wheat, a hedge) and were not used. */
    treesInCover: number;
    /** Trees trimmed from row ends as runs beyond a gap. */
    treesTrimmed: number;
    onRowTreesOutside: number;
    offRowTreesOutside: number;
    /** Trees off the field's rows that stand inside the block (a hedge or another planting taken in). */
    offRowTreesInside: number;
    /** Observed trees on the used rows against the positions their spans hold at the plant spacing. */
    fillShare: number;
    /** Shares of the block's ground by evidence class (null without photographs). */
    inside: Record<EvidenceClass, number> | null;
  };
  baselines: { rowAligned: BoundaryBaseline; concave: (BoundaryBaseline & { overlapShare: number }) | null };
  processingMs: number;
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export const polygonArea = (ring: FieldPoint[]) => Math.abs(ring.reduce((s, [x, y], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return s + x * y2 - x2 * y; }, 0)) / 2;

const segDist = (p: FieldPoint, q: FieldPoint, r: FieldPoint) => { const dx = r[0] - q[0], dy = r[1] - q[1], L = dx * dx + dy * dy; if (!L) return Math.hypot(p[0] - q[0], p[1] - q[1]); const t = Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / L)); return Math.hypot(p[0] - q[0] - t * dx, p[1] - q[1] - t * dy); };
/** Nearest distance from a point to a closed ring's edges. */
export function distToRing(p: FieldPoint, ring: FieldPoint[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) best = Math.min(best, segDist(p, ring[i], ring[(i + 1) % ring.length]));
  return best;
}

/** Douglas-Peucker on a closed ring, returning the kept indices (always at least 3). */
export function simplifyRing(ring: FieldPoint[], tolM: number): number[] {
  const n = ring.length;
  if (n <= 3) return ring.map((_, i) => i);
  const keep = new Uint8Array(n);
  // Anchor on the two points furthest apart, then recurse on both arcs.
  let a = 0, b = 0, bd = -1;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = (ring[i][0] - ring[j][0]) ** 2 + (ring[i][1] - ring[j][1]) ** 2; if (d > bd) { bd = d; a = i; b = j; } }
  keep[a] = keep[b] = 1;
  const rec = (i0: number, i1: number) => {
    // Arc from i0 to i1 going forward (wrapping).
    let best = -1, bdist = tolM;
    for (let k = (i0 + 1) % n; k !== i1; k = (k + 1) % n) { const d = segDist(ring[k], ring[i0], ring[i1]); if (d > bdist) { bdist = d; best = k; } }
    if (best >= 0) { keep[best] = 1; rec(i0, best); rec(best, i1); }
  };
  rec(a, b); rec(b, a);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  if (out.length < 3) { // a degenerate ring: keep the furthest third point
    let c = -1, cd = -1;
    for (let i = 0; i < n; i++) { if (keep[i]) continue; const d = segDist(ring[i], ring[a], ring[b]); if (d > cd) { cd = d; c = i; } }
    if (c >= 0) { keep[c] = 1; out.length = 0; for (let i = 0; i < n; i++) if (keep[i]) out.push(i); }
  }
  return out;
}

export type TrimReason = "off the line" | "beyond an edge";
export type TrimmedRun = { ids: number[]; end: "start" | "end"; gapM: number; why: TrimReason };
type RowGeom = { id: number; across: number; a0: number; a1: number; trees: number; photos: number; /** Trees trimmed from the row's ends: runs beyond a gap that are not the row's own (at most one record per end). */ trimmed: TrimmedRun[] };

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
 * a gap of more than 2.5 spacings is the row's own only if it sits on the row's line (its trees within half a
 * metre of the line fitted through the row's main run, not drifting across by more than a metre) and, when the
 * photographs were read, the ground of the gap is the field's own (soil or canopy): a run beyond ground that is
 * not (another crop, a hedge, a track, trees off the rows) is beyond the field's edge. Otherwise it is something
 * else strung onto the line (on the apricot field, another planting's rows crossing it at an angle) and is
 * trimmed and reported. A run on the line over the field's own ground stays however small: missing trees make
 * gaps, not ends.
 */
function rowGeometry(twin: TwinBundle, fr: LocalFrame, excludeTrees: Set<number> = new Set(), evidence: EvidenceRaster | null = null): RowGeom[] {
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
      const runs = runsOf(trees, S, 2.5);
      const trimmed: TrimmedRun[] = [];
      // The row grows outward from its largest run, one run at a time, each tested against the row as kept so far.
      // The reference is the kept trees' nearest 30 m (their median across; no slope is extrapolated, because a row
      // of this field wanders half a metre across over its length and a fitted slope carried over a gap lies). A
      // run is off the line when its trees sit more than `tol` from that (median; tol is half a metre or twice the
      // row's own straightness), when it drifts across at its own angle (another planting's row crossing: over a
      // metre of drift at more than 6 degrees, slopes by Theil-Sen so one odd tree cannot make a drift), or when a
      // short run spreads over a metre. A run off the line, or beyond ground that is not the field's own, ends the
      // row there: it and every run beyond it are trimmed and reported.
      type Pt = { along: number; across: number };
      const tol = Math.max(0.5, 2 * (Number.isFinite(r.straightnessSdM) ? r.straightnessSdM : 0));
      const bulkIndex = runs.reduce((bi, run, i) => (run.length > runs[bi].length ? i : bi), 0);
      const robustSlope = (pts: Pt[]): number => { const sl: number[] = []; for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const d = pts[j].along - pts[i].along; if (Math.abs(d) > 1) sl.push((pts[j].across - pts[i].across) / d); } return sl.length ? median(sl) : 0; };
      const nearest = (keptPts: Pt[], side: "start" | "end") => (side === "start" ? keptPts.filter(t => t.along <= keptPts[0].along + 30) : keptPts.filter(t => t.along >= keptPts[keptPts.length - 1].along - 30));
      const onLine = (run: Pt[], keptPts: Pt[], side: "start" | "end") => {
        const near = nearest(keptPts, side), base = median(near.map(t => t.across));
        const rs = run.map(t => t.across - base);
        if (Math.abs(median(rs)) > tol) return false;
        const len = run[run.length - 1].along - run[0].along;
        if (run.length >= 3) { const dSlope = Math.abs(robustSlope(run) - robustSlope(near)); if (dSlope * len > 1 && dSlope > 0.1) return false; }
        if (len < 15 && Math.max(...rs) - Math.min(...rs) > 1) return false;
        return true;
      };
      // The gap's ground, sampled on the row's line: mostly not the field's own means the run lies beyond an edge.
      const beyondEdge = (g0: number, g1: number, across: number): boolean => {
        if (!evidence) return false;
        let field = 0, other = 0;
        for (let a = g0 + 0.5; a < g1; a += 0.5) { const c = evidenceAt(evidence, a, across); if (c === EV.soil || c === EV.canopy) field++; else if (c !== EV.unseen) other++; }
        return other + field > 0 && other >= field;
      };
      let keptRuns: Pt[][] = [runs[bulkIndex]];
      for (const side of ["start", "end"] as const) {
        const order = side === "start" ? runs.slice(0, bulkIndex).reverse() : runs.slice(bulkIndex + 1);
        for (let k = 0; k < order.length; k++) {
          const run = order[k], keptPts = keptRuns.flat().sort((p, q) => p.along - q.along);
          const g0 = side === "start" ? run[run.length - 1].along : keptPts[keptPts.length - 1].along, g1 = side === "start" ? keptPts[0].along : run[0].along;
          const off = !onLine(run, keptPts, side), edge = !off && beyondEdge(g0, g1, median(nearest(keptPts, side).map(t => t.across)));
          if (!off && !edge) { keptRuns = side === "start" ? [run, ...keptRuns] : [...keptRuns, run]; continue; }
          trimmed.push({ ids: order.slice(k).flatMap(q => q.map(t => t.id)), end: side, gapM: g1 - g0, why: off ? "off the line" : "beyond an edge" });
          break;
        }
      }
      const kept = keptRuns.flat();
      out.push({ id: r.id, across: median(kept.map(t => t.across)), a0: Math.min(...kept.map(t => t.along)), a1: Math.max(...kept.map(t => t.along)), trees: kept.length, photos: r.photos, trimmed });
    } else {
      const ends = r.line.map(([lat, lng]) => fr.toField(...fr.toLocal(lat, lng)));
      out.push({ id: r.id, across: ends.reduce((s, p) => s + p[1], 0) / ends.length, a0: Math.min(...ends.map(p => p[0])) + half, a1: Math.max(...ends.map(p => p[0])) - half, trees: r.trees, photos: r.photos, trimmed: [] });
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
/** What each support is worth as photographic evidence of an edge. */
const EVIDENCE_SCORE: Record<BoundarySupport, number> = { photographs: 1, bridged: 0.5, coverage: 0.25, cap: 0.2, default: 0 };

/** The largest 4-connected component of a raster mask, traced along its cell edges to a ring, rounded `rounding` passes, simplified. Null when the mask is empty. */
function traceMask(mask: Uint8Array, W: number, H: number, x0: number, y0: number, cellM: number, rounding: number, simplifyM: number): { ringField: FieldPoint[]; cells: number } | null {
  const comp = new Int32Array(W * H).fill(-1);
  let bestComp = -1, bestN = 0, nComp = 0;
  const stack: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || comp[s] >= 0) continue;
    let n = 0;
    stack.length = 0; stack.push(s); comp[s] = nComp;
    while (stack.length) {
      const c = stack.pop()!; n++;
      const i = c % W, j = (c - i) / W;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue; const q = jj * W + ii; if (mask[q] && comp[q] < 0) { comp[q] = nComp; stack.push(q); } }
    }
    if (n > bestN) { bestN = n; bestComp = nComp; }
    nComp++;
  }
  if (bestComp < 0) return null;
  const edges: [FieldPoint, FieldPoint][] = [];
  const corner = (i: number, j: number): FieldPoint => [x0 + i * cellM, y0 + j * cellM];
  const isIn = (ii: number, jj: number) => ii >= 0 && jj >= 0 && ii < W && jj < H && comp[jj * W + ii] === bestComp;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (comp[j * W + i] !== bestComp) continue;
    if (!isIn(i + 1, j)) edges.push([corner(i + 1, j), corner(i + 1, j + 1)]);
    if (!isIn(i - 1, j)) edges.push([corner(i, j + 1), corner(i, j)]);
    if (!isIn(i, j + 1)) edges.push([corner(i + 1, j + 1), corner(i, j + 1)]);
    if (!isIn(i, j - 1)) edges.push([corner(i, j), corner(i + 1, j)]);
  }
  const rings = chainEdges(edges);
  if (!rings.length) return null;
  let ring = rings[0];
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
  const smooth = rounding ? roundCorners(ring, rounding) : ring;
  const keep = simplifyRing(smooth, simplifyM);
  return { ringField: keep.map(k => smooth[k]), cells: bestN };
}

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
  const traced = traceMask(closed, W, H, x0, y0, cellM, 2, cellM * 0.6);
  return traced ? { ringField: traced.ringField, areaM2: polygonArea(traced.ringField) } : null;
}

/**
 * The ground the photographs cover, from the twin's footprints: views per metre cell, and the polygons of the
 * ground seen by any photograph and by two or more. This is image coverage, never the cultivated block.
 */
export function imageCoverage(twin: TwinBundle, fr: LocalFrame = localFrame(twin), cellM = 1): CoveragePolygons {
  const rings = twin.footprints.map(f => f.ring.map(([lat, lng]) => fr.toField(...fr.toLocal(lat, lng)))).filter(r => r.length >= 3);
  const empty: CoveragePolygons = { cellM, along0: 0, across0: 0, width: 0, height: 0, views: new Uint8Array(0), anyView: null, twoPlusViews: null, areaM2: 0, twoPlusAreaM2: 0, meanViews: 0 };
  if (!rings.length) return empty;
  const all = rings.flat();
  const along0 = Math.floor(Math.min(...all.map(p => p[0])) / cellM) * cellM - cellM, across0 = Math.floor(Math.min(...all.map(p => p[1])) / cellM) * cellM - cellM;
  const width = Math.ceil((Math.max(...all.map(p => p[0])) - along0) / cellM) + 2, height = Math.ceil((Math.max(...all.map(p => p[1])) - across0) / cellM) + 2;
  const views = new Uint8Array(width * height);
  for (const r of rings) {
    const i0 = Math.max(0, Math.floor((Math.min(...r.map(p => p[0])) - along0) / cellM)), i1 = Math.min(width - 1, Math.ceil((Math.max(...r.map(p => p[0])) - along0) / cellM));
    const j0 = Math.max(0, Math.floor((Math.min(...r.map(p => p[1])) - across0) / cellM)), j1 = Math.min(height - 1, Math.ceil((Math.max(...r.map(p => p[1])) - across0) / cellM));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { if (!pointInRing(along0 + (i + 0.5) * cellM, across0 + (j + 0.5) * cellM, r)) continue; const c = j * width + i; if (views[c] < 255) views[c]++; }
  }
  let seen = 0, two = 0, sum = 0;
  const m1 = new Uint8Array(width * height), m2 = new Uint8Array(width * height);
  for (let c = 0; c < views.length; c++) { if (views[c] >= 1) { seen++; sum += views[c]; m1[c] = 1; } if (views[c] >= 2) { two++; m2[c] = 1; } }
  const anyView = traceMask(m1, width, height, along0, across0, cellM, 0, cellM * 0.6), twoPlus = traceMask(m2, width, height, along0, across0, cellM, 0, cellM * 0.6);
  return {
    cellM, along0, across0, width, height, views,
    anyView: anyView ? { ...anyView, areaM2: polygonArea(anyView.ringField) } : null,
    twoPlusViews: twoPlus ? { ...twoPlus, areaM2: polygonArea(twoPlus.ringField) } : null,
    areaM2: seen * cellM * cellM, twoPlusAreaM2: two * cellM * cellM, meanViews: seen ? sum / seen : 0,
  };
}

/** Photographs covering a field-frame point (0 off the coverage raster). */
export function viewsAt(c: CoveragePolygons, along: number, across: number): number {
  const i = Math.floor((along - c.along0) / c.cellM), j = Math.floor((across - c.across0) / c.cellM);
  if (i < 0 || j < 0 || i >= c.width || j >= c.height) return 0;
  return c.views[j * c.width + i];
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
 * Rows grouped into blocks and scored against each other. Consecutive rows (by across) stay in one block unless
 * their gap is over `componentGapPitches` pitches or their spans along the rows overlap by less than
 * `componentOverlapShare`. Each block's score is relative to the others on this field, never a universal number:
 * row support (rows with a neighbour at the pitch), crop density (trees per metre of row, against the densest
 * block), photograph support (rows seen in enough photographs), and share of the field's rows. The best block is
 * the field. A neighbouring planting at the same row direction with a track between is another block.
 */
function rowComponents(rows: RowGeom[], pitch: number, S: number, o: BoundaryOptions, evidence: EvidenceRaster | null): { groups: RowGeom[][]; components: BoundaryComponent[]; chosen: number } {
  const groups: RowGeom[][] = [];
  const separated: BoundaryComponent["separatedBy"][] = [null];
  // The ground between two rows further apart than 1.5 pitches: mostly not the field's own (a track, a hedge, another
  // crop) separates two blocks; soil between them is a missing row.
  const groundBetween = (p: RowGeom, r: RowGeom): boolean => {
    if (!evidence || r.across - p.across <= 1.5 * pitch) return false;
    const lo = Math.max(p.a0, r.a0), hi = Math.min(p.a1, r.a1);
    if (hi - lo < 2) return false;
    let field = 0, other = 0;
    for (const off of [-0.25, 0, 0.25]) for (let a = lo; a <= hi; a += 1) {
      const c = evidenceAt(evidence, a, (p.across + r.across) / 2 + off * pitch);
      if (c === EV.soil || c === EV.canopy) field++; else if (c !== EV.unseen) other++;
    }
    return other + field > 0 && other >= field;
  };
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (!last) { groups.push([r]); continue; }
    const prev = last[last.length - 1];
    const gA0 = Math.min(...last.map(q => q.a0)), gA1 = Math.max(...last.map(q => q.a1));
    const lo = Math.max(r.a0, gA0), hi = Math.min(r.a1, gA1);
    const overlap = Math.max(0, hi - lo) / Math.max(1e-9, Math.min(r.a1 - r.a0, gA1 - gA0));
    const by: BoundaryComponent["separatedBy"] = r.across - prev.across > o.componentGapPitches * pitch ? "gap" : overlap < o.componentOverlapShare ? "overlap" : groundBetween(prev, r) ? "ground" : null;
    if (by) { groups.push([r]); separated.push(by); } else last.push(r);
  }
  const density = (g: RowGeom[]) => g.reduce((s, r) => s + r.trees, 0) / Math.max(1e-9, g.reduce((s, r) => s + (r.a1 - r.a0) + S, 0));
  const maxDensity = Math.max(...groups.map(density)) || 1;
  const total = rows.length || 1;
  const components: BoundaryComponent[] = groups.map(g => {
    const atPitch = g.filter((r, i) => (i > 0 && Math.abs(g[i].across - g[i - 1].across - pitch) <= o.pitchTolerance * pitch) || (i < g.length - 1 && Math.abs(g[i + 1].across - r.across - pitch) <= o.pitchTolerance * pitch)).length;
    const parts = { r: g.length > 1 ? atPitch / g.length : 0, d: density(g) / maxDensity, c: g.reduce((s, r) => s + Math.min(1, r.photos / (2 * o.minPhotos)), 0) / g.length, p: g.length / total };
    return { rows: g.map(r => r.id), trees: g.reduce((s, r) => s + r.trees, 0), score: COMPONENT_WEIGHTS.rows * parts.r + COMPONENT_WEIGHTS.density * parts.d + COMPONENT_WEIGHTS.confidence * parts.c + COMPONENT_WEIGHTS.share * parts.p, chosen: false, acrossM: [g[0].across, g[g.length - 1].across], parts, separatedBy: null };
  });
  components.forEach((c, k) => { c.separatedBy = separated[k] ?? null; });
  let chosen = 0;
  for (let k = 1; k < components.length; k++) if (components[k].score > components[chosen].score || (components[k].score === components[chosen].score && components[k].trees > components[chosen].trees)) chosen = k;
  components[chosen].chosen = true;
  return { groups, components, chosen };
}

/**
 * Step 1: the rows the boundary may stand on. Kept rows with enough observed trees and photographs; grouped into
 * blocks and the best block taken (rowComponents); then an outer row whose offset from its neighbour is off the
 * planting's pitch is excluded (a hedge, a stray line of trees). With an evidence raster the exclusion says what
 * the photographs show along that row. `excludeTrees` are trees found standing in dense cover (see inferBoundary);
 * they count for nothing here.
 */
export function reliableRows(twin: TwinBundle, evidence: EvidenceRaster | null = null, options: Partial<BoundaryOptions> = {}, excludeTrees: Set<number> = new Set(), fr: LocalFrame = localFrame(twin)): { rows: RowGeom[]; excluded: { id: number; reason: string }[]; pitch: number; /** Trees trimmed from row ends (ids), by row. */ trimmed: { rowId: number; ids: number[]; end: "start" | "end"; gapM: number; why: TrimReason }[]; components: BoundaryComponent[] } {
  const o = { ...BOUNDARY_DEFAULTS, ...options };
  const geoms = rowGeometry(twin, fr, excludeTrees, evidence);
  const excluded: { id: number; reason: string }[] = [];
  let rows = geoms.filter(g => {
    if (g.trees < o.minTrees) { excluded.push({ id: g.id, reason: `${g.trees} reliable observed trees (${o.minTrees} needed)` }); return false; }
    if (g.photos < o.minPhotos) { excluded.push({ id: g.id, reason: `seen in ${g.photos} photograph (${o.minPhotos} needed)` }); return false; }
    return true;
  });
  const gaps = rows.slice(1).map((r, i) => r.across - rows[i].across);
  let pitch = gaps.length ? median(gaps) : twin.field.rowSpacingM;
  let components: BoundaryComponent[] = [];
  if (rows.length) {
    const rc = rowComponents(rows, pitch, twin.field.plantSpacingM, o, evidence);
    components = rc.components;
    if (rc.groups.length > 1) {
      const best = rc.components[rc.chosen];
      const why = (c: BoundaryComponent, k: number) => { const by = k > rc.chosen ? c.separatedBy : rc.components[k + 1]?.separatedBy; return by === "ground" ? "ground between that is not the field's own" : by === "overlap" ? "spans along the rows that barely overlap" : "a gap of rows"; };
      rc.components.forEach((c, k) => { if (k === rc.chosen) return; for (const id of c.rows) excluded.push({ id, reason: `another block of ${c.rows.length} row${c.rows.length > 1 ? "s" : ""} (${c.trees} trees, score ${r2(c.score)} against ${r2(best.score)} for the field's ${best.rows.length} rows), separated by ${why(c, k)}` }); });
      rows = rc.groups[rc.chosen];
      const g2 = rows.slice(1).map((r, i) => r.across - rows[i].across);
      pitch = g2.length ? median(g2) : pitch;
    }
  }
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
  const trimmed = geoms.flatMap(g => g.trimmed.map(t => ({ rowId: g.id, ...t })));
  return { rows, excluded, pitch, trimmed, components };
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

/** The inference up to the ring: shared by the boundary and by the stability ensemble (which needs no diagnostics). */
type Core = {
  rows: RowGeom[]; rowsExcluded: { id: number; reason: string }[]; pitch: number; trimmed: ReturnType<typeof reliableRows>["trimmed"]; components: BoundaryComponent[]; unreliable: Set<number>;
  kept: BoundaryVertex[]; ringField: FieldPoint[]; ends0: BoundaryVertex[]; ends1: BoundaryVertex[]; side0: BoundaryVertex[]; side1: BoundaryVertex[]; cellM: number;
};

function inferCore(twin: TwinBundle, evidence: EvidenceRaster | null, o: BoundaryOptions, fr: LocalFrame): Core | null {
  const S = twin.field.plantSpacingM;
  // 1. Reliable crop objects and rows.
  const unreliable = evidence ? treesInCover(twin, evidence, fr) : new Set<number>();
  const { rows, excluded: rowsExcluded, pitch, trimmed, components } = reliableRows(twin, evidence, o, unreliable, fr);
  if (!rows.length) return null;
  const halfPitch = pitch / 2, halfS = S / 2;
  const defaultEnd = o.defaultMarginShare * S, defaultSide = o.defaultMarginShare * pitch;
  const cellM = evidence?.cellM ?? o.stepM;
  const stepM = Math.min(o.stepM, cellM);

  // 3 and 5. Row ends: a probe from each row's last tree, along the row, in a window the row's strip wide.
  const endCap = o.endCapPitches * pitch, sideCap = o.sideCapPitches * pitch;
  const endWin = o.windowShare * halfPitch, sideWin = o.windowShare * halfS;
  const ends0: BoundaryVertex[] = [], ends1: BoundaryVertex[] = [];
  // A row whose probe meets nothing within the cap may simply be short (trees missing at its end): it is walked
  // again as far as its neighbouring rows' ends plus a pitch, and only a probe that meets nothing there is capped.
  const endProbe = (r: RowGeom, i: number, dir: -1 | 1): Probe => {
    const from = dir < 0 ? r.a0 : r.a1;
    const first = probe(evidence, from, r.across, dir, 0, endWin, 0, endCap, stepM, defaultEnd);
    if (first.support !== "cap") return first;
    const further = Math.max(0, ...[rows[i - 1], rows[i + 1]].filter(Boolean).map(q => (dir < 0 ? from - q.a0 : q.a1 - from)));
    if (further <= 0) return first;
    return probe(evidence, from, r.across, dir, 0, endWin, 0, Math.max(endCap, further + pitch), stepM, defaultEnd);
  };
  rows.forEach((r, i) => {
    const p0 = endProbe(r, i, -1), p1 = endProbe(r, i, 1);
    ends0.push({ along: r.a0 - p0.marginM, across: r.across, side: "end0", rowId: r.id, support: p0.support, stoppedBy: p0.stoppedBy, marginM: p0.marginM, uncertaintyM: uncertaintyOf(p0, cellM), confidence: 0, scores: null });
    ends1.push({ along: r.a1 + p1.marginM, across: r.across, side: "end1", rowId: r.id, support: p1.support, stoppedBy: p1.stoppedBy, marginM: p1.marginM, uncertaintyM: uncertaintyOf(p1, cellM), confidence: 0, scores: null });
  });
  // Outer sides: probes along the outer rows, across them, every plant spacing; medians of three against speckle.
  const sideOf = (r: RowGeom, dir: -1 | 1, side: "side0" | "side1"): BoundaryVertex[] => {
    const every = o.probeEveryM ?? S;
    const n = Math.max(2, Math.round((r.a1 - r.a0) / every) + 1);
    const raw: { along: number; p: Probe }[] = [];
    for (let k = 0; k < n; k++) {
      const along = r.a0 + ((r.a1 - r.a0) * k) / (n - 1);
      raw.push({ along, p: probe(evidence, along, r.across, 0, dir, sideWin, 0, sideCap, stepM, defaultSide) });
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
      if (src.p.support === "cap" && consensus != null && consensus < m) return { along: x.along, across: r.across + dir * consensus, side, rowId: r.id, support: "bridged" as const, stoppedBy: null, marginM: consensus, uncertaintyM: m - consensus, confidence: 0, scores: null };
      return { along: x.along, across: r.across + dir * m, side, rowId: r.id, support: src.p.support, stoppedBy: src.p.stoppedBy, marginM: m, uncertaintyM: uncertaintyOf(src.p, cellM), confidence: 0, scores: null };
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
  const kept = [...keepSet].sort((a, b) => a - b).map(k => ({ ...ringV[k] }));
  return { rows, rowsExcluded, pitch, trimmed, components, unreliable, kept, ringField: kept.map(v => [v.along, v.across] as FieldPoint), ends0, ends1, side0, side1, cellM };
}

/** The inference run again under each variant of STABILITY_VARIANTS: how far each vertex of the boundary moves. */
function stabilityOf(twin: TwinBundle, evidence: EvidenceRaster | null, o: BoundaryOptions, fr: LocalFrame, ringField: FieldPoint[], areaM2: number, pitch: number): BoundaryStability {
  const shifts = ringField.map(() => 0);
  const areas = [areaM2];
  for (const v of STABILITY_VARIANTS) {
    const c = inferCore(twin, evidence, { ...o, ...v, ensemble: false }, fr);
    if (!c) { for (let i = 0; i < shifts.length; i++) shifts[i] = Math.max(shifts[i], 2 * pitch); continue; }
    areas.push(polygonArea(c.ringField));
    for (let i = 0; i < ringField.length; i++) shifts[i] = Math.max(shifts[i], distToRing(ringField[i], c.ringField));
  }
  return { variants: STABILITY_VARIANTS.length, areaMinM2: Math.min(...areas), areaMaxM2: Math.max(...areas), perVertexShiftM: shifts, medianShiftM: median(shifts), maxShiftM: Math.max(...shifts) };
}

/** Confidence level from an overall score. */
export const confidenceLevel = (c: number): BoundaryConfidence["level"] => (c >= CONFIDENCE_LEVELS.high ? "high" : c >= CONFIDENCE_LEVELS.medium ? "medium" : "low");

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
  const failureModes: BoundaryFailure[] = [];
  const fail = (code: BoundaryFailureCode, detail: string, text = true) => { const have = failureModes.find(f => f.code === code); if (have) have.detail += `; ${detail}`; else failureModes.push({ code, detail }); if (text) failures.push(detail); };

  const core = inferCore(twin, evidence, o, fr);
  if (!core) return null;
  const { rows, rowsExcluded, pitch, trimmed, components, unreliable, kept, ringField, ends0, ends1, side0, side1 } = core;
  const halfPitch = pitch / 2, halfS = S / 2;
  const vertices = kept;
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

  // 7 and 8. Image coverage and stability.
  const coverage = imageCoverage(twin, fr);
  const stability = o.ensemble ? stabilityOf(twin, evidence, o, fr, ringField, areaM2, pitch) : null;

  // Diagnostics.
  const support: Record<BoundarySupport, number> = { photographs: 0, default: 0, coverage: 0, cap: 0, bridged: 0 };
  const lengthBySupport: Record<BoundarySupport, number> = { photographs: 0, default: 0, coverage: 0, cap: 0, bridged: 0 };
  const stoppedBy: Partial<Record<EvidenceClass, number>> = {};
  for (const v of kept) { support[v.support]++; if (v.stoppedBy) stoppedBy[v.stoppedBy] = (stoppedBy[v.stoppedBy] ?? 0) + 1; }
  for (const k of Object.keys(support) as BoundarySupport[]) support[k] /= kept.length || 1;
  let totalLength = 0;
  const edgeLengths = kept.map((a, i) => { const b = kept[(i + 1) % kept.length]; return Math.hypot(a.along - b.along, a.across - b.across); });
  kept.forEach((a, i) => { const b = kept[(i + 1) % kept.length]; const weak = SUPPORT_RANK[b.support] > SUPPORT_RANK[a.support] ? b.support : a.support; lengthBySupport[weak] += edgeLengths[i]; totalLength += edgeLengths[i]; });
  for (const k of Object.keys(lengthBySupport) as BoundarySupport[]) lengthBySupport[k] /= totalLength || 1;
  const within = (p: FieldPoint) => pointInRing(p[0], p[1], ringField) || distToRing(p, ringField) <= 0.5;
  const treesInside = onRowField.filter(within).length;
  const onRowTreesOutside = onRowField.length - treesInside;
  const offRowTreesOutside = offRowField.filter(p => !within(p)).length;
  const offRowTreesInside = offRowField.length - offRowTreesOutside;
  const positions = rows.reduce((s, r) => s + (r.a1 - r.a0) / S + 1, 0);
  const fillShare = positions ? Math.min(1, treesInside / positions) : 0;
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

  // 9. Confidence per vertex, then overall as a length-weighted lower quantile of the edges.
  const rowById = new Map(rows.map(r => [r.id, r]));
  const medianTrees = median(rows.map(r => r.trees)) || 1;
  kept.forEach((v, i) => {
    const r = rowById.get(v.rowId);
    const g = r ? Math.min(1, r.trees / medianTrees) * (r.photos >= o.minPhotos ? 1 : 0.5) : 0;
    const e = EVIDENCE_SCORE[v.support];
    const vw = Math.min(1, viewsAt(coverage, v.along, v.across) / 2);
    const cands = [rowAligned.ringField, ...(concave ? [concave.ringField] : [])];
    const a = cands.reduce((s, c) => s + Math.max(0, 1 - distToRing([v.along, v.across], c) / (2 * pitch)), 0) / cands.length;
    const s = stability ? Math.max(0, 1 - stability.perVertexShiftM[i] / pitch) : 0.5;
    v.scores = { g: r3(g), e, v: r3(vw), a: r3(a), s: r3(s) };
    v.confidence = r3(CONFIDENCE_WEIGHTS.geometry * g + CONFIDENCE_WEIGHTS.evidence * e + CONFIDENCE_WEIGHTS.views * vw + CONFIDENCE_WEIGHTS.agreement * a + CONFIDENCE_WEIGHTS.stability * s);
  });
  const edges = kept.map((a, i) => ({ c: (a.confidence + kept[(i + 1) % kept.length].confidence) / 2, L: edgeLengths[i] })).sort((p, q) => p.c - q.c);
  let acc = 0, overall = edges.length ? edges[edges.length - 1].c : 0;
  for (const e of edges) { acc += e.L; if (acc >= 0.2 * totalLength) { overall = e.c; break; } }
  const meanC = totalLength ? edges.reduce((s, e) => s + e.c * e.L, 0) / totalLength : 0;
  const confidence: BoundaryConfidence = { overall: r3(overall), mean: r3(meanC), level: confidenceLevel(overall), review: confidenceLevel(overall) !== "high" };

  // Failure cases, as codes with details and as text (the text the operator reads).
  const endMargins = [...ends0, ...ends1].map(v => v.marginM), sideMargins = [...side0, ...side1].map(v => v.marginM);
  const capped = [...ends0, ...ends1, ...side0, ...side1].filter(v => v.support === "cap");
  const limited = [...ends0, ...ends1, ...side0, ...side1].filter(v => v.support === "coverage");
  const bridged = [...side0, ...side1].filter(v => v.support === "bridged");
  if (evidence) {
    if (capped.length) failures.push(`${capped.length} probe${capped.length > 1 ? "s" : ""} met no edge within the cap (${[...new Set(capped.map(v => v.side === "end0" || v.side === "end1" ? `row ${v.rowId} ${v.side === "end0" ? "start" : "end"}` : v.side === "side0" ? "first side" : "last side"))].join(", ")}): the boundary there is the cap, not an observed edge`);
    if (bridged.length) failures.push(`${bridged.length} side probe${bridged.length > 1 ? "s" : ""} met no edge; the edge most of that side met is taken to continue through (bridged, ${[...new Set(bridged.map(v => (v.side === "side0" ? "first side" : "last side")))].join(", ")})`);
    if (limited.length) fail("BOUNDARY_EXTENDS_BEYOND_IMAGE_COVERAGE", `${limited.length} probe${limited.length > 1 ? "s" : ""} reached the end of the photographs (${[...new Set(limited.map(v => v.side))].join(", ")}): the block may continue beyond, unseen`);
    if (inside && inside.cover > 0.02) fail("FOREIGN_GROUND_INSIDE", `${Math.round(100 * inside.cover)} % of the block's ground reads as dense cover in the photographs: a neighbouring crop or sward may be included`);
    if (inside && inside.road > 0.02) fail("FOREIGN_GROUND_INSIDE", `${Math.round(100 * inside.road)} % of the block's ground reads as road or track`);
    if (inside && inside.unseen > 0.01) fail("BOUNDARY_EXTENDS_BEYOND_IMAGE_COVERAGE", `${Math.round(100 * inside.unseen)} % of the block's ground was seen by no photograph`);
    if (lengthBySupport.photographs < 0.6) fail("LOW_IMAGE_EDGE_SUPPORT", `the photographs showed the edge along only ${Math.round(100 * lengthBySupport.photographs)} % of the boundary's length`);
  } else {
    fail("NO_PHOTOGRAPHS", "no photographs were read: every margin is the planting's own half spacing (default), unverified against the ground");
  }
  if (unreliable.size) failures.push(`${unreliable.size} tree${unreliable.size > 1 ? "s" : ""} on the field's rows stand in dense cover in the photographs (wheat, a hedge): not used, and the rows' ends were taken from the trees before them`);
  for (const t of trimmed) if (rowIds.has(t.rowId)) failures.push(`row ${t.rowId}: ${t.ids.length} tree${t.ids.length > 1 ? "s" : ""} at its ${t.end} lie beyond a gap of ${t.gapM.toFixed(0)} m and ${t.why === "off the line" ? "off the row's line: not taken as the row's end (another planting's trees crossing it)" : "beyond ground that is not the field's own: not taken as the row's end (trees past the field's edge)"}`);
  if (onRowTreesOutside) fail("INSUFFICIENT_CROP_SUPPORT", `${onRowTreesOutside} tree${onRowTreesOutside > 1 ? "s" : ""} on the field's rows stand outside the boundary: a missing crop area`);
  if (offRowTreesOutside >= 10) fail("ADJACENT_CULTIVATED_BLOCK_DETECTED", `${offRowTreesOutside} trees off the field's rows stand outside the boundary: a hedge or another planting borders the block and is not included`);
  if (offRowTreesInside >= 3) fail("FOREIGN_GROUND_INSIDE", `${offRowTreesInside} trees off the field's rows stand inside the boundary: part of a hedge or another planting may be included`);
  for (const x of rowsExcluded) failures.push(`row ${x.id} excluded: ${x.reason}`);
  const chosen = components.find(c => c.chosen);
  for (const c of components) {
    if (c.chosen || !chosen) continue;
    if (c.rows.length >= 2 && c.score >= 0.85 * chosen.score && c.trees >= 0.5 * chosen.trees) fail("MULTIPLE_COMPETING_BLOCKS", `another block of ${c.rows.length} rows (${c.trees} trees) scores ${r2(c.score)} against the field's ${r2(chosen.score)} with at least half its trees: the choice between them is narrow`);
    else if (c.rows.length >= 2) fail("ADJACENT_CULTIVATED_BLOCK_DETECTED", `another block of ${c.rows.length} rows (${c.trees} trees) at the same row direction, ${r2(Math.min(Math.abs(c.acrossM[0] - chosen.acrossM[1]), Math.abs(chosen.acrossM[0] - c.acrossM[1])))} m across from the field: not merged`);
  }
  if (rows.length < 2) fail("INSUFFICIENT_ROW_SUPPORT", `${rows.length} reliable row: the block has no width of its own beyond one row's half pitch`);
  if (treesInside < 3 * o.minTrees) fail("INSUFFICIENT_CROP_SUPPORT", `${treesInside} trees on the used rows inside the block (${3 * o.minTrees} wanted)`);
  if (fillShare < 0.6) fail("SPARSE_OR_IRREGULAR_PLANTING", `the used rows hold ${Math.round(100 * fillShare)} % of the positions their spans have at the plant spacing: sparse or irregular planting, the row ends rest on fewer trees`);
  if (stability && (stability.areaMaxM2 - stability.areaMinM2 > 0.1 * areaM2 || stability.medianShiftM > halfPitch)) fail("HIGH_PARAMETER_INSTABILITY", `under ${stability.variants} small changes of the rules the area ranges ${(stability.areaMinM2 / 10_000).toFixed(3)} to ${(stability.areaMaxM2 / 10_000).toFixed(3)} ha and the vertices move ${stability.medianShiftM.toFixed(1)} m (median), ${stability.maxShiftM.toFixed(1)} m at most`);
  const spread = twin.stats?.treePositionSpreadM;
  if (typeof spread === "number" && spread > 0.3) fail("CAMERA_ALIGNMENT_UNCERTAIN", `the trees' positions spread ${spread.toFixed(2)} m between the photographs that saw them: the cameras disagree by more than the boundary's own precision`);
  if (concave && concave.overlapShare < 0.85) failures.push(`the concave baseline of the trees overlaps the boundary by only ${Math.round(100 * concave.overlapShare)} %`);

  return {
    ring, ringField, ringLatLng, vertices, areaM2, uncertaintyM2,
    method: evidence ? "rows and photographs" : "rows only",
    rowsUsed: rows.map(r => r.id), rowsExcluded, failures, failureModes, excludedTrees: { inCover: [...unreliable], trimmed: trimmed.filter(t => rowIds.has(t.rowId)).flatMap(t => t.ids) }, confidence, coverage, stability, components,
    stats: {
      rowPitchM: pitch, plantSpacingM: S,
      extentAlongM: Math.max(...ringField.map(p => p[0])) - Math.min(...ringField.map(p => p[0])), extentAcrossM: Math.max(...ringField.map(p => p[1])) - Math.min(...ringField.map(p => p[1])),
      endMarginM: { median: median(endMargins), min: Math.min(...endMargins), max: Math.max(...endMargins) },
      sideMarginM: { median: median(sideMargins), min: Math.min(...sideMargins), max: Math.max(...sideMargins) },
      support, lengthBySupport, stoppedBy, treesInside, treesInCover: unreliable.size, treesTrimmed: trimmedAll.size, onRowTreesOutside, offRowTreesOutside, offRowTreesInside, fillShare: r3(fillShare), inside,
    },
    baselines: { rowAligned, concave },
    processingMs: now() - t0,
  };
}

/**
 * The whole pass from the sampled ground measurements to the boundary, as the build and the scripts run it: the
 * rows judged on geometry, the ground classified with the field's own crowns as canopy, the trees standing in
 * dense cover found and the rows judged again without them, the ground classified once more, then the inference.
 */
export function inferBoundaryFromMeasures(twin: TwinBundle, measures: EvidenceMeasures, options: Partial<BoundaryOptions> = {}, fr: LocalFrame = localFrame(twin)): { result: BoundaryResult | null; raster: EvidenceRaster; classifyMs: number; treesInCover: number } {
  const t0 = now();
  const treesFor = (rowIds: Set<number>, exclude: Set<number>): EvidenceTree[] => twin.trees.map(t => { const [al, ac] = fr.toField(...fr.toLocal(t.lat, t.lng)); return { along: al, across: ac, r: t.crownRadiusM, onRow: !exclude.has(t.id) && t.rowId != null && rowIds.has(t.rowId) }; });
  const pass1 = reliableRows(twin, null, options, new Set(), fr);
  let raster = classifyEvidence(measures, treesFor(new Set(pass1.rows.map(r => r.id)), new Set(pass1.trimmed.flatMap(t => t.ids)))).raster;
  const inCover = treesInCover(twin, raster, fr);
  const pass2 = reliableRows(twin, raster, options, inCover, fr);
  raster = classifyEvidence(measures, treesFor(new Set(pass2.rows.map(r => r.id)), new Set([...inCover, ...pass2.trimmed.flatMap(t => t.ids)]))).raster;
  const classifyMs = now() - t0;
  return { result: inferBoundary(twin, raster, options), raster, classifyMs, treesInCover: inCover.size };
}

// ------------------------------------------------------------------------------------------------------------------
// The bundle's boundary record and the operator's state.
// ------------------------------------------------------------------------------------------------------------------

/** What a bundle carries: the inferred block with its evidence, never an operational boundary. */
export type TwinBoundary = {
  version: 1;
  cultivated: {
    ring: LatLngPair[];
    vertices: (Pick<BoundaryVertex, "support" | "stoppedBy" | "marginM" | "uncertaintyM" | "side" | "rowId"> & { confidence?: number })[];
    areaM2: number;
    uncertaintyM2: number;
    method: BoundaryResult["method"];
    rowsUsed: number[];
    rowsExcluded: { id: number; reason: string }[];
    failures: string[];
    /** Absent in bundles built before the codes existed. */
    failureModes?: BoundaryFailure[];
    confidence?: BoundaryConfidence;
    components?: BoundaryComponent[];
    stats: BoundaryResult["stats"];
    processingMs: number;
  };
  baselines: { rowAligned: { ring: LatLngPair[]; areaM2: number }; concave: { ring: LatLngPair[]; areaM2: number; overlapShare: number } | null };
  /** Image coverage: the ground seen by any photograph and by two or more (absent in older bundles). */
  coverage?: { anyView: { ring: LatLngPair[]; areaM2: number } | null; twoPlusViews: { ring: LatLngPair[]; areaM2: number } | null; areaM2: number; twoPlusAreaM2: number; meanViews: number };
  stability?: Omit<BoundaryStability, "perVertexShiftM"> | null;
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
      vertices: r.vertices.map(v => ({ support: v.support, stoppedBy: v.stoppedBy, marginM: r2(v.marginM), uncertaintyM: r2(v.uncertaintyM), side: v.side, rowId: v.rowId, confidence: v.confidence })),
      areaM2: Math.round(r.areaM2), uncertaintyM2: Math.round(r.uncertaintyM2), method: r.method, rowsUsed: r.rowsUsed, rowsExcluded: r.rowsExcluded, failures: r.failures, failureModes: r.failureModes, confidence: r.confidence,
      components: r.components.map(c => ({ ...c, score: r3(c.score), acrossM: [r2(c.acrossM[0]), r2(c.acrossM[1])], parts: { r: r3(c.parts.r), d: r3(c.parts.d), c: r3(c.parts.c), p: r3(c.parts.p) } })),
      stats: r.stats, processingMs: Math.round(r.processingMs),
    },
    baselines: { rowAligned: { ring: ll(r.baselines.rowAligned.ringField), areaM2: Math.round(r.baselines.rowAligned.areaM2) }, concave: r.baselines.concave ? { ring: ll(r.baselines.concave.ringField), areaM2: Math.round(r.baselines.concave.areaM2), overlapShare: r2(r.baselines.concave.overlapShare) } : null },
    coverage: {
      anyView: r.coverage.anyView ? { ring: ll(r.coverage.anyView.ringField), areaM2: Math.round(r.coverage.anyView.areaM2) } : null,
      twoPlusViews: r.coverage.twoPlusViews ? { ring: ll(r.coverage.twoPlusViews.ringField), areaM2: Math.round(r.coverage.twoPlusViews.areaM2) } : null,
      areaM2: Math.round(r.coverage.areaM2), twoPlusAreaM2: Math.round(r.coverage.twoPlusAreaM2), meanViews: r2(r.coverage.meanViews),
    },
    stability: r.stability ? { variants: r.stability.variants, areaMinM2: Math.round(r.stability.areaMinM2), areaMaxM2: Math.round(r.stability.areaMaxM2), medianShiftM: r2(r.stability.medianShiftM), maxShiftM: r2(r.stability.maxShiftM) } : null,
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
 * cultivated block is never returned here, whatever its support or confidence, so a spray plan cannot pick it up
 * by accident.
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
