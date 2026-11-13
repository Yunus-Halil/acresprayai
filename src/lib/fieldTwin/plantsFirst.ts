// Corn: the plants first, then the rows through them (2026-11-13).
//
// Every photograph's plant read already locates seedlings over its whole frame, at full resolution, on the plant
// itself (checked by eye on the first independent flight: a circle at the base of nearly every seedling). What went
// wrong before was the combining: the rows came first, every photograph was slid onto a row lattice before its plants
// were read, and plants were joined across photographs by their distance along a row only. Where the lattice sat a
// little off the real row, the search band slid off the seedlings and several photographs agreed on soil beside them.
//
// Here nothing is fitted to rows until the plants are placed:
//   1. projectSightings   each photograph's plants through its own camera onto the ground.
//   2. registerPhotos     the photographs' disagreement removed against each other: in each cell of a photograph, every
//                         plant and every other photograph's plant near it vote for their difference (east and north,
//                         centimetre bins); the same plant seen twice is a sharp peak, its neighbours a seed spacing
//                         away a broad one. The peaks over a photograph's cells are fitted as a plane in each axis
//                         (a camera turned a fraction of a degree or a percent off in height moves one edge one way
//                         and the other the other). All photographs move half way a round, five rounds; the flight's
//                         mean is kept, so the dots stay in the frame the twin's rows and photographs are drawn in.
//   3. mergeDots          one dot per plant: sightings of different photographs within a gate (derived from how
//                         tightly the same plant repeats), one per photograph, at the mean of where they saw it.
//                         A dot needs two photographs.
//   4. rowsFromDots       rows as lines through the dots, along the field's direction, found in windows along it,
//                         joined window to window; a row runs from its first dot to its last.
// Nothing here knows a field: the gate comes from the repeats, the row spacing from the dots, and the seed spacing
// from the dots (bounded by what corn is sown at).
import { type GeorefFrame, pixelToGround } from "@/lib/directGeoref/projection";
import { type LatLngAlt, toEnu } from "@/lib/sourceFrames/odm";
import { seedSpacing } from "./rowGuided";

export type Read = { name: string; scale: number; plants: [number, number][] };
export type Sight = { p: number; u: number; v: number; e: number; n: number };

/** Each photograph's plants on the ground, metres east and north of `origin`, through its own camera. */
export function projectSightings(reads: Read[], frames: Map<string, GeorefFrame>, origin: LatLngAlt): { sights: Sight[]; photos: string[] } {
  const photos: string[] = [], sights: Sight[] = [];
  for (const r of reads) {
    const f = frames.get(r.name);
    if (!f) continue;
    const p = photos.length; photos.push(r.name);
    for (const [x, y] of r.plants) {
      const u = x * r.scale, v = y * r.scale, g = pixelToGround(f, u, v);
      if (!g) continue;
      const [e, n] = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, origin);
      sights.push({ p, u, v, e, n });
    }
  }
  return { sights, photos };
}

/** A photograph's correction, metres: east a + b (u - u0) + c (v - v0), north the same with its own a, b, c. */
export type PhotoShift = { e: [number, number, number]; n: [number, number, number]; u0: number; v0: number; cells: number };
export const shiftOf = (s: PhotoShift, u: number, v: number): [number, number] => [s.e[0] + s.e[1] * (u - s.u0) + s.e[2] * (v - s.v0), s.n[0] + s.n[1] * (u - s.u0) + s.n[2] * (v - s.v0)];

/** A grid over the ground for neighbour queries. */
class Grid {
  private cells = new Map<number, number[]>();
  constructor(private xs: ArrayLike<number>, private ys: ArrayLike<number>, private size: number) {
    for (let i = 0; i < xs.length; i++) { const k = this.key(Math.floor(xs[i] / size), Math.floor(ys[i] / size)); (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(i); }
  }
  private key(i: number, j: number) { return (i + 1_000_000) * 2_000_003 + (j + 1_000_000); }
  near(x: number, y: number, r: number, fn: (i: number) => void) {
    const i0 = Math.floor((x - r) / this.size), i1 = Math.floor((x + r) / this.size), j0 = Math.floor((y - r) / this.size), j1 = Math.floor((y + r) / this.size);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const c = this.cells.get(this.key(i, j)); if (c) for (const k of c) fn(k); }
  }
}

export const PLANTS_FIRST = {
  /** How far apart two photographs' sightings may be and still vote on their offset, metres. */
  reachM: 0.3,
  /** A photograph's cells (across x down) for the plane fit. */
  gridU: 4, gridV: 3,
  /** A cell's votes needed for a peak. */
  minVotes: 40,
  rounds: 5,
  /** The broad background a sharp peak must stand above: a box this wide (metres) around it. */
  backgroundM: 0.12,
  /** The merge gate: this many times the same plant's repeat spread, within these bounds (metres). */
  gateTimes: 2.5, gateMin: 0.025, gateMax: 0.06,
  /** Rows: windows along the field this long; a row peak must hold this many dots a metre of window. */
  windowM: 6, minDotsPerM: 1,
  /** Dots within this share of a row spacing of a row line are its plants. */
  onRowShare: 0.12,
};
export type PlantsFirstOptions = typeof PLANTS_FIRST;

/**
 * The photographs' corrections against each other (see the header). Returns one PhotoShift a photograph, and the
 * spread with which the same plant repeats between photographs once corrected (metres, the median distance of a
 * sighting from its nearest other photograph's sighting at the peak).
 */
