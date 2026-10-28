// The cultivated-block boundary: the evidence classes, the inference on a small synthetic orchard with and without
// photographs, what it refuses to do (extend into unseen ground, promote itself to an operational limit), the
// operator's state, and how the intelligence clips to the block while keeping the observations outside it.
import { describe, expect, it } from "vitest";
import { BOUNDARY_DEFAULTS, NO_OPERATIONAL_BOUNDARY, STABILITY_VARIANTS, concaveBaseline, imageCoverage, inferBoundary, inferBoundaryFromMeasures, operationalBoundary, polygonArea, reliableRows, simplifyRing, toTwinBoundary, treesInCover, validRing, viewsAt } from "@/lib/fieldTwin/boundary";
import { EV, type EvidenceMeasures, type EvidenceRaster, classifyEvidence, decodeEvidence, downsampleEvidence, encodeEvidence, evidenceAt } from "@/lib/fieldTwin/boundaryEvidence";
import { buildHeatRaster } from "@/lib/fieldTwin/heatmap";
import { blockOf, fieldIntelligence, localFrame, pointInRing, pressureGrid, scoutingZones } from "@/lib/fieldTwin/intelligence";
import { buildScene } from "@/lib/fieldTwin/scene";
import { FIELD_TWIN_FORMAT, type TwinBundle, type TwinTree, type TwinWeed, parseTwin } from "@/lib/fieldTwin/types";

// A small orchard with rows running east: 4 rows 5 m apart (across 5, 10, 15, 20), trees every 3 m from along 8
// to 47. Photographs cover along -20 to 80, across -10 to 40 (two footprints, overlapping).
const LAT = 33.88, LNG = -5.42, mLat = 111_320, mLng = 111_320 * Math.cos((LAT * Math.PI) / 180);
const at = (e: number, n: number): [number, number] => [LAT + n / mLat, LNG + e / mLng];
let nextId = 1;
const tree = (e: number, n: number, rowId: number | null, over: Partial<TwinTree> = {}): TwinTree => ({ id: nextId++, lat: at(e, n)[0], lng: at(e, n)[1], crownRadiusM: 1, heightM: 1, seenBy: 3, coveredBy: 3, viewSpreadM: 0.05, sizeCv: 0.05, rowId, evidence: [], ...over });
const weed = (id: number, e: number, n: number, over: Partial<TwinWeed> = {}): TwinWeed => ({ id, lat: at(e, n)[0], lng: at(e, n)[1], status: "verified", rowStatus: "between rows", diameterM: 0.3, areaM2: 0.07, spanM: null, heightM: null, seenBy: 3, coveredBy: 3, viewSpreadM: 0.04, sizeCv: 0.1, score: 0.7, treeId: null, ring: [at(e - 0.15, n - 0.15), at(e + 0.15, n - 0.15), at(e, n + 0.15)], evidence: [], ...over });
const ROWS = [5, 10, 15, 20];
const baseTwin = (): TwinBundle => {
  nextId = 1;
  const trees = ROWS.flatMap((ac, k) => Array.from({ length: 14 }, (_, i) => tree(8 + 3 * i, ac, k + 1)));
  return {
    format: FIELD_TWIN_FORMAT, id: "boundary-test", name: "t", builtAt: "", source: { photographs: 2, camera: "", capturedAt: null, groundPixelCm: 1, method: "", weedModel: "", treeModel: "" },
    origin: { lat: LAT, lng: LNG }, bounds: [at(-20, -10), at(80, 40)], field: { rowDirectionDeg: 0, rowSpacingM: 5, plantSpacingM: 3 },
    footprints: [{ photo: "a", ring: [at(-20, -10), at(35, -10), at(35, 40), at(-20, 40)] }, { photo: "b", ring: [at(25, -10), at(80, -10), at(80, 40), at(25, 40)] }],
    rows: ROWS.map((ac, k) => ({ id: k + 1, kept: true, reason: null, line: [at(6.5, ac), at(48.5, ac)], trees: 14, inferred: 0, photos: 2, lengthM: 42, straightnessSdM: 0.1 })),
    trees, inferredTrees: [],
    weeds: [weed(100, 30, 12), weed(101, 31, 12.5), weed(102, 30.5, 13), weed(200, 70, 12), weed(201, 71, 12.5)],
    vegetation: [], atlases: [], stats: {},
  };
};

