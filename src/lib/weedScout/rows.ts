// The row model: learn where corn is.
//
// Ported from offrow/src/offrow/rows.py, in three parts per window:
//
//   angle  projection-profile variance search across 0..180 degrees, coarse
//          then fine. Rows aligned with the projection stack into sharp peaks;
//          everything else smears flat. With a hint from a previous fit the
//          search is confined to a few degrees either side, which is what makes
//          a full-depth sweep of hundreds of windows affordable.
//   pitch  autocorrelation of the perpendicular profile, searched inside a
//          band around the grower's spacing. The band is not the answer; the
//          fit happens inside it, and disagreeing with the grower by more than
//          ten percent means a harmonic, so the grower's number is kept and
//          the confidence halved.
//   phase  circular mean of exp(2 pi i across / pitch) over every vegetated
//          pixel, in GROUND coordinates about the window's own centre. That is
//          the same expression signedDistanceToRow uses, so there is no
//          coordinate convention left to disagree about. Two separate phase
//          bugs in the research track put every centreline at a random offset
//          while angle and pitch stayed exact; this is the arrangement that
//          survived them.
//
// The projection is SPARSE: only vegetated samples are projected, at a cost
// proportional to the vegetation rather than to the window. The per-bin
// normalisation is the EXACT count of disc pixels whose centre lands in each
// bin, computed once per image size and angle and cached. An analytic chord
// length was tried and is wrong in a way that matters: at exactly 45 and 135
// degrees the pixel centres project onto a lattice of half the bin width, so
// bins alternate between one and two lattice lines, and dividing by a smooth
// chord leaves an alternating pattern whose variance is fourteen times the
// typical angle's. Every noise window "found rows" at 45 degrees. Exact
// counts carry the same alternation and cancel it.
//
// Confidence is split into an angle part and a pitch part because they fail
// separately: one row gives a perfect direction and no spacing at all. A
// window is only as good as the weaker one, and a model with no window above
// the floor refuses to be queried rather than returning distances computed
// from nothing.
import type { RasterSource } from "../cellFeatures";
import { type LatLng2, M_PER_DEG_LAT, mPerDegLng } from "../geo";
import { rasterGsdM } from "./tiles";
import type { RowModel, RowTileFit } from "./types";

/** Rows land about this many samples apart after downsampling. Speed only. */
export const TARGET_PITCH_PX = 8;
/** Pitch search band, as a fraction of the grower's spacing. */
export const PITCH_SEARCH_BAND: [number, number] = [0.6, 1.6];
/** Recovered pitch further than this from the grower's spacing is a harmonic. */
export const PITCH_TOLERANCE = 0.10;
/** Below this a window's fit is not consulted. Sits between the worst real grid and the best noise. */
export const MIN_TILE_CONFIDENCE = 0.35;
/** Default window edge for a per-window fit, metres. About sixteen rows at 30 inches. */
export const DEFAULT_ROW_WINDOW_M = 12;
/** Windows outside this vegetation-fraction band cannot carry rows: bare, or closed canopy. */
export const VEGETATION_FRACTION_RANGE: [number, number] = [0.01, 0.85];
/** Half-width of the angle search when a hint is supplied, degrees. */
export const HINT_SEARCH_DEG = 4;

const clip01 = (v: number) => Math.max(0, Math.min(1, v));
const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** A mask window as a float image (values 0..1), possibly mean-pooled. */
export type FloatImage = { data: Float32Array; width: number; height: number };

/** The vegetated samples of a FloatImage, which is all the projection needs. */
export type SparseImage = {
  width: number; height: number;
  xs: Float32Array; ys: Float32Array; vals: Float32Array;
  total: number;
};

export function toSparse(img: FloatImage): SparseImage {
  let n = 0;
  for (let i = 0; i < img.data.length; i++) if (img.data[i] > 0) n++;
  const xs = new Float32Array(n), ys = new Float32Array(n), vals = new Float32Array(n);
  let k = 0, total = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const v = img.data[y * img.width + x];
      if (v <= 0) continue;
      xs[k] = x + 0.5; ys[k] = y + 0.5; vals[k] = v; k++; total += v;
    }
  }
  return { width: img.width, height: img.height, xs, ys, vals, total };
}

export function downsampleFactor(gsdM: number, nominalSpacingM: number): number {
  if (!(gsdM > 0) || !(nominalSpacingM > 0)) return 1;
  return Math.max(1, Math.floor(nominalSpacingM / gsdM / TARGET_PITCH_PX));
}

