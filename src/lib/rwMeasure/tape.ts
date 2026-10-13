// The measuring tape: found by its yellow, straightened along its own axis,
// and calibrated from its ticks.
//
// What is read, measured on the real photos: every tick is ink darker than
// the tape's own yellow in its row; the fine ticks sit in a band along each
// edge and the inch ticks run across the whole body (on a Stanley tape they
// join the two edges). So two whole-body statistics are taken per column of
// the straightened tape: the darkness in the edge bands, whose
// autocorrelation gives the finest tick period, and the share of rows with
// ink, whose deepest class is the inch ticks. The inch ticks are fitted to a
// lattice (a numeral or a scuff may hide one; the lattice tolerates gaps),
// which gives the inch in pixels; the fine period times sixteen is the
// second, independent estimate, and sixteen rather than ten is how an inch
// tape is told from a metric one, not assumed. The uncertainty is the lattice
// residual together with the disagreement of the two estimates. A tape whose
// ticks cannot be read fails, with the reason. The earlier reading, a
// contiguous run of ink in from the edge, read the real ticks at a fifth of
// their length because JPEG and tilt break the run; it is gone.
//
// The scale holds along the tape, on the tape's plane. It says nothing on
// its own about the direction across the tape or about leaves above the
// plane; the measurement module states that assumption.
import { type Calibration, type Pt, type TapeAxis } from "./types";
import { pixelsPerCmFromInchPx } from "./geometry";

export type Rgba = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

/**
 * A pixel of the tape's yellow: bright, red close to green, blue well under
 * both. Measured on the real photos: the tape body reads about r 237, g 240,
 * b 113 in the kerb photos and a washed-out r 220, g 246, b 178 in the bright
 * lawn photos (hue 83, which a 42 to 72 degree hue rule rejected, so five of
 * fifteen photos lost their tape). Grass, lit or dry, has red well under
 * green (r/g 0.55 to 0.75); yellow has red within 15% of green and green
 * within 20% of red (a saturated printed yellow is about 235, 210, 40). A
 * brown leaf has green well under red and is out. What remains, dry grass at the margin,
 * is not a filled bar and does not survive findTape.
 */
export const isYellow = (r: number, g: number, b: number): boolean => {
  const mx = Math.max(r, g, b);
  return mx >= 150 && r >= 0.85 * g && g >= 0.8 * r && b <= 0.85 * g;
};

/**
 * Find the tape among the yellow components at a reduced scale: the one that
 * is most a rectangle. Each component of at least 200 pixels gets a principal
 * axis; a candidate is at least three times as long as wide and fills at
 * a quarter of its own oriented box (ticks, numerals, the hook and
 * the case break the yellow; a real tape read 0.36 to 0.83) (a lawn of yellow-green blades is big
 * but ragged; a tape is a bar). The best is the largest filled bar. Measured
 * on the real photos: in five of fifteen the largest yellow component was
 * lawn, not tape, and the largest-component rule found no tape at all.
 */
