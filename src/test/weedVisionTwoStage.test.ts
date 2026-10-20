// The two-stage prototype on a synthetic orchard: tree rows 5 m apart, one weed patch between two rows.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { throw new Error("not in this test"); } } }));

import type { LatLng2 } from "@/lib/geo";
import type { PhotoPixels } from "@/lib/photoScout/pattern";
import type { WeedInstance, WeedVisionResult } from "@/lib/weedVision/client";
import { type FieldRows, fieldReadPlan } from "@/lib/weedVision/fieldRows";
import type { SavedFrameRun } from "@/lib/weedVision/frameRunCache";
import { resetFrameRunStore, setFrameRunBoundary, setFrameRunMap } from "@/lib/weedVision/frameRunStore";
import type { GroundPlant } from "@/lib/weedVision/frames";
import { latLngOfPx, mercatorPx } from "@/lib/weedVision/mapRun";
import { DEFAULT_ROUTER, planWindows, routeWindows, seeded } from "@/lib/weedVision/twoStage/router";
import { type CellLabel, patchesOf, scoreTwoStage, wilson } from "@/lib/weedVision/twoStage/score";
import { cellAt, cellKey, fillConvex, readStage1, rowBandMask } from "@/lib/weedVision/twoStage/stage1";
import { mergeSeamDuplicates } from "@/lib/weedVision/twoStage/seams";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { TwoStagePanel } from "@/components/app/weedVision/TwoStagePanel";
import { getTwoStage, importLabels, exportLabels, labelCell, nextRandomCell, resetTwoStageStore, runStage1, runStage2 } from "@/lib/weedVision/twoStage/twoStageStore";

const LAT = 37.6, LNG = -78.4; // Virginia
const SIDE_M = 40;
const dLat = SIDE_M / 111_320, dLng = SIDE_M / (111_320 * Math.cos((LAT * Math.PI) / 180));
const RING: LatLng2[] = [{ lat: LAT, lng: LNG }, { lat: LAT, lng: LNG + dLng }, { lat: LAT - dLat, lng: LNG + dLng }, { lat: LAT - dLat, lng: LNG }];
const PLAN = fieldReadPlan([RING], 23, LAT)!;
const M = PLAN.mpp;
// Rows run west to east at 2.5, 7.5, ... m south of the field's north edge; trees every 4 m, crowns 0.9 m.
const ROW_Y = [2.5, 7.5, 12.5, 17.5, 22.5, 27.5, 32.5, 37.5];
const TREES = ROW_Y.flatMap(y => Array.from({ length: 10 }, (_, k) => ({ x: 2 + 4 * k, y })));
const CROWN_M = 0.9;
// The weed patch: 4 m by 1.6 m between the rows at 2.5 and 7.5 m.
const PATCH = { x0: 10, x1: 14, y0: 4.2, y1: 5.8 };

/** The synthetic map at the read zoom: brown soil, green crowns and the green patch. Global pixels in, RGBA out. */
function draw(_tile: unknown, z: number, gx: number, gy: number, w: number, h: number): Promise<PhotoPixels> {
  expect(z).toBe(PLAN.z);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const mx = (gx + x + 0.5 - PLAN.left) * M, my = (gy + y + 0.5 - PLAN.top) * M;
    const inPatch = mx >= PATCH.x0 && mx < PATCH.x1 && my >= PATCH.y0 && my < PATCH.y1;
    const inTree = TREES.some(t => (mx - t.x) ** 2 + (my - t.y) ** 2 <= CROWN_M ** 2);
    const o = (y * w + x) * 4;
    const [r, g, b] = inPatch || inTree ? [60, 160, 50] : [150, 115, 80];
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
  }
  return Promise.resolve({ width: w, height: h, rgba });
}

const ROWS: FieldRows = {
  z: PLAN.z, left: PLAN.left, top: PLAN.top, mpp: M, rows: ROW_Y.length, spacingM: 5, seedSpacingM: 4, directionDeg: 0, blocks: 1,
  ctx: { lines: ROW_Y.map(y => ({ x1: 0, y1: y / M, x2: SIDE_M / M, y2: y / M })), crops: TREES.map(t => ({ x: t.x / M, y: t.y / M, r: CROWN_M / M })), bandPx: 1.1 / M, gsdM: M },
};
const at = (mx: number, my: number) => latLngOfPx(PLAN.left + mx / M, PLAN.top + my / M, PLAN.z);
const keyAt = (g: { z: number }, s: Awaited<ReturnType<typeof readStage1>>, mx: number, my: number) => {
  const p = at(mx, my);
  const [X, Y] = mercatorPx(p.lat, p.lng, s!.grid.z);
  const c = cellAt(s!.grid, X, Y)!;
  return cellKey(c.i, c.j);
};