/** Measurements over along -20..80, across -10..40 at `cellM`: bare soil everywhere, then regions painted in. */
function measures(cellM = 0.5, paint: (al: number, ac: number) => { cover?: number; luma?: number; sat?: number; unseen?: boolean } | null = () => null): EvidenceMeasures {
  const along0 = -20, across0 = -10, width = Math.round(100 / cellM), height = Math.round(50 / cellM), N = width * height;
  const m: EvidenceMeasures = { cellM, along0, across0, width, height, seen: new Uint8Array(N).fill(1), cover: new Float32Array(N), luma: new Float32Array(N).fill(128), sat: new Float32Array(N).fill(0.43) };
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const p = paint(along0 + (i + 0.5) * cellM, across0 + (j + 0.5) * cellM);
    if (!p) continue;
    const c = j * width + i;
    if (p.unseen) m.seen[c] = 0;
    if (p.cover != null) m.cover[c] = p.cover;
    if (p.luma != null) m.luma[c] = p.luma;
    if (p.sat != null) m.sat[c] = p.sat;
  }
  return m;
}
const wheatEast = (al: number) => (al >= 60 ? { cover: 1 } : null);

describe("boundary evidence classes", () => {
  it("classes dense cover, road and soil, drops small cover patches, paints canopy and foreign trees, keeps unseen", () => {
    const m = measures(0.5, (al, ac) => {
      if (al >= 60) return { cover: 1 };                                  // wheat: 20 x 50 m
      if (ac <= -5) return { cover: 0, luma: 170, sat: 0.25 };            // a track along the south
      if (al >= 30 && al < 32 && ac >= 25 && ac < 27) return { cover: 1 }; // a 2 x 2 m weed patch
      if (al < -15) return { unseen: true };
      return null;
    });
    const { raster, stats } = classifyEvidence(m, [{ along: 20, across: 10, r: 1, onRow: true }, { along: 20, across: 35, r: 1, onRow: false }]);
    expect(evidenceAt(raster, 70, 20)).toBe(EV.cover);
    expect(evidenceAt(raster, 20, -8)).toBe(EV.road);
    expect(evidenceAt(raster, 31, 26)).toBe(EV.soil); // 4 m2 of cover is a weed patch, not another crop
    expect(evidenceAt(raster, 20, 10)).toBe(EV.canopy);
    expect(evidenceAt(raster, 20, 35)).toBe(EV.foreign);
    expect(evidenceAt(raster, 20, 36.2)).toBe(EV.foreign); // widened into a band
    expect(evidenceAt(raster, -18, 20)).toBe(EV.unseen);
    expect(evidenceAt(raster, 500, 500)).toBe(EV.unseen); // off the raster
    expect(stats.coverComponentsKept).toBe(1); expect(stats.coverComponentsDropped).toBe(1); expect(stats.roadComponentsKept).toBe(1);
    expect(stats.cells.unseen).toBeGreaterThan(0);
  });

  it("round-trips through the run-length encoding and downsamples by majority", () => {
    const m = measures(0.5, wheatEast);
    const { raster } = classifyEvidence(m, []);
    const enc = encodeEvidence(raster);
    expect(enc.rle.length).toBeLessThan(raster.cls.length / 10);
    const back = decodeEvidence(enc)!;
    expect(back).not.toBeNull();
    expect(Array.from(back.cls)).toEqual(Array.from(raster.cls));
    expect(decodeEvidence({ ...enc, width: enc.width + 1 })).toBeNull();
    const coarse = downsampleEvidence(raster, 2);
    expect(coarse.cellM).toBe(1); expect(coarse.width).toBe(100);
    expect(evidenceAt(coarse, 70, 20)).toBe(EV.cover); expect(evidenceAt(coarse, 20, 20)).toBe(EV.soil);
  });
});

