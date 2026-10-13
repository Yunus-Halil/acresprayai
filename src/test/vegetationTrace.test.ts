// @vitest-environment node
//
// Every vegetation component can be traced to one fate, and the fixtures the
// audit asked for each land where they should: an isolated weed, two that
// touch, a long continuous strip, vegetation at the photo's edge, a weed
// merged with the crop row, small fragments, and vegetation across the
// field's boundary. Nothing here is called a weed; nothing is counted twice.
import { describe, expect, it } from "vitest";
import type { PhotoBlob, PhotoPattern } from "@/lib/photoScout/pattern";
import { accountingGap, groupVegetation, isStrip, widthAcross } from "@/lib/weedScout/structure/group";
import { structureOfMap } from "@/lib/weedScout/structure/map";
import { dispositionOf, traceLine, traceVegetation } from "@/lib/weedScout/structure/trace";
import type { VegItem } from "@/lib/weedScout/structure/types";
import { segmentWeed } from "@/lib/weedScout/sizing/segment";
import { measurementLine, measurementRows } from "@/lib/weedScout/sizing/describe";
import { DEFAULT_SIZE_THRESHOLDS } from "@/lib/weedScout/sizing/types";
import { localFrame } from "@/lib/weedScout/rows";
import type { PhotoPixels } from "@/lib/photoScout/pattern";

const blob = (id: number, cls: PhotoBlob["cls"], dM: number, over: Partial<PhotoBlob> = {}): PhotoBlob => ({
  id, x: 100 + id * 50, y: 100, areaPx: Math.PI * (dM / 0.01 / 2) ** 2, areaM2: Math.PI * (dM / 2) ** 2, equivDiameterM: dM, widthM: dM, heightM: dM,
  touchesBorder: false, window: 0, rowIndex: 0, acrossM: 0.5, alongM: 0, cls, ...over,
});
const pattern = (blobs: PhotoBlob[], usable = 1): PhotoPattern => ({
  width: 2000, height: 1000, gsdM: 0.01, rowSpacingM: null, windowM: 4, minBlobAreaCm2: 4, vegetationFraction: 0.1, canopyClosed: false,
  windows: [], blobs, blocks: [], fragments: { cellM: 1, cells: [[0, 0, 30, 90]] },
  summary: { windows: 2, usableWindows: usable, brightnessWindows: 0, medianAngleDeg: 0, medianPitchM: 2, pitchKeptFromGiven: 0, plantDiameterM: 0.3, seedSpacingM: null, seedAgreement: null, blobs: blobs.length, specks: 30, onPattern: 0, doubles: 0, betweenPlants: 0, offRow: 0, unplaced: 0, skips: 0, blocks: 1, squareGrid: false },
  notes: [],
});

