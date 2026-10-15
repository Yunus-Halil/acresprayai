// @vitest-environment node
// Unique plants into review areas: the metre grid, connectivity, what seeds an area, what is kept aside, the ranking and its reasons.
import { describe, expect, it } from "vitest";
import { fromEnu } from "@/lib/sourceFrames/odm";
import type { GroundPlant } from "@/lib/weedVision/frames";
import { DEFAULT_HOTSPOT_PARAMS, buildHotspots, convexHull, summaryLine } from "@/lib/weedVision/hotspots";
import type { RowStatus } from "@/lib/weedVision/rowFilter";

const REF = { lat: 54.1726, lng: 12.3062, altM: 40 };
const ALT = 40;

/** A weed at local metres (x, y). */
function weed(id: string, x: number, y: number, opts: Partial<{ score: number; rowStatus: RowStatus; areaM2: number | null; duplicates: number; seenIn: string[]; klass: "weed" | "crop" }> = {}): GroundPlant {
  const g = fromEnu([x, y, 0], REF);
  const areaM2 = opts.areaM2 === undefined ? 0.01 : opts.areaM2;
  return {
    id, frame: opts.seenIn?.[0] ?? "A.JPG", instanceId: 1, klass: opts.klass ?? "weed", score: opts.score ?? 0.6, scoreKind: "detector_confidence",
    nativePolygon: [], nativeCentroid: [0, 0], nativeBbox: [0, 0, 1, 1], areaPx: 100, equivalentDiameterPx: 11,
    ring: null, centre: { lat: g.lat, lng: g.lng }, gsdM: areaM2 == null ? null : 0.01, areaM2, diameterM: areaM2 == null ? null : 0.11,
    viewAngleDeg: 5, status: "ok", flags: [], tiny: false, touchesBorder: false, fusedFromTiles: 1, rowStatus: opts.rowStatus ?? "off-row",
    seenIn: opts.seenIn ?? ["A.JPG"], duplicates: opts.duplicates ?? 0,
  };
}

