// The classifier boundary: the contract the browser shares with the trainer,
// the registry's refusal to load what it does not understand, the default
// verdict's order of authority, and the scoring step's degradation to "no
// prediction" rather than a failed scan.
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DIAMETER_M, DEFAULT_SPAN_RULE, batchInputs, chipToInput, objectSpanM, softmax,
} from "@/lib/weedScout/classify/preprocess";
import { currentModel, fetchManifest } from "@/lib/weedScout/classify/registry";
import { classifyCandidates, isScorable } from "@/lib/weedScout/classify";
import { EXPECTED_CLASSES, NOT_WEED_BELOW, WEED_AT_OR_ABOVE, describePrediction, isUsableMeta, makePrediction, readPrediction, resolutionUsable } from "@/lib/weedScout/classify/types";
import { findingClassOf } from "@/lib/weedScout/candidates";
import { predictionColumns, verdictSourceFor } from "@/lib/weedScout/observations";
import type { ModelMeta } from "@/lib/weedScout/classify/types";
import type { Blob, Candidate } from "@/lib/weedScout/types";
import { defaultVerdict } from "@/components/app/workspace/WeedScoutTab";

describe("the chip contract mirrors offrow/learn/examples.py", () => {
  it("pins the span rule: 4x the diameter, clamped to 0.24..1.2 m, 0.15 m when unknown", () => {
    expect(DEFAULT_SPAN_RULE).toEqual({ per_diameter: 4, min_m: 0.24, max_m: 1.2 });
    expect(DEFAULT_DIAMETER_M).toBe(0.15);
    expect(objectSpanM(0.001)).toBe(0.24);
    expect(objectSpanM(10)).toBe(1.2);
    expect(objectSpanM(0.1)).toBeCloseTo(0.4);
    expect(objectSpanM(null)).toBeCloseTo(0.6);
  });

  it("crops the centre to the object span and box-filters to the model size, in [0, 1] CHW", () => {
    // A 40 px chip covering 2 m: the centre 20 px are red, the rest blue.
    const w = 40, h = 40;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const inner = x >= 10 && x < 30 && y >= 10 && y < 30;
      const i = (y * w + x) * 4;
      rgba[i] = inner ? 255 : 0; rgba[i + 1] = 0; rgba[i + 2] = inner ? 0 : 255; rgba[i + 3] = 255;
    }
    // Object span 1 m of a 2 m chip: exactly the red centre.
    const t = chipToInput({ rgba, width: w, height: h, spanM: 2 }, 1.0, 4);
    expect(t.length).toBe(3 * 16);
    for (let i = 0; i < 16; i++) {
      expect(t[i]).toBeCloseTo(1);          // R plane
      expect(t[16 + i]).toBeCloseTo(0);     // G plane
      expect(t[32 + i]).toBeCloseTo(0);     // B plane
    }
    // The whole chip: three quarters blue, a quarter red, averaged in the box filter.
    const whole = chipToInput({ rgba, width: w, height: h, spanM: 2 }, 2.0, 2);
    const sum = Array.from(whole.subarray(0, 4)).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(4 * 0.25, 5);
  });

  it("batches inputs contiguously and softmax sums to one", () => {
    const a = new Float32Array([1, 2, 3]), b = new Float32Array([4, 5, 6]);
    expect(Array.from(batchInputs([a, b], 1))).toEqual([1, 2, 3, 4, 5, 6]);
    const p = softmax([2, 1, 0]);
    expect(p.reduce((x, y) => x + y, 0)).toBeCloseTo(1);
    expect(p[0]).toBeGreaterThan(p[1]);
  });
});

const META: ModelMeta = {
  version: "weed-v1", file: "weed-v1.onnx", bytes: 1, quantized: true,
  classes: [...EXPECTED_CLASSES], input: { layout: "NCHW", px: 96, range: "0..1", span_rule: DEFAULT_SPAN_RULE },
  output: "logits", temperature: 1.2, trained_at: null, sources: [],
  scorecard: { test_examples: 10, weed_recall: 0.9, weed_precision: 0.8, weed_auroc: 0.95, ece: 0.03 },
  caveat: "A bootstrap.", exported_at: "2026-09-29T00:00:00Z",
};

