// The classifier's boundary: what a prediction is, and what a shipped model
// says about itself.
//
// A Prediction is three probabilities that sum to one and the version that
// produced them. It is attached to a candidate next to the operator's own
// past verdicts (feedback) and the in-house description (estimate), and like
// both of those it is a suggestion. Nothing downstream may treat it as the
// verdict: the operator's click is the verdict, and the archive stores the
// two side by side so they can be compared later.
//
// ModelMeta is the sidecar `offrow learn publish` writes next to the ONNX
// file. The app reads it to know the input contract (pixels, span rule), the
// calibration temperature already folded into the graph, and the scorecard
// the model shipped with. A model whose sidecar the app does not understand
// is not loaded.

export type PredictedClass = "weed" | "crop" | "other";

/**
 * The one shape the rest of the app consumes, whatever model produced it. A
 * replacement model only has to yield three probabilities and a version;
 * `makePrediction` derives the rest.
 */
export type Prediction = {
  pWeed: number;
  pCrop: number;
  pOther: number;
  /** The shipped model's id, e.g. "weed-v1". Identifies the weights, so it is also the model id. */
  modelVersion: string;
  /** The highest of the three. */
  predictedClass: PredictedClass;
  /** The probability of `predictedClass`. */
  confidence: number;
  /** When this browser ran the model, ISO. */
  inferredAt: string;
};

export function makePrediction(p: { pWeed: number; pCrop: number; pOther: number }, modelVersion: string, inferredAt = new Date().toISOString()): Prediction {
  const predictedClass: PredictedClass = p.pWeed >= Math.max(p.pCrop, p.pOther) ? "weed" : p.pCrop >= p.pOther ? "crop" : "other";
  const confidence = predictedClass === "weed" ? p.pWeed : predictedClass === "crop" ? p.pCrop : p.pOther;
  return { pWeed: p.pWeed, pCrop: p.pCrop, pOther: p.pOther, modelVersion, predictedClass, confidence, inferredAt };
}

/**
 * A stored `weed_observations.prediction`, read back. Rows written before the
 * derived fields existed carry only the probabilities and the version; those
 * are completed here (with a null time, which is the truth about them). Anything
 * that is not a prediction reads as none.
 */
export function readPrediction(json: unknown): (Omit<Prediction, "inferredAt"> & { inferredAt: string | null }) | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const pWeed = num(j.pWeed), pCrop = num(j.pCrop), pOther = num(j.pOther);
  if (pWeed == null || pCrop == null || pOther == null || typeof j.modelVersion !== "string") return null;
  const full = makePrediction({ pWeed, pCrop, pOther }, j.modelVersion);
  return { ...full, inferredAt: typeof j.inferredAt === "string" ? j.inferredAt : null };
}

export type InferenceStatus =
  /** The model ran on this spot's pixels. */
  | "scored"
  /** The pixels are coarser than anything the model was trained on; it was not asked. */
  | "unknown_resolution"
  /** Bare ground, residue, shadow, a thin stand: not a plant, so not the model's question. */
  | "not_vegetation"
  /** A vegetation region, not a single plant; the model knows single plants only. */
  | "not_a_single_plant"
  | "no_chip";

/**
 * Whether the model was asked about a spot, and on what. Kept beside the
 * prediction (which exists only when status is "scored") so a stored row can
 * say "not run: 8.7 cm/px" rather than carry a silent null.
 */
export type Inference = {
  modelVersion: string;
  /** Where the pixels came from. */
  source: "orthomosaic" | "source_frame";
  effectiveGsdM: number | null;
  /** The coarsest GSD the model may be asked about; null when the sidecar set none. */
  requiredGsdM: number | null;
  status: InferenceStatus;
};

/** True when the model may be asked about pixels this coarse. A sidecar with no limit sets none. */
export function resolutionUsable(meta: Pick<ModelMeta, "max_gsd_m">, gsdM: number | null | undefined): boolean {
  if (meta.max_gsd_m == null) return true;
  return gsdM != null && gsdM <= meta.max_gsd_m;
}

export type SpanRule = { per_diameter: number; min_m: number; max_m: number };

export type ModelScorecard = {
  test_examples: number | null;
  weed_recall: number | null;
  weed_precision: number | null;
  weed_auroc: number | null;
  ece: number | null;
  by_source?: Record<string, { n: number | null; weed_recall: number | null }>;
  weed_recall_by_diameter?: Record<string, { n: number; recall: number }>;
};

export type ModelMeta = {
  version: string;
  file: string;
  bytes: number;
  quantized: boolean;
  classes: string[];
  input: { layout: string; px: number; range: string; span_rule: SpanRule };
  output: string;
  temperature: number | null;
  /** Coarsest ground sample distance the model was trained on, metres per pixel. Absent on older sidecars. */
  max_gsd_m?: number | null;
  max_gsd_basis?: string | null;
  trained_at: string | null;
  sources: string[];
  scorecard: ModelScorecard;
  caveat: string;
  exported_at: string;
};

export type ModelManifest = {
  current: string | null;
  models: Record<string, ModelMeta>;
};

/** The class order the model was trained with. A sidecar that disagrees is refused. */
export const EXPECTED_CLASSES = ["weed", "crop", "other"] as const;

/** Above this the model's word makes a plant start as a weed; below `NOT_WEED_BELOW`, as removed. */
export const WEED_AT_OR_ABOVE = 0.6;
export const NOT_WEED_BELOW = 0.4;

export function isUsableMeta(meta: unknown): meta is ModelMeta {
  if (!meta || typeof meta !== "object") return false;
  const m = meta as Partial<ModelMeta>;
  return (
    typeof m.version === "string" &&
    typeof m.file === "string" &&
    Array.isArray(m.classes) &&
    m.classes.length === EXPECTED_CLASSES.length &&
    m.classes.every((c, i) => c === EXPECTED_CLASSES[i]) &&
    !!m.input && typeof m.input.px === "number" && m.input.px > 0 &&
    !!m.input.span_rule && typeof m.input.span_rule.per_diameter === "number"
  );
}

/** Plain words for a popup. Never says "is a weed". */
export function describePrediction(p: Pick<Prediction, "pWeed" | "predictedClass" | "modelVersion">): string {
  const pct = Math.round(p.pWeed * 100);
  const lead = p.predictedClass === "other" ? "not a plant" : p.predictedClass;
  return `Model: ${pct}% weed (reads most like ${lead}), ${p.modelVersion}. A suggestion, not a finding.`;
}
