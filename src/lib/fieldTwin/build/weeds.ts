// Stage 4: the weed model on every original photograph, reconciled into one object per plant and classed
// against the trees and rows. The port of scripts/directGeoref/m1Weeds.ts (milestone 1).
import { type AdjustModel, type GeorefFrame, type Observation, type ReconciledObject, groundSampleAt, groundToPixel, pixelToGround, reconcile, vegetationObjects } from "../../directGeoref";
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
  /** Model tier: nearest views per ground cell to run (0 = all tiles), and the detector's tile plan. */
  views?: number;
  plan?: DetectPlan;
  /** Colour tier: the pixels to read (a quarter decode, or the camera's preview), per photograph. */
  colourPixels?: (name: string) => Promise<PhotoPixels>;
  /** Colour tier: patches smaller than this are left out, square metres. */
  colourMinM2?: number;
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
export function colourObservations(name: string, f: GeorefFrame, px: PhotoPixels, minM2 = 0.01): Observation[] {
  const ratio = f.intrinsics.width / px.width;
  const obs: Observation[] = [];
  for (const o of vegetationObjects(px, ratio)) {
    const gsd = groundSampleAt(f, o.u, o.v);
    if (gsd == null) continue;
    const areaM2 = o.areaPx * gsd * gsd;
    if (areaM2 < minM2) continue;
    obs.push({ frame: name, id: o.id, u: o.u, v: o.v, sizeM: Math.sqrt((4 * areaM2) / Math.PI), areaM2, touchesEdge: o.touchesEdge, data: { score: null, spanM: o.hull.length >= 2 ? spanOf(o.hull) * gsd : null, poly: thin(o.hull) } });
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
  for (const [i, p] of photos.entries()) {
    const f = frames.get(p.name);
    if (!f) continue;
    checkCancelled(hooks.signal);
    hooks.onProgress?.({ stage: "weeds", done: i, total: photos.length, message: `${p.name}: ${tier === "model" ? "the weed model" : "green patches"}`, elapsedMs: Date.now() - t0 });
    if (tier === "colour") {
      try {
        const px = await opts.colourPixels!(p.name);
        const o = colourObservations(p.name, f, px, opts.colourMinM2 ?? 0.01);
        if (!settings.model) settings = { model: "colour rules: ExGR green patches, 2-pixel cells, 3 cells or more", pixelsM: +((groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy) ?? 0.01) * (f.intrinsics.width / px.width)).toFixed(4), minM2: opts.colourMinM2 ?? 0.01 };
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
    : `colour rules (green patches at ${settings.pixelsM != null ? `${(Number(settings.pixelsM) * 100).toFixed(1)} cm` : "?"} pixels, ${Number(settings.minM2 ?? 0.01) * 10_000} cm² or more); no model`;
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
  let weeds = reconcile(obs, frames, { maxHeightM: 6, runRings: views > 0 ? ringsOf() : undefined }).map(classify);
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
