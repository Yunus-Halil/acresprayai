// Corn: the photographs aligned to each other, all together, by their plants (2026-11-25).
//
// The registration before this (plantsFirst.ts registerPhotos) reads each photograph against ALL the others at once and
// moves it half way, five times. Measured pair by pair on the first independent flight (scripts/rowCrop/
// cornAlignMeasure.ts), that leaves one square of ground in seven where two photographs still disagree by more than the
// merge gate, and the disagreement is not a flight line's (under a centimetre on every pair of lines), not a shift of a
// photograph's own (fitting one changes nothing) and not the lens (a shared lens term changes nothing once the fit is
// held): it is each photograph's own turn, scale and tilt, which only show towards its edges, where one plant then
// becomes two dots.
//
// Here the plants are the marks:
//   1. measure   every PAIR of overlapping photographs, in every square of ground both marked: one photograph's marks
//                slid over the other's (centimetre bins); where the same plants lie on top of each other is a sharp
//                peak. Plants a spacing apart along a row repeat too, so a square keeps its three sharpest peaks: the
//                uneven spacing makes the true one the sharpest, and where it does not, the next step decides.
//   2. solve     one correction a photograph (a plane and the two tilt terms: the same eight numbers the registration
//                holds), for ALL photographs in one least-squares fit over all the squares, so no error chains from pair
//                to pair. Misfits over `misfitM` are weighed down, and each square's peak is chosen again among its
//                three after each fit. The corrections are held small (`holdM`): without that the fit can shrink the
//                whole field towards a point, which makes every disagreement smaller and means nothing.
//   3. check     how many marks have another photograph's mark within `checkM`, before and after. Only where that
//                share rises is the correction kept; otherwise the photographs stay as the registration left them.
//   4. the trap  plants a spacing apart along a row match each other too, so a photograph could be put a whole plant
//                along the row from where it belongs and still look matched. The share in 3 does not see that over a
//                flight (measured: every other flight line slid a plant along the rows still scores above the
//                registration). A PAIR of photographs does: where they are put right, the sharpest match in their
//                squares is "no shift"; a plant off, it is a plant spacing away. So after the fit every pair is read
//                again, and the correction is kept only where nearly all pairs' plants lie on each other (`pairsOn`).
// Nothing here knows a field or a row: only marks, photographs and the ground squares.
import { Grid, type PhotoShift, type Sight, shiftOf } from "./plantsFirst";

export const ALIGN_TOGETHER = {
  /** Squares of ground this wide, metres. */
  cellM: 4,
  /** How far apart two photographs' marks may be and still vote, metres (the registration's own reach). */
  reachM: 0.3,
  /** Pairs of marks a square needs before it is read, and marks under its sharpest peak. */
  minVotes: 30, minInPeak: 5,
  /** A square keeps this many peaks, none within `apartM` of another. */
  peaks: 3, apartM: 0.04,
  /** The broad background a peak must stand above: a box this wide around it, metres. */
  backgroundM: 0.12,
  /** Measure and solve this many times. */
  rounds: 2,
  /** Fits a round; a square further than this from the fit is weighed down by how far. */
  fits: 3, misfitM: 0.03,
  /** What a photograph is moved by, at nine places of its frame, counts against the fit as a centimetre of disagreement
   * does at this many metres. Measured: at 0.03 the squares over the gate fell as far as at 0.3 and the marks moved a
   * sixth as far. */
  holdM: 0.03,
  /** The check: a mark is matched when another photograph's mark lies within this, metres. */
  checkM: 0.02,
  /** The matched share must rise by at least this (a share of the marks) for the correction to be kept. */
  minGain: 0.01,
  /** The trap (see the header): a pair of photographs with `pairSquares` squares or more is "on each other" when the
   * sharpest match of at least `pairShare` of them lies within `onM` of no shift; the correction is kept only where at
   * least `pairsOn` of the pairs are. Measured (2026-11-25): on the first independent flight, whose alignment the
   * soil's own texture confirmed (scripts/rowCrop/cornAlignSoilCheck.ts), 0.97 of the pairs after aligning (0.74
   * before); the same flight with every other flight line slid a plant along the rows 0.48, one line slid 0.58, one
   * photograph in five 0.64. On a held-out flight whose lens is not modelled, 0.54 after aligning (0.13 before): the
   * soil says that alignment is better than the registration and not a plant off, but it is not finished, and at
   * this bar it is not kept. */
  onM: 0.03, pairSquares: 4, pairShare: 0.5, pairsOn: 0.85,
};
export type AlignTogetherOptions = typeof ALIGN_TOGETHER;

