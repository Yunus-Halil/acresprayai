// Photo Scout: the planting pattern in ONE drone photo, with no orthomosaic.
//
// A low flight over a small field gives photos at one or two centimetres per
// pixel, where every plant is its own blob. That is finer than any ortho the
// pipeline has seen, and it allows a second pattern on top of the rows: along
// each row the plants sit at the seed spacing. Rows across, seeds along. Once
// both are known every plant has an expected place, and a green blob that is
// at no expected place is off-pattern. No model, no cloud, no map.
//
// What runs, in order:
//   1. vegetation mask         the scout's own chromaticity index + Otsu
//   2. rows per window         the scout's fitWindow (angle, pitch, phase)
//   3. blobs                   8-connected components of the mask, measured
//   4. place each blob         across = distance to its row, along = position
//                              on that row; off-row if across is too far
//   5. seed spacing per window shorth of the gaps between neighbours along
//                              each row; a gap of two spacings is a skip, a
//                              half gap is a double, a blob with two short
//                              gaps that add up to one spacing is between
//                              plants
//
// Two signals find the rows, and each window says which one it used:
//   vegetation  the scout's mask: plants against soil, the early-season case
//   brightness  luma with the slow variation removed: in a closed canopy the
//               chromaticity mask is shadow-blind by design and sees only
//               noise, but the plant lines are lighter than the shadowed gaps
//               between them. Brightness is allowed to find the GEOMETRY of
//               the rows here; it never decides what a blob is.
//
// Coordinates: the photo's own frame, metres, x right and y UP from the
// photo's top-left corner (y = -row * gsd). That is the same convention
// fitWindow uses for a north-up raster, so its angle, phase and distance
// functions apply unchanged. Nothing here is georeferenced.
//
// Honesty rules carried over from the scout: the word "weed" appears nowhere
// in an output class; counts are of blobs, which are plants only where the
// stand is young enough for plants to be separate; the pixel size is whatever
// the caller measured or estimated, and the result says which.
import type { RasterSource } from "../cellFeatures";
import { shorth } from "../weedScout/baseline";
import { minAreaPx } from "../weedScout/blobs";
import {
  type FloatImage, MIN_TILE_CONFIDENCE, VEGETATION_FRACTION_RANGE, checkPitch, downsampleFactor, fitWindow,
  groundAngleToPixel, phaseFromImage, pixelAngleToGround, poolWindow, projectionProfile, rowAngle, rowPitch, toSparse,
} from "../weedScout/rows";
import type { RowTileFit } from "../weedScout/types";
import { globalThreshold, indexRaster, maskWindow } from "../weedScout/vegetation";

export type PhotoPixels = { width: number; height: number; rgba: Uint8ClampedArray };

export type PhotoParams = {
  /** Ground sample distance of THESE pixels, metres. */
  gsdM: number;
  /**
   * The grower's row spacing, metres, or "auto": every window is fitted at
   * each of AUTO_SPACING_CANDIDATES_M, the best fit wins, and the window is
   * refitted at the spacing it measured so the fit stands on that number.
   */
  rowSpacingM: number | "auto";
  /** Window edge for the row fit, metres. */
  windowM?: number;
  /** Blobs under this ground area are specks, not plants. */
  minBlobAreaCm2?: number;
};

export const DEFAULT_MIN_BLOB_AREA_CM2 = 4;
/**
 * Candidate spacings for "auto". fitWindow searches 60 to 160 percent of its
 * number and pools the mask so that number is about eight samples, so the
 * candidates overlap and together cover about 12 cm to 1.6 m.
 */
export const AUTO_SPACING_CANDIDATES_M = [0.2, 0.3, 0.45, 0.76, 1.0, 1.5, 2.5, 4, 6];
/** A blob further than this fraction of the pitch from its row is off-row, at most. */
export const OFF_ROW_FRACTION = 0.25;
/** And at least this fraction: rows wobble, and a plant is wider than a line. */
export const OFF_ROW_FRACTION_MIN = 0.1;
/** Blobs under this share of the typical plant's area do not take part in the along-row spacing. */
export const SEED_MIN_AREA_SHARE = 0.25;
/** Gaps along a row must be at least this many pixels to count as two plants. */
export const MIN_GAP_PX = 2;
/** Pieces of one plant sit closer than this share of the row spacing; neighbouring plants never do. */
export const MERGE_GAP_FRACTION = 0.02;
/** A blob under this many pixels is a speck at any pixel size: two or three pixels of soil noise are not a plant. */
export const MIN_BLOB_PX = 6;
/** Window edge for a photo: the tiling blobs are placed in. Small plots and curved rows want less than the ortho's 12 m. */
export const DEFAULT_PHOTO_WINDOW_M = 4;
/** A spacing is fitted over at least this many rows, widening the neighbourhood beyond the window when the window is small. */
export const MIN_ROWS_PER_FIT = 12;
/**
 * But never over a neighbourhood wider than this. Twelve orchard rows at 5 m
 * is 60 m, more than a photo from 36 m up, so every window was fitted on the
 * whole photo and a road, a hedge or a second block at the far side voted on
 * this window's rows: the fit took 7 m where the rows were 5 m apart. Wide
 * rows get fewer rows under the fit instead, never fewer than
 * MIN_ROWS_PER_FIT_WIDE, and the phase is referenced near the window.
 */
