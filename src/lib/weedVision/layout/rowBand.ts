// Painting the crop row band into a raster: every row line widened to its band
// and every crop plant's disc. Shared by Stage 1 (what is off the rows) and the
// model runs that only look between the rows (the band is painted over before
// the model sees the picture). Pure.
import type { FieldRows } from "../fieldRows";

/** Fill a convex polygon (pixel coordinates, pixel centres at +0.5) into a mask. */
export function fillConvex(mask: Uint8Array, w: number, h: number, pts: [number, number][]): void {
  const ys = pts.map(p => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < pts.length; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[(k + 1) % pts.length];
      if ((ay <= yc && by >= yc) || (by <= yc && ay >= yc)) {
        const x = ay === by ? Math.min(ax, bx) : ax + ((yc - ay) / (by - ay)) * (bx - ax);
        const x2 = ay === by ? Math.max(ax, bx) : x;
        lo = Math.min(lo, x, x2); hi = Math.max(hi, x, x2);
      }
    }
    if (lo > hi) continue;
    const xa = Math.max(0, Math.ceil(lo - 0.5)), xb = Math.min(w - 1, Math.floor(hi - 0.5));
    for (let x = xa; x <= xb; x++) mask[y * w + x] = 1;
  }
}

export function fillDisc(mask: Uint8Array, w: number, h: number, cx: number, cy: number, r: number): void {
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy, span = r * r - dy * dy;
    if (span < 0) continue;
    const s = Math.sqrt(span);
    const xa = Math.max(0, Math.ceil(cx - s - 0.5)), xb = Math.min(w - 1, Math.floor(cx + s - 0.5));
    for (let x = xa; x <= xb; x++) mask[y * w + x] = 1;
  }
}

/**
 * The crop row band in a raster's pixels. The rows are in their own read frame (rows.z, rows.left, rows.top);
 * `origin` is the raster's top-left in global pixels at zoom `z`.
 */
export function rowBandMask(rows: FieldRows, z: number, originX: number, originY: number, w: number, h: number, crownMarginPx = 0): Uint8Array {
  const mask = new Uint8Array(w * h);
  const f = 2 ** (z - rows.z);
  const tx = (x: number) => (rows.left + x) * f - originX, ty = (y: number) => (rows.top + y) * f - originY;
  for (const l of rows.ctx.lines) {
    const b = (l.band ?? rows.ctx.bandPx) * f;
    const x1 = tx(l.x1), y1 = ty(l.y1), x2 = tx(l.x2), y2 = ty(l.y2);
    if (Math.max(x1, x2) + b < 0 || Math.min(x1, x2) - b > w || Math.max(y1, y2) + b < 0 || Math.min(y1, y2) - b > h) continue;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len > 0) {
      const nx = (-(y2 - y1) / len) * b, ny = ((x2 - x1) / len) * b;
      fillConvex(mask, w, h, [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]]);
    }
    fillDisc(mask, w, h, x1, y1, b);
    fillDisc(mask, w, h, x2, y2, b);
  }
  for (const c of rows.ctx.crops) {
    const cx = tx(c.x), cy = ty(c.y), r = (c.r + crownMarginPx) * f;
    if (cx + r < 0 || cx - r > w || cy + r < 0 || cy - r > h) continue;
    fillDisc(mask, w, h, cx, cy, r);
  }
  return mask;
}

/**
 * Paint the crop row band over a picture with the picture's own bare-ground colour (the median of its non-green
 * pixels), so a model run on it sees only what grows between the rows. Returns how many pixels were painted.
 */
export function paintRowBand(rgba: Uint8ClampedArray, w: number, h: number, band: Uint8Array): number {
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let i = 0, k = 0; i < w * h; i += 7, k++) {
    if (band[i]) continue;
    const o = i * 4, r = rgba[o], g = rgba[o + 1], b = rgba[o + 2], s = r + g + b;
    if (rgba[o + 3] === 0 || (s > 0 && (2 * g - r - b) / s > 0.05)) continue;
    rs.push(r); gs.push(g); bs.push(b);
  }
  const med = (v: number[]) => { if (!v.length) return 128; v.sort((a, b) => a - b); return v[v.length >> 1]; };
  const R = med(rs), G = med(gs), B = med(bs);
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!band[i]) continue;
    const o = i * 4;
    if (rgba[o + 3] === 0) continue;
    rgba[o] = R; rgba[o + 1] = G; rgba[o + 2] = B;
    n++;
  }
  return n;
}

/**
 * A short signature of the rows a result was computed with: a result painted around one set of rows must not be
 * handed back for another (the rows change when the layout is refitted, re-marked, or the fitter improves).
 */
export function rowsSignature(rows: FieldRows): string {
  let h = 2166136261;
  const mix = (v: number) => { h ^= Math.round(v * 10) & 0xffffffff; h = Math.imul(h, 16777619) >>> 0; };
  mix(rows.ctx.lines.length); mix(rows.ctx.crops.length); mix(rows.ctx.bandPx);
  for (const l of rows.ctx.lines) { mix(l.x1); mix(l.y1); mix(l.x2); mix(l.y2); }
  for (const c of rows.ctx.crops) { mix(c.x); mix(c.y); mix(c.r); }
  return h.toString(36);
}

/** A painter for a model's picture: the crop row band painted over, so the model looks only between the rows. */
export type ChunkPainter = (rgba: Uint8ClampedArray, w: number, h: number, originX: number, originY: number, z: number) => void;
/**
 * Each crop plant's crown is painted this much wider than measured: painted at the row band alone, the rims of crowns
 * wider than the band were left as green crescents the model called weeds (DJI_0301: 114 detections 1 to 1.6 m from a
 * tree centre against 33 unpainted, 2026-10-19).
 */
export const PAINT_CROWN_MARGIN_M = 0.3;
export function betweenRowsPainter(rows: FieldRows): ChunkPainter {
  const margin = PAINT_CROWN_MARGIN_M / rows.mpp;
  return (rgba, w, h, originX, originY, z) => { paintRowBand(rgba, w, h, rowBandMask(rows, z, originX, originY, w, h, margin)); };
}
