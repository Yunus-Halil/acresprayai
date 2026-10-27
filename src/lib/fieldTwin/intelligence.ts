// Field intelligence derived from a twin's reconciled objects: the orchard block, weed pressure on the ground,
// scouting zones, weed clusters, and how many photographs cover each piece of ground.
//
// These are AGGREGATES over the objects. They never replace or alter the objects themselves: a pressure cell says
// how much verified weed cover its ground holds, and the weeds that make it up remain in the bundle, each with its
// own measured outline. Everything is computed in the field's own frame (metres along and across the planting
// direction) so the cells follow the alleys rather than the compass.
import type { LatLngPair, TwinBundle, TwinWeed } from "./types";

export type LocalFrame = {
  /** Metres east and north of the twin's origin. */
  toLocal: (lat: number, lng: number) => [number, number];
  toLatLng: (e: number, n: number) => LatLngPair;
  /** Unit vector along the rows (east, north). */
  ux: number;
  uy: number;
  /** Metres along the rows and across them (positive to the left of the along direction). */
  toField: (e: number, n: number) => [number, number];
  fromField: (along: number, across: number) => [number, number];
};

export function localFrame(twin: TwinBundle): LocalFrame {
  const lat0 = twin.origin.lat, lng0 = twin.origin.lng;
  const mLat = 111_320, mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const th = (twin.field.rowDirectionDeg * Math.PI) / 180, ux = Math.cos(th), uy = Math.sin(th);
  return {
    toLocal: (lat, lng) => [(lng - lng0) * mLng, (lat - lat0) * mLat],
    toLatLng: (e, n) => [lat0 + n / mLat, lng0 + e / mLng],
    ux, uy,
    toField: (e, n) => [e * ux + n * uy, -e * uy + n * ux],
    fromField: (along, across) => [along * ux - across * uy, along * uy + across * ux],
  };
}

