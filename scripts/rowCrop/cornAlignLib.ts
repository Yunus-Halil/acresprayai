// Development only: the measuring behind cornAlignMeasure.ts (2026-11-25). Nothing in the app reads this.
import type { Sight } from "../../src/lib/fieldTwin/plantsFirst";

export type Cam = { e: number; n: number; h: number; W: number; H: number; cx: number; cy: number };
/** A repeat: where photograph j's marks sit from photograph i's, metres east and north, and how sharp it is. */
export type Cand = { x: number; y: number; w: number };
export type Meas = { i: number; j: number; /** Ground, metres. */ x: number; y: number; ui: number; vi: number; uj: number; vj: number; /** 0 the frame's middle, 1 its corner. */ ri: number; rj: number; c: Cand[]; ambiguous: boolean; votes: number };

export type Line = { photos: number[]; headingDeg: number; stepM: number; offsetM: (o: Line) => number; mid: [number, number] };

/** Flight lines from the cameras' places in the order flown: runs of even steps on one heading, four photographs or more. */
export function flightLines(cam: Cam[]): Line[] {
  const n = cam.length, step = (a: number, b: number) => [cam[b].e - cam[a].e, cam[b].n - cam[a].n] as [number, number];
  const lens = Array.from({ length: n - 1 }, (_, k) => Math.hypot(...step(k, k + 1))).sort((a, b) => a - b), med = lens[lens.length >> 1] ?? 0;
  const runs: number[][] = []; let cur: number[] = [0];
  for (let k = 1; k < n; k++) {
    const s = step(k - 1, k), L = Math.hypot(...s);
    let ok = L > 0.5 * med && L < 1.6 * med;
    if (ok && cur.length >= 2) { const p = step(cur[cur.length - 2], cur[cur.length - 1]), c = (p[0] * s[0] + p[1] * s[1]) / (Math.hypot(...p) * L); ok = c > Math.cos((15 * Math.PI) / 180); }
    if (ok) cur.push(k); else { runs.push(cur); cur = cur.length >= 2 && L > 0.5 * med && L < 1.6 * med ? [k - 1, k] : [k]; }
  }
  runs.push(cur);
  // A photograph may close one run and open the next (the corner of a turn): it stays with the longer.
  const owner = new Int32Array(n).fill(-1); runs.map((r, k) => k).sort((a, b) => runs[b].length - runs[a].length).forEach(k => { for (const p of runs[k]) if (owner[p] < 0) owner[p] = k; });
  return runs.map((r, k) => r.filter(p => owner[p] === k)).filter(r => r.length >= 4).map(r => {
    const a = cam[r[0]], b = cam[r[r.length - 1]], hx = b.e - a.e, hy = b.n - a.n, hl = Math.hypot(hx, hy), mid: [number, number] = [(a.e + b.e) / 2, (a.n + b.n) / 2];
    return { photos: r, headingDeg: (Math.atan2(hy, hx) * 180) / Math.PI, stepM: hl / (r.length - 1), mid, offsetM: (o: Line) => Math.abs((-(mid[0] - o.mid[0]) * hy + (mid[1] - o.mid[1]) * hx) / hl) };
  });
}

const R = 0.3, BIN = 0.01, NB = Math.round((2 * R) / BIN) + 1;

