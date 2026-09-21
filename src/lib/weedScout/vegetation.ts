// Vegetation masking from RGB, via normalised chromaticity.
//
// Ported from offrow/src/offrow/vegetation.py. Raw RGB is never thresholded:
// a shaded corn leaf and a sunlit corn leaf differ enormously in RGB and
// barely in chromaticity, so dividing by the channel sum first is the entire
// shadow strategy.
//
// Index: ExG (2g - r - b) plus half the informative part of CIVE, negated so
// higher means more vegetation. CIVE's 18.78745 offset is dropped on purpose;
// on chromaticity it is a constant twenty times the signal and would make the
// weighted sum meaningless. Thresholded with Otsu per tile, falling back to a
// whole-field Otsu for tiles that are nearly all soil or nearly all canopy.
//
// No morphology. offrow measured that a millimetre kernel quantises to a
// different ground radius at every GSD and that the ground-unit area floor in
// blobs.ts does the despeckling continuously instead.
import type { RasterSource } from "../cellFeatures";
import type { PixelWindow } from "./tiles";

export const CIVE_WEIGHT = 0.5;
/** Range the combined index is histogrammed over. ExG on chromaticity spans [-1, 2]. */
export const INDEX_RANGE: [number, number] = [-1.5, 2.5];
export const HISTOGRAM_BINS = 512;
/**
 * Minimum separation between Otsu's two class means for a per-tile threshold
 * to be trusted. Otsu always returns a split; below this there was only one
 * mode to split, and using it paints half the soil green.
 */
export const OTSU_MIN_SPREAD = 0.05;

export const combinedIndex = (r: number, g: number, b: number): number =>
  (2 * g - r - b) + CIVE_WEIGHT * -(0.441 * r - 0.811 * g + 0.385 * b);

/**
 * Vegetation index per pixel, NaN where there is no usable pixel (off-field
 * alpha, or a black pixel with no colour to normalise).
 */
export function indexRaster(src: RasterSource): Float32Array {
  const n = src.width * src.height;
  const out = new Float32Array(n);
  const px = src.rgba;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const R = px[o], G = px[o + 1], B = px[o + 2];
    const total = R + G + B;
    if (px[o + 3] === 0 || total <= 0) { out[i] = NaN; continue; }
    out[i] = combinedIndex(R / total, G / total, B / total);
  }
  return out;
}

export type Histogram = { counts: Float64Array; lo: number; hi: number };

export const emptyHistogram = (): Histogram =>
  ({ counts: new Float64Array(HISTOGRAM_BINS), lo: INDEX_RANGE[0], hi: INDEX_RANGE[1] });

const binOf = (h: Histogram, v: number): number => {
  const t = (v - h.lo) / (h.hi - h.lo);
  return Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor(t * HISTOGRAM_BINS)));
};

/** Add every finite value of `index` inside `w` (or the whole raster) to the histogram. */
export function accumulateHistogram(
  h: Histogram, index: Float32Array, width: number, w?: PixelWindow,
): void {
  if (!w) {
    for (let i = 0; i < index.length; i++) {
      const v = index[i];
      if (Number.isFinite(v)) h.counts[binOf(h, v)]++;
    }
    return;
  }
  for (let y = w.y0; y <= w.y1; y++) {
    const row = y * width;
    for (let x = w.x0; x <= w.x1; x++) {
      const v = index[row + x];
      if (Number.isFinite(v)) h.counts[binOf(h, v)]++;
    }
  }
}

export type OtsuResult = {
  threshold: number;
  /** Separation of the class means, in index units. */
  spread: number;
  /** Samples the split was made over. */
  n: number;
};

/**
 * Otsu's threshold over a histogram: the split maximising between-class
 * variance. Returns the bin centre, and the class-mean spread that says
 * whether there were two classes to split.
 */
export function otsuFromHistogram(h: Histogram): OtsuResult | null {
  const bins = h.counts.length;
  const width = (h.hi - h.lo) / bins;
  let total = 0, sumAll = 0;
  for (let i = 0; i < bins; i++) { total += h.counts[i]; sumAll += i * h.counts[i]; }
  if (total < 2) return null;
  let wB = 0, sumB = 0, best = -1, bestI = -1, bestSpread = 0;
  for (let i = 0; i < bins; i++) {
    wB += h.counts[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * h.counts[i];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestI = i; bestSpread = (mF - mB) * width; }
  }
  if (bestI < 0) return null;
  return { threshold: h.lo + (bestI + 1) * width, spread: bestSpread, n: total };
}

export type MaskStats = {
  threshold: number;
  usedFallback: boolean;
  pixels: number;
  vegetation: number;
};

/**
 * Threshold one window of the index raster into `mask` (1 = vegetation).
 *
 * `globalThreshold` is what a window falls back to when its own Otsu split has
 * no spread, or when it holds too few pixels to split at all. Writes only
 * inside the window, so callers can compose a field mask tile by tile.
 */
export function maskWindow(
  index: Float32Array, width: number, w: PixelWindow,
  mask: Uint8Array, globalThreshold: number,
  minSpread = OTSU_MIN_SPREAD,
): MaskStats {
  const h = emptyHistogram();
  accumulateHistogram(h, index, width, w);
  const local = otsuFromHistogram(h);
  let threshold = globalThreshold, usedFallback = true;
  if (local && local.n >= 64 && local.spread >= minSpread) {
    threshold = local.threshold;
    usedFallback = false;
  }
  let pixels = 0, vegetation = 0;
  for (let y = w.y0; y <= w.y1; y++) {
    const row = y * width;
    for (let x = w.x0; x <= w.x1; x++) {
      const v = index[row + x];
      if (!Number.isFinite(v)) { mask[row + x] = 0; continue; }
      pixels++;
      const on = v > threshold ? 1 : 0;
      vegetation += on;
      mask[row + x] = on;
    }
  }
  return { threshold, usedFallback, pixels, vegetation };
}

/** Whole-field Otsu threshold, the fallback every window may lean on. */
export function globalThreshold(index: Float32Array, width: number): number {
  const h = emptyHistogram();
  accumulateHistogram(h, index, width);
  return otsuFromHistogram(h)?.threshold ?? 0;
}

/** Ground area of a mask by pixel count. Not GSD-invariant for objects a few pixels across. */
export const maskAreaM2 = (vegetationPixels: number, gsdM: number): number =>
  vegetationPixels * gsdM * gsdM;
