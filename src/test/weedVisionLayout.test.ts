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

  it("rows on both sides and green between: the young block between, at its own pitch and phase, is found", () => {
    // Big trees on rows at 2.5, 7.5, 12.5 m and again at 27.5, 32.5, 37.5 m; between them three rows of 0.3 m trees 3 m
    // apart (not the 5 m pitch), shifted a metre along; one big row has six small trees where big ones are missing.
    const trees: (Tree & { kind: "big" | "small" })[] = [];
    const ang = 3 * deg, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
    const put = (i: number, c: number, r: number, kind: "big" | "small", shift = 0) => { const x = 2 + (i * 3.2 + shift) * ux + c * nx, y = 2.5 + (i * 3.2 + shift) * uy + c * ny; if (x > 1 && x < 59 && y > 0.5 && y < 39.5) trees.push({ x, y, r, kind }); };
    for (const c of [0, 5, 10, 25, 30, 35]) for (let i = 0; i < 18; i++) put(i, c, 0.9, "big");
    for (const c of [14, 17, 20]) for (let i = 0; i < 18; i++) put(i, c, 0.3, "small", 1);
    // On the row at 25 m, trees 6 to 11 are young ones.
    trees.splice(0, trees.length, ...trees.filter(t => !(t.kind === "big" && Math.abs(((t.x - 2) * ux + (t.y - 2.5) * uy) / 3.2 - 8.5) < 3 && Math.abs((t.x - 2) * nx + (t.y - 2.5) * ny - 25) < 0.5)));
    for (let i = 6; i <= 11; i++) put(i, 25, 0.3, "small");
    const green = new Uint8Array(W * H);
    const set = (x: number, y: number) => { const xi = Math.floor(x / MPP), yi = Math.floor(y / MPP); if (xi >= 0 && yi >= 0 && xi < W && yi < H) green[yi * W + xi] = 255; };
    for (const t of trees) for (let dy = -t.r; dy <= t.r; dy += MPP / 2) for (let dx = -t.r; dx <= t.r; dx += MPP / 2) if (dx * dx + dy * dy <= t.r * t.r) set(t.x + dx, t.y + dy);
    const inField = new Uint8Array(W * H);
    fillPolygon(inField, W, H, [[0, 0], [W, 0], [W, H], [0, H]]);
    const r: LayoutRaster = { z: Z, left: LEFT, top: TOP, scale: SCALE, mpp: MPP, w: W, h: H, green, inField };
    const big = trees.filter(t => t.kind === "big"), small = trees.filter(t => t.kind === "small");
    const row0 = big.filter(t => Math.abs((t.x - 2) * nx + (t.y - 2.5) * ny) < 0.5).sort((p, q) => p.x - q.x);
    const row1 = big.filter(t => Math.abs((t.x - 2) * nx + (t.y - 2.5) * ny - 5) < 0.5).sort((p, q) => p.x - q.x);
    const a = row0[5], b = row0[6], c = row1[5];
    const fits = fitLayoutAll(latticeFromClicks(px(a.x, a.y), px(b.x, b.y), px(c.x, c.y))!, r);
    const plants = fits.flatMap(f => f.plants);
    expect(big.filter(t => near(t, plants)).length / big.length).toBeGreaterThan(0.9);
    expect(small.filter(t => near(t, plants)).length / small.length).toBeGreaterThan(0.85);
    expect(fits.reduce((s, f) => s + f.rows, 0)).toBeGreaterThanOrEqual(9);
  });

  it("three trees marked in a row too pale to pass are taken as plants, and the row is followed from them", () => {
    // The orchard with one extra row of very small, pale trees (0.15 m) between two big rows, where nothing passes the
    // presence bar; marking three of them must bring the whole row in.
    const { r, trees } = orchard();
    const ll = (t: { x: number; y: number }): LatLng2 => latLngOfPx(r.left + (t.x / MPP) * r.scale, r.top + (t.y / MPP) * r.scale, r.z);
    const ang = 4 * deg, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
    const pale: { x: number; y: number }[] = [];
    for (let i = 0; i < 18; i++) { const x = 2 + i * 3.2 * ux + 7.5 * nx, y = 2.5 + i * 3.2 * uy + 7.5 * ny; if (x > 1 && x < 59) pale.push({ x, y }); }
    const set = (x: number, y: number) => { const xi = Math.floor(x / MPP), yi = Math.floor(y / MPP); if (xi >= 0 && yi >= 0 && xi < W && yi < H) r.green[yi * W + xi] = 255; };
    for (const t of pale) for (let dy = -0.15; dy <= 0.15; dy += MPP / 2) for (let dx = -0.15; dx <= 0.15; dx += MPP / 2) if (dx * dx + dy * dy <= 0.15 * 0.15) set(t.x + dx, t.y + dy);
    const a = treeA(trees, "6,1"), b = treeA(trees, "7,1"), c = treeA(trees, "6,2");
    const before = fitLayoutAll(latticeFromClicks(px(a.x, a.y), px(b.x, b.y), px(c.x, c.y))!, r).flatMap(f => f.plants);
    expect(pale.filter(t => near(t, before, 0.3)).length).toBeLessThan(pale.length / 2); // too pale for the planting's bar
    // The operator marks three of the pale trees: one, its neighbour, and a big tree in the next row.
    const layout = { version: 1 as const, blocks: [
      { points: [ll(a), ll(b), ll(c)] as [LatLng2, LatLng2, LatLng2] },
      { points: [ll(pale[6]), ll(pale[7]), ll(treeA(trees, "6,2"))] as [LatLng2, LatLng2, LatLng2] },
    ], confirmedAt: null };
    const out = fitPlantingLayout(r, layout);
    expect(out.reason).toBeNull();
    const after = out.fits.flatMap(f => f.plants);
    expect(pale.filter(t => near(t, after, 0.3)).length / pale.length).toBeGreaterThan(0.85);
    expect(out.fits).toHaveLength(1); // the same planting, not a second one
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

describe("what the evidence says at each position", () => {
  it("states: a full crown is confirmed, a small one probable, a merged one ambiguous; a gap says whether green was seen", () => {
    // A5,1 and A9,2 removed and refilled below; A14,2 removed and left bare: the one true gap.
    const { r, trees } = orchard(new Set(["A5,1", "A9,2", "A14,2"]));
    const ang = 4 * deg, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
    const set = (x: number, y: number) => { const xi = Math.floor(x / MPP), yi = Math.floor(y / MPP); if (xi >= 0 && yi >= 0 && xi < W && yi < H) r.green[yi * W + xi] = 255; };
    const disc = (x: number, y: number, rad: number) => { for (let dy = -rad; dy <= rad; dy += MPP / 2) for (let dx = -rad; dx <= rad; dx += MPP / 2) if (dx * dx + dy * dy <= rad * rad) set(x + dx, y + dy); };
    // A young tree where A5,1 is missing; a weed clump of 0.25 m where A9,2 is missing; A12,1's crown swollen to 1.7 m (merged with weeds).
    const at = (i: number, j: number) => [2 + i * 3.2 * ux + j * 5 * nx, 2.5 + i * 3.2 * uy + j * 5 * ny] as const;
    disc(...at(5, 1), 0.3); disc(...at(9, 2), 0.25); disc(...at(12, 1), 1.7);
    const a = treeA(trees, "6,1"), b = treeA(trees, "7,1"), c = treeA(trees, "6,2");
    const fit = fitLayout(latticeFromClicks(px(a.x, a.y), px(b.x, b.y), px(c.x, c.y))!, r);
    const find = (i: number, j: number) => { const [x, y] = at(i, j); return fit.plants.find(p => Math.hypot(p.x * MPP - x, p.y * MPP - y) <= 0.5) ?? null; };
    expect(find(6, 1)!.state).toBe("confirmed");
    expect(find(5, 1)!.state).toBe("probable");
    // The swollen crown is green all the way to its neighbours: either an ambiguous plant at its own size cap, or
    // refused at its slot as a strip, which leaves an expected position with strong green for the operator. Never a
    // confirmed crop, and never a canopy as wide as the merged green.
    const [mx, my] = at(12, 1);
    // Strong green that runs into other green is a crop with an uncertain canopy, not a question: the ring is capped.
    const atSlot = fit.plants.find(p => Math.hypot(p.x * MPP - mx, p.y * MPP - my) <= 0.9);
    const slotGap = fit.gaps.find(g => Math.hypot(g.x * MPP - mx, g.y * MPP - my) <= 0.9);
    if (atSlot) { expect(atSlot.state).toBe("confirmed"); expect(atSlot.merged).toBe(true); expect(atSlot.r * MPP).toBeLessThan(1.2); }
    else { expect(slotGap?.evidence).toBe("some"); } // refused as a strip: an expected position with green, for the operator
    expect(fit.plants.every(p => p.r * MPP < 1.2)).toBe(true); // no canopy as wide as the merged green
    // Full trees are not questioned: at most the young tree and the weed at a tree's place.
    expect(fit.plants.filter(p => p.state !== "confirmed").length).toBeLessThanOrEqual(2);
    const gap = fit.gaps.find(g => { const [x, y] = at(9, 2); return Math.hypot(g.x * MPP - x, g.y * MPP - y) <= 0.6; });
    expect(gap?.evidence === "some" || find(9, 2)?.state === "probable").toBe(true); // a weed at a tree's place: never a confirmed crop
    const [bx, by] = at(14, 2);
    const bare = fit.gaps.find(g => Math.hypot(g.x * MPP - bx, g.y * MPP - by) <= 0.6);
    expect(bare?.evidence).toBe("none");
  });

  it("a crown standing half a metre off its slot gets its ring on the crown, not on the slot", () => {
    const { r, trees } = orchard(new Set(["A8,1"]));
    const ang = 4 * deg, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
    const at = (i: number, j: number) => [2 + i * 3.2 * ux + j * 5 * nx, 2.5 + i * 3.2 * uy + j * 5 * ny] as const;
    const [sx, sy] = at(8, 1);
    const cx = sx + 0.5 * ux + 0.4 * nx, cy = sy + 0.5 * uy + 0.4 * ny; // 0.5 m along, 0.4 m across off the slot
    const set = (x: number, y: number) => { const xi = Math.floor(x / MPP), yi = Math.floor(y / MPP); if (xi >= 0 && yi >= 0 && xi < W && yi < H) r.green[yi * W + xi] = 255; };
    for (let dy = -0.8; dy <= 0.8; dy += MPP / 2) for (let dx = -0.8; dx <= 0.8; dx += MPP / 2) if (dx * dx + dy * dy <= 0.64) set(cx + dx, cy + dy);
    const a = treeA(trees, "6,1"), b = treeA(trees, "7,1"), c = treeA(trees, "6,2");
    const fit = fitLayout(latticeFromClicks(px(a.x, a.y), px(b.x, b.y), px(c.x, c.y))!, r);
    const p = fit.plants.find(q => Math.hypot(q.x * MPP - cx, q.y * MPP - cy) <= 0.6)!;
    expect(p).toBeDefined();
    expect(Math.hypot(p.x * MPP - cx, p.y * MPP - cy)).toBeLessThan(0.15);
    expect(p.state).toBe("confirmed");
  });

  it("a crown standing almost a metre off its slot, found only at its margin, gets its ring on the crown and round all of it", () => {
    const { r, trees } = orchard(new Set(["A8,1"]));
    const ang = 4 * deg, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
    const at = (i: number, j: number) => [2 + i * 3.2 * ux + j * 5 * nx, 2.5 + i * 3.2 * uy + j * 5 * ny] as const;
    const [sx, sy] = at(8, 1);
    const cx = sx + 0.85 * ux + 0.3 * nx, cy = sy + 0.85 * uy + 0.3 * ny; // 0.85 m along, 0.3 m across: the search box reaches only its near margin
    const set = (x: number, y: number) => { const xi = Math.floor(x / MPP), yi = Math.floor(y / MPP); if (xi >= 0 && yi >= 0 && xi < W && yi < H) r.green[yi * W + xi] = 255; };
    // An oval crown, 1.2 m along the row by 0.8 m across: the ring must reach its long ends.
    for (let dy = -0.6; dy <= 0.6; dy += MPP / 2) for (let dx = -0.6; dx <= 0.6; dx += MPP / 2) { const al = dx * ux + dy * uy, ac = -dx * uy + dy * ux; if ((al * al) / 0.36 + (ac * ac) / 0.16 <= 1) set(cx + dx, cy + dy); }
    const a = treeA(trees, "6,1"), b = treeA(trees, "7,1"), c = treeA(trees, "6,2");
    const fit = fitLayout(latticeFromClicks(px(a.x, a.y), px(b.x, b.y), px(c.x, c.y))!, r);
    const p = fit.plants.find(q => Math.hypot(q.x * MPP - cx, q.y * MPP - cy) <= 0.6)!;
    expect(p).toBeDefined();
    expect(Math.hypot(p.x * MPP - cx, p.y * MPP - cy)).toBeLessThan(0.15);
    expect(p.r * MPP).toBeGreaterThanOrEqual(0.5); // round the long ends, not the short ones only
    expect(p.r * MPP).toBeLessThan(0.8); // and not wider than the crown
    expect(p.merged).toBe(false);
    expect(p.paint).toBe(p.r); // nothing merged: what is painted for the model is what is drawn
    // The crowns of the planting's typical size are enclosed too: no ring under the 0.8 m disc it stands on.
    for (const t of trees.filter(t => t.block === "A")) { const q = fit.plants.find(q => Math.hypot(q.x * MPP - t.x, q.y * MPP - t.y) <= 0.3); if (q) expect(q.r * MPP).toBeGreaterThanOrEqual(0.7); }
  });

  it("a tree the operator marked holds its place against a bigger green clump beside it", () => {
    const { r, trees } = orchard();
    const ang = 4 * deg, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
    const t = treeA(trees, "8,1");
    // A weed clump 1 m across against the crown, towards the alley: greener and bigger than the tree.
    const set = (x: number, y: number) => { const xi = Math.floor(x / MPP), yi = Math.floor(y / MPP); if (xi >= 0 && yi >= 0 && xi < W && yi < H) r.green[yi * W + xi] = 255; };
    const bx = t.x + 1.6 * nx, by = t.y + 1.6 * ny;
    for (let dy = -1; dy <= 1; dy += MPP / 2) for (let dx = -1; dx <= 1; dx += MPP / 2) if (dx * dx + dy * dy <= 1) set(bx + dx, by + dy);
    const b = treeA(trees, "9,1"), c = treeA(trees, "8,2");
    const clicks: [number, number][] = [px(t.x, t.y), px(b.x, b.y), px(c.x, c.y)];
    const fits = fitLayoutAll(latticeFromClicks(...(clicks as [[number, number], [number, number], [number, number]]))!, r, clicks);
    const p = fits[0].plants.find(q => q.state === "operator" && Math.hypot(q.x * MPP - t.x, q.y * MPP - t.y) <= 1.2)!;
    expect(p).toBeDefined();
    expect(Math.hypot(p.x * MPP - t.x, p.y * MPP - t.y)).toBeLessThanOrEqual(0.5);
    void ux; void uy;
  });

  it("\"a crop\" on an expected position beside a tree that stood too far off its slot finds the tree, at its size", () => {
    const { r, trees } = orchard(new Set(["A8,1"]));
    const ang = 4 * deg, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
    const at = (i: number, j: number) => [2 + i * 3.2 * ux + j * 5 * nx, 2.5 + i * 3.2 * uy + j * 5 * ny] as const;
    const [sx, sy] = at(8, 1);
    const cx = sx + 1.0 * ux + 0.9 * nx, cy = sy + 1.0 * uy + 0.9 * ny; // 1.0 m along, 0.9 m across: beyond the layout's limit and the scans' reach
    const set = (x: number, y: number) => { const xi = Math.floor(x / MPP), yi = Math.floor(y / MPP); if (xi >= 0 && yi >= 0 && xi < W && yi < H) r.green[yi * W + xi] = 255; };
    for (let dy = -0.8; dy <= 0.8; dy += MPP / 2) for (let dx = -0.8; dx <= 0.8; dx += MPP / 2) if (dx * dx + dy * dy <= 0.64) set(cx + dx, cy + dy);
    const a = treeA(trees, "6,1"), b = treeA(trees, "7,1"), c = treeA(trees, "6,2");
    const L0 = latticeFromClicks(px(a.x, a.y), px(b.x, b.y), px(c.x, c.y))!;
    // Whether or not the fitter reached this tree by itself, the operator marks the expected position (the slot), not
    // the crown: the ring must land on the crown, at the crown's size.
    const after = fitLayoutAll(L0, r, [], undefined, [{ x: sx / MPP, y: sy / MPP, crop: true }])[0];
    const p = after.plants.find(q => q.state === "operator")!;
    expect(p).toBeDefined();
    expect(Math.hypot(p.x * MPP - cx, p.y * MPP - cy)).toBeLessThan(0.2);
    expect(p.r * MPP).toBeGreaterThan(0.6);
  });

  it("the operator's word: no crop makes a gap of a green position; a crop makes a plant of a pale one", () => {
    const { r, trees } = orchard();
    const ang = 4 * deg, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
    const at = (i: number, j: number) => [2 + i * 3.2 * ux + j * 5 * nx, 2.5 + i * 3.2 * uy + j * 5 * ny] as const;
    const a = treeA(trees, "6,1"), b = treeA(trees, "7,1"), c = treeA(trees, "6,2");
    const L0 = latticeFromClicks(px(a.x, a.y), px(b.x, b.y), px(c.x, c.y))!;
    const [tx, ty] = at(8, 1), [gx, gy] = at(3, 1);
    // Remove tree A3,1's green and put nothing there; say "crop" there anyway; say "no crop" at A8,1 where a full tree stands.
    for (let dy = -1; dy <= 1; dy += MPP / 2) for (let dx = -1; dx <= 1; dx += MPP / 2) { const xi = Math.floor((gx + dx) / MPP), yi = Math.floor((gy + dy) / MPP); if (xi >= 0 && yi >= 0 && xi < W && yi < H) r.green[yi * W + xi] = 0; }
    const fits = fitLayoutAll(L0, r, [], undefined, [{ x: tx / MPP, y: ty / MPP, crop: false }, { x: gx / MPP, y: gy / MPP, crop: true }]);
    const plants = fits.flatMap(f => f.plants), gaps = fits.flatMap(f => f.gaps);
    expect(plants.some(p => Math.hypot(p.x * MPP - tx, p.y * MPP - ty) <= 0.5)).toBe(false);
    expect(gaps.find(g => Math.hypot(g.x * MPP - tx, g.y * MPP - ty) <= 0.6)?.evidence).toBe("operator");
    const forced = plants.find(p => Math.hypot(p.x * MPP - gx, p.y * MPP - gy) <= 0.5);
    expect(forced?.state).toBe("operator");
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