describe("the trace: every component to one fate", () => {
  it("names the fate of each fixture, with the reason, and counts them once", () => {
    const blobs = [
      blob(0, "off-row", 0.2),                                              // isolated weed candidate
      blob(1, "off-row", 0.2), blob(2, "off-row", 0.2, { x: 150 + 19 }),    // two touching: both candidates here; the structure clusters them
      blob(3, "off-row", 0.6, { widthM: 5, heightM: 0.3, areaM2: 1.2, equivDiameterM: 1.24 }), // a long strip
      blob(4, "off-row", 0.2, { touchesBorder: true }),                      // at the photo's edge
      blob(5, "on pattern", 1.8),                                            // the crop
      blob(6, "unplaced", 0.3),                                              // no trusted rows
      blob(7, "off-row", 0.04),                                              // under the measurable size
      blob(8, "between plants", 0.1),                                        // under the display floor
    ];
    const measured = new Map([[0, { status: "measured", reason: null }], [1, { status: "unknown", reason: "the plant runs past the measured window" }]]);
    const t = traceVegetation(pattern(blobs), { displayFloorM: 0.15, measured });
    expect(t.components.map(c => c.disposition)).toEqual([
      "candidate: measured", "candidate: refused", "candidate: not measured", "strip: continuous vegetation", "filtered: cut by the edge",
      "crop", "uncertain: no trusted rows", "filtered: under the measurable size", "hidden: under the display floor",
    ]);
    expect(t.components[1].reason).toBe("the plant runs past the measured window");
    expect(t.components[3].reason).toMatch(/5\.0 m long, 4\.0x its equivalent diameter: not one plant/);
    expect(t.components[6].reason).toMatch(/no row pattern was trusted/);
    expect(Object.values(t.counts).reduce((a, b) => a + b, 0)).toBe(blobs.length);
    expect(t.fragments).toBe(30);
    expect(t.minMeasurableM).toBeCloseTo(0.06, 6);
    expect(traceLine(t)).toMatch(/1 candidate: measured; 1 candidate: refused; 1 candidate: not measured; 1 strip: continuous vegetation; 1 uncertain: no trusted rows; 1 filtered: cut by the edge; 1 filtered: under the measurable size; 1 hidden: under the display floor; 1 crop|1 crop; 1 candidate: measured/);
    expect(t.notes.some(n => /1 component\(s\) sit in windows where no row pattern was trusted \(1 of 2 windows\)/.test(n))).toBe(true);
    expect(t.notes.some(n => /30 fragments under the component floor are coverage/.test(n))).toBe(true);
    // The order of the rules: the edge beats everything but the crop; a strip beats the size floors.
    expect(dispositionOf(blob(9, "unplaced", 0.3, { touchesBorder: true }), 0.06, 0).disposition).toBe("filtered: cut by the edge");
    expect(dispositionOf(blob(9, "on pattern", 0.3, { touchesBorder: true }), 0.06, 0).disposition).toBe("crop");
    expect(dispositionOf(blob(9, "off-row", 0.3, { widthM: 1.2, heightM: 0.1 }), 0.06, 0.5).disposition).toBe("strip: continuous vegetation");
  });
});