/** A histogram's sharpest repeats (3 x 3 bins less the broad background around them, as the registration reads a peak), up to `most`. */
export function peaksOf(h: Float32Array, most = 3, backgroundM = 0.12, apartBins = 4): Cand[] {
  const nb = NB, half = Math.round(backgroundM / BIN), S = new Float64Array((nb + 1) * (nb + 1));
  for (let y = 0; y < nb; y++) { let row = 0; for (let x = 0; x < nb; x++) { row += h[y * nb + x]; S[(y + 1) * (nb + 1) + x + 1] = S[y * (nb + 1) + x + 1] + row; } }
  const box = (x0: number, y0: number, x1: number, y1: number): [number, number] => { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(nb - 1, x1); y1 = Math.min(nb - 1, y1); return [S[(y1 + 1) * (nb + 1) + x1 + 1] - S[y0 * (nb + 1) + x1 + 1] - S[(y1 + 1) * (nb + 1) + x0] + S[y0 * (nb + 1) + x0], (x1 - x0 + 1) * (y1 - y0 + 1)]; };
  const ex = new Float32Array(nb * nb), sig = new Float32Array(nb * nb);
  for (let y = 1; y < nb - 1; y++) for (let x = 1; x < nb - 1; x++) { const [s3] = box(x - 1, y - 1, x + 1, y + 1), [sw, aw] = box(x - half, y - half, x + half, y + half), bg = (9 * (sw - s3)) / Math.max(1, aw - 9); ex[y * nb + x] = s3 - bg; sig[y * nb + x] = 3 * Math.sqrt(Math.max(1, bg)); }
  const out: Cand[] = [], taken: [number, number][] = [];
  for (let k = 0; k < most; k++) {
    let bx = -1, by = -1, best = 0;
    for (let y = 1; y < nb - 1; y++) for (let x = 1; x < nb - 1; x++) { const v = ex[y * nb + x]; if (v <= best || v < sig[y * nb + x] || v < 5) continue; if (taken.some(([tx, ty]) => Math.abs(tx - x) <= apartBins && Math.abs(ty - y) <= apartBins)) continue; best = v; bx = x; by = y; }
    if (bx < 0) break;
    let sx = 0, sy = 0, sw = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const w = h[(by + dy) * nb + bx + dx]; sx += w * (bx + dx); sy += w * (by + dy); sw += w; }
    out.push({ x: (sx / sw) * BIN - R, y: (sy / sw) * BIN - R, w: best }); taken.push([bx, by]);
  }
  return out;
}

class Grid {
  private cells = new Map<number, number[]>();
  constructor(private xs: ArrayLike<number>, private ys: ArrayLike<number>, private size: number) { for (let i = 0; i < xs.length; i++) { const k = this.key(Math.floor(xs[i] / size), Math.floor(ys[i] / size)); (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(i); } }
  private key(i: number, j: number) { return (i + 1_000_000) * 2_000_003 + (j + 1_000_000); }
  near(x: number, y: number, r: number, fn: (i: number) => void) { const i0 = Math.floor((x - r) / this.size), i1 = Math.floor((x + r) / this.size), j0 = Math.floor((y - r) / this.size), j1 = Math.floor((y + r) / this.size); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const c = this.cells.get(this.key(i, j)); if (c) for (const k of c) fn(k); } }
}

/**
 * Every pair of photographs, in every square of ground both marked: the repeats of one's marks in the other's.
 * `xs`, `ys`: the marks where the state being measured puts them.
 */
