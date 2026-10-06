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
import { DEFAULT_ROW_WINDOW_M, MIN_TILE_CONFIDENCE, fitWindow } from "../weedScout/rows";
import type { RowTileFit } from "../weedScout/types";
import { globalThreshold, indexRaster, maskWindow } from "../weedScout/vegetation";

export type PhotoPixels = { width: number; height: number; rgba: Uint8ClampedArray };

export type PhotoParams = {
  /** Ground sample distance of THESE pixels, metres. */
  gsdM: number;
  /** The grower's row spacing, metres. The fit happens inside a band around it. */
  rowSpacingM: number;
  /** Window edge for the row fit, metres. */
  windowM?: number;
  /** Blobs under this ground area are specks, not plants. */
  minBlobAreaCm2?: number;
};

export const DEFAULT_MIN_BLOB_AREA_CM2 = 4;
/** A blob further than this fraction of the pitch from its row is off-row. */
export const OFF_ROW_FRACTION = 0.25;
/** Gaps along a row must be at least this many pixels to count as two plants. */
export const MIN_GAP_PX = 2;
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

export type PhotoWindow = {
  index: number;
  x0: number; y0: number; x1: number; y1: number;
  fit: RowTileFit;
  usable: boolean;
  seed: SeedFit | null;
  onRow: number;
  offRow: number;
};

