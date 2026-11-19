// L8 Report: what a build keeps and shows (2026-11-18).
//
//   in:   L3's dots, L6/L7's reading, the field (cornField.ts: its rows, weed candidates, stand gaps), the guard over
//         the flight (cornField.ts cornFlightGuard), the photographs' reads (for the unsure list) and the options
//   out:  the plants (cornPlants.ts cornPlantsOf: every dot of the stricter marks and every candidate on a row, by
//         what was made of it; the row stretches confirmed and not confirmed), the field's weed candidates and stand
//         gaps, the photographs whose count the guard withheld, with why, and (LAYERS.unsureList, off by default) the
//         unsure list
//
// The unsure list (recorded only: nothing is removed or added by it): the plants on a row the views disagree on. Each
// photograph's mark of a plant says which of L1's views found it (L2: the green, a vivid core, or both). A plant is
// unsure where a photograph's mark of it was added by a core alone: that photograph's green saw one plant there, its
// cores more. "cores only": every photograph's mark of it was; "photographs disagree": some photographs' green found it
// and others' only a core did. Each is listed with its photographs and what found it in each.
import type { CornFieldResult, CornPhotoRead, cornFlightGuard } from "../cornField";
import { type CornPlantsOptions, type PlacedDots, cornPlantsOf } from "../cornPlants";
import type { Reconstruction } from "../plantsFirst";
import { LAYERS } from "./options";

export type UnsureDot = { dot: number; e: number; n: number; kind: "cores only" | "photographs disagree"; photographs: { name: string; foundBy: number }[] };

/** The plants on a row the views disagree on (see the header); `recorded` false where the reads do not say what found each mark. */
export function unsureList(P: Pick<PlacedDots, "all" | "strict" | "photos" | "sights">, rec: Reconstruction, reads: CornPhotoRead[]): { dots: UnsureDot[]; plantsLooked: number; recorded: boolean } {
  const readOf = new Map(reads.map(r => [r.name, r])), out: UnsureDot[] = [];
  const by = P.photos.map(name => { const r = readOf.get(name), f = r?.look?.foundBy; return f && f.length === r!.plants.length ? f : null; });
  if (!P.sights || !by.some(Boolean)) return { dots: [], plantsLooked: 0, recorded: false };
  let looked = 0;
  for (let i = 0; i < P.strict; i++) {
    if (rec.rowOf[i] < 0) continue;
    const ph: { name: string; foundBy: number }[] = [];
    for (const m of P.all[i].members) { const s = P.sights[m], f = by[s.p]; if (f && s.k != null) ph.push({ name: P.photos[s.p], foundBy: f[s.k] }); }
    if (!ph.length) continue;
    looked++;
    const coreOnly = ph.filter(x => x.foundBy === 2).length;
    if (!coreOnly) continue;
    out.push({ dot: i, e: P.all[i].e, n: P.all[i].n, kind: coreOnly === ph.length ? "cores only" : "photographs disagree", photographs: ph });
  }
  return { dots: out, plantsLooked: looked, recorded: true };
}

export function fieldReport(P: PlacedDots, rec: Reconstruction, F: CornFieldResult, guard: ReturnType<typeof cornFlightGuard> | null, opts: CornPlantsOptions = {}, reads: CornPhotoRead[] = []) {
  const unsure = (opts.layers?.unsureList ?? LAYERS.unsureList) ? unsureList(P, rec, reads) : null;
  return {
    plants: cornPlantsOf(P, rec, F, opts),
    weeds: F.weeds, gaps: F.gaps, summary: F.summary,
    guard: guard ? { medianSpacingM: guard.medianSpacingM, withheld: guard.withheld } : null,
    unsure,
  };
}
