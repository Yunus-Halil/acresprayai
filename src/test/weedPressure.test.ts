// Weed pressure graded per cell: the classes by crop group, the three scenarios, the tiers, the floor, the patches.
import { describe, expect, it } from "vitest";
import type { LatLng2 } from "@/lib/geo";
import type { GroundPlant } from "@/lib/weedVision/frames";
import { latLngOfPx, mercatorPx } from "@/lib/weedVision/mapRun";
import { CLASS_ORDER, classOf, cropGroupOf, gradePressure, kropffLoss, pressureLine, schemeFor, weedObjectsOf, weedObjectsOfScan } from "@/lib/weedVision/pressure/grade";
import { type GridFrame, type Stage1Cell, cellKey } from "@/lib/weedVision/twoStage/stage1";

const LAT = 37.6, LNG = -78.4, Z = 23;
const [LEFT, TOP] = mercatorPx(LAT, LNG, Z);
const MPP = 0.015; // the map's pixel, metres
const CELL_M = 2;
const grid: GridFrame = { z: Z, left: LEFT, top: TOP, mpp: MPP, cellPx: Math.round(CELL_M / MPP), nx: 6, ny: 6 };
const cellM2 = (grid.cellPx * MPP) ** 2;

/** A grid of assessed cells, every one fully imaged with a fifth under the row band, unless overridden. */
function cells(over: Partial<Record<string, Partial<Stage1Cell>>> = {}): Stage1Cell[] {
  const out: Stage1Cell[] = [];
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) {
    const X = LEFT + (i + 0.5) * grid.cellPx, Y = TOP + (j + 0.5) * grid.cellPx;
    const corner = (dx: number, dy: number): LatLng2 => latLngOfPx(LEFT + (i + dx) * grid.cellPx, TOP + (j + dy) * grid.cellPx, Z);
    const key = cellKey(i, j);
    out.push({ i, j, key, centre: latLngOfPx(X, Y, Z), ring: [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)], imagedShare: 1, greenShare: 0.1, bandShare: 0.2, darkShare: 0, pressure: 0, density: 0, offRowGreenM2: 0, uncertain: [], ...(over[key] ?? {}) });
  }
  return out;
}

/** A weed at a cell's centre (plus an offset in metres), of a given canopy area, seen by the given photographs. */
function weed(i: number, j: number, areaM2: number, opts: { id?: string; seenIn?: string[]; dx?: number; dy?: number; px?: number; onRow?: boolean } = {}): GroundPlant {
  const X = LEFT + (i + 0.5) * grid.cellPx + (opts.dx ?? 0) / MPP, Y = TOP + (j + 0.5) * grid.cellPx + (opts.dy ?? 0) / MPP;
  const d = 2 * Math.sqrt(areaM2 / Math.PI);
  const frames = opts.seenIn ?? ["map/a"];
  return { id: opts.id ?? `w-${i}-${j}-${areaM2}-${opts.dx ?? 0}-${opts.dy ?? 0}`, frame: frames[0], instanceId: 1, klass: "weed", score: 0.8, scoreKind: "d", nativePolygon: [], nativeCentroid: [0, 0], nativeBbox: [0, 0, 0, 0], areaPx: 1, equivalentDiameterPx: opts.px ?? Math.round(d / MPP), ring: null, centre: latLngOfPx(X, Y, Z), gsdM: MPP, areaM2, diameterM: d, viewAngleDeg: 0, status: "ok", flags: [], tiny: false, touchesBorder: false, fusedFromTiles: 1, rowStatus: opts.onRow ? "on-row" : "off-row", seenIn: frames, duplicates: frames.length - 1 };
}

const grade = (plants: GroundPlant[], o: Partial<Parameters<typeof gradePressure>[0]> = {}) => gradePressure({ objects: weedObjectsOf(plants), grid, cells: cells(), rows: null, crop: "corn", canopyClosed: false, photoBased: false, ...o });
const groundM2 = cellM2 * 0.8;

