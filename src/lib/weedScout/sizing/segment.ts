// The measurement itself: one plant's canopy, cut out of a window of pixels.
//
// Pure. The window is a cut of the original photo around where the map put
// the plant, at the camera's own resolution; `gsdM` is the ground size of
// one of its pixels at the plant. What runs, in order:
//
//   1. the scout's vegetation index (chromaticity, shadow-tolerant) on the
//      window, with pixels too dark to classify left out; the soil-to-plant
//      threshold from the wider context the caller measured (vegetationThreshold
//      on a few metres around the spot, the scale the pass itself thresholds
//      at), else Otsu on the window itself; the class separation kept as the
//      mask's contrast. A threshold found on one small weed and a lot of
//      soil sits low and counts the soil's edge as canopy; the context's
//      does not
//   2. 8-connected components of the mask (the pass's own measureComponents)
//   3. the component under the spot, or the nearest within reach
//   4. the component split where two canopies touch (the pass's own
//      watershed on the distance transform, splitTouchingPlants); the part
//      at the spot is the plant, the rest are its neighbours
//   5. the part checked against the crop plants the pattern placed: a part
//      that holds a crop plant's centre is the crop, not a weed, and is not
//      measured; one that only reaches a crop plant is measured and flagged
//   6. the part checked against the edges: cut by the photo's edge it cannot
//      be measured; running past the window it asks for a wider one
//   7. area from the pixel count, diameter from the area, the longest axis
//      from the convex hull, the box from the extremes, the outline traced;
//      and the correspondence check: a canopy whose centre sits further
//      from the spot than the reach or the plant's own expected size is
//      not the plant the map put there (the pass separated a row of vines
//      by their spacing; the mask at native joins them, and the part under
//      the spot is a neighbour's), so it is refused with the offset named
//   8. confidence from the quality indicators, by the rule in `confidenceOf`;
//      under `minConfidence` the status is unknown and the numbers are
//      withheld
//
// Every threshold here is a parameter with a stated default. Nothing here
// knows what crop or what weed it is looking at.
import type { RasterSource } from "../../cellFeatures";
import { MIN_BLOB_PX, type PhotoPixels, type RawBlob, type SplitOptions, measureComponents, splitTouchingPlants } from "../../photoScout/pattern";
import { minAreaPx } from "../blobs";
import { OTSU_MIN_SPREAD, accumulateHistogram, emptyHistogram, indexRaster, otsuFromHistogram } from "../vegetation";
import { MEASUREMENT_VERSION, type SegmentationQuality, type SizeThresholds, type WeedMeasurement, sizeCategoryOf } from "./types";
import { isStrip, widthAcross } from "../structure/group";

/** A pixel whose channel mean is under this (0..255) is shadow too deep to classify and is left out of the mask. */
export const DEFAULT_MIN_BRIGHTNESS = 20;
/** The plant is looked for within this many metres of where the map put it. */
export const DEFAULT_REACH_M = 0.3;
/** Under this many pixels across, the outline is mostly edge and the size is not reported. */
export const DEFAULT_MIN_PIXELS_ACROSS = 6;
/** Under this confidence the numbers are withheld and the status is unknown. */
export const DEFAULT_MIN_CONFIDENCE = 0.3;
/**
 * The touching-plant split, set for single weeds rather than for the tree
 * canopies the pass separates: a light closing and smoothing (2 and 3 cm)
 * and a neck at 70% of the lesser plant's depth. Measured on painted
 * shapes: two discs that touch, or overlap by up to a fifth of their
 * diameter, come apart down to 12 px across; a six-leaf rosette and a grass
 * blade stay whole. Two canopies that overlap more than that read as one
 * plant, which the clump field cannot see; a limitation of v1.
 */