describe("the registry", () => {
  it("returns no model when the manifest is missing, malformed, or names an unknown contract", async () => {
    const missing = vi.fn(async () => new Response("", { status: 404 }));
    expect(await fetchManifest(missing as unknown as typeof fetch)).toBeNull();
    const bad = vi.fn(async () => new Response("not json", { status: 200 }));
    expect(await fetchManifest(bad as unknown as typeof fetch)).toBeNull();
    expect(currentModel({ current: "x", models: {} })).toBeNull();
    expect(currentModel({ current: "weed-v1", models: { "weed-v1": { ...META, classes: ["crop", "weed", "other"] } } })).toBeNull();
    expect(currentModel({ current: "weed-v1", models: { "weed-v1": META } })).toEqual(META);
  });

  it("refuses a sidecar with the wrong class order or no input contract", () => {
    expect(isUsableMeta(META)).toBe(true);
    expect(isUsableMeta({ ...META, classes: ["weed", "crop"] })).toBe(false);
    expect(isUsableMeta({ ...META, input: undefined })).toBe(false);
  });
});

const blob = (d: number): Blob => ({
  id: "b", tileId: "t", centroid: { lat: 0, lng: 0 }, areaM2: Math.PI * (d / 2) ** 2, equivDiameterM: d,
  widthM: d, heightM: d, extent: 0.7, chromaR: 0.3, chromaG: 0.4, chromaB: 0.3, exgMean: 0.2, brightness: 120,
  gsdM: 0.01, touchesBorder: false,
});

const plant = (over: Partial<Candidate> = {}): Candidate => ({
  id: "c", tileId: "t", centroid: { lat: 0, lng: 0 }, kind: "off-row vegetation", score: 0.5,
  distanceToRowM: 0.3, rowConfidence: 0.9, anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null,
  blob: blob(0.1), region: null, areaM2: 0.01, feedback: null, estimate: null, prediction: null,
  chip: "data:image/png;base64,AAAA", chipSpanM: 0.6, chipGsdM: 0.01, ...over,
});

describe("the default verdict's order of authority", () => {
  it("the operator's own past verdicts beat the model", () => {
    const c = plant({ feedback: { confirmed: 0, dismissed: 5, species: [], factor: 0.4 }, prediction: makePrediction({ pWeed: 0.95, pCrop: 0.03, pOther: 0.02 }, "weed-v1") });
    expect(defaultVerdict(c)).toBe("not_weed");
  });

  it("a confident model sets the default; the middle starts unsure", () => {
    expect(defaultVerdict(plant({ prediction: makePrediction({ pWeed: WEED_AT_OR_ABOVE, pCrop: 0.2, pOther: 0.2 }, "v") }))).toBe("weed");
    expect(defaultVerdict(plant({ prediction: makePrediction({ pWeed: NOT_WEED_BELOW - 0.01, pCrop: 0.5, pOther: 0.11 }, "v") }))).toBe("not_weed");
    expect(defaultVerdict(plant({ prediction: makePrediction({ pWeed: 0.5, pCrop: 0.3, pOther: 0.2 }, "v") }))).toBe("unsure");
  });

  it("without a prediction the old rule stands: a plant starts as a weed", () => {
    expect(defaultVerdict(plant())).toBe("weed");
  });

  it("never wording a prediction as a finding", () => {
    const line = describePrediction(makePrediction({ pWeed: 0.82, pCrop: 0.1, pOther: 0.08 }, "weed-v1"));
    expect(line).toMatch(/82% weed/);
    expect(line).toMatch(/suggestion, not a finding/);
    expect(line).not.toMatch(/is a weed/);
  });
});

