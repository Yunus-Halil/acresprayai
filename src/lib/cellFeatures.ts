// Per-cell feature extraction from the orthomosaic, for "Mark & match".
//
// Pure functions only — the raster comes in already decoded, so all of this is
// testable without a network or a canvas. `orthoRaster.ts` does the fetching.
//
// WHAT WE CAN ACTUALLY MEASURE. The baked ortho tiles are 8-bit RGB, and since
// the nodata fix their alpha channel carries the off-field mask, so edge cells
// exclude collar pixels for free. True NDVI is NOT available from the default
// vegetation-index tiles: those are colormapped (rdylgn), and that colormap is
// non-monotonic in RGB, so sampling them yields palette colours rather than
// index values. Numeric NDVI requires the `raw=1` mode on `ndvi-tile`, and only
// exists at all when the scan is genuinely multispectral.
import type { LatLng2 } from "./geo";
import { pointInRing } from "./geo";
import type { CellId, TreatmentCell } from "./treatmentGrid";

/**
 * Minimum pixels a cell must contribute before its statistics mean anything.
 *
 * Below this the per-cell means are noise wearing the costume of signal — the
 * same failure shape as an over-confident classifier, arriving by a different
 * road. At z20 a 6 m cell holds ~1600 px; at z17 it holds ~25, which is why
 * this is a hard gate rather than a warning.
 */
export const MIN_PIXELS_PER_CELL = 30;

/** Decoded raster covering the field, north-up, in WGS84. */
export type RasterSource = {
  width: number;
  height: number;
  bounds: { north: number; south: number; east: number; west: number };
  /** RGBA, row-major, length width*height*4. Alpha 0 = off-field. */
  rgba: Uint8ClampedArray;
};

/** Optional numeric vegetation index on the same geometry. */
export type IndexSource = {
  width: number;
  height: number;
  bounds: { north: number; south: number; east: number; west: number };
  /** Index value per pixel, NaN where absent. */
  values: Float32Array;
  /** Which index this actually is — never assume it is NDVI. */
  index: "ndvi" | "ndre";
};

// Feature order is part of the contract: `weights[i]` in a fitted classifier
// refers to `FEATURE_NAMES[i]`, so these arrays must not be reordered casually.
export const RGB_FEATURES = [
  "red share", "green share", "blue share",
  "brightness", "brightness variation",
  "red variation", "green variation", "blue variation",
  "greenness (ExG)", "greenness variation",
  "green-red index (low)", "green-red index (high)",
] as const;

export const INDEX_FEATURES = [
  "index mean", "index variation", "index (low)", "index (high)",
] as const;

/**
 * Which measurements are in play.
 *
 * The feature count is never allowed to vary silently: an RGB scan and a
 * multispectral scan produce visibly different lists, and the UI shows which.
 * Backfilling a fake index value for RGB-only scans would make the two look
 * identical while measuring different things.
 */
export function featureNames(hasIndex: boolean): string[] {
  return hasIndex ? [...RGB_FEATURES, ...INDEX_FEATURES] : [...RGB_FEATURES];
}

export type CellSample = {
  cellId: CellId;
  pixelCount: number;
  /** Aligned with `featureNames(...)`. Empty when the cell is under-sampled. */
  features: number[];
  /** False when the cell had too few pixels to characterise. */
  usable: boolean;
};

export type SampleResult = {
  samples: CellSample[];
  names: string[];
  hasIndex: boolean;
  /** Cells dropped for lack of pixels. */
  underSampled: number;
  /** Median pixels per cell — what the UI should show before offering to match. */
  medianPixels: number;
};

type Acc = { sum: number; sumSq: number; n: number };
const acc = (): Acc => ({ sum: 0, sumSq: 0, n: 0 });
const push = (a: Acc, v: number) => { a.sum += v; a.sumSq += v * v; a.n++; };
const mean = (a: Acc) => (a.n ? a.sum / a.n : 0);
const sd = (a: Acc) => {
  if (a.n < 2) return 0;
  const m = a.sum / a.n;
  return Math.sqrt(Math.max(0, a.sumSq / a.n - m * m));
};

const quantile = (sorted: number[], q: number): number => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
};

/** Pixel column/row containing a coordinate in a north-up raster. */
function pixelOf(src: { width: number; height: number; bounds: RasterSource["bounds"] }, p: LatLng2) {
  const { north, south, east, west } = src.bounds;
  return {
    x: Math.floor(((p.lng - west) / (east - west)) * src.width),
    y: Math.floor(((north - p.lat) / (north - south)) * src.height),
  };
}

/** Geographic centre of a pixel. */
function latLngOf(
  src: { width: number; height: number; bounds: RasterSource["bounds"] },
  x: number, y: number,
): LatLng2 {
  const { north, south, east, west } = src.bounds;
  return {
    lng: west + ((x + 0.5) / src.width) * (east - west),
    lat: north - ((y + 0.5) / src.height) * (north - south),
  };
}

