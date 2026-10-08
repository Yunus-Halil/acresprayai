// The planting pattern drawn on the original photo.
//
// Two ways in. During the run, the photo pass reads each photo whole and
// keeps, for every spot whose best photo it is, a PhotoLook: the lines and
// circles in a window around the spot, in the original's own pixels, so
// the closer look opens on it with nothing left to compute. When a spot has
// no look (the photos were not read, or that photo was over the budget) the
// closer look reads the whole photo itself, once, and builds the same look.
// A cut of a few row spacings is not enough: the pass needs several rows
// in view to trust a fit, so it is always the whole photo that is read.
//
// When a spot's photo opens, the operator should see what the pass saw: the
// rows as lines, every plant as a circle coloured by what it is (crop on the
// pattern, a double, a weed between plants, a weed off the row), not a box.
// The photo is cut wide enough around the spot for rows to fit (several row
// spacings), read by the same pass at native resolution with the field's
// own spacing when the scan knows it, and the result is turned into lines
// and circles in the crop's pixels. Pure where it can be: the overlay from a
// pattern is a function; only the cut touches the canvas.
import { type BlobClass, type PhotoPattern, type PhotoPixels, rowSegmentsPx } from "../photoScout/pattern";
import type { AreaWindow } from "./crop";

/** Rows to show around a spot, in row spacings; never under PATTERN_LOOK_MIN_M a side. Three: the spot is the subject, its neighbours the context. */
export const PATTERN_LOOK_ROWS = 3;
export const PATTERN_LOOK_MIN_M = 8;
export const PATTERN_LOOK_MAX_M = 24;
/** The spot's own blob is the placed blob nearest the spot within this many metres. */
export const FOCUS_REACH_M = 1.5;
/** The crop is read at or under this many pixels a side; a wider cut is pooled down. */
export const PATTERN_LOOK_MAX_EDGE = 2400;

export const BLOB_COLOUR: Record<BlobClass, string> = {
  "on pattern": "#4CAF50",
  "double": "#26c6da",
  "between plants": "#ffa726",
  "off-row": "#ef5350",
  "unplaced": "#9e9e9e",
};
export const ROW_COLOUR = "#ffeb3b";

export type PatternCut = {
  /** Object URL of the cut, JPEG; revoke when done. */
  url: string;
  /** The cut's pixels at the resolution the pass reads, after pooling. */
  pixels: PhotoPixels;
  /** The cut in native pixels. */
  window: AreaWindow;
  /** Native pixels per pooled pixel. */
  factor: number;
  /** Ground metres per pooled pixel. */
  gsdM: number;
  width: number;
  height: number;
};

/** The side of the cut, metres, from the row spacing when known. */
export function patternLookSideM(rowSpacingM: number | null | undefined): number {
  const want = rowSpacingM && rowSpacingM > 0 ? PATTERN_LOOK_ROWS * rowSpacingM : PATTERN_LOOK_MIN_M;
  return Math.min(PATTERN_LOOK_MAX_M, Math.max(PATTERN_LOOK_MIN_M, want));
}

/**
 * Browser only. Cut a square of `sideM` around a native pixel, pooled by an
 * integer factor so the longer side is at most PATTERN_LOOK_MAX_EDGE, and
 * hand back its pixels and a JPEG of them.
 */
export async function cutPatternWindow(frame: Blob, centreNative: { x: number; y: number }, sideM: number, nativeGsdM: number): Promise<PatternCut | null> {
  if (typeof document === "undefined") return null;
  const bitmap = await createImageBitmap(frame).catch(() => null);
  if (!bitmap) return null;
  try {
    const sidePx = Math.round(sideM / nativeGsdM);
    const x0 = Math.max(0, Math.min(bitmap.width - 1, Math.round(centreNative.x - sidePx / 2)));
    const y0 = Math.max(0, Math.min(bitmap.height - 1, Math.round(centreNative.y - sidePx / 2)));
    const x1 = Math.min(bitmap.width, x0 + sidePx), y1 = Math.min(bitmap.height, y0 + sidePx);
    const window: AreaWindow = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    if (window.width < 16 || window.height < 16) return null;
    const factor = Math.max(1, Math.ceil(Math.max(window.width, window.height) / PATTERN_LOOK_MAX_EDGE));
    const width = Math.floor(window.width / factor), height = Math.floor(window.height / factor);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, window.x, window.y, width * factor, height * factor, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/jpeg", 0.92));
    if (!blob) return null;
    return { url: URL.createObjectURL(blob), pixels: { width, height, rgba: data }, window, factor, gsdM: nativeGsdM * factor, width, height };
  } finally {
    bitmap.close?.();
  }
}

