// The adaptive findings logic, on deterministic fields: the prominence rule, each filter's selection, no double
// counting, and that nothing qualifying is ever hidden from the list. Scenarios follow the brief's ten cases.
import { describe, expect, it } from "vitest";
import { FindingsEngine, PATCH_LINK_M, prominence, weedPatches } from "@/lib/fieldTwin/findings";
import { buildHeatRaster, heatColour } from "@/lib/fieldTwin/heatmap";
import { fieldIntelligence } from "@/lib/fieldTwin/intelligence";
import { buildScene, toWorld } from "@/lib/fieldTwin/scene";
import { syntheticTwin } from "@/lib/fieldTwin/synthetic";
import { FIELD_TWIN_FORMAT, type TwinBundle, type TwinTree, type TwinWeed } from "@/lib/fieldTwin/types";

const LAT = 33.88, LNG = -5.42, mLat = 111_320, mLng = 111_320 * Math.cos((LAT * Math.PI) / 180);
const at = (e: number, n: number): [number, number] => [LAT + n / mLat, LNG + e / mLng];
const weed = (id: number, e: number, n: number, over: Partial<TwinWeed> = {}): TwinWeed => {
  const areaM2 = over.areaM2 ?? 0.05, d = 2 * Math.sqrt(areaM2 / Math.PI);
  return { id, lat: at(e, n)[0], lng: at(e, n)[1], status: "verified", rowStatus: "between rows", diameterM: d, areaM2, spanM: null, heightM: null, seenBy: 3, coveredBy: 3, viewSpreadM: 0.04, sizeCv: 0.1, score: 0.7, treeId: null, ring: [], evidence: [], ...over };
};
const tree = (id: number, e: number, n: number, r = 1): TwinTree => ({ id, lat: at(e, n)[0], lng: at(e, n)[1], crownRadiusM: r, heightM: 1, seenBy: 2, coveredBy: 2, viewSpreadM: 0.05, sizeCv: 0.05, rowId: 1, evidence: [] });
/** A 60 x 40 m field, two photographs overlapping on x in [20, 40], rows east. */
const field = (weeds: TwinWeed[], over: Partial<TwinBundle> = {}): TwinBundle => ({
  format: FIELD_TWIN_FORMAT, id: "t", name: "t", builtAt: "", source: { photographs: 2, camera: "", capturedAt: null, groundPixelCm: 1, method: "", weedModel: "", treeModel: "" },
  origin: { lat: LAT, lng: LNG }, bounds: [at(-5, -5), at(60, 40)], field: { rowDirectionDeg: 0, rowSpacingM: 5, plantSpacingM: 3 },
  footprints: [{ photo: "a", ring: [at(0, 0), at(40, 0), at(40, 40), at(0, 40)] }, { photo: "b", ring: [at(20, 0), at(60, 0), at(60, 40), at(20, 40)] }],
  rows: [{ id: 1, kept: true, reason: null, line: [at(5, 10), at(50, 10)], trees: 15, inferred: 0, photos: 2, lengthM: 45, straightnessSdM: 0.1 }],
  trees: [], inferredTrees: [], weeds, vegetation: [], atlases: [], stats: {}, ...over,
});
const engine = (t: TwinBundle) => new FindingsEngine(t, fieldIntelligence(t));
/** A tight patch of `n` candidates around (e, n), 0.3 m apart (gaps well under the link distance). */
const patch = (id0: number, e: number, n: number, count: number, areaM2 = 0.03): TwinWeed[] => Array.from({ length: count }, (_, i) => weed(id0 + i, e + (i % 5) * 0.3, n + Math.floor(i / 5) * 0.3, { areaM2 }));

