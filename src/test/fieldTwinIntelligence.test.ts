import { describe, expect, it } from "vitest";
import { chainEdges, fieldIntelligence, localFrame, orchardBlock, pointInRing, pressureClass, pressureGrid, roundCorners, scoutingZones, weedClusters } from "@/lib/fieldTwin/intelligence";
import { GridIndex, buildScene, detailFor, metresPerPixel, toWorld, zoomForSize } from "@/lib/fieldTwin/scene";
import { FIELD_TWIN_FORMAT, type TwinBundle, type TwinWeed } from "@/lib/fieldTwin/types";

// A small orchard: rows running east, 5 m apart, trees 3 m apart; photographs covering 60 x 40 m; weeds placed by hand.
const LAT = 33.88, LNG = -5.42, mLat = 111_320, mLng = 111_320 * Math.cos((LAT * Math.PI) / 180);
const at = (e: number, n: number): [number, number] => [LAT + n / mLat, LNG + e / mLng];
const weed = (id: number, e: number, n: number, over: Partial<TwinWeed> = {}): TwinWeed => ({
  id, lat: at(e, n)[0], lng: at(e, n)[1], status: "verified", rowStatus: "between rows", diameterM: 0.3, areaM2: 0.07, spanM: null, heightM: null,
  seenBy: 3, coveredBy: 3, viewSpreadM: 0.04, sizeCv: 0.1, score: 0.7, treeId: null, ring: [at(e - 0.15, n - 0.15), at(e + 0.15, n - 0.15), at(e, n + 0.15)], evidence: [], ...over,
});
const twin: TwinBundle = {
  format: FIELD_TWIN_FORMAT, id: "t", name: "t", builtAt: "", source: { photographs: 2, camera: "", capturedAt: null, groundPixelCm: 1, method: "", weedModel: "", treeModel: "" },
  origin: { lat: LAT, lng: LNG }, bounds: [at(-5, -5), at(60, 40)], field: { rowDirectionDeg: 0, rowSpacingM: 5, plantSpacingM: 3 },
  footprints: [{ photo: "a", ring: [at(0, 0), at(40, 0), at(40, 40), at(0, 40)] }, { photo: "b", ring: [at(20, 0), at(60, 0), at(60, 40), at(20, 40)] }],
  rows: [1, 2, 3].map(k => ({ id: k, kept: true, reason: null, line: [at(5, 5 * k + 5), at(50, 5 * k + 5)], trees: 15, inferred: 0, photos: 2, lengthM: 45, straightnessSdM: 0.1 })),
  trees: [1, 2, 3].flatMap(k => [0, 1, 2, 3].map(i => ({ id: k * 10 + i, lat: at(8 + 3 * i, 5 * k + 5)[0], lng: at(8 + 3 * i, 5 * k + 5)[1], crownRadiusM: 1, heightM: 1, seenBy: 2, coveredBy: 2, viewSpreadM: 0.05, sizeCv: 0.05, rowId: k, evidence: [] }))),
  inferredTrees: [],
  // A dense patch of 12 weeds around (30, 12) and one lonely weed at (10, 32), one single-view, one on a tree.
  weeds: [
    ...Array.from({ length: 12 }, (_, i) => weed(100 + i, 29 + (i % 4) * 0.6, 12.2 + Math.floor(i / 4) * 0.6)),
    weed(200, 10, 32), weed(201, 11, 32, { status: "single view", seenBy: 1 }), weed(202, 8, 10, { status: "on a tree", treeId: 10 }),
  ],
  vegetation: [], atlases: [], stats: {},
};