/** Convex hull of points in any planar frame (Andrew's monotone chain), counterclockwise. */
export function convexHull<T extends [number, number]>(pts: T[]): T[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: T, a: T, b: T) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: T[] = [], up: T[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export function pointInRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The orchard block: the ground the kept rows occupy, half a row spacing beyond the outer rows and half a plant
 * spacing beyond each row's ends. It follows the rows' actual ends, so a block whose rows stop at different places
 * is not squared off. Null when the twin has no kept rows. In local metres.
 */
export function orchardBlock(twin: TwinBundle, frame: LocalFrame = localFrame(twin)): [number, number][] | null {
  const rows = twin.rows.filter(r => r.kept && r.line.length >= 2);
  if (!rows.length) return null;
  const halfAlong = twin.field.plantSpacingM / 2, halfAcross = twin.field.rowSpacingM / 2;
  const segs = rows.map(r => {
    const ends = r.line.map(([lat, lng]) => frame.toField(...frame.toLocal(lat, lng)));
    const alongs = ends.map(p => p[0]), across = ends.reduce((s, p) => s + p[1], 0) / ends.length;
    return { a0: Math.min(...alongs) - halfAlong, a1: Math.max(...alongs) + halfAlong, across };
  }).sort((p, q) => p.across - q.across);
  // Left side top to bottom, right side bottom to top: a polygon that steps with each row's own ends.
  const left: [number, number][] = [], right: [number, number][] = [];
  segs.forEach((s, i) => {
    const lo = i === 0 ? s.across - halfAcross : (s.across + segs[i - 1].across) / 2;
    const hi = i === segs.length - 1 ? s.across + halfAcross : (s.across + segs[i + 1].across) / 2;
    left.push([s.a0, lo], [s.a0, hi]);
    right.push([s.a1, lo], [s.a1, hi]);
  });
  return [...left, ...right.reverse()].map(([al, ac]) => frame.fromField(al, ac));
}

/** The ground the photographs cover: the convex hull of every footprint, local metres. */
export function imageryHull(twin: TwinBundle, frame: LocalFrame = localFrame(twin)): [number, number][] {
  return convexHull(twin.footprints.flatMap(f => f.ring.map(([lat, lng]) => frame.toLocal(lat, lng))));
}

export type PressureClass = "none" | "trace" | "low" | "moderate" | "high";

/**
 * Weed pressure as percent of the ground covered by verified weed candidates, per cell. The bands are fixed so the
 * same colour means the same cover on every field; they are not quantiles of this field.
 */
export const PRESSURE_BANDS: { cls: PressureClass; fromPct: number }[] = [
  { cls: "none", fromPct: 0 }, { cls: "trace", fromPct: 0.05 }, { cls: "low", fromPct: 0.5 }, { cls: "moderate", fromPct: 1.5 }, { cls: "high", fromPct: 4 },
];
export function pressureClass(coverPct: number): PressureClass {
  let cls: PressureClass = "none";
  for (const b of PRESSURE_BANDS) if (coverPct >= b.fromPct) cls = b.cls;
  return cls;
}

export type PressureCell = {
  /** Cell indices along and across the rows. */
  i: number;
  j: number;
  /** Corners, local metres, counterclockwise. */
  ring: [number, number][];
  centre: [number, number];
  cellM: number;
  verified: number;
  singleView: number;
  /** Ground covered by verified weed candidates, square metres and percent of the cell. */
  coverM2: number;
  coverPct: number;
  /** Cover percent averaged with the neighbouring cells (3 x 3), for a wash without cell edges. */
  smoothPct: number;
  cls: PressureClass;
  /** Photographs whose footprint holds the cell centre. */
  photos: number;
  /** Inside the orchard block (when the twin has one). */
  inBlock: boolean;
};

export type PressureGrid = { cellM: number; cells: PressureCell[]; byIndex: Map<string, PressureCell> };

/**
 * Cells of `cellM` metres aligned to the rows, over the imagery hull. A cell is listed when the ground is covered by
 * at least one photograph; cells with no weeds are listed too, so "none" is a statement, not an absence.
 */
export function pressureGrid(twin: TwinBundle, cellM = 4, frame: LocalFrame = localFrame(twin)): PressureGrid {
  const hull = imageryHull(twin, frame);
  const block = orchardBlock(twin, frame);
  const foot = twin.footprints.map(f => f.ring.map(([lat, lng]) => frame.toLocal(lat, lng)));
  const inField = hull.map(p => frame.toField(p[0], p[1]));
  const i0 = Math.floor(Math.min(...inField.map(p => p[0])) / cellM), i1 = Math.ceil(Math.max(...inField.map(p => p[0])) / cellM);
  const j0 = Math.floor(Math.min(...inField.map(p => p[1])) / cellM), j1 = Math.ceil(Math.max(...inField.map(p => p[1])) / cellM);
  const byIndex = new Map<string, PressureCell>();
  const cells: PressureCell[] = [];
  for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
    const centre = frame.fromField((i + 0.5) * cellM, (j + 0.5) * cellM);
    if (!pointInRing(centre[0], centre[1], hull)) continue;
    const photos = foot.reduce((s, r) => s + (pointInRing(centre[0], centre[1], r) ? 1 : 0), 0);
    if (!photos) continue;
    const ring: [number, number][] = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => frame.fromField(a * cellM, b * cellM));
    const cell: PressureCell = { i, j, ring, centre, cellM, verified: 0, singleView: 0, coverM2: 0, coverPct: 0, smoothPct: 0, cls: "none", photos, inBlock: block ? pointInRing(centre[0], centre[1], block) : true };
    byIndex.set(`${i},${j}`, cell);
    cells.push(cell);
  }
  for (const w of twin.weeds) {
    if (w.status === "on a tree") continue;
    const [al, ac] = frame.toField(...frame.toLocal(w.lat, w.lng));
    const cell = byIndex.get(`${Math.floor(al / cellM)},${Math.floor(ac / cellM)}`);
    if (!cell) continue;
    if (w.status === "verified") { cell.verified++; cell.coverM2 += w.areaM2; } else cell.singleView++;
  }
  for (const c of cells) { c.coverPct = (100 * c.coverM2) / (cellM * cellM); c.cls = pressureClass(c.coverPct); }
  for (const c of cells) {
    let s = 0, n = 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const q = byIndex.get(`${c.i + di},${c.j + dj}`); if (q) { s += q.coverPct; n++; } }
    c.smoothPct = n ? s / n : c.coverPct;
  }
  return { cellM, cells, byIndex };
}