export function measurePairs(sights: Sight[], xs: Float64Array, ys: Float64Array, nP: number, cam: Cam[], o: { cellM: number; axis: [number, number]; seedM: number; minVotes?: number }): Meas[] {
  const grid = new Grid(xs, ys, R), votes = new Map<number, number[]>(), OFF = 512;
  for (let a = 0; a < sights.length; a++) {
    const pa = sights[a].p;
    grid.near(xs[a], ys[a], R, b => {
      if (b <= a) return; const pb = sights[b].p; if (pb === pa) return;
      if (Math.abs(xs[b] - xs[a]) > R || Math.abs(ys[b] - ys[a]) > R) return;
      const [i, j, si, sj] = pa < pb ? [pa, pb, a, b] : [pb, pa, b, a];
      const gx = Math.floor((xs[a] + xs[b]) / 2 / o.cellM) + OFF, gy = Math.floor((ys[a] + ys[b]) / 2 / o.cellM) + OFF;
      const key = ((i * nP + j) * 1024 + gx) * 1024 + gy;
      (votes.get(key) ?? votes.set(key, []).get(key)!).push(si, sj);
    });
  }
  const out: Meas[] = [], h = new Float32Array(NB * NB), minVotes = o.minVotes ?? 30;
  for (const [key, v] of votes) {
    if (v.length / 2 < minVotes) continue;
    h.fill(0);
    for (let k = 0; k < v.length; k += 2) { const bx = Math.round((xs[v[k + 1]] - xs[v[k]] + R) / BIN), by = Math.round((ys[v[k + 1]] - ys[v[k]] + R) / BIN); if (bx >= 0 && by >= 0 && bx < NB && by < NB) h[by * NB + bx]++; }
    const c = peaksOf(h); if (!c.length) continue;
    const ij = Math.floor(key / (1024 * 1024)), i = Math.floor(ij / nP), j = ij % nP;
    // Where the square's repeat was read: the marks that made the sharpest peak.
    let ui = 0, vi = 0, uj = 0, vj = 0, x = 0, y = 0, n = 0;
    for (let k = 0; k < v.length; k += 2) { const a = v[k], b = v[k + 1]; if (Math.abs(xs[b] - xs[a] - c[0].x) > 0.02 || Math.abs(ys[b] - ys[a] - c[0].y) > 0.02) continue; ui += sights[a].u; vi += sights[a].v; uj += sights[b].u; vj += sights[b].v; x += (xs[a] + xs[b]) / 2; y += (ys[a] + ys[b]) / 2; n++; }
    if (n < 5) continue;
    ui /= n; vi /= n; uj /= n; vj /= n; x /= n; y /= n;
    const rOf = (p: number, u: number, vv: number) => Math.hypot(u - cam[p].cx, vv - cam[p].cy) / Math.hypot(cam[p].W / 2, cam[p].H / 2);
    out.push({ i, j, x, y, ui, vi, uj, vj, ri: rOf(i, ui, vi), rj: rOf(j, uj, vj), c, ambiguous: c.length > 1 && c[1].w >= 0.6 * c[0].w, votes: n });
  }
  return out;
}

export function summarise(ms: Meas[], ds: { x: number; y: number }[], ax: [number, number], gateM: number) {
  const size = ds.map(d => Math.hypot(d.x, d.y)).sort((a, b) => a - b), al = ds.map(d => Math.abs(d.x * ax[0] + d.y * ax[1])).sort((a, b) => a - b), ac = ds.map(d => Math.abs(-d.x * ax[1] + d.y * ax[0])).sort((a, b) => a - b);
  const q = (v: number[], f: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(f * v.length))] : NaN);
  return { n: ms.length, median: q(size, 0.5), p90: q(size, 0.9), alongMedian: q(al, 0.5), acrossMedian: q(ac, 0.5), alongP90: q(al, 0.9), acrossP90: q(ac, 0.9), over: size.filter(s => s > gateM).length };
}

export const MODELS = {
  none: "nothing moved (the nearest of a square's repeats)",
  lineShift: "1. one shift for each flight line",
  photoShift: "2. one shift for each photograph",
  photoSimilarity: "a shift, a turn and a scale for each photograph",
  photoPlane: "a plane for each photograph (shift, turn, scale, shear)",
  photoPlaneTilt: "a plane and the two tilt terms for each photograph (what the registration is meant to fit)",
  lens: "3. one lens correction shared by every photograph (two numbers), nothing else",
  photoShiftLens: "2 + 3: a shift for each photograph and the shared lens correction",
  photoPlaneTiltLens: "plane, tilt terms and the shared lens correction",
  ground: "ground height in each square, nothing else",
  photoPlaneTiltGround: "plane, tilt terms and ground height in each square",
  photoPlaneTiltLensGround: "plane, tilt terms, lens and ground height",
} as const;
export type ModelName = keyof typeof MODELS;

