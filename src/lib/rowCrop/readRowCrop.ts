// Continuous-row crops (corn first): the rows are traced on the green itself, the whole row is the crop, and only
// green standing clear of every row band is a weed candidate.
//
// Why a reader of its own. The planting-pattern pass (photoScout/pattern.ts) was built for plants on a lattice: trees
// and vines at a spacing along rows, where a green blob at no lattice position is the finding. Corn is not that. From
// about V4 the plants of a row merge into one ragged line of leaves, the leaves reach a third of the way into the
// alley, and every one of them is crop. Read as a lattice, a corn row becomes hundreds of "off-row" circles; read by
// brightness, the lines land on the straw stripe between the rows. Here nothing on a row is ever a finding, phase is
// taken from the green only (never from brightness, so never from straw), and each row is a polyline traced strip by
// strip so that lens distortion and planter drift do not pull a straight line off the row at the frame's edges.
//
// Steps, each a function below: work raster (about 1 cm a pixel) -> soil-relative ExGR green mask -> row direction
// (projection variance) -> pitch (autocorrelation, checked against the crop's planted spacings, never assumed) ->
// strips half a metre long along the rows, the green peaks across each strip settled on the strip's lattice and
// chained strip to strip into rows -> a crop band per row from the row's own green -> green components: on a band
// they are crop, clear of every band they are weed candidates -> gaps along each row, and (fine pixels only) a stand
// estimate from the green peaks along the row.
//
// Scale. With a known pixel size the pitch is measured and compared with the planted spacings. Without one (no EXIF)
// the pitch in pixels gives the scale from the profile's default spacing, and the result says so: every metre in it
// then rests on that assumption.
import { type GreenOptions, GREEN_DEFAULTS, greenMaskWithExcess } from "../directGeoref/green";
import type { PhotoPixels } from "../photoScout/pattern";

export const ROW_CROP_READ_VERSION = 1;

/** Target pixel size of the work raster, metres. Corn leaves are 2 cm and wider; finer buys nothing here. */
export const WORK_GSD_M = 0.01;
/** Strip length along the rows, metres. */
export const STRIP_M = 0.5;
/** Gaps along a row shorter than this are not reported, metres. */
export const MIN_GAP_M = 0.3;
/** A row must stand on green in at least this many strips, and this share of its span. */
export const MIN_ROW_STRIPS = 3;
export const MIN_ROW_SUPPORT_SHARE = 0.3;
/** Each row is carried this many strips past its last green for judging nearby patches (a row leaves the frame, it does not stop). */
export const END_EXTRAPOLATION_STRIPS = 2;
/** A row absent from more strips than this is ended (and may start again as another row). */
export const MAX_BRIDGE_STRIPS = 6;
/** Band half-width bounds as shares of the pitch. */
export const BAND_MIN_SHARE = 0.1;
export const BAND_MAX_SHARE = 0.45;
/** Vegetation between rows wider across than this many pitches is a border or cover, not a weed. */
export const BORDER_ACROSS_PITCHES = 1.5;
/** Vegetation between rows over this area is reported apart from the weeds, square metres. */
export const LARGE_PATCH_M2 = 1.0;
/** A strip peak must carry at least this many times the green of its alleys to be a row. */
export const PEAK_OVER_ALLEY = 3;
/** Green components under this area must stand clearly above their soil (mean excess over the margin) to count. */
export const SMALL_PATCH_CM2 = 50;
export const SMALL_PATCH_EXCESS = 0.1;
/** The band ends where the row's green density has fallen this close to the alley's floor: the tails of the leaves. */
export const BAND_FALL_SHARE = 0.1;
/** A patch no larger than this, within half a band beyond the band, elongated and pointing at the row, is a leaf tip. */
export const LEAF_TIP_MAX_CM2 = 80;
export const LEAF_TIP_REACH_SHARE = 0.6;
export const LEAF_TIP_ASPECT = 1.8;
export const LEAF_TIP_ANGLE_DEG = 40;

export type RowCropParams = {
  /** Metres per pixel of the photo, or null when unknown. */
  gsdM: number | null;
  /** The crop's planted row spacings, metres, preferred when the measured pitch is within the tolerance of one. */
  spacingsM: number[];
  /** The spacing assumed for the scale when the pixel size is unknown. */
  defaultSpacingM: number;
  pitchToleranceShare: number;
  /** Half-width floor of a row's crop band, metres (a V2 row is a thin line). */
  bandMinHalfWidthM: number;
  /** Typical seed spacing along the row, metres; null disables gaps by spacing and the stand estimate. */
  seedSpacingM: number | null;
  /** The stand is estimated only when the work pixel is at most this, centimetres. */
  maxStandGsdCm: number;
  /** Green components under this area are specks, square centimetres. */
  minWeedAreaCm2: number;
  crop: { id: string; version: string } | null;
};

export const DEFAULT_ROW_CROP_PARAMS: RowCropParams = {
  gsdM: null, spacingsM: [0.381, 0.508, 0.70, 0.762, 0.914], defaultSpacingM: 0.762, pitchToleranceShare: 0.08,
  bandMinHalfWidthM: 0.08, seedSpacingM: 0.16, maxStandGsdCm: 1.5, minWeedAreaCm2: 4, crop: null,
};

export type RowCropGap = { x1: number; y1: number; x2: number; y2: number; lengthM: number };

export type RowCropRow = {
  id: number;
  /** Lattice index across the field (0 at the first row seen; consecutive rows differ by one). */
  k: number;
  /** Centreline, photo pixels, one point per strip from the first to the last strip with green. */
  points: [number, number][];
  lengthM: number;
  /** Share of the row's strips that stand on green of their own (the rest are bridged). */
  supportShare: number;
  bandHalfWidthM: number;
  /** Green pixels within the band over the band's area. */
  greenShare: number;
  gaps: RowCropGap[];
  /** Plants estimated from the green peaks along the row, or null when the pixel is too coarse. Unverified. */
  plants: number | null;
  plantPoints: [number, number][] | null;
};

export type RowCropWeedStatus = "between rows" | "no rows here";

export type RowCropWeed = {
  id: number;
  x: number;
  y: number;
  areaM2: number;
  equivDiameterM: number;
  /** Convex outline, photo pixels. */
  hull: [number, number][];
  /** Nearest distance from the patch to a row centreline, metres (null with no rows in reach). */
  distToRowM: number | null;
  /** The band of the nearest row at that point, metres. */
  bandHalfWidthM: number | null;
  touchesEdge: boolean;
  status: RowCropWeedStatus;
};

export type RowCropExcluded = { hull: [number, number][]; areaM2: number; reason: string };

