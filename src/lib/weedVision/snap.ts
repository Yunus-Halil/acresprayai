// Every outline snapped onto its weed on the map, all the time, without
// stalling the map.
//
// However an outline was placed (a photograph's pose and alignment, or the
// map read directly), what the operator judges it against is the green on the
// orthomosaic under it. So each outline is matched against that green right
// around it: the outline's own shape is slid over the map within a small
// radius, and the shift where the shape sits on green with bare ground just
// outside it wins. Inside-minus-ring is the test, not "most green", so an
// outline beside a tree is not pulled into the tree (all green inside and
// all green around scores nothing). A shift is kept only when it clearly
// beats where the outline already is; otherwise the outline stays.
//
// The work runs in small slices between frames, the outlines in view first,
// then the rest; the map tiles come through the tile cache and are decoded
// once. Only the shift is stored, never a new outline: the model's shape is
// kept, it is moved onto its weed.
import type { LatLng2 } from "../geo";
import { fetchTileCached } from "../tileCache";
import { TILE_PX, latLngOfPx, mercatorPx, metresPerPixel } from "./mapRun";

/** How far an outline may move: placed through a photograph, or read off the map itself. */
export const SNAP_MAX_FROM_PHOTO_M = 0.6;
export const SNAP_MAX_FROM_MAP_M = 0.12;
/** The finest pixel used: the map's own at zoom 23 is about 1.5 cm. */
export const SNAP_MPP_MIN = 0.012;
/** A shift is kept when its score is at least this... */
export const MIN_SNAP_SCORE = 0.3;
/** ...and beats the outline's place by at least this. */
export const MIN_SNAP_GAIN = 0.05;
/** The score pays this much for moving the whole radius: of two equal matches the nearer wins. */
export const SNAP_DISTANCE_COST = 0.1;

export type Snap = { dLat: number; dLng: number; score: number; shiftM: number };

/** Pixel lists of a template: inside the outline, and a ring just outside it, as window coordinates. */
export type Template = { inside: Int32Array; ring: Int32Array };

/** The outline filled on a w x h grid (even-odd scanline) and a ring `d` pixels wide around it. */
export function templateOf(poly: [number, number][], w: number, h: number, d: number): Template {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const yc = y + 0.5, xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[j];
      if ((y1 > yc) !== (y2 > yc)) xs.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(w - 1, Math.floor(xs[k + 1] - 0.5)); x++) mask[y * w + x] = 1;
    }
  }
  // The ring: everything within d pixels (8-neighbour steps) of the inside, by a two-pass distance, minus the inside.
  const dist = new Int32Array(w * h);
  const BIG = 1 << 20;
  for (let i = 0; i < w * h; i++) dist[i] = mask[i] ? 0 : BIG;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let v = dist[i];
    if (x > 0) v = Math.min(v, dist[i - 1] + 1);
    if (y > 0) { v = Math.min(v, dist[i - w] + 1); if (x > 0) v = Math.min(v, dist[i - w - 1] + 1); if (x < w - 1) v = Math.min(v, dist[i - w + 1] + 1); }
    dist[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; let v = dist[i];
    if (x < w - 1) v = Math.min(v, dist[i + 1] + 1);
    if (y < h - 1) { v = Math.min(v, dist[i + w] + 1); if (x < w - 1) v = Math.min(v, dist[i + w + 1] + 1); if (x > 0) v = Math.min(v, dist[i + w - 1] + 1); }
    dist[i] = v;
  }
  const inside: number[] = [], ring: number[] = [];
  for (let i = 0; i < w * h; i++) { if (mask[i]) inside.push(i); else if (dist[i] <= d) ring.push(i); }
  return { inside: Int32Array.from(inside), ring: Int32Array.from(ring) };
}