export function findTape(img: Rgba, scale: number): TapeAxis | null {
  const w = Math.floor(img.width / scale), h = Math.floor(img.height / scale);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * scale * img.width + x * scale) * 4;
    if (isYellow(img.data[o], img.data[o + 1], img.data[o + 2])) mask[y * w + x] = 1;
  }
  // Components, 8-connected, by flood fill.
  const label = new Int32Array(w * h);
  let next = 0; const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s]) continue;
    next++; label[s] = next; stack.push(s); let n = 0;
    while (stack.length) {
      const i = stack.pop()!; n++;
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (mask[j] && !label[j]) { label[j] = next; stack.push(j); }
      }
    }
    sizes.push(n);
  }
  // Moments per component in one pass.
  const sx = new Float64Array(next + 1), sy = new Float64Array(next + 1), sxx = new Float64Array(next + 1), syy = new Float64Array(next + 1), sxy = new Float64Array(next + 1);
  for (let i = 0; i < w * h; i++) { const id = label[i]; if (!id || sizes[id - 1] < 200) continue; const x = i % w, y = (i - x) / w; sx[id] += x; sy[id] += y; sxx[id] += x * x; syy[id] += y * y; sxy[id] += x * y; }
  let best: { score: number; axis: TapeAxis } | null = null;
  for (let id = 1; id <= next; id++) {
    const n = sizes[id - 1]; if (n < 200) continue;
    const cx = sx[id] / n, cy = sy[id] / n;
    const vxx = sxx[id] / n - cx * cx, vyy = syy[id] / n - cy * cy, vxy = sxy[id] / n - cx * cy;
    const theta = 0.5 * Math.atan2(2 * vxy, vxx - vyy);
    const dir = { x: Math.cos(theta), y: Math.sin(theta) };
    // Extents along and across the axis from the 1st and 99th percentiles: a blade of dry grass or a yellow petal stuck to the tape
    // must not widen its box.
    const ts: number[] = [], ss: number[] = [];
    for (let i = 0; i < w * h; i++) if (label[i] === id) {
      const x = i % w - cx, y = (i - (i % w)) / w - cy;
      ts.push(x * dir.x + y * dir.y); ss.push(-x * dir.y + y * dir.x);
    }
    ts.sort((u, v) => u - v); ss.sort((u, v) => u - v);
    const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * f)))];
    const tMin = q(ts, 0.01), tMax = q(ts, 0.99), sMin = q(ss, 0.01), sMax = q(ss, 0.99);
    const len = tMax - tMin, wid = sMax - sMin;
    if (len < 3 * wid || wid < 2) continue;
    const fill = n / (len * wid);
    if (fill < 0.25) continue;
    const halfLength = (len / 2) * scale, halfWidth = (wid / 2) * scale;
    // Centre of the extent (not the centroid: the hook and numerals skew it).
    const centre = { x: (cx + ((tMin + tMax) / 2) * dir.x) * scale, y: (cy + ((tMin + tMax) / 2) * dir.y) * scale };
    const score = n * fill;
    if (!best || score > best.score) best = { score, axis: { centre, dir, halfLength, halfWidth, pixels: n } };
  }
  return best ? best.axis : null;
}

/** The tape straightened: a luma image of `length` by `width` native pixels sampled along the axis. */
export function straighten(img: Rgba, tape: TapeAxis, margin = 1.3): { luma: Float32Array; yellow: Uint8Array; length: number; width: number; t0: number; s0: number } {
  const length = Math.round(2 * tape.halfLength), width = Math.round(2 * tape.halfWidth * margin);
  const t0 = -tape.halfLength, s0 = -tape.halfWidth * margin;
  const luma = new Float32Array(length * width), yellow = new Uint8Array(length * width);
  const nx = -tape.dir.y, ny = tape.dir.x;
  for (let s = 0; s < width; s++) for (let t = 0; t < length; t++) {
    const px = Math.round(tape.centre.x + (t0 + t) * tape.dir.x + (s0 + s) * nx), py = Math.round(tape.centre.y + (t0 + t) * tape.dir.y + (s0 + s) * ny);
    const i = s * length + t;
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) { luma[i] = 255; continue; }
    const o = (py * img.width + px) * 4, r = img.data[o], g = img.data[o + 1], b = img.data[o + 2];
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    yellow[i] = isYellow(r, g, b) ? 1 : 0;
  }
  return { luma, yellow, length, width, t0, s0 };
}

/** The normalised autocorrelation of a profile at one lag. */
export function autocorrAt(profile: Float32Array, lag: number): number {
  const n = profile.length; let mean = 0; for (let i = 0; i < n; i++) mean += profile[i]; mean /= n;
  let v = 0, s = 0; const L = Math.round(lag);
  for (let i = 0; i < n; i++) { const z = profile[i] - mean; v += z * z; if (i + L < n) s += z * (profile[i + L] - mean); }
  return v > 0 ? s / v : 0;
}

