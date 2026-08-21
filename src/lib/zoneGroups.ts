// Treatment zones, clustered into planning groups.
//
// WHY THIS EXISTS. The planner used to treat every zone as an island: cover a
// strip, fly away, come back for the next one. On a field whose problem area
// was marked as a cluster of parallel strips that produced a route made mostly
// of transit — the aircraft bounced between neighbours that were metres apart
// and should have been flown as one sweep. Grouping is the fix, and it is a
// ROUTING change only: the group is a planning unit, not a new shape to spray.
// Coverage still comes from the member rings, one at a time, exactly as marked.
//
// SAME RATE IS PART OF THE DEFINITION. A boom lays one rate at a time, so two
// zones at different rates cannot share a pass however close they sit. A group
// is therefore same-rate by construction, and zones of different rates stay
// separate groups even when they touch.
import {
  type LatLng2, M_PER_DEG_LAT, centroidOfRings, mPerDegLng, pointInRing,
} from "./geo";

export type GroupableZone = {
  id: string;
  ring: LatLng2[];
  /**
   * Litres per hectare. Undefined means the caller has not resolved a rate for
   * this zone yet; those group only with each other, never with a rated zone,
   * because "unknown" is not a rate two zones can be shown to share.
   */
  rateLha?: number;
};

export type ZoneGroup<Z extends GroupableZone = GroupableZone> = {
  /** Stable for a given membership: derived from the lowest member id. */
  id: string;
  zones: Z[];
  /** The member rings — the group's footprint is their union, never a hull. */
  rings: LatLng2[][];
  rateLha?: number;
};

/**
 * How far apart two zones may sit and still be flown as one sweep, expressed
 * in swath widths.
 *
 * TUNABLE STARTING VALUE, not a measured figure. 1.5 swaths is chosen because
 * it is wide enough to pull a cluster of strips separated by a lane or two of
 * unmarked ground into one continuous pass set, and narrow enough that two
 * genuinely separate patches on opposite sides of a field stay separate. The
 * gap is still flown boom-off — grouping never fills it.
 */
export const DEFAULT_GROUPING_SWATHS = 1.5;

/** The default grouping distance for a given swath, in metres. */
export const groupingDistanceM = (swathM: number, swaths = DEFAULT_GROUPING_SWATHS): number =>
  Math.max(0, swathM) * swaths;

/** Rate bucket key. Rounded so float noise cannot split one rate into two. */
const rateKey = (r: number | undefined): string =>
  r == null || !Number.isFinite(r) ? "\u0000none" : r.toFixed(4);

type XY = { x: number; y: number };

/** Metres east/north about `origin`. */
const local = (p: LatLng2, origin: LatLng2): XY => ({
  x: (p.lng - origin.lng) * mPerDegLng(origin.lat),
  y: (p.lat - origin.lat) * M_PER_DEG_LAT,
});

/** Shortest distance between two segments, in the local metric frame. */
function segSegDist(a: XY, b: XY, c: XY, d: XY): number {
  const ux = b.x - a.x, uy = b.y - a.y;
  const vx = d.x - c.x, vy = d.y - c.y;
  const wx = a.x - c.x, wy = a.y - c.y;
  const uu = ux * ux + uy * uy, uv = ux * vx + uy * vy, vv = vx * vx + vy * vy;
  const uw = ux * wx + uy * wy, vw = vx * wx + vy * wy;
  const den = uu * vv - uv * uv;
  let s: number, t: number;
  if (den < 1e-12) {
    // Parallel: pin one parameter and solve the other.
    s = 0;
    t = vv > 0 ? vw / vv : 0;
  } else {
    s = (uv * vw - vv * uw) / den;
    t = (uu * vw - uv * uw) / den;
  }
  s = Math.max(0, Math.min(1, s));
  t = Math.max(0, Math.min(1, t));
  const px = a.x + ux * s, py = a.y + uy * s;
  const qx = c.x + vx * t, qy = c.y + vy * t;
  return Math.hypot(px - qx, py - qy);
}

/**
 * Gap between two rings, in metres. Zero when they touch or overlap.
 *
 * Edge-to-edge rather than centroid-to-centroid: two long strips lying side by
 * side are metres apart along their whole length, and a centroid measure would
 * call them as distant as their length.
 */
export function ringGapM(a: LatLng2[], b: LatLng2[]): number {
  if (a.length < 3 || b.length < 3) return Infinity;
  const origin = a[0];
  const A = a.map(p => local(p, origin));
  const B = b.map(p => local(p, origin));
  // Containment first — a ring wholly inside another never crosses its edges.
  if (a.some(p => pointInRing(p, b)) || b.some(p => pointInRing(p, a))) return 0;
  let best = Infinity;
  for (let i = 0; i < A.length; i++) {
    const a0 = A[i], a1 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const b0 = B[j], b1 = B[(j + 1) % B.length];
      const d = segSegDist(a0, a1, b0, b1);
      if (d < best) best = d;
      if (best === 0) return 0;
    }
  }
  return best;
}

/**
 * Cluster zones into groups: same rate, and within `distanceM` of each other.
 *
 * `distanceM <= 0` turns grouping OFF — every zone becomes its own group, which
 * is exactly the per-zone behaviour the planner had before this module and the
 * comparison baseline the tests use.
 *
 * Closeness is transitive: A near B and B near C puts all three in one group
 * even if A and C are far apart, because the sweep that covers B covers the
 * ground between them anyway.
 */
export function groupZones<Z extends GroupableZone>(
  zones: readonly Z[],
  opts: { distanceM: number },
): ZoneGroup<Z>[] {
  const usable = zones.filter(z => z.ring && z.ring.length >= 3);
  if (!usable.length) return [];

  const distance = opts.distanceM;
  if (!(distance > 0)) {
    return usable.map(z => ({
      id: `grp:${z.id}`, zones: [z], rings: [z.ring], rateLha: z.rateLha,
    }));
  }

  // Union-find over zones, joined within a rate bucket only.
  const parent = usable.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (i: number, j: number) => {
    const a = find(i), b = find(j);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };

  const buckets = new Map<string, number[]>();
  usable.forEach((z, i) => {
    const k = rateKey(z.rateLha);
    const list = buckets.get(k);
    if (list) list.push(i); else buckets.set(k, [i]);
  });

  for (const idxs of buckets.values()) {
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        if (find(idxs[a]) === find(idxs[b])) continue;
        if (ringGapM(usable[idxs[a]].ring, usable[idxs[b]].ring) <= distance) {
          union(idxs[a], idxs[b]);
        }
      }
    }
  }

  const byRoot = new Map<number, Z[]>();
  usable.forEach((z, i) => {
    const r = find(i);
    const list = byRoot.get(r);
    if (list) list.push(z); else byRoot.set(r, [z]);
  });

  const groups: ZoneGroup<Z>[] = [];
  for (const members of byRoot.values()) {
    // Deterministic membership order: zone ids feed the group id, and an id
    // that moves between renders is a plan that redraws itself for no reason.
    members.sort((x, y) => x.id.localeCompare(y.id));
    groups.push({
      id: `grp:${members[0].id}`,
      zones: members,
      rings: members.map(m => m.ring),
      rateLha: members[0].rateLha,
    });
  }
  groups.sort((a, b) => a.id.localeCompare(b.id));
  return groups;
}

/** Mean position of every member vertex — the group's anchor for rotation. */
export const groupCentroid = (g: ZoneGroup): LatLng2 => centroidOfRings(g.rings);