/** Mean-pool a mask window by `factor`, which keeps the periodic signal and antialiases it. */
export function poolWindow(
  mask: Uint8Array, width: number,
  x0: number, y0: number, w: number, h: number, factor: number,
): FloatImage {
  const ow = Math.floor(w / factor), oh = Math.floor(h / factor);
  const data = new Float32Array(ow * oh);
  const inv = 1 / (factor * factor);
  for (let oy = 0; oy < oh; oy++) {
    for (let ox = 0; ox < ow; ox++) {
      let s = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y0 + oy * factor + dy) * width + x0 + ox * factor;
        for (let dx = 0; dx < factor; dx++) s += mask[row + dx];
      }
      data[oy * ow + ox] = s * inv;
    }
  }
  return { data, width: ow, height: oh };
}

/**
 * Projection profile at one array-frame angle, chord-corrected.
 *
 * `angleDeg` is the direction the ROWS run, counterclockwise from +x in array
 * coordinates (y down). Vegetated samples inside the inscribed disc are
 * projected onto the perpendicular and binned at one sample per bin; each bin
 * is divided by the disc's chord length there, so the disc's own dome shape
 * does not swamp the row signal. Bins with a short chord are NaN.
 */
const countCache = new Map<string, { counts: Float64Array; max: number }>();
const COUNT_CACHE_LIMIT = 6000;

/** Disc pixels per projection bin for an image size and angle. Exact, cached. */
export function binCounts(width: number, height: number, angleDeg: number): { counts: Float64Array; max: number } {
  const key = `${width}x${height}|${Math.round(angleDeg * 100)}`;
  const hit = countCache.get(key);
  if (hit) return hit;
  const side = Math.min(width, height);
  const cx = width / 2, cy = height / 2, R = side / 2, R2 = R * R;
  const th = (angleDeg * Math.PI) / 180;
  const nx = -Math.sin(th), ny = Math.cos(th);
  const nBins = Math.ceil(side) + 2;
  const counts = new Float64Array(nBins);
  for (let y = 0; y < height; y++) {
    const dy = y + 0.5 - cy;
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy > R2) continue;
      const b = Math.floor(dx * nx + dy * ny + R);
      if (b >= 0 && b < nBins) counts[b]++;
    }
  }
  let max = 0;
  for (let i = 0; i < nBins; i++) if (counts[i] > max) max = counts[i];
  if (countCache.size >= COUNT_CACHE_LIMIT) countCache.clear();
  const entry = { counts, max };
  countCache.set(key, entry);
  return entry;
}

export function projectionProfile(img: SparseImage | FloatImage, angleDeg: number): { profile: Float64Array } {
  const sp: SparseImage = "xs" in img ? img : toSparse(img);
  const side = Math.min(sp.width, sp.height);
  const cx = sp.width / 2, cy = sp.height / 2, R = side / 2;
  const th = (angleDeg * Math.PI) / 180;
  const nx = -Math.sin(th), ny = Math.cos(th);
  const nBins = Math.ceil(side) + 2;
  const sums = new Float64Array(nBins);
  const R2 = R * R;
  for (let i = 0; i < sp.xs.length; i++) {
    const dx = sp.xs[i] - cx, dy = sp.ys[i] - cy;
    if (dx * dx + dy * dy > R2) continue;
    const b = Math.floor(dx * nx + dy * ny + R);
    if (b < 0 || b >= nBins) continue;
    sums[b] += sp.vals[i];
  }
  const { counts, max } = binCounts(sp.width, sp.height, angleDeg);
  const profile = new Float64Array(nBins);
  for (let b = 0; b < nBins; b++) {
    profile[b] = counts[b] > 0.5 * max ? sums[b] / counts[b] : NaN;
  }
  return { profile };
}

const finiteVariance = (p: Float64Array): number => {
  let n = 0, s = 0, s2 = 0;
  for (let i = 0; i < p.length; i++) {
    const v = p[i];
    if (!Number.isFinite(v)) continue;
    n++; s += v; s2 += v * v;
  }
  if (n < 2) return 0;
  const m = s / n;
  return Math.max(0, s2 / n - m * m);
};

const norm180 = (a: number) => ((a % 180) + 180) % 180;

/**
 * Dominant row angle in ARRAY coordinates, and a confidence from the margin
 * between the best angle's profile variance and the typical variance.
 *
 * With `hintPxDeg` the coarse search covers only HINT_SEARCH_DEG either side;
 * the confidence is then measured against a full-circle sample at 10 degree
 * steps so a confined search cannot manufacture a margin.
 */
