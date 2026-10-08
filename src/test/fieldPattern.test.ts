// The planting pattern on the ground: a synthetic orchard rendered as a
// georeferenced raster at the field map's resolution, read through the same
// conversion the scout uses, with no tiles and no worker.
import { describe, expect, it } from "vitest";
import type { RasterSource } from "@/lib/cellFeatures";
import { M_PER_DEG_LAT, type LatLng2, mPerDegLng } from "@/lib/geo";
import { analysePhoto } from "@/lib/photoScout/pattern";
import { analysePhotoOffThread } from "@/lib/photoScout/runPattern";
import {
  PATTERN_FIT_WINDOW_M, assembleFieldPattern, betweenPlantsAt, convertPattern, nearestPlantFinder, patternDistance,
  patternRowModel, patternZoom, planPatternWindows, readFieldPattern,
} from "@/lib/weedScout/fieldPattern";
import { localFrame } from "@/lib/weedScout/rows";
import { rasterGsdM } from "@/lib/weedScout/tiles";
import { rankCandidates } from "@/lib/weedScout/candidates";
import { DEFAULT_SCOUT_PARAMS, type AnalysisTile, type Blob } from "@/lib/weedScout/types";

const LAT0 = 38.9, LNG0 = -77.5;
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

/**
 * An orchard 60 m by 45 m at 5 cm/px: rows 4.5 m apart at 15 degrees, trees
 * 2 m along with 1 m canopies, one small weed on a row between two trees and
 * one between the rows. North-west corner at (LAT0, LNG0).
 */
function orchard() {
  const g = 0.05, W = 1200, H = 900, pitch = 4.5, seed = 2.0, th = (15 * Math.PI) / 180;
  const rand = rng(7);
  const rgba = new Uint8ClampedArray(W * H * 4);
  const cx = (W / 2) * g, cy = -(H / 2) * g;
  const tx = Math.cos(th), ty = Math.sin(th), nx = -Math.sin(th), ny = Math.cos(th);
  const trees: { x: number; y: number }[] = [];
  let planted = 0;
  for (let k = -8; k <= 8; k++) for (let a = -40; a <= 40; a += seed) {
    const t = { x: cx + a * tx + k * pitch * nx, y: cy + a * ty + k * pitch * ny };
    trees.push(t);
    if (t.x > 0.6 && t.x < W * g - 0.6 && t.y < -0.6 && t.y > -H * g + 0.6) planted++;
  }
  // The weeds: one on row 0 midway between the trees at a = 0 and a = 2; one 2.25 m across from row 0.
  const onRow = { x: cx + 1 * tx, y: cy + 1 * ty };
  const between = { x: cx + 3 * tx + 2.25 * nx, y: cy + 3 * ty + 2.25 * ny };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = i * g, y = -j * g;
    let R = 150, G = 120, B = 85;
    if (trees.some(t => (x - t.x) ** 2 + (y - t.y) ** 2 <= 0.25) || (x - onRow.x) ** 2 + (y - onRow.y) ** 2 <= 0.04 || (x - between.x) ** 2 + (y - between.y) ** 2 <= 0.04) { R = 60; G = 125; B = 45; }
    R += (rand() - 0.5) * 12; G += (rand() - 0.5) * 12; B += (rand() - 0.5) * 12;
    const o = (j * W + i) * 4; rgba[o] = R; rgba[o + 1] = G; rgba[o + 2] = B; rgba[o + 3] = 255;
  }
  const bounds = { north: LAT0, west: LNG0, south: LAT0 - (H * g) / M_PER_DEG_LAT, east: LNG0 + (W * g) / mPerDegLng(LAT0) };
  const raster: RasterSource = { width: W, height: H, bounds, rgba };
  const frame = localFrame({ lat: LAT0, lng: LNG0 });
  return { raster, g, pitch, seed, planted, frame, at: (x: number, y: number): LatLng2 => frame.toLatLng(x, y), onRow, between, cx, cy, tx, ty, nx, ny };
}