type Term = [number, number, number];
export type Fit = { unknowns: number; /** What the correction adds to a mark of photograph p at pixel (u, v), ground (X, Y): metres east, north. */ shiftAt: (p: number, u: number, v: number, X?: number, Y?: number) => [number, number]; extra: Record<string, unknown> };

/** Cholesky solve of a symmetric positive system held densely (row-major, n x n); returns null when it is not positive. */
function solveSym(M: Float64Array, b: Float64Array, n: number): Float64Array | null {
  for (let c = 0; c < n; c++) {
    let d = M[c * n + c]; for (let k = 0; k < c; k++) d -= M[c * n + k] * M[c * n + k];
    if (!(d > 0)) return null; d = Math.sqrt(d); M[c * n + c] = d;
    for (let r = c + 1; r < n; r++) { let s = M[r * n + c]; const rr = r * n, cc = c * n; for (let k = 0; k < c; k++) s -= M[rr + k] * M[cc + k]; M[rr + c] = s / d; }
  }
  const y = new Float64Array(n); for (let r = 0; r < n; r++) { let s = b[r]; for (let k = 0; k < r; k++) s -= M[r * n + k] * y[k]; y[r] = s / M[r * n + r]; }
  const x = new Float64Array(n); for (let r = n - 1; r >= 0; r--) { let s = y[r]; for (let k = r + 1; k < n; k++) s -= M[k * n + r] * x[k]; x[r] = s / M[r * n + r]; }
  return x;
}

/** Each photograph's slopes from pixels to ground (metres east and north per pixel along u and v), from its marks. */
export function pixelSlopes(sights: Sight[], nP: number, cam: Cam[]): Float64Array[] {
  const cnt = new Float64Array(nP), me = new Float64Array(nP), mn = new Float64Array(nP), mu = new Float64Array(nP), mv = new Float64Array(nP);
  for (const s of sights) { cnt[s.p]++; me[s.p] += s.e; mn[s.p] += s.n; mu[s.p] += s.u; mv[s.p] += s.v; }
  for (let p = 0; p < nP; p++) if (cnt[p]) { me[p] /= cnt[p]; mn[p] /= cnt[p]; mu[p] /= cnt[p]; mv[p] /= cnt[p]; }
  // uu, uv, vv, u e, v e, u n, v n
  const q = Array.from({ length: nP }, () => new Float64Array(7));
  for (const s of sights) { const du = s.u - mu[s.p], dv = s.v - mv[s.p], de = s.e - me[s.p], dn = s.n - mn[s.p], a = q[s.p]; a[0] += du * du; a[1] += du * dv; a[2] += dv * dv; a[3] += du * de; a[4] += dv * de; a[5] += du * dn; a[6] += dv * dn; }
  return q.map((a, p) => { const det = a[0] * a[2] - a[1] * a[1]; if (cnt[p] < 3 || Math.abs(det) < 1e-9) { const g = cam[p].h / 3700; return Float64Array.from([g, 0, 0, -g]); } return Float64Array.from([(a[3] * a[2] - a[4] * a[1]) / det, (a[4] * a[0] - a[3] * a[1]) / det, (a[5] * a[2] - a[6] * a[1]) / det, (a[6] * a[0] - a[5] * a[1]) / det]); });
}

/**
 * One explanation fitted to every measurement at once: least squares over all pairs, misfits over 3 cm weighed down,
 * and each square's repeat chosen again among its candidates after every fit (four fits).
 */
