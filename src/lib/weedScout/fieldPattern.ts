// The planting pattern of a whole field, read from the field map.
//
// The pass in photoScout/pattern.ts reads one raster in its own frame: pixels,
// metres, y up. This module runs it over the field map window by window at
// the zoom nearest PATTERN_TARGET_GSD_M (the pattern and the crop plants hold
// at 5 cm per pixel; only the small weeds need the photos, see
// docs/features/field-intelligence-plan.md), and puts what it finds on the
// ground: row lines and plants in lat/lng, one row model the rest of the
// scout can read, and a distance-to-row function that follows each settled
// row line rather than a straight model.
//
// Windows overlap so a row block at a window's edge has its neighbourhood;
// each window owns a rectangle and only what falls inside it is kept, so
// nothing is counted twice. Pure apart from the tile fetch and the worker,
// which are injected: the conversion is tested on a synthetic raster.
import type { RasterSource } from "../cellFeatures";
import { M_PER_DEG_LAT, type LatLng2, mPerDegLng, pointInAnyRing } from "../geo";
import {
  type BlobClass, type PhotoParams, type PhotoPattern, type RowLine, placeOnRows, rowSegmentsPx,
} from "../photoScout/pattern";
import { analysePhotoOffThread } from "../photoScout/runPattern";
import { localFrame } from "./rows";
import { rasterGsdM } from "./tiles";
import type { RowModel, RowTileFit } from "./types";
import { fetchRaster } from "./zoom";

export type Bounds = { north: number; south: number; east: number; west: number };

/** The pixel size the pattern is read at: fine enough for the crop plants, coarse enough to read a field in minutes. */
export const PATTERN_TARGET_GSD_M = 0.05;
/** Ground edge of one pattern window, metres: twelve orchard rows. */
export const PATTERN_WINDOW_M = 60;
/** Overlap between pattern windows, metres: a row block at the edge still has neighbours. */
export const PATTERN_OVERLAP_M = 12;
/** The pass's own window inside a pattern window, metres. */
export const PATTERN_FIT_WINDOW_M = 12;
/** Pattern windows per field before the window grows. */
export const PATTERN_MAX_WINDOWS = 200;
/** Map tiles one pattern window may fetch. */
export const PATTERN_MAX_TILES = 64;
/** A point further than this from any block's windows has no row under it. */
export const PATTERN_REACH_M = 12;
/** An on-row blob further than this share of a plant from the nearest crop plant sits between plants. */
export const BETWEEN_PLANT_SHARE = 0.6;
/** ...and is at most this share of a plant in area: a weed under the row, not a crop plant the pattern missed. */
export const BETWEEN_PLANT_MAX_AREA_SHARE = 0.5;

export type PatternWindow = { id: string; col: number; row: number; fetch: Bounds; owned: Bounds };
export type PatternPlan = { z: number; gsdM: number; windowM: number; windows: PatternWindow[]; grown: boolean };

/** One row of one block, clipped to the window it was read in. Two points. */
export type PatternLine = { windowId: string; block: number; rowIndex: number; points: [LatLng2, LatLng2] };

export type PatternPlant = {
  id: string;
  windowId: string;
  block: number;
  centroid: LatLng2;
  areaM2: number;
  equivDiameterM: number;
  cls: BlobClass;
  rowIndex: number | null;
  /** Signed metres across from the settled row line. */
  distanceToRowM: number | null;
};

/** A local rectangle, metres in the window's frame (origin at the raster's north-west corner, y up). */
type Rect = { x0: number; y0: number; x1: number; y1: number };

export type PatternBlock = {
  windowId: string;
  id: number;
  /** Ground degrees counterclockwise from east, in [0, 180). */
  angleDeg: number;
  /** Compass bearing of the row line, degrees clockwise from north, in [0, 180). For people. */
  bearingDeg: number;
  pitchM: number;
  confidence: number;
  plants: number;
  seedSpacingM: number | null;
  squareGrid: boolean;
  /** The block's model and settled lines, in the window's frame. */
  fit: RowTileFit;
  rowLines: RowLine[];
  /** The pass's windows of this block, in the window's frame. */
  rects: Rect[];
};

export type PatternWindowResult = {
  win: PatternWindow;
  /** The raster's north-west corner: the origin of the window's frame. */
  origin: LatLng2;
  gsdM: number;
  /** The pass's own windows in this pattern window, and how many found rows. */
  fitWindows: number;
  usableWindows: number;
  blocks: PatternBlock[];
  plantDiameterM: number | null;
  seedSpacingM: number | null;
  seedAgreement: number | null;
  canopyClosed: boolean;
  missingTiles: number;
  notes: string[];
  /** Why this window gave nothing, when the pass itself failed on it. */
  failed?: string | null;
};