describe("the planting pattern on the field map", () => {
  it("picks the baked zoom nearest 5 cm per pixel and lays windows only where the field is", () => {
    expect(patternZoom(38.9, 22)).toBe(21);
    expect(patternZoom(0, 22)).toBe(22);
    expect(patternZoom(38.9, 19)).toBe(19);
    const bbox = { north: LAT0, south: LAT0 - 300 / M_PER_DEG_LAT, west: LNG0, east: LNG0 + 300 / mPerDegLng(LAT0) };
    // A field in the north-west quarter of the bbox.
    const f = localFrame({ lat: LAT0, lng: LNG0 });
    const ring = [f.toLatLng(10, -10), f.toLatLng(140, -10), f.toLatLng(140, -140), f.toLatLng(10, -140), f.toLatLng(10, -10)];
    const plan = planPatternWindows(bbox, [ring], 22);
    expect(plan.z).toBe(21);
    expect(plan.windowM).toBe(60);
    expect(plan.grown).toBe(false);
    expect(plan.windows.length).toBeGreaterThanOrEqual(4);
    expect(plan.windows.length).toBeLessThanOrEqual(12);
    for (const w of plan.windows) {
      expect(w.fetch.west).toBeLessThanOrEqual(w.owned.west);
      expect(w.fetch.north).toBeGreaterThanOrEqual(w.owned.north);
      // Every kept window touches the field; none sits in the empty south-east.
      expect(w.owned.west).toBeLessThan(LNG0 + 150 / mPerDegLng(LAT0));
    }
    // A big field grows the window rather than exceeding the budget.
    const big = { north: LAT0, south: LAT0 - 2000 / M_PER_DEG_LAT, west: LNG0, east: LNG0 + 2000 / mPerDegLng(LAT0) };
    const ringBig = [f.toLatLng(0, 0), f.toLatLng(2000, 0), f.toLatLng(2000, -2000), f.toLatLng(0, -2000), f.toLatLng(0, 0)];
    const planBig = planPatternWindows(big, [ringBig], 22);
    expect(planBig.grown).toBe(true);
    expect(planBig.windows.length).toBeLessThanOrEqual(230);
  });

  it("reads an orchard from one window: rows, plants, lines and distances on the ground", async () => {
    const o = orchard();
    const win = { id: "0:0", col: 0, row: 0, fetch: o.raster.bounds, owned: o.raster.bounds };
    const pattern = await analysePhoto(o.raster, { gsdM: rasterGsdM(o.raster), rowSpacingM: "auto", windowM: PATTERN_FIT_WINDOW_M }, { yieldBetweenWindows: false });
    const result = convertPattern(o.raster, win, pattern);
    expect(result.blocks.length).toBeGreaterThanOrEqual(1);
    const main = result.blocks.reduce((a, b) => (b.rects.length > a.rects.length ? b : a));
    expect(Math.abs(main.pitchM - o.pitch) / o.pitch).toBeLessThan(0.08);
    // Rows at 15 degrees counterclockwise from east run at a compass bearing of 75.
    expect(Math.abs(main.bearingDeg - 75)).toBeLessThan(2.5);
    expect(main.rects.length).toBeGreaterThan(10);

    const plan = { z: 21, gsdM: o.g, windowM: 60, windows: [win], grown: false };
    const fp = assembleFieldPattern(plan, { lat: LAT0, lng: LNG0 }, [result]);
    expect(fp.summary.blocks).toBeGreaterThanOrEqual(1);
    expect(Math.abs(fp.summary.rowSpacingM! - o.pitch) / o.pitch).toBeLessThan(0.08);
    expect(fp.summary.plantSpacingM).not.toBeNull();
    expect(Math.abs(fp.summary.plantSpacingM! - o.seed) / o.seed).toBeLessThan(0.1);
    expect(fp.summary.plantCount).toBeGreaterThan(o.planted * 0.85);
    expect(fp.summary.plantCount).toBeLessThan(o.planted * 1.1);
    expect(fp.summary.squareGrid).toBe(false);
    // Lines: at least the rows that cross the raster, each inside its bounds.
    expect(fp.lines.length).toBeGreaterThanOrEqual(8);
    for (const l of fp.lines) for (const p of l.points) {
      expect(p.lat).toBeLessThanOrEqual(o.raster.bounds.north + 1e-9);
      expect(p.lat).toBeGreaterThanOrEqual(o.raster.bounds.south - 1e-9);
      expect(p.lng).toBeGreaterThanOrEqual(o.raster.bounds.west - 1e-9);
      expect(p.lng).toBeLessThanOrEqual(o.raster.bounds.east + 1e-9);
    }
    // The trees are on pattern.
    const onPattern = fp.plants.filter(p => p.cls === "on pattern");
    expect(onPattern.length).toBe(fp.summary.plantCount);

    // Distances follow the rows: on a tree about zero, midway between rows about half a pitch.
    const dist = patternDistance(fp);
    const tree = o.at(o.cx + 6 * o.tx, o.cy + 6 * o.ty);
    const mid = o.at(o.cx + 6 * o.tx + 2.25 * o.nx, o.cy + 6 * o.ty + 2.25 * o.ny);
    expect(Math.abs(dist(tree)!)).toBeLessThan(0.3);
    expect(Math.abs(Math.abs(dist(mid)!) - 2.25)).toBeLessThan(0.35);
    // And nothing is said about a point far outside the pattern windows.
    expect(dist({ lat: LAT0 + 1, lng: LNG0 })).toBeNull();

    // The row model the rest of the scout reads agrees.
    const model = patternRowModel(fp)!;
    expect(model.usable).toBe(true);
    expect(Math.abs(model.medianPitchM - o.pitch) / o.pitch).toBeLessThan(0.08);
    expect(model.tiles.length).toBe(fp.summary.blocks);

    // The weed on the row between two trees is between plants; a tree is not; the weed between rows is not.
    const nearest = nearestPlantFinder(fp);
    expect(nearest(tree)!).toBeLessThan(0.4);
    const weedOnRow = o.at(o.onRow.x, o.onRow.y);
    expect(nearest(weedOnRow)!).toBeGreaterThan(0.7);
    expect(betweenPlantsAt(fp, nearest, weedOnRow, 0.12)).toBe(true);
    expect(betweenPlantsAt(fp, nearest, tree, 0.12)).toBe(false);
    expect(betweenPlantsAt(fp, nearest, weedOnRow, 1.5)).toBe(false);

    // rankCandidates turns such a blob into a "between plants" candidate and leaves a tree alone.
    const tileOf = (p: LatLng2): AnalysisTile => ({ id: "t", col: 0, row: 0, ring: [], centroid: p, clipped: false, headland: false } as unknown as AnalysisTile);
    const blobAt = (id: string, p: LatLng2, areaM2: number): Blob => ({
      id, tileId: "t", centroid: p, areaM2, equivDiameterM: 2 * Math.sqrt(areaM2 / Math.PI), widthM: 0.3, heightM: 0.3, extent: 0.7,
      chromaR: 0.3, chromaG: 0.45, chromaB: 0.25, exgMean: 0.3, brightness: 0.4, gsdM: 0.02, touchesBorder: false,
      distanceToRowM: dist(p), rowConfidence: 0.9,
    });
    const blobs = [blobAt("weed", weedOnRow, 0.12), blobAt("tree", tree, 0.8), ...Array.from({ length: 10 }, (_, i) => blobAt(`t${i}`, o.at(o.cx + (i - 5) * 2 * o.tx + 4.5 * o.nx, o.cy + (i - 5) * 2 * o.ty + 4.5 * o.ny), 0.8))];
    const ranked = rankCandidates({ blobs, tiles: [tileOf(tree)], flags: [], regions: [], rows: model, params: DEFAULT_SCOUT_PARAMS, pattern: fp });
    const kinds = Object.fromEntries(ranked.candidates.map(c => [c.blob?.id, c.kind]));
    expect(kinds.weed).toBe("between plants");
    expect(kinds.tree).toBeUndefined();
  }, 120_000);

  it("reads a field through injected windows and assembles the whole", async () => {
    const o = orchard();
    const bbox = o.raster.bounds;
    const ring = [o.at(1, -1), o.at(59, -1), o.at(59, -44), o.at(1, -44), o.at(1, -1)];
    const plan = planPatternWindows(bbox, [ring], 21, { windowM: 40, overlapM: 10 });
    expect(plan.windows.length).toBeGreaterThanOrEqual(2);
    // Each window gets the part of the raster it asked for.
    const cut = (b: { north: number; south: number; east: number; west: number }): RasterSource => {
      const W = o.raster.width, H = o.raster.height, rb = o.raster.bounds;
      const x0 = Math.max(0, Math.floor(((b.west - rb.west) / (rb.east - rb.west)) * W)), x1 = Math.min(W, Math.ceil(((b.east - rb.west) / (rb.east - rb.west)) * W));
      const y0 = Math.max(0, Math.floor(((rb.north - b.north) / (rb.north - rb.south)) * H)), y1 = Math.min(H, Math.ceil(((rb.north - b.south) / (rb.north - rb.south)) * H));
      const w = x1 - x0, h = y1 - y0, rgba = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) rgba.set(o.raster.rgba.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x1) * 4), y * w * 4);
      return { width: w, height: h, rgba, bounds: { north: rb.north - (y0 / H) * (rb.north - rb.south), south: rb.north - (y1 / H) * (rb.north - rb.south), west: rb.west + (x0 / W) * (rb.east - rb.west), east: rb.west + (x1 / W) * (rb.east - rb.west) } };
    };
    const progress: string[] = [];
    const fp = await readFieldPattern(() => "", plan, { lat: bbox.north, lng: bbox.west }, {
      rowSpacingM: "auto",
      fetch: async win => ({ raster: cut(win.fetch), missingTiles: 0 }),
      analyse: (px, params) => analysePhotoOffThread(px, params, { inline: true }),
      onProgress: (_i, _n, note) => { progress.push(note); },
    });
    expect(progress[progress.length - 1]).toBe("done");
    expect(fp.summary.windowsWithRows).toBe(plan.windows.length);
    expect(Math.abs(fp.summary.rowSpacingM! - o.pitch) / o.pitch).toBeLessThan(0.08);
    // No plant is counted twice: each lies in exactly one owned rectangle.
    const seen = new Set<string>();
    for (const p of fp.plants) { const k = `${p.centroid.lat.toFixed(7)},${p.centroid.lng.toFixed(7)}`; expect(seen.has(k)).toBe(false); seen.add(k); }
    expect(fp.summary.plantCount).toBeGreaterThan(o.planted * 0.8);
  }, 180_000);
});
