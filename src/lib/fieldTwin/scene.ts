// The render scene: a twin projected ONCE into zoom-0 Web Mercator units, with a grid index over every object so a
// frame draws only what the viewport holds, and the detail rules that decide what a frame shows.
//
// Four kinds of data stay apart (see docs/features/field-twin-visualization.md):
//   1. observations        the per-photo sightings inside each object's `members` (the bundle; the inspector reads them)
//   2. reconciled objects  trees, weeds, vegetation: their measured geometry, carried here unchanged
//   3. field intelligence  pressure cells, zones, clusters (intelligence.ts): aggregates computed from the objects
//   4. render geometry     the circles, simplified rows and cluster discs this module prepares for drawing only
// A detail rule never alters 1 to 3; it decides which of 2 to 4 is legible at the current ground scale.
import { type FieldIntelligence, type PressureClass, fieldIntelligence } from "./intelligence";
import type { LatLngPair, TwinBundle } from "./types";

const WORLD = 256;
/** Latitude/longitude to zoom-0 Web Mercator units (256 across the world). */
export function toWorld(lat: number, lng: number): [number, number] {
  const r = (lat * Math.PI) / 180;
  return [((lng + 180) / 360) * WORLD, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * WORLD];
}
/** Ground metres per zoom-0 unit at a latitude. */
export const metresPerUnitAt = (lat: number) => 156543.03392 * Math.cos((lat * Math.PI) / 180);

/** A uniform grid over points: which indices fall in a box. Built once; a query is a few map lookups. */
export class GridIndex {
  private cells = new Map<string, number[]>();
  constructor(private xs: ArrayLike<number>, private ys: ArrayLike<number>, readonly cell: number) {
    for (let i = 0; i < xs.length; i++) { const k = `${Math.floor(xs[i] / cell)},${Math.floor(ys[i] / cell)}`; (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(i); }
  }
  /** Indices inside [x0, x1] x [y0, y1], expanded by `pad` (the largest object radius, same units). */
  query(x0: number, y0: number, x1: number, y1: number, pad = 0, out: number[] = []): number[] {
    const c = this.cell;
    const i0 = Math.floor((x0 - pad) / c), i1 = Math.floor((x1 + pad) / c), j0 = Math.floor((y0 - pad) / c), j1 = Math.floor((y1 + pad) / c);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > this.cells.size * 4) { for (const list of this.cells.values()) for (const i of list) if (this.xs[i] >= x0 - pad && this.xs[i] <= x1 + pad && this.ys[i] >= y0 - pad && this.ys[i] <= y1 + pad) out.push(i); return out; }
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const list = this.cells.get(`${i},${j}`); if (list) for (const k of list) if (this.xs[k] >= x0 - pad && this.xs[k] <= x1 + pad && this.ys[k] >= y0 - pad && this.ys[k] <= y1 + pad) out.push(k); }
    return out;
  }
  /** The nearest index to (x, y) within `r`, by centre distance, or -1. */
  nearest(x: number, y: number, r: number): number {
    let best = -1, bd = r * r;
    for (const k of this.query(x - r, y - r, x + r, y + r)) { const d = (this.xs[k] - x) ** 2 + (this.ys[k] - y) ** 2; if (d <= bd) { bd = d; best = k; } }
    return best;
  }
}

/** Polygons packed flat: ring k is xy[off[k] .. off[k + 1]) as x, y pairs. */
export type PackedRings = { xy: Float64Array; off: Int32Array };
function pack(rings: LatLngPair[][]): PackedRings {
  const off = new Int32Array(rings.length + 1);
  let n = 0;
  rings.forEach((r, k) => { off[k] = n; n += r.length * 2; });
  off[rings.length] = n;
  const xy = new Float64Array(n);
  let p = 0;
  for (const r of rings) for (const [lat, lng] of r) { const [x, y] = toWorld(lat, lng); xy[p++] = x; xy[p++] = y; }
  return { xy, off };
}

