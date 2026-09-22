// A spot's id is what it is and where it is, so a re-run finds it again.
//
// Candidate ids used to come from blob-labelling order, which changed with
// every run and made "already saved" and "already on Field View" impossible
// to answer after a reopen. Now the id is a hash of the candidate family and
// its centroid rounded to about a metre: the same ground flagged again under
// the same settings gets the same id, the archive row for it is found under
// `candidate_id`, and the annotation it became is found under `spot_id`.
//
// It is a stability property, not an identity proof. Change the tile size or
// a threshold enough and a region's centroid moves, and it becomes a new spot
// beside an archived one, which is the honest outcome: the archive describes
// what was flagged then, not what is flagged now.
import { cyrb53 } from "../weedCatalog/import";
import type { Candidate, CandidateKind } from "./types";
import type { LatLng2 } from "../geo";

/** Plants and ground are keyed apart: a plant on a bare patch is two spots. */
export function spotFamily(kind: CandidateKind): "region" | "tile" | "plant" {
  if (kind === "not-average region") return "region";
  if (kind === "field outlier") return "tile";
  return "plant";
}

/** About a metre: 1e-5 deg of latitude is 1.1 m. */
const roundCoord = (v: number) => v.toFixed(5);

export function spotIdFor(kind: CandidateKind, centroid: LatLng2): string {
  return `spot-${spotFamily(kind)}-${cyrb53(`${roundCoord(centroid.lat)}|${roundCoord(centroid.lng)}`)}`;
}

/**
 * Give every candidate its stable id, in place. Two candidates of one family
 * within the rounding of each other (two seedlings a hand apart) get a
 * numeric suffix in score order, so ids stay unique within a run.
 */
export function assignSpotIds(candidates: Candidate[]): Candidate[] {
  const seen = new Map<string, number>();
  for (const c of candidates) {
    const base = spotIdFor(c.kind, c.centroid);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    c.id = n === 0 ? base : `${base}-${n + 1}`;
  }
  return candidates;
}
