// @vitest-environment node
//
// Vegetation structure on known arrangements: one plant alone, two that
// touch, a clump, a scatter of fragments, weeds beside the crop, objects on
// the edge, the same scene at a coarse pixel size, two photos of one place,
// and a field of twenty thousand objects. Every case holds the accounting
// identity: nothing is counted twice and nothing is lost.
import { describe, expect, it } from "vitest";
import type { PhotoPattern } from "@/lib/photoScout/pattern";
import { analysePhoto } from "@/lib/photoScout/pattern";
import { accountingGap, groupVegetation, linkByGap, polygonArea } from "@/lib/weedScout/structure/group";
import { emptyGroundStructure, groundStructure, mergeGroundStructures } from "@/lib/weedScout/structure/ground";
import { itemsFromPhoto, structureOfPhoto } from "@/lib/weedScout/structure/photo";
import { structureOfMap } from "@/lib/weedScout/structure/map";
import { DEFAULT_STRUCTURE_PARAMS, readStructureParams, type VegItem } from "@/lib/weedScout/structure/types";
import { localFrame } from "@/lib/weedScout/rows";

const plant = (id: string, x: number, y: number, dM: number, over: Partial<VegItem> = {}): VegItem =>
  ({ id, x, y, areaM2: Math.PI * (dM / 2) ** 2, equivDiameterM: dM, cls: "off-pattern", kind: "off-row", ...over });
const bounds = { x0: 0, y0: 0, x1: 20, y1: 20 };