export function rowAngle(
  img: FloatImage | SparseImage,
  opts: { coarseStep?: number; fineStep?: number; hintPxDeg?: number | null } = {},
): { anglePxDeg: number; confidence: number } {
  const sp = "xs" in img ? img : toSparse(img);
  if (sp.xs.length === 0) return { anglePxDeg: 0, confidence: 0 };
  const coarseStep = opts.coarseStep ?? 1, fineStep = opts.fineStep ?? 0.1;
  const hint = opts.hintPxDeg ?? null;

  const background: number[] = [];
  let best = 0, bestVar = -1;
  if (hint === null) {
    for (let a = 0; a < 180; a += coarseStep) {
      const v = finiteVariance(projectionProfile(sp, a).profile);
      background.push(v);
      if (v > bestVar) { bestVar = v; best = a; }
    }
  } else {
    for (let a = 0; a < 180; a += 10) background.push(finiteVariance(projectionProfile(sp, a).profile));
    for (let a = hint - HINT_SEARCH_DEG; a <= hint + HINT_SEARCH_DEG + 1e-9; a += 0.5) {
      const v = finiteVariance(projectionProfile(sp, norm180(a)).profile);
      if (v > bestVar) { bestVar = v; best = a; }
    }
  }
  let bestFine = best, bestFineVar = -1;
  const span = hint === null ? coarseStep : 0.5;
  for (let a = best - span; a <= best + span + 1e-9; a += fineStep) {
    const v = finiteVariance(projectionProfile(sp, norm180(a)).profile);
    if (v > bestFineVar) { bestFineVar = v; bestFine = a; }
  }
  const typical = median(background);
  const peak = Math.max(bestVar, bestFineVar);
  const confidence = peak <= 0 ? 0 : clip01((peak - typical) / (peak + typical));
  return { anglePxDeg: norm180(bestFine), confidence };
}

/** Array-frame angle to ground-frame. A north-up raster's y grows downward, so the angle mirrors. */
export const pixelAngleToGround = (anglePxDeg: number): number => norm180(-anglePxDeg);
export const groundAngleToPixel = (angleGroundDeg: number): number => norm180(-angleGroundDeg);

/**
 * Row spacing from the perpendicular profile, by autocorrelation inside the
 * plausible band. Returns metres, and a confidence from how much the chosen
 * lag stands above the typical lag in the band.
 */
export function rowPitch(
  profile: Float64Array, sampleM: number, nominalSpacingM: number,
): { pitchM: number; confidence: number } {
  const vals: number[] = [];
  for (let i = 0; i < profile.length; i++) if (Number.isFinite(profile[i])) vals.push(profile[i]);
  const n = vals.length;
  if (n < 8) return { pitchM: nominalSpacingM, confidence: 0 };
  const m = vals.reduce((a, b) => a + b, 0) / n;
  const c = vals.map(v => v - m);
  let var0 = 0;
  for (const v of c) var0 += v * v;
  if (var0 <= 0) return { pitchM: nominalSpacingM, confidence: 0 };

  const low = Math.max(2, Math.floor((nominalSpacingM * PITCH_SEARCH_BAND[0]) / sampleM));
  const high = Math.min(Math.floor(n / 3), Math.ceil((nominalSpacingM * PITCH_SEARCH_BAND[1]) / sampleM));
  if (high <= low) return { pitchM: nominalSpacingM, confidence: 0 };

  const r: number[] = [];
  for (let lag = low; lag <= high; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += c[i] * c[i + lag];
    r.push(s / var0);
  }
  let bi = 0;
  for (let i = 1; i < r.length; i++) if (r[i] > r[bi]) bi = i;
  let lag = low + bi;
  if (bi > 0 && bi < r.length - 1) {
    const a = r[bi - 1], b = r[bi], d = r[bi + 1];
    const denom = a - 2 * b + d;
    if (denom < 0) lag += 0.5 * (a - d) / denom;
  }
  const peak = r[bi];
  const typical = median(r);
  const confidence = peak <= 0 ? 0 : clip01((peak - typical) / (Math.abs(peak) + Math.abs(typical) + 1e-9));
  return { pitchM: lag * sampleM, confidence };
}

/** Does the recovered pitch agree with what the grower planted? */
export function checkPitch(recoveredM: number, growerM: number): boolean {
  if (!(growerM > 0) || !(recoveredM > 0)) return false;
  return Math.abs(recoveredM - growerM) / growerM <= PITCH_TOLERANCE;
}