export function registerPhotos(sights: Sight[], nPhotos: number, o: PlantsFirstOptions = PLANTS_FIRST): { shifts: PhotoShift[]; repeatM: number } {
  const R = o.reachM, nb = Math.round((2 * R) / 0.01) + 1, NB = nb * nb, half = Math.max(2, Math.round(o.backgroundM / 0.01));
  const shifts: PhotoShift[] = Array.from({ length: nPhotos }, () => ({ e: [0, 0, 0], n: [0, 0, 0], u0: 0, v0: 0, cells: 0 }));
  // Each photograph's frame extent and centre, from its own sightings; each sighting's cell.
  const uMin = new Float64Array(nPhotos).fill(Infinity), uMax = new Float64Array(nPhotos).fill(-Infinity), vMin = new Float64Array(nPhotos).fill(Infinity), vMax = new Float64Array(nPhotos).fill(-Infinity), cnt = new Float64Array(nPhotos);
  for (const s of sights) { uMin[s.p] = Math.min(uMin[s.p], s.u); uMax[s.p] = Math.max(uMax[s.p], s.u); vMin[s.p] = Math.min(vMin[s.p], s.v); vMax[s.p] = Math.max(vMax[s.p], s.v); shifts[s.p].u0 += s.u; shifts[s.p].v0 += s.v; cnt[s.p]++; }
  for (let p = 0; p < nPhotos; p++) if (cnt[p]) { shifts[p].u0 /= cnt[p]; shifts[p].v0 /= cnt[p]; }
  const nc = o.gridU * o.gridV;
  const cellOf = sights.map(s => Math.min(o.gridU - 1, Math.floor(((s.u - uMin[s.p]) / Math.max(1, uMax[s.p] - uMin[s.p])) * o.gridU)) * o.gridV + Math.min(o.gridV - 1, Math.floor(((s.v - vMin[s.p]) / Math.max(1, vMax[s.p] - vMin[s.p])) * o.gridV)));
  let repeatM = NaN;
  for (let round = 0; round < o.rounds; round++) {
    const xs = new Float64Array(sights.length), ys = new Float64Array(sights.length);
    sights.forEach((s, i) => { const [de, dn] = shiftOf(shifts[s.p], s.u, s.v); xs[i] = s.e + de; ys[i] = s.n + dn; });
    const grid = new Grid(xs, ys, R);
    // Votes per photograph cell: Float32 histograms, made only for cells that get votes.
    const hist = new Map<number, Float32Array>(), uvSum = new Map<number, [number, number, number]>();
    const vote = (p: number, c: number, dx: number, dy: number, u: number, v: number) => {
      const bx = Math.round((dx + R) / 0.01), by = Math.round((dy + R) / 0.01); if (bx < 0 || by < 0 || bx >= nb || by >= nb) return;
      const k = p * nc + c; let h = hist.get(k); if (!h) { h = new Float32Array(NB); hist.set(k, h); }
      h[by * nb + bx]++;
      const s = uvSum.get(k) ?? uvSum.set(k, [0, 0, 0]).get(k)!; s[0] += u; s[1] += v; s[2]++;
    };
    const nearest: number[] = [];
    for (let i = 0; i < sights.length; i++) {
      const si = sights[i]; let best = Infinity;
      grid.near(xs[i], ys[i], R, j => {
        if (j <= i) return;
        const sj = sights[j]; if (sj.p === si.p) return;
        const dx = xs[j] - xs[i], dy = ys[j] - ys[i]; if (Math.abs(dx) > R || Math.abs(dy) > R) return;
        vote(si.p, cellOf[i], dx, dy, si.u, si.v); vote(sj.p, cellOf[j], -dx, -dy, sj.u, sj.v);
        best = Math.min(best, Math.hypot(dx, dy));
      });
      if (best < Infinity) nearest.push(best);
    }
    nearest.sort((a, b) => a - b);
    repeatM = nearest.length ? nearest[nearest.length >> 1] : NaN;
    // Each cell's sharpest peak: 3 x 3 box less the mean of a wider box around it.
    const peakOf = (h: Float32Array): { x: number; y: number; w: number } | null => {
      let tot = 0; for (let k = 0; k < NB; k++) tot += h[k]; if (tot < o.minVotes) return null;
      // Summed-area table for box sums.
      const S = new Float64Array((nb + 1) * (nb + 1));
      for (let y = 0; y < nb; y++) { let row = 0; for (let x = 0; x < nb; x++) { row += h[y * nb + x]; S[(y + 1) * (nb + 1) + x + 1] = S[y * (nb + 1) + x + 1] + row; } }
      const box = (x0: number, y0: number, x1: number, y1: number) => { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(nb - 1, x1); y1 = Math.min(nb - 1, y1); if (x1 < x0 || y1 < y0) return [0, 0]; return [S[(y1 + 1) * (nb + 1) + x1 + 1] - S[y0 * (nb + 1) + x1 + 1] - S[(y1 + 1) * (nb + 1) + x0] + S[y0 * (nb + 1) + x0], (x1 - x0 + 1) * (y1 - y0 + 1)]; };
      let bx = -1, by = -1, best = 0, bg = 0;
      for (let y = 1; y < nb - 1; y++) for (let x = 1; x < nb - 1; x++) {
        const [s3] = box(x - 1, y - 1, x + 1, y + 1), [sw, aw] = box(x - half, y - half, x + half, y + half), ex = s3 - (9 * sw) / aw;
        if (ex > best) { best = ex; bx = x; by = y; bg = (9 * sw) / aw; }
      }
      if (bx < 0 || best < 3 * Math.sqrt(Math.max(1, bg))) return null;
      // Sub-bin: the weighted mean over the 3 x 3 around the peak.
      let sx = 0, sy = 0, sw = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const w = h[(by + dy) * nb + bx + dx]; sx += w * (bx + dx); sy += w * (by + dy); sw += w; }
      return { x: (sx / sw) * 0.01 - R, y: (sy / sw) * 0.01 - R, w: best };
    };
    const next = shifts.map((s0, p): PhotoShift => {
      const meas: { u: number; v: number; x: number; y: number; w: number }[] = [];
      for (let c = 0; c < nc; c++) { const h = hist.get(p * nc + c); if (!h) continue; const pk = peakOf(h); if (!pk) continue; const uv = uvSum.get(p * nc + c)!; meas.push({ u: uv[0] / uv[2] - s0.u0, v: uv[1] / uv[2] - s0.v0, x: pk.x, y: pk.y, w: pk.w }); }
      if (!meas.length) return s0;
      // The other photographs sit at +d from this one: this one moves by d, half way.
      const fit = (key: "x" | "y"): [number, number, number] => {
        const wsum = meas.reduce((t, m) => t + m.w, 0), mean = meas.reduce((t, m) => t + m.w * m[key], 0) / wsum;
        if (meas.length < 4) return [mean, 0, 0];
        let used = meas, sol: [number, number, number] | null = null;
        for (let it = 0; it < 3; it++) {
          const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], y = [0, 0, 0];
          for (const m of used) { const x = [1, m.u, m.v]; for (let i = 0; i < 3; i++) { y[i] += m.w * x[i] * m[key]; for (let j = 0; j < 3; j++) A[i][j] += m.w * x[i] * x[j]; } }
          const s = solve3(A, y); if (!s) break; sol = s;
          const keep = used.filter(m => Math.abs(m[key] - (s[0] + s[1] * m.u + s[2] * m.v)) <= 0.04);
          if (keep.length === used.length || keep.length < 4) break;
          used = keep;
        }
        if (!sol) return [mean, 0, 0];
        // A plane that would move any measured cell more than the reach from the middle is not believed.
        if (Math.max(...meas.map(m => Math.abs(sol![1] * m.u + sol![2] * m.v))) > R) return [mean, 0, 0];
        return sol;
      };
      const fe = fit("x"), fn = fit("y");
      return { e: [s0.e[0] + 0.5 * fe[0], s0.e[1] + 0.5 * fe[1], s0.e[2] + 0.5 * fe[2]], n: [s0.n[0] + 0.5 * fn[0], s0.n[1] + 0.5 * fn[1], s0.n[2] + 0.5 * fn[2]], u0: s0.u0, v0: s0.v0, cells: meas.length };
    });
    for (let p = 0; p < nPhotos; p++) shifts[p] = next[p];
    const me = shifts.reduce((t, s) => t + s.e[0], 0) / Math.max(1, nPhotos), mn = shifts.reduce((t, s) => t + s.n[0], 0) / Math.max(1, nPhotos);
    for (const s of shifts) { s.e[0] -= me; s.n[0] -= mn; }
  }
  return { shifts, repeatM };
}

