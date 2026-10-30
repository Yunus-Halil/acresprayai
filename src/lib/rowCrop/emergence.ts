// Corn at emergence (VE to about V2): the "emergence" variant of the continuous-row reader.
//
// Just after planting the field is bare soil and the only green in it is the crop, one seedling every 15 cm or so on
// the planter's line. So the rows are not read from a green density (the early variant, which shrinks the photo to
// 1.5 cm pixels where a 1 cm leaf vanishes, and lets a grass verge decide the direction): each seedling is a point,
// and a row is the line the points stand on.
//
// Steps: work raster at about 1 cm -> soil-relative green -> solid green (a verge, a lawn, a hedge: over
// EMERGENCE.solidGreenShare of a cell) left out -> every small green component a point -> the direction where the
// points' projection is most concentrated -> the pitch from that projection's autocorrelation -> the rows' phase from
// the central points -> each row grown from its densest stretch outward, refitted as a quadratic as it grows (the lens
// bends straight rows near the frame's edges) -> points on a row are seedlings, merged into plants along the row ->
// gaps where the next plant is missing -> green off every row is a weed candidate.
//
// Never tuned for the other stages, and they never read EMERGENCE.
import { GREEN_DEFAULTS, type GreenOptions, greenMaskWithExcess } from "../directGeoref/green";
import type { PhotoPixels } from "../photoScout/pattern";
import { type RowCropExcluded, type RowCropGap, type RowCropOptions, type RowCropParams, type RowCropRead, type RowCropRow, type RowCropWeed, ROW_CROP_READ_VERSION, convexHull, downsample, pitchFromProfile } from "./readRowCrop";

export const EMERGENCE = {
  /** Work pixel, metres: a seedling's leaf is about a centimetre wide. */
  workGsdM: 0.01,
  /** Before the scale is known, sizes are shares of the work raster's long side. Solid-green cells: about half a metre on a 26 m frame. */
  solidCellShare: 1 / 48,
  /** A cell over this share green is solid vegetation (a verge, a lawn), not seedlings (a row of seedlings is about 1 % green). */
  solidGreenShare: 0.15,
  /** A seedling point stands in a cell at most this share green (a seedling row is about 2 % green). */
  soilGreenMax: 0.08,
  /** A component larger than this square (share of the long side) is not a seedling point for the direction and pitch. */
  pointMaxSideShare: 1 / 250,
  /** Fewest pixels in a point. */
  pointMinPx: 3,
  /** Under this many points the photo shows no rows of seedlings. */
  minPoints: 40,
  /** A row's points lie within this of its line once the row is fitted, metres (floor; the row's own spread can widen it). */
  rowTolM: 0.04,
  /** Largest radial lens coefficient tried (normalised to half the long side). */
  lensMax: 0.2,
  /** While a row is fitted, a point joins within this share of the pitch. */
  growTolShare: 1 / 6,
  /** Fewest points on a kept row. */
  minRowPoints: 8,
  /** Seedling pieces this close along the row are one plant, metres. */
  plantMergeM: 0.035,
  /** A gap is a stretch with no plant longer than this many median plant spacings of the row, and at least gapMinM. */
  gapSpacings: 2,
  gapMinM: 0.3,
  /** A row is split at empty stretches longer than this, metres; short runs (a few specks on a road) are dropped. */
  endTrimM: 1.5,
  /** Drawn band half-width, metres (the seed furrow and the leaves either side). */
  bandHalfM: 0.06,
  /** Green off every row smaller than this is a speck, square centimetres. */
  minWeedCm2: 2,
  /** Row polyline sampling, metres. */
  sampleM: 0.25,
};

type Comp = { x: number; y: number; n: number; px: number[] };

/** Connected components (8-neighbour) of `mask` outside `skip`; pixel lists kept up to `keepPx` pixels. */
function components(mask: Uint8Array, skip: Uint8Array, W: number, H: number, keepPx: number): Comp[] {
  const lab = new Int32Array(W * H), out: Comp[] = [], stack: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || lab[i] || skip[i]) continue;
    const id = out.length + 1; let sx = 0, sy = 0, n = 0; const px: number[] = [];
    lab[i] = id; stack.push(i);
    while (stack.length) {
      const p = stack.pop()!, x = p % W, y = (p - x) / W;
      sx += x; sy += y; n++; if (px.length < keepPx) px.push(p);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx; if (mask[q] && !lab[q] && !skip[q]) { lab[q] = id; stack.push(q); }
      }
    }
    out.push({ x: sx / n, y: sy / n, n, px });
  }
  return out;
}