/**
 * Row phase in ground metres about (cx, cy), from the mask itself.
 *
 * `toGround` maps a pooled pixel to local metres. The lever arm is bounded at
 * half a window because everything is referenced to the window centre; from a
 * far-away origin an angle error of 0.05 degrees is a 400 m offset, and 400 m
 * modulo a 76 cm pitch is uniform noise.
 */
export function phaseFromImage(
  sp: SparseImage,
  toGround: (px: number, py: number) => { x: number; y: number },
  cx: number, cy: number,
  angleGroundDeg: number, pitchM: number,
): number {
  if (!(pitchM > 0)) return 0;
  const th = (angleGroundDeg * Math.PI) / 180;
  const nx = -Math.sin(th), ny = Math.cos(th);
  let re = 0, im = 0;
  for (let i = 0; i < sp.xs.length; i++) {
    const g = toGround(sp.xs[i], sp.ys[i]);
    const across = (g.x - cx) * nx + (g.y - cy) * ny;
    const ang = (2 * Math.PI * across) / pitchM;
    re += sp.vals[i] * Math.cos(ang);
    im += sp.vals[i] * Math.sin(ang);
  }
  if (re === 0 && im === 0) return 0;
  const ph = (Math.atan2(im, re) / (2 * Math.PI)) * pitchM;
  return ((ph % pitchM) + pitchM) % pitchM;
}

/** Signed metres from a point to the nearest centreline of one fitted window. */
export function signedDistanceToRow(fit: RowTileFit, x: number, y: number): number {
  const th = (fit.angleDeg * Math.PI) / 180;
  const across = (x - fit.centre.x) * -Math.sin(th) + (y - fit.centre.y) * Math.cos(th);
  const d = across - fit.phaseM;
  const p = fit.pitchM;
  return ((((d + p / 2) % p) + p) % p) - p / 2;
}

/** Local metric frame: metres east / north of `origin`. */
export function localFrame(origin: LatLng2) {
  const mLng = mPerDegLng(origin.lat);
  return {
    toXY: (p: LatLng2) => ({ x: (p.lng - origin.lng) * mLng, y: (p.lat - origin.lat) * M_PER_DEG_LAT }),
    toLatLng: (x: number, y: number): LatLng2 => ({ lng: origin.lng + x / mLng, lat: origin.lat + y / M_PER_DEG_LAT }),
  };
}

export type FitWindowInput = {
  mask: Uint8Array;
  width: number;
  /** Pixel window, inclusive. */
  x0: number; y0: number; x1: number; y1: number;
  gsdM: number;
  /** Local metres of the window's pixel (0,0) corner; y decreases per pixel row. */
  originX: number; originY: number;
  growerSpacingM: number;
  /** Ground angle of a previous fit, to confine the search. */
  angleHintDeg?: number | null;
};

/** Fit one window: angle, pitch, phase, and how much to believe each. */
export function fitWindow(input: FitWindowInput): RowTileFit {
  const { mask, width, x0, y0, x1, y1, gsdM, growerSpacingM } = input;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  let veg = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) veg += mask[y * width + x];
  const vegetationFraction = veg / Math.max(1, w * h);

  const factor = downsampleFactor(gsdM, growerSpacingM);
  const img = poolWindow(mask, width, x0, y0, w, h, factor);
  const sampleM = gsdM * factor;
  const toGround = (px: number, py: number) => ({
    x: input.originX + px * sampleM,
    y: input.originY - py * sampleM,
  });
  const centre = toGround(img.width / 2, img.height / 2);
  const sizeM = Math.max(w, h) * gsdM;

  const empty: RowTileFit = {
    centre, sizeM, angleDeg: 0, pitchM: growerSpacingM, phaseM: 0,
    confidence: 0, angleConfidence: 0, pitchConfidence: 0,
    vegetationFraction, pitchFromGrower: true, recoveredPitchM: 0,
  };
  if (img.width < 8 || img.height < 8) return empty;
  if (vegetationFraction < VEGETATION_FRACTION_RANGE[0] || vegetationFraction > VEGETATION_FRACTION_RANGE[1]) return empty;

  const sp = toSparse(img);
  const hintPx = input.angleHintDeg == null ? null : groundAngleToPixel(input.angleHintDeg);
  const { anglePxDeg, confidence: angleConfidence } = rowAngle(sp, { hintPxDeg: hintPx });
  const { profile } = projectionProfile(sp, anglePxDeg);
  const { pitchM: recovered, confidence: rawPitchConf } = rowPitch(profile, sampleM, growerSpacingM);
  let pitchM = recovered, pitchConfidence = rawPitchConf, pitchFromGrower = false;
  if (!checkPitch(recovered, growerSpacingM)) {
    pitchM = growerSpacingM;
    pitchConfidence *= 0.5;
    pitchFromGrower = true;
  }
  const angleDeg = pixelAngleToGround(anglePxDeg);
  const phaseM = phaseFromImage(sp, toGround, centre.x, centre.y, angleDeg, pitchM);
  return {
    centre, sizeM, angleDeg, pitchM, phaseM,
    confidence: Math.min(angleConfidence, pitchConfidence),
    angleConfidence, pitchConfidence,
    vegetationFraction, pitchFromGrower, recoveredPitchM: recovered,
  };
}

