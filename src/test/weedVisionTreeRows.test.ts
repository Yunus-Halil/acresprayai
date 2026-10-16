// The field's tree rows: trees found as crowns, rows fitted through them, and only the alleys between count.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { throw new Error("not in this test"); } } }));

import type { PhotoPixels } from "@/lib/photoScout/pattern";
import type { GroundPlant } from "@/lib/weedVision/frames";
import { ensureFieldRows, getFrameRun, resetFrameRunStore, restoreFrameRun, setFieldRows, setFrameRunBoundary, setFrameRunMap } from "@/lib/weedVision/frameRunStore";
import type { SavedFrameRun } from "@/lib/weedVision/frameRunCache";
import { latLngOfPx, mercatorPx } from "@/lib/weedVision/mapRun";
import { type TreeRows, findTrees, fitTreeRows, treeRowStatusAt, treeRowStatusPx } from "@/lib/weedVision/treeRows";

const MPP = 0.08;
const SOIL: [number, number, number] = [150, 122, 92], GREEN: [number, number, number] = [80, 140, 45], SHADOW: [number, number, number] = [62, 56, 46];

/** An orchard at `deg` degrees: crowns of radius 1.2 m every 4 m along rows 6 m apart, two thin weed strips in each alley, and scattered small weeds. */
function orchard(deg: number, size = 900) {
  const th = (deg * Math.PI) / 180, dx = Math.cos(th), dy = Math.sin(th), nx = -dy, ny = dx;
  const rgba = new Uint8ClampedArray(size * size * 4);
  const put = (x: number, y: number, c: [number, number, number]) => { if (x < 0 || y < 0 || x >= size || y >= size) return; const o = (y * size + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, SOIL);
  const spacing = 6 / MPP, inRow = 4 / MPP, crown = 1.2 / MPP;
  const cx = size / 2, cy = size / 2;
  const trees: { x: number; y: number }[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = -6; k <= 6; k++) for (let j = -10; j <= 10; j++) {
    const x = cx + j * inRow * dx + k * spacing * nx + (rnd() - 0.5) * 3, y = cy + j * inRow * dy + k * spacing * ny + (rnd() - 0.5) * 3;
    if (x < -crown || y < -crown || x > size + crown || y > size + crown) continue;
    trees.push({ x, y });
    // A shadow first, then the crown over it.
    for (let v = -crown; v <= crown; v++) for (let u = -crown; u <= crown; u++) if (u * u + v * v <= crown * crown) put(Math.round(x + u + crown * 0.6), Math.round(y + v + crown * 0.4), SHADOW);
    for (let v = -crown; v <= crown; v++) for (let u = -crown; u <= crown; u++) if (u * u + v * v <= crown * crown * (0.85 + 0.15 * Math.cos(5 * Math.atan2(v, u)))) put(Math.round(x + u), Math.round(y + v), GREEN);
  }
  // Weed strips 0.2 m wide along the tracks, 2 m and 4 m into each alley.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (x - cx) * nx + (y - cy) * ny;
    const m = ((o % spacing) + spacing) % spacing;
    if (Math.abs(m - 2 / MPP) < 0.1 / MPP || Math.abs(m - 4 / MPP) < 0.1 / MPP) { if (rnd() < 0.7) put(x, y, GREEN); }
  }
  for (let i = 0; i < 400; i++) { const x = Math.floor(rnd() * size), y = Math.floor(rnd() * size); for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) put(x + u, y + v, GREEN); }
  return { px: { width: size, height: size, rgba } as PhotoPixels, trees, dx, dy, nx, ny, cx, cy, spacing };
}

describe("tree rows from the map", () => {
  it("finds the crowns and not the weed strips or small weeds", () => {
    const o = orchard(35);
    const found = findTrees(o.px, MPP);
    const inside = o.trees.filter(t => t.x > 20 && t.y > 20 && t.x < 880 && t.y < 880);
    // Every crown inside the raster found once, near its centre; nothing else.
    for (const t of inside) expect(found.filter(f => Math.hypot(f.x - t.x, f.y - t.y) < 6)).toHaveLength(1);
    expect(found.length).toBeLessThanOrEqual(o.trees.length);
    for (const f of found) expect(Math.min(...o.trees.map(t => Math.hypot(f.x - t.x, f.y - t.y)))).toBeLessThan(12);
  });

  it("fits the rows' direction and spacing, and keeps the alleys open", () => {
    for (const deg of [35, 120, 0]) {
      const o = orchard(deg);
      const rows = fitTreeRows(findTrees(o.px, MPP), MPP)!;
      expect(rows).not.toBeNull();
      const dd = Math.abs(((rows.directionDeg - deg) % 180 + 180) % 180);
      expect(Math.min(dd, 180 - dd)).toBeLessThan(1.5);
      expect(rows.spacingM).toBeGreaterThan(5.6);
      expect(rows.spacingM).toBeLessThan(6.4);
      expect(rows.treeRadiusM).toBeGreaterThan(0.9);
      const at = (along: number, acrossM: number) => treeRowStatusPx(rows, o.cx + along * o.dx + (acrossM / MPP) * o.nx, o.cy + along * o.dy + (acrossM / MPP) * o.ny);
      expect(at(0, 0)).toBe("on-crop"); // a crown
      expect(at(2 / MPP, 0)).toBe("on-row"); // between two trees of one row
      expect(at(1 / MPP, 2)).toBe("off-row"); // the first weed strip
      expect(at(1 / MPP, 4)).toBe("off-row"); // the second
      expect(at(1 / MPP, 3)).toBe("off-row"); // mid-alley
      expect(at(2 / MPP, 6 - 0.5)).toBe("on-row"); // close to the next row, between its trees
    }
  });

  it("says nothing for a row crop: plants too small and rows too close", () => {
    const size = 600, rgba = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4, row = (x * MPP) % 0.76 < 0.12, plant = row && (y * MPP) % 0.2 < 0.08;
      const c = plant ? GREEN : SOIL;
      rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
    }
    expect(fitTreeRows(findTrees({ width: size, height: size, rgba }, MPP), MPP)).toBeNull();
  });
});