/** The autocorrelation peak of a profile between lags lo and hi: the strongest period in that range. */
export function dominantPeriod(profile: Float32Array, lo: number, hi: number): { period: number; strength: number } | null {
  const n = profile.length; let mean = 0; for (let i = 0; i < n; i++) mean += profile[i]; mean /= n;
  const z = new Float32Array(n); let v = 0; for (let i = 0; i < n; i++) { z[i] = profile[i] - mean; v += z[i] * z[i]; }
  if (v <= 0) return null;
  let best = -Infinity, bestLag = 0;
  for (let lag = Math.max(1, Math.floor(lo)); lag <= Math.min(n - 2, Math.ceil(hi)); lag++) {
    let s = 0; for (let i = 0; i + lag < n; i++) s += z[i] * z[i + lag];
    const r = s / v;
    if (r > best) { best = r; bestLag = lag; }
  }
  if (bestLag === 0) return null;
  // Refine with a parabola through the neighbours.
  const at = (lag: number) => { let s = 0; for (let i = 0; i + lag < n; i++) s += z[i] * z[i + lag]; return s / v; };
  const a = at(bestLag - 1), b = best, c = at(bestLag + 1), den = a - 2 * b + c;
  const off = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  return { period: bestLag + off, strength: best };
}

/** Local maxima of a profile above a floor, at least `minGap` apart; the position is each run's height-weighted centroid. */
export function peaks(profile: Float32Array, floor: number, minGap: number): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < profile.length) {
    if (profile[i] < floor) { i++; continue; }
    let j = i, sw = 0, swx = 0;
    while (j < profile.length && profile[j] >= floor) { const wgt = profile[j] - floor + 1e-6; sw += wgt; swx += wgt * j; j++; }
    // The position is the run's centroid weighted by its height above the floor: steadier than the deepest column under JPEG noise,
    // and less swayed than the plain centre by a numeral stroke that joins the run beside an inch tick.
    const centre = swx / sw;
    if (!out.length || centre - out[out.length - 1] >= minGap) out.push(centre); else if (profile[Math.round(centre)] > profile[Math.round(out[out.length - 1])]) out[out.length - 1] = centre;
    i = j;
  }
  return out;
}

/**
 * The tape body's width in inches, measured: on the photos whose inch is read unambiguously (sixteen fine ticks to a long tick)
 * the yellow body is 0.90 to 0.95 inch wide (a one-inch tape whose edges are not read as yellow); where a plant shades one edge
 * it reads narrower (0.72 on the kerb photo). It is used only to break the ambiguity of a coarse reading: eight fine ticks to a
 * long tick is an inch at eighth resolution or a half inch at sixteenth resolution, and the body width, within a quarter, tells
 * which (the readings are a factor of two apart). It is never the scale itself.
 */
export const TAPE_BODY_WIDTH_IN = 0.92;
const TAPE_BODY_WIDTH_TOLERANCE = 0.25;
/** Darkness relative to the row's own yellow above this is ink (0 on the yellow, towards 1 on black). */
const INK = 0.2;

/**
 * The finest period of a profile: the smallest lag whose autocorrelation is a
 * local maximum at least `share` of the strongest one in [lo, hi]. The
 * strongest peak is often a harmonic (the eighth-inch ticks are deeper than
 * the sixteenths, so the eighth's lag correlates better); the finest tick is
 * the smallest lag that still clearly repeats.
 */
