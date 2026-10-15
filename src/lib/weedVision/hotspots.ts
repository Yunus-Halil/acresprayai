// From unique plants to areas worth a look.
//
// The model sees thousands of things; the agronomist should only have to
// look at the important ones. This module groups the weeds a scan's photos
// found into areas on a metre grid, measures each area, and ranks them for
// review by measurable signals with their reasons spelled out. It claims no
// severity and no treatment: "review priority" is the order to look in.
//
// Everything is in local metres (toEnu on the scan's reference), never in
// pixels, so the same settings mean the same thing at any flying height.
// Pure: plants in, areas out; the raw observations and the unique plants it
// reads are not changed.
import { type LatLng2 } from "../geo";
import { type LatLngAlt, fromEnu, toEnu } from "../sourceFrames/odm";
import type { GroundPlant } from "./frames";
import { isOnRow } from "./rowFilter";

export type HotspotParams = {
  version: string;
  /** Grid cell edge, metres. */
  cellM: number;
  /** A cell is occupied with at least this many unique weeds (off the rows or unread), or ... */
  minPlants: number;
  /** ... at least this much candidate weed canopy, square metres. */
  minCoveredM2: number;
  /** Confidence under this counts as low. */
  lowConfidence: number;
  /** Weights of the normalised signals in the review priority. */
  weights: { coveredArea: number; density: number; plants: number; offRow: number; lowConfidence: number; observations: number };
};

export const DEFAULT_HOTSPOT_PARAMS: HotspotParams = {
  version: "hotspots-v1",
  cellM: 2,
  minPlants: 2,
  minCoveredM2: 0.02,
  lowConfidence: 0.3,
  weights: { coveredArea: 1.0, density: 1.0, plants: 0.5, offRow: 0.75, lowConfidence: 0.25, observations: 0.25 },
};

export type HotspotCell = {
  ix: number; iy: number;
  ring: LatLng2[];
  /** Unique weeds off the rows or unread in the cell. */
  plants: number;
  /** Weeds the pattern put on a crop plant or a row line, in the cell. */
  onRow: number;
  /** Candidate weed canopy in the cell, m²; null when a plant has no ground sampling. */
  coveredM2: number | null;
};

export type HotspotReview = "confirmed" | "dismissed" | "uncertain";

export type Hotspot = {
  id: string;
  rank: number;
  /** Convex hull of the cells, for the map. */
  ring: LatLng2[];
  cellRings: LatLng2[][];
  centre: LatLng2;
  bbox: { south: number; west: number; north: number; east: number };
  /** Area of the cells, m². */
  areaM2: number;
  /** Unique weeds off the rows or unread. */
  plants: number;
  /** Weeds on crop plants or row lines inside the area: classification to review. */
  onRow: number;
  /** Raw sightings behind the unique plants (repeat sightings included). */
  observations: number;
  /** Candidate weed canopy, m²; null when any plant lacks a ground sampling. */
  coveredM2: number | null;
  /** Unique weeds per m² of the area. */
  density: number;
  offRow: number;
  noRows: number;
  /** Whether a row read backs the off-row signal (at least one plant has a row status other than no-rows). */
  rowReliable: boolean;
  confidence: { mean: number | null; median: number | null; low: number; n: number };
  /** Distinct photographs that saw the area's plants, best views first. */
  frames: string[];
  priority: number;
  signals: Record<string, number>;
  reasons: string[];
  plantIds: string[];
};

export type HotspotSummary = {
  areas: number;
  concentratedOffRow: number;
  classificationToReview: number;
  isolated: number;
  uniqueWeeds: number;
  observations: number;
  rowReadShare: number;
};

export type HotspotResult = {
  hotspots: Hotspot[];
  /** Weeds that occupy no cell: kept, counted, inspectable in the detections mode. */
  isolated: GroundPlant[];
  /** Every cell with a weed in it, for the heatmap. */
  cells: HotspotCell[];
  params: HotspotParams;
  summary: HotspotSummary;
};

const key = (ix: number, iy: number) => `${ix}:${iy}`;

