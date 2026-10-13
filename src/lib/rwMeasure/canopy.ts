// The canopy: the broadleaf plant cut out of grass, soil, tape and shadow.
//
// Grass and a broadleaf are both green. What tells them apart from above is
// shape and light: a leaf is a lit patch several millimetres wide with no
// dark gaps in it, grass is thin blades with shadow between them. So: the
// vegetation index (chromaticity, so a shaded leaf is still green) and a
// luma above the green pixels' own 30th percentile give "lit green"; an
// opening with a disc wider than a blade keeps the leaves (no gap inside
// them) and drops the grass (gaps everywhere); the opened pieces are the
// plant cores. Measured on the real photos: local texture could not tell
// them apart at this scale (a lawn's blades are as wide as the window), the
// lit-green opening could. The target is the core nearest the tape (the
// photographer laid the tape beside the plant), weighted by size and by
// nearness to the picture's centre. A rosette's leaves open into separate
// cores (the dark centre between them is not lit green), so cores within a
// small gap of the chosen one are joined, chained, into one canopy; the
// result says how many were joined, and a person decides whether they are
// one plant. The joined core is then grown back to the leaf edges within the
// green mask, by at most the opening radius and a margin, so the outline is
// the leaf's and not the disc's. The tape's yellow and deep shadow are never
// canopy. Where an unjoined core is inside the grown mask, the mask is
// "merged" and the measurement says so.
//
// Works at a reduced scale given in pixels per centimetre, so the disc is a
// physical size: a blade is thinner than 6 mm, a leaf wider.
import { combinedIndex } from "../weedScout/vegetation";
import { distanceInside } from "../photoScout/pattern";
import { isYellow, type Rgba } from "./tape";
import type { Pt, SegmentationQuality, TargetSelection } from "./types";

/** The opening disc's radius, centimetres: wider than a grass blade, narrower than a leaf. */
export const OPEN_RADIUS_CM = 0.35;
/** The core grows back to the leaf edge by this much beyond the opening radius, centimetres. */
export const GROW_MARGIN_CM = 0.15;
/** A core under this many square centimetres is not a target. */
export const MIN_CORE_CM2 = 1.5;
/** Cores within this gap of the chosen canopy, centimetres, are joined into it: the leaves of one rosette. */
export const JOIN_GAP_CM = 0.7;
/** This many joined cores or more is a patch (clover, a mat of seedlings), not one plant: the measurement is of the patch and says so. */
export const PATCH_CORES = 8;
/** An unjoined core within this distance of the canopy, centimetres, may be a shaded leaf of the same plant: the result is uncertain until a person says. */
export const NEAR_CORE_CM = 2.5;
/** A second core with at least this share of the best's score is a plausible target too. */
export const REVIEW_SHARE = 0.5;
/** Luma under this is deep shadow, never canopy. */
export const SHADOW_LUMA = 35;
/**
 * Lit green: luma above this percentile of the green pixels' luma. A leaf has no dark gap inside it; a lawn has shadow between
 * its blades every few millimetres, so dropping the darkest green and opening with a disc wider than a blade keeps the leaves and
 * loses the grass. Measured on the real photos: at the 60th percentile a dandelion darker than its lawn (0112) lost most of its
 * leaves (17 cm2 of about 70); at the 25th to 35th it was whole and the grass still fell out; the rosette on the kerb (0097) read
 * the same at every setting. Thirty.
 */
export const LIT_PERCENTILE = 0.3;
/** Green over this share of the picture is a lawn, where the lit-green rule applies; under it the green is the plant. */
export const LAWN_GREEN_SHARE = 0.35;
/** A core's score is discounted by its distance from the tape's axis in tape widths over this: the tape was laid near the plant, not always beside it. */
export const TAPE_REACH_WIDTHS = 6;

export type Working = { width: number; height: number; scale: number; pixelsPerCm: number; green: Uint8Array; smooth: Uint8Array; luma: Float32Array };

