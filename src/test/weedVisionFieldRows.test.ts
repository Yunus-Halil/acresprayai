// @vitest-environment node
// The field's rows from the whole map: evenly spaced lines of evenly spaced crop plants are the crop, everything
// on them is taken for the crop, and only the weeds between them count. Synthetic orchards at 5 cm a pixel with
// the things a real one has: shadows, weed strips along the tracks, scattered weeds, patchy young crowns, rows
// that bend, spacing that drifts, weed patches in the tree line, two blocks at different angles.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { throw new Error("not in this test"); } } }));

import type { PhotoPixels } from "@/lib/photoScout/pattern";
import type { GroundPlant } from "@/lib/weedVision/frames";
import type { SavedFrameRun } from "@/lib/weedVision/frameRunCache";
import { ensureFieldRows, getFrameRun, resetFrameRunStore, restoreFrameRun, setFrameRunBoundary, setFrameRunMap } from "@/lib/weedVision/frameRunStore";
import { type Blob, type FieldRows, READ_OVERLAP_PX, fieldReadPlan, fieldRowStatusAt, fieldRowsFromPixels, fieldRowsFromPlants, joinPieces, piecesOf, plantCandidates, vegetationMask } from "@/lib/weedVision/fieldRows";
import { latLngOfPx, mercatorPx } from "@/lib/weedVision/mapRun";
import { rowStatusOf } from "@/lib/weedVision/rowFilter";

const GSD = 0.05;
const SOIL: [number, number, number] = [150, 122, 92], GREEN: [number, number, number] = [80, 140, 45], SHADOW: [number, number, number] = [62, 56, 46];

/**
 * A young orchard seen from the map at 5 cm: crowns 1.2 m across every 4 m along rows 6 m apart running at
 * `deg`, each with its shadow; in every alley two broken weed strips along the tractor tracks, 1.7 m in from each
 * row; and weeds scattered everywhere.
 */
function orchard(deg: number, sizeM = 70, crownM = 0.6, fill = 0.85) {
  const size = Math.round(sizeM / GSD);
  const th = (deg * Math.PI) / 180, dx = Math.cos(th), dy = -Math.sin(th), nx = Math.sin(th), ny = Math.cos(th);
  const rgba = new Uint8ClampedArray(size * size * 4);
  const put = (x: number, y: number, c: [number, number, number]) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= size || y >= size) return; const o = (y * size + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, SOIL);
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const spacing = 6 / GSD, inRow = 4 / GSD, crown = crownM / GSD;
  const cx = size / 2, cy = size / 2;
  const at = (along: number, across: number): [number, number] => [cx + along * dx + across * nx, cy + along * dy + across * ny];
  // Weed strips first, crowns over them.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (x - cx) * nx + (y - cy) * ny;
    const m = ((o % spacing) + spacing) % spacing;
    if ((Math.abs(m - 1.7 / GSD) < 0.08 / GSD || Math.abs(m - 4.3 / GSD) < 0.08 / GSD) && rnd() < 0.55) put(x, y, GREEN);
  }
  for (let i = 0; i < (size * size) / 2500; i++) { const x = rnd() * size, y = rnd() * size; for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) if (u * u + v * v <= 4) put(x + u, y + v, GREEN); }
  const reach = size;
  for (let k = -Math.ceil(reach / spacing); k <= Math.ceil(reach / spacing); k++) for (let j = -Math.ceil(reach / inRow); j <= Math.ceil(reach / inRow); j++) {
    const [x, y] = at(j * inRow + (rnd() - 0.5) * 4, k * spacing + (rnd() - 0.5) * 4);
    if (x < -2 * crown || y < -2 * crown || x > size + 2 * crown || y > size + 2 * crown) continue;
    for (let v = -crown; v <= crown; v++) for (let u = -crown; u <= crown; u++) if (u * u + v * v <= crown * crown) put(x + u + crown * 0.7, y + v + crown * 0.5, SHADOW);
    for (let v = -crown; v <= crown; v++) for (let u = -crown; u <= crown; u++) {
      const a = Math.atan2(v, u), rr = crown * (0.8 + 0.2 * Math.cos(6 * a));
      if (u * u + v * v <= rr * rr && rnd() < fill) put(x + u, y + v, GREEN);
    }
  }
  return { px: { width: size, height: size, rgba } as PhotoPixels, at, spacing };
}

type FieldOpts = { deg: number; bendM?: number; drift?: number; patchShare?: number; crownM?: number; fill?: number; clip?: (x: number, y: number) => boolean; seed?: number };