export type PatternSummary = {
  windows: number;
  /** Pattern windows in which at least one block was found. */
  windowsWithRows: number;
  fitWindows: number;
  usableFitWindows: number;
  blocks: number;
  rowSpacingM: number | null;
  /** The main direction, compass bearing of the row line. */
  bearingDeg: number | null;
  plantSpacingM: number | null;
  plantDiameterM: number | null;
  /** Blobs on pattern: the crop. */
  plantCount: number;
  /** Blobs between plants and off the rows at this resolution: the large weeds. */
  offPatternCount: number;
  seedAgreement: number | null;
  squareGrid: boolean;
  missingTiles: number;
};

export type FieldPattern = {
  z: number;
  gsdM: number;
  windowM: number;
  /** The frame plants and lines are also given in, for callers that want metres: the field's north-west corner. */
  origin: LatLng2;
  windows: PatternWindowResult[];
  plants: PatternPlant[];
  lines: PatternLine[];
  summary: PatternSummary;
  notes: string[];
};

/** Web Mercator ground resolution at a latitude and zoom, metres per pixel. */
export const metresPerPixelAt = (lat: number, z: number): number => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** The baked zoom whose pixel size is nearest the target, never deeper than the scan was baked. */
export function patternZoom(lat: number, maxNative: number, targetGsdM = PATTERN_TARGET_GSD_M): number {
  let best = Math.min(22, maxNative), bestErr = Infinity;
  for (let z = 14; z <= Math.min(22, maxNative); z++) {
    const err = Math.abs(Math.log(metresPerPixelAt(lat, z) / targetGsdM));
    if (err < bestErr) { bestErr = err; best = z; }
  }
  return best;
}

/**
 * Lay pattern windows over the field's bounding box. Only windows that touch
 * the boundary are kept; the window grows until the count fits the budget.
 */
export function planPatternWindows(
  bbox: Bounds, boundary: LatLng2[][], maxNative: number,
  opts: { targetGsdM?: number; windowM?: number; overlapM?: number; maxWindows?: number } = {},
): PatternPlan {
  const midLat = (bbox.north + bbox.south) / 2;
  const z = patternZoom(midLat, maxNative, opts.targetGsdM ?? PATTERN_TARGET_GSD_M);
  const gsdM = metresPerPixelAt(midLat, z);
  const mLng = mPerDegLng(midLat);
  const widthM = (bbox.east - bbox.west) * mLng, heightM = (bbox.north - bbox.south) * M_PER_DEG_LAT;
  const overlapM = opts.overlapM ?? PATTERN_OVERLAP_M, maxWindows = opts.maxWindows ?? PATTERN_MAX_WINDOWS;
  let windowM = opts.windowM ?? PATTERN_WINDOW_M;
  const fit = Math.sqrt((widthM * heightM) / maxWindows) + overlapM;
  const grown = fit > windowM;
  if (grown) windowM = Math.ceil(fit);
  // Windows are spaced evenly so each is a full window: a thin remainder at
  // the field's edge would hold too few rows to fit. Each owns the stretch
  // nearer its centre than its neighbours', so the owned rectangles tile the
  // box and nothing is counted twice.
  const axis = (extent: number): { from: number; to: number; own0: number; own1: number }[] => {
    if (extent <= windowM) return [{ from: 0, to: extent, own0: 0, own1: extent }];
    const n = Math.max(2, Math.ceil((extent - overlapM) / (windowM - overlapM)));
    const stride = (extent - windowM) / (n - 1);
    return Array.from({ length: n }, (_, i) => {
      const from = i * stride, to = from + windowM, centre = from + windowM / 2;
      const prev = i === 0 ? null : (i - 1) * stride + windowM / 2, next = i === n - 1 ? null : (i + 1) * stride + windowM / 2;
      return { from, to, own0: prev == null ? 0 : (prev + centre) / 2, own1: next == null ? extent : (centre + next) / 2 };
    });
  };
  const xs = axis(widthM), ys = axis(heightM);
  const toBounds = (x0: number, x1: number, y0: number, y1: number): Bounds => ({
    west: bbox.west + x0 / mLng, east: bbox.west + x1 / mLng,
    south: bbox.south + y0 / M_PER_DEG_LAT, north: bbox.south + y1 / M_PER_DEG_LAT,
  });
  const touches = (b: Bounds): boolean => {
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      const p = { lng: b.west + ((b.east - b.west) * i) / 4, lat: b.south + ((b.north - b.south) * j) / 4 };
      if (pointInAnyRing(p, boundary)) return true;
    }
    // A boundary vertex inside the window counts too, for a window larger than a small plot.
    return boundary.some(ring => ring.some(p => p.lng >= b.west && p.lng <= b.east && p.lat >= b.south && p.lat <= b.north));
  };
  const windows: PatternWindow[] = [];
  for (let r = 0; r < ys.length; r++) {
    for (let c = 0; c < xs.length; c++) {
      const owned = toBounds(xs[c].own0, xs[c].own1, ys[r].own0, ys[r].own1);
      if (!touches(owned)) continue;
      windows.push({ id: `${c}:${r}`, col: c, row: r, owned, fetch: toBounds(xs[c].from, xs[c].to, ys[r].from, ys[r].to) });
    }
  }
  return { z, gsdM, windowM, windows, grown };
}

