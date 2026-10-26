// Milestone 1: the app's weed model on the original photographs, reconciled into one object per plant.
//
//   npx vite-node scripts/directGeoref/m1Weeds.ts
//
// Input: m1/rfdetr/<photo>.json, the local service's answer for each ORIGINAL photograph with the settings of the
// app's simple Find weeds (RF-DETR Seg-Large, confidence 0.5, 1024 px tiles, 256 px overlap, full resolution), and
// m2's reconciled trees and kept field rows.
// Each weed instance becomes an observation measured on the ground at its own pixel size (groundSampleAt), the
// observations are reconciled across photographs (reconcile.ts: rays must meet, one sighting per photo), and each
// object is classed:
//   on a tree     inside a reconciled tree's crown, or triangulated more than 0.5 m above the soil: the model
//                 (trained on sugar beet) calling part of an apricot tree a weed
//   on a row      within 0.5 m of a kept field row's line (LAYOUT_BAND_M)
//   between rows  the rest: the candidates that matter
//   verified      seen in 2+ photographs and not on a tree; one sighting is reported as "seen in 1 of N"
// DJI_0301's hand-labelled weeds are compared with objects reconciled WITHOUT DJI_0301 and with DJI_0301's own
// detections, so reconciliation's loss (if any) is measured on the same labels.
// Writes m1/{weeds.json, report.json}.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Observation, type ReconciledObject, groundSampleAt, pixelToGround, reconcile } from "../../src/lib/directGeoref";
import { LAYOUT_BAND_M } from "../../src/lib/weedVision/layout/plantingLayout";
import { toEnu } from "../../src/lib/sourceFrames/odm";
import { OUT, ROOT, loadReference, quant, r2, r3 } from "./common";

const DIR = join(OUT, "m1");
const { frames, model } = loadReference();
const origin = model.origin;
const enOf = (lat: number, lng: number) => { const e = toEnu({ lat, lng, altM: 0 }, origin); return [e[0], e[1]] as [number, number]; };

type Inst = { id: number; centroid_px: [number, number]; area_px: number; equivalent_diameter_px: number; max_span_px: number | null; touches_border: boolean; score: number | null; polygons_px: [number, number][][] };
type Result = { count: number; instances: Inst[]; crop_instances?: Inst[] | null; error?: string };

const thin = (poly: [number, number][], n = 32) => { if (poly.length <= n) return poly; const step = poly.length / n; return Array.from({ length: n }, (_, i) => poly[Math.floor(i * step)]); };
const polyArea = (p: [number, number][]) => Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0)) / 2;

function observationsOf(kind: "weed" | "crop", skip?: string): { obs: Observation[]; detections: number } {
  const obs: Observation[] = [];
  let detections = 0;
  for (const [name, f] of frames) {
    if (name === skip) continue;
    const p = join(DIR, "rfdetr", `${name}.json`);
    if (!existsSync(p)) continue;
    const r = JSON.parse(readFileSync(p, "utf8")) as Result;
    const list = kind === "weed" ? r.instances : r.crop_instances ?? [];
    for (const i of list) {
      detections++;
      const [u, v] = i.centroid_px;
      const gsd = groundSampleAt(f, u, v);
      if (gsd == null) continue;
      const poly = i.polygons_px.length ? thin(i.polygons_px.reduce((a, b) => (polyArea(b) > polyArea(a) ? b : a))) : [];
      obs.push({ frame: name, id: i.id, u: u + 0.5, v: v + 0.5, sizeM: i.equivalent_diameter_px * gsd, areaM2: i.area_px * gsd * gsd, touchesEdge: i.touches_border, data: { score: i.score, spanM: i.max_span_px != null ? i.max_span_px * gsd : null, poly } });
    }
  }
  return { obs, detections };
}