export type OverlayLine = { x1: number; y1: number; x2: number; y2: number; block: number | null };
export type OverlayCircle = { x: number; y: number; r: number; cls: BlobClass };
export type PatternOverlay = {
  lines: OverlayLine[];
  circles: OverlayCircle[];
  /** The spot itself: the placed blob nearest the focus, or a ring at the focus when none is near. Null without a focus. */
  focus: (OverlayCircle & { matched: boolean }) | null;
  blocks: number; usable: number; windows: number;
};

/** Liang-Barsky, for one window's rectangle. */
function clip(x1: number, y1: number, x2: number, y2: number, r: { x0: number; y0: number; x1: number; y1: number }): [number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const checks: [number, number][] = [[-dx, x1 - r.x0], [dx, r.x1 - x1], [-dy, y1 - r.y0], [dy, r.y1 - y1]];
  for (const [p, q] of checks) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [t0, t1];
}

/**
 * The pattern as lines and circles in the pixels it was read on: each block's
 * rows run across the union of the block's windows; every placed blob is a
 * circle of its own size in its class's colour.
 */
export function overlayFromPattern(pattern: PhotoPattern, focusPx: { x: number; y: number; diameterM?: number | null } | null = null): PatternOverlay {
  const lines: OverlayLine[] = [];
  const byBlock = new Map<number, typeof pattern.windows>();
  for (const w of pattern.windows) {
    if (!w.usable || w.block == null) continue;
    (byBlock.get(w.block) ?? byBlock.set(w.block, []).get(w.block)!).push(w);
  }
  for (const [block, windows] of byBlock) {
    const rects = windows.map(w => ({ x0: w.x0, y0: w.y0, x1: w.x1 + 1, y1: w.y1 + 1 }));
    for (const seg of rowSegmentsPx(windows[0], pattern.gsdM)) {
      let tMin = Infinity, tMax = -Infinity;
      for (const r of rects) {
        const t = clip(seg.x1, seg.y1, seg.x2, seg.y2, r);
        if (t) { tMin = Math.min(tMin, t[0]); tMax = Math.max(tMax, t[1]); }
      }
      if (!(tMin < tMax)) continue;
      lines.push({
        x1: seg.x1 + (seg.x2 - seg.x1) * tMin, y1: seg.y1 + (seg.y2 - seg.y1) * tMin,
        x2: seg.x1 + (seg.x2 - seg.x1) * tMax, y2: seg.y1 + (seg.y2 - seg.y1) * tMax, block,
      });
    }
  }
  const circles: OverlayCircle[] = pattern.blobs
    .filter(b => b.cls !== "unplaced")
    .map(b => ({ x: b.x, y: b.y, r: Math.max(3, b.equivDiameterM / pattern.gsdM / 2), cls: b.cls }));
  // The spot: the nearest placed blob within reach, else a ring where the map put it.
  let focus: PatternOverlay["focus"] = null;
  if (focusPx) {
    const reach = FOCUS_REACH_M / pattern.gsdM;
    let best: OverlayCircle | null = null, bestD = Infinity;
    for (const c of circles) {
      const d = Math.hypot(c.x - focusPx.x, c.y - focusPx.y);
      if (d <= reach && d < bestD) { bestD = d; best = c; }
    }
    focus = best
      ? { ...best, matched: true }
      : { x: focusPx.x, y: focusPx.y, r: Math.max(6, ((focusPx.diameterM ?? 0.3) / pattern.gsdM) / 2), cls: "off-row", matched: false };
  }
  return { lines, circles, focus, blocks: pattern.summary.blocks, usable: pattern.summary.usableWindows, windows: pattern.summary.windows };
}

/** What the overlay means, in a line. */
export function overlayLegend(o: PatternOverlay, pattern: PhotoPattern): string {
  const n = (cls: BlobClass) => pattern.blobs.filter(b => b.cls === cls).length;
  const spot = o.focus ? (o.focus.matched ? `The white ring is this spot, read here as ${o.focus.cls}. ` : "The white ring is where the map put this spot; the pass placed no plant there. ") : "";
  if (o.blocks === 0) return spot + "No row pattern was read in this part of the photo.";
  return spot + `Around it: ${n("on pattern")} crop plants on the pattern (green), ${n("between plants")} between plants (orange), ${n("off-row")} off the rows (red)${n("double") ? `, ${n("double")} doubles (blue)` : ""}, in ${o.blocks} planting${o.blocks === 1 ? "" : "s"}.`;
}

/** A rectangle in a photo's pixels. */
export type LookWindow = { x: number; y: number; width: number; height: number };

/** What the pass saw around a spot in one photo, in that photo's original pixels. */
export type PhotoLook = {
  filename: string;
  /** The cut around the spot, in the original photo's pixels. */
  window: LookWindow;
  /** Ground metres per original pixel. */
  gsdM: number;
  /** Lines, circles and the spot, in the window's pixels (origin at its corner). */
  lines: OverlayLine[];
  circles: OverlayCircle[];
  focus: PatternOverlay["focus"];
  /** Row blocks the pass read in the whole photo. */
  blocks: number;
  /** Placed blobs inside the window, by class. */
  counts: { onPattern: number; between: number; offRow: number; doubles: number };
};