export const MAX_NEIGHBOURHOOD_M = 30;
/** The floor on rows under a fit once MAX_NEIGHBOURHOOD_M bites. */
export const MIN_ROWS_PER_FIT_WIDE = 5;
/**
 * The row phase of a window is measured on a patch this many rows across
 * about the window itself (never smaller than the window), after the angle
 * and the pitch came from the wider neighbourhood. Referenced to the
 * neighbourhood's centre, up to 15 m from a window at the photo's edge, a
 * pitch five percent off put the rows a metre across at the window.
 */
export const PHASE_PATCH_ROWS = 3;
/** No crop is seeded closer than this along the row; a smaller "spacing" is mask speckle, not plants. */
export const MIN_SEED_SPACING_M = 0.05;
/** A row needs this many on-row blobs before its gaps say anything. */
export const MIN_ROW_BLOBS = 5;
/** A window needs this many gaps before a seed spacing is reported. */
export const MIN_GAPS = 10;
/** Share of gaps that must sit within a quarter of the spacing for the seed fit to be used. */
export const MIN_SEED_AGREEMENT = 0.5;
/** Vegetation share above which the canopy is closed and no plant is separate. */
export const CANOPY_CLOSED = 0.85;

export type BlobClass =
  | "on pattern"       // on a row, at a plausible spacing from its neighbours
  | "double"           // on a row, half a spacing from a neighbour
  | "between plants"   // on a row, with a planted neighbour each side a spacing apart
  | "off-row"          // between rows
  | "unplaced";        // no trusted row fit here, or touching the photo edge

export type PhotoBlob = {
  id: number;
  /** Centroid in photo pixels. */
  x: number;
  y: number;
  areaPx: number;
  areaM2: number;
  equivDiameterM: number;
  touchesBorder: boolean;
  window: number | null;
  rowIndex: number | null;
  /** Signed metres from the row centreline (null without a trusted fit). */
  acrossM: number | null;
  /** Metres along the row from the window centre. */
  alongM: number | null;
  cls: BlobClass;
};

export type SeedFit = {
  spacingM: number;
  /** Share of gaps within a quarter of the spacing. */
  agreement: number;
  usable: boolean;
  rows: number;
  gaps: number;
  skips: number;
  doubles: number;
  betweenPlants: number;
};

export type RowSignal = "vegetation" | "brightness";

export type PhotoWindow = {
  index: number;
  x0: number; y0: number; x1: number; y1: number;
  fit: RowTileFit;
  /** Which signal the fit stands on. */
  signal: RowSignal;
  usable: boolean;
  seed: SeedFit | null;
  onRow: number;
  offRow: number;
};

export type PhotoSummary = {
  windows: number;
  usableWindows: number;
  /** Usable windows whose rows came from brightness rather than the vegetation mask. */
  brightnessWindows: number;
  medianAngleDeg: number | null;
  medianPitchM: number | null;
  /** Usable windows whose fit kept the given spacing instead of its own measurement. */
  pitchKeptFromGiven: number;
  /** The typical plant of this stand: the blob size at which half the on-row vegetation area is in blobs at least that big. */
  plantDiameterM: number | null;
  seedSpacingM: number | null;
  seedAgreement: number | null;
  blobs: number;
  specks: number;
  onPattern: number;
  doubles: number;
  betweenPlants: number;
  offRow: number;
  unplaced: number;
  skips: number;
};

