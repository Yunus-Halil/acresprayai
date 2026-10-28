// Stage 4: the weed model on every original photograph, reconciled into one object per plant and classed
// against the trees and rows. The port of scripts/directGeoref/m1Weeds.ts (milestone 1).
import { type AdjustModel, type GeorefFrame, type GreenOptions, type Observation, type ReconciledObject, greenPatches, groundSampleAt, groundToPixel, pixelToGround, reconcile, vegetationObjects } from "../../directGeoref";
import type { Pool } from "./pool";
import { type TilePlan, chooseViews, planTiles, runRings, tilesAt } from "./views";
import type { PhotoPixels } from "../../photoScout/pattern";
import { toEnu } from "../../sourceFrames/odm";
import type { WeedInstance, WeedVisionResult } from "../../weedVision/client";
import { LAYOUT_BAND_M } from "../../weedVision/layout/plantingLayout";
import type { RowsResult } from "./rows";
import { type BuildHooks, type DetectPlan, type PhotoSource, type WeedDetector, checkCancelled } from "./types";

const quant = (v: number[], q: number) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(q * (s.length - 1))] : NaN; };
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const thin = (poly: [number, number][], n = 32) => { if (poly.length <= n) return poly; const step = poly.length / n; return Array.from({ length: n }, (_, i) => poly[Math.floor(i * step)]); };
const polyArea = (p: [number, number][]) => Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0)) / 2;

export type BuildWeed = {
  id: number; lat: number; lng: number; heightM: number | null; diameterM: number; areaM2: number; spanM: number | null; sizeCv: number; viewSpreadM: number;
  seenBy: number; coveredBy: number; runBy: number; onTree: boolean; treeId: number | null; rowStatus: "on a row" | "between rows" | "no rows"; verified: boolean; score: number | null;
  members: { frame: string; id: number; u: number; v: number; sizeM: number; poly: [number, number][] }[];
};

/** Which weed pass ran: the model through the injected detector, the colour rules on the photographs' own pixels, or none. */
export type WeedTier = "model" | "colour" | "none";

export type WeedsResult = { tier: WeedTier; weeds: BuildWeed[]; detections: number; photographsRun: number; photographsFailed: { name: string; reason: string }[]; stats: Record<string, unknown>; settings: Record<string, unknown>; /** One line for the bundle's `source.weedModel`. */ describe: string; /** How the views were chosen, when they were. */ views: { rule: string; views: number; tilesTotal: number; tilesFirst: number; tilesThird: number } | null };

export type WeedsOptions = {
  tier: WeedTier;
  /** Helper workers for the colour pass; the photographs' files are needed for it. */
  pool?: Pool | null;
  files?: Map<string, Blob>;
  colourDown?: number;
  /** Model tier: nearest views per ground cell to run (0 = all tiles), and the detector's tile plan. */
  views?: number;
  plan?: DetectPlan;
  /** Colour tier: the pixels to read (a quarter decode, or the camera's preview), per photograph. */
  colourPixels?: (name: string) => Promise<PhotoPixels>;
  /** Colour tier: patches smaller than this are left out, square metres. */
  colourMinM2?: number;
  /** Colour tier: the green rules (green.ts), over COLOUR_GREEN. */
  colourGreen?: Partial<GreenOptions>;
};

/** The longest distance between two points of a polygon, pixels. */
const spanOf = (p: [number, number][]): number => { let m = 0; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) m = Math.max(m, Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1])); return m; };

/**
 * Weed observations from the service's answer for one photograph, measured on the ground at their own pixel size.
 * The span comes from the answer when it holds one ("full" geometry) and from the outline otherwise ("lite").
 */