function bboxOf(ring: LatLng2[]) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of ring) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Extract features for every cell.
 *
 * Chromaticity (each channel over total intensity) rather than raw RGB is
 * deliberate: raw means drift with exposure and cloud shadow across an ortho,
 * so a shadowed cell would otherwise read as a different class purely for being
 * darker. Brightness is kept as its own feature, because for bare soil, water
 * and residue it genuinely is the signal.
 */
export function extractCellFeatures(
  cells: TreatmentCell[],
  rgb: RasterSource,
  index: IndexSource | null,
  opts: { maxPixelsPerCell?: number } = {},
): SampleResult {
  const hasIndex = !!index;
  const names = featureNames(hasIndex);
  const cap = opts.maxPixelsPerCell ?? 400;
  const samples: CellSample[] = [];
  const pixelCounts: number[] = [];

  for (const cell of cells) {
    const bb = bboxOf(cell.ring);
    const tl = pixelOf(rgb, { lat: bb.maxLat, lng: bb.minLng });
    const br = pixelOf(rgb, { lat: bb.minLat, lng: bb.maxLng });
    const x0 = Math.max(0, tl.x), x1 = Math.min(rgb.width - 1, br.x);
    const y0 = Math.max(0, tl.y), y1 = Math.min(rgb.height - 1, br.y);

    // Stride so a big cell costs the same as a small one — the statistics are
    // means and spreads, which converge long before we run out of pixels.
    const spanX = Math.max(1, x1 - x0 + 1), spanY = Math.max(1, y1 - y0 + 1);
    const stride = Math.max(1, Math.floor(Math.sqrt((spanX * spanY) / cap)));

    const aR = acc(), aG = acc(), aB = acc(), aI = acc(), aExg = acc(), aIdx = acc();
    const ngrdi: number[] = [], idxVals: number[] = [];
    let n = 0;

    for (let y = y0; y <= y1; y += stride) {
      for (let x = x0; x <= x1; x += stride) {
        const o = (y * rgb.width + x) * 4;
        if (rgb.rgba[o + 3] === 0) continue;              // off-field collar
        if (!pointInRing(latLngOf(rgb, x, y), cell.ring)) continue;

        const R = rgb.rgba[o], G = rgb.rgba[o + 1], B = rgb.rgba[o + 2];
        const total = R + G + B;
        if (total <= 0) continue;
        const r = R / total, g = G / total, b = B / total;

        push(aR, r); push(aG, g); push(aB, b);
        push(aI, total / 3);
        push(aExg, 2 * g - r - b);
        ngrdi.push(G + R > 0 ? (G - R) / (G + R) : 0);
        n++;

        if (index) {
          // The index raster may differ in resolution; resolve by coordinate.
          const ip = pixelOf(index, latLngOf(rgb, x, y));
          if (ip.x >= 0 && ip.y >= 0 && ip.x < index.width && ip.y < index.height) {
            const v = index.values[ip.y * index.width + ip.x];
            if (Number.isFinite(v)) { push(aIdx, v); idxVals.push(v); }
          }
        }
      }
    }

    pixelCounts.push(n);
    if (n < MIN_PIXELS_PER_CELL) {
      samples.push({ cellId: cell.id, pixelCount: n, features: [], usable: false });
      continue;
    }

    ngrdi.sort((p, q) => p - q);
    const features = [
      mean(aR), mean(aG), mean(aB),
      mean(aI), sd(aI),
      sd(aR), sd(aG), sd(aB),
      mean(aExg), sd(aExg),
      quantile(ngrdi, 0.1), quantile(ngrdi, 0.9),
    ];
    if (hasIndex) {
      idxVals.sort((p, q) => p - q);
      features.push(mean(aIdx), sd(aIdx), quantile(idxVals, 0.1), quantile(idxVals, 0.9));
    }

    samples.push({ cellId: cell.id, pixelCount: n, features, usable: true });
  }

  const sortedCounts = [...pixelCounts].sort((a, b) => a - b);
  return {
    samples,
    names,
    hasIndex,
    underSampled: samples.filter(s => !s.usable).length,
    medianPixels: quantile(sortedCounts, 0.5),
  };
}

/**
 * Whether the imagery supports matching at all.
 *
 * Refusing here, with the numbers visible, is the point: a classifier fitted on
 * nine-pixel means would produce a confident-looking map from nothing.
 */
export function samplingVerdict(result: SampleResult): {
  ok: boolean;
  message: string;
} {
  const usable = result.samples.length - result.underSampled;
  if (usable < 2) {
    return {
      ok: false,
      message:
        `The imagery is too coarse for this grid, cells hold about ${result.medianPixels} pixels ` +
        `and we need at least ${MIN_PIXELS_PER_CELL}. Re-bake this scan at a higher zoom, or use ` +
        `a larger cell size.`,
    };
  }
  if (result.underSampled > 0) {
    return {
      ok: true,
      message:
        `${result.underSampled} cell(s) hold too few pixels to measure and will be left unscored. ` +
        `Typical cell: ${result.medianPixels} pixels.`,
    };
  }
  return { ok: true, message: `Typical cell: ${result.medianPixels} pixels.` };
}