export const WEED_STATUS = { verified: 0, single: 1, onTree: 2 } as const;
export const ROW_STATUS = { between: 0, onRow: 1, none: 2 } as const;
export const PRESSURE_INDEX: Record<PressureClass, number> = { none: 0, trace: 1, low: 2, moderate: 3, high: 4 };

export type Scene = {
  twin: TwinBundle;
  intel: FieldIntelligence;
  /** Ground metres per zoom-0 unit at the field. */
  mpu: number;
  weeds: { n: number; x: Float64Array; y: Float64Array; rM: Float32Array; status: Uint8Array; row: Uint8Array; id: Int32Array; rings: PackedRings; index: GridIndex; maxRM: number };
  trees: { n: number; x: Float64Array; y: Float64Array; rM: Float32Array; id: Int32Array; rowId: Int32Array; index: GridIndex; maxRM: number };
  inferred: { n: number; x: Float64Array; y: Float64Array; rM: number };
  vegetation: { n: number; x: Float64Array; y: Float64Array; rM: Float32Array; id: Int32Array; rings: PackedRings; index: GridIndex; maxRM: number };
  rows: { n: number; x1: Float64Array; y1: Float64Array; x2: Float64Array; y2: Float64Array; kept: Uint8Array; id: Int32Array };
  cells: { n: number; rings: PackedRings; cls: Uint8Array; coverPct: Float32Array; photos: Uint8Array; verified: Int32Array; single: Int32Array; inBlock: Uint8Array };
  zones: { id: number; cx: number; cy: number; edges: Float64Array; areaM2: number; coverM2: number; meanCoverPct: number; weeds: number }[];
  clusters: { n: number; x: Float64Array; y: Float64Array; rM: Float32Array; count: Int32Array; verified: Int32Array; coverM2: Float32Array; index: GridIndex; maxRM: number };
  block: Float64Array | null;
  imagery: Float64Array;
  footprints: PackedRings;
  /** Bounding box of everything, zoom-0 units. */
  bbox: [number, number, number, number];
};

