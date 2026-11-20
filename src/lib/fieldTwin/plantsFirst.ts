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
/** `k` (read only, 2026-11-18): the plant's index in its read's `plants` (the field profile reads its look by it). */
export type Sight = { p: number; u: number; v: number; e: number; n: number; k?: number };

/** Each photograph's plants on the ground, metres east and north of `origin`, through its own camera. */
export function projectSightings(reads: Read[], frames: Map<string, GeorefFrame>, origin: LatLngAlt): { sights: Sight[]; photos: string[] } {
  const photos: string[] = [], sights: Sight[] = [];
  for (const r of reads) {
    const f = frames.get(r.name);
    if (!f) continue;
    const p = photos.length; photos.push(r.name);
    for (let k = 0; k < r.plants.length; k++) {
      const [x, y] = r.plants[k], u = x * r.scale, v = y * r.scale, g = pixelToGround(f, u, v);
      if (!g) continue;
      const [e, n] = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, origin);
      sights.push({ p, u, v, e, n, k });
    }
  }
  return { sights, photos };
}

/** A photograph's correction, metres: east a + b (u - u0) + c (v - v0), north the same with its own a, b, c.
 * `tilt` (PLANTS_FIRST.tilt): on top of that, what a camera tilted by a small angle does on flat ground and no plane
 * holds. With G the mark's place on the ground from the photograph's middle (`g`: metres east and north per pixel
 * along u and along v), the mark moves by (t . G) G, t being the two tilt angles over the flying height. */
export type PhotoShift = { e: [number, number, number]; n: [number, number, number]; u0: number; v0: number; cells: number; tilt?: { g: [number, number, number, number]; t: [number, number] } };
export const shiftOf = (s: PhotoShift, u: number, v: number): [number, number] => {
  const du = u - s.u0, dv = v - s.v0;
  let e = s.e[0] + s.e[1] * du + s.e[2] * dv, n = s.n[0] + s.n[1] * du + s.n[2] * dv;
  if (s.tilt) { const ge = s.tilt.g[0] * du + s.tilt.g[1] * dv, gn = s.tilt.g[2] * du + s.tilt.g[3] * dv, k = s.tilt.t[0] * ge + s.tilt.t[1] * gn; e += k * ge; n += k * gn; }
  return [e, n];
};

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
  /** A photograph's cells (across x down) for the fit. */
  gridU: 6, gridV: 4,
  /** The fit holds the two tilt terms beside the plane (see PhotoShift), for a photograph with at least
   * `tiltMinCells` cells that gave a peak (2026-11-16). Measured on what the plane alone left over, on a 6 x 4 grid:
   * the worst cell of the median photograph was 17 cm off the other photographs on one flight and 22 cm on another,
   * and the two terms, fitted afterwards, halved the cells left over by more than the merge gate (588 to 305, 1,209
   * to 737). One plant was becoming two dots at the frames' edges. */
  tilt: true, tiltMinCells: 16,
  /** A photograph keeps the tilt fit only where it leaves that photograph's own cells closer together than the plane
   * fit does (2026-11-16). The exact rule: the photographs are registered twice, once by a plane each on the grid
   * `planeGridU` x `planeGridV` (the registration as it was) and once with the tilt terms on `gridU` x `gridV`. After
   * each, every photograph's frame is read in the `gridU` x `gridV` cells as a round of the registration reads it: in
   * each cell, the sharpest repeat of its marks in all the other photographs' marks. A photograph's left-over is the
   * root mean square length of those repeats over the cells that give one under both registrations. It keeps the tilt
   * fit when its left-over with it is smaller than with the plane; otherwise it keeps its plane fit.
   * First, though, the flight is asked whether that comparison says anything: where the tilt fit is fitting noise, a
   * photograph's left-over is smaller with it as often as larger. The photographs it leaves smaller must outnumber
   * those it leaves larger by more than chance (a sign test: the chance of that many or more out of the two counts at
   * one half, under rowGuided.ts's alpha); if not, no photograph keeps the tilt fit and the flight is registered
   * exactly as before. Measured: on three flights whose marks stand several to a plant the left-over with the tilt
   * fit was smaller on 20, 21 and 19 of 40 photographs (ratio to the plane's: median 0.99, 0.94, 1.00) and frame
   * cells over 6 cm got worse; on the flight of single seedlings it was smaller on 110 of 123 (median ratio 0.51). */
  tiltMustHelp: true, planeGridU: 4, planeGridV: 3,
  /** The plant spacing is "not measured" when its score has no single peak (rowGuided.ts seedSpacing `needsAPeak`). */
  seedNeedsAPeak: true,
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
/** The rules as they stood before 2026-11-16's registration and plant-spacing changes: a plane a photograph on a 4 x 3
 * grid, and the plant spacing taken whatever its score. Kept so that result can be run beside the present one. */
