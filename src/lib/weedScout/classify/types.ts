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

export type Prediction = {
  pWeed: number;
  pCrop: number;
  pOther: number;
  modelVersion: string;
};

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
export function describePrediction(p: Prediction): string {
  const pct = Math.round(p.pWeed * 100);
  const lead = p.pWeed >= Math.max(p.pCrop, p.pOther) ? "weed" : p.pCrop >= p.pOther ? "crop" : "not a plant";
  return `Model: ${pct}% weed (reads most like ${lead}), ${p.modelVersion}. A suggestion, not a finding.`;
}
