// A small visual model fitted afresh on every field, from labels the field's own rows supply (2026-11-12).
//
// Position says what a candidate is likely to be: on a verified row, at the seed spacing, it is very likely the crop;
// on the strips midway between rows it is not. That labels hundreds of candidates on every field for nothing. A model
// fitted on those labels, from what the candidates LOOK like and never from where they are, can then add evidence
// where position alone is weak. Published row-labelled classifiers came within a few points of hand-labelled ones at
// 0.2 to 0.6 cm a pixel; none was tested at 0.6 to 1 cm, where a seedling is a few pixels wide, so here the look is
// weak evidence by design: its say on a plant is capped (LOOK.maxShift).
//
// The model: logistic regression on a handful of features measured against the soil around each candidate (score,
// size in cm², long axis in cm, elongation, brightness against its soil), standardised on this field. Training:
// out-of-fold probabilities over spatial blocks (a plant and its neighbours never sit in both training and test), the
// examples the model confidently disagrees with dropped as label noise, then one refit. No iteration on its own
// output: that is how self-training confirms its mistakes.
//
// Nothing here knows a candidate's position. Two checks keep that honest: the cross-validated AUC is reported, and
// the evaluation compares position alone, look alone and both (scripts/rowCrop/rowGuidedBench.ts).
import type { Candidate } from "./rowGuided";

export const LOOK = {
  folds: 5,
  /** Spatial blocks for the folds: this long along the rows, metres. */
  blockM: 10,
  /** An example is dropped as label noise when its out-of-fold probability of its own label is under this. */
  noiseBelow: 0.15,
  /** Ridge penalty and steps of the fit. */
  l2: 1e-3, steps: 400, rate: 0.5,
  /** The most a plant's look may move its evidence, in log-odds either way. */
  maxShift: 1.5,
  /** Fewer examples than this of either label: no model on this field. */
  minPerClass: 60,
};

export type LookFeatures = (c: Candidate) => number[];
export const FEATURE_NAMES = ["z", "zMean", "log area cm2", "log length cm", "log elongation", "brightness vs soil"];
export const features: LookFeatures = c => [c.z, c.zMean, Math.log(Math.max(0.1, c.areaCm2)), Math.log(Math.max(0.1, c.lengthCm)), Math.log(Math.max(1, c.elong)), c.dLum];

export type LookModel = { w: number[]; b: number; mean: number[]; sd: number[]; names: string[] };
export type LookReport = { positives: number; negatives: number; droppedAsNoise: number; aucOutOfFold: number | null; model: LookModel | null; why: string | null };

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function fit(X: number[][], y: number[], o = LOOK): { w: number[]; b: number } {
  const d = X[0].length, w = new Array(d).fill(0); let b = 0;
  // Balanced classes: each label weighs the same in total.
  const npos = y.filter(v => v === 1).length, nneg = y.length - npos, wp = y.length / (2 * Math.max(1, npos)), wn = y.length / (2 * Math.max(1, nneg));
  for (let it = 0; it < o.steps; it++) {
    const gw = new Array(d).fill(0); let gb = 0;
    for (let i = 0; i < X.length; i++) { let z = b; for (let k = 0; k < d; k++) z += w[k] * X[i][k]; const e = (sigmoid(z) - y[i]) * (y[i] ? wp : wn); for (let k = 0; k < d; k++) gw[k] += e * X[i][k]; gb += e; }
    for (let k = 0; k < d; k++) w[k] -= o.rate * (gw[k] / X.length + o.l2 * w[k]);
    b -= (o.rate * gb) / X.length;
  }
  return { w, b };
}