export const SIZER_SPLIT: SplitOptions = { closeM: 0.02, smoothM: 0.03, neckShare: 0.7, minDeepestM: 0.025 };
/** Points kept on the traced outline, for drawing. */
export const OUTLINE_MAX_POINTS = 240;
/** Pixels across at which the resolution term reaches 1. */
export const FULL_RESOLUTION_PX = 16;
/** Mask contrast (Otsu class separation, index units) at which the contrast term reaches 1. */
export const FULL_CONTRAST = 0.2;
/** View angle, degrees from straight down, at which the view term reaches its floor. */
export const VIEW_ANGLE_FLOOR_DEG = 40;
/** A canopy more than this many times the diameter the map expected has most likely grown into something else (a vine the pattern never placed); the confidence is halved and the caveat says so. */
export const GROWN_RATIO = 3;

export type Pt = { x: number; y: number };

/** The soil-to-plant threshold of some pixels: the scout's index, the dark floor, Otsu. Null when there was nothing to split. */
export function vegetationThreshold(px: PhotoPixels, minBrightness = DEFAULT_MIN_BRIGHTNESS): { threshold: number; spread: number; n: number; darkShare: number } | null {
  const src: RasterSource = { ...px, bounds: { north: 1, south: 0, east: 1, west: 0 } };
  const index = indexRaster(src);
  let dark = 0;
  for (let i = 0; i < px.width * px.height; i++) {
    const o = i * 4;
    if ((px.rgba[o] + px.rgba[o + 1] + px.rgba[o + 2]) / 3 < minBrightness) { index[i] = NaN; dark++; }
  }
  const hist = emptyHistogram();
  accumulateHistogram(hist, index, px.width);
  const otsu = otsuFromHistogram(hist);
  if (!otsu || otsu.n < 64) return null;
  return { threshold: otsu.threshold, spread: otsu.spread, n: otsu.n, darkShare: dark / Math.max(1, px.width * px.height) };
}

export type SegmentInput = {
  px: PhotoPixels;
  /** Where the map put the plant, in window pixels. */
  centre: Pt;
  /** Ground metres per pixel at the plant. */
  gsdM: number;
  thresholds: SizeThresholds;
  /** Crop plants the pattern placed, in window pixels, when known. Null: unknown, and the confidence says so. */
  cropCircles?: { x: number; y: number; r: number }[] | null;
  /** The soil-to-plant threshold from the wider context (vegetationThreshold), when the caller has one with contrast. */
  context?: { threshold: number; spread: number } | null;
  /** How big the map (or the look) said this plant was, metres, when it said. */
  expectedDiameterM?: number | null;
  /** Which of the window's edges are the photo's own edges. */
  photoEdge?: { left: boolean; top: boolean; right: boolean; bottom: boolean };
  viewAngleDeg?: number | null;
  minBlobAreaCm2?: number;
  reachM?: number;
  minPixelsAcross?: number;
  minConfidence?: number;
  minBrightness?: number;
};