export type RowCropSummary = {
  rows: number;
  rowsDropped: number;
  totalRowLengthM: number;
  medianBandHalfWidthM: number | null;
  medianRowGreenShare: number | null;
  weeds: number;
  weedAreaM2: number;
  /** Green area between the bands over the between-band area, the field's weed cover. */
  betweenRowCover: number | null;
  cropComponents: number;
  /** Green patches where no rows were read (a border, a headland): not judged. */
  noRowsPatches: number;
  /** Small patches just beyond a band, elongated toward the row, counted as the crop (a leaf tip cut off by shadow). */
  leafTips: number;
  specks: number;
  gaps: number;
  gapLengthM: number;
  plants: number | null;
  /** Mean autocorrelation at the pitch over 3 m windows with green: how row-like the field reads. */
  coherence: number | null;
  vegetationFraction: number;
  ms: number;
};

export type RowCropRead = {
  version: number;
  width: number;
  height: number;
  /** Metres per photo pixel used by every metre in this read. */
  gsdM: number;
  scaleBasis: "given" | "assumed spacing";
  workFactor: number;
  /** Row direction in the photo, degrees counterclockwise from +x in image coordinates (y down), [0, 180). */
  directionDeg: number | null;
  pitchM: number | null;
  /** The planted spacing the pitch matched, or null when none did (the measured pitch stands). */
  matchedSpacingM: number | null;
  rows: RowCropRow[];
  weeds: RowCropWeed[];
  excluded: RowCropExcluded[];
  summary: RowCropSummary;
  notes: string[];
  crop: { id: string; version: string } | null;
};

type Work = { W: number; H: number; rgba: Uint8ClampedArray };

/** Box-average downsample by an integer factor. */
export function downsample(px: PhotoPixels, f: number): Work {
  if (f <= 1) return { W: px.width, H: px.height, rgba: px.rgba };
  const W = Math.floor(px.width / f), H = Math.floor(px.height / f);
  const out = new Uint8ClampedArray(W * H * 4);
  const n = f * f;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let yy = 0; yy < f; yy++) { let o = ((y * f + yy) * px.width + x * f) * 4; for (let xx = 0; xx < f; xx++, o += 4) { r += px.rgba[o]; g += px.rgba[o + 1]; b += px.rgba[o + 2]; } }
    const q = (y * W + x) * 4; out[q] = r / n; out[q + 1] = g / n; out[q + 2] = b / n; out[q + 3] = 255;
  }
  return { W, H, rgba: out };
}

const quantile = (xs: number[], q: number): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Green density on a coarse grid, and where it is saturated: cells whose neighbourhood (radius `R` cells) is more than
 * SATURATED_SHARE green are a lawn, a hedge or a closed canopy, not rows, and are left out of the direction, the
 * pitch and the tracing. The density returned is high-passed (the neighbourhood mean removed) so that a bright field
 * next to a dark road does not swamp the row periodicity.
 */
export const SATURATED_SHARE = 0.45;
export function coarseDensity(mask: Uint8Array, W: number, H: number, coarse: number, R: number): { d: Float32Array; sat: Uint8Array; w: number; h: number; satShare: number } {
  const w = Math.max(1, Math.floor(W / coarse)), h = Math.max(1, Math.floor(H / coarse));
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let n = 0; for (let yy = 0; yy < coarse; yy++) for (let xx = 0; xx < coarse; xx++) n += mask[(y * coarse + yy) * W + x * coarse + xx]; d[y * w + x] = n / (coarse * coarse); }
  // Box mean over (2R+1)^2 cells through a summed-area table.
  const sat = new Uint8Array(w * h), hp = new Float32Array(w * h);
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) S[(y + 1) * (w + 1) + x + 1] = d[y * w + x] + S[y * (w + 1) + x + 1] + S[(y + 1) * (w + 1) + x] - S[y * (w + 1) + x];
  let satN = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - R), x1 = Math.min(w - 1, x + R), y0 = Math.max(0, y - R), y1 = Math.min(h - 1, y + R);
    const m = (S[(y1 + 1) * (w + 1) + x1 + 1] - S[y0 * (w + 1) + x1 + 1] - S[(y1 + 1) * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / ((x1 - x0 + 1) * (y1 - y0 + 1));
    if (m > SATURATED_SHARE) { sat[y * w + x] = 1; satN++; hp[y * w + x] = 0; } else hp[y * w + x] = d[y * w + x] - m;
  }
  return { d: hp, sat, w, h, satShare: satN / (w * h) };
}

/** Projection of a density raster along the axis at `alpha`, detrended; its periodicity: the strongest autocorrelation between the lags, times the profile's standard deviation. */
function periodicity(d: Float32Array, W: number, H: number, alpha: number, minLag: number, maxLag: number): number {
  const c = Math.cos(alpha), s = Math.sin(alpha), D = Math.ceil(Math.hypot(W, H));
  const bins = new Float64Array(2 * D + 2), counts = new Int32Array(2 * D + 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const b = Math.round(x * c + y * s) + D; bins[b] += d[y * W + x]; counts[b]++; }
  let lo = -1, hi = -1; for (let b = 0; b < bins.length; b++) if (counts[b] > 0) { if (lo < 0) lo = b; hi = b; bins[b] /= counts[b]; }
  if (hi - lo < 4 * minLag) return 0;
  const p = boxSmooth(bins.slice(lo, hi + 1), Math.round(maxLag));
  const q = new Float64Array(hi - lo + 1); for (let i = 0; i < q.length; i++) q[i] = bins[lo + i] - p[i];
  let m = 0; for (const v of q) m += v; m /= q.length;
  const ac = (lag: number) => { let a = 0; for (let i = 0; i + lag < q.length; i++) a += (q[i] - m) * (q[i + lag] - m); return a / Math.max(1, q.length - lag); };
  const a0 = ac(0); if (!(a0 > 0)) return 0;
  let best = 0; for (let lag = Math.max(2, Math.round(minLag)); lag <= Math.min(q.length / 3, maxLag); lag++) best = Math.max(best, ac(lag) / a0);
  // The periodicity itself, weighted by the profile's spread so an empty direction cannot win on noise alone; a sparse
  // V2 stand has little variance in any direction but a clear comb across its rows.
  return best * Math.sqrt(a0);
}

/** The row direction: the axis whose projection of the density is most periodic is across the rows. Lags in cells. Returns the row angle, radians. */
export function rowDirection(d: Float32Array, w: number, h: number, minLag: number, maxLag: number): number {
  let best = 0, bv = -1;
  for (let deg = 0; deg < 180; deg += 1) { const v = periodicity(d, w, h, (deg * Math.PI) / 180, minLag, maxLag); if (v > bv) { bv = v; best = deg; } }
  let fine = best;
  for (let t = best - 1.5; t <= best + 1.5; t += 0.1) { const v = periodicity(d, w, h, (t * Math.PI) / 180, minLag, maxLag); if (v > bv) { bv = v; fine = t; } }
  // The projection axis is across the rows; the rows run perpendicular to it.
  return ((((fine + 90) % 180) + 180) % 180) * (Math.PI / 180);
}

