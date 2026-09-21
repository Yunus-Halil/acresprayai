// Step 1: the field boundary becomes analysis tiles.
//
// Axis-aligned in a local metric frame, sized in metres, clipped to the
// boundary by centroid. Unlike the treatment grid these tiles are not
// something an aircraft flies, so they owe nothing to the swath or the field
// heading; they exist to give the baseline pass a unit to compare, and the
// zoom pass a unit to re-read. Three metres is the default: at the 2 cm/px an
// operator gets from a 100 m mapping flight that is a 150 px square, enough
// to average, small enough that one odd plant still moves the average.
import { type LatLng2, M_PER_DEG_LAT, bboxOfRings, mPerDegLng, pointInAnyRing } from "../geo";
import type { RasterSource } from "../cellFeatures";
import type { AnalysisTile } from "./types";

/**
 * Ceiling on tile count. Per-tile work is a strided pixel pass, so the cost
 * is the raster more than the tiles, but the results are held in memory and
 * drawn, and a hundred-thousand-tile list is where a tablet gives up. Fails
 * loudly with the fix in the message.
 */
export const MAX_ANALYSIS_TILES = 60_000;

export class TooManyTilesError extends Error {
  constructor(readonly tiles: number, readonly tileM: number) {
    super(
      `This field needs ${tiles.toLocaleString()} analysis tiles at ${tileM} m, over the ` +
      `${MAX_ANALYSIS_TILES.toLocaleString()} limit. Use a larger tile size.`,
    );
    this.name = "TooManyTilesError";
  }
}

/** Metres from a point to the nearest boundary edge. */
export function distanceToBoundaryM(p: LatLng2, rings: LatLng2[][]): number {
  const mLng = mPerDegLng(p.lat);
  let best = Infinity;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const ax = (a.lng - p.lng) * mLng, ay = (a.lat - p.lat) * M_PER_DEG_LAT;
      const bx = (b.lng - p.lng) * mLng, by = (b.lat - p.lat) * M_PER_DEG_LAT;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const cx = ax + t * dx, cy = ay + t * dy;
      const d = Math.hypot(cx, cy);
      if (d < best) best = d;
    }
  }
  return best;
}

export type TileLattice = {
  minLat: number; minLng: number;
  dLat: number; dLng: number;
  cols: number; rows: number;
};

/** The lattice every tile id is defined on. Shared by the tessellation and the lookup. */
export function tileLattice(boundary: LatLng2[][], tileM: number): TileLattice {
  if (!(tileM > 0)) throw new Error("tileM must be positive");
  const bb = bboxOfRings(boundary);
  const midLat = (bb.minLat + bb.maxLat) / 2;
  const mLng = mPerDegLng(midLat);
  const widthM = (bb.maxLng - bb.minLng) * mLng;
  const heightM = (bb.maxLat - bb.minLat) * M_PER_DEG_LAT;
  const cols = Math.max(1, Math.ceil(widthM / tileM));
  const rows = Math.max(1, Math.ceil(heightM / tileM));
  if (cols * rows > MAX_ANALYSIS_TILES) throw new TooManyTilesError(cols * rows, tileM);
  return { minLat: bb.minLat, minLng: bb.minLng, dLat: tileM / M_PER_DEG_LAT, dLng: tileM / mLng, cols, rows };
}

/** Id of the tile a point falls in, or null outside the lattice. Existence is the caller's check. */
export function tileIdAt(lattice: TileLattice, p: LatLng2): string | null {
  const c = Math.floor((p.lng - lattice.minLng) / lattice.dLng);
  const r = Math.floor((p.lat - lattice.minLat) / lattice.dLat);
  if (c < 0 || r < 0 || c >= lattice.cols || r >= lattice.rows) return null;
  return `${c}:${r}`;
}

/**
 * Tessellate the boundary into `tileM` squares.
 *
 * A tile is kept when its centroid is inside the field; `clipped` says a
 * corner was not. Tiles inside the headland buffer are kept and marked rather
 * than dropped, because the baseline should still be computed over them (they
 * are real ground with a real average) even though nothing in them is scored.
 */
export function tessellate(
  boundary: LatLng2[][],
  tileM: number,
  headlandM: number,
): AnalysisTile[] {
  const lattice = tileLattice(boundary, tileM);
  const { cols, rows, dLat, dLng } = lattice;
  const bb = { minLat: lattice.minLat, minLng: lattice.minLng };
  const out: AnalysisTile[] = [];
  for (let r = 0; r < rows; r++) {
    const south = bb.minLat + r * dLat;
    const north = south + dLat;
    for (let c = 0; c < cols; c++) {
      const west = bb.minLng + c * dLng;
      const east = west + dLng;
      const centroid = { lat: (south + north) / 2, lng: (west + east) / 2 };
      if (!pointInAnyRing(centroid, boundary)) continue;
      const ring = [
        { lat: north, lng: west }, { lat: north, lng: east },
        { lat: south, lng: east }, { lat: south, lng: west },
      ];
      const clipped = !ring.every(p => pointInAnyRing(p, boundary));
      const headland = headlandM > 0 && distanceToBoundaryM(centroid, boundary) < headlandM;
      out.push({ id: `${c}:${r}`, col: c, row: r, ring, centroid, clipped, headland });
    }
  }
  if (out.length > MAX_ANALYSIS_TILES) throw new TooManyTilesError(out.length, tileM);
  return out;
}

export type PixelWindow = { x0: number; y0: number; x1: number; y1: number };

/** Pixel bounds of a tile in a north-up raster, clamped, inclusive. */
export function tileWindow(tile: AnalysisTile, src: Pick<RasterSource, "width" | "height" | "bounds">): PixelWindow | null {
  const { north, south, east, west } = src.bounds;
  const lats = tile.ring.map(p => p.lat), lngs = tile.ring.map(p => p.lng);
  const maxLat = Math.max(...lats), minLat = Math.min(...lats);
  const maxLng = Math.max(...lngs), minLng = Math.min(...lngs);
  const x0 = Math.max(0, Math.floor(((minLng - west) / (east - west)) * src.width));
  const x1 = Math.min(src.width - 1, Math.ceil(((maxLng - west) / (east - west)) * src.width) - 1);
  const y0 = Math.max(0, Math.floor(((north - maxLat) / (north - south)) * src.height));
  const y1 = Math.min(src.height - 1, Math.ceil(((north - minLat) / (north - south)) * src.height) - 1);
  if (x1 < x0 || y1 < y0) return null;
  return { x0, y0, x1, y1 };
}

/** Metres per pixel of a north-up WGS84 raster, at its middle latitude. */
export function rasterGsdM(src: Pick<RasterSource, "width" | "bounds">): number {
  const midLat = (src.bounds.north + src.bounds.south) / 2;
  return ((src.bounds.east - src.bounds.west) * mPerDegLng(midLat)) / src.width;
}

/** Geographic centre of a pixel. */
export function pixelLatLng(src: Pick<RasterSource, "width" | "height" | "bounds">, x: number, y: number): LatLng2 {
  const { north, south, east, west } = src.bounds;
  return {
    lng: west + ((x + 0.5) / src.width) * (east - west),
    lat: north - ((y + 0.5) / src.height) * (north - south),
  };
}