export function finePeriod(profile: Float32Array, lo: number, hi: number, share = 0.5): { period: number; strength: number } | null {
  const n = profile.length; let mean = 0; for (let i = 0; i < n; i++) mean += profile[i]; mean /= n;
  const z = new Float32Array(n); let v = 0; for (let i = 0; i < n; i++) { z[i] = profile[i] - mean; v += z[i] * z[i]; }
  if (v <= 0) return null;
  const l0 = Math.max(2, Math.floor(lo)), l1 = Math.min(n - 2, Math.ceil(hi));
  const r = new Float32Array(l1 + 2);
  for (let lag = l0 - 1; lag <= l1 + 1; lag++) { let a = 0; for (let i = 0; i + lag < n; i++) a += z[i] * z[i + lag]; r[lag] = a / v; }
  const maxima: number[] = [];
  for (let lag = l0; lag <= l1; lag++) if (r[lag] > r[lag - 1] && r[lag] >= r[lag + 1] && r[lag] > 0.12) maxima.push(lag);
  if (!maxima.length) return null;
  let strongest = 0; for (const m of maxima) if (r[m] > strongest) strongest = r[m];
  const lag = maxima.find(m => r[m] >= share * strongest)!;
  const a = r[lag - 1], b = r[lag], c = r[lag + 1], den = a - 2 * b + c;
  const off = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  return { period: lag + off, strength: b };
}

/**
 * Fit weighted positions to a lattice, robustly: the base spacing is tried
 * from the modes of the consecutive spacings, the anchor from each position,
 * and the lattice with most members (each within `tol` of a lattice point,
 * one per index) wins. A numeral stroke, a grass blade across the tape or a
 * scuff is then simply not a member. If the members alternate in depth
 * (every other one clearly shallower: the half-inch ticks read along with
 * the inch ticks), the shallower parity is dropped and the spacing doubled.
 * Returns the least-squares spacing, the members, and the largest residual.
 */
export function fitLattice(pos: number[], depth: number[], tol: number, minMembers = 2, minBase = 0): { spacing: number; origin: number; members: number[]; index: number[]; occupancy: number; residual: number } | null {
  if (pos.length < minMembers) return null;
  // The modes of the consecutive spacings, by support within 6%.
  const sp: number[] = []; for (let i = 1; i < pos.length; i++) sp.push(pos[i] - pos[i - 1]);
  const modes = sp.map(x => ({ x, support: sp.filter(y => Math.abs(y / x - 1) <= 0.06).length })).sort((u, v) => v.support - u.support);
  const bases: number[] = [];
  for (const m of modes) { if (m.x >= Math.max(2 * tol, minBase) && !bases.some(bb => Math.abs(bb / m.x - 1) <= 0.06)) bases.push(m.x); if (bases.length >= 4) break; }
  let best: { base: number; anchor: number; members: number[] } | null = null;
  for (const base of bases) for (let ai = 0; ai < pos.length; ai++) {
    const byIndex = new Map<number, number>();
    for (let i = 0; i < pos.length; i++) {
      const k = Math.round((pos[i] - pos[ai]) / base);
      // The tolerance grows a little with distance (a tape seen slightly off nadir foreshortens), but not enough to admit a numeral stroke beside a far tick.
      if (Math.abs(pos[i] - pos[ai] - k * base) > tol + 0.005 * Math.abs(k * base)) continue;
      const prev = byIndex.get(k);
      if (prev === undefined || depth[i] > depth[prev]) byIndex.set(k, i);
    }
    const members = [...byIndex.values()].sort((u, v) => u - v);
    if (!best || members.length > best.members.length) best = { base, anchor: ai, members };
  }
  if (!best || best.members.length < minMembers) return null;
  let members = best.members, base = best.base;
  for (let round = 0; round < 3; round++) {
    const index = members.map(i => Math.round((pos[i] - pos[members[0]]) / base));
    const n = members.length; let si = 0, sx = 0, sii = 0, six = 0;
    for (let j = 0; j < n; j++) { si += index[j]; sx += pos[members[j]]; sii += index[j] * index[j]; six += index[j] * pos[members[j]]; }
    const den = n * sii - si * si; if (den === 0) return null;
    const spacing = (n * six - si * sx) / den, origin = (sx - spacing * si) / n;
    // Alternating depth: the deeper parity is the lattice, the other its halves.
    const even = members.filter((_, j) => index[j] % 2 === 0), odd = members.filter((_, j) => index[j] % 2 !== 0);
    const mean = (m: number[]) => m.reduce((acc, i) => acc + depth[i], 0) / Math.max(1, m.length);
    if (even.length >= 2 && odd.length >= 2 && Math.min(mean(even), mean(odd)) < 0.82 * Math.max(mean(even), mean(odd))) {
      members = mean(even) >= mean(odd) ? even : odd; base = spacing * 2; continue;
    }
    let residual = 0; for (let j = 0; j < n; j++) residual = Math.max(residual, Math.abs(pos[members[j]] - origin - spacing * index[j]));
    const span = index[n - 1] - index[0] + 1;
    return { spacing, origin, members, index, occupancy: n / span, residual };
  }
  return null;
}