export type PhotoPattern = {
  width: number;
  height: number;
  gsdM: number;
  /** The spacing the operator gave; null when it was searched automatically. */
  rowSpacingM: number | null;
  windowM: number;
  minBlobAreaCm2: number;
  vegetationFraction: number;
  canopyClosed: boolean;
  windows: PhotoWindow[];
  blobs: PhotoBlob[];
  summary: PhotoSummary;
  /** Plain-language notes the UI shows verbatim. */
  notes: string[];
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** The vegetation mask of a photo: one global Otsu, then per-window refinement. */
export function photoMask(px: PhotoPixels, windowPx: number): { mask: Uint8Array; vegetationFraction: number } {
  // indexRaster only reads width, height and rgba; the bounds are a type requirement.
  const src: RasterSource = { ...px, bounds: { north: 1, south: 0, east: 1, west: 0 } };
  const index = indexRaster(src);
  const t = globalThreshold(index, px.width);
  const mask = new Uint8Array(px.width * px.height);
  let veg = 0, pixels = 0;
  for (let y0 = 0; y0 < px.height; y0 += windowPx) {
    for (let x0 = 0; x0 < px.width; x0 += windowPx) {
      const w = { x0, y0, x1: Math.min(px.width, x0 + windowPx) - 1, y1: Math.min(px.height, y0 + windowPx) - 1 };
      const s = maskWindow(index, px.width, w, mask, t);
      veg += s.vegetation; pixels += s.pixels;
    }
  }
  return { mask, vegetationFraction: pixels ? veg / pixels : 0 };
}

export type RawBlob = { n: number; sx: number; sy: number; minX: number; maxX: number; minY: number; maxY: number };

/**
 * Join components whose bounding boxes come within `gapPx` of each other:
 * one plant whose canopy the mask split into pieces, a tree with its
 * branches, a corn plant with a leaf cut off by a shadow. Grid-hashed on
 * the gap so a hundred thousand specks do not cost a hundred thousand
 * squared comparisons.
 */
export function mergeComponents(blobs: RawBlob[], gapPx: number): RawBlob[] {
  if (!(gapPx > 0) || blobs.length < 2) return blobs;
  const parent = blobs.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const cell = Math.max(1, Math.ceil(gapPx));
  const grid = new Map<string, number[]>();
  blobs.forEach((b, i) => {
    for (let cy = Math.floor(b.minY / cell); cy <= Math.floor(b.maxY / cell); cy++) {
      for (let cx = Math.floor(b.minX / cell); cx <= Math.floor(b.maxX / cell); cx++) {
        const k = `${cx},${cy}`;
        grid.set(k, [...(grid.get(k) ?? []), i]);
      }
    }
  });
  const near = (a: RawBlob, b: RawBlob) => {
    const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
    const dy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
    return Math.hypot(dx, dy) <= gapPx;
  };
  blobs.forEach((b, i) => {
    for (let cy = Math.floor(b.minY / cell) - 1; cy <= Math.floor(b.maxY / cell) + 1; cy++) {
      for (let cx = Math.floor(b.minX / cell) - 1; cx <= Math.floor(b.maxX / cell) + 1; cx++) {
        for (const j of grid.get(`${cx},${cy}`) ?? []) {
          if (j <= i) continue;
          const ri = find(i), rj = find(j);
          if (ri !== rj && near(b, blobs[j])) parent[rj] = ri;
        }
      }
    }
  });
  const merged = new Map<number, RawBlob>();
  blobs.forEach((b, i) => {
    const r = find(i);
    const m = merged.get(r);
    if (!m) merged.set(r, { ...b });
    else {
      m.n += b.n; m.sx += b.sx; m.sy += b.sy;
      m.minX = Math.min(m.minX, b.minX); m.maxX = Math.max(m.maxX, b.maxX);
      m.minY = Math.min(m.minY, b.minY); m.maxY = Math.max(m.maxY, b.maxY);
    }
  });
  return [...merged.values()];
}

/**
 * Measure every 8-connected component of the mask without keeping a label
 * image, and without the scout's component cap: a sharp photo of a young
 * stand has tens of thousands of plants and that is the point, not a fault.
 * Components under `floorPx` are counted as specks and dropped.
 */
export function measureComponents(mask: Uint8Array, width: number, height: number, floorPx: number): { blobs: RawBlob[]; specks: number } {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  const blobs: RawBlob[] = [];
  let specks = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    const b: RawBlob = { n: 0, sx: 0, sy: 0, minX: width, maxX: -1, minY: height, maxY: -1 };
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width, y = (i - x) / width;
      b.n++; b.sx += x; b.sy += y;
      if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
    }
    if (b.n < floorPx) specks++; else blobs.push(b);
  }
  return { blobs, specks };
}

/** Luma per pixel, 0..1. */
export function lumaRaster(px: PhotoPixels): Float32Array {
  const n = px.width * px.height, out = new Float32Array(n), d = px.rgba;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[i] = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255;
  }
  return out;
}

/** Mean-pool a float raster window by `factor`. */
export function poolFloat(values: Float32Array, width: number, x0: number, y0: number, w: number, h: number, factor: number): FloatImage {
  const ow = Math.floor(w / factor), oh = Math.floor(h / factor);
  const data = new Float32Array(ow * oh);
  const inv = 1 / (factor * factor);
  for (let oy = 0; oy < oh; oy++) {
    for (let ox = 0; ox < ow; ox++) {
      let s = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y0 + oy * factor + dy) * width + x0 + ox * factor;
        for (let dx = 0; dx < factor; dx++) s += values[row + dx];
      }
      data[oy * ow + ox] = s * inv;
    }
  }
  return { data, width: ow, height: oh };
}

/**
 * The part of an image that is brighter than its surroundings: the image
 * minus a box mean of radius `r`, negative values dropped. Vignetting and
 * the slow fall of light across a window are wider than `r` and vanish; a
 * row a few samples wide survives.
 */
export function highPassPositive(img: FloatImage, r: number): FloatImage {
  const { width: w, height: h, data } = img;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { s += data[y * w + k]; n++; }
      tmp[y * w + x] = s / n;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let s = 0, n = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { s += tmp[k * w + x]; n++; }
      const v = data[y * w + x] - s / n;
      out[y * w + x] = v > 0 ? v : 0;
    }
  }
  return { data: out, width: w, height: h };
}

export type SoftFitInput = {
  luma: Float32Array;
  width: number;
  x0: number; y0: number; x1: number; y1: number;
  gsdM: number;
  growerSpacingM: number;
  angleHintDeg?: number | null;
  /** Vegetation share of the window, carried through for the record. */
  vegetationFraction: number;
};

/**
 * Fit one window on brightness: the same angle, pitch and phase steps as the
 * scout's fitWindow, on the high-passed luma instead of the mask.
 */
