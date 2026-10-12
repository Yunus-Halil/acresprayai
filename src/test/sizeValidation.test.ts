//
// The field validation: reference plants matched to predictions by id, by
// position and by photo and pixel; the errors; the verdict that refuses to
// call accuracy measured on too few plants. Plus the misalignment cases the
// measurement itself must refuse, and a saved run keeping its measurements
// and its vegetation structure through the tables.
import { describe, expect, it } from "vitest";
import { type Prediction, type ReferencePlant, matchReferences, predictionFromMeasurement, readReferences, reportLines, validationReport } from "@/lib/weedScout/sizing/validate";
import { DEFAULT_SIZE_THRESHOLDS, type WeedMeasurement, unavailableMeasurement } from "@/lib/weedScout/sizing/types";
import { resultFromRows, slimResult, findingRow } from "@/lib/weedScout/runCache";
import { emptyGroundStructure } from "@/lib/weedScout/structure/ground";
import { DEFAULT_STRUCTURE_PARAMS } from "@/lib/weedScout/structure/types";
import type { Candidate, ScoutResult } from "@/lib/weedScout/types";

const T = DEFAULT_SIZE_THRESHOLDS;
const measured = (d: number, over: Partial<WeedMeasurement> = {}): WeedMeasurement => ({
  ...unavailableMeasurement("", T), status: "measured", reason: null, method: "native-photo-mask-v1", confidence: 0.9,
  canopyDiameterCm: d, canopyAreaCm2: Math.PI * (d / 2) ** 2, maxExtentCm: d * 1.2, boxWidthCm: d, boxHeightCm: d, sizeCategory: "medium", gsdCmPx: 1.0, sourceFrame: "A.JPG", centrePx: { x: 100, y: 100 }, ...over,
});
const pred = (id: string, lat: number, lng: number, m: WeedMeasurement | null): Prediction => predictionFromMeasurement(id, { lat, lng }, m);

describe("matching reference plants", () => {
  const predictions = [
    pred("c-1", 38.9000, -77.5000, measured(20)),
    pred("c-2", 38.9001, -77.5000, measured(10, { gsdCmPx: 3.2, confidence: 0.4 })),
    pred("c-3", 38.9002, -77.5000, { ...unavailableMeasurement("x", T), status: "unknown", reason: "cut by the photo's edge", sourceFrame: "A.JPG" }),
    { ...pred("c-4", 38.9003, -77.5000, measured(30)), image: "B.JPG", x: 2000, y: 1500 },
  ];
  it("by id first, then by position within the tolerance, then by photo and pixel, each prediction used once", () => {
    const refs: ReferencePlant[] = [
      { plantId: "c-1", diameterCm: 18, lat: 38.9, lng: -77.5 },
      { lat: 38.900102, lng: -77.500001, diameterCm: 12 },
      { image: "B.JPG", x: 2030, y: 1480, diameterCm: 28, areaCm2: 600 },
      { lat: 38.95, lng: -77.5, diameterCm: 9 },
      { plantId: "c-3", diameterCm: 15 },
    ];
    const m = matchReferences(refs, predictions);
    expect(m.map(x => x.how)).toEqual(["id", "position", "image-pixel", "none", "id"]);
    expect(m[0].prediction!.id).toBe("c-1");
    expect(m[0].distanceM).toBeCloseTo(0, 3);
    expect(m[1].prediction!.id).toBe("c-2");
    expect(m[1].distanceM!).toBeGreaterThan(0.1);
    expect(m[1].distanceM!).toBeLessThan(0.5);
    expect(m[2].prediction!.id).toBe("c-4");
    expect(m[3].prediction).toBeNull();
    // A second reference naming c-1 cannot take it again.
    expect(matchReferences([{ plantId: "c-1", diameterCm: 18 }, { plantId: "c-1", diameterCm: 19 }], predictions).map(x => x.how)).toEqual(["id", "none"]);
    // Position matching respects the tolerance.
    expect(matchReferences([{ lat: 38.900102, lng: -77.500001, diameterCm: 12 }], predictions, { maxDistanceM: 0.05 })[0].how).toBe("none");
  });

  it("reports the errors, the rates, the buckets and the refusals, and will not call accuracy measured under twenty plants", () => {
    const refs: ReferencePlant[] = [
      { plantId: "c-1", diameterCm: 18, lat: 38.9, lng: -77.5 },
      { plantId: "c-2", diameterCm: 12 },
      { plantId: "c-3", diameterCm: 15 },
      { image: "B.JPG", x: 2030, y: 1480, diameterCm: 28, areaCm2: 600 },
      { lat: 38.95, lng: -77.5, diameterCm: 9 },
    ];
    const r = validationReport(matchReferences(refs, predictions));
    expect(r).toMatchObject({ references: 5, matched: 4, measured: 3, matchRate: 0.8, measuredRate: 0.6 });
    expect(r.howMatched).toEqual({ id: 3, position: 0, "image-pixel": 1, none: 1 });
    // Errors: 20-18 = 2, 10-12 = -2, 30-28 = 2.
    expect(r.meanAbsDiameterErrorCm).toBe(2);
    expect(r.medianAbsDiameterErrorCm).toBe(2);
    expect(r.medianSignedDiameterErrorCm).toBe(2);
    expect(r.medianRelativeError).toBeCloseTo(2 / 18, 2);
    expect(r.area.n).toBe(1);
    expect(r.area.medianAbsErrorCm2).toBeCloseTo(Math.abs(Math.PI * 225 - 600), 0);
    expect(r.position.n).toBe(1);
    expect(r.byGsd.map(b => [b.bucket, b.n])).toEqual([["3 cm/px and over", 1], ["under 1.5 cm/px", 2]]);
    expect(r.byQuality.map(b => [b.bucket, b.n])).toEqual([["confidence 0.8 and over", 2], ["confidence under 0.5", 1]]);
    expect(r.refused).toEqual([{ id: "c-3", reason: "cut by the photo's edge" }]);
    expect(r.unmatched).toEqual(["38.95,-77.5"]);
    expect(r.verdict).toMatch(/3 of 5 reference plant\(s\) matched a measured prediction; under 20, so accuracy is NOT established/);
    const lines = reportLines(r);
    expect(lines[0]).toBe(r.verdict);
    expect(lines.some(l => /mean abs error 2 cm, median abs 2 cm, median signed 2 cm/.test(l))).toBe(true);
    expect(validationReport([]).verdict).toBe("No reference plants: accuracy is unverified.");
    // Twenty measured plants and the verdict changes its mind.
    const many = Array.from({ length: 20 }, (_, i) => ({ plantId: `p${i}`, diameterCm: 10 + i }));
    const manyPred = many.map((x, i) => pred(x.plantId, 38.9 + i * 1e-5, -77.5, measured(10 + i + 1)));
    expect(validationReport(matchReferences(many, manyPred)).verdict).toMatch(/^20 reference plants matched a measured prediction: the errors below are the measured accuracy/);
  });

  it("reads a reference file strictly: a diameter and a way to match, or an error, never an invented plant", () => {
    const { references, errors } = readReferences([
      { _comment: "ignored" },
      { plantId: "c-1", diameterCm: 18 },
      { diameterCm: 12 },
      { plantId: "c-2", diameterCm: -1 },
      { image: "A.JPG", x: 1, y: 2, diameterCm: 9, areaCm2: "big" },
    ]);
    expect(references).toHaveLength(2);
    expect(references[1].areaCm2).toBeNull();
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/row 2: give plantId, or lat and lng, or image/);
    expect(errors[1]).toMatch(/row 3: diameterCm is required/);
    expect(readReferences({ not: "an array" }).errors[0]).toMatch(/must be a JSON array/);
  });
});

