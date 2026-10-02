// Score the candidates that have a chip, with whatever model this build ships.
//
// Only plant candidates are scored: the model was trained on chips centred
// on one object (a weed, a crop plant, a clod) and knows nothing about a
// region of ground, so a region gets no prediction rather than a meaningless
// one. A candidate with no chip, or a chip that will not decode, gets none
// either. The scout's notes say how many were scored and by which version,
// or that no model was available.
//
// CURRENT LIMITATION: this is a verifier, not a detector. It only sees what
// the geometric candidate generator already flagged (and only the top
// `maxChips` of those). If candidate generation misses a weed, the model never
// evaluates it, so its recall is bounded by the generator's.

import { findingClassOf } from "../candidates";
import type { Candidate } from "../types";
import { getClassifier } from "./onnxClassifier";
import { type ChipPixels, dataUrlToPixels } from "./preprocess";
import { loadCurrentModel } from "./registry";
import { type Inference, type ModelMeta, type Prediction, resolutionUsable } from "./types";

export type ClassifyOutcome = {
  candidates: Candidate[];
  /** Null when no model was available. */
  meta: ModelMeta | null;
  scored: number;
  /** Plain-language line for the run's notes. */
  note: string;
};

/** Which candidates the model may speak about: single plants with a chip. */
export function isScorable(c: Candidate): boolean {
  return !c.region && !!c.blob && !!c.chip && !!c.chipSpanM;
}

export type ClassifyDeps = {
  loadModel?: () => Promise<ModelMeta | null>;
  decode?: (dataUrl: string, spanM: number) => Promise<ChipPixels | null>;
  classifierFor?: typeof getClassifier;
};

export async function classifyCandidates(candidates: Candidate[], deps: ClassifyDeps = {}): Promise<ClassifyOutcome> {
  const loadModel = deps.loadModel ?? loadCurrentModel;
  const decode = deps.decode ?? dataUrlToPixels;
  const classifierFor = deps.classifierFor ?? getClassifier;
  const meta = await loadModel();
  if (!meta) return { candidates, meta: null, scored: 0, note: "No classifier is shipped in this build; spots are ranked by geometry and your past verdicts alone." };
  const classifier = await classifierFor(meta);
  if (!classifier) return { candidates, meta, scored: 0, note: `Classifier ${meta.version} could not be loaded; spots are ranked by geometry and your past verdicts alone.` };

  // Every spot gets a record of whether the model was asked, and why not.
  // The gate comes first: a model is never asked about pixels coarser than
  // it has ever seen, and the answer it would give is not an answer.
  const out = candidates.slice();
  const record = (i: number, status: Inference["status"]) => {
    out[i] = { ...out[i], inference: { modelVersion: meta.version, source: "orthomosaic", effectiveGsdM: out[i].chipGsdM ?? null, requiredGsdM: meta.max_gsd_m ?? null, status } };
  };
  const tooCoarse: number[] = [];
  let notVegetation = 0;
  const indexed: { index: number; pixels: ChipPixels; diameterM: number | null }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (findingClassOf(c) !== "vegetation") { record(i, "not_vegetation"); notVegetation++; continue; }
    if (c.region) { record(i, "not_a_single_plant"); continue; }
    if (!isScorable(c)) { record(i, "no_chip"); continue; }
    if (!resolutionUsable(meta, c.chipGsdM)) { record(i, "unknown_resolution"); tooCoarse.push(i); continue; }
    const pixels = await decode(c.chip!, c.chipSpanM!);
    if (!pixels) { record(i, "no_chip"); continue; }
    indexed.push({ index: i, pixels, diameterM: c.blob?.equivDiameterM ?? null });
  }
  let scored = 0;
  const BATCH = 32;
  for (let start = 0; start < indexed.length; start += BATCH) {
    const slice = indexed.slice(start, start + BATCH);
    let preds: Prediction[];
    try {
      preds = await classifier.classify(slice.map(s => ({ pixels: s.pixels, diameterM: s.diameterM })));
    } catch (e) {
      console.warn("[weed-scout] classifier batch failed:", (e as Error)?.message ?? e);
      continue;
    }
    slice.forEach((s, j) => { record(s.index, "scored"); out[s.index] = { ...out[s.index], prediction: preds[j] }; scored++; });
  }
  const parts = [`Classifier ${meta.version} scored ${scored} plant spot${scored === 1 ? "" : "s"}`];
  if (tooCoarse.length) {
    const gsds = tooCoarse.map(i => out[i].chipGsdM!).sort((a, b) => a - b);
    const median = gsds[Math.floor(gsds.length / 2)];
    parts.push(`${tooCoarse.length} plant spot${tooCoarse.length === 1 ? "" : "s"} not scored: the chips are ${(median * 100).toFixed(1)} cm/px, coarser than the ${((meta.max_gsd_m ?? 0) * 100).toFixed(1)} cm/px the model was trained on (UNKNOWN_RESOLUTION)`);
  }
  const other = candidates.length - scored - tooCoarse.length - notVegetation;
  if (other) parts.push(`${other} vegetation region${other === 1 ? "" : "s"} or unchipped spot${other === 1 ? "" : "s"} not scored (the model knows single plants only)`);
  if (notVegetation) parts.push(`${notVegetation} not vegetation, not the model's question`);
  return { candidates: out, meta, scored, note: `${parts.join("; ")}. ${meta.caveat}` };
}

export { describePrediction, makePrediction, readPrediction, resolutionUsable, NOT_WEED_BELOW, WEED_AT_OR_ABOVE } from "./types";
export { loadCurrentModel } from "./registry";
export type { Inference, InferenceStatus, ModelMeta, PredictedClass, Prediction } from "./types";
