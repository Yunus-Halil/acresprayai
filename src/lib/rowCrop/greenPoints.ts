// Plant positions from the green itself, no model (Corn V1, 2026-11-04).
//
// The row builder of plantRows.ts (rowsFromPoints) needs plant positions, not pixels. MaSC gives them as boxes; this
// gives them from the seedling mask (green judged against the soil beside it, seedlingGreen.ts) so the same geometry
// runs in the browser with nothing to download and no licence to clear. A piece of green up to a few typical plants is
// one point at its centre; a larger piece (plants touching along a row, leaves of neighbours meeting) is cut into
// squares about two typical plants across, one point per square with enough green. Weeds are points too: the row
// builder only keeps points that line up in parallel, evenly spaced rows, and scattered green makes no rows.
import type { PhotoPixels } from "../photoScout/pattern";
import type { PlantPoint } from "./plantRows";
import { convexHull } from "./readRowCrop";
import { SEEDLING_GREEN, seedlingMask } from "./seedlingGreen";

export const GREEN_POINTS = {
  /** The mask is judged at the photo's pixel and read at this long side (pieces and points). */
  workLongSide: 1600,
  /** A work pixel is green when at least this share of its photo pixels is. */
  shrinkShare: 0.25,
  /** Pieces smaller than this (work pixels) are specks, not plants. */
  minPiecePx: 4,
  /** A piece up to this many typical plants is one point. */
  wholeUpTo: 4,
  /** A piece over this share of the frame does not size the typical plant. */
  maxPlantShare: 0.002,
  /** Pieces under this share of the typical plant are specks. */
  speckShare: 0.15,
  /** A larger piece filling more than this share of its box and wider than coverPlants typical plants both ways is
   * cover (a lawn, a canopy): no points. */
  coverFill: 0.35,
  coverPlants: 6,
  /** A long piece gives a point per this many typical plant diameters along its long axis. */
  stepPlants: 1.5,
  /** A lone plant smaller than this (photo pixels) is too few pixels to say what shape its leaves are. */
  shapeMinPx: 60,
  /** Points stop here (a frame of cover gives no plant positions anyway). */
  maxPoints: 15000,
};

/** A lone plant's outline at the photo's own pixel: how a grass (corn's narrow, spread leaves) differs from a broadleaf
 * seedling (beet, sunflower, soybean: round leaves, a compact rosette). */
export type PlantShape = {
  areaPx: number;
  /** Area over the convex hull's: a few narrow leaves spread out fill little of their hull, round leaves most of it. */
  solidity: number;
  /** Mean width of the plant's leaves, photo pixels (twice the area over the outline's length). */
  widthPx: number;
};
export type GreenPoint = PlantPoint & { shape?: PlantShape };

export type GreenPoints = {
  points: GreenPoint[];
  /** The typical plant piece's diameter, photo pixels (the median piece's square root). */
  typicalPx: number;
  /** Share of the frame that is green. */
  greenShare: number;
  workFactor: number;
};