/**
 * Calibrate from the straightened tape. Returns a failed calibration with a
 * reason rather than a number when the ticks cannot be read.
 */
export function calibrateFromTicks(st: ReturnType<typeof straighten>, opts: { minLongTicks?: number } = {}): Calibration {
  const { luma, yellow, length, width } = st;
  const minLong = opts.minLongTicks ?? 4;
  const none = (reason: string): Calibration => ({ status: "failed", method: "tick-periodicity", units: "unknown", pixelsPerCm: null, relativeUncertainty: null, inchPxFromLongTicks: null, inchPxFromFineTicks: null, longTicks: [], edge: null, localInchPx: [], driftAlongTape: null, bodyWidthPx: null, reason });
  if (length < 200) return none("the tape is too short in the picture to read its ticks");
  // The body's rows: where most columns are the tape's yellow. Ink alone does not count: dark grass beside the tape would read as body.
  const rowFill = new Float32Array(width);
  for (let s = 0; s < width; s++) { let n = 0; for (let t = 0; t < length; t++) if (yellow[s * length + t]) n++; rowFill[s] = n / length; }
  let top = 0; while (top < width && rowFill[top] < 0.4) top++;
  let bottom = width - 1; while (bottom > top && rowFill[bottom] < 0.4) bottom--;
  const bodyWidth = bottom - top + 1;
  if (bodyWidth < 12) return none("the tape's body is too narrow in the picture");
  // Each row's own yellow: its 60th percentile luma (the ticks and numerals are the dark minority). Ink is darkness against that.
  const ref = new Float32Array(width);
  for (let s = top; s <= bottom; s++) { const v: number[] = []; for (let t = 0; t < length; t += 3) v.push(luma[s * length + t]); v.sort((a, b) => a - b); ref[s] = Math.max(1, v[Math.floor(v.length * 0.6)]); }
  const dark = (s: number, t: number) => Math.max(0, (ref[s] - luma[s * length + t]) / ref[s]);
  // The rows read: the body less a blurred margin at each edge; the fine-tick bands: the outer third of the body from each edge.
  const inset = Math.max(1, Math.round(0.06 * bodyWidth));
  const s1 = top + inset, s2 = bottom - inset;
  const bandRows = Math.max(2, Math.round(0.3 * bodyWidth));
  const bandTop = new Float32Array(length), bandBottom = new Float32Array(length), coverage = new Float32Array(length);
  const rows = s2 - s1 + 1;
  for (let t = 0; t < length; t++) {
    let a = 0, b = 0, inked = 0;
    for (let s = s1; s <= s2; s++) {
      const d = dark(s, t);
      if (s < s1 + bandRows) a += d; if (s > s2 - bandRows) b += d;
      let m = d; for (let dt = -2; dt <= 2; dt++) { const tt = t + dt; if (tt >= 0 && tt < length) { const x = dark(s, tt); if (x > m) m = x; } }
      if (m > INK) inked++;
    }
    bandTop[t] = a / bandRows; bandBottom[t] = b / bandRows; coverage[t] = inked / rows;
  }
  let sumTop = 0, sumBottom = 0; for (let t = 0; t < length; t++) { sumTop += bandTop[t]; sumBottom += bandBottom[t]; }
  const edge: "top" | "bottom" = sumTop >= sumBottom ? "top" : "bottom";
  const band = new Float32Array(length); for (let t = 0; t < length; t++) band[t] = bandTop[t] + bandBottom[t];
  // The fine period, from the autocorrelation of the band darkness: a tick a few pixels wide repeats every sixteenth; the search spans a fiftieth to a half of the body width.
  const fine = finePeriod(band, Math.max(4, bodyWidth / 50), bodyWidth / 2);
  if (!fine) return none("no periodic fine ticks were found along the tape's edges");
  // The long ticks: the columns inked across most of the body, at least two fine ticks apart. The deepest class on one lattice is the inch
  // ticks; numeral strokes and grass blades across the tape are deep too, so the lattice fit must leave them out.
  let maxCov = 0; for (let t = 0; t < length; t++) if (coverage[t] > maxCov) maxCov = coverage[t];
  if (maxCov < 0.35) return none("no tick runs across the tape; the deepest ink covers " + (maxCov * 100).toFixed(0) + "% of the body");
  // The deepest class first: the candidates are taken down a ladder of shares of the deepest ink, and the first lattice with enough
  // members, at least half occupied, wins; a long tick is never within six fine ticks of another (an inch has sixteen, a half inch
  // eight, a centimetre ten; a quarter-inch lattice is never taken).
  let lat: ReturnType<typeof fitLattice> = null, deepPos: number[] = [];
  for (const share of [0.8, 0.7, 0.6, 0.5]) {
    deepPos = peaks(coverage, share * maxCov, 2 * fine.period);
    if (deepPos.length < minLong) continue;
    const fit = fitLattice(deepPos, deepPos.map(t => coverage[Math.round(t)]), Math.max(2, fine.period / 3), minLong, 6 * fine.period);
    if (fit && fit.members.length >= minLong && fit.occupancy >= 0.5) { lat = fit; break; }
  }
  if (!lat) return none(`${deepPos.length} long tick(s) run across the tape but fewer than ${minLong} sit on one lattice`);
  // Extend the lattice outward from its members by tracking: the next tick is predicted from the local spacing, which may drift a
  // few percent per inch (a tape seen off nadir foreshortens along its length) but not jump; the nearest candidate down to half the
  // deepest ink within a tight tolerance is taken, up to three ticks in a row may be missing (a numeral, a blade), and a candidate
  // that would jump the spacing is a stroke, not a tick. The result is every inch tick with its own local spacing.
  const tol = Math.max(2, fine.period / 3);
  const all = peaks(coverage, 0.5 * maxCov, 2 * fine.period);
  const tracked: { k: number; t: number }[] = lat.members.map((i, j) => ({ k: lat!.index[j], t: deepPos[i] }));
  for (const dirn of [1, -1]) {
    let d = lat.spacing;
    for (let guard = 0; guard < 200; guard++) {
      const last = dirn > 0 ? tracked[tracked.length - 1] : tracked[0];
      let found: { k: number; t: number } | null = null;
      for (let gap = 1; gap <= 4 && !found; gap++) {
        const predicted = last.t + dirn * d * gap;
        if (predicted < 0 || predicted >= length) break;
        let nearest: number | null = null;
        for (const c of all) if (Math.abs(c - predicted) <= tol + 0.01 * d * gap && (nearest === null || Math.abs(c - predicted) < Math.abs(nearest - predicted))) nearest = c;
        if (nearest === null) continue;
        const dd = Math.abs(nearest - last.t) / gap;
        if (Math.abs(dd / d - 1) > 0.04 * gap) continue;
        found = { k: last.k + dirn * gap, t: nearest }; d = dd;
      }
      if (!found) break;
      if (dirn > 0) tracked.push(found); else tracked.unshift(found);
    }
  }
  // Trim the ends: an end member whose spacing to its neighbour is off the median by over 6% is a stroke (the hook's shadow, a
  // numeral at the far end), not a tick.
  for (let guard = 0; guard < 10 && tracked.length > minLong; guard++) {
    const sp = tracked.slice(1).map((m, i) => (m.t - tracked[i].t) / (m.k - tracked[i].k)).sort((u, v) => u - v);
    const med = sp[Math.floor(sp.length / 2)];
    const first = (tracked[1].t - tracked[0].t) / (tracked[1].k - tracked[0].k), last = (tracked[tracked.length - 1].t - tracked[tracked.length - 2].t) / (tracked[tracked.length - 1].k - tracked[tracked.length - 2].k);
    if (Math.abs(first / med - 1) > 0.06) tracked.shift(); else if (Math.abs(last / med - 1) > 0.06) tracked.pop(); else break;
  }
  // Local spacings between consecutive tracked ticks, per inch of index; the inch is their median, the drift their spread.
  const local: { t: number; inchPx: number }[] = [];
  for (let i = 1; i < tracked.length; i++) local.push({ t: (tracked[i].t + tracked[i - 1].t) / 2, inchPx: (tracked[i].t - tracked[i - 1].t) / (tracked[i].k - tracked[i - 1].k) });
  const sortedLocal = local.map(l => l.inchPx).sort((u, v) => u - v);
  const medianInch = sortedLocal[Math.floor(sortedLocal.length / 2)];
  const drift = (sortedLocal[sortedLocal.length - 1] - sortedLocal[0]) / medianInch;
  // Noise about the drift: each spacing against the mean of its neighbours.
  let noise = 0; for (let i = 1; i < local.length - 1; i++) noise = Math.max(noise, Math.abs(local[i].inchPx - (local[i - 1].inchPx + local[i + 1].inchPx) / 2) / medianInch);
  lat = { spacing: medianInch, origin: tracked[0].t, members: tracked.map((_, i) => i), index: tracked.map(m => m.k), occupancy: tracked.length / (tracked[tracked.length - 1].k - tracked[0].k + 1), residual: noise * medianInch };
  deepPos = tracked.map(m => m.t);
  const longPx = lat.spacing, ratio = longPx / fine.period;
  const lattice = lat.members.map(i => deepPos[i]);
  // The unit and the reading. The lattice spacing over the fine period is a power of two on an inch tape (sixteen when the
  // sixteenths are resolved and the lattice is the inch; thirty-two when the lattice is two inches, or the thirty-seconds of the
  // first foot are resolved; eight when the eighths are the finest resolved, or the lattice is the half inch) and ten or five on a
  // metric tape. Each power of two admits readings of the inch a factor of two apart; the body width, measured on the photos,
  // decides between them, within a quarter. A metric reading is refused in this version.
  const near = (n: number) => Math.abs(ratio / n - 1) <= 0.1;
  if (near(10) || near(5) || near(20)) return none(`the tape reads as metric (${ratio.toFixed(1)} fine ticks per long tick); only inch tapes are calibrated in this version`);
  const ratioN = [4, 8, 16, 32].find(near) ?? null;
  if (ratioN === null) return none(`the long ticks are ${ratio.toFixed(1)} fine ticks apart; an inch tape gives a power of two, a metric one ten`);
  let factor = 0, fineDiv = 0, widthOff = Infinity;
  for (const f of [0.5, 1, 2, 4]) {
    const div = ratioN * f; if (![4, 8, 16, 32].includes(div)) continue;
    const off = Math.abs((bodyWidth / (longPx * f)) / TAPE_BODY_WIDTH_IN - 1);
    if (off < widthOff) { widthOff = off; factor = f; fineDiv = div; }
  }
  if (widthOff > TAPE_BODY_WIDTH_TOLERANCE) return none(`the long ticks are ${ratio.toFixed(1)} fine ticks apart and the body width (${(bodyWidth / longPx).toFixed(2)} lattice spacings) matches no reading of the inch within a quarter of the ${TAPE_BODY_WIDTH_IN} inch measured on the other photos`);
  const inchPx = longPx * factor;
  const expected = fine.period * fineDiv;
  const disagreement = Math.abs(expected - inchPx) / inchPx;
  // The fine period is read to about half a pixel; at fifteen pixels a sixteenth that is three percent on its own. Only disagreement
  // beyond that resolution says something is wrong with the inch.
  const fineResolution = 0.5 / fine.period;
  const excess = Math.max(0, disagreement - fineResolution);
  // The uncertainty: the spacing noise, the disagreement beyond the fine resolution, and half the drift along the tape (the scale at the
  // plant, off the tape, is not known better than the scale's variation along it).
  const residual = lat.residual / longPx;
  const rel = Math.max(0.005, residual, excess, drift / 2);
  const pixelsPerCm = pixelsPerCmFromInchPx(inchPx);
  const status: Calibration["status"] = rel <= 0.03 ? "ok" : rel <= 0.08 ? "uncertain" : "failed";
  const note = (fineDiv === 8 ? "; the sixteenths are not resolved, the eighths were read" : fineDiv === 4 ? "; the sixteenths and eighths are not resolved, the quarters were read" : fineDiv === 32 ? "; thirty-seconds were read" : "")
    + (factor !== 1 ? `; the lattice read is ${factor === 0.5 ? "two inches" : factor === 2 ? "the half inch" : "the quarter inch"}, told by the body width` : "");
  return {
    status, method: "tick-periodicity", units: "inch", pixelsPerCm: status === "failed" ? null : pixelsPerCm, relativeUncertainty: rel,
    inchPxFromLongTicks: inchPx, inchPxFromFineTicks: expected, longTicks: lattice.map(t => t + st.t0), edge,
    localInchPx: local.map(l => ({ t: l.t + st.t0, inchPx: l.inchPx * factor })), driftAlongTape: drift, bodyWidthPx: bodyWidth,
    reason: status === "failed" ? `spacing noise ${(residual * 100).toFixed(1)}% over ${lattice.length} ticks, drift ${(drift * 100).toFixed(1)}% along the tape; the inch-tick lattice (${inchPx.toFixed(1)} px) and ${fineDiv} fine ticks (${expected.toFixed(1)} px) disagree by ${(disagreement * 100).toFixed(1)}% against a fine resolution of ${(fineResolution * 100).toFixed(1)}%${note}`
      : status === "uncertain" ? `${lattice.length} ticks; spacing noise ${(residual * 100).toFixed(1)}%, drift ${(drift * 100).toFixed(1)}% along the tape, fine and long estimates differ ${(disagreement * 100).toFixed(1)}% (fine resolution ${(fineResolution * 100).toFixed(1)}%)${note}` : (note ? note.slice(2) : null),
  };
}

/** A point along the tape axis at `t` native pixels from its centre, offset `s` across. */
export const alongTape = (tape: TapeAxis, t: number, s = 0): Pt => ({ x: tape.centre.x + t * tape.dir.x - s * tape.dir.y, y: tape.centre.y + t * tape.dir.y + s * tape.dir.x });

/** The inch in pixels at `t` along the tape (native pixels from its centre): the nearest local spacing, or the overall inch. */
export function inchPxAt(cal: Calibration, t: number): number | null {
  if (!cal.localInchPx.length) return cal.inchPxFromLongTicks;
  let best = cal.localInchPx[0];
  for (const l of cal.localInchPx) if (Math.abs(l.t - t) < Math.abs(best.t - t)) best = l;
  return best.inchPx;
}
