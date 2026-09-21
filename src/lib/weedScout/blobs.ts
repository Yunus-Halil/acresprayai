// Connected components of the vegetation mask, described in ground units.
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
import type { RasterSource } from "../cellFeatures";
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
