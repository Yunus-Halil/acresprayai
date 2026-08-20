// "Find similar" — score unlabeled cells against the ones the operator has
// already decided, using the interactive classifier that has been sitting in
// this repo waiting for exactly this entry point.
//
// NOT A SECOND ENGINE. matchCells.ts / shrunkenCentroid.ts / cellFeatures.ts
// were built and tested for this feature (commit 86ee4e9) and never wired in.
// This module is glue: it derives the labeled examples from the treatment
// grid's own cell state, runs the existing classifier, and filters the scores
// to candidates. The statistics — nearest shrunken centroid, leave-one-out
// separability, the 30-pixel floor — live where they always did.
//
// LABELS COME FROM DECISIONS, NOT A SEPARATE MARKING MODE. A cell the operator
// painted treated (source "operator") is a positive example; a cell they
// explicitly skipped (untreated, source "operator") is a negative one. The
// default untouched majority is the candidate pool. This means running the
// tool again after accepting or rejecting suggestions AUTOMATICALLY improves
// the next pass — every acceptance is a new positive, every rejection a new
// negative, with no bookkeeping anywhere else.
//
// CANDIDATES ARE SUGGESTIONS. Nothing here writes a rate. A cell crossing the
// threshold gets an amber outline and a place in a review list; it becomes
// treated only when a human confirms it. Chemical goes on ground because
// someone decided, never because a distance ratio cleared a constant.
import type { SampleResult } from "./cellFeatures";
import {
  type MatchPreview, type MatchSession, MIN_MARKS_PER_CLASS, previewMatch,
} from "./matchCells";
import type { CellId, TreatmentGrid } from "./treatmentGrid";

/**
 * Score above which an unlabeled cell becomes a suggestion.
 *
 * A STARTING GUESS, not a tuned constant. 0.5 is the indifference point of the
 * classifier's distance ratio; 0.65 asks for a clear lean toward the positive
 * examples before bothering the operator. Nobody has validated this against a
 * real field — treat it as adjustable, and if operators report the tool is too
 * eager or too timid, this is the number to move.
 */
export const SIMILARITY_THRESHOLD = 0.65;

/** The operator's existing decisions, read straight off the grid. */
export function labelsFromGrid(grid: TreatmentGrid): {
  wanted: CellId[]; unwanted: CellId[];
} {
  const wanted: CellId[] = [];
  const unwanted: CellId[] = [];
  for (const c of grid.cells) {
    if (c.rate.source !== "operator") continue;   // defaults are the pool, not labels
    if (c.rate.state === "treated") wanted.push(c.id);
    else unwanted.push(c.id);
  }
  return { wanted, unwanted };
}

export type FindSimilarResult = {
  ready: boolean;
  /** Why not, when not ready — worded for the button's tooltip. */
  message: string;
  /** Unlabeled, usable cells at or above the threshold, best first. */
  candidates: { cellId: CellId; score: number }[];
  /** Every scored cell, for detection provenance and for explainCell. */
  preview: MatchPreview | null;
  /** Cells the imagery could not characterise — excluded, not scored low. */
  unscored: CellId[];
  wantedCount: number;
  unwantedCount: number;
};

const notReady = (
  message: string, wantedCount: number, unwantedCount: number,
): FindSimilarResult => ({
  ready: false, message, candidates: [], preview: null, unscored: [],
  wantedCount, unwantedCount,
});

/**
 * Score every default-state cell against the operator's own examples.
 *
 * Pure: same grid, same sampling, same answer. The imagery enters only through
 * `sampling`, which is produced elsewhere (orthoRaster + extractCellFeatures),
 * so tests can drive this with synthetic features and no canvas.
 */
export function findSimilarCells(
  grid: TreatmentGrid,
  sampling: SampleResult,
  threshold = SIMILARITY_THRESHOLD,
): FindSimilarResult {
  const { wanted, unwanted } = labelsFromGrid(grid);

  // The classifier needs MIN_MARKS_PER_CLASS per side before its separability
  // check means anything — with fewer, the marks always separate perfectly and
  // the score is confidence-shaped noise. The brief asked for one of each;
  // the statistics the existing module documents ask for three, and a tool
  // that fires on one example would suggest half the field off a single click.
  if (wanted.length < MIN_MARKS_PER_CLASS || unwanted.length < MIN_MARKS_PER_CLASS) {
    const needW = Math.max(0, MIN_MARKS_PER_CLASS - wanted.length);
    const needU = Math.max(0, MIN_MARKS_PER_CLASS - unwanted.length);
    const parts: string[] = [];
    if (needW) parts.push(`${needW} more cell${needW > 1 ? "s" : ""} marked treated`);
    if (needU) parts.push(`${needU} more explicitly skipped (Assign › Skip)`);
    return notReady(
      `Needs examples of both kinds first: ${parts.join(" and ")}.`,
      wanted.length, unwanted.length,
    );
  }

  const session: MatchSession = {
    marks: Object.fromEntries([
      ...wanted.map(id => [id, "wanted" as const]),
      ...unwanted.map(id => [id, "unwanted" as const]),
    ]),
    history: [],
  };

  const preview = previewMatch(session, sampling);
  if (!preview) {
    return notReady(
      "The imagery could not characterise enough of the labeled cells to compare against.",
      wanted.length, unwanted.length,
    );
  }

  const labeled = new Set<CellId>([...wanted, ...unwanted]);
  const candidates: { cellId: CellId; score: number }[] = [];
  for (const c of grid.cells) {
    if (labeled.has(c.id)) continue;
    if (c.rate.source !== "default" || c.rate.state !== "untreated") continue;
    const score = preview.scores.get(c.id);
    if (score === undefined) continue;          // unusable imagery: excluded, not "dissimilar"
    if (score >= threshold) candidates.push({ cellId: c.id, score });
  }
  candidates.sort((a, b) => b.score - a.score);

  return {
    ready: true,
    message: "",
    candidates,
    preview,
    unscored: preview.unscored,
    wantedCount: wanted.length,
    unwantedCount: unwanted.length,
  };
}

/** Additional area and volume if every remaining candidate were accepted. */
export function candidateTotals(
  grid: TreatmentGrid,
  candidateIds: ReadonlySet<CellId>,
  rateLha: number,
): { areaM2: number; volumeL: number; count: number } {
  let areaM2 = 0, count = 0;
  for (const c of grid.cells) {
    if (!candidateIds.has(c.id)) continue;
    areaM2 += c.areaM2;
    count++;
  }
  // Same arithmetic as gridTotals: true clipped area × rate. Kept in one
  // expression here rather than round-tripping a hypothetical grid through
  // gridTotals, but the units and the area source are identical.
  return { areaM2, volumeL: (areaM2 / 10_000) * rateLha, count };
}
