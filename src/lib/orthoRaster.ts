// Turn the orthomosaic's map tiles back into one decoded raster.
//
// WHY THIS EXISTS. The interactive matcher (cellFeatures.ts) needs NUMBERS — an
// RGBA array with known WGS84 bounds — and nothing in the app has them. The
// viewer consumes {z}/{x}/{y} tiles that go straight into Leaflet <img>
// elements and are never readable as data. This module fetches the tiles that
// cover the field at a zoom deep enough to sample cells, draws them onto one
// canvas, and reads the pixels back. It is the "stitch tiles" path chosen over
// a dedicated bounded-image endpoint: it reuses the existing tile pipeline,
// its cache, and its auth, at the cost of a Mercator subtlety noted below.
//
// THE MERCATOR SUBTLETY. Tiles are Web Mercator; RasterSource is declared
// north-up with LINEAR latitude. Over a whole country those disagree wildly.
// Over a field they do not: the row error across a boundary Δlat is of order
// (Δlat · tanφ / 2) of the raster height — for a 1 km field at 45° latitude
// that is roughly 0.1%, under one pixel in a thousand-pixel raster and far
// inside a 6 m cell. Fields larger than the 20k-cell ceiling cannot exist here,
// so the approximation is safe by construction. Do not reuse this module for
// anything continent-sized.
import type { RasterSource } from "./cellFeatures";
import { MIN_PIXELS_PER_CELL } from "./cellFeatures";
import { metresPerPixel } from "./gridRender";

export const TILE_SIZE = 256;

/**
 * Hard cap on tiles fetched for one sampling pass.
 *
 * 64 tiles is a 2048×2048 canvas — 16 MB of RGBA — and about the most a field
 * tablet should be asked to hold while also running a Leaflet map. The zoom
 * backs off rather than exceeding it, trading pixels-per-cell for fitting in
 * memory, and the caller is told what it got via the returned cellPx.
 */
export const MAX_TILES = 64;

/** Slippy-map tile x/y of a coordinate at a zoom. */
export function tileOf(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  };
}

/** North-west corner of a tile, WGS84. */
export function tileCorner(x: number, y: number, z: number): { lat: number; lng: number } {
  const n = 2 ** z;
  const lng = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lat, lng };
}

export type TileRange = { z: number; minX: number; maxX: number; minY: number; maxY: number };

export function tileRangeFor(
  bounds: { north: number; south: number; east: number; west: number }, z: number,
): TileRange {
  const a = tileOf(bounds.north, bounds.west, z);
  const b = tileOf(bounds.south, bounds.east, z);
  return {
    z,
    minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y),
  };
}

export const tileCount = (r: TileRange): number =>
  (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);

/**
 * Pick the zoom for sampling: deep enough that a cell holds a measurable
 * number of pixels, shallow enough to stay under the tile budget.
 *
 * Targets ~10 px across a cell (≈100 px of area) against the statistics floor
 * of MIN_PIXELS_PER_CELL — headroom, because edge cells are clipped and hold
 * less than their bounding box suggests. When the budget forces a shallower
 * zoom, that is reported rather than hidden: the caller can warn that some
 * cells will be unscorable instead of quietly scoring noise.
 */
export function zoomForSampling(
  bounds: { north: number; south: number; east: number; west: number },
  cellSizeM: number,
  maxZoom: number,
  targetCellPx = 10,
): { z: number; cellPx: number; range: TileRange } {
  const midLat = (bounds.north + bounds.south) / 2;
  let z = maxZoom;
  // Walk down from the deepest zoom until the tile budget fits.
  while (z > 1 && tileCount(tileRangeFor(bounds, z)) > MAX_TILES) z--;
  // Then walk further down while a shallower zoom still meets the pixel target
  // — no point fetching four times the data the statistics need.
  while (z > 1) {
    const next = cellSizeM / metresPerPixel(midLat, z - 1);
    if (next < targetCellPx) break;
    z--;
  }
  return { z, cellPx: cellSizeM / metresPerPixel(midLat, z), range: tileRangeFor(bounds, z) };
}

export type StitchResult = {
  raster: RasterSource;
  /** Tiles that failed to load — their pixels stay alpha-0 (off-field). */
  missingTiles: number;
  cellPx: number;
};

/** The pixels one cell is expected to hold at a given on-screen size. */
export const expectedCellPixels = (cellPx: number): number => Math.floor(cellPx * cellPx);

/** Whether a sampling pass at this resolution can clear the statistics floor. */
export const resolutionSufficient = (cellPx: number): boolean =>
  expectedCellPixels(cellPx) >= MIN_PIXELS_PER_CELL;

/**
 * Fetch every tile covering the bounds and read them back as one raster.
 *
 * Browser-only (canvas + Image); everything decidable without a DOM lives in
 * the pure helpers above, which is where the tests are. Tiles that fail to
 * load leave alpha-0 holes rather than aborting the pass — a cell over a hole
 * comes back unusable, which is the honest answer for missing imagery.
 */
export async function stitchTiles(
  tileTemplate: (z: number, x: number, y: number) => string,
  bounds: { north: number; south: number; east: number; west: number },
  cellSizeM: number,
  maxZoom: number,
): Promise<StitchResult> {
  const { z, cellPx, range } = zoomForSampling(bounds, cellSizeM, maxZoom);
  const cols = range.maxX - range.minX + 1;
  const rows = range.maxY - range.minY + 1;

  const canvas = document.createElement("canvas");
  canvas.width = cols * TILE_SIZE;
  canvas.height = rows * TILE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create a canvas to sample the imagery.");

  let missingTiles = 0;
  await Promise.all(
    Array.from({ length: cols * rows }, (_, i) => {
      const x = range.minX + (i % cols);
      const y = range.minY + Math.floor(i / cols);
      return new Promise<void>(resolve => {
        const img = new Image();
        // Without this the canvas is tainted and getImageData throws — the
        // whole pass would die on a security error instead of sampling.
        img.crossOrigin = "anonymous";
        img.onload = () => {
          ctx.drawImage(img, (x - range.minX) * TILE_SIZE, (y - range.minY) * TILE_SIZE);
          resolve();
        };
        img.onerror = () => { missingTiles++; resolve(); };
        img.src = tileTemplate(z, x, y);
      });
    }),
  );

  // The raster's bounds are the TILE GRID's bounds, not the field's — the
  // stitched image starts at a tile corner, and declaring anything else would
  // shear every sample off its cell.
  const nw = tileCorner(range.minX, range.minY, z);
  const se = tileCorner(range.maxX + 1, range.maxY + 1, z);

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    throw new Error(
      "The imagery could not be read back. The tile server did not allow cross-origin sampling.",
    );
  }

  return {
    raster: {
      width: canvas.width,
      height: canvas.height,
      bounds: { north: nw.lat, south: se.lat, west: nw.lng, east: se.lng },
      rgba: data.data,
    },
    missingTiles,
    cellPx,
  };
}