describe("vegetation structure", () => {
  it("1. one isolated plant is an individual, measured, with the scale on the record", () => {
    const s = groupVegetation({ items: [plant("a", 5, 5, 0.2)], gsdM: 0.01, bounds });
    expect(s.individuals).toHaveLength(1);
    expect(s.clusters).toHaveLength(0);
    expect(s.zones).toHaveLength(0);
    expect(s.individuals[0]).toMatchObject({ itemId: "a", equivDiameterM: 0.2, pixelsAcross: 20, kind: "off-row", rowsKnown: true });
    expect(s.minMeasurableM).toBeCloseTo(0.06, 6);
    expect(accountingGap(s.accounting)).toBeCloseTo(0, 9);
    expect(s.accounting.counts).toMatchObject({ items: 1, individuals: 1, clusters: 0, micro: 0 });
  });

  it("2. two touching plants are one cluster of two components with no plant count; two plants 40 cm apart are two individuals", () => {
    const touching = groupVegetation({ items: [plant("a", 5, 5, 0.2), plant("b", 5.2, 5, 0.2)], gsdM: 0.01, bounds });
    expect(touching.individuals).toHaveLength(0);
    expect(touching.clusters).toHaveLength(1);
    const k = touching.clusters[0];
    expect(k.components).toBe(2);
    expect(k.plantCount).toBeNull();
    expect(k.members.sort()).toEqual(["a", "b"]);
    expect(k.canopyAreaM2).toBeCloseTo(2 * Math.PI * 0.01, 6);
    // The footprint holds both discs: wider than one, about 40 by 20 cm.
    expect(k.boxWidthM).toBeCloseTo(0.4, 1);
    expect(k.boxHeightM).toBeCloseTo(0.2, 1);
    expect(k.maxExtentM).toBeCloseTo(0.4, 1);
    expect(k.footprintAreaM2).toBeGreaterThan(k.canopyAreaM2 * 0.8);
    expect(k.x).toBeCloseTo(5.1, 6);
    expect(accountingGap(touching.accounting)).toBeCloseTo(0, 9);
    const apart = groupVegetation({ items: [plant("a", 5, 5, 0.2), plant("b", 5.6, 5, 0.2)], gsdM: 0.01, bounds });
    expect(apart.individuals).toHaveLength(2);
    expect(apart.clusters).toHaveLength(0);
    // The gap is physical and a setting: at 50 cm they are one cluster.
    expect(groupVegetation({ items: [plant("a", 5, 5, 0.2), plant("b", 5.6, 5, 0.2)], gsdM: 0.01, bounds, params: { clusterGapM: 0.5 } }).clusters).toHaveLength(1);
  });

  it("3. a dense clump of overlapping plants is one cluster: canopy is the sum of the components, the footprint is the hull", () => {
    const items: VegItem[] = [];
    for (let i = 0; i < 8; i++) items.push(plant(`c${i}`, 10 + 0.12 * Math.cos((i * Math.PI) / 4), 10 + 0.12 * Math.sin((i * Math.PI) / 4), 0.15));
    const s = groupVegetation({ items, gsdM: 0.01, bounds });
    expect(s.clusters).toHaveLength(1);
    expect(s.individuals).toHaveLength(0);
    const k = s.clusters[0];
    expect(k.components).toBe(8);
    expect(k.canopyAreaM2).toBeCloseTo(8 * Math.PI * 0.075 ** 2, 6);
    expect(k.footprintAreaM2).toBeGreaterThan(0.1);
    expect(k.footprintAreaM2).toBeLessThan(0.2);
    expect(k.hull.length).toBeGreaterThanOrEqual(6);
    expect(polygonArea(k.hull)).toBeCloseTo(k.footprintAreaM2, 9);
    expect(k.x).toBeCloseTo(10, 2);
    expect(accountingGap(s.accounting)).toBeCloseTo(0, 9);
  });

  it("4. a scatter of tiny fragments becomes coverage zones, never individuals, with coverage, density and count", () => {
    const items: VegItem[] = [];
    // Forty fragments per square metre over one 4 m cell (16 m2): 640 fragments of 4 cm2 each.
    for (let i = 0; i < 640; i++) items.push({ id: `f${i}`, x: 4 + (i % 32) * 0.125, y: 4 + Math.floor(i / 32) * 0.2, areaM2: 0.0004, equivDiameterM: 0.0226, cls: "fragment", count: 1 });
    // And a few objects under the measurable size in the next cell.
    for (let i = 0; i < 5; i++) items.push(plant(`s${i}`, 9 + i * 0.5, 5, 0.04));
    const s = groupVegetation({ items, gsdM: 0.01, bounds });
    expect(s.individuals).toHaveLength(0);
    expect(s.zones.length).toBe(2);
    const dense = s.zones.find(z => z.col === 1 && z.row === 1)!;
    expect(dense.fragments).toBe(640);
    expect(dense.count).toBe(640);
    expect(dense.microAreaM2).toBeCloseTo(0.256, 6);
    expect(dense.coverage).toBeCloseTo(0.016, 4);
    expect(dense.density).toBeCloseTo(40, 6);
    expect(dense.cellAreaM2).toBe(16);
    const sub = s.zones.find(z => z.col === 2 && z.row === 1)!;
    expect(sub.subMeasurable).toBe(5);
    expect(sub.fragments).toBe(0);
    expect(s.accounting.microM2).toBeCloseTo(0.256 + 5 * Math.PI * 0.02 ** 2, 6);
    expect(accountingGap(s.accounting)).toBeCloseTo(0, 9);
    // Under both floors a cell holds nothing worth a zone.
    expect(groupVegetation({ items: [plant("s", 15, 15, 0.04)], gsdM: 0.01, bounds }).zones).toHaveLength(0);
    expect(groupVegetation({ items: [plant("s", 15, 15, 0.04)], gsdM: 0.01, bounds, params: { zoneMinCount: 1 } }).zones).toHaveLength(1);
  });

  it("5. a weed beside a crop plant stays its own individual; the crop is counted and never grouped", () => {
    const items = [plant("tree", 10, 10, 1.8, { cls: "crop", kind: null }), plant("w", 10.95, 10, 0.1), plant("w2", 12, 10, 0.1, { kind: "between plants" })];
    const s = groupVegetation({ items, gsdM: 0.01, bounds });
    expect(s.individuals.map(i => i.itemId).sort()).toEqual(["w", "w2"]);
    expect(s.individuals.find(i => i.itemId === "w2")!.kind).toBe("between plants");
    expect(s.clusters).toHaveLength(0);
    expect(s.accounting.cropM2).toBeCloseTo(Math.PI * 0.9 ** 2, 6);
    expect(s.accounting.counts.crop).toBe(1);
    expect(accountingGap(s.accounting)).toBeCloseTo(0, 9);
    // Without a trusted pattern the same objects are vegetation of unknown standing: the tree and the weed touching it are one cluster, the other weed stands alone.
    const blind = groupVegetation({ items: items.map(i => ({ ...i, cls: "unplaced" as const })), gsdM: 0.01, bounds, rowsKnown: false });
    expect(blind.individuals.every(i => !i.rowsKnown && i.kind === null)).toBe(true);
    expect(blind.individuals.map(i => i.itemId)).toEqual(["w2"]);
    expect(blind.clusters).toHaveLength(1);
    expect(blind.clusters[0].members.sort()).toEqual(["tree", "w"]);
    expect(blind.clusters[0].rowsKnown).toBe(false);
    expect(blind.accounting.counts.crop).toBe(0);
    expect(blind.notes.some(n => /not known to be off the crop/.test(n))).toBe(true);
  });

  it("6. an object cut by the imagery's edge is set aside: counted, not measured, not grouped", () => {
    const s = groupVegetation({ items: [plant("a", 0.05, 5, 0.2, { touchesBorder: true }), plant("b", 0.3, 5, 0.2)], gsdM: 0.01, bounds });
    expect(s.individuals.map(i => i.itemId)).toEqual(["b"]);
    expect(s.clusters).toHaveLength(0);
    expect(s.accounting.borderM2).toBeCloseTo(Math.PI * 0.01, 6);
    expect(s.accounting.counts.border).toBe(1);
    expect(accountingGap(s.accounting)).toBeCloseTo(0, 9);
  });

  it("7. the same plant is an individual at 1 cm per pixel and coverage at 3 cm per pixel", () => {
    const fine = groupVegetation({ items: [plant("a", 5, 5, 0.1)], gsdM: 0.01, bounds });
    expect(fine.individuals).toHaveLength(1);
    const coarse = groupVegetation({ items: [plant("a", 5, 5, 0.1)], gsdM: 0.03, bounds, params: { zoneMinCount: 1 } });
    expect(coarse.minMeasurableM).toBeCloseTo(0.18, 6);
    expect(coarse.individuals).toHaveLength(0);
    expect(coarse.zones).toHaveLength(1);
    expect(coarse.zones[0].subMeasurable).toBe(1);
    expect(coarse.notes[0]).toMatch(/under 18 cm across is not measured on its own/);
    expect(readStructureParams({ minPixelsAcross: 8, cellM: -1 })).toEqual({ ...DEFAULT_STRUCTURE_PARAMS, minPixelsAcross: 8 });
  });

  it("8. two photos of the same ground: an object seen twice is kept once and the accounting is summed once", () => {
    const origin = { lat: 38.9, lng: -77.5 };
    const frame = localFrame(origin);
    const toLatLng = (x: number, y: number) => frame.toLatLng(x, y);
    const a = groundStructure(groupVegetation({ items: [plant("a", 5, 5, 0.2), plant("b", 8, 8, 0.2), plant("c", 8.15, 8, 0.2), ...Array.from({ length: 10 }, (_, i) => plant(`f${i}`, 1 + i * 0.1, 1, 0.03))], gsdM: 0.01, bounds }), "photo", toLatLng, "A.JPG");
    const b = groundStructure(groupVegetation({ items: [plant("a2", 5.1, 5, 0.2), plant("d", 15, 15, 0.2), ...Array.from({ length: 10 }, (_, i) => plant(`g${i}`, 1.5 + i * 0.1, 1.5, 0.03))], gsdM: 0.01, bounds }), "photo", toLatLng, "B.JPG");
    expect(a.individuals).toHaveLength(1);
    expect(a.clusters).toHaveLength(1);
    expect(a.zones).toHaveLength(1);
    expect(a.individuals[0].centroid.lat).toBeCloseTo(frame.toLatLng(5, 5).lat, 7);
    expect(a.clusters[0].hull.length).toBeGreaterThan(5);
    expect(a.zones[0].ring).toHaveLength(4);
    const m = mergeGroundStructures([a, b])!;
    expect(m.frames).toEqual(["A.JPG", "B.JPG"]);
    expect(m.individuals.map(i => i.itemId).sort()).toEqual(["a", "d"]);
    expect(m.clusters).toHaveLength(1);
    expect(m.zones).toHaveLength(1);
    expect(m.accounting.individualsM2).toBeCloseTo(2 * Math.PI * 0.01, 6);
    expect(m.accounting.microM2).toBeCloseTo(a.accounting.microM2, 9);
    expect(m.notes[0]).toMatch(/2 photo\(s\) read: 2 individual plants, 1 clusters, 1 coverage zones; 2 seen in a second photo were kept once/);
    expect(mergeGroundStructures([])).toBeNull();
    expect(emptyGroundStructure("map", DEFAULT_STRUCTURE_PARAMS, 0.04).minMeasurableM).toBeCloseTo(0.24, 6);
  });

  it("9. a field of twenty thousand objects groups in well under a few seconds and keeps the identity", () => {
    const items: VegItem[] = [];
    let seed = 5;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 20_000; i++) items.push(plant(`p${i}`, rand() * 400, rand() * 400, 0.05 + rand() * 0.3, { cls: rand() < 0.2 ? "crop" : "off-pattern" }));
    const t0 = Date.now();
    const s = groupVegetation({ items, gsdM: 0.01, bounds: { x0: 0, y0: 0, x1: 400, y1: 400 } });
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(3000);
    expect(s.individuals.length + s.accounting.counts.clusterMembers + s.accounting.counts.crop + s.accounting.counts.micro).toBe(20_000);
    expect(s.clusters.length).toBeGreaterThan(0);
    expect(accountingGap(s.accounting)).toBeCloseTo(0, 6);
    // The linkage finds every touching pair: a brute-force check on a sample agrees.
    const sample = items.filter(i => i.cls !== "crop").slice(0, 2000);
    const roots = linkByGap(sample, 0.15);
    for (let i = 0; i < 300; i++) for (let j = i + 1; j < 300; j++) {
      const a = sample[i], b = sample[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) - a.equivDiameterM / 2 - b.equivDiameterM / 2 <= 0.15) expect(roots[i]).toBe(roots[j]);
    }
  });
});

