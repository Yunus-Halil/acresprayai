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
import { ROW_GUIDED, bandBeatsControls, seedSpacing } from "./rowGuided";

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
  return mergeXY(xs, ys, i => sights[i].p, gateM, minPhotos);
}

/** The grouping of mergeDots over any positions: `photoOf(i)` is the photograph of sighting i. */
function mergeXY(xs: Float64Array, ys: Float64Array, photoOf: (i: number) => number, gateM: number, minPhotos: number): Dot[] {
  const sights = { length: xs.length };
  const grid = new Grid(xs, ys, Math.max(0.05, gateM));
  const density = new Int32Array(sights.length);
  for (let i = 0; i < sights.length; i++) grid.near(xs[i], ys[i], gateM, j => { if (photoOf(j) !== photoOf(i) && Math.hypot(xs[j] - xs[i], ys[j] - ys[i]) <= gateM) density[i]++; });
  const order = Int32Array.from({ length: sights.length }, (_, i) => i).sort((a, b) => density[b] - density[a]);
  const claimed = new Uint8Array(sights.length), dots: Dot[] = [];
  const gather = (cx: number, cy: number): number[] => {
    const best = new Map<number, [number, number]>();
    grid.near(cx, cy, gateM, j => { if (claimed[j]) return; const d = Math.hypot(xs[j] - cx, ys[j] - cy); if (d > gateM) return; const b = best.get(photoOf(j)); if (!b || d < b[1]) best.set(photoOf(j), [j, d]); });
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

export const ROW_RECALL = {
  /** A candidate this close to a dot the stricter marks made is that plant again (another leaf of it): left out. */
  exclM: 0.06,
  /** A candidate this close to a stricter mark of its own photograph is that mark again. */
  sameMarkM: 0.03,
  /** Candidates of different photographs are one plant within this far along the rows and this far across them: a
   * mark sits at the middle of the green its photograph saw, and which leaf that is changes from photograph to
   * photograph, mostly along the row (measured: lone marks of one plant a median 6 cm apart). */
  gateAlongM: 0.09, gateAcrossM: 0.045,
  /** One photograph alone is enough on a row only where it sees sharply: within this angle of straight down
   * (measured: a frame's edges are soft and lose the leaves' colour). */
  sharpDeg: 20,
  /** Loosened (off by default): one photograph anywhere in its frame is a candidate too (tier 3, placed last). */
  anyView: false,
};
export type RowRecallOptions = typeof ROW_RECALL;

/**
 * Candidates for plants ALONG THE ROWS that the stricter marks did not make into a dot (2026-11-16): each photograph's
 * marks at the lower bar (`low`, greenPoints.ts rowPlantPoints) and the stricter marks only one photograph made.
 * Placed with the photographs' corrections as they stand (the registration is never redone with them), left out
 * within `exclM` of an existing dot, joined across photographs with a gate longer along the rows than across them.
 * Tier 1: two or more photographs. Tier 2: one photograph, where it sees sharply. Tier 3 (only with `anyView`): one
 * photograph, anywhere in its frame. They are only ever kept on a row
 * (reconstruct: probable at most, never a certain plant, tier 2 never a row of its own): off the rows nothing changes,
 * so no weed and no dot between the rows comes from them.
 */
export function rowCandidates(low: Read[], frames: Map<string, GeorefFrame>, origin: LatLngAlt, photos: string[], shifts: PhotoShift[], sights: Sight[], dots: Dot[], directionDeg: number, o: RowRecallOptions = ROW_RECALL): { dots: Dot[]; tier: Uint8Array } {
  const pOf = new Map(photos.map((n, i) => [n, i]));
  const ce: number[] = [], cn: number[] = [], cp: number[] = [], sharp: number[] = [];
  const offNadir = (f: GeorefFrame, u: number, v: number) => (Math.atan(Math.hypot((u - f.intrinsics.cx) / f.intrinsics.fx, (v - f.intrinsics.cy) / f.intrinsics.fy)) * 180) / Math.PI;
  // The stricter marks only one photograph made.
  const inDot = new Uint8Array(sights.length); for (const d of dots) for (const m of d.members) inDot[m] = 1;
  const loneX: number[] = [], loneY: number[] = [], loneP: number[] = [];
  sights.forEach((s, i) => {
    if (inDot[i]) return;
    const f = frames.get(photos[s.p]); if (!f) return;
    const [de, dn] = shiftOf(shifts[s.p], s.u, s.v);
    loneX.push(s.e + de); loneY.push(s.n + dn); loneP.push(s.p);
    ce.push(s.e + de); cn.push(s.n + dn); cp.push(s.p); sharp.push(offNadir(f, s.u, s.v) <= o.sharpDeg ? 1 : 0);
  });
  const loneGrid = new Grid(loneX, loneY, 0.1);
  for (const r of low) {
    const p = pOf.get(r.name), f = frames.get(r.name); if (p == null || !f) continue;
    for (const [x, y] of r.plants) {
      const u = x * r.scale, v = y * r.scale, g = pixelToGround(f, u, v); if (!g) continue;
      const [e0, n0] = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, origin), [de, dn] = shiftOf(shifts[p], u, v), e = e0 + de, n = n0 + dn;
      let same = false; loneGrid.near(e, n, o.sameMarkM, k => { if (loneP[k] === p && Math.hypot(loneX[k] - e, loneY[k] - n) <= o.sameMarkM) same = true; });
      if (same) continue;
      ce.push(e); cn.push(n); cp.push(p); sharp.push(offNadir(f, u, v) <= o.sharpDeg ? 1 : 0);
    }
  }
  // Not a plant the stricter marks already made.
  const dotGrid = new Grid(dots.map(d => d.e), dots.map(d => d.n), 0.1);
  const keep: number[] = [];
  for (let i = 0; i < ce.length; i++) { let near = false; dotGrid.near(ce[i], cn[i], o.exclM, k => { if (Math.hypot(dots[k].e - ce[i], dots[k].n - cn[i]) <= o.exclM) near = true; }); if (!near) keep.push(i); }
  // Joined across photographs: along / across the rows, the across axis stretched so one gate serves both.
  const th = (directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th), k = o.gateAlongM / o.gateAcrossM;
  const xs = new Float64Array(keep.length), ys = new Float64Array(keep.length);
  keep.forEach((i, j) => { xs[j] = ce[i] * ct + cn[i] * st; ys[j] = (-ce[i] * st + cn[i] * ct) * k; });
  const groups = mergeXY(xs, ys, j => cp[keep[j]], o.gateAlongM, 1);
  const out: Dot[] = [], tier: number[] = [];
  for (const g of groups) {
    const m = g.members.map(j => keep[j]);
    if (m.length === 1 && !sharp[m[0]] && !o.anyView) continue;
    const e = m.reduce((t, i) => t + ce[i], 0) / m.length, n = m.reduce((t, i) => t + cn[i], 0) / m.length;
    out.push({ e, n, members: [], photos: m.length, spreadM: Math.sqrt(m.reduce((t, i) => t + (ce[i] - e) ** 2 + (cn[i] - n) ** 2, 0) / m.length) });
    tier.push(m.length >= 2 ? 1 : sharp[m[0]] ? 2 : 3);
  }
  return { dots: out, tier: Uint8Array.from(tier) };
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
 * `patternOnly`: a cell that holds enough certain plants and no row pattern in them (strength under 0.3) is not given
 * its neighbour's: its dots get no row number (residual Infinity), so no row is made of them. Without it such a cell
 * was filled like a cell with too few plants, and the scattered plants of a headland within a fifth of a spacing of
 * the carried lines became row plants.
 */
export function rowNumbers(A: Float64Array, C: Float64Array, certain: Uint8Array, S: number, cellAlongM = 10, cellAcrossM = 6, minPlants = 12, patternOnly = false): { j: Int32Array; resid: Float64Array; cells: number; /** Cells with plants and no pattern, left without rows. */ flat: number } {
  const n = A.length;
  let aMin = Infinity, cMin = Infinity, aMax = -Infinity, cMax = -Infinity;
  for (let i = 0; i < n; i++) { aMin = Math.min(aMin, A[i]); aMax = Math.max(aMax, A[i]); cMin = Math.min(cMin, C[i]); cMax = Math.max(cMax, C[i]); }
  const W = Math.max(1, Math.ceil((aMax - aMin) / cellAlongM)), H = Math.max(1, Math.ceil((cMax - cMin) / cellAcrossM));
  const cellOf = (i: number) => Math.min(W - 1, Math.floor((A[i] - aMin) / cellAlongM)) * H + Math.min(H - 1, Math.floor((C[i] - cMin) / cellAcrossM));
  const sx = new Float64Array(W * H), sy = new Float64Array(W * H), cnt = new Int32Array(W * H);
  for (let i = 0; i < n; i++) if (certain[i]) { const k = cellOf(i), t = (2 * Math.PI * C[i]) / S; sx[k] += Math.cos(t); sy[k] += Math.sin(t); cnt[k]++; }
  const phase = new Float64Array(W * H).fill(NaN), strength = new Float64Array(W * H), flat = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) if (cnt[k] >= minPlants) { strength[k] = Math.hypot(sx[k], sy[k]) / cnt[k]; if (strength[k] >= 0.3) phase[k] = ((Math.atan2(sy[k], sx[k]) / (2 * Math.PI)) * S); else if (patternOnly) flat[k] = 1; }
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
    if (Number.isFinite(phase[k]) || flat[k] || !heldCells.length) continue;
    const ai = Math.floor(k / H), ci = k % H; let best = heldCells[0], bd = Infinity;
    for (const h of heldCells) { const d = Math.hypot((Math.floor(h / H) - ai) * cellAlongM, ((h % H) - ci) * cellAcrossM); if (d < bd) { bd = d; best = h; } }
    phase[k] = phase[best];
  }
  const j = new Int32Array(n), resid = new Float64Array(n);
  for (let i = 0; i < n; i++) { const k = cellOf(i); if (flat[k]) { resid[i] = Infinity; continue; } const ph = phase[k]; const x = (C[i] - (Number.isFinite(ph) ? ph : 0)) / S; j[i] = Math.round(x); resid[i] = (x - j[i]) * S; }
  return { j, resid, cells: heldCells.length, flat: flat.reduce((t, x) => t + x, 0) };
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
  /** Loosened placement on a row (off by default, 2026-11-16): a dot within `freeAcrossShare` of a row spacing of a
   * certain row's course, no closer than half a plant spacing to a plant already on it and within `maxGapSeeds` of
   * one, is on the row whatever its distance to its neighbours (a planter does not space plants exactly). */
  free: false, freeAcrossShare: 0.07,
  /** The loosened placement keeps this share of a plant spacing clear of the plants already on the row: measured
   * 2026-11-16, at half a spacing it added 8,500 marks 7-10 cm from a plant already there (a seedling's other leaf),
   * a distance under 4 % of neighbouring plants stand at. */
  freeMinSeeds: 0.7,
  /** No rows on unplanted ground (2026-11-16); both only on a flight whose ground the field judged (`ground` handed
   * in). `patternCellsOnly`: a cell with plenty of certain plants and no row pattern in them holds no row (rowNumbers
   * `patternOnly`; the plants on ground judged scattered are not counted in the pattern). `refuseScattered`: on ground the field's plants show as
   * scattered (cornField.ts FIELD.planted, handed in as `ground`) no certain plant makes a row, no dot is a probable
   * plant, no candidate is taken, and a row is cut where its course would cross that ground. Ground the field did not
   * judge, and a flight it judged none of, read as before. */
  patternCellsOnly: true, refuseScattered: true,
  /** Rows guide the search, they never make a plant (2026-11-16). A candidate of the second look, and any dot the
   * loosened placement would take, is kept on a row only along a stretch of it where dots stand on the row's line
   * clearly more than on the ground between the rows: rowGuided.ts's stretch test (bandBeatsControls: the band against
   * its two mid-alley strips, over `stretchM` of row), on the dots, which every photograph located without a row.
   * Which dots are counted, for a dot of the stricter marks always those dots, and for a candidate:
   *   "row"  the row's band as it stands: the stricter marks' dots and the candidates as strong as it or stronger
   *          (its tier and the tiers placed before it), on the line against between the rows. A full row with three
   *          plants missing passes on its own plants; a line through scattered plants or across bare ground does not.
   *          Known limit: a bare strip shorter than a stretch shares its stretch with planted row and passes with it;
   *   "own"  only the candidates as strong as it or stronger, against the same between the rows. Stricter, and
   *          biased against a well-read row: its band holds only the plants the stricter marks missed, the alley
   *          everything the second look finds there (measured 2026-11-16 on one photograph: 48 candidates of 2 to 6
   *          photographs standing on seedlings of one row refused, the alleys beside it cracked soil);
   *   "all"  every dot, whatever its tier;
   *   "none" the test is not asked (as before). */
  alleyTest: "row" as "none" | "own" | "row" | "all",
  /** Where the test's two control strips are centred, as a share of the row spacing either side of the row: mid-alley
   * (rowGuided.ts controlShare). Only the scoreboard changes it, to read phantom rows laid half way between the real
   * ones against strips a quarter spacing either side of them. */
  alleyControlShare: ROW_GUIDED.controlShare,
  /** "Between two rows" is said only of a dot that stands off every row's line (2026-11-16). Before, a dot left off
   * the row it stands on (a double, off the plant spacing, refused) was counted as lying beside that very row, and with
   * the next row on its other side it read "between two rows, not the crop": on the first flight judged, 13,600 dots. */
  betweenOffLines: true,
};
/** The rules as they stood on 2026-11-16 at f23efc0, before the changes above them here: kept so that result can be run beside the present one. */
export const SEQUENCE_V1: typeof SEQUENCE = { ...SEQUENCE, patternCellsOnly: false, refuseScattered: false, alleyTest: "none", betweenOffLines: false };
/** The field's judgement of the ground as reconstruct takes it (cornField.ts FieldGround): at a place, metres east and
 * north, 0 unknown, 1 planted, 2 scattered; `dotState` where the caller judged the dots itself. */