function solve3(A: number[][], y: number[]): [number, number, number] | null {
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A); if (!Number.isFinite(D) || Math.abs(D) < 1e-12) return null;
  const col = (k: number) => A.map((r, i) => r.map((v, j) => (j === k ? y[i] : v)));
  return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
}

export type Dot = { e: number; n: number; members: number[]; photos: number; /** Spread of its sightings about it, metres (RMS). */ spreadM: number };

/**
 * One dot per plant (see the header). Sightings are taken densest first: each unclaimed one gathers the nearest
 * unclaimed sighting of every other photograph within the gate, and the group is gathered again around its mean.
 */
export function mergeDots(sights: Sight[], shifts: PhotoShift[], gateM: number, minPhotos = 2): Dot[] {
  const xs = new Float64Array(sights.length), ys = new Float64Array(sights.length);
  sights.forEach((s, i) => { const [de, dn] = shiftOf(shifts[s.p], s.u, s.v); xs[i] = s.e + de; ys[i] = s.n + dn; });
  const grid = new Grid(xs, ys, Math.max(0.05, gateM));
  const density = new Int32Array(sights.length);
  for (let i = 0; i < sights.length; i++) grid.near(xs[i], ys[i], gateM, j => { if (sights[j].p !== sights[i].p && Math.hypot(xs[j] - xs[i], ys[j] - ys[i]) <= gateM) density[i]++; });
  const order = Int32Array.from({ length: sights.length }, (_, i) => i).sort((a, b) => density[b] - density[a]);
  const claimed = new Uint8Array(sights.length), dots: Dot[] = [];
  const gather = (cx: number, cy: number): number[] => {
    const best = new Map<number, [number, number]>();
    grid.near(cx, cy, gateM, j => { if (claimed[j]) return; const d = Math.hypot(xs[j] - cx, ys[j] - cy); if (d > gateM) return; const b = best.get(sights[j].p); if (!b || d < b[1]) best.set(sights[j].p, [j, d]); });
    return [...best.values()].map(b => b[0]);
  };
  for (const i of order) {
    if (claimed[i]) continue;
    let m = gather(xs[i], ys[i]);
    if (!m.includes(i)) m.push(i);
    const cx = m.reduce((t, k) => t + xs[k], 0) / m.length, cy = m.reduce((t, k) => t + ys[k], 0) / m.length;
    const m2 = gather(cx, cy);
    if (m2.length >= m.length) m = m2;
    if (m.length < minPhotos) continue;
    for (const k of m) claimed[k] = 1;
    const ex = m.reduce((t, k) => t + xs[k], 0) / m.length, ny = m.reduce((t, k) => t + ys[k], 0) / m.length;
    dots.push({ e: ex, n: ny, members: m, photos: m.length, spreadM: Math.sqrt(m.reduce((t, k) => t + (xs[k] - ex) ** 2 + (ys[k] - ny) ** 2, 0) / m.length) });
  }
  return dots;
}

/**
 * How many photographs looked at each dot's ground: those whose frame, less a margin of `marginPx` (a plant cut by
 * the frame's edge is not a fair miss), contains it once corrected. A dot seen by two of ten photographs that looked
 * is a speck two of them happened to mark; one seen by eight of ten is a plant.
 */