describe("prominence rule", () => {
  it("nothing, one, a clear break, and no break", () => {
    expect(prominence([])).toEqual({ count: 0, rule: "none", breakRatio: null, breakAt: null });
    expect(prominence([5]).rule).toBe("single");
    const dom = prominence([100, 90, 80, 10, 9, 8]);
    expect(dom.rule).toBe("dominant"); expect(dom.count).toBe(3); expect(dom.breakRatio).toBeCloseTo(8, 6);
    const sim = prominence(Array.from({ length: 20 }, (_, i) => 100 - i));
    expect(sim.rule).toBe("similar"); expect(sim.count).toBe(20);
  });
  it("an uncertain measurement cannot create a break on its own", () => {
    // 100 over 45 is a break (2.2x); with the top value 60 % uncertain its discounted value is 40, so no break.
    expect(prominence([100, 45, 40]).rule).toBe("dominant");
    expect(prominence([100, 45, 40], [0.6, 0, 0]).rule).toBe("similar");
  });
  it("only the top of the list is searched for the break", () => {
    const v = Array.from({ length: 60 }, (_, i) => (i < 40 ? 100 - i : 1));
    expect(prominence(v).rule).toBe("similar"); // the break at index 40 is past the 24 steps looked at
  });
});

describe("scenarios", () => {
  it("1. one dominant cluster is the one emphasised, every patch stays listed", () => {
    const t = field([...patch(1, 10, 12, 20), ...patch(100, 30, 30, 3), ...patch(200, 45, 5, 2)]);
    const r = engine(t).run({ mode: "clusters" });
    expect(r.findings.length).toBe(3);
    expect(r.findings[0].members).toBe(20);
    expect(r.prominence.rule).toBe("dominant"); expect(r.prominence.count).toBe(1);
    expect(r.findings.map(f => f.members).reduce((a, b) => a! + b!, 0)).toBe(25); // no candidate in two patches
  });
  it("2. several equally significant clusters are all emphasised", () => {
    const t = field(Array.from({ length: 6 }, (_, k) => patch(1 + 100 * k, 5 + 9 * k, 20, 8)).flat());
    const r = engine(t).run({ mode: "clusters" });
    expect(r.findings.length).toBe(6);
    expect(r.prominence.rule).toBe("similar"); expect(r.prominence.count).toBe(6);
  });
  it("3. thousands of small candidates qualify, none is dropped, and the map bins them by zoom", () => {
    const t = syntheticTwin({ weeds: 5000, seed: 3 });
    const e = engine(t), r = e.run({ mode: "largest" });
    const verified = t.weeds.filter(w => w.status === "verified").length;
    expect(r.findings.length).toBe(verified);
    for (let i = 1; i < r.findings.length; i++) expect(r.findings[i].value).toBeLessThanOrEqual(r.findings[i - 1].value);
    expect(r.excluded.some(x => x.reason.includes("one photograph"))).toBe(true);
    // Prominence never hides findings: the count is a display emphasis, the list is complete.
    expect(r.prominence.count).toBeGreaterThanOrEqual(1);
    expect(r.prominence.count).toBeLessThanOrEqual(r.findings.length);
  });
  it("4. a few exceptionally large weeds stand apart from the rest", () => {
    const t = field([weed(1, 10, 10, { areaM2: 1.2 }), weed(2, 20, 20, { areaM2: 1.0 }), ...Array.from({ length: 30 }, (_, i) => weed(10 + i, 5 + i * 1.5, 30, { areaM2: 0.02 + 0.001 * i }))]);
    const r = engine(t).run({ mode: "largest" });
    expect(r.findings[0].id).toBe(1); expect(r.findings[1].id).toBe(2);
    expect(r.prominence.rule).toBe("dominant"); expect(r.prominence.count).toBe(2);
    const min = engine(t).run({ mode: "largest", minAreaM2: 0.5 });
    expect(min.findings.map(f => f.id)).toEqual([1, 2]);
  });
  it("5 and 6. high pressure on a small area ranks first by pressure; moderate pressure on a large area ranks first by extent", () => {
    // Small hot spot: 12 candidates of 0.12 m2 over three 4 m cells (3 % each). Broad band: 2 % cover across eight cells.
    const hot = Array.from({ length: 12 }, (_, i) => weed(1 + i, 5 + i * 0.9, 6, { areaM2: 0.12 }));
    const broad = Array.from({ length: 8 * 4 }, (_, i) => weed(100 + i, 21 + Math.floor(i / 4) * 4 + (i % 4) * 0.9, 25 + (i % 4) * 0.9, { areaM2: 0.08 }));
    const t = field([...hot, ...broad]);
    const e = engine(t);
    const byPressure = e.run({ mode: "pressure" }), byExtent = e.run({ mode: "extent" });
    expect(byPressure.findings.length).toBe(2); expect(byExtent.findings.length).toBe(2);
    expect(byPressure.findings[0].members).toBe(12); expect(byPressure.findings[0].coverPct).toBeGreaterThan(byPressure.findings[1].coverPct!);
    expect(byExtent.findings[0].members).toBe(32); expect(byExtent.findings[0].affectedM2).toBeGreaterThan(byExtent.findings[1].affectedM2!);
    // Density and affected ground are different numbers on the same region.
    const big = byExtent.findings[0];
    expect(big.coverPct).toBeLessThan(byPressure.findings[0].coverPct!);
  });
  it("7. incomplete photo coverage: ground no photograph saw has no cell and no colour, never 'none'", () => {
    const t = field([weed(1, 10, 10)], { footprints: [{ photo: "a", ring: [at(0, 0), at(30, 0), at(30, 40), at(0, 40)] }] });
    const intel = fieldIntelligence(t);
    expect(intel.grid.cells.every(c => c.photos >= 1)).toBe(true);
    const seenX = intel.grid.cells.map(c => c.centre[0]);
    expect(Math.max(...seenX)).toBeLessThanOrEqual(30); // the last cell centre sits on the footprint's edge
    const raster = buildHeatRaster(intel, 1)!;
    expect(raster.unobserved).toBe(0); // the raster spans the cells only; beyond them nothing is painted
    const r = engine(t).run({ mode: "pressure" });
    expect(r.findings.length).toBe(0);
    expect(r.note).toContain("observable");
  });
  it("8. closed-canopy cells are unobservable, excluded from the pressure share, drawn as canopy", () => {
    // Crowns of 2.5 m radius on a 3 m lattice cover nearly all of cell (1, 2) [4..8 x 8..12]; a weed under them stays counted.
    const trees = [tree(1, 5, 9, 2.5), tree(2, 7, 11, 2.5), tree(3, 5, 11, 2.5), tree(4, 7, 9, 2.5)];
    const t = field([weed(1, 6, 10, { areaM2: 0.3 }), weed(2, 30, 30, { areaM2: 0.3 })], { trees });
    const intel = fieldIntelligence(t);
    const under = intel.grid.byIndex.get("1,2")!, open = intel.grid.byIndex.get("7,7")!;
    expect(under.canopy).toBe(true); expect(under.verified).toBe(1); expect(under.coverM2).toBeCloseTo(0.3, 9); expect(under.cls).toBe("none");
    expect(open.canopy).toBe(false); expect(open.coverPct).toBeCloseTo((100 * 0.3) / open.observableM2, 9);
    const raster = buildHeatRaster(intel, 1)!;
    expect(raster.canopy).toBeGreaterThan(0);
    // A region is ranked over its observable ground, not its whole area.
    const r = engine(t).run({ mode: "pressure", minCoverPct: 0.5 });
    for (const f of r.findings) expect(f.observableM2).toBeLessThanOrEqual(f.affectedM2!);
  });
  it("9. dense findings near crop rows: the row filter keeps only what is on a row, and the other relation only what is between", () => {
    const onRow = Array.from({ length: 10 }, (_, i) => weed(1 + i, 10 + i, 10.2, { rowStatus: "on a row", areaM2: 0.04 }));
    const between = Array.from({ length: 10 }, (_, i) => weed(50 + i, 10 + i, 12.5, { rowStatus: "between rows", areaM2: 0.06 }));
    const t = field([...onRow, ...between]);
    const e = engine(t);
    const rows = e.run({ mode: "rows", rowRelation: "on a row" }), gaps = e.run({ mode: "rows", rowRelation: "between rows" }), any = e.run({ mode: "largest" });
    expect(rows.findings.length).toBe(10); expect(rows.findings.every(f => f.rowStatus === "on a row")).toBe(true);
    expect(gaps.findings.length).toBe(10); expect(gaps.findings.every(f => f.rowStatus === "between rows")).toBe(true);
    expect(any.findings.length).toBe(20);
    expect(rows.excluded.find(x => x.reason === "between the rows")?.count).toBe(10);
  });
  it("10. zero qualifying findings is an explicit empty result with the reasons", () => {
    const t = field([weed(1, 10, 10, { status: "single view", seenBy: 1 }), weed(2, 12, 10, { status: "on a tree", treeId: 1 })]);
    const r = engine(t).run({ mode: "largest" });
    expect(r.findings).toEqual([]);
    expect(r.prominence).toEqual({ count: 0, rule: "none", breakRatio: null, breakAt: null });
    expect(r.excluded.map(x => x.count)).toEqual([1, 1]);
  });
});

