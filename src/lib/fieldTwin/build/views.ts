// Which views the weed model should look at. A flight sees every patch of ground four or five times (median 4
// on the apricot flight), while a weed is verified by two sightings; the third and later views only add to
// "seen in N of M". So the model runs on the tiles that hold each ground cell's nearest views (two by default),
// and a third pass later looks again at the ground where only one view saw a plant (weeds.ts). The tile plan
// here is the service's own (weedlab.service.tiling.plan_tiles), so the indices it is asked for mean the same
// tiles on both sides.
import { type GeorefFrame, frameCorners, groundToPixel, pixelToGround } from "../../directGeoref";
import { toEnu } from "../../sourceFrames/odm";

export type TilePlan = { tile: number; overlap: number; width: number; height: number; /** (y, x) origins in the padded image, the service's order. */ origins: [number, number][] };

/** The service's tile plan for an image of `width` x `height` at processing scale. */
export function planTiles(width: number, height: number, tile: number, overlap: number): TilePlan {
  const padB = Math.max(0, tile - height), padR = Math.max(0, tile - width);
  const H = height + padB, W = width + padR, step = tile - overlap;
  const starts = (n: number): number[] => {
    if (n <= tile) return [0];
    const s: number[] = [];
    for (let v = 0; v < n - tile; v += step) s.push(v);
    if (s[s.length - 1] + tile < n) s.push(n - tile);
    return s;
  };
  const origins: [number, number][] = [];
  for (const y of starts(H)) for (const x of starts(W)) origins.push([y, x]);
  return { tile, overlap, width, height, origins };
}

/** The indices of the tiles that hold pixel (u, v) (several where tiles overlap). */
export function tilesAt(plan: TilePlan, u: number, v: number): number[] {
  const out: number[] = [];
  plan.origins.forEach(([y, x], i) => { if (u >= x && u < x + plan.tile && v >= y && v < y + plan.tile) out.push(i); });
  return out;
}

export type ViewChoice = {
  /** Per photograph: the tile indices to run, sorted. Photographs with nothing to run are absent. */
  tiles: Map<string, number[]>;
  /** Tiles in all plans, and tiles chosen. */
  total: number;
  run: number;
  views: number;
  cellM: number;
};

type Fp = { name: string; f: GeorefFrame; ring: [number, number][]; nadir: [number, number]; box: [number, number, number, number] };

function footprintsOf(frames: Map<string, GeorefFrame>, origin: { lat: number; lng: number }): Fp[] {
  const en = (lat: number, lng: number): [number, number] => { const e = toEnu({ lat, lng, altM: 0 }, { ...origin, altM: 0 }); return [e[0], e[1]]; };
  const out: Fp[] = [];
  for (const f of frames.values()) {
    const c = frameCorners(f), nd = pixelToGround(f, f.intrinsics.cx, f.intrinsics.cy);
    if (!c || !nd) continue;
    const ring = c.map(g => en(g.lat, g.lng)), nadir = en(nd.lat, nd.lng);
    out.push({ name: f.name, f, ring, nadir, box: [Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1])), Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))] });
  }
  return out;
}

const inRing = (x: number, y: number, ring: [number, number][]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; }
  return inside;
};

/**
 * For every `cellM` cell of photographed ground, the `views` photographs whose nadir is nearest, and in each of
 * them the tiles that hold the cell. `groundAlt` is the flat ground's height (the model's), where the cell is
 * projected into the photographs. `only` restricts the cells to those inside the given ring (local metres).
 */
export function chooseViews(frames: Map<string, GeorefFrame>, plans: Map<string, TilePlan>, origin: { lat: number; lng: number }, groundAlt: number, views = 2, cellM = 2, only: ((e: number, n: number) => boolean) | null = null): ViewChoice {
  const fps = footprintsOf(frames, origin);
  const chosen = new Map<string, Set<number>>();
  if (!fps.length) return { tiles: new Map(), total: 0, run: 0, views, cellM };
  const x0 = Math.min(...fps.map(p => p.box[0])), x1 = Math.max(...fps.map(p => p.box[2])), y0 = Math.min(...fps.map(p => p.box[1])), y1 = Math.max(...fps.map(p => p.box[3]));
  const lat0 = (origin.lat * Math.PI) / 180;
  for (let y = y0 + cellM / 2; y < y1; y += cellM) for (let x = x0 + cellM / 2; x < x1; x += cellM) {
    if (only && !only(x, y)) continue;
    const cov: { d: number; fp: Fp }[] = [];
    for (const fp of fps) { if (x < fp.box[0] || x > fp.box[2] || y < fp.box[1] || y > fp.box[3] || !inRing(x, y, fp.ring)) continue; cov.push({ d: (fp.nadir[0] - x) ** 2 + (fp.nadir[1] - y) ** 2, fp }); }
    if (!cov.length) continue;
    cov.sort((a, b) => a.d - b.d);
    const lat = origin.lat + (y / 6378137) * (180 / Math.PI), lng = origin.lng + (x / (6378137 * Math.cos(lat0))) * (180 / Math.PI);
    for (const { fp } of cov.slice(0, views)) {
      const plan = plans.get(fp.name);
      if (!plan) continue;
      const hit = groundToPixel(fp.f, lat, lng, groundAlt);
      if (!hit) continue;
      const s = plan.width / fp.f.intrinsics.width;
      for (const t of tilesAt(plan, hit.u * s, hit.v * s)) (chosen.get(fp.name) ?? chosen.set(fp.name, new Set()).get(fp.name)!).add(t);
    }
  }
  const tiles = new Map<string, number[]>();
  let run = 0, total = 0;
  for (const [name, set] of chosen) { const list = [...set].sort((a, b) => a - b); tiles.set(name, list); run += list.length; }
  for (const p of plans.values()) total += p.origins.length;
  return { tiles, total, run, views, cellM };
}

/** The ground each run tile of a photograph covers: its four corners projected to the flat ground, local metres about `origin`. */
export function runRings(f: GeorefFrame, plan: TilePlan, tiles: number[], origin: { lat: number; lng: number }): [number, number][][] {
  const s = f.intrinsics.width / plan.width;
  const en = (lat: number, lng: number): [number, number] => { const e = toEnu({ lat, lng, altM: 0 }, { ...origin, altM: 0 }); return [e[0], e[1]]; };
  const out: [number, number][][] = [];
  for (const i of tiles) {
    const [y, x] = plan.origins[i];
    const corners: [number, number][] = [[x, y], [x + plan.tile, y], [x + plan.tile, y + plan.tile], [x, y + plan.tile]];
    const ring: [number, number][] = [];
    for (const [u, v] of corners) { const g = pixelToGround(f, Math.min(u * s, f.intrinsics.width), Math.min(v * s, f.intrinsics.height)); if (!g) break; ring.push(en(g.lat, g.lng)); }
    if (ring.length === 4) out.push(ring);
  }
  return out;
}