describe("stage 1: pressure between the rows", () => {
  it("paints the row band: a line widened to its band, ends rounded", () => {
    const rows: FieldRows = { ...ROWS, left: 0, top: 0, ctx: { lines: [{ x1: 10, y1: 20, x2: 50, y2: 20 }], crops: [], bandPx: 3, gsdM: 0.03 } };
    const m = rowBandMask(rows, rows.z, 0, 0, 64, 40);
    expect(m[20 * 64 + 30]).toBe(1);
    expect(m[22 * 64 + 30]).toBe(1);
    expect(m[25 * 64 + 30]).toBe(0);
    expect(m[20 * 64 + 8]).toBe(1); // the rounded end
    expect(m[20 * 64 + 2]).toBe(0);
    const sq = new Uint8Array(100);
    fillConvex(sq, 10, 10, [[2, 2], [8, 2], [8, 8], [2, 8]]);
    expect(sq.reduce((s, v) => s + v, 0)).toBe(36);
  });

  it("flags the weed patch between the rows and never a tree on a row", async () => {
    const s = await readStage1({ rings: [RING], tile: () => "", maxNative: 23, lat: LAT, rows: ROWS, draw });
    expect(s).not.toBeNull();
    expect(s!.rowsUsed).toBe(true);
    const flagged = new Set(s!.hotspots.flatMap(h => h.cells));
    expect(flagged.has(keyAt(PLAN, s, 12, 5))).toBe(true);
    for (const t of TREES.slice(0, 20)) expect(flagged.has(keyAt(PLAN, s, t.x, t.y))).toBe(false);
    const patch = s!.hotspots.find(h => h.cells.includes(keyAt(PLAN, s, 12, 5)))!;
    expect(patch.offRowGreenM2).toBeGreaterThan(0.8 * (PATCH.x1 - PATCH.x0) * (PATCH.y1 - PATCH.y0));
    expect(patch.offRowGreenM2).toBeLessThan(1.2 * (PATCH.x1 - PATCH.x0) * (PATCH.y1 - PATCH.y0));
    expect(s!.summary.reasons["no rows"]).toBe(0);
    // A cell holding a crown with bare soil beside it is judged on that soil: not uncertain, and no pressure (the crown is out of the count).
    const treeCell = s!.cells.find(c => c.key === keyAt(PLAN, s, 2, 2.5))!;
    expect(treeCell.uncertain).not.toContain("mostly crop row");
    expect(treeCell.pressure).toBeLessThan(0.02);
  });

  it("cells the read rows do not reach are 'no rows', even when rows were read elsewhere in the field", async () => {
    // Rows read only in the northern half (the first four rows): the south is unexplained, not confident.
    const north: FieldRows = { ...ROWS, ctx: { ...ROWS.ctx, lines: ROWS.ctx.lines.slice(0, 4), crops: ROWS.ctx.crops.filter(c => c.y * M < 20) } };
    const s = await readStage1({ rings: [RING], tile: () => "", maxNative: 23, lat: LAT, rows: north, draw });
    const cell = (mx: number, my: number) => s!.cells.find(c => c.key === keyAt(PLAN, s, mx, my))!;
    expect(cell(12, 5).uncertain).not.toContain("no rows");
    expect(cell(12, 21).uncertain).not.toContain("no rows"); // within one spacing of the last row read
    expect(cell(12, 35).uncertain).toContain("no rows");
    const r = routeWindows(planWindows([RING], 23, 680), s!);
    const southKey = keyAt(PLAN, s, 12, 35);
    expect([...r.cellsOf.entries()].filter(([, cs]) => cs.includes(southKey)).every(([wn]) => r.reasons[wn] !== "skipped")).toBe(true);
  });

  it("without rows every cell is uncertain and the trees become candidates", async () => {
    const s = await readStage1({ rings: [RING], tile: () => "", maxNative: 23, lat: LAT, rows: null, draw });
    expect(s!.rowsUsed).toBe(false);
    expect(s!.summary.uncertainShare).toBe(1);
    expect(new Set(s!.hotspots.flatMap(h => h.cells)).has(keyAt(PLAN, s, 2, 2.5))).toBe(true);
  });
});

