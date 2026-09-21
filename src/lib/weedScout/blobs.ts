// Connected components of the vegetation mask, described in ground units,
// and the population statistics that say which plant is unlike the others.
//
// Ported from offrow/src/offrow/blobs.py. The area floor is 1 cm squared, not
// the 4 the original spec named: a 3 cm rosette covers about 5 cm squared of
// leaf, so a 4 cm squared floor sat directly on the target. A pixel count
// times a pixel area is continuous in GSD, which is why the floor is where
// despeckling belongs and not in a morphological kernel.
//
// Blobs touching the raster border are flagged, not dropped here: a blob cut
// by an edge has a displaced centroid and a truncated area, so the ranking
// treats it as untrustworthy, but the operator can still see that something
// was there.
//
// THE PLANT POPULATION. In an early-season row crop most blobs ARE the crop,
// at one size and one colour. The shorth of the blob population is therefore
// "what the crop looks like from above today", and a plant far from it in
// size or colour is worth a look whether or not a row model exists. That is
// how a single large weed among small corn is found in a field where the
// canopy has closed enough to defeat the row fit.
import type { RasterSource } from "../cellFeatures";
import { shorth } from "./baseline";
import { pixelLatLng, rasterGsdM } from "./tiles";
import type { Blob } from "./types";

/** Smallest blob kept, in square centimetres of ground. */
export const MIN_AREA_CM2 = 1.0;
/** Components beyond this mean a closed canopy or a broken mask, not a field of candidates. */
export const MAX_COMPONENTS = 60_000;

export class TooManyBlobsError extends Error {
  constructor(readonly count: number) {
    super(
      `The vegetation mask split into more than ${count.toLocaleString()} pieces. That is a closed ` +
      `canopy or a mask that failed, not a field of candidates. Off-row detection needs early-season ` +
      `imagery with soil visible between rows.`,
    );
    this.name = "TooManyBlobsError";
  }
}

/** Fractional pixels: rounding would make the floor a different ground area at every GSD. */
export const minAreaPx = (gsdM: number, minAreaCm2 = MIN_AREA_CM2): number =>
  (minAreaCm2 / 10_000) / (gsdM * gsdM);

export type LabelResult = {
  labels: Int32Array;
  count: number;
};

/** 8-connected component labels over a mask. Label 0 is background. */
export function labelComponents(mask: Uint8Array, width: number, height: number): LabelResult {
  const labels = new Int32Array(width * height);
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    next++;
    if (next > MAX_COMPONENTS) throw new TooManyBlobsError(MAX_COMPONENTS);
    labels[start] = next;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width, y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (mask[j] && !labels[j]) { labels[j] = next; stack.push(j); }
        }
      }
    }
  }
  return { labels, count: next };
}

/**
 * Measure every component. `tileOf` assigns a blob to an analysis tile by its
 * centroid; blobs with no tile (outside the field) are dropped.
 */
