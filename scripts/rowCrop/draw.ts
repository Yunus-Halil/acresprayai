// Drawing a row-crop read over its photograph (shared by the stage bench and the adaptive bench): the same colours
// everywhere so a picture from either bench reads the same way.
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { rowCropOverlay, type RowCropRead } from "../../src/lib/rowCrop/readRowCrop";

export type Rgb = [number, number, number];
export type Canvas = { w: number; h: number; c: Uint8Array };

export function canvasOf(img: PhotoPixels, dim = 0.85): Canvas {
  const { width: w, height: h } = img;
  const c = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { c[i * 4] = img.rgba[i * 4] * dim; c[i * 4 + 1] = img.rgba[i * 4 + 1] * dim; c[i * 4 + 2] = img.rgba[i * 4 + 2] * dim; c[i * 4 + 3] = 255; }
  return { w, h, c };
}

export function line(cv: Canvas, x1: number, y1: number, x2: number, y2: number, col: Rgb, t = 1) {
  const { c, w, h } = cv;
  const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  for (let k = 0; k <= n; k++) { const x = x1 + ((x2 - x1) * k) / n, y = y1 + ((y2 - y1) * k) / n; for (let dy = -t; dy <= t; dy++) for (let dx = -t; dx <= t; dx++) { const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const o = (yy * w + xx) * 4; c[o] = col[0]; c[o + 1] = col[1]; c[o + 2] = col[2]; } }
}

export function poly(cv: Canvas, pts: [number, number][], col: Rgb, t: number, closed: boolean) {
  for (let i = 0; i + 1 < pts.length; i++) line(cv, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], col, t);
  if (closed && pts.length > 2) line(cv, pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], col, t);
}

export function dashed(cv: Canvas, x1: number, y1: number, x2: number, y2: number, col: Rgb, t: number, dash: number) {
  const L = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.floor(L / dash));
  for (let k = 0; k < n; k += 2) { const a = k / n, b = Math.min(1, (k + 1) / n); line(cv, x1 + (x2 - x1) * a, y1 + (y2 - y1) * a, x1 + (x2 - x1) * b, y1 + (y2 - y1) * b, col, t); }
}

export function ring(cv: Canvas, x: number, y: number, r: number, col: Rgb, t: number) {
  for (let k = 0; k < 48; k++) { const a = (k / 48) * 2 * Math.PI, a2 = ((k + 1) / 48) * 2 * Math.PI; line(cv, x + r * Math.cos(a), y + r * Math.sin(a), x + r * Math.cos(a2), y + r * Math.sin(a2), col, t); }
}

/** Tint a rectangle (photo pixels) toward a colour. */
export function tint(cv: Canvas, x0: number, y0: number, x1: number, y1: number, col: Rgb, mix: number) {
  const { c, w, h } = cv;
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(h, Math.round(y1)); y++) for (let x = Math.max(0, Math.round(x0)); x < Math.min(w, Math.round(x1)); x++) { const o = (y * w + x) * 4; c[o] = c[o] * (1 - mix) + col[0] * mix; c[o + 1] = c[o + 1] * (1 - mix) + col[1] * mix; c[o + 2] = c[o + 2] * (1 - mix) + col[2] * mix; }
}

/**
 * One read drawn: bands pale blue, rows cyan, gaps orange, excluded grey, field edges white, mid seedlings amber rings,
 * emergence possible/missing/uncertain blue/orange/grey rings, small green thin grey, weeds red, escapes magenta,
 * plants green dots. `weedFilter` leaves out weeds drawn by the caller in another colour.
 */
export function drawRead(cv: Canvas, read: RowCropRead, weedFilter?: (hull: [number, number][]) => boolean) {
  const { w } = cv;
  const o = rowCropOverlay(read), t = Math.max(1, Math.round(w / 1800));
  for (const b of o.bands) poly(cv, b, [120, 200, 255], 0, false);
  for (const r of o.rows) poly(cv, r, [0, 230, 255], t, false);
  for (const g of o.gaps) line(cv, g.x1, g.y1, g.x2, g.y2, [255, 160, 0], t + 1);
  for (const e of o.excluded) poly(cv, e, [160, 160, 160], t, true);
  for (const e of o.fieldEdges) poly(cv, e, [255, 255, 255], t + 1, false);
  const ringR = Math.max(6, Math.round(0.025 / read.gsdM));
  for (const [x, y] of o.seedlings) ring(cv, x, y, ringR, [255, 190, 0], Math.max(1, t - 1));
  for (const [x, y] of o.possible) ring(cv, x, y, ringR, [60, 140, 255], t);
  for (const [x, y] of o.missing) ring(cv, x, y, ringR, [255, 150, 0], t);
  for (const [x, y] of o.uncertain) ring(cv, x, y, ringR, [170, 170, 170], t);
  for (const wd of o.smallGreen) poly(cv, wd, [175, 175, 175], Math.max(0, t - 1), true);
  for (const wd of o.weeds) if (!weedFilter || weedFilter(wd)) poly(cv, wd, [255, 40, 40], t, true);
  for (const wd of o.escapes) poly(cv, wd, [255, 0, 200], t + 2, true);
  for (const [x, y] of o.plants) line(cv, x, y, x, y, [60, 255, 90], t);
}
