// L8 Report: what a build keeps and shows (2026-11-18).
//
//   in:   L3's dots, L6/L7's reading, the field (cornField.ts: its rows, weed candidates, stand gaps), the guard over
//         the flight (cornField.ts cornFlightGuard) and the options
//   out:  the plants (cornPlants.ts cornPlantsOf: every dot of the stricter marks and every candidate on a row, by
//         what was made of it; the row stretches confirmed and not confirmed), the field's weed candidates and stand
//         gaps, and the photographs whose count the guard withheld, with why
//
// The "unsure" list (dots the views disagree on, with the photographs) is not built yet (the brief's phase 4).
import type { CornFieldResult, cornFlightGuard } from "../cornField";
import { type CornPlantsOptions, type PlacedDots, cornPlantsOf } from "../cornPlants";
import type { Reconstruction } from "../plantsFirst";

export function fieldReport(P: PlacedDots, rec: Reconstruction, F: CornFieldResult, guard: ReturnType<typeof cornFlightGuard> | null, opts: CornPlantsOptions = {}) {
  return {
    plants: cornPlantsOf(P, rec, F, opts),
    weeds: F.weeds, gaps: F.gaps, summary: F.summary,
    guard: guard ? { medianSpacingM: guard.medianSpacingM, withheld: guard.withheld } : null,
  };
}
