// The full-depth sweep: read the whole interior at the deepest baked zoom,
// window by window, so the small things are seen at all.
//
// The base pass is capped at 64 map tiles, which on a real field means 10 to
// 20 cm per pixel. A 10 cm weed is one pixel there and nothing downstream can
// say anything about one pixel. The sweep walks the field at native zoom in
// windows of a few hundred pixels, fits the rows in each window with the
// coarse model's angle as a hint, measures every plant, and keeps each plant
// exactly once.
//
// OWNERSHIP, NOT OVERLAP ARITHMETIC. Windows overlap by at least one blob
// diameter, and every window owns a rectangle; the owned rectangles tile the
// field exactly with no gaps and no overlaps, and a blob is kept by the window
// that owns its centroid. Blobs touching a window's raster border are dropped
// before that test, because a cut blob has a displaced centroid. With the
// overlap at least a blob diameter, every blob appears whole in the window
// that owns it. Same rule as offrow/io.py, same reason.
//
// The planning is pure and tested. The fetching is browser-only.
import type { RasterSource } from "../cellFeatures";
import { type LatLng2, M_PER_DEG_LAT, mPerDegLng } from "../geo";
import { metresPerPixel } from "../gridRender";
import { TooManyBlobsError, extractBlobs } from "./blobs";
import { MIN_TILE_CONFIDENCE, fitRaster } from "./rows";
import { rasterGsdM } from "./tiles";
import type { AnalysisTile, Blob, RowTileFit } from "./types";
import { indexRaster, maskWindow } from "./vegetation";
import { type Bounds, fetchRaster } from "./zoom";

/** Window edge in pixels at the sweep zoom. Two map tiles, plus overlap. */
export const SWEEP_WINDOW_PX = 512;
/** Overlap between windows, metres. Larger than any plant the sweep is for. */
export const SWEEP_OVERLAP_M = 0.6;
/** Map tiles a window may fetch after alignment to the tile grid. */
export const SWEEP_MAX_TILES = 12;
/** Deepest zoom the sweep will read at. Tiles above this are rarely baked. */
export const SWEEP_MAX_ZOOM = 21;

export type SweepWindow = {
  id: string;
  col: number;
  row: number;
  /** What to fetch: the owned rectangle plus half the overlap on every side. */
  fetch: Bounds;
  /** What this window is responsible for. */
  owned: Bounds;
};

export type SweepPlan = {
  z: number;
  gsdM: number;
  windows: SweepWindow[];
  /** Levels backed off from the requested zoom to fit the budget. */
  backedOff: number;
  /** Ground metres one window covers along an edge, overlap included. */
  windowM: number;
};

/**
 * Lay windows over the field's bounding box at zoom `z`.
 *
 * Only windows whose owned rectangle contains at least one non-headland tile
 * centroid are kept; the rest is ground nothing will be scored on.
 */
export function planWindows(
  bbox: Bounds,
  tiles: AnalysisTile[],
  z: number,
  windowPx = SWEEP_WINDOW_PX,
  overlapM = SWEEP_OVERLAP_M,
): { windows: SweepWindow[]; gsdM: number; windowM: number } {
  const midLat = (bbox.north + bbox.south) / 2;
  const gsdM = metresPerPixel(midLat, z);
  const windowM = windowPx * gsdM;
  const stride = Math.max(1, windowM - overlapM);
  const mLng = mPerDegLng(midLat);
  const widthM = (bbox.east - bbox.west) * mLng;
  const heightM = (bbox.north - bbox.south) * M_PER_DEG_LAT;
  const cols = Math.max(1, Math.ceil(widthM / stride));
  const rows = Math.max(1, Math.ceil(heightM / stride));
  const half = overlapM / 2;

  const wanted = new Set<string>();
  for (const t of tiles) {
    if (t.headland) continue;
    const x = (t.centroid.lng - bbox.west) * mLng;
    const y = (t.centroid.lat - bbox.south) * M_PER_DEG_LAT;
    const c = Math.min(cols - 1, Math.max(0, Math.floor((x - half) / stride)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor((y - half) / stride)));
    wanted.add(`${c}:${r}`);
  }

  const windows: SweepWindow[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!wanted.has(`${c}:${r}`)) continue;
      const ox0 = c === 0 ? 0 : c * stride + half;
      const ox1 = c === cols - 1 ? widthM : (c + 1) * stride + half;
      const oy0 = r === 0 ? 0 : r * stride + half;
      const oy1 = r === rows - 1 ? heightM : (r + 1) * stride + half;
      const toBounds = (x0: number, x1: number, y0: number, y1: number): Bounds => ({
        west: bbox.west + x0 / mLng, east: bbox.west + x1 / mLng,
        south: bbox.south + y0 / M_PER_DEG_LAT, north: bbox.south + y1 / M_PER_DEG_LAT,
      });
      windows.push({
        id: `${c}:${r}`, col: c, row: r,
        owned: toBounds(ox0, ox1, oy0, oy1),
        fetch: toBounds(ox0 - half, ox1 + half, oy0 - half, oy1 + half),
      });
    }
  }
  return { windows, gsdM, windowM };
}