/**
 * Orchard blocks drawn onto one raster, each in its own row frame: row k's line at along s sits `bendM` metres
 * across at the block's ends (a parabola), tree j stands at j * 4 m stretched by `drift` per tree, and
 * `patchShare` of the gaps hold a weed patch in the tree line. `status(block, s, acrossM)` is where the truth
 * puts a point: s and acrossM in metres from the block's row 0 at the raster's centre.
 */
function fieldOf(sizeM: number, blocks: FieldOpts[]) {
  const size = Math.round(sizeM / GSD);
  const rgba = new Uint8ClampedArray(size * size * 4);
  const cx = size / 2, cy = size / 2;
  for (let i = 0; i < size * size; i++) { rgba[i * 4] = SOIL[0]; rgba[i * 4 + 1] = SOIL[1]; rgba[i * 4 + 2] = SOIL[2]; rgba[i * 4 + 3] = 255; }
  const frames = blocks.map(b => {
    const th = (b.deg * Math.PI) / 180, dx = Math.cos(th), dy = -Math.sin(th), nx = Math.sin(th), ny = Math.cos(th);
    const half = sizeM / 2;
    const bend = (b.bendM ?? 0) / (half * half);
    /** Raster pixel of a point s metres along and a metres across, following the bend. */
    const at = (sM: number, aM: number): [number, number] => { const a = aM + bend * sM * sM; return [cx + (sM * dx + a * nx) / GSD, cy + (sM * dy + a * ny) / GSD]; };
    return { b, at, clip: b.clip ?? (() => true) };
  });
  frames.forEach(({ b, at, clip }, bi) => {
    let seed = b.seed ?? 5 + bi;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const put = (x: number, y: number, c: [number, number, number]) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= size || y >= size || !clip(x, y)) return; const o = (y * size + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; };
    const disc = (x: number, y: number, rPx: number, c: [number, number, number], fill = 1) => { for (let v = -rPx; v <= rPx; v++) for (let u = -rPx; u <= rPx; u++) if (u * u + v * v <= rPx * rPx && (fill >= 1 || rnd() < fill)) put(x + u, y + v, c); };
    const reach = sizeM;
    // Weed strips along the tracks, 1.7 m in from each row, broken.
    for (let k = -15; k <= 15; k++) for (const off of [1.7, 4.3]) for (let sM = -reach; sM <= reach; sM += 0.04) if (rnd() < 0.6) { const [x, y] = at(sM, k * 6 + off); disc(x, y, 1, GREEN); }
    // Scattered weeds.
    for (let i = 0; i < (size * size) / 2500; i++) disc(rnd() * size, rnd() * size, 2, GREEN);
    // Trees, with their shadows, and weed patches in some gaps of the tree line.
    for (let k = -15; k <= 15; k++) {
      let sM = -reach, j = 0;
      while (sM <= reach) {
        const [x, y] = at(sM + (rnd() - 0.5) * 0.2, k * 6 + (rnd() - 0.5) * 0.2);
        const cr = Math.round((b.crownM ?? 0.6) / GSD);
        disc(x + 0.75 * cr, y + 0.5 * cr, cr, SHADOW);
        disc(x, y, cr, GREEN, b.fill ?? 0.85);
        const gap = 4 * (1 + (b.drift ?? 0) * j);
        if (rnd() < (b.patchShare ?? 0)) { const [px2, py2] = at(sM + gap * (0.35 + 0.3 * rnd()), k * 6); disc(px2, py2, 7, GREEN); }
        sM += gap; j++;
      }
    }
  });
  return { px: { width: size, height: size, rgba } as PhotoPixels, at: (bi: number, sM: number, aM: number) => frames[bi].at(sM, aM) };
}


