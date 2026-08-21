// Pure geodesic/planar helpers shared by the map viewer, the flight planner and
// the reporting code. Everything here is dependency-free and side-effect-free so
// it can be unit-tested without a DOM or a Leaflet map.
//
// Scale note: fields are at most a few km across, so lat/lng are treated as a
// locally-flat plane with a per-latitude longitude scale. That is accurate to
// well under a metre at field scale and keeps the maths cheap.

export type LatLng2 = { lat: number; lng: number };

export const EARTH_RADIUS_M = 6378137;
export const M_PER_DEG_LAT = 111_320;
export const M2_PER_ACRE = 4046.8564224;
export const M2_PER_HECTARE = 10_000;
export const HA_TO_AC = 2.4710538147;

export function mPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/**
 * Geodesic ring area in m² (spherical excess approximation — plenty accurate at
 * field scale). Accepts anything with lat/lng, including Leaflet LatLng objects.
 * Returns 0 for degenerate rings.
 */
export function polygonAreaM2(ring: LatLng2[]): number {
  const n = ring.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % n];
    area +=
      ((p2.lng - p1.lng) * Math.PI) / 180 *
      (2 + Math.sin((p1.lat * Math.PI) / 180) + Math.sin((p2.lat * Math.PI) / 180));
  }
  return Math.abs((area * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

export const m2ToAcres = (m2: number) => m2 / M2_PER_ACRE;
export const m2ToHectares = (m2: number) => m2 / M2_PER_HECTARE;

/** Sum of ring areas, in m². Used for multi-part (fragmented) fields. */
export function ringsAreaM2(rings: LatLng2[][]): number {
  return rings.reduce((sum, r) => sum + polygonAreaM2(r), 0);
}

/** Ray-casting point-in-polygon in lng/lat space. */
export function pointInRing(pt: LatLng2, ring: LatLng2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat;
    const xj = ring[j].lng, yj = ring[j].lat;
    const intersect = ((yi > pt.lat) !== (yj > pt.lat)) &&
      (pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInAnyRing(pt: LatLng2, rings: LatLng2[][]): boolean {
  for (const r of rings) if (pointInRing(pt, r)) return true;
  return false;
}

/** Parametric position along ab where it crosses cd, or null if they miss. */
export function segSegT(a: LatLng2, b: LatLng2, c: LatLng2, d: LatLng2): number | null {
  const x1 = a.lng, y1 = a.lat, x2 = b.lng, y2 = b.lat;
  const x3 = c.lng, y3 = c.lat, x4 = d.lng, y4 = d.lat;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-14) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

/** t-values in (0,1) where segment ab crosses the ring. */
export function segRingIntersections(a: LatLng2, b: LatLng2, ring: LatLng2[]): number[] {
  const ts: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const t = segSegT(a, b, ring[j], ring[i]);
    if (t !== null && t > 1e-9 && t < 1 - 1e-9) ts.push(t);
  }
  return ts;
}

export function lerp(a: LatLng2, b: LatLng2, t: number): LatLng2 {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

export function bboxOfRings(rings: LatLng2[][]) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/** Rotate a point about `center` by the angle whose cos/sin are given. */
export function rotateLL(p: LatLng2, center: LatLng2, cosA: number, sinA: number): LatLng2 {
  const mLng = mPerDegLng(center.lat);
  const x = (p.lng - center.lng) * mLng;
  const y = (p.lat - center.lat) * M_PER_DEG_LAT;
  const xr = x * cosA - y * sinA;
  const yr = x * sinA + y * cosA;
  return { lng: center.lng + xr / mLng, lat: center.lat + yr / M_PER_DEG_LAT };
}

/**
 * Angle of the field's long axis, from the largest-eigenvalue eigenvector of the
 * vertex covariance. Sweep rows are run along this so passes follow the long
 * edge rather than cutting the field cornerwise.
 */
export function principalAxisAngle(rings: LatLng2[][]): number {
  const c = vertexCovariance(rings);
  if (!c) return 0;
  return 0.5 * Math.atan2(2 * c.sxy, c.sxx - c.syy);
}

/** Second moments of every ring vertex about their mean, in metres². */
function vertexCovariance(rings: LatLng2[][]) {
  let cx = 0, cy = 0, n = 0;
  for (const r of rings) for (const p of r) { cx += p.lng; cy += p.lat; n++; }
  if (n === 0) return null;
  cx /= n; cy /= n;
  const mLng = mPerDegLng(cy);
  let sxx = 0, syy = 0, sxy = 0;
  for (const r of rings) for (const p of r) {
    const x = (p.lng - cx) * mLng;
    const y = (p.lat - cy) * M_PER_DEG_LAT;
    sxx += x * x; syy += y * y; sxy += x * y;
  }
  return { sxx, syy, sxy, n };
}

/**
 * How decided the principal axis is: the ratio of the two covariance
 * eigenvalues, 1 for a shape with no preferred direction and rising with
 * elongation.
 *
 * Separate from the bounding box's aspect ratio, and the two disagree in a way
 * that matters. A CLUSTER of parallel strips has a nearly square bounding box —
 * four 8 m strips spread over 56 m are as wide as they are long — while its
 * vertices are unmistakably strung out along the strips. The box says "no long
 * axis, pick anything"; the covariance says "along the strips", and the
 * covariance is right, because that is the direction a pass can run furthest
 * without leaving marked ground.
 */
export function axisAnisotropy(rings: LatLng2[][]): number {
  const c = vertexCovariance(rings);
  if (!c || c.n === 0) return 1;
  const half = (c.sxx + c.syy) / 2;
  const disc = Math.sqrt(((c.sxx - c.syy) / 2) ** 2 + c.sxy * c.sxy);
  const lo = half - disc;
  return lo > 1e-9 ? (half + disc) / lo : Infinity;
}

export function distM(a: LatLng2, b: LatLng2): number {
  const dLat = (b.lat - a.lat) * M_PER_DEG_LAT;
  const dLng = (b.lng - a.lng) * mPerDegLng((a.lat + b.lat) / 2);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function polylineLengthM(pts: LatLng2[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += distM(pts[i - 1], pts[i]);
  return d;
}

export function centroidOfRing(ring: LatLng2[]): LatLng2 {
  if (!ring.length) return { lat: 0, lng: 0 };
  let lat = 0, lng = 0;
  for (const p of ring) { lat += p.lat; lng += p.lng; }
  return { lat: lat / ring.length, lng: lng / ring.length };
}

export function centroidOfRings(rings: LatLng2[][]): LatLng2 {
  let lat = 0, lng = 0, n = 0;
  for (const r of rings) for (const p of r) { lat += p.lat; lng += p.lng; n++; }
  return n > 0 ? { lat: lat / n, lng: lng / n } : { lat: 0, lng: 0 };
}

export function centroidSafe(ring: LatLng2[] | null): LatLng2 | null {
  return ring && ring.length >= 3 ? centroidOfRing(ring) : null;
}

/** True when every sampled point along ab stays inside at least one ring. */
export function segmentInsideRings(a: LatLng2, b: LatLng2, rings: LatLng2[][], samples = 12): boolean {
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    if (!pointInAnyRing(lerp(a, b, t), rings)) return false;
  }
  return true;
}

export function ringContaining(p: LatLng2, rings: LatLng2[][]): LatLng2[] | null {
  for (const r of rings) if (pointInRing(p, r)) return r;
  return null;
}

/**
 * A point guaranteed to lie inside the ring. The centroid is used when it is
 * actually interior, which it is for convex fields — but for a concave field
 * (C, L, U shapes are common when a field wraps a wood or a pond) the centroid
 * can sit in the notch, outside the field entirely. In that case, scan a grid
 * over the bounding box and take the interior sample closest to the centroid.
 * Returns null for rings with no interior sample at this resolution.
 */
export function interiorPointOfRing(ring: LatLng2[], samples = 24): LatLng2 | null {
  if (ring.length < 3) return null;
  const c = centroidOfRing(ring);
  if (pointInRing(c, ring)) return c;

  const bb = bboxOfRings([ring]);
  let best: LatLng2 | null = null;
  let bestD = Infinity;
  for (let i = 1; i < samples; i++) {
    for (let j = 1; j < samples; j++) {
      const p = {
        lat: bb.minLat + ((bb.maxLat - bb.minLat) * i) / samples,
        lng: bb.minLng + ((bb.maxLng - bb.minLng) * j) / samples,
      };
      if (!pointInRing(p, ring)) continue;
      const d = distM(c, p);
      if (d < bestD) { bestD = d; best = p; }
    }
  }
  return best;
}

/**
 * Route a transit leg so it stays inside the field.
 *
 * A straight line is used whenever it is already legal. Otherwise the boundary
 * bbox is discretised and a breadth-first search finds a cell path through
 * in-field cells only, which is then greedily simplified back down to the few
 * waypoints a flight controller wants. A single detour anchor is not enough
 * here: routing between the two arms of a C-shaped field needs at least two
 * turns, and the previous centroid-based scheme silently returned a path that
 * cut straight across the notch.
 *
 * `fullyInside` reports whether the returned path actually satisfies the
 * constraint. When it is false, `path` is the plain straight line and is NOT a
 * safe route — the endpoints may simply be unreachable from each other within
 * the field. Callers must check it before treating the path as obstacle-free.
 */
export function routeInsideBoundary(
  a: LatLng2,
  b: LatLng2,
  rings: LatLng2[][],
  gridSize = 48,
): { path: LatLng2[]; fullyInside: boolean } {
  if (segmentInsideRings(a, b, rings)) return { path: [a, b], fullyInside: true };
  if (!rings.length) return { path: [a, b], fullyInside: false };

  const bb = bboxOfRings([...rings, [a, b]]);
  const latStep = (bb.maxLat - bb.minLat) / gridSize;
  const lngStep = (bb.maxLng - bb.minLng) / gridSize;
  if (!(latStep > 0) || !(lngStep > 0)) return { path: [a, b], fullyInside: false };

  const at = (i: number, j: number): LatLng2 => ({
    lat: bb.minLat + (i + 0.5) * latStep,
    lng: bb.minLng + (j + 0.5) * lngStep,
  });
  const open: boolean[][] = [];
  for (let i = 0; i < gridSize; i++) {
    open[i] = [];
    for (let j = 0; j < gridSize; j++) open[i][j] = pointInAnyRing(at(i, j), rings);
  }

  // Snap each endpoint to the nearest open cell.
  const snap = (p: LatLng2): [number, number] | null => {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        if (!open[i][j]) continue;
        const d = distM(p, at(i, j));
        if (d < bestD) { bestD = d; best = [i, j]; }
      }
    }
    return best;
  };
  const start = snap(a);
  const goal = snap(b);
  if (!start || !goal) return { path: [a, b], fullyInside: false };

  // BFS over 4-connected open cells.
  const prev = new Map<number, number>();
  const key = (i: number, j: number) => i * gridSize + j;
  const seen = new Set<number>([key(start[0], start[1])]);
  const queue: [number, number][] = [start];
  let found = false;
  while (queue.length) {
    const [i, j] = queue.shift()!;
    if (i === goal[0] && j === goal[1]) { found = true; break; }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= gridSize || nj >= gridSize) continue;
      if (!open[ni][nj] || seen.has(key(ni, nj))) continue;
      seen.add(key(ni, nj));
      prev.set(key(ni, nj), key(i, j));
      queue.push([ni, nj]);
    }
  }
  if (!found) return { path: [a, b], fullyInside: false };

  const cells: LatLng2[] = [];
  for (let k: number | undefined = key(goal[0], goal[1]); k !== undefined; k = prev.get(k)) {
    cells.push(at(Math.floor(k / gridSize), k % gridSize));
    if (k === key(start[0], start[1])) break;
  }
  cells.reverse();

  // Greedy string-pulling: keep only the waypoints needed to stay legal.
  const raw = [a, ...cells, b];
  const path: LatLng2[] = [raw[0]];
  let anchor = 0;
  while (anchor < raw.length - 1) {
    let next = anchor + 1;
    for (let probe = raw.length - 1; probe > anchor; probe--) {
      if (segmentInsideRings(raw[anchor], raw[probe], rings)) { next = probe; break; }
    }
    path.push(raw[next]);
    anchor = next;
  }

  let fullyInside = true;
  for (let i = 1; i < path.length; i++) {
    if (!segmentInsideRings(path[i - 1], path[i], rings)) { fullyInside = false; break; }
  }
  return fullyInside ? { path, fullyInside } : { path: [a, b], fullyInside: false };
}
