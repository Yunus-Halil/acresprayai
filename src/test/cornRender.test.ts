// The corn twin's views (cornRender.ts): the count, the colours blended over the ground, the tints, and when a plant
// is drawn as a plant or stamped as a dot.
import { describe, expect, it } from "vitest";
import { CORN_RENDER, blendGrid, cornLookOf, cornPlantCount, cornTints, gridCell, isOnRow, leavesFor, plantDrawMode, plantHash, stampOf } from "@/lib/fieldTwin/cornRender";
import type { TwinCorn } from "@/lib/fieldTwin/types";

const corn = (over: Partial<TwinCorn>): TwinCorn => ({ version: 1, engine: "", enteredCrop: "corn", rowSpacingM: 0.76, rowDirectionDeg: 0, rowAgreementM: null, photographs: { read: 1, withRows: 1, failed: [] }, rows: [], weeds: [], gaps: [], summary: { cornRows: 0, unconfirmedRows: 0, cornRowLengthM: 0, offLatticeDropped: 0, weeds: { confirmed: 0, unconfirmed: 0, contested: 0 }, gaps: { confirmed: 0, withheld: 0, confirmedLengthM: 0 }, perPhoto: { weedCandidates: 0, standGaps: 0, rows: 0 } }, notes: [], ...over });
const plants = (certainty: number[]) => ({ points: certainty.map((_, i) => [38 + i * 1e-6, -77] as [number, number]), certainty, photos: certainty.map(() => 2), note: "", summary: { plants: certainty.length, certain: 0, probable: 0, onNoRow: 0, betweenRows: 0, confirmedM: 0, notConfirmedM: 0 } });
const id = (lat: number, lng: number): [number, number] => [lng, lat];

describe("cornPlantCount", () => {
  it("counts every located plant, on the rows and off them", () => {
    // 0 certain, 1 probable, 4 and 5 found along a row: on a row. 2 on no row, 3 between rows: off the rows.
    const c = cornPlantCount(corn({ plants: plants([0, 0, 1, 4, 5, 2, 2, 3]) }));
    expect(c).toEqual({ total: 8, onRows: 5, offRows: 3, onNoRow: 2, betweenRows: 1 });
  });
  it("is null on a twin with no located plants (the count was withheld)", () => {
    expect(cornPlantCount(corn({}))).toBeNull();
    expect(cornPlantCount(null)).toBeNull();
  });
  it("knows the row classes", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(isOnRow)).toEqual([true, true, false, false, true, true, true]);
  });
});

describe("cornLookOf", () => {
  it("falls back to the standard colours and size on a twin built before colours were read", () => {
    const L = cornLookOf(corn({}), id);
    expect(L.sampled).toBe(false);
    expect(L.soil).toEqual(CORN_RENDER.defaultSoil);
    expect(L.corn).toEqual(CORN_RENDER.defaultCorn);
    expect(L.plantSizeM).toBe(CORN_RENDER.defaultPlantSizeM);
    expect(L.sizeMeasured).toBe(false);
  });
  it("takes the field's own colours and size, and places the samples", () => {
    const L = cornLookOf(corn({ look: { version: 1, samples: [{ lat: 38, lng: -77, soil: [1, 2, 3], corn: null }], soil: [1, 2, 3], corn: null, plantSizeM: 0.07, note: "" } }), id);
    expect(L.sampled).toBe(true);
    expect(L.soil).toEqual([1, 2, 3]);
    expect(L.corn).toEqual(CORN_RENDER.defaultCorn);
    expect(L.plantSizeM).toBe(0.07);
    expect(L.samples).toEqual([{ x: -77, y: 38, soil: [1, 2, 3], corn: null }]);
  });
});