export function coverage(dots: Dot[], frames: Map<string, GeorefFrame>, photos: string[], shifts: PhotoShift[], origin: LatLngAlt, marginPx = 60, perEdge = 12): Int32Array {
  const covered = new Int32Array(dots.length);
  photos.forEach((name, p) => {
    const f = frames.get(name); if (!f) return;
    const W = f.intrinsics.width, H = f.intrinsics.height, ring: [number, number][] = [];
    const edge = (u0: number, v0: number, u1: number, v1: number) => { for (let k = 0; k < perEdge; k++) { const t = k / perEdge, u = u0 + t * (u1 - u0), v = v0 + t * (v1 - v0), g = pixelToGround(f, u, v); if (!g) continue; const [e, n] = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, origin), [de, dn] = shiftOf(shifts[p], u, v); ring.push([e + de, n + dn]); } };
    const m = marginPx; edge(m, m, W - m, m); edge(W - m, m, W - m, H - m); edge(W - m, H - m, m, H - m); edge(m, H - m, m, m);
    if (ring.length < 3) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    for (let i = 0; i < dots.length; i++) {
      const x = dots[i].e, y = dots[i].n; if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      let inside = false; for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const [xa, ya] = ring[a], [xb, yb] = ring[b]; if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside; }
      if (inside) covered[i]++;
    }
  });
  return covered;
}

export type DotRow = { id: number; line: [number, number][]; dots: number[]; lengthM: number; perM: number; a0: number; a1: number };
export type RowsFromDots = { rows: DotRow[]; spacingM: number; directionDeg: number; seedM: number | null; offRow: number[] };

/**
 * Rows through the dots (see the header). The direction is searched near `directionDeg` (the first pass's) for the
 * one along which the dots' across offsets repeat most sharply at one spacing; the spacing is that repeat. In windows
 * along the field the across histogram of the dots is peaked at the spacing; peaks are joined window to window within
 * a quarter spacing; each row is the dots within `onRowShare` of its course, and runs from its first dot to its last
 * (gaps bridged by rowExtents' rule from the seed spacing the dots show).
 */
export function rowsFromDots(dots: Dot[], directionDeg: number, spacingGuessM: number, o: PlantsFirstOptions = PLANTS_FIRST, searchDeg = 3, spacingRange = 0.15): RowsFromDots {
  // Direction and spacing: the sharpest periodicity of the across offsets (held as given when the search is 0).
  let bestTh = (directionDeg * Math.PI) / 180, bestS = spacingGuessM, bestR = -1;
  for (let dDeg = -searchDeg; dDeg <= searchDeg + 1e-4; dDeg += 0.1) {
    const th = ((directionDeg + dDeg) * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th);
    for (let s = (1 - spacingRange) * spacingGuessM; s <= (1 + spacingRange) * spacingGuessM + 1e-9; s += 0.002) {
      let sx = 0, sy = 0;
      for (let i = 0; i < dots.length; i += 3) { const c = -dots[i].e * st + dots[i].n * ct, t = (2 * Math.PI * c) / s; sx += Math.cos(t); sy += Math.sin(t); }
      const r = Math.hypot(sx, sy);
      if (r > bestR) { bestR = r; bestTh = th; bestS = s; }
    }
  }
  const ct = Math.cos(bestTh), st = Math.sin(bestTh), S = bestS;
  const A = dots.map(d => d.e * ct + d.n * st), C = dots.map(d => -d.e * st + d.n * ct);
  const aMin = Math.min(...A), aMax = Math.max(...A), nW = Math.max(1, Math.ceil((aMax - aMin) / o.windowM));
  // Per window: row centres at the peaks of the across histogram (1 cm bins, smoothed over 3 cm), at least a
  // spacing's 0.6 apart, each with enough dots.
  type Peak = { w: number; a: number; c: number; used: boolean };
  const peaks: Peak[][] = [];
  for (let w = 0; w < nW; w++) {
    const a0 = aMin + w * o.windowM, a1 = a0 + o.windowM, idx: number[] = [];
    for (let i = 0; i < dots.length; i++) if (A[i] >= a0 && A[i] < a1) idx.push(i);
    const list: Peak[] = [];
    if (idx.length) {
      const cMin = Math.min(...idx.map(i => C[i])) - 0.05, nbin = Math.ceil((Math.max(...idx.map(i => C[i])) + 0.05 - cMin) / 0.01) + 1, h = new Float64Array(nbin);
      for (const i of idx) h[Math.round((C[i] - cMin) / 0.01)]++;
      const sm = Array.from(h, (_, k) => { let t = 0; for (let j = -3; j <= 3; j++) t += h[k + j] ?? 0; return t; });
      const minDots = o.minDotsPerM * o.windowM, sep = Math.round((0.6 * S) / 0.01);
      const cand = sm.map((v, k) => [v, k] as [number, number]).filter(([v]) => v >= minDots).sort((x, y) => y[0] - x[0]), taken: number[] = [];
      for (const [, k] of cand) if (taken.every(t => Math.abs(t - k) >= sep)) taken.push(k);
      for (const k of taken) {
        // The centre: the median offset of the dots within a quarter spacing of the peak.
        const near = idx.filter(i => Math.abs(C[i] - (cMin + k * 0.01)) <= 0.25 * S).map(i => C[i]).sort((x, y) => x - y);
        list.push({ w, a: (a0 + a1) / 2, c: near[near.length >> 1], used: false });
      }
    }
    peaks.push(list);
  }
  // Join peaks window to window (each to the nearest in the next within a quarter spacing; a missing window bridged once).
  const chains: Peak[][] = [];
  for (let w = 0; w < nW; w++) for (const pk of peaks[w]) {
    if (pk.used) continue;
    pk.used = true; const chain = [pk];
    let cur = pk;
    for (let w2 = w + 1; w2 < nW && w2 - cur.w <= 2; w2++) {
      let nb: Peak | null = null, bd = 0.25 * S;
      for (const q of peaks[w2]) if (!q.used && Math.abs(q.c - cur.c) <= bd) { bd = Math.abs(q.c - cur.c); nb = q; }
      if (nb) { nb.used = true; chain.push(nb); cur = nb; }
    }
    chains.push(chain);
  }
  // Each chain's dots, its course through them, its ends at its first and last dot.
  const onRow = o.onRowShare * S, claimed = new Int32Array(dots.length).fill(-1);
  const courseOf = (ch: Peak[]) => (a: number) => { if (a <= ch[0].a) return ch[0].c; if (a >= ch[ch.length - 1].a) return ch[ch.length - 1].c; for (let k = 0; k + 1 < ch.length; k++) if (a >= ch[k].a && a <= ch[k + 1].a) { const t = (a - ch[k].a) / (ch[k + 1].a - ch[k].a); return ch[k].c + t * (ch[k + 1].c - ch[k].c); } return ch[0].c; };
  const prelim: { ch: Peak[]; course: (a: number) => number; dots: number[] }[] = [];
  chains.forEach((ch, ci) => {
    const course = courseOf(ch), a0 = ch[0].a - o.windowM / 2, a1 = ch[ch.length - 1].a + o.windowM / 2, mine: number[] = [];
    for (let i = 0; i < dots.length; i++) { if (A[i] < a0 || A[i] > a1) continue; const d = Math.abs(C[i] - course(A[i])); if (d <= onRow && (claimed[i] < 0 || d < Math.abs(C[i] - prelim[claimed[i]]?.course(A[i]) || Infinity))) { claimed[i] = ci; } }
    prelim.push({ ch, course, dots: mine });
  });
  for (let i = 0; i < dots.length; i++) if (claimed[i] >= 0) prelim[claimed[i]].dots.push(i);
  // The seed spacing the dots show, for the gap rule at the row ends.
  const marks = prelim.flatMap((r, ri) => r.dots.map(i => ({ row: ri + 1, a: A[i] })));
  const seed = seedSpacing(marks, S);
  const seedM = seed.spacingM;
  const maxGap = 4 * (seedM ?? 0.18);
  const rows: DotRow[] = [];
  for (const r of prelim) {
    const ds = r.dots.sort((x, y) => A[x] - A[y]);
    // Runs of dots with no gap over maxGap; the row runs from its first run of 5 or more to its last.
    let first = -1, last = -1;
    for (let s0 = 0; s0 < ds.length;) { let e0 = s0; while (e0 + 1 < ds.length && A[ds[e0 + 1]] - A[ds[e0]] <= maxGap) e0++; if (e0 - s0 + 1 >= 5) { if (first < 0) first = s0; last = e0; } s0 = e0 + 1; }
    if (first < 0) continue;
    const kept = ds.slice(first, last + 1), a0 = A[kept[0]], a1 = A[kept[kept.length - 1]];
    if (a1 - a0 < 1) continue;
    // The course through its own dots: a running median of their offsets every metre.
    const line: [number, number][] = [];
    for (let a = a0; a <= a1 + 1e-6; a = Math.min(a1, a + 1) + (a >= a1 ? 1 : 0)) {
      const near = kept.filter(i => Math.abs(A[i] - a) <= 1.5).map(i => C[i]).sort((x, y) => x - y);
      const c = near.length ? near[near.length >> 1] : r.course(a);
      line.push([a * ct - c * st, a * st + c * ct]);
      if (a >= a1) break;
    }
    rows.push({ id: rows.length + 1, line, dots: kept, lengthM: a1 - a0, perM: kept.length / Math.max(1e-6, a1 - a0), a0, a1 });
  }
  const onAny = new Uint8Array(dots.length); for (const r of rows) for (const i of r.dots) onAny[i] = 1;
  const offRow: number[] = []; for (let i = 0; i < dots.length; i++) if (!onAny[i]) offRow.push(i);
  return { rows, spacingM: S, directionDeg: (bestTh * 180) / Math.PI, seedM, offRow };
}

