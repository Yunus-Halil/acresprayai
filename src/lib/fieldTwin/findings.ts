// Explore Findings: the ranked lists behind the Field Twin's filters, and the adaptive prominence rule that decides
// how many of them the map emphasises. Everything here is computed from the twin's reconciled objects and the
// field intelligence; nothing is estimated for display, and no finding is ever dropped from a list because the
// map chose not to label it.
//
// The metrics stay distinct (docs/features/field-twin-adaptive-map.md):
//   weed size            one candidate's measured ground cover (areaM2)
//   patch footprint      the ground a connected group of candidates spans (convex hull of the members' extents)
//   summed cover         the members' areas added up (never the footprint)
//   pressure             verified cover as a share of the OBSERVABLE ground of a region (cells under canopy and
//                        ground no photograph saw are excluded from the denominator, never counted as weed-free)
//   affected ground      a region's area in square metres (its cells), regardless of how dense it is
//   model confidence     the detector's score for one candidate, kept apart from how many photographs agree on it
import { type FieldIntelligence, type ScoutingZone, convexHull, scoutingZones } from "./intelligence";
import type { RowStatus, TwinBundle, TwinWeed } from "./types";

export type FindingMode = "overview" | "largest" | "clusters" | "pressure" | "extent" | "confidence" | "rows";
export type RowRelation = "any" | "on a row" | "between rows";

export type FindingsQuery = {
  mode: FindingMode;
  /** Largest weeds and the row filter: least ground cover of one candidate, square metres. */
  minAreaM2?: number;
  /** Biggest patches: least footprint, square metres. */
  minFootprintM2?: number;
  /** Pressure and extent: regions are connected cells at or above this cover percent (of observable ground). */
  minCoverPct?: number;
  /** Highest confidence: least model score, 0 to 1. */
  minScore?: number;
  /** On a crop row, between rows, or either (weed and patch modes). */
  rowRelation?: RowRelation;
};

export const MODE_LABEL: Record<FindingMode, string> = {
  overview: "Overview", largest: "Largest individual weeds", clusters: "Biggest weed patches", pressure: "Highest weed pressure", extent: "Most extensive affected areas", confidence: "Highest confidence", rows: "Near crop rows / between rows",
};

export type Finding = {
  kind: "weed" | "patch" | "region";
  /** Weed id, patch id or region id (regions are numbered by rank within one query). */
  id: number;
  lat: number;
  lng: number;
  /** The quantity the list is ranked by, and which metric it is. */
  value: number;
  valueOf: "weed area m2" | "footprint m2" | "cover % of observable ground" | "affected ground m2" | "model score" | "verified cover m2";
  /** One candidate's measured ground cover. */
  weedAreaM2?: number;
  /** A patch's footprint (hull) and its members' summed cover: two different numbers, both kept. */
  footprintM2?: number;
  coverM2?: number;
  members?: number;
  /** A region's ground, its observable ground, and verified cover as a share of the observable ground. */
  affectedM2?: number;
  observableM2?: number;
  coverPct?: number;
  /** Detector score (one candidate, or a patch's median), null when the model gave none. */
  score?: number | null;
  /** Agreement across photographs: how it was verified, kept apart from the score. */
  consistency?: { seenBy: number; coveredBy: number; viewSpreadM: number; sizeCv: number };
  rowStatus?: RowStatus;
  /** Measurement uncertainty, 0 (certain) to 1: sizeCv for a weed, the members' median for a patch, the share of
   *  cells seen once for a region. The prominence rule reads it; the ranking does not. */
  uncertainty: number;
  /** How far the finding reaches from its centre, metres (for zooming and the highlight). */
  reachM: number;
  /** Boundary in local metres (patch hull or region rings), when the finding has one. */
  rings?: [number, number][][];
  /** Member weed ids (patches). */
  weedIds?: number[];
};

export type Prominence = {
  /** How many findings, from the top of the list, the map emphasises. */
  count: number;
  rule: "none" | "single" | "dominant" | "similar";
  /** The ratio between the last emphasised value and the next one (dominant), with the index of the break. */
  breakRatio: number | null;
  breakAt: number | null;
};

export type FindingsResult = {
  query: FindingsQuery;
  /** Every qualifying finding, best first. Nothing is removed from this list for display reasons. */
  findings: Finding[];
  prominence: Prominence;
  /** How the list was made, in words the panel shows. */
  note: string;
  /** What was excluded and why (for the empty state and the panel). */
  excluded: { reason: string; count: number }[];
};

// --------------------------------------------------------------------------------------------------------------
// Connected patches: candidates whose extents touch or nearly touch, by union-find over a grid.
// --------------------------------------------------------------------------------------------------------------

