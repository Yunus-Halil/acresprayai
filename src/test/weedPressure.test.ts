// Weed pressure graded per cell: the classes by crop group, the three scenarios, the tiers, the floor, the patches.
import { describe, expect, it, vi } from "vitest";
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

/** The cells as Stage 1 reads them under these weeds: each cell's off-row green is the canopy of the off-row weeds centred in it (the pixels see what the model saw). */
function cellsSeeing(weeds: { centre: LatLng2 | null; areaM2: number | null; onRow?: boolean }[], over: Partial<Record<string, Partial<Stage1Cell>>> = {}): Stage1Cell[] {
  const green = new Map<string, number>();
  for (const w of weeds) {
    if (!w.centre || w.onRow || !w.areaM2) continue;
    const [X, Y] = mercatorPx(w.centre.lat, w.centre.lng, Z);
    const k = cellKey(Math.floor((X - LEFT) / grid.cellPx), Math.floor((Y - TOP) / grid.cellPx));
    green.set(k, (green.get(k) ?? 0) + w.areaM2);
  }
  const o: Partial<Record<string, Partial<Stage1Cell>>> = {};
  for (const [k, m2] of green) o[k] = { offRowGreenM2: m2, pressure: m2 / (cellM2 * 0.8) };
  for (const [k, v] of Object.entries(over)) o[k] = { ...(o[k] ?? {}), ...v };
  return cells(o);
}
const plantsSeen = (plants: GroundPlant[]) => cellsSeeing(plants.map(p => ({ centre: p.centre, areaM2: p.areaM2, onRow: p.rowStatus === "on-row" })));
const grade = (plants: GroundPlant[], o: Partial<Parameters<typeof gradePressure>[0]> = {}) => gradePressure({ objects: weedObjectsOf(plants), grid, cells: plantsSeen(plants), rows: null, crop: "corn", canopyClosed: false, photoBased: false, ...o });
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

  it("scenario 1 reads size over the treatment unit: a cell with no weeds of its own inside a dense unit steps up with it", () => {
    // 2 m cells, a 6 m unit (3 x 3 cells). Eight 6.7 cm weeds in each of the eight cells around (2,2), none in (2,2).
    const small: GroundPlant[] = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      for (let n = 0; n < 8; n++) small.push(weed(2 + di, 2 + dj, 0.0035, { id: `s${di}${dj}${n}`, dx: -0.6 + 0.17 * n, dy: 0.2 * (n % 3) }));
    }
    const gr = grade(small, { params: { unitM: 6 } });
    const c = gr.cells.find(x => x.key === cellKey(2, 2))!;
    expect(c.count).toBe(0);
    expect(c.medianDiameterM).toBeNull(); // nothing of its own
    expect(c.unitCount).toBe(64);
    expect(c.unitMedianDiameterM).toBeCloseTo(2 * Math.sqrt(0.0035 / Math.PI), 6);
    expect(c.treatWhileSmall).toBe(true);
    expect(c.klass).toBe("low"); // trace over the unit, stepped up
  });

  it("scenario 1: a unit with no objects never steps up, however many small blobs Stage 1 counted", () => {
    // Every cell full of specks (3 per m², 1% cover) and no objects: dense and small by the pixels, but no weed found.
    const all: Record<string, Partial<Stage1Cell>> = {};
    for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) all[cellKey(i, j)] = { pressure: 0.01, density: 3, offRowGreenM2: 0.01 * groundM2 };
    const gr = gradePressure({ objects: [], grid, cells: cells(all), rows: null, crop: "corn", canopyClosed: false, photoBased: false, params: { unitM: 6 } });
    const c = gr.cells.find(x => x.key === cellKey(2, 2))!;
    expect(c.unitCount).toBeGreaterThan(20);
    expect(c.unitMedianDiameterM).toBeNull();
    expect(gr.cells.some(x => x.treatWhileSmall)).toBe(false);
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

  it("tiers: Stage 1's pixel blobs never corroborate by count; only objects do", () => {
    // Twelve specks in a cell at 1% cover and no objects: counted, but not three objects, so possible.
    const specks = cells({ [cellKey(2, 4)]: { pressure: 0.01, density: 12 / groundM2, offRowGreenM2: 0.01 * groundM2 } });
    const gr = gradePressure({ objects: [], grid, cells: specks, rows: null, crop: "corn", canopyClosed: false, photoBased: false });
    const c = gr.cells.find(x => x.key === cellKey(2, 4))!;
    expect(c.count).toBe(12);
    expect(c.objects).toBe(0);
    expect(c.unitObjects).toBe(0);
    expect(c.tier).toBe("possible");
    // The same cell with three objects found over its pixels is confirmed.
    const three = [weed(2, 4, 0.01, { id: "a" }), weed(2, 4, 0.01, { id: "b", dx: 0.3 }), weed(2, 4, 0.01, { id: "c", dx: -0.3 })];
    const withObjects = gradePressure({ objects: weedObjectsOf(three), grid, cells: specks, rows: null, crop: "corn", canopyClosed: false, photoBased: false });
    expect(withObjects.cells.find(x => x.key === cellKey(2, 4))!.unitObjects).toBe(3);
    expect(withObjects.cells.find(x => x.key === cellKey(2, 4))!.tier).toBe("confirmed");
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

  it("relative cover and the loss band are off: null in every cell, whatever the rows, before closure or after", () => {
    const one = [weed(1, 3, 0.1 * groundM2)];
    const readerRows = { z: Z, left: LEFT, top: TOP, mpp: MPP, rows: 1, spacingM: 5, seedSpacingM: 3, directionDeg: 0, blocks: 1, source: "reader" as const, ctx: { lines: [], crops: [], bandPx: 10, gsdM: MPP } };
    // A layout crown centred in the cell: once the one case that produced a band.
    const crownX = LEFT + 1.5 * grid.cellPx + 0.6 / MPP, crownY = TOP + 3.5 * grid.cellPx;
    const layoutRows = { z: Z, left: 0, top: 0, mpp: MPP, rows: 1, spacingM: 5, seedSpacingM: 3, directionDeg: 0, blocks: 1, source: "layout" as const, ctx: { lines: [], crops: [{ x: crownX, y: crownY, r: 0.3 / MPP, state: "confirmed" as const }], bandPx: 10, gsdM: MPP } };
    for (const rows of [null, readerRows, layoutRows]) {
      const gr = gradePressure({ objects: weedObjectsOf(one), grid, cells: plantsSeen(one), rows, crop: "olive", canopyClosed: false, photoBased: false });
      expect(gr.cells.every(c => c.relativeCover === null && c.lossBand === null)).toBe(true);
      expect(gr.summary.medianRelativeCover).toBeNull();
    }
    // The crop's area is still kept for the card: the band's share with reader rows, the crown's with a layout.
    const r = gradePressure({ objects: weedObjectsOf(one), grid, cells: plantsSeen(one), rows: readerRows, crop: "corn", canopyClosed: false, photoBased: false });
    expect(r.cells.find(x => x.key === cellKey(1, 3))!.cropM2).toBeCloseTo(cellM2 * 0.2, 3);
    const l = gradePressure({ objects: weedObjectsOf(one), grid, cells: plantsSeen(one), rows: layoutRows, crop: "olive", canopyClosed: false, photoBased: false });
    expect(l.cells.find(x => x.key === cellKey(1, 3))!.cropM2).toBeCloseTo(Math.PI * 0.3 ** 2, 6);
    // An expected crown (placed at the typical size, little green) counts at half the typical confirmed crown, not as a full canopy.
    const expectedRows = { ...layoutRows, ctx: { ...layoutRows.ctx, crops: [{ ...layoutRows.ctx.crops[0], r: 0.5 / MPP, state: "expected" as const }, { x: crownX + 20 / MPP, y: crownY, r: 0.4 / MPP, state: "confirmed" as const }] } };
    const ex = gradePressure({ objects: weedObjectsOf(one), grid, cells: plantsSeen(one), rows: expectedRows, crop: "olive", canopyClosed: false, photoBased: false });
    expect(ex.cells.find(x => x.key === cellKey(1, 3))!.cropM2).toBeCloseTo(Math.PI * 0.2 ** 2, 6);
    expect(kropffLoss(0.1, 1)).toBeCloseTo(0.1, 9); // kept for when it returns at the unit
  });
});

describe("weeds from the scan", () => {
  it("the scan's kept spots grade like the model's plants: a region's area, a plant's blob area, no pixels so the floor is on the metres", () => {
    const spot = (id: string, i: number, j: number, areaM2: number) => ({ id, tileId: "t", centroid: weed(i, j, areaM2).centre, kind: "off-row vegetation", score: 0.7, distanceToRowM: 1, rowConfidence: 0.8, anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null, blob: null, region: null, areaM2, feedback: null, estimate: null }) as unknown as import("@/lib/weedScout/types").Candidate;
    const objs = weedObjectsOfScan([spot("a", 2, 2, 0.12 * groundM2), spot("b", 3, 3, 0.0005), spot("c", 4, 4, 0)]);
    expect(objs).toHaveLength(2); // a zero-area spot has nothing to grade
    expect(objs[0].px).toBeNull();
    const gr = gradePressure({ objects: objs, grid, cells: cellsSeeing(objs), rows: null, crop: "apricot", canopyClosed: false, photoBased: false });
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

describe("row crops are not graded yet", () => {
  const readerRows = { z: Z, left: LEFT, top: TOP, mpp: MPP, rows: 4, spacingM: 0.76, seedSpacingM: 0.2, directionDeg: 0, blocks: 1, source: "reader" as const, ctx: { lines: [], crops: [], bandPx: 10, gsdM: MPP } };
  const layoutRows = { ...readerRows, source: "layout" as const };
  const MESSAGE = "Row-crop grading is not supported yet: the row reader needs rows at least 1 m apart and separate crop plants. Orchards and vineyards only for now.";

  it("a wide-row or cereal crop on file without a fitted planting layout is refused; orchards, layouts and no crop on file are not", async () => {
    const { pressureRefusal } = await import("@/lib/weedVision/pressure/pressureStore");
    const { ROW_CROP_GRADING_UNSUPPORTED, rowCropGradingBlocked } = await import("@/lib/weedVision/fieldRows");
    expect(ROW_CROP_GRADING_UNSUPPORTED).toBe(MESSAGE);
    expect(pressureRefusal("corn", readerRows)).toBe(MESSAGE);
    expect(pressureRefusal("Soybean", null)).toBe(MESSAGE); // no rows read at all
    expect(pressureRefusal("winter wheat", readerRows)).toBe(MESSAGE);
    expect(pressureRefusal("corn", layoutRows)).toBeNull(); // the operator's own rows
    expect(pressureRefusal("apricot", readerRows)).toBeNull();
    expect(pressureRefusal(null, readerRows)).toBeNull(); // no crop on file: nothing says it is a row crop
    expect(pressureRefusal("  ", readerRows)).toBeNull();
    expect(rowCropGradingBlocked("orchard", null)).toBe(false);
    expect(rowCropGradingBlocked("cereal", undefined)).toBe(true);
  });

  it("gradeField sets the error and never reads Stage 1 or grades", async () => {
    const { gradeField, getPressure } = await import("@/lib/weedVision/pressure/pressureStore");
    const readStage1 = vi.fn();
    await gradeField("row-crop-task", { crop: "corn", stage1: { params: {} as never, modelSha: null, photoGsdM: null, deps: { ensureRows: async () => undefined, rowsOf: () => readerRows, readStage1 } } });
    const p = getPressure("row-crop-task");
    expect(p.error).toBe(MESSAGE);
    expect(p.grade).toBeNull();
    expect(p.state).toBe("none");
    expect(readStage1).not.toHaveBeenCalled();
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
    expect(c.disagreement).toBeNull(); // no objects: nothing to disagree with
  });

  it("cover comes from the pixels alone; the objects give the count and sizes, and a cell where the two disagree says so", () => {
    const cs = cells({ [cellKey(3, 1)]: { pressure: 0.12, density: 1.2, offRowGreenM2: 0.12 * groundM2 } });
    // One object of 30% of the ground over pixels that read 12%: the cover stays 12%, the count is the one object.
    const more = gradePressure({ objects: weedObjectsOf([weed(3, 1, 0.3 * groundM2)]), grid, cells: cs, rows: null, crop: "corn", canopyClosed: false, photoBased: false });
    const c = more.cells.find(x => x.key === cellKey(3, 1))!;
    expect(c.cover).toBeCloseTo(0.12, 2);
    expect(c.weedM2).toBeCloseTo(0.12 * groundM2, 6);
    expect(c.objectM2).toBeCloseTo(0.3 * groundM2, 6);
    expect(c.count).toBe(1);
    expect(c.medianDiameterM).toBeCloseTo(2 * Math.sqrt((0.3 * groundM2) / Math.PI), 6);
    expect(c.disagreement).toBeCloseTo(0.18, 6);
    expect(more.summary.disagreeing).toBe(1);
    expect(more.notes.join(" ")).toMatch(/1 cell where the map's pixels and the weeds found differ by more than 10%/);
    // An object that agrees with the pixels: no disagreement counted, no note.
    const agree = gradePressure({ objects: weedObjectsOf([weed(3, 1, 0.15 * groundM2)]), grid, cells: cs, rows: null, crop: "corn", canopyClosed: false, photoBased: false });
    expect(agree.cells.find(x => x.key === cellKey(3, 1))!.disagreement).toBeCloseTo(0.03, 6);
    expect(agree.summary.disagreeing).toBe(0);
    expect(agree.notes.join(" ")).not.toMatch(/differ by more than/);
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

describe("near the crop", () => {
  it("a scrap of ground beside the band, or a cell a crown's margin touches, is capped at medium on the map and said so", async () => {
    const { drawnBandOf } = await import("@/lib/weedVision/pressure/grade");
    // (5,0): 70% of the cell under the band, a leaf on the scrap reads 40% cover: class high, drawn medium, near the crop.
    const cs = cells({ [cellKey(5, 0)]: { bandShare: 0.7, pressure: 0.4, density: 1, offRowGreenM2: 0.4 * cellM2 * 0.3 } });
    const gr = gradePressure({ objects: [], grid, cells: cs, rows: null, crop: "corn", canopyClosed: false, photoBased: false });
    const c = gr.cells.find(x => x.key === cellKey(5, 0))!;
    expect(c.assessed).toBe(true);
    expect(c.klass).toBe("high");
    expect(c.nearCrop).toBe(true);
    expect(drawnBandOf(c)).toBe("medium");
    expect(gr.summary.nearCrop).toBe(1);
    expect(gr.notes.join(" ")).toMatch(/against the crop/);
    // A crown whose margin reaches into cell (2,2) makes it near the crop too; a far cell is not.
    const crownX = LEFT + 2 * grid.cellPx - 0.5 / MPP, crownY = TOP + 2.5 * grid.cellPx; // 0.5 m left of the cell's edge; crown radius 0.4 m plus the 0.3 m margin reaches it
    const rows = { z: Z, left: 0, top: 0, mpp: MPP, rows: 1, spacingM: 5, seedSpacingM: 3, directionDeg: 0, blocks: 1, source: "layout" as const, ctx: { lines: [], crops: [{ x: crownX, y: crownY, r: 0.4 / MPP }], bandPx: 10, gsdM: MPP } };
    const near = [weed(2, 2, 0.2 * groundM2), weed(4, 4, 0.2 * groundM2)];
    const g2 = gradePressure({ objects: weedObjectsOf(near), grid, cells: plantsSeen(near), rows, crop: "apricot", canopyClosed: false, photoBased: false });
    expect(g2.cells.find(x => x.key === cellKey(2, 2))!.nearCrop).toBe(true);
    expect(g2.cells.find(x => x.key === cellKey(4, 4))!.nearCrop).toBe(false);
    expect(drawnBandOf(g2.cells.find(x => x.key === cellKey(4, 4))!)).toBe("high");
  });
});

describe("the treatment unit", () => {
  const at = (gr: ReturnType<typeof gradePressure>, i: number, j: number) => gr.cells.find(x => x.key === cellKey(i, j))!;
  it("a lone high cell is a plant, not a patch, over the unit; a block of them stays high; the field verdict leads the line", () => {
    // 2 m cells, a 6 m unit: each cell is judged over the 3 x 3 cells around it.
    const lone = gradePressure({ objects: [], grid, cells: cells({ [cellKey(2, 2)]: { pressure: 0.3, density: 2, offRowGreenM2: 0.3 * groundM2 } }), rows: null, crop: "corn", canopyClosed: false, photoBased: false, params: { unitM: 6 } });
    expect(lone.summary.unitM).toBeCloseTo(6, 0);
    expect(at(lone, 2, 2).cover).toBeCloseTo(0.3, 5); // the cell's own cover, for the card
    expect(at(lone, 2, 2).unitCover).toBeCloseTo(0.3 / 9, 5);
    expect(at(lone, 2, 2).klass).toBe("low");
    expect(lone.patches).toHaveLength(0);
    const block: Record<string, Partial<Stage1Cell>> = {};
    for (let j = 1; j <= 3; j++) for (let i = 1; i <= 3; i++) block[cellKey(i, j)] = { pressure: 0.3, density: 2, offRowGreenM2: 0.3 * groundM2 };
    const patch = gradePressure({ objects: [], grid, cells: cells(block), rows: null, crop: "corn", canopyClosed: false, photoBased: false, params: { unitM: 6 } });
    expect(at(patch, 2, 2).klass).toBe("high");
    expect(at(patch, 1, 1).klass).toBe("action"); // the patch's corner: four of its nine unit cells are the patch, 13%
    expect(at(patch, 4, 4).klass).toBe("low"); // one patch cell in nine, 3.3%
    expect(patch.patches.length).toBeGreaterThan(0);
    expect(patch.patches[0].rank).toBe(1);
    expect(patch.summary.fieldCover).toBeCloseTo(9 * 0.3 / 36, 5);
    expect(patch.summary.fieldClass).toBe("moderate");
    expect(pressureLine(patch, m2 => `${Math.round(m2)} m²`)).toMatch(/^Field as a whole: 7\.5% cover, moderate \(action at 10%\); 36 cells assessed/);
    expect(patch.notes.join(" ")).toMatch(/6\.0 m treatment unit/);
  });
  it("at the default unit on a 2 m grid the unit is the cell, and a field at the action point says so", () => {
    const all: Record<string, Partial<Stage1Cell>> = {};
    for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) all[cellKey(i, j)] = { pressure: 0.12, density: 1, offRowGreenM2: 0.12 * groundM2 };
    const gr = gradePressure({ objects: [], grid, cells: cells(all), rows: null, crop: "corn", canopyClosed: false, photoBased: false });
    expect(gr.summary.unitM).toBeCloseTo(2, 0);
    expect(gr.summary.fieldClass).toBe("action");
    expect(gr.notes.join(" ")).toMatch(/field as a whole reads at the action point/);
    const orchard = gradePressure({ objects: [], grid, cells: cells(all), rows: null, crop: "olive", group: "orchard", canopyClosed: false, photoBased: false });
    expect(orchard.notes.join(" ")).toMatch(/floor pass first/);
  });
});

describe("the default treatment unit on the grade's own grid", () => {
  it("is 2.5 m, five half-metre cells, and the summary and the notes say the side actually used", async () => {
    const { DEFAULT_GRADE } = await import("@/lib/weedVision/pressure/grade");
    expect(DEFAULT_GRADE.unitM).toBe(2.5);
    const g5: GridFrame = { ...grid, cellPx: Math.round(0.5 / MPP), nx: 11, ny: 11 };
    const cs: Stage1Cell[] = [];
    for (let j = 0; j < g5.ny; j++) for (let i = 0; i < g5.nx; i++) {
      const corner = (dx: number, dy: number): LatLng2 => latLngOfPx(LEFT + (i + dx) * g5.cellPx, TOP + (j + dy) * g5.cellPx, Z);
      const lone = i === 5 && j === 5;
      cs.push({ i, j, key: cellKey(i, j), centre: corner(0.5, 0.5), ring: [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)], imagedShare: 1, greenShare: 0.1, bandShare: 0, darkShare: 0, pressure: lone ? 0.5 : 0, density: 0, offRowGreenM2: lone ? 0.5 * (g5.cellPx * MPP) ** 2 : 0, uncertain: [] });
    }
    const gr = gradePressure({ objects: [], grid: g5, cells: cs, rows: null, crop: "corn", canopyClosed: false, photoBased: false });
    const side = 5 * g5.cellPx * MPP;
    expect(gr.summary.unitM).toBeCloseTo(side, 9);
    const c = gr.cells.find(x => x.key === cellKey(5, 5))!;
    expect(c.unitCover).toBeCloseTo(0.5 / 25, 9); // one cell of 25 in the window
    expect(gr.cells.find(x => x.key === cellKey(7, 7))!.unitCover).toBeCloseTo(0.5 / 25, 9); // two cells off: still inside
    expect(gr.cells.find(x => x.key === cellKey(8, 5))!.unitCover).toBe(0); // three cells off: outside
    expect(gr.notes.join(" ")).toMatch(new RegExp(`over a ${side.toFixed(1)} m treatment unit`));
  });
});

describe("the cell size", () => {
  it("the grade reads at half-metre cells and the not-assessed floor is a share of the cell, not a fixed area", async () => {
    const { PRESSURE_CELL_M } = await import("@/lib/weedVision/pressure/pressureStore");
    const { DEFAULT_GRADE } = await import("@/lib/weedVision/pressure/grade");
    expect(PRESSURE_CELL_M).toBe(0.5);
    // A cell with 29% of its ground visible is not assessed; one with 31% is, at any cell size.
    const cs = cells({ [cellKey(0, 0)]: { bandShare: 0.71 }, [cellKey(1, 0)]: { bandShare: 0.69 } });
    const gr = gradePressure({ objects: [], grid, cells: cs, rows: null, crop: "corn", canopyClosed: false, photoBased: false });
    expect(gr.cells.find(c => c.key === cellKey(0, 0))!.assessed).toBe(false);
    expect(gr.cells.find(c => c.key === cellKey(1, 0))!.assessed).toBe(true);
    expect(DEFAULT_GRADE.minGroundShare).toBe(0.3);
  });
});

describe("when nothing can be assessed", () => {
  it("the line says why, by reason and count", () => {
    const cs = cells();
    for (const c of cs) c.uncertain = c.i < 3 ? ["no rows"] : ["partly imaged"];
    cs[0].uncertain = [];
    cs[0].bandShare = 0.95; // the grade's own floor: too little ground
    const gr = gradePressure({ objects: [], grid, cells: cs, rows: null, crop: "corn", canopyClosed: false, photoBased: false });
    expect(gr.summary.assessed).toBe(0);
    expect(gr.summary.whyNot).toEqual({ "no rows": 17, "partly imaged": 18, "too little ground": 1 });
    expect(pressureLine(gr, m2 => `${m2}`)).toBe("No cell could be assessed: 36 cells read, none judged (partly imaged 18, no rows 17, too little ground 1).");
    expect(gr.cells[0].whyNot).toEqual(["too little ground"]);
  });
});
