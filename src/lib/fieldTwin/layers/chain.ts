// The layers L4 to L7 chained (2026-11-18, moved out of plantsFirst.ts so that it imports no layer: no import cycle).
//
//   in:   L3's dots, how many photographs looked at each, the rows' direction and spacing guessed from the field, the
//         placing and sequence options, the dots never to be certain, the candidates' tiers, L3's first reading of the
//         rows (`pre`), and the field's judgement of the ground
//   out:  plantsFirst.ts Reconstruction (L6's reading, through L7)
import { type Dot, type GroundJudge, PLANTS_FIRST, type PlantsFirstOptions, type Reconstruction, type RowsFromDots, SEQUENCE } from "../plantsFirst";
import { obviousPlants } from "./l4Obvious";
import { rowProfile } from "./l5Profile";
import { judgeDots } from "./l6Judge";
import { secondLook } from "./l7SecondLook";
import { LAYERS, type LayerOptions } from "./options";

/** `notCertain`: dots that may be probable at most (the second look's plants: they confirm a stretch, never start a row).
 * `tier` (rowCandidates): per dot 0 a dot of the stricter marks, 1 / 2 a candidate for the rows; every dot of a lower tier
 * is placed on the rows before any of a higher one; a candidate joins a row the plants found first made, never makes one.
 * `pre`: rowsFromDots over the certain dots, when the caller already made it (the same dots in the same order).
 * `ground`: the field's planted / scattered judgement (used with `q.refuseScattered`). */
export function reconstruct(dots: Dot[], covered: Int32Array, directionDeg: number, spacingGuessM: number, o: PlantsFirstOptions = PLANTS_FIRST, q = SEQUENCE, notCertain: Uint8Array | null = null, tier: Uint8Array | null = null, pre: RowsFromDots | null = null, ground: GroundJudge | null = null, layers: LayerOptions = LAYERS): Reconstruction {
  // The layers (fieldTwin/layers, 2026-11-18): L4 the certain plants, L5 the field's profile from them, L6 every
  // other dot judged against it, L7 a second look where they disagree (not built: it passes the reading through).
  const L4 = obviousPlants(dots, covered, q, notCertain);
  const L5 = rowProfile(dots, L4, directionDeg, spacingGuessM, o, q, pre, ground, layers);
  const rec = secondLook(judgeDots(dots, L4, L5, o, q, tier));
  // Read only: what L5 learned beyond what the reading carries (the spread; the ground from L4 with phase 2a on).
  rec.profile = { spread: L5.spread, groundL4: L5.groundL4 };
  return rec;
}
