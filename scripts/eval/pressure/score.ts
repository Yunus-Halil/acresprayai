// The grade scored against a truth file of quadrats. Pure: a grade, its grid and the quadrats in; numbers out.
//
// Each quadrat is a north-up square on the ground. It is matched to the grade's cells by overlap area in the grid's
// own pixels (cell (i, j) covers [left + i * cellPx, left + (i + 1) * cellPx) and the same down), and only its
// assessed cells speak for it:
//   cover      sum of overlap x Stage 1's weed m² over sum of overlap x visible ground m² (weed over the visible
//              ground, as the grade reads it; weed is taken as even inside a cell)
//   count      objects per assessed ground across the overlap, times the quadrat's area
//   act        the grade acts on the quadrat when at least half of its assessed overlap is in cells classed at the
//              scheme's action point or over (the class the map draws red, judged over the treatment unit); the
//              truth acts when its cover is at or over the scheme's action point
//   scored     only when at least half of the quadrat is assessed ground; the rest are listed, never scored as
//              weed-free, and their unassessed cells counted by reason
// Patch IoU is measured inside the quadrats only (the truth says nothing outside them): the grade's patch cells
// against the quadrats whose truth is at or over the action point, by area, sampled at an eighth of a cell.
import type { PressureGrade } from "../../../src/lib/weedVision/pressure/grade";
import { CLASS_ORDER } from "../../../src/lib/weedVision/pressure/grade";
import { mercatorPx } from "../../../src/lib/weedVision/mapRun";
import { type GridFrame, cellKey } from "../../../src/lib/weedVision/twoStage/stage1";
import type { TruthQuadrat } from "./fixture";

/** A quadrat is scored when at least this share of it is assessed ground. */
export const MIN_ASSESSED_SHARE = 0.5;

export type QuadratScore = {
  id: string; sideM: number;
  truthCover: number; truthCount: number;
  /** Share of the quadrat's area in assessed cells. */
  assessedShare: number;
  scored: boolean;
  predCover: number | null; predCount: number | null;
  truthAct: boolean; predAct: boolean | null;
  /** The quadrat's cells that were not assessed, with their reasons. */
  notAssessedCells: { key: string; whyNot: string[] }[];
};

export type EvalMetrics = {
  quadrats: number; scored: number; notScored: number;
  cover: { mae: number | null; bias: number | null; rmse: number | null };
  count: { mae: number | null; bias: number | null };
  /** At the scheme's action point: act / don't act. */
  confusion: { tp: number; fp: number; fn: number; tn: number; precision: number | null; recall: number | null };
  /** The grade's patch cells against the truth quadrats at or over the action point, inside the quadrats. */
  patchIoU: number | null;
  /** The same with the cells classed at the action point or over in place of the patch cells (ours, beside the patch IoU). */
  actionIoU: number | null;
  /** Distinct cells inside truth quadrats that were not assessed, by reason (a cell can carry several). */
  notAssessedByReason: Record<string, number>;
  notAssessedCells: number;
  actionPoint: number;
};

type Rect = { x0: number; y0: number; x1: number; y1: number };
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** The quadrat in the grid's global pixels. */
export function quadratRect(q: TruthQuadrat, g: GridFrame): Rect {
  const [X, Y] = mercatorPx(q.centre.lat, q.centre.lng, g.z);
  const h = q.sideM / 2 / g.mpp;
  return { x0: X - h, y0: Y - h, x1: X + h, y1: Y + h };
}

const cellRect = (g: GridFrame, i: number, j: number): Rect => ({ x0: g.left + i * g.cellPx, y0: g.top + j * g.cellPx, x1: g.left + (i + 1) * g.cellPx, y1: g.top + (j + 1) * g.cellPx });

