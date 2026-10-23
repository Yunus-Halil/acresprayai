// Continuous crop rows (corn, and any crop whose profile reads rows this way) for the weed-pressure grade, Stage 1
// and the hotspots: the field-map pattern pass with the crop's profile, put into the FieldRows shape those read.
//
// The tree reader (fieldRows.ts) finds rows by chaining separate plants at least a metre apart, so it never reads a
// row crop. The pattern pass (weedScout/fieldPattern.ts over photoScout/pattern.ts) reads rows as periodic green
// stripes, which is the method with the best evidence on whole-field drone maps of row crops
// (docs/research/crops/row-reading-approaches.md); with a crop profile it searches the crop's planted spacings,
// gates the green with ExGR and only stands on a measured pitch (src/lib/cropProfiles). This module adds nothing to
// how rows are found: it reads the field with that pass and converts the settled row lines to frame pixels with the
// crop's row band.
//
// Rows from here are "pattern" rows. The grade uses them only after the operator has looked at them on the map and
// confirmed them (frameRunStore confirmFieldRows): a wrong spacing is a wrong grade.
import type { LatLng2 } from "../geo";
import type { RasterSource } from "../cellFeatures";
import { cropProfileFor } from "../cropProfiles/registry";
import { patternPriorFor } from "../cropProfiles/engine";
import type { PhotoParams, PhotoPattern } from "../photoScout/pattern";
import { type FieldPattern, type PatternWindow, planPatternWindows, readFieldPattern } from "../weedScout/fieldPattern";
import type { FieldRows } from "./fieldRows";
import { mercatorPx } from "./mapRun";

/** Half-width of the crop band either side of a row line when the profile gives none, metres (rowFilter.ts ROW_BAND_MIN_M). */
export const DEFAULT_PATTERN_BAND_M = 0.15;
export const PATTERN_ROWS_VERSION = 1;

/** Whether a crop's rows are read with the pattern pass: its profile reads continuous rows. */
export function readsPatternRows(crop: string | null | undefined): boolean {
  return cropProfileFor(crop)?.rowReader.strategy === "continuous-row";
}

/**
 * The pattern's settled row lines in a FieldRows frame at the pattern's zoom, with the crop band. Null when the
 * pattern found no rows. The frame's origin is the field's north-west corner.
 */
export function fieldRowsFromPattern(fp: FieldPattern, bandHalfWidthM: number = DEFAULT_PATTERN_BAND_M): (FieldRows & { source: "pattern" }) | null {
  if (!fp.summary.blocks || !fp.lines.length || !(fp.gsdM > 0)) return null;
  const z = fp.z, mpp = fp.gsdM;
  const [X0, Y0] = mercatorPx(fp.origin.lat, fp.origin.lng, z);
  const left = Math.floor(X0), top = Math.floor(Y0);
  const px = (p: LatLng2) => { const [X, Y] = mercatorPx(p.lat, p.lng, z); return { x: X - left, y: Y - top }; };
  const bandPx = bandHalfWidthM / mpp;
  const lines = fp.lines.map(l => { const a = px(l.points[0]), b = px(l.points[1]); return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, band: bandPx }; });
  const spacingM = fp.summary.rowSpacingM ?? 0;
  return {
    z, left, top, mpp,
    ctx: { lines, crops: [], bandPx, gsdM: mpp },
    rows: distinctRows(lines, spacingM / mpp),
    spacingM,
    seedSpacingM: fp.summary.plantSpacingM ?? 0,
    directionDeg: fp.summary.bearingDeg ?? 0,
    blocks: fp.summary.blocks,
    source: "pattern",
  };
}

/**
 * Rows, not line pieces: a row crossing several pattern windows comes back as one piece per window. Pieces are
 * grouped by where they sit across the main direction, a new row wherever the gap exceeds half a spacing.
 */
export function distinctRows(lines: { x1: number; y1: number; x2: number; y2: number }[], spacingPx: number): number {
  if (!lines.length) return 0;
  // The main direction: a length-weighted mean of the doubled angles.
  let c = 0, s = 0;
  for (const l of lines) { const dx = l.x2 - l.x1, dy = l.y2 - l.y1, len = Math.hypot(dx, dy), t = 2 * Math.atan2(dy, dx); c += len * Math.cos(t); s += len * Math.sin(t); }
  const th = Math.atan2(s, c) / 2, nx = -Math.sin(th), ny = Math.cos(th);
  const across = lines.map(l => ((l.x1 + l.x2) / 2) * nx + ((l.y1 + l.y2) / 2) * ny).sort((a, b) => a - b);
  if (!(spacingPx > 0)) return across.length;
  let rows = 1;
  for (let i = 1; i < across.length; i++) if (across[i] - across[i - 1] > spacingPx / 2) rows++;
  return rows;
}

const boundsOf = (rings: LatLng2[][]) => {
  const pts = rings.flat();
  return { north: Math.max(...pts.map(p => p.lat)), south: Math.min(...pts.map(p => p.lat)), east: Math.max(...pts.map(p => p.lng)), west: Math.min(...pts.map(p => p.lng)) };
};

/**
 * Read the field's continuous rows with the crop's profile. Null when the crop has no profile that reads continuous
 * rows, or the pattern found none. `fetch` and `analyse` are injectable so a stand-in map can be read headless.
 */
export async function readPatternRows(input: {
  rings: LatLng2[][]; tile: (z: number, x: number, y: number) => string; maxNative: number; crop: string | null;
  onProgress?: (fraction: number) => void; signal?: AbortSignal;
  /** Read the map at about this pixel, metres; absent: the crop profile's own, else the pattern pass's 5 cm. */
  targetGsdM?: number;
  fetch?: (win: PatternWindow, z: number) => Promise<{ raster: RasterSource; missingTiles: number }>;
  analyse?: (px: RasterSource, params: PhotoParams) => Promise<PhotoPattern>;
}): Promise<{ rows: (FieldRows & { source: "pattern" }) | null; pattern: FieldPattern | null }> {
  const profile = cropProfileFor(input.crop);
  if (!profile || profile.rowReader.strategy !== "continuous-row" || !input.rings.length) return { rows: null, pattern: null };
  const bbox = boundsOf(input.rings);
  const target = input.targetGsdM ?? (profile.rowReader.readGsdCm != null ? profile.rowReader.readGsdCm / 100 : undefined);
  const plan = planPatternWindows(bbox, input.rings, input.maxNative, target ? { targetGsdM: target } : {});
  const pattern = await readFieldPattern(input.tile, plan, { lat: bbox.north, lng: bbox.west }, {
    rowSpacingM: "auto", prior: patternPriorFor(profile), signal: input.signal,
    onProgress: (i, n) => input.onProgress?.(n ? i / n : 0),
    ...(input.fetch ? { fetch: input.fetch } : {}), ...(input.analyse ? { analyse: input.analyse } : {}),
  });
  return { rows: fieldRowsFromPattern(pattern, profile.rowReader.bandHalfWidthM ?? DEFAULT_PATTERN_BAND_M), pattern };
}