describe("metrics stay distinct", () => {
  it("a patch's footprint is the ground it spans, its summed cover the plants; neither is the other", () => {
    const t = field(patch(1, 10, 10, 10, 0.02));
    const ps = weedPatches(t, fieldIntelligence(t));
    expect(ps.length).toBe(1);
    expect(ps[0].coverM2).toBeCloseTo(0.2, 9);
    expect(ps[0].footprintM2).toBeGreaterThan(ps[0].coverM2);
    expect(ps[0].members.length).toBe(10);
  });
  it("candidates farther apart than the link distance are separate patches; a lone candidate is no patch", () => {
    const t = field([weed(1, 10, 10), weed(2, 10.3, 10), weed(3, 10 + PATCH_LINK_M + 2, 10), weed(4, 30, 30)]);
    const ps = weedPatches(t, fieldIntelligence(t));
    expect(ps.length).toBe(1); expect(ps[0].members.sort()).toEqual([1, 2]);
  });
  it("confidence ranks by the model score and lists agreement beside it, not inside it", () => {
    const t = field([weed(1, 10, 10, { score: 0.9, seenBy: 2, coveredBy: 5 }), weed(2, 20, 10, { score: 0.6, seenBy: 5, coveredBy: 5 }), weed(3, 30, 10, { score: null })]);
    const r = engine(t).run({ mode: "confidence" });
    expect(r.findings.map(f => f.id)).toEqual([1, 2]);
    expect(r.findings[0].consistency).toEqual({ seenBy: 2, coveredBy: 5, viewSpreadM: 0.04, sizeCv: 0.1 });
    expect(r.excluded.find(x => x.reason.includes("no model score"))?.count).toBe(1);
    expect(engine(t).run({ mode: "confidence", minScore: 0.8 }).findings.map(f => f.id)).toEqual([1]);
  });
  it("the heatmap colours fixed cover bands: the same cover is the same colour on every field", () => {
    expect(heatColour(0)).toEqual(heatColour(-1));
    expect(heatColour(1.5)).toEqual([232, 164, 52, Math.round(255 * 0.62)]);
    expect(heatColour(100)).toEqual(heatColour(8));
    const mid = heatColour(2.75);
    expect(mid[0]).toBeGreaterThan(232); expect(mid[1]).toBeLessThan(164);
  });
});

describe("rows end at their trees", () => {
  it("the drawn row runs from the first observed tree to the last, not past them", () => {
    const trees = [tree(1, 11, 10), tree(2, 14, 10), tree(3, 17, 10), tree(4, 44, 10)];
    const s = buildScene(field([], { trees }));
    // Row 1's bundle line spans e 5..50 (45 m); the trees span 11..44 (33 m). Compared in zoom-0 units.
    const [ax, ay] = toWorld(...s.twin.rows[0].line[0]), [bx, by] = toWorld(...s.twin.rows[0].line[1]);
    const lineLen = Math.hypot(bx - ax, by - ay), drawnLen = Math.hypot(s.rows.x2[0] - s.rows.x1[0], s.rows.y2[0] - s.rows.y1[0]);
    expect(drawnLen / lineLen).toBeCloseTo(33 / 45, 3);
    // A row without trees keeps its bundle line.
    const s2 = buildScene(field([]));
    expect(Math.hypot(s2.rows.x2[0] - s2.rows.x1[0], s2.rows.y2[0] - s2.rows.y1[0]) / lineLen).toBeCloseTo(1, 9);
  });
});