/** Build the scene for a twin: one pass over the bundle, then draws are index lookups. */
export function buildScene(twin: TwinBundle, intel: FieldIntelligence = fieldIntelligence(twin)): Scene {
  const mpu = metresPerUnitAt(twin.origin.lat);
  const cell = 4 / mpu; // 4 m grid cells in zoom-0 units
  const ll = (lat: number, lng: number) => toWorld(lat, lng);
  const local = (e: number, n: number) => ll(...intel.frame.toLatLng(e, n));

  const W = twin.weeds, nw = W.length;
  const weeds = { n: nw, x: new Float64Array(nw), y: new Float64Array(nw), rM: new Float32Array(nw), status: new Uint8Array(nw), row: new Uint8Array(nw), id: new Int32Array(nw), rings: pack(W.map(w => w.ring)), index: null as unknown as GridIndex, maxRM: 0 };
  W.forEach((w, i) => {
    const [x, y] = ll(w.lat, w.lng);
    weeds.x[i] = x; weeds.y[i] = y; weeds.rM[i] = w.diameterM / 2; weeds.id[i] = w.id;
    weeds.status[i] = w.status === "verified" ? WEED_STATUS.verified : w.status === "single view" ? WEED_STATUS.single : WEED_STATUS.onTree;
    weeds.row[i] = w.rowStatus === "between rows" ? ROW_STATUS.between : w.rowStatus === "on a row" ? ROW_STATUS.onRow : ROW_STATUS.none;
    weeds.maxRM = Math.max(weeds.maxRM, w.diameterM / 2);
  });
  weeds.index = new GridIndex(weeds.x, weeds.y, cell);

  const T = twin.trees, nt = T.length;
  const trees = { n: nt, x: new Float64Array(nt), y: new Float64Array(nt), rM: new Float32Array(nt), id: new Int32Array(nt), rowId: new Int32Array(nt), index: null as unknown as GridIndex, maxRM: 0 };
  T.forEach((t, i) => { const [x, y] = ll(t.lat, t.lng); trees.x[i] = x; trees.y[i] = y; trees.rM[i] = t.crownRadiusM; trees.id[i] = t.id; trees.rowId[i] = t.rowId ?? -1; trees.maxRM = Math.max(trees.maxRM, t.crownRadiusM); });
  trees.index = new GridIndex(trees.x, trees.y, cell);

  const I = twin.inferredTrees;
  const inferred = { n: I.length, x: new Float64Array(I.length), y: new Float64Array(I.length), rM: intel.summary.medianCrownRadiusM };
  I.forEach((p, i) => { const [x, y] = ll(p.lat, p.lng); inferred.x[i] = x; inferred.y[i] = y; });

  const V = twin.vegetation, nv = V.length;
  const vegetation = { n: nv, x: new Float64Array(nv), y: new Float64Array(nv), rM: new Float32Array(nv), id: new Int32Array(nv), rings: pack(V.map(v => v.ring)), index: null as unknown as GridIndex, maxRM: 0 };
  V.forEach((v, i) => { const [x, y] = ll(v.lat, v.lng); vegetation.x[i] = x; vegetation.y[i] = y; const r = Math.sqrt(v.areaM2 / Math.PI) * 1.5; vegetation.rM[i] = r; vegetation.id[i] = v.id; vegetation.maxRM = Math.max(vegetation.maxRM, r); });
  vegetation.index = new GridIndex(vegetation.x, vegetation.y, cell);

  const R = twin.rows, nr = R.length;
  const rows = { n: nr, x1: new Float64Array(nr), y1: new Float64Array(nr), x2: new Float64Array(nr), y2: new Float64Array(nr), kept: new Uint8Array(nr), id: new Int32Array(nr) };
  R.forEach((r, i) => { const a = ll(...r.line[0]), b = ll(...r.line[r.line.length - 1]); rows.x1[i] = a[0]; rows.y1[i] = a[1]; rows.x2[i] = b[0]; rows.y2[i] = b[1]; rows.kept[i] = r.kept ? 1 : 0; rows.id[i] = r.id; });

  const C = intel.grid.cells, nc = C.length;
  const cells = { n: nc, rings: pack(C.map(c => c.ring.map(([e, n]) => intel.frame.toLatLng(e, n)))), cls: new Uint8Array(nc), coverPct: new Float32Array(nc), photos: new Uint8Array(nc), verified: new Int32Array(nc), single: new Int32Array(nc), inBlock: new Uint8Array(nc) };
  C.forEach((c, i) => { cells.cls[i] = PRESSURE_INDEX[c.cls]; cells.coverPct[i] = c.coverPct; cells.photos[i] = Math.min(255, c.photos); cells.verified[i] = c.verified; cells.single[i] = c.singleView; cells.inBlock[i] = c.inBlock ? 1 : 0; });

  const zones = intel.zones.map(z => { const [cx, cy] = local(z.centre[0], z.centre[1]); const edges = new Float64Array(z.edges.length * 4); z.edges.forEach(([a, b], k) => { const p = local(a[0], a[1]), q = local(b[0], b[1]); edges[4 * k] = p[0]; edges[4 * k + 1] = p[1]; edges[4 * k + 2] = q[0]; edges[4 * k + 3] = q[1]; }); return { id: z.id, cx, cy, edges, areaM2: z.areaM2, coverM2: z.coverM2, meanCoverPct: z.meanCoverPct, weeds: z.weeds }; });

  const K = intel.clusters, nk = K.length;
  const clusters = { n: nk, x: new Float64Array(nk), y: new Float64Array(nk), rM: new Float32Array(nk), count: new Int32Array(nk), verified: new Int32Array(nk), coverM2: new Float32Array(nk), index: null as unknown as GridIndex, maxRM: 0 };
  K.forEach((k, i) => { const [x, y] = local(k.centre[0], k.centre[1]); clusters.x[i] = x; clusters.y[i] = y; clusters.rM[i] = k.radiusM; clusters.count[i] = k.count; clusters.verified[i] = k.verified; clusters.coverM2[i] = k.coverM2; clusters.maxRM = Math.max(clusters.maxRM, k.radiusM); });
  clusters.index = new GridIndex(clusters.x, clusters.y, cell);

  const ringOf = (pts: [number, number][]) => { const out = new Float64Array(pts.length * 2); pts.forEach(([e, n], i) => { const [x, y] = local(e, n); out[2 * i] = x; out[2 * i + 1] = y; }); return out; };
  const block = intel.block ? ringOf(intel.block) : null;
  const imagery = ringOf(intel.imagery);
  const footprints = pack(twin.footprints.map(f => f.ring));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < imagery.length; i += 2) { x0 = Math.min(x0, imagery[i]); x1 = Math.max(x1, imagery[i]); y0 = Math.min(y0, imagery[i + 1]); y1 = Math.max(y1, imagery[i + 1]); }
  return { twin, intel, mpu, weeds, trees, inferred, vegetation, rows, cells, zones, clusters, block, imagery, footprints, bbox: [x0, y0, x1, y1] };
}