/** The reduced image's green mask, smooth-green mask and luma. */
export function prepare(img: Rgba, scale: number, nativePixelsPerCm: number, opts: { litPercentile?: number } = {}): Working {
  const w = Math.floor(img.width / scale), h = Math.floor(img.height / scale);
  const luma = new Float32Array(w * h), index = new Float32Array(w * h), green = new Uint8Array(w * h), yellow = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // Box-average the scale x scale block.
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const o = ((y * scale + dy) * img.width + x * scale + dx) * 4; r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; }
    const n = scale * scale; r /= n; g /= n; b /= n;
    const i = y * w + x, tot = r + g + b;
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    index[i] = tot > 0 ? combinedIndex(r / tot, g / tot, b / tot) : -2;
    yellow[i] = isYellow(r, g, b) ? 1 : 0;
  }
  // Otsu on the index.
  const bins = 512, lo = -1.5, hi = 2.5, hist = new Float64Array(bins);
  for (let i = 0; i < w * h; i++) { const t = Math.min(bins - 1, Math.max(0, Math.floor(((index[i] - lo) / (hi - lo)) * bins))); hist[t]++; }
  let total = 0, sumAll = 0; for (let i = 0; i < bins; i++) { total += hist[i]; sumAll += i * hist[i]; }
  let wB = 0, sumB = 0, best = -1, bestI = 0;
  for (let i = 0; i < bins; i++) { wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break; sumB += i * hist[i]; const mB = sumB / wB, mF = (sumAll - sumB) / wF; const v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; bestI = i; } }
  // A lawn is nearly all vegetation: Otsu then splits the grass by brightness. Floor the threshold at a modest positive index so soil stays out and green stays in.
  const thr = Math.max(0.08, lo + ((bestI + 1) / bins) * (hi - lo) * (total ? 1 : 1));
  for (let i = 0; i < w * h; i++) green[i] = index[i] > Math.min(thr, 0.25) && !yellow[i] && luma[i] >= SHADOW_LUMA ? 1 : 0;
  // Lit green: the green pixels above their own luma percentile.
  const gl: number[] = []; for (let i = 0; i < w * h; i++) if (green[i]) gl.push(luma[i]);
  gl.sort((a, b) => a - b);
  // In a lawn the grass sets the luma distribution and the leaves sit above its 60th percentile; on soil or pavement the green IS the plant and no luma floor applies.
  const greenShare = gl.length / (w * h);
  const lit = greenShare >= LAWN_GREEN_SHARE && gl.length ? gl[Math.floor(gl.length * (opts.litPercentile ?? LIT_PERCENTILE))] : -1;
  const smooth = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) smooth[i] = green[i] && luma[i] > lit ? 1 : 0;
  return { width: w, height: h, scale, pixelsPerCm: nativePixelsPerCm / scale, green, smooth, luma };
}

/** Morphological opening by a disc of radius r, via distance transforms. */
export function open(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const d = distanceInside(mask, w, h);
  const eroded = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) eroded[i] = d[i] > r ? 1 : 0;
  return dilate(eroded, w, h, r);
}
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1;
  const d = distanceInside(inv, w, h);
  const out = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) out[i] = mask[i] || d[i] <= r ? 1 : 0;
  return out;
}

export type Component = { id: number; n: number; cx: number; cy: number; minX: number; maxX: number; minY: number; maxY: number };

export function components(mask: Uint8Array, w: number, h: number, labels: Int32Array): Component[] {
  labels.fill(0);
  const out: Component[] = []; const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || labels[s]) continue;
    const id = out.length + 1; labels[s] = id; stack.push(s);
    const c: Component = { id, n: 0, cx: 0, cy: 0, minX: w, maxX: -1, minY: h, maxY: -1 };
    while (stack.length) {
      const i = stack.pop()!; const x = i % w, y = (i - x) / w;
      c.n++; c.cx += x; c.cy += y; if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x; if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; if (mask[j] && !labels[j]) { labels[j] = id; stack.push(j); } }
    }
    c.cx /= c.n; c.cy /= c.n; out.push(c);
  }
  return out;
}

export type CanopyResult = {
  target: TargetSelection;
  quality: SegmentationQuality;
  /** The final mask at the working scale. */
  mask: Uint8Array;
  /** The chosen core, for the overlay. */
  core: Uint8Array;
};

