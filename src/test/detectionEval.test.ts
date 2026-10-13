// @vitest-environment node
//
// The detection evaluation on a labelled region: one-to-one matching so one
// big prediction cannot claim several weeds, segmentation scored apart from
// classification, crop-to-weed confusion, misses by what they were lost to,
// and a verdict that refuses to call accuracy measured on a handful.
import { describe, expect, it } from "vitest";
import { CANDIDATE_DISPOSITIONS, type Label, type RegionPrediction, detectionLines, detectionReport, matchLabels } from "@/lib/weedScout/sizing/detectionEval";

const P = (id: string, x: number, y: number, dM: number, disposition: RegionPrediction["disposition"], over: Partial<RegionPrediction> = {}): RegionPrediction =>
  ({ id, x, y, equivDiameterM: dM, disposition, reason: null, measuredCm: disposition === "candidate: measured" ? dM * 100 : null, distanceToRowM: 1, ...over });
const L = (id: string, x: number, y: number, cls: Label["cls"], over: Partial<Label> = {}): Label => ({ id, x, y, cls, ...over });

describe("matching", () => {
  it("is one to one, nearest first, within the larger of the tolerance and the prediction's radius", () => {
    const preds = [P("big", 100, 100, 1.0, "candidate: measured"), P("small", 300, 100, 0.1, "candidate: measured")];
    // Three labels on the big plant's canopy: only one can match it.
    const labels = [L("a", 110, 100, "weed"), L("b", 130, 100, "weed"), L("c", 100, 140, "weed"), L("d", 310, 100, "weed"), L("e", 600, 600, "weed")];
    const m = matchLabels(labels, preds, 0.01);
    expect(m.map(x => x.prediction?.id ?? null)).toEqual(["big", null, null, "small", null]);
    expect(m[0].distancePx).toBeCloseTo(10, 6);
    // A small prediction's reach is the tolerance, not its 5 px radius.
    expect(matchLabels([L("f", 320, 100, "weed")], preds, 0.01)[0].prediction?.id).toBe("small");
    expect(matchLabels([L("g", 330, 100, "weed")], preds, 0.01)[0].prediction).toBeNull();
  });
});

describe("the report", () => {
  const preds = [
    P("w1", 100, 100, 0.2, "candidate: measured"),
    P("w2", 200, 100, 0.05, "candidate: refused", { reason: "under 6 pixels across" }),
    P("w3", 300, 100, 0.08, "hidden: under the display floor"),
    P("c1", 400, 100, 1.8, "crop"),
    P("u1", 500, 100, 0.2, "uncertain: no trusted rows"),
    P("fp", 600, 100, 0.2, "candidate: measured"),
    P("fp2", 700, 100, 0.3, "candidate: measured"),
    P("s1", 800, 100, 0.5, "strip: continuous vegetation"),
  ];
  const labels = [
    L("A", 100, 100, "weed", { diameterCm: 18, shadow: false, distanceToRowM: 0.2 }),
    L("B", 200, 100, "weed", { diameterCm: 5, shadow: true }),
    L("C", 300, 100, "weed", { distanceToRowM: 2 }),
    L("D", 500, 100, "weed"),
    L("E", 800, 100, "weed"),
    L("F", 900, 900, "weed"),
    L("G", 400, 100, "crop"),
    L("H", 700, 100, "crop"),
    L("I", 600, 100, "uncertain"),
  ];
  it("scores segmentation and classification apart, names the losses, and counts the confusion", () => {
    const r = detectionReport(matchLabels(labels, preds, 0.01), preds);
    expect(r.labels).toEqual({ weed: 6, crop: 2, uncertain: 1 });
    expect(r.predictions).toEqual({ total: 8, candidates: 5 });
    expect(CANDIDATE_DISPOSITIONS).toContain("hidden: under the display floor");
    // Segmentation found A, B, C, D, E; F nowhere.
    expect(r.segmentation.weedsSegmented).toEqual({ n: 6, hits: 5, rate: 0.833 });
    expect(r.segmentation.weedsMissedBySegmentation).toEqual(["F"]);
    // Candidates on weeds: A, B (refused still a candidate), C (hidden). Lost: D to uncertain, E to the strip, F to nothing.
    const c = r.classification;
    expect(c.truePositives).toBe(3);
    expect(c.falseNegatives).toBe(3);
    expect(c.weedsLostTo).toEqual({ "uncertain: no trusted rows": 1, "strip: continuous vegetation": 1 });
    // False candidates: fp2 on a crop label; fp on an uncertain label is neither.
    expect(c.falsePositives).toBe(1);
    expect(c.cropCalledWeed).toBe(1);
    expect(c.candidatesOnUncertain).toBe(1);
    expect(c.precision).toBeCloseTo(3 / 4, 3);
    expect(c.recall).toBeCloseTo(0.5, 3);
    expect(c.f1).toBeCloseTo((2 * 0.75 * 0.5) / 1.25, 3);
    // A, D in the middle bucket (18 cm labelled, 20 cm from the prediction); B, C under 10; E over 30; F has neither a label diameter nor a prediction.
    expect(r.bySize.map(b => [b.bucket, b.n])).toEqual([["10 to 30 cm", 2], ["30 cm and over", 1], ["under 10 cm", 2]]);
    // A is 20 cm from a row by its label; B, D and E take their prediction's 1 m; C is 2 m by its label; F has neither.
    expect(r.byDistanceToRow.map(b => [b.bucket, b.n, b.recall])).toEqual([["over 1 m", 4, 0.5], ["under 30 cm from a row", 1, 1]]);
    expect(r.byShadow.map(b => [b.bucket, b.n, b.recall])).toEqual([["in shadow", 1, 1], ["in sun", 1, 1]]);
    expect(r.measurement).toEqual({ n: 1, medianAbsErrorCm: 2, medianRelativeError: 0.111 });
    expect(r.falsePositiveIds).toEqual(["fp2"]);
    expect(r.falseNegativeIds).toEqual(["D", "E", "F"]);
    expect(r.verdict).toMatch(/6 weed label\(s\): under 20/);
    const lines = detectionLines(r);
    expect(lines.some(l => /precision 75%, recall 50%, F1 60%; 3 hits, 3 missed, 1 false candidates; crop called weed 1/.test(l))).toBe(true);
    expect(lines.some(l => /lost to: 1 uncertain: no trusted rows; 1 strip/.test(l))).toBe(true);
  });
  it("says accuracy cannot be calculated with no labels, and that it is measured with twenty", () => {
    expect(detectionReport([], preds).verdict).toBe("No labels: detection accuracy cannot be calculated.");
    const many = Array.from({ length: 20 }, (_, i) => L(`m${i}`, 1000 + i * 100, 500, "weed"));
    const manyPreds = many.map((l, i) => P(`p${i}`, l.x, l.y, 0.2, "candidate: measured"));
    expect(detectionReport(matchLabels(many, manyPreds, 0.01), manyPreds).verdict).toMatch(/^20 weed labels: the rates are the measured performance/);
  });
});
