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
  type FloatImage, HINT_SEARCH_DEG, MIN_TILE_CONFIDENCE, VEGETATION_FRACTION_RANGE, checkPitch, downsampleFactor, fitWindow,
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
  /**
   * The direction the rows run, ground degrees counterclockwise from east,
   * when the grower has said so ("rows run this way"). Every window then
   * searches only near it and the square-grid tiebreak is off. Null or
   * absent: the pass decides.
   */
  rowAngleDeg?: number | null;
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
/** The floor on rows under a fit once MAX_NEIGHBOURHOOD_M bites. Four rows was too few: most windows then fell back on a candidate. */
export const MIN_ROWS_PER_FIT_WIDE = 5;
/**
 * The row phase of a window is measured on a patch this many rows across
 * about the window itself (never smaller than the window), after the angle
 * and the pitch came from the wider neighbourhood. Referenced to the
 * neighbourhood's centre, up to 15 m from a window at the photo's edge, a
 * pitch five percent off put the rows a metre across at the window.
 */
export const PHASE_PATCH_ROWS = 3;
/** Samples per row spacing on the patch, finer than the fit's TARGET_PITCH_PX so a small patch still resolves a degree. */
export const PATCH_PITCH_PX = 32;
/** A window joins a block when its rows run within this many degrees of the block's first window. */
export const BLOCK_ANGLE_DEG = 2.5;
/** ...its spacing is within this fraction of that window's... */
export const BLOCK_PITCH_TOL = 0.1;
/** ...and the two models put the rows at their shared edge within this fraction of a spacing of each other. */
export const BLOCK_EDGE_TOL = 0.25;
/** A block's spacing is halved when the block's own pixels show rows at half of it with at least this share of the full spacing's confidence. */
export const BLOCK_HALF_PITCH_SHARE = 0.7;
/** Each row line settles on the vegetation within this fraction of a spacing of the block's line for it. */
export const ROW_LINE_BAND = 1 / 3;
/** A row line is refined only from at least this much pooled vegetation, spread over at least one spacing along the row. */
export const ROW_LINE_MIN_MASS = 30;
/** A row line may tilt at most this far from the block's direction, degrees. */
export const ROW_LINE_MAX_TILT_DEG = 3;
/** A block needs this many fitted windows. A lone window that found rows beside a road found shrubs. */
export const MIN_BLOCK_WINDOWS = 3;
/**
 * A square grid: vines 3.5 m along the wire and rows 3.5 m apart fit both
 * ways. The direction a quarter turn from a window's best fit, at the same
 * spacing, is a square grid when its pitch confidence is at least this share
 * of the fit's own.
 */
export const SQUARE_GRID_SHARE = 0.6;
/**
 * On a square grid the rows run the way the brightness profile is stronger:
 * the wire, the net edge, the furrow or the wheel track runs along the row
 * and is bright. Any preference for the quarter turn is enough (1.0): on
 * the vineyard frames brightness favoured the wire by 1.02 to 1.7 where the
 * vegetation had chosen across it, and on the orchard, which is not a
 * square grid but can pass the pitch check, brightness favoured the tree
 * rows by five to one. Vegetation alone cannot decide: across the rows the
 * bare alleys cut deep in both crops.
 */
export const SQUARE_GRID_BRIGHTNESS_RATIO = 1.0;
/** A block with under this share of the main block's windows... */
export const STRAY_BLOCK_WINDOW_SHARE = 0.2;
/** ...whose fits mostly fell back on a candidate spacing, or whose median confidence is under this share of the main block's, is shrubs by a road and not a planting. */
export const STRAY_BLOCK_CONFIDENCE_SHARE = 0.85;
/** Two parts of one component on the same row, nearer along it than this share of a plant, are one plant the split cut in two. Two plants that touch sit further apart, or they would be one canopy. */
export const DOUBLE_MERGE_SHARE = 0.6;
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

/**
 * One row of a block, settled on its own vegetation: across the block's
 * direction it sits at `phase + index * pitch + offsetM + slope * along`,
 * where `along` is metres from the block's centre along the rows. Rows
 * that fan or are unevenly spaced get their own line each.
 */
export type RowLine = { index: number; offsetM: number; slope: number };

export type PhotoWindow = {
  index: number;
  x0: number; y0: number; x1: number; y1: number;
  fit: RowTileFit;
  /** Which signal the fit stands on. */
  signal: RowSignal;
  usable: boolean;
  /** The block of windows sharing this window's row model, or null when the window has no rows. */
  block: number | null;
  /** What this window measured on its own before it took the block's model; null for a window that took it without rows of its own. */
  own: { angleDeg: number; pitchM: number; confidence: number } | null;
  /** The block's row lines, each settled on its own row; shared by every window of the block. Null before blocks. */
  rowLines: RowLine[] | null;
  /** The plants here sit on a square grid, so the row direction was decided by brightness, not by the vegetation alone. */
  squareGrid: boolean;
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
  /** Plantings in the photo, each with its own rows. */
  blocks: number;
  /** Any block sits on a square grid, where the direction is brightness's call or the grower's. */
  squareGrid: boolean;
};

/**
 * One planting: the windows that share a row model, the model, and its
 * settled row lines. Coordinates are the photo's local metres, y up, like
 * every RowTileFit here; the caller georeferences them.
 */
export type PhotoBlock = {
  id: number;
  /** Ground degrees counterclockwise from +x, in [0, 180). */
  angleDeg: number;
  pitchM: number;
  phaseM: number;
  /** The point the phase is referenced to. */
  centre: { x: number; y: number };
  signal: RowSignal;
  /** Window indices. */
  windows: number[];
  rowLines: RowLine[];
  squareGrid: boolean;
  /** Blobs on pattern in this block's windows. */
  plants: number;
  /** Median spacing along the row where a window measured one. */
  seedSpacingM: number | null;
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
  blocks: PhotoBlock[];
  summary: PhotoSummary;
  /** Plain-language notes the UI shows verbatim. */
  notes: string[];
};

/** The mean direction of lines, which wrap at 180: a mean of doubled angles. */
const meanAngleDeg = (angles: number[]): number => {
  let c = 0, s = 0;
  for (const a of angles) { const t = (2 * a * Math.PI) / 180; c += Math.cos(t); s += Math.sin(t); }
  return ((((Math.atan2(s, c) / 2) * 180) / Math.PI) % 180 + 180) % 180;
};
const angleDiffDeg = (a: number, b: number): number => { const d = Math.abs((((a - b) % 180) + 180) % 180); return Math.min(d, 180 - d); };

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
  // Even tiles, as planWindows lays them: a thin leftover strip at the
  // bottom or the right thresholded on its own found soil against soil.
  for (const w of planWindows(px.width, px.height, 1, windowPx)) {
    const s = maskWindow(index, px.width, w, mask, t);
    veg += s.vegetation; pixels += s.pixels;
  }
  return { mask, vegetationFraction: pixels ? veg / pixels : 0 };
}

export type RawBlob = { n: number; sx: number; sy: number; minX: number; maxX: number; minY: number; maxY: number; /** Component labels (1-based) in the label map this blob is made of. */ labels?: number[] };

