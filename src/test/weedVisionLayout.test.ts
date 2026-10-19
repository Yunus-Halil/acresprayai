// The field's planting layout: three clicks, the whole planting found, nothing else taken for the crop.
// A synthetic orchard with what broke the automatic row reader on real frames: two blocks at different angles,
// a weed strip along a track, missing trees, weed clumps touching crowns.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { throw new Error("not in this test"); } } }));

import type { LatLng2 } from "@/lib/geo";
import { rowStatusOf } from "@/lib/weedVision/rowFilter";
import { type LayoutRaster, fillPolygon, fitLayout, fitLayoutAll, latticeFromClicks, layoutsToFieldRows } from "@/lib/weedVision/layout/plantingLayout";
import { betweenRowsPainter, paintRowBand, rowBandMask } from "@/lib/weedVision/layout/rowBand";
import { fitPlantingLayout, proposeFromRows } from "@/lib/weedVision/layout/readLayout";
import { addClick, getLayoutUi, resetLayoutUi, saveLayout, startMarking } from "@/lib/weedVision/layout/layoutUi";
import { ensureFieldRows, frameRunFieldRows, getFrameRun, refinedLayoutBlocks, rereadFieldRows, resetFrameRunStore, setFieldRowsReaders, setFrameRunBoundary, setFrameRunLayout, setFrameRunMap, startMapRun } from "@/lib/weedVision/frameRunStore";
import { rowsSignature } from "@/lib/weedVision/layout/rowBand";
import { latLngOfPx, mercatorPx } from "@/lib/weedVision/mapRun";

const MPP = 0.08; // raster metres per pixel
const W = 750, H = 500; // 60 m x 40 m
const Z = 22, LEFT = 1_000_000, TOP = 1_600_000, SCALE = 3; // raster pixel = 3 global px at zoom 22 (about 2.7 cm each)
const deg = Math.PI / 180;

type Tree = { x: number; y: number; r: number }; // metres
/** Block A: rows 5 m apart, trees 3.2 m apart, at 4 degrees, in the north half; block B at 15 degrees in the south. */
function orchard(missing = new Set<string>()) {
  const trees: (Tree & { block: "A" | "B"; key: string })[] = [];
  const add = (block: "A" | "B", ox: number, oy: number, ang: number, rows: number, per: number, ymin: number, ymax: number) => {
    const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
    for (let j = 0; j < rows; j++) for (let i = 0; i < per; i++) {
      const x = ox + i * 3.2 * ux + j * 5 * nx, y = oy + i * 3.2 * uy + j * 5 * ny;
      if (x < 1 || x > 59 || y < ymin || y > ymax) continue;
      const key = `${block}${i},${j}`;
      if (missing.has(key)) continue;
      trees.push({ x, y, r: 0.8, block, key });
    }
  };
  add("A", 2, 2.5, 4 * deg, 4, 18, 0, 19);
  add("B", 2, 24, 15 * deg, 4, 18, 23, 40);
  const green = new Uint8Array(W * H);
  const set = (x: number, y: number) => { const xi = Math.floor(x / MPP), yi = Math.floor(y / MPP); if (xi >= 0 && yi >= 0 && xi < W && yi < H) green[yi * W + xi] = 255; };
  for (const t of trees) for (let dy = -t.r; dy <= t.r; dy += MPP / 2) for (let dx = -t.r; dx <= t.r; dx += MPP / 2) if (dx * dx + dy * dy <= t.r * t.r) set(t.x + dx, t.y + dy);
  // A weed strip along a track between the blocks (continuous green), and weed clumps between rows, two touching crowns.
  for (let x = 0; x < 60; x += MPP / 2) for (let w = 0; w < 0.6; w += MPP / 2) set(x, 20.5 + 0.08 * x + w);
  const weeds = [{ x: 10, y: 5.2 }, { x: 30, y: 12.4 }, { x: 45, y: 7.6 }];
  for (const p of weeds) for (let dy = -0.4; dy <= 0.4; dy += MPP / 2) for (let dx = -0.4; dx <= 0.4; dx += MPP / 2) set(p.x + dx, p.y + dy);
  const inField = new Uint8Array(W * H);
  fillPolygon(inField, W, H, [[0, 0], [W, 0], [W, H], [0, H]]);
  const r: LayoutRaster = { z: Z, left: LEFT, top: TOP, scale: SCALE, mpp: MPP, w: W, h: H, green, inField };
  return { r, trees, weeds };
}
const px = (x: number, y: number): [number, number] => [x / MPP, y / MPP];
const treeA = (trees: (Tree & { key: string })[], k: string) => trees.find(t => t.key === `A${k}`)!;
const treeB = (trees: (Tree & { key: string })[], k: string) => trees.find(t => t.key === `B${k}`)!;