describe("field frame and block", () => {
  it("converts between local metres and the field's along/across frame both ways", () => {
    const f = localFrame({ ...twin, field: { ...twin.field, rowDirectionDeg: 30 } });
    const [e, n] = f.fromField(10, 4);
    const [al, ac] = f.toField(e, n);
    expect(al).toBeCloseTo(10, 9); expect(ac).toBeCloseTo(4, 9);
    const [lat, lng] = f.toLatLng(e, n);
    const back = f.toLocal(lat, lng);
    expect(back[0]).toBeCloseTo(e, 6); expect(back[1]).toBeCloseTo(n, 6);
  });

  it("the orchard block follows the kept rows half a spacing beyond them", () => {
    const b = orchardBlock(twin)!;
    expect(b.length).toBe(12);
    const es = b.map(p => p[0]), ns = b.map(p => p[1]);
    expect(Math.min(...es)).toBeCloseTo(3.5, 6); expect(Math.max(...es)).toBeCloseTo(51.5, 6);
    expect(Math.min(...ns)).toBeCloseTo(7.5, 6); expect(Math.max(...ns)).toBeCloseTo(22.5, 6);
    expect(pointInRing(30, 15, b)).toBe(true);
    expect(pointInRing(30, 30, b)).toBe(false);
    expect(orchardBlock({ ...twin, rows: [] })).toBeNull();
  });
});

describe("weed pressure", () => {
  it("bands percent cover, fixed, not by quantile", () => {
    expect(pressureClass(0)).toBe("none"); expect(pressureClass(0.2)).toBe("trace"); expect(pressureClass(1)).toBe("low"); expect(pressureClass(2)).toBe("moderate"); expect(pressureClass(10)).toBe("high");
  });

  it("cells follow the rows, count verified cover only, and know how many photographs saw them", () => {
    const g = pressureGrid(twin, 4);
    const dense = g.byIndex.get(`${Math.floor(29.9 / 4)},${Math.floor(12 / 4)}`)!;
    expect(dense.verified).toBe(12);
    expect(dense.coverM2).toBeCloseTo(12 * 0.07, 9);
    expect(dense.coverPct).toBeCloseTo((100 * 12 * 0.07) / 16, 9);
    expect(dense.cls).toBe("high");
    expect(dense.photos).toBe(2); // the overlap of a and b
    const lonely = g.byIndex.get(`${Math.floor(10 / 4)},${Math.floor(32 / 4)}`)!;
    expect(lonely.verified).toBe(1); expect(lonely.singleView).toBe(1); expect(lonely.photos).toBe(1); expect(lonely.inBlock).toBe(false);
    const onTreeCell = g.byIndex.get(`${Math.floor(8 / 4)},${Math.floor(10 / 4)}`)!;
    expect(onTreeCell.verified).toBe(0); // detections on crowns never count as pressure
    expect(g.cells.every(c => c.photos >= 1)).toBe(true);
    expect(g.cells.some(c => c.cls === "none")).toBe(true);
  });

  it("scouting zones are connected high-pressure cells with an outer edge, ranked by cover", () => {
    const g = pressureGrid(twin, 1);
    const zones = scoutingZones(g, 1.5, 3);
    expect(zones.length).toBe(1);
    expect(zones[0].id).toBe(1);
    expect(zones[0].weeds).toBe(12);
    expect(zones[0].edges.length).toBeGreaterThanOrEqual(4);
    expect(zones[0].meanCoverPct).toBeGreaterThan(1.5);
  });

  it("a zone's boundary chains into closed rings with rounded corners, and ranks carry a priority", () => {
    const g = pressureGrid(twin, 1);
    const zones = scoutingZones(g, 1.5, 3);
    const z = zones[0];
    expect(z.priority).toBe(1);
    expect(z.rings.length).toBeGreaterThanOrEqual(1);
    // Two corner-cutting passes turn every boundary vertex into four, and every ring point stays inside the zone's cells' hull.
    const raw = chainEdges(z.edges);
    expect(raw[0].length).toBeGreaterThanOrEqual(4);
    expect(roundCorners(raw[0], 2).length).toBe(4 * raw[0].length);
    const es = z.cells.flatMap(c => c.ring.map(p => p[0])), ns = z.cells.flatMap(c => c.ring.map(p => p[1]));
    for (const [e, n] of z.rings[0]) { expect(e).toBeGreaterThanOrEqual(Math.min(...es) - 1e-9); expect(e).toBeLessThanOrEqual(Math.max(...es) + 1e-9); expect(n).toBeGreaterThanOrEqual(Math.min(...ns) - 1e-9); expect(n).toBeLessThanOrEqual(Math.max(...ns) + 1e-9); }
    // Smoothed cover: a cell's smoothPct is the mean over its 3 x 3 neighbourhood of listed cells.
    const dense = g.byIndex.get(`${Math.floor(29.9)},${Math.floor(12.5)}`)!;
    expect(dense.smoothPct).toBeGreaterThan(0);
    expect(dense.smoothPct).toBeLessThanOrEqual(Math.max(...g.cells.map(c => c.coverPct)));
  });

  it("clusters group candidates on a row-aligned grid and keep their ids", () => {
    const cl = weedClusters(twin, 1.5);
    const big = cl.reduce((a, b) => (b.count > a.count ? b : a));
    expect(big.count).toBeGreaterThanOrEqual(4);
    expect(big.weedIds.every(id => id >= 100 && id < 112)).toBe(true);
    expect(cl.some(c => c.weedIds.includes(202))).toBe(false); // on-tree detections are not candidates
    expect(cl.reduce((s, c) => s + c.count, 0)).toBe(14);
  });

  it("summarises the field", () => {
    const fi = fieldIntelligence(twin, 4);
    expect(fi.summary.blockHa).toBeCloseTo((48 * 15) / 10_000, 6);
    expect(fi.summary.imageryHa).toBeCloseTo((60 * 40) / 10_000, 6);
    expect(fi.summary.cellsSingleCoverage).toBeGreaterThan(0);
    expect(fi.summary.medianWeedDiameterM).toBeCloseTo(0.3, 9);
  });
});