export type GroundJudge = { state: (e: number, n: number) => 0 | 1 | 2; dotState?: Uint8Array | null };
export type RowSegment = { a0: number; a1: number; confirmed: boolean };
/** A row's course in the rows' frame: its across position at knots along it, from its first plant to its last, and the dots it was fitted through. */
export type RowCourse = { ka: Float64Array; kc: Float64Array; a0: number; a1: number; dots: number[] };
/** A course's across position at `a` along (held level past its ends). */
export const courseAt = (L: RowCourse, a: number) => { const X = L.ka, Y = L.kc; if (a <= X[0]) return Y[0]; if (a >= X[X.length - 1]) return Y[Y.length - 1]; let lo = 0, hi = X.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] <= a) lo = m; else hi = m; } const t = (a - X[lo]) / (X[hi] - X[lo] || 1); return Y[lo] + t * (Y[hi] - Y[lo]); };
/** Whether a dot is a certain plant on its own evidence: enough photographs made it, and enough of those that looked at its ground. */
export const certainEvidence = (d: Dot, covered: number, q: { certainViews: number; certainShare: number } = SEQUENCE) => d.photos >= q.certainViews && covered > 0 && d.photos / covered >= q.certainShare;
export type SeqRow = { id: number; kind: "certain" | "geometry"; line: [number, number][]; dots: number[]; a0: number; a1: number; lengthM: number; perM: number; segments: RowSegment[] };
export type Reconstruction = {
  /** Per dot: 0 certain, 1 probable (the certain geometry supports it), 2 uncertain. */
  certainty: Uint8Array;
  rows: SeqRow[];
  /** Per dot: the index of the row it is on, or -1. */
  rowOf: Int32Array;
  /** Per dot: 1 when it is on no row, off every row's line, and has a row on either side of it within a spacing: between the rows, not the crop. */
  between: Uint8Array;
  /** Per dot, why it is on no row: 0 on a row, 1 no row reaches it, 2 as close as a double to a plant on the row, 3 not at the plant spacing, 4 between two rows, 5 on ground the field's plants show as scattered, 6 a candidate (or a dot for the loosened placement) on a stretch of row whose band does not beat the ground between the rows. */
  why: Uint8Array;
  /** The gap rule as measured, and what it did: gaps bridged as confirmed, stretches not confirmed, rows cut (over a
   * stretch with no plant, and where the course would cross ground judged scattered). */
  gaps: { filled: number; gapM: number; bridged: number; notConfirmedStretches: number; cutOverMaxBridge: number; cutLengthM: number; cutOverScattered: number };
  /** Unplanted ground: dots on ground judged scattered (all, and the certain ones among them), and cells with plants
   * and no row pattern that were left without rows. */
  unplanted: { dotsOnScattered: number; certainOnScattered: number; flatCells: number };
  /** The band-against-alley test (`alleyTest`): dots it kept off a row. */
  alleyRefused: number;
  geometry: { spacingM: number; directionDeg: number; seedM: number | null; rowLengthMedianM: number; perMMedian: number; certainDots: number; certainRows: number };
  /** Along / across of every dot in the rows' frame, metres. */
  a: Float64Array; c: Float64Array;
  /** Per dot: 1 when it is on a row only by the loosened placement (`free`), not at the plant spacing. */
  loose: Uint8Array;
  /** The courses of the rows the certain plants made (before anything was placed along them), and of the rows found in
   * a slot those leave. */
  courses: RowCourse[]; geomCourses: RowCourse[];
};