describe("the planting from three clicks", () => {
  it("finds block A's trees and gaps, follows nothing into block B or along the weed strip", () => {
    const { r, trees } = orchard(new Set(["A5,1", "A9,2"]));
    const a = treeA(trees, "6,1"), b = treeA(trees, "7,1"), c = treeA(trees, "6,2");
    const fit = fitLayout(latticeFromClicks(px(a.x, a.y), px(b.x, b.y), px(c.x, c.y))!, r);
    expect(fit.lattice.along * MPP).toBeCloseTo(3.2, 1);
    expect(Math.abs(fit.lattice.across) * MPP).toBeCloseTo(5, 1);
    const near = (t: { x: number; y: number }, pts: { x: number; y: number }[], m = 0.4) => pts.some(p => Math.hypot(p.x * MPP - t.x, p.y * MPP - t.y) <= m);
    const A = trees.filter(t => t.block === "A"), B = trees.filter(t => t.block === "B");
    expect(A.filter(t => near(t, fit.plants)).length / A.length).toBeGreaterThan(0.9);
    expect(B.filter(t => near(t, fit.plants)).length).toBe(0);
    // The two removed trees are gaps, not plants.
    const gap = (k: string) => { const i = Number(k.split(",")[0]), j = Number(k.split(",")[1]); const ux = Math.cos(4 * deg), uy = Math.sin(4 * deg); return { x: 2 + i * 3.2 * ux - j * 5 * uy, y: 2.5 + i * 3.2 * uy + j * 5 * ux }; };
    for (const k of ["5,1", "9,2"]) expect(near(gap(k), fit.gaps, 0.6)).toBe(true);
    // Nothing on the weed strip (y about 20.5 to 25).
    expect(fit.plants.every(p => p.y * MPP < 20)).toBe(true);
  });

  it("two plantings marked: both found, neither takes the other's trees; the rows put trees on the crop and weeds between them", () => {
    const { r, trees, weeds } = orchard();
    const a1 = treeA(trees, "6,1"), b1 = treeA(trees, "7,1"), c1 = treeA(trees, "6,2");
    const a2 = treeB(trees, "6,1"), b2 = treeB(trees, "7,1"), c2 = treeB(trees, "6,2");
    const fits = [fitLayout(latticeFromClicks(px(a1.x, a1.y), px(b1.x, b1.y), px(c1.x, c1.y))!, r), fitLayout(latticeFromClicks(px(a2.x, a2.y), px(b2.x, b2.y), px(c2.x, c2.y))!, r)];
    const rows = layoutsToFieldRows(fits, r)!;
    expect(rows.source).toBe("layout");
    expect(rows.blocks).toBe(2);
    // Frame pixels are global pixels at zoom 22 less the origin; a tree's place in them is metres / mpp * SCALE.
    const f = (t: { x: number; y: number }) => [(t.x / MPP) * SCALE, (t.y / MPP) * SCALE] as const;
    const onCrop = trees.filter(t => { const s = rowStatusOf(rows.ctx, ...f(t)); return s === "on-crop" || s === "on-row"; }).length;
    expect(onCrop / trees.length).toBeGreaterThan(0.9);
    for (const w of weeds) expect(rowStatusOf(rows.ctx, ...f(w))).toBe("off-row");
  });

  it("reports tree-sized green the layout does not cover (block B when only A is marked)", async () => {
    const { r, trees } = orchard();
    const a = treeA(trees, "6,1"), b = treeA(trees, "7,1"), c = treeA(trees, "6,2");
    const ll = (t: Tree): LatLng2 => latLngOfPx(LEFT + (t.x / MPP) * SCALE, TOP + (t.y / MPP) * SCALE, Z);
    const out = fitPlantingLayout(r, { version: 1, blocks: [{ points: [ll(a), ll(b), ll(c)] }], confirmedAt: null });
    expect(out.rows!.unexplained.length).toBeGreaterThan(10);
    expect(out.rows!.unexplained.every(u => (u.y / SCALE) * MPP > 19)).toBe(true); // all of them south of block A
    // The plantings as refined, to be saved: three points, the first within a tree spacing of the first click.
    const [p0] = out.blocks[0].points;
    const [X, Y] = mercatorPx(p0.lat, p0.lng, Z);
    expect(Math.hypot(((X - LEFT) / SCALE) * MPP - a.x, ((Y - TOP) / SCALE) * MPP - a.y)).toBeLessThan(3.3);
  });
});