export function observationsOf(name: string, f: GeorefFrame, list: WeedInstance[]): Observation[] {
  const obs: Observation[] = [];
  for (const i of list) {
    const [u, v] = i.centroid_px;
    const gsd = groundSampleAt(f, u, v);
    if (gsd == null) continue;
    const largest = i.polygons_px.length ? i.polygons_px.reduce((a, b) => (polyArea(b) > polyArea(a) ? b : a)) : null;
    const poly = largest ? thin(largest) : [];
    const spanPx = i.max_span_px ?? (largest && largest.length >= 2 ? spanOf(poly) : null);
    obs.push({ frame: name, id: i.id, u: u + 0.5, v: v + 0.5, sizeM: i.equivalent_diameter_px * gsd, areaM2: i.area_px * gsd * gsd, touchesEdge: i.touches_border, data: { score: i.score, spanM: spanPx != null ? spanPx * gsd : null, poly } });
  }
  return obs;
}

/**
 * The colour tier: green patches (ExGR over bare soil, connected components of 2-pixel cells) in a photograph's
 * own pixels become weed observations, each with its hull as the outline. Patches on the field's crowns are
 * classed "on a tree" by the same rule the model's detections are; the small, the dark and the yellowing are
 * what this tier misses (measured on the apricot flight: see the speed document).
 */
/** A reconciled crown for the colour pass: its centre and radius. */
export type CrownRef = { lat: number; lng: number; r: number; /** Height above the ground, metres, when measured. */ h?: number | null };

/** The colour tier's rules (green.ts) as the twin runs them, measured on DJI_0301's labels (scripts/directGeoref/colourBench.ts): 1-pixel cells of 2 or more, the threshold relative to the soil around the plant, a patch under 4 cells standing 0.25 above its soil, patches over 0.3 m² split at their plants. */
export const COLOUR_GREEN: Partial<GreenOptions> = { index: "exgr-soil", cellPx: 1, minCells: 2, splitM2: 0.3, peakSepM: 0.2, smallCells: 4, smallMargin: 0.25 };
/**
 * Each reconciled crown's disc, its radius times CROWN_SCALE plus CROWN_MARGIN_M, is cut out of the green mask
 * before the patches are found: what is inside is the tree, and a weed strip running into the crown ends at the
 * disc's edge instead of going with it. The reconciled radius is the crown's core as the row reader measures it;
 * the foliage reaches further (on the apricot twin about 1.3 times), and a crown's shoots beyond the core were the
 * "weeds" ringing every tree in the first run. Dropping whole patches that touch a crown was measured too and
 * halved the labelled weeds found: the strips under the drip line touch the crowns.
 */
export const CROWN_SCALE = 1.0;
export const CROWN_MARGIN_M = 0.3;
/**
 * Beyond the cut disc, a patch that lies WHOLLY within CROWN_FRINGE_SCALE times the radius plus the margin is the
 * crown's fringe and is dropped whole. Measured on DJI_0301's labels (colourBench v18 to v20): at 1.3 it drops
 * 31 % of the unlabelled candidates and 12 % of the labelled weeds, at 1.8 both by two thirds; the unlabelled
 * candidates near crowns are weeds as often as elsewhere. Off (0) by default; kept for a field where it is not so.
 */
export const CROWN_FRINGE_SCALE = 0;

/** Whether every one of the patch's points (its centre and hull vertices) falls inside some crown's disc at `scale` times its radius plus `marginM`. */
export function patchInsideCrowns(f: GeorefFrame, patch: { u: number; v: number; hull: [number, number][] }, crowns: CrownRef[], scale: number, marginM: number): boolean {
  if (!crowns.length) return false;
  const lat0 = f.pose.lat, mLat = 111_320, mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  for (const [u, v] of [[patch.u, patch.v] as [number, number], ...patch.hull]) {
    const g = pixelToGround(f, u, v);
    if (!g) return false;
    const e = (g.lng - f.pose.lng) * mLng, n = (g.lat - lat0) * mLat;
    let inside = false;
    for (const c of crowns) { const ce = (c.lng - f.pose.lng) * mLng, cn = (c.lat - lat0) * mLat; if ((ce - e) ** 2 + (cn - n) ** 2 <= (scale * c.r + marginM) ** 2) { inside = true; break; } }
    if (!inside) return false;
  }
  return true;
}

