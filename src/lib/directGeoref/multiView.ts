// Direct photo georeferencing, part 5: the photographs check each other.
//
// Neighbouring photographs overlap by 60-80 %, so most objects are seen two to eight times from different camera
// positions. That gives two things without an orthomosaic or ground control:
//
//   agreement    the same object projected from two photographs onto the declared flat ground should land in one
//                place. The disagreement mixes two causes: the object's height above the declared plane (parallax,
//                along the line joining the cameras: baseline x object height / (camera height - object height)) and pose error.
//   triangulation the two rays through the object's centroid nearly cross. Where they come closest is the object's
//                3D position (its height included), and HOW close they come (the miss distance) measures pose error
//                alone: attitude, position, timing, lens. Height does not make rays miss; a wrong yaw does.
//
// Matching is deliberately simple: mutual nearest neighbours on the flat projection within maxM, with a ratio test
// against the second-nearest, inside both footprints, away from both frame edges.
import { toEnu } from "../sourceFrames/odm";
import type { GroundObject } from "./objects";
import { type GeorefFrame, type V3, cameraCentreIn, worldRay } from "./projection";

/** Inside the footprint ring and at least `marginM` from its border. */
export function pointInFootprint(p: { lat: number; lng: number }, ring: { lat: number; lng: number }[], marginM = 0): boolean {
  if (ring.length < 3) return false;
  const o = { lat: p.lat, lng: p.lng, altM: 0 };
  const q = ring.map(r => toEnu({ lat: r.lat, lng: r.lng, altM: 0 }, o));
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const [xi, yi] = q[i], [xj, yj] = q[j];
    if ((yi > 0) !== (yj > 0) && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
  }
  if (!inside) return false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const [ax, ay] = q[j], [bx, by] = q[i];
    const L2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = L2 ? Math.max(0, Math.min(1, -(ax * (bx - ax) + ay * (by - ay)) / L2)) : 0;
    if (Math.hypot(ax + t * (bx - ax), ay + t * (by - ay)) < marginM) return false;
  }
  return true;
}

export type MatchOptions = {
  /** Largest flat-ground disagreement accepted for a match, metres. */
  maxM?: number;
  /** The second-nearest candidate must be at least this many times further than the nearest. */
  ratio?: number;
  /** Objects at least this large, square metres (small patches are too ambiguous to pair between photos). */
  minAreaM2?: number;
};
export const MATCH_DEFAULTS: Required<MatchOptions> = { maxM: 1.5, ratio: 1.6, minAreaM2: 0.15 };

export type Triangulated = {
  /** Local ENU about the pair's origin. */
  point: V3;
  lat: number;
  lng: number;
  /** Height in the cameras' datum. */
  altM: number;
  /** Closest approach between the two rays, metres. */
  missM: number;
};

export type ObjectMatch = {
  a: GroundObject;
  b: GroundObject;
  /** Flat-ground disagreement, metres east and north (b minus a). */
  dEastM: number;
  dNorthM: number;
  distM: number;
  tri: Triangulated | null;
};

export type PairResult = {
  a: string;
  b: string;
  baselineM: number;
  /** Heading difference between the two cameras, degrees (0 = same direction, 180 = opposite legs). */
  headingDiffDeg: number;
  candidatesA: number;
  candidatesB: number;
  matches: ObjectMatch[];
};

const median = (v: number[]) => { if (!v.length) return NaN; const s = [...v].sort((p, q) => p - q); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
export { median };

/** Closest points of two rays C1 + s d1 and C2 + t d2 (s, t > 0); null when parallel or behind a camera. */
export function triangulateRays(C1: V3, d1: V3, C2: V3, d2: V3): { point: V3; missM: number } | null {
  const w: V3 = [C1[0] - C2[0], C1[1] - C2[1], C1[2] - C2[2]];
  const a = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2];
  const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
  const c = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2];
  const d = d1[0] * w[0] + d1[1] * w[1] + d1[2] * w[2];
  const e = d2[0] * w[0] + d2[1] * w[1] + d2[2] * w[2];
  const den = a * c - b * b;
  if (den < 1e-12 * a * c) return null;
  const s = (b * e - c * d) / den, t = (a * e - b * d) / den;
  if (s <= 0 || t <= 0) return null;
  const p1: V3 = [C1[0] + s * d1[0], C1[1] + s * d1[1], C1[2] + s * d1[2]];
  const p2: V3 = [C2[0] + t * d2[0], C2[1] + t * d2[1], C2[2] + t * d2[2]];
  return { point: [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2], missM: Math.hypot(p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]) };
}

/** Local ENU about `origin` back to latitude/longitude (same tangent plane as toEnu). */
function enuToLatLng(p: V3, origin: { lat: number; lng: number }) {
  const R = 6378137, lat0 = (origin.lat * Math.PI) / 180;
  return { lat: origin.lat + (p[1] / R) * (180 / Math.PI), lng: origin.lng + (p[0] / (R * Math.cos(lat0))) * (180 / Math.PI) };
}