/** Area under the ROC curve: the chance a random positive scores above a random negative. */
export function auc(scores: number[], y: number[]): number | null {
  const idx = scores.map((s, i) => [s, y[i]] as [number, number]).sort((a, b) => a[0] - b[0]);
  let rank = 0, sumPos = 0, npos = 0;
  for (let i = 0; i < idx.length;) { let j = i; while (j < idx.length && idx[j][0] === idx[i][0]) j++; const r = (i + j + 1) / 2; for (let k = i; k < j; k++) if (idx[k][1]) { sumPos += r; npos++; } rank = j; i = j; }
  const nneg = idx.length - npos;
  return npos && nneg ? (sumPos - (npos * (npos + 1)) / 2) / (npos * nneg) : (void rank, null);
}

/**
 * The model for one field. `examples`: candidates with a position label (1 crop, 0 not) and the key of the spatial
 * block they stand in (row and along, so neighbours fall in the same fold).
 */
export function fitLook(examples: { c: Candidate; y: 0 | 1; block: string }[], o = LOOK): LookReport {
  const pos = examples.filter(e => e.y === 1).length, neg = examples.length - pos;
  if (pos < o.minPerClass || neg < o.minPerClass) return { positives: pos, negatives: neg, droppedAsNoise: 0, aucOutOfFold: null, model: null, why: `too few examples to fit a model (${pos} on the rows, ${neg} between them; ${o.minPerClass} of each needed)` };
  const raw = examples.map(e => features(e.c)), d = raw[0].length;
  const mean = Array.from({ length: d }, (_, k) => raw.reduce((s, x) => s + x[k], 0) / raw.length);
  const sd = Array.from({ length: d }, (_, k) => Math.sqrt(raw.reduce((s, x) => s + (x[k] - mean[k]) ** 2, 0) / raw.length) || 1);
  const X = raw.map(x => x.map((v, k) => (v - mean[k]) / sd[k])), y = examples.map(e => e.y);
  // Folds by block, so a plant and its neighbours are never on both sides.
  const blocks = [...new Set(examples.map(e => e.block))].sort(), foldOf = new Map(blocks.map((b, i) => [b, i % o.folds]));
  const oof = new Array(X.length).fill(0.5);
  for (let f = 0; f < o.folds; f++) {
    const tr = X.map((_, i) => i).filter(i => foldOf.get(examples[i].block) !== f), te = X.map((_, i) => i).filter(i => foldOf.get(examples[i].block) === f);
    if (!tr.length || !te.length) continue;
    const m = fit(tr.map(i => X[i]), tr.map(i => y[i]), o);
    for (const i of te) { let z = m.b; for (let k = 0; k < d; k++) z += m.w[k] * X[i][k]; oof[i] = sigmoid(z); }
  }
  const aucOutOfFold = auc(oof, y);
  // Label noise: examples whose own label the out-of-fold model gives little chance.
  const keep = X.map((_, i) => i).filter(i => (y[i] ? oof[i] : 1 - oof[i]) >= o.noiseBelow);
  const m = fit(keep.map(i => X[i]), keep.map(i => y[i]), o);
  return { positives: pos, negatives: neg, droppedAsNoise: X.length - keep.length, aucOutOfFold: aucOutOfFold != null ? Math.round(aucOutOfFold * 1000) / 1000 : null, model: { ...m, mean, sd, names: FEATURE_NAMES }, why: null };
}

/** A candidate's look, in log-odds of "crop" (0 without a model). */
export function lookLogit(model: LookModel | null, c: Candidate): number {
  if (!model) return 0;
  const x = features(c); let z = model.b;
  for (let k = 0; k < x.length; k++) z += model.w[k] * ((x[k] - model.mean[k]) / model.sd[k]);
  return z;
}

/** What a plant's look adds to its evidence: the mean of its views' log-odds (views of one plant are not independent), capped. */
export function lookShift(model: LookModel | null, views: Candidate[], o = LOOK): number {
  if (!model || !views.length) return 0;
  const m = views.reduce((s, c) => s + lookLogit(model, c), 0) / views.length;
  return Math.max(-o.maxShift, Math.min(o.maxShift, m));
}