// ------------------------------------------------------------------------------------------------------------------
// Detail rules: what is legible at a ground scale, from rendered feature sizes, as blend factors 0 to 1.
// ------------------------------------------------------------------------------------------------------------------

export type DetailLevel = "field" | "row" | "plant";

export type Detail = {
  level: DetailLevel;
  /** Ground metres per screen pixel. */
  mpp: number;
  /** Measured weed outlines and vegetation patches (the plant level). */
  outlines: number;
  /** Weed clusters, the row-level stand-in for the outlines. */
  clusters: number;
  clusterLabels: boolean;
  /** Tree crowns at their measured radius; tree points when crowns are too small. */
  crowns: number;
  treePoints: number;
  inferred: number;
  /** Pressure cells and scouting zones (the field level). */
  pressure: number;
  zones: number;
  zoneLabels: boolean;
  rowWidth: number;
  /** The field's surroundings (a muted basemap): 1 when the field is seen small within them, 0 by the row level. */
  surroundings: number;
  /** What the thresholds were judged on: rendered sizes in screen pixels. */
  px: { weed: number; crown: number; cluster: number; cell: number };
};

const ramp = (v: number, lo: number, hi: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

/**
 * The detail for a view, from the sizes real features render at: the median verified weed, the median crown, a
 * 1.5 m cluster and a pressure cell. Zoom numbers never appear here, so the same rules hold at any latitude.
 */
export function detailFor(mpp: number, scene: Pick<Scene, "intel">): Detail {
  const weed = scene.intel.summary.medianWeedDiameterM / mpp, crown = (2 * scene.intel.summary.medianCrownRadiusM) / mpp, cluster = 1.5 / mpp, cell = scene.intel.grid.cellM / mpp;
  const outlines = ramp(weed, 3, 7);
  const crowns = ramp(crown, 8, 16);
  const clusters = ramp(cluster, 6, 14) * (1 - outlines);
  // Pressure cells give way as the crowns come in: a cell of 4 m at 16 px is the field seen whole, at 40 px the rows.
  const pressure = 1 - ramp(cell, 16, 40);
  const zones = 1 - ramp(cell, 20, 50);
  return {
    level: outlines >= 0.5 ? "plant" : crowns >= 0.5 || clusters >= 0.5 ? "row" : "field",
    mpp, outlines, clusters, clusterLabels: cluster >= 28 && outlines < 0.5, crowns, treePoints: ramp(crown, 4, 8) * (1 - crowns) * (1 - pressure), inferred: crowns,
    pressure, zones, zoneLabels: zones > 0.3 && cell >= 6, rowWidth: 1 + 1.5 * ramp(crown, 2, 16),
    surroundings: 1 - ramp(cell, 24, 70),
    px: { weed, crown, cluster, cell },
  };
}

/** Ground metres per pixel at a Web Mercator zoom and latitude. */
export const metresPerPixel = (zoom: number, lat: number) => metresPerUnitAt(lat) / 2 ** zoom;

/** The zoom at which a ground length renders at `px` pixels. */
export const zoomForSize = (metres: number, px: number, lat: number) => Math.log2((metresPerUnitAt(lat) * px) / metres);