describe("stage 2 routing", () => {
  it("inspects candidate and uncertain windows, audits a seeded, spread-out share of the rest", async () => {
    const s = (await readStage1({ rings: [RING], tile: () => "", maxNative: 23, lat: LAT, rows: ROWS, draw }))!;
    const windows = planWindows([RING], 23, 680);
    expect(windows[0].size).toBe(680 - 192);
    const r = routeWindows(windows, s);
    const patchKey = keyAt(PLAN, s, 12, 5);
    const patchWindows = windows.filter(w => r.cellsOf.get(w.name)!.includes(patchKey));
    expect(patchWindows.length).toBeGreaterThan(0);
    expect(patchWindows.every(w => r.reasons[w.name] === "hotspot")).toBe(true);
    const eligible = windows.filter(w => r.reasons[w.name] === "skipped" || r.reasons[w.name] === "audit").filter(w => r.cellsOf.get(w.name)!.length);
    expect(r.counts.audit).toBe(Math.min(eligible.length, Math.max(DEFAULT_ROUTER.auditMin, Math.ceil(DEFAULT_ROUTER.auditShare * eligible.length))));
    expect(routeWindows(windows, s).reasons).toEqual(r.reasons); // the same seed draws the same audit
    expect(routeWindows(windows, s, { ...DEFAULT_ROUTER, seed: 7 }).order).not.toEqual(r.order.length > 6 ? [] : r.order);
    expect(r.order[0] && r.reasons[r.order[0]]).toBe("hotspot");
    // Rows are in nearly every window of an orchard; they must not send every window to the model.
    expect(r.order.length).toBeLessThan(0.6 * windows.length);
    expect(seeded(1)()).toBe(seeded(1)());
  });
});

describe("seam duplicates", () => {
  const plant = (id: string, frame: string, mx: number, my: number, areaM2: number, score = 0.8): GroundPlant => ({ id, frame, instanceId: 1, klass: "weed", score, scoreKind: "d", nativePolygon: [], nativeCentroid: [0, 0], nativeBbox: [0, 0, 0, 0], areaPx: 1, equivalentDiameterPx: 1, ring: null, centre: at(mx, my), gsdM: 0.015, areaM2, diameterM: 2 * Math.sqrt(areaM2 / Math.PI), viewAngleDeg: 0, status: "ok", flags: [], tiny: false, touchesBorder: false, fusedFromTiles: 1, rowStatus: "off-row", seenIn: [frame], duplicates: 0 });
  it("keeps one of a plant two windows both kept across their seam, and nothing else", () => {
    const out = mergeSeamDuplicates([
      plant("a", "map/w/1_1", 10, 10, 0.86, 0.9), plant("b", "map/w/2_1", 10.03, 10, 0.862, 0.7), // the same plant, 3 cm apart
      plant("c", "map/w/1_1", 20, 10, 0.06), plant("d", "map/w/1_1", 20.04, 10, 0.06), // two plants in one window
      plant("e", "map/w/1_1", 30, 10, 2.35), plant("f", "map/w/2_1", 30.4, 10, 0.07), // a big plant and a cut piece: left alone
      plant("g", "map/w/1_1", 40, 10, 0.1), plant("h", "map/w/2_1", 41, 10, 0.1), // a metre apart: two plants
    ]);
    expect(out.map(p => p.id).sort()).toEqual(["a", "c", "d", "e", "f", "g", "h"]);
    const a = out.find(p => p.id === "a")!;
    expect(a.duplicates).toBe(1);
    expect(a.seenIn).toEqual(["map/w/1_1", "map/w/2_1"]);
  });
});