/** Inside-minus-ring green at a shift, every `stride`-th pixel; null when the shifted template leaves the window. */
function scoreAt(green: Uint8Array, w: number, h: number, t: Template, sx: number, sy: number, stride = 1): number | null {
  let gi = 0, gr = 0, ni = 0, nr = 0;
  for (let k = 0; k < t.inside.length; k += stride) {
    const i = t.inside[k], x = (i % w) + sx, y = ((i / w) | 0) + sy;
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    gi += green[y * w + x]; ni++;
  }
  for (let k = 0; k < t.ring.length; k += stride) {
    const i = t.ring[k], x = (i % w) + sx, y = ((i / w) | 0) + sy;
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    gr += green[y * w + x]; nr++;
  }
  return gi / Math.max(1, ni) - gr / Math.max(1, nr);
}
/** Template pixels the coarse search looks at, at most: a large patch is sampled, not counted pixel by pixel. */
const COARSE_SAMPLES = 1500;

/**
 * The shift (pixels) that puts the template on the green: searched in steps of `coarse` over the radius, then
 * pixel by pixel around the best. Null when nothing clearly beats where the template already is.
 */
export function snapShift(green: Uint8Array, w: number, h: number, t: Template, maxShiftPx: number): { dx: number; dy: number; score: number; score0: number } | null {
  if (!t.inside.length) return null;
  const s0 = scoreAt(green, w, h, t, 0, 0);
  if (s0 == null) return null;
  const cost = (dx: number, dy: number) => (SNAP_DISTANCE_COST * Math.hypot(dx, dy)) / Math.max(1, maxShiftPx);
  let best = { dx: 0, dy: 0, v: s0 };
  // The coarse pass ranks shifts; the fine pass scores the winner's neighbourhood in full.
  const coarse = Math.max(1, Math.round(maxShiftPx / 12));
  const stride = Math.max(1, Math.ceil((t.inside.length + t.ring.length) / COARSE_SAMPLES));
  for (let dy = -maxShiftPx; dy <= maxShiftPx; dy += coarse) for (let dx = -maxShiftPx; dx <= maxShiftPx; dx += coarse) {
    if (dx * dx + dy * dy > maxShiftPx * maxShiftPx) continue;
    const v = scoreAt(green, w, h, t, dx, dy, stride);
    if (v != null && v - cost(dx, dy) > best.v - cost(best.dx, best.dy)) best = { dx, dy, v };
  }
  const c = best;
  best = { dx: 0, dy: 0, v: s0 };
  for (let dy = c.dy - coarse; dy <= c.dy + coarse; dy++) for (let dx = c.dx - coarse; dx <= c.dx + coarse; dx++) {
    if (dx * dx + dy * dy > maxShiftPx * maxShiftPx) continue;
    const v = scoreAt(green, w, h, t, dx, dy);
    if (v != null && v - cost(dx, dy) > best.v - cost(best.dx, best.dy)) best = { dx, dy, v };
  }
  if (best.v < MIN_SNAP_SCORE || best.v - s0 < MIN_SNAP_GAIN || (best.dx === 0 && best.dy === 0)) return null;
  return { dx: best.dx, dy: best.dy, score: best.v, score0: s0 };
}

const excessGreen = (r: number, g: number, b: number) => { const s = r + g + b; return s > 0 ? (2 * g - r - b) / s : 0; };

/** Green pixels of an RGBA window: excess green over a threshold between the window's soil and plants. */
export function greenOf(rgba: Uint8ClampedArray, n: number): Uint8Array {
  const g = new Float32Array(n);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    g[i] = rgba[o + 3] === 0 ? -1 : excessGreen(rgba[o], rgba[o + 1], rgba[o + 2]);
    if (rgba[o + 3]) { lo = Math.min(lo, g[i]); hi = Math.max(hi, g[i]); }
  }
  // Midway between the window's soil and its greenest, never under 0.06 nor over 0.2.
  const t = Math.min(0.2, Math.max(0.06, Number.isFinite(lo) ? (lo + hi) / 2 : 0.1));
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = g[i] > t ? 1 : 0;
  return out;
}

// ---------------------------------------------------------------- browser