/** Liang-Barsky: the parameter range of segment A→B inside a rectangle, or null. */
function clipParam(ax: number, ay: number, bx: number, by: number, r: Rect): [number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const checks: [number, number][] = [[-dx, ax - r.x0], [dx, r.x1 - ax], [-dy, ay - r.y0], [dy, r.y1 - ay]];
  for (const [p, q] of checks) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [t0, t1];
}

const distToRect = (x: number, y: number, r: Rect): number => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.y0 - y, 0, y - r.y1));

/**
 * What one raster's pattern means on the ground. Pure: the pass has run, this
 * places its blocks, lines and plants in lat/lng and keeps what the window
 * owns.
 */
export function convertPattern(raster: Pick<RasterSource, "width" | "height" | "bounds">, win: PatternWindow, pattern: PhotoPattern, missingTiles = 0): PatternWindowResult {
  const gsdM = pattern.gsdM;
  const origin: LatLng2 = { lat: raster.bounds.north, lng: raster.bounds.west };
  const frame = localFrame(origin);
  const ownedXY = { a: frame.toXY({ lat: win.owned.south, lng: win.owned.west }), b: frame.toXY({ lat: win.owned.north, lng: win.owned.east }) };
  const owned: Rect = { x0: ownedXY.a.x, y0: ownedXY.a.y, x1: ownedXY.b.x, y1: ownedXY.b.y };
  const toRect = (w: { x0: number; y0: number; x1: number; y1: number }): Rect => ({ x0: w.x0 * gsdM, x1: (w.x1 + 1) * gsdM, y0: -(w.y1 + 1) * gsdM, y1: -w.y0 * gsdM });
  const blocks: PatternBlock[] = pattern.blocks.map(b => ({
    windowId: win.id, id: b.id, angleDeg: b.angleDeg, bearingDeg: (((90 - b.angleDeg) % 180) + 180) % 180,
    pitchM: b.pitchM, confidence: pattern.windows[b.windows[0]]?.fit.confidence ?? 0,
    plants: b.plants, seedSpacingM: b.seedSpacingM, squareGrid: b.squareGrid,
    fit: pattern.windows[b.windows[0]].fit, rowLines: b.rowLines, rects: b.windows.map(i => toRect(pattern.windows[i])),
  }));
  return {
    win, origin, gsdM,
    fitWindows: pattern.summary.windows, usableWindows: pattern.summary.usableWindows,
    blocks,
    plantDiameterM: pattern.summary.plantDiameterM, seedSpacingM: pattern.summary.seedSpacingM, seedAgreement: pattern.summary.seedAgreement,
    canopyClosed: pattern.canopyClosed, missingTiles, notes: pattern.notes,
    // Kept on the result object for the field-level assembly below, then dropped.
    ...({ __lines: linesOf(pattern, blocks, owned, frame, win.id), __plants: plantsOf(pattern, owned, frame, win.id) } as object),
  };
}