export type AlignReport = {
  /** The correction was kept. */
  applied: boolean;
  /** Why not, in words; null when kept. */
  why: string | null;
  /** Squares read (a pair of photographs in a square of ground) before and after, and those over `gateM`. */
  squares: [number, number]; overGate: [number, number];
  /** Median size of a square's disagreement, metres, before and after. */
  medianM: [number, number];
  /** Marks, and those with another photograph's mark within `checkM`, before and after. */
  marks: number; matched: [number, number];
  /** How far the correction moves a mark, metres: median and most. */
  movedMedianM: number; movedMostM: number;
  /** Pairs of photographs read for the trap of a plant spacing, and those whose plants lie on each other, after. */
  pairs: number; pairsOn: number;
  ms: number;
};

type Cand = { x: number; y: number; w: number };
type Square = { i: number; j: number; ui: number; vi: number; uj: number; vj: number; c: Cand[] };

const BIN = 0.01;

/** Every pair of photographs in every square of ground both marked: where the second's marks sit from the first's. */
function measure(sights: Sight[], xs: Float64Array, ys: Float64Array, nP: number, o: AlignTogetherOptions): Square[] {
  const R = o.reachM, NB = Math.round((2 * R) / BIN) + 1, grid = new Grid(xs, ys, R), votes = new Map<number, number[]>(), OFF = 512;
  for (let a = 0; a < sights.length; a++) {
    const pa = sights[a].p;
    grid.near(xs[a], ys[a], R, b => {
      if (b <= a) return; const pb = sights[b].p; if (pb === pa) return;
      if (Math.abs(xs[b] - xs[a]) > R || Math.abs(ys[b] - ys[a]) > R) return;
      const i = pa < pb ? pa : pb, j = pa < pb ? pb : pa, gx = Math.floor((xs[a] + xs[b]) / 2 / o.cellM) + OFF, gy = Math.floor((ys[a] + ys[b]) / 2 / o.cellM) + OFF;
      if (gx < 0 || gy < 0 || gx > 1023 || gy > 1023) return;
      const key = ((i * nP + j) * 1024 + gx) * 1024 + gy;
      const v = votes.get(key) ?? votes.set(key, []).get(key)!;
      if (pa < pb) v.push(a, b); else v.push(b, a);
    });
  }
  const out: Square[] = [], h = new Float32Array(NB * NB), S = new Float64Array((NB + 1) * (NB + 1)), half = Math.round(o.backgroundM / BIN), apart = Math.round(o.apartM / BIN);
  const box = (x0: number, y0: number, x1: number, y1: number): [number, number] => { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(NB - 1, x1); y1 = Math.min(NB - 1, y1); return [S[(y1 + 1) * (NB + 1) + x1 + 1] - S[y0 * (NB + 1) + x1 + 1] - S[(y1 + 1) * (NB + 1) + x0] + S[y0 * (NB + 1) + x0], (x1 - x0 + 1) * (y1 - y0 + 1)]; };
  const ex = new Float32Array(NB * NB);
  for (const [key, v] of votes) {
    if (v.length / 2 < o.minVotes) continue;
    h.fill(0);
    for (let k = 0; k < v.length; k += 2) { const bx = Math.round((xs[v[k + 1]] - xs[v[k]] + R) / BIN), by = Math.round((ys[v[k + 1]] - ys[v[k]] + R) / BIN); if (bx >= 0 && by >= 0 && bx < NB && by < NB) h[by * NB + bx]++; }
    for (let y = 0; y < NB; y++) { let row = 0; for (let x = 0; x < NB; x++) { row += h[y * NB + x]; S[(y + 1) * (NB + 1) + x + 1] = S[y * (NB + 1) + x + 1] + row; } }
    // A peak: the 3 x 3 bins less the background around them, and over three spreads of that background.
    ex.fill(0);
    for (let y = 1; y < NB - 1; y++) for (let x = 1; x < NB - 1; x++) { const [s3] = box(x - 1, y - 1, x + 1, y + 1); if (s3 < o.minInPeak) continue; const [sw, aw] = box(x - half, y - half, x + half, y + half), bg = (9 * (sw - s3)) / Math.max(1, aw - 9), e = s3 - bg; if (e >= 3 * Math.sqrt(Math.max(1, bg))) ex[y * NB + x] = e; }
    const c: Cand[] = [], taken: number[] = [];
    for (let k = 0; k < o.peaks; k++) {
      let bx = -1, by = -1, best = 0;
      for (let y = 1; y < NB - 1; y++) for (let x = 1; x < NB - 1; x++) { const e = ex[y * NB + x]; if (e <= best) continue; let free = true; for (let t = 0; t < taken.length; t += 2) if (Math.abs(taken[t] - x) <= apart && Math.abs(taken[t + 1] - y) <= apart) { free = false; break; } if (free) { best = e; bx = x; by = y; } }
      if (bx < 0) break;
      let sx = 0, sy = 0, sw = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const w = h[(by + dy) * NB + bx + dx]; sx += w * (bx + dx); sy += w * (by + dy); sw += w; }
      c.push({ x: (sx / sw) * BIN - R, y: (sy / sw) * BIN - R, w: best }); taken.push(bx, by);
    }
    if (!c.length) continue;
    // Where in the two frames the square was read: the marks under its sharpest peak.
    let ui = 0, vi = 0, uj = 0, vj = 0, n = 0;
    for (let k = 0; k < v.length; k += 2) { const a = v[k], b = v[k + 1]; if (Math.abs(xs[b] - xs[a] - c[0].x) > 2 * BIN || Math.abs(ys[b] - ys[a] - c[0].y) > 2 * BIN) continue; ui += sights[a].u; vi += sights[a].v; uj += sights[b].u; vj += sights[b].v; n++; }
    if (n < o.minInPeak) continue;
    const ij = Math.floor(key / (1024 * 1024));
    out.push({ i: Math.floor(ij / nP), j: ij % nP, ui: ui / n, vi: vi / n, uj: uj / n, vj: vj / n, c });
  }
  return out;
}

