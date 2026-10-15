// Comparing two runs on the same photo. Pure.
//
// Instances are paired greedily by centroid distance, nearest first, within a
// radius of half the larger max span (at least 12 px). Pairs are "the same
// weed as seen by both algorithms"; everything unpaired is reported as such.
// Nothing here says which run is right: without a reference there is no truth.
import type { WeedInstance, WeedVisionResult } from "./client";

export type Pair = { a: WeedInstance; b: WeedInstance; distancePx: number; areaDiffPx: number; spanDiffPx: number };
export type Comparison = {
  pairs: Pair[];
  onlyA: WeedInstance[];
  onlyB: WeedInstance[];
  countA: number;
  countB: number;
  countDiff: number;
  runtimeMsA: number;
  runtimeMsB: number;
  medianAreaDiffPx: number | null;
  medianSpanDiffPx: number | null;
};

const median = (xs: number[]) => (xs.length ? [...xs].sort((p, q) => p - q)[Math.floor((xs.length - 1) / 2)] : null);

export function compareRuns(a: WeedVisionResult, b: WeedVisionResult): Comparison {
  const cands: Array<{ i: number; j: number; d: number }> = [];
  a.instances.forEach((ia, i) => b.instances.forEach((ib, j) => {
    const d = Math.hypot(ia.centroid_px[0] - ib.centroid_px[0], ia.centroid_px[1] - ib.centroid_px[1]);
    const r = Math.max(12, 0.5 * Math.max(ia.max_span_px, ib.max_span_px));
    if (d <= r) cands.push({ i, j, d });
  }));
  cands.sort((p, q) => p.d - q.d);
  const usedA = new Set<number>(); const usedB = new Set<number>(); const pairs: Pair[] = [];
  for (const c of cands) {
    if (usedA.has(c.i) || usedB.has(c.j)) continue;
    usedA.add(c.i); usedB.add(c.j);
    const ia = a.instances[c.i]; const ib = b.instances[c.j];
    pairs.push({ a: ia, b: ib, distancePx: c.d, areaDiffPx: ib.area_px - ia.area_px, spanDiffPx: ib.max_span_px - ia.max_span_px });
  }
  return {
    pairs,
    onlyA: a.instances.filter((_, i) => !usedA.has(i)),
    onlyB: b.instances.filter((_, j) => !usedB.has(j)),
    countA: a.count, countB: b.count, countDiff: b.count - a.count,
    runtimeMsA: a.timings_ms.total ?? 0, runtimeMsB: b.timings_ms.total ?? 0,
    medianAreaDiffPx: median(pairs.map(p => p.areaDiffPx)),
    medianSpanDiffPx: median(pairs.map(p => p.spanDiffPx)),
  };
}