/** A blob is cut across the rows only when it reaches further across them than this share of the spacing. */
export const SPLIT_ACROSS_SHARE = 0.6;
/** A plant centre lies at least this deep inside its blob, pixels: shallower ridges are weeds along the row. */
export const SPLIT_MIN_DEPTH_PX = 3;
/** A blob that nowhere reaches this far from its edge, metres, is weeds and is never split. */
export const SPLIT_MIN_DEEPEST_M = 0.08;
/** Gaps narrower than twice this are closed before the depth is measured, so a young canopy's branch clusters are one shape. Capped at a quarter of the blob's depth, so two touching plants keep a narrow neck. */
export const SPLIT_CLOSE_M = 0.15;
/** ...and at least this share as deep as the blob's deepest point. */
export const SPLIT_DEPTH_SHARE = 0.35;
/** The depth map is smoothed over this radius, metres, before centres are found: a canopy at 2 cm/px is ragged with bays between branches. Capped at half the blob's depth so small plants keep their shape. */
export const SPLIT_SMOOTH_M = 0.3;
/** Two centres are two plants when the neck between them is shallower than this share of the lesser centre's depth: two touching discs meet at nearly zero, two lobes of one canopy over a deep neck. */
export const SPLIT_NECK_SHARE = 0.4;

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
    if (!m) merged.set(r, { ...b, labels: b.labels ? [...b.labels] : undefined });
    else {
      if (b.labels) m.labels = (m.labels ?? []).concat(b.labels);
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
/**
 * Split one blob into plants. First across the rows: each pixel goes to
 * the row it is nearest, so weeds bridging two rows do not make one blob
 * of both. Then along each row at the valleys of the vegetation profile:
 * trees whose canopies touch, or a row with weeds running under it, mask
 * as one component the length of the row and got one circle, but the
 * profile along the row still rises at every plant and falls between.
 * Needs the label map from measureComponents.
 */
export function splitAlongRow(b: RawBlob, labels: Int32Array, width: number, fit: RowTileFit, rowLines: RowLine[] | null, gsdM: number, floorPx: number): RawBlob[] {
  if (!b.labels?.length) return [b];
  const set = new Set(b.labels);
  // Across the rows only when the blob straddles them: a weed midway
  // between two rows is one weed, not two halves.
  const th = (fit.angleDeg * Math.PI) / 180, nx = -Math.sin(th), ny = Math.cos(th);
  let cMin = Infinity, cMax = -Infinity;
  for (let y = b.minY; y <= b.maxY; y++) for (let x = b.minX; x <= b.maxX; x++) {
    if (!set.has(labels[y * width + x])) continue;
    const c = x * gsdM * nx + -y * gsdM * ny;
    if (c < cMin) cMin = c; if (c > cMax) cMax = c;
  }
  const straddles = cMax - cMin > SPLIT_ACROSS_SHARE * fit.pitchM;
  const byRow = new Map<number, number[]>();
  for (let y = b.minY; y <= b.maxY; y++) {
    for (let x = b.minX; x <= b.maxX; x++) {
      const i = y * width + x;
      if (!set.has(labels[i])) continue;
      const k = straddles ? placeOnRows(fit, x * gsdM, -y * gsdM, rowLines).rowIndex : 0;
      let list = byRow.get(k);
      if (!list) { list = []; byRow.set(k, list); }
      list.push(i);
    }
  }
  if (byRow.size === 0) return [b];
  const out: RawBlob[] = [];
  for (const pixels of byRow.values()) out.push(...splitAlong(pixels, width, floorPx, b.labels, gsdM));
  if (out.length === 0) return [b];
  return out.length > 1 ? out : [b];
}

/**
 * One row's pixels of a blob, split into plants by the distance to the
 * blob's edge. A canopy is round-ish, so its centre is where the blob is
 * deepest; two canopies that touch are two peaks of that depth with a
 * neck between, and every pixel goes to the nearest peak. Weeds along
 * the row are shallow and raise no peak of their own.
 */
function splitAlong(pixels: number[], width: number, floorPx: number, labelsOf: number[], gsdM: number): RawBlob[] {
  const blobOf = (list: number[]): RawBlob => {
    const r: RawBlob = { n: 0, sx: 0, sy: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, labels: labelsOf };
    for (const i of list) { const x = i % width, y = (i - x) / width; r.n++; r.sx += x; r.sy += y; if (x < r.minX) r.minX = x; if (x > r.maxX) r.maxX = x; if (y < r.minY) r.minY = y; if (y > r.maxY) r.maxY = y; }
    return r;
  };
  const b = blobOf(pixels);
  if (b.n < floorPx) return [];
  // A padded local grid; the pad is outside, so every pixel has a finite depth.
  const pad = Math.ceil(SPLIT_CLOSE_M / gsdM) + 2;
  const W = b.maxX - b.minX + 1 + 2 * pad, H = b.maxY - b.minY + 1 + 2 * pad;
  const inside = new Uint8Array(W * H);
  for (const i of pixels) { const x = i % width, y = (i - x) / width; inside[(y - b.minY + pad) * W + (x - b.minX + pad)] = 1; }
  const raw0 = distanceInside(inside, W, H);
  let rawDeepest = 0;
  for (let k = 0; k < raw0.length; k++) if (raw0[k] > rawDeepest) rawDeepest = raw0[k];
  if (rawDeepest * gsdM < SPLIT_MIN_DEEPEST_M) return [b];
  // Closing: grow by k, then shrink by k. Fills bays and gaps narrower
  // than 2k; a neck between two plants that touch at a point becomes 2k
  // wide, still narrow against their depth.
  const k = Math.round(Math.min(SPLIT_CLOSE_M / gsdM, rawDeepest / 4));
  let shape = inside;
  if (k >= 1) {
    const outside = new Uint8Array(W * H);
    for (let i = 0; i < outside.length; i++) outside[i] = inside[i] ? 0 : 1;
    const toInside = distanceInside(outside, W, H);
    const grown = new Uint8Array(W * H);
    for (let i = 0; i < grown.length; i++) grown[i] = inside[i] || toInside[i] <= k ? 1 : 0;
    const fromEdge = distanceInside(grown, W, H);
    shape = new Uint8Array(W * H);
    for (let i = 0; i < shape.length; i++) shape[i] = grown[i] && fromEdge[i] > k ? 1 : 0;
    for (const i of pixels) { const x = i % width, y = (i - x) / width; shape[(y - b.minY + pad) * W + (x - b.minX + pad)] = 1; }
  }
  // Holes the shadow cut out of a canopy are filled, so the canopy is one
  // clean cone of depth and not a ring of lobes: what the pad cannot reach
  // around the outside is inside.
  const reach = new Uint8Array(W * H);
  const stack = [0];
  reach[0] = 1;
  while (stack.length) {
    const kk = stack.pop()!, x = kk % W, y = (kk - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (!shape[j] && !reach[j]) { reach[j] = 1; stack.push(j); }
    }
  }
  const filled = new Uint8Array(W * H);
  for (let i = 0; i < filled.length; i++) filled[i] = shape[i] || !reach[i] ? 1 : 0;
  const raw = distanceInside(filled, W, H);
  rawDeepest = 0;
  for (let i = 0; i < raw.length; i++) if (raw[i] > rawDeepest) rawDeepest = raw[i];
  const depth = boxBlur(raw, W, H, Math.round(Math.min(SPLIT_SMOOTH_M / gsdM, rawDeepest / 2)));
  let deepest = 0;
  for (let k = 0; k < depth.length; k++) if (depth[k] > deepest) deepest = depth[k];
  const floor = Math.max(SPLIT_MIN_DEPTH_PX, SPLIT_DEPTH_SHARE * deepest);
  // Watershed from the deepest point down. Each basin starts at a local
  // maximum of depth; where two basins meet, the depth there is the neck
  // between their centres, and a neck deep enough for the lesser centre
  // makes them one plant. Pixels are visited deepest first, so the first
  // meeting is the highest neck.
  const order: number[] = [];
  for (let k = 0; k < W * H; k++) if (filled[k]) order.push(k);
  order.sort((i, j) => depth[j] - depth[i]);
  const label = new Int32Array(W * H).fill(-1);
  const parent: number[] = [], peak: number[] = [];
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const k of order) {
    const x = k % W, y = (k - x) / W, d = depth[k];
    let first = -1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const l = label[yy * W + xx];
      if (l < 0) continue;
      const r = find(l);
      if (first < 0) { first = r; continue; }
      if (r === first) continue;
      // Two basins meet here, at a neck of depth d.
      const lesser = Math.min(peak[r], peak[first]);
      if (lesser < floor || d > SPLIT_NECK_SHARE * lesser) {
        const keep = peak[r] >= peak[first] ? r : first, drop = keep === r ? first : r;
        parent[drop] = keep; first = keep;
      }
    }
    if (first < 0) { first = parent.length; parent.push(first); peak.push(d); }
    label[k] = first;
  }
  const byRoot = new Map<number, number[]>();
  for (const i of pixels) {
    const x = i % width - b.minX + pad, y = (i - (i % width)) / width - b.minY + pad;
    const r = find(label[y * W + x]);
    let list = byRoot.get(r);
    if (!list) { list = []; byRoot.set(r, list); }
    list.push(i);
  }
  if (byRoot.size < 2) return [b];
  const parts = [...byRoot.values()];
  const kept = parts.filter(list => list.length >= floorPx).map(blobOf);
  return kept.length > 1 ? kept : [b];
}