/** Match the objects two photographs share and triangulate each match. */
export function matchPair(fa: GeorefFrame, oa: GroundObject[], fb: GeorefFrame, ob: GroundObject[], footA: { lat: number; lng: number }[], footB: { lat: number; lng: number }[], opts: MatchOptions = {}): PairResult {
  const o = { ...MATCH_DEFAULTS, ...opts };
  const origin = { lat: fa.pose.lat, lng: fa.pose.lng };
  const keep = (x: GroundObject, otherFoot: { lat: number; lng: number }[]) => !x.touchesEdge && x.areaM2 >= o.minAreaM2 && pointInFootprint(x.ground, otherFoot, 1.0);
  const A = oa.filter(x => keep(x, footB)), B = ob.filter(x => keep(x, footA));
  const en = (x: GroundObject) => { const e = toEnu({ lat: x.ground.lat, lng: x.ground.lng, altM: 0 }, { ...origin, altM: 0 }); return [e[0], e[1]] as [number, number]; };
  const PA = A.map(en), PB = B.map(en);
  const nearest = (p: [number, number], Q: [number, number][]) => {
    let i1 = -1, d1 = Infinity, d2 = Infinity;
    for (let i = 0; i < Q.length; i++) { const d = Math.hypot(Q[i][0] - p[0], Q[i][1] - p[1]); if (d < d1) { d2 = d1; d1 = d; i1 = i; } else if (d < d2) d2 = d; }
    return { i: i1, d1, d2 };
  };
  const CA = cameraCentreIn(fa, origin), CB = cameraCentreIn(fb, origin);
  const matches: ObjectMatch[] = [];
  for (let i = 0; i < PA.length; i++) {
    const nb = nearest(PA[i], PB);
    if (nb.i < 0 || nb.d1 > o.maxM || nb.d2 < o.ratio * nb.d1) continue;
    const na = nearest(PB[nb.i], PA);
    if (na.i !== i || na.d2 < o.ratio * na.d1) continue;
    const a = A[i], b = B[nb.i];
    const ra = worldRay(fa, a.u, a.v), rb = worldRay(fb, b.u, b.v);
    const t = ra && rb ? triangulateRays(CA, ra, CB, rb) : null;
    const tri: Triangulated | null = t ? { point: t.point, ...enuToLatLng(t.point, origin), altM: t.point[2], missM: t.missM } : null;
    matches.push({ a, b, dEastM: PB[nb.i][0] - PA[i][0], dNorthM: PB[nb.i][1] - PA[i][1], distM: nb.d1, tri });
  }
  let hd = Math.abs(fa.pose.attitude.yawDeg - fb.pose.attitude.yawDeg) % 360;
  if (hd > 180) hd = 360 - hd;
  return { a: fa.name, b: fb.name, baselineM: Math.hypot(CB[0] - CA[0], CB[1] - CA[1]), headingDiffDeg: hd, candidatesA: A.length, candidatesB: B.length, matches };
}

export type Cluster = {
  id: number;
  views: { frame: string; objectId: number }[];
  lat: number;
  lng: number;
  /** Mean triangulated height, cameras' datum. */
  altM: number;
  /** Spread of the pair triangulations about the mean, horizontal, metres (RMS). */
  spreadM: number;
  /** Median ray miss distance over the cluster's pairs. */
  missM: number;
  pairs: number;
};

/**
 * One object per real thing: matches joined across all pairs (union-find over frame/object), positioned by the mean
 * of their pair triangulations. Clusters whose triangulations miss by more than `maxMissM` are not averaged in.
 */
export function clusterMatches(pairs: PairResult[], maxMissM = 0.5): Cluster[] {
  const key = (x: GroundObject) => `${x.frame}#${x.id}`;
  const parent = new Map<string, string>();
  const find = (k: string): string => { let r = k; while (parent.get(r) !== r) r = parent.get(r)!; let c = k; while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; } return r; };
  const add = (k: string) => { if (!parent.has(k)) parent.set(k, k); };
  for (const p of pairs) for (const m of p.matches) {
    if (!m.tri || m.tri.missM > maxMissM) continue;
    const ka = key(m.a), kb = key(m.b);
    add(ka); add(kb);
    const ra = find(ka), rb = find(kb);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<string, { views: Set<string>; tris: Triangulated[] }>();
  for (const p of pairs) for (const m of p.matches) {
    if (!m.tri || m.tri.missM > maxMissM) continue;
    const r = find(key(m.a));
    const g = groups.get(r) ?? { views: new Set<string>(), tris: [] };
    g.views.add(key(m.a)); g.views.add(key(m.b)); g.tris.push(m.tri);
    groups.set(r, g);
  }
  const out: Cluster[] = [];
  let id = 1;
  for (const g of groups.values()) {
    const n = g.tris.length;
    const lat = g.tris.reduce((s, t) => s + t.lat, 0) / n, lng = g.tris.reduce((s, t) => s + t.lng, 0) / n, alt = g.tris.reduce((s, t) => s + t.altM, 0) / n;
    const spread = Math.sqrt(g.tris.reduce((s, t) => { const e = toEnu({ lat: t.lat, lng: t.lng, altM: 0 }, { lat, lng, altM: 0 }); return s + e[0] * e[0] + e[1] * e[1]; }, 0) / n);
    out.push({
      id: id++, views: [...g.views].map(v => { const [frame, oid] = v.split("#"); return { frame, objectId: Number(oid) }; }),
      lat, lng, altM: alt, spreadM: spread, missM: median(g.tris.map(t => t.missM)), pairs: n,
    });
  }
  return out;
}