describe("the spacing is the clue", () => {
  /** Big trees on every second row, young 0.5 m trees on the rows between (out of step by half a plant spacing), 60 x 40 m. */
  function alternating(missingSmall = new Set<string>()) {
    const trees: (Tree & { kind: "big" | "small"; key: string })[] = [];
    const ang = 6 * deg, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
    for (let j = 0; j < 14; j++) for (let i = 0; i < 20; i++) {
      const big = j % 2 === 0;
      const x = 2 + (i + (big ? 0 : 0.5)) * 3.2 * ux + j * 2.6 * nx, y = 3 + (i + (big ? 0 : 0.5)) * 3.2 * uy + j * 2.6 * ny;
      if (x < 1 || x > 59 || y < 1 || y > 39) continue;
      const key = `${i},${j}`;
      if (!big && missingSmall.has(key)) continue;
      trees.push({ x, y, r: big ? 0.9 : 0.3, kind: big ? "big" : "small", key });
    }
    const green = new Uint8Array(W * H);
    const set = (x: number, y: number) => { const xi = Math.floor(x / MPP), yi = Math.floor(y / MPP); if (xi >= 0 && yi >= 0 && xi < W && yi < H) green[yi * W + xi] = 255; };
    for (const t of trees) for (let dy = -t.r; dy <= t.r; dy += MPP / 2) for (let dx = -t.r; dx <= t.r; dx += MPP / 2) if (dx * dx + dy * dy <= t.r * t.r) set(t.x + dx, t.y + dy);
    // A few weed clumps between the rows.
    for (const p of [{ x: 20, y: 9.2 }, { x: 40, y: 24.8 }]) for (let dy = -0.4; dy <= 0.4; dy += MPP / 2) for (let dx = -0.4; dx <= 0.4; dx += MPP / 2) set(p.x + dx, p.y + dy);
    const inField = new Uint8Array(W * H);
    fillPolygon(inField, W, H, [[0, 0], [W, 0], [W, H], [0, H]]);
    const r: LayoutRaster = { z: Z, left: LEFT, top: TOP, scale: SCALE, mpp: MPP, w: W, h: H, green, inField };
    return { r, trees };
  }
  const near = (t: { x: number; y: number }, pts: { x: number; y: number }[], m = 0.4) => pts.some(p => Math.hypot(p.x * MPP - t.x, p.y * MPP - t.y) <= m);

  it("clicks on two big rows (skipping the young row between) still find every row, the young trees included", () => {
    const { r, trees } = alternating(new Set(["7,3", "12,5"]));
    const t = (k: string) => trees.find(x => x.key === k)!;
    const a = t("6,4"), b = t("7,4"), c = t("6,6"); // big row, neighbour, next BIG row: 5.2 m across, the young row at 2.6 m skipped
    const fits = fitLayoutAll(latticeFromClicks(px(a.x, a.y), px(b.x, b.y), px(c.x, c.y))!, r);
    expect(fits.length).toBeGreaterThanOrEqual(2); // the clicked rows and the rows between them
    const plants = fits.flatMap(f => f.plants);
    const big = trees.filter(x => x.kind === "big"), small = trees.filter(x => x.kind === "small");
    expect(big.filter(x => near(x, plants)).length / big.length).toBeGreaterThan(0.9);
    expect(small.filter(x => near(x, plants)).length / small.length).toBeGreaterThan(0.85);
    const rows = layoutsToFieldRows(fits, r)!;
    expect(rows.rows).toBeGreaterThanOrEqual(13);
    expect(rows.spacingM).toBeCloseTo(2.6, 0); // the field's spacing, not the clicks'
  });

  it("clicks on a tree and the one after next (skipping a tree) still find every tree", () => {
    const { r, trees } = orchard();
    const a = treeA(trees, "6,1"), b = treeA(trees, "8,1"), c = treeA(trees, "6,2"); // 6.4 m along instead of 3.2
    const fit = fitLayout(latticeFromClicks(px(a.x, a.y), px(b.x, b.y), px(c.x, c.y))!, r);
    expect(fit.lattice.along * MPP).toBeCloseTo(3.2, 1);
    const A = trees.filter(t => t.block === "A");
    expect(A.filter(t => near(t, fit.plants)).length / A.length).toBeGreaterThan(0.9);
  });

  it("does not invent rows between rows when the alleys are bare, nor plants between plants that stand apart", () => {
    const { r, trees } = orchard();
    const a = treeA(trees, "6,1"), b = treeA(trees, "7,1"), c = treeA(trees, "6,2");
    const fits = fitLayoutAll(latticeFromClicks(px(a.x, a.y), px(b.x, b.y), px(c.x, c.y))!, r);
    expect(fits).toHaveLength(1);
    expect(fits[0].lattice.along * MPP).toBeCloseTo(3.2, 1);
    expect(Math.abs(fits[0].lattice.across) * MPP).toBeCloseTo(5, 1);
  });
});