function linesOf(pattern: PhotoPattern, blocks: PatternBlock[], owned: Rect, frame: ReturnType<typeof localFrame>, windowId: string): PatternLine[] {
  const out: PatternLine[] = [];
  for (const b of blocks) {
    const first = pattern.windows[pattern.blocks.find(x => x.id === b.id)!.windows[0]];
    for (const seg of rowSegmentsPx(first, pattern.gsdM)) {
      const ax = seg.x1 * pattern.gsdM, ay = -seg.y1 * pattern.gsdM, bx = seg.x2 * pattern.gsdM, by = -seg.y2 * pattern.gsdM;
      // The row runs where the block has windows: the union of the segment's
      // pieces inside them, then clipped to what this window owns.
      let tMin = Infinity, tMax = -Infinity;
      for (const r of b.rects) {
        const t = clipParam(ax, ay, bx, by, r);
        if (t) { tMin = Math.min(tMin, t[0]); tMax = Math.max(tMax, t[1]); }
      }
      if (!(tMin < tMax)) continue;
      const o = clipParam(ax, ay, bx, by, owned);
      if (!o) continue;
      const t0 = Math.max(tMin, o[0]), t1 = Math.min(tMax, o[1]);
      if (!(t1 - t0 > 1e-6)) continue;
      const p0 = frame.toLatLng(ax + (bx - ax) * t0, ay + (by - ay) * t0), p1 = frame.toLatLng(ax + (bx - ax) * t1, ay + (by - ay) * t1);
      out.push({ windowId, block: b.id, rowIndex: seg.rowIndex, points: [p0, p1] });
    }
  }
  return out;
}

function plantsOf(pattern: PhotoPattern, owned: Rect, frame: ReturnType<typeof localFrame>, windowId: string): PatternPlant[] {
  const out: PatternPlant[] = [];
  for (const b of pattern.blobs) {
    if (b.cls === "unplaced" || b.window == null) continue;
    const x = b.x * pattern.gsdM, y = -b.y * pattern.gsdM;
    if (x < owned.x0 || x > owned.x1 || y < owned.y0 || y > owned.y1) continue;
    const block = pattern.windows[b.window].block;
    if (block == null) continue;
    out.push({ id: `${windowId}:${b.id}`, windowId, block, centroid: frame.toLatLng(x, y), areaM2: b.areaM2, equivDiameterM: b.equivDiameterM, cls: b.cls, rowIndex: b.rowIndex, distanceToRowM: b.acrossM });
  }
  return out;
}

const median = (xs: number[]): number | null => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const meanAngle = (angles: number[]): number | null => {
  if (!angles.length) return null;
  let c = 0, s = 0;
  for (const a of angles) { const t = (2 * a * Math.PI) / 180; c += Math.cos(t); s += Math.sin(t); }
  return ((((Math.atan2(s, c) / 2) * 180) / Math.PI) % 180 + 180) % 180;
};

/** The field's pattern from its windows' results. */
export function assembleFieldPattern(plan: PatternPlan, origin: LatLng2, results: PatternWindowResult[]): FieldPattern {
  const plants: PatternPlant[] = [], lines: PatternLine[] = [];
  const windows = results.map(r => {
    const x = r as PatternWindowResult & { __lines?: PatternLine[]; __plants?: PatternPlant[] };
    if (x.__lines) lines.push(...x.__lines);
    if (x.__plants) plants.push(...x.__plants);
    const { __lines: _l, __plants: _p, ...rest } = x;
    return rest as PatternWindowResult;
  });
  const blocks = windows.flatMap(w => w.blocks);
  const pitches: number[] = [], angles: number[] = [];
  for (const b of blocks) for (let i = 0; i < Math.min(50, b.rects.length); i++) { pitches.push(b.pitchM); angles.push(b.angleDeg); }
  const mainAngle = meanAngle(angles);
  const summary: PatternSummary = {
    windows: windows.length,
    windowsWithRows: windows.filter(w => w.blocks.length > 0).length,
    fitWindows: windows.reduce((s, w) => s + w.fitWindows, 0),
    usableFitWindows: windows.reduce((s, w) => s + w.usableWindows, 0),
    blocks: blocks.length,
    rowSpacingM: median(pitches),
    bearingDeg: mainAngle == null ? null : (((90 - mainAngle) % 180) + 180) % 180,
    plantSpacingM: median(blocks.map(b => b.seedSpacingM ?? NaN)),
    plantDiameterM: median(windows.map(w => w.plantDiameterM ?? NaN)),
    plantCount: plants.filter(p => p.cls === "on pattern").length,
    offPatternCount: plants.filter(p => p.cls === "off-row" || p.cls === "between plants").length,
    seedAgreement: median(windows.map(w => w.seedAgreement ?? NaN)),
    squareGrid: blocks.some(b => b.squareGrid),
    missingTiles: windows.reduce((s, w) => s + w.missingTiles, 0),
  };
  return { z: plan.z, gsdM: plan.gsdM, windowM: plan.windowM, origin, windows, plants, lines, summary, notes: patternNotes(plan, windows, summary) };
}