describe("scene", () => {
  it("projects to zoom-0 units and back to metres per pixel", () => {
    const [x, y] = toWorld(0, 0);
    expect(x).toBeCloseTo(128, 9); expect(y).toBeCloseTo(128, 9);
    expect(metresPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
    expect(zoomForSize(1, 10, 0)).toBeCloseTo(Math.log2(1565430.3), 6);
  });

  it("the grid index finds what a box holds and the nearest point", () => {
    const xs = [0, 1, 2, 10], ys = [0, 1, 2, 10];
    const g = new GridIndex(xs, ys, 1.5);
    expect(g.query(-0.5, -0.5, 1.2, 1.2).sort()).toEqual([0, 1]);
    expect(g.query(0, 0, 0.5, 0.5, 0.6).sort()).toEqual([0, 1]);
    expect(g.nearest(9.6, 9.6, 1)).toBe(3);
    expect(g.nearest(5, 5, 1)).toBe(-1);
  });

  it("builds every array and keeps the measured outlines", () => {
    const s = buildScene(twin);
    expect(s.weeds.n).toBe(15); expect(s.trees.n).toBe(12); expect(s.rows.n).toBe(3);
    expect(s.weeds.rings.off[1] - s.weeds.rings.off[0]).toBe(6);
    expect(s.block).not.toBeNull();
    expect(s.cells.n).toBe(s.intel.grid.cells.length);
    expect(s.zones.length).toBe(s.intel.zones.length);
  });

  it("detail follows rendered size: field when crowns are specks, row when crowns show, plant when a weed is drawable", () => {
    const s = buildScene(twin);
    const far = detailFor(0.5, s), mid = detailFor(0.12, s), near = detailFor(0.02, s);
    expect(far.level).toBe("field"); expect(far.pressure).toBe(1); expect(far.outlines).toBe(0); expect(far.clusters).toBe(0);
    expect(mid.level).toBe("row"); expect(mid.crowns).toBeGreaterThan(0.9); expect(mid.outlines).toBe(0); expect(mid.clusters).toBeGreaterThan(0.5);
    expect(near.level).toBe("plant"); expect(near.outlines).toBe(1); expect(near.clusters).toBe(0); expect(near.pressure).toBe(0);
    // Smooth: between row and plant the two blend, neither jumps.
    const between = detailFor(0.055, s);
    expect(between.outlines).toBeGreaterThan(0); expect(between.outlines).toBeLessThan(1);
    expect(between.clusters).toBeGreaterThan(0); expect(between.clusters).toBeLessThan(1);
  });
});
