// Steps 2 and 3: measure every tile, then mark the ones that are not average,
// at two scales, and merge what touches into regions.
//
// WHY NOT MEDIAN AND MAD. The first version compared every tile to the median
// of all tiles with the MAD as its yardstick. That is robust while the odd
// ground is a minority. A dry patch covering a third of a field is not a
// minority: it drags the median toward itself and swells the MAD until the
// patch is no longer unusual, and everything small disappears with it. The
// baseline here is the SHORTH: the shortest interval holding half the tiles.
// Its centre is the densest cluster, which is the ordinary ground however
// large the patch, and its length is a spread estimate that ignores the patch
// entirely (for normal data the shortest half is the interquartile range,
// 1.349 standard deviations).
//
// TWO SCALES. A tile is scored against the field (the shorth) AND against its
// own neighbourhood (the median of the tiles within two tiles of it). Patch
// interiors show on the field score; a single odd plant, and the edges of a
// patch, show on the local score.
//
// SUPPORT. A tile is flagged when its strongest deviation crosses the
// threshold AND a second feature from a different group backs it up (or the
// first is overwhelming). Brightness never leads and never supports: it is
// what mosaic seams, vignetting and cloud edges move, so it is descriptive
// (it names the class of a region) and not a trigger. A dry patch still
// flags, on its vegetation fraction and its colour.
//
// REGIONS. Hysteresis, then connected components. Core tiles are the ones
// past the threshold; any 4-neighbour past GROW_FRACTION of it is grown in.
// That is what turns a patch from a speckle of rectangles into one shape with
// an area, and what keeps a single noisy tile a point.
import type { RasterSource } from "../cellFeatures";
import { MIN_PIXELS_PER_CELL } from "../cellFeatures";
import type { LatLng2 } from "../geo";
import {
  F, GROW_FRACTION, TILE_FEATURE_NAMES, type AnalysisTile, type Driver, type Region,
  type RegionClass, type TileFlag, type TileSample, type TileScore,
} from "./types";
import { type TileLattice, tileWindow } from "./tiles";

export const MIN_PIXELS_PER_TILE = MIN_PIXELS_PER_CELL;
/** Tiles needed before a baseline means anything. */
export const MIN_BASELINE_TILES = 8;
/** Radius, in tiles, of the neighbourhood a tile is compared against locally. */
export const LOCAL_RADIUS_TILES = 2;
/** Shortest-half length of a normal distribution, in standard deviations. */
const SHORTH_TO_SD = 1.349;
/**
 * Smallest spread each tile feature may have, in its own units: measurement
 * precision on 8-bit imagery. Without a floor, a field that agrees with
 * itself to the fourth decimal makes every tile an outlier from the rest.
 */
export const TILE_SCALE_FLOORS = [0.005, 0.005, 0.005, 2, 1, 0.01, 0.005, 0.01, 0.01];
/** Fraction of the threshold a second feature must reach to count as support. */
const SUPPORT_FRACTION = 0.5;
/** A single feature this far past the threshold needs no support (except brightness). */
const OVERWHELMING = 1.5;
const BRIGHTNESS_FEATURES = new Set<number>([F.brightness, F.brightnessSd]);
/**
 * Feature groups. Support must come from a DIFFERENT group than the leader:
 * brightness and its spread both move at a seam, and three greenness indices
 * on the same chromaticity are one measurement written three ways.
 */
const GROUP_OF: Record<number, "brightness" | "colour" | "colourSpread" | "vegetation"> = {
  [F.redShare]: "colour", [F.greenShare]: "colour", [F.blueShare]: "colour",
  [F.brightness]: "brightness", [F.brightnessSd]: "brightness",
  [F.exg]: "colour", [F.exgSd]: "colourSpread",
  [F.ngrdi]: "colour",
  [F.vegetation]: "vegetation",
};

type Acc = { sum: number; sumSq: number; n: number };
const acc = (): Acc => ({ sum: 0, sumSq: 0, n: 0 });
const push = (a: Acc, v: number) => { a.sum += v; a.sumSq += v * v; a.n++; };
const mean = (a: Acc) => (a.n ? a.sum / a.n : 0);
const sd = (a: Acc) => {
  if (a.n < 2) return 0;
  const m = a.sum / a.n;
  return Math.sqrt(Math.max(0, a.sumSq / a.n - m * m));
};