/** Weighted least squares s = c0 + c1 u + c2 u^2 (degree 1 or 2), u = t - t0. */
function fitPoly(ts: number[], ss: number[], t0: number, degree: 1 | 2): number[] {
  const m = degree + 1, A = Array.from({ length: m }, () => new Float64Array(m)), b = new Float64Array(m);
  for (let i = 0; i < ts.length; i++) {
    const u = ts[i] - t0, pw = [1, u, u * u];
    for (let r = 0; r < m; r++) { b[r] += pw[r] * ss[i]; for (let c = 0; c < m; c++) A[r][c] += pw[r] * pw[c]; }
  }
  // Gaussian elimination with partial pivoting; a singular system falls back to the mean.
  const M = A.map((row, r) => [...row, b[r]]);
  for (let c = 0; c < m; c++) {
    let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9) { const mean = ss.reduce((a, v) => a + v, 0) / Math.max(1, ss.length); return [mean, 0, 0]; }
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < m; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let j = c; j <= m; j++) M[r][j] -= k * M[c][j]; }
  }
  const coef = M.map((row, r) => row[m] / row[r]);
  return [coef[0], coef[1], degree === 2 ? coef[2] : 0];
}
const evalPoly = (c: number[], t0: number, t: number) => { const u = t - t0; return c[0] + c[1] * u + c[2] * u * u; };

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };

/** Read one photograph of corn at emergence. Same result as readRowCrop; coordinates in photo pixels. */
export function readEmergence(px: PhotoPixels, P: RowCropParams, opts: RowCropOptions = {}): RowCropRead {
  const t0 = Date.now(), E = EMERGENCE;
  const notes: string[] = [];
  const given = P.gsdM != null && P.gsdM > 0 ? P.gsdM : null;
  const f = given ? Math.max(1, Math.round(E.workGsdM / given)) : Math.max(1, Math.ceil(Math.max(px.width, px.height) / 2700));
  const work = downsample(px, f);
  const { W, H } = work, L = Math.max(W, H);
  const empty = (why: string, veg: number, gsdM = given ?? NaN): RowCropRead => ({
    version: ROW_CROP_READ_VERSION, stage: "emergence", width: px.width, height: px.height, gsdM, scaleBasis: given ? "given" : "assumed spacing", workFactor: f, directionDeg: null, pitchM: null, matchedSpacingM: null, rows: [], weeds: [], excluded: [], seedlings: null,
    summary: { rows: 0, rowsDropped: 0, totalRowLengthM: 0, medianBandHalfWidthM: null, medianRowGreenShare: null, weeds: 0, weedAreaM2: 0, betweenRowCover: null, cropComponents: 0, noRowsPatches: 0, leafTips: 0, specks: 0, gaps: 0, gapLengthM: 0, plants: null, coherence: null, vegetationFraction: veg, ms: Date.now() - t0 },
    notes: [...notes, why], crop: P.crop,
  });

  // 1. Green against the soil around it, at about a centimetre.
  const soilTilePx = given ? Math.max(16, Math.round(0.64 / (given * f))) : Math.max(16, Math.round(L / 40));
  const gopts: GreenOptions = { ...GREEN_DEFAULTS, index: "exgr-soil", soilTilePx, cellPx: 1, soilCapAboveGlobal: 0.05 };
  const { mask } = greenMaskWithExcess({ width: W, height: H, rgba: work.rgba }, gopts);
  let greenN = 0; for (let i = 0; i < W * H; i++) greenN += mask[i];
  const veg = greenN / (W * H);
  if (veg < 0.0005) return empty("Almost no green in the photo: no seedlings to read.", r3(veg));

  // 2. Solid green (a verge, a lawn): cells over EMERGENCE.solidGreenShare, grown by one cell, left out.
  const cell = Math.max(4, Math.round(L * E.solidCellShare)), cw = Math.ceil(W / cell), ch = Math.ceil(H / cell);
  const cg = new Float32Array(cw * ch), cn = new Float32Array(cw * ch);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = Math.floor(y / cell) * cw + Math.floor(x / cell); cn[c]++; cg[c] += mask[y * W + x]; }
  const solid = new Uint8Array(cw * ch);
  for (let c = 0; c < cw * ch; c++) if (cn[c] && cg[c] / cn[c] > E.solidGreenShare) solid[c] = 1;
  const grown = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    if (!solid[cy * cw + cx]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = cx + dx, yy = cy + dy; if (xx >= 0 && yy >= 0 && xx < cw && yy < ch) grown[yy * cw + xx] = 1; }
  }
  const skip = new Uint8Array(W * H);
  let solidPx = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grown[Math.floor(y / cell) * cw + Math.floor(x / cell)]) { skip[y * W + x] = 1; solidPx++; }
  const excludedShare = solidPx / (W * H);
  if (excludedShare > 0.01) notes.push(`${Math.round(excludedShare * 100)}% of the photo is solid green (a verge, a lawn, a hedge) and is left out of the rows.`);

  // 3. Components; the small ones are the points the rows are read from.
  const comps = components(mask, skip, W, H, 4000);
  const maxSide = Math.max(3, L * E.pointMaxSideShare);
  // A seedling stands on soil: in a cell over EMERGENCE.soilGreenMax green (thin grass, a weedy headland, the dark
  // corner of a verge) green specks line up along any line drawn through them, so they are no seedling points.
  const onSoil = (c: Comp) => { const k = Math.floor(c.y / cell) * cw + Math.floor(c.x / cell); return cn[k] > 0 && cg[k] / cn[k] <= E.soilGreenMax; };
  const points = comps.filter(c => c.n >= E.pointMinPx && c.n <= maxSide * maxSide && onSoil(c));
  if (points.length < E.minPoints) return empty(`Only ${points.length} seedling-sized green points on the soil: no rows of seedlings to read (is the crop up, or is this a later stage?).`, r3(veg));

  // 4. The lens and the direction. Barrel distortion bends straight rows toward the frame's edges, the same way for
  // every row; one radial coefficient, chosen with the direction where the points line up best, straightens them.
  // Rows are read in the straightened plane and drawn back through the lens (a row half a metre off at the edge
  // otherwise falls onto its neighbour's line).
  const cx0 = (W - 1) / 2, cy0 = (H - 1) / 2, R = L / 2;
  const undistort = (x: number, y: number, k1: number): [number, number] => { const ux = (x - cx0) / R, uy = (y - cy0) / R, g = 1 + k1 * (ux * ux + uy * uy); return [cx0 + (x - cx0) * g, cy0 + (y - cy0) * g]; };
  const distort = (x: number, y: number, k1: number): [number, number] => {
    let px0 = x, py0 = y;
    for (let it = 0; it < 6; it++) { const ux = (px0 - cx0) / R, uy = (py0 - cy0) / R, g = 1 + k1 * (ux * ux + uy * uy); px0 = cx0 + (x - cx0) / g; py0 = cy0 + (y - cy0) / g; }
    return [px0, py0];
  };
  const bin = 2;
  const concentration = (pts: [number, number][], deg: number) => {
    const a = (deg * Math.PI) / 180, ax = -Math.sin(a), ay = Math.cos(a), h = new Map<number, number>();
    for (const [x, y] of pts) { const b = Math.round((x * ax + y * ay) / bin); h.set(b, (h.get(b) ?? 0) + 1); }
    let sc = 0; for (const v of h.values()) sc += v * v; return sc;
  };
  const raw: [number, number][] = points.map(p => [p.x, p.y]);
  let bestDeg = 0, bestV = -1;
  for (let d = 0; d < 180; d += 1) { const v = concentration(raw, d); if (v > bestV) { bestV = v; bestDeg = d; } }
  for (let d = bestDeg - 1; d <= bestDeg + 1; d += 0.1) { const v = concentration(raw, d); if (v > bestV) { bestV = v; bestDeg = d; } }
  let k1 = 0;
  const tryLens = (kk: number, around: number, half: number, step: number) => {
    const pts = raw.map(([x, y]) => undistort(x, y, kk));
    for (let d = around - half; d <= around + half + 1e-9; d += step) { const v = concentration(pts, d); if (v > bestV) { bestV = v; bestDeg = d; k1 = kk; } }
  };
  for (let kk = -E.lensMax; kk <= E.lensMax + 1e-9; kk += 0.02) tryLens(kk, bestDeg, 0.6, 0.2);
  const k1c = k1;
  for (let kk = k1c - 0.02; kk <= k1c + 0.02 + 1e-9; kk += 0.004) tryLens(kk, bestDeg, 0.3, 0.1);
  if (Math.abs(k1) >= 0.01) notes.push(`The lens bends the rows toward the photo's edges; straightened with a radial coefficient of ${k1.toFixed(3)} before the rows were read.`);
  const alpha = (((bestDeg % 180) + 180) % 180) * (Math.PI / 180);
  const dx = Math.cos(alpha), dy = Math.sin(alpha), nx = -Math.sin(alpha), ny = Math.cos(alpha);
  const T = (x: number, y: number) => { const [u, v] = undistort(x, y, k1); return u * dx + v * dy; };
  const S = (x: number, y: number) => { const [u, v] = undistort(x, y, k1); return u * nx + v * ny; };
  opts.debug?.(`direction ${bestDeg.toFixed(1)} deg, lens k1 ${k1.toFixed(3)}, ${points.length} points`);
  checkStop(opts);

  // 5. Pitch from the across profile (one bin a work pixel, lightly smoothed).
  const sv = points.map(p => S(p.x, p.y)), tv = points.map(p => T(p.x, p.y));
  const sMin = Math.floor(Math.min(...sv)), sMax = Math.ceil(Math.max(...sv));
  const prof = new Float64Array(sMax - sMin + 3);
  for (const s of sv) { const b = s - sMin; const i = Math.floor(b), fr = b - i; prof[i] += 1 - fr; prof[i + 1] += fr; }
  const sm = new Float64Array(prof.length);
  for (let i = 0; i < prof.length; i++) for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < prof.length) sm[i] += prof[j] * [1, 4, 6, 4, 1][k + 2] / 16; }
  const minPitchM = 0.8 * Math.min(...P.spacingsM, P.defaultSpacingM), maxPitchM = 1.6 * Math.max(...P.spacingsM, P.defaultSpacingM);
  const gW = given ? given * f : null;
  const pitchPx = pitchFromProfile(sm, gW ? minPitchM / gW : L / 80, gW ? maxPitchM / gW : L / 8, gW ? { lagsPx: P.spacingsM.map(m => m / gW), tolerance: P.pitchToleranceShare } : undefined);
  if (pitchPx == null) return empty("The seedlings do not line up at a row spacing: no rows read.", r3(veg));
  const gsdW = gW ?? P.defaultSpacingM / pitchPx;
  const gsdM = gsdW / f;
  const pitchM = pitchPx * gsdW;
  const matched = P.spacingsM.find(m => Math.abs(pitchM / m - 1) <= P.pitchToleranceShare) ?? null;
  if (!given) notes.push(`No pixel size: the scale assumes a ${(P.defaultSpacingM * 100).toFixed(1)} cm row spacing, so every metre here rests on that.`);
  let m0 = 0; for (const v of sm) m0 += v; m0 /= sm.length;
  let a0 = 0, aP = 0; const lag = Math.round(pitchPx);
  for (let i = 0; i < sm.length; i++) { a0 += (sm[i] - m0) ** 2; if (i + lag < sm.length) aP += (sm[i] - m0) * (sm[i + lag] - m0); }
  const coherence = a0 > 0 ? aP / a0 : 0;

  // 6. Phase from the circular mean of the points across the rows.
  let cs = 0, sn = 0;
  for (const s of sv) { const a = (2 * Math.PI * s) / pitchPx; cs += Math.cos(a); sn += Math.sin(a); }
  const phase = ((Math.atan2(sn, cs) / (2 * Math.PI)) * pitchPx + pitchPx) % pitchPx;
  const span = Math.max(1, Math.max(...tv) - Math.min(...tv));

  // 7. Rows: the points near each line of the comb, the line refitted to them (a quadratic once the row is long
  // and well held, for the planter's own drift), membership narrowed to the row's own spread.
  const tolGrow = pitchPx * E.growTolShare, tolFinal = Math.max(E.rowTolM / gsdW, 2);
  const kLo = Math.floor((sMin - phase) / pitchPx) - 1, kHi = Math.ceil((sMax - phase) / pitchPx) + 1;
  type Fit = { k: number; t0: number; c: number[]; members: number[] };
  let fits: Fit[] = [];
  const owner = new Int32Array(points.length).fill(-1);
  let rowsDropped = 0;
  const all = points.map((_, i) => i);
  for (let k = kLo; k <= kHi; k++) {
    const s0 = phase + k * pitchPx;
    let members = all.filter(i => Math.abs(sv[i] - s0) < pitchPx / 4);
    if (members.length < E.minRowPoints) continue;
    const t0 = members.reduce((u, i) => u + tv[i], 0) / members.length;
    let c = fitPoly(members.map(i => tv[i]), members.map(i => sv[i]), t0, 1);
    for (let it = 0; it < 4; it++) {
      const res = members.map(i => Math.abs(sv[i] - evalPoly(c, t0, tv[i])));
      const tol = it < 2 ? tolGrow : Math.max(tolFinal, Math.min(tolGrow, 3 * 1.4826 * (median(res) ?? 0)));
      const next = all.filter(i => Math.abs(sv[i] - evalPoly(c, t0, tv[i])) < tol);
      if (next.length < 4) break;
      members = next;
      const ts = members.map(i => tv[i]), long = Math.max(...ts) - Math.min(...ts) > 0.3 * span;
      c = fitPoly(ts, members.map(i => sv[i]), t0, members.length >= 12 && long ? 2 : 1);
    }
    opts.debug?.(`row k ${k} at ${s0.toFixed(0)}: ${members.length} members, offset ${(c[0] - s0).toFixed(1)}`);
    if (members.length < E.minRowPoints) { rowsDropped++; continue; }
    fits.push({ k, t0, c, members });
  }
  // Two fits that settled on one row: the one with more points stays.
  fits.sort((a, b) => b.members.length - a.members.length);
  const unique: Fit[] = [];
  for (const fit of fits) {
    const at = evalPoly(fit.c, fit.t0, fit.t0);
    if (unique.some(u => Math.abs(evalPoly(u.c, u.t0, fit.t0) - at) < pitchPx / 3)) { rowsDropped++; continue; }
    unique.push(fit);
  }
  fits = unique.sort((a, b) => a.k - b.k);
  // A point claimed by two rows goes to the nearer.
  for (const [fi, fit] of fits.entries()) for (const i of fit.members) {
    const d = Math.abs(sv[i] - evalPoly(fit.c, fit.t0, tv[i]));
    if (owner[i] < 0 || d < Math.abs(sv[i] - evalPoly(fits[owner[i]].c, fits[owner[i]].t0, tv[i]))) owner[i] = fi;
  }
  checkStop(opts);

  // 8. Plants along each row, gaps, the drawn line.
  const toPhoto = (t: number, s: number): [number, number] => { const [x, y] = distort(t * dx + s * nx, t * dy + s * ny, k1); return [r3(x * f + (f - 1) / 2), r3(y * f + (f - 1) / 2)]; };
  const rowsOut: RowCropRow[] = [];
  const kept: (Fit & { tLo: number; tHi: number })[] = [];
  let plantsTotal = 0, gapsN = 0, gapLen = 0;
  for (const [fi, fit] of fits.entries()) {
    const mine = fit.members.filter(i => owner[i] === fi).sort((a, b) => tv[a] - tv[b]);
    if (mine.length < E.minRowPoints) { rowsDropped++; continue; }
    const merge = E.plantMergeM / gsdW;
    const plants: { t: number; s: number; n: number }[] = [];
    for (const i of mine) {
      const last = plants[plants.length - 1];
      if (last && tv[i] - last.t < merge) { const w = points[i].n; last.t = (last.t * last.n + tv[i] * w) / (last.n + w); last.s = (last.s * last.n + sv[i] * w) / (last.n + w); last.n += w; }
      else plants.push({ t: tv[i], s: sv[i], n: points[i].n });
    }
    // A row's ends stop at its last run of plants: a lone green point beyond a long empty stretch (a verge, a road
    // edge the line happens to cross) is not the row going on.
    // The row is split at every empty stretch over EMERGENCE.endTrimM; runs with fewer than minRowPoints plants (and
    // under a tenth of the longest run) are dropped, wherever they are.
    const lone = E.endTrimM / gsdW;
    const runs: (typeof plants)[] = [[]];
    for (const p of plants) { const run = runs[runs.length - 1]; if (run.length && p.t - run[run.length - 1].t > lone) runs.push([p]); else run.push(p); }
    const longest = Math.max(...runs.map(r => r.length));
    plants.splice(0, plants.length, ...runs.filter(r => r.length >= E.minRowPoints && r.length >= 0.1 * longest).flat());
    if (plants.length < E.minRowPoints) { rowsDropped++; continue; }
    const tA = plants[0].t, tB = plants[plants.length - 1].t;
    const spacings = plants.slice(1).map((p, j) => p.t - plants[j].t);
    const medSp = median(spacings) ?? 0;
    const gapPx = Math.max(E.gapMinM / gsdW, E.gapSpacings * medSp);
    const gaps: RowCropGap[] = [];
    for (let j = 1; j < plants.length; j++) {
      const a = plants[j - 1], b = plants[j];
      if (b.t - a.t <= gapPx) continue;
      const [x1, y1] = toPhoto(a.t, evalPoly(fit.c, fit.t0, a.t)), [x2, y2] = toPhoto(b.t, evalPoly(fit.c, fit.t0, b.t));
      gaps.push({ x1, y1, x2, y2, lengthM: r3((b.t - a.t) * gsdW) });
    }
    const line: [number, number][] = [];
    const stepT = E.sampleM / gsdW;
    for (let t = tA; t < tB; t += stepT) line.push(toPhoto(t, evalPoly(fit.c, fit.t0, t)));
    line.push(toPhoto(tB, evalPoly(fit.c, fit.t0, tB)));
    // Support: half-metre strips along the row with a plant of their own.
    const strips = Math.max(1, Math.ceil((tB - tA) / (0.5 / gsdW)));
    const held = new Set(plants.map(p => Math.min(strips - 1, Math.floor((p.t - tA) / (0.5 / gsdW)))));
    let greenPx = 0; for (const i of mine) greenPx += points[i].n;
    const lengthM = (tB - tA) * gsdW;
    kept.push({ ...fit, tLo: tA, tHi: tB });
    plantsTotal += plants.length; gapsN += gaps.length; gapLen += gaps.reduce((u, g) => u + g.lengthM, 0);
    rowsOut.push({
      id: rowsOut.length, k: fit.k - fits[0].k, points: line, lengthM: r3(lengthM), supportShare: r3(held.size / strips),
      bandHalfWidthM: E.bandHalfM, greenShare: r3(lengthM > 0 ? (greenPx * gsdW * gsdW) / (lengthM * 2 * E.bandHalfM) : 0),
      gaps, plants: plants.length, plantPoints: plants.map(p => toPhoto(p.t, p.s)),
    });
  }

  // 9. Green off every row: weed candidates between the rows, or where no row was read.
  const nearestRow = (t: number, s: number): { d: number; inside: boolean } => {
    let best = Infinity, inside = false;
    for (const fit of kept) {
      const d = Math.abs(s - evalPoly(fit.c, fit.t0, t));
      if (d < best) { best = d; inside = t >= fit.tLo - pitchPx && t <= fit.tHi + pitchPx; }
    }
    return { d: best, inside };
  };
  const compIndex = new Map(points.map((p, i) => [p, i]));
  const weeds: RowCropWeed[] = [];
  let specks = 0, noRows = 0, weedArea = 0, cropComponents = 0;
  const minWeedPx = (E.minWeedCm2 / 1e4) / (gsdW * gsdW);
  for (const c of comps) {
    const pi = compIndex.get(c);
    if (pi != null && owner[pi] >= 0 && kept.some(k => k.members.includes(pi))) { cropComponents++; continue; }
    const t = T(c.x, c.y), s = S(c.x, c.y), nr = nearestRow(t, s);
    if (nr.d * gsdW <= E.bandHalfM) { cropComponents++; continue; }
    if (c.n < minWeedPx) { specks++; continue; }
    const hullPts: [number, number][] = c.px.map(p => { const x = p % W, y = (p - x) / W; return [x * f + (f - 1) / 2, y * f + (f - 1) / 2] as [number, number]; });
    const areaM2 = c.n * gsdW * gsdW;
    const status = kept.length && nr.inside && nr.d < pitchPx ? "between rows" : "no rows here";
    if (status === "no rows here") noRows++;
    weedArea += areaM2;
    weeds.push({
      id: weeds.length, x: r3(c.x * f), y: r3(c.y * f), areaM2: r3(areaM2), equivDiameterM: r3(2 * Math.sqrt(areaM2 / Math.PI)), hull: convexHull(hullPts),
      distToRowM: Number.isFinite(nr.d) ? r3(nr.d * gsdW) : null, bandHalfWidthM: E.bandHalfM,
      touchesEdge: c.px.some(p => { const x = p % W, y = (p - x) / W; return x === 0 || y === 0 || x === W - 1 || y === H - 1; }), status,
    });
  }

  // Solid green as excluded patches: runs of cells per cell row, stacked while they keep the same span (rectangles,
  // so an L-shaped verge is not drawn as one triangle across the field).
  const excluded: RowCropExcluded[] = [];
  let open = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
  const close = (r: { x0: number; x1: number; y0: number; y1: number }) => {
    const X0 = r.x0 * cell * f, X1 = Math.min(W, r.x1 * cell) * f, Y0 = r.y0 * cell * f, Y1 = Math.min(H, r.y1 * cell) * f;
    excluded.push({ hull: [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]], areaM2: r3(((X1 - X0) / f) * ((Y1 - Y0) / f) * gsdW * gsdW), reason: "solid green: a verge, a lawn or a hedge, not seedlings" });
  };
  for (let cy = 0; cy <= ch; cy++) {
    const next = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
    if (cy < ch) for (let cx = 0; cx < cw;) {
      if (!grown[cy * cw + cx]) { cx++; continue; }
      let ex = cx; while (ex < cw && grown[cy * cw + ex]) ex++;
      const key = `${cx}:${ex}`, prev = open.get(key);
      if (prev) { prev.y1 = cy + 1; next.set(key, prev); open.delete(key); } else next.set(key, { x0: cx, x1: ex, y0: cy, y1: cy + 1 });
      cx = ex;
    }
    for (const r of open.values()) close(r);
    open = next;
  }

  notes.push(`Emergence: every seedling is a point, a row is the line the points stand on; ${plantsTotal.toLocaleString()} plants on ${rowsOut.length} rows (seedling pieces within ${Math.round(E.plantMergeM * 100)} cm along a row counted as one plant). The count is from the photo and has not been checked against plants counted on the ground.`);
  if (gapsN) notes.push(`${gapsN} gap${gapsN === 1 ? "" : "s"} along the rows (${gapLen.toFixed(1)} m in all): stretches with no plant found longer than ${E.gapSpacings} x the row's own plant spacing (at least ${Math.round(E.gapMinM * 100)} cm). A gap is where no seedling was seen, not yet a confirmed skip: pale seedlings in the dim corners of the frame are missed, so gaps there run long.`);
  if (weeds.length) notes.push(`${weeds.length} green patch${weeds.length === 1 ? "" : "es"} off the rows: on soil this young, anything green off the planter's line is a weed candidate or a volunteer.`);
  opts.onProgress?.(1, 1);
  return {
    version: ROW_CROP_READ_VERSION, stage: "emergence", width: px.width, height: px.height, gsdM, scaleBasis: given ? "given" : "assumed spacing", workFactor: f,
    directionDeg: r3((alpha * 180) / Math.PI), pitchM: r3(pitchM), matchedSpacingM: matched,
    rows: rowsOut, weeds, excluded, seedlings: null,
    summary: {
      rows: rowsOut.length, rowsDropped, totalRowLengthM: r3(rowsOut.reduce((u, r) => u + r.lengthM, 0)),
      medianBandHalfWidthM: rowsOut.length ? E.bandHalfM : null, medianRowGreenShare: median(rowsOut.map(r => r.greenShare)),
      weeds: weeds.length, weedAreaM2: r3(weedArea), betweenRowCover: null, cropComponents, noRowsPatches: noRows, leafTips: 0, specks,
      gaps: gapsN, gapLengthM: r3(gapLen), plants: plantsTotal, coherence: r3(coherence), vegetationFraction: r3(veg), ms: Date.now() - t0,
    },
    notes, crop: P.crop,
  };
}

function checkStop(opts: RowCropOptions) { if (opts.signal?.aborted) throw new Error("cancelled"); }