export type WeedPatch = {
  id: number;
  /** Centre of the members' extents, local metres. */
  centre: [number, number];
  /** Convex hull of the members' extents (four points per member), local metres. */
  hull: [number, number][];
  /** Hull area, never less than the members' summed cover (two members in a line have no hull area). */
  footprintM2: number;
  coverM2: number;
  members: number[];
  rowStatus: RowStatus;
  medianScore: number | null;
  medianSizeCv: number;
  reachM: number;
};

/** The gap (edge to edge) within which two candidates belong to one patch, metres. */
export const PATCH_LINK_M = 0.75;

/**
 * Connected patches of verified candidates: two candidates are linked when the gap between their extents is at most
 * `linkM`; a patch is a connected set of two or more. Single candidates are not patches (they are findings in the
 * weed lists). Each candidate is one object in the twin already (reconciled across its photographs), so a patch
 * counts it once.
 */
export function weedPatches(twin: TwinBundle, intel: FieldIntelligence, linkM = PATCH_LINK_M): WeedPatch[] {
  const f = intel.frame;
  const ws: TwinWeed[] = [];
  for (const w of twin.weeds) if (w.status === "verified") ws.push(w);
  const n = ws.length;
  if (n < 2) return [];
  const xs = new Float64Array(n), ys = new Float64Array(n), rs = new Float32Array(n);
  let maxR = 0;
  ws.forEach((w, i) => { const [e, no] = f.toLocal(w.lat, w.lng); xs[i] = e; ys[i] = no; rs[i] = w.diameterM / 2; if (rs[i] > maxR) maxR = rs[i]; });
  // Union-find. Points are bucketed on a fine lattice of linkM / sqrt(2): any two in one cell are within linkM of
  // each other and join at once. Across cells, two buckets whose sets still differ are compared pair by pair only
  // until the first link (dense hot spots would otherwise cost every point a scan of a thousand neighbours).
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const c = linkM / Math.SQRT2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i]; if (ys[i] < y0) y0 = ys[i]; if (ys[i] > y1) y1 = ys[i]; }
  const nx = Math.floor((x1 - x0) / c) + 1, ny = Math.floor((y1 - y0) / c) + 1;
  const cellOf = new Int32Array(n), start = new Int32Array(nx * ny + 1);
  for (let i = 0; i < n; i++) { const k = Math.floor((ys[i] - y0) / c) * nx + Math.floor((xs[i] - x0) / c); cellOf[i] = k; start[k + 1]++; }
  for (let k = 0; k < nx * ny; k++) start[k + 1] += start[k];
  const fill = start.slice(0, -1), items = new Int32Array(n);
  for (let i = 0; i < n; i++) items[fill[cellOf[i]]++] = i;
  for (let k = 0; k < nx * ny; k++) for (let p = start[k] + 1; p < start[k + 1]; p++) union(items[start[k]], items[p]);
  const reach = Math.ceil((2 * maxR + linkM) / c);
  const linked = (a: number, b: number) => Math.hypot(xs[a] - xs[b], ys[a] - ys[b]) <= rs[a] + rs[b] + linkM;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (start[k] === start[k + 1]) continue;
    for (let dj = 0; dj <= reach; dj++) for (let di = dj === 0 ? 1 : -reach; di <= reach; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || ii >= nx || jj >= ny) continue;
      const q = jj * nx + ii;
      if (start[q] === start[q + 1] || find(items[start[k]]) === find(items[start[q]])) continue;
      let joined = false;
      for (let p = start[k]; p < start[k + 1] && !joined; p++) for (let r = start[q]; r < start[q + 1]; r++) if (linked(items[p], items[r])) { union(items[p], items[r]); joined = true; break; }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) { const root = find(i); (groups.get(root) ?? groups.set(root, []).get(root)!).push(i); }
  const patches: WeedPatch[] = [];
  let id = 1;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const pts: [number, number][] = [];
    let coverM2 = 0, cx = 0, cy = 0;
    for (const i of g) { const r = rs[i]; pts.push([xs[i] - r, ys[i]], [xs[i] + r, ys[i]], [xs[i], ys[i] - r], [xs[i], ys[i] + r]); coverM2 += ws[i].areaM2; cx += xs[i]; cy += ys[i]; }
    cx /= g.length; cy /= g.length;
    const hull = convexHull(pts);
    const hullArea = Math.abs(hull.reduce((s, [x, y], k) => { const [x2, y2] = hull[(k + 1) % hull.length]; return s + x * y2 - x2 * y; }, 0)) / 2;
    const scores = g.map(i => ws[i].score).filter((v): v is number => v != null).sort((a, b) => a - b);
    const cvs = g.map(i => ws[i].sizeCv).sort((a, b) => a - b);
    const onRow = g.filter(i => ws[i].rowStatus === "on a row").length, between = g.filter(i => ws[i].rowStatus === "between rows").length;
    let reach = 0; for (const [x, y] of hull) reach = Math.max(reach, Math.hypot(x - cx, y - cy));
    patches.push({
      id: id++, centre: [cx, cy], hull, footprintM2: Math.max(hullArea, coverM2), coverM2, members: g.map(i => ws[i].id),
      rowStatus: onRow > between ? "on a row" : between > 0 ? "between rows" : "no rows",
      medianScore: scores.length ? scores[scores.length >> 1] : null, medianSizeCv: cvs[cvs.length >> 1], reachM: reach,
    });
  }
  patches.sort((a, b) => b.footprintM2 - a.footprintM2);
  patches.forEach((p, k) => { p.id = k + 1; });
  return patches;
}