/** Separable box blur of radius r over a grid; outside the grid counts as zero. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) if (x >= 0 && x < w) acc += src[y * w + x];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / n;
      const add = x + r + 1, drop = x - r;
      if (add < w) acc += src[y * w + add];
      if (drop >= 0) acc -= src[y * w + drop];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) if (y >= 0 && y < h) acc += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      const add = y + r + 1, drop = y - r;
      if (add < h) acc += tmp[add * w + x];
      if (drop >= 0) acc -= tmp[drop * w + x];
    }
  }
  return out;
}

/**
 * Euclidean distance of every inside pixel to the nearest outside pixel,
 * in pixels; zero outside. Felzenszwalb and Huttenlocher's separable
 * lower-envelope transform, exact and linear.
 */
export function distanceInside(inside: Uint8Array, w: number, h: number): Float32Array {
  const FAR = 1e9;
  const sq = new Float64Array(w * h);
  for (let k = 0; k < sq.length; k++) sq[k] = inside[k] ? FAR : 0;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1), v = new Int32Array(n);
  const pass = (len: number) => {
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = sq[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) sq[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = sq[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) sq[y * w + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let k = 0; k < out.length; k++) out[k] = inside[k] ? Math.sqrt(sq[k]) : 0;
  return out;
}

export function measureComponents(mask: Uint8Array, width: number, height: number, floorPx: number): { blobs: RawBlob[]; specks: number; labels: Int32Array } {
  const seen = new Uint8Array(mask.length);
  const labels = new Int32Array(mask.length);
  const stack: number[] = [];
  const blobs: RawBlob[] = [];
  let specks = 0;
  const pixels: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    pixels.length = 0;
    const b: RawBlob = { n: 0, sx: 0, sy: 0, minX: width, maxX: -1, minY: height, maxY: -1 };
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width, y = (i - x) / width;
      pixels.push(i);
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
    if (b.n < floorPx) { specks++; continue; }
    b.labels = [blobs.length + 1];
    for (const i of pixels) labels[i] = blobs.length + 1;
    blobs.push(b);
  }
  return { blobs, specks, labels };
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
export function placeOnRows(fit: RowTileFit, x: number, y: number, rowLines: RowLine[] | null = null): { rowIndex: number; acrossM: number; alongM: number } {
  const th = (fit.angleDeg * Math.PI) / 180;
  const nx = -Math.sin(th), ny = Math.cos(th), tx = Math.cos(th), ty = Math.sin(th);
  const acrossRaw = (x - fit.centre.x) * nx + (y - fit.centre.y) * ny - fit.phaseM;
  const alongM = (x - fit.centre.x) * tx + (y - fit.centre.y) * ty;
  const k0 = Math.round(acrossRaw / fit.pitchM);
  if (!rowLines) return { rowIndex: k0, acrossM: acrossRaw - k0 * fit.pitchM, alongM };
  // The nearest of the settled lines about the model's nearest row.
  let rowIndex = k0, acrossM = Infinity;
  for (let k = k0 - 1; k <= k0 + 1; k++) {
    const line = rowLines.find(l => l.index === k);
    const at = k * fit.pitchM + (line ? line.offsetM + line.slope * alongM : 0);
    if (Math.abs(acrossRaw - at) < Math.abs(acrossM)) { rowIndex = k; acrossM = acrossRaw - at; }
  }
  return { rowIndex, acrossM, alongM };
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

  type Fitted = { fit: RowTileFit; signal: RowSignal; squareGrid?: boolean };
  const profileVariance = (prof: Float64Array): number => {
    let n = 0, m = 0;
    for (let i = 0; i < prof.length; i++) if (Number.isFinite(prof[i])) { n++; m += prof[i]; }
    if (n < 2) return 0;
    m /= n;
    let v = 0;
    for (let i = 0; i < prof.length; i++) if (Number.isFinite(prof[i])) v += (prof[i] - m) ** 2;
    return v / n;
  };
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
   * The same fit, with its direction and phase measured again on a patch
   * about the window and referenced to the window's own centre. The pitch
   * is kept: it needs the rows of the wider neighbourhood. The direction is
   * searched only near the neighbourhood's, which is a blur of the plantings
   * the neighbourhood straddled; the patch is one planting's own, so two
   * plantings a few degrees apart in one photo get their own directions and
   * fall into their own blocks.
   */
  const localisePhase = (w: { x0: number; y0: number; x1: number; y1: number }, f: Fitted): Fitted => {
    const { fit } = f;
    if (!(fit.confidence > 0) || !(fit.pitchM > 0)) return f;
    const r = regionAround(w, Math.round((PHASE_PATCH_ROWS * fit.pitchM) / gsdM));
    const factor = Math.max(1, Math.floor(fit.pitchM / gsdM / PATCH_PITCH_PX));
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
    const local = rowAngle(sp, { hintPxDeg: groundAngleToPixel(fit.angleDeg) });
    const angleDeg = local.confidence >= MIN_TILE_CONFIDENCE ? pixelAngleToGround(local.anglePxDeg) : fit.angleDeg;
    const phaseM = phaseFromImage(sp, toGround, centre.x, centre.y, angleDeg, fit.pitchM);
    return { signal: f.signal, fit: { ...fit, centre, angleDeg, phaseM } };
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
    const at = (growerSpacingM: number, signal: RowSignal, hint: number | null = angleHintDeg): Fitted | null => {
      const { x0, y0, x1, y1 } = neighbourhood(w, growerSpacingM);
      if (signal === "vegetation" && !maskableOver(x0, y0, x1, y1)) return null;
      const key = `${x0},${y0},${x1},${y1},${growerSpacingM.toFixed(4)},${signal},${hint == null ? "" : hint.toFixed(1)}`;
      let fit = fitCache.get(key);
      if (!fit) {
        fit = signal === "vegetation"
          ? fitWindow({ mask, width: px.width, x0, y0, x1, y1, gsdM, originX: x0 * gsdM, originY: -y0 * gsdM, growerSpacingM, angleHintDeg: hint })
          : fitWindowBrightness({ luma, width: px.width, x0, y0, x1, y1, gsdM, growerSpacingM, angleHintDeg: hint, vegetationFraction: vegFraction });
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
  /** Is the quarter-turned direction as good a fit as this one on the window's neighbourhood, and which way is brighter? Cached per neighbourhood. */
  const squareCache = new Map<string, { angleDeg: number; turn: boolean } | null>();
  function squareCheck(w: { x0: number; y0: number; x1: number; y1: number }, fit: { angleDeg: number; pitchM: number }): { angleDeg: number; turn: boolean } | null {
    const n = neighbourhood(w, fit.pitchM);
    const key = `${n.x0},${n.y0},${n.x1},${n.y1},${fit.pitchM.toFixed(3)},${fit.angleDeg.toFixed(1)}`;
    const cached = squareCache.get(key);
    if (cached !== undefined) return cached;
    const factor = downsampleFactor(gsdM, fit.pitchM), sampleM = gsdM * factor;
    const nw = n.x1 - n.x0 + 1, nh = n.y1 - n.y0 + 1;
    const veg = toSparse(poolWindow(mask, px.width, n.x0, n.y0, nw, nh, factor));
    const perpDeg = (fit.angleDeg + 90) % 180;
    let out: { angleDeg: number; turn: boolean } | null = null;
    if (veg.xs.length > 0) {
      const along = rowPitch(projectionProfile(veg, groundAngleToPixel(fit.angleDeg)).profile, sampleM, fit.pitchM);
      const perpProfile = projectionProfile(veg, groundAngleToPixel(perpDeg)).profile;
      const across = rowPitch(perpProfile, sampleM, fit.pitchM);
      // Plants 20 cm apart along a 40 cm row also peak at 40 cm across the
      // turn: a harmonic. The quarter turn is a grid only when its own
      // fundamental is the row pitch, not half of it.
      const half = rowPitch(perpProfile, sampleM, fit.pitchM / 2);
      const harmonic = half.confidence >= 0.7 * across.confidence && checkPitch(half.pitchM, fit.pitchM / 2);
      if (!harmonic && across.confidence >= Math.max(MIN_TILE_CONFIDENCE, SQUARE_GRID_SHARE * along.confidence) && checkPitch(across.pitchM, fit.pitchM)) {
        const bri = toSparse(highPassPositive(poolFloat(luma, px.width, n.x0, n.y0, nw, nh, factor), Math.max(2, Math.round((2 * fit.pitchM) / sampleM))));
        const v0 = profileVariance(projectionProfile(bri, groundAngleToPixel(fit.angleDeg)).profile);
        const v1 = profileVariance(projectionProfile(bri, groundAngleToPixel(perpDeg)).profile);
        out = { angleDeg: perpDeg, turn: v1 >= SQUARE_GRID_BRIGHTNESS_RATIO * v0 };
      }
    }
    squareCache.set(key, out);
    return out;
  }
  const canopyClosed = vegetationFraction >= CANOPY_CLOSED;
  if (canopyClosed) notes.push("The canopy is closed in this photo: almost every pixel is vegetation, so no plant is separate and blobs are not placed. Rows can still be found from brightness.");

  const windows: PhotoWindow[] = [];
  for (let i = 0; i < plan.length; i++) {
    const w = plan[i];
    const { fit, signal } = fitOne(w, params.rowAngleDeg ?? null);
    windows.push({ index: i, ...w, fit, signal, usable: fit.confidence >= MIN_TILE_CONFIDENCE, block: null, own: null, rowLines: null, squareGrid: false, seed: null, onRow: 0, offRow: 0 });
    if (opts.onProgress?.(i + 1, plan.length) === false) break;
    if (opts.yieldBetweenWindows !== false) await tick();
  }

  // A square grid fits both ways on vegetation (vines 3.5 m along the wire
  // and rows 3.5 m apart), and the windows chose across the trellis, each on
  // its own. Decided once per photo: the direction a quarter turn from the
  // photo's main direction is tried at the main spacing on the whole photo;
  // where it is nearly as good, brightness decides, because the wire, the
  // net edge or the wheel track runs along the row and is bright. Every
  // window is then refitted near the chosen direction, so the blocks come out
  // whole. The grower's direction, when given, settles it without asking.
  if (params.rowAngleDeg == null) {
    const good = windows.filter(w => w.usable && w.signal === "vegetation" && selfConsistent(w.fit));
    const mainPitch = median(good.map(w => w.fit.pitchM));
    if (good.length >= plan.length / 4 && mainPitch != null) {
      const mainAngle = meanAngleDeg(good.map(w => w.fit.angleDeg));
      const sq = squareCheck({ x0: 0, y0: 0, x1: px.width - 1, y1: px.height - 1 }, { angleDeg: mainAngle, pitchM: mainPitch });
      if (sq) {
        // Whichever way was chosen, every window is refitted near it: on a
        // square grid the first pass splits between the two directions
        // window by window, and a split photo is two blocks of one planting.
        const chosen = sq.turn ? sq.angleDeg : mainAngle;
        for (const w of windows) {
          if (w.usable && angleDiffDeg(w.fit.angleDeg, chosen) <= HINT_SEARCH_DEG) { w.squareGrid = true; continue; }
          const { fit, signal } = fitOne(w, chosen);
          if (fit.confidence >= MIN_TILE_CONFIDENCE && selfConsistent(fit) && angleDiffDeg(fit.angleDeg, chosen) <= HINT_SEARCH_DEG + 0.5 && checkPitch(fit.pitchM, mainPitch)) {
            w.fit = fit; w.signal = signal; w.usable = true; w.squareGrid = true;
          }
        }
        if (opts.yieldBetweenWindows !== false) await tick();
      }
    }
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

  // Blocks. Rows are straight and run the same way across one planting, so
  // windows whose rows are the same rows share one model: one direction, one
  // spacing, one phase, referenced to the block's centre. The lines then run
  // unbroken across the block instead of jogging or stopping at every window
  // edge, and a window of bare soil inside a block takes the block's rows.
  // Where the rows change, two plantings in one photo, the blocks are
  // separate and the lines stop where they meet. Membership is by fit: a
  // window belongs to a block only while the block's lines pass through the
  // rows the window measured on its own, so two plantings two degrees apart
  // whose rows do not line up are two blocks even though their directions
  // nearly agree.
  const cols = new Set(plan.map(w => w.x0)).size;
  const angleDiff = (a: number, b: number) => { const d = Math.abs((((a - b) % 180) + 180) % 180); return Math.min(d, 180 - d); };
  const neighbours = (i: number) => {
    const r = Math.floor(i / cols), c = i % cols, out: number[] = [];
    if (c > 0) out.push(i - 1);
    if (c < cols - 1 && i + 1 < windows.length) out.push(i + 1);
    if (r > 0) out.push(i - cols);
    if (i + cols < windows.length) out.push(i + cols);
    return out;
  };
  const centreOf = (w: { x0: number; y0: number; x1: number; y1: number }) => ({ x: ((w.x0 + w.x1 + 1) / 2) * gsdM, y: -((w.y0 + w.y1 + 1) / 2) * gsdM });
  const wrapHalf = (d: number, p: number) => ((((d + p / 2) % p) + p) % p) - p / 2;
  type BlockModel = { angleDeg: number; pitchM: number; phaseM: number; ref: { x: number; y: number }; fromGrower: boolean; signal: RowSignal; typical: { confidence: number; angleConfidence: number; pitchConfidence: number; recoveredPitchM: number } };
  /**
   * One straight model through a block's windows. Each window's phase is a
   * measured row position near its centre; the block's direction is the
   * mean of the windows' own, its phase the circular mean of the positions
   * about the reference, and its spacing the median corrected by how the
   * positions drift from the lines across the block.
   */
  const modelOf = (members: number[]): BlockModel => {
    const fits = members.map(i => windows[i].fit);
    const wts = fits.map(f => Math.max(1e-3, f.confidence));
    const wsum = wts.reduce((a, b) => a + b, 0);
    // A mean of doubled angles, since rows at 179 and 1 degree run the same way.
    let cx2 = 0, sx2 = 0;
    fits.forEach((f, k) => { const t = (2 * f.angleDeg * Math.PI) / 180; cx2 += wts[k] * Math.cos(t); sx2 += wts[k] * Math.sin(t); });
    const angleDeg = ((((Math.atan2(sx2, cx2) / 2) * 180) / Math.PI) % 180 + 180) % 180;
    let pitchM = median(fits.map(f => f.pitchM))!;
    const ref = { x: 0, y: 0 };
    members.forEach((i, k) => { const c = centreOf(windows[i]); ref.x += (wts[k] * c.x) / wsum; ref.y += (wts[k] * c.y) / wsum; });
    const fromGrower = fits.filter(f => f.pitchFromGrower).length * 2 > fits.length;
    const th = (angleDeg * Math.PI) / 180, nx = -Math.sin(th), ny = Math.cos(th);
    const cRef = ref.x * nx + ref.y * ny;
    const rowAt = fits.map(f => f.centre.x * nx + f.centre.y * ny + f.phaseM);
    const circularPhase = (p: number) => {
      let re = 0, im = 0;
      rowAt.forEach((a, k) => { const t = (2 * Math.PI * (a - cRef)) / p; re += wts[k] * Math.cos(t); im += wts[k] * Math.sin(t); });
      return ((((Math.atan2(im, re) / (2 * Math.PI)) * p) % p) + p) % p;
    };
    let phaseM = circularPhase(pitchM);
    if (!fromGrower && members.length >= 3) {
      const cs = members.map(i => { const c = centreOf(windows[i]); return c.x * nx + c.y * ny - cRef; });
      const rs = rowAt.map(a => wrapHalf(a - cRef - phaseM, pitchM));
      let cm = 0, rm = 0;
      cs.forEach((c, k) => { cm += (wts[k] * c) / wsum; rm += (wts[k] * rs[k]) / wsum; });
      let sxy = 0, sxx = 0;
      cs.forEach((c, k) => { sxy += wts[k] * (c - cm) * (rs[k] - rm); sxx += wts[k] * (c - cm) * (c - cm); });
      if (sxx > 0) {
        pitchM = pitchM / (1 - Math.max(-0.15, Math.min(0.15, sxy / sxx)));
        phaseM = circularPhase(pitchM);
      }
    }
    const signal: RowSignal = members.filter(i => windows[i].signal === "brightness").length * 2 > members.length ? "brightness" : "vegetation";
    return {
      angleDeg, pitchM, phaseM, ref, fromGrower, signal,
      typical: {
        confidence: median(fits.map(f => f.confidence))!, angleConfidence: median(fits.map(f => f.angleConfidence))!,
        pitchConfidence: median(fits.map(f => f.pitchConfidence))!, recoveredPitchM: median(fits.map(f => f.recoveredPitchM))!,
      },
    };
  };
  /** Signed metres from (x, y) to a model's nearest row. */
  const rowOffset = (m: BlockModel, x: number, y: number) => {
    const t = (m.angleDeg * Math.PI) / 180;
    return wrapHalf((x - m.ref.x) * -Math.sin(t) + (y - m.ref.y) * Math.cos(t) - m.phaseM, m.pitchM);
  };
  /** A point on the row a window measured on its own. */
  const rowPoint = (f: RowTileFit) => { const t = (f.angleDeg * Math.PI) / 180; return { x: f.centre.x + f.phaseM * -Math.sin(t), y: f.centre.y + f.phaseM * Math.cos(t) }; };
  const agree = (seed: RowTileFit, b: RowTileFit) =>
    angleDiff(seed.angleDeg, b.angleDeg) <= BLOCK_ANGLE_DEG && Math.abs(seed.pitchM - b.pitchM) <= BLOCK_PITCH_TOL * Math.max(seed.pitchM, b.pitchM);
  // Rows that are the same rows continue across a window edge: two windows
  // join only when their fits put the rows at the middle of their shared
  // edge in the same place, not merely in the same direction, or a chain of
  // windows each a little different from the last joins two plantings.
  const edgeMid = (j: number, k: number) => {
    const a = windows[j], b = windows[k];
    return { x: ((Math.max(a.x0, b.x0) + Math.min(a.x1, b.x1) + 1) / 2) * gsdM, y: -((Math.max(a.y0, b.y0) + Math.min(a.y1, b.y1) + 1) / 2) * gsdM };
  };
  const rowsMeet = (j: number, k: number): boolean => {
    const m = edgeMid(j, k), fa = windows[j].fit, fb = windows[k].fit;
    const off = (f: RowTileFit) => { const t = (f.angleDeg * Math.PI) / 180; return (m.x - f.centre.x) * -Math.sin(t) + (m.y - f.centre.y) * Math.cos(t) - f.phaseM; };
    const p = Math.min(fa.pitchM, fb.pitchM);
    return Math.abs(wrapHalf(off(fa) - off(fb), p)) <= BLOCK_EDGE_TOL * p;
  };
  /** Connected groups within a pool of windows whose fits agree edge to edge. */
  const flood = (pool: Set<number>): number[][] => {
    const seen = new Set<number>(), out: number[][] = [];
    for (const i of pool) {
      if (seen.has(i)) continue;
      const members: number[] = [], stack = [i];
      seen.add(i);
      while (stack.length) {
        const j = stack.pop()!;
        members.push(j);
        for (const k of neighbours(j)) if (pool.has(k) && !seen.has(k) && agree(windows[i].fit, windows[k].fit) && rowsMeet(j, k)) { seen.add(k); stack.push(k); }
      }
      out.push(members);
    }
    return out;
  };
  // Too small a block is not a planting: a lone window that found rows
  // beside a road found shrubs. Its window loses its rows.
  let blocks = flood(new Set(windows.filter(w => w.usable).map(w => w.index))).filter(b => b.length >= MIN_BLOCK_WINDOWS);
  let models: (BlockModel | null)[] = blocks.map(modelOf);
  const blockOf = new Array<number>(windows.length).fill(-1);
  const mapBlocks = () => { blockOf.fill(-1); blocks.forEach((b, id) => b.forEach(i => { blockOf[i] = id; })); };
  // Merging: one noisy window edge splits a planting into two blocks whose
  // models, fitted on dozens of windows each, agree. Adjacent blocks whose
  // models put the rows in the same places along their shared edges are one
  // block. Until nothing merges.
  const mergeAll = () => {
    for (;;) {
      mapBlocks();
      let merged = false;
      for (let a = 0; a < blocks.length && !merged; a++) {
        const ma = models[a];
        if (!ma) continue;
        for (let b = a + 1; b < blocks.length && !merged; b++) {
          const mb = models[b];
          if (!mb) continue;
          if (angleDiff(ma.angleDeg, mb.angleDeg) > BLOCK_ANGLE_DEG || Math.abs(ma.pitchM - mb.pitchM) > BLOCK_PITCH_TOL * Math.max(ma.pitchM, mb.pitchM)) continue;
          let shared = 0, meet = 0;
          for (const i of blocks[a]) for (const k of neighbours(i)) {
            if (blockOf[k] !== b) continue;
            const m = edgeMid(i, k), p = Math.min(ma.pitchM, mb.pitchM);
            shared++;
            if (Math.abs(wrapHalf(rowOffset(ma, m.x, m.y) - rowOffset(mb, m.x, m.y), p)) <= BLOCK_EDGE_TOL * p) meet++;
          }
          if (shared === 0 || meet * 2 <= shared) continue;
          blocks[a] = blocks[a].concat(blocks[b]);
          blocks[b] = [];
          models[a] = modelOf(blocks[a]);
          models[b] = null;
          merged = true;
        }
      }
      if (!merged) break;
    }
  };
  mergeAll();
  // Membership by fit: windows whose own rows the block's lines miss leave
  // the block, the block is refitted without them, and they regroup among
  // themselves (alone if need be: a planting's edge is still that planting).
  for (let pass = 0; pass < 3; pass++) {
    const loose: number[] = [];
    for (let id = 0; id < blocks.length; id++) {
      const m = models[id];
      if (!m) continue;
      const out = blocks[id].filter(i => { const p = rowPoint(windows[i].fit); return Math.abs(rowOffset(m, p.x, p.y)) > BLOCK_EDGE_TOL * m.pitchM; });
      if (out.length === 0 || blocks[id].length - out.length < MIN_BLOCK_WINDOWS) continue;
      const outSet = new Set(out);
      blocks[id] = blocks[id].filter(i => !outSet.has(i));
      models[id] = modelOf(blocks[id]);
      loose.push(...out);
    }
    if (loose.length === 0) break;
    for (const g of flood(new Set(loose))) { blocks.push(g); models.push(modelOf(g)); }
    mergeAll();
  }
  mapBlocks();
  // Stray blocks: a few windows beside a road or a hedge that found rows in
  // shrubs. Against the main block (the most windows), a block with under a
  // fifth of its windows whose fits mostly fell back on a candidate spacing
  // or whose median confidence is well under the main block's is dropped;
  // its windows lose their rows. A second planting keeps its block: it has
  // the windows, or the confidence, or both.
  {
    const live = blocks.map((b, id) => ({ id, b })).filter(x => models[x.id] && x.b.length > 0);
    const main = live.reduce((best, x) => (x.b.length > best.b.length ? x : best), live[0] ?? { id: -1, b: [] as number[] });
    if (main.id >= 0) {
      const mainConf = median(main.b.map(i => windows[i].fit.confidence)) ?? 0;
      for (const { id, b } of live) {
        if (id === main.id || b.length >= STRAY_BLOCK_WINDOW_SHARE * main.b.length) continue;
        const fromGrower = b.filter(i => windows[i].fit.pitchFromGrower).length * 2 > b.length;
        const conf = median(b.map(i => windows[i].fit.confidence)) ?? 0;
        if (fromGrower || conf < STRAY_BLOCK_CONFIDENCE_SHARE * mainConf) { blocks[id] = []; models[id] = null; }
      }
      mapBlocks();
    }
  }
  // Holes: a window without rows whose neighbours mostly belong to one block
  // joins it. Twice, so a hole two windows wide closes from both sides.
  const filled = new Set<number>();
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < windows.length; i++) {
      if (blockOf[i] >= 0) continue;
      const votes = new Map<number, number>();
      for (const k of neighbours(i)) if (blockOf[k] >= 0) votes.set(blockOf[k], (votes.get(blockOf[k]) ?? 0) + 1);
      let best = -1, n = 0;
      for (const [b, v] of votes) if (v > n) { best = b; n = v; }
      if (n >= 2) { blockOf[i] = best; filled.add(i); }
    }
  }
  for (const w of windows) if (blockOf[w.index] < 0) w.usable = false;
  // Refit on the block's own pixels. The windows' fits came from
  // neighbourhoods that reach into whatever lies around them; a block is
  // one planting, so its direction, spacing and phase are measured again
  // on the vegetation (or brightness) of its windows alone. That is where a
  // sliver of three rows at 2.8 m beside a planting at 5.1 m gets its own
  // spacing instead of the neighbour's, which had left every second row
  // without a line.
  const pooledCache = new Map<string, FloatImage>();
  const pooledWhole = (signal: RowSignal, factor: number, pitchM: number): FloatImage => {
    const key = `${signal}:${factor}:${signal === "brightness" ? pitchM.toFixed(2) : ""}`;
    let img = pooledCache.get(key);
    if (!img) {
      const w = Math.floor(px.width / factor), h = Math.floor(px.height / factor);
      img = signal === "vegetation"
        ? poolWindow(mask, px.width, 0, 0, w * factor, h * factor, factor)
        : highPassPositive(poolFloat(luma, px.width, 0, 0, w * factor, h * factor, factor), Math.max(2, Math.round((2 * pitchM) / (gsdM * factor))));
      pooledCache.set(key, img);
    }
    return img;
  };
  const refitOnPixels = (m: BlockModel, all: number[]): { model: BlockModel; rowLines: RowLine[] } => {
    const factor = Math.max(1, Math.floor(m.pitchM / gsdM / PATCH_PITCH_PX));
    const sampleM = gsdM * factor;
    const whole = pooledWhole(m.signal, factor, m.pitchM);
    // The block's cells only; everything else is zero and so absent from the sparse image.
    const data = new Float32Array(whole.data.length);
    for (const i of all) {
      const w = windows[i];
      const cx0 = Math.ceil(w.x0 / factor), cx1 = Math.min(whole.width - 1, Math.floor((w.x1 + 1) / factor) - 1);
      const cy0 = Math.ceil(w.y0 / factor), cy1 = Math.min(whole.height - 1, Math.floor((w.y1 + 1) / factor) - 1);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) data[cy * whole.width + cx] = whole.data[cy * whole.width + cx];
    }
    const sp = toSparse({ data, width: whole.width, height: whole.height });
    const toGround = (sx: number, sy: number) => ({ x: sx * sampleM, y: -sy * sampleM });
    // Each row line settled on its own row: the vegetation within
    // ROW_LINE_BAND of the model's line for that row, a straight line
    // through it (offset and tilt about the model), so rows that fan or
    // sit unevenly each get a line through them and not beside them.
    const settle = (mm: BlockModel): RowLine[] => {
      const t = (mm.angleDeg * Math.PI) / 180, nx = -Math.sin(t), ny = Math.cos(t), tx = Math.cos(t), ty = Math.sin(t);
      const acc = new Map<number, { w: number; sl: number; sr: number; sll: number; slr: number }>();
      for (let i = 0; i < sp.xs.length; i++) {
        const g = toGround(sp.xs[i], sp.ys[i]), v = sp.vals[i];
        const along = (g.x - mm.ref.x) * tx + (g.y - mm.ref.y) * ty;
        const across = (g.x - mm.ref.x) * nx + (g.y - mm.ref.y) * ny - mm.phaseM;
        const k = Math.round(across / mm.pitchM), r = across - k * mm.pitchM;
        if (Math.abs(r) > ROW_LINE_BAND * mm.pitchM) continue;
        let a = acc.get(k);
        if (!a) { a = { w: 0, sl: 0, sr: 0, sll: 0, slr: 0 }; acc.set(k, a); }
        a.w += v; a.sl += v * along; a.sr += v * r; a.sll += v * along * along; a.slr += v * along * r;
      }
      const lines: RowLine[] = [];
      const maxSlope = Math.tan((ROW_LINE_MAX_TILT_DEG * Math.PI) / 180);
      for (const [k, a] of acc) {
        if (a.w < ROW_LINE_MIN_MASS) continue;
        const lm = a.sl / a.w, rm = a.sr / a.w;
        const sll = a.sll - a.w * lm * lm, slr = a.slr - a.w * lm * rm;
        // Spread along the row of at least one spacing before a tilt is believed.
        let slope = sll > mm.pitchM * mm.pitchM * a.w ? slr / sll : 0;
        slope = Math.max(-maxSlope, Math.min(maxSlope, slope));
        const offsetM = Math.max(-ROW_LINE_BAND * mm.pitchM, Math.min(ROW_LINE_BAND * mm.pitchM, rm - slope * lm));
        lines.push({ index: k, offsetM, slope });
      }
      return lines;
    };
    if (sp.xs.length < 64) return { model: m, rowLines: [] };
    const found = rowAngle(sp, { hintPxDeg: groundAngleToPixel(m.angleDeg) });
    if (found.confidence < MIN_TILE_CONFIDENCE) return { model: m, rowLines: settle(m) };
    const angleDeg = pixelAngleToGround(found.anglePxDeg);
    const { profile } = projectionProfile(sp, found.anglePxDeg);
    let pitchM = m.pitchM;
    if (!m.fromGrower) {
      // The block's own pixels outrank the neighbourhoods' spacing: a sliver
      // of rows at 3.4 m beside a planting at 5.1 m was handed 5.6 m, and
      // the peak in its own profile is at 3.4 m.
      const full = rowPitch(profile, sampleM, m.pitchM);
      if (full.confidence >= MIN_TILE_CONFIDENCE) pitchM = full.pitchM;
      // The neighbourhoods may have handed the block a harmonic: rows at
      // half the spacing, on the block's own pixels, are the truer ones.
      const half = rowPitch(profile, sampleM, pitchM / 2);
      if (half.confidence >= Math.max(MIN_TILE_CONFIDENCE, BLOCK_HALF_PITCH_SHARE * full.confidence) && checkPitch(half.pitchM, pitchM / 2)) pitchM = half.pitchM;
    }
    const phaseM = phaseFromImage(sp, toGround, m.ref.x, m.ref.y, angleDeg, pitchM);
    const model = { ...m, angleDeg, pitchM, phaseM };
    return { model, rowLines: settle(model) };
  };
  const blockNotes: string[] = [];
  const blocksOut: PhotoBlock[] = [];
  for (let id = 0; id < blocks.length; id++) {
    let m = models[id];
    if (!m) continue;
    const all: number[] = [];
    for (let i = 0; i < windows.length; i++) if (blockOf[i] === id) all.push(i);
    const refit = refitOnPixels(m, all);
    m = refit.model;
    let sizeM = 0;
    for (const i of all) {
      const w = windows[i];
      for (const [x, y] of [[w.x0, w.y0], [w.x1 + 1, w.y0], [w.x0, w.y1 + 1], [w.x1 + 1, w.y1 + 1]]) sizeM = Math.max(sizeM, Math.hypot(x * gsdM - m.ref.x, -y * gsdM - m.ref.y));
    }
    for (const i of all) {
      const w = windows[i], own = filled.has(i) ? null : w.fit;
      w.own = own ? { angleDeg: own.angleDeg, pitchM: own.pitchM, confidence: own.confidence } : null;
      w.fit = {
        centre: m.ref, sizeM, angleDeg: m.angleDeg, pitchM: m.pitchM, phaseM: m.phaseM,
        confidence: own?.confidence ?? m.typical.confidence, angleConfidence: own?.angleConfidence ?? m.typical.angleConfidence, pitchConfidence: own?.pitchConfidence ?? m.typical.pitchConfidence,
        vegetationFraction: w.fit.vegetationFraction, pitchFromGrower: m.fromGrower, recoveredPitchM: own?.recoveredPitchM ?? m.typical.recoveredPitchM,
      };
      w.signal = m.signal; w.usable = true; w.block = id; w.rowLines = refit.rowLines;
    }
    blocksOut.push({
      id, angleDeg: m.angleDeg, pitchM: m.pitchM, phaseM: m.phaseM, centre: m.ref, signal: m.signal, windows: all, rowLines: refit.rowLines,
      squareGrid: all.some(i => windows[i].squareGrid), plants: 0, seedSpacingM: null,
    });
    blockNotes.push(`${all.length} windows at ${m.angleDeg.toFixed(0)}° and ${(m.pitchM * 100).toFixed(0)} cm`);
  }
  if (blockNotes.length > 1) notes.push(`Rows run ${blockNotes.length} ways in this photo: ${blockNotes.join("; ")}. Each block has its own lines, which stop where the blocks meet.`);

  const minBlobAreaCm2 = params.minBlobAreaCm2 ?? DEFAULT_MIN_BLOB_AREA_CM2;
  const floorPx = Math.max(MIN_BLOB_PX, minAreaPx(gsdM, minBlobAreaCm2));
  const measured = measureComponents(mask, px.width, px.height, floorPx);
  const pitchForMerge = median(windows.filter(w => w.usable).map(w => w.fit.pitchM));
  if (pitchForMerge != null) measured.blobs = mergeComponents(measured.blobs, (MERGE_GAP_FRACTION * pitchForMerge) / gsdM);
  const windowAt = (x: number, y: number): PhotoWindow | null => {
    for (const w of windows) if (x >= w.x0 && x <= w.x1 && y >= w.y0 && y <= w.y1) return w;
    return null;
  };
  // A row whose canopies touch, or that has weeds running under it, masks
  // as one blob the length of the row; it is split at the valleys of its
  // profile along the row, one plant per rise.
  measured.blobs = measured.blobs.flatMap(b => {
    const w = windowAt(Math.round(b.sx / b.n), Math.round(b.sy / b.n));
    // A part on the photo's edge stays unplaced by its own bounding box; the rest of the row is placed.
    // Nothing is placed in a closed canopy, and its one blob is the photo.
    return w?.usable && !canopyClosed ? splitAlongRow(b, measured.labels, px.width, w.fit, w.rowLines, gsdM, floorPx) : [b];
  });
  let blobs: PhotoBlob[] = measured.blobs.map((b, id) => {
    const x = b.sx / b.n, y = b.sy / b.n;
    const touchesBorder = b.minX === 0 || b.minY === 0 || b.maxX === px.width - 1 || b.maxY === px.height - 1;
    const areaM2 = b.n * gsdM * gsdM;
    const w = windowAt(Math.round(x), Math.round(y));
    const blob: PhotoBlob = {
      id, x, y, areaPx: b.n, areaM2, equivDiameterM: 2 * Math.sqrt(areaM2 / Math.PI), touchesBorder,
      window: w?.index ?? null, rowIndex: null, acrossM: null, alongM: null, cls: "unplaced",
    };
    if (w && w.usable && !touchesBorder && !canopyClosed) {
      const p = placeOnRows(w.fit, x * gsdM, -y * gsdM, w.rowLines);
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

  // Ragged canopies the split cut in two, and a branch cluster the mask
  // holds apart from its tree: two on-row blobs on one row of one block,
  // nearer along it than DOUBLE_MERGE_SHARE of a plant, are one plant. Two
  // plants sit a seed spacing apart, further than that, or they would be
  // one canopy.
  if (plantDiameterM != null) {
    const groups = new Map<string, PhotoBlob[]>();
    for (const b of blobs) {
      if (b.cls !== "on pattern" || b.rowIndex == null || b.alongM == null || b.window == null) continue;
      const key = `${windows[b.window].block}:${b.rowIndex}`;
      let g = groups.get(key);
      if (!g) { g = []; groups.set(key, g); }
      g.push(b);
    }
    const gone = new Set<PhotoBlob>();
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      g.sort((a, b) => a.alongM! - b.alongM!);
      let keep = g[0];
      for (let i = 1; i < g.length; i++) {
        const b = g[i];
        if (b.alongM! - keep.alongM! < DOUBLE_MERGE_SHARE * plantDiameterM) {
          const n = keep.areaPx + b.areaPx;
          keep.x = (keep.x * keep.areaPx + b.x * b.areaPx) / n; keep.y = (keep.y * keep.areaPx + b.y * b.areaPx) / n;
          keep.acrossM = (keep.acrossM! * keep.areaPx + b.acrossM! * b.areaPx) / n; keep.alongM = (keep.alongM! * keep.areaPx + b.alongM! * b.areaPx) / n;
          keep.areaPx = n; keep.areaM2 = n * gsdM * gsdM; keep.equivDiameterM = 2 * Math.sqrt(keep.areaM2 / Math.PI);
          keep.touchesBorder = keep.touchesBorder || b.touchesBorder;
          gone.add(b);
          windows[b.window!].onRow--;
          // The kept blob belongs to the window its centre now sits in.
          const home = windowAt(Math.round(keep.x), Math.round(keep.y));
          if (home && home.index !== keep.window) { windows[keep.window!].onRow--; home.onRow++; keep.window = home.index; }
        } else keep = b;
      }
    }
    if (gone.size) blobs = blobs.filter(b => !gone.has(b)).map((b, id) => ({ ...b, id }));
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
      const p = placeOnRows(w.fit, b.x * gsdM, -b.y * gsdM, w.rowLines);
      if (Math.abs(p.acrossM) <= tol) placed.push({ blob: b, rowIndex: p.rowIndex, alongM: p.alongM });
    }
    w.seed = fitSeeds(placed, gsdM, b => b.window === w.index && b.cls === "on pattern");
    // On the row but under a quarter of a plant, where the plants are
    // separate enough to have a spacing: weeds along the row, not the crop.
    if (w.seed?.usable) {
      for (const b of blobs) {
        if (b.window !== w.index || b.cls !== "on pattern" || b.areaM2 >= minSeedArea) continue;
        b.cls = "between plants"; w.onRow--; w.seed.betweenPlants++;
      }
    }
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
    blocks: blocksOut.length,
    squareGrid: blocksOut.some(b => b.squareGrid),
  };
  for (const bl of blocksOut) {
    const members = new Set(bl.windows);
    bl.plants = blobs.filter(b => b.cls === "on pattern" && b.window != null && members.has(b.window)).length;
    bl.seedSpacingM = median(bl.windows.map(i => windows[i].seed).filter((s): s is SeedFit => !!s && s.usable).map(s => s.spacingM));
  }
  if (summary.squareGrid && params.rowAngleDeg == null) {
    notes.push("The plants sit on a square grid, so rows fit both ways. The lines follow the brighter direction (a trellis, a wire or a wheel track runs along the row). If they run the wrong way, set the row direction.");
  }

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

  return { width: px.width, height: px.height, gsdM, rowSpacingM, windowM, minBlobAreaCm2, vegetationFraction, canopyClosed, windows, blobs, blocks: blocksOut, summary, notes };
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
    const line = w.rowLines?.find(l => l.index === k);
    const at = (along: number) => fit.phaseM + k * fit.pitchM + (line ? line.offsetM + line.slope * along : 0);
    const a = { x: fit.centre.x - tx * half + at(-half) * nx, y: fit.centre.y - ty * half + at(-half) * ny };
    const b = { x: fit.centre.x + tx * half + at(half) * nx, y: fit.centre.y + ty * half + at(half) * ny };
    out.push({ x1: a.x / gsdM, y1: -a.y / gsdM, x2: b.x / gsdM, y2: -b.y / gsdM, rowIndex: k });
  }
  return out;
}