/**
 * Select the target and cut its canopy. `override` is a person's choice of
 * plant (native pixels); `erase` their discs to remove (native pixels).
 */
export function segmentCanopy(wk: Working, opts: { override?: Pt | null; erase?: { x: number; y: number; r: number }[] | null; /** The tape's axis, native pixels: cores far from it are not the target. */ tape?: { centre: Pt; dir: Pt; halfWidth: number } | null; /** A person's join gap, centimetres, in place of JOIN_GAP_CM. */ joinGapCm?: number | null } = {}): CanopyResult {
  const { width: w, height: h, scale, pixelsPerCm } = wk;
  const rOpen = OPEN_RADIUS_CM * pixelsPerCm, rGrow = (OPEN_RADIUS_CM + GROW_MARGIN_CM) * pixelsPerCm;
  const opened = open(wk.smooth, w, h, rOpen);
  const labels = new Int32Array(w * h);
  const cores = components(opened, w, h, labels).filter(c => c.n >= MIN_CORE_CM2 * pixelsPerCm * pixelsPerCm);
  const fail = (reason: string): CanopyResult => ({
    target: { status: "none", centre: null, alternatives: [], method: opts.override ? "manual" : "centre-weighted-core", reason },
    quality: { status: "failed", coreShare: null, touchesImageEdge: false, mergedWithAlternative: false, maskPixels: 0, pieces: 0, joinedCores: 0, nearbyCores: 0, reason },
    mask: new Uint8Array(w * h), core: new Uint8Array(w * h),
  });
  if (!cores.length) return fail("no smooth broadleaf patch of at least " + MIN_CORE_CM2 + " cm2 was found");
  // Score: area, discounted by distance from the picture's centre and, softly, by distance from the tape's axis.
  const diag = Math.hypot(w, h);
  const across = (c: Component): number | null => {
    if (!opts.tape) return null;
    const dx = c.cx * scale - opts.tape.centre.x, dy = c.cy * scale - opts.tape.centre.y;
    return Math.abs(-dx * opts.tape.dir.y + dy * opts.tape.dir.x) / Math.max(1, opts.tape.halfWidth * 2);
  };
  const scored = cores.map(c => ({ c, score: c.n / (1 + Math.hypot(c.cx - w / 2, c.cy - h / 2) / (0.25 * diag)) / (1 + (across(c) ?? 0) / TAPE_REACH_WIDTHS) })).sort((a, b) => b.score - a.score);
  let chosen = scored[0].c, method: TargetSelection["method"] = "centre-weighted-core";
  if (opts.override) {
    const ox = opts.override.x / scale, oy = opts.override.y / scale;
    const at = labels[Math.round(oy) * w + Math.round(ox)];
    const hit = cores.find(c => c.id === at) ?? cores.reduce((b, c) => (Math.hypot(c.cx - ox, c.cy - oy) < Math.hypot(b.cx - ox, b.cy - oy) ? c : b));
    chosen = hit; method = "manual";
  }
  // Join the cores within JOIN_GAP_CM of the chosen one, chained: the leaves of one rosette.
  const joined = new Set<number>([chosen.id]);
  const core = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) core[i] = labels[i] === chosen.id ? 1 : 0;
  const rJoin = (opts.joinGapCm ?? JOIN_GAP_CM) * pixelsPerCm;
  for (let round = 0; round < 12; round++) {
    const reach = dilate(core, w, h, rJoin);
    const found = new Set<number>();
    for (let i = 0; i < w * h; i++) if (reach[i] && labels[i] && !joined.has(labels[i]) && cores.some(c => c.id === labels[i])) found.add(labels[i]);
    if (!found.size) break;
    for (const id of found) joined.add(id);
    for (let i = 0; i < w * h; i++) if (joined.has(labels[i])) core[i] = 1;
  }
  const joinedArea = cores.filter(c => joined.has(c.id)).reduce((a, c) => a + c.n, 0);
  const chosenScore = scored.find(s => s.c === chosen)!.score * (joinedArea / chosen.n);
  const others = scored.filter(s => !joined.has(s.c.id));
  const alternatives = others.slice(0, 4).map(s => ({ centre: { x: s.c.cx * scale, y: s.c.cy * scale }, areaPx: s.c.n * scale * scale }));
  const review = method !== "manual" && others.length > 0 && others[0].score >= REVIEW_SHARE * chosenScore;
  // The joined core, grown back to the leaf edge within the green mask.
  const reach = dilate(core, w, h, rGrow);
  const mask = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) mask[i] = reach[i] && wk.green[i] ? 1 : 0;
  for (const e of opts.erase ?? []) { const ex = e.x / scale, ey = e.y / scale, er = e.r / scale; for (let y = Math.max(0, Math.floor(ey - er)); y <= Math.min(h - 1, Math.ceil(ey + er)); y++) for (let x = Math.max(0, Math.floor(ex - er)); x <= Math.min(w - 1, Math.ceil(ex + er)); x++) if ((x - ex) ** 2 + (y - ey) ** 2 <= er * er) mask[y * w + x] = 0; }
  // Quality.
  let maskN = 0, coreN = 0, edge = false;
  for (let i = 0; i < w * h; i++) if (mask[i]) { maskN++; if (core[i]) coreN++; const x = i % w, y = (i - x) / w; if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true; }
  const otherCoreInside = cores.some(c => !joined.has(c.id) && mask[Math.round(c.cy) * w + Math.round(c.cx)] === 1);
  const pieces = components(mask, w, h, new Int32Array(w * h)).length;
  // Unjoined cores near the canopy: a shaded leaf of the same plant, or a neighbour. Not decided here.
  const nearReach = dilate(mask, w, h, NEAR_CORE_CM * pixelsPerCm);
  const nearby = new Set<number>(); for (let i = 0; i < w * h; i++) if (nearReach[i] && labels[i] && !joined.has(labels[i]) && cores.some(cc => cc.id === labels[i])) nearby.add(labels[i]);
  const coreShare = maskN ? coreN / maskN : 0;
  let status: SegmentationQuality["status"] = "isolated";
  let reason: string | null = null;
  if (!maskN) { status = "failed"; reason = "the grown mask is empty"; }
  else if (edge) { status = "edge-cut"; reason = "the canopy touches the picture's edge"; }
  else if (otherCoreInside) { status = "merged"; reason = "another plausible plant's core lies inside the grown mask"; }
  else if (coreShare < 0.45) { status = "touching-vegetation"; reason = `only ${(coreShare * 100).toFixed(0)}% of the mask is smooth leaf: thin material (grass or stems) was taken in at the edges`; }
  else if (joined.size >= PATCH_CORES) { status = "uncertain"; reason = `${joined.size} leaf cores joined: a patch of many plants, not one; the measurement is the patch's extent`; }
  else if (review) { status = "uncertain"; reason = "a second plant scored nearly as well as the target; the choice needs a person"; }
  else if (nearby.size) { status = "uncertain"; reason = `${nearby.size} leaf core(s) within ${NEAR_CORE_CM} cm were not joined; whether they belong to this plant needs a person (set joinGapCm in the review file to join them)`; }
  return {
    target: { status: method === "manual" ? "selected" : review ? "review" : "selected", centre: { x: chosen.cx * scale, y: chosen.cy * scale }, alternatives, method, reason: [joined.size > 1 ? `${joined.size} leaf cores within ${JOIN_GAP_CM} cm joined as one canopy` : null, review ? `runner-up core scored ${(others[0].score / chosenScore * 100).toFixed(0)}% of the target's` : null].filter(Boolean).join("; ") || null },
    quality: { status, coreShare: +coreShare.toFixed(3), touchesImageEdge: edge, mergedWithAlternative: otherCoreInside, maskPixels: maskN * scale * scale, pieces, joinedCores: joined.size, nearbyCores: nearby.size, reason },
    mask, core,
  };
}

/** Boundary pixels of a mask (4-neighbour), as points. */
export function boundary(mask: Uint8Array, w: number, h: number): Pt[] {
  const out: Pt[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!mask[i]) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) out.push({ x, y });
  }
  return out;
}