describe("only between the rows", () => {
  it("paints the row band over with the picture's bare ground and nothing else", () => {
    const rows = { z: Z, left: 0, top: 0, mpp: 0.03, rows: 1, spacingM: 5, seedSpacingM: 3, directionDeg: 0, blocks: 1, source: "layout" as const, ctx: { lines: [{ x1: 0, y1: 20, x2: 64, y2: 20, band: 4 }], crops: [], bandPx: 4, gsdM: 0.03 } };
    const w = 64, h = 40, rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { rgba.set(i % 5 === 0 ? [60, 160, 50, 255] : [150, 115, 80, 255], i * 4); }
    const band = rowBandMask(rows, Z, 0, 0, w, h);
    const n = paintRowBand(rgba, w, h, band);
    expect(n).toBeGreaterThan(0);
    const at = (x: number, y: number) => Array.from(rgba.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
    expect(at(15, 20)).toEqual([150, 115, 80]); // a green pixel on the row (index divisible by 5) is now ground
    expect(at(5, 5)).toEqual([60, 160, 50]); // a green pixel off the band is untouched
    const p = betweenRowsPainter(rows);
    const again = new Uint8ClampedArray(w * h * 4).fill(200);
    p(again, w, h, 0, 0, Z);
    expect(Array.from(again.slice((20 * w + 3) * 4, (20 * w + 3) * 4 + 3))).toEqual([200, 200, 200]);
  });
});

describe("in the app", () => {
  beforeEach(() => { resetFrameRunStore(); resetLayoutUi(); try { localStorage.clear(); } catch { /* none */ } });
  afterEach(() => { resetFrameRunStore(); resetLayoutUi(); setFieldRowsReaders(null); });
  const LAT = 37.6, LNG = -78.4;
  function register(taskId: string) {
    const { r, trees } = orchard();
    // Move the synthetic raster to Virginia: the field's frame starts at the boundary's north-west corner.
    const [X, Y] = mercatorPx(LAT, LNG, Z);
    const rr = { ...r, left: Math.floor(X), top: Math.floor(Y) };
    const ll = (t: Tree): LatLng2 => latLngOfPx(rr.left + (t.x / MPP) * SCALE, rr.top + (t.y / MPP) * SCALE, Z);
    const ring = [latLngOfPx(rr.left, rr.top, Z), latLngOfPx(rr.left + W * SCALE, rr.top, Z), latLngOfPx(rr.left + W * SCALE, rr.top + H * SCALE, Z), latLngOfPx(rr.left, rr.top + H * SCALE, Z)];
    setFrameRunMap(taskId, { tile: () => "", maxNative: 23, lat: LAT, lng: LNG });
    setFrameRunBoundary(taskId, [ring]);
    return { rr, trees, ll };
  }

  it("three clicks become the scan's rows; a save keeps the refined planting; the map run looks only between the rows", async () => {
    const { rr, trees, ll } = register("t");
    const rasterReader = vi.fn(async () => rr);
    const reader = vi.fn(async () => null);
    setFieldRowsReaders({ reader, rasterReader });
    await ensureFieldRows("t");
    expect(getFrameRun("t").fieldRowsState).toBe("none");
    startMarking("t");
    addClick("t", ll(treeA(trees, "6,1")));
    addClick("t", ll(treeA(trees, "7,1")));
    expect(getLayoutUi("t").clicks).toHaveLength(2);
    addClick("t", ll(treeA(trees, "6,2")));
    expect(getLayoutUi("t").clicking).toBe(false);
    expect(getLayoutUi("t").unsaved).toBe(true);
    await vi.waitFor(() => expect(getFrameRun("t").fieldRowsSource).toBe("layout"));
    expect(rasterReader).toHaveBeenCalledTimes(1); // read once, kept for the next fit
    const s = getFrameRun("t");
    expect(s.layoutStats!.plants).toBeGreaterThan(30);
    expect(s.layoutStats!.unexplained).toBeGreaterThan(0); // block B, not marked
    expect(refinedLayoutBlocks("t")).toHaveLength(1);
    const save = vi.fn(async () => ({ ok: true, savedTo: "field" as const }));
    await saveLayout("t", { fieldId: "f1", userId: "u", save });
    expect(save).toHaveBeenCalledTimes(1);
    expect((save.mock.calls[0] as unknown as [{ layout: { blocks: unknown[]; confirmedAt: string } }])[0].layout.confirmedAt).toBeTruthy();
    expect(getLayoutUi("t").unsaved).toBe(false);
    await vi.waitFor(() => expect(getFrameRun("t").fieldRowsSource).toBe("layout"));

    // The map run paints the rows over and keys its results apart.
    const mapChunk = vi.fn(async () => ({ pixels: { width: 4, height: 4, rgba: new Uint8ClampedArray(64) }, image: new Blob([new Uint8Array(4)]), coverage: 1 }));
    const detect = vi.fn(async () => ({ ok: true as const, value: { instances: [], crop_instances: [], image: { width: 4, height: 4 }, algorithm: { name: "rfdetr_seg_large" }, timings_ms: { total: 1 } } as never }));
    startMapRun("t", { userId: "u", params: { algorithm: "rfdetr_seg_large", threshold: 0.5, tile: 1024, overlap: 256, scale: 1 }, algorithmLabel: "RF-DETR", modelSha: "abc", photoGsdM: 0.01, passParams: { rowSpacingM: "auto", windowM: 6, minBlobAreaCm2: 1 },
      deps: { detect, mapChunk, mapRows: async () => null, download: async () => null, cache: { load: async () => new Map(), save: async () => ({ ok: true }), remove: async () => ({ ok: true }) } } as never });
    await vi.waitFor(() => expect(getFrameRun("t").running).toBe(false));
    expect(mapChunk.mock.calls.length).toBeGreaterThan(0);
    expect((mapChunk.mock.calls as unknown as unknown[][]).every(c => typeof c[4] === "function")).toBe(true);
    // The results are keyed on the rows they were painted around: other rows, other results.
    const rows = frameRunFieldRows("t")!;
    expect(getFrameRun("t").paramsKey!.endsWith(`|between-rows|${rowsSignature(rows)}`)).toBe(true);
    expect(rowsSignature({ ...rows, ctx: { ...rows.ctx, crops: rows.ctx.crops.slice(1) } })).not.toBe(rowsSignature(rows));
    // "Read the rows again": the same marks fitted again, the field read once more only if the map changed.
    const before = getFrameRun("t").layoutStats;
    rereadFieldRows("t");
    await vi.waitFor(() => expect(getFrameRun("t").fieldRowsState).toBe("found"));
    expect(rasterReader).toHaveBeenCalledTimes(1);
    expect(getFrameRun("t").layoutStats).toEqual(before);
  });

  it("proposes a planting from rows the reader found", () => {
    const rows = { z: Z, left: 0, top: 0, mpp: 0.03, rows: 3, spacingM: 5, seedSpacingM: 3, directionDeg: 0, blocks: 1,
      ctx: { lines: [], crops: [0, 1, 2].flatMap(j => [0, 1, 2, 3].map(i => ({ x: (i * 3) / 0.03, y: (j * 5) / 0.03, r: 20 }))), bandPx: 25, gsdM: 0.03 } };
    const b = proposeFromRows(rows)!;
    expect(b.points).toHaveLength(3);
    expect(setFrameRunLayout).toBeTypeOf("function");
    expect(frameRunFieldRows("none")).toBeNull();
  });
});