export function fitWindowBrightness(input: SoftFitInput): RowTileFit {
  const { luma, width, x0, y0, x1, y1, gsdM, growerSpacingM } = input;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const factor = downsampleFactor(gsdM, growerSpacingM);
  const sampleM = gsdM * factor;
  const pooled = poolFloat(luma, width, x0, y0, w, h, factor);
  const originX = x0 * gsdM, originY = -y0 * gsdM;
  const toGround = (px: number, py: number) => ({ x: originX + px * sampleM, y: originY - py * sampleM });
  const centre = toGround(pooled.width / 2, pooled.height / 2);
  const sizeM = Math.max(w, h) * gsdM;
  const empty: RowTileFit = {
    centre, sizeM, angleDeg: 0, pitchM: growerSpacingM, phaseM: 0,
    confidence: 0, angleConfidence: 0, pitchConfidence: 0,
    vegetationFraction: input.vegetationFraction, pitchFromGrower: true, recoveredPitchM: 0,
  };
  if (pooled.width < 8 || pooled.height < 8) return empty;
  // The box radius is two spacings: wide enough to pass a row, narrow enough to drop the light's fall-off.
  const img = highPassPositive(pooled, Math.max(2, Math.round((2 * growerSpacingM) / sampleM)));
  const sp = toSparse(img);
  if (sp.xs.length < 64) return empty;
  const hintPx = input.angleHintDeg == null ? null : groundAngleToPixel(input.angleHintDeg);
  const { anglePxDeg, confidence: angleConfidence } = rowAngle(sp, { hintPxDeg: hintPx });
  const { profile } = projectionProfile(sp, anglePxDeg);
  const { pitchM: recovered, confidence: rawPitchConf } = rowPitch(profile, sampleM, growerSpacingM);
  let pitchM = recovered, pitchConfidence = rawPitchConf, pitchFromGrower = false;
  if (!checkPitch(recovered, growerSpacingM)) { pitchM = growerSpacingM; pitchConfidence *= 0.5; pitchFromGrower = true; }
  const angleDeg = pixelAngleToGround(anglePxDeg);
  const phaseM = phaseFromImage(sp, toGround, centre.x, centre.y, angleDeg, pitchM);
  return {
    centre, sizeM, angleDeg, pitchM, phaseM,
    confidence: Math.min(angleConfidence, pitchConfidence), angleConfidence, pitchConfidence,
    vegetationFraction: input.vegetationFraction, pitchFromGrower, recoveredPitchM: recovered,
  };
}

/** Tile the photo into near-square windows of about `windowM`, covering every pixel. */
export function planWindows(width: number, height: number, gsdM: number, windowM: number): { x0: number; y0: number; x1: number; y1: number }[] {
  const target = Math.max(16, windowM / gsdM);
  const cols = Math.max(1, Math.round(width / target)), rows = Math.max(1, Math.round(height / target));
  const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        x0: Math.floor((c * width) / cols), y0: Math.floor((r * height) / rows),
        x1: Math.floor(((c + 1) * width) / cols) - 1, y1: Math.floor(((r + 1) * height) / rows) - 1,
      });
    }
  }
  return out;
}

/** Where a point sits relative to one window's rows: which row, how far across it, how far along it. */
export function placeOnRows(fit: RowTileFit, x: number, y: number): { rowIndex: number; acrossM: number; alongM: number } {
  const th = (fit.angleDeg * Math.PI) / 180;
  const nx = -Math.sin(th), ny = Math.cos(th), tx = Math.cos(th), ty = Math.sin(th);
  const acrossRaw = (x - fit.centre.x) * nx + (y - fit.centre.y) * ny - fit.phaseM;
  const rowIndex = Math.round(acrossRaw / fit.pitchM);
  return { rowIndex, acrossM: acrossRaw - rowIndex * fit.pitchM, alongM: (x - fit.centre.x) * tx + (y - fit.centre.y) * ty };
}

/**
 * The seed spacing of one window from the gaps between on-row neighbours,
 * and what each on-row blob is once that spacing is known. Mutates `cls` on
 * the blobs it classifies.
 */
/** An on-row blob as one window's fit sees it, which may differ from the window it lives in. */
export type Placed = { blob: PhotoBlob; rowIndex: number; alongM: number };

/**
 * `placed` may reach beyond the window (a neighbourhood placed with this
 * window's fit, so a row has enough plants under it to measure); `inside`
 * says which blobs are the window's own, and only those are classified and
 * only gaps that start on them are counted, so nothing is counted twice.
 */