describe("the adapters", () => {
  const fit = { centre: { x: 2, y: -2 }, sizeM: 4, angleDeg: 0, pitchM: 1, phaseM: 0, confidence: 0.9, angleConfidence: 0.9, pitchConfidence: 0.9, vegetationFraction: 0.1, pitchFromGrower: false, recoveredPitchM: 1 };
  const blob = (id: number, x: number, y: number, dM: number, cls: PhotoPattern["blobs"][number]["cls"], touchesBorder = false) => {
    const areaM2 = Math.PI * (dM / 2) ** 2;
    return { id, x, y, areaPx: areaM2 / 1e-4, areaM2, equivDiameterM: dM, touchesBorder, window: 0, rowIndex: 0, acrossM: 0, alongM: 0, cls };
  };
  const pattern: PhotoPattern = {
    width: 400, height: 400, gsdM: 0.01, rowSpacingM: null, windowM: 4, minBlobAreaCm2: 4, vegetationFraction: 0.1, canopyClosed: false,
    windows: [{ index: 0, x0: 0, y0: 0, x1: 399, y1: 399, fit, signal: "vegetation", usable: true, block: 0, own: null, rowLines: [], squareGrid: false, seed: null, onRow: 0, offRow: 0 }],
    blobs: [blob(0, 100, 100, 0.3, "on pattern"), blob(1, 200, 200, 0.2, "off-row"), blob(2, 220, 200, 0.2, "between plants"), blob(3, 300, 100, 0.04, "off-row"), blob(4, 2, 2, 0.2, "off-row", true)],
    blocks: [], fragments: { cellM: 1, cells: [[3, 3, 50, 2000], [0, 0, 1, 10]] },
    summary: { windows: 1, usableWindows: 1, brightnessWindows: 0, medianAngleDeg: 0, medianPitchM: 1, pitchKeptFromGiven: 0, plantDiameterM: 0.3, seedSpacingM: null, seedAgreement: null, blobs: 5, specks: 51, onPattern: 1, doubles: 0, betweenPlants: 1, offRow: 3, unplaced: 0, skips: 0, blocks: 1, squareGrid: false },
    notes: [],
  };

  it("read a photo's blobs and fragment cells as items in metres, and group them with the photo as the bounds", () => {
    const items = itemsFromPhoto(pattern);
    expect(items).toHaveLength(7);
    expect(items.find(i => i.id === "b0")).toMatchObject({ cls: "crop", x: 1, y: 1 });
    expect(items.find(i => i.id === "b2")).toMatchObject({ cls: "off-pattern", kind: "between plants" });
    expect(items.find(i => i.id === "f3:3")).toMatchObject({ cls: "fragment", count: 50, areaM2: 0.2, x: 3.5, y: 3.5 });
    const s = structureOfPhoto(pattern, { cellM: 2 });
    expect(s.clusters).toHaveLength(1);
    expect(s.clusters[0].kinds).toEqual({ offRow: 1, between: 1 });
    expect(s.individuals).toHaveLength(0);
    expect(s.accounting.counts.border).toBe(1);
    expect(s.accounting.cropM2).toBeCloseTo(Math.PI * 0.15 ** 2, 6);
    const dense = s.zones.find(z => z.col === 1 && z.row === 1)!;
    expect(dense.fragments).toBe(50);
    expect(dense.coverage).toBeCloseTo(0.2 / 4, 6);
    expect(accountingGap(s.accounting)).toBeCloseTo(0, 9);
    const old = structureOfPhoto({ ...pattern, fragments: undefined });
    expect(old.notes.some(n => /predates fragment counting/.test(n))).toBe(true);
  });

  it("the pass counts its specks per cell", async () => {
    // Soil with one 12 cm plant and a sprinkle of two-pixel specks, at 1 cm/px.
    const W = 300, H = 300, rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { rgba[i * 4] = 150; rgba[i * 4 + 1] = 110; rgba[i * 4 + 2] = 80; rgba[i * 4 + 3] = 255; }
    const green = (x: number, y: number) => { const o = (y * W + x) * 4; rgba[o] = 70; rgba[o + 1] = 150; rgba[o + 2] = 50; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - 150) ** 2 + (y - 150) ** 2 <= 36) green(x, y);
    for (let k = 0; k < 40; k++) { const x = 10 + (k % 8) * 35, y = 10 + Math.floor(k / 8) * 50; green(x, y); green(x + 1, y); }
    const p = await analysePhoto({ width: W, height: H, rgba }, { gsdM: 0.01, rowSpacingM: 1, windowM: 3 }, { yieldBetweenWindows: false });
    expect(p.fragments).toBeDefined();
    expect(p.fragments!.cellM).toBe(1);
    expect(p.summary.specks).toBe(40);
    expect(p.fragments!.cells.reduce((n, c) => n + c[2], 0)).toBe(40);
    expect(p.fragments!.cells.reduce((n, c) => n + c[3], 0)).toBe(80);
    expect(p.blobs).toHaveLength(1);
  });

  it("the map's blobs are classed by the pattern and grouped in the field's frame", () => {
    const origin = { lat: 38.9, lng: -77.5 };
    const frame = localFrame(origin);
    const at = (x: number, y: number) => frame.toLatLng(x, y);
    const mk = (id: string, x: number, y: number, dM: number, d: number | null, border = false) => ({
      id, tileId: "t", centroid: at(x, y), areaM2: Math.PI * (dM / 2) ** 2, equivDiameterM: dM, widthM: dM, heightM: dM, extent: 0.7, chromaR: 0, chromaG: 0, chromaB: 0, exgMean: 0, brightness: 0, gsdM: 0.04, touchesBorder: border, distanceToRowM: d, rowConfidence: 0.9,
    });
    const fieldPattern = {
      origin, plants: [{ id: "p", windowId: "w", block: 0, centroid: at(10, 10), areaM2: 2.5, equivDiameterM: 1.8, cls: "on pattern" as const, rowIndex: 0, distanceToRowM: 0 }],
      summary: { plantDiameterM: 1.8 },
    } as never;
    const boundary = [[at(0, 0), at(40, 0), at(40, 40), at(0, 40)]];
    const blobs = [mk("tree", 10, 10, 1.8, 0), mk("w1", 12, 10, 0.4, 0.1), mk("w2", 20, 12, 0.5, 2.4), mk("w3", 20.5, 12, 0.5, 2.4), mk("tiny", 30, 30, 0.1, 2), mk("edge", 0, 5, 0.5, 2, true)];
    const g = structureOfMap({ blobs, pattern: fieldPattern, rows: null, boundary, gsdM: 0.04, bandM: 0.3, params: { zoneMinCount: 1 } });
    expect(g.source).toBe("map");
    expect(g.minMeasurableM).toBeCloseTo(0.24, 6);
    expect(g.individuals.map(i => i.itemId)).toEqual(["w1"]);
    expect(g.individuals[0].kind).toBe("between plants");
    expect(g.clusters).toHaveLength(1);
    expect(g.clusters[0].members.sort()).toEqual(["w2", "w3"]);
    expect(g.clusters[0].kinds.offRow).toBe(2);
    expect(g.zones).toHaveLength(1);
    expect(g.zones[0].subMeasurable).toBe(1);
    expect(g.accounting.counts).toMatchObject({ crop: 1, border: 1, individuals: 1, clusters: 1, micro: 1 });
    expect(accountingGap(g.accounting)).toBeCloseTo(0, 9);
    // Without a pattern or rows, everything is vegetation of unknown standing.
    const blind = structureOfMap({ blobs, pattern: null, rows: null, boundary, gsdM: 0.04, bandM: 0.3 });
    expect(blind.individuals.every(i => !i.rowsKnown)).toBe(true);
    expect(blind.accounting.counts.crop).toBe(0);
  });
});