/** Monotone-chain convex hull of points [x, y]. */
export function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** Group the scan's weeds into review areas. `reference` is the scan's local origin (the reconstruction's). */
export function buildHotspots(reference: LatLngAlt, altM: number, plants: GroundPlant[], params: HotspotParams = DEFAULT_HOTSPOT_PARAMS): HotspotResult {
  const C = params.cellM;
  const toLL = (x: number, y: number): LatLng2 => { const g = fromEnu([x, y, altM - reference.altM], reference); return { lat: g.lat, lng: g.lng }; };
  const cellRing = (ix: number, iy: number): LatLng2[] => [toLL(ix * C, iy * C), toLL((ix + 1) * C, iy * C), toLL((ix + 1) * C, (iy + 1) * C), toLL(ix * C, (iy + 1) * C)];
  type Acc = { ix: number; iy: number; seeds: GroundPlant[]; onRow: GroundPlant[]; coveredM2: number; coveredValid: boolean };
  const cells = new Map<string, Acc>();
  const enu = new Map<string, [number, number]>();
  const weeds = plants.filter(p => p.klass === "weed" && p.centre);
  for (const p of weeds) {
    const e = toEnu({ ...p.centre!, altM }, reference);
    enu.set(p.id, [e[0], e[1]]);
    const ix = Math.floor(e[0] / C), iy = Math.floor(e[1] / C);
    const k = key(ix, iy);
    let acc = cells.get(k);
    if (!acc) { acc = { ix, iy, seeds: [], onRow: [], coveredM2: 0, coveredValid: true }; cells.set(k, acc); }
    if (isOnRow(p.rowStatus)) acc.onRow.push(p);
    else {
      acc.seeds.push(p);
      if (p.areaM2 != null) acc.coveredM2 += p.areaM2; else acc.coveredValid = false;
    }
  }
  // Occupied cells, then 8-connected components of them.
  const occupied = new Set<string>();
  for (const [k, a] of cells) {
    if (a.seeds.length >= params.minPlants || (a.coveredValid && a.coveredM2 >= params.minCoveredM2)) occupied.add(k);
  }
  const seen = new Set<string>();
  const groups: Acc[][] = [];
  for (const k of occupied) {
    if (seen.has(k)) continue;
    const group: Acc[] = [];
    const stack = [k];
    seen.add(k);
    while (stack.length) {
      const cur = stack.pop()!;
      const a = cells.get(cur)!;
      group.push(a);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nk = key(a.ix + dx, a.iy + dy);
        if (occupied.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
    groups.push(group);
  }
  const inHotspot = new Set<string>();
  const raw: Omit<Hotspot, "rank" | "priority" | "reasons">[] = [];
  for (const group of groups) {
    const seeds = group.flatMap(a => a.seeds);
    const onRow = group.flatMap(a => a.onRow);
    for (const p of seeds) inHotspot.add(p.id);
    for (const p of onRow) inHotspot.add(p.id);
    const coveredValid = group.every(a => a.coveredValid);
    const coveredM2 = coveredValid ? group.reduce((s, a) => s + a.coveredM2, 0) : null;
    const corners: [number, number][] = group.flatMap(a => [[a.ix * C, a.iy * C], [(a.ix + 1) * C, a.iy * C], [(a.ix + 1) * C, (a.iy + 1) * C], [a.ix * C, (a.iy + 1) * C]] as [number, number][]);
    const hull = convexHull(corners);
    const cx = corners.reduce((s, c) => s + c[0], 0) / corners.length, cy = corners.reduce((s, c) => s + c[1], 0) / corners.length;
    const ring = hull.map(([x, y]) => toLL(x, y));
    const lats = ring.map(q => q.lat), lngs = ring.map(q => q.lng);
    const scores = seeds.map(p => p.score).filter((s): s is number => s != null);
    const frames = [...new Set([...seeds, ...onRow].sort((a, b) => (a.viewAngleDeg ?? 90) - (b.viewAngleDeg ?? 90)).flatMap(p => p.seenIn))];
    const areaM2 = group.length * C * C;
    const offRow = seeds.filter(p => p.rowStatus === "off-row").length;
    const noRows = seeds.filter(p => !p.rowStatus || p.rowStatus === "no-rows").length;
    raw.push({
      id: `${params.version}:${Math.round(cx / 4)}:${Math.round(cy / 4)}`,
      ring, cellRings: group.map(a => cellRing(a.ix, a.iy)), centre: toLL(cx, cy),
      bbox: { south: Math.min(...lats), west: Math.min(...lngs), north: Math.max(...lats), east: Math.max(...lngs) },
      areaM2, plants: seeds.length, onRow: onRow.length, observations: [...seeds, ...onRow].reduce((s, p) => s + 1 + p.duplicates, 0),
      coveredM2, density: seeds.length / areaM2, offRow, noRows, rowReliable: offRow + onRow.length > 0,
      confidence: { mean: scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null, median: median(scores), low: scores.filter(s => s < params.lowConfidence).length, n: scores.length },
      frames, signals: {}, plantIds: [...seeds, ...onRow].map(p => p.id),
    });
  }
  // Review priority: each signal normalised by the field's maximum, weighted, with the reasons that carried it.
  const maxOf = (f: (h: typeof raw[number]) => number) => Math.max(1e-9, ...raw.map(f));
  const mCovered = maxOf(h => h.coveredM2 ?? 0), mDensity = maxOf(h => h.density), mPlants = maxOf(h => h.plants), mObs = maxOf(h => h.observations);
  const w = params.weights;
  const scored: Hotspot[] = raw.map(h => {
    const offRowShare = h.rowReliable ? h.offRow / Math.max(1, h.plants) : 0;
    const lowShare = h.confidence.n ? h.confidence.low / h.confidence.n : 0;
    const signals = {
      coveredArea: (h.coveredM2 ?? 0) / mCovered, density: h.density / mDensity, plants: h.plants / mPlants,
      offRow: offRowShare, lowConfidence: lowShare, observations: h.observations / mObs,
    };
    const total = w.coveredArea + w.density + w.plants + w.offRow + w.lowConfidence + w.observations;
    const priority = (w.coveredArea * signals.coveredArea + w.density * signals.density + w.plants * signals.plants + w.offRow * signals.offRow + w.lowConfidence * signals.lowConfidence + w.observations * signals.observations) / Math.max(1e-9, total);
    const reasons: string[] = [];
    if (h.coveredM2 != null && signals.coveredArea >= 0.5) reasons.push(`${h.coveredM2.toFixed(2)} m² of candidate weed canopy, among the field's largest`);
    if (signals.density >= 0.5) reasons.push(`${h.plants} plants in ${h.areaM2.toFixed(0)} m²: concentrated`);
    else if (h.plants >= 2) reasons.push(`${h.plants} plants in ${h.areaM2.toFixed(0)} m²`);
    if (h.rowReliable && offRowShare >= 0.6) reasons.push(`${Math.round(offRowShare * 100)}% of the plants are between the crop rows`);
    if (h.onRow > 0) reasons.push(`${h.onRow} detection${h.onRow === 1 ? "" : "s"} on crop plants or row lines: classification to review`);
    if (!h.rowReliable) reasons.push("no row read for these photos: position relative to the crop unknown");
    if (lowShare >= 0.5 && h.confidence.n) reasons.push(`${Math.round(lowShare * 100)}% of the detections are under ${params.lowConfidence} confidence: worth a look rather than trust`);
    if (h.frames.length > 1) reasons.push(`seen in ${h.frames.length} photographs`);
    return { ...h, signals, priority, reasons, rank: 0 };
  });
  scored.sort((a, b) => b.priority - a.priority || b.plants - a.plants);
  scored.forEach((h, i) => { h.rank = i + 1; });
  const isolated = weeds.filter(p => !inHotspot.has(p.id));
  const cellList: HotspotCell[] = [...cells.values()].map(a => ({ ix: a.ix, iy: a.iy, ring: cellRing(a.ix, a.iy), plants: a.seeds.length, onRow: a.onRow.length, coveredM2: a.coveredValid ? a.coveredM2 : null }));
  const withRows = weeds.filter(p => p.rowStatus && p.rowStatus !== "no-rows").length;
  const summary: HotspotSummary = {
    areas: scored.length,
    concentratedOffRow: scored.filter(h => h.rowReliable && h.offRow / Math.max(1, h.plants) >= 0.6 && h.signals.density >= 0.5).length,
    classificationToReview: scored.filter(h => h.onRow > 0 || (h.confidence.n > 0 && h.confidence.low / h.confidence.n >= 0.5)).length,
    isolated: isolated.length,
    uniqueWeeds: weeds.length,
    observations: weeds.reduce((s, p) => s + 1 + p.duplicates, 0),
    rowReadShare: weeds.length ? withRows / weeds.length : 0,
  };
  return { hotspots: scored, isolated, cells: cellList, params, summary };
}

/** The summary as the overview sentence, with nothing claimed beyond the counts. */
export function summaryLine(s: HotspotSummary): string {
  const parts = [`${s.areas} area${s.areas === 1 ? "" : "s"} flagged for review`];
  if (s.concentratedOffRow) parts.push(`${s.concentratedOffRow} with concentrated vegetation between the crop rows`);
  if (s.classificationToReview) parts.push(`${s.classificationToReview} with classification to review`);
  if (s.isolated) parts.push(`${s.isolated.toLocaleString()} isolated finding${s.isolated === 1 ? "" : "s"} outside any area`);
  return parts.join("; ") + ".";
}