// Trees and rows from milestone 2.
type TreeOut = { id: number; lat: number; lng: number; heightM: number | null; crownRadiusM: number; observed: boolean };
const trees = (JSON.parse(readFileSync(join(OUT, "m2", "trees.json"), "utf8")) as TreeOut[]).filter(t => t.observed);
const rowsDoc = JSON.parse(readFileSync(join(OUT, "m2", "rows.json"), "utf8")) as { rows: { id: number; kept: boolean; line: [number, number][] }[] };
const rowLines = rowsDoc.rows.filter(r => r.kept).map(r => r.line.map(([lat, lng]) => enOf(lat, lng)));
const treeEn = trees.map(t => ({ t, p: enOf(t.lat, t.lng) }));
const segDist = (p: [number, number], a: [number, number], b: [number, number]) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0; return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]); };

type Classified = ReconciledObject & { onTree: boolean; treeId: number | null; rowStatus: "on a row" | "between rows" | "no rows"; verified: boolean; spanM: number | null; score: number | null };
function classify(objs: ReconciledObject[]): Classified[] {
  return objs.map(o => {
    const p = enOf(o.lat, o.lng);
    let treeId: number | null = null;
    for (const { t, p: q } of treeEn) if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= t.crownRadiusM + 0.1) { treeId = t.id; break; }
    const tall = o.heightM != null && o.heightM > 0.5;
    const onTree = treeId != null || tall;
    const d = rowLines.length ? Math.min(...rowLines.map(l => segDist(p, l[0], l[1]))) : Infinity;
    const spans = o.members.map(m => m.data?.spanM as number | null).filter((x): x is number => x != null);
    const scores = o.members.map(m => m.data?.score as number | null).filter((x): x is number => x != null);
    return { ...o, onTree, treeId, rowStatus: !rowLines.length ? "no rows" : d <= LAYOUT_BAND_M ? "on a row" : "between rows", verified: o.seenBy >= 2 && !onTree, spanM: spans.length ? quant(spans, 0.5) : null, score: scores.length ? Math.max(...scores) : null };
  });
}

const weedObs = observationsOf("weed");
const weeds = classify(reconcile(weedObs.obs, frames, { maxHeightM: 6 }));
const notTree = weeds.filter(w => !w.onTree);
const verified = notTree.filter(w => w.verified);
const between = verified.filter(w => w.rowStatus === "between rows");
const multiCovered = notTree.filter(w => w.coveredBy >= 2);
const stats = {
  detections: weedObs.detections, usable: weedObs.obs.filter(o => !o.touchesEdge).length, objects: weeds.length,
  onTree: weeds.filter(w => w.onTree).length,
  candidates: notTree.length, verified: verified.length, verifiedBetweenRows: between.length, verifiedOnRows: verified.filter(w => w.rowStatus === "on a row").length,
  singleView: notTree.filter(w => w.seenBy === 1).length, singleViewThoughCoveredTwice: notTree.filter(w => w.seenBy === 1 && w.coveredBy >= 2).length,
  repeatability: {
    note: "of candidates that 2+ photographs covered, the share of those photographs that detected them",
    median: r2(quant(multiCovered.map(w => w.seenBy / w.coveredBy), 0.5)),
    seenByAllCovering: multiCovered.filter(w => w.seenBy >= w.coveredBy).length, of: multiCovered.length,
  },
  verifiedViews: { median: quant(verified.map(w => w.seenBy), 0.5), max: Math.max(...verified.map(w => w.seenBy)) },
  verifiedPositionSpreadM: { median: r3(quant(verified.map(w => w.viewSpreadM), 0.5)), p90: r3(quant(verified.map(w => w.viewSpreadM), 0.9)) },
  verifiedSizeCv: { median: r3(quant(verified.map(w => w.sizeCv), 0.5)), p90: r3(quant(verified.map(w => w.sizeCv), 0.9)) },
  verifiedDiameterM: { p10: r3(quant(verified.map(w => w.sizeM), 0.1)), median: r3(quant(verified.map(w => w.sizeM), 0.5)), p90: r3(quant(verified.map(w => w.sizeM), 0.9)) },
  verifiedHeightM: { median: r2(quant(verified.map(w => w.heightM ?? NaN), 0.5)) },
};
console.log("Weeds:", JSON.stringify(stats, null, 1));