/**
 * The trap of a plant spacing, read on marks as they are placed: of the pairs of photographs with squares enough, how
 * many have their plants on each other (the sharpest match of most of their squares is no shift at all).
 */
export function pairsOnEachOther(sights: Sight[], xs: Float64Array, ys: Float64Array, nPhotos: number, o: AlignTogetherOptions = ALIGN_TOGETHER): { pairs: number; on: number } {
  return pairsOf(measure(sights, xs, ys, nPhotos, o), nPhotos, o);
}
function pairsOf(sq: Square[], nP: number, o: AlignTogetherOptions): { pairs: number; on: number } {
  const all = new Map<number, [number, number]>();
  for (const s of sq) { const c = all.get(s.i * nP + s.j) ?? all.set(s.i * nP + s.j, [0, 0]).get(s.i * nP + s.j)!; c[0]++; if (Math.hypot(s.c[0].x, s.c[0].y) <= o.onM) c[1]++; }
  let pairs = 0, on = 0; for (const [n, ok] of all.values()) { if (n < o.pairSquares) continue; pairs++; if (ok >= o.pairShare * n) on++; }
  return { pairs, on };
}

/** Cholesky solve of a symmetric positive system held densely (row-major); null when it is not positive. */
function solveSym(M: Float64Array, b: Float64Array, n: number): Float64Array | null {
  for (let c = 0; c < n; c++) {
    const cc = c * n; let d = M[cc + c]; for (let k = 0; k < c; k++) d -= M[cc + k] * M[cc + k];
    if (!(d > 0)) return null; d = Math.sqrt(d); M[cc + c] = d;
    for (let r = c + 1; r < n; r++) { const rr = r * n; let s = M[rr + c]; for (let k = 0; k < c; k++) s -= M[rr + k] * M[cc + k]; M[rr + c] = s / d; }
  }
  const y = new Float64Array(n); for (let r = 0; r < n; r++) { let s = b[r]; for (let k = 0; k < r; k++) s -= M[r * n + k] * y[k]; y[r] = s / M[r * n + r]; }
  const x = new Float64Array(n); for (let r = n - 1; r >= 0; r--) { let s = y[r]; for (let k = r + 1; k < n; k++) s -= M[k * n + r] * x[k]; x[r] = s / M[r * n + r]; }
  return x;
}