export const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Per-tile features from the raster and the vegetation mask.
 *
 * Strided so a big tile costs the same as a small one: the statistics are
 * means and spreads, which converge long before the pixels run out. Very dark
 * pixels are skipped as unknown rather than counted as soil: a deep shadow has
 * no colour to normalise and would otherwise read as bare, dark ground.
 */
export function sampleTiles(
  tiles: AnalysisTile[],
  rgb: RasterSource,
  mask: Uint8Array,
  opts: { maxPixelsPerTile?: number; minBrightness?: number } = {},
): TileSample[] {
  const cap = opts.maxPixelsPerTile ?? 600;
  const minBrightness = opts.minBrightness ?? 12;
  const out: TileSample[] = [];
  for (const tile of tiles) {
    const w = tileWindow(tile, rgb);
    if (!w) {
      out.push({ tileId: tile.id, pixelCount: 0, features: [], usable: false, vegetationFraction: 0 });
      continue;
    }
    const spanX = w.x1 - w.x0 + 1, spanY = w.y1 - w.y0 + 1;
    const stride = Math.max(1, Math.floor(Math.sqrt((spanX * spanY) / cap)));
    const aR = acc(), aG = acc(), aB = acc(), aI = acc(), aExg = acc(), aNg = acc();
    let n = 0, veg = 0;
    for (let y = w.y0; y <= w.y1; y += stride) {
      for (let x = w.x0; x <= w.x1; x += stride) {
        const i = y * rgb.width + x;
        const o = i * 4;
        if (rgb.rgba[o + 3] === 0) continue;
        const R = rgb.rgba[o], G = rgb.rgba[o + 1], B = rgb.rgba[o + 2];
        const total = R + G + B;
        if (total < minBrightness * 3) continue;
        const r = R / total, g = G / total, b = B / total;
        push(aR, r); push(aG, g); push(aB, b);
        push(aI, total / 3);
        push(aExg, 2 * g - r - b);
        push(aNg, G + R > 0 ? (G - R) / (G + R) : 0);
        if (mask[i]) veg++;
        n++;
      }
    }
    if (n < MIN_PIXELS_PER_TILE) {
      out.push({ tileId: tile.id, pixelCount: n, features: [], usable: false, vegetationFraction: 0 });
      continue;
    }
    const vegetationFraction = veg / n;
    out.push({
      tileId: tile.id,
      pixelCount: n,
      usable: true,
      vegetationFraction,
      features: [
        mean(aR), mean(aG), mean(aB),
        mean(aI), sd(aI),
        mean(aExg), sd(aExg),
        mean(aNg),
        vegetationFraction,
      ],
    });
  }
  return out;
}

export type Baseline = {
  /** Centre of the densest half per feature. */
  centres: number[];
  /** Spread per feature, in standard-deviation-equivalent units. */
  scales: number[];
  tiles: number;
};

/**
 * The shorth: centre and spread of the shortest interval holding half the
 * values. Location is robust until the ordinary ground is itself a minority.
 */
export function shorth(values: number[]): { centre: number; scale: number } {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return { centre: 0, scale: 0 };
  if (n < 4) return { centre: median(s), scale: 0 };
  const h = Math.ceil(n / 2);
  let best = Infinity, bi = 0;
  for (let i = 0; i + h - 1 < n; i++) {
    const len = s[i + h - 1] - s[i];
    if (len < best) { best = len; bi = i; }
  }
  let sum = 0;
  for (let i = bi; i < bi + h; i++) sum += s[i];
  return { centre: sum / h, scale: best / SHORTH_TO_SD };
}