describe("what a finding is, before the weed question", () => {
  const region = (klass: string) => ({ kind: "not-average region" as const, region: { klass } as never, blob: null });
  it("maps the pipeline's classes onto the five finding classes", () => {
    expect(findingClassOf(region("bare or dry ground"))).toBe("bare_ground");
    expect(findingClassOf(region("dark ground (wet, shadow or residue)"))).toBe("wet_or_dark_ground");
    expect(findingClassOf(region("thin stand"))).toBe("thin_stand");
    expect(findingClassOf(region("dense vegetation"))).toBe("vegetation");
    expect(findingClassOf(region("pale vegetation"))).toBe("vegetation");
    expect(findingClassOf(region("greener than the field"))).toBe("vegetation");
    expect(findingClassOf(region("different from the field"))).toBe("other_anomaly");
    expect(findingClassOf({ kind: "field outlier", region: null, blob: blob(0.1) })).toBe("vegetation");
    expect(findingClassOf({ kind: "off-row vegetation", region: null, blob: null })).toBe("vegetation");
    expect(findingClassOf({ kind: "field outlier", region: null, blob: null })).toBe("other_anomaly");
  });

  it("the resolution gate: no limit means no gate; a limit refuses coarser pixels and unknown ones", () => {
    expect(resolutionUsable({ max_gsd_m: null }, 0.5)).toBe(true);
    expect(resolutionUsable({ max_gsd_m: 0.02 }, 0.02)).toBe(true);
    expect(resolutionUsable({ max_gsd_m: 0.02 }, 0.021)).toBe(false);
    expect(resolutionUsable({ max_gsd_m: 0.02 }, null)).toBe(false);
  });
});

describe("the normalized prediction", () => {
  it("derives the class and its confidence from the probabilities, for any model", () => {
    const p = makePrediction({ pWeed: 0.1, pCrop: 0.25, pOther: 0.65 }, "other-model-v9", "2026-10-01T00:00:00Z");
    expect(p).toMatchObject({ predictedClass: "other", confidence: 0.65, modelVersion: "other-model-v9", inferredAt: "2026-10-01T00:00:00Z" });
    expect(makePrediction({ pWeed: 0.4, pCrop: 0.4, pOther: 0.2 }, "v").predictedClass).toBe("weed");
  });

  it("reads a stored prediction, completing rows written before the derived fields existed", () => {
    const legacy = readPrediction({ pWeed: 0.81, pCrop: 0.15, pOther: 0.04, modelVersion: "weed-v1" });
    expect(legacy).toMatchObject({ predictedClass: "weed", confidence: 0.81, inferredAt: null });
    const full = makePrediction({ pWeed: 0.2, pCrop: 0.7, pOther: 0.1 }, "weed-v1");
    expect(readPrediction(JSON.parse(JSON.stringify(full)))).toEqual(full);
    expect(readPrediction(null)).toBeNull();
    expect(readPrediction({ pWeed: "x" })).toBeNull();
  });
});

describe("the model's word is stored beside the verdict, never over it", () => {
  it("sends the prediction and its version when a model scored the spot", () => {
    const p = makePrediction({ pWeed: 0.81, pCrop: 0.15, pOther: 0.04 }, "weed-v1");
    expect(predictionColumns({ prediction: p })).toEqual({ prediction: p, model_version: "weed-v1" });
  });

  it("records whether a person set the verdict, and never relabels an untouched archived row", () => {
    expect(verdictSourceFor(true, false)).toBe("operator");
    expect(verdictSourceFor(true, true)).toBe("operator");
    expect(verdictSourceFor(false, false)).toBe("default");
    expect(verdictSourceFor(false, true)).toBeNull();
  });

  it("sends no model columns without a prediction, so a re-save cannot null a stored one", () => {
    const cols = predictionColumns({ prediction: null });
    expect(cols).toEqual({});
    expect("prediction" in cols).toBe(false);
    expect("model_version" in cols).toBe(false);
  });
});