export type ScoutingZone = {
  id: number;
  /** 1 for the heaviest zones (the first three by verified cover), 2 for the next five, 3 for the rest. */
  priority: 1 | 2 | 3;
  cells: PressureCell[];
  areaM2: number;
  coverM2: number;
  meanCoverPct: number;
  weeds: number;
  centre: [number, number];
  /** Outer edges of the zone's cells, local metres: segments to draw. */
  edges: [[number, number], [number, number]][];
  /** The same edges chained into closed rings (outer boundary first, then holes), corners rounded for drawing. */
  rings: [number, number][][];
};

/**
 * Scouting zones: connected runs of cells at or above `fromPct` cover, at least `minCells` cells, ranked by total
 * verified cover. A zone is a place worth walking to; it holds the pressure cells that make it, nothing more.
 */
export function scoutingZones(grid: PressureGrid, fromPct = 1.5, minCells = 3): ScoutingZone[] {
  const seen = new Set<PressureCell>();
  const zones: ScoutingZone[] = [];
  for (const start of grid.cells) {
    if (seen.has(start) || start.coverPct < fromPct) continue;
    const members: PressureCell[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const c = stack.pop()!;
      members.push(c);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = grid.byIndex.get(`${c.i + di},${c.j + dj}`);
        if (n && !seen.has(n) && n.coverPct >= fromPct) { seen.add(n); stack.push(n); }
      }
    }
    if (members.length < minCells) continue;
    const set = new Set(members);
    const edges: ScoutingZone["edges"] = [];
    for (const c of members) {
      const sides: [[number, number], [number, number], [number, number]][] = [[[1, 0], c.ring[1], c.ring[2]], [[-1, 0], c.ring[3], c.ring[0]], [[0, 1], c.ring[2], c.ring[3]], [[0, -1], c.ring[0], c.ring[1]]];
      for (const [[di, dj], a, b] of sides) { const n = grid.byIndex.get(`${c.i + di},${c.j + dj}`); if (!n || !set.has(n)) edges.push([a, b]); }
    }
    const areaM2 = members.length * grid.cellM * grid.cellM, coverM2 = members.reduce((s, c) => s + c.coverM2, 0);
    zones.push({
      id: 0, priority: 3, cells: members, areaM2, coverM2, meanCoverPct: (100 * coverM2) / areaM2, weeds: members.reduce((s, c) => s + c.verified, 0),
      centre: [members.reduce((s, c) => s + c.centre[0], 0) / members.length, members.reduce((s, c) => s + c.centre[1], 0) / members.length], edges,
      rings: chainEdges(edges).map(r => roundCorners(r, 2)),
    });
  }
  zones.sort((a, b) => b.coverM2 - a.coverM2);
  zones.forEach((z, k) => { z.id = k + 1; z.priority = k < 3 ? 1 : k < 8 ? 2 : 3; });
  return zones;
}

/** Closed rings from a set of boundary segments (each vertex meets exactly two segments), longest ring first. */
export function chainEdges(edges: [[number, number], [number, number]][]): [number, number][][] {
  const key = (p: [number, number]) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const next = new Map<string, { p: [number, number]; q: [number, number]; used: boolean }[]>();
  const segs = edges.map(([p, q]) => ({ p, q, used: false }));
  for (const s of segs) for (const [a] of [[s.p], [s.q]] as const) (next.get(key(a)) ?? next.set(key(a), []).get(key(a))!).push(s);
  const rings: [number, number][][] = [];
  for (const start of segs) {
    if (start.used) continue;
    const ring: [number, number][] = [start.p];
    let cur = start, at = start.q;
    start.used = true;
    for (let guard = 0; guard < segs.length; guard++) {
      ring.push(at);
      const cand = (next.get(key(at)) ?? []).find(s => !s.used);
      if (!cand) break;
      cand.used = true;
      at = key(cand.p) === key(at) ? cand.q : cand.p;
      cur = cand;
      if (key(at) === key(start.p)) break;
    }
    void cur;
    if (ring.length >= 4) rings.push(ring);
  }
  return rings.sort((a, b) => b.length - a.length);
}

/** Chaikin's corner cutting, `n` passes: a stepped cell boundary becomes a soft region edge (shape kept, corners rounded). */
export function roundCorners(ring: [number, number][], n = 2): [number, number][] {
  let r = ring[0] !== undefined && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  for (let pass = 0; pass < n; pass++) {
    const out: [number, number][] = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    r = out;
  }
  return r;
}