export const PLANTS_FIRST_V1: PlantsFirstOptions = { ...PLANTS_FIRST, gridU: 4, gridV: 3, tilt: false, tiltMustHelp: false, seedNeedsAPeak: false };

/**
 * The photographs' corrections against each other (see the header). Returns one PhotoShift a photograph, and the
 * spread with which the same plant repeats between photographs once corrected (metres, the median distance of a
 * sighting from its nearest other photograph's sighting at the peak).
 */
export function registerPhotos(sights: Sight[], nPhotos: number, o: PlantsFirstOptions = PLANTS_FIRST): { shifts: PhotoShift[]; repeatM: number; /** Photographs that kept the tilt fit (`tiltMustHelp`). */ tilted?: number; /** Per photograph: its left-over (metres, RMS over the cells both registrations gave a repeat in) with the plane and with the tilt terms. */ leftOver?: { plane: number; tilt: number; cells: number }[] } {
  if (!o.tilt || !o.tiltMustHelp) return registerOnce(sights, nPhotos, o);
  // Both ways, then each photograph keeps the fit that leaves its own cells closer together (see PLANTS_FIRST.tiltMustHelp).
  const plane = registerOnce(sights, nPhotos, { ...o, tilt: false, gridU: o.planeGridU, gridV: o.planeGridV }), tilt = registerOnce(sights, nPhotos, o);
  const afterPlane = new Map<number, { x: number; y: number }>(), afterTilt = new Map<number, { x: number; y: number }>();
  registerOnce(sights, nPhotos, o, plane.shifts, afterPlane); registerOnce(sights, nPhotos, o, tilt.shifts, afterTilt);
  const nc = o.gridU * o.gridV, a = new Float64Array(nPhotos), b = new Float64Array(nPhotos), cells = new Int32Array(nPhotos);
  for (const [k, pa] of afterPlane) { const pb = afterTilt.get(k); if (!pb) continue; const p = Math.floor(k / nc); a[p] += pa.x * pa.x + pa.y * pa.y; b[p] += pb.x * pb.x + pb.y * pb.y; cells[p]++; }
  const keep = (p: number) => cells[p] > 0 && b[p] < a[p];
  let tilted = 0, larger = 0; for (let p = 0; p < nPhotos; p++) { if (keep(p)) tilted++; else if (cells[p] > 0 && b[p] > a[p]) larger++; }
  // Smaller on that many photographs or more, of those where the two differ, by chance alone (each as likely either way).
  const byChance = (() => { const m = tilted + larger; let logC = 0, tail = 0; for (let i = 0; i <= m; i++) { if (i >= tilted) tail += Math.exp(logC - m * Math.LN2); logC += Math.log((m - i) / (i + 1)); } return tail; })();
  const chance = byChance >= ROW_GUIDED.alpha;
  const leftOver = Array.from({ length: nPhotos }, (_, p) => ({ plane: cells[p] ? Math.sqrt(a[p] / cells[p]) : NaN, tilt: cells[p] ? Math.sqrt(b[p] / cells[p]) : NaN, cells: cells[p] }));
  if (!tilted || chance) return { ...plane, tilted: 0, leftOver };
  if (tilted === nPhotos) return { ...tilt, tilted, leftOver };
  const shifts = plane.shifts.map((s0, p) => (keep(p) ? tilt.shifts[p] : s0));
  return { shifts, repeatM: registerOnce(sights, nPhotos, o, shifts, new Map()).repeatM, tilted, leftOver };
}

