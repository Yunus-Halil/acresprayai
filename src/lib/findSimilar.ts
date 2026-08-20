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
import { MIN_MARKS_PER_CLASS } from "./matchCells";
import { standardiser } from "./shrunkenCentroid";
import type { CellDetection, CellId, TreatmentGrid } from "./treatmentGrid";

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

/**
 * Neighbours consulted per candidate. A STARTING GUESS, tunable. Small on
 * purpose: labeled sets here are typically 6-15 cells, and k must stay below
 * the size of either class or the vote drowns in the majority class.
 */
export const K_NEIGHBOURS = 3;

/**
 * Robust z-score at which a cell counts as a field outlier. A STARTING GUESS,
 * tunable exactly like SIMILARITY_THRESHOLD. 3.5 scaled-MAD units is a common
 * conservative default for univariate outliers; if operators report obvious
 * patches being missed, lower it before reaching for more machinery.
 */
export const OUTLIER_Z_THRESHOLD = 3.5;

/** Detection provenance for kNN-scored runs (v1 was the centroid scorer). */
export const KNN_MODEL_VERSION = "interactive-knn-v2";

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

export type Separability = {
  verdict: "clear" | "weak" | "indistinguishable";
  /** Leave-one-out accuracy of the kNN vote over the labeled cells. */
  looAccuracy: number;
};

export type FindSimilarResult = {
  ready: boolean;
  /** Why not, when not ready - worded for the button's tooltip. */
  message: string;
  /** Unlabeled, usable cells at or above the threshold, best first. */
  candidates: { cellId: CellId; score: number }[];
  /** Every scored unlabeled cell - written to detection as provenance. */
  scores: Map<CellId, number>;
  /** How distinguishable the operator's own examples are, by the same vote. */
  separability: Separability | null;
  /** Cells the imagery could not characterise - excluded, not scored low. */
  unscored: CellId[];
  wantedCount: number;
  unwantedCount: number;
};

const notReady = (
  message: string, wantedCount: number, unwantedCount: number,
): FindSimilarResult => ({
  ready: false, message, candidates: [], scores: new Map(), separability: null,
  unscored: [], wantedCount, unwantedCount,
});

type Example = { row: number[]; positive: boolean };

/**
 * Distance-weighted kNN vote: the fraction of nearby-example weight that is
 * positive, 0..1.
 *
 * WHY NEIGHBOURS AND NOT CENTROIDS. The first version of this scored against
 * one shrunken centroid per class - statistically careful, but a centroid is
 * ONE point, and averaging a red discoloured patch with a white bare patch
 * yields a pink nothing that resembles neither. The field case that exposed
 * it: obvious white bare patches scored ambiguous because the only positives
 * painted were red-band cells, and the white ground was far from BOTH class
 * centres. Per-example distances let each visually distinct positive pull in
 * its own neighbourhood. Still not a trained model - just a better comparison.
 */
function knnScore(row: number[], examples: Example[], k: number): number {
  const ds = examples
    .map(e => {
      let d2 = 0;
      for (let i = 0; i < row.length; i++) {
        const d = row[i] - e.row[i];
        d2 += d * d;
      }
      return { d2, positive: e.positive };
    })
    .sort((a, b) => a.d2 - b.d2)
    .slice(0, Math.min(k, examples.length));
  let pos = 0, all = 0;
  for (const { d2, positive } of ds) {
    const w = 1 / (d2 + 1e-6);
    all += w;
    if (positive) pos += w;
  }
  return all > 0 ? pos / all : 0;
}

/**
 * Leave-one-out accuracy of the kNN vote over the labeled examples - the same
 * honesty check the centroid version carried, computed for the procedure
 * actually in use. Same verdict cutoffs as shrunkenCentroid's.
 */
function knnSeparability(examples: Example[], k: number): Separability {
  let correct = 0;
  for (let i = 0; i < examples.length; i++) {
    const rest = examples.filter((_, j) => j !== i);
    const score = knnScore(examples[i].row, rest, k);
    if ((score >= 0.5) === examples[i].positive) correct++;
  }
  const looAccuracy = examples.length ? correct / examples.length : 0;
  return {
    looAccuracy,
    verdict: looAccuracy >= 0.9 ? "clear" : looAccuracy >= 0.7 ? "weak" : "indistinguishable",
  };
}

/**
 * Score every default-state cell against the operator's own examples.
 *
 * Pure: same grid, same sampling, same answer. Standardisation is against the
 * WHOLE field (as before), so a cell's score does not shift merely because a
 * mark landed somewhere else.
 */