describe("the fixtures through the structure", () => {
  const item = (id: string, x: number, y: number, dM: number, over: Partial<VegItem> = {}): VegItem =>
    ({ id, x, y, areaM2: Math.PI * (dM / 2) ** 2, equivDiameterM: dM, cls: "off-pattern", kind: "off-row", widthM: dM, heightM: dM, ...over });
  const bounds = { x0: 0, y0: 0, x1: 30, y1: 30 };

  it("a long continuous strip is a cluster of one component with length, width and area, never an individual", () => {
    const strip = item("strip", 10, 10, 1.24, { widthM: 5, heightM: 0.3, areaM2: 1.2 });
    const s = groupVegetation({ items: [strip, item("w", 20, 20, 0.2)], gsdM: 0.01, bounds });
    expect(s.individuals.map(i => i.itemId)).toEqual(["w"]);
    expect(s.clusters).toHaveLength(1);
    const k = s.clusters[0];
    expect(k.continuous).toBe(true);
    expect(k.components).toBe(1);
    expect(k.plantCount).toBeNull();
    expect(k.lengthM).toBeCloseTo(5, 6);
    expect(k.widthM).toBeCloseTo(0.3, 6);
    expect(k.canopyAreaM2).toBeCloseTo(1.2, 6);
    expect(k.footprintAreaM2).toBeCloseTo(1.5, 6);
    expect(s.accounting.counts.strips).toBe(1);
    expect(s.notes.some(n => /1 strip\(s\) of continuous vegetation/.test(n))).toBe(true);
    expect(accountingGap(s.accounting)).toBeCloseTo(0, 9);
    // The rule: at least a metre, at least three times the equivalent diameter.
    expect(isStrip(0.3, 0.9)).toBe(false);
    expect(isStrip(0.3, 1.0)).toBe(true);
    expect(isStrip(0.5, 1.2)).toBe(false);
    expect(widthAcross([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 0, y: 1 }], 4)).toBeCloseTo(1, 6);
  });

  it("a weed touching the crop row stays its own individual; a crop row of merged canopies is crop, not a strip", () => {
    const row = item("row", 10, 10, 1.9, { cls: "crop", kind: null, widthM: 12, heightM: 0.9, areaM2: 2.8 });
    const weed = item("w", 10.5, 10.7, 0.2);
    const s = groupVegetation({ items: [row, weed], gsdM: 0.01, bounds });
    expect(s.individuals.map(i => i.itemId)).toEqual(["w"]);
    expect(s.clusters).toHaveLength(0);
    expect(s.accounting.counts.crop).toBe(1);
    expect(s.accounting.counts.strips).toBe(0);
  });

  it("vegetation across the field's boundary is counted and left out; inside it is grouped", () => {
    const origin = { lat: 38.9, lng: -77.5 };
    const frame = localFrame(origin);
    const at = (x: number, y: number) => frame.toLatLng(x, y);
    const mk = (id: string, x: number, y: number, dM: number) => ({
      id, tileId: "t", centroid: at(x, y), areaM2: Math.PI * (dM / 2) ** 2, equivDiameterM: dM, widthM: dM, heightM: dM, extent: 0.7, chromaR: 0, chromaG: 0, chromaB: 0, exgMean: 0, brightness: 0, gsdM: 0.04, touchesBorder: false, distanceToRowM: 2, rowConfidence: 0.9,
    });
    const boundary = [[at(0, 0), at(20, 0), at(20, 20), at(0, 20)]];
    const g = structureOfMap({ blobs: [mk("in", 5, 5, 0.5), mk("out", 25, 5, 0.5), mk("edge", 19.9, 5, 0.5)], pattern: null, rows: { usable: true, medianPitchM: 2, tiles: [], confidence: 0.9, medianAngleDeg: 0, origin } as never, boundary, gsdM: 0.04, bandM: 0.3 });
    expect(g.individuals.map(i => i.itemId).sort()).toEqual(["edge", "in"]);
    expect(g.accounting.counts.outside).toBe(1);
    expect(g.accounting.outsideM2).toBeCloseTo(Math.PI * 0.0625, 6);
    expect(accountingGap(g.accounting)).toBeCloseTo(0, 9);
    expect(g.notes.some(n => /1 object\(s\) outside the field's boundary/.test(n))).toBe(true);
  });
});

describe("the sizer on a strip", () => {
  it("gives continuous vegetation by length, width and area, and withholds a diameter", () => {
    const W = 400, H = 200, rgba = new Uint8ClampedArray(W * H * 4);
    let seed = 9;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, n = (rand() - 0.5) * 20;
      const green = x >= 50 && x < 350 && y >= 92 && y < 108; // a 3 m by 16 cm strip at 1 cm/px
      rgba[o] = (green ? 70 : 150) + n; rgba[o + 1] = (green ? 150 : 110) + n; rgba[o + 2] = (green ? 50 : 80) + n; rgba[o + 3] = 255;
    }
    const px: PhotoPixels = { width: W, height: H, rgba };
    const m = { ...segmentWeed({ px, centre: { x: 200, y: 100 }, gsdM: 0.01, thresholds: DEFAULT_SIZE_THRESHOLDS, cropCircles: [], expectedDiameterM: 0.8 }).measurement, sourceFrame: null, source: null };
    expect(m.status).toBe("unknown");
    expect(m.reason).toMatch(/continuous vegetation 3\d\d cm long and 1\d cm across/);
    expect(m.canopyDiameterCm).toBeNull();
    expect(m.strip).not.toBeNull();
    expect(m.strip!.lengthCm).toBeGreaterThan(295);
    expect(m.strip!.lengthCm).toBeLessThan(310);
    expect(m.strip!.widthCm).toBeGreaterThan(14);
    expect(m.strip!.widthCm).toBeLessThan(22);
    expect(m.strip!.areaCm2).toBeGreaterThan(4500);
    expect(m.strip!.areaCm2).toBeLessThan(5100);
    expect(m.outlinePx!.length).toBeGreaterThan(8);
    expect(measurementLine(m, "metric")).toMatch(/^Continuous vegetation, not one plant: 3\d\d\.\d cm long, 1\d\.\d cm across, [\d,]+ cm² of canopy\.$/);
    expect(measurementRows(m, "metric").some(r => r[0] === "Continuous vegetation")).toBe(true);
  });
});
