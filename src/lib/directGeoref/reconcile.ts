// Direct photo georeferencing, part 8: many observations of one plant become one object.
//
// Overlapping photographs see the same plant two to eight times. Each sighting (a detector's instance in one photo)
// is an observation: a pixel, a size, the photo's camera. Reconciliation decides which observations are the same
// physical plant and turns each group into one measurable object:
//
//   linking      between every pair of overlapping photos, candidates within `searchM` on the ground with compatible
//                sizes; two observations are the same plant when their two RAYS nearly meet (miss under
//                missBaseM + missSizeFactor x size) at a plausible height. Rays, not flat positions: a 1.5 m tree
//                projected to the soil from two cameras 20 m apart lands 0.9 m apart, yet its rays still cross at
//                the tree. Mutual best by miss + flatWeight x flat distance (the flat term breaks the tie between
//                two weeds a hand apart along the cameras' baseline, whose rays both meet near the soil)
//   grouping     links are applied closest first, and a link is refused when it would put two observations from
//                the SAME photo into one object (one plant is seen at most once per photo); chains cannot snowball
//   position     the point closest to all the object's rays (least squares), so a tall plant lands at its own height
//                instead of leaning away from each camera; one view: the flat projection
//   repeatability how many photographs had the plant inside their frame (with a margin), against how many saw it:
//                a plant every covering photo detects is a consistent detection; one seen once out of five is not
//
// Observations cut by the photo's edge are left out of linking and positions (their centroid is truncated).
import { toEnu, type LatLngAlt } from "../sourceFrames/odm";
import { triangulateRays } from "./multiView";
import { type GeorefFrame, type V3, cameraCentreIn, frameFootprint, pixelToGround, worldRay } from "./projection";

export type Observation = {
  frame: string;
  id: number;
  /** Centroid, original-frame pixels. */
  u: number;
  v: number;
  /** Equivalent diameter on the ground, metres. */
  sizeM: number;
  areaM2: number;
  touchesEdge: boolean;
  /** Anything the caller wants carried through (score, class, outline). */
  data?: Record<string, unknown>;
};

export type ReconcileOptions = {
  /** Candidates further apart than this on the declared ground are never the same plant, metres. */
  searchM?: number;
  /** Largest ray miss for a link: missBaseM + missSizeFactor x mean size. */
  missBaseM?: number;
  missSizeFactor?: number;
  /** Plausible heights of the meeting point above the ground, metres. */
  minHeightM?: number;
  maxHeightM?: number;
  /** Weight of the flat distance in the link score. */
  flatWeight?: number;
  /** Largest size ratio between two observations of one plant. */
  maxSizeRatio?: number;
  /** A photo "covers" a plant when the plant is this far inside its footprint (metres, plus the plant's radius). */
  coverMarginM?: number;
  /** Camera centres further apart than this are not compared. */
  maxPairM?: number;
  /** Per frame, the ground its detector actually looked at (rings, local metres about the set's origin); when given, `runBy` counts them. */
  runRings?: Map<string, [number, number][][]>;
};
export const RECONCILE_DEFAULTS: Required<Omit<ReconcileOptions, "runRings">> & { runRings: Map<string, [number, number][][]> | null } = { searchM: 2, missBaseM: 0.1, missSizeFactor: 0.25, minHeightM: -0.6, maxHeightM: 6, flatWeight: 0.2, maxSizeRatio: 3, coverMarginM: 0.3, maxPairM: 45, runRings: null };

export type ReconciledObject = {
  id: number;
  members: Observation[];
  lat: number;
  lng: number;
  /** Height of the object's centre above the cameras' ground model, metres; null with one view or a weak baseline. */
  heightM: number | null;
  /** Median of the members' sizes. */
  sizeM: number;
  areaM2: number;
  /** Size variation across views (sd / mean); 0 with one view. */
  sizeCv: number;
  /** Median distance from each view's ray (at the object's height) to the object, metres. */
  viewSpreadM: number;
  /** Photographs whose frame holds the object (with margin), and how many of them saw it. */
  coveredBy: number;
  seenBy: number;
  /** Photographs whose detector looked at this ground (the run tiles), when the run was limited; else equal to coveredBy. */
  runBy: number;
};

type Prepared = Observation & { key: string; e: number; n: number; C: V3; d: V3; groundZ: number };