/** Across-row profile of the mask at the row angle, one bin per pixel, without the saturated pixels, detrended over `trendR` bins. */
function acrossProfile(mask: Uint8Array, skip: Uint8Array, W: number, H: number, rowAngle: number, trendR: number): { profile: Float64Array; aMin: number } {
  const sn = -Math.sin(rowAngle), cs = Math.cos(rowAngle);
  const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => x * sn + y * cs);
  const aMin = Math.floor(Math.min(...corners)), aMax = Math.ceil(Math.max(...corners));
  const profile = new Float64Array(aMax - aMin + 2), counts = new Int32Array(aMax - aMin + 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (skip[i]) continue; const b = Math.round(x * sn + y * cs) - aMin; counts[b]++; if (mask[i]) profile[b]++; }
  for (let b = 0; b < profile.length; b++) if (counts[b]) profile[b] /= counts[b];
  const trend = boxSmooth(profile, trendR);
  for (let b = 0; b < profile.length; b++) profile[b] = counts[b] ? Math.max(0, profile[b] - trend[b]) : 0;
  return { profile, aMin };
}

/**
 * The pitch from the across profile's autocorrelation between minLag and maxLag, pixels; null when none. Every local
 * maximum at least half the strongest is a candidate. With `prefer` (planted spacings in pixels, and a tolerance share)
 * the strongest candidate near a planted spacing wins; otherwise the strongest, unless a candidate at a half or a
 * third of its lag is nearly as strong (the fundamental under a harmonic).
 */
export function pitchFromProfile(profile: Float64Array, minLag: number, maxLag: number, prefer?: { lagsPx: number[]; tolerance: number }): number | null {
  const n = profile.length;
  let m = 0, cnt = 0; for (let i = 0; i < n; i++) if (profile[i] > 0) { m += profile[i]; cnt++; }
  if (cnt < 10) return null;
  m /= cnt;
  const ac = (lag: number) => { let a = 0; for (let i = 0; i + lag < n; i++) a += (profile[i] - m) * (profile[i + lag] - m); return a / Math.max(1, n - lag); };
  const a0 = ac(0);
  if (!(a0 > 0)) return null;
  const lo = Math.max(2, Math.floor(minLag)), hi = Math.max(lo + 2, Math.floor(maxLag));
  const vals = new Float64Array(hi + 2);
  for (let lag = lo - 1; lag <= hi + 1; lag++) vals[lag] = ac(lag) / a0;
  let gmax = -1; for (let lag = lo; lag <= hi; lag++) if (vals[lag] > gmax) gmax = vals[lag];
  if (gmax < 0.1) return null;
  const cands: { lag: number; v: number }[] = [];
  for (let lag = lo; lag <= hi; lag++) {
    if (vals[lag] > vals[lag - 1] && vals[lag] >= vals[lag + 1] && vals[lag] >= 0.5 * gmax) {
      const d = (vals[lag - 1] - vals[lag + 1]) / (2 * (vals[lag - 1] - 2 * vals[lag] + vals[lag + 1]) || 1);
      cands.push({ lag: lag + (Number.isFinite(d) ? Math.max(-0.5, Math.min(0.5, d)) : 0), v: vals[lag] });
    }
  }
  if (!cands.length) return null;
  if (prefer) {
    const near = cands.filter(c => prefer.lagsPx.some(L => Math.abs(c.lag - L) / L <= prefer.tolerance)).sort((a, b) => b.v - a.v);
    if (near.length) return near[0].lag;
  }
  // The harmonics of a comb are all about as strong as its fundamental; the fundamental is the shortest of them.
  const vmax = Math.max(...cands.map(c => c.v));
  return cands.filter(c => c.v >= 0.8 * vmax).reduce((a, b) => (b.lag < a.lag ? b : a)).lag;
}

type StripPeak = { a: number; mass: number };
type RowTrack = { k: number; pts: Map<number, { a: number; mass: number; support: boolean }>; lastStrip: number; lastA: number };

/** Local maxima of a smoothed strip profile, at least `minSep` apart, with at least `minMass`. */
function peaks(profile: Float64Array, minSep: number, minMass: number): StripPeak[] {
  const out: StripPeak[] = [];
  for (let i = 1; i + 1 < profile.length; i++) {
    if (profile[i] < minMass || profile[i] < profile[i - 1] || profile[i] < profile[i + 1]) continue;
    if (out.length && i - out[out.length - 1].a < minSep) { if (profile[i] > out[out.length - 1].mass) out[out.length - 1] = { a: i, mass: profile[i] }; continue; }
    out.push({ a: i, mass: profile[i] });
  }
  return out;
}

function boxSmooth(src: Float64Array, r: number): Float64Array {
  const n = src.length, out = new Float64Array(n), pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src[i];
  for (let i = 0; i < n; i++) { const lo = Math.max(0, i - r), hi = Math.min(n - 1, i + r); out[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1); }
  return out;
}

/** Phase of a set of peaks against a lattice of pitch P: the mass-weighted circular mean of (a mod P). */
function latticePhase(ps: StripPeak[], P: number): number {
  let sx = 0, sy = 0;
  for (const p of ps) { const t = ((p.a % P) / P) * 2 * Math.PI; sx += p.mass * Math.cos(t); sy += p.mass * Math.sin(t); }
  const t = Math.atan2(sy, sx);
  return (((t / (2 * Math.PI)) * P) % P + P) % P;
}

export type RowCropOptions = { onProgress?: (done: number, total: number) => void; signal?: AbortSignal; /** Diagnostic lines (the bench prints them). */ debug?: (line: string) => void };

/**
 * Read one photograph of a continuous-row crop. Coordinates in the result are photo pixels; metres rest on `gsdM`
 * (given, or assumed from the pitch and the default spacing when null).
 */