type Decoded = { width: number; height: number; data: Uint8ClampedArray } | null;
const decoded = new Map<string, Promise<Decoded>>();
const DECODED_KEPT = 240;
function tileImage(url: string): Promise<Decoded> {
  const key = url.replace(/[?&]token=[^&]*/, "");
  const have = decoded.get(key);
  if (have) { decoded.delete(key); decoded.set(key, have); return have; }
  const p = fetchTileCached(url).then(async b => {
    const bmp = await createImageBitmap(b);
    const c: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
    const ctx = (c as HTMLCanvasElement).getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    return { width: c.width, height: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
  }).catch(() => null);
  decoded.set(key, p);
  while (decoded.size > DECODED_KEPT) { const k = decoded.keys().next().value; if (k == null) break; decoded.delete(k); }
  return p;
}

/** The zoom outlines are snapped at: the finest the map has, not finer than SNAP_MPP_MIN. */
export function snapZoom(maxNative: number, lat: number): number {
  let z = Math.min(23, Math.floor(maxNative));
  while (z > 16 && metresPerPixel(lat, z) < SNAP_MPP_MIN) z--;
  return z;
}

/** One outline snapped onto the green of the map; null when it is already on its weed or nothing clearly better is near. */
export async function snapOutline(input: { ring: LatLng2[]; centre: LatLng2; maxShiftM: number; tile: (z: number, x: number, y: number) => string; z: number }): Promise<Snap | null> {
  if (typeof createImageBitmap === "undefined" || input.ring.length < 3) return null;
  const { z } = input;
  const mpp = metresPerPixel(input.centre.lat, z);
  const pts = input.ring.map(p => mercatorPx(p.lat, p.lng, z));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const ringPx = Math.max(2, Math.round(Math.min(0.4 * span, 0.15 / mpp)));
  const maxShiftPx = Math.max(1, Math.round(input.maxShiftM / mpp));
  const pad = maxShiftPx + ringPx + 2;
  const left = Math.floor(Math.min(...xs)) - pad, top = Math.floor(Math.min(...ys)) - pad;
  const w = Math.ceil(Math.max(...xs)) + pad - left, h = Math.ceil(Math.max(...ys)) + pad - top;
  if (w * h > 600 * 600) return null; // a plant a few metres across is an area, not a weed to snap
  const rgba = new Uint8ClampedArray(w * h * 4);
  const jobs: Promise<void>[] = [];
  for (let ty = Math.floor(top / TILE_PX); ty <= Math.floor((top + h - 1) / TILE_PX); ty++) {
    for (let tx = Math.floor(left / TILE_PX); tx <= Math.floor((left + w - 1) / TILE_PX); tx++) {
      jobs.push(tileImage(input.tile(z, tx, ty)).then(img => {
        if (!img) return;
        const x0 = Math.max(left, tx * TILE_PX), x1 = Math.min(left + w, tx * TILE_PX + img.width);
        const y0 = Math.max(top, ty * TILE_PX), y1 = Math.min(top + h, ty * TILE_PX + img.height);
        for (let y = y0; y < y1; y++) {
          const src = ((y - ty * TILE_PX) * img.width + (x0 - tx * TILE_PX)) * 4;
          rgba.set(img.data.subarray(src, src + (x1 - x0) * 4), ((y - top) * w + (x0 - left)) * 4);
        }
      }));
    }
  }
  await Promise.all(jobs);
  const green = greenOf(rgba, w * h);
  const t = templateOf(pts.map(([x, y]) => [x - left, y - top]), w, h, ringPx);
  const s = snapShift(green, w, h, t, maxShiftPx);
  if (!s) return null;
  const [cx, cy] = mercatorPx(input.centre.lat, input.centre.lng, z);
  const moved = latLngOfPx(cx + s.dx, cy + s.dy, z);
  return { dLat: moved.lat - input.centre.lat, dLng: moved.lng - input.centre.lng, score: s.score, shiftM: Math.hypot(s.dx, s.dy) * mpp };
}

/** For tests and after a rebake. */
export function resetSnapTiles(): void { decoded.clear(); }