/** A crown is cut out from the ground up to this height at least (its measured height times 1.5 when taller), metres: the foliage of an oblique view lands on the ground plane displaced by its height. */
export const CROWN_SWEEP_M = 2.5;

/** The crowns' discs as an exclusion mask over a photograph's raster (one byte per raster pixel), or null without crowns. Each disc is painted at every half metre of height from the ground to the crown's top, so an oblique view's displaced foliage is covered. */
export function crownMask(f: GeorefFrame, px: PhotoPixels, crowns: CrownRef[], scale = CROWN_SCALE, marginM = CROWN_MARGIN_M, sweepM = CROWN_SWEEP_M): Uint8Array | null {
  if (!crowns.length) return null;
  const ratio = f.intrinsics.width / px.width;
  const centre = pixelToGround(f, f.intrinsics.cx, f.intrinsics.cy);
  const groundAlt = centre?.altM ?? (f.ground.kind === "flat" ? f.ground.altM : 0);
  const mask = new Uint8Array(px.width * px.height);
  for (const c of crowns) {
    const top = Math.max(sweepM, 1.5 * (c.h ?? 0));
    for (let z = 0; z <= top + 1e-9; z += 0.5) {
      const h = groundToPixel(f, c.lat, c.lng, groundAlt + z);
      if (!h) continue;
      const u = h.u / ratio, v = h.v / ratio;
      const gsd = groundSampleAt(f, h.u, h.v);
      if (gsd == null) continue;
      const r = (scale * c.r + marginM) / (gsd * ratio);
      if (u < -r || v < -r || u > px.width + r || v > px.height + r) continue;
      const x0 = Math.max(0, Math.floor(u - r)), x1 = Math.min(px.width - 1, Math.ceil(u + r)), y0 = Math.max(0, Math.floor(v - r)), y1 = Math.min(px.height - 1, Math.ceil(v + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if ((x + 0.5 - u) ** 2 + (y + 0.5 - v) ** 2 <= r * r) mask[y * px.width + x] = 1;
    }
  }
  return mask;
}

/**
 * The colour tier: green patches in one photograph by rules alone (green.ts), as observations. A patch whose centre
 * falls inside a reconciled crown is the tree and is left out; the rest keep their outline for the overlap
 * reconciliation. `minM2` drops specks on the ground.
 */
export function colourObservations(name: string, f: GeorefFrame, px: PhotoPixels, minM2 = 0.005, crowns: CrownRef[] = [], green: Partial<GreenOptions> = {}): Observation[] {
  const ratio = f.intrinsics.width / px.width;
  const pixelM = (groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy) ?? 0.01) * ratio;
  const obs: Observation[] = [];
  const exclude = crownMask(f, px, crowns);
  // Crowns within reach of this photograph only, for the fringe test.
  const centre = pixelToGround(f, f.intrinsics.cx, f.intrinsics.cy);
  const reachM = 0.6 * Math.hypot(f.intrinsics.width, f.intrinsics.height) * (groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy) ?? 0.01) + 10;
  const nearCrowns = centre ? crowns.filter(c => Math.hypot((c.lng - centre.lng) * 111_320 * Math.cos((centre.lat * Math.PI) / 180), (c.lat - centre.lat) * 111_320) <= reachM) : crowns;
  const keep = CROWN_FRINGE_SCALE > 0 && nearCrowns.length ? (o: { u: number; v: number; hull: [number, number][] }) => !patchInsideCrowns(f, o, nearCrowns, CROWN_FRINGE_SCALE, CROWN_MARGIN_M) : undefined;
  for (const o of greenPatches(px, ratio, { ...COLOUR_GREEN, ...green, pixelM }, keep, exclude)) {
    const gsd = groundSampleAt(f, o.u, o.v);
    if (gsd == null) continue;
    const areaM2 = o.areaPx * gsd * gsd;
    if (areaM2 < minM2) continue;
    const g = pixelToGround(f, o.u, o.v);
    if (!g) continue;
    obs.push({ frame: name, id: o.id, u: o.u, v: o.v, sizeM: Math.sqrt((4 * areaM2) / Math.PI), areaM2, touchesEdge: o.touchesEdge, data: { score: null, spanM: o.hull.length >= 2 ? spanOf(o.hull) * gsd : null, poly: thin(o.hull, 16) } });
  }
  return obs;
}

