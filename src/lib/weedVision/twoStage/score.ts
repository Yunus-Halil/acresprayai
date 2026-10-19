// The two-stage prototype's scorecard, per field.
//
// Two references, never confused:
//   - RF-DETR everywhere ("the reference run"): the same model on every window.
//     It says how much of what full RF-DETR would flag the two-stage route
//     keeps, and at what share of the GPU time. Agreement with RF-DETR, not
//     accuracy: RF-DETR itself is unvalidated on these fields.
//   - The operator's cell labels, made blind (no model layer on screen). Only
//     these say anything about the weeds, and only with enough of them.
// Definitions follow docs/features/two-stage-weed-intelligence.md, section 5.
import { mercatorPx } from "../mapRun";
import type { GroundPlant } from "../frames";
import { isOnRow } from "../rowFilter";
import { ROUTING_REASONS, type Routing } from "./router";
import { type GridFrame, type Stage1Result, cellAt, cellKey } from "./stage1";

export type ScoreParams = {
  /** A cell is part of a patch at this weed cover or more (5%). */
  patchCover: number;
  /** A patch is high priority at this area, m², or this mean cover. */
  highPriorityAreaM2: number;
  highPriorityCover: number;
  /** A flagged area is false when no cell in it reaches this cover (1%). */
  falseCover: number;
  /** Fewest labelled cells before any label figure is shown. */
  minLabels: number;
};
export const DEFAULT_SCORE: ScoreParams = { patchCover: 0.05, highPriorityAreaM2: 25, highPriorityCover: 0.25, falseCover: 0.01, minLabels: 30 };

/** Wilson 95% interval of k successes in n. */
export function wilson(k: number, n: number): { p: number; lo: number; hi: number } | null {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

/** Weed canopy per cell, m², from the model's weeds between the rows (on-row ones are the crop). */
export function weedM2ByCell(plants: GroundPlant[], g: GridFrame): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of plants) {
    if (p.klass !== "weed" || !p.centre || isOnRow(p.rowStatus) || p.areaM2 == null) continue;
    const [X, Y] = mercatorPx(p.centre.lat, p.centre.lng, g.z);
    const c = cellAt(g, X, Y);
    if (!c) continue;
    const k = cellKey(c.i, c.j);
    out.set(k, (out.get(k) ?? 0) + p.areaM2);
  }
  return out;
}

export type Patch = { cells: string[]; areaM2: number; meanCover: number; highPriority: boolean };