export function fitModel(name: ModelName, meas: Meas[], nP: number, cam: Cam[], lineOf: Int32Array, nLines: number, sights: Sight[], cellM: number, holdM = 0.1): Fit {
  const holdW = holdM > 0 ? (0.01 / holdM) ** 2 : 0;
  const J = pixelSlopes(sights, nP, cam);
  const perPhoto = name.startsWith("photoPlaneTilt") ? 8 : name === "photoPlane" ? 6 : name === "photoSimilarity" ? 4 : name.startsWith("photoShift") ? 2 : 0;
  const perLine = name === "lineShift" ? 2 : 0, lens = /lens/i.test(name) ? 2 : 0, ground = /ground/i.test(name);
  const sq = new Map<number, number>(), sqOf = (X: number, Y: number, make: boolean) => { const k = (Math.floor(X / cellM) + 4096) * 8192 + Math.floor(Y / cellM) + 4096; let q = sq.get(k); if (q == null && make) { q = sq.size; sq.set(k, q); } return q ?? -1; };
  if (ground) for (const m of meas) sqOf(m.x, m.y, true);
  const oLine = nP * perPhoto, oLens = oLine + nLines * perLine, oGround = oLens + lens, N = oGround + (ground ? sq.size : 0);
  const terms = (p: number, u: number, v: number, X: number | undefined, Y: number | undefined): Term[] => {
    const t: Term[] = [], c = cam[p], du = u - c.cx, dv = v - c.cy, g = J[p], ge = (g[0] * du + g[1] * dv) / 10, gn = (g[2] * du + g[3] * dv) / 10, b = p * perPhoto;
    if (perPhoto >= 2) t.push([b, 1, 0], [b + 1, 0, 1]);
    if (perPhoto === 4) t.push([b + 2, ge, gn], [b + 3, -gn, ge]);
    if (perPhoto >= 6) t.push([b + 2, ge, 0], [b + 3, gn, 0], [b + 4, 0, ge], [b + 5, 0, gn]);
    if (perPhoto === 8) t.push([b + 6, ge * ge, ge * gn], [b + 7, gn * ge, gn * gn]);
    if (perLine && lineOf[p] >= 0) t.push([oLine + 2 * lineOf[p], 1, 0], [oLine + 2 * lineOf[p] + 1, 0, 1]);
    if (lens) { const r2 = (du * du + dv * dv) / ((c.W / 2) ** 2 + (c.H / 2) ** 2); t.push([oLens, r2 * ge, r2 * gn], [oLens + 1, r2 * r2 * ge, r2 * r2 * gn]); }
    if (ground && X != null && Y != null) { const q = sqOf(X, Y, false); if (q >= 0) t.push([oGround + q, (X - c.e) / c.h, (Y - c.n) / c.h]); }
    return t;
  };
  let sol = new Float64Array(N);
  const shiftAt = (p: number, u: number, v: number, X?: number, Y?: number): [number, number] => { let e = 0, n = 0; for (const [k, ce, cn] of terms(p, u, v, X, Y)) { e += sol[k] * ce; n += sol[k] * cn; } return [e, n]; };
  const predict = (m: Meas) => { const a = shiftAt(m.i, m.ui, m.vi, m.x, m.y), b = shiftAt(m.j, m.uj, m.vj, m.x, m.y); return { x: a[0] - b[0], y: a[1] - b[1] }; };
  const choose = (m: Meas, first: boolean) => { if (first) return m.c[0]; const p = predict(m); let best = m.c[0], bd = Infinity; for (const c of m.c) { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = c; } } return best; };
  if (N > 0) for (let it = 0; it < 4; it++) {
    const M = new Float64Array(N * N), b = new Float64Array(N);
    for (const m of meas) {
      const d = choose(m, it === 0), p = it === 0 ? { x: 0, y: 0 } : predict(m), res = Math.hypot(d.x - p.x, d.y - p.y), w = it === 0 ? 1 : res <= 0.03 ? 1 : 0.03 / res;
      const ti = terms(m.i, m.ui, m.vi, m.x, m.y), tj = terms(m.j, m.uj, m.vj, m.x, m.y), row: Term[] = [...ti, ...tj.map(([k, ce, cn]): Term => [k, -ce, -cn])];
      for (const [k1, e1, n1] of row) { b[k1] += w * (e1 * d.x + n1 * d.y); for (const [k2, e2, n2] of row) M[k1 * N + k2] += w * (e1 * e2 + n1 * n2); }
    }
    // The corrections are held small: at nine places in every frame, what a photograph is moved by counts against the
    // fit as a disagreement a tenth as heavy as a square's (`holdM` against 1 cm). Without it the fit can shrink the
    // whole field towards a point, which makes every disagreement smaller and means nothing.
    if (holdW > 0) for (let p = 0; p < nP; p++) for (const fu of [0.1, 0.5, 0.9]) for (const fv of [0.1, 0.5, 0.9]) {
      const row = terms(p, fu * cam[p].W, fv * cam[p].H, undefined, undefined);
      for (const [k1, e1, n1] of row) for (const [k2, e2, n2] of row) M[k1 * N + k2] += holdW * (e1 * e2 + n1 * n2);
    }
    if (ground) for (let q = 0; q < sq.size; q++) M[(oGround + q) * N + oGround + q] += 0.02;
    let tr = 0; for (let k = 0; k < N; k++) tr += M[k * N + k];
    const ridge = (1e-7 * tr) / N + 1e-12; for (let k = 0; k < N; k++) M[k * N + k] += ridge;
    const s = solveSym(M, b, N); if (!s) break; sol = s;
  }
  const extra: Record<string, unknown> = {};
  // The lens correction at the frame's corner and half way out, metres outward (the corner of photograph 0's frame).
  if (lens) { const c = cam[0], g = J[0], at = (f: number) => { const du = (f * c.W) / 2, dv = (f * c.H) / 2, G = Math.hypot(g[0] * du + g[1] * dv, g[2] * du + g[3] * dv) / 10, r2 = f * f; return (sol[oLens] * r2 + sol[oLens + 1] * r2 * r2) * G; }; extra.lensOutwardM = { corner: at(1), threeQuarters: at(0.75), half: at(0.5), quarter: at(0.25) }; }
  if (ground) { const dz = [...sq.values()].map(q => sol[oGround + q]).sort((a, b) => a - b); extra.groundSquares = dz.length; extra.groundHeightM = { least: dz[0], lowerQuartile: dz[dz.length >> 2], median: dz[dz.length >> 1], upperQuartile: dz[(3 * dz.length) >> 2], most: dz[dz.length - 1] }; }
  if (perLine) extra.lineShiftsM = Array.from({ length: nLines }, (_, k) => [sol[oLine + 2 * k], sol[oLine + 2 * k + 1]]);
  return { unknowns: N, shiftAt, extra };
}