describe("scoring the candidates", () => {
  it("scores plant spots with a chip and leaves regions and unchipped spots alone", async () => {
    const region = plant({ id: "r", kind: "not-average region", blob: null, region: { id: "g", tileIds: ["t"], rings: [[]], centroid: { lat: 0, lng: 0 }, areaM2: 50, tileCount: 5, coreTiles: 3, meanStrength: 4, maxStrength: 5, meanFieldZ: [], drivers: [], klass: "thin stand" } });
    const unchipped = plant({ id: "u", chip: null });
    const scorable = plant({ id: "s" });
    expect(isScorable(region)).toBe(false);
    expect(isScorable(unchipped)).toBe(false);
    expect(isScorable(scorable)).toBe(true);

    const decode = vi.fn(async () => ({ rgba: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4, spanM: 0.6 }));
    const classify = vi.fn(async (chips: unknown[]) => chips.map(() => (makePrediction({ pWeed: 0.7, pCrop: 0.2, pOther: 0.1 }, "weed-v1"))));
    const outcome = await classifyCandidates([region, unchipped, scorable], {
      loadModel: async () => META,
      decode,
      classifierFor: async () => ({ meta: META, classify }),
    });
    expect(outcome.scored).toBe(1);
    expect(outcome.candidates[2].prediction?.pWeed).toBe(0.7);
    expect(outcome.candidates[0].prediction).toBeNull();
    expect(outcome.candidates[1].prediction).toBeNull();
    expect(outcome.note).toMatch(/scored 1 plant spot/);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("refuses pixels coarser than the model was trained on, and says so instead of scoring", async () => {
    const gated: ModelMeta = { ...META, max_gsd_m: 0.02 };
    const coarse = plant({ id: "coarse", chipGsdM: 0.087 });
    const fine = plant({ id: "fine", chipGsdM: 0.01 });
    const classify = vi.fn(async (chips: unknown[]) => chips.map(() => makePrediction({ pWeed: 0.9, pCrop: 0.05, pOther: 0.05 }, "weed-v1")));
    const outcome = await classifyCandidates([coarse, fine], {
      loadModel: async () => gated,
      decode: async () => ({ rgba: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4, spanM: 0.6 }),
      classifierFor: async () => ({ meta: gated, classify }),
    });
    expect(outcome.scored).toBe(1);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(outcome.candidates[0].prediction).toBeNull();
    expect(outcome.candidates[0].inference).toMatchObject({ status: "unknown_resolution", effectiveGsdM: 0.087, requiredGsdM: 0.02, modelVersion: "weed-v1", source: "orthomosaic" });
    expect(outcome.candidates[1].inference).toMatchObject({ status: "scored" });
    expect(outcome.candidates[1].prediction?.pWeed).toBe(0.9);
    expect(outcome.note).toMatch(/1 plant spot not scored: the chips are 8\.7 cm\/px, coarser than the 2\.0 cm\/px the model was trained on \(UNKNOWN_RESOLUTION\)/);
  });

  it("records why a non-vegetation finding or a vegetation region was never the model's question", async () => {
    const bare = plant({ id: "bare", kind: "not-average region", blob: null, region: { id: "g", tileIds: ["t"], rings: [[]], centroid: { lat: 0, lng: 0 }, areaM2: 50, tileCount: 5, coreTiles: 3, meanStrength: 4, maxStrength: 5, meanFieldZ: [], drivers: [], klass: "bare or dry ground" } });
    const dense = plant({ id: "dense", kind: "not-average region", blob: null, region: { ...bare.region!, klass: "dense vegetation" } });
    const outcome = await classifyCandidates([bare, dense], { loadModel: async () => META, classifierFor: async () => ({ meta: META, classify: vi.fn(async () => []) }) });
    expect(outcome.candidates[0].inference?.status).toBe("not_vegetation");
    expect(outcome.candidates[1].inference?.status).toBe("not_a_single_plant");
    expect(outcome.note).toMatch(/1 not vegetation/);
  });

  it("with no model, says so and changes nothing", async () => {
    const c = plant();
    const outcome = await classifyCandidates([c], { loadModel: async () => null });
    expect(outcome.candidates[0]).toBe(c);
    expect(outcome.note).toMatch(/No classifier is shipped/);
  });

  it("a classifier that fails to load degrades to no predictions, not a failed scan", async () => {
    const outcome = await classifyCandidates([plant()], { loadModel: async () => META, classifierFor: async () => null });
    expect(outcome.scored).toBe(0);
    expect(outcome.candidates[0].prediction).toBeNull();
  });
});