/**
 * Why the field read as it did, in a line or two: how many windows showed
 * rows, how many fit windows were trusted, what went missing or failed, and
 * the pass's own most common word on the windows that showed nothing.
 * The run notes carry this, so a field that reads nothing says why.
 */
export function patternNotes(plan: PatternPlan, windows: PatternWindowResult[], summary: PatternSummary): string[] {
  const out: string[] = [];
  const planned = plan.windows.length, read = windows.length;
  const failed = windows.filter(w => w.failed), closed = windows.filter(w => w.canopyClosed);
  out.push(
    `Pattern pass: ${summary.windowsWithRows} of ${read} window(s) showed rows (${summary.usableFitWindows} of ${summary.fitWindows} fit windows trusted)` +
    `${planned > read ? `, ${planned - read} window(s) had no imagery` : ""}${summary.missingTiles ? `, ${summary.missingTiles} tile(s) failed to load` : ""}` +
    `${closed.length ? `, ${closed.length} window(s) read as closed canopy` : ""}${failed.length ? `, ${failed.length} window(s) failed (${failed[0].failed})` : ""}, at ${(plan.gsdM * 100).toFixed(1)} cm per pixel (zoom ${plan.z}).`,
  );
  if (summary.windowsWithRows === 0) {
    const counts = new Map<string, number>();
    for (const w of windows) for (const n of w.notes) counts.set(n, (counts.get(n) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) out.push(`The pass said of ${top[1]} window(s): ${top[0]}`);
  }
  return out;
}

/** The pass as it runs: the plan, how many windows are read, the one being read, and the field assembled from the windows so far. */
export type PatternLive = { plan: PatternPlan; done: number; current: PatternWindow | null; pattern: FieldPattern };

export type ReadPatternOptions = {
  rowSpacingM: number | "auto";
  /** Called before the first window and after each one, for a map that shows the pass working. */
  onWindow?: (live: PatternLive) => void;
  rowAngleDeg?: number | null;
  minBlobAreaCm2?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, note: string) => void;
  /** Injected for tests: the pass on one raster. Defaults to the worker. */
  analyse?: (px: RasterSource, params: PhotoParams) => Promise<PhotoPattern>;
  /** Injected for tests: the raster of a window. Defaults to the tile fetch. */
  fetch?: (win: PatternWindow, z: number) => Promise<{ raster: RasterSource; missingTiles: number }>;
};

/** Read the pattern of every planned window, in order, and assemble the field. */
export async function readFieldPattern(
  template: (z: number, x: number, y: number) => string, plan: PatternPlan, origin: LatLng2, opts: ReadPatternOptions,
): Promise<FieldPattern> {
  const results: PatternWindowResult[] = [];
  const live = (i: number) => opts.onWindow?.({ plan, done: results.length, current: plan.windows[i] ?? null, pattern: assembleFieldPattern(plan, origin, results) });
  live(0);
  const fetchWin = opts.fetch ?? (async (win: PatternWindow, z: number) => {
    const { raster, missingTiles } = await fetchRaster(template, win.fetch, z, PATTERN_MAX_TILES);
    return { raster, missingTiles };
  });
  const analyse = opts.analyse ?? ((px: RasterSource, params: PhotoParams) => analysePhotoOffThread(px, params, { signal: opts.signal, transfer: true }));
  for (let i = 0; i < plan.windows.length; i++) {
    const win = plan.windows[i];
    opts.onProgress?.(i, plan.windows.length, `window ${i + 1} of ${plan.windows.length}`);
    if (opts.signal?.aborted) throw Object.assign(new Error("Pattern pass cancelled."), { name: "Aborted" });
    const { raster, missingTiles } = await fetchWin(win, plan.z);
    if (raster.width < 16 || raster.height < 16) continue;
    try {
      const pattern = await analyse(raster, {
        gsdM: rasterGsdM(raster), rowSpacingM: opts.rowSpacingM, windowM: PATTERN_FIT_WINDOW_M,
        minBlobAreaCm2: opts.minBlobAreaCm2, rowAngleDeg: opts.rowAngleDeg ?? null,
      });
      results.push(convertPattern(raster, win, pattern, missingTiles));
    } catch (e) {
      if ((e as Error)?.name === "Aborted") throw e;
      // One window failing is one window without rows, not a field without a pattern.
      results.push({
        win, origin: { lat: raster.bounds.north, lng: raster.bounds.west }, gsdM: rasterGsdM(raster), fitWindows: 0, usableWindows: 0, blocks: [],
        plantDiameterM: null, seedSpacingM: null, seedAgreement: null, canopyClosed: false, missingTiles, notes: [], failed: (e as Error)?.message ?? String(e),
      });
    }
    live(i + 1);
  }
  opts.onProgress?.(plan.windows.length, plan.windows.length, "done");
  return assembleFieldPattern(plan, origin, results);
}

