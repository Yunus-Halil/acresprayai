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
import { SEEDLING_GREEN, SEEDLING_RELAXED, seedlingMask, seedlingWindow, shrinkMask, soilLevels } from "./seedlingGreen";
import { type EmergenceV2, type RowCropExcluded, type RowCropGap, type RowCropOptions, type RowCropParams, type RowCropRead, type RowCropRow, type RowCropWeed, ROW_CROP_READ_VERSION, convexHull, downsample, pitchFromProfile } from "./readRowCrop";

export const EMERGENCE = {
  /** Work pixel, metres: a seedling's leaf is about a centimetre wide. */
  workGsdM: 0.01,
  /** Before the scale is known, sizes are shares of the work raster's long side. Solid-green cells: about half a metre on a 26 m frame. */
  solidCellShare: 1 / 48,
  /** A cell over this share green is solid vegetation (a verge, a lawn), not seedlings (a row of seedlings is about 1 % green). */
  solidGreenShare: 0.15,
  /** A seedling point stands in a cell at most this share green (a seedling row is about 2 % green). */
  soilGreenMax: 0.08,
  /**
   * The verge's edge, at a finer cell (this share of the coarse cell, about 14 cm on these photographs; Yunus,
   * 2026-11-02: "it is corn, so follow it, and stop when the non-corn stuff comes"). The coarse exclusion grown by a
   * whole cell cut up to a metre of seedlings off every row ending at a verge. Inside the coarse zone a pixel is left
   * out where its fine cell is solidly green itself and part of green ground; grass is continuous green, a fine cell with
   * a seedling on soil is a few percent to a fifth. Grown only into neighbouring cells that are green themselves.
   */
  edgeCellShare: 0.25,
  /** A fine cell is grass when it is this green itself (and its 3 x 3 neighbourhood over solidGreenShare) ... */
  edgeOwnGreen: 0.3,
  /** ... and the grass grows into a neighbouring fine cell this green (its ragged fringe), never into a seedling's cell on soil. */
  edgeFringeGreen: 0.12,
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
  /**
   * V2 (2026-11-02). More plantings in one frame: photograph 100's right third is a later planting in the same direction
   * at its own place, barely emerged, and its seedlings were all listed as weeds. Ground the main rows do not reach,
   * at least EMERGENCE.extraMinWidthPitches wide, soil for the most part, is looked at again with the relaxed seedling
   * test (SEEDLING_RELAXED, light-scaled); its specks are a planting only when they line up at a planted spacing at
   * least EMERGENCE.extraMinCoherence strongly. Its rows are not drawn (too faint to place: tried, they missed the
   * furrows); the ground is set apart, not judged, and its green counted on its own. Off: the V1 reader.
   */
  extraPlantings: true,
  extraMinWidthPitches: 3,
  extraMinPoints: 60,
  extraMinCoherence: 0.45,
  /**
   * V2. Row-conditioned recovery: in a stretch of a row longer than EMERGENCE.recoverFromSpacings plant spacings, the
   * expected plant positions (the row's own spacing) are searched with the relaxed test inside a corridor along the
   * fitted line, and the same search is run in the alleys beside it as a control. Off: the V1 reader.
   */
  recover: true,
  recoverFromSpacings: 1.6,
  /** Corridor half-width, metres (at least; 2.5 times the row's own spread when wider). */
  corridorM: 0.03,
  /** A recovered speck has at least this many photo pixels (at 0.48 cm about 2 cm²) ... */
  recoverMinPx: 8,
  /** ... and stands within this share of the row's spacing of its expected position, along the row. */
  recoverAlongShare: 0.45,
  /** Control hits in the alleys per expected position at or over this: the ground fires the relaxed test by itself
   * (busy soil, crust), so neither a find nor an absence there is evidence. */
  noisyControl: 0.34,
  /** A missing plant is supported only where the soil is at least this bright against the frame's (no dim corner) ... */
  missingMinLight: 0.7,
  /** ... and the position stands inside this share of the frame's half-diagonal from its centre (no vignetted rim). */
  missingMaxRadius: 0.92,
  /**
   * Row ends (validation 2026-11-02: 12 of 17 audited row ends stopped while seedlings went on, every one in the frame's
   * dim rim, and the seedlings beyond became weed candidates). From each end the row is followed on along its fitted
   * line, one plant spacing at a time: the strict test first, then the relaxed light-scaled one with both alleys quiet.
   * It stops at the frame, at solid green (a verge), at the later planting's ground, where the alleys beside are as
   * green as the line (stubble, a weedy headland: not the row going on), and after this many expected positions in a
   * row with nothing. Off: rows end at their last strict point, as before.
   */
  extendEnds: true,
  extendMisses: 2,
  /**
   * Off the rows (validation 2026-11-02: 7 of 29 decided off-row candidates were weeds; every wrong one was smaller than
   * the stand's median seedling, stubble at the verge, soil and residue, a seedling just off the line). A patch larger
   * than nearly all the crop's own seedlings (their 90th percentile, measured on each photograph) is a weed candidate:
   * at emergence a plant already bigger than the corn is the one that competes. Smaller green off the rows is counted
   * apart as small green, never called a weed: a tiny weed, a displaced seedling, a leaf piece or a green fleck look
   * alike at this pixel. Off: every off-row patch is a weed candidate, as before.
   */
  tierBySeedlings: true,
  /**
   * The field's edge (Yunus, 2026-11-02, on the emergence pictures: "all of the false ones are near the edge of the
   * field ... the threshold to be a weed is higher so little things do not get caught up"). Within edgeZoneM of the
   * field's edge (verge or lawn left out as solid green, or a row's end inside the photo: the headland) a patch must be
   * edgeFactor times the stand's 90th-percentile seedling to be a weed candidate; smaller is counted apart as small
   * green. The validation's fresh sample: all 11 verge or stubble false candidates stood there.
   */
  edgeZoneM: 1.0,
  edgeFactor: 3,
  /**
   * Touching the row (Yunus, 2026-11-02: "it is literally in the row ... it obviously is the crop"). A patch any part of
   * which lies within the row's band (bandHalfM of the fitted line) is the crop's own leaf, not a weed, unless it is
   * clearly green and larger than touchRowFactor times the stand's 90th-percentile seedling. Off: only the patch's
   * centre is tested, as before.
   */
  touchRowIsCrop: true,
  touchRowFactor: 3,
  /**
   * Its own colour (Yunus: "it obviously looks like straw ... it's not even green"). The seedling test judges a pixel
   * against the soil right beside it, so pale straw with a few grass blades through it passes. A plant's leaf reflects
   * more green than red: a patch whose mask pixels average G - R at or under minGreenOverRed is straw, residue or soil,
   * never a plant (every real weed in the validation sample was over 0, the red straw marks under it). At the field's
   * edge a weed must also be mostly clearly green: edgeMinGreenOverRed and edgeMinStrongShare of its pixels.
   */
  minGreenOverRed: 0,
  edgeMinGreenOverRed: 5,
  edgeMinStrongShare: 0.6,
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

  // 2. Solid green (a verge, a lawn): cells over EMERGENCE.solidGreenShare, grown by one cell, then its edge refined at
  // a finer cell so the rows run up to the grass (EMERGENCE.edgeCellShare).
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
  // The edge refined: fine cells inside the coarse zone, solid where their 3 x 3 neighbourhood is, grown by one.
  const fcell = Math.max(2, Math.round(cell * E.edgeCellShare)), fw = Math.ceil(W / fcell), fh = Math.ceil(H / fcell);
  const fg = new Float32Array(fw * fh), fn = new Float32Array(fw * fh);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = Math.floor(y / fcell) * fw + Math.floor(x / fcell); fn[c]++; fg[c] += mask[y * W + x]; }
  /** Green share of the 3 x 3 fine cells around fine cell (fx, fy). */
  const fineNb = (fx: number, fy: number) => { let g = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = fx + dx, yy = fy + dy; if (xx < 0 || yy < 0 || xx >= fw || yy >= fh) continue; g += fg[yy * fw + xx]; n += fn[yy * fw + xx]; } return n ? g / n : 0; };
  const inCoarse = (fx: number, fy: number) => grown[Math.min(ch - 1, Math.floor(((fy + 0.5) * fcell) / cell)) * cw + Math.min(cw - 1, Math.floor(((fx + 0.5) * fcell) / cell))] === 1;
  const fsolid = new Uint8Array(fw * fh);
  const own = (fx: number, fy: number) => { const c = fy * fw + fx; return fn[c] ? fg[c] / fn[c] : 0; };
  for (let fy = 0; fy < fh; fy++) for (let fx = 0; fx < fw; fx++) if (inCoarse(fx, fy) && own(fx, fy) > E.edgeOwnGreen && fineNb(fx, fy) > E.solidGreenShare) fsolid[fy * fw + fx] = 1;
  // Grown by one fine cell, but only into cells that are green themselves (the grass's ragged fringe); a cell holding
  // a seedling or two on soil is under that and stays in the field.
  const fgrown = new Uint8Array(fsolid);
  for (let fy = 0; fy < fh; fy++) for (let fx = 0; fx < fw; fx++) {
    if (!fsolid[fy * fw + fx]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = fx + dx, yy = fy + dy; if (xx >= 0 && yy >= 0 && xx < fw && yy < fh && own(xx, yy) > E.edgeFringeGreen) fgrown[yy * fw + xx] = 1; }
  }
  const skip = new Uint8Array(W * H);
  let solidPx = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fgrown[Math.floor(y / fcell) * fw + Math.floor(x / fcell)]) { skip[y * W + x] = 1; solidPx++; }
  const excludedShare = solidPx / (W * H);
  if (excludedShare > 0.01) notes.push(`${Math.round(excludedShare * 100)}% of the photo is solid green (a verge, a lawn, a hedge) and is left out of the rows.`);

  // 3. The seedlings themselves, pale leaves included (seedlingGreen.ts: tint against the soil beside each pixel, at
  // the photo's own pixel, shrunk to the work raster by "any pixel in the block"); the components of that mask are
  // the points the rows are read from. The fixed index above judges solid green and the soil only.
  const levels = soilLevels(px, SEEDLING_GREEN);
  const seedFull = seedlingMask(px, SEEDLING_GREEN, levels);
  const seed = shrinkMask(seedFull, px.width, px.height, f);
  const comps = components(seed, skip, W, H, 4000);
  const maxSide = Math.max(3, L * E.pointMaxSideShare);
  // A seedling stands on soil: in a cell over EMERGENCE.soilGreenMax green (thin grass, a weedy headland, the dark
  // corner of a verge) green specks line up along any line drawn through them, so they are no seedling points.
  // A coarse cell can hold grass or a weed patch beside the seedlings (at a verge, beside a clover patch: photograph
  // 35's rows lost 2 m of seedlings that way); there the fine neighbourhood decides (it can only add points).
  const onSoil = (c: Comp) => { const k = Math.floor(c.y / cell) * cw + Math.floor(c.x / cell); if (cn[k] > 0 && cg[k] / cn[k] <= E.soilGreenMax) return true; const fx = Math.floor(c.x / fcell), fy = Math.floor(c.y / fcell); return !fgrown[fy * fw + fx] && fineNb(fx, fy) <= E.soilGreenMax; };
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
  const toPhoto = (t: number, s: number): [number, number] => { const [x, y] = distort(t * dx + s * nx, t * dy + s * ny, k1); return [r3(x * f + (f - 1) / 2), r3(y * f + (f - 1) / 2)]; };
  const strongAt = (xP: number, yP: number, r: number) => {
    for (let yy = Math.max(0, Math.round(yP) - r); yy <= Math.min(px.height - 1, Math.round(yP) + r); yy++) for (let xx = Math.max(0, Math.round(xP) - r); xx <= Math.min(px.width - 1, Math.round(xP) + r); xx++) if (seedFull[yy * px.width + xx]) return true;
    return false;
  };
  /** Specks of the relaxed, light-scaled seedling test inside a straightened window (t, s ranges, work units), in (t, s), with their size in photo pixels; solid green left out. */
  type Speck = { t: number; s: number; xP: number; yP: number; n: number; strong: boolean };
  const relaxedIn = (tLo: number, tHi: number, sLo: number, sHi: number, maxPx = Infinity): Speck[] => {
    const cs = [toPhoto(tLo, sLo), toPhoto(tLo, sHi), toPhoto(tHi, sLo), toPhoto(tHi, sHi)];
    const x0 = Math.floor(Math.min(...cs.map(c => c[0]))) - 2, x1 = Math.ceil(Math.max(...cs.map(c => c[0]))) + 3;
    const y0 = Math.floor(Math.min(...cs.map(c => c[1]))) - 2, y1 = Math.ceil(Math.max(...cs.map(c => c[1]))) + 3;
    const X0 = Math.max(0, x0), Y0 = Math.max(0, y0), X1 = Math.min(px.width, x1), Y1 = Math.min(px.height, y1);
    if (X1 <= X0 || Y1 <= Y0) return [];
    const m = seedlingWindow(px, levels, SEEDLING_RELAXED, X0, Y0, X1, Y1, true), w = X1 - X0, h = Y1 - Y0;
    const lab = new Uint8Array(w * h), out: Speck[] = [], st: number[] = [];
    for (let i0 = 0; i0 < w * h; i0++) {
      if (!m[i0] || lab[i0]) continue;
      let sx = 0, sy = 0, n = 0; lab[i0] = 1; st.push(i0);
      while (st.length) {
        const q = st.pop()!, x = q % w, y = (q - x) / w; sx += x; sy += y; n++;
        for (let ddy = -1; ddy <= 1; ddy++) for (let ddx = -1; ddx <= 1; ddx++) { const xx = x + ddx, yy = y + ddy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; if (m[j] && !lab[j]) { lab[j] = 1; st.push(j); } }
      }
      if (n < E.recoverMinPx || n > maxPx) continue;
      const xP = X0 + sx / n, yP = Y0 + sy / n, wx = (xP - (f - 1) / 2) / f, wy = (yP - (f - 1) / 2) / f;
      const wi = Math.min(H - 1, Math.max(0, Math.round(wy))) * W + Math.min(W - 1, Math.max(0, Math.round(wx)));
      if (skip[wi]) continue;
      const t = T(wx, wy), sAc = S(wx, wy);
      if (t < tLo || t > tHi || sAc < sLo || sAc > sHi) continue;
      out.push({ t, s: sAc, xP, yP, n, strong: strongAt(xP, yP, 1) });
    }
    return out;
  };

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
  type Fit = { k: number; t0: number; c: number[]; members: number[]; /** Which planting (comb) the row belongs to, 0 the main one. */ comb: number; tLo: number; tHi: number };
  let rowsDropped = 0;
  const all = points.map((_, i) => i);
  /** The rows of one comb (pitch, phase) grown from the candidate points only, each refitted to its own points. */
  const growComb = (cands: number[], pitch: number, ph: number, comb: number): Fit[] => {
    const out: Fit[] = [];
    const cs = cands.map(i => sv[i]);
    const lo = Math.floor((Math.min(...cs) - ph) / pitch) - 1, hi = Math.ceil((Math.max(...cs) - ph) / pitch) + 1;
    const grow = pitch * E.growTolShare;
    for (let k = lo; k <= hi; k++) {
      const s0 = ph + k * pitch;
      let members = cands.filter(i => Math.abs(sv[i] - s0) < pitch / 4);
      if (members.length < E.minRowPoints) continue;
      const t0 = members.reduce((u, i) => u + tv[i], 0) / members.length;
      let c = fitPoly(members.map(i => tv[i]), members.map(i => sv[i]), t0, 1);
      for (let it = 0; it < 4; it++) {
        const res = members.map(i => Math.abs(sv[i] - evalPoly(c, t0, tv[i])));
        const tol = it < 2 ? grow : Math.max(tolFinal, Math.min(grow, 3 * 1.4826 * (median(res) ?? 0)));
        const next = cands.filter(i => Math.abs(sv[i] - evalPoly(c, t0, tv[i])) < tol);
        if (next.length < 4) break;
        members = next;
        const ts = members.map(i => tv[i]), long = Math.max(...ts) - Math.min(...ts) > 0.3 * span;
        c = fitPoly(ts, members.map(i => sv[i]), t0, members.length >= 12 && long ? 2 : 1);
      }
      opts.debug?.(`comb ${comb} row k ${k} at ${s0.toFixed(0)}: ${members.length} members, offset ${(c[0] - s0).toFixed(1)}`);
      if (members.length < E.minRowPoints) { rowsDropped++; continue; }
      const ts = members.map(i => tv[i]);
      out.push({ k: k + comb * 10000, t0, c, members, comb, tLo: Math.min(...ts), tHi: Math.max(...ts) });
    }
    return out;
  };
  /** Two fits that settled on one row (inside each other's span): the one with more points stays. */
  const dedupe = (fs: Fit[], keep: Fit[] = []): Fit[] => {
    const unique: Fit[] = [...keep];
    for (const fit of [...fs].sort((a, b) => b.members.length - a.members.length)) {
      const t = (fit.tLo + fit.tHi) / 2, at = evalPoly(fit.c, fit.t0, t);
      if (unique.some(u => t >= u.tLo - pitchPx && t <= u.tHi + pitchPx && Math.abs(evalPoly(u.c, u.t0, t) - at) < pitchPx / 3)) { rowsDropped++; continue; }
      unique.push(fit);
    }
    return unique.slice(keep.length);
  };
  const fits: Fit[] = dedupe(growComb(all, pitchPx, phase, 0));
  // V2: more plantings. The ground the main rows do not reach (across the field, beyond their outermost lines, where
  // most of the main rows' length lies) is looked at again with the relaxed test; a later planting there is the pattern.
  const laterGround: { sLo: number; sHi: number; tLo: number; tHi: number }[] = [];
  if (E.extraPlantings && fits.length) {
    // Each row's across position at the middle of the main rows' common span; the frame's extent in s and t.
    const tMid = median(fits.map(fit => (fit.tLo + fit.tHi) / 2)) ?? 0;
    const across = fits.map(fit => evalPoly(fit.c, fit.t0, Math.min(fit.tHi, Math.max(fit.tLo, tMid)))).sort((a, b) => a - b);
    const border: [number, number][] = [];
    for (let q = 0; q <= 40; q++) { const u = (q / 40) * (W - 1), v = (q / 40) * (H - 1); border.push([u, 0], [u, H - 1], [0, v], [W - 1, v]); }
    const fs = border.map(([x, y]) => S(x, y)), ft = border.map(([x, y]) => T(x, y));
    const fsLo = Math.min(...fs), fsHi = Math.max(...fs), ftLo = Math.min(...ft), ftHi = Math.max(...ft);
    // The main rows' body: the largest run of rows each within 1.5 pitches of the next (a stray row out in other
    // ground, photograph 100's, does not stretch it).
    let bodyLo = 0, bodyHi = 0, bestN = 0;
    for (let i = 0; i < across.length;) { let j = i; while (j + 1 < across.length && across[j + 1] - across[j] <= 1.5 * pitchPx) j++; if (j - i + 1 > bestN) { bestN = j - i + 1; bodyLo = i; bodyHi = j; } i = j + 1; }
    const sides: [number, number][] = [[fsLo, across[bodyLo] - pitchPx / 2], [across[bodyHi] + pitchPx / 2, fsHi]];
    for (const [sLo, sHi] of sides) {
      if (sHi - sLo < E.extraMinWidthPitches * pitchPx) continue;
      // Mostly soil there? (a verge beside the field is solid green and skipped)
      let soilCells = 0, cells = 0;
      for (let fy = 0; fy < fh; fy++) for (let fx = 0; fx < fw; fx++) { const x = (fx + 0.5) * fcell, y = (fy + 0.5) * fcell; const sv0 = S(x, y); if (sv0 < sLo || sv0 > sHi) continue; cells++; if (!fgrown[fy * fw + fx]) soilCells++; }
      if (!cells || soilCells < 0.5 * cells) continue;
      const maxPx = maxSide * maxSide * f * f;
      const specks = relaxedIn(ftLo, ftHi, sLo, sHi, maxPx);
      opts.debug?.(`planting 2: ground ${((sHi - sLo) / pitchPx).toFixed(1)} pitches wide, ${specks.length} relaxed specks`);
      if (specks.length < E.extraMinPoints) continue;
      // Its own small angle to the main rows: the slope (up to 3 degrees) where the specks' across positions concentrate.
      const tC = specks.reduce((u, q) => u + q.t, 0) / specks.length;
      let slope = 0, bestC = -1;
      for (let deg = -3; deg <= 3.001; deg += 0.1) {
        const sl = Math.tan((deg * Math.PI) / 180), h = new Map<number, number>();
        for (const q of specks) { const b = Math.round((q.s - sl * (q.t - tC)) / 2); h.set(b, (h.get(b) ?? 0) + 1); }
        let c = 0; for (const v of h.values()) c += v * v;
        if (c > bestC) { bestC = c; slope = sl; }
      }
      const rs = specks.map(q => q.s - slope * (q.t - tC)), rMin = Math.floor(Math.min(...rs)), rMax = Math.ceil(Math.max(...rs));
      const rp = new Float64Array(rMax - rMin + 3);
      for (const v of rs) { const b = v - rMin, i = Math.floor(b), fr = b - i; rp[i] += 1 - fr; rp[i + 1] += fr; }
      const rsm = new Float64Array(rp.length);
      for (let i = 0; i < rp.length; i++) for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < rp.length) rsm[i] += rp[j] * [1, 4, 6, 4, 1][k + 2] / 16; }
      const p2 = pitchFromProfile(rsm, minPitchM / gsdW, maxPitchM / gsdW, { lagsPx: P.spacingsM.map(m => m / gsdW), tolerance: P.pitchToleranceShare });
      if (p2 == null) continue;
      let mm = 0; for (const v of rsm) mm += v; mm /= rsm.length;
      let b0 = 0, bP = 0; const lg = Math.round(p2);
      for (let i = 0; i < rsm.length; i++) { b0 += (rsm[i] - mm) ** 2; if (i + lg < rsm.length) bP += (rsm[i] - mm) * (rsm[i + lg] - mm); }
      const coh2 = b0 > 0 ? bP / b0 : 0;
      opts.debug?.(`planting 2: ${((Math.atan(slope) * 180) / Math.PI).toFixed(1)} deg to the main rows, pitch ${p2.toFixed(1)} px (${(p2 * gsdW * 100).toFixed(0)} cm), coherence ${coh2.toFixed(2)}`);
      if (coh2 < E.extraMinCoherence) continue;
      // Its specks line up: a later planting. Its rows are not drawn: on photograph 100 a comb grown from these specks put
      // lines on plain soil beside the furrows and skipped furrows between, and a line through ground that is not the
      // crop is worse than none. The ground is set apart, its green kept as its own count, never called weeds.
      laterGround.push({ sLo, sHi, tLo: ftLo, tHi: ftHi });
      notes.push(`Another planting beside these rows, barely emerged: green specks there line up ${(p2 * gsdW * 100).toFixed(0)} cm apart (at the assumed scale), but too faintly to place its rows reliably. That ground is set apart and not judged; its green is not counted as weeds.`);
    }
  }
  // A main-comb row standing inside the later planting's ground (photograph 100 had one) is not supported: dropped.
  for (let i = fits.length - 1; i >= 0; i--) {
    const fit = fits[i], at = evalPoly(fit.c, fit.t0, (fit.tLo + fit.tHi) / 2);
    if (laterGround.some(g => at >= g.sLo && at <= g.sHi)) { fits.splice(i, 1); rowsDropped++; }
  }
  fits.sort((a, b) => a.comb - b.comb || evalPoly(a.c, a.t0, (a.tLo + a.tHi) / 2) - evalPoly(b.c, b.t0, (b.tLo + b.tHi) / 2));
  // A point claimed by two rows goes to the nearer.
  const owner = new Int32Array(points.length).fill(-1);
  for (const [fi, fit] of fits.entries()) for (const i of fit.members) {
    const d = Math.abs(sv[i] - evalPoly(fit.c, fit.t0, tv[i]));
    if (owner[i] < 0 || d < Math.abs(sv[i] - evalPoly(fits[owner[i]].c, fits[owner[i]].t0, tv[i]))) owner[i] = fi;
  }
  checkStop(opts);

  // 8. Plants along each row, gaps, the drawn line; with V2 recovery, the expected positions in long stretches searched.
  const rowsOut: RowCropRow[] = [];
  const v2 = { searched: 0, possible: 0, uncertain: 0, missing: 0, controlWindows: 0, controlHits: 0, confirmed: 0, strictFound: 0, gapsV1: 0, gapLenV1: 0, endStrict: 0, endPossible: 0 };
  /** Strict-mask pixels in a straightened window around (t, s) on a row: their mean position, or null. */
  const strictIn = (t: number, sC: number, halfT: number, halfS: number): { t: number; s: number } | null => {
    let n = 0, st = 0, ss = 0;
    for (let u = -halfT; u <= halfT; u += 0.5) for (let v = -halfS; v <= halfS; v += 0.5) {
      const [xP, yP] = toPhoto(t + u, sC + v), xi = Math.round(xP), yi = Math.round(yP);
      if (xi < 0 || yi < 0 || xi >= px.width || yi >= px.height || !seedFull[yi * px.width + xi]) continue;
      n++; st += t + u; ss += sC + v;
    }
    return n >= 2 ? { t: st / n, s: ss / n } : null;
  };
  const rOf = (t: number, s: number) => { const [x, y] = distort(t * dx + s * nx, t * dy + s * ny, k1); return Math.hypot((x - cx0) / R, (y - cy0) / R) / Math.hypot(W / L, H / L); };
  const lightAt = (xP: number, yP: number) => { const c = Math.min(levels.gh - 1, Math.floor(yP / levels.B)) * levels.gw + Math.min(levels.gw - 1, Math.floor(xP / levels.B)); const l = levels.soilL[c]; return Number.isFinite(l) ? l / levels.globalL : 0; };
  const kept: (Fit & { tLo: number; tHi: number })[] = [];
  let plantsTotal = 0, gapsN = 0, gapLen = 0;
  const plantPx: number[] = [];
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
    // A stretch is empty only when the strict mask holds no green on the fitted line along it for EMERGENCE.endTrimM:
    // a seedling over the point size cap is still a plant there (photograph 35 lost two metres of two rows to that).
    const emptyFor = (ta: number, tb: number) => {
      const step = 0.02 / gsdW, half = 0.01 / gsdW, across = 0.03 / gsdW;
      let longest = 0, run = 0;
      for (let t = ta + step; t < tb; t += step) {
        const sE = evalPoly(fit.c, fit.t0, t), [xP, yP] = toPhoto(t, sE);
        const wi = Math.min(H - 1, Math.max(0, Math.round((yP - (f - 1) / 2) / f))) * W + Math.min(W - 1, Math.max(0, Math.round((xP - (f - 1) / 2) / f)));
        // Green inside solid-green ground (a verge, a lawn) is grass, never a plant holding the row together.
        if (!skip[wi] && strictIn(t, sE, half, across)) run = 0; else { run += step; if (run > longest) longest = run; }
      }
      return longest;
    };
    const runs: (typeof plants)[] = [[]];
    for (const p of plants) { const run = runs[runs.length - 1]; if (run.length && p.t - run[run.length - 1].t > lone && emptyFor(run[run.length - 1].t, p.t) > lone) runs.push([p]); else run.push(p); }
    const longest = Math.max(...runs.map(r => r.length));
    plants.splice(0, plants.length, ...runs.filter(r => r.length >= E.minRowPoints && r.length >= 0.1 * longest).flat());
    if (plants.length < E.minRowPoints) { rowsDropped++; continue; }
    let tA = plants[0].t, tB = plants[plants.length - 1].t;
    const spacings = plants.slice(1).map((p, j) => p.t - plants[j].t);
    const medSp = median(spacings) ?? 0;
    const gapPx = Math.max(E.gapMinM / gsdW, E.gapSpacings * medSp);
    const gapsOf = (ps: { t: number }[]) => { const out: [number, number][] = []; for (let j = 1; j < ps.length; j++) if (ps[j].t - ps[j - 1].t > gapPx) out.push([ps[j - 1].t, ps[j].t]); return out; };
    // Row ends followed on (EMERGENCE.extendEnds), before the gaps and the recovery, which then see the whole row.
    const endStrict: { t: number; s: number }[] = [], endPossible: { t: number; s: number }[] = [];
    if (E.extendEnds && medSp > 0) {
      const spreadE = median(mine.map(i => Math.abs(sv[i] - evalPoly(fit.c, fit.t0, tv[i])))) ?? 0;
      const corrE = Math.max(E.corridorM / gsdW, 2.5 * spreadE), along = E.recoverAlongShare * medSp;
      const ctrlMaxPx = Math.round(0.004 / (gsdM * gsdM));
      for (const dir of [1, -1] as const) {
        // Followed from the row's last stretch, not the whole row's curve carried past its end: in a corner the lens
        // bends the row away from that curve (photograph 54). The line through the last plants, re-centred on each find.
        const tail = (dir === 1 ? plants.slice(-8) : plants.slice(0, 8));
        const tl = fitPoly(tail.map(q => q.t), tail.map(q => q.s), tail[0].t, 1);
        const slope = tl[1];
        let last = dir === 1 ? tB : tA, lastS = evalPoly(tl, tail[0].t, last), k = 1;
        const lineAt = (t: number) => lastS + slope * (t - last);
        for (let guard = 0; guard < 400 && k <= E.extendMisses + 1; guard++) {
          const t = last + dir * k * medSp, sE = lineAt(t), [xP, yP] = toPhoto(t, sE);
          if (xP < 0 || yP < 0 || xP >= px.width || yP >= px.height) break; // the frame
          const wi = Math.min(H - 1, Math.max(0, Math.round((yP - (f - 1) / 2) / f))) * W + Math.min(W - 1, Math.max(0, Math.round((xP - (f - 1) / 2) / f)));
          if (skip[wi] || laterGround.some(g => sE >= g.sLo && sE <= g.sHi)) break; // a verge, the later planting
          // Green on the alleys' lines beside the expected position: the ground is green all over, not the row going on.
          if (strictIn(t, sE - pitchPx / 2, along, corrE) || strictIn(t, sE + pitchPx / 2, along, corrE)) { k++; continue; }
          const sHit = strictIn(t, sE, along, corrE);
          if (sHit) { endStrict.push(sHit); lastS = sHit.s; last = sHit.t; k = 1; continue; }
          const hit = relaxedIn(t - along, t + along, sE - corrE - 2, sE + corrE + 2).filter(q => Math.abs(q.s - lineAt(q.t)) <= corrE).sort((u, w) => w.n - u.n)[0];
          const ctrl = hit ? relaxedIn(t - along, t + along, sE - pitchPx / 2 - corrE, sE - pitchPx / 2 + corrE, ctrlMaxPx).length + relaxedIn(t - along, t + along, sE + pitchPx / 2 - corrE, sE + pitchPx / 2 + corrE, ctrlMaxPx).length : 0;
          if (hit && !ctrl) { endPossible.push({ t: hit.t, s: hit.s }); lastS = hit.s; last = hit.t; k = 1; continue; }
          k++;
        }
      }
      const ends = [...endStrict, ...endPossible].map(q => q.t);
      if (ends.length) { tA = Math.min(tA, ...ends); tB = Math.max(tB, ...ends); }
      v2.endStrict += endStrict.length; v2.endPossible += endPossible.length;
    }
    const v1Gaps = gapsOf(plants);
    v2.gapsV1 += v1Gaps.length; v2.gapLenV1 += v1Gaps.reduce((u, [a, b]) => u + (b - a) * gsdW, 0);
    // V2 recovery: in every stretch longer than EMERGENCE.recoverFromSpacings spacings, the expected positions
    // searched with the relaxed test in a corridor along the fitted line; the same search in both alleys is the control.
    const possible: { t: number; s: number }[] = [], uncertain: { t: number; s: number }[] = [], missing: { t: number; s: number }[] = [], strictFound: { t: number; s: number }[] = [];
    if (E.recover && medSp > 0) {
      const spread = median(mine.map(i => Math.abs(sv[i] - evalPoly(fit.c, fit.t0, tv[i])))) ?? 0;
      const corr = Math.max(E.corridorM / gsdW, 2.5 * spread);
      for (let j = 1; j < plants.length; j++) {
        const a = plants[j - 1], b = plants[j], gap = b.t - a.t;
        if (gap < E.recoverFromSpacings * medSp) continue;
        const m = Math.max(1, Math.round(gap / medSp) - 1);
        const step = gap / (m + 1);
        const sMid = evalPoly(fit.c, fit.t0, (a.t + b.t) / 2);
        const tLo = a.t + 0.5 * step, tHi = b.t - 0.5 * step;
        const found = relaxedIn(tLo - E.recoverAlongShare * step, tHi + E.recoverAlongShare * step, sMid - corr - Math.abs(fit.c[1]) * gap - 2, sMid + corr + Math.abs(fit.c[1]) * gap + 2).filter(q => Math.abs(q.s - evalPoly(fit.c, fit.t0, q.t)) <= corr);
        // Control: the same search in the middle of both alleys, as wide.
        let ctrl = 0;
        for (const side of [-1, 1]) ctrl += relaxedIn(tLo - E.recoverAlongShare * step, tHi + E.recoverAlongShare * step, sMid + side * pitchPx / 2 - corr, sMid + side * pitchPx / 2 + corr, Math.round((0.004 / (gsdM * gsdM)))).length;
        const ctrlRate = ctrl / (2 * m);
        v2.controlWindows += 2 * m; v2.controlHits += ctrl;
        const noisy = ctrlRate >= E.noisyControl;
        for (let q = 1; q <= m; q++) {
          const t = a.t + q * step, sE = evalPoly(fit.c, fit.t0, t);
          { const [xq, yq] = toPhoto(t, sE); if (xq < 0 || yq < 0 || xq >= px.width || yq >= px.height) continue; } // outside the photograph: nothing to say
          v2.searched++;
          // The strict test first: a plant it sees on the line here (larger than a seedling point, or in a crowded
          // cell, so V1 never made it a point) is confirmed, whatever its size.
          const sHit = strictIn(t, sE, E.recoverAlongShare * step, corr);
          if (sHit) { strictFound.push(sHit); continue; }
          const hit = found.filter(h => Math.abs(h.t - t) <= E.recoverAlongShare * step).sort((u, w) => w.n - u.n)[0];
          if (hit && !noisy) { possible.push({ t: hit.t, s: hit.s }); continue; }
          const [xP, yP] = toPhoto(t, sE);
          const clear = !noisy && lightAt(xP, yP) >= E.missingMinLight && rOf(t, sE) <= E.missingMaxRadius && xP > 0.02 * px.width && xP < 0.98 * px.width && yP > 0.02 * px.height && yP < 0.98 * px.height;
          (clear && !hit ? missing : uncertain).push({ t, s: sE });
        }
      }
      v2.possible += possible.length; v2.uncertain += uncertain.length; v2.missing += missing.length;
    }
    strictFound.push(...endStrict); possible.push(...endPossible); v2.possible += endPossible.length;
    v2.confirmed += plants.length + strictFound.length; v2.strictFound += strictFound.length;
    // Gaps over every plant the row now holds (confirmed and possible); each named by what its expected positions were.
    const holding = [...plants.map(p => ({ t: p.t })), ...strictFound.map(p => ({ t: p.t })), ...possible.map(p => ({ t: p.t }))].sort((u, w) => u.t - w.t);
    const gaps: RowCropGap[] = [];
    for (const [ta, tb] of gapsOf(holding)) {
      const [x1, y1] = toPhoto(ta, evalPoly(fit.c, fit.t0, ta)), [x2, y2] = toPhoto(tb, evalPoly(fit.c, fit.t0, tb));
      const nm = missing.filter(q => q.t > ta && q.t < tb).length, nu = uncertain.filter(q => q.t > ta && q.t < tb).length;
      gaps.push({ x1, y1, x2, y2, lengthM: r3((tb - ta) * gsdW), ...(E.recover ? { kind: nm > nu ? "supported missing" as const : "uncertain" as const } : {}) });
    }
    const line: [number, number][] = [];
    const stepT = E.sampleM / gsdW;
    for (let t = tA; t < tB; t += stepT) line.push(toPhoto(t, evalPoly(fit.c, fit.t0, t)));
    line.push(toPhoto(tB, evalPoly(fit.c, fit.t0, tB)));
    // Support: half-metre strips along the row with a plant of their own.
    const strips = Math.max(1, Math.ceil((tB - tA) / (0.5 / gsdW)));
    const held = new Set(plants.map(p => Math.min(strips - 1, Math.floor((p.t - tA) / (0.5 / gsdW)))));
    let greenPx = 0; for (const i of mine) { greenPx += points[i].n; plantPx.push(points[i].n); }
    const lengthM = (tB - tA) * gsdW;
    kept.push({ ...fit, tLo: tA, tHi: tB });
    plantsTotal += plants.length + strictFound.length; gapsN += gaps.length; gapLen += gaps.reduce((u, g) => u + g.lengthM, 0);
    rowsOut.push({
      id: rowsOut.length, k: fit.k - fits[0].k, points: line, lengthM: r3(lengthM), supportShare: r3(held.size / strips),
      bandHalfWidthM: E.bandHalfM, greenShare: r3(lengthM > 0 ? (greenPx * gsdW * gsdW) / (lengthM * 2 * E.bandHalfM) : 0),
      gaps, plants: plants.length + strictFound.length, plantPoints: [...plants.map(p => toPhoto(p.t, p.s)), ...strictFound.map(p => toPhoto(p.t, p.s))],
      ...(E.recover ? {
        possiblePoints: possible.map(p => toPhoto(p.t, p.s)), uncertainPoints: uncertain.map(p => toPhoto(p.t, p.s)), missingPoints: missing.map(p => toPhoto(p.t, p.s)),
      } : {}),
    });
  }

  // The stand's own seedlings, for judging what is off the rows against them.
  const plantSorted = [...plantPx].sort((a, b) => a - b), cm2 = (n: number) => r3(n * gsdW * gsdW * 1e4);
  const seedlingAreaCm2 = plantSorted.length >= 20 ? { p50: cm2(plantSorted[plantSorted.length >> 1]), p90: cm2(plantSorted[Math.floor(0.9 * (plantSorted.length - 1))]) } : null;

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
  let specks = 0, noRows = 0, weedArea = 0, cropComponents = 0, laterGreen = 0, vergeGreen = 0, smallGreen = 0, edgeSmall = 0, touchRow = 0, notGreen = 0;
  /** A component's colour over its mask pixels at the photo's own pixel: mean G - R and the share clearly green against its soil. */
  const colourOf = (c: Comp) => {
    let n = 0, gr = 0, strong = 0;
    for (const p of c.px) {
      const wx = p % W, wy = (p - wx) / W;
      for (let yy = wy * f; yy < wy * f + f && yy < px.height; yy++) for (let xx = wx * f; xx < wx * f + f && xx < px.width; xx++) {
        const i = yy * px.width + xx; if (!seedFull[i]) continue;
        const o = i * 4, b = Math.floor(yy / levels.B) * levels.gw + Math.floor(xx / levels.B);
        n++; gr += px.rgba[o + 1] - px.rgba[o];
        if (px.rgba[o + 1] - (px.rgba[o] + px.rgba[o + 2]) / 2 - levels.soilT[b] > SEEDLING_GREEN.strongTint) strong++;
      }
    }
    return { gr: n ? gr / n : 0, strong: n ? strong / n : 0 };
  };
  /** The nearest any pixel of a component comes to a kept row's line, work pixels. */
  const minDistToRow = (c: Comp) => {
    let best = Infinity;
    for (const p of c.px) { const x = p % W, y = (p - x) / W, t = T(x, y), sv0 = S(x, y); for (const k of kept) { if (t < k.tLo - pitchPx || t > k.tHi + pitchPx) continue; best = Math.min(best, Math.abs(sv0 - evalPoly(k.c, k.t0, t))); } }
    return best;
  };
  // Distance to left-out solid green (verge, lawn), work pixels, by a two-pass chamfer; and the rows' ends inside the photo.
  const edgePx = E.edgeZoneM / gsdW;
  let vergeDist: Float32Array | null = null;
  if (E.tierBySeedlings && solidPx) {
    vergeDist = new Float32Array(W * H).fill(1e9);
    for (let i = 0; i < W * H; i++) if (skip[i]) vergeDist[i] = 0;
    const D = Math.SQRT2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; let v = vergeDist[i]; if (x) v = Math.min(v, vergeDist[i - 1] + 1); if (y) { v = Math.min(v, vergeDist[i - W] + 1); if (x) v = Math.min(v, vergeDist[i - W - 1] + D); if (x < W - 1) v = Math.min(v, vergeDist[i - W + 1] + D); } vergeDist[i] = v; }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; let v = vergeDist[i]; if (x < W - 1) v = Math.min(v, vergeDist[i + 1] + 1); if (y < H - 1) { v = Math.min(v, vergeDist[i + W] + 1); if (x < W - 1) v = Math.min(v, vergeDist[i + W + 1] + D); if (x) v = Math.min(v, vergeDist[i + W - 1] + D); } vergeDist[i] = v; }
  }
  const inFrame = (t: number, s: number) => { const [x, y] = toPhoto(t, s); return x > 0.03 * px.width && x < 0.97 * px.width && y > 0.03 * px.height && y < 0.97 * px.height; };
  /** Within edgeZoneM of the field's edge: left-out solid green, or the end of a nearby row that stops inside the photo. */
  const atFieldEdge = (c: Comp, t: number, s: number) => {
    if (vergeDist && vergeDist[Math.min(H - 1, Math.round(c.y)) * W + Math.min(W - 1, Math.round(c.x))] <= edgePx) return true;
    for (const k of kept) {
      if (Math.abs(s - evalPoly(k.c, k.t0, t)) > pitchPx) continue;
      if (t > k.tHi - edgePx && inFrame(k.tHi, evalPoly(k.c, k.t0, k.tHi))) return true;
      if (t < k.tLo + edgePx && inFrame(k.tLo, evalPoly(k.c, k.t0, k.tLo))) return true;
    }
    return false;
  };
  const minWeedPx = (E.minWeedCm2 / 1e4) / (gsdW * gsdW);
  for (const c of comps) {
    const pi = compIndex.get(c);
    if (pi != null && owner[pi] >= 0 && kept.some(k => k.members.includes(pi))) { cropComponents++; continue; }
    const t = T(c.x, c.y), s = S(c.x, c.y), nr = nearestRow(t, s);
    if (nr.d * gsdW <= E.bandHalfM) { cropComponents++; continue; }
    if (laterGround.some(g => s >= g.sLo && s <= g.sHi)) { laterGreen++; continue; } // the later planting's ground
    // Near a verge (the coarse zone the fine edge opened up): green that is part of the grass's fringe is not judged,
    // nor anything past the rows' ends (the headland's stubble strip); only a patch on soil within the rows' length is.
    if (grown[Math.floor(c.y / cell) * cw + Math.floor(c.x / cell)] && (fineNb(Math.floor(c.x / fcell), Math.floor(c.y / fcell)) > E.soilGreenMax || !(kept.some(k => t >= k.tLo - 0.1 / gsdW && t <= k.tHi + 0.1 / gsdW && Math.abs(s - evalPoly(k.c, k.t0, t)) < pitchPx)))) { vergeGreen++; continue; } // ... and past the rows' ends toward a verge is headland, not field
    if (c.n < minWeedPx) { specks++; continue; }
    const hullPts: [number, number][] = c.px.map(p => { const x = p % W, y = (p - x) / W; return [x * f + (f - 1) / 2, y * f + (f - 1) / 2] as [number, number]; });
    const areaM2 = c.n * gsdW * gsdW;
    const status = kept.length && nr.inside && nr.d < pitchPx ? "between rows" : "no rows here";
    // Where no row was read (past every row's end, out beyond the outermost row) nothing is judged, as at establishment:
    // the validation's wrong calls there were the frame rim's own corn.
    if (status === "no rows here") { noRows++; continue; }
    const col = E.tierBySeedlings ? colourOf(c) : null;
    // Not green in its own colour: straw, residue or soil, never a plant.
    if (col && col.gr <= E.minGreenOverRed) { notGreen++; continue; }
    // Touching the row's band: the crop's own leaf, unless clearly green and much larger than the crop's seedlings.
    if (E.touchRowIsCrop && seedlingAreaCm2 && minDistToRow(c) * gsdW <= E.bandHalfM && !(areaM2 * 1e4 > E.touchRowFactor * seedlingAreaCm2.p90 && col && col.strong >= E.edgeMinStrongShare)) { cropComponents++; touchRow++; continue; }
    const edge = !!seedlingAreaCm2 && E.tierBySeedlings && atFieldEdge(c, t, s), need = seedlingAreaCm2 ? (edge ? E.edgeFactor : 1) * seedlingAreaCm2.p90 : 0;
    const greenEnough = !edge || !col || (col.gr >= E.edgeMinGreenOverRed && col.strong >= E.edgeMinStrongShare);
    const tier = E.tierBySeedlings && seedlingAreaCm2 ? (areaM2 * 1e4 > need && greenEnough ? "larger than the crop" as const : "small green" as const) : undefined;
    if (edge && tier === "small green" && areaM2 * 1e4 > seedlingAreaCm2!.p90) edgeSmall++;
    if (tier === "small green") smallGreen++; else weedArea += areaM2;
    weeds.push({ ...(tier ? { tier } : {}),
      id: weeds.length, x: r3(c.x * f), y: r3(c.y * f), areaM2: r3(areaM2), equivDiameterM: r3(2 * Math.sqrt(areaM2 / Math.PI)), hull: convexHull(hullPts),
      distToRowM: Number.isFinite(nr.d) ? r3(nr.d * gsdW) : null, bandHalfWidthM: E.bandHalfM,
      touchesEdge: c.px.some(p => { const x = p % W, y = (p - x) / W; return x === 0 || y === 0 || x === W - 1 || y === H - 1; }), status,
    });
  }

  // Solid green as excluded patches: runs of cells per cell row, stacked while they keep the same span (rectangles,
  // so an L-shaped verge is not drawn as one triangle across the field).
  const excluded: RowCropExcluded[] = [];
  for (const g of laterGround) {
    const ring: [number, number][] = [], N = 24;
    const inPhoto = ([x, y]: [number, number]): [number, number] => [Math.min(px.width, Math.max(0, x)), Math.min(px.height, Math.max(0, y))];
    for (let q = 0; q <= N; q++) ring.push(inPhoto(toPhoto(g.tLo + ((g.tHi - g.tLo) * q) / N, g.sLo)));
    for (let q = 0; q <= N; q++) ring.push(inPhoto(toPhoto(g.tHi - ((g.tHi - g.tLo) * q) / N, g.sHi)));
    excluded.push({ hull: ring, areaM2: r3((g.tHi - g.tLo) * (g.sHi - g.sLo) * gsdW * gsdW), reason: "a later planting just emerging: its rows are too faint to place, nothing here is judged" });
  }
  let open = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
  const close = (r: { x0: number; x1: number; y0: number; y1: number }) => {
    const X0 = r.x0 * fcell * f, X1 = Math.min(W, r.x1 * fcell) * f, Y0 = r.y0 * fcell * f, Y1 = Math.min(H, r.y1 * fcell) * f;
    excluded.push({ hull: [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]], areaM2: r3(((X1 - X0) / f) * ((Y1 - Y0) / f) * gsdW * gsdW), reason: "solid green: a verge, a lawn or a hedge, not seedlings" });
  };
  for (let cy = 0; cy <= fh; cy++) {
    const next = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
    if (cy < fh) for (let cx = 0; cx < fw;) {
      if (!fgrown[cy * fw + cx]) { cx++; continue; }
      let ex = cx; while (ex < fw && fgrown[cy * fw + ex]) ex++;
      const key = `${cx}:${ex}`, prev = open.get(key);
      if (prev) { prev.y1 = cy + 1; next.set(key, prev); open.delete(key); } else next.set(key, { x0: cx, x1: ex, y0: cy, y1: cy + 1 });
      cx = ex;
    }
    for (const r of open.values()) close(r);
    open = next;
  }

  notes.push(`Emergence: every seedling is a point, a row is the line the points stand on; ${plantsTotal.toLocaleString()} plants on ${rowsOut.length} rows (seedling pieces within ${Math.round(E.plantMergeM * 100)} cm along a row counted as one plant). The count is from the photo and has not been checked against plants counted on the ground.`);
  if (gapsN) notes.push(`${gapsN} gap${gapsN === 1 ? "" : "s"} along the rows (${gapLen.toFixed(1)} m in all): stretches with no plant found longer than ${E.gapSpacings} x the row's own plant spacing (at least ${Math.round(E.gapMinM * 100)} cm). A gap is where no seedling was seen, not yet a confirmed skip: pale seedlings in the dim corners of the frame are missed, so gaps there run long.`);
  if (vergeGreen) notes.push(`${vergeGreen} green patch${vergeGreen === 1 ? "" : "es"} at the edge of the verge (the grass's fringe, or past the rows' ends on the headland), not judged.`);
  const bigN = weeds.length - smallGreen;
  if (seedlingAreaCm2 && E.tierBySeedlings) {
    if (bigN) notes.push(`${bigN} green patch${bigN === 1 ? "" : "es"} off the rows larger than nearly all the crop's own seedlings (over ${seedlingAreaCm2.p90.toFixed(0)} cm², their 90th percentile here): weed candidates, the plants already out-growing the corn.`);
    if (smallGreen) notes.push(`${smallGreen} smaller green patch${smallGreen === 1 ? "" : "es"} off the rows, counted apart and not called weeds: at this pixel a tiny weed, a seedling just off the line, a leaf piece or a green fleck in the stubble look alike.`);
    if (notGreen) notes.push(`${notGreen} patch${notGreen === 1 ? "" : "es"} off the rows passed the seedling test against the soil beside ${notGreen === 1 ? "it" : "them"} but ${notGreen === 1 ? "is" : "are"} not green in ${notGreen === 1 ? "its" : "their"} own colour (no more green than red: straw, residue or soil) and ${notGreen === 1 ? "is" : "are"} not counted.`);
    if (touchRow) notes.push(`${touchRow} patch${touchRow === 1 ? "" : "es"} touching a row's band counted as the crop's own leaves, not weeds.`);
    if (edgeSmall) notes.push(`${edgeSmall} of them within ${E.edgeZoneM} m of the field's edge (the verge or the headland), where a patch must be ${E.edgeFactor} times the crop's large seedlings to be called a weed: stubble and grass at the edge look like small weeds.`);
  } else if (weeds.length) notes.push(`${weeds.length} green patch${weeds.length === 1 ? "" : "es"} off the rows: on soil this young, anything green off the planter's line is a weed candidate or a volunteer.`);
  if (v2.endStrict + v2.endPossible) notes.push(`Rows followed on past their last clear seedling to the frame or the field's edge: ${v2.endStrict} more plants clear, ${v2.endPossible} possible (the frame's dim rim hides seedlings from the strict test).`);
  // Row spacing and direction, for the read's own consistency: the main rows' neighbouring spacings at their common middle.
  const mainRows = kept.filter(k => k.comb === 0);
  const tMid0 = median(mainRows.map(k => (k.tLo + k.tHi) / 2)) ?? 0;
  const atMid = mainRows.filter(k => k.tLo <= tMid0 && k.tHi >= tMid0).map(k => evalPoly(k.c, k.t0, tMid0)).sort((a, b) => a - b);
  const spacings = atMid.slice(1).map((v, i) => v - atMid[i]).filter(d => d < 1.5 * pitchPx);
  const spMean = spacings.length ? spacings.reduce((u, v) => u + v, 0) / spacings.length : 0;
  const spCv = spacings.length > 1 && spMean > 0 ? Math.sqrt(spacings.reduce((u, v) => u + (v - spMean) ** 2, 0) / spacings.length) / spMean : null;
  const emergence: EmergenceV2 = {
    laterPlanting: laterGround.length ? { greenPatches: laterGreen } : null, confirmed: v2.confirmed, strictFound: v2.strictFound, possible: v2.possible, uncertain: v2.uncertain, missing: v2.missing, searched: v2.searched,
    controlRate: v2.controlWindows ? r3(v2.controlHits / v2.controlWindows) : null,
    gapsBefore: v2.gapsV1, gapLengthBeforeM: r3(v2.gapLenV1),
    rowSpacingM: spacings.length ? r3(spMean * gsdW) : null, rowSpacingCv: spCv == null ? null : r3(spCv), lensK1: r3(k1), seedlingAreaCm2, smallGreen, rowEndsFollowed: { strict: v2.endStrict, possible: v2.endPossible },
  };
  if (E.recover && v2.searched) notes.push(`Along the rows ${v2.searched.toLocaleString()} expected plant positions in the long stretches were looked at again more sensitively: ${v2.possible.toLocaleString()} possible seedlings (weak evidence on the planter's line), ${v2.missing.toLocaleString()} missing plants the photo supports (good light, a quiet alley beside, nothing there), ${v2.uncertain.toLocaleString()} uncertain (dim, at the rim, or soil that fools the test). A possible seedling is not a confirmed plant; a missing plant is what the photo shows, not yet a counted skip.`);
  opts.onProgress?.(1, 1);
  return {
    version: ROW_CROP_READ_VERSION, stage: "emergence", width: px.width, height: px.height, gsdM, scaleBasis: given ? "given" : "assumed spacing", workFactor: f,
    directionDeg: r3((alpha * 180) / Math.PI), pitchM: r3(pitchM), matchedSpacingM: matched,
    rows: rowsOut, weeds, excluded, seedlings: null, emergence,
    summary: {
      rows: rowsOut.length, rowsDropped, totalRowLengthM: r3(rowsOut.reduce((u, r) => u + r.lengthM, 0)),
      medianBandHalfWidthM: rowsOut.length ? E.bandHalfM : null, medianRowGreenShare: median(rowsOut.map(r => r.greenShare)),
      weeds: weeds.length - smallGreen, weedAreaM2: r3(weedArea), betweenRowCover: null, cropComponents, noRowsPatches: noRows, leafTips: 0, specks,
      gaps: gapsN, gapLengthM: r3(gapLen), plants: plantsTotal, coherence: r3(coherence), vegetationFraction: r3(veg), ms: Date.now() - t0,
    },
    notes, crop: P.crop,
  };
}

function checkStop(opts: RowCropOptions) { if (opts.signal?.aborted) throw new Error("cancelled"); }