describe("boundary inference without photographs", () => {
  it("is the rows' own geometry with half-spacing margins, every vertex marked default, and says no photographs were read", () => {
    const twin = baseTwin();
    const r = inferBoundary(twin)!;
    expect(r).not.toBeNull();
    expect(r.method).toBe("rows only");
    expect(r.vertices.every(v => v.support === "default")).toBe(true);
    const als = r.ringField.map(p => p[0]), acs = r.ringField.map(p => p[1]);
    expect(Math.min(...als)).toBeCloseTo(8 - 1.5, 6); expect(Math.max(...als)).toBeCloseTo(47 + 1.5, 6);
    expect(Math.min(...acs)).toBeCloseTo(5 - 2.5, 6); expect(Math.max(...acs)).toBeCloseTo(20 + 2.5, 6);
    expect(r.areaM2).toBeCloseTo(42 * 20, 3);
    expect(r.areaM2).toBeCloseTo(r.baselines.rowAligned.areaM2, 3);
    expect(r.failures.some(f => /no photographs/.test(f))).toBe(true);
    expect(r.stats.treesInside).toBe(56); expect(r.stats.onRowTreesOutside).toBe(0);
    expect(r.baselines.concave).not.toBeNull();
    expect(r.baselines.concave!.overlapShare).toBeGreaterThan(0.6);
    expect(r.processingMs).toBeLessThan(2000);
    expect(inferBoundary({ ...twin, rows: [], trees: [] })).toBeNull();
  });

  it("excludes an outer row off the pitch, and rows with too few trees", () => {
    const twin = baseTwin();
    // A fifth "row" 7 m beyond the last (the pitch is 5): a hedge.
    const hedge = Array.from({ length: 10 }, (_, i) => tree(8 + 4 * i, 27, 5));
    twin.rows.push({ id: 5, kept: true, reason: null, line: [at(6.5, 27), at(48.5, 27)], trees: 10, inferred: 0, photos: 3, lengthM: 42, straightnessSdM: 0.1 });
    twin.trees.push(...hedge);
    twin.rows.push({ id: 6, kept: true, reason: null, line: [at(6.5, 0), at(48.5, 0)], trees: 2, inferred: 0, photos: 3, lengthM: 42, straightnessSdM: 0.1 });
    twin.trees.push(tree(10, 0, 6), tree(13, 0, 6));
    const { rows, excluded } = reliableRows(twin);
    expect(rows.map(r => r.id)).toEqual([1, 2, 3, 4]);
    expect(excluded.find(x => x.id === 5)?.reason).toMatch(/off the pitch: 7 m from row 4 against a 5 m pitch/);
    expect(excluded.find(x => x.id === 6)?.reason).toMatch(/2 reliable observed trees/);
    const r = inferBoundary(twin)!;
    expect(Math.max(...r.ringField.map(p => p[1]))).toBeCloseTo(22.5, 6);
    expect(r.stats.offRowTreesOutside).toBe(12);
  });

  it("trims a run of trees beyond a gap that is off the row's line, keeps one on the line", () => {
    const twin = baseTwin();
    // Row 4: three trees 15 m beyond its end drifting across (another planting crossing); row 1: two trees beyond a gap but on the line.
    twin.trees.push(tree(62, 20.2, 4), tree(64.6, 20.9, 4), tree(67.2, 21.6, 4));
    twin.trees.push(tree(62, 5, 1), tree(65, 5.1, 1));
    const { rows, trimmed } = reliableRows(twin);
    expect(trimmed).toEqual([{ rowId: 4, ids: expect.any(Array), end: "end", gapM: expect.any(Number), why: "off the line" }]);
    expect(trimmed[0].ids.length).toBe(3);
    expect(rows.find(r => r.id === 4)!.a1).toBeCloseTo(47, 6);
    expect(rows.find(r => r.id === 1)!.a1).toBeCloseTo(65, 6);
    const r = inferBoundary(twin)!;
    expect(r.failures.some(f => /row 4: 3 trees at its end lie beyond a gap/.test(f))).toBe(true);
    expect(r.stats.treesTrimmed).toBe(3);
  });
});

