// A run packed for its tables and rebuilt from them: nothing the review reads is lost but the chip.
import { describe, expect, it } from "vitest";
import type { FieldPattern } from "@/lib/weedScout/fieldPattern";
import { RUN_CACHE_VERSION, findingRow, packPattern, resultFromRows, slimResult, unpackPattern } from "@/lib/weedScout/runCache";
import type { Candidate, ScoutResult } from "@/lib/weedScout/types";

const fit = { centre: { x: 30, y: -20 }, sizeM: 40, angleDeg: 15, pitchM: 4.5, phaseM: 1.2, confidence: 0.9, angleConfidence: 0.9, pitchConfidence: 0.9, vegetationFraction: 0.2, pitchFromGrower: false, recoveredPitchM: 4.5 };
const pattern: FieldPattern = {
  z: 21, gsdM: 0.059, windowM: 60, origin: { lat: 38.9, lng: -77.5 }, notes: ["a note"],
  windows: [{
    win: { id: "0:0", col: 0, row: 0, fetch: { north: 38.9, south: 38.8995, east: -77.499, west: -77.5 }, owned: { north: 38.9, south: 38.8995, east: -77.499, west: -77.5 } },
    origin: { lat: 38.9, lng: -77.5 }, gsdM: 0.059, fitWindows: 25, usableWindows: 24, canopyClosed: false, missingTiles: 0, notes: [],
    plantDiameterM: 1.8, seedSpacingM: 2, seedAgreement: 0.8,
    blocks: [{ windowId: "0:0", id: 0, angleDeg: 15, bearingDeg: 75, pitchM: 4.5, confidence: 0.9, plants: 2, seedSpacingM: 2, squareGrid: false, fit, rowLines: [{ index: 0, offsetM: 0.1, slope: 0.01 }], rects: [{ x0: 0, y0: -12, x1: 12, y1: 0 }] }],
  }],
  plants: [
    { id: "0:0:1", windowId: "0:0", block: 0, centroid: { lat: 38.89991, lng: -77.49992 }, areaM2: 2.5, equivDiameterM: 1.78, cls: "on pattern", rowIndex: 0, distanceToRowM: 0.05 },
    { id: "0:0:2", windowId: "0:0", block: 0, centroid: { lat: 38.89982, lng: -77.49985 }, areaM2: 0.1, equivDiameterM: 0.36, cls: "off-row", rowIndex: 1, distanceToRowM: null },
  ],
  lines: [{ windowId: "0:0", block: 0, rowIndex: 0, points: [{ lat: 38.9, lng: -77.5 }, { lat: 38.8996, lng: -77.4992 }] }],
  summary: { windows: 1, windowsWithRows: 1, fitWindows: 25, usableFitWindows: 24, blocks: 1, rowSpacingM: 4.5, bearingDeg: 75, plantSpacingM: 2, plantDiameterM: 1.8, plantCount: 1, offPatternCount: 1, seedAgreement: 0.8, squareGrid: false, missingTiles: 0 },
};

const candidate = (id: string, kind: Candidate["kind"], score: number): Candidate => ({
  id, tileId: "t", centroid: { lat: 38.8999, lng: -77.4999 }, kind, score, distanceToRowM: 1.1, rowConfidence: 0.8,
  anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null,
  blob: { id: "b", tileId: "t", centroid: { lat: 38.8999, lng: -77.4999 }, areaM2: 0.2, equivDiameterM: 0.5, widthM: 0.5, heightM: 0.5, extent: 0.7, chromaR: 0.3, chromaG: 0.4, chromaB: 0.3, exgMean: 0.2, brightness: 0.5, gsdM: 0.02, touchesBorder: false },
  region: null, areaM2: 0.2, feedback: null, estimate: null, prediction: null,
  sourceImages: { photos: 1, best: "DJI_0005.JPG", coverage: 1, chosen: ["DJI_0005.JPG"], nearestOnly: false, kept: true },
  chip: "data:image/png;base64,AAAA", chipSpanM: 2, chipGsdM: 0.02,
});

const result: ScoutResult = {
  tileM: 3, rowsUsed: "fitted", canopyClosed: false, tiles: [{ id: "t" } as ScoutResult["tiles"][number]], samples: [{} as ScoutResult["samples"][number]], scores: [], flags: [],
  regions: [], rows: null, pattern, candidates: [candidate("c-1", "off-row vegetation", 0.4), candidate("c-2", "between plants", 0.7)],
  gsdM: 0.1, sweep: { ran: true, windows: 10, gsdM: 0.02, backedOff: 0, failed: 0, rowWindows: 0 }, missingTiles: 0, baselineTiles: 100,
  blobCount: 500, smallestMeasurableM: 0.06, notes: ["n1"], startedAt: "2026-10-08T10:00:00Z", finishedAt: "2026-10-08T10:05:00Z",
};

describe("the saved run", () => {
  it("packs the plants to numbers and unpacks them whole", () => {
    const packed = packPattern(pattern);
    expect(packed.packedPlants).toHaveLength(2);
    expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(pattern).length);
    const back = unpackPattern(packed);
    expect(back.plants.map(p => [p.cls, p.areaM2, p.rowIndex, p.distanceToRowM, p.block, p.windowId])).toEqual(
      pattern.plants.map(p => [p.cls, p.areaM2, p.rowIndex, p.distanceToRowM, p.block, p.windowId]),
    );
    expect(back.plants[0].centroid.lat).toBeCloseTo(pattern.plants[0].centroid.lat, 7);
    expect(back.windows).toEqual(pattern.windows);
    expect(back.lines).toEqual(pattern.lines);
    expect(back.summary).toEqual(pattern.summary);
  });

  it("slims the result to what the review reads and strips the chip from each finding", () => {
    const slim = slimResult(result);
    expect("tiles" in slim).toBe(false);
    expect("candidates" in slim).toBe(false);
    expect(slim.pattern?.packedPlants).toHaveLength(2);
    expect(slim.notes).toEqual(["n1"]);
    const row = findingRow(result.candidates[1]);
    expect(row).toMatchObject({ candidate_id: "c-2", kind: "between plants", finding_class: "vegetation", score: 0.7, source_photo: "DJI_0005.JPG" });
    expect("chip" in row.candidate).toBe(false);
    expect(row.candidate.sourceImages?.best).toBe("DJI_0005.JPG");
  });

  it("rebuilds a result from its rows, worst first, with empty tile arrays and the restore time", () => {
    const slim = slimResult(result);
    const rows = result.candidates.map(c => ({ candidate: findingRow(c).candidate }));
    const back = resultFromRows({ result: slim, updated_at: "2026-10-08T11:00:00Z" }, rows);
    expect(back.restoredAt).toBe("2026-10-08T11:00:00Z");
    expect(back.tiles).toEqual([]);
    expect(back.candidates.map(c => c.id)).toEqual(["c-2", "c-1"]);
    expect(back.candidates.every(c => c.chip === null)).toBe(true);
    expect(back.pattern?.summary).toEqual(pattern.summary);
    expect(back.pattern?.plants).toHaveLength(2);
    expect(back.sweep.gsdM).toBe(0.02);
    expect(RUN_CACHE_VERSION).toMatch(/^weed-scout-v/);
  });
});