// --------------------------------------------------------------------------------------------------------------
// The prominence rule.
// --------------------------------------------------------------------------------------------------------------

/**
 * How many of a ranked list the map emphasises. The rule, in words:
 *   - nothing qualifies: none; one qualifies: that one.
 *   - Each value is first discounted by its uncertainty (v' = v * (1 - u), u capped at 0.9), so an uncertain
 *     measurement cannot create a break on its own. The order stays the order of the measured values.
 *   - Walking down the top of the list (at most 24 steps), the first place where a value is at least `breakRatio`
 *     times the next one is a break: the findings above it stand clearly apart and are the emphasised set
 *     ("dominant").
 *   - With no such break, the findings are similarly significant: all of them are emphasised ("similar") and the
 *     map's job is to summarise them at the current zoom, never to drop some.
 * Deterministic and testable: the same values give the same answer on every field.
 */
export function prominence(values: ArrayLike<number>, uncertainty?: ArrayLike<number>, breakRatio = 2, maxSteps = 24): Prominence {
  const n = values.length;
  if (n === 0) return { count: 0, rule: "none", breakRatio: null, breakAt: null };
  if (n === 1) return { count: 1, rule: "single", breakRatio: null, breakAt: null };
  const v = (i: number) => Math.max(0, values[i]) * (1 - Math.min(0.9, uncertainty ? uncertainty[i] : 0));
  for (let i = 1; i < Math.min(n, maxSteps + 1); i++) {
    const a = v(i - 1), b = v(i);
    if (b <= 0 ? a > 0 : a / b >= breakRatio) return { count: i, rule: "dominant", breakRatio: b <= 0 ? Infinity : a / b, breakAt: i };
  }
  return { count: n, rule: "similar", breakRatio: null, breakAt: null };
}

// --------------------------------------------------------------------------------------------------------------
// The engine: one object per twin, with the expensive parts computed once and the queries cheap.
// --------------------------------------------------------------------------------------------------------------

export class FindingsEngine {
  private patches: WeedPatch[] | null = null;
  private zonesAt = new Map<number, ScoutingZone[]>();
  /** Verified and single-view candidates (never detections on crowns), sorted by area, largest first. */
  private byArea: TwinWeed[] | null = null;

  constructor(readonly twin: TwinBundle, readonly intel: FieldIntelligence) {}

  getPatches(): WeedPatch[] { return (this.patches ??= weedPatches(this.twin, this.intel)); }
  zones(minCoverPct: number): ScoutingZone[] {
    const key = Math.round(minCoverPct * 100) / 100;
    let z = this.zonesAt.get(key);
    if (!z) { z = Math.abs(key - 1.5) < 1e-9 ? this.intel.zones : scoutingZones(this.intel.grid, key); this.zonesAt.set(key, z); }
    return z;
  }
  private candidates(): TwinWeed[] {
    if (!this.byArea) { this.byArea = this.twin.weeds.filter(w => w.status === "verified"); this.byArea.sort((a, b) => b.areaM2 - a.areaM2); }
    return this.byArea;
  }