/**
 * Every dot's row number, from where the certain plants put the rows (the planter's pattern: straight, parallel, one
 * spacing apart). The field is cut into cells (`cellAlongM` x `cellAcrossM`); in each cell holding enough certain
 * plants, the rows' offset across is the circular mean of their across positions over one spacing. Cells are joined
 * outward from the best-held one, each cell's offset taken within half a spacing of its neighbour's (so row numbers
 * stay the same row from cell to cell); cells with too few certain plants take the offset of the nearest held cell.
 * A dot's row number is its across position less its cell's offset, in spacings, rounded; its residual is how far
 * from that row's line it lies.
 */
export function rowNumbers(A: Float64Array, C: Float64Array, certain: Uint8Array, S: number, cellAlongM = 10, cellAcrossM = 6, minPlants = 12): { j: Int32Array; resid: Float64Array; cells: number } {
  const n = A.length;
  let aMin = Infinity, cMin = Infinity, aMax = -Infinity, cMax = -Infinity;
  for (let i = 0; i < n; i++) { aMin = Math.min(aMin, A[i]); aMax = Math.max(aMax, A[i]); cMin = Math.min(cMin, C[i]); cMax = Math.max(cMax, C[i]); }
  const W = Math.max(1, Math.ceil((aMax - aMin) / cellAlongM)), H = Math.max(1, Math.ceil((cMax - cMin) / cellAcrossM));
  const cellOf = (i: number) => Math.min(W - 1, Math.floor((A[i] - aMin) / cellAlongM)) * H + Math.min(H - 1, Math.floor((C[i] - cMin) / cellAcrossM));
  const sx = new Float64Array(W * H), sy = new Float64Array(W * H), cnt = new Int32Array(W * H);
  for (let i = 0; i < n; i++) if (certain[i]) { const k = cellOf(i), t = (2 * Math.PI * C[i]) / S; sx[k] += Math.cos(t); sy[k] += Math.sin(t); cnt[k]++; }
  const phase = new Float64Array(W * H).fill(NaN), strength = new Float64Array(W * H);
  for (let k = 0; k < W * H; k++) if (cnt[k] >= minPlants) { strength[k] = Math.hypot(sx[k], sy[k]) / cnt[k]; if (strength[k] >= 0.3) phase[k] = ((Math.atan2(sy[k], sx[k]) / (2 * Math.PI)) * S); }
  // Joined outward from the best-held cell: each offset unwrapped to within half a spacing of the neighbour it was reached from.
  const done = new Uint8Array(W * H), order: number[] = [];
  const held = Array.from({ length: W * H }, (_, k) => k).filter(k => Number.isFinite(phase[k])).sort((x, y) => cnt[y] * strength[y] - cnt[x] * strength[x]);
  for (const start of held) {
    if (done[start]) continue;
    done[start] = 1; const queue = [start];
    while (queue.length) {
      const k = queue.shift()!; order.push(k);
      const ai = Math.floor(k / H), ci = k % H;
      for (const [da, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a2 = ai + da, c2 = ci + dc; if (a2 < 0 || c2 < 0 || a2 >= W || c2 >= H) continue;
        const k2 = a2 * H + c2; if (done[k2] || !Number.isFinite(phase[k2])) continue;
        phase[k2] += Math.round((phase[k] - phase[k2]) / S) * S;
        done[k2] = 1; queue.push(k2);
      }
    }
  }
  // Cells with too few certain plants: the nearest held cell's offset.
  const heldCells = order;
  for (let k = 0; k < W * H; k++) {
    if (Number.isFinite(phase[k]) || !heldCells.length) continue;
    const ai = Math.floor(k / H), ci = k % H; let best = heldCells[0], bd = Infinity;
    for (const h of heldCells) { const d = Math.hypot((Math.floor(h / H) - ai) * cellAlongM, ((h % H) - ci) * cellAcrossM); if (d < bd) { bd = d; best = h; } }
    phase[k] = phase[best];
  }
  const j = new Int32Array(n), resid = new Float64Array(n);
  for (let i = 0; i < n; i++) { const ph = phase[cellOf(i)]; const x = (C[i] - (Number.isFinite(ph) ? ph : 0)) / S; j[i] = Math.round(x); resid[i] = (x - j[i]) * S; }
  return { j, resid, cells: heldCells.length };
}

/**
 * The order a person reads a field in (2026-11-13, Yunus's sequence): the certain plants first, the rows they make,
 * the field's own geometry measured on those certain rows (row spacing, plant spacing, row length, plants a metre),
 * and only then a second look at everything uncertain, against that geometry. Geometry supports a plant; it never
 * makes one: a stretch of row with no plant seen stays "plants not confirmed".
 *   certain    a dot `certainViews` or more photographs made, and `certainShare` of those that looked at its ground
 *   probable   an uncertain dot the certain geometry supports: on a certain row's course (or just past its ends), a
 *              whole number of plant spacings from the nearest plant on it (never closer than half a spacing)
 *   uncertain  neither: drawn apart, never counted
 * New rows on the second look stand only in a slot the certain rows leave (a whole number of row spacings from one),
 * holding at least `minRowDensityShare` of the certain rows' plants a metre.
 */
export const SEQUENCE = {
  certainViews: 3, certainShare: 0.3, minCertainRowM: 3, probableTol: 0.3, slotTol: 0.15, minRowDensityShare: 0.4, gapSeeds: 2.5, maxGapSeeds: 4,
  /** A gap is still "plants confirmed" while a run of missed plants that long is likelier than `gapRisk` given how
   * full the certain rows are (half the positions found: up to 5 plant spacings at 0.05). */
  gapRisk: 0.05,
  /** A row's line: plants within this share of a spacing are fitted; pieces joined when they agree within `joinTol`. */
  fitTol: 0.1, joinTol: 0.12,
  /** A row's course is straight over this far either way of any point on it (metres), following the slow drift of the
   * placed ground beyond. */
  localM: 8,
  /** A stretch with no plant longer than this (metres) is not bridged: the row stops and, past it, starts again.
   * "The row probably continues" is said over a missed plant or a short failed stretch, never across a headland. */
  maxBridgeM: 8,
};
export type RowSegment = { a0: number; a1: number; confirmed: boolean };
export type SeqRow = { id: number; kind: "certain" | "geometry"; line: [number, number][]; dots: number[]; a0: number; a1: number; lengthM: number; perM: number; segments: RowSegment[] };
export type Reconstruction = {
  /** Per dot: 0 certain, 1 probable (the certain geometry supports it), 2 uncertain. */
  certainty: Uint8Array;
  rows: SeqRow[];
  /** Per dot: the index of the row it is on, or -1. */
  rowOf: Int32Array;
  /** Per dot: 1 when it is on no row and has a row on either side of it within a spacing: between the rows, not the crop. */
  between: Uint8Array;
  /** Per dot, why it is on no row: 0 on a row, 1 no row reaches it, 2 as close as a double to a plant on the row, 3 not at the plant spacing, 4 between two rows. */
  why: Uint8Array;
  /** The gap rule as measured, and what it did: gaps bridged as confirmed, stretches not confirmed, rows cut. */
  gaps: { filled: number; gapM: number; bridged: number; notConfirmedStretches: number; cutOverMaxBridge: number; cutLengthM: number };
  geometry: { spacingM: number; directionDeg: number; seedM: number | null; rowLengthMedianM: number; perMMedian: number; certainDots: number; certainRows: number };
  /** Along / across of every dot in the rows' frame, metres. */
  a: Float64Array; c: Float64Array;
};

export function reconstruct(dots: Dot[], covered: Int32Array, directionDeg: number, spacingGuessM: number, o: PlantsFirstOptions = PLANTS_FIRST, q = SEQUENCE): Reconstruction {
  const n = dots.length, certainty = new Uint8Array(n).fill(2);
  for (let i = 0; i < n; i++) if (dots[i].photos >= q.certainViews && covered[i] > 0 && dots[i].photos / covered[i] >= q.certainShare) certainty[i] = 0;
  // 1-2. The certain plants, and the rows they make.
  const cIdx: number[] = []; for (let i = 0; i < n; i++) if (certainty[i] === 0) cIdx.push(i);
  const R1 = rowsFromDots(cIdx.map(i => dots[i]), directionDeg, spacingGuessM, o);
  const th = (R1.directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th), S = R1.spacingM;
  const A = new Float64Array(n), C = new Float64Array(n);
  for (let i = 0; i < n; i++) { A[i] = dots[i].e * ct + dots[i].n * st; C[i] = -dots[i].e * st + dots[i].n * ct; }
  // A planter drives straight, but the ground the photographs are placed on is not rigid over a whole flight (cameras
  // without RTK drift by tens of centimetres over a hundred metres): a row is straight over a stretch and follows that
  // slow drift. Its course is a line fitted locally (tricube weights within `localM` either way), every 2 m along it,
  // robustly: plants further than `fitTol` of a spacing from the course are dropped and it is fitted again.
  type Line = { ka: Float64Array; kc: Float64Array; a0: number; a1: number; dots: number[] };
  const at = (L: Line, a: number) => { const X = L.ka, Y = L.kc; if (a <= X[0]) return Y[0]; if (a >= X[X.length - 1]) return Y[Y.length - 1]; let lo = 0, hi = X.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] <= a) lo = m; else hi = m; } const t = (a - X[lo]) / (X[hi] - X[lo] || 1); return Y[lo] + t * (Y[hi] - Y[lo]); };
  const course = (use: number[], a0: number, a1: number): { ka: Float64Array; kc: Float64Array } => {
    const sorted = [...use].sort((x, y) => A[x] - A[y]), ka: number[] = [], kc: number[] = [], h = q.localM;
    for (let a = a0; ; a = Math.min(a1, a + 2)) {
      let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const i of sorted) { const d = A[i] - a; if (d < -h) continue; if (d > h) break; const w = (1 - Math.abs(d / h) ** 3) ** 3; sw += w; sx += w * d; sy += w * C[i]; sxx += w * d * d; sxy += w * d * C[i]; }
      if (sw > 0) { const det = sw * sxx - sx * sx; const c = Math.abs(det) > 1e-9 && sw >= 3 ? (sy * sxx - sx * sxy) / det : sy / sw; ka.push(a); kc.push(c); }
      if (a >= a1) break;
    }
    return { ka: Float64Array.from(ka), kc: Float64Array.from(kc) };
  };
  const fit = (idx: number[]): Line | null => {
    if (idx.length < 2) return null;
    let use = idx, L: Line | null = null;
    for (let it = 0; it < 4; it++) {
      const a0 = Math.min(...use.map(i => A[i])), a1 = Math.max(...use.map(i => A[i]));
      const k = course(use, a0, a1); if (k.ka.length < 1) break;
      L = { ...k, a0, a1, dots: use };
      const keep = idx.filter(i => Math.abs(C[i] - at(L!, A[i])) <= q.fitTol * S);
      if (keep.length === use.length || keep.length < 2) break;
      use = keep;
    }
    return L;
  };
  // Each certain plant's row number from the planter's pattern (rowNumbers), and one straight line per row number.
  const isCertain = new Uint8Array(n); for (const i of cIdx) isCertain[i] = 1;
  const RN = rowNumbers(A, C, isCertain, S);
  const byJ = new Map<number, number[]>();
  for (const i of cIdx) if (Math.abs(RN.resid[i]) <= 0.2 * S) (byJ.get(RN.j[i]) ?? byJ.set(RN.j[i], []).get(RN.j[i])!).push(i);
  let lines = [...byJ.values()].filter(g => g.length >= 5).map(fit).filter((L): L is Line => !!L && L.a1 - L.a0 >= q.minCertainRowM);
  // Pieces of one row joined: two lines that agree (within `joinTol` of a spacing) where one ends and the other begins.
  for (let changed = true; changed;) {
    changed = false;
    lines.sort((x, y) => x.a0 - y.a0);
    outer: for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j], mid = (Math.min(a.a1, b.a1) + Math.max(a.a0, b.a0)) / 2;
      if (Math.abs(at(a, mid) - at(b, mid)) > q.joinTol * S) continue;
      // Not two neighbouring rows overlapping: where both hold plants, they must be the same line all along.
      const ov0 = Math.max(a.a0, b.a0), ov1 = Math.min(a.a1, b.a1);
      if (ov1 > ov0 && (Math.abs(at(a, ov0) - at(b, ov0)) > q.joinTol * S || Math.abs(at(a, ov1) - at(b, ov1)) > q.joinTol * S)) continue;
      const m = fit([...a.dots, ...b.dots]); if (!m) continue;
      lines = lines.filter((_, k) => k !== i && k !== j); lines.push(m); changed = true; break outer;
    }
  }
  // 3. The field's own geometry, from the certain rows.
  const med = (xs: number[]) => { const t = [...xs].sort((x, y) => x - y); return t.length ? t[t.length >> 1] : NaN; };
  const seedM = R1.seedM, seed = seedM ?? 0.18;
  const geometry = { spacingM: S, directionDeg: R1.directionDeg, seedM, rowLengthMedianM: med(lines.map(r => r.a1 - r.a0)), perMMedian: med(lines.map(r => r.dots.length / Math.max(1e-6, r.a1 - r.a0))), certainDots: cIdx.length, certainRows: lines.length };
  // 4-5. Every other dot again, strongest first: on a certain row's line (within its reach past the ends), at a whole
  // number of plant spacings from the nearest plant on it, it is probable; between the rows it is not the crop.
  const onRow = o.onRowShare * S, reach = q.maxGapSeeds * seed;
  // Why a dot is on no row (diagnostics): 0 on a row, 1 no row reaches it, 2 as close to a plant on the row as a
  // double, 3 not a whole number of plant spacings from the row's plants, 4 between two rows (set at the end).
  const why = new Uint8Array(n);
  const nearestRow = (i: number, list: Line[]) => { let best = -1, bd = onRow; list.forEach((r, ri) => { if (A[i] < r.a0 - reach || A[i] > r.a1 + reach) return; const d = Math.abs(C[i] - at(r, A[i])); if (d <= bd) { bd = d; best = ri; } }); return best; };
  const along = lines.map(r => r.dots.map(i => A[i]));
  const extra = lines.map(() => [] as number[]);
  const onCertain = new Uint8Array(n); for (const r of lines) for (const i of r.dots) onCertain[i] = 1;
  const order = Array.from({ length: n }, (_, i) => i).filter(i => !onCertain[i]).sort((x, y) => dots[y].photos - dots[x].photos);
  for (const i of order) {
    const ri = nearestRow(i, lines); if (ri < 0) { why[i] = 1; continue; }
    let nearest = Infinity; for (const a of along[ri]) nearest = Math.min(nearest, Math.abs(a - A[i]));
    if (nearest < 0.5 * seed) { why[i] = 2; continue; } // as close as a double, or the same plant twice: not taken on geometry
    const k = Math.round(nearest / seed);
    if (k < 1 || k > q.maxGapSeeds || Math.abs(nearest - k * seed) > q.probableTol * seed) { why[i] = 3; continue; }
    if (certainty[i] === 2) certainty[i] = 1;
    along[ri].push(A[i]); extra[ri].push(i); onCertain[i] = 1;
  }
  // New rows from what is left, only in a row slot of the planter's pattern that no certain row holds there, as dense
  // as the certain rows are, straight.
  const restByJ = new Map<number, number[]>();
  for (let i = 0; i < n; i++) if (!onCertain[i] && Math.abs(RN.resid[i]) <= onRow) (restByJ.get(RN.j[i]) ?? restByJ.set(RN.j[i], []).get(RN.j[i])!).push(i);
  const geomLines: Line[] = [];
  for (const g of restByJ.values()) {
    if (g.length < 5) continue;
    const L = fit(g); if (!L || L.a1 - L.a0 < q.minCertainRowM) continue;
    // Not where a certain row already runs: the slot must be free over this stretch.
    const mid = (L.a0 + L.a1) / 2;
    if (lines.some(cr => mid >= cr.a0 - 2 && mid <= cr.a1 + 2 && Math.abs(at(cr, mid) - at(L, mid)) < 0.5 * S)) continue;
    if (L.dots.length / Math.max(1e-6, L.a1 - L.a0) < q.minRowDensityShare * geometry.perMMedian) continue;
    geomLines.push(L);
  }
  // How full the certain rows are, and so how long a run of missed plants is still ordinary there.
  const filled = Math.min(0.95, Math.max(0.15, geometry.perMMedian * seed));
  const gapK = Math.max(q.gapSeeds, Math.ceil(Math.log(q.gapRisk) / Math.log(1 - filled))), gapM = gapK * seed;
  const breaks = { bridged: 0, notConfirmedStretches: 0, cutOverMaxBridge: 0, cutLengthM: 0 };
  // Rows with their stretches: plants confirmed, or a gap of over `gapM` ("the row probably
  // continues here; plants not confirmed").
  const rows: SeqRow[] = [], rowOf = new Int32Array(n).fill(-1);
  const build = (kind: SeqRow["kind"], ds: number[], L: Line) => {
    const all = [...new Set(ds)].sort((x, y) => A[x] - A[y]);
    // Cut where no plant stands for over maxBridgeM; each piece with 3 or more plants is a row of its own.
    for (let s0 = 0; s0 < all.length;) { let e0 = s0; while (e0 + 1 < all.length && A[all[e0 + 1]] - A[all[e0]] <= q.maxBridgeM) e0++; if (e0 - s0 + 1 >= 3) piece(kind, all.slice(s0, e0 + 1), L); if (e0 + 1 < all.length) { breaks.cutOverMaxBridge++; breaks.cutLengthM += A[all[e0 + 1]] - A[all[e0]]; } s0 = e0 + 1; }
  };
  const piece = (kind: SeqRow["kind"], sorted: number[], L: Line) => {
    if (sorted.length < 2) return;
    const a0 = A[sorted[0]], a1 = A[sorted[sorted.length - 1]], segs: RowSegment[] = [];
    let s0 = a0;
    for (let k = 1; k < sorted.length; k++) { const g0 = A[sorted[k - 1]], g1 = A[sorted[k]]; if (g1 - g0 > gapM) { if (g0 > s0) segs.push({ a0: s0, a1: g0, confirmed: true }); segs.push({ a0: g0, a1: g1, confirmed: false }); s0 = g1; breaks.notConfirmedStretches++; } else if (g1 - g0 > 1.5 * seed) breaks.bridged++; }
    if (a1 > s0) segs.push({ a0: s0, a1, confirmed: true });
    // The drawn course: refitted through all its plants (the certain ones and those the second look added).
    const k = course(sorted, a0, a1), LL: Line = { ...k, a0, a1, dots: sorted };
    const line: [number, number][] = []; for (let a = a0; ; a = Math.min(a1, a + 1)) { const c = at(k.ka.length ? LL : L, a); line.push([a * ct - c * st, a * st + c * ct]); if (a >= a1) break; }
    for (const i of sorted) rowOf[i] = rows.length;
    rows.push({ id: rows.length + 1, kind, line, dots: sorted, a0, a1, lengthM: a1 - a0, perM: sorted.length / Math.max(1e-6, a1 - a0), segments: segs });
  };
  lines.forEach((L, ri) => build("certain", [...L.dots, ...extra[ri]], L));
  for (const L of geomLines) { for (const i of L.dots) if (certainty[i] === 2) certainty[i] = 1; build("geometry", L.dots, L); }
  // A probable dot that ended on no row is uncertain again.
  for (let i = 0; i < n; i++) if (certainty[i] === 1 && rowOf[i] < 0) certainty[i] = 2;
  // Between the rows: a dot on no row, with a row on either side of it within a spacing, is not the crop.
  const between = new Uint8Array(n);
  const all = [...lines, ...geomLines];
  for (let i = 0; i < n; i++) {
    if (rowOf[i] >= 0) continue;
    let below = false, above = false;
    for (const r of all) { if (A[i] < r.a0 - reach || A[i] > r.a1 + reach) continue; const d = C[i] - at(r, A[i]); if (d > 0 && d < 1.2 * S) below = true; if (d < 0 && d > -1.2 * S) above = true; }
    if (below && above) { between[i] = 1; why[i] = 4; }
  }
  for (let i = 0; i < n; i++) if (rowOf[i] >= 0) why[i] = 0; else if (!why[i]) why[i] = 1;
  return { certainty, rows, rowOf, between, why, gaps: { filled, gapM, ...breaks }, geometry, a: A, c: C };
}
