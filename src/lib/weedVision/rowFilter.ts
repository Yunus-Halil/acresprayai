// The planting pattern as a filter on a model's weeds.
//
// The photo pass (lib/photoScout) reads a photograph's rows and places every
// plant on them: on the pattern, a double, between plants, off the row, or
// unplaced where no rows were trusted. A model weed whose centre sits on one of
// those crop plants, or on a row line, is almost always the crop itself (in an
// orchard, a tree), so it is kept but set aside as "on the row", and only the
// weeds off the rows are shown by default. Pure: pixels in, a status out.
import type { PhotoPattern } from "../photoScout/pattern";
import { overlayFromPattern } from "../sourceFrames/patternLook";

export type RowStatus =
  | "off-row"   // not on a crop plant and not on a row line: a weed candidate
  | "on-crop"   // its centre lies inside a plant the pattern placed on a row
  | "on-row"    // its centre lies on a row line, within the crop canopy band
  | "no-rows";  // the photo has no row read, so nothing can be said

/** The pattern of one photograph in that photograph's ORIGINAL pixels. */
export type RowContext = {
  /** Row lines, native px. */
  /** Row lines, native px; a line may carry its own band half-width (a second planting in the field). */
  lines: { x1: number; y1: number; x2: number; y2: number; band?: number }[];
  /** Plants the pattern placed on rows (on pattern, double, between plants), native px. */
  crops: { x: number; y: number; r: number; /** Layout plants: what the evidence says (layout/plantingLayout.ts). */ state?: "confirmed" | "probable" | "ambiguous" | "operator"; /** The canopy merged with other green: its extent is the planting's typical one, not measured. */ uncertain?: boolean }[];
  /** Half-width of the row band, native px: the crop canopy's typical radius, never under ROW_BAND_MIN_M. */
  bandPx: number;
  /** Ground metres per native pixel. */
  gsdM: number;
};

export const ROW_BAND_MIN_M = 0.15;
/** The band's half-width is at least this share of the row spacing: under a 0.76 m row crop it never binds (11 cm). */
export const ROW_BAND_PITCH_SHARE = 0.15;
const ROW_CLASSES = new Set(["on pattern", "double", "between plants"]);

/** The context from a whole-photo pattern read on `nativeScale` times smaller pixels; null when no rows were read. */
export function rowContextFromPattern(pattern: PhotoPattern, nativeScale: number): RowContext | null {
  if (!pattern.summary?.blocks) return null;
  const o = overlayFromPattern(pattern, null);
  const s = nativeScale;
  const lines = o.lines.map(l => ({ x1: l.x1 * s, y1: l.y1 * s, x2: l.x2 * s, y2: l.y2 * s }));
  const crops = o.circles.filter(c => ROW_CLASSES.has(c.cls)).map(c => ({ x: c.x * s, y: c.y * s, r: c.r * s }));
  if (!lines.length && !crops.length) return null;
  const gsdM = pattern.gsdM / s;
  const radii = crops.map(c => c.r).sort((a, b) => a - b);
  const medianR = radii.length ? radii[Math.floor(radii.length / 2)] : 0;
  // Everything on a row line is the crop: the band is at least the typical crop plant's radius, and on wide
  // rows (an orchard's trees, a vineyard) at least ROW_BAND_PITCH_SHARE of the row spacing, which a plant's
  // own outline can understate when its canopy is open.
  const pitchM = pattern.summary?.medianPitchM;
  const widePx = pitchM && pitchM > 0 ? (ROW_BAND_PITCH_SHARE * pitchM) / gsdM : 0;
  const bandPx = Math.max(ROW_BAND_MIN_M / gsdM, medianR, widePx);
  return { lines, crops, bandPx, gsdM };
}

function distToSegment(px: number, py: number, l: { x1: number; y1: number; x2: number; y2: number }): number {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - l.x1) * dx + (py - l.y1) * dy) / len2)) : 0;
  return Math.hypot(px - (l.x1 + t * dx), py - (l.y1 + t * dy));
}

/** Where a detection with its centre at (cx, cy) native px stands against the rows. */
export function rowStatusOf(ctx: RowContext | null, cx: number, cy: number): RowStatus {
  if (!ctx) return "no-rows";
  for (const c of ctx.crops) {
    if (Math.hypot(cx - c.x, cy - c.y) <= c.r) return "on-crop";
  }
  for (const l of ctx.lines) {
    if (distToSegment(cx, cy, l) <= (l.band ?? ctx.bandPx)) return "on-row";
  }
  return "off-row";
}

/** True for the statuses hidden by default: the plant is most likely the crop. */
export const isOnRow = (s: RowStatus | undefined | null): boolean => s === "on-crop" || s === "on-row";