/**
 * Fit the whole field, window by window, and assemble a model.
 *
 * `insideField` lets the caller skip windows whose centre is outside the
 * boundary, so a window of road and hedge cannot vote on the row direction.
 */
export function fitRowModel(
  mask: Uint8Array,
  raster: Pick<RasterSource, "width" | "height" | "bounds">,
  growerSpacingM: number,
  opts: { windowM?: number; insideField?: (p: LatLng2) => boolean } = {},
): RowModel {
  const gsdM = rasterGsdM(raster);
  const windowM = opts.windowM ?? DEFAULT_ROW_WINDOW_M;
  const windowPx = Math.max(16, Math.round(windowM / gsdM));
  const origin: LatLng2 = { lat: raster.bounds.north, lng: raster.bounds.west };
  const frame = localFrame(origin);
  const tiles: RowTileFit[] = [];
  for (let y0 = 0; y0 + windowPx <= raster.height; y0 += windowPx) {
    for (let x0 = 0; x0 + windowPx <= raster.width; x0 += windowPx) {
      const x1 = x0 + windowPx - 1, y1 = y0 + windowPx - 1;
      if (opts.insideField) {
        const c = frame.toLatLng((x0 + windowPx / 2) * gsdM, -(y0 + windowPx / 2) * gsdM);
        if (!opts.insideField(c)) continue;
      }
      tiles.push(fitWindow({
        mask, width: raster.width, x0, y0, x1, y1, gsdM,
        originX: x0 * gsdM, originY: -y0 * gsdM, growerSpacingM,
      }));
    }
  }
  const usable = tiles.filter(t => t.confidence >= MIN_TILE_CONFIDENCE);
  return {
    tiles,
    origin,
    usable: usable.length > 0,
    confidence: median(usable.map(t => t.confidence)),
    medianAngleDeg: median(usable.map(t => t.angleDeg)),
    medianPitchM: median(usable.map(t => t.pitchM)),
  };
}

/**
 * Metres from a point to the nearest fitted centreline, from the nearest
 * usable window. Null when the model has nothing to say: no usable window, or
 * none within two window widths of the point.
 */
export function distanceToRowM(model: RowModel, p: LatLng2): number | null {
  if (!model.usable) return null;
  const { x, y } = localFrame(model.origin).toXY(p);
  let best: RowTileFit | null = null, bestD = Infinity;
  for (const t of model.tiles) {
    if (t.confidence < MIN_TILE_CONFIDENCE) continue;
    const d = Math.hypot(t.centre.x - x, t.centre.y - y);
    if (d < bestD) { bestD = d; best = t; }
  }
  if (!best || bestD > 2 * best.sizeM) return null;
  return signedDistanceToRow(best, x, y);
}

/**
 * Fit a whole raster as one window, in a frame anchored at ITS north-west
 * corner, and return a distance function in that same frame. For the sweep,
 * where each window is its own raster.
 */
export function fitRaster(
  mask: Uint8Array,
  raster: Pick<RasterSource, "width" | "height" | "bounds">,
  growerSpacingM: number,
  angleHintDeg: number | null,
): { fit: RowTileFit; distanceTo: (p: LatLng2) => number } {
  const gsdM = rasterGsdM(raster);
  const origin: LatLng2 = { lat: raster.bounds.north, lng: raster.bounds.west };
  const frame = localFrame(origin);
  const fit = fitWindow({
    mask, width: raster.width, x0: 0, y0: 0, x1: raster.width - 1, y1: raster.height - 1,
    gsdM, originX: 0, originY: 0, growerSpacingM, angleHintDeg,
  });
  return {
    fit,
    distanceTo: (p: LatLng2) => { const { x, y } = frame.toXY(p); return signedDistanceToRow(fit, x, y); },
  };
}