// Crop instances against the reconciled trees (a sanity check on what RF-DETR's "crop" means on an orchard).
const crops = reconcile(observationsOf("crop").obs, frames, { maxHeightM: 6 });
const cropOnTree = crops.filter(c => { const p = enOf(c.lat, c.lng); return treeEn.some(({ t, p: q }) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= t.crownRadiusM + 0.3); }).length;
console.log(`RF-DETR crop objects: ${crops.length}, of which ${cropOnTree} sit on a reconciled tree crown`);

// DJI_0301 hand labels: weeds found by objects reconciled WITHOUT DJI_0301, and by DJI_0301's own detections.
const LABELS = join(ROOT, "evaluation/groundtruth/image1/DJI_0301.labels.json");
let labelCheck: Record<string, unknown> = { note: "no labels" };
const f301 = frames.get("DJI_0301");
if (f301 && existsSync(LABELS)) {
  const lab = (JSON.parse(readFileSync(LABELS, "utf8")).labels as { cls: string; x: number; y: number }[]).filter(l => l.cls === "weed");
  const labEn = lab.map(l => { const g = pixelToGround(f301, l.x, l.y)!; return enOf(g.lat, g.lng); });
  const others = classify(reconcile(observationsOf("weed", "DJI_0301").obs, frames, { maxHeightM: 6 })).filter(w => !w.onTree);
  const own = weedObs.obs.filter(o => o.frame === "DJI_0301").map(o => { const g = pixelToGround(f301, o.u, o.v)!; return { p: enOf(g.lat, g.lng), r: o.sizeM / 2 }; });
  const hit = (pts: { p: [number, number]; r: number }[], q: [number, number]) => pts.some(x => Math.hypot(x.p[0] - q[0], x.p[1] - q[1]) <= Math.max(0.25, x.r + 0.1));
  const oth = others.map(w => ({ p: enOf(w.lat, w.lng), r: w.sizeM / 2 }));
  const othVerified = others.filter(w => w.verified).map(w => ({ p: enOf(w.lat, w.lng), r: w.sizeM / 2 }));
  labelCheck = {
    labelledWeeds: lab.length,
    foundByDJI0301OwnDetections: labEn.filter(q => hit(own, q)).length,
    foundByObjectsFromOtherPhotos: labEn.filter(q => hit(oth, q)).length,
    foundByVerifiedObjectsFromOtherPhotos: labEn.filter(q => hit(othVerified, q)).length,
    note: "a label counts as found when an object's centre is within max(0.25 m, its radius + 0.1 m); labels are not exhaustive, so this is recall against the labels only",
  };
  console.log("DJI_0301 weed labels:", JSON.stringify(labelCheck, null, 1));
}

writeFileSync(join(DIR, "weeds.json"), JSON.stringify(weeds.map(w => ({
  id: w.id, lat: w.lat, lng: w.lng, heightM: w.heightM, diameterM: w.sizeM, areaM2: w.areaM2, spanM: w.spanM, sizeCv: w.sizeCv, viewSpreadM: w.viewSpreadM,
  seenBy: w.seenBy, coveredBy: w.coveredBy, onTree: w.onTree, treeId: w.treeId, rowStatus: w.rowStatus, verified: w.verified, score: w.score,
  members: w.members.map(m => ({ frame: m.frame, id: m.id, u: m.u, v: m.v, sizeM: m.sizeM, poly: m.data?.poly })),
}))));
writeFileSync(join(DIR, "report.json"), JSON.stringify({ settings: { model: "rfdetr_seg_large", threshold: 0.5, tilePx: 1024, overlapPx: 256, scale: 1 }, weeds: stats, crops: { objects: crops.length, onTreeCrown: cropOnTree }, labels: labelCheck }, null, 1));
console.log(`written ${DIR}`);