/**
 * The look around a spot, from a whole photo's pattern: a square of `sideM`
 * around the spot (clamped to the photo), the rows clipped to it, the
 * circles inside it, everything carried to the original's pixels by
 * `nativeScale` (original pixels per pixel the pattern was read on). Pure.
 */
export function lookFromPattern(
  pattern: PhotoPattern, focusPx: { x: number; y: number; diameterM?: number | null },
  opts: { filename: string; sideM: number; nativeScale: number },
): PhotoLook {
  const o = overlayFromPattern(pattern, focusPx);
  const s = opts.nativeScale;
  const side = Math.max(16, Math.round(opts.sideM / pattern.gsdM));
  const w = Math.min(side, pattern.width), h = Math.min(side, pattern.height);
  const x0 = Math.round(Math.min(Math.max(0, focusPx.x - w / 2), pattern.width - w));
  const y0 = Math.round(Math.min(Math.max(0, focusPx.y - h / 2), pattern.height - h));
  const rect = { x0, y0, x1: x0 + w, y1: y0 + h };
  const lines: OverlayLine[] = [];
  for (const l of o.lines) {
    const t = clip(l.x1, l.y1, l.x2, l.y2, rect);
    if (!t || !(t[1] - t[0] > 1e-6)) continue;
    const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
    lines.push({ x1: (l.x1 + dx * t[0] - x0) * s, y1: (l.y1 + dy * t[0] - y0) * s, x2: (l.x1 + dx * t[1] - x0) * s, y2: (l.y1 + dy * t[1] - y0) * s, block: l.block });
  }
  const inside = (c: OverlayCircle) => c.x + c.r >= rect.x0 && c.x - c.r <= rect.x1 && c.y + c.r >= rect.y0 && c.y - c.r <= rect.y1;
  const move = <T extends OverlayCircle>(c: T): T => ({ ...c, x: (c.x - x0) * s, y: (c.y - y0) * s, r: c.r * s });
  const circles = o.circles.filter(inside).map(move);
  const counts = { onPattern: 0, between: 0, offRow: 0, doubles: 0 };
  for (const c of circles) {
    if (c.cls === "on pattern") counts.onPattern++;
    else if (c.cls === "between plants") counts.between++;
    else if (c.cls === "off-row") counts.offRow++;
    else if (c.cls === "double") counts.doubles++;
  }
  return {
    filename: opts.filename,
    window: { x: Math.round(x0 * s), y: Math.round(y0 * s), width: Math.round(w * s), height: Math.round(h * s) },
    gsdM: pattern.gsdM / s,
    lines, circles, focus: o.focus ? move(o.focus) : null, blocks: o.blocks, counts,
  };
}

/** What a look means, in a line. */
export function lookLegend(look: PhotoLook): string {
  const spot = look.focus
    ? (look.focus.matched ? `The white ring is this spot, read here as ${look.focus.cls}. ` : "The white ring is where the map put this spot; the pass placed no plant there. ")
    : "";
  if (look.blocks === 0) return spot + "No row pattern was read in this photo.";
  if (look.lines.length === 0) return spot + "The rows the pass read in this photo do not run through this cut.";
  const c = look.counts;
  return spot + `Around it: ${c.onPattern} crop plants on the pattern (green), ${c.between} between plants (orange), ${c.offRow} off the rows (red)${c.doubles ? `, ${c.doubles} doubles (blue)` : ""}.`;
}

export type LookCut = { url: string; width: number; height: number; factor: number };

/** Browser only. A look's window cut from the original, pooled so the longer side is at most PATTERN_LOOK_MAX_EDGE. */
export async function cutLookWindow(frame: Blob, window: LookWindow): Promise<LookCut | null> {
  if (typeof document === "undefined") return null;
  const bitmap = await createImageBitmap(frame).catch(() => null);
  if (!bitmap) return null;
  try {
    const x0 = Math.max(0, Math.min(bitmap.width - 1, window.x)), y0 = Math.max(0, Math.min(bitmap.height - 1, window.y));
    const w = Math.min(bitmap.width - x0, window.width), h = Math.min(bitmap.height - y0, window.height);
    if (w < 16 || h < 16) return null;
    const factor = Math.max(1, Math.ceil(Math.max(w, h) / PATTERN_LOOK_MAX_EDGE));
    const width = Math.floor(w / factor), height = Math.floor(h / factor);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, x0, y0, width * factor, height * factor, 0, 0, width, height);
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/jpeg", 0.92));
    if (!blob) return null;
    return { url: URL.createObjectURL(blob), width, height, factor };
  } finally {
    bitmap.close?.();
  }
}
