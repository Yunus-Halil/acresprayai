// Direct photo georeferencing, part 4: vegetation objects found in a raw photograph, then put on the ground.
//
// Detection reuses the app's own pieces and adds nothing clever: the ExGR vegetation mask the planting layout uses
// (weedVision/fieldRows vegetationMask), pooled to cells, and Photo Scout's 8-connected component measurer
// (photoScout/pattern measureComponents). An object is a connected patch of green; the word "weed" or "tree" is not
// claimed here, only size. Each object keeps its outline (convex hull of its cells) in ORIGINAL frame pixels, so the
// projection runs on the photograph's own coordinates whatever raster the detector saw.
import { measureComponents } from "../photoScout/pattern";
import type { PhotoPixels } from "../photoScout/pattern";
import { vegetationMask } from "../weedVision/fieldRows";
import { type GeorefFrame, type GroundPoint, groundSampleAt, pixelToGround } from "./projection";

export type PixelObject = {
  id: number;
  /** Centroid, original frame pixels (continuous coordinates). */
  u: number;
  v: number;
  /** Convex outline, original frame pixels, counterclockwise in the image. */
  hull: [number, number][];
  cells: number;
  /** Area in original frame pixels. */
  areaPx: number;
  /** The patch reaches the image border: its outline and centroid are cut off by the frame. */
  touchesEdge: boolean;
};

export type ObjectOptions = {
  /** Raster pixels per detection cell. */
  cellPx?: number;
  /** A cell is green when at least this share of its pixels is. */
  cellGreenShare?: number;
  /** Patches with fewer cells are specks. */
  minCells?: number;
};

export const OBJECT_DEFAULTS: Required<ObjectOptions> = { cellPx: 2, cellGreenShare: 0.3, minCells: 3 };

function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/**
 * Green patches in a (possibly downsized) photograph. `toOriginal` is original pixels per raster pixel (4 for a
 * quarter-size decode), so outlines and centroids come back in the original frame's pixels.
 */
export function vegetationObjects(px: PhotoPixels, toOriginal: number, opts: ObjectOptions = {}): PixelObject[] {
  const o = { ...OBJECT_DEFAULTS, ...opts };
  const mask = vegetationMask(px);
  const k = o.cellPx, W = Math.floor(px.width / k), H = Math.floor(px.height / k);
  const cells = new Uint8Array(W * H);
  const bar = o.cellGreenShare * k * k;
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    let n = 0;
    for (let y = cy * k; y < cy * k + k; y++) for (let x = cx * k; x < cx * k + k; x++) n += mask[y * px.width + x];
    if (n >= bar) cells[cy * W + cx] = 1;
  }
  const { blobs, labels } = measureComponents(cells, W, H, o.minCells);
  const corners: [number, number][][] = blobs.map(() => []);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (!l) continue;
    const x = i % W, y = (i - x) / W;
    // Only boundary cells can be hull vertices; their four corners are the outline.
    const inside = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < W && yy < H && labels[yy * W + xx] === l;
    if (inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1)) continue;
    corners[l - 1].push([x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]);
  }
  const s = k * toOriginal;
  return blobs.map((b, i) => ({
    id: i + 1,
    u: (b.sx / b.n + 0.5) * s,
    v: (b.sy / b.n + 0.5) * s,
    hull: convexHull(corners[i]).map(([x, y]) => [x * s, y * s] as [number, number]),
    cells: b.n,
    areaPx: b.n * s * s,
    touchesEdge: b.minX === 0 || b.minY === 0 || b.maxX === W - 1 || b.maxY === H - 1,
  }));
}

export type GroundObject = PixelObject & {
  frame: string;
  ground: GroundPoint;
  outline: { lat: number; lng: number }[];
  /** Ground area: cells x the ground area of one original pixel at the centroid. */
  areaM2: number;
};

/** Each object's centroid and outline on the frame's ground model. Objects whose rays miss the ground are dropped. */
export function objectsToGround(f: GeorefFrame, objects: PixelObject[]): GroundObject[] {
  const out: GroundObject[] = [];
  for (const ob of objects) {
    const g = pixelToGround(f, ob.u, ob.v);
    const gsd = groundSampleAt(f, ob.u, ob.v);
    if (!g || gsd == null) continue;
    const outline: { lat: number; lng: number }[] = [];
    for (const [u, v] of ob.hull) {
      const q = pixelToGround(f, u, v);
      if (q) outline.push({ lat: q.lat, lng: q.lng });
    }
    out.push({ ...ob, frame: f.name, ground: g, outline, areaM2: ob.areaPx * gsd * gsd });
  }
  return out;
}