describe("the store judges every weed against the field's tree rows", () => {
  beforeEach(() => resetFrameRunStore());
  afterEach(() => resetFrameRunStore());
  const LAT = 37.6, LNG = -78.4, Z = 21;
  const [X0, Y0] = mercatorPx(LAT, LNG, Z);
  // One row line straight east through the origin, a band of 20 px, one crown at the origin.
  const rows: TreeRows = { z: Z, left: Math.floor(X0) - 500, top: Math.floor(Y0) - 500, mpp: 0.07, trees: [{ x: 500 + (X0 % 1), y: 500 + (Y0 % 1), r: 15 }], lines: [{ x1: 0, y1: 500 + (Y0 % 1), x2: 1000, y2: 500 + (Y0 % 1) }], bandPx: 20, spacingM: 6, directionDeg: 0, treeRadiusM: 1 };
  const plantAt = (id: string, dyPx: number, dxPx = 0): GroundPlant => ({ id, frame: "map/z23/a", klass: "weed", rowStatus: "no-rows", centre: latLngOfPx(X0 + dxPx, Y0 + dyPx, Z), seenIn: ["map/z23/a"], duplicates: 0 } as unknown as GroundPlant);

  it("places the test points where it should", () => {
    expect(treeRowStatusAt(rows, latLngOfPx(X0, Y0, Z))).toBe("on-crop");
    expect(treeRowStatusAt(rows, latLngOfPx(X0 + 100, Y0 + 10, Z))).toBe("on-row");
    expect(treeRowStatusAt(rows, latLngOfPx(X0 + 100, Y0 + 60, Z))).toBe("off-row");
  });

  it("reads the rows once per map and boundary, and re-tags the plants already shown", async () => {
    const reader = vi.fn(async () => rows);
    const ring = [{ lat: LAT - 0.001, lng: LNG - 0.001 }, { lat: LAT - 0.001, lng: LNG + 0.001 }, { lat: LAT + 0.001, lng: LNG + 0.001 }, { lat: LAT + 0.001, lng: LNG - 0.001 }];
    await ensureFieldRows("scan-t", reader);
    expect(reader).not.toHaveBeenCalled(); // no map yet
    setFrameRunMap("scan-t", { tile: () => "", maxNative: 23, lat: LAT, lng: LNG });
    setFrameRunBoundary("scan-t", [ring]);
    // A saved map run on screen: one weed in the alley, one on the row, one in the crown, all read "no-rows" by their chunk.
    const saved: SavedFrameRun = { filename: "map/z23/a", algorithm: "rfdetr_seg_large", modelSha256: null, nativeWidth: 1, nativeHeight: 1, timingsMs: {}, detections: [plantAt("alley", 60, 100), plantAt("row", 10, 100), plantAt("crown", 0)], createdAt: null };
    const load = async () => new Map([["map/z23/a", saved]]);
    expect(await restoreFrameRun("scan-t", { sources: null, params: { algorithm: "rfdetr_seg_large", threshold: 0.5, tile: 1024, overlap: 256, scale: 1 }, paramsKey: "map|z23|u1|k", modelSha: null, algorithmLabel: "m", deps: { cache: { load } as never } })).toBe(true);
    const status = () => Object.fromEntries(getFrameRun("scan-t").plants.map(p => [p.id, p.rowStatus]));
    expect(status()).toEqual({ alley: "no-rows", row: "no-rows", crown: "no-rows" });
    await ensureFieldRows("scan-t", reader);
    expect(status()).toEqual({ alley: "off-row", row: "on-row", crown: "on-crop" });
    await ensureFieldRows("scan-t", reader);
    expect(reader).toHaveBeenCalledTimes(1);
    const s = getFrameRun("scan-t");
    expect(s.fieldRowsState).toBe("found");
    expect(s.fieldRows).toMatchObject({ rows: 1, spacingM: 6 });
    setFieldRows("scan-t", rows);
    expect(getFrameRun("scan-t").fieldRows?.bandM).toBeCloseTo(1.4, 6);
  });
});