describe("boundary inference with photographs", () => {
  it("stops the row ends at a wheat field and the sides at a track and at trees off the rows; marks the end of the photographs", () => {
    const twin = baseTwin();
    // Wheat east of along 55; a track south of across 1; foreign trees along across 26; nothing seen north of across 32.
    const foreign = Array.from({ length: 14 }, (_, i) => tree(8 + 3 * i, 26, null));
    twin.trees.push(...foreign);
    const m = measures(0.25, (al, ac) => {
      if (al >= 55) return { cover: 1 };
      if (ac <= 1) return { cover: 0, luma: 170, sat: 0.25 };
      if (ac >= 32) return { unseen: true };
      return null;
    });
    const { raster } = classifyEvidence(m, twin.trees.map(t => { const [al, ac] = localFrame(twin).toField(...localFrame(twin).toLocal(t.lat, t.lng)); return { along: al, across: ac, r: t.crownRadiusM, onRow: t.rowId != null }; }));
    const r = inferBoundary(twin, raster)!;
    expect(r.method).toBe("rows and photographs");
    const end1 = r.vertices.filter(v => v.side === "end1");
    expect(end1.length).toBeGreaterThan(0);
    for (const v of end1) { expect(v.support).toBe("photographs"); expect(v.stoppedBy).toBe("cover"); expect(v.along).toBeGreaterThan(53); expect(v.along).toBeLessThan(55.5); }
    const side0 = r.vertices.filter(v => v.side === "side0");
    for (const v of side0) { expect(v.stoppedBy).toBe("road"); expect(v.across).toBeGreaterThan(0.5); expect(v.across).toBeLessThan(2); }
    const side1 = r.vertices.filter(v => v.side === "side1");
    for (const v of side1) { expect(v.stoppedBy).toBe("foreign"); expect(v.across).toBeLessThan(26 - 1.5); expect(v.across).toBeGreaterThan(22); }
    // The west ends meet nothing within the cap (3 pitches = 15 m): capped and said so.
    const end0 = r.vertices.filter(v => v.side === "end0");
    for (const v of end0) { expect(v.support).toBe("cap"); expect(v.marginM).toBeCloseTo(15, 6); }
    expect(r.failures.some(f => /met no edge within the cap/.test(f))).toBe(true);
    expect(r.stats.inside!.cover).toBeLessThan(0.02);
    expect(r.stats.support.photographs).toBeGreaterThan(0.5);
    expect(r.uncertaintyM2).toBeGreaterThan(0);
    expect(r.uncertaintyM2).toBeLessThan(r.areaM2);
    expect(r.processingMs).toBeLessThan(3000);
  });

  it("never extends into ground no photograph saw, and bridges a side between the pieces of an edge it met", () => {
    const twin = baseTwin();
    // Nothing seen north of across 23; foreign trees south at across -1 only along the west half.
    const foreign = Array.from({ length: 7 }, (_, i) => tree(8 + 3 * i, -1, null));
    twin.trees.push(...foreign);
    const m = measures(0.25, (al, ac) => (ac >= 23 ? { unseen: true } : null));
    const fr = localFrame(twin);
    const { raster } = classifyEvidence(m, twin.trees.map(t => { const [al, ac] = fr.toField(...fr.toLocal(t.lat, t.lng)); return { along: al, across: ac, r: t.crownRadiusM, onRow: t.rowId != null }; }));
    const r = inferBoundary(twin, raster)!;
    const side1 = r.vertices.filter(v => v.side === "side1");
    for (const v of side1) { expect(v.support).toBe("coverage"); expect(v.stoppedBy).toBe("unseen"); expect(v.across).toBeLessThanOrEqual(23); }
    expect(r.failures.some(f => /end of the photographs/.test(f))).toBe(true);
    const side0 = r.vertices.filter(v => v.side === "side0");
    expect(side0.some(v => v.support === "photographs" && v.stoppedBy === "foreign")).toBe(true);
    expect(side0.some(v => v.support === "bridged")).toBe(true);
    for (const v of side0) expect(v.marginM).toBeLessThan(BOUNDARY_DEFAULTS.sideCapPitches * 5);
    expect(r.failures.some(f => /bridged/.test(f))).toBe(true);
  });

  it("finds trees that stand in dense cover and takes the row's end from the trees before them", () => {
    const twin = baseTwin();
    // Row 2 runs on into the wheat: four more trees at along 62 to 71, all inside cover.
    const extra = [62, 65, 68, 71].map(al => tree(al, 10, 2));
    twin.trees.push(...extra);
    const m = measures(0.25, wheatEast);
    const fr = localFrame(twin);
    const { raster } = classifyEvidence(m, twin.trees.map(t => { const [al, ac] = fr.toField(...fr.toLocal(t.lat, t.lng)); return { along: al, across: ac, r: t.crownRadiusM, onRow: true }; }));
    const inCover = treesInCover(twin, raster);
    expect([...inCover].sort()).toEqual(extra.map(t => t.id).sort());
    const r = inferBoundary(twin, raster)!;
    expect(r.stats.treesInCover).toBe(4);
    const end1 = r.vertices.filter(v => v.side === "end1" && v.rowId === 2);
    for (const v of end1) expect(v.along).toBeLessThan(60.5);
    expect(r.failures.some(f => /4 trees on the field's rows stand in dense cover/.test(f))).toBe(true);
  });
});

describe("the bundle record and the operator's boundary", () => {
  it("writes a record a bundle parses, with lat/lng rings and the evidence, and refuses a broken one", () => {
    const twin = baseTwin();
    const m = measures(0.5, wheatEast);
    const { raster } = classifyEvidence(m, []);
    const r = inferBoundary(twin, raster)!;
    const record = toTwinBoundary(r, localFrame(twin), encodeEvidence(downsampleEvidence(raster, 2)));
    expect(record.cultivated.ring.length).toBe(record.cultivated.vertices.length);
    expect(record.cultivated.areaM2).toBe(Math.round(r.areaM2));
    const parsed = parseTwin({ ...twin, boundary: record });
    expect(parsed.ok).toBe(true);
    const bad = parseTwin({ ...twin, boundary: { ...record, cultivated: { ...record.cultivated, vertices: [] } } });
    expect("reason" in bad && bad.reason).toMatch(/vertices/);
    expect(parseTwin({ ...twin, boundary: null }).ok).toBe(true);
    // The scene decodes the evidence and carries the boundary's supports.
    const scene = buildScene({ ...twin, boundary: record });
    expect(scene.boundary?.n).toBe(record.cultivated.ring.length);
    expect(scene.evidence?.cellM).toBe(1);
    expect(scene.intel.blockSource).toBe("inferred");
  });

  it("never returns the inferred boundary as an operational one", () => {
    expect(operationalBoundary(NO_OPERATIONAL_BOUNDARY)).toBeNull();
    expect(operationalBoundary(null)).toBeNull();
    const ring: [number, number][] = [at(0, 0), at(10, 0), at(10, 10)];
    expect(operationalBoundary({ ring, source: null, at: null })).toBeNull();
    expect(operationalBoundary({ ring, source: "accepted", at: "2026-10-28" })).toBe(ring);
    expect(operationalBoundary({ ring: ring.slice(0, 2), source: "accepted", at: null })).toBeNull();
    expect(validRing(ring)).toBe(true); expect(validRing([[1, 2]])).toBe(false); expect(validRing([[91, 0], [0, 0], [1, 1]])).toBe(false);
  });
});

describe("intelligence clipped to the block", () => {
  it("takes the corrected ring over the inferred one over the rows, clips zones and the pressure wash, keeps the observations outside", () => {
    const twin = baseTwin();
    const m = measures(0.5, wheatEast);
    const { raster } = classifyEvidence(m, []);
    const record = toTwinBoundary(inferBoundary(twin, raster)!, localFrame(twin), null);
    const withB: TwinBundle = { ...twin, boundary: record };
    expect(blockOf(twin)!.source).toBe("rows");
    expect(blockOf(withB)!.source).toBe("inferred");
    const corrected: [number, number][] = [at(0, 0), at(40, 0), at(40, 25), at(0, 25)];
    expect(blockOf(withB, undefined, corrected)!.source).toBe("corrected");
    expect(polygonArea(blockOf(withB, undefined, corrected)!.ring)).toBeCloseTo(1000, 3);

    // Weeds 200 and 201 at along 70 lie in the wheat, outside the block: observed, not the field's pressure.
    const intel = fieldIntelligence(withB);
    expect(intel.summary.verifiedOutsideBlock).toBe(2);
    const outside = intel.grid.cells.find(c => !c.inBlock && c.verified > 0);
    expect(outside).toBeDefined();
    expect(outside!.verified).toBe(2);
    const grid = pressureGrid(withB, 4);
    const all = scoutingZones(grid, 0.01, 1, false), clipped = scoutingZones(grid, 0.01, 1);
    expect(all.length).toBe(2); expect(clipped.length).toBe(1);
    expect(clipped[0].cells.every(c => c.inBlock)).toBe(true);
    const inside = buildHeatRaster(intel, 1)!, both = buildHeatRaster(intel, 1, undefined, true)!;
    expect(both.painted).toBeGreaterThan(inside.painted);
    const [e, n] = intel.frame.toLocal(...at(70, 12));
    expect(pointInRing(e, n, intel.block!)).toBe(false);
  });
});

describe("blocks of rows, coverage, confidence and failure codes", () => {
  const rasterOf = (twin: TwinBundle, m: EvidenceMeasures) => { const fr = localFrame(twin); return classifyEvidence(m, twin.trees.map(t => { const [al, ac] = fr.toField(...fr.toLocal(t.lat, t.lng)); return { along: al, across: ac, r: t.crownRadiusM, onRow: t.rowId != null }; })).raster; };

  it("keeps a block of rows beyond a gap of three pitches as another block: reported, never merged", () => {
    const twin = baseTwin();
    // Three rows of 6 trees at across 35, 40, 45: the same pitch, 15 m (three pitches) beyond row 4.
    for (const [k, ac] of [35, 40, 45].entries()) {
      twin.rows.push({ id: 5 + k, kept: true, reason: null, line: [at(6.5, ac), at(24.5, ac)], trees: 6, inferred: 0, photos: 2, lengthM: 18, straightnessSdM: 0.1 });
      twin.trees.push(...Array.from({ length: 6 }, (_, i) => tree(8 + 3 * i, ac, 5 + k)));
    }
    const { rows, excluded, components } = reliableRows(twin);
    expect(rows.map(r => r.id)).toEqual([1, 2, 3, 4]);
    expect(components.length).toBe(2);
    expect(components.find(c => c.chosen)!.rows).toEqual([1, 2, 3, 4]);
    expect(components.find(c => !c.chosen)).toMatchObject({ rows: [5, 6, 7], trees: 18, separatedBy: "gap" });
    expect(excluded.filter(x => /another block of 3 rows/.test(x.reason)).map(x => x.id)).toEqual([5, 6, 7]);
    const r = inferBoundary(twin, rasterOf(twin, measures(0.5)))!;
    expect(Math.max(...r.ringField.map(p => p[1]))).toBeLessThan(30);
    expect(r.failureModes.some(f => f.code === "ADJACENT_CULTIVATED_BLOCK_DETECTED" && /another block of 3 rows/.test(f.detail))).toBe(true);
    expect(r.failureModes.some(f => f.code === "MULTIPLE_COMPETING_BLOCKS")).toBe(false);
    expect(r.components.length).toBe(2);
  });

  it("splits two groups of rows two pitches apart when the ground between is a track, and merges them when it is soil", () => {
    const twin = baseTwin();
    for (const [k, ac] of [30, 35].entries()) {
      twin.rows.push({ id: 5 + k, kept: true, reason: null, line: [at(6.5, ac), at(48.5, ac)], trees: 14, inferred: 0, photos: 2, lengthM: 42, straightnessSdM: 0.1 });
      twin.trees.push(...Array.from({ length: 14 }, (_, i) => tree(8 + 3 * i, ac, 5 + k)));
    }
    const soil = rasterOf(twin, measures(0.5));
    expect(reliableRows(twin, soil).rows.map(r => r.id)).toEqual([1, 2, 3, 4, 5, 6]);
    const track = rasterOf(twin, measures(0.5, (_al, ac) => (ac >= 23.5 && ac <= 26.5 ? { cover: 0, luma: 170, sat: 0.25 } : null)));
    const { rows, components } = reliableRows(twin, track);
    expect(rows.map(r => r.id)).toEqual([1, 2, 3, 4]);
    expect(components.find(c => !c.chosen)).toMatchObject({ rows: [5, 6], separatedBy: "ground" });
    const r = inferBoundary(twin, track)!;
    expect(Math.max(...r.ringField.map(p => p[1]))).toBeLessThan(24);
    expect(r.failureModes.some(f => f.code === "ADJACENT_CULTIVATED_BLOCK_DETECTED")).toBe(true);
  });

  it("measures the image coverage from the footprints: by any photograph and by two or more", () => {
    const twin = baseTwin();
    const c = imageCoverage(twin);
    expect(c.anyView).not.toBeNull(); expect(c.twoPlusViews).not.toBeNull();
    expect(c.areaM2).toBeGreaterThan(100 * 50 * 0.95); expect(c.areaM2).toBeLessThan(100 * 50 * 1.05);
    expect(c.twoPlusAreaM2).toBeGreaterThan(10 * 50 * 0.8); expect(c.twoPlusAreaM2).toBeLessThan(10 * 50 * 1.2);
    expect(c.anyView!.areaM2).toBeGreaterThan(100 * 50 * 0.9);
    expect(c.meanViews).toBeGreaterThan(1); expect(c.meanViews).toBeLessThan(1.2);
    expect(viewsAt(c, 30, 10)).toBe(2); expect(viewsAt(c, 0, 10)).toBe(1); expect(viewsAt(c, 200, 0)).toBe(0);
    expect(imageCoverage({ ...twin, footprints: [] }).anyView).toBeNull();
  });

  it("scores every vertex and the whole boundary, conservatively, deterministically, with the stability ensemble", () => {
    const twin = baseTwin();
    const foreign = Array.from({ length: 14 }, (_, i) => tree(8 + 3 * i, 26, null));
    twin.trees.push(...foreign);
    const m = measures(0.25, (al, ac) => (al >= 55 ? { cover: 1 } : ac <= 1 ? { cover: 0, luma: 170, sat: 0.25 } : ac >= 32 ? { unseen: true } : null));
    const raster = rasterOf(twin, m);
    const r = inferBoundary(twin, raster)!, again = inferBoundary(twin, raster)!;
    expect(r.ringField).toEqual(again.ringField);
    expect(r.confidence).toEqual(again.confidence);
    expect(r.stability!.variants).toBe(STABILITY_VARIANTS.length);
    expect(r.stability!.perVertexShiftM.length).toBe(r.vertices.length);
    for (const v of r.vertices) { expect(v.confidence).toBeGreaterThanOrEqual(0); expect(v.confidence).toBeLessThanOrEqual(1); expect(v.scores).not.toBeNull(); }
    const seen = r.vertices.filter(v => v.support === "photographs"), capped = r.vertices.filter(v => v.support === "cap");
    expect(seen.length).toBeGreaterThan(0); expect(capped.length).toBeGreaterThan(0);
    expect(Math.min(...seen.map(v => v.scores!.e))).toBeGreaterThan(Math.max(...capped.map(v => v.scores!.e)));
    expect(r.confidence.overall).toBeLessThanOrEqual(r.confidence.mean + 1e-9);
    expect(r.confidence.review).toBe(r.confidence.level !== "high");
    expect(r.stats.lengthBySupport.photographs + r.stats.lengthBySupport.cap + r.stats.lengthBySupport.bridged + r.stats.lengthBySupport.coverage + r.stats.lengthBySupport.default).toBeCloseTo(1, 6);
    // Without photographs: the code says so, and the stability ensemble still runs (the default margins vary).
    const dry = inferBoundary(twin)!;
    expect(dry.failureModes.map(f => f.code)).toContain("NO_PHOTOGRAPHS");
    expect(dry.stability!.areaMaxM2).toBeGreaterThan(dry.stability!.areaMinM2);
    expect(inferBoundary(twin, raster, { ensemble: false })!.stability).toBeNull();
  });

  it("codes the end of the photographs, and runs the whole pass from measurements as the build does", () => {
    const twin = baseTwin();
    const m = measures(0.25, (_al, ac) => (ac >= 23 ? { unseen: true } : null));
    const { result, raster, classifyMs, treesInCover: n } = inferBoundaryFromMeasures(twin, m);
    expect(result).not.toBeNull();
    expect(raster.cellM).toBe(0.25);
    expect(classifyMs).toBeGreaterThanOrEqual(0);
    expect(n).toBe(0);
    expect(result!.failureModes.filter(f => f.code === "BOUNDARY_EXTENDS_BEYOND_IMAGE_COVERAGE").length).toBe(1); // merged, not repeated
    expect(result!.excludedTrees).toEqual({ inCover: [], trimmed: [] });
  });

  it("carries the confidence, the codes, the coverage and the stability in the record, and still parses a record without them", () => {
    const twin = baseTwin();
    const r = inferBoundary(twin, rasterOf(twin, measures(0.5, wheatEast)))!;
    const record = toTwinBoundary(r, localFrame(twin), null);
    expect(record.cultivated.confidence).toEqual(r.confidence);
    expect(record.cultivated.failureModes).toEqual(r.failureModes);
    expect(record.cultivated.vertices.every(v => typeof v.confidence === "number")).toBe(true);
    expect(record.coverage!.anyView!.ring.length).toBeGreaterThan(3);
    expect(record.coverage!.areaM2).toBe(Math.round(r.coverage.areaM2));
    expect(record.stability!.variants).toBe(STABILITY_VARIANTS.length);
    expect(parseTwin({ ...twin, boundary: record }).ok).toBe(true);
    const old = { ...record, cultivated: { ...record.cultivated, confidence: undefined, failureModes: undefined, components: undefined, vertices: record.cultivated.vertices.map(v => ({ ...v, confidence: undefined })) }, coverage: undefined, stability: undefined };
    expect(parseTwin({ ...twin, boundary: JSON.parse(JSON.stringify(old)) }).ok).toBe(true);
    expect(buildScene({ ...twin, boundary: JSON.parse(JSON.stringify(old)) }).boundary?.n).toBe(record.cultivated.ring.length);
  });
});

describe("geometry helpers", () => {
  it("simplifies a ring to its corners and closes a grid of trees into one shape", () => {
    const rect: [number, number][] = [];
    for (let x = 0; x <= 10; x++) rect.push([x, 0]);
    for (let y = 1; y <= 5; y++) rect.push([10, y]);
    for (let x = 9; x >= 0; x--) rect.push([x, 5]);
    for (let y = 4; y >= 1; y--) rect.push([0, y]);
    const keep = simplifyRing(rect, 0.1);
    expect(keep.length).toBe(4);
    const trees: [number, number][] = [];
    for (let x = 0; x < 30; x += 3) for (let y = 0; y < 20; y += 5) trees.push([x, y]);
    const c = concaveBaseline(trees, 3)!;
    expect(c).not.toBeNull();
    expect(c.areaM2).toBeGreaterThan(27 * 15 * 0.8); expect(c.areaM2).toBeLessThan((27 + 6) * (15 + 6));
    expect(concaveBaseline([[0, 0]], 3)).toBeNull();
  });
});