export function scoreGrade(grade: PressureGrade, g: GridFrame, truth: TruthQuadrat[]): { metrics: EvalMetrics; quadrats: QuadratScore[] } {
  const byKey = new Map(grade.cells.map(c => [c.key, c]));
  const atAction = (k: (typeof grade.cells)[number]["klass"]) => CLASS_ORDER.indexOf(k) >= CLASS_ORDER.indexOf("action");
  const actionPoint = grade.scheme.action;
  const cellArea = g.cellPx * g.cellPx;
  const notAssessed = new Map<string, string[]>();
  const quadrats: QuadratScore[] = truth.map(q => {
    const r = quadratRect(q, g), qArea = (r.x1 - r.x0) * (r.y1 - r.y0);
    const i0 = Math.floor((r.x0 - g.left) / g.cellPx), i1 = Math.floor((r.x1 - g.left - 1e-9) / g.cellPx);
    const j0 = Math.floor((r.y0 - g.top) / g.cellPx), j1 = Math.floor((r.y1 - g.top - 1e-9) / g.cellPx);
    let aArea = 0, weed = 0, ground = 0, count = 0, actArea = 0;
    const missing: QuadratScore["notAssessedCells"] = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const ov = overlap(r, cellRect(g, i, j));
      if (!(ov > 0)) continue;
      const c = byKey.get(cellKey(i, j));
      if (!c) { missing.push({ key: cellKey(i, j), whyNot: ["outside the field"] }); notAssessed.set(cellKey(i, j), ["outside the field"]); continue; }
      if (!c.assessed) { missing.push({ key: c.key, whyNot: c.whyNot }); notAssessed.set(c.key, c.whyNot); continue; }
      const w = ov / cellArea;
      aArea += ov; weed += w * c.weedM2; ground += w * c.groundM2; count += w * c.count;
      if (atAction(c.klass)) actArea += ov;
    }
    const assessedShare = qArea > 0 ? aArea / qArea : 0;
    const scored = assessedShare >= MIN_ASSESSED_SHARE && ground > 0;
    return {
      id: q.id, sideM: q.sideM, truthCover: q.cover, truthCount: q.count, assessedShare, scored,
      predCover: scored ? weed / ground : null, predCount: scored ? count / assessedShare : null,
      truthAct: q.cover >= actionPoint, predAct: scored ? actArea >= 0.5 * aArea : null,
      notAssessedCells: missing,
    };
  });

  const s = quadrats.filter(q => q.scored);
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  const dc = s.map(q => q.predCover! - q.truthCover), dn = s.map(q => q.predCount! - q.truthCount);
  const tp = s.filter(q => q.predAct && q.truthAct).length, fp = s.filter(q => q.predAct && !q.truthAct).length;
  const fn = s.filter(q => !q.predAct && q.truthAct).length, tn = s.filter(q => !q.predAct && !q.truthAct).length;

  // IoU inside the quadrats, sampled at an eighth of a cell on a lattice tied to the grid (so overlapping quadrats are sampled once).
  const patchCells = new Set(grade.patches.flatMap(p => p.cells));
  const actionCells = new Set(grade.cells.filter(c => c.assessed && atAction(c.klass)).map(c => c.key));
  const step = Math.max(1e-6, g.cellPx / 8);
  const rects = truth.map(q => ({ r: quadratRect(q, g), act: q.cover >= actionPoint }));
  const seen = new Set<string>();
  let pI = 0, pU = 0, aI = 0, aU = 0;
  for (const { r } of rects) {
    for (let y = Math.ceil((r.y0 - g.top) / step - 0.5); (y + 0.5) * step + g.top < r.y1; y++) for (let x = Math.ceil((r.x0 - g.left) / step - 0.5); (x + 0.5) * step + g.left < r.x1; x++) {
      const X = g.left + (x + 0.5) * step, Y = g.top + (y + 0.5) * step;
      if (X < r.x0 || Y < r.y0) continue;
      const k = `${x}:${y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const t = rects.some(q => q.act && X >= q.r.x0 && X < q.r.x1 && Y >= q.r.y0 && Y < q.r.y1);
      const ck = cellKey(Math.floor((X - g.left) / g.cellPx), Math.floor((Y - g.top) / g.cellPx));
      const p = patchCells.has(ck), a = actionCells.has(ck);
      if (p && t) pI++; if (p || t) pU++;
      if (a && t) aI++; if (a || t) aU++;
    }
  }
  const notAssessedByReason: Record<string, number> = {};
  for (const why of notAssessed.values()) for (const w of why) notAssessedByReason[w] = (notAssessedByReason[w] ?? 0) + 1;

  return {
    quadrats,
    metrics: {
      quadrats: quadrats.length, scored: s.length, notScored: quadrats.length - s.length,
      cover: { mae: mean(dc.map(Math.abs)), bias: mean(dc), rmse: s.length ? Math.sqrt(mean(dc.map(d => d * d))!) : null },
      count: { mae: mean(dn.map(Math.abs)), bias: mean(dn) },
      confusion: { tp, fp, fn, tn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null },
      patchIoU: pU ? pI / pU : null, actionIoU: aU ? aI / aU : null,
      notAssessedByReason, notAssessedCells: notAssessed.size, actionPoint,
    },
  };
}