describe("buildHotspots", () => {
  it("groups weeds in touching occupied cells into one area and keeps a lone weed isolated", () => {
    const plants = [
      weed("a", 1, 1), weed("b", 1.5, 1.2), // cell (0,0): two weeds -> occupied
      weed("c", 2.5, 1), weed("d", 2.7, 1.5), // cell (1,0): occupied, touches (0,0)
      weed("e", 20, 20), // alone
    ];
    const r = buildHotspots(REF, ALT, plants);
    expect(r.hotspots).toHaveLength(1);
    const h = r.hotspots[0];
    expect(h.plants).toBe(4);
    expect(h.areaM2).toBe(8); // two 2 m cells
    expect(h.cellRings).toHaveLength(2);
    expect(h.ring.length).toBeGreaterThanOrEqual(4);
    expect(h.plantIds.sort()).toEqual(["a", "b", "c", "d"]);
    expect(r.isolated.map(p => p.id)).toEqual(["e"]);
    expect(r.cells).toHaveLength(3);
    expect(r.summary).toMatchObject({ areas: 1, isolated: 1, uniqueWeeds: 5 });
    expect(h.rank).toBe(1);
  });

  it("does not let weeds on crop plants or row lines start an area, but counts them inside one for review", () => {
    const onRow = [weed("t1", 1, 1, { rowStatus: "on-crop" }), weed("t2", 1.5, 1, { rowStatus: "on-row" }), weed("t3", 1.2, 1.4, { rowStatus: "on-crop" })];
    expect(buildHotspots(REF, ALT, onRow).hotspots).toHaveLength(0);
    const mixed = [...onRow, weed("w1", 1.1, 1.1), weed("w2", 1.3, 1.3)];
    const r = buildHotspots(REF, ALT, mixed);
    expect(r.hotspots).toHaveLength(1);
    expect(r.hotspots[0].plants).toBe(2);
    expect(r.hotspots[0].onRow).toBe(3);
    expect(r.hotspots[0].reasons.some(s => s.includes("classification to review"))).toBe(true);
    expect(r.summary.classificationToReview).toBe(1);
  });

  it("counts observations separately from unique plants, and leaves covered canopy null when a plant has no sampling", () => {
    const r = buildHotspots(REF, ALT, [weed("a", 1, 1, { duplicates: 2, seenIn: ["A.JPG", "B.JPG", "C.JPG"] }), weed("b", 1.2, 1.2, { areaM2: null })]);
    expect(r.hotspots).toHaveLength(1);
    expect(r.hotspots[0].plants).toBe(2);
    expect(r.hotspots[0].observations).toBe(4);
    expect(r.hotspots[0].coveredM2).toBeNull();
    expect(r.hotspots[0].frames).toEqual(["A.JPG", "B.JPG", "C.JPG"]);
    expect(r.summary.observations).toBe(4);
  });

  it("ranks the denser, larger area first and explains why; low confidence is a reason to look, not to drop", () => {
    const dense = Array.from({ length: 8 }, (_, i) => weed(`d${i}`, 1 + (i % 4) * 0.3, 1 + Math.floor(i / 4) * 0.3, { areaM2: 0.05 }));
    const sparse = [weed("s1", 31, 31, { score: 0.15 }), weed("s2", 31.5, 31.5, { score: 0.2 })]; // well inside one cell, off any cell edge
    const r = buildHotspots(REF, ALT, [...sparse, ...dense]);
    expect(r.hotspots).toHaveLength(2);
    expect(r.hotspots[0].plantIds).toContain("d0");
    expect(r.hotspots[0].priority).toBeGreaterThan(r.hotspots[1].priority);
    expect(r.hotspots[0].reasons.some(s => /concentrated/.test(s))).toBe(true);
    expect(r.hotspots[0].reasons.some(s => /between the crop rows/.test(s))).toBe(true);
    expect(r.hotspots[1].reasons.some(s => /under 0.3 confidence/.test(s))).toBe(true);
    expect(r.hotspots[1].confidence.low).toBe(2);
    expect(r.hotspots[1].rank).toBe(2);
  });

  it("falls back without rows: the off-row signal is skipped and the reasons say so", () => {
    const r = buildHotspots(REF, ALT, [weed("a", 1, 1, { rowStatus: "no-rows" }), weed("b", 1.2, 1.2, { rowStatus: "no-rows" })]);
    expect(r.hotspots[0].rowReliable).toBe(false);
    expect(r.hotspots[0].signals.offRow).toBe(0);
    expect(r.hotspots[0].reasons.some(s => /no row read/.test(s))).toBe(true);
    expect(r.summary.rowReadShare).toBe(0);
    expect(r.summary.concentratedOffRow).toBe(0);
  });

  it("keeps an area's id while its centre stays put, and ignores crop plants", () => {
    const base = [weed("a", 1, 1), weed("b", 1.2, 1.2), weed("c", 5, 5, { klass: "crop" })];
    const r1 = buildHotspots(REF, ALT, base);
    const r2 = buildHotspots(REF, ALT, [...base, weed("d", 1.4, 1.1)]);
    expect(r1.hotspots[0].id).toBe(r2.hotspots[0].id);
    expect(r1.hotspots[0].id).toMatch(/^hotspots-v1:/);
    expect(r1.summary.uniqueWeeds).toBe(2);
  });

  it("respects the occupancy thresholds and the params", () => {
    const one = buildHotspots(REF, ALT, [weed("a", 1, 1, { areaM2: 0.005 })]);
    expect(one.hotspots).toHaveLength(0);
    const canopy = buildHotspots(REF, ALT, [weed("a", 1, 1, { areaM2: 0.5 })]); // one big plant passes minCoveredM2
    expect(canopy.hotspots).toHaveLength(1);
    const strict = buildHotspots(REF, ALT, [weed("a", 1, 1, { areaM2: 0.5 })], { ...DEFAULT_HOTSPOT_PARAMS, minCoveredM2: 1 });
    expect(strict.hotspots).toHaveLength(0);
  });

  it("hull and summary helpers", () => {
    expect(convexHull([[0, 0], [2, 0], [2, 2], [0, 2], [1, 1]])).toHaveLength(4);
    expect(summaryLine({ areas: 3, concentratedOffRow: 1, classificationToReview: 2, isolated: 5, uniqueWeeds: 40, observations: 60, rowReadShare: 0.8 })).toBe("3 areas flagged for review; 1 with concentrated vegetation between the crop rows; 2 with classification to review; 5 isolated findings outside any area.");
  });
});