export function readRowCrop(px: PhotoPixels, params: Partial<RowCropParams> = {}, opts: RowCropOptions = {}): RowCropRead {
  const t0 = Date.now();
  const P: RowCropParams = { ...DEFAULT_ROW_CROP_PARAMS, ...params };
  const notes: string[] = [];
  const given = P.gsdM != null && P.gsdM > 0 ? P.gsdM : null;
  const f = given ? Math.max(1, Math.round(WORK_GSD_M / given)) : Math.max(1, Math.ceil(Math.max(px.width, px.height) / 2048));
  const work = downsample(px, f);
  const { W, H } = work;
  let gsdW = given ? given * f : NaN; // metres per work pixel; set from the pitch when the scale is assumed
  const empty = (gsdM: number, scaleBasis: RowCropRead["scaleBasis"], why: string, vegetationFraction: number): RowCropRead => ({
    version: ROW_CROP_READ_VERSION, width: px.width, height: px.height, gsdM, scaleBasis, workFactor: f, directionDeg: null, pitchM: null, matchedSpacingM: null, rows: [], weeds: [], excluded: [],
    summary: { rows: 0, rowsDropped: 0, totalRowLengthM: 0, medianBandHalfWidthM: null, medianRowGreenShare: null, weeds: 0, weedAreaM2: 0, betweenRowCover: null, cropComponents: 0, noRowsPatches: 0, leafTips: 0, specks: 0, gaps: 0, gapLengthM: 0, plants: null, coherence: null, vegetationFraction, ms: Date.now() - t0 },
    notes: [...notes, why], crop: P.crop,
  });

  // 1. Green, relative to the soil around it (straw and red soil stay out; a yellowing leaf still counts if it stands above its soil).
  const soilTilePx = given ? Math.max(16, Math.min(256, Math.round(0.64 / gsdW))) : 64;
  const gopts: GreenOptions = { ...GREEN_DEFAULTS, index: "exgr-soil", soilTilePx, cellPx: 1, soilCapAboveGlobal: 0.05 };
  const { mask, excess } = greenMaskWithExcess({ width: W, height: H, rgba: work.rgba }, gopts);
  let greenN = 0; for (let i = 0; i < W * H; i++) greenN += mask[i];
  const vegetationFraction = greenN / (W * H);
  if (vegetationFraction < 0.002) return empty(given ?? NaN, given ? "given" : "assumed spacing", "Almost no green in the photo: no rows to read.", vegetationFraction);

  // 2. Direction, on a coarse density raster (about 4 cm a cell when the scale is known), saturated green left out.
  const coarse = given ? Math.max(1, Math.round(0.04 / gsdW)) : Math.max(1, Math.round(Math.max(W, H) / 500));
  const satR = given ? Math.max(2, Math.round(0.75 / gsdW / coarse)) : Math.max(2, Math.round(Math.max(W, H) / coarse / 25));
  const cd = coarseDensity(mask, W, H, coarse, satR);
  // Per work pixel: inside a saturated cell (left out of the rows).
  const skip = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { const cy = Math.min(cd.h - 1, Math.floor(y / coarse)); for (let x = 0; x < W; x++) if (cd.sat[cy * cd.w + Math.min(cd.w - 1, Math.floor(x / coarse))]) skip[y * W + x] = 1; }
  if (cd.satShare > 0.02) notes.push(`${Math.round(cd.satShare * 100)}% of the photo is solid green (a border, a lawn or a closed canopy) and is left out of the rows.`);
  const minPitchM = 0.8 * Math.min(...P.spacingsM, P.defaultSpacingM);
  const rowAngle = rowDirection(cd.d, cd.w, cd.h, given ? minPitchM / gsdW / coarse : 2, given ? 2.0 / gsdW / coarse : Math.max(cd.w, cd.h) / 6);
  checkStop(opts);

  // 3. Pitch from the across profile's autocorrelation.
  const minLag = given ? minPitchM / gsdW : 8, maxLagRaw = given ? 2.0 / gsdW : Math.max(W, H) / 3;
  const { profile, aMin } = acrossProfile(mask, skip, W, H, rowAngle, Math.round(maxLagRaw));
  const maxLag = Math.min(profile.length / 3, maxLagRaw);
  const pitchPx = pitchFromProfile(profile, minLag, maxLag, given ? { lagsPx: P.spacingsM.map(m => m / gsdW), tolerance: P.pitchToleranceShare } : undefined);
  opts.debug?.(`direction ${((rowAngle * 180) / Math.PI).toFixed(1)} deg, pitch ${pitchPx == null ? "none" : pitchPx.toFixed(1)} work px, saturated ${(cd.satShare * 100).toFixed(1)}%`);
  if (pitchPx == null) return empty(given ?? NaN, given ? "given" : "assumed spacing", "No periodic rows across the green: the field may be bare, closed, or the photo may not show rows.", vegetationFraction);
  let matchedSpacingM: number | null = null;
  let scaleBasis: RowCropRead["scaleBasis"] = "given";
  if (given) {
    const pitchM = pitchPx * gsdW;
    const near = P.spacingsM.filter(s => Math.abs(s - pitchM) / s <= P.pitchToleranceShare).sort((a, b) => Math.abs(a - pitchM) - Math.abs(b - pitchM));
    matchedSpacingM = near[0] ?? null;
    if (!matchedSpacingM) notes.push(`The measured row pitch, ${(pitchM * 100).toFixed(1)} cm, matches no planted spacing of the crop; the measurement stands.`);
  } else {
    gsdW = P.defaultSpacingM / pitchPx;
    scaleBasis = "assumed spacing";
    notes.push(`No pixel size: the scale assumes a ${(P.defaultSpacingM * 100).toFixed(1)} cm row spacing, so every metre here rests on that.`);
  }
  const gsdM = gsdW / f;
  const pitchM = pitchPx * gsdW;
  const mPx = (m: number) => m / gsdW; // metres to work pixels

  // 4. Strips along the rows; the green peaks across each strip, settled on the strip's lattice, chained into rows.
  const cs = Math.cos(rowAngle), sn = Math.sin(rowAngle);
  const along = (x: number, y: number) => x * cs + y * sn, across = (x: number, y: number) => -x * sn + y * cs;
  const corners = [[0, 0], [W, 0], [0, H], [W, H]];
  const lMin = Math.floor(Math.min(...corners.map(([x, y]) => along(x, y)))), lMax = Math.ceil(Math.max(...corners.map(([x, y]) => along(x, y))));
  const stripPx = Math.max(8, Math.round(mPx(STRIP_M)));
  const nStrips = Math.ceil((lMax - lMin) / stripPx);
  const nA = profile.length;
  const stripProfiles: Float64Array[] = Array.from({ length: nStrips }, () => new Float64Array(nA));
  const stripCounts: Int32Array[] = Array.from({ length: nStrips }, () => new Int32Array(nA));
  // Per work pixel: its strip and across bin (kept for the band and the components).
  const pxStrip = new Int32Array(W * H), pxA = new Int32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, s = Math.min(nStrips - 1, Math.floor((along(x, y) - lMin) / stripPx)), b = Math.max(0, Math.min(nA - 1, Math.round(across(x, y)) - aMin));
    pxStrip[i] = s; pxA[i] = b; stripCounts[s][b]++; if (mask[i] && !skip[i]) stripProfiles[s][b]++;
  }
  const smoothR = Math.max(1, Math.round(Math.min(pitchPx / 8, mPx(0.04))));
  const minSep = Math.max(2, 0.5 * pitchPx);
  // Minimum mass for a peak: green along at least this share of the strip's length (a smoothed bin is an average of pixels across).
  const minPeakMass = 0.03 * stripPx;
  const tracks: RowTrack[] = [];
  let nextK = 0;
  for (let s = 0; s < nStrips; s++) {
    checkStop(opts);
    const pr = stripProfiles[s];
    // Bins the strip does not cover (outside the photo's rotated corners) stay zero.
    const sm = boxSmooth(pr, smoothR);
    // A row's peak stands over its alleys: the mean a quarter to half a pitch either side. A lawn's peaks do not.
    const alley = (a: number) => { let m = 0, n = 0; for (const sgn of [-1, 1]) for (let d = Math.round(pitchPx / 4); d <= Math.round(pitchPx / 2); d++) { const j = a + sgn * d; if (j >= 0 && j < sm.length) { m += sm[j]; n++; } } return n ? m / n : 0; };
    const ps = peaks(sm, minSep, minPeakMass).filter(p => p.mass >= PEAK_OVER_ALLEY * alley(p.a));
    if (ps.length) {
      const phase = latticePhase(ps, pitchPx);
      // Local pitch from the accepted peaks' spacings (lens distortion and drift change it by a few percent).
      const sorted = [...ps].sort((u, v) => u.a - v.a);
      const onLattice = (p: StripPeak) => Math.abs(((p.a - phase) % pitchPx + pitchPx * 1.5) % pitchPx - pitchPx / 2) <= pitchPx / 4;
      const chained = (i: number) => [i - 1, i + 1].some(j => j >= 0 && j < sorted.length && Math.abs(Math.abs(sorted[j].a - sorted[i].a) - pitchPx) <= 0.2 * pitchPx);
      const accRaw = sorted.filter((p, i) => onLattice(p) || chained(i));
      const acc: StripPeak[] = [];
      for (const p of accRaw) { const last = acc[acc.length - 1]; if (last && p.a - last.a < 0.75 * pitchPx) { if (p.mass > last.mass) acc[acc.length - 1] = p; } else acc.push(p); }
      let Ps = pitchPx;
      if (acc.length >= 3) {
        const diffs: number[] = [];
        for (let i = 1; i < acc.length; i++) { const d = acc[i].a - acc[i - 1].a, n = Math.round(d / pitchPx); if (n >= 1) diffs.push(d / n); }
        const med = quantile(diffs, 0.5);
        if (med != null) Ps = Math.max(0.9 * pitchPx, Math.min(1.1 * pitchPx, med));
      }
      // Assign accepted peaks to rows: a row seen within MAX_BRIDGE_STRIPS strips at a position within a third of a pitch.
      const assignedThisStrip: { k: number; a: number }[] = [];
      for (const p of acc.sort((u, v) => u.a - v.a)) {
        let best: RowTrack | null = null, bd = Ps / 3;
        for (const t of tracks) { if (s - t.lastStrip > MAX_BRIDGE_STRIPS || t.pts.has(s)) continue; const d = Math.abs(p.a - t.lastA); if (d < bd) { bd = d; best = t; } }
        if (!best) {
          // A new row: its index from the nearest row already placed in this strip, else from the last rows seen, else fresh.
          let k: number | null = null;
          if (assignedThisStrip.length) { const n = assignedThisStrip.reduce((u, v) => (Math.abs(v.a - p.a) < Math.abs(u.a - p.a) ? v : u)); k = n.k + Math.round((p.a - n.a) / Ps); }
          else { const recent = tracks.filter(t => s - t.lastStrip <= MAX_BRIDGE_STRIPS); if (recent.length) { const n = recent.reduce((u, v) => (Math.abs(v.lastA - p.a) < Math.abs(u.lastA - p.a) ? v : u)); k = n.k + Math.round((p.a - n.lastA) / Ps); } }
          if (k == null) k = nextK++;
          // Two tracks may share an index for a while (a row lost and found again, or the index chain slipped at the edge);
          // the indices are settled from position once the rows are known.
          best = { k, pts: new Map(), lastStrip: s, lastA: p.a };
          tracks.push(best);
        }
        best.pts.set(s, { a: p.a, mass: p.mass, support: true });
        best.lastStrip = s; best.lastA = p.a;
        assignedThisStrip.push({ k: best.k, a: p.a });
      }
    }
    opts.onProgress?.(s + 1, nStrips + 2);
  }

  // Rows: trimmed to their supported span, bridged inside it, dropped when too short or thin.
  type RowW = { k: number; s0: number; s1: number; a: Float64Array; support: Uint8Array };
  const rowsW: RowW[] = [];
  let rowsDropped = 0;
  for (const t of tracks) {
    const ss = [...t.pts.keys()].sort((u, v) => u - v);
    const s0 = ss[0], s1 = ss[ss.length - 1], n = s1 - s0 + 1;
    const supported = ss.length;
    if (supported < MIN_ROW_STRIPS || supported / n < MIN_ROW_SUPPORT_SHARE) { rowsDropped++; continue; }
    const a = new Float64Array(n), support = new Uint8Array(n);
    for (const s of ss) { a[s - s0] = t.pts.get(s)!.a; support[s - s0] = 1; }
    // Linear bridge over the gaps.
    for (let i = 0; i < n; i++) if (!support[i]) { let lo = i - 1; while (lo >= 0 && !support[lo]) lo--; let hi = i + 1; while (hi < n && !support[hi]) hi++; a[i] = lo >= 0 && hi < n ? a[lo] + ((a[hi] - a[lo]) * (i - lo)) / (hi - lo) : lo >= 0 ? a[lo] : a[hi]; }
    rowsW.push({ k: t.k, s0, s1, a, support });
  }
  // Settle the lattice indices from position: the rows' mean across positions, sorted, divided by the pitch.
  for (const r of rowsW) { let m = 0; for (let i = 0; i < r.a.length; i++) m += r.a[i]; r.k = m / r.a.length; }
  rowsW.sort((u, v) => u.k - v.k);
  // Indices in order of position: the next row's index steps by its distance in pitches, at least one unless the two
  // traces are the same row (overlapping in strips and within a third of a pitch, or one after the other within half).
  const meanA = rowsW.map(r => r.k); // the mean across positions, before k becomes an index
  for (let i = 0; i < rowsW.length; i++) {
    if (i === 0) { rowsW[i].k = 0; continue; }
    const prev = rowsW[i - 1], cur = rowsW[i], d = meanA[i] - meanA[i - 1], overlap = cur.s0 <= prev.s1 && prev.s0 <= cur.s1;
    const same = overlap ? d < pitchPx / 3 : d < pitchPx / 2;
    cur.k = same ? prev.k : prev.k + Math.max(1, Math.round(d / pitchPx));
  }
  // One row per lattice slot: two traces of the same row (lost and found again, or found twice) are joined, a supported
  // point winning over a bridged one where they overlap.
  for (let i = rowsW.length - 1; i > 0; i--) {
    const a = rowsW[i], b = rowsW[i - 1];
    if (a.k !== b.k) continue;
    const s0 = Math.min(a.s0, b.s0), s1 = Math.max(a.s1, b.s1), n = s1 - s0 + 1;
    const pos = new Float64Array(n), sup = new Uint8Array(n), has = new Uint8Array(n);
    for (const r of [b, a]) for (let j = 0; j < r.a.length; j++) { const t = r.s0 + j - s0; if (!has[t] || (r.support[j] && !sup[t])) { pos[t] = r.a[j]; sup[t] = r.support[j]; has[t] = 1; } }
    for (let t = 0; t < n; t++) if (!has[t]) { let lo = t - 1; while (lo >= 0 && !has[lo]) lo--; let hi = t + 1; while (hi < n && !has[hi]) hi++; pos[t] = lo >= 0 && hi < n ? pos[lo] + ((pos[hi] - pos[lo]) * (t - lo)) / (hi - lo) : lo >= 0 ? pos[lo] : pos[hi]; }
    rowsW.splice(i - 1, 2, { k: a.k, s0, s1, a: pos, support: sup });
  }
  const kMin = 0;
  if (!rowsW.length) return empty(gsdM, scaleBasis, "Rows were periodic across the photo but none could be traced along it.", vegetationFraction);

  // Row position per strip, for nearest-row lookups.
  const rowsByStrip: { r: number; a: number }[][] = Array.from({ length: nStrips }, () => []);
  rowsW.forEach((r, ri) => {
    for (let s = r.s0; s <= r.s1; s++) rowsByStrip[s].push({ r: ri, a: r.a[s - r.s0] });
    // Carried on past both ends along the row's own drift, for judging patches there (not drawn, not counted as length).
    const n = r.a.length, slope = n >= 4 ? (r.a[n - 1] - r.a[Math.max(0, n - 4)]) / Math.min(3, n - 1) : 0, slope0 = n >= 4 ? (r.a[Math.min(n - 1, 3)] - r.a[0]) / Math.min(3, n - 1) : 0;
    for (let e = 1; e <= END_EXTRAPOLATION_STRIPS; e++) {
      if (r.s1 + e < nStrips) rowsByStrip[r.s1 + e].push({ r: ri, a: r.a[n - 1] + slope * e });
      if (r.s0 - e >= 0) rowsByStrip[r.s0 - e].push({ r: ri, a: r.a[0] - slope0 * e });
    }
  });
  for (const lst of rowsByStrip) lst.sort((u, v) => u.a - v.a);
  const nearestRow = (s: number, b: number): { r: number; d: number } | null => {
    const lst = rowsByStrip[s]; if (!lst.length) return null;
    if (b < lst[0].a - pitchPx / 2 || b > lst[lst.length - 1].a + pitchPx / 2) return null; // beyond the outermost rows
    let best = lst[0], bd = Math.abs(b - lst[0].a);
    for (let i = 1; i < lst.length; i++) { const d = Math.abs(b - lst[i].a); if (d < bd) { bd = d; best = lst[i]; } }
    return { r: best.r, d: bd };
  };

  // 5. The crop band of each row from its own green: the density of green by distance from the centreline falls
  // from the row's peak to the alley's floor; the band ends where it has fallen three quarters of the way.
  const halfP = Math.ceil(pitchPx / 2) + 1;
  const dens: Float64Array[] = rowsW.map(() => new Float64Array(halfP)), cnts: Float64Array[] = rowsW.map(() => new Float64Array(halfP));
  for (let i = 0; i < W * H; i++) {
    if (skip[i]) continue;
    const nr = nearestRow(pxStrip[i], pxA[i]);
    if (!nr || nr.d > pitchPx / 2) continue;
    const b = Math.round(nr.d); cnts[nr.r][b]++; if (mask[i]) dens[nr.r][b]++;
  }
  const bandMin = Math.max(mPx(P.bandMinHalfWidthM), BAND_MIN_SHARE * pitchPx), bandMax = BAND_MAX_SHARE * pitchPx;
  const bandRaw = rowsW.map((_, ri) => {
    const d = new Float64Array(halfP); for (let b = 0; b < halfP; b++) d[b] = cnts[ri][b] ? dens[ri][b] / cnts[ri][b] : 0;
    const sm = boxSmooth(d, 2);
    let peak = 0; for (let b = 0; b <= Math.min(halfP - 1, Math.round(bandMax)); b++) peak = Math.max(peak, sm[b]);
    let floor = 0, n = 0; for (let b = Math.round(0.35 * pitchPx); b < halfP; b++) { floor += sm[b]; n++; } floor = n ? floor / n : 0;
    if (!(peak > floor)) return bandMin;
    const thr = floor + BAND_FALL_SHARE * (peak - floor);
    // The outermost offset still above the threshold: the leaves' tails (a twin row's second line keeps the density up too).
    let b = Math.min(halfP - 1, Math.round(bandMax)); while (b > bandMin && sm[b] < thr) b--;
    return Math.max(bandMin, Math.min(bandMax, b + 3));
  });
  const bandMed = quantile(bandRaw, 0.5) ?? bandMin;
  const band = bandRaw.map(b => Math.max(bandMin, Math.min(bandMax, Math.max(0.6 * bandMed, Math.min(1.5 * bandMed, b)))));

  // 6. Components of the green: on a band they are crop; clear of every band they are weed candidates.
  const labels = new Int32Array(W * H);
  const minWeedPx = Math.max(2, Math.round((P.minWeedAreaCm2 / 1e4) / (gsdW * gsdW)));
  const weeds: RowCropWeed[] = [];
  const excluded: RowCropExcluded[] = [];
  let cropComponents = 0, specks = 0, betweenGreen = 0, noRowsPatches = 0, noRowsAreaM2 = 0, leafTips = 0;
  const stack = new Int32Array(W * H);
  const smallPx = Math.round((SMALL_PATCH_CM2 / 1e4) / (gsdW * gsdW));
  let label = 0, faint = 0;
  const toPhoto = (x: number, y: number): [number, number] => [(x + 0.5) * f, (y + 0.5) * f];
  for (let i0 = 0; i0 < W * H; i0++) {
    if (!mask[i0] || labels[i0]) continue;
    label++;
    let top = 0; stack[top++] = i0; labels[i0] = label;
    const pix: number[] = [];
    let minD = Infinity, minBand = 0, noRows = 0, touchesEdge = false, aLo = Infinity, aHi = -Infinity, exc = 0, satN = 0;
    let mL = 0, mA = 0, mLL = 0, mAA = 0, mLA = 0; // moments in the (along, across) frame for the leaf-tip test
    while (top) {
      const i = stack[--top]; pix.push(i); exc += excess[i]; satN += skip[i];
      const x = i % W, y = (i - x) / W;
      { const l = along(x, y), a = across(x, y); mL += l; mA += a; mLL += l * l; mAA += a * a; mLA += l * a; }
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touchesEdge = true;
      const nr = nearestRow(pxStrip[i], pxA[i]);
      if (!nr || nr.d > pitchPx) noRows++; else { const rel = nr.d - band[nr.r]; if (rel < minD) { minD = rel; minBand = band[nr.r]; } }
      if (pxA[i] < aLo) aLo = pxA[i]; if (pxA[i] > aHi) aHi = pxA[i];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx; if (mask[j] && !labels[j]) { labels[j] = label; stack[top++] = j; }
      }
    }
    const n = pix.length;
    if (n < minWeedPx) { specks++; continue; }
    if (n < smallPx && exc / n < gopts.soilMargin + SMALL_PATCH_EXCESS) { faint++; continue; }
    const areaM2 = n * gsdW * gsdW;
    if (satN > n / 2) { // solid green: a border, a lawn, a closed canopy
      if (areaM2 >= LARGE_PATCH_M2) { const hp: [number, number][] = []; const st = Math.max(1, Math.floor(n / 400)); for (let q = 0; q < n; q += st) { const i = pix[q], x = i % W; hp.push(toPhoto(x, (i - x) / W)); } excluded.push({ hull: convexHull(hp), areaM2: r3(areaM2), reason: "solid green (a border, a lawn or a closed canopy), not plants between rows" }); }
      continue;
    }
    if (noRows < n && minD <= 0) { cropComponents++; continue; } // touches a row's band: crop
    if (noRows < n && areaM2 <= LEAF_TIP_MAX_CM2 / 1e4 && minD <= LEAF_TIP_REACH_SHARE * minBand) {
      // A leaf tip cut off from its row by shadow or a pale midrib: small, close, elongated across the rows (toward the row).
      const cl = mL / n, ca = mA / n, vLL = mLL / n - cl * cl, vAA = mAA / n - ca * ca, vLA = mLA / n - cl * ca;
      const tr = vLL + vAA, det = vLL * vAA - vLA * vLA, disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
      const e1 = tr / 2 + disc, e2 = Math.max(1e-9, tr / 2 - disc);
      // Principal axis angle from the across direction: 0 means pointing straight at the row.
      const theta = Math.abs(Math.atan2(2 * vLA, vAA - vLL) / 2) * (180 / Math.PI);
      if (Math.sqrt(e1 / e2) >= LEAF_TIP_ASPECT && theta <= LEAF_TIP_ANGLE_DEG) { cropComponents++; leafTips++; continue; }
    }
    const hullPts: [number, number][] = [];
    const step = Math.max(1, Math.floor(n / 400));
    for (let q = 0; q < n; q += step) { const i = pix[q], x = i % W, y = (i - x) / W; hullPts.push(toPhoto(x, y)); }
    const hull = convexHull(hullPts);
    let sx = 0, sy = 0; for (const i of pix) { const x = i % W; sx += x; sy += (i - x) / W; }
    const [cx, cy] = toPhoto(sx / n, sy / n);
    if (noRows === n) { noRowsPatches++; noRowsAreaM2 += areaM2; if (areaM2 > LARGE_PATCH_M2) excluded.push({ hull, areaM2: r3(areaM2), reason: "vegetation where no rows were read (a border, a headland, cover)" }); continue; }
    if ((aHi - aLo) > BORDER_ACROSS_PITCHES * pitchPx) { excluded.push({ hull, areaM2: r3(areaM2), reason: "vegetation wider than the rows' spacing across them (a border or cover, not a plant between rows)" }); continue; }
    betweenGreen += n;
    weeds.push({ id: weeds.length + 1, x: r3(cx), y: r3(cy), areaM2: r3(areaM2), equivDiameterM: r3(2 * Math.sqrt(areaM2 / Math.PI)), hull, distToRowM: noRows === n ? null : r3((minD + minBand) * gsdW), bandHalfWidthM: noRows === n ? null : r3(minBand * gsdW), touchesEdge, status: noRows === n ? "no rows here" : "between rows" });
  }
  checkStop(opts);
  opts.debug?.(`rows ${rowsW.length} (dropped ${rowsDropped}; k ${rowsW.map(r => r.k - kMin).join(",")}), band px ${band.map(b => b.toFixed(0)).join(",")}, components: crop ${cropComponents} (leaf tips ${leafTips}), weeds ${weeds.length}, specks ${specks}, faint ${faint}, excluded ${excluded.length}`);

  // 7. Along each row: green share inside the band, gaps, and (fine pixels only) the stand from the green peaks.
  const binPx = Math.max(1, Math.round(mPx(0.1)));
  const standBin = Math.max(1, Math.round(mPx(0.02)));
  const standOk = P.seedSpacingM != null && gsdW * 100 <= P.maxStandGsdCm;
  const rowGreen: number[][] = rowsW.map(r => new Array(Math.ceil(((r.s1 - r.s0 + 1) * stripPx) / binPx) + 1).fill(0));
  const rowBandPx: number[][] = rowsW.map(r => new Array(Math.ceil(((r.s1 - r.s0 + 1) * stripPx) / binPx) + 1).fill(0));
  const rowStand: Float64Array[] = rowsW.map(r => new Float64Array(Math.ceil(((r.s1 - r.s0 + 1) * stripPx) / standBin) + 1));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, s = pxStrip[i];
    const nr = nearestRow(s, pxA[i]);
    if (!nr || nr.d > band[nr.r]) continue;
    const r = rowsW[nr.r];
    const l = along(x, y) - lMin - r.s0 * stripPx;
    if (l < 0) continue;
    const b = Math.floor(l / binPx);
    if (b >= rowGreen[nr.r].length) continue;
    rowBandPx[nr.r][b]++;
    if (mask[i]) { rowGreen[nr.r][b]++; if (standOk) rowStand[nr.r][Math.min(rowStand[nr.r].length - 1, Math.floor(l / standBin))]++; }
  }
  const minGapBins = Math.max(1, Math.round(Math.max(MIN_GAP_M, P.seedSpacingM != null ? 2 * P.seedSpacingM : 0) / (binPx * gsdW)));
  const rows: RowCropRow[] = rowsW.map((r, ri) => {
    const n = r.s1 - r.s0 + 1;
    const pts: [number, number][] = [];
    for (let s = 0; s < n; s++) { const l = lMin + (r.s0 + s + 0.5) * stripPx, a = r.a[s] + aMin; pts.push(toPhoto(l * cs - a * sn, l * sn + a * cs)); }
    const g = rowGreen[ri], bp = rowBandPx[ri];
    const shares = g.map((v, b) => (bp[b] > 0 ? v / bp[b] : NaN)).filter(Number.isFinite);
    const med = quantile(shares, 0.5) ?? 0;
    const gaps: RowCropGap[] = [];
    let run = -1;
    const lastBin = Math.floor((n * stripPx - 1) / binPx);
    const endRun = (b: number) => {
      if (run < 0) return; const len = b - run; if (len >= minGapBins) {
        const l1 = lMin + r.s0 * stripPx + run * binPx, l2 = lMin + r.s0 * stripPx + b * binPx;
        const aAt = (l: number) => { const s = Math.max(0, Math.min(n - 1, Math.floor((l - lMin) / stripPx) - r.s0)); return r.a[s] + aMin; };
        const p1 = toPhoto(l1 * cs - aAt(l1) * sn, l1 * sn + aAt(l1) * cs), p2 = toPhoto(l2 * cs - aAt(l2) * sn, l2 * sn + aAt(l2) * cs);
        gaps.push({ x1: r3(p1[0]), y1: r3(p1[1]), x2: r3(p2[0]), y2: r3(p2[1]), lengthM: r3(len * binPx * gsdW) });
      } run = -1;
    };
    for (let b = 0; b <= lastBin; b++) {
      const covered = bp[b] > 0.5 * band[ri] * 2 * binPx; // the band is inside the photo here
      const share = bp[b] > 0 ? g[b] / bp[b] : 0;
      if (covered && share < 0.15 * med) { if (run < 0) run = b; } else endRun(b);
    }
    endRun(lastBin + 1);
    let plants: number | null = null, plantPoints: [number, number][] | null = null;
    if (standOk && P.seedSpacingM) {
      const seedPx = mPx(P.seedSpacingM) / standBin;
      const sm = boxSmooth(rowStand[ri], Math.max(1, Math.round(seedPx / 4)));
      const q = quantile([...sm].filter(v => v > 0), 0.75) ?? 0;
      const pk = peaks(sm, Math.max(1, 0.6 * seedPx), 0.3 * q);
      plantPoints = pk.map(p => { const l = lMin + r.s0 * stripPx + (p.a + 0.5) * standBin, s = Math.max(0, Math.min(n - 1, Math.floor((p.a * standBin) / stripPx))), a = r.a[s] + aMin; const [x, y] = toPhoto(l * cs - a * sn, l * sn + a * cs); return [r3(x), r3(y)]; });
      plants = plantPoints.length;
    }
    let support = 0; for (let s = 0; s < n; s++) support += r.support[s];
    const bandArea = bp.reduce((u, v) => u + v, 0), greenIn = g.reduce((u, v) => u + v, 0);
    return { id: ri + 1, k: r.k - kMin, points: pts.map(([x, y]) => [r3(x), r3(y)]), lengthM: r3(n * stripPx * gsdW), supportShare: r3(support / n), bandHalfWidthM: r3(band[ri] * gsdW), greenShare: r3(bandArea ? greenIn / bandArea : 0), gaps, plants, plantPoints };
  });

  // 8. Coherence: autocorrelation at the pitch of 3 m windows' across profiles, where there is green.
  const winPx = Math.max(stripPx * 2, Math.round(mPx(3)));
  const cohs: number[] = [];
  for (let y0 = 0; y0 + winPx <= H; y0 += winPx) for (let x0 = 0; x0 + winPx <= W; x0 += winPx) {
    const prof = new Float64Array(Math.ceil(winPx * 1.5) + 2); let g = 0;
    for (let y = y0; y < y0 + winPx; y++) for (let x = x0; x < x0 + winPx; x++) { const i = y * W + x; if (!mask[i]) continue; g++; const b = Math.round(across(x - x0, y - y0) + winPx * 0.75); if (b >= 0 && b < prof.length) prof[b]++; }
    if (g < 0.01 * winPx * winPx) continue;
    let m = 0; for (const v of prof) m += v; m /= prof.length;
    let a0 = 0, aP = 0; const lag = Math.round(pitchPx);
    for (let i = 0; i < prof.length; i++) { a0 += (prof[i] - m) ** 2; if (i + lag < prof.length) aP += (prof[i] - m) * (prof[i + lag] - m); }
    if (a0 > 0) cohs.push(Math.max(-1, Math.min(1, aP / a0)));
  }
  const coherence = cohs.length ? cohs.reduce((u, v) => u + v, 0) / cohs.length : null;

  // Between-row cover: green clear of every band over the area clear of every band, where rows were read.
  let betweenArea = 0;
  for (let i = 0; i < W * H; i++) { const nr = nearestRow(pxStrip[i], pxA[i]); if (nr && nr.d > band[nr.r] && nr.d <= pitchPx) betweenArea++; }
  const weedAreaM2 = weeds.reduce((u, w) => u + w.areaM2, 0);
  const gapsN = rows.reduce((u, r) => u + r.gaps.length, 0), gapLen = rows.reduce((u, r) => u + r.gaps.reduce((a, g) => a + g.lengthM, 0), 0);
  const plantsTotal = standOk ? rows.reduce((u, r) => u + (r.plants ?? 0), 0) : null;
  if (!standOk) notes.push(P.seedSpacingM == null ? "No seed spacing for the crop: no gaps by spacing and no stand estimate." : `The pixel is coarser than ${P.maxStandGsdCm} cm: no stand estimate.`);
  else notes.push("The stand is an estimate from the green peaks along each row; it has not been verified against counted plants.");
  if (excluded.length) notes.push(`${excluded.length} patch${excluded.length === 1 ? "" : "es"} of vegetation left out as border or cover, not weeds.`);
  if (noRowsPatches) notes.push(`${noRowsPatches} green patch${noRowsPatches === 1 ? "" : "es"} (${noRowsAreaM2.toFixed(1)} m²) lie where no rows were read and are not judged.`);
  opts.onProgress?.(nStrips + 2, nStrips + 2);
  return {
    version: ROW_CROP_READ_VERSION, width: px.width, height: px.height, gsdM, scaleBasis, workFactor: f,
    directionDeg: r3(((rowAngle * 180) / Math.PI + 180) % 180), pitchM: r3(pitchM), matchedSpacingM,
    rows, weeds, excluded,
    summary: {
      rows: rows.length, rowsDropped, totalRowLengthM: r3(rows.reduce((u, r) => u + r.lengthM, 0)),
      medianBandHalfWidthM: quantile(rows.map(r => r.bandHalfWidthM), 0.5), medianRowGreenShare: quantile(rows.map(r => r.greenShare), 0.5),
      weeds: weeds.length, weedAreaM2: r3(weedAreaM2), betweenRowCover: betweenArea ? r3(betweenGreen / betweenArea) : null,
      cropComponents, noRowsPatches, leafTips, specks, gaps: gapsN, gapLengthM: r3(gapLen), plants: plantsTotal, coherence: coherence == null ? null : r3(coherence), vegetationFraction: r3(vegetationFraction), ms: Date.now() - t0,
    },
    notes, crop: P.crop,
  };
}

