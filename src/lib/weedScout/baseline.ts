// Steps 2 and 3: measure every tile, then mark the ones that are not average.
//
// The field is its own control. Median and scaled MAD per feature rather than
// mean and SD, because the tiles being hunted are exactly the values that
// would corrupt a mean. A tile is flagged on its single most deviant feature,
// and that feature is named in the flag: "greenness is 4.1 typical deviations
// above the field" is a reason an operator can check against the imagery,
// where a blended distance is a number they must take on faith.
//
// Same statistical shape as findSimilar.scanOutliers, applied to analysis
// tiles instead of treatment cells, with the vegetation fraction added as a
// feature because the mask exists here and does not there.
import type { RasterSource } from "../cellFeatures";
import { MIN_PIXELS_PER_CELL } from "../cellFeatures";
import { TILE_FEATURE_NAMES, type AnalysisTile, type TileFlag, type TileSample } from "./types";
import { tileWindow } from "./tiles";

export const MIN_PIXELS_PER_TILE = MIN_PIXELS_PER_CELL;
/** Tiles needed before a baseline means anything. */
export const MIN_BASELINE_TILES = 8;

type Acc = { sum: number; sumSq: number; n: number };
const acc = (): Acc => ({ sum: 0, sumSq: 0, n: 0 });
const push = (a: Acc, v: number) => { a.sum += v; a.sumSq += v * v; a.n++; };
const mean = (a: Acc) => (a.n ? a.sum / a.n : 0);
const sd = (a: Acc) => {
  if (a.n < 2) return 0;
  const m = a.sum / a.n;
  return Math.sqrt(Math.max(0, a.sumSq / a.n - m * m));
};

/**
 * Per-tile features from the raster and the vegetation mask.
 *
 * Strided so a big tile costs the same as a small one: the statistics are
 * means and spreads, which converge long before the pixels run out. The
 * vegetation fraction is taken over the SAME strided sample, so it is
 * comparable across tiles even when the mask itself was full-resolution.
 */
export function sampleTiles(
  tiles: AnalysisTile[],
  rgb: RasterSource,
  mask: Uint8Array,
  opts: { maxPixelsPerTile?: number } = {},
): TileSample[] {
  const cap = opts.maxPixelsPerTile ?? 600;
  const out: TileSample[] = [];
  for (const tile of tiles) {
    const w = tileWindow(tile, rgb);
    if (!w) {
      out.push({ tileId: tile.id, pixelCount: 0, features: [], usable: false, vegetationFraction: 0 });
      continue;
    }
    const spanX = w.x1 - w.x0 + 1, spanY = w.y1 - w.y0 + 1;
    const stride = Math.max(1, Math.floor(Math.sqrt((spanX * spanY) / cap)));
    const aR = acc(), aG = acc(), aB = acc(), aI = acc(), aExg = acc(), aNg = acc();
    let n = 0, veg = 0;
    for (let y = w.y0; y <= w.y1; y += stride) {
      for (let x = w.x0; x <= w.x1; x += stride) {
        const i = y * rgb.width + x;
        const o = i * 4;
        if (rgb.rgba[o + 3] === 0) continue;
        const R = rgb.rgba[o], G = rgb.rgba[o + 1], B = rgb.rgba[o + 2];
        const total = R + G + B;
        if (total <= 0) continue;
        const r = R / total, g = G / total, b = B / total;
        push(aR, r); push(aG, g); push(aB, b);
        push(aI, total / 3);
        push(aExg, 2 * g - r - b);
        push(aNg, G + R > 0 ? (G - R) / (G + R) : 0);
        if (mask[i]) veg++;
        n++;
      }
    }
    if (n < MIN_PIXELS_PER_TILE) {
      out.push({ tileId: tile.id, pixelCount: n, features: [], usable: false, vegetationFraction: 0 });
      continue;
    }
    const vegetationFraction = veg / n;
    out.push({
      tileId: tile.id,
      pixelCount: n,
      usable: true,
      vegetationFraction,
      features: [
        mean(aR), mean(aG), mean(aB),
        mean(aI), sd(aI),
        mean(aExg), sd(aExg),
        mean(aNg),
        vegetationFraction,
      ],
    });
  }
  return out;
}

export type Baseline = {
  medians: number[];
  mads: number[];
  tiles: number;
};

/** Median and scaled MAD per feature over the usable tiles. */
export function fieldBaseline(samples: TileSample[]): Baseline | null {
  const usable = samples.filter(s => s.usable);
  if (usable.length < MIN_BASELINE_TILES) return null;
  const nF = TILE_FEATURE_NAMES.length;
  const medians: number[] = [], mads: number[] = [];
  for (let f = 0; f < nF; f++) {
    const vals = usable.map(s => s.features[f]).sort((a, b) => a - b);
    const med = vals[Math.floor(vals.length / 2)];
    const dev = vals.map(v => Math.abs(v - med)).sort((a, b) => a - b);
    medians.push(med);
    mads.push(dev[Math.floor(dev.length / 2)] * 1.4826);
  }
  return { medians, mads, tiles: usable.length };
}

/**
 * Flag the tiles that are not average.
 *
 * Headland tiles are excluded from the FLAGS, not from the baseline: they are
 * real ground and belong in the median, but nothing in them is scored because
 * end rows and turn strips break every assumption downstream.
 */
export function flagOutliers(
  samples: TileSample[],
  baseline: Baseline,
  zThreshold: number,
  exclude: ReadonlySet<string> = new Set(),
): TileFlag[] {
  const flags: TileFlag[] = [];
  for (const s of samples) {
    if (!s.usable || exclude.has(s.tileId)) continue;
    let bestZ = 0, bestF = -1, above = true;
    for (let f = 0; f < baseline.medians.length; f++) {
      // A feature the whole field agrees on (MAD 0) cannot rank outliers.
      if (baseline.mads[f] < 1e-9) continue;
      const diff = s.features[f] - baseline.medians[f];
      const z = Math.abs(diff) / baseline.mads[f];
      if (z > bestZ) { bestZ = z; bestF = f; above = diff > 0; }
    }
    if (bestF >= 0 && bestZ >= zThreshold) {
      flags.push({
        tileId: s.tileId,
        z: bestZ,
        feature: TILE_FEATURE_NAMES[bestF],
        direction: above ? "above" : "below",
      });
    }
  }
  flags.sort((a, b) => b.z - a.z);
  return flags;
}