/** One registration by the rules given. `start`: begin from these corrections; `read`: do not fit, only read every
 * photograph's cells once with the corrections as they stand (key: photograph x cells + cell) and say how the same
 * plant repeats. */
function registerOnce(sights: Sight[], nPhotos: number, o: PlantsFirstOptions, start: PhotoShift[] | null = null, read: Map<number, { x: number; y: number }> | null = null): { shifts: PhotoShift[]; repeatM: number } {
  const R = o.reachM, nb = Math.round((2 * R) / 0.01) + 1, NB = nb * nb, half = Math.max(2, Math.round(o.backgroundM / 0.01));
  const shifts: PhotoShift[] = start ? start.map(s0 => ({ ...s0 })) : Array.from({ length: nPhotos }, () => ({ e: [0, 0, 0], n: [0, 0, 0], u0: 0, v0: 0, cells: 0 }));
  // Each photograph's frame extent and centre, from its own sightings; each sighting's cell.
  const uMin = new Float64Array(nPhotos).fill(Infinity), uMax = new Float64Array(nPhotos).fill(-Infinity), vMin = new Float64Array(nPhotos).fill(Infinity), vMax = new Float64Array(nPhotos).fill(-Infinity), cnt = new Float64Array(nPhotos);
  for (const s of sights) { uMin[s.p] = Math.min(uMin[s.p], s.u); uMax[s.p] = Math.max(uMax[s.p], s.u); vMin[s.p] = Math.min(vMin[s.p], s.v); vMax[s.p] = Math.max(vMax[s.p], s.v); if (!start) { shifts[s.p].u0 += s.u; shifts[s.p].v0 += s.v; } cnt[s.p]++; }
  if (!start) for (let p = 0; p < nPhotos; p++) if (cnt[p]) { shifts[p].u0 /= cnt[p]; shifts[p].v0 /= cnt[p]; }
  // For the tilt terms: each photograph's own slopes from pixels to ground (east and north per pixel along u and v),
  // by least squares over its sightings.
  if (o.tilt && !start) {
    const me = new Float64Array(nPhotos), mn = new Float64Array(nPhotos), q = Array.from({ length: nPhotos }, () => new Float64Array(7));
    for (const s of sights) { me[s.p] += s.e; mn[s.p] += s.n; }
    for (const s of sights) { const du = s.u - shifts[s.p].u0, dv = s.v - shifts[s.p].v0, de = s.e - me[s.p] / cnt[s.p], dn = s.n - mn[s.p] / cnt[s.p], a = q[s.p]; a[0] += du * du; a[1] += du * dv; a[2] += dv * dv; a[3] += du * de; a[4] += dv * de; a[5] += du * dn; a[6] += dv * dn; }
    for (let p = 0; p < nPhotos; p++) { const a = q[p], det = a[0] * a[2] - a[1] * a[1]; if (cnt[p] >= 3 && Math.abs(det) > 1e-9) shifts[p].tilt = { g: [(a[3] * a[2] - a[4] * a[1]) / det, (a[4] * a[0] - a[3] * a[1]) / det, (a[5] * a[2] - a[6] * a[1]) / det, (a[6] * a[0] - a[5] * a[1]) / det], t: [0, 0] }; }
  }
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
    // Only reading: every cell's repeat with the corrections as they stand, and nothing fitted.
    if (read) { for (const [k, h] of hist) { const pk = peakOf(h); if (pk) read.set(k, { x: pk.x, y: pk.y }); } return { shifts, repeatM }; }
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
      // The plane and the two tilt terms together, east and north in one fit (o.tilt), where the photograph has cells
      // enough: eight unknowns, the cells further than 4 cm from the fit dropped and it fitted again, as the plane below.
      // Pixels are taken in thousands and ground metres in tens so the unknowns are of one size.
      if (s0.tilt && meas.length >= o.tiltMinCells) {
        const g = s0.tilt.g, at = (m: (typeof meas)[number]) => { const ge = (g[0] * m.u + g[1] * m.v) / 10, gn = (g[2] * m.u + g[3] * m.v) / 10; return { U: m.u / 1000, V: m.v / 1000, ge, gn }; };
        const model = (s: number[], m: (typeof meas)[number]): [number, number] => { const { U, V, ge, gn } = at(m), k = s[6] * ge + s[7] * gn; return [s[1] * U + s[2] * V + k * ge, s[4] * U + s[5] * V + k * gn]; };
        let used = meas, sol: number[] | null = null;
        for (let it = 0; it < 3; it++) {
          const rows: number[][] = [], vals: number[] = [], ws: number[] = [];
          for (const m of used) { const { U, V, ge, gn } = at(m); rows.push([1, U, V, 0, 0, 0, ge * ge, ge * gn], [0, 0, 0, 1, U, V, ge * gn, gn * gn]); vals.push(m.x, m.y); ws.push(m.w, m.w); }
          const s = solveLeastSquares(rows, vals, ws); if (!s) break; sol = s;
          const keep = used.filter(m => { const [dx, dy] = model(s, m); return Math.abs(m.x - s[0] - dx) <= 0.04 && Math.abs(m.y - s[3] - dy) <= 0.04; });
          if (keep.length === used.length || keep.length < o.tiltMinCells) break;
          used = keep;
        }
        // Not believed if it would move any measured cell more than the reach from the middle (as the plane below).
        if (sol && Math.max(...meas.map(m => Math.max(...model(sol!, m).map(Math.abs)))) <= R) {
          const h = 0.5;
          return { e: [s0.e[0] + h * sol[0], s0.e[1] + (h * sol[1]) / 1000, s0.e[2] + (h * sol[2]) / 1000], n: [s0.n[0] + h * sol[3], s0.n[1] + (h * sol[4]) / 1000, s0.n[2] + (h * sol[5]) / 1000], u0: s0.u0, v0: s0.v0, cells: meas.length, tilt: { g, t: [s0.tilt.t[0] + (h * sol[6]) / 100, s0.tilt.t[1] + (h * sol[7]) / 100] } };
        }
      }
      const fe = fit("x"), fn = fit("y");
      return { e: [s0.e[0] + 0.5 * fe[0], s0.e[1] + 0.5 * fe[1], s0.e[2] + 0.5 * fe[2]], n: [s0.n[0] + 0.5 * fn[0], s0.n[1] + 0.5 * fn[1], s0.n[2] + 0.5 * fn[2]], u0: s0.u0, v0: s0.v0, cells: meas.length, ...(s0.tilt ? { tilt: s0.tilt } : {}) };
    });
    for (let p = 0; p < nPhotos; p++) shifts[p] = next[p];
    const me = shifts.reduce((t, s) => t + s.e[0], 0) / Math.max(1, nPhotos), mn = shifts.reduce((t, s) => t + s.n[0], 0) / Math.max(1, nPhotos);
    for (const s of shifts) { s.e[0] -= me; s.n[0] -= mn; }
  }
  return { shifts, repeatM };
}