export function findSimilarCells(
  grid: TreatmentGrid,
  sampling: SampleResult,
  threshold = SIMILARITY_THRESHOLD,
  k = K_NEIGHBOURS,
): FindSimilarResult {
  const { wanted, unwanted } = labelsFromGrid(grid);

  // Three per class before the vote means anything - with fewer, the labeled
  // set always separates and the score is confidence-shaped noise. Same floor
  // the centroid version used, for the same reason.
  if (wanted.length < MIN_MARKS_PER_CLASS || unwanted.length < MIN_MARKS_PER_CLASS) {
    const needW = Math.max(0, MIN_MARKS_PER_CLASS - wanted.length);
    const needU = Math.max(0, MIN_MARKS_PER_CLASS - unwanted.length);
    const parts: string[] = [];
    if (needW) parts.push(`${needW} more cell${needW > 1 ? "s" : ""} marked treated`);
    if (needU) parts.push(`${needU} more explicitly skipped (Assign > Skip)`);
    return notReady(
      `Needs examples of both kinds first: ${parts.join(" and ")}.`,
      wanted.length, unwanted.length,
    );
  }

  const usable = sampling.samples.filter(s => s.usable);
  if (usable.length < 2) {
    return notReady(
      "The imagery could not characterise enough cells to compare against.",
      wanted.length, unwanted.length,
    );
  }
  const std = standardiser(usable.map(s => s.features));
  const rowById = new Map(usable.map(s => [s.cellId, std.apply(s.features)]));

  const examples: Example[] = [];
  for (const id of wanted) {
    const row = rowById.get(id);
    if (row) examples.push({ row, positive: true });
  }
  for (const id of unwanted) {
    const row = rowById.get(id);
    if (row) examples.push({ row, positive: false });
  }
  if (!examples.some(e => e.positive) || !examples.some(e => !e.positive)) {
    return notReady(
      "The imagery could not characterise enough of the labeled cells to compare against.",
      wanted.length, unwanted.length,
    );
  }

  const labeled = new Set<CellId>([...wanted, ...unwanted]);
  const scores = new Map<CellId, number>();
  const candidates: { cellId: CellId; score: number }[] = [];
  for (const c of grid.cells) {
    if (labeled.has(c.id)) continue;
    if (c.rate.source !== "default" || c.rate.state !== "untreated") continue;
    const row = rowById.get(c.id);
    if (!row) continue;                       // unusable imagery: excluded, not "dissimilar"
    const score = knnScore(row, examples, k);
    scores.set(c.id, score);
    if (score >= threshold) candidates.push({ cellId: c.id, score });
  }
  candidates.sort((a, b) => b.score - a.score);

  return {
    ready: true,
    message: "",
    candidates,
    scores,
    separability: knnSeparability(examples, k),
    unscored: sampling.samples.filter(s => !s.usable).map(s => s.cellId),
    wantedCount: wanted.length,
    unwantedCount: unwanted.length,
  };
}

/**
 * Write scores onto the grid's detection field - provenance, never rates.
 * The kNN sibling of matchCells.applyMatch, carrying its own model version.
 */
export function applyScores(
  grid: TreatmentGrid,
  scores: Map<CellId, number>,
  scoredAt: string,
  modelVersion = KNN_MODEL_VERSION,
): TreatmentGrid {
  return {
    ...grid,
    cells: grid.cells.map(cell => {
      const score = scores.get(cell.id);
      if (score === undefined) return cell;
      const detection: CellDetection = { score, modelVersion, scoredAt };
      return { ...cell, detection };
    }),
  };
}

// ---------------------------------------------------------------------------
// Outlier scan - the unsupervised sibling
// ---------------------------------------------------------------------------

export type OutlierCandidate = {
  cellId: CellId;
  /** Robust z of the most deviant feature, in scaled-MAD units. */
  z: number;
  /** Which measurement drove it - the honest "why was this flagged". */
  feature: string;
};

export type OutlierScanResult = {
  candidates: OutlierCandidate[];
  /** Cells the baseline was computed over. */
  baselineCells: number;
  unscored: CellId[];
};

/**
 * Flag cells that are strong outliers from the field's own baseline - no
 * examples needed.
 *
 * Similarity search can only find things that look like something already
 * pointed at; it cannot discover an anomaly type nobody has marked. This scan
 * answers the other question: "what does not look like this field?" Median and
 * MAD per feature rather than mean and SD, because the anomalies being hunted
 * are exactly the values that would corrupt a mean.
 *
 * The score is per-feature max |z|, not a combined distance: "brightness is
 * 4.2 typical-deviations above the field median" is a reason an operator can
 * check against the imagery, where a Mahalanobis blend is a number they must
 * take on faith.
 */
export function scanOutliers(
  grid: TreatmentGrid,
  sampling: SampleResult,
  zThreshold = OUTLIER_Z_THRESHOLD,
): OutlierScanResult {
  const usable = sampling.samples.filter(s => s.usable);
  const unscored = sampling.samples.filter(s => !s.usable).map(s => s.cellId);
  if (usable.length < 8) {
    // Too few cells for a baseline to mean anything; better no answer than a
    // baseline made of noise.
    return { candidates: [], baselineCells: usable.length, unscored };
  }

  const nF = sampling.names.length;
  const medians: number[] = [], mads: number[] = [];
  for (let f = 0; f < nF; f++) {
    const vals = usable.map(s => s.features[f]).sort((a, b) => a - b);
    const med = vals[Math.floor(vals.length / 2)];
    const dev = vals.map(v => Math.abs(v - med)).sort((a, b) => a - b);
    medians.push(med);
    mads.push(dev[Math.floor(dev.length / 2)] * 1.4826);   // ~ sd for normal data
  }

  const decided = new Set(
    grid.cells.filter(c => c.rate.source !== "default" || c.rate.state !== "untreated").map(c => c.id),
  );
  const rowById = new Map(usable.map(s => [s.cellId, s.features]));
  const candidates: OutlierCandidate[] = [];
  for (const c of grid.cells) {
    if (decided.has(c.id)) continue;
    const row = rowById.get(c.id);
    if (!row) continue;
    let bestZ = 0, bestF = "";
    for (let f = 0; f < nF; f++) {
      // A feature the whole field agrees on (MAD 0) cannot rank outliers -
      // skipped rather than dividing toward infinity.
      if (mads[f] < 1e-9) continue;
      const z = Math.abs(row[f] - medians[f]) / mads[f];
      if (z > bestZ) { bestZ = z; bestF = sampling.names[f]; }
    }
    if (bestZ >= zThreshold) candidates.push({ cellId: c.id, z: bestZ, feature: bestF });
  }
  candidates.sort((a, b) => b.z - a.z);
  return { candidates, baselineCells: usable.length, unscored };
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