/** Pick the deepest zoom whose window count fits the budget. */
export function planSweep(
  bbox: Bounds,
  tiles: AnalysisTile[],
  maxNative: number,
  maxWindows: number,
): SweepPlan {
  let z = Math.min(SWEEP_MAX_ZOOM, maxNative);
  let backedOff = 0;
  for (;;) {
    const { windows, gsdM, windowM } = planWindows(bbox, tiles, z);
    if (windows.length <= maxWindows || z <= 14) return { z, gsdM, windows, backedOff, windowM };
    z--;
    backedOff++;
  }
}

export const inBounds = (p: LatLng2, b: Bounds): boolean =>
  p.lat >= b.south && p.lat < b.north && p.lng >= b.west && p.lng < b.east;

export type WindowResult = {
  blobs: Blob[];
  fit: RowTileFit | null;
  gsdM: number;
  failed: boolean;
  missingTiles: number;
  /** The window's mask was one sheet of vegetation; no plants could be separated. */
  canopy: boolean;
};

/**
 * Read one window and measure what it owns. Browser-only.
 *
 * The vegetation threshold is per window with the field's coarse threshold as
 * the fallback (chromaticity is scale-free, so the coarse number carries).
 * Rows are fitted in the window with the coarse angle as a hint; a fit below
 * the confidence floor is discarded and the coarse model answers instead.
 */
export async function sweepWindow(
  template: (z: number, x: number, y: number) => string,
  win: SweepWindow,
  z: number,
  opts: {
    fieldThreshold: number;
    growerSpacingM: number;
    angleHintDeg: number | null;
    minAreaCm2: number;
    tileOf: (p: LatLng2) => string | null;
    coarseDistance: (p: LatLng2) => number | null;
    /** False when the field is not a row crop: skip the fit, use coarseDistance (null) instead. */
    fitRows: boolean;
  },
): Promise<WindowResult> {
  let raster: RasterSource, missingTiles: number;
  try {
    ({ raster, missingTiles } = await fetchRaster(template, win.fetch, z, SWEEP_MAX_TILES));
  } catch {
    return { blobs: [], fit: null, gsdM: 0, failed: true, missingTiles: 0, canopy: false };
  }
  const gsdM = rasterGsdM(raster);
  const index = indexRaster(raster);
  const mask = new Uint8Array(raster.width * raster.height);
  // Per-window Otsu with the field's threshold as the fallback: maskWindow
  // decides whether this window has two modes of its own to split.
  maskWindow(
    index, raster.width, { x0: 0, y0: 0, x1: raster.width - 1, y1: raster.height - 1 },
    mask, opts.fieldThreshold,
  );
  const rowFit = opts.fitRows ? fitRaster(mask, raster, opts.growerSpacingM, opts.angleHintDeg) : null;
  const trusted = !!rowFit && rowFit.fit.confidence >= MIN_TILE_CONFIDENCE;
  let all: Blob[];
  try {
    all = extractBlobs(mask, raster, { minAreaCm2: opts.minAreaCm2, tileOf: opts.tileOf, idPrefix: `s${win.id}-` });
  } catch (e) {
    if (e instanceof TooManyBlobsError) return { blobs: [], fit: null, gsdM, failed: false, missingTiles, canopy: true };
    throw e;
  }
  const blobs: Blob[] = [];
  for (const b of all) {
    if (b.touchesBorder || !inBounds(b.centroid, win.owned)) continue;
    const d = trusted ? rowFit!.distanceTo(b.centroid) : opts.coarseDistance(b.centroid);
    blobs.push({ ...b, distanceToRowM: d, rowConfidence: trusted ? rowFit!.fit.confidence : null });
  }
  return { blobs, fit: trusted ? rowFit!.fit : null, gsdM, failed: false, missingTiles, canopy: false };
}
