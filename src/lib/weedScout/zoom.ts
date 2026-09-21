// Step 4: zoom in on the not-average things, but not on the operator's end.
//
// The base pass reads the whole field at whatever zoom fits the tile budget
// (orthoRaster.stitchTiles backs off to stay under 64 tiles), which on a big
// field is coarser than the scan was baked at. Flagged tiles are then re-read
// at the deepest baked zoom, one tile at a time, and the blobs remeasured on
// those pixels. The operator never drives this; they see the result as a chip
// beside each candidate and a refined size on it.
//
// The chip is upscaled with smoothing OFF. Bilinear upscaling invents edges
// the sensor never saw, and the chip's whole job, on screen and in the brain's
// prompt and in the archive, is to show exactly the pixels that exist.
//
// Browser-only (canvas + Image). Everything decidable without a DOM lives in
// the pure modules, where the tests are.
import type { RasterSource } from "../cellFeatures";
import type { LatLng2 } from "../geo";
import { M_PER_DEG_LAT, mPerDegLng } from "../geo";
import { TILE_SIZE, tileCorner, tileCount, tileRangeFor } from "../orthoRaster";
import { rasterGsdM } from "./tiles";

/** Tiles fetched per zoomed window. A 3 m analysis tile at z20 spans at most four. */
export const MAX_ZOOM_TILES_PER_WINDOW = 16;

export type Bounds = { north: number; south: number; east: number; west: number };

/** Grow a bounding box by `marginM` on every side. */
export function padBounds(b: Bounds, marginM: number): Bounds {
  const midLat = (b.north + b.south) / 2;
  const dLat = marginM / M_PER_DEG_LAT, dLng = marginM / mPerDegLng(midLat);
  return { north: b.north + dLat, south: b.south - dLat, east: b.east + dLng, west: b.west - dLng };
}

export function boundsOfRing(ring: LatLng2[]): Bounds {
  let north = -Infinity, south = Infinity, east = -Infinity, west = Infinity;
  for (const p of ring) {
    if (p.lat > north) north = p.lat;
    if (p.lat < south) south = p.lat;
    if (p.lng > east) east = p.lng;
    if (p.lng < west) west = p.lng;
  }
  return { north, south, east, west };
}

export function boundsAround(centre: LatLng2, spanM: number): Bounds {
  return padBounds({ north: centre.lat, south: centre.lat, east: centre.lng, west: centre.lng }, spanM / 2);
}

/**
 * Fetch every tile covering `bounds` at zoom `z` (backing off while the tile
 * budget is exceeded) and read the pixels back as one north-up raster whose
 * bounds are the TILE GRID's bounds, not the request's.
 */
export async function fetchRaster(
  template: (z: number, x: number, y: number) => string,
  bounds: Bounds,
  z: number,
  maxTiles = MAX_ZOOM_TILES_PER_WINDOW,
): Promise<{ raster: RasterSource; missingTiles: number; z: number }> {
  while (z > 1 && tileCount(tileRangeFor(bounds, z)) > maxTiles) z--;
  const range = tileRangeFor(bounds, z);
  const cols = range.maxX - range.minX + 1, rows = range.maxY - range.minY + 1;
  const canvas = document.createElement("canvas");
  canvas.width = cols * TILE_SIZE;
  canvas.height = rows * TILE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create a canvas to read the imagery.");
  let missingTiles = 0;
  await Promise.all(Array.from({ length: cols * rows }, (_, i) => {
    const x = range.minX + (i % cols), y = range.minY + Math.floor(i / cols);
    return new Promise<void>(resolve => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => { ctx.drawImage(img, (x - range.minX) * TILE_SIZE, (y - range.minY) * TILE_SIZE); resolve(); };
      img.onerror = () => { missingTiles++; resolve(); };
      img.src = template(z, x, y);
    });
  }));
  const nw = tileCorner(range.minX, range.minY, z);
  const se = tileCorner(range.maxX + 1, range.maxY + 1, z);
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    throw new Error("The imagery could not be read back. The tile server did not allow cross-origin sampling.");
  }
  return {
    raster: {
      width: canvas.width, height: canvas.height,
      bounds: { north: nw.lat, south: se.lat, west: nw.lng, east: se.lng },
      rgba: data.data,
    },
    missingTiles,
    z,
  };
}

/** Pixel rectangle of `bounds` within a raster, clamped and inclusive. Pure. */
export function pixelRect(src: Pick<RasterSource, "width" | "height" | "bounds">, b: Bounds) {
  const { north, south, east, west } = src.bounds;
  const x0 = Math.max(0, Math.floor(((b.west - west) / (east - west)) * src.width));
  const x1 = Math.min(src.width - 1, Math.ceil(((b.east - west) / (east - west)) * src.width) - 1);
  const y0 = Math.max(0, Math.floor(((north - b.north) / (north - south)) * src.height));
  const y1 = Math.min(src.height - 1, Math.ceil(((north - b.south) / (north - south)) * src.height) - 1);
  return { x0, y0, x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
}

/** Cut a sub-raster out of a larger one. Pure; bounds recomputed from the pixel edges. */
export function cropRaster(src: RasterSource, b: Bounds): RasterSource {
  const r = pixelRect(src, b);
  const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((r.y0 + y) * src.width + r.x0) * 4;
    rgba.set(src.rgba.subarray(from, from + w * 4), y * w * 4);
  }
  const { north, south, east, west } = src.bounds;
  const lngPer = (east - west) / src.width, latPer = (north - south) / src.height;
  return {
    width: w, height: h, rgba,
    bounds: {
      west: west + r.x0 * lngPer, east: west + (r.x1 + 1) * lngPer,
      north: north - r.y0 * latPer, south: north - (r.y1 + 1) * latPer,
    },
  };
}

export type Chip = {
  /** PNG data URL. */
  dataUrl: string;
  /** Ground metres across the chip. */
  spanM: number;
  gsdM: number;
  /** Source pixels across, before upscaling. */
  sourcePx: number;
};

/**
 * Render a square chip of `spanM` metres about `centre` from a raster, at
 * least `outPx` on a side, with the real pixels preserved (no smoothing).
 */
export function renderChip(src: RasterSource, centre: LatLng2, spanM: number, outPx = 256): Chip | null {
  const crop = cropRaster(src, boundsAround(centre, spanM));
  if (crop.width < 2 || crop.height < 2) return null;
  const gsdM = rasterGsdM(src);
  const source = document.createElement("canvas");
  source.width = crop.width;
  source.height = crop.height;
  const sctx = source.getContext("2d");
  if (!sctx) return null;
  sctx.putImageData(new ImageData(crop.rgba, crop.width, crop.height), 0, 0);
  const scale = Math.max(1, Math.ceil(outPx / Math.max(crop.width, crop.height)));
  const out = document.createElement("canvas");
  out.width = crop.width * scale;
  out.height = crop.height * scale;
  const octx = out.getContext("2d");
  if (!octx) return null;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(source, 0, 0, out.width, out.height);
  return {
    dataUrl: out.toDataURL("image/png"),
    spanM: Math.max(crop.width, crop.height) * gsdM,
    gsdM,
    sourcePx: Math.max(crop.width, crop.height),
  };
}

/** Strip the data-URL prefix so a PNG can be posted as bare base64. */
export function dataUrlToBase64(dataUrl: string): { mediaType: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  return m ? { mediaType: m[1], data: m[2] } : null;
}