/** Shorth per feature over the usable tiles. */
export function fieldBaseline(samples: TileSample[]): Baseline | null {
  const usable = samples.filter(s => s.usable);
  if (usable.length < MIN_BASELINE_TILES) return null;
  const nF = TILE_FEATURE_NAMES.length;
  const centres: number[] = [], scales: number[] = [];
  for (let f = 0; f < nF; f++) {
    const { centre, scale } = shorth(usable.map(s => s.features[f]));
    centres.push(centre);
    scales.push(Math.max(scale, TILE_SCALE_FLOORS[f] ?? 0));
  }
  return { centres, scales, tiles: usable.length };
}

/**
 * Score every usable tile at both scales.
 *
 * The local comparison divides by the FIELD scale, not the neighbourhood's:
 * a neighbourhood of nine near-identical tiles has a spread of nothing, and
 * dividing by nothing makes every tile an outlier from itself.
 */
export function scoreTiles(
  samples: TileSample[],
  baseline: Baseline,
  tiles: AnalysisTile[],
  anomalyZ: number,
  radiusTiles = LOCAL_RADIUS_TILES,
): TileScore[] {
  const nF = TILE_FEATURE_NAMES.length;
  const byId = new Map(samples.map(s => [s.tileId, s]));
  const grid = new Map<string, TileSample>();
  for (const t of tiles) {
    const s = byId.get(t.id);
    if (s?.usable) grid.set(`${t.col}:${t.row}`, s);
  }
  const out: TileScore[] = [];
  for (const t of tiles) {
    const s = byId.get(t.id);
    if (!s?.usable) continue;
    const neighbours: TileSample[] = [];
    for (let dr = -radiusTiles; dr <= radiusTiles; dr++) {
      for (let dc = -radiusTiles; dc <= radiusTiles; dc++) {
        if (!dr && !dc) continue;
        const n = grid.get(`${t.col + dc}:${t.row + dr}`);
        if (n) neighbours.push(n);
      }
    }
    const fieldZ: number[] = [], localZ: number[] = [];
    const drivers: Driver[] = [];
    for (let f = 0; f < nF; f++) {
      const scale = baseline.scales[f];
      if (scale < 1e-9) { fieldZ.push(0); localZ.push(0); continue; }
      const fz = (s.features[f] - baseline.centres[f]) / scale;
      const lz = neighbours.length >= 4
        ? (s.features[f] - median(neighbours.map(n => n.features[f]))) / scale
        : 0;
      fieldZ.push(fz);
      localZ.push(lz);
      const useField = Math.abs(fz) >= Math.abs(lz);
      drivers.push({
        feature: TILE_FEATURE_NAMES[f],
        z: useField ? fz : lz,
        scale: useField ? "field" : "local",
      });
    }
    drivers.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    // The decision is made over the non-brightness drivers only.
    const deciding = drivers.filter(d => !BRIGHTNESS_FEATURES.has(TILE_FEATURE_NAMES.indexOf(d.feature)));
    const top = deciding[0];
    const topIdx = top ? TILE_FEATURE_NAMES.indexOf(top.feature) : -1;
    // The strongest deciding driver from a different group than the leader is the support.
    const second = deciding.find(d => GROUP_OF[TILE_FEATURE_NAMES.indexOf(d.feature)] !== GROUP_OF[topIdx]);
    const m1 = top ? Math.abs(top.z) : 0, m2 = second ? Math.abs(second.z) : 0;
    const supported = m2 >= SUPPORT_FRACTION * anomalyZ || m1 >= OVERWHELMING * anomalyZ;
    // Strength is what thresholds and ranks apply to: the leader when it is
    // supported, otherwise only the support itself. The leader is kept for
    // hysteresis, where a core next door supplies the context.
    const strength = supported ? m1 : m2;
    const shown = top && second ? [top, second] : drivers.slice(0, 2);
    out.push({ tileId: t.id, fieldZ, localZ, strength, leader: m1, drivers: shown, supported });
  }
  return out;
}

/** Core flags: supported tiles past the threshold, strongest first. */
export function flagTiles(
  scores: TileScore[],
  anomalyZ: number,
  exclude: ReadonlySet<string> = new Set(),
): TileFlag[] {
  const flags: TileFlag[] = [];
  for (const s of scores) {
    if (exclude.has(s.tileId) || !s.supported || s.strength < anomalyZ || !s.drivers.length) continue;
    const d = s.drivers[0];
    flags.push({ tileId: s.tileId, z: s.strength, feature: d.feature, direction: d.z > 0 ? "above" : "below", drivers: s.drivers });
  }
  flags.sort((a, b) => b.z - a.z);
  return flags;
}