describe("scorecard", () => {
  it("states a Wilson interval and refuses label figures under 30 labels", async () => {
    const w = wilson(0, 30)!;
    expect(w.p).toBe(0);
    expect(w.hi).toBeCloseTo(0.1135, 3);
    expect(wilson(0, 0)).toBeNull();
    const s = (await readStage1({ rings: [RING], tile: () => "", maxNative: 23, lat: LAT, rows: ROWS, draw }))!;
    const windows = planWindows([RING], 23, 680);
    const routing = routeWindows(windows, s);
    const labels: Record<string, CellLabel> = {};
    s.cells.slice(0, 10).forEach(c => { labels[c.key] = { coverClass: 0, highPriority: false, at: "" }; });
    const few = scoreTwoStage({ stage1: s, routing, plants: [], ran: new Map(), allWindows: windows.map(x => x.name), labels });
    expect(few.labels!.enough).toBe(false);
    expect(few.vsReference).toBeNull();
  });

  it("counts a reference patch outside every inspected window as missed, and high priority on its own", async () => {
    const s = (await readStage1({ rings: [RING], tile: () => "", maxNative: 23, lat: LAT, rows: ROWS, draw }))!;
    const windows = planWindows([RING], 23, 680);
    const routing = routeWindows(windows, s, { ...DEFAULT_ROUTER, auditShare: 0, auditMin: 0 });
    // The reference saw the patch, plus a big hidden patch Stage 1 cannot see (say, under a cover crop) far from it.
    const plant = (mx: number, my: number, areaM2: number): GroundPlant => ({ id: `p${mx}-${my}`, frame: "map/x", instanceId: 1, klass: "weed", score: 0.9, scoreKind: "d", nativePolygon: [], nativeCentroid: [0, 0], nativeBbox: [0, 0, 0, 0], areaPx: 1, equivalentDiameterPx: 1, ring: null, centre: at(mx, my), gsdM: 0.01, areaM2, diameterM: 0.1, viewAngleDeg: 0, status: "ok", flags: [], tiny: false, touchesBorder: false, fusedFromTiles: 1, rowStatus: "off-row", seenIn: ["map/x"], duplicates: 0 });
    const hidden = [];
    for (let x = 31; x <= 37; x += 2) for (let y = 30; y <= 35; y += 2) hidden.push(plant(x, y, 2)); // 50% cover over about 30 m²
    const plants = [plant(12, 5, 2), ...hidden];
    const ran = new Map(windows.map(w => [w.name, 100]));
    const rep = scoreTwoStage({ stage1: s, routing, plants, ran, allWindows: windows.map(w => w.name) });
    expect(rep.vsReference).not.toBeNull();
    const vr = rep.vsReference!;
    expect(vr.patches).toBeGreaterThanOrEqual(2);
    expect(vr.recallRouted!.k).toBeLessThan(vr.recallRouted!.n);
    expect(vr.missed.some(m => m.highPriority)).toBe(true);
    expect(vr.highPriorityRecallRouted!.k).toBeLessThan(vr.highPriorityRecallRouted!.n);
    expect(rep.cost.gpuShare).toBeCloseTo(routing.order.length / windows.length, 6);
    const cellM2 = (s.grid.cellPx * s.grid.mpp) ** 2;
    expect(patchesOf(new Map([["0:0", 0.3], ["1:1", 0.3], ["5:5", 0.02]]), cellM2)).toHaveLength(1);
  });
});

