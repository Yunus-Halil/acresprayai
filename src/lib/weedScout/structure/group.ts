// The grouping: items in a metric frame become individuals, clusters and
// zones, with every square centimetre in one account. Pure.
//
//   1. the scale: minMeasurableM = minPixelsAcross x gsdM. A fragment, or
//      an object under that size, is micro vegetation; an object cut by the
//      edge is set aside; the crop is counted and left alone
//   2. the clusters: single linkage over the measurable off-pattern (and
//      unplaced) objects, two joined when their canopies come within
//      clusterGapM edge to edge (centre distance less both radii), on a
//      grid hash so a field of twenty thousand objects links in a moment.
//      A group of one is an individual; a group of two or more is a cluster
//      with the sum of its members' areas, the hull around their canopies,
//      and no plant count
//   3. the zones: a cell grid over the bounds; every micro item lands in its
//      cell; a cell is a zone when its micro coverage or count passes the
//      floor. Measurable objects are counted per cell and never re-added
//   4. the accounting, which a test holds to the identity
//      total = crop + individuals + clusters + micro + border
//
// Nearby is not the same as one cluster: two plants 40 cm apart edge to
// edge with a 15 cm gap setting are two individuals. The gap is physical,
// so the same field reads the same from a photo and from the map.
import { convexHull, maxFeret } from "../sizing/segment";
import { type Accounting, type Cluster, type Individual, type Pt, type Structure, type StructureParams, STRUCTURE_VERSION, type VegItem, type Zone, DEFAULT_STRUCTURE_PARAMS } from "./types";

export type Bounds = { x0: number; y0: number; x1: number; y1: number };

/** Shoelace area of a ring, metres squared. */
export function polygonArea(ring: Pt[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s) / 2;
}

/** Eight points on an object's disc, for the hull: a canopy is round-ish, and its mask outline is not kept here. */
const discPoints = (it: VegItem): Pt[] => {
  const r = it.equivDiameterM / 2;
  const out: Pt[] = [];
  for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; out.push({ x: it.x + r * Math.cos(a), y: it.y + r * Math.sin(a) }); }
  return out;
};

/** Which items touch: single linkage within `gapM` edge to edge. Returns a root per item index. */
export function linkByGap(items: VegItem[], gapM: number): Int32Array {
  const n = items.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  if (n < 2) return parent;
  let maxD = 0;
  for (const it of items) if (it.equivDiameterM > maxD) maxD = it.equivDiameterM;
  const cell = Math.max(1e-3, gapM + maxD);
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  items.forEach((it, i) => { const k = key(it.x, it.y); const l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]); });
  items.forEach((a, i) => {
    const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
        if (j <= i) continue;
        const b = items[j];
        const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.equivDiameterM / 2 - b.equivDiameterM / 2;
        if (gap <= gapM) { const ri = find(i), rj = find(j); if (ri !== rj) parent[rj] = ri; }
      }
    }
  });
  for (let i = 0; i < n; i++) parent[i] = find(i);
  return parent;
}

export type GroupInput = {
  items: VegItem[];
  gsdM: number;
  /** The ground the zones tile; from the items when absent. */
  bounds?: Bounds | null;
  params?: Partial<StructureParams>;
  /** Whether a trusted row pattern classed the items; false makes every object "vegetation, rows unknown". */
  rowsKnown?: boolean;
};