/** Patches: 8-connected cells at or over the patch cover. */
export function patchesOf(cover: Map<string, number>, cellM2: number, params: ScoreParams = DEFAULT_SCORE): Patch[] {
  const on = new Set([...cover.entries()].filter(([, v]) => v >= params.patchCover).map(([k]) => k));
  const seen = new Set<string>();
  const out: Patch[] = [];
  for (const k of on) {
    if (seen.has(k)) continue;
    const cells: string[] = [];
    const stack = [k];
    seen.add(k);
    while (stack.length) {
      const cur = stack.pop()!;
      cells.push(cur);
      const [i, j] = cur.split(":").map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const n = cellKey(i + dx, j + dy);
        if (on.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    const areaM2 = cells.length * cellM2;
    const meanCover = cells.reduce((s, c) => s + (cover.get(c) ?? 0), 0) / cells.length;
    out.push({ cells, areaM2, meanCover, highPriority: areaM2 >= params.highPriorityAreaM2 || meanCover >= params.highPriorityCover });
  }
  return out;
}

export type CellLabel = { coverClass: 0 | 1 | 2 | 3 | 4; highPriority: boolean; at: string };
/** The labelling classes: 0, under 1%, 1 to 5%, 5 to 25%, over 25%, with the cover each stands for when compared. */
export const COVER_CLASSES = ["none", "under 1%", "1 to 5%", "5 to 25%", "over 25%"] as const;
export const CLASS_MIDPOINT = [0, 0.005, 0.03, 0.15, 0.5] as const;

export type Rate = { k: number; n: number; p: number; lo: number; hi: number } | null;
const rate = (k: number, n: number): Rate => { const w = wilson(k, n); return w ? { k, n, ...w } : null; };

export type TwoStageReport = {
  cost: { stage1Ms: number; routedWindows: number; allWindows: number; inspectedShare: number; stage2Ms: number | null; referenceMs: number | null; gpuShare: number | null };
  /** Against RF-DETR everywhere; null until the reference run covers every window. */
  vsReference: null | {
    patches: number; highPriority: number;
    recallStage1: Rate; recallRouted: Rate; highPriorityRecallRouted: Rate; highPriorityRecallStage1: Rate;
    falseCandidates: Rate;
    coverMaePp: number; coverBiasPp: number;
    recallAtBudget: { budget: number; recall: Rate }[];
    missed: Patch[];
  };
  /** What the random audit windows held outside the candidates and the uncertain cells. */
  audit: null | { cells: number; withPatchCover: Rate };
  /** Against the operator's blind cell labels: the two-stage result, and RF-DETR everywhere once it has run. */
  labels: null | { n: number; enough: boolean; patchRecall: Rate; highPriorityRecall: Rate; falseFlags: Rate; stage1MaePp: number | null; modelMaePp: number | null; referencePatchRecall: Rate };
};

/**
 * The scorecard. `plants` are the model's plants from every window that ran (routed or reference); `ran` the
 * windows with a result and their service time; `routing` the route Stage 1 chose.
 */
export function scoreTwoStage(input: {
  stage1: Stage1Result; routing: Routing; plants: GroundPlant[]; ran: Map<string, number | null>; allWindows: string[];
  labels?: Record<string, CellLabel>; params?: ScoreParams;
}): TwoStageReport {
  const { stage1, routing, plants, ran, allWindows } = input;
  const params = input.params ?? DEFAULT_SCORE;
  const g = stage1.grid;
  const cellM2 = (g.cellPx * g.mpp) ** 2;
  const byKey = new Map(stage1.cells.map(c => [c.key, c]));
  const imagedM2 = (k: string) => (byKey.get(k)?.imagedShare ?? 1) * cellM2;
  const weed = weedM2ByCell(plants, g);
  const cover = new Map<string, number>();
  for (const k of byKey.keys()) cover.set(k, Math.min(1, (weed.get(k) ?? 0) / imagedM2(k)));

  const routed = routing.order;
  const inspectedCells = new Set(routed.flatMap(w => routing.cellsOf.get(w) ?? []));
  const sumMs = (names: string[]) => { let s = 0; for (const n of names) { const v = ran.get(n); if (v == null) return null; s += v; } return s; };
  const everyRan = allWindows.every(w => ran.has(w));
  const stage2Ms = routed.every(w => ran.has(w)) ? sumMs(routed) : null;
  const referenceMs = everyRan ? sumMs(allWindows) : null;
  const cost = {
    stage1Ms: stage1.ms, routedWindows: routed.length, allWindows: allWindows.length,
    inspectedShare: allWindows.length ? routed.length / allWindows.length : 0,
    stage2Ms, referenceMs, gpuShare: stage2Ms != null && referenceMs ? stage2Ms / referenceMs : null,
  };

  const candidateCells = new Set(stage1.hotspots.flatMap(h => h.cells));
  let vsReference: TwoStageReport["vsReference"] = null;
  if (everyRan) {
    const patches = patchesOf(cover, cellM2, params);
    const hp = patches.filter(p => p.highPriority);
    const hitStage1 = (p: Patch) => p.cells.some(c => candidateCells.has(c));
    const hitRouted = (p: Patch) => p.cells.some(c => inspectedCells.has(c));
    const falseC = stage1.hotspots.filter(h => !h.cells.some(c => (cover.get(c) ?? 0) >= params.falseCover)).length;
    let ae = 0, bias = 0;
    for (const c of stage1.cells) { const d = c.pressure - (cover.get(c.key) ?? 0); ae += Math.abs(d); bias += d; }
    const n = Math.max(1, stage1.cells.length);
    const ranked = [...stage1.cells].sort((a, b) => b.pressure - a.pressure);
    const patchCells = new Set(patches.flatMap(p => p.cells));
    const recallAtBudget = [0.1, 0.2, 0.3].map(budget => {
      const top = new Set(ranked.slice(0, Math.round(budget * ranked.length)).map(c => c.key));
      return { budget, recall: rate([...patchCells].filter(k => top.has(k)).length, patchCells.size) };
    });
    vsReference = {
      patches: patches.length, highPriority: hp.length,
      recallStage1: rate(patches.filter(hitStage1).length, patches.length),
      recallRouted: rate(patches.filter(hitRouted).length, patches.length),
      highPriorityRecallStage1: rate(hp.filter(hitStage1).length, hp.length),
      highPriorityRecallRouted: rate(hp.filter(hitRouted).length, hp.length),
      falseCandidates: rate(falseC, stage1.hotspots.length),
      coverMaePp: (100 * ae) / n, coverBiasPp: (100 * bias) / n,
      recallAtBudget,
      missed: patches.filter(p => !hitRouted(p)).sort((a, b) => Number(b.highPriority) - Number(a.highPriority) || b.areaM2 - a.areaM2),
    };
  }

  // The audit: cells of audit windows that ran, outside candidates and uncertain cells.
  const auditWindows = routed.filter(w => routing.reasons[w] === "audit" && ran.has(w));
  let audit: TwoStageReport["audit"] = null;
  if (auditWindows.length) {
    const cells = [...new Set(auditWindows.flatMap(w => routing.cellsOf.get(w) ?? []))].filter(k => !candidateCells.has(k) && !byKey.get(k)?.uncertain.some(r => ROUTING_REASONS.has(r)));
    audit = { cells: cells.length, withPatchCover: rate(cells.filter(k => (cover.get(k) ?? 0) >= params.patchCover).length, cells.length) };
  }

  // Against the operator's labels.
  let labels: TwoStageReport["labels"] = null;
  const lab = Object.entries(input.labels ?? {}).filter(([k]) => byKey.has(k));
  if (lab.length) {
    // Cells the routed model actually looked at: those of routed windows with a result.
    const routedSeen = new Set(routed.filter(w => ran.has(w)).flatMap(w => routing.cellsOf.get(w) ?? []));
    const modelSeen = (k: string) => routedSeen.has(k);
    const flagged = (k: string) => candidateCells.has(k) || (modelSeen(k) && (cover.get(k) ?? 0) >= params.patchCover);
    const referenceFlagged = (k: string) => (cover.get(k) ?? 0) >= params.patchCover;
    const patchL = lab.filter(([, l]) => l.coverClass >= 3);
    const hpL = lab.filter(([, l]) => l.highPriority || l.coverClass === 4);
    const flaggedL = lab.filter(([k]) => flagged(k));
    const s1 = lab.reduce((s, [k, l]) => s + Math.abs((byKey.get(k)?.pressure ?? 0) - CLASS_MIDPOINT[l.coverClass]), 0) / lab.length;
    const seen = lab.filter(([k]) => modelSeen(k));
    const m = seen.length ? seen.reduce((s, [k, l]) => s + Math.abs((cover.get(k) ?? 0) - CLASS_MIDPOINT[l.coverClass]), 0) / seen.length : null;
    labels = {
      n: lab.length, enough: lab.length >= params.minLabels,
      patchRecall: rate(patchL.filter(([k]) => flagged(k)).length, patchL.length),
      highPriorityRecall: rate(hpL.filter(([k]) => flagged(k)).length, hpL.length),
      falseFlags: rate(flaggedL.filter(([, l]) => l.coverClass <= 1).length, flaggedL.length),
      stage1MaePp: 100 * s1, modelMaePp: m == null ? null : 100 * m,
      referencePatchRecall: everyRan ? rate(patchL.filter(([k]) => referenceFlagged(k)).length, patchL.length) : null,
    };
  }
  return { cost, vsReference, audit, labels };
}
