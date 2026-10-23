// A photo or a rendered scene placed on the map as a stand-in field map: Web Mercator pixels at one zoom, its
// boundary, and the two readers the app's map code takes by injection (the pattern pass's window fetch and Stage 1's
// draw). Lets the whole chain run headless: the map pattern pass with the crop profile, the corn rows, Stage 1, and the
// grade. The same placement the corn photo test (scripts/bench/cropTest.ts) uses for its stand-in grade.
import type { RasterSource } from "../../src/lib/cellFeatures";
import type { LatLng2 } from "../../src/lib/geo";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import type { PatternWindow } from "../../src/lib/weedScout/fieldPattern";
import { latLngOfPx, mercatorPx, metresPerPixel } from "../../src/lib/weedVision/mapRun";
import { type Raster, downsample, drawFrom, sliceRaster } from "../eval/pressure/fixture";

export type StandInMap = {
  raster: Raster;
  ring: LatLng2[];
  maxNative: number;
  lat: number;
  /** The ground size of the map's own pixel, metres. */
  mpp: number;
  /** For readFieldPattern / readPatternRows: a pattern window's raster at the pattern zoom. */
  fetch: (win: PatternWindow, z: number) => Promise<{ raster: RasterSource; missingTiles: number }>;
  /** For readStage1. */
  draw: ReturnType<typeof drawFrom>;
  /** Map pixel (frame of `raster`) for a point in the source image's own pixels. */
  fromSourcePx: (x: number, y: number) => { x: number; y: number };
};

/** Box-average an image down by a real factor (each output pixel the mean of the input pixels it covers). */
function resample(src: PhotoPixels, f: number): PhotoPixels {
  if (f <= 1) return src;
  const w = Math.max(1, Math.floor(src.width / f)), h = Math.max(1, Math.floor(src.height / f));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y * f), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * f));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * f), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * f));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = sy0; yy < sy1 && yy < src.height; yy++) for (let xx = sx0; xx < sx1 && xx < src.width; xx++) { const o = (yy * src.width + xx) * 4; r += src.rgba[o]; g += src.rgba[o + 1]; b += src.rgba[o + 2]; n++; }
      const o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { width: w, height: h, rgba: out };
}

/**
 * Place an image of known pixel size on the map at a latitude, north up, at the deepest zoom whose pixel is not finer
 * than the image's (so the map never invents detail).
 */
export function standInMap(px: PhotoPixels, gsdM: number, lat = 40, lng = -75): StandInMap {
  let z = 23;
  while (z > 14 && metresPerPixel(lat, z) < gsdM * 0.999) z--;
  const mpp = metresPerPixel(lat, z), f = mpp / gsdM;
  const img = resample(px, f);
  const [X0f, Y0f] = mercatorPx(lat, lng, z);
  const X0 = Math.floor(X0f), Y0 = Math.floor(Y0f);
  const raster: Raster = { z, left: X0, top: Y0, width: img.width, height: img.height, rgba: img.rgba };
  const ring: LatLng2[] = [latLngOfPx(X0 + 1, Y0 + 1, z), latLngOfPx(X0 + img.width - 1, Y0 + 1, z), latLngOfPx(X0 + img.width - 1, Y0 + img.height - 1, z), latLngOfPx(X0 + 1, Y0 + img.height - 1, z)];
  const byZ = new Map<number, Raster>([[z, raster]]);
  const fetch = async (win: PatternWindow, wz: number) => {
    if (!byZ.has(wz)) byZ.set(wz, wz === z ? raster : downsample(raster, wz));
    const r = byZ.get(wz)!;
    const [ax, ay] = mercatorPx(win.fetch.north, win.fetch.west, wz), [bx, by] = mercatorPx(win.fetch.south, win.fetch.east, wz);
    const gx = Math.max(r.left, Math.floor(ax)), gy = Math.max(r.top, Math.floor(ay));
    const gx1 = Math.min(r.left + r.width, Math.ceil(bx)), gy1 = Math.min(r.top + r.height, Math.ceil(by));
    const w = Math.max(0, gx1 - gx), h = Math.max(0, gy1 - gy);
    const slice = sliceRaster(r, gx, gy, w, h);
    const nw = latLngOfPx(gx, gy, wz), se = latLngOfPx(gx + w, gy + h, wz);
    return { raster: { width: slice.width, height: slice.height, rgba: slice.rgba, bounds: { north: nw.lat, west: nw.lng, south: se.lat, east: se.lng } }, missingTiles: 0 };
  };
  return { raster, ring, maxNative: z, lat, mpp, fetch, draw: drawFrom(raster), fromSourcePx: (x, y) => ({ x: x / f, y: y / f }) };
}