export type StretchCount = { /** Index into the courses given. */ row: number; a0: number; a1: number; /** Per class: dots within the band on the row's line, and in its two mid-alley strips together. */ band: Int32Array; alley: Int32Array };

/**
 * What stands on each row's line and what stands between the rows there (2026-11-16), per stretch of `stretchM` along
 * each course and per class of dot (`cls`, negative: not counted). The band is the ground within `halfM` of the course;
 * the two control strips are centred `controlShare` of the row spacing either side of it (mid-alley, the ground
 * farthest from both neighbouring rows) and are as wide as the band, never wider than `controlHalfShare` allows:
 * rowGuided.ts's strips, on the dots. A dot past a course's end by up to `reachM` counts in its last stretch.
 * `controlScale` times an alley count is a count over the band's area (1 when the strips are as wide as the band).
 * `stretchOf(row, a)` is the index of the stretch of course `row` that holds `a` along.
 */
export function bandAndAlley(courses: RowCourse[], A: ArrayLike<number>, C: ArrayLike<number>, cls: ArrayLike<number>, nCls: number, S: number, halfM: number, reachM: number, o: Pick<typeof ROW_GUIDED, "stretchM" | "controlShare" | "controlHalfShare"> = ROW_GUIDED): { stretches: StretchCount[]; first: number[]; controlScale: number; stretchOf: (row: number, a: number) => number } {
  const halfC = Math.min(halfM, o.controlHalfShare * S), off = o.controlShare * S;
  const first: number[] = [], out: StretchCount[] = [];
  // Whole stretches; the last takes what is left over (a sliver at a row's end could never pass the test on its own).
  courses.forEach((r, ri) => { first.push(out.length); const n = Math.max(1, Math.floor((r.a1 - r.a0) / o.stretchM + 1e-9)); for (let k = 0; k < n; k++) out.push({ row: ri, a0: r.a0 + k * o.stretchM, a1: k === n - 1 ? r.a1 : r.a0 + (k + 1) * o.stretchM, band: new Int32Array(nCls), alley: new Int32Array(nCls) }); });
  first.push(out.length);
  const stretchOf = (ri: number, a: number) => first[ri] + Math.min(first[ri + 1] - first[ri] - 1, Math.max(0, Math.floor((a - courses[ri].a0) / o.stretchM)));
  for (let i = 0; i < A.length; i++) {
    const c = cls[i]; if (c < 0) continue;
    for (let ri = 0; ri < courses.length; ri++) {
      const r = courses[ri]; if (A[i] < r.a0 - reachM || A[i] > r.a1 + reachM) continue;
      const d = Math.abs(C[i] - courseAt(r, A[i])), inBand = d <= halfM;
      if (!inBand && Math.abs(d - off) > halfC) continue;
      const k = stretchOf(ri, A[i]);
      if (inBand) out[k].band[c]++; else out[k].alley[c]++;
    }
  }
  return { stretches: out, first, controlScale: halfM / halfC, stretchOf };
}