export function groupVegetation(input: GroupInput): Structure {
  const params: StructureParams = { ...DEFAULT_STRUCTURE_PARAMS, ...(input.params ?? {}) };
  const { gsdM, items } = input;
  if (!(gsdM > 0)) throw new Error("A pixel size is needed before vegetation can be grouped.");
  const rowsKnown = input.rowsKnown ?? true;
  const minMeasurableM = params.minPixelsAcross * gsdM;
  const notes: string[] = [];
  const acc: Accounting = {
    totalM2: 0, cropM2: 0, individualsM2: 0, clustersM2: 0, microM2: 0, borderM2: 0,
    counts: { items: items.length, crop: 0, individuals: 0, clusters: 0, clusterMembers: 0, micro: 0, border: 0, zones: 0 },
  };

  // 1. The scale, and the accounts that need no grouping.
  const measurable: VegItem[] = [];
  const micro: (VegItem & { fragment: boolean })[] = [];
  for (const it of items) {
    acc.totalM2 += it.areaM2;
    if (it.cls === "crop") { acc.cropM2 += it.areaM2; acc.counts.crop++; continue; }
    if (it.cls === "fragment") { micro.push({ ...it, fragment: true }); continue; }
    if (it.touchesBorder) { acc.borderM2 += it.areaM2; acc.counts.border++; continue; }
    if (it.equivDiameterM < minMeasurableM) { micro.push({ ...it, fragment: false }); continue; }
    measurable.push(it);
  }

  // 2. The clusters and the individuals.
  const roots = linkByGap(measurable, params.clusterGapM);
  const groups = new Map<number, VegItem[]>();
  measurable.forEach((it, i) => { const l = groups.get(roots[i]); if (l) l.push(it); else groups.set(roots[i], [it]); });
  const individuals: Individual[] = [];
  const clusters: Cluster[] = [];
  const known = (it: VegItem) => rowsKnown && it.cls === "off-pattern";
  for (const members of groups.values()) {
    if (members.length === 1) {
      const it = members[0];
      individuals.push({
        id: `i:${it.id}`, itemId: it.id, x: it.x, y: it.y, areaM2: it.areaM2, equivDiameterM: it.equivDiameterM,
        pixelsAcross: +(it.equivDiameterM / gsdM).toFixed(1), kind: known(it) ? (it.kind ?? "off-row") : null, rowsKnown: known(it),
      });
      acc.individualsM2 += it.areaM2;
      continue;
    }
    const canopy = members.reduce((s, m) => s + m.areaM2, 0);
    const hull = convexHull(members.flatMap(discPoints));
    const xs = hull.map(p => p.x), ys = hull.map(p => p.y);
    clusters.push({
      id: `k:${members.map(m => m.id).sort()[0]}`,
      x: members.reduce((s, m) => s + m.x * m.areaM2, 0) / canopy, y: members.reduce((s, m) => s + m.y * m.areaM2, 0) / canopy,
      members: members.map(m => m.id), components: members.length, canopyAreaM2: canopy,
      hull, footprintAreaM2: polygonArea(hull),
      boxWidthM: Math.max(...xs) - Math.min(...xs), boxHeightM: Math.max(...ys) - Math.min(...ys), maxExtentM: maxFeret(hull),
      plantCount: null,
      kinds: { offRow: members.filter(m => m.kind === "off-row").length, between: members.filter(m => m.kind === "between plants").length },
      rowsKnown: members.every(known),
    });
    acc.clustersM2 += canopy;
    acc.counts.clusterMembers += members.length;
  }
  acc.counts.individuals = individuals.length;
  acc.counts.clusters = clusters.length;

  // 3. The zones.
  const all = [...measurable, ...micro];
  const bounds: Bounds = input.bounds ?? (all.length
    ? { x0: Math.min(...all.map(i => i.x)), y0: Math.min(...all.map(i => i.y)), x1: Math.max(...all.map(i => i.x)) + 1e-9, y1: Math.max(...all.map(i => i.y)) + 1e-9 }
    : { x0: 0, y0: 0, x1: 0, y1: 0 });
  const cellM = params.cellM;
  const cols = Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / cellM)), rows = Math.max(1, Math.ceil((bounds.y1 - bounds.y0) / cellM));
  const cellOf = (x: number, y: number) => {
    const c = Math.min(cols - 1, Math.max(0, Math.floor((x - bounds.x0) / cellM))), r = Math.min(rows - 1, Math.max(0, Math.floor((y - bounds.y0) / cellM)));
    return r * cols + c;
  };
  const cells = new Map<number, { microM2: number; count: number; fragments: number; sub: number; measurable: number }>();
  const at = (i: number) => { let c = cells.get(i); if (!c) { c = { microM2: 0, count: 0, fragments: 0, sub: 0, measurable: 0 }; cells.set(i, c); } return c; };
  for (const m of micro) {
    const c = at(cellOf(m.x, m.y));
    c.microM2 += m.areaM2; acc.microM2 += m.areaM2;
    const n = m.fragment ? (m.count ?? 1) : 1;
    c.count += n; if (m.fragment) c.fragments += n; else c.sub++;
    acc.counts.micro += n;
  }
  for (const it of measurable) at(cellOf(it.x, it.y)).measurable++;
  const zones: Zone[] = [];
  for (const [i, c] of cells) {
    const col = i % cols, row = (i - col) / cols;
    const x0 = bounds.x0 + col * cellM, y0 = bounds.y0 + row * cellM;
    const x1 = Math.min(bounds.x1, x0 + cellM), y1 = Math.min(bounds.y1, y0 + cellM);
    const cellAreaM2 = Math.max(1e-6, (x1 - x0) * (y1 - y0));
    const coverage = c.microM2 / cellAreaM2;
    if (c.count === 0 || (coverage < params.zoneMinCoverage && c.count < params.zoneMinCount)) continue;
    zones.push({
      id: `z:${col}:${row}`, col, row, x0, y0, x1, y1, cellAreaM2,
      microAreaM2: c.microM2, coverage, count: c.count, density: c.count / cellAreaM2,
      fragments: c.fragments, subMeasurable: c.sub, measurableObjects: c.measurable, rowsKnown,
    });
  }
  zones.sort((a, b) => b.coverage - a.coverage);
  acc.counts.zones = zones.length;

  // 4. Said plainly.
  const cm = (m: number) => `${(m * 100).toFixed(0)} cm`;
  notes.push(`At ${(gsdM * 100).toFixed(1)} cm per pixel an object under ${cm(minMeasurableM)} across is not measured on its own; ${acc.counts.micro.toLocaleString()} such fragments and objects went to ${zones.length} coverage zone(s) of ${cellM} m.`);
  if (clusters.length) notes.push(`${clusters.length} cluster(s) of canopies within ${cm(params.clusterGapM)} of each other, ${acc.counts.clusterMembers} objects in all; no plant count is claimed for them.`);
  if (!rowsKnown) notes.push("No trusted row pattern here: the objects are vegetation, not known to be off the crop.");
  return { version: STRUCTURE_VERSION, params, gsdM, minMeasurableM, individuals, clusters, zones, accounting: acc, notes };
}

/** The identity every structure keeps, as a number a test can read: total less the sum of the accounts. */
export function accountingGap(a: Accounting): number {
  return a.totalM2 - (a.cropM2 + a.individualsM2 + a.clustersM2 + a.microM2 + a.borderM2);
}