describe("a saved run keeps its measurements and its vegetation structure", () => {
  it("through the tables and back", () => {
    const c: Candidate = {
      id: "c-1", tileId: "t", centroid: { lat: 38.9, lng: -77.5 }, kind: "off-row vegetation", score: 0.5, distanceToRowM: 1, rowConfidence: 0.8,
      anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null, blob: null, region: null, areaM2: 0.02, feedback: null, estimate: null,
      chip: "data:image/png;base64,AAAA", chipSpanM: 1, chipGsdM: 0.01,
      measurement: measured(14.2, { outline: [{ lat: 38.9, lng: -77.5 }, { lat: 38.90001, lng: -77.5 }, { lat: 38.9, lng: -77.49999 }] }),
    };
    const vegetation = { map: { ...emptyGroundStructure("map", DEFAULT_STRUCTURE_PARAMS, 0.04), notes: ["map"] }, photos: null };
    const result = {
      tileM: 3, rowsUsed: "fitted", canopyClosed: false, tiles: [], samples: [], scores: [], flags: [], regions: [], rows: null, pattern: null, candidates: [c],
      gsdM: 0.1, sweep: { ran: false, windows: 0, gsdM: null, backedOff: 0, failed: 0, rowWindows: 0 }, missingTiles: 0, baselineTiles: 0, blobCount: 0, smallestMeasurableM: 0.3,
      notes: [], startedAt: "2026-10-12T10:00:00Z", finishedAt: "2026-10-12T10:01:00Z", vegetation,
    } as unknown as ScoutResult;
    const slim = slimResult(result);
    expect(slim.vegetation).toEqual(vegetation);
    const row = findingRow(c);
    expect((row.candidate as Candidate).measurement?.canopyDiameterCm).toBe(14.2);
    expect((row.candidate as Candidate).measurement?.outline).toHaveLength(3);
    expect("chip" in row.candidate).toBe(false);
    const back = resultFromRows({ result: JSON.parse(JSON.stringify(slim)), updated_at: "2026-10-12T10:02:00Z" }, [JSON.parse(JSON.stringify({ candidate: row.candidate }))]);
    expect(back.vegetation).toEqual(vegetation);
    expect(back.candidates[0].measurement).toEqual(c.measurement);
    expect(back.candidates[0].chip).toBeNull();
    expect(back.restoredAt).toBe("2026-10-12T10:02:00Z");
  });
});