export function fitSeeds(placed: Placed[], gsdM: number, inside: (b: PhotoBlob) => boolean = () => true): SeedFit | null {
  const byRow = new Map<number, Placed[]>();
  for (const p of placed) byRow.set(p.rowIndex, [...(byRow.get(p.rowIndex) ?? []), p]);
  const rows = [...byRow.values()].filter(r => r.length >= MIN_ROW_BLOBS).map(r => [...r].sort((a, b) => a.alongM - b.alongM));
  const gaps: number[] = [];
  const minGap = MIN_GAP_PX * gsdM;
  for (const r of rows) for (let i = 1; i < r.length; i++) {
    const g = r[i].alongM - r[i - 1].alongM;
    if (g >= minGap) gaps.push(g);
  }
  if (gaps.length < MIN_GAPS) return null;
  const spacingM = shorth(gaps).centre;
  if (!(spacingM >= MIN_SEED_SPACING_M)) return null;
  const agreement = gaps.filter(g => Math.abs(g - spacingM) <= 0.25 * spacingM).length / gaps.length;
  const usable = agreement >= MIN_SEED_AGREEMENT;
  let skips = 0, doubles = 0, betweenPlants = 0;
  if (usable) {
    for (const r of rows) {
      for (let i = 0; i < r.length; i++) {
        if (!inside(r[i].blob)) continue;
        const prev = i > 0 ? r[i].alongM - r[i - 1].alongM : null;
        const next = i + 1 < r.length ? r[i + 1].alongM - r[i].alongM : null;
        if (next != null) {
          const n = Math.round(next / spacingM);
          if (n >= 2) skips += n - 1;
        }
        if (prev != null && next != null && prev < 0.6 * spacingM && next < 0.6 * spacingM
          && prev + next >= 0.7 * spacingM && prev + next <= 1.3 * spacingM) {
          r[i].blob.cls = "between plants"; betweenPlants++;
        } else if ((prev != null && prev < 0.5 * spacingM) || (next != null && next < 0.5 * spacingM)) {
          r[i].blob.cls = "double"; doubles++;
        }
      }
    }
  }
  return { spacingM, agreement, usable, rows: rows.length, gaps: gaps.length, skips, doubles, betweenPlants };
}

export type AnalyseOptions = {
  /** Called after each window; return false to stop. */
  onProgress?: (done: number, total: number) => void | boolean;
  /** Yield to the event loop between windows. Default: yes. */
  yieldBetweenWindows?: boolean;
};

const tick = () => new Promise<void>(r => setTimeout(r, 0));