/** The measurement, minus what only the caller knows (the photo, the window in it). */
export type SegmentOutput = {
  measurement: Omit<WeedMeasurement, "sourceFrame" | "source" | "gsdCmPx"> & { gsdCmPx: number };
  /** The plant runs past the window: cut a wider one and try again. */
  wider: boolean;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * The confidence rule, stated once. The weakest of resolution and contrast
 * (either alone can ruin a mask), scaled down by the view angle, and halved
 * or more by each thing that could have put foreign pixels in the canopy.
 */
export function confidenceOf(q: SegmentationQuality, viewAngleDeg: number | null | undefined, minPixelsAcross: number): number {
  const res = clamp01(((q.pixelsAcross ?? 0) - minPixelsAcross / 2) / (FULL_RESOLUTION_PX - minPixelsAcross / 2));
  const con = clamp01(((q.maskContrast ?? 0) - OTSU_MIN_SPREAD) / (FULL_CONTRAST - OTSU_MIN_SPREAD));
  const view = viewAngleDeg == null ? 1 : Math.max(0.25, 1 - viewAngleDeg / VIEW_ANGLE_FLOOR_DEG);
  const touch = q.touchingNeighbours > 0 ? 0.6 : 1;
  const crop = q.touchesCrop ? 0.5 : q.cropContext === "unknown" ? 0.85 : 1;
  const grown = q.sizeVsExpected != null && q.sizeVsExpected > GROWN_RATIO ? 0.5 : 1;
  return +(Math.min(res, con) * view * touch * crop * grown).toFixed(3);
}

/** Monotone-chain convex hull, points in any order. */
export function convexHull(points: Pt[]): Pt[] {
  if (points.length < 3) return [...points];
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** The longest distance between two hull points: the maximum Feret diameter, in pixels. */
export function maxFeret(hull: Pt[]): number {
  let best = 0;
  for (let i = 0; i < hull.length; i++) for (let j = i + 1; j < hull.length; j++) {
    const d = Math.hypot(hull[i].x - hull[j].x, hull[i].y - hull[j].y);
    if (d > best) best = d;
  }
  return best;
}

/**
 * The outer boundary of a shape as an ordered ring of pixel centres: Moore
 * neighbourhood tracing from the top-left-most pixel, stopping when the
 * start is re-entered towards the same second pixel (Jacob's criterion).
 * `inside(x, y)` is false outside the grid. An isolated pixel is a ring of one.
 */
export function traceOutline(inside: (x: number, y: number) => boolean, width: number, height: number): Pt[] {
  let sx = -1, sy = -1;
  for (let y = 0; y < height && sx < 0; y++) for (let x = 0; x < width; x++) if (inside(x, y)) { sx = x; sy = y; break; }
  if (sx < 0) return [];
  // Clockwise with y down: E, SE, S, SW, W, NW, N, NE.
  const D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const indexOf = (dx: number, dy: number) => D.findIndex(d => d[0] === dx && d[1] === dy);
  const out: Pt[] = [{ x: sx, y: sy }];
  let cx = sx, cy = sy, back = 4;
  const cap = 4 * width * height + 8;
  for (let step = 0; step < cap; step++) {
    let found = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      if (inside(cx + D[d][0], cy + D[d][1])) { found = d; break; }
    }
    if (found < 0) break;
    const nx = cx + D[found][0], ny = cy + D[found][1];
    if (cx === sx && cy === sy && out.length > 1 && nx === out[1].x && ny === out[1].y) break;
    const prev = (found + 7) % 8;
    const bx = cx + D[prev][0], by = cy + D[prev][1];
    cx = nx; cy = ny;
    back = indexOf(bx - cx, by - cy);
    if (cx === sx && cy === sy) { if (out.length > 1) break; continue; }
    out.push({ x: cx, y: cy });
  }
  return out;
}

/** Every `k`-th point so a ring has at most `max` points. */
export function thinRing(ring: Pt[], max = OUTLINE_MAX_POINTS): Pt[] {
  if (ring.length <= max) return ring;
  const step = Math.ceil(ring.length / max);
  return ring.filter((_, i) => i % step === 0);
}

function unknown(reason: string, input: SegmentInput, quality: SegmentationQuality | null, wider = false): SegmentOutput {
  return {
    measurement: {
      version: MEASUREMENT_VERSION, status: "unknown", reason, method: "native-photo-mask-v1", confidence: null,
      canopyDiameterCm: null, canopyAreaCm2: null, maxExtentCm: null, boxWidthCm: null, boxHeightCm: null,
      sizeCategory: null, thresholds: input.thresholds, gsdCmPx: input.gsdM * 100, quality, clump: null, strip: null,
      outlinePx: null, outline: null, centrePx: null, measuredAt: new Date().toISOString(),
    },
    wider,
  };
}

/** Measure the plant at `centre` in the window. See the module comment for the steps. */
export function segmentWeed(input: SegmentInput): SegmentOutput {
  const { px, gsdM, thresholds } = input;
  const W = px.width, H = px.height;
  if (!(gsdM > 0)) throw new Error("A pixel size is needed before a plant can be measured.");
  const minBrightness = input.minBrightness ?? DEFAULT_MIN_BRIGHTNESS;
  const minPixelsAcross = input.minPixelsAcross ?? DEFAULT_MIN_PIXELS_ACROSS;
  const minConfidence = input.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const photoEdge = input.photoEdge ?? { left: false, top: false, right: false, bottom: false };
  const context = input.context && input.context.spread >= OTSU_MIN_SPREAD ? input.context : null;
  const quality: SegmentationQuality = {
    pixelsAcross: null, maskContrast: null, darkShare: 0, touchingNeighbours: 0, touchesCrop: false,
    cropContext: input.cropCircles ? "known" : "unknown", sizeVsExpected: null, centreOffsetM: null, thresholdSource: context ? "context" : "window", touchesWindowEdge: false, touchesPhotoEdge: false,
  };

  // 1. The index, the dark floor, the threshold: the context's, else Otsu on the window.
  const src: RasterSource = { ...px, bounds: { north: 1, south: 0, east: 1, west: 0 } };
  const index = indexRaster(src);
  let dark = 0;
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if ((px.rgba[o] + px.rgba[o + 1] + px.rgba[o + 2]) / 3 < minBrightness) { index[i] = NaN; dark++; }
  }
  quality.darkShare = +(dark / Math.max(1, W * H)).toFixed(3);
  let threshold: number;
  if (context) {
    threshold = context.threshold;
    quality.maskContrast = +context.spread.toFixed(4);
  } else {
    const hist = emptyHistogram();
    accumulateHistogram(hist, index, W);
    const otsu = otsuFromHistogram(hist);
    if (!otsu || otsu.n < 64) return unknown("too few usable pixels in the window", input, quality);
    quality.maskContrast = +otsu.spread.toFixed(4);
    if (otsu.spread < OTSU_MIN_SPREAD) return unknown("no soil-to-plant contrast in the window: one sheet of vegetation, or none", input, quality);
    threshold = otsu.threshold;
  }
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = index[i] > threshold ? 1 : 0;

  // 2, 3. Components, and the one under the spot.
  const floorPx = Math.max(MIN_BLOB_PX, minAreaPx(gsdM, input.minBlobAreaCm2 ?? 1));
  const { blobs, labels } = measureComponents(mask, W, H, floorPx);
  if (!blobs.length) return unknown("no vegetation in the window", input, quality);
  const cx = Math.round(input.centre.x), cy = Math.round(input.centre.y);
  const reachPx = (input.reachM ?? DEFAULT_REACH_M) / gsdM;
  let target: RawBlob | null = null, nearest = Infinity;
  const under = cx >= 0 && cy >= 0 && cx < W && cy < H ? labels[cy * W + cx] : 0;
  if (under) {
    target = blobs.find(b => b.labels?.includes(under)) ?? null;
    nearest = 0;
  } else {
    for (const b of blobs) {
      // Bounding-box distance first; the pixels only when the box is within reach.
      const dx = Math.max(b.minX - cx, 0, cx - b.maxX), dy = Math.max(b.minY - cy, 0, cy - b.maxY);
      if (Math.hypot(dx, dy) > reachPx || Math.hypot(dx, dy) >= nearest) continue;
      const label = b.labels![0];
      for (let y = b.minY; y <= b.maxY; y++) for (let x = b.minX; x <= b.maxX; x++) {
        if (labels[y * W + x] !== label) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d < nearest) { nearest = d; target = b; }
      }
    }
  }
  if (!target || nearest > reachPx) {
    return unknown(`no vegetation at the spot: the nearest plant is ${nearest === Infinity ? "further than" : Math.round(nearest * gsdM * 100) + " cm away, more than"} the ${Math.round((input.reachM ?? DEFAULT_REACH_M) * 100)} cm reach`, input, quality);
  }
  const label = target.labels![0];
  const pixels: number[] = [];
  for (let y = target.minY; y <= target.maxY; y++) for (let x = target.minX; x <= target.maxX; x++) if (labels[y * W + x] === label) pixels.push(y * W + x);

  // 4. Touching plants.
  const parts = splitTouchingPlants(pixels, W, floorPx, [label], gsdM, true, SIZER_SPLIT);
  let part: RawBlob = parts[0] ?? target;
  if (parts.length > 1) {
    let best = Infinity;
    for (const p of parts) {
      const list = p.pixels ?? [];
      // The part under the spot; else the one whose pixels come nearest it.
      if (list.includes(cy * W + cx)) { part = p; best = 0; break; }
      for (const i of list) { const x = i % W, y = (i - x) / W; const d = Math.hypot(x - cx, y - cy); if (d < best) { best = d; part = p; } }
    }
    quality.touchingNeighbours = parts.length - 1;
  }
  const partPixels = part.pixels ?? pixels;
  const inPart = new Uint8Array(W * H);
  for (const i of partPixels) inPart[i] = 1;

  // 5. The crop.
  if (input.cropCircles) {
    for (const c of input.cropCircles) {
      const ccx = Math.round(c.x), ccy = Math.round(c.y);
      if (ccx >= 0 && ccy >= 0 && ccx < W && ccy < H && inPart[ccy * W + ccx]) {
        return unknown("the vegetation at the spot is a crop plant on the pattern, or is merged with one", input, quality);
      }
      if (quality.touchesCrop) continue;
      // Any pixel of the part inside the crop's circle, box-checked first.
      if (c.x + c.r < part.minX || c.x - c.r > part.maxX || c.y + c.r < part.minY || c.y - c.r > part.maxY) continue;
      const r2 = c.r * c.r;
      for (const i of partPixels) { const x = i % W, y = (i - x) / W; if ((x - c.x) ** 2 + (y - c.y) ** 2 <= r2) { quality.touchesCrop = true; break; } }
    }
  }

  // 6. The edges.
  const atLeft = part.minX <= 0, atTop = part.minY <= 0, atRight = part.maxX >= W - 1, atBottom = part.maxY >= H - 1;
  quality.touchesWindowEdge = atLeft || atTop || atRight || atBottom;
  quality.touchesPhotoEdge = (atLeft && photoEdge.left) || (atTop && photoEdge.top) || (atRight && photoEdge.right) || (atBottom && photoEdge.bottom);
  if (quality.touchesPhotoEdge) return unknown("the plant is cut by the photo's edge", input, quality);
  if (quality.touchesWindowEdge) return unknown("the plant runs past the measured window", input, quality, true);

  // 7. The numbers.
  const n = partPixels.length;
  const areaM2 = n * gsdM * gsdM;
  const equivDiameterM = 2 * Math.sqrt(areaM2 / Math.PI);
  quality.pixelsAcross = +(equivDiameterM / gsdM).toFixed(1);
  if (input.expectedDiameterM && input.expectedDiameterM > 0) quality.sizeVsExpected = +(equivDiameterM / input.expectedDiameterM).toFixed(2);
  if (quality.pixelsAcross < minPixelsAcross) {
    return unknown(`under ${minPixelsAcross} pixels across at ${(gsdM * 100).toFixed(1)} cm per pixel: too small to measure in this photo`, input, quality);
  }
  const boundary: Pt[] = [];
  for (const i of partPixels) {
    const x = i % W, y = (i - x) / W;
    const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1 || !inPart[i - 1] || !inPart[i + 1] || !inPart[i - W] || !inPart[i + W];
    if (edge) boundary.push({ x, y });
  }
  const hull = convexHull(boundary);
  const feretPx = Math.max(1, maxFeret(hull) + 1);
  const ring = traceOutline((x, y) => x >= 0 && y >= 0 && x < W && y < H && inPart[y * W + x] === 1, W, H);
  // Pixel centres, as blobs.ts measures them: a disc drawn about (100, 100) reads as (100, 100).
  const centrePx = { x: part.sx / part.n + 0.5, y: part.sy / part.n + 0.5 };
  // The correspondence check. The spot is where the map put the plant's
  // centre; a canopy centred further away than the reach, or than the size
  // the map read, is another object the mask joined to this spot.
  const offsetM = Math.hypot(centrePx.x - input.centre.x, centrePx.y - input.centre.y) * gsdM;
  quality.centreOffsetM = +offsetM.toFixed(3);
  const offsetLimitM = Math.max(input.reachM ?? DEFAULT_REACH_M, input.expectedDiameterM ?? 0);
  if (offsetM > offsetLimitM) {
    const out = unknown(`the vegetation at the spot is part of an object centred ${Math.round(offsetM * 100)} cm away, further than the ${Math.round(offsetLimitM * 100)} cm the map's reading allows: not the plant the map placed here`, input, quality);
    out.measurement.clump = parts.length > 1 ? { diameterCm: +(2 * Math.sqrt((pixels.length * gsdM * gsdM) / Math.PI) * 100).toFixed(1), areaCm2: +(pixels.length * gsdM * gsdM * 1e4).toFixed(0), parts: parts.length } : null;
    out.measurement.centrePx = centrePx;
    return out;
  }

  // A strip: too long and thin to be one plant. Continuous vegetation, by length, width and area; no diameter.
  const lengthM = feretPx * gsdM;
  if (isStrip(equivDiameterM, lengthM)) {
    const widthM = widthAcross(hull, maxFeret(hull)) * gsdM;
    const out = unknown(`continuous vegetation ${(lengthM * 100).toFixed(0)} cm long and ${(widthM * 100).toFixed(0)} cm across, ${(lengthM / equivDiameterM).toFixed(1)}x its equivalent diameter: a strip, not one plant`, input, quality);
    out.measurement.strip = { lengthCm: +(lengthM * 100).toFixed(1), widthCm: +(widthM * 100).toFixed(1), areaCm2: +(areaM2 * 1e4).toFixed(0) };
    out.measurement.outlinePx = thinRing(ring);
    out.measurement.centrePx = centrePx;
    return out;
  }

  // 8. The confidence, and the verdict on the number.
  const confidence = confidenceOf(quality, input.viewAngleDeg, minPixelsAcross);
  const cm = (m: number) => +(m * 100).toFixed(1);
  const clump = parts.length > 1 ? { diameterCm: cm(2 * Math.sqrt((pixels.length * gsdM * gsdM) / Math.PI)), areaCm2: +(pixels.length * gsdM * gsdM * 1e4).toFixed(0), parts: parts.length } : null;
  if (confidence < minConfidence) {
    const out = unknown(`confidence ${confidence.toFixed(2)} is under ${minConfidence}: ${lowConfidenceWhy(quality, input.viewAngleDeg)}`, input, quality);
    out.measurement.confidence = confidence;
    out.measurement.clump = clump;
    out.measurement.centrePx = centrePx;
    return out;
  }
  const diameterCm = cm(equivDiameterM);
  return {
    measurement: {
      version: MEASUREMENT_VERSION, status: "measured", reason: null, method: "native-photo-mask-v1", confidence,
      canopyDiameterCm: diameterCm, canopyAreaCm2: +(areaM2 * 1e4).toFixed(0), maxExtentCm: cm(feretPx * gsdM),
      boxWidthCm: cm((part.maxX - part.minX + 1) * gsdM), boxHeightCm: cm((part.maxY - part.minY + 1) * gsdM),
      sizeCategory: sizeCategoryOf(diameterCm, thresholds), thresholds, gsdCmPx: gsdM * 100,
      quality, clump, strip: null, outlinePx: thinRing(ring), outline: null, centrePx, measuredAt: new Date().toISOString(),
    },
    wider: false,
  };
}

/** The weakest term, named, for the reason line. */
function lowConfidenceWhy(q: SegmentationQuality, viewAngleDeg: number | null | undefined): string {
  const parts: string[] = [];
  if ((q.pixelsAcross ?? 0) < FULL_RESOLUTION_PX) parts.push(`${q.pixelsAcross} pixels across`);
  if ((q.maskContrast ?? 0) < FULL_CONTRAST) parts.push("weak soil-to-plant contrast");
  if (viewAngleDeg != null && viewAngleDeg > 15) parts.push(`${viewAngleDeg.toFixed(0)} degrees off straight down`);
  if (q.touchingNeighbours) parts.push(`touches ${q.touchingNeighbours} other plant${q.touchingNeighbours === 1 ? "" : "s"}`);
  if (q.touchesCrop) parts.push("reaches a crop plant");
  if (q.cropContext === "unknown") parts.push("the crop's positions were not known");
  if (q.sizeVsExpected != null && q.sizeVsExpected > GROWN_RATIO) parts.push(`${q.sizeVsExpected.toFixed(1)}x the size the map read`);
  return parts.join(", ") || "the quality indicators";
}
