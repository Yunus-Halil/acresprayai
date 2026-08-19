// "Mark & match" — the operator marks a few cells they want and a few they do
// not, and every other cell is scored for similarity.
//
// WHY THIS INSTEAD OF A PRETRAINED DETECTOR. We have no labelled training data
// for weed or disease detection and will not for a while. This needs none: the
// operator supplies the labels live, for their own field, for whatever they are
// looking at today — dry patches, weed pressure, standing water. When we do
// have enough field data to train a detector, both can coexist, which is why
// the score records WHICH method produced it.
//
// WHAT IT DOES NOT DO. It scores. It never assigns rates. Turning scores into
// rate classes stays a separate, reversible thresholding step, so re-tuning
// thresholds does not re-run the classifier and an operator override is never
// silently overwritten.
import {
  type CellId, type CellDetection, type TreatmentGrid,
} from "./treatmentGrid";
import {
  type Classifier, type Label,
  fitShrunkenCentroid, scoreRow, standardiser,
} from "./shrunkenCentroid";
import type { SampleResult } from "./cellFeatures";

/** Distinguishes these scores from any future pretrained model's. */
export const MATCH_MODEL_VERSION = "interactive-v1";

/**
 * Minimum marks per class before the classifier runs.
 *
 * Two is enough to define a centroid but not enough for leave-one-out to say
 * anything, and a match fitted on one example either side is indistinguishable
 * from a coin flip wearing a confident colour ramp.
 */
export const MIN_MARKS_PER_CLASS = 3;

export type MarkLabel = "wanted" | "unwanted";

export type MatchSession = {
  marks: Record<CellId, MarkLabel>;
  /** Snapshots for undo, oldest first. Bounded — this is a UI affordance. */
  history: Record<CellId, MarkLabel>[];
};

export const emptySession = (): MatchSession => ({ marks: {}, history: [] });

const MAX_HISTORY = 100;

function commit(session: MatchSession, next: Record<CellId, MarkLabel>): MatchSession {
  const history = [...session.history, session.marks];
  return { marks: next, history: history.slice(-MAX_HISTORY) };
}

/** Mark a cell. Marking with the same label again clears it, so clicks toggle. */
export function markCell(session: MatchSession, cellId: CellId, label: MarkLabel): MatchSession {
  const next = { ...session.marks };
  if (next[cellId] === label) delete next[cellId];
  else next[cellId] = label;
  return commit(session, next);
}

export function unmarkCell(session: MatchSession, cellId: CellId): MatchSession {
  if (!(cellId in session.marks)) return session;
  const next = { ...session.marks };
  delete next[cellId];
  return commit(session, next);
}

/** Step back one mark. Undoing to zero marks is allowed and expected. */
export function undo(session: MatchSession): MatchSession {
  if (!session.history.length) return session;
  const history = session.history.slice(0, -1);
  return { marks: session.history[session.history.length - 1], history };
}

/** Clear every mark without leaving the mode. Undoable like any other step. */
export function clearMarks(session: MatchSession): MatchSession {
  if (!Object.keys(session.marks).length) return session;
  return commit(session, {});
}

export const markCounts = (session: MatchSession) => {
  let wanted = 0, unwanted = 0;
  for (const label of Object.values(session.marks)) {
    if (label === "wanted") wanted++; else unwanted++;
  }
  return { wanted, unwanted };
};

export type Readiness = { ready: boolean; message: string };

export function readiness(session: MatchSession): Readiness {
  const { wanted, unwanted } = markCounts(session);
  const needW = Math.max(0, MIN_MARKS_PER_CLASS - wanted);
  const needU = Math.max(0, MIN_MARKS_PER_CLASS - unwanted);
  if (!needW && !needU) {
    return { ready: true, message: `${wanted} wanted · ${unwanted} not wanted` };
  }
  const parts: string[] = [];
  if (needW) parts.push(`${needW} more to treat`);
  if (needU) parts.push(`${needU} more to leave`);
  return { ready: false, message: `Mark ${parts.join(" and ")}.` };
}

export type MatchPreview = {
  /** Score per cell, 0..1. Absent for cells that could not be sampled. */
  scores: Map<CellId, number>;
  classifier: Classifier;
  /** Cells left unscored because the imagery could not characterise them. */
  unscored: CellId[];
};

/**
 * Score every cell against the current marks.
 *
 * Recomputed on each mark so the preview is live — there is no separate
 * "calculate" step to press before seeing what the marks imply.
 */
export function previewMatch(
  session: MatchSession,
  sampling: SampleResult,
): MatchPreview | null {
  if (!readiness(session).ready) return null;

  const usable = sampling.samples.filter(s => s.usable);
  if (usable.length < 2) return null;

  // Standardise against the whole field, so a cell's score does not shift
  // merely because the operator marked another cell somewhere else.
  const std = standardiser(usable.map(s => s.features));
  const byId = new Map(usable.map(s => [s.cellId, std.apply(s.features)]));

  const X: number[][] = [], y: Label[] = [];
  for (const [cellId, label] of Object.entries(session.marks)) {
    const row = byId.get(cellId);
    // A marked cell that could not be sampled is skipped rather than faked.
    if (!row) continue;
    X.push(row);
    y.push(label === "wanted" ? 1 : 0);
  }
  if (!y.includes(0) || !y.includes(1)) return null;

  const classifier = fitShrunkenCentroid(X, y, sampling.names);
  const scores = new Map<CellId, number>();
  for (const [cellId, row] of byId) scores.set(cellId, scoreRow(classifier, row));

  return {
    scores,
    classifier,
    unscored: sampling.samples.filter(s => !s.usable).map(s => s.cellId),
  };
}

/**
 * Write the preview's scores onto the grid's existing detection field.
 *
 * Deliberately touches `detection` ONLY. Rates are not assigned here — that
 * stays a separate thresholding step — so confirming a match can never
 * overwrite an operator's hand-set rate.
 */
export function applyMatch(
  grid: TreatmentGrid,
  preview: MatchPreview,
  scoredAt: string,
): TreatmentGrid {
  return {
    ...grid,
    cells: grid.cells.map(cell => {
      const score = preview.scores.get(cell.id);
      if (score === undefined) return cell;
      const detection: CellDetection = {
        score,
        modelVersion: MATCH_MODEL_VERSION,
        scoredAt,
      };
      return { ...cell, detection };
    }),
  };
}

/**
 * Why a cell scored as it did — the measurements that drove the match, ordered
 * by influence.
 *
 * Agronomists will not trust a black box over their own fields, and detection
 * is never perfect. Being able to say "this was flagged mostly on greenness and
 * brightness" is what makes a wrong answer arguable rather than authoritative.
 */
export function explainCell(
  preview: MatchPreview,
  sampling: SampleResult,
  cellId: CellId,
  limit = 3,
): { score: number; drivers: { name: string; value: number }[] } | null {
  const score = preview.scores.get(cellId);
  const sample = sampling.samples.find(s => s.cellId === cellId);
  if (score === undefined || !sample?.usable) return null;

  const drivers = preview.classifier.featureNames
    .map((name, i) => ({ name, weight: preview.classifier.weights[i], value: sample.features[i] }))
    .filter(d => d.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map(({ name, value }) => ({ name, value }));

  return { score, drivers };
}
