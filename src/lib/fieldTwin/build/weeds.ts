// Stage 4: the weed model on every original photograph, reconciled into one object per plant and classed
// against the trees and rows. The port of scripts/directGeoref/m1Weeds.ts (milestone 1).
import { type AdjustModel, type GeorefFrame, type Observation, type ReconciledObject, groundSampleAt, reconcile } from "../../directGeoref";
import { toEnu } from "../../sourceFrames/odm";
import type { WeedInstance, WeedVisionResult } from "../../weedVision/client";
import { LAYOUT_BAND_M } from "../../weedVision/layout/plantingLayout";
import type { RowsResult } from "./rows";
import { type BuildHooks, type PhotoSource, type WeedDetector, checkCancelled } from "./types";

const quant = (v: number[], q: number) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(q * (s.length - 1))] : NaN; };
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const thin = (poly: [number, number][], n = 32) => { if (poly.length <= n) return poly; const step = poly.length / n; return Array.from({ length: n }, (_, i) => poly[Math.floor(i * step)]); };
const polyArea = (p: [number, number][]) => Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0)) / 2;

export type BuildWeed = {
  id: number; lat: number; lng: number; heightM: number | null; diameterM: number; areaM2: number; spanM: number | null; sizeCv: number; viewSpreadM: number;
  seenBy: number; coveredBy: number; onTree: boolean; treeId: number | null; rowStatus: "on a row" | "between rows" | "no rows"; verified: boolean; score: number | null;
  members: { frame: string; id: number; u: number; v: number; sizeM: number; poly: [number, number][] }[];
};

export type WeedsResult = { weeds: BuildWeed[]; detections: number; photographsRun: number; photographsFailed: { name: string; reason: string }[]; stats: Record<string, unknown>; settings: Record<string, unknown> };

/** Weed observations from the service's answer for one photograph, measured on the ground at their own pixel size. */
export function observationsOf(name: string, f: GeorefFrame, list: WeedInstance[]): Observation[] {
  const obs: Observation[] = [];
  for (const i of list) {
    const [u, v] = i.centroid_px;
    const gsd = groundSampleAt(f, u, v);
    if (gsd == null) continue;
    const poly = i.polygons_px.length ? thin(i.polygons_px.reduce((a, b) => (polyArea(b) > polyArea(a) ? b : a))) : [];
    obs.push({ frame: name, id: i.id, u: u + 0.5, v: v + 0.5, sizeM: i.equivalent_diameter_px * gsd, areaM2: i.area_px * gsd * gsd, touchesEdge: i.touches_border, data: { score: i.score, spanM: i.max_span_px != null ? i.max_span_px * gsd : null, poly } });
  }
  return obs;
}

/** Runs the detector on every photograph and reconciles. With a null detector the answer holds no weeds and says so. */
export async function findWeeds(photos: PhotoSource[], frames: Map<string, GeorefFrame>, model: AdjustModel, rows: RowsResult | null, detector: WeedDetector, hooks: BuildHooks = {}): Promise<WeedsResult> {
  const t0 = Date.now();
  const origin = model.origin;
  const enOf = (lat: number, lng: number) => { const e = toEnu({ lat, lng, altM: 0 }, origin); return [e[0], e[1]] as [number, number]; };
  const settings = { model: "rfdetr_seg_large", threshold: 0.5, tilePx: 1024, overlapPx: 256, scale: 1 };
  if (!detector) { hooks.onProgress?.({ stage: "weeds", done: 0, total: 0, message: "no weed model: skipped", elapsedMs: 0 }); return { weeds: [], detections: 0, photographsRun: 0, photographsFailed: [], stats: { note: "built without the weed model" }, settings }; }
  const obs: Observation[] = [];
  const failed: { name: string; reason: string }[] = [];
  let detections = 0, run = 0;
  for (const [i, p] of photos.entries()) {
    const f = frames.get(p.name);
    if (!f) continue;
    checkCancelled(hooks.signal);
    hooks.onProgress?.({ stage: "weeds", done: i, total: photos.length, message: `${p.name}: the weed model`, elapsedMs: Date.now() - t0 });
    let res: WeedVisionResult | null = null;
    try { res = await detector(p, hooks.signal); } catch (e) { failed.push({ name: p.name, reason: (e as Error).message }); continue; }
    if (!res) { failed.push({ name: p.name, reason: "no answer from the weed model" }); continue; }
    run++;
    detections += res.instances.length;
    obs.push(...observationsOf(p.name, f, res.instances));
    hooks.log?.(`${p.name}: ${res.instances.length} weed detections`);
  }
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
      seenBy: o.seenBy, coveredBy: o.coveredBy, onTree, treeId, rowStatus: !rowLines.length ? "no rows" : d <= LAYOUT_BAND_M ? "on a row" : "between rows", verified: o.seenBy >= 2 && !onTree, score: scores.length ? Math.max(...scores) : null,
      members: o.members.map(m => ({ frame: m.frame, id: m.id, u: m.u, v: m.v, sizeM: m.sizeM, poly: (m.data?.poly as [number, number][]) ?? [] })),
    };
  };
  checkCancelled(hooks.signal);
  hooks.onProgress?.({ stage: "weeds", done: photos.length, total: photos.length, message: "reconciling the detections across photographs", elapsedMs: Date.now() - t0 });
  const weeds = reconcile(obs, frames, { maxHeightM: 6 }).map(classify);
  const notTree = weeds.filter(w => !w.onTree), verified = notTree.filter(w => w.verified), multiCovered = notTree.filter(w => w.coveredBy >= 2);
  const stats = {
    detections, usable: obs.filter(o => !o.touchesEdge).length, objects: weeds.length, onTree: weeds.filter(w => w.onTree).length,
    candidates: notTree.length, verified: verified.length, verifiedBetweenRows: verified.filter(w => w.rowStatus === "between rows").length, verifiedOnRows: verified.filter(w => w.rowStatus === "on a row").length,
    singleView: notTree.filter(w => w.seenBy === 1).length,
    repeatability: { median: r2(quant(multiCovered.map(w => w.seenBy / w.coveredBy), 0.5)) },
    verifiedPositionSpreadM: { median: r3(quant(verified.map(w => w.viewSpreadM), 0.5)) },
    verifiedDiameterM: { median: r3(quant(verified.map(w => w.diameterM), 0.5)) },
  };
  hooks.log?.(`${weeds.length} weed objects from ${detections} detections, ${verified.length} verified`);
  return { weeds, detections, photographsRun: run, photographsFailed: failed, stats, settings };
}