describe("crop groups and schemes", () => {
  it("names the group from the crop, or from a planting layout, and carries the published action points", () => {
    expect(cropGroupOf("corn", false)).toBe("wide-row");
    expect(cropGroupOf("Winter wheat", false)).toBe("cereal");
    expect(cropGroupOf("apricot", false)).toBe("orchard");
    expect(cropGroupOf("kayısı", false)).toBe("orchard");
    expect(cropGroupOf(null, true)).toBe("orchard");
    expect(cropGroupOf(null, false)).toBe("wide-row");
    expect(schemeFor("wide-row", "corn").action).toBe(0.10);
    expect(schemeFor("cereal", "wheat").action).toBe(0.09);
    expect(schemeFor("cereal", "barley").action).toBe(0.05);
    expect(schemeFor("orchard", "olive").action).toBe(0.10);
    expect(schemeFor("orchard", "apricot").action).toBe(0.15);
    expect(schemeFor("orchard", "apricot").high).toBe(0.25);
  });

  it("classes cover against the scheme, with trace for anything under low", () => {
    const s = schemeFor("wide-row", "corn");
    expect(classOf(0, 0, s)).toBe("none");
    expect(classOf(0.005, 1, s)).toBe("trace");
    expect(classOf(0.03, 2, s)).toBe("low");
    expect(classOf(0.07, 2, s)).toBe("moderate");
    expect(classOf(0.12, 2, s)).toBe("action");
    expect(classOf(0.3, 2, s)).toBe("high");
    expect(CLASS_ORDER.indexOf("action")).toBeGreaterThan(CLASS_ORDER.indexOf("moderate"));
  });
});