/** What a fit leaves of every measurement: the candidate nearest to what the fit says, less that. */
export function residualsOf(meas: Meas[], fit: Fit): { x: number; y: number }[] {
  return meas.map(m => { const a = fit.shiftAt(m.i, m.ui, m.vi, m.x, m.y), b = fit.shiftAt(m.j, m.uj, m.vj, m.x, m.y), px = a[0] - b[0], py = a[1] - b[1]; let best = { x: Infinity, y: Infinity }, bd = Infinity; for (const c of m.c) { const d = Math.hypot(c.x - px, c.y - py); if (d < bd) { bd = d; best = { x: c.x - px, y: c.y - py }; } } return best; });
}

/** The built-in check: of one photograph's marks, with another photograph's mark within `withinM` (and how many had one within `reachM` at all). */
export function matchShare(sights: Sight[], xs: Float64Array, ys: Float64Array, withinM: number, reachM: number, keep?: (a: number) => boolean) {
  const grid = new Grid(xs, ys, reachM); let near = 0, close = 0, n = 0;
  for (let a = 0; a < sights.length; a++) {
    if (keep && !keep(a)) continue;
    let best = Infinity; grid.near(xs[a], ys[a], reachM, b => { if (sights[b].p === sights[a].p) return; const d = Math.hypot(xs[b] - xs[a], ys[b] - ys[a]); if (d < best) best = d; });
    n++; if (best <= reachM) near++; if (best <= withinM) close++;
  }
  return { marks: n, withAnother: near, within: close };
}