/** `notCertain`: dots that may be probable at most (the second look's plants: they confirm a stretch, never start a row).
 * `tier` (rowCandidates): per dot 0 a dot of the stricter marks, 1 / 2 a candidate for the rows; every dot of a lower tier
 * is placed on the rows before any of a higher one; a candidate joins a row the plants found first made, never makes one.
 * `pre`: rowsFromDots over the certain dots, when the caller already made it (the same dots in the same order).
 * `ground`: the field's planted / scattered judgement (used with `q.refuseScattered`). */
export function reconstruct(dots: Dot[], covered: Int32Array, directionDeg: number, spacingGuessM: number, o: PlantsFirstOptions = PLANTS_FIRST, q = SEQUENCE, notCertain: Uint8Array | null = null, tier: Uint8Array | null = null, pre: RowsFromDots | null = null, ground: GroundJudge | null = null): Reconstruction {
  const n = dots.length, certainty = new Uint8Array(n).fill(2);
  for (let i = 0; i < n; i++) if (!notCertain?.[i] && certainEvidence(dots[i], covered[i], q)) certainty[i] = 0;
  // 1-2. The certain plants, and the rows they make.
  const cIdx: number[] = []; for (let i = 0; i < n; i++) if (certainty[i] === 0) cIdx.push(i);
  const R1 = pre ?? rowsFromDots(cIdx.map(i => dots[i]), directionDeg, spacingGuessM, o);
  const th = (R1.directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th), S = R1.spacingM;
  const A = new Float64Array(n), C = new Float64Array(n);
  for (let i = 0; i < n; i++) { A[i] = dots[i].e * ct + dots[i].n * st; C[i] = -dots[i].e * st + dots[i].n * ct; }
  // Ground the field's plants show as scattered: nothing there is the planting (q.refuseScattered).
  const judge = q.refuseScattered ? ground : null, scattered = new Uint8Array(n);
  if (judge) for (let i = 0; i < n; i++) if ((judge.dotState ? judge.dotState[i] : judge.state(dots[i].e, dots[i].n)) === 2) scattered[i] = 1;
  const overScattered = (L: RowCourse, a0: number, a1: number) => { if (!judge) return false; for (let a = a0 + 0.25; a < a1; a += 0.5) { const c = courseAt(L, a); if (judge.state(a * ct - c * st, a * st + c * ct) === 2) return true; } return false; };
  // A planter drives straight, but the ground the photographs are placed on is not rigid over a whole flight (cameras
  // without RTK drift by tens of centimetres over a hundred metres): a row is straight over a stretch and follows that
  // slow drift. Its course is a line fitted locally (tricube weights within `localM` either way), every 2 m along it,
  // robustly: plants further than `fitTol` of a spacing from the course are dropped and it is fitted again.
  type Line = RowCourse;
  const at = courseAt;
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
  const isCertain = new Uint8Array(n); for (const i of cIdx) if (!scattered[i]) isCertain[i] = 1;
  // Only on a flight whose ground the field's plants judged: where they show the planting nowhere (a canopy, where one
  // dot is not one plant), a cell without the pattern says nothing about the ground (measured 2026-11-16 on a flight
  // 45 days after planting, not judged: one cell of a planted field lost its rows, 35 m of them).
  const RN = rowNumbers(A, C, isCertain, S, undefined, undefined, undefined, q.patternCellsOnly && !!ground);
  const byJ = new Map<number, number[]>();
  for (const i of cIdx) if (!scattered[i] && Math.abs(RN.resid[i]) <= 0.2 * S) (byJ.get(RN.j[i]) ?? byJ.set(RN.j[i], []).get(RN.j[i])!).push(i);
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
  // double, 3 not a whole number of plant spacings from the row's plants, 4 between two rows (set at the end), 5 on
  // ground the field's plants show as scattered.
  const why = new Uint8Array(n);
  const nearestRow = (i: number, list: Line[]) => { let best = -1, bd = onRow; list.forEach((r, ri) => { if (A[i] < r.a0 - reach || A[i] > r.a1 + reach) return; const d = Math.abs(C[i] - at(r, A[i])); if (d <= bd) { bd = d; best = ri; } }); return best; };
  // Where a row's band beats the ground between the rows (q.alleyTest), per stretch and per group of dots. Counted
  // before anything is placed: what stands where, not what was made of it.
  // Groups: 0 the stricter marks' dots, 1 to 3 the candidates by tier.
  const groupOf = (i: number) => (tier?.[i] ? Math.min(3, tier[i]) : 0);
  const strips = q.alleyTest === "none" ? null : bandAndAlley(lines, A, C, Int8Array.from({ length: n }, (_, i) => groupOf(i)), 4, S, onRow, reach, { ...ROW_GUIDED, controlShare: q.alleyControlShare });
  const beatsAlley = (ri: number, i: number) => {
    if (!strips) return true;
    const s = strips.stretches[strips.stretchOf(ri, A[i])], g = groupOf(i), len = Math.max(s.a1 - s.a0, 1e-6);
    // Counted: the groups from `lo` to `hi` (see SEQUENCE.alleyTest).
    const lo = q.alleyTest === "own" && g > 0 ? 1 : 0, hi = q.alleyTest === "all" ? 3 : g;
    let band = 0, alley = 0; for (let k = lo; k <= hi; k++) { band += s.band[k]; alley += s.alley[k]; }
    return bandBeatsControls(band, Math.round(alley * strips.controlScale), len);
  };
  let alleyRefused = 0;
  const along = lines.map(r => r.dots.map(i => A[i]));
  const extra = lines.map(() => [] as number[]);
  const onCertain = new Uint8Array(n); for (const r of lines) for (const i of r.dots) onCertain[i] = 1;
  const order = Array.from({ length: n }, (_, i) => i).filter(i => !onCertain[i]).sort((x, y) => (tier ? tier[x] - tier[y] : 0) || dots[y].photos - dots[x].photos);
  for (const i of order) {
    if (scattered[i]) { why[i] = 5; continue; }
    const ri = nearestRow(i, lines); if (ri < 0) { why[i] = 1; continue; }
    if (tier?.[i] && !beatsAlley(ri, i)) { why[i] = 6; alleyRefused++; continue; }
    let nearest = Infinity; for (const a of along[ri]) nearest = Math.min(nearest, Math.abs(a - A[i]));
    if (nearest < 0.5 * seed) { why[i] = 2; continue; } // as close as a double, or the same plant twice: not taken on geometry
    const k = Math.round(nearest / seed);
    if (k < 1 || k > q.maxGapSeeds || Math.abs(nearest - k * seed) > q.probableTol * seed) { why[i] = 3; continue; }
    if (certainty[i] === 2) certainty[i] = 1;
    along[ri].push(A[i]); extra[ri].push(i); onCertain[i] = 1;
  }
  // Loosened (q.free): what the spacing left out, again, strongest first and until nothing more joins: on a row's
  // course (tighter across than above), not a double, within reach of a plant on it. No distance to its neighbours is asked.
  const loose = new Uint8Array(n);
  if (q.free) for (let changed = true; changed;) {
    changed = false;
    for (const i of order) {
      if (onCertain[i] || why[i] !== 3) continue;
      let ri = -1, bd = q.freeAcrossShare * S;
      lines.forEach((r, k) => { if (A[i] < r.a0 - reach || A[i] > r.a1 + reach) return; const d = Math.abs(C[i] - at(r, A[i])); if (d <= bd) { bd = d; ri = k; } });
      if (ri < 0) continue;
      if (!beatsAlley(ri, i)) { why[i] = 6; alleyRefused++; continue; }
      let nearest = Infinity; for (const a of along[ri]) nearest = Math.min(nearest, Math.abs(a - A[i]));
      if (nearest < q.freeMinSeeds * seed) { why[i] = 2; continue; }
      if (nearest > q.maxGapSeeds * seed) continue;
      if (certainty[i] === 2) certainty[i] = 1;
      along[ri].push(A[i]); extra[ri].push(i); onCertain[i] = 1; loose[i] = 1; why[i] = 0; changed = true;
    }
  }
  // New rows from what is left, only in a row slot of the planter's pattern that no certain row holds there, as dense
  // as the certain rows are, straight.
  const restByJ = new Map<number, number[]>();
  // A candidate of the second look (any tier) never makes a row: rows come from the plants found first (2026-11-16).
  for (let i = 0; i < n; i++) if (!onCertain[i] && !tier?.[i] && !scattered[i] && Math.abs(RN.resid[i]) <= onRow) (restByJ.get(RN.j[i]) ?? restByJ.set(RN.j[i], []).get(RN.j[i])!).push(i);
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
  const breaks = { bridged: 0, notConfirmedStretches: 0, cutOverMaxBridge: 0, cutLengthM: 0, cutOverScattered: 0 };
  // Rows with their stretches: plants confirmed, or a gap of over `gapM` ("the row probably
  // continues here; plants not confirmed").
  const rows: SeqRow[] = [], rowOf = new Int32Array(n).fill(-1);
  const build = (kind: SeqRow["kind"], ds: number[], L: Line) => {
    const all = [...new Set(ds)].sort((x, y) => A[x] - A[y]);
    // Cut where no plant stands for over maxBridgeM, and where a stretch with no plant confirmed would cross ground
    // judged scattered; each piece with 3 or more plants is a row of its own.
    const tooFar = (i0: number, i1: number) => A[i1] - A[i0] > q.maxBridgeM, unplanted = (i0: number, i1: number) => A[i1] - A[i0] > gapM && overScattered(L, A[i0], A[i1]);
    for (let s0 = 0; s0 < all.length;) { let e0 = s0; while (e0 + 1 < all.length && !tooFar(all[e0], all[e0 + 1]) && !unplanted(all[e0], all[e0 + 1])) e0++; if (e0 - s0 + 1 >= 3) piece(kind, all.slice(s0, e0 + 1), L); if (e0 + 1 < all.length) { if (tooFar(all[e0], all[e0 + 1])) { breaks.cutOverMaxBridge++; breaks.cutLengthM += A[all[e0 + 1]] - A[all[e0]]; } else breaks.cutOverScattered++; } s0 = e0 + 1; }
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
  // Between the rows: a dot on no row, with a row on either side of it within a spacing, is not the crop. A dot that
  // stands on a row's line (within the band a row's plants are taken in) is not between two rows: that row is the one
  // it stands on, and why it was left off it is already said (q.betweenOffLines).
  const between = new Uint8Array(n);
  const all = [...lines, ...geomLines];
  for (let i = 0; i < n; i++) {
    if (rowOf[i] >= 0) continue;
    let below = false, above = false, onLine = false;
    for (const r of all) { if (A[i] < r.a0 - reach || A[i] > r.a1 + reach) continue; const d = C[i] - at(r, A[i]); if (q.betweenOffLines && Math.abs(d) <= onRow) { onLine = true; break; } if (d > 0 && d < 1.2 * S) below = true; if (d < 0 && d > -1.2 * S) above = true; }
    if (!onLine && below && above) { between[i] = 1; why[i] = 4; }
  }
  for (let i = 0; i < n; i++) if (rowOf[i] >= 0) why[i] = 0; else if (!why[i]) why[i] = 1;
  const unplantedGround = { dotsOnScattered: scattered.reduce((t, x) => t + x, 0), certainOnScattered: cIdx.reduce((t, i) => t + scattered[i], 0), flatCells: RN.flat };
  return { certainty, rows, rowOf, between, why, gaps: { filled, gapM, ...breaks }, unplanted: unplantedGround, alleyRefused, geometry, a: A, c: C, loose, courses: lines, geomCourses: geomLines };
}