/** Marks with another photograph's mark within `withinM`. */
export function matchedMarks(sights: Sight[], xs: Float64Array, ys: Float64Array, withinM: number): number {
  const grid = new Grid(xs, ys, Math.max(0.05, withinM)); let n = 0;
  for (let a = 0; a < sights.length; a++) { let hit = false; grid.near(xs[a], ys[a], withinM, b => { if (!hit && sights[b].p !== sights[a].p && Math.hypot(xs[b] - xs[a], ys[b] - ys[a]) <= withinM) hit = true; }); if (hit) n++; }
  return n;
}

/** The spread with which the same plant repeats between photographs, as registerPhotos says it (the median distance
 * of a mark from the nearest later mark of another photograph within the reach). */
export function repeatSpread(sights: Sight[], xs: Float64Array, ys: Float64Array, reachM: number): number {
  const grid = new Grid(xs, ys, reachM), nearest: number[] = [];
  for (let i = 0; i < sights.length; i++) { let best = Infinity; grid.near(xs[i], ys[i], reachM, j => { if (j <= i || sights[j].p === sights[i].p) return; const dx = xs[j] - xs[i], dy = ys[j] - ys[i]; if (Math.abs(dx) > reachM || Math.abs(dy) > reachM) return; best = Math.min(best, Math.hypot(dx, dy)); }); if (best < Infinity) nearest.push(best); }
  nearest.sort((a, b) => a - b);
  return nearest.length ? nearest[nearest.length >> 1] : NaN;
}

const placed = (sights: Sight[], shifts: PhotoShift[]) => { const xs = new Float64Array(sights.length), ys = new Float64Array(sights.length); for (let i = 0; i < sights.length; i++) { const s = sights[i], d = shiftOf(shifts[s.p], s.u, s.v); xs[i] = s.e + d[0]; ys[i] = s.n + d[1]; } return { xs, ys }; };

/**
 * The photographs' corrections after the registration, solved together (see the header). `shifts`: the registration's.
 * `gateM`: the merge gate, only for the report. Returns the corrections to use (the registration's own where the check
 * did not pass) and what was measured.
 */