describe("the prototype's session", () => {
  beforeEach(() => { resetFrameRunStore(); resetTwoStageStore(); try { localStorage.clear(); } catch { /* none */ } });
  afterEach(() => { resetFrameRunStore(); resetTwoStageStore(); });

  function deps() {
    const store = new Map<string, SavedFrameRun>();
    const inst = (x: number, y: number): WeedInstance => ({ id: 1, centroid_px: [x, y], bbox_px: [x - 5, y - 5, x + 5, y + 5], area_px: 80, max_span_px: null, span_endpoints_px: null, perpendicular_span_px: null, obb: null, equivalent_diameter_px: 10, solidity: null, pieces: 1, touches_border: false, tiny: false, score: 0.8, score_kind: "detector_confidence", polygons_px: [[[x - 5, y - 5], [x + 5, y - 5], [x + 5, y + 5], [x - 5, y + 5]]], flags: [], class: "weed", fused_from_tiles: 1 });
    const detect = vi.fn(async () => ({ ok: true as const, value: { instances: [inst(340, 340)], crop_instances: [], image: { width: 680, height: 680 }, algorithm: { name: "rfdetr_seg_large" }, timings_ms: { total: 130 } } as unknown as WeedVisionResult }));
    const save = vi.fn(async ({ paramsKey, run }: { paramsKey: string; run: SavedFrameRun }) => { store.set(`${paramsKey}|${run.filename}`, run); return { ok: true as const }; });
    return {
      detect, save, store,
      deps: {
        readStage1: (i: Parameters<typeof readStage1>[0]) => readStage1({ ...i, draw }),
        ensureRows: async () => undefined,
        rowsOf: () => ROWS,
        mapChunk: vi.fn(async () => ({ pixels: { width: 4, height: 4, rgba: new Uint8ClampedArray(64) }, image: new Blob([new Uint8Array(4)]), coverage: 1 })),
        detect,
        cache: {
          load: async (_scan: string, key: string) => new Map([...store.entries()].filter(([k]) => k.startsWith(`${key}|`)).map(([k, v]) => [k.slice(key.length + 1), v])),
          save,
        },
      },
    };
  }
  const PARAMS = { algorithm: "rfdetr_seg_large", threshold: 0.5, tile: 1024, overlap: 256, scale: 1 };

  it("reads Stage 1, runs only the routed windows, then the rest for the reference, never a window twice", async () => {
    setFrameRunMap("t", { tile: () => "", maxNative: 23, lat: LAT, lng: LNG });
    setFrameRunBoundary("t", [RING]);
    const f = deps();
    await runStage1("t", { params: PARAMS, modelSha: "abc", photoGsdM: null, deps: f.deps as never });
    const s1 = getTwoStage("t");
    expect(s1.stage1State).toBe("done");
    expect(s1.tilePx).toBe(680); // 1.48 cm map, 1 cm target: 1024 / 1.5
    expect(s1.paramsKey!.startsWith("two-stage|map|")).toBe(true);
    runStage2("t", { userId: "u", mode: "routed", deps: f.deps as never });
    await vi.waitFor(() => expect(getTwoStage("t").running).toBe(false));
    const routed = s1.routing!.order.length;
    expect(f.detect).toHaveBeenCalledTimes(routed);
    const opts = (f.detect.mock.calls as unknown as unknown[][]).map(c => c[2] as { tile: number; overlap: number; geometry: string });
    expect(opts.every(o => o.tile === 680 && o.overlap === 0 && o.geometry === "lite")).toBe(true);
    expect(getTwoStage("t").stage2!.done).toBe(routed);
    runStage2("t", { userId: "u", mode: "everywhere", deps: f.deps as never });
    await vi.waitFor(() => expect(getTwoStage("t").running).toBe(false));
    expect(f.detect).toHaveBeenCalledTimes(s1.windows.length);
    expect(Object.keys(getTwoStage("t").runs)).toHaveLength(s1.windows.length);
    expect(f.save).toHaveBeenCalledTimes(s1.windows.length);
    // Again from the cache: Stage 1 restores every window, nothing is sent to the model.
    resetTwoStageStore();
    await runStage1("t", { params: PARAMS, modelSha: "abc", photoGsdM: null, deps: f.deps as never });
    expect(Object.keys(getTwoStage("t").runs)).toHaveLength(s1.windows.length);
    expect(f.detect).toHaveBeenCalledTimes(s1.windows.length);
  });

  it("keeps blind labels per grid, draws random cells reproducibly, and round-trips them through a file", async () => {
    setFrameRunMap("t", { tile: () => "", maxNative: 23, lat: LAT, lng: LNG });
    setFrameRunBoundary("t", [RING]);
    await runStage1("t", { params: PARAMS, modelSha: "abc", photoGsdM: null, deps: deps().deps as never });
    const a = nextRandomCell("t");
    expect(a).toBeTruthy();
    expect(getTwoStage("t").focus).not.toBeNull();
    labelCell("t", a!, { coverClass: 3, highPriority: true });
    const file = exportLabels("t")!;
    expect(file.labels).toHaveLength(1);
    expect(file.labels[0]).toMatchObject({ cell: a, coverClass: 3, highPriority: true });
    labelCell("t", a!, null);
    expect(getTwoStage("t").labels).toEqual({});
    expect(importLabels("t", file)).toBe(1);
    expect(importLabels("t", { ...file, grid: "other" })).toBe(0);
    expect(getTwoStage("t").labels[a!].coverClass).toBe(3);
  });

  it("shows the summary, the route and the scorecard without claiming accuracy", async () => {
    setFrameRunMap("t", { tile: () => "", maxNative: 23, lat: LAT, lng: LNG });
    setFrameRunBoundary("t", [RING]);
    const f = deps();
    await runStage1("t", { params: PARAMS, modelSha: "abc", photoGsdM: null, deps: f.deps as never });
    runStage2("t", { userId: "u", mode: "routed", deps: f.deps as never });
    await vi.waitFor(() => expect(getTwoStage("t").running).toBe(false));
    const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    render(createElement(TwoStagePanel, { taskId: "t", userId: "u", sources: null, fetchImpl: down }));
    expect(screen.getByTestId("two-stage-summary").textContent).toMatch(/candidate area/);
    expect(screen.getByTestId("two-stage-panel").textContent).toMatch(/No field has been validated yet/);
    expect(screen.getByTestId("two-stage-report").textContent).toMatch(/Run the reference once to compare/);
    expect(screen.getByTestId("two-stage-audit").textContent).toMatch(/not a measured miss rate/);
  });
});