describe("the grade", () => {
  it("measures cover over the visible ground, not the whole cell, and classes it", () => {
    // 12% of the visible ground: one weed of that area in cell (2,2).
    const gr = grade([weed(2, 2, 0.12 * groundM2)]);
    const c = gr.cells.find(x => x.key === cellKey(2, 2))!;
    expect(c.cover).toBeCloseTo(0.12, 2);
    expect(c.klass).toBe("action");
    expect(c.tier).toBe("confirmed"); // corroborated by cover
    expect(gr.summary.byClass.action).toBe(1);
    expect(gr.summary.actionAreaM2).toBeCloseTo(groundM2, 1);
    expect(pressureLine(gr, m2 => `${Math.round(m2)} m²`)).toMatch(/1 at the action point/);
  });

  it("scenario 1: many small weeds at low cover step the cell up one class and are tagged, only before closure", () => {
    // Eight 6.7 cm weeds (0.0035 m² each, just over the 6 cm floor): cover about 0.9%, density 2.5 per m²: trace, stepped up to low.
    const small = Array.from({ length: 8 }, (_, n) => weed(1, 1, 0.0035, { id: `s${n}`, dx: -0.6 + 0.17 * n, dy: 0.2 * (n % 3) }));
    const gr = grade(small);
    const c = gr.cells.find(x => x.key === cellKey(1, 1))!;
    expect(c.count).toBe(8);
    expect(c.cover).toBeLessThan(0.01);
    expect(c.treatWhileSmall).toBe(true);
    expect(c.klass).toBe("low");
    expect(gr.summary.treatWhileSmall).toBe(1);
    expect(gr.notes.join(" ")).toMatch(/treat while small|easiest to treat while small/);
    const closed = grade(small, { canopyClosed: true });
    expect(closed.cells.find(x => x.key === cellKey(1, 1))!.treatWhileSmall).toBe(false);
    expect(closed.notes.join(" ")).toMatch(/canopy reads as closed/);
  });

  it("scenario 2: one large weed never raises its cell's class; it is a large escape with its size", () => {
    // A 0.5 m weed (0.196 m²) alone in a cell: cover about 6% (moderate), one escape.
    const gr = grade([weed(3, 3, 0.196)]);
    const c = gr.cells.find(x => x.key === cellKey(3, 3))!;
    expect(c.klass).toBe("moderate");
    expect(c.treatWhileSmall).toBe(false);
    expect(gr.escapes).toHaveLength(1);
    expect(gr.escapes[0].diameterM).toBeCloseTo(0.5, 1);
    expect(gr.escapes[0].cell).toBe(cellKey(3, 3));
    expect(gr.notes.join(" ")).toMatch(/large escape/);
  });

  it("scenario 3: a cluster across cells is one patch, ranked by area, a priority at 25 m² or high cover", () => {
    // 10% cover in four touching cells (a 4 x 4 m cluster) and 30% in one far cell.
    const plants = [weed(0, 0, 0.1 * groundM2), weed(1, 0, 0.1 * groundM2), weed(0, 1, 0.1 * groundM2), weed(1, 1, 0.1 * groundM2), weed(5, 5, 0.3 * groundM2)];
    const gr = grade(plants);
    expect(gr.patches).toHaveLength(2);
    expect(gr.patches[0].cells).toHaveLength(4);
    expect(gr.patches[0].rank).toBe(1);
    expect(gr.patches[0].areaM2).toBeCloseTo(4 * groundM2, 0);
    expect(gr.patches[0].priority).toBe(false); // 12.8 m² of ground at 10%: neither 25 m² nor high cover
    expect(gr.patches[1].priority).toBe(true); // 30% is over the scheme's high
    expect(gr.summary.priorityPatches).toBe(1);
  });

  it("tiers: a lone object is possible, corroboration or a second photograph confirms, and nothing is dropped", () => {
    const lone = grade([weed(2, 4, 0.02)]);
    const c = lone.cells.find(x => x.key === cellKey(2, 4))!;
    expect(c.tier).toBe("possible");
    expect(c.count).toBe(1);
    expect(lone.summary.possible).toBe(1);
    // Three objects corroborate on the map.
    const three = grade([weed(2, 4, 0.01, { id: "a" }), weed(2, 4, 0.01, { id: "b", dx: 0.3 }), weed(2, 4, 0.01, { id: "c", dx: -0.3 })]);
    expect(three.cells.find(x => x.key === cellKey(2, 4))!.tier).toBe("confirmed");
    // From photographs, corroboration needs an object seen twice.
    const once = grade([weed(2, 4, 0.01, { id: "a", seenIn: ["p1"] }), weed(2, 4, 0.01, { id: "b", dx: 0.3, seenIn: ["p1"] }), weed(2, 4, 0.01, { id: "c", dx: -0.3, seenIn: ["p2"] })], { photoBased: true });
    expect(once.cells.find(x => x.key === cellKey(2, 4))!.tier).toBe("possible");
    const twice = grade([weed(2, 4, 0.01, { id: "a", seenIn: ["p1", "p2"] }), weed(2, 4, 0.01, { id: "b", dx: 0.3, seenIn: ["p1"] }), weed(2, 4, 0.01, { id: "c", dx: -0.3, seenIn: ["p2"] })], { photoBased: true });
    expect(twice.cells.find(x => x.key === cellKey(2, 4))!.tier).toBe("confirmed");
    expect(twice.cells.find(x => x.key === cellKey(2, 4))!.multiView).toBe(1);
  });

  it("the floor: objects under four pixels are counted apart, and the floor is stated in centimetres", () => {
    const gr = grade([weed(0, 5, 0.0005, { px: 2 }), weed(0, 5, 0.02, { dx: 0.4 })]);
    expect(gr.summary.belowFloor).toBe(1);
    expect(gr.cells.find(x => x.key === cellKey(0, 5))!.count).toBe(1);
    expect(gr.detectionFloorM).toBeCloseTo(4 * MPP, 6);
    expect(gr.notes.join(" ")).toMatch(/6 cm across/);
  });

  it("not assessed cells carry their reason and are never weed-free; weeds on a row never count", () => {
    const cs = cells({ [cellKey(4, 4)]: { uncertain: ["shadow"] } });
    const gr = gradePressure({ objects: weedObjectsOf([weed(4, 4, 0.2 * groundM2), weed(4, 1, 0.2 * groundM2, { onRow: true })]), grid, cells: cs, rows: null, crop: "corn", canopyClosed: false, photoBased: false });
    const shaded = gr.cells.find(x => x.key === cellKey(4, 4))!;
    expect(shaded.assessed).toBe(false);
    expect(shaded.whyNot).toEqual(["shadow"]);
    expect(shaded.klass).toBe("none");
    expect(gr.summary.notAssessed).toBe(1);
    expect(gr.cells.find(x => x.key === cellKey(4, 1))!.count).toBe(0);
    expect(gr.notes.join(" ")).toMatch(/not weed-free, unseen/);
  });

  it("relative cover and the loss band come from weed over weed plus crop, before closure only", () => {
    // Without a layout the crop's cover is the row band share: 20% of the cell.
    const gr = grade([weed(1, 3, 0.1 * groundM2)]);
    const c = gr.cells.find(x => x.key === cellKey(1, 3))!;
    const cropM2 = cellM2 * 0.2;
    expect(c.cropM2).toBeCloseTo(0, 6); // no rows at all: no crop cover known
    const withRows = gradePressure({ objects: weedObjectsOf([weed(1, 3, 0.1 * groundM2)]), grid, cells: cells(), rows: { z: Z, left: LEFT, top: TOP, mpp: MPP, rows: 1, spacingM: 5, seedSpacingM: 3, directionDeg: 0, blocks: 1, source: "reader", ctx: { lines: [], crops: [], bandPx: 10, gsdM: MPP } }, crop: "corn", canopyClosed: false, photoBased: false });
    const r = withRows.cells.find(x => x.key === cellKey(1, 3))!;
    expect(r.cropM2).toBeCloseTo(cropM2, 3);
    expect(r.relativeCover).toBeCloseTo(r.weedM2 / (r.weedM2 + cropM2), 6);
    expect(r.lossBand![0]).toBeCloseTo(kropffLoss(r.relativeCover!, 0.54), 6);
    expect(r.lossBand![1]).toBeCloseTo(r.relativeCover!, 6); // q = 1 is the identity
    const closed = gradePressure({ objects: weedObjectsOf([weed(1, 3, 0.1 * groundM2)]), grid, cells: cells(), rows: withRows.cells.length ? ({ z: Z, left: LEFT, top: TOP, mpp: MPP, rows: 1, spacingM: 5, seedSpacingM: 3, directionDeg: 0, blocks: 1, source: "reader", ctx: { lines: [], crops: [], bandPx: 10, gsdM: MPP } }) : null, crop: "corn", canopyClosed: true, photoBased: false });
    expect(closed.cells.find(x => x.key === cellKey(1, 3))!.lossBand).toBeNull();
  });
});