/** Weighted least squares: the unknowns minimising the sum of w (row . unknowns - value)^2; null when they are not determined. */
function solveLeastSquares(rows: number[][], vals: number[], ws: number[]): number[] | null {
  const m = rows[0].length, M = Array.from({ length: m }, () => new Array<number>(m + 1).fill(0));
  rows.forEach((r, k) => { for (let i = 0; i < m; i++) { M[i][m] += ws[k] * r[i] * vals[k]; for (let j = 0; j < m; j++) M[i][j] += ws[k] * r[i] * r[j]; } });
  for (let c = 0; c < m; c++) {
    let pv = c; for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[pv][c])) pv = r;
    if (!Number.isFinite(M[pv][c]) || Math.abs(M[pv][c]) < 1e-12) return null;
    [M[c], M[pv]] = [M[pv], M[c]];
    for (let r = 0; r < m; r++) { if (r === c) continue; const k = M[r][c] / M[c][c]; for (let j = c; j <= m; j++) M[r][j] -= k * M[c][j]; }
  }
  return M.map((r, i) => r[m] / r[i]);
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
export function rowCandidates(low: Read[], frames: Map<string, GeorefFrame>, origin: LatLngAlt, photos: string[], shifts: PhotoShift[], sights: Sight[], dots: Dot[], directionDeg: number, o: RowRecallOptions = ROW_RECALL): { dots: Dot[]; tier: Uint8Array;
  /** Read only, for the corn inspector: every sighting the candidates were gathered from (a lone stricter mark: its
   * index in `sights`; a lower-bar mark: -1), and per candidate dot the sightings it gathered (indices into `from`). */
  from: { p: number; u: number; v: number; sight: number }[]; members: number[][] } {
  const pOf = new Map(photos.map((n, i) => [n, i]));
  const ce: number[] = [], cn: number[] = [], cp: number[] = [], sharp: number[] = [], from: { p: number; u: number; v: number; sight: number }[] = [];
  const offNadir = (f: GeorefFrame, u: number, v: number) => (Math.atan(Math.hypot((u - f.intrinsics.cx) / f.intrinsics.fx, (v - f.intrinsics.cy) / f.intrinsics.fy)) * 180) / Math.PI;
  // The stricter marks only one photograph made.
  const inDot = new Uint8Array(sights.length); for (const d of dots) for (const m of d.members) inDot[m] = 1;
  const loneX: number[] = [], loneY: number[] = [], loneP: number[] = [];
  sights.forEach((s, i) => {
    if (inDot[i]) return;
    const f = frames.get(photos[s.p]); if (!f) return;
    const [de, dn] = shiftOf(shifts[s.p], s.u, s.v);
    loneX.push(s.e + de); loneY.push(s.n + dn); loneP.push(s.p);
    ce.push(s.e + de); cn.push(s.n + dn); cp.push(s.p); sharp.push(offNadir(f, s.u, s.v) <= o.sharpDeg ? 1 : 0); from.push({ p: s.p, u: s.u, v: s.v, sight: i });
  });
  const loneGrid = new Grid(loneX, loneY, 0.1);
  for (const r of low) {
    const p = pOf.get(r.name), f = frames.get(r.name); if (p == null || !f) continue;
    for (const [x, y] of r.plants) {
      const u = x * r.scale, v = y * r.scale, g = pixelToGround(f, u, v); if (!g) continue;
      const [e0, n0] = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, origin), [de, dn] = shiftOf(shifts[p], u, v), e = e0 + de, n = n0 + dn;
      let same = false; loneGrid.near(e, n, o.sameMarkM, k => { if (loneP[k] === p && Math.hypot(loneX[k] - e, loneY[k] - n) <= o.sameMarkM) same = true; });
      if (same) continue;
      ce.push(e); cn.push(n); cp.push(p); sharp.push(offNadir(f, u, v) <= o.sharpDeg ? 1 : 0); from.push({ p, u, v, sight: -1 });
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
  const out: Dot[] = [], tier: number[] = [], members: number[][] = [];
  for (const g of groups) {
    const m = g.members.map(j => keep[j]);
    if (m.length === 1 && !sharp[m[0]] && !o.anyView) continue;
    const e = m.reduce((t, i) => t + ce[i], 0) / m.length, n = m.reduce((t, i) => t + cn[i], 0) / m.length;
    out.push({ e, n, members: [], photos: m.length, spreadM: Math.sqrt(m.reduce((t, i) => t + (ce[i] - e) ** 2 + (cn[i] - n) ** 2, 0) / m.length) });
    tier.push(m.length >= 2 ? 1 : sharp[m[0]] ? 2 : 3); members.push(m);
  }
  return { dots: out, tier: Uint8Array.from(tier), from, members };
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
  const seed = seedSpacing(marks, S, undefined, o.seedNeedsAPeak);
  const seedM = seed.spacingM;
  // Without a measured spacing (o.seedNeedsAPeak and no peak) a gap cannot be called long: the row runs from its first
  // dot to its last. (Before, and still where the spacing is taken whatever its score, 0.18 m stood in for it.)
  const maxGap = seedM == null && o.seedNeedsAPeak ? Infinity : 4 * (seedM ?? 0.18);
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
  /** A rule that needs the plant spacing does not run where the spacing is not measured (2026-11-16; before, 0.18 m
   * stood in for it). On such a flight: no dot becomes a probable plant and no candidate is placed (both are asked to
   * stand a whole number of spacings from a plant: why 7), the loosened placement does not run (its clearance and its
   * reach are counted in spacings), a row reaches no further than its own plants, and no stretch is called "not
   * confirmed" (how long a run of missed plants is still ordinary is counted in spacings): a row is cut only where no
   * plant stands for `maxBridgeM` or where its course crosses ground judged scattered. The certain plants, the rows
   * they make and the rows found in a free slot do not use the spacing and read as before. */
  spacingRulesNeedASpacing: true,
  /** The final sweep (2026-11-16): a mark of the second look that stands alone on its row is taken off it. After every
   * dot is placed and before the rows are built, each candidate on a row (every tier) is asked for company along that
   * row: a plant found without help from a row, within the reach a row already takes dots in (`maxGapSeeds` plant
   * spacings), on either side of it. With none it is off the row: why 8, "alone on its row". Who is company
   * (`loneMarkCompany`):
   *   "located"  the row's certain plants and its probable ones: every dot the stricter marks made, which no row
   *              helped to find (a probable plant's place on the row is the spacing rule's, its finding is not);
   *   "certain"  the row's certain plants only: the plants the row itself was made from (the design note's `own`).
   *              Measured 2026-11-16 on the one flight with marks to sweep: 310 marks go instead of 137, most of the
   *              difference at row ends beside a wheel track, next to probable plants.
   * Another candidate is never company. A certain or a probable plant is never removed, and a dot on no row is not
   * touched. One pass is the whole of it: what is removed was nobody's company. (A planter drops seed in a line at a
   * steady spacing, so one faint mark alone in a bare strip is not read as its plant.) */
  sweepLoneMarks: true, loneMarkCompany: "located" as "certain" | "located",
  /** Off by default (2026-11-17): the plant spacing is not asked of a dot on a row's line. A dot that every other test
   * lets through and that is refused only because it does not stand a whole number of plant spacings from the nearest
   * plant on its row (off by more than `probableTol` of a spacing) goes on the row all the same. Every other test
   * stays: ground judged scattered, the row's line and its reach, the band against the alley for a candidate, the
   * double rule (closer than half a spacing to a plant on the row) and the reach of `maxGapSeeds` spacings from one.
   * A candidate of the second look follows the same change. A row's course is not fitted through these dots: they are
   * told apart (`Reconstruction.offSpacing`) and left out where a row's drawn course is fitted through its plants.
   * (Beside it: SEQUENCE.free takes such a dot too, but only within `freeAcrossShare` of the line and no closer than
   * `freeMinSeeds` to a plant; this option keeps the row's own band and the double rule's half a spacing.) */
  placeOffSpacing: false,
  /** Off by default (2026-11-18), a narrower `placeOffSpacing`: only a dot of the stricter marks goes on its row
   * without the spacing asked of it. A candidate of the second look keeps the spacing rule as it stood. */
  offSpacingStricterOnly: false,
  /** Off by default (2026-11-18): how close to a plant on its row a dot may stand is learned from the field, in place of
   * half a plant spacing. The limit is the distance under which the lowest `tooCloseQuantile` of the gaps between
   * neighbouring certain plants on the flight's row lines fall (`Reconstruction.tooCloseM`): closer than the field's own
   * certain plants stand to each other, a dot is a second mark on a plant. With no such gap the half spacing stands. */
  tooCloseFromField: false, tooCloseQuantile: 0.05,
  /** Off by default (2026-11-19, on in the app's preset): the stricter marks' dots refused as "too far" (no plant on their row within
   * `maxGapSeeds` plant spacings when they were tried) are tried again once every other dot is placed, strongest first,
   * until nothing more joins, by the same tests. Each dot is tried once, strongest first, so a dot tried before the
   * plants around it were placed was refused for a gap those plants then filled: on the private seedling flight 179
   * real seedlings on their row lines were drawn off the rows for that. */
  retryTooFar: false,
  /** Off by default (2026-11-19, on in the app's preset): what a build keeps tells the "doubles" (a dot on a row's line
   * refused only as closer than the too-close limit to a plant on that row; cornPlants.ts `shown` 7) from the other
   * dots on no row. His count: the plants on rows and the doubles (until a look at the photographs decides each double);
   * every other dot on no row is green that is not corn. */
  doublesApart: false,
  /** TEMPORARY PATCH (2026-11-20; 0 = off, the default; 0.05 in the app's preset). A second-look candidate placed on a
   * row is taken off it when it stands over this far ACROSS from the line through the stricter marks' plants beside it
   * on that row (the nearest before and the nearest after it along, each within 3 plant spacings; one alone where
   * only one is; with none the candidate stays). Why: where two flight lines disagree on a row's place by about 10 cm
   * a real plant marked only by the second look of one line lands on bare soil beside its row, inside the on-row band
   * (0.12 of the row spacing: 11 cm at 0.925 m), and is drawn and counted there (dot 57911 of the private seedling
   * flight, photographs 0077 to 0079). Measured on that flight: 247 of 2,783 second-look plants stand over 5 cm
   * across; on photo 0025's dev tiles the rule takes 4 marks, none on a labelled plant (found 1,023 unchanged, wrong
   * 78 -> 75); at 4 cm it takes labelled plants (4 of 10). It treats the symptom: the cause is the photographs'
   * registration, and this goes when that is mended. */
  secondLookAcrossMaxM: 0,
  /** His rule of 2026-11-20 (0 = off, the default; 2 in the app's preset): a plant counts as corn only when it is part
   * of a run: another plant of its row stands within this many plant spacings of it along the row, on at least one
   * side; a plant only one photograph made needs one on both sides. Asked again whenever a plant goes (a neighbour that
   * was itself left out is no neighbour), until nothing more goes. A plant left out is on no row: green that is not
   * corn, not counted (a second-look candidate is then not kept at all, as any candidate off a row). A row then
   * runs from its first plant in a run to its last. Needs the plant spacing: where it is not measured nothing is asked.
   * In place of trimming rows' ends (tried and taken out the same day). */
  runReachSeeds: 0,
};
/** The rules as they stood on 2026-11-16 at f23efc0, before the changes above them here: kept so that result can be run beside the present one. */
export const SEQUENCE_V1: typeof SEQUENCE = { ...SEQUENCE, patternCellsOnly: false, refuseScattered: false, alleyTest: "none", betweenOffLines: false, spacingRulesNeedASpacing: false, sweepLoneMarks: false };
/** The field's judgement of the ground as reconstruct takes it (cornField.ts FieldGround): at a place, metres east and
 * north, 0 unknown, 1 planted, 2 scattered; `dotState` where the caller judged the dots itself. */
/**
 * Read only, for the corn inspector (2026-11-18): which test settled each dot in `reconstruct`. No rule reads it.
 * Each value is written on the same line as the test it names, so a dot's rule can be found in this file by its name.
 * `cutFromRow`: placed on a row, then left on no row when the row was built (a piece of under three plants, a stretch
 * longer than `maxBridgeM` with no plant, or a stretch over ground judged scattered: `build` in reconstruct).
 */
export const SETTLED = { none: 0, certainRow: 1, scattered: 2, noRow: 3, noSpacing: 4, alley: 5, tooClose: 6, tooFar: 7, offSpacing: 8, placedAtSpacing: 9, placedOffSpacing: 10, freeAlley: 11, freeTooClose: 12, freePlaced: 13, alone: 14, geometryRow: 15, cutFromRow: 16, secondLook: 17, placedOnRetry: 18, offLine: 19, notInARun: 20 } as const;
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
  /** Per dot, why it is on no row: 0 on a row, 1 no row reaches it, 2 as close as a double to a plant on the row, 3 not at the plant spacing, 4 between two rows, 5 on ground the field's plants show as scattered, 6 a candidate (or a dot for the loosened placement) on a stretch of row whose band does not beat the ground between the rows, 7 the plant spacing is not measured on this flight, so the rule that would place it does not run, 8 a candidate that was on a row and alone on it (the final sweep, `sweepLoneMarks`), 9 a candidate that was on a row and too far across from the line of the plants beside it (the temporary patch, `secondLookAcrossMaxM`). */
  why: Uint8Array;
  /** The gap rule as measured, and what it did: gaps bridged as confirmed, stretches not confirmed, rows cut (over a
   * stretch with no plant, and where the course would cross ground judged scattered). */
  gaps: { filled: number; gapM: number; bridged: number; notConfirmedStretches: number; cutOverMaxBridge: number; cutLengthM: number; cutOverScattered: number };
  /** Unplanted ground: dots on ground judged scattered (all, and the certain ones among them), and cells with plants
   * and no row pattern that were left without rows. */
  unplanted: { dotsOnScattered: number; certainOnScattered: number; flatCells: number };
  /** The band-against-alley test (`alleyTest`): dots it kept off a row. */
  alleyRefused: number;
  /** Whether the rules that need the plant spacing ran: false where it is not measured and `spacingRulesNeedASpacing`. */
  spacingRules: boolean;
  /** The final sweep (`sweepLoneMarks`): the candidates it took off a row, and for each the course (index into `courses`) it stood on. */
  alone: { dot: number[]; course: number[] };
  geometry: { spacingM: number; directionDeg: number; seedM: number | null; rowLengthMedianM: number; perMMedian: number; certainDots: number; certainRows: number };
  /** Along / across of every dot in the rows' frame, metres. */
  a: Float64Array; c: Float64Array;
  /** Per dot: 1 when it is on a row only by the loosened placement (`free`), not at the plant spacing. */
  loose: Uint8Array;
  /** The courses of the rows the certain plants made (before anything was placed along them), and of the rows found in
   * a slot those leave. */
  courses: RowCourse[]; geomCourses: RowCourse[];
  /** Per dot: 1 when it is on its row only because the plant spacing was not asked of it (`placeOffSpacing`). */
  offSpacing: Uint8Array;
  /** The distance from a plant on its row under which a dot is as close as a double, metres: half a plant spacing, or
   * the limit learned from the field (`tooCloseFromField`); and the gaps between neighbouring certain plants it was read from. */
  tooCloseM: number; certainGaps: number;
  /** Read only (SETTLED): per dot, the test that settled it. */
  settled: Uint8Array;
  /** Read only (layers/chain.ts, 2026-11-18): what L5 learned beyond the above (layers/l5Profile.ts spacingSpread; the
   * ground judged from L4's certain plants, with LAYERS.groundFromObvious). */
  /** L7 (layers/l7SecondLook.ts, LAYERS.secondLook): per dot, 1 when the second look put it on its row or added it. */
  secondLook?: Uint8Array;
  profile?: { spread: { all: { q1: number | null; q2: number | null; q3: number | null; n: number }; single: { q1: number | null; q2: number | null; q3: number | null; n: number }; lowerFenceM: number | null; upperFenceM: number | null }; groundL4: unknown };
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

// reconstruct (steps 4 on: the rows through the certain dots, every other dot against them) is the layers L4 to L7
// chained: fieldTwin/layers/chain.ts (moved there 2026-11-18 so that this file imports no layer).