/** Does the point fall inside the window's owned rectangle? */
const inBounds = (p: LatLng2, b: Bounds): boolean => p.lat <= b.north && p.lat >= b.south && p.lng >= b.west && p.lng <= b.east;

/**
 * Signed metres from a point to the nearest settled row line, or null where
 * no block reaches: the block whose windows are nearest the point places it
 * with its own lines, which follow the rows where they fan or sit unevenly.
 */
export function patternDistance(fp: FieldPattern): (p: LatLng2) => number | null {
  return (p: LatLng2) => {
    for (const w of fp.windows) {
      if (!inBounds(p, w.win.owned)) continue;
      if (w.blocks.length === 0) return null;
      const { x, y } = localFrame(w.origin).toXY(p);
      let best: PatternBlock | null = null, bestD = Infinity;
      for (const b of w.blocks) {
        let d = Infinity;
        for (const r of b.rects) { d = Math.min(d, distToRect(x, y, r)); if (d === 0) break; }
        if (d < bestD) { bestD = d; best = b; }
      }
      if (!best || bestD > PATTERN_REACH_M) return null;
      return placeOnRows(best.fit, x, y, best.rowLines).acrossM;
    }
    return null;
  };
}

/** The scout's row model, built from the pattern's blocks, for the code that reads one. */
export function patternRowModel(fp: FieldPattern): RowModel | null {
  const frame = localFrame(fp.origin);
  const tiles: RowTileFit[] = [];
  for (const w of fp.windows) {
    const wf = localFrame(w.origin);
    for (const b of w.blocks) {
      const centre = frame.toXY(wf.toLatLng(b.fit.centre.x, b.fit.centre.y));
      tiles.push({ ...b.fit, centre, sizeM: Math.max(b.fit.sizeM, fp.windowM) });
    }
  }
  if (!tiles.length) return null;
  return {
    tiles, origin: fp.origin, usable: true,
    confidence: median(tiles.map(t => t.confidence)) ?? 0,
    medianAngleDeg: fp.windows.flatMap(w => w.blocks).length ? meanAngle(fp.windows.flatMap(w => w.blocks.map(b => b.angleDeg)))! : 0,
    medianPitchM: fp.summary.rowSpacingM ?? 0,
  };
}

/** Distance from a point to the nearest crop plant the pattern placed, by a 2 m grid over the field. */
export function nearestPlantFinder(fp: FieldPattern): (p: LatLng2) => number | null {
  const frame = localFrame(fp.origin);
  const cell = 2;
  const grid = new Map<string, { x: number; y: number }[]>();
  for (const pl of fp.plants) {
    if (pl.cls !== "on pattern") continue;
    const { x, y } = frame.toXY(pl.centroid);
    const k = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
    let list = grid.get(k);
    if (!list) { list = []; grid.set(k, list); }
    list.push({ x, y });
  }
  if (!grid.size) return () => null;
  return (p: LatLng2) => {
    const { x, y } = frame.toXY(p);
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let best = Infinity;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const q of grid.get(`${cx + i}:${cy + j}`) ?? []) best = Math.min(best, Math.hypot(q.x - x, q.y - y));
    }
    return Number.isFinite(best) ? best : null;
  };
}

/**
 * Is a blob on the row but not a crop plant: further from the nearest placed
 * plant than BETWEEN_PLANT_SHARE of a plant, and small? A weed under the row.
 */
export function betweenPlantsAt(fp: FieldPattern, nearest: (p: LatLng2) => number | null, p: LatLng2, areaM2: number): boolean {
  const d = fp.summary.plantDiameterM;
  if (d == null || !(d > 0)) return false;
  const plantArea = Math.PI * (d / 2) ** 2;
  if (areaM2 > BETWEEN_PLANT_MAX_AREA_SHARE * plantArea) return false;
  const n = nearest(p);
  return n != null && n > BETWEEN_PLANT_SHARE * d;
}