/** The planting pattern of one photo. */
export async function analysePhoto(px: PhotoPixels, params: PhotoParams, opts: AnalyseOptions = {}): Promise<PhotoPattern> {
  const { gsdM } = params;
  const auto = params.rowSpacingM === "auto";
  const rowSpacingM = auto ? null : (params.rowSpacingM as number);
  if (!(gsdM > 0)) throw new Error("A pixel size is needed before a photo can be read.");
  if (!auto && !(rowSpacingM! > 0)) throw new Error("A row spacing is needed before rows can be fitted.");
  const candidates = auto ? AUTO_SPACING_CANDIDATES_M : [rowSpacingM!];
  const windowM = params.windowM ?? DEFAULT_PHOTO_WINDOW_M;
  const notes: string[] = [];
  const plan = planWindows(px.width, px.height, gsdM, windowM);
  const windowPx = Math.max(16, Math.round(windowM / gsdM));

  const { mask, vegetationFraction } = photoMask(px, windowPx);
  const luma = lumaRaster(px);

  type Fitted = { fit: RowTileFit; signal: RowSignal };
  // A fit that measured its own spacing beats one that fell back on the
  // candidate it was handed: a harmonic of the true spacing is self-consistent
  // at the harmonic's candidate too, but its peak is the weaker one. And
  // vegetation beats brightness: plants against soil are the planting pattern
  // itself, where brightness also sees furrows and tyre tracks. Brightness is
  // tried only where the mask is blind (closed canopy, or nothing green): in
  // an orchard window whose trees the mask saw but whose rows no spacing
  // fitted, brightness found the plough furrows at 40 cm and called them rows.
  const selfConsistent = (f: RowTileFit) => !f.pitchFromGrower && f.confidence >= MIN_TILE_CONFIDENCE;
  const rank = (f: Fitted) => (selfConsistent(f.fit) ? (f.signal === "vegetation" ? 30 : 10) : 0) + f.fit.confidence;

  /**
   * A spacing needs enough rows under it for the autocorrelation to mean
   * anything: the neighbourhood of a window widened to at least
   * MIN_ROWS_PER_FIT rows, within the photo. Rows are straight, so a model
   * fitted on the neighbourhood places the window's own blobs.
   */
  const regionAround = (w: { x0: number; y0: number; x1: number; y1: number }, need: number) => {
    const grow = (lo: number, hi: number, max: number) => {
      const have = hi - lo + 1;
      if (have >= need) return [lo, hi] as const;
      const extra = need - have;
      let a = lo - Math.floor(extra / 2), b = hi + Math.ceil(extra / 2);
      if (a < 0) { b = Math.min(max, b - a); a = 0; }
      if (b > max) { a = Math.max(0, a - (b - max)); b = max; }
      return [a, b] as const;
    };
    const [x0, x1] = grow(w.x0, w.x1, px.width - 1), [y0, y1] = grow(w.y0, w.y1, px.height - 1);
    return { x0, y0, x1, y1 };
  };
  const neighbourhood = (w: { x0: number; y0: number; x1: number; y1: number }, spacingM: number) => {
    const needM = Math.min(MIN_ROWS_PER_FIT * spacingM, Math.max(MIN_ROWS_PER_FIT_WIDE * spacingM, MAX_NEIGHBOURHOOD_M));
    return regionAround(w, Math.round(needM / gsdM));
  };

  /**
   * The same fit, with its phase measured on a patch about the window and
   * referenced to the window's own centre. Angle and pitch are kept.
   */
  const localisePhase = (w: { x0: number; y0: number; x1: number; y1: number }, f: Fitted): Fitted => {
    const { fit } = f;
    if (!(fit.confidence > 0) || !(fit.pitchM > 0)) return f;
    const r = regionAround(w, Math.round((PHASE_PATCH_ROWS * fit.pitchM) / gsdM));
    const factor = downsampleFactor(gsdM, fit.pitchM);
    const rw = r.x1 - r.x0 + 1, rh = r.y1 - r.y0 + 1;
    const sampleM = gsdM * factor;
    const pooled = f.signal === "vegetation"
      ? poolWindow(mask, px.width, r.x0, r.y0, rw, rh, factor)
      : highPassPositive(poolFloat(luma, px.width, r.x0, r.y0, rw, rh, factor), Math.max(2, Math.round((2 * fit.pitchM) / sampleM)));
    if (pooled.width < 2 || pooled.height < 2) return f;
    const sp = toSparse(pooled);
    if (sp.xs.length === 0) return f;
    const toGround = (sx: number, sy: number) => ({ x: r.x0 * gsdM + sx * sampleM, y: -r.y0 * gsdM - sy * sampleM });
    const centre = { x: ((w.x0 + w.x1 + 1) / 2) * gsdM, y: -((w.y0 + w.y1 + 1) / 2) * gsdM };
    const phaseM = phaseFromImage(sp, toGround, centre.x, centre.y, fit.angleDeg, fit.pitchM);
    return { signal: f.signal, fit: { ...fit, centre, phaseM } };
  };
  // Narrow spacings on a small photo widen every window to the same
  // neighbourhood; the fit is then the same for every window and is done once.
  const fitCache = new Map<string, RowTileFit>();
  const vegCache = new Map<string, number>();

  /** One window at every candidate spacing on both signals; the best fit, refitted on the spacing it measured. */
  const fitOne = (w: { x0: number; y0: number; x1: number; y1: number }, angleHintDeg: number | null): Fitted => {
    const vegFraction = (() => {
      let veg = 0;
      for (let y = w.y0; y <= w.y1; y++) for (let x = w.x0; x <= w.x1; x++) veg += mask[y * px.width + x];
      return veg / Math.max(1, (w.x1 - w.x0 + 1) * (w.y1 - w.y0 + 1));
    })();
    // Whether the mask can carry rows is judged on the neighbourhood that is
    // fitted, not on the window alone: a window of bare soil between two
    // tree rows still sits in a neighbourhood full of trees.
    const maskableOver = (x0: number, y0: number, x1: number, y1: number): boolean => {
      const key = `${x0},${y0},${x1},${y1}`;
      let f = vegCache.get(key);
      if (f == null) {
        let veg = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) veg += mask[y * px.width + x];
        f = veg / Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
        vegCache.set(key, f);
      }
      return f >= VEGETATION_FRACTION_RANGE[0] && f <= VEGETATION_FRACTION_RANGE[1];
    };
    const at = (growerSpacingM: number, signal: RowSignal): Fitted | null => {
      const { x0, y0, x1, y1 } = neighbourhood(w, growerSpacingM);
      if (signal === "vegetation" && !maskableOver(x0, y0, x1, y1)) return null;
      const key = `${x0},${y0},${x1},${y1},${growerSpacingM.toFixed(4)},${signal},${angleHintDeg == null ? "" : angleHintDeg.toFixed(1)}`;
      let fit = fitCache.get(key);
      if (!fit) {
        fit = signal === "vegetation"
          ? fitWindow({ mask, width: px.width, x0, y0, x1, y1, gsdM, originX: x0 * gsdM, originY: -y0 * gsdM, growerSpacingM, angleHintDeg })
          : fitWindowBrightness({ luma, width: px.width, x0, y0, x1, y1, gsdM, growerSpacingM, angleHintDeg, vegetationFraction: vegFraction });
        fitCache.set(key, fit);
      }
      return { signal, fit };
    };
    const fits: Fitted[] = [];
    for (const c of candidates) {
      const v = at(c, "vegetation");
      fits.push(v ?? at(c, "brightness")!);
    }
    // Second pass, auto only: every spacing a first-pass fit measured but
    // could not stand on (more than ten percent from its candidate) is tried
    // as a candidate of its own, so a 25 cm row found from the 20 cm and the
    // 30 cm candidates gets a fit that agrees with itself.
    if (auto) {
      const seen = new Set<string>();
      for (const f of [...fits]) {
        if (!f.fit.pitchFromGrower || !(f.fit.recoveredPitchM > 0) || !(f.fit.confidence > 0)) continue;
        const key = `${f.signal}:${f.fit.recoveredPitchM.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const again = at(f.fit.recoveredPitchM, f.signal);
        if (again) fits.push(again);
      }
    }
    let best = fits[0];
    for (const f of fits) if (rank(f) > rank(best)) best = f;
    // A spacing twice or three times the true one is self-consistent too (its
    // autocorrelation peaks at every multiple), and pooled coarser it can look
    // cleaner. The fundamental also peaks, so a self-consistent fit at a half
    // or a third of the winner's spacing with most of its confidence is the
    // truer one.
    for (const f of fits) {
      if (f.signal !== best.signal || !selfConsistent(f.fit) || f.fit.confidence < 0.7 * best.fit.confidence) continue;
      const ratio = best.fit.pitchM / f.fit.pitchM;
      if (Math.abs(ratio - Math.round(ratio)) <= 0.15 && Math.round(ratio) >= 2) best = f;
    }
    return localisePhase(w, best);
  };
  const canopyClosed = vegetationFraction >= CANOPY_CLOSED;
  if (canopyClosed) notes.push("The canopy is closed in this photo: almost every pixel is vegetation, so no plant is separate and blobs are not placed. Rows can still be found from brightness.");

  const windows: PhotoWindow[] = [];
  for (let i = 0; i < plan.length; i++) {
    const w = plan[i];
    const { fit, signal } = fitOne(w, null);
    windows.push({ index: i, ...w, fit, signal, usable: fit.confidence >= MIN_TILE_CONFIDENCE, seed: null, onRow: 0, offRow: 0 });
    if (opts.onProgress?.(i + 1, plan.length) === false) break;
    if (opts.yieldBetweenWindows !== false) await tick();
  }

  // Second pass with the median angle as a hint, for windows that could not
  // find the direction alone: a corner of mostly soil still has a row or two.
  const usableAngles = windows.filter(w => w.usable).map(w => w.fit.angleDeg);
  const hint = median(usableAngles);
  if (hint != null) {
    for (const w of windows) {
      if (w.usable) continue;
      const { fit, signal } = fitOne(w, hint);
      if (fit.confidence >= MIN_TILE_CONFIDENCE) { w.fit = fit; w.signal = signal; w.usable = true; }
    }
    if (opts.yieldBetweenWindows !== false) await tick();
  }

  const minBlobAreaCm2 = params.minBlobAreaCm2 ?? DEFAULT_MIN_BLOB_AREA_CM2;
  const floorPx = Math.max(MIN_BLOB_PX, minAreaPx(gsdM, minBlobAreaCm2));
  const measured = measureComponents(mask, px.width, px.height, floorPx);
  const pitchForMerge = median(windows.filter(w => w.usable).map(w => w.fit.pitchM));
  if (pitchForMerge != null) measured.blobs = mergeComponents(measured.blobs, (MERGE_GAP_FRACTION * pitchForMerge) / gsdM);
  const windowAt = (x: number, y: number): PhotoWindow | null => {
    for (const w of windows) if (x >= w.x0 && x <= w.x1 && y >= w.y0 && y <= w.y1) return w;
    return null;
  };
  const blobs: PhotoBlob[] = measured.blobs.map((b, id) => {
    const x = b.sx / b.n, y = b.sy / b.n;
    const touchesBorder = b.minX === 0 || b.minY === 0 || b.maxX === px.width - 1 || b.maxY === px.height - 1;
    const areaM2 = b.n * gsdM * gsdM;
    const w = windowAt(Math.round(x), Math.round(y));
    const blob: PhotoBlob = {
      id, x, y, areaPx: b.n, areaM2, equivDiameterM: 2 * Math.sqrt(areaM2 / Math.PI), touchesBorder,
      window: w?.index ?? null, rowIndex: null, acrossM: null, alongM: null, cls: "unplaced",
    };
    if (w && w.usable && !touchesBorder && !canopyClosed) {
      const p = placeOnRows(w.fit, x * gsdM, -y * gsdM);
      blob.rowIndex = p.rowIndex; blob.acrossM = p.acrossM; blob.alongM = p.alongM;
    }
    return blob;
  });

  // The typical plant: among blobs near a row, the blob size that holds the
  // middle of the vegetation AREA (half the green is in blobs at least this
  // big). The crop carries the area; weeds near the row are many but small,
  // and would win a count. The on-row tolerance is then about one plant
  // width, between a tenth and a quarter of the row spacing, so a weed a
  // metre from a tree row is not "on the row" just because orchard rows are
  // far apart.
  const nearRow = blobs.filter(b => b.acrossM != null && b.window != null && Math.abs(b.acrossM) <= OFF_ROW_FRACTION * windows[b.window].fit.pitchM);
  const plantAreaM2 = (() => {
    if (nearRow.length < 4) return null;
    const areas = nearRow.map(b => b.areaM2).sort((a, b) => b - a);
    const total = areas.reduce((s, a) => s + a, 0);
    let acc = 0;
    for (const a of areas) { acc += a; if (acc >= total / 2) return a; }
    return areas[areas.length - 1];
  })();
  const plantDiameterM = plantAreaM2 == null ? null : 2 * Math.sqrt(plantAreaM2 / Math.PI);
  const onRowTolM = (pitchM: number) => Math.max(2 * gsdM, Math.min(OFF_ROW_FRACTION * pitchM, Math.max(OFF_ROW_FRACTION_MIN * pitchM, plantDiameterM ?? 0)));
  for (const b of blobs) {
    if (b.acrossM == null || b.window == null) continue;
    const w = windows[b.window];
    if (Math.abs(b.acrossM) > onRowTolM(w.fit.pitchM)) { b.cls = "off-row"; w.offRow++; }
    else { b.cls = "on pattern"; w.onRow++; }
  }

  for (const w of windows) {
    // Seeds are counted only where plants are separate things in the mask; a
    // row found from brightness has no such blobs, only canopy speckle. The
    // neighbourhood the rows were fitted on is placed with this window's fit
    // so each row has enough plants under it; only the window's own blobs
    // are classified and counted.
    if (!w.usable || w.signal !== "vegetation") continue;
    const n = neighbourhood(w, w.fit.pitchM);
    const tol = onRowTolM(w.fit.pitchM);
    const minSeedArea = (plantAreaM2 ?? 0) * SEED_MIN_AREA_SHARE;
    const placed: Placed[] = [];
    for (const b of blobs) {
      if (b.touchesBorder || b.cls === "unplaced" || b.areaM2 < minSeedArea || b.x < n.x0 || b.x > n.x1 || b.y < n.y0 || b.y > n.y1) continue;
      const p = placeOnRows(w.fit, b.x * gsdM, -b.y * gsdM);
      if (Math.abs(p.acrossM) <= tol) placed.push({ blob: b, rowIndex: p.rowIndex, alongM: p.alongM });
    }
    w.seed = fitSeeds(placed, gsdM, b => b.window === w.index && b.cls === "on pattern");
  }

  const usable = windows.filter(w => w.usable);
  const seeds = usable.map(w => w.seed).filter((s): s is SeedFit => !!s && s.usable);
  const count = (c: BlobClass) => blobs.filter(b => b.cls === c).length;
  const summary: PhotoSummary = {
    windows: windows.length,
    usableWindows: usable.length,
    brightnessWindows: usable.filter(w => w.signal === "brightness").length,
    medianAngleDeg: median(usable.map(w => w.fit.angleDeg)),
    medianPitchM: median(usable.map(w => w.fit.pitchM)),
    pitchKeptFromGiven: usable.filter(w => w.fit.pitchFromGrower).length,
    plantDiameterM,
    seedSpacingM: median(seeds.map(s => s.spacingM)),
    seedAgreement: median(seeds.map(s => s.agreement)),
    blobs: blobs.length,
    specks: measured.specks,
    onPattern: count("on pattern"),
    doubles: count("double"),
    betweenPlants: count("between plants"),
    offRow: count("off-row"),
    unplaced: count("unplaced"),
    skips: seeds.reduce((s, f) => s + f.skips, 0),
  };

  if (usable.length === 0) {
    notes.push("No window of this photo showed a row pattern the fit would trust. Either the crop is not in rows, the row spacing is wrong, the photo is too high for the rows to resolve, or the soil does not show between rows.");
  } else if (usable.length > 0 && usable.length < windows.length / 2) {
    notes.push(`Rows were trusted in ${usable.length} of ${windows.length} windows. Blobs in the other windows are shown but not placed.`);
  }
  if (summary.brightnessWindows > 0) {
    notes.push(`${summary.brightnessWindows} of ${usable.length} windows with rows found them from brightness, not from vegetation against soil: the canopy is closed or nearly so there. The lines are the plant rows; blob classes in those windows are weaker evidence.`);
  }
  if (usable.length > 0 && seeds.length === 0) {
    notes.push("Rows were found but no window gave a consistent spacing between plants along the row, so skips, doubles and between-plant blobs are not counted. That is normal once plants touch along the row, or when the photo is too coarse for single plants.");
  }
  if (!auto && summary.pitchKeptFromGiven > 0) {
    const measured = median(usable.filter(w => w.fit.pitchFromGrower).map(w => w.fit.recoveredPitchM));
    notes.push(`${summary.pitchKeptFromGiven} of ${usable.length} windows with rows measured a spacing more than ten percent away from the one you gave${measured ? ` (about ${(measured * 100).toFixed(0)} cm)` : ""}. The fit kept your number there, so rows at the measured spacing land between the drawn lines. Try that spacing, or "auto".`);
  }
  if (measured.specks > blobs.length * 5 && blobs.length > 0) {
    notes.push(`${measured.specks.toLocaleString()} specks under the minimum blob size were dropped against ${blobs.length.toLocaleString()} blobs kept. If plants are being dropped, lower the minimum blob size.`);
  }

  return { width: px.width, height: px.height, gsdM, rowSpacingM, windowM, minBlobAreaCm2, vegetationFraction, canopyClosed, windows, blobs, summary, notes };
}

/**
 * Row centrelines of one usable window as pixel segments, for drawing. Each
 * segment spans well beyond the window so the caller can clip to it.
 */
export function rowSegmentsPx(w: PhotoWindow, gsdM: number): { x1: number; y1: number; x2: number; y2: number; rowIndex: number }[] {
  if (!w.usable) return [];
  const { fit } = w;
  const th = (fit.angleDeg * Math.PI) / 180;
  const nx = -Math.sin(th), ny = Math.cos(th), tx = Math.cos(th), ty = Math.sin(th);
  const half = fit.sizeM;
  const kMax = Math.ceil(fit.sizeM / fit.pitchM) + 1;
  const out: { x1: number; y1: number; x2: number; y2: number; rowIndex: number }[] = [];
  for (let k = -kMax; k <= kMax; k++) {
    const off = fit.phaseM + k * fit.pitchM;
    const cx = fit.centre.x + off * nx, cy = fit.centre.y + off * ny;
    const a = { x: cx - tx * half, y: cy - ty * half }, b = { x: cx + tx * half, y: cy + ty * half };
    out.push({ x1: a.x / gsdM, y1: -a.y / gsdM, x2: b.x / gsdM, y2: -b.y / gsdM, rowIndex: k });
  }
  return out;
}