function checkStop(opts: RowCropOptions) { if (opts.signal?.aborted) throw new Error("cancelled"); }

function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1)).map(([x, y]) => [r3(x), r3(y)]);
}

/** Everything to draw, in photo pixels: rows, each row's band edges, weeds, gaps, plants, excluded patches. */
export function rowCropOverlay(read: RowCropRead): { rows: [number, number][][]; bands: [number, number][][]; weeds: [number, number][][]; gaps: RowCropGap[]; plants: [number, number][]; excluded: [number, number][][] } {
  const bands: [number, number][][] = [];
  for (const r of read.rows) {
    const half = r.bandHalfWidthM / read.gsdM;
    const left: [number, number][] = [], right: [number, number][] = [];
    for (let i = 0; i < r.points.length; i++) {
      const [x, y] = r.points[i];
      const [x2, y2] = r.points[Math.min(r.points.length - 1, i + 1)], [x1, y1] = r.points[Math.max(0, i - 1)];
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      left.push([x + nx * half, y + ny * half]); right.push([x - nx * half, y - ny * half]);
    }
    bands.push(left, right);
  }
  return { rows: read.rows.map(r => r.points), bands, weeds: read.weeds.map(w => w.hull), gaps: read.rows.flatMap(r => r.gaps), plants: read.rows.flatMap(r => r.plantPoints ?? []), excluded: read.excluded.map(e => e.hull) };
}