export function alignTogether(sights: Sight[], nPhotos: number, shifts: PhotoShift[], gateM: number, o: AlignTogetherOptions = ALIGN_TOGETHER): { shifts: PhotoShift[]; report: AlignReport } {
  const t0 = Date.now(), nP = nPhotos, N = nP * 8;
  // Every photograph's frame extent, and its slopes from pixels to ground where the registration did not keep them.
  const cnt = new Float64Array(nP), uMin = new Float64Array(nP).fill(Infinity), uMax = new Float64Array(nP).fill(-Infinity), vMin = new Float64Array(nP).fill(Infinity), vMax = new Float64Array(nP).fill(-Infinity), me = new Float64Array(nP), mn = new Float64Array(nP), mu = new Float64Array(nP), mv = new Float64Array(nP);
  for (const s of sights) { const p = s.p; cnt[p]++; me[p] += s.e; mn[p] += s.n; mu[p] += s.u; mv[p] += s.v; if (s.u < uMin[p]) uMin[p] = s.u; if (s.u > uMax[p]) uMax[p] = s.u; if (s.v < vMin[p]) vMin[p] = s.v; if (s.v > vMax[p]) vMax[p] = s.v; }
  const q = Array.from({ length: nP }, () => new Float64Array(7));
  for (const s of sights) { const p = s.p, du = s.u - mu[p] / cnt[p], dv = s.v - mv[p] / cnt[p], de = s.e - me[p] / cnt[p], dn = s.n - mn[p] / cnt[p], a = q[p]; a[0] += du * du; a[1] += du * dv; a[2] += dv * dv; a[3] += du * de; a[4] += dv * de; a[5] += du * dn; a[6] += dv * dn; }
  const base: PhotoShift[] = shifts.map((s0, p) => {
    if (s0.tilt) return { ...s0, e: [...s0.e], n: [...s0.n], tilt: { g: s0.tilt.g, t: [...s0.tilt.t] } };
    const a = q[p], det = a[0] * a[2] - a[1] * a[1];
    const g: [number, number, number, number] | null = cnt[p] >= 3 && Math.abs(det) > 1e-9 ? [(a[3] * a[2] - a[4] * a[1]) / det, (a[4] * a[0] - a[3] * a[1]) / det, (a[5] * a[2] - a[6] * a[1]) / det, (a[6] * a[0] - a[5] * a[1]) / det] : null;
    return { ...s0, e: [...s0.e], n: [...s0.n], ...(g ? { tilt: { g, t: [0, 0] as [number, number] } } : {}) };
  });
  // A photograph's eight numbers at a pixel: [unknown, its part east, its part north]. Pixels in thousands and ground
  // metres in tens, so the unknowns are of one size (as the registration's own fit).
  const terms = (p: number, u: number, v: number, out: Float64Array): number => {
    const s = base[p], du = u - s.u0, dv = v - s.v0, U = du / 1000, V = dv / 1000;
    out[0] = 1; out[1] = 0; out[2] = U; out[3] = 0; out[4] = V; out[5] = 0; out[6] = 0; out[7] = 1; out[8] = 0; out[9] = U; out[10] = 0; out[11] = V;
    if (!s.tilt) return 6;
    const g = s.tilt.g, ge = (g[0] * du + g[1] * dv) / 10, gn = (g[2] * du + g[3] * dv) / 10;
    out[12] = ge * ge; out[13] = ge * gn; out[14] = gn * ge; out[15] = gn * gn;
    return 8;
  };
  const X = new Float64Array(N);
  const withX = (): PhotoShift[] => base.map((s, p) => { const b = p * 8; return { ...s, e: [s.e[0] + X[b], s.e[1] + X[b + 1] / 1000, s.e[2] + X[b + 2] / 1000], n: [s.n[0] + X[b + 3], s.n[1] + X[b + 4] / 1000, s.n[2] + X[b + 5] / 1000], ...(s.tilt ? { tilt: { g: s.tilt.g, t: [s.tilt.t[0] + X[b + 6] / 100, s.tilt.t[1] + X[b + 7] / 100] as [number, number] } } : {}) }; });
  const at = (x: Float64Array, p: number, u: number, v: number, T: Float64Array): [number, number] => { const n = terms(p, u, v, T), b = p * 8; let e = 0, nn = 0; for (let k = 0; k < n; k++) { e += x[b + k] * T[2 * k]; nn += x[b + k] * T[2 * k + 1]; } return [e, nn]; };

  const before = placed(sights, shifts), holdW = o.holdM > 0 ? (0.01 / o.holdM) ** 2 : 0;
  const Ti = new Float64Array(16), Tj = new Float64Array(16), idx = new Int32Array(16), ce = new Float64Array(16), cn = new Float64Array(16);
  let first: Square[] | null = null, cur = before;
  const sizeOf = (sq: Square[]) => { const d = sq.map(s => Math.hypot(s.c[0].x, s.c[0].y)).sort((a, b) => a - b); return { median: d.length ? d[d.length >> 1] : NaN, over: d.filter(x => x > gateM).length }; };
  for (let round = 0; round < o.rounds; round++) {
    const sq = measure(sights, cur.xs, cur.ys, nP, o);
    if (!first) first = sq;
    if (!sq.length) break;
    // This round's change D on top of X; the hold is on X + D, so the corrections stay small over all rounds together.
    let D = new Float64Array(N);
    for (let it = 0; it < o.fits; it++) {
      const M = new Float64Array(N * N), b = new Float64Array(N);
      const add = (n: number, w: number, de: number, dn: number) => { for (let a = 0; a < n; a++) { const ka = idx[a]; b[ka] += w * (ce[a] * de + cn[a] * dn); const ra = ka * N; for (let c = 0; c < n; c++) M[ra + idx[c]] += w * (ce[a] * ce[c] + cn[a] * cn[c]); } };
      for (const s of sq) {
        const ni = terms(s.i, s.ui, s.vi, Ti), nj = terms(s.j, s.uj, s.vj, Tj);
        // What the change so far says this square's disagreement should be.
        let pe = 0, pn = 0;
        for (let k = 0; k < ni; k++) { pe += D[s.i * 8 + k] * Ti[2 * k]; pn += D[s.i * 8 + k] * Ti[2 * k + 1]; }
        for (let k = 0; k < nj; k++) { pe -= D[s.j * 8 + k] * Tj[2 * k]; pn -= D[s.j * 8 + k] * Tj[2 * k + 1]; }
        let d = s.c[0], res = Math.hypot(d.x - pe, d.y - pn);
        if (it > 0) for (const c of s.c) { const r = Math.hypot(c.x - pe, c.y - pn); if (r < res) { res = r; d = c; } }
        const w = it === 0 || res <= o.misfitM ? 1 : o.misfitM / res;
        let n = 0;
        for (let k = 0; k < ni; k++) { idx[n] = s.i * 8 + k; ce[n] = Ti[2 * k]; cn[n] = Ti[2 * k + 1]; n++; }
        for (let k = 0; k < nj; k++) { idx[n] = s.j * 8 + k; ce[n] = -Tj[2 * k]; cn[n] = -Tj[2 * k + 1]; n++; }
        add(n, w, d.x, d.y);
      }
      if (holdW > 0) for (let p = 0; p < nP; p++) {
        if (!cnt[p]) continue;
        for (const fu of [0.1, 0.5, 0.9]) for (const fv of [0.1, 0.5, 0.9]) {
          const u = uMin[p] + fu * (uMax[p] - uMin[p]), v = vMin[p] + fv * (vMax[p] - vMin[p]), n = terms(p, u, v, Ti), [he, hn] = at(X, p, u, v, Tj);
          for (let k = 0; k < n; k++) { idx[k] = p * 8 + k; ce[k] = Ti[2 * k]; cn[k] = Ti[2 * k + 1]; }
          add(n, holdW, -he, -hn);
        }
      }
      let tr = 0; for (let k = 0; k < N; k++) tr += M[k * N + k];
      const ridge = (1e-9 * tr) / N + 1e-12; for (let k = 0; k < N; k++) M[k * N + k] += ridge;
      const sol = solveSym(M, b, N); if (!sol) break; D = sol;
    }
    for (let k = 0; k < N; k++) X[k] += D[k];
    cur = placed(sights, withX());
  }
  const out = withX(), after = cur, last = measure(sights, after.xs, after.ys, nP, o);
  const m0 = matchedMarks(sights, before.xs, before.ys, o.checkM), m1 = matchedMarks(sights, after.xs, after.ys, o.checkM);
  const moved = Array.from(after.xs, (x, i) => Math.hypot(x - before.xs[i], after.ys[i] - before.ys[i])).sort((a, b) => a - b);
  const s0 = sizeOf(first ?? []), s1 = sizeOf(last);
  // The check: the share of marks another photograph agrees with must rise, and the pairs' plants must lie on each
  // other, not a plant along the row.
  const gain = sights.length ? (m1 - m0) / sights.length : 0, PO = pairsOf(last, nP, o);
  const why = !first?.length ? "no square of ground was marked by two photographs"
    : gain < o.minGain ? `the marks another photograph agrees with within ${Math.round(o.checkM * 100)} cm did not rise by ${Math.round(o.minGain * 100)} in 100 (${m0} to ${m1} of ${sights.length})`
    : PO.pairs > 0 && PO.on < o.pairsOn * PO.pairs ? `only ${PO.on} of ${PO.pairs} pairs of photographs have their plants on each other; the rest match best a step along the row` : null;
  return { shifts: why ? shifts : out, report: { applied: !why, why, squares: [first?.length ?? 0, last.length], overGate: [s0.over, s1.over], medianM: [s0.median, s1.median], marks: sights.length, matched: [m0, m1], movedMedianM: moved.length ? moved[moved.length >> 1] : 0, movedMostM: moved.length ? moved[moved.length - 1] : 0, pairs: PO.pairs, pairsOn: PO.on, ms: Date.now() - t0 } };
}