  run(query: FindingsQuery): FindingsResult {
    const f = this.intel.frame, rel = query.rowRelation ?? "any";
    const excluded: FindingsResult["excluded"] = [];
    const singles = this.twin.weeds.filter(w => w.status === "single view").length, onTree = this.twin.weeds.filter(w => w.status === "on a tree").length;
    const weedFinding = (w: TwinWeed, value: number, valueOf: Finding["valueOf"]): Finding => ({
      kind: "weed", id: w.id, lat: w.lat, lng: w.lng, value, valueOf, weedAreaM2: w.areaM2, score: w.score,
      consistency: { seenBy: w.seenBy, coveredBy: w.coveredBy, viewSpreadM: w.viewSpreadM, sizeCv: w.sizeCv }, rowStatus: w.rowStatus,
      uncertainty: Math.min(1, w.sizeCv), reachM: Math.max(w.diameterM / 2, (w.spanM ?? 0) / 2),
    });
    const byRow = (w: { rowStatus: RowStatus }) => rel === "any" || w.rowStatus === rel;
    let findings: Finding[] = [], note = "";

    if (query.mode === "largest" || query.mode === "rows") {
      const min = query.minAreaM2 ?? 0;
      let dropped = 0;
      for (const w of this.candidates()) { if (w.areaM2 < min) break; if (!byRow(w)) { dropped++; continue; } findings.push(weedFinding(w, w.areaM2, "weed area m2")); }
      if (dropped) excluded.push({ reason: rel === "on a row" ? "between the rows" : "on a crop row", count: dropped });
      note = `Verified candidates ranked by measured ground cover${min > 0 ? ` of at least ${min} m²` : ""}${rel === "any" ? "" : `, ${rel}`}.`;
    } else if (query.mode === "confidence") {
      const min = query.minScore ?? 0;
      let noScore = 0, dropped = 0;
      for (const w of this.candidates()) {
        if (w.score == null) { noScore++; continue; }
        if (w.score < min) { dropped++; continue; }
        if (!byRow(w)) continue;
        findings.push(weedFinding(w, w.score, "model score"));
      }
      // Ties on the score are broken by how many views agree, then by area; agreement is shown, not mixed in.
      findings.sort((a, b) => b.value - a.value || (b.consistency!.seenBy / b.consistency!.coveredBy) - (a.consistency!.seenBy / a.consistency!.coveredBy) || b.weedAreaM2! - a.weedAreaM2!);
      if (noScore) excluded.push({ reason: "no model score recorded", count: noScore });
      if (dropped) excluded.push({ reason: `score under ${Math.round(min * 100)} %`, count: dropped });
      note = "Verified candidates ranked by the detector's own score. How many photographs agree is listed beside it, not added to it.";
    } else if (query.mode === "clusters") {
      const min = query.minFootprintM2 ?? 0;
      for (const p of this.getPatches()) {
        if (p.footprintM2 < min) break;
        if (!byRow(p)) continue;
        const [lat, lng] = f.toLatLng(p.centre[0], p.centre[1]);
        findings.push({ kind: "patch", id: p.id, lat, lng, value: p.footprintM2, valueOf: "footprint m2", footprintM2: p.footprintM2, coverM2: p.coverM2, members: p.members.length, score: p.medianScore, rowStatus: p.rowStatus, uncertainty: Math.min(1, p.medianSizeCv), reachM: p.reachM, rings: [p.hull], weedIds: p.members });
      }
      note = `Connected patches of verified candidates (gaps of ${PATCH_LINK_M} m or less), ranked by the ground they span. Summed cover is listed separately.`;
    } else if (query.mode === "pressure" || query.mode === "extent" || query.mode === "overview") {
      const min = query.minCoverPct ?? 1.5;
      const zones = this.zones(min);
      findings = zones.map(z => {
        const [lat, lng] = f.toLatLng(z.centre[0], z.centre[1]);
        const value = query.mode === "pressure" ? z.meanCoverPct : query.mode === "extent" ? z.areaM2 : z.coverM2;
        return { kind: "region" as const, id: z.id, lat, lng, value, valueOf: query.mode === "pressure" ? "cover % of observable ground" as const : query.mode === "extent" ? "affected ground m2" as const : "verified cover m2" as const, affectedM2: z.areaM2, observableM2: z.observableM2, coverPct: z.meanCoverPct, coverM2: z.coverM2, members: z.weeds, uncertainty: z.singleCoverageShare, reachM: Math.sqrt(z.areaM2) * 0.8, rings: z.rings };
      });
      findings.sort((a, b) => b.value - a.value);
      note = query.mode === "pressure" ? `Connected ground at ${min} % cover or more, ranked by cover as a share of its observable ground (canopy and unseen ground excluded).`
        : query.mode === "extent" ? `Connected ground at ${min} % cover or more, ranked by how much ground it affects, however dense.`
        : `Connected ground at ${min} % cover or more, ranked by total verified cover (density times ground).`;
    }
    if (query.mode !== "overview") {
      if (singles) excluded.push({ reason: "seen in one photograph only (unverified)", count: singles });
      if (onTree) excluded.push({ reason: "detections on tree crowns", count: onTree });
    }
    // Regions are renumbered by rank so "Region 1" is the top of this list.
    if (findings.length && findings[0].kind === "region") findings.forEach((x, k) => { x.id = k + 1; });
    const prom = prominence(findings.map(x => x.value), findings.map(x => x.uncertainty));
    return { query, findings, prominence: prom, note, excluded };
  }
}

/** The number or quantity a finding is ranked by, as a short text. */
export function findingValueText(x: Finding, fmtArea: (m2: number) => string): string {
  switch (x.valueOf) {
    case "weed area m2": case "footprint m2": case "affected ground m2": case "verified cover m2": return fmtArea(x.value);
    case "cover % of observable ground": return `${x.value.toFixed(1)} %`;
    case "model score": return `${Math.round(x.value * 100)} %`;
  }
}
