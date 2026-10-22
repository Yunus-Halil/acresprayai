// Recall of labelled weed points against the grade: the classification, pure (points-recall.ts runs it on DJI_0301).
// Each weed label is put in its grade cell and given the first class that holds, in this order:
//   seen          an object the grade counted (any tier) has its centre within 0.25 m of the point
//   below-floor   the nearest object within 0.25 m is one the grade set apart as under its detection floor
//   in-band       the point is inside the ground the grade cuts away: the row band or a crown with its margin, as
//                 layout/rowBand.ts (rowsForGround, rowBandMask) paints it for Stage 1
//   not-assessed  the point's cell exists but was not assessed (its reasons given), or it has no cell (outside the
//                 field's grid)
//   missed        none of these: an assessed cell, no object within 0.25 m
// The objects counted and set apart are exactly the grade's (grade.ts sortObjects). Per label the cell's class, tier
// and near-crop flag are kept too.
import type { LatLng2 } from "../../../src/lib/geo";
import type { FieldRows } from "../../../src/lib/weedVision/fieldRows";
import { PAINT_CROWN_MARGIN_M, rowBandMask, rowsForGround } from "../../../src/lib/weedVision/layout/rowBand";
import { mercatorPx } from "../../../src/lib/weedVision/mapRun";
import { type PressureClass, type PressureGrade, type WeedObject, sortObjects } from "../../../src/lib/weedVision/pressure/grade";
import { type GridFrame, cellAt, cellKey } from "../../../src/lib/weedVision/twoStage/stage1";

export const RECALL_RADIUS_M = 0.25;
export const RECALL_CLASSES = ["seen", "below-floor", "in-band", "not-assessed", "missed"] as const;
export type RecallClass = (typeof RECALL_CLASSES)[number];

export type PointLabel = { id: string; centre: LatLng2; x?: number; y?: number };
export type PointResult = {
  id: string; x: number | null; y: number | null; lat: number; lng: number;
  class: RecallClass; reason: string | null;
  /** Distance to the nearest counted object and to the nearest object under the floor, metres (null when none in the field). */
  nearestCountedM: number | null; nearestBelowFloorM: number | null;
  cell: string | null; klass: PressureClass | null; tier: string | null; nearCrop: boolean | null;
};

/** Each point classified against the grade, its counted and below-floor objects, and the ground Stage 1 cut. */
export function pointsRecall(input: { grade: PressureGrade; grid: GridFrame; rows: FieldRows | null; objects: WeedObject[]; points: PointLabel[]; radiusM?: number }): PointResult[] {
  const { grade, grid: g, rows } = input;
  const R = input.radiusM ?? RECALL_RADIUS_M;
  const sorted = sortObjects(input.objects, rows, g, grade.params.floorPx);
  const px = (q: LatLng2) => mercatorPx(q.lat, q.lng, g.z);
  const counted = sorted.counted.map(o => px(o.p.centre)), below = sorted.belowFloor.map(o => px(o.centre));
  const ground = rows ? rowsForGround(rows, PAINT_CROWN_MARGIN_M / rows.mpp) : null;
  const byKey = new Map(grade.cells.map(c => [c.key, c]));
  const nearest = (pts: [number, number][], X: number, Y: number) => { let b = Infinity; for (const [x, y] of pts) { const d = Math.hypot(x - X, y - Y); if (d < b) b = d; } return Number.isFinite(b) ? b * g.mpp : null; };
  return input.points.map(p => {
    const [X, Y] = px(p.centre);
    const dC = nearest(counted, X, Y), dB = nearest(below, X, Y);
    const c = cellAt(g, X, Y), key = c ? cellKey(c.i, c.j) : null, cell = key ? byKey.get(key) : undefined;
    const inBand = !!ground && rowBandMask(ground, g.z, Math.floor(X), Math.floor(Y), 1, 1)[0] === 1;
    let cls: RecallClass, reason: string | null = null;
    if (dC != null && dC <= R) cls = "seen";
    else if (dB != null && dB <= R) cls = "below-floor";
    else if (inBand) cls = "in-band";
    else if (!cell) { cls = "not-assessed"; reason = "no cell (outside the field's grid)"; }
    else if (!cell.assessed) { cls = "not-assessed"; reason = cell.whyNot.join("+"); }
    else cls = "missed";
    return {
      id: p.id, x: p.x ?? null, y: p.y ?? null, lat: p.centre.lat, lng: p.centre.lng, class: cls, reason,
      nearestCountedM: dC, nearestBelowFloorM: dB,
      cell: key, klass: cell?.assessed ? cell.klass : null, tier: cell?.assessed ? cell.tier : null, nearCrop: cell ? cell.nearCrop : null,
    };
  });
}

export function recallCsv(rs: PointResult[]): string {
  const f = (v: number | null, d: number) => (v == null ? "" : v.toFixed(d));
  const head = "id,x,y,lat,lng,class,reason,nearestCountedM,nearestBelowFloorM,cell,klass,tier,nearCrop";
  return [head, ...rs.map(r => [r.id, f(r.x, 1), f(r.y, 1), f(r.lat, 8), f(r.lng, 8), r.class, r.reason ?? "", f(r.nearestCountedM, 3), f(r.nearestBelowFloorM, 3), r.cell ?? "", r.klass ?? "", r.tier ?? "", r.nearCrop == null ? "" : String(r.nearCrop)].join(","))].join("\n") + "\n";
}