export type PhotoSummary = {
  windows: number;
  usableWindows: number;
  medianAngleDeg: number | null;
  medianPitchM: number | null;
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
  rowSpacingM: number;
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

type RawBlob = { n: number; sx: number; sy: number; minX: number; maxX: number; minY: number; maxY: number };

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
export function fitSeeds(onRow: PhotoBlob[], gsdM: number): SeedFit | null {
  const byRow = new Map<number, PhotoBlob[]>();
  for (const b of onRow) {
    if (b.rowIndex == null) continue;
    byRow.set(b.rowIndex, [...(byRow.get(b.rowIndex) ?? []), b]);
  }
  const rows = [...byRow.values()].filter(r => r.length >= MIN_ROW_BLOBS).map(r => [...r].sort((a, b) => a.alongM! - b.alongM!));
  const gaps: number[] = [];
  const minGap = MIN_GAP_PX * gsdM;
  for (const r of rows) for (let i = 1; i < r.length; i++) {
    const g = r[i].alongM! - r[i - 1].alongM!;
    if (g >= minGap) gaps.push(g);
  }
  if (gaps.length < MIN_GAPS) return null;
  const spacingM = shorth(gaps).centre;
  if (!(spacingM > 0)) return null;
  const agreement = gaps.filter(g => Math.abs(g - spacingM) <= 0.25 * spacingM).length / gaps.length;
  const usable = agreement >= MIN_SEED_AGREEMENT;
  let skips = 0, doubles = 0, betweenPlants = 0;
  if (usable) {
    for (const r of rows) {
      for (let i = 0; i < r.length; i++) {
        const prev = i > 0 ? r[i].alongM! - r[i - 1].alongM! : null;
        const next = i + 1 < r.length ? r[i + 1].alongM! - r[i].alongM! : null;
        if (next != null) {
          const n = Math.round(next / spacingM);
          if (n >= 2) skips += n - 1;
        }
        if (prev != null && next != null && prev < 0.6 * spacingM && next < 0.6 * spacingM
          && prev + next >= 0.7 * spacingM && prev + next <= 1.3 * spacingM) {
          r[i].cls = "between plants"; betweenPlants++;
        } else if ((prev != null && prev < 0.5 * spacingM) || (next != null && next < 0.5 * spacingM)) {
          r[i].cls = "double"; doubles++;
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
  const { gsdM, rowSpacingM } = params;
  if (!(gsdM > 0)) throw new Error("A pixel size is needed before a photo can be read.");
  if (!(rowSpacingM > 0)) throw new Error("A row spacing is needed before rows can be fitted.");
  const windowM = params.windowM ?? DEFAULT_ROW_WINDOW_M;
  const notes: string[] = [];
  const plan = planWindows(px.width, px.height, gsdM, windowM);
  const windowPx = Math.max(16, Math.round(windowM / gsdM));

  const { mask, vegetationFraction } = photoMask(px, windowPx);
  const canopyClosed = vegetationFraction >= CANOPY_CLOSED;
  if (canopyClosed) notes.push("The canopy is closed in this photo: almost every pixel is vegetation, so no plant is separate and no row can be fitted. Earlier in the season the soil shows between rows.");

  const windows: PhotoWindow[] = [];
  for (let i = 0; i < plan.length; i++) {
    const w = plan[i];
    const fit = canopyClosed
      ? { centre: { x: ((w.x0 + w.x1 + 1) / 2) * gsdM, y: -((w.y0 + w.y1 + 1) / 2) * gsdM }, sizeM: (w.x1 - w.x0 + 1) * gsdM, angleDeg: 0, pitchM: rowSpacingM, phaseM: 0, confidence: 0, angleConfidence: 0, pitchConfidence: 0, vegetationFraction, pitchFromGrower: true, recoveredPitchM: 0 }
      : fitWindow({
        mask, width: px.width, x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1, gsdM,
        originX: w.x0 * gsdM, originY: -w.y0 * gsdM, growerSpacingM: rowSpacingM,
      });
    windows.push({ index: i, ...w, fit, usable: fit.confidence >= MIN_TILE_CONFIDENCE, seed: null, onRow: 0, offRow: 0 });
    if (opts.onProgress?.(i + 1, plan.length) === false) break;
    if (opts.yieldBetweenWindows !== false) await tick();
  }

  // Second pass with the median angle as a hint, for windows that could not
  // find the direction alone: a corner of mostly soil still has a row or two.
  const usableAngles = windows.filter(w => w.usable).map(w => w.fit.angleDeg);
  const hint = median(usableAngles);
  if (hint != null && !canopyClosed) {
    for (const w of windows) {
      if (w.usable) continue;
      const fit = fitWindow({
        mask, width: px.width, x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1, gsdM,
        originX: w.x0 * gsdM, originY: -w.y0 * gsdM, growerSpacingM: rowSpacingM, angleHintDeg: hint,
      });
      if (fit.confidence >= MIN_TILE_CONFIDENCE) { w.fit = fit; w.usable = true; }
    }
    if (opts.yieldBetweenWindows !== false) await tick();
  }

  const minBlobAreaCm2 = params.minBlobAreaCm2 ?? DEFAULT_MIN_BLOB_AREA_CM2;
  const floorPx = Math.max(MIN_GAP_PX, minAreaPx(gsdM, minBlobAreaCm2));
  const measured = measureComponents(mask, px.width, px.height, floorPx);
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
    if (w && w.usable && !touchesBorder) {
      const p = placeOnRows(w.fit, x * gsdM, -y * gsdM);
      blob.rowIndex = p.rowIndex; blob.acrossM = p.acrossM; blob.alongM = p.alongM;
      const tol = Math.max(OFF_ROW_FRACTION * w.fit.pitchM, 2 * gsdM);
      if (Math.abs(p.acrossM) > tol) { blob.cls = "off-row"; w.offRow++; }
      else { blob.cls = "on pattern"; w.onRow++; }
    }
    return blob;
  });

  for (const w of windows) {
    if (!w.usable) continue;
    w.seed = fitSeeds(blobs.filter(b => b.window === w.index && (b.cls === "on pattern")), gsdM);
  }

  const usable = windows.filter(w => w.usable);
  const seeds = usable.map(w => w.seed).filter((s): s is SeedFit => !!s && s.usable);
  const count = (c: BlobClass) => blobs.filter(b => b.cls === c).length;
  const summary: PhotoSummary = {
    windows: windows.length,
    usableWindows: usable.length,
    medianAngleDeg: median(usable.map(w => w.fit.angleDeg)),
    medianPitchM: median(usable.map(w => w.fit.pitchM)),
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

  if (!canopyClosed && usable.length === 0) {
    notes.push("No window of this photo showed a row pattern the fit would trust. Either the crop is not in rows, the row spacing is wrong, the photo is too high for the rows to resolve, or the soil does not show between rows.");
  } else if (usable.length > 0 && usable.length < windows.length / 2) {
    notes.push(`Rows were trusted in ${usable.length} of ${windows.length} windows. Blobs in the other windows are shown but not placed.`);
  }
  if (usable.length > 0 && seeds.length === 0) {
    notes.push("Rows were found but no window gave a consistent spacing between plants along the row, so skips, doubles and between-plant blobs are not counted. That is normal once plants touch along the row, or when the photo is too coarse for single plants.");
  }
  if (usable.some(w => w.fit.pitchFromGrower && w.fit.confidence > 0)) {
    notes.push("At least one window measured a row spacing more than ten percent away from the one you gave. The fit kept your number; check it.");
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