/** Least-squares point closest to a set of rays (C + t d). */
export function closestPointToRays(rays: { C: V3; d: V3 }[]): V3 | null {
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0], b = [0, 0, 0];
  for (const { C, d } of rays) {
    const L = Math.hypot(d[0], d[1], d[2]), u = [d[0] / L, d[1] / L, d[2] / L];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const m = (i === j ? 1 : 0) - u[i] * u[j];
      A[i * 3 + j] += m;
      b[i] += m * C[j];
    }
  }
  const det = A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) + A[2] * (A[3] * A[7] - A[4] * A[6]);
  if (Math.abs(det) < 1e-9) return null;
  const inv = [
    A[4] * A[8] - A[5] * A[7], A[2] * A[7] - A[1] * A[8], A[1] * A[5] - A[2] * A[4],
    A[5] * A[6] - A[3] * A[8], A[0] * A[8] - A[2] * A[6], A[2] * A[3] - A[0] * A[5],
    A[3] * A[7] - A[4] * A[6], A[1] * A[6] - A[0] * A[7], A[0] * A[4] - A[1] * A[3],
  ].map(x => x / det);
  return [inv[0] * b[0] + inv[1] * b[1] + inv[2] * b[2], inv[3] * b[0] + inv[4] * b[1] + inv[5] * b[2], inv[6] * b[0] + inv[7] * b[1] + inv[8] * b[2]];
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };

/**
 * Reconcile observations from many photographs into objects. `frames` are the cameras (any ground model);
 * positions are reported in latitude / longitude, heights against each camera's ground at the object.
 */