/** Plant positions over a whole photograph, photo pixels. */
export function plantPointsFromGreen(px: PhotoPixels, o = GREEN_POINTS): GreenPoints {
  const W = px.width, H = px.height, f = Math.max(1, Math.round(Math.max(W, H) / o.workLongSide));
  const full = seedlingMask(px, SEEDLING_GREEN);
  const w = Math.floor(W / f), h = Math.floor(H / f), mask = new Uint8Array(w * h), need = Math.max(1, Math.ceil(f * f * o.shrinkShare));
  let green = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = 0;
    for (let yy = 0; yy < f; yy++) { const row = (y * f + yy) * W + x * f; for (let xx = 0; xx < f; xx++) c += full[row + xx]; }
    if (c >= need) { mask[y * w + x] = 1; green++; }
  }
  // 8-connected pieces.
  const label = new Int32Array(w * h).fill(-1), stack = new Int32Array(w * h);
  const area: number[] = [], sx: number[] = [], sy: number[] = [], bx0: number[] = [], by0: number[] = [], bx1: number[] = [], by1: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    const id = area.length; let top = 0, a = 0, ax = 0, ay = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[top++] = i; label[i] = id;
    while (top) {
      const j = stack[--top], x = j % w, y = (j - x) / w;
      a++; ax += x; ay += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx; if (mask[k] && label[k] < 0) { label[k] = id; stack[top++] = k; }
      }
    }
    area.push(a); sx.push(ax); sy.push(ay); bx0.push(x0); by0.push(y0); bx1.push(x1); by1.push(y1);
  }
  // The typical plant: the area-weighted median piece (half the green lies in smaller pieces), so specks of soil
  // texture, however many, do not set it. Pieces under a share of it are specks.
  // Pieces over maxPlantShare of the frame (a lawn, a canopy, rows grown together) say nothing of a plant's size.
  const kept = area.map((a, id) => id).filter(id => area[id] >= o.minPiecePx).sort((p, q) => area[p] - area[q]);
  const sizing = kept.filter(id => area[id] <= o.maxPlantShare * w * h);
  const total = sizing.reduce((s, id) => s + area[id], 0);
  let typical = o.minPiecePx;
  for (let acc = 0, i = 0; i < sizing.length; i++) { acc += area[sizing[i]]; if (acc >= total / 2) { typical = area[sizing[i]]; break; } }
  const d = Math.sqrt(typical), minPiece = Math.max(o.minPiecePx, typical * o.speckShare);
  const toPhoto = (x: number, y: number): PlantPoint => ({ x: (x + 0.5) * f, y: (y + 0.5) * f });
  const points: GreenPoint[] = [];
  /** The piece's own pixels at the photo's pixel: its outline, hull and leaf width. */
  const shapeOf = (id: number): PlantShape | undefined => {
    const X0 = bx0[id] * f, Y0 = by0[id] * f, X1 = Math.min(W, (bx1[id] + 1) * f), Y1 = Math.min(H, (by1[id] + 1) * f);
    const inP = (X: number, Y: number) => X >= X0 && Y >= Y0 && X < X1 && Y < Y1 && full[Y * W + X] === 1 && label[Math.min(h - 1, (Y / f) | 0) * w + Math.min(w - 1, (X / f) | 0)] === id;
    let A = 0, P = 0; const edge: [number, number][] = [];
    for (let Y = Y0; Y < Y1; Y++) for (let X = X0; X < X1; X++) {
      if (!inP(X, Y)) continue;
      A++;
      if (!inP(X - 1, Y) || !inP(X + 1, Y) || !inP(X, Y - 1) || !inP(X, Y + 1)) { P++; edge.push([X, Y]); }
    }
    if (A < o.shapeMinPx || edge.length < 3) return undefined;
    const hull = convexHull(edge);
    let ha = 0, hp = 0;
    for (let i = 0; i < hull.length; i++) { const [ax, ay] = hull[i], [bx, by] = hull[(i + 1) % hull.length]; ha += ax * by - bx * ay; hp += Math.hypot(bx - ax, by - ay); }
    const hullArea = Math.abs(ha) / 2 + hp / 2 + 1;
    return { areaPx: A, solidity: Math.min(1, A / hullArea), widthPx: (2 * A) / P };
  };
  for (const id of kept) {
    const a = area[id]; if (a < minPiece) continue;
    if (a <= o.wholeUpTo * typical) { points.push({ ...toPhoto(sx[id] / a, sy[id] / a), shape: shapeOf(id) }); continue; }
    // A large piece: cover (it fills its box, wide both ways) gives no points: squares cut from a lawn or a canopy line
    // up in a perfect lattice the row builder would take for rows. A long piece (plants touching along a row) gives
    // points along its long axis, one per typical plant.
    const bw = bx1[id] - bx0[id] + 1, bh = by1[id] - by0[id] + 1, fill = a / (bw * bh);
    if (fill > o.coverFill && Math.min(bw, bh) > o.coverPlants * d) continue;
    const mx = sx[id] / a, my = sy[id] / a;
    let cxx = 0, cyy = 0, cxy = 0;
    for (let y = by0[id]; y <= by1[id]; y++) for (let x = bx0[id]; x <= bx1[id]; x++) if (label[y * w + x] === id) { cxx += (x - mx) ** 2; cyy += (y - my) ** 2; cxy += (x - mx) * (y - my); }
    const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy), ux = Math.cos(th), uy = Math.sin(th), step = Math.max(2, d * o.stepPlants);
    const bins = new Map<number, [number, number, number]>();
    for (let y = by0[id]; y <= by1[id]; y++) for (let x = bx0[id]; x <= bx1[id]; x++) if (label[y * w + x] === id) {
      const k = Math.floor(((x - mx) * ux + (y - my) * uy) / step), b = bins.get(k) ?? [0, 0, 0]; b[0]++; b[1] += x; b[2] += y; bins.set(k, b);
    }
    for (const [n, bxs, bys] of bins.values()) if (n >= minPiece) points.push(toPhoto(bxs / n, bys / n));
    if (points.length > o.maxPoints) break;
  }
  return { points, typicalPx: d * f, greenShare: green / (w * h || 1), workFactor: f };
}