/** How a region reads, from the mean signed field deviation of its tiles. */
export function classify(meanFieldZ: number[]): RegionClass {
  const veg = meanFieldZ[F.vegetation] ?? 0;
  const bright = meanFieldZ[F.brightness] ?? 0;
  const green = ((meanFieldZ[F.greenShare] ?? 0) + (meanFieldZ[F.exg] ?? 0) + (meanFieldZ[F.ngrdi] ?? 0)) / 3;
  if (veg <= -1.5 && bright >= 1) return "bare or dry ground";
  if (veg <= -1.5 && bright <= -1) return "dark ground (wet, shadow or residue)";
  if (veg <= -1.5) return "thin stand";
  if (veg >= 1.5) return "dense vegetation";
  if (green <= -1.5) return "pale vegetation";
  if (green >= 1.5) return "greener than the field";
  return "different from the field";
}

/**
 * Trace the outline of a set of lattice tiles as rings.
 *
 * Every tile edge with no region tile on the other side is a boundary edge,
 * oriented so the region is on its left. Chaining them gives the outer ring
 * counterclockwise and any holes clockwise. At a pinch (two boundary edges
 * leaving one vertex) the left turn is taken, which keeps every ring simple.
 */
export function traceOutline(tiles: AnalysisTile[], lattice: TileLattice): LatLng2[][] {
  const cells = new Set(tiles.map(t => `${t.col}:${t.row}`));
  type V = [number, number];
  const key = (v: V) => `${v[0]}:${v[1]}`;
  // Directed edges: from vertex -> list of to vertices.
  const edges = new Map<string, V[]>();
  const add = (a: V, b: V) => {
    const k = key(a);
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k)!.push(b);
  };
  for (const t of tiles) {
    const c = t.col, r = t.row;
    if (!cells.has(`${c}:${r - 1}`)) add([c, r], [c + 1, r]);           // south edge, west to east
    if (!cells.has(`${c + 1}:${r}`)) add([c + 1, r], [c + 1, r + 1]);   // east edge, south to north
    if (!cells.has(`${c}:${r + 1}`)) add([c + 1, r + 1], [c, r + 1]);   // north edge, east to west
    if (!cells.has(`${c - 1}:${r}`)) add([c, r + 1], [c, r]);           // west edge, north to south
  }
  const toLatLng = (v: V): LatLng2 => ({ lat: lattice.minLat + v[1] * lattice.dLat, lng: lattice.minLng + v[0] * lattice.dLng });
  const rings: LatLng2[][] = [];
  const remaining = () => { for (const [k, v] of edges) if (v.length) return k; return null; };
  let startKey = remaining();
  while (startKey) {
    const [sc, sr] = startKey.split(":").map(Number);
    let cur: V = [sc, sr];
    let prevDir: V | null = null;
    const ring: V[] = [cur];
    for (let guard = 0; guard < 200_000; guard++) {
      const outs = edges.get(key(cur));
      if (!outs || !outs.length) break;
      let pick = 0;
      if (outs.length > 1 && prevDir) {
        // Prefer left turn, then straight, then right, relative to the incoming direction.
        const score = (to: V) => {
          const d: V = [to[0] - cur[0], to[1] - cur[1]];
          const cross = prevDir![0] * d[1] - prevDir![1] * d[0];
          const dot = prevDir![0] * d[0] + prevDir![1] * d[1];
          return cross > 0 ? 0 : dot > 0 ? 1 : 2;
        };
        pick = outs.map((to, i) => [score(to), i] as [number, number]).sort((a, b) => a[0] - b[0])[0][1];
      }
      const next = outs.splice(pick, 1)[0];
      prevDir = [next[0] - cur[0], next[1] - cur[1]];
      cur = next;
      if (cur[0] === sc && cur[1] === sr) break;
      ring.push(cur);
    }
    if (ring.length >= 4) rings.push(ring.map(toLatLng));
    startKey = remaining();
  }
  // Outer ring first: the one with the largest lattice-area magnitude.
  const area = (r: LatLng2[]) => {
    let a = 0;
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length];
      a += p.lng * q.lat - q.lng * p.lat;
    }
    return Math.abs(a);
  };
  rings.sort((a, b) => area(b) - area(a));
  return rings;
}