export type WeedCluster = {
  id: number;
  centre: [number, number];
  /** Extent for drawing: the members' spread about the centre plus the median member's radius, metres. */
  radiusM: number;
  count: number;
  verified: number;
  coverM2: number;
  weedIds: number[];
};

/**
 * Weed candidates grouped on a `cellM` grid aligned to the rows, for the row-level view: a stand-in that says how
 * many candidates stand here and how much ground they cover. The candidates themselves are drawn at the plant level.
 */
export function weedClusters(twin: TwinBundle, cellM = 1.5, frame: LocalFrame = localFrame(twin), keep: (w: TwinWeed) => boolean = w => w.status !== "on a tree"): WeedCluster[] {
  const groups = new Map<string, TwinWeed[]>();
  for (const w of twin.weeds) {
    if (!keep(w)) continue;
    const [al, ac] = frame.toField(...frame.toLocal(w.lat, w.lng));
    const k = `${Math.floor(al / cellM)},${Math.floor(ac / cellM)}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(w);
  }
  const out: WeedCluster[] = [];
  let id = 1;
  for (const ws of groups.values()) {
    const pts = ws.map(w => frame.toLocal(w.lat, w.lng));
    const wsum = ws.reduce((s, w) => s + Math.max(w.areaM2, 1e-4), 0);
    const ce = ws.reduce((s, w, k) => s + pts[k][0] * Math.max(w.areaM2, 1e-4), 0) / wsum, cn = ws.reduce((s, w, k) => s + pts[k][1] * Math.max(w.areaM2, 1e-4), 0) / wsum;
    const spread = Math.sqrt(pts.reduce((s, p) => s + (p[0] - ce) ** 2 + (p[1] - cn) ** 2, 0) / pts.length);
    const radii = ws.map(w => w.diameterM / 2).sort((a, b) => a - b);
    // At least half a metre across, so a cluster reads as a patch of ground rather than a dot.
    out.push({ id: id++, centre: [ce, cn], radiusM: Math.max(0.5, spread + radii[radii.length >> 1]), count: ws.length, verified: ws.filter(w => w.status === "verified").length, coverM2: ws.reduce((s, w) => s + w.areaM2, 0), weedIds: ws.map(w => w.id) });
  }
  return out;
}

export type FieldIntelligence = {
  frame: LocalFrame;
  block: [number, number][] | null;
  imagery: [number, number][];
  grid: PressureGrid;
  zones: ScoutingZone[];
  clusters: WeedCluster[];
  summary: {
    blockHa: number | null;
    imageryHa: number;
    cellsWithWeeds: number;
    cellsSingleCoverage: number;
    byClass: Record<PressureClass, number>;
    medianWeedDiameterM: number;
    medianCrownRadiusM: number;
  };
};

const polyArea = (ring: [number, number][]) => Math.abs(ring.reduce((s, [x, y], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return s + x * y2 - x2 * y; }, 0)) / 2;
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

/** Everything the map's wide views stand on, computed once per twin. */
export function fieldIntelligence(twin: TwinBundle, cellM = 4): FieldIntelligence {
  const frame = localFrame(twin);
  const block = orchardBlock(twin, frame);
  const imagery = imageryHull(twin, frame);
  const grid = pressureGrid(twin, cellM, frame);
  const zones = scoutingZones(grid);
  const clusters = weedClusters(twin, 1.5, frame);
  const byClass: Record<PressureClass, number> = { none: 0, trace: 0, low: 0, moderate: 0, high: 0 };
  for (const c of grid.cells) byClass[c.cls]++;
  return {
    frame, block, imagery, grid, zones, clusters,
    summary: {
      blockHa: block ? polyArea(block) / 10_000 : null, imageryHa: polyArea(imagery) / 10_000,
      cellsWithWeeds: grid.cells.filter(c => c.verified > 0).length, cellsSingleCoverage: grid.cells.filter(c => c.photos < 2).length, byClass,
      medianWeedDiameterM: median(twin.weeds.filter(w => w.status === "verified").map(w => w.diameterM)) || 0.2,
      medianCrownRadiusM: median(twin.trees.map(t => t.crownRadiusM)) || 1,
    },
  };
}