describe("blendGrid", () => {
  const box: [number, number, number, number] = [0, 0, 100, 50];
  it("is the fallback colour with no sample", () => {
    const g = blendGrid([], [9, 8, 7], box);
    expect([g.rgb[0], g.rgb[1], g.rgb[2]]).toEqual([9, 8, 7]);
  });
  it("takes each sample's colour near it and blends between", () => {
    const g = blendGrid([{ x: 5, y: 25, c: [200, 0, 0] }, { x: 95, y: 25, c: [0, 0, 200] }], [0, 0, 0], box);
    const at = (x: number, y: number) => { const k = 3 * gridCell(g, x, y); return [g.rgb[k], g.rgb[k + 1], g.rgb[k + 2]]; };
    expect(at(5, 25)[0]).toBeGreaterThan(180);
    expect(at(95, 25)[2]).toBeGreaterThan(180);
    const mid = at(50, 25);
    expect(Math.abs(mid[0] - mid[2])).toBeLessThan(25);
    // No hard edge: neighbouring cells differ by little everywhere.
    let step = 0;
    for (let j = 0; j < g.height; j++) for (let i = 1; i < g.width; i++) step = Math.max(step, Math.abs(g.rgb[3 * (j * g.width + i)] - g.rgb[3 * (j * g.width + i - 1)]));
    expect(step).toBeLessThan(40);
  });
  it("costs the same for a flight of thousands of photographs", () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ x: (i * 37) % 100, y: (i * 11) % 50, c: [100, 90, 80] as [number, number, number] }));
    const g = blendGrid(many, [0, 0, 0], box);
    expect(g.width * g.height * many.length).toBeLessThanOrEqual(CORN_RENDER.maxWork * 1.2);
    expect([g.rgb[0], g.rgb[1], g.rgb[2]]).toEqual([100, 90, 80]);
  });
});

describe("cornTints", () => {
  it("gives a few tints from dark to bright and a tint for every cell", () => {
    const g = blendGrid([{ x: 0, y: 25, c: [40, 90, 30] }, { x: 100, y: 25, c: [110, 180, 80] }], [0, 0, 0], [0, 0, 100, 50]);
    const { palette, cellTint } = cornTints(g);
    expect(palette.length).toBe(CORN_RENDER.tints);
    for (let t = 1; t < palette.length; t++) expect(palette[t][1]).toBeGreaterThanOrEqual(palette[t - 1][1]);
    expect(Math.max(...cellTint)).toBe(CORN_RENDER.tints - 1);
    expect(cellTint[gridCell(g, 1, 25)]).toBe(0);
    expect(cellTint[gridCell(g, 99, 25)]).toBe(CORN_RENDER.tints - 1);
  });
});

describe("how plants are drawn", () => {
  it("draws plants as plants only when they are big enough and few enough", () => {
    expect(plantDrawMode(12, 500)).toBe("sprite");
    expect(plantDrawMode(2, 500)).toBe("stamp");
    expect(plantDrawMode(12, CORN_RENDER.spriteCap + 1)).toBe("stamp");
  });
  it("stamps a plant fainter the smaller it is, never invisible", () => {
    expect(stampOf(0.2)).toEqual({ size: 1, alpha: 0.3 });
    expect(stampOf(1).alpha).toBeGreaterThan(stampOf(0.6).alpha);
    expect(stampOf(2).size).toBe(2);
    expect(stampOf(3.5).size).toBe(3);
  });
  it("gives a plant the same leaves on every visit, and different plants different ones", () => {
    expect(plantHash(1234)).toBe(plantHash(1234));
    const seen = new Set(Array.from({ length: 200 }, (_, i) => plantHash(i) % CORN_RENDER.rotations));
    expect(seen.size).toBe(CORN_RENDER.rotations);
  });
  it("draws more leaves on a bigger plant, inside the plant's span", () => {
    for (let v = 0; v < CORN_RENDER.variants; v++) {
      expect(leavesFor(0.05, v).length).toBeLessThanOrEqual(3);
      expect(leavesFor(0.3, v).length).toBeGreaterThanOrEqual(4);
      for (const l of leavesFor(0.12, v)) { expect(l.length).toBeGreaterThan(0.4); expect(l.length).toBeLessThanOrEqual(1); }
    }
  });
});