export function reconcile(observations: Observation[], frames: Map<string, GeorefFrame>, opts: ReconcileOptions = {}): ReconciledObject[] {
  const o = { ...RECONCILE_DEFAULTS, ...opts };
  const fs = [...frames.values()];
  const origin: LatLngAlt = { lat: fs.reduce((s, f) => s + f.pose.lat, 0) / fs.length, lng: fs.reduce((s, f) => s + f.pose.lng, 0) / fs.length, altM: 0 };
  const en = (lat: number, lng: number) => { const e = toEnu({ lat, lng, altM: 0 }, origin); return [e[0], e[1]] as [number, number]; };

  // Flat projection of every usable observation.
  const prep: Prepared[] = [];
  for (const ob of observations) {
    if (ob.touchesEdge) continue;
    const f = frames.get(ob.frame);
    if (!f) continue;
    const g = pixelToGround(f, ob.u, ob.v), d = worldRay(f, ob.u, ob.v);
    if (!g || !d) continue;
    const [e, n] = en(g.lat, g.lng);
    prep.push({ ...ob, key: `${ob.frame}#${ob.id}`, e, n, C: cameraCentreIn(f, origin), d, groundZ: g.altM });
  }
  const byFrame = new Map<string, Prepared[]>();
  for (const p of prep) (byFrame.get(p.frame) ?? byFrame.set(p.frame, []).get(p.frame)!).push(p);

  // Candidate links: between each pair of overlapping photos, the best partner by ray miss (plus a little flat
  // distance), kept when it is mutual.
  const cell = o.searchM;
  const gridOf = (list: Prepared[]) => { const g = new Map<string, Prepared[]>(); for (const p of list) { const k = `${Math.floor(p.e / cell)},${Math.floor(p.n / cell)}`; (g.get(k) ?? g.set(k, []).get(k)!).push(p); } return g; };
  const grids = new Map([...byFrame].map(([k, v]) => [k, gridOf(v)]));
  /** Link score for two observations, or null when they cannot be the same plant. */
  const score = (p: Prepared, q: Prepared): number | null => {
    const flat = Math.hypot(q.e - p.e, q.n - p.n);
    if (flat > o.searchM) return null;
    const ratio = Math.max(p.sizeM, q.sizeM) / Math.max(1e-6, Math.min(p.sizeM, q.sizeM));
    if (ratio > o.maxSizeRatio) return null;
    const size = (p.sizeM + q.sizeM) / 2, tol = o.missBaseM + o.missSizeFactor * size;
    const t = triangulateRays(p.C, p.d, q.C, q.d);
    if (!t) return flat <= tol ? flat * (1 + o.flatWeight) : null; // near-parallel rays: the flat distance is the miss
    const h = t.point[2] - (p.groundZ + q.groundZ) / 2;
    if (t.missM > tol || h < o.minHeightM || h > o.maxHeightM) return null;
    return t.missM + o.flatWeight * flat;
  };
  const best = (p: Prepared, frame: string) => {
    const g = grids.get(frame)!, gx = Math.floor(p.e / cell), gy = Math.floor(p.n / cell);
    let bq: Prepared | null = null, bs = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const q of g.get(`${gx + dx},${gy + dy}`) ?? []) {
      const sc = score(p, q);
      if (sc != null && sc < bs) { bs = sc; bq = q; }
    }
    return bq ? { q: bq, s: bs } : null;
  };
  const frameNames = [...byFrame.keys()];
  const centre = new Map(frameNames.map(k => [k, en(frames.get(k)!.pose.lat, frames.get(k)!.pose.lng)]));
  const links: { a: Prepared; b: Prepared; d: number }[] = [];
  for (let i = 0; i < frameNames.length; i++) for (let j = i + 1; j < frameNames.length; j++) {
    const A = frameNames[i], B = frameNames[j], ca = centre.get(A)!, cb = centre.get(B)!;
    if (Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) > o.maxPairM) continue;
    for (const p of byFrame.get(A)!) {
      const nb = best(p, B);
      if (!nb) continue;
      const back = best(nb.q, A);
      if (!back || back.q !== p) continue;
      links.push({ a: p, b: nb.q, d: nb.s });
    }
  }

  // Group, closest links first, one observation per photo per object.
  links.sort((x, y) => x.d - y.d);
  const parent = new Map<string, string>(prep.map(p => [p.key, p.key]));
  const framesOf = new Map<string, Set<string>>(prep.map(p => [p.key, new Set([p.frame])]));
  const find = (k: string): string => { let r = k; while (parent.get(r) !== r) r = parent.get(r)!; let c = k; while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; } return r; };
  for (const { a, b } of links) {
    const ra = find(a.key), rb = find(b.key);
    if (ra === rb) continue;
    const fa = framesOf.get(ra)!, fb = framesOf.get(rb)!;
    let clash = false;
    for (const f of fb) if (fa.has(f)) { clash = true; break; }
    if (clash) continue;
    parent.set(rb, ra);
    for (const f of fb) fa.add(f);
  }
  const groups = new Map<string, Prepared[]>();
  for (const p of prep) { const r = find(p.key); (groups.get(r) ?? groups.set(r, []).get(r)!).push(p); }

  // Footprints for coverage, in the same local metres.
  const foot = new Map(frameNames.length ? fs.map(f => [f.name, (frameFootprint(f, 8) ?? []).map(g => en(g.lat, g.lng))]) : []);
  const inside = (ring: [number, number][], e: number, n: number, margin: number) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > n) !== (yj > n) && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) hit = !hit;
    }
    if (!hit) return false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j], [bx, by] = ring[i], L2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = L2 ? Math.max(0, Math.min(1, ((e - ax) * (bx - ax) + (n - ay) * (by - ay)) / L2)) : 0;
      if (Math.hypot(ax + t * (bx - ax) - e, ay + t * (by - ay) - n) < margin) return false;
    }
    return true;
  };

  const out: ReconciledObject[] = [];
  let id = 1;
  for (const members of groups.values()) {
    const rays = members.map(m => ({ C: m.C, d: m.d }));
    let e = members.reduce((s, m) => s + m.e, 0) / members.length, n = members.reduce((s, m) => s + m.n, 0) / members.length;
    let heightM: number | null = null, z: number | null = null;
    if (members.length >= 2) {
      // A usable baseline: cameras at least 3 m apart.
      const cs = rays.map(r => r.C);
      let base = 0;
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) base = Math.max(base, Math.hypot(cs[i][0] - cs[j][0], cs[i][1] - cs[j][1]));
      const p = base >= 3 ? closestPointToRays(rays) : null;
      if (p) {
        e = p[0]; n = p[1]; z = p[2];
        const ll = { lat: origin.lat + (n / 6378137) * (180 / Math.PI), lng: origin.lng + (e / (6378137 * Math.cos((origin.lat * Math.PI) / 180))) * (180 / Math.PI) };
        const f0 = frames.get(members[0].frame)!;
        const groundAt = f0.ground.kind === "flat" ? f0.ground.altM : f0.ground.altAt(ll.lat, ll.lng) ?? 0;
        heightM = z - groundAt;
      }
    }
    // How far each view puts the object from the reconciled position: its ray at the object's height when one was
    // triangulated, else its flat projection.
    const spread = z != null
      ? rays.map(r => { const s = (z! - r.C[2]) / r.d[2]; return Math.hypot(r.C[0] + s * r.d[0] - e, r.C[1] + s * r.d[1] - n); })
      : members.map(m => Math.hypot(m.e - e, m.n - n));
    const sizes = members.map(m => m.sizeM), ms = sizes.reduce((s, x) => s + x, 0) / sizes.length;
    const sizeM = median(sizes);
    const ll = { lat: origin.lat + (n / 6378137) * (180 / Math.PI), lng: origin.lng + (e / (6378137 * Math.cos((origin.lat * Math.PI) / 180))) * (180 / Math.PI) };
    const coveredBy = fs.filter(f => inside(foot.get(f.name)!, e, n, o.coverMarginM + sizeM / 2)).length;
    const runBy = o.runRings ? fs.filter(f => { const rings = o.runRings!.get(f.name); return rings ? rings.some(r => inside(r, e, n, 0)) : inside(foot.get(f.name)!, e, n, o.coverMarginM + sizeM / 2); }).length : coveredBy;
    out.push({
      id: id++, members: members.map(({ key: _k, e: _e, n: _n, C: _c, d: _d, groundZ: _g, ...m }) => m), lat: ll.lat, lng: ll.lng, heightM, sizeM,
      areaM2: median(members.map(m => m.areaM2)),
      sizeCv: members.length > 1 ? Math.sqrt(sizes.reduce((s, x) => s + (x - ms) ** 2, 0) / sizes.length) / ms : 0,
      viewSpreadM: median(spread),
      coveredBy: Math.max(coveredBy, members.length), runBy: Math.max(runBy, members.length), seenBy: members.length,
    });
  }
  return out;
}