export function extractBlobs(
  mask: Uint8Array,
  rgb: RasterSource,
  opts: {
    minAreaCm2?: number;
    tileOf: (p: { lat: number; lng: number }) => string | null;
    idPrefix?: string;
  },
): Blob[] {
  const { width, height } = rgb;
  const gsdM = rasterGsdM(rgb);
  const floorPx = minAreaPx(gsdM, opts.minAreaCm2 ?? MIN_AREA_CM2);
  const { labels, count } = labelComponents(mask, width, height);
  if (count === 0) return [];

  const n = new Float64Array(count + 1);
  const sx = new Float64Array(count + 1), sy = new Float64Array(count + 1);
  const minX = new Int32Array(count + 1).fill(width), maxX = new Int32Array(count + 1).fill(-1);
  const minY = new Int32Array(count + 1).fill(height), maxY = new Int32Array(count + 1).fill(-1);
  const sr = new Float64Array(count + 1), sg = new Float64Array(count + 1), sb = new Float64Array(count + 1);
  const sexg = new Float64Array(count + 1), sbr = new Float64Array(count + 1);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const l = labels[i];
      if (!l) continue;
      n[l]++; sx[l] += x + 0.5; sy[l] += y + 0.5;
      if (x < minX[l]) minX[l] = x;
      if (x > maxX[l]) maxX[l] = x;
      if (y < minY[l]) minY[l] = y;
      if (y > maxY[l]) maxY[l] = y;
      const o = i * 4;
      const R = rgb.rgba[o], G = rgb.rgba[o + 1], B = rgb.rgba[o + 2];
      const total = R + G + B;
      if (total > 0) {
        const r = R / total, g = G / total, b = B / total;
        sr[l] += r; sg[l] += g; sb[l] += b;
        sexg[l] += 2 * g - r - b;
        sbr[l] += total / 3;
      }
    }
  }

  const out: Blob[] = [];
  const prefix = opts.idPrefix ?? "b";
  for (let l = 1; l <= count; l++) {
    if (n[l] < floorPx) continue;
    const cx = sx[l] / n[l], cy = sy[l] / n[l];
    const centroid = pixelLatLng(rgb, cx - 0.5, cy - 0.5);
    const tileId = opts.tileOf(centroid);
    if (!tileId) continue;
    const areaM2 = n[l] * gsdM * gsdM;
    const widthPx = maxX[l] - minX[l] + 1, heightPx = maxY[l] - minY[l] + 1;
    out.push({
      id: `${prefix}${l}`,
      tileId,
      centroid,
      areaM2,
      equivDiameterM: 2 * Math.sqrt(areaM2 / Math.PI),
      widthM: widthPx * gsdM,
      heightM: heightPx * gsdM,
      extent: n[l] / (widthPx * heightPx),
      chromaR: sr[l] / n[l], chromaG: sg[l] / n[l], chromaB: sb[l] / n[l],
      exgMean: sexg[l] / n[l],
      brightness: sbr[l] / n[l],
      gsdM,
      touchesBorder: minX[l] === 0 || minY[l] === 0 || maxX[l] === width - 1 || maxY[l] === height - 1,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The plant population
// ---------------------------------------------------------------------------

export const BLOB_FEATURE_NAMES = ["size", "greenness (ExG)", "green share", "shape (extent)"] as const;
export type BlobFeatureName = (typeof BLOB_FEATURE_NAMES)[number];

/** Plants needed before "unlike the others" means anything. */
export const MIN_POPULATION = 30;

/**
 * Smallest spread each plant feature is allowed to have, in its own units.
 *
 * A population of near-identical plants, or one measured on a coarse pixel
 * grid, can have a shorth of nearly nothing: every rasterised 5 px disc has
 * one of three possible extents. Dividing by that would make a plant one
 * pixel different from its neighbours an outlier by a hundred deviations.
 * These floors are measurement precision, stated: 10% in size, 0.02 in ExG,
 * 0.01 in green share, 0.05 in extent.
 */
export const BLOB_SCALE_FLOORS = [0.1, 0.02, 0.01, 0.05];

export type BlobBaseline = {
  centres: number[];
  scales: number[];
  population: number;
  /** Typical plant diameter, metres: the crop, in an early-season row crop. */
  typicalDiameterM: number;
};

const blobFeatures = (b: Blob): number[] => [
  Math.log(Math.max(1e-6, b.equivDiameterM)),
  b.exgMean,
  b.chromaG,
  b.extent,
];

/**
 * Shorth over the plant population, on log size so a plant twice the typical
 * size is as far above as a plant half the size is below.
 *
 * Blobs at the resolution floor (under three pixels across) are left out of
 * the baseline: their shape and colour are mostly edge, and they would drag
 * the typical plant toward the noise.
 */
export function blobBaseline(blobs: Blob[]): BlobBaseline | null {
  const measurable = blobs.filter(b => !b.touchesBorder && b.equivDiameterM >= 3 * b.gsdM);
  if (measurable.length < MIN_POPULATION) return null;
  const rows = measurable.map(blobFeatures);
  const centres: number[] = [], scales: number[] = [];
  for (let f = 0; f < BLOB_FEATURE_NAMES.length; f++) {
    const { centre, scale } = shorth(rows.map(r => r[f]));
    centres.push(centre);
    scales.push(Math.max(scale, BLOB_SCALE_FLOORS[f]));
  }
  return { centres, scales, population: measurable.length, typicalDiameterM: Math.exp(centres[0]) };
}

export type BlobScore = {
  /** Signed deviation per feature. */
  z: number[];
  strength: number;
  feature: BlobFeatureName;
  direction: "above" | "below";
};

/**
 * How unlike the population one plant is.
 *
 * Size stands on its own: a plant three times the typical diameter needs no
 * second opinion. Colour and shape need support from a second feature, or an
 * overwhelming margin, for the same reason tiles do.
 */
export function scoreBlob(b: Blob, base: BlobBaseline, blobZ: number): BlobScore {
  const f = blobFeatures(b);
  const z = f.map((v, i) => (base.scales[i] > 1e-9 ? (v - base.centres[i]) / base.scales[i] : 0));
  // Under six pixels across a blob's outline is mostly edge; its shape says
  // nothing about the plant and must not lead or support.
  if (b.equivDiameterM / b.gsdM < 6) z[3] = 0;
  const order = z.map((v, i) => i).sort((a, c) => Math.abs(z[c]) - Math.abs(z[a]));
  const top = order[0], second = order[1];
  const m1 = Math.abs(z[top]), m2 = Math.abs(z[second]);
  const supported = top === 0 || m2 >= 0.5 * blobZ || m1 >= 1.5 * blobZ;
  const strength = supported ? m1 : Math.min(m1, 2 * m2);
  return { z, strength, feature: BLOB_FEATURE_NAMES[top], direction: z[top] > 0 ? "above" : "below" };
}