describe("weeds from the scan", () => {
  it("the scan's kept spots grade like the model's plants: a region's area, a plant's blob area, no pixels so the floor is on the metres", () => {
    const spot = (id: string, i: number, j: number, areaM2: number) => ({ id, tileId: "t", centroid: weed(i, j, areaM2).centre, kind: "off-row vegetation", score: 0.7, distanceToRowM: 1, rowConfidence: 0.8, anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null, blob: null, region: null, areaM2, feedback: null, estimate: null }) as unknown as import("@/lib/weedScout/types").Candidate;
    const objs = weedObjectsOfScan([spot("a", 2, 2, 0.12 * groundM2), spot("b", 3, 3, 0.0005), spot("c", 4, 4, 0)]);
    expect(objs).toHaveLength(2); // a zero-area spot has nothing to grade
    expect(objs[0].px).toBeNull();
    const gr = gradePressure({ objects: objs, grid, cells: cells(), rows: null, crop: "apricot", canopyClosed: false, photoBased: false });
    expect(gr.group).toBe("orchard");
    expect(gr.cells.find(c => c.key === cellKey(2, 2))!.klass).toBe("moderate"); // 12% is under the apricot action point of 15%
    expect(gr.summary.belowFloor).toBe(1); // 2.5 cm across, under the 6 cm floor
  });
});

describe("the store's pure parts", () => {
  it("the windows' key carries the painting suffix only when the crop is painted out over a layout's rows", async () => {
    const { windowsKey } = await import("@/lib/weedVision/twoStage/twoStageStore");
    expect(windowsKey("two-stage|k|w680", "sig", true)).toBe("two-stage|k|w680|between-rows|sig");
    expect(windowsKey("two-stage|k|w680", "sig", false)).toBe("two-stage|k|w680");
    expect(windowsKey("two-stage|k|w680", null, true)).toBe("two-stage|k|w680");
  });

  it("the canopy reads as closed from the assessed cells' mean green share", async () => {
    const { canopyClosedOf } = await import("@/lib/weedVision/pressure/pressureStore");
    expect(canopyClosedOf([])).toBeNull();
    expect(canopyClosedOf([{ greenShare: 0.9, uncertain: [] }, { greenShare: 0.95, uncertain: [] }, { greenShare: 0.1, uncertain: ["shadow"] }])).toBe(true);
    expect(canopyClosedOf([{ greenShare: 0.3, uncertain: [] }, { greenShare: 0.95, uncertain: [] }])).toBe(false);
  });
});

describe("the map's own pixels", () => {
  it("a cell with off-row green but no spot on the list is still graded, from Stage 1's measure", () => {
    const cs = cells({ [cellKey(3, 1)]: { pressure: 0.12, density: 1.2, offRowGreenM2: 0.12 * groundM2 } });
    const gr = gradePressure({ objects: [], grid, cells: cs, rows: null, crop: "corn", canopyClosed: false, photoBased: false });
    const c = gr.cells.find(x => x.key === cellKey(3, 1))!;
    expect(c.cover).toBeCloseTo(0.12, 2);
    expect(c.klass).toBe("action");
    expect(c.count).toBe(Math.round(1.2 * groundM2));
    expect(c.tier).toBe("confirmed");
    // And an object that says more than the pixels wins the cell's cover, never less.
    const more = gradePressure({ objects: weedObjectsOf([weed(3, 1, 0.3 * groundM2)]), grid, cells: cs, rows: null, crop: "corn", canopyClosed: false, photoBased: false });
    expect(more.cells.find(x => x.key === cellKey(3, 1))!.cover).toBeCloseTo(0.3, 2);
  });
});

describe("the three bands the map draws", () => {
  it("low is trace and low, medium is moderate, high is the action point and over", async () => {
    const { bandOf } = await import("@/lib/weedVision/pressure/grade");
    expect(bandOf("none")).toBe("none");
    expect(bandOf("trace")).toBe("low");
    expect(bandOf("low")).toBe("low");
    expect(bandOf("moderate")).toBe("medium");
    expect(bandOf("action")).toBe("high");
    expect(bandOf("high")).toBe("high");
  });
});