describe("field rows: evenly spaced lines of evenly spaced plants", () => {
  it("finds the tree rows, not the weed strips along the tracks, at any angle, and leaves the alleys open", () => {
    for (const deg of [35, 120, 0, 90]) {
      const o = orchard(deg);
      const rows = fieldRowsFromPixels(o.px, GSD)!;
      expect(rows).not.toBeNull();
      expect(rows.spacingM).toBeGreaterThan(5.4);
      expect(rows.spacingM).toBeLessThan(6.6);
      expect(rows.seedSpacingM).toBeGreaterThan(3.4);
      expect(rows.seedSpacingM).toBeLessThan(4.6);
      const dd = Math.abs((((rows.directionDeg + deg) % 180) + 180) % 180); // image y runs down: ground angle deg is -deg here
      expect(Math.min(dd, 180 - dd)).toBeLessThan(1.5);
      const s = (along: number, acrossM: number) => { const [x, y] = o.at(along / GSD, acrossM / GSD); return rowStatusOf(rows.ctx, x, y); };
      // On the row line, between two trees: the crop.
      expect(["on-row", "on-crop"]).toContain(s(2, 0));
      expect(["on-row", "on-crop"]).toContain(s(6, 0.4));
      // The weed strips and mid-alley: between the rows.
      expect(s(1, 1.7)).toBe("off-row");
      expect(s(1, 4.3)).toBe("off-row");
      expect(s(3, 3)).toBe("off-row");
      expect(s(1, -1.7)).toBe("off-row");
      // The band: at least 15 % of the spacing, never a third of the alley.
      expect(rows.ctx.bandPx * GSD).toBeGreaterThanOrEqual(0.15 * rows.spacingM - 1e-9);
      expect(rows.ctx.bandPx * GSD).toBeLessThanOrEqual(0.35 * rows.spacingM + 1e-9);
    }
  });

  it("finds the rows of young trees with thin crowns that break into pieces", () => {
    const o = orchard(35, 70, 0.5, 0.45);
    const rows = fieldRowsFromPixels(o.px, GSD)!;
    expect(rows).not.toBeNull();
    expect(rows.spacingM).toBeGreaterThan(5.4);
    expect(rows.spacingM).toBeLessThan(6.6);
    const s = (along: number, acrossM: number) => { const [x, y] = o.at(along / GSD, acrossM / GSD); return rowStatusOf(rows.ctx, x, y); };
    expect(["on-row", "on-crop"]).toContain(s(2, 0));
    expect(s(1, 1.7)).toBe("off-row");
    expect(s(1, 4.3)).toBe("off-row");
  });

  it("finds no rows in a field of scattered weeds and weed strips with no evenly spaced plants", () => {
    const size = 1000, rgba = new Uint8ClampedArray(size * size * 4);
    let seed = 3;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4, strip = (x + 0.4 * y) % 37 < 3 && rnd() < 0.5;
      const c = strip ? GREEN : SOIL;
      rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
    }
    for (let i = 0; i < 300; i++) {
      const x = Math.floor(rnd() * size), y = Math.floor(rnd() * size), r = 2 + Math.floor(rnd() * 8);
      for (let v = -r; v <= r; v++) for (let u = -r; u <= r; u++) if (u * u + v * v <= r * r && x + u >= 0 && y + v >= 0 && x + u < size && y + v < size) { const o = ((y + v) * size + x + u) * 4; rgba[o] = GREEN[0]; rgba[o + 1] = GREEN[1]; rgba[o + 2] = GREEN[2]; }
    }
    expect(fieldRowsFromPixels({ width: size, height: size, rgba }, GSD)).toBeNull();
  });

  it("follows rows that bend: the band stays on the trees at the ends of the field", () => {
    const f = fieldOf(80, [{ deg: 20, bendM: 2.5 }]);
    const rows = fieldRowsFromPixels(f.px, GSD)!;
    expect(rows).not.toBeNull();
    const st = (sM: number, aM: number) => { const [x, y] = f.at(0, sM, aM); return rowStatusOf(rows.ctx, x, y); };
    for (const sM of [-30, -10, 10, 30]) {
      expect(["on-row", "on-crop"]).toContain(st(sM + 2, 0)); // between two trees, where the row has bent 1-2.5 m
      expect(st(sM + 2, 1.7)).toBe("off-row");
      expect(st(sM + 2, -1.7)).toBe("off-row");
      expect(st(sM + 2, 3)).toBe("off-row");
    }
  });

  it("holds rows whose tree spacing drifts and whose tree lines hold weed patches", () => {
    const f = fieldOf(70, [{ deg: 50, drift: 0.006, patchShare: 0.3 }]);
    const rows = fieldRowsFromPixels(f.px, GSD)!;
    expect(rows).not.toBeNull();
    expect(rows.spacingM).toBeGreaterThan(5.4);
    expect(rows.spacingM).toBeLessThan(6.6);
    expect(rows.rows).toBeGreaterThanOrEqual(10);
    const st = (sM: number, aM: number) => { const [x, y] = f.at(0, sM, aM); return rowStatusOf(rows.ctx, x, y); };
    expect(st(1, 1.7)).toBe("off-row");
    expect(st(1, 3)).toBe("off-row");
  });

  it("finds two blocks planted at different angles, each with its own rows", () => {
    const f = fieldOf(90, [{ deg: 30, clip: x => x < 900 }, { deg: 105, clip: x => x >= 900, seed: 41 }]);
    const rows = fieldRowsFromPixels(f.px, GSD)!;
    expect(rows).not.toBeNull();
    expect(rows.blocks).toBe(2);
    // Points well inside each block: on its own rows, and its own alleys open.
    const st = (bi: number, sM: number, aM: number) => { const [x, y] = f.at(bi, sM, aM); return rowStatusOf(rows.ctx, x, y); };
    for (const [bi, sign] of [[0, -1], [1, 1]] as const) {
      // Sample along a row line crossing into the block's half; keep the points inside it.
      const pts = [-30, -20, -10, 10, 20, 30].map(sM => ({ sM, p: f.at(bi, sM + 2, 6 * 2) })).filter(({ p }) => (sign < 0 ? p[0] < 820 : p[0] > 980) && p[0] > 60 && p[0] < 1740 && p[1] > 60 && p[1] < 1740);
      expect(pts.length).toBeGreaterThan(0);
      for (const { sM } of pts) {
        expect(["on-row", "on-crop"]).toContain(st(bi, sM + 2, 12));
        expect(st(bi, sM + 2, 12 + 3)).toBe("off-row");
      }
    }
  });

  it("reads twelve random orchards right, point by point", () => {
    let seed = 2024;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    let points = 0, right = 0, found = 0;
    const misses: string[] = [];
    for (let n = 0; n < 12; n++) {
      const opts: FieldOpts = { deg: rnd() * 180, bendM: rnd() * 2, drift: (rnd() - 0.5) * 0.01, patchShare: rnd() * 0.3, crownM: 0.4 + rnd() * 0.4, fill: 0.45 + rnd() * 0.45, seed: 100 + n };
      const f = fieldOf(70, [opts]);
      const rows = fieldRowsFromPixels(f.px, GSD);
      if (!rows) { misses.push(`#${n} no rows (${JSON.stringify(opts)})`); continue; }
      found++;
      // Points on the field: on the row line between trees, on both weed strips, and mid-alley, along every row near the centre.
      for (let k = -3; k <= 3; k++) for (const sM of [-20, -6, 6, 20]) {
        const truth: [number, boolean][] = [[0, true], [1.7, false], [4.3, false], [3, false]];
        for (const [aM, onRow] of truth) {
          const [x, y] = f.at(0, sM + 2, k * 6 + aM);
          if (x < 40 || y < 40 || x > f.px.width - 40 || y > f.px.height - 40) continue;
          const st = rowStatusOf(rows.ctx, x, y);
          points++;
          if ((st === "on-row" || st === "on-crop") === onRow) right++; else misses.push(`#${n} row ${k} at ${sM + 2} m, ${aM} m across: ${st}`);
        }
      }
    }
    console.log(`random orchards: rows found in ${found}/12, ${right}/${points} points right (${((100 * right) / points).toFixed(1)} %)`);
    if (misses.length) console.log(misses.slice(0, 12).join(" | "));
    expect(found).toBe(12);
    expect(right / points).toBeGreaterThan(0.98);
  }, 120_000);

  it("reads the same rows tile by tile as in one piece", () => {
    const o = orchard(35, 90);
    const whole = fieldRowsFromPixels(o.px, GSD)!;
    // Three by three tiles of the raster with the overlap, pieces kept by the tile that owns their centre.
    const W = o.px.width, T = Math.ceil(W / 3), pieces: Blob[] = [];
    for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 3; tx++) {
      const x0 = tx * T, y0 = ty * T, x1 = Math.min(W, x0 + T), y1 = Math.min(W, y0 + T);
      const gx = Math.max(0, x0 - READ_OVERLAP_PX), gy = Math.max(0, y0 - READ_OVERLAP_PX), gx1 = Math.min(W, x1 + READ_OVERLAP_PX), gy1 = Math.min(W, y1 + READ_OVERLAP_PX);
      const w = gx1 - gx, h = gy1 - gy, rgba = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) rgba.set(o.px.rgba.subarray(((gy + y) * W + gx) * 4, ((gy + y) * W + gx + w) * 4), y * w * 4);
      pieces.push(...piecesOf(vegetationMask({ width: w, height: h, rgba }), w, h, gx, gy, { x0, y0, x1, y1 }, 2));
    }
    const tiled = fieldRowsFromPlants(plantCandidates(joinPieces(pieces, GSD), GSD), GSD)!;
    expect(tiled.rows).toBe(whole.rows);
    expect(tiled.spacingM).toBeCloseTo(whole.spacingM, 1);
    expect(tiled.ctx.crops.length).toBeGreaterThanOrEqual(whole.ctx.crops.length - 3);
  });

  it("reads the field at about 4-6 cm in tiles, however large it is", () => {
    const LAT = 37.6, LNG = -78.4;
    const ring = (dM: number) => { const d = dM / 111_320; return [[{ lat: LAT - d, lng: LNG - d }, { lat: LAT - d, lng: LNG + d }, { lat: LAT + d, lng: LNG + d }, { lat: LAT + d, lng: LNG - d }]]; };
    const small = fieldReadPlan(ring(20), 23, LAT)!;
    const big = fieldReadPlan(ring(400), 23, LAT)!;
    for (const p of [small, big]) { expect(p.mpp).toBeGreaterThan(0.028); expect(p.mpp).toBeLessThan(0.065); }
    expect(small.tiles).toHaveLength(1);
    expect(big.tiles.length).toBeGreaterThan(4);
    expect(fieldReadPlan(ring(20), 20, LAT)!.mpp).toBeGreaterThan(0.1); // never finer than the map has
  });
});