/**
 * Hysteresis growth and connected components over the tile lattice.
 *
 * Core tiles are flagged tiles. Growth admits any 4-neighbour whose leading
 * non-brightness deviation is at least GROW_FRACTION of the threshold,
 * supported or not: once a core exists next door, the context the support
 * rule asked for is present.
 * Components under `minRegionTiles` are not regions; they stay as the point
 * candidates their core tiles already are.
 */
export function growRegions(
  tiles: AnalysisTile[],
  scores: TileScore[],
  flags: TileFlag[],
  lattice: TileLattice,
  params: { anomalyZ: number; minRegionTiles: number; tileM: number },
  exclude: ReadonlySet<string> = new Set(),
): Region[] {
  const tileById = new Map(tiles.map(t => [t.id, t]));
  const scoreById = new Map(scores.map(s => [s.tileId, s]));
  const growAt = GROW_FRACTION * params.anomalyZ;
  const core = new Set(flags.map(f => f.tileId));
  const eligible = (id: string) => {
    if (exclude.has(id)) return false;
    const s = scoreById.get(id);
    return !!s && s.leader >= growAt;
  };
  const seen = new Set<string>();
  const regions: Region[] = [];
  let n = 0;
  for (const f of flags) {
    if (seen.has(f.tileId)) continue;
    const members: AnalysisTile[] = [];
    const stack = [f.tileId];
    seen.add(f.tileId);
    while (stack.length) {
      const id = stack.pop()!;
      const t = tileById.get(id);
      if (!t) continue;
      members.push(t);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nid = `${t.col + dc}:${t.row + dr}`;
        if (seen.has(nid) || !tileById.has(nid)) continue;
        if (core.has(nid) || eligible(nid)) { seen.add(nid); stack.push(nid); }
      }
    }
    if (members.length < params.minRegionTiles) continue;
    const nF = TILE_FEATURE_NAMES.length;
    const meanFieldZ = new Array(nF).fill(0);
    let strengthSum = 0, maxStrength = 0, coreTiles = 0;
    const driverVotes = new Map<string, { d: Driver; n: number; zSum: number }>();
    for (const m of members) {
      const s = scoreById.get(m.id);
      if (!s) continue;
      for (let i = 0; i < nF; i++) meanFieldZ[i] += s.fieldZ[i] / members.length;
      strengthSum += s.strength;
      if (s.strength > maxStrength) maxStrength = s.strength;
      if (core.has(m.id)) coreTiles++;
      for (const d of s.drivers) {
        const k = `${d.feature}|${d.z > 0 ? "+" : "-"}`;
        const v = driverVotes.get(k) ?? { d, n: 0, zSum: 0 };
        v.n++; v.zSum += d.z;
        driverVotes.set(k, v);
      }
    }
    const drivers = [...driverVotes.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 2)
      .map(v => ({ feature: v.d.feature, z: v.zSum / v.n, scale: v.d.scale }));
    let latSum = 0, lngSum = 0;
    for (const m of members) { latSum += m.centroid.lat; lngSum += m.centroid.lng; }
    n++;
    regions.push({
      id: `r${n}`,
      tileIds: members.map(m => m.id),
      rings: traceOutline(members, lattice),
      centroid: { lat: latSum / members.length, lng: lngSum / members.length },
      areaM2: members.length * params.tileM * params.tileM,
      tileCount: members.length,
      coreTiles,
      meanStrength: strengthSum / members.length,
      maxStrength,
      meanFieldZ,
      drivers,
      klass: classify(meanFieldZ),
    });
  }
  regions.sort((a, b) => b.tileCount * b.meanStrength - a.tileCount * a.meanStrength);
  return regions;
}
