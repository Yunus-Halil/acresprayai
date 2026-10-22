// The cells where the map's pixels and the weeds found disagree, as CSV: candidate model false positives to look at.
//
// A cell is listed when it was assessed and |pixels' weed - objects' weed| over its visible ground is over the grade's
// disagreeShare (0.1). Sorted by objM2 - pixelM2, largest first: the top of the list is where the model claims far more
// weed than the map's own green shows (a tree crown or a crown's rim called a weed, a box drawn round soil), the cells
// most worth opening first. The bottom is the other way round: green the model did not find.
import type { PressureGrade } from "../../../src/lib/weedVision/pressure/grade";

export type DisagreementRow = { frame: string; cell: string; lat: number; lng: number; pixelM2: number; objM2: number; groundM2: number; nearCrop: boolean; tier: string; klass: string };

export function disagreementRows(frame: string, grade: PressureGrade): DisagreementRow[] {
  const bar = grade.params.disagreeShare;
  return grade.cells
    .filter(c => c.assessed && c.disagreement != null && c.disagreement > bar)
    .map(c => ({ frame, cell: c.key, lat: c.centre.lat, lng: c.centre.lng, pixelM2: c.weedM2, objM2: c.objectM2, groundM2: c.groundM2, nearCrop: c.nearCrop, tier: c.tier, klass: c.klass }))
    .sort((a, b) => (b.objM2 - b.pixelM2) - (a.objM2 - a.pixelM2));
}

const HEAD = ["frame", "cell", "lat", "lng", "pixelM2", "objM2", "groundM2", "nearCrop", "tier", "klass"] as const;

/** The rows as CSV, already sorted; several frames' rows are merged and re-sorted the same way. */
export function disagreementCsv(rows: DisagreementRow[]): string {
  const sorted = [...rows].sort((a, b) => (b.objM2 - b.pixelM2) - (a.objM2 - a.pixelM2));
  const f = (v: number, d: number) => v.toFixed(d);
  return [HEAD.join(","), ...sorted.map(r => [r.frame, r.cell, f(r.lat, 8), f(r.lng, 8), f(r.pixelM2, 4), f(r.objM2, 4), f(r.groundM2, 4), r.nearCrop, r.tier, r.klass].join(","))].join("\n") + "\n";
}