describe("the store judges every weed against the field's rows", () => {
  beforeEach(() => resetFrameRunStore());
  afterEach(() => resetFrameRunStore());
  const LAT = 37.6, LNG = -78.4, Z = 22;
  const [X0, Y0] = mercatorPx(LAT, LNG, Z);
  const left = Math.floor(X0) - 500, top = Math.floor(Y0) - 500;
  // One row line straight east through the origin with a band of 20 px, one crop plant at the origin.
  const rows: FieldRows = { z: Z, left, top, mpp: 0.03, rows: 1, spacingM: 6, seedSpacingM: 4, directionDeg: 0, blocks: 1, ctx: { lines: [{ x1: 0, y1: Y0 - top, x2: 1000, y2: Y0 - top }], crops: [{ x: X0 - left, y: Y0 - top, r: 15 }], bandPx: 20, gsdM: 0.03 } };
  const plantAt = (id: string, dyPx: number, dxPx = 0): GroundPlant => ({ id, frame: "map/z23/a", klass: "weed", rowStatus: "no-rows", centre: latLngOfPx(X0 + dxPx, Y0 + dyPx, Z), seenIn: ["map/z23/a"], duplicates: 0 } as unknown as GroundPlant);

  it("places points against the rows", () => {
    expect(fieldRowStatusAt(rows, latLngOfPx(X0, Y0, Z))).toBe("on-crop");
    expect(fieldRowStatusAt(rows, latLngOfPx(X0 + 100, Y0 + 10, Z))).toBe("on-row");
    expect(fieldRowStatusAt(rows, latLngOfPx(X0 + 100, Y0 + 60, Z))).toBe("off-row");
  });

  it("reads the rows once per map, boundary and settings, and re-tags the weeds already shown", async () => {
    const reader = vi.fn(async () => rows);
    const ring = [{ lat: LAT - 0.001, lng: LNG - 0.001 }, { lat: LAT - 0.001, lng: LNG + 0.001 }, { lat: LAT + 0.001, lng: LNG + 0.001 }, { lat: LAT + 0.001, lng: LNG - 0.001 }];
    await ensureFieldRows("scan-t", { reader });
    expect(reader).not.toHaveBeenCalled(); // no map yet
    setFrameRunMap("scan-t", { tile: () => "", maxNative: 23, lat: LAT, lng: LNG });
    setFrameRunBoundary("scan-t", [ring]);
    const saved: SavedFrameRun = { filename: "map/z23/a", algorithm: "rfdetr_seg_large", modelSha256: null, nativeWidth: 1, nativeHeight: 1, timingsMs: {}, detections: [plantAt("alley", 60, 100), plantAt("row", 10, 100), plantAt("crop", 0)], createdAt: null };
    expect(await restoreFrameRun("scan-t", { sources: null, params: { algorithm: "rfdetr_seg_large", threshold: 0.5, tile: 1024, overlap: 256, scale: 1 }, paramsKey: "map|z23|u1|k", modelSha: null, algorithmLabel: "m", deps: { cache: { load: async () => new Map([["map/z23/a", saved]]) } as never } })).toBe(true);
    const status = () => Object.fromEntries(getFrameRun("scan-t").plants.map(p => [p.id, p.rowStatus]));
    expect(status()).toEqual({ alley: "no-rows", row: "no-rows", crop: "no-rows" });
    await ensureFieldRows("scan-t", { reader });
    await ensureFieldRows("scan-t", { reader });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(status()).toEqual({ alley: "off-row", row: "on-row", crop: "on-crop" });
    expect(getFrameRun("scan-t").fieldRows).toMatchObject({ rows: 1, spacingM: 6 });
    expect(getFrameRun("scan-t").fieldRows!.bandM).toBeCloseTo(0.6, 6);
  });
});