/** Runs the chosen tier on every photograph and reconciles. Tier "none" gives no weeds and says so. */
export async function findWeeds(photos: PhotoSource[], frames: Map<string, GeorefFrame>, model: AdjustModel, rows: RowsResult | null, detector: WeedDetector, hooks: BuildHooks = {}, opts: WeedsOptions = { tier: detector ? "model" : "none" }): Promise<WeedsResult> {
  const t0 = Date.now();
  const origin = model.origin;
  const enOf = (lat: number, lng: number) => { const e = toEnu({ lat, lng, altM: 0 }, origin); return [e[0], e[1]] as [number, number]; };
  const tier: WeedTier = opts.tier === "model" && !detector ? "none" : opts.tier === "colour" && !opts.colourPixels ? "none" : opts.tier;
  let settings: Record<string, unknown> = {};
  let describe = "none (built without a weed pass)";
  if (tier === "none") { hooks.onProgress?.({ stage: "weeds", done: 0, total: 0, message: "no weed pass: skipped", elapsedMs: 0 }); return { tier, weeds: [], detections: 0, photographsRun: 0, photographsFailed: [], stats: { note: "built without a weed pass" }, settings, describe, views: null }; }
  const obs: Observation[] = [];
  const failed: { name: string; reason: string }[] = [];
  let detections = 0, run = 0;
  // The reconciled crowns, for the colour pass to leave out.
  const crowns: CrownRef[] = (rows?.trees ?? []).filter(t => t.observed).map(t => ({ lat: t.lat, lng: t.lng, r: t.crownRadiusM, h: t.heightM }));
  const colourSettings = (pixelsM: number, op: WeedsOptions): Record<string, unknown> => { const g = { ...COLOUR_GREEN, ...(op.colourGreen ?? {}) }; return { model: `colour rules: ${g.index === "exgr-soil" ? "green against the soil around it (ExGR over the tile's soil level plus " + g.soilMargin + ")" : g.index === "exg-otsu" ? "ExG with Otsu's split" : "ExGR over zero"}, ${g.cellPx}-pixel cells, ${g.minCells} or more, patches over ${g.splitM2} m² split at their plants, crowns left out`, pixelsM: +pixelsM.toFixed(4), minM2: op.colourMinM2 ?? 0.005, green: g, crownsLeftOut: crowns.length }; };
  // Model tier with a view rule: the tile plan per photograph (the service's own), the nearest views per cell.
  const views = tier === "model" && (opts.views ?? 0) > 0 && opts.plan ? opts.views! : 0;
  const plans = new Map<string, TilePlan>();
  let choice: ReturnType<typeof chooseViews> | null = null;
  const runTiles = new Map<string, number[]>();
  if (views > 0) {
    const pl = opts.plan!;
    for (const p of photos) { const f = frames.get(p.name); if (f) plans.set(p.name, planTiles(Math.round(f.intrinsics.width * pl.scale), Math.round(f.intrinsics.height * pl.scale), pl.tile, pl.overlap)); }
    choice = chooseViews(frames, plans, origin, model.globals.groundOffsetM, views, 2);
    for (const [name, list] of choice.tiles) runTiles.set(name, list);
    hooks.log?.(`views: ${views} nearest per 2 m cell: ${choice.run} of ${choice.total} tiles`);
  }
  // The colour pass through the pool: one task per photograph, results in photograph order.
  if (tier === "colour" && opts.pool && opts.pool.size > 1 && opts.files) {
    const jobs = photos.map(async p => {
      const f = frames.get(p.name), file = opts.files!.get(p.name);
      if (!f || !file) return null;
      const r = await opts.pool!.run({ kind: "colour", name: p.name, file, frame: f, down: opts.colourDown ?? 4, minM2: opts.colourMinM2 ?? 0.005, crowns, green: opts.colourGreen ?? {} });
      return r.kind === "colour" ? { f, obs: r.observations } : null;
    });
    let i = 0;
    for (const job of jobs) {
      const r = await job;
      checkCancelled(hooks.signal);
      hooks.onProgress?.({ stage: "weeds", done: ++i, total: photos.length, message: "green patches", elapsedMs: Date.now() - t0 });
      if (!r) continue;
      if (!settings.model) settings = colourSettings((groundSampleAt(r.f, r.f.intrinsics.cx, r.f.intrinsics.cy) ?? 0.01) * (opts.colourDown ?? 4), opts);
      run++; detections += r.obs.length; obs.push(...r.obs);
    }
  }
  for (const [i, p] of photos.entries()) {
    if (tier === "colour" && opts.pool && opts.pool.size > 1 && opts.files) break;
    const f = frames.get(p.name);
    if (!f) continue;
    checkCancelled(hooks.signal);
    hooks.onProgress?.({ stage: "weeds", done: i, total: photos.length, message: `${p.name}: ${tier === "model" ? "the weed model" : "green patches"}`, elapsedMs: Date.now() - t0 });
    if (tier === "colour") {
      try {
        const px = await opts.colourPixels!(p.name);
        const o = colourObservations(p.name, f, px, opts.colourMinM2 ?? 0.005, crowns, opts.colourGreen ?? {});
        if (!settings.model) settings = colourSettings((groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy) ?? 0.01) * (f.intrinsics.width / px.width), opts);
        run++; detections += o.length; obs.push(...o);
        hooks.log?.(`${p.name}: ${o.length} green patches`);
      } catch (e) { failed.push({ name: p.name, reason: (e as Error).message }); }
      continue;
    }
    const askTiles = views > 0 ? runTiles.get(p.name) : undefined;
    if (views > 0 && !askTiles) { run++; continue; }
    let res: WeedVisionResult | null = null;
    try { res = await detector!(p, hooks.signal, askTiles); } catch (e) { failed.push({ name: p.name, reason: (e as Error).message }); continue; }
    if (!res) { failed.push({ name: p.name, reason: "no answer from the weed model" }); continue; }
    if (!settings.model) settings = { model: res.algorithm?.name ?? "rfdetr_seg_large", threshold: res.processing?.threshold ?? null, tilePx: res.processing?.tile_px ?? null, overlapPx: res.processing?.overlap_px ?? null, scale: res.processing?.scale ?? null, geometry: res.instances[0]?.flags ? ((res.instances[0] as unknown as { geometry?: string }).geometry ?? "full") : "full" };
    run++;
    detections += res.instances.length;
    obs.push(...observationsOf(p.name, f, res.instances));
    hooks.log?.(`${p.name}: ${res.instances.length} weed detections`);
  }
  describe = tier === "model"
    ? `${String(settings.model ?? "the weed model")}, confidence ${String(settings.threshold ?? "?")}, ${String(settings.tilePx ?? "?")} px tiles with ${String(settings.overlapPx ?? "?")} px overlap at scale ${String(settings.scale ?? "?")}`
    : `colour rules (green against the soil around it at ${settings.pixelsM != null ? `${(Number(settings.pixelsM) * 100).toFixed(1)} cm` : "?"} pixels, ${Number(settings.minM2 ?? 0.005) * 10_000} cm² or more, patches over ${(settings.green as Partial<GreenOptions> | undefined)?.splitM2 ?? 0.3} m² split at their plants, ${String(settings.crownsLeftOut ?? 0)} crowns left out); no model`;
  const trees = (rows?.trees ?? []).filter(t => t.observed);
  const rowLines = (rows?.rows ?? []).filter(r => r.kept).map(r => r.line.map(([lat, lng]) => enOf(lat, lng)));
  const treeEn = trees.map(t => ({ t, p: enOf(t.lat, t.lng) }));
  const segDist = (p: [number, number], a: [number, number], b: [number, number]) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0; return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]); };
  const classify = (o: ReconciledObject): BuildWeed => {
    const p = enOf(o.lat, o.lng);
    let treeId: number | null = null;
    for (const { t, p: q } of treeEn) if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= t.crownRadiusM + 0.1) { treeId = t.id; break; }
    const tall = o.heightM != null && o.heightM > 0.5;
    const onTree = treeId != null || tall;
    const d = rowLines.length ? Math.min(...rowLines.map(l => segDist(p, l[0], l[1]))) : Infinity;
    const spans = o.members.map(m => m.data?.spanM as number | null).filter((x): x is number => x != null);
    const scores = o.members.map(m => m.data?.score as number | null).filter((x): x is number => x != null);
    return {
      id: o.id, lat: o.lat, lng: o.lng, heightM: o.heightM, diameterM: o.sizeM, areaM2: o.areaM2, spanM: spans.length ? quant(spans, 0.5) : null, sizeCv: o.sizeCv, viewSpreadM: o.viewSpreadM,
      seenBy: o.seenBy, coveredBy: o.coveredBy, runBy: o.runBy, onTree, treeId, rowStatus: !rowLines.length ? "no rows" : d <= LAYOUT_BAND_M ? "on a row" : "between rows", verified: o.seenBy >= 2 && !onTree, score: scores.length ? Math.max(...scores) : null,
      members: o.members.map(m => ({ frame: m.frame, id: m.id, u: m.u, v: m.v, sizeM: m.sizeM, poly: (m.data?.poly as [number, number][]) ?? [] })),
    };
  };
  checkCancelled(hooks.signal);
  hooks.onProgress?.({ stage: "weeds", done: photos.length, total: photos.length, message: "reconciling the detections across photographs", elapsedMs: Date.now() - t0 });
  const ringsOf = () => { const m = new Map<string, [number, number][][]>(); for (const [name, list] of runTiles) { const f = frames.get(name), plan = plans.get(name); if (f && plan) m.set(name, runRings(f, plan, list, origin)); } return m; };
  // The colour tier reconciles by outline overlap and absorbs pieces: a patch one photograph sees whole and another
  // sees as three is one plant. The model's instances keep the ray rule.
  let weeds = reconcile(obs, frames, tier === "colour" ? { maxHeightM: 6, linkBy: "overlap", absorb: true } : { maxHeightM: 6, runRings: views > 0 ? ringsOf() : undefined }).map(classify);
  // The colour tier: a patch seen once where three or more photographs looked is a speck of one photograph, not an
  // observation worth carrying (40,000 of them on the apricot flight, half the twin's bytes); one seen once where
  // only one or two photographs looked stays, as the model's single sightings do.
  const singlesDropped = tier === "colour" ? weeds.filter(w => w.seenBy < 2 && w.coveredBy >= 3).length : 0;
  if (singlesDropped) weeds = weeds.filter(w => w.seenBy >= 2 || w.coveredBy < 3);
  let thirdTiles = 0;
  if (views > 0) {
    // The third pass: where one view alone saw a plant, the next-nearest photograph that has not looked there yet.
    const extra = new Map<string, Set<number>>();
    const fps = [...frames.values()].map(f => ({ f, nadir: pixelToGround(f, f.intrinsics.cx, f.intrinsics.cy) })).filter(x => x.nadir);
    const lat0 = (origin.lat * Math.PI) / 180;
    for (const w of weeds) {
      if (w.onTree || w.seenBy !== 1) continue;
      const [e, n] = enOf(w.lat, w.lng);
      const cands = fps.map(x => { const [ne, nn] = enOf(x.nadir!.lat, x.nadir!.lng); return { f: x.f, d: (ne - e) ** 2 + (nn - n) ** 2 }; }).sort((a, b) => a.d - b.d);
      for (const c of cands) {
        if (c.f.name === w.members[0]?.frame) continue;
        const plan = plans.get(c.f.name); if (!plan) continue;
        const hit = groundToPixel(c.f, w.lat, w.lng, model.globals.groundOffsetM);
        if (!hit || !hit.inside) continue;
        const s = plan.width / c.f.intrinsics.width;
        const t = tilesAt(plan, hit.u * s, hit.v * s).filter(i => !(runTiles.get(c.f.name) ?? []).includes(i));
        if (!t.length) continue; // already looked there and did not see it
        for (const i of t) (extra.get(c.f.name) ?? extra.set(c.f.name, new Set()).get(c.f.name)!).add(i);
        break;
      }
    }
    for (const [name, set] of extra) {
      const p = photos.find(x => x.name === name), f = frames.get(name);
      if (!p || !f) continue;
      const list = [...set].sort((a, b) => a - b);
      checkCancelled(hooks.signal);
      hooks.onProgress?.({ stage: "weeds", done: photos.length, total: photos.length, message: `${name}: a third look at ${list.length} tiles`, elapsedMs: Date.now() - t0 });
      try {
        const res = await detector!(p, hooks.signal, list);
        if (!res) continue;
        thirdTiles += list.length;
        // Only what the new tiles add: a plant whose centroid also lies in a tile of the first run was already reported, or judged absent, there.
        const plan = plans.get(name)!, s = plan.width / f.intrinsics.width, first = runTiles.get(name) ?? [];
        const fresh = res.instances.filter(i => !tilesAt(plan, i.centroid_px[0] * s, i.centroid_px[1] * s).some(t => first.includes(t)));
        detections += fresh.length;
        const base = 1_000_000;
        obs.push(...observationsOf(name, f, fresh.map(i => ({ ...i, id: i.id + base }))));
        runTiles.set(name, [...(runTiles.get(name) ?? []), ...list].sort((a, b) => a - b));
      } catch (e) { failed.push({ name, reason: `third pass: ${(e as Error).message}` }); }
    }
    if (extra.size) weeds = reconcile(obs, frames, { maxHeightM: 6, runRings: ringsOf() }).map(classify);
    hooks.log?.(`third pass: ${thirdTiles} tiles in ${extra.size} photographs`);
  }
  const notTree = weeds.filter(w => !w.onTree), verified = notTree.filter(w => w.verified), multiCovered = notTree.filter(w => w.runBy >= 2);
  const stats = {
    singleSightingsDropped: singlesDropped,
    detections, usable: obs.filter(o => !o.touchesEdge).length, objects: weeds.length, onTree: weeds.filter(w => w.onTree).length,
    candidates: notTree.length, verified: verified.length, verifiedBetweenRows: verified.filter(w => w.rowStatus === "between rows").length, verifiedOnRows: verified.filter(w => w.rowStatus === "on a row").length,
    singleView: notTree.filter(w => w.seenBy === 1).length,
    repeatability: { note: "of candidates that 2+ run views covered, the share of those views that saw them", median: r2(quant(multiCovered.map(w => w.seenBy / w.runBy), 0.5)) },
    verifiedPositionSpreadM: { median: r3(quant(verified.map(w => w.viewSpreadM), 0.5)) },
    verifiedDiameterM: { median: r3(quant(verified.map(w => w.diameterM), 0.5)) },
  };
  hooks.log?.(`${weeds.length} weed objects from ${detections} ${tier === "model" ? "detections" : "patches"}, ${verified.length} verified`);
  return { tier, weeds, detections, photographsRun: run, photographsFailed: failed, stats, settings, describe: views > 0 ? `${describe}; run on each 2 m cell's ${views} nearest views (${choice!.run + thirdTiles} of ${choice!.total} tiles) with a third look where one view alone saw a plant` : describe, views: views > 0 ? { rule: `${views} nearest views per 2 m cell, a third look where one view alone saw a plant`, views, tilesTotal: choice!.total, tilesFirst: choice!.run, tilesThird: thirdTiles } : null };
}
