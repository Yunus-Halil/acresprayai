// Milestone 3, part 1: the Swardus Field Twin bundle, built straight from the original photographs.
//
//   npx vite-node scripts/directGeoref/buildTwin.ts -- [--id apricot-2021-04-27]
//
// Reads milestone 1 (m1/weeds.json), milestone 2 (m2/trees.json, m2/rows.json), the per-photo green patches (cache/)
// and the reference cameras, and writes data/direct-georef/twin/<id>/:
//   twin.json       format swardus-field-twin-v1 (src/lib/fieldTwin/types.ts): rows, trees, inferred positions,
//                   weeds (verified, single view, on a tree), other vegetation, photo coverage, statistics
//   atlas-N.jpg     evidence: for every tree and weed, crops of the ORIGINAL photographs that saw it (best views:
//                   nearest the frame centre), 112 px cells packed 18 x 18; each evidence entry carries the object's
//                   outline in the cell's own pixels so the app draws it over the crop
// Nothing here is a satellite image or an orthomosaic: the map is vectors, the pictures are the drone's own frames.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import { type Observation, frameCorners, groundSampleAt, pixelToGround, reconcile } from "../../src/lib/directGeoref";
import { FIELD_TWIN_FORMAT, type TwinBundle, type TwinEvidence } from "../../src/lib/fieldTwin/types";
import { toEnu } from "../../src/lib/sourceFrames/odm";
import { OUT, PHOTOS, loadReference, quant, r2, r3 } from "./common";

const argv = process.argv.slice(2);
const ID = argv.includes("--id") ? argv[argv.indexOf("--id") + 1] : "apricot-2021-04-27";
const DIR = join(OUT, "..", "twin", ID);
mkdirSync(DIR, { recursive: true });
const { frames, model, cached } = loadReference();
const origin = model.origin;
const enOf = (lat: number, lng: number) => { const e = toEnu({ lat, lng, altM: 0 }, origin); return [e[0], e[1]] as [number, number]; };
// 7 decimals of a degree is about 1 cm: finer than anything here is measured.
const ll = (e: number, n: number) => { const lat0 = (origin.lat * Math.PI) / 180; return [+(origin.lat + (n / 6378137) * (180 / Math.PI)).toFixed(7), +(origin.lng + (e / (6378137 * Math.cos(lat0))) * (180 / Math.PI)).toFixed(7)] as [number, number]; };
/** At most n points of a closed outline, evenly picked. */
function thinTo<T>(pts: T[], n: number): T[] { return pts.length <= n ? pts : Array.from({ length: n }, (_, i) => pts[Math.floor((i * pts.length) / n)]); }
const fix = (v: number | null | undefined, d = 3) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(d));

// ------------------------------------------------------------------------------------------------------------------
// Inputs
// ------------------------------------------------------------------------------------------------------------------
type M2Tree = { id: number; lat: number; lng: number; heightM: number | null; crownRadiusM: number; seenBy: number; coveredBy: number; viewSpreadM: number; sizeCv: number; observed: boolean; members: { frame: string; u: number; v: number; rM: number; state: string }[] };
type M2Rows = { field: { directionDeg: number; directionRefinedDeg: number; rowSpacingM: number; plantSpacingM: number }; rows: { id: number; kept: boolean; reason: string | null; trees: number; inferred: number; photos: number; photosWithOwnRows: number; lengthM: number; straightnessSdM: number; line: [number, number][]; treeIds: number[] }[]; inferred: { row: number; lat: number; lng: number }[] };
type M1Weed = { id: number; lat: number; lng: number; heightM: number | null; diameterM: number; areaM2: number; spanM: number | null; sizeCv: number; viewSpreadM: number; seenBy: number; coveredBy: number; onTree: boolean; treeId: number | null; rowStatus: string; verified: boolean; score: number | null; members: { frame: string; id: number; u: number; v: number; sizeM: number; poly: [number, number][] }[] };
const trees = (JSON.parse(readFileSync(join(OUT, "m2", "trees.json"), "utf8")) as M2Tree[]).filter(t => t.observed);
const rowsDoc = JSON.parse(readFileSync(join(OUT, "m2", "rows.json"), "utf8")) as M2Rows;
const weeds = JSON.parse(readFileSync(join(OUT, "m1", "weeds.json"), "utf8")) as M1Weed[];
const m1Report = JSON.parse(readFileSync(join(OUT, "m1", "report.json"), "utf8"));
const m2Report = JSON.parse(readFileSync(join(OUT, "m2", "report.json"), "utf8"));
const treeOfRow = new Map<number, number>();
for (const r of rowsDoc.rows) if (r.kept) for (const t of r.treeIds) treeOfRow.set(t, r.id);

// Other vegetation: green patches seen in 2+ photographs that are neither a tree nor a weed object.
const vegObs: Observation[] = [];
for (const c of cached) {
  const f = frames.get(c.name);
  if (!f) continue;
  for (const o of c.objects) {
    const gsd = groundSampleAt(f, o.u, o.v);
    if (gsd == null) continue;
    const areaM2 = o.areaPx * gsd * gsd;
    if (areaM2 < 0.1) continue;
    vegObs.push({ frame: c.name, id: o.id, u: o.u, v: o.v, sizeM: Math.sqrt((4 * areaM2) / Math.PI), areaM2, touchesEdge: o.touchesEdge, data: { hull: o.hull } });
  }
}
const treeEn = trees.map(t => ({ t, p: enOf(t.lat, t.lng) }));
const weedEn = weeds.map(w => ({ w, p: enOf(w.lat, w.lng) }));
const vegetation = reconcile(vegObs, frames, { maxHeightM: 6 }).filter(v => {
  if (v.seenBy < 2) return false;
  const p = enOf(v.lat, v.lng);
  if (treeEn.some(({ t, p: q }) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= t.crownRadiusM + 0.2)) return false;
  if (weedEn.some(({ w, p: q }) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= Math.max(0.3, w.diameterM / 2 + 0.1))) return false;
  return true;
});

// ------------------------------------------------------------------------------------------------------------------
// Evidence crops: requests first, then one pass over the photographs.
// ------------------------------------------------------------------------------------------------------------------
const CELL = 112, PER_ROW = 18, PER_ATLAS = PER_ROW * PER_ROW, ATLAS = CELL * PER_ROW;
type Req = { photo: string; x0: number; y0: number; size: number; poly: [number, number][]; target: TwinEvidence[] };
const reqs: Req[] = [];
const centreDist = (frame: string, u: number, v: number) => { const f = frames.get(frame)!; return Math.hypot(u - f.intrinsics.cx, v - f.intrinsics.cy); };
function request(frame: string, u: number, v: number, extentM: number, polyPx: [number, number][], target: TwinEvidence[]) {
  const f = frames.get(frame)!;
  const gsd = groundSampleAt(f, u, v) ?? 0.01;
  const size = Math.max(48, Math.round(extentM / gsd));
  const { width: w, height: h } = f.intrinsics;
  const x0 = Math.round(Math.min(Math.max(0, u - size / 2), w - size)), y0 = Math.round(Math.min(Math.max(0, v - size / 2), h - size));
  reqs.push({ photo: frame, x0, y0, size, poly: polyPx, target });
}
const circlePx = (u: number, v: number, r: number): [number, number][] => Array.from({ length: 24 }, (_, i) => [u + r * Math.cos((i * Math.PI) / 12), v + r * Math.sin((i * Math.PI) / 12)]);

// ------------------------------------------------------------------------------------------------------------------
// The bundle
// ------------------------------------------------------------------------------------------------------------------
const twinTrees = trees.map(t => {
  const evidence: TwinEvidence[] = [];
  const best = [...t.members].sort((a, b) => centreDist(a.frame, a.u, a.v) - centreDist(b.frame, b.u, b.v)).slice(0, 2);
  for (const m of best) { const gsd = groundSampleAt(frames.get(m.frame)!, m.u, m.v) ?? 0.01; request(m.frame, m.u, m.v, Math.max(1.2, 2.6 * t.crownRadiusM), circlePx(m.u, m.v, m.rM / gsd), evidence); }
  return { id: t.id, lat: +t.lat.toFixed(8), lng: +t.lng.toFixed(8), crownRadiusM: fix(t.crownRadiusM)!, heightM: fix(t.heightM, 2), seenBy: t.seenBy, coveredBy: t.coveredBy, viewSpreadM: fix(t.viewSpreadM)!, sizeCv: fix(t.sizeCv)!, rowId: treeOfRow.get(t.id) ?? null, evidence };
});
const twinWeeds = weeds.map(w => {
  const evidence: TwinEvidence[] = [];
  const best = [...w.members].sort((a, b) => centreDist(a.frame, a.u, a.v) - centreDist(b.frame, b.u, b.v));
  const nEvidence = w.onTree ? 1 : 2;
  for (const m of best.slice(0, nEvidence)) request(m.frame, m.u, m.v, Math.max(0.6, 2.4 * w.diameterM), m.poly ?? [], evidence);
  // The outline on the map: the best view's outline projected to the soil, centred on the reconciled position.
  const b = best[0], f = frames.get(b.frame)!;
  const c0 = pixelToGround(f, b.u, b.v), [ce, cn] = enOf(w.lat, w.lng);
  const ring = c0 ? thinTo(b.poly ?? [], 16).map(([x, y]) => { const g = pixelToGround(f, x + 0.5, y + 0.5); if (!g) return null; const [e, n] = enOf(g.lat, g.lng), [e0, n0] = enOf(c0.lat, c0.lng); return ll(ce + e - e0, cn + n - n0); }).filter((p): p is [number, number] => !!p) : [];
  const status: "verified" | "single view" | "on a tree" = w.onTree ? "on a tree" : w.verified ? "verified" : "single view";
  return { id: w.id, lat: +w.lat.toFixed(8), lng: +w.lng.toFixed(8), status, rowStatus: w.rowStatus as "on a row" | "between rows" | "no rows", diameterM: fix(w.diameterM)!, areaM2: fix(w.areaM2, 4)!, spanM: fix(w.spanM), heightM: fix(w.heightM, 2), seenBy: w.seenBy, coveredBy: w.coveredBy, viewSpreadM: fix(w.viewSpreadM)!, sizeCv: fix(w.sizeCv)!, score: fix(w.score, 2), treeId: w.treeId, ring, evidence };
});
const twinVeg = vegetation.map(v => {
  const m = [...v.members].sort((a, b) => centreDist(a.frame, a.u, a.v) - centreDist(b.frame, b.u, b.v))[0], f = frames.get(m.frame)!;
  const c0 = pixelToGround(f, m.u, m.v), [ce, cn] = enOf(v.lat, v.lng);
  const ring = c0 ? thinTo((m.data?.hull as [number, number][]) ?? [], 16).map(([x, y]) => { const g = pixelToGround(f, x, y); if (!g) return null; const [e, n] = enOf(g.lat, g.lng), [e0, n0] = enOf(c0.lat, c0.lng); return ll(ce + e - e0, cn + n - n0); }).filter((p): p is [number, number] => !!p) : [];
  return { id: v.id, lat: +v.lat.toFixed(8), lng: +v.lng.toFixed(8), areaM2: fix(v.areaM2, 3)!, seenBy: v.seenBy, ring };
});

// Cut the crops: photographs in order, atlases filled in order, one decoded photo and one atlas in memory.
reqs.sort((a, b) => (a.photo < b.photo ? -1 : a.photo > b.photo ? 1 : 0));
let atlas = new Uint8Array(ATLAS * ATLAS * 4).fill(255), atlasIdx = 0, cellIdx = 0;
const atlases: { file: string; width: number; height: number }[] = [];
const flush = () => {
  const rows = Math.ceil(cellIdx / PER_ROW), hgt = rows * CELL;
  const data = atlas.subarray(0, ATLAS * hgt * 4);
  const file = `atlas-${atlasIdx}.jpg`;
  writeFileSync(join(DIR, file), encodeJpeg({ width: ATLAS, height: hgt, data }, 72));
  atlases.push({ file, width: ATLAS, height: hgt });
  atlasIdx++; cellIdx = 0; atlas = new Uint8Array(ATLAS * ATLAS * 4).fill(255);
};
let current: { name: string; img: ReturnType<typeof decodeImage> } | null = null;
const t0 = Date.now();
for (const r of reqs) {
  if (!current || current.name !== r.photo) { current = { name: r.photo, img: decodeImage(new Uint8Array(readFileSync(join(PHOTOS, `${r.photo}.JPG`)))) }; }
  const img = current.img, cx = (cellIdx % PER_ROW) * CELL, cy = Math.floor(cellIdx / PER_ROW) * CELL, s = r.size / CELL;
  // Box-average when shrinking, nearest when enlarging: the crop is evidence, not decoration.
  const k = Math.max(1, Math.floor(s));
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const sx0 = Math.floor(r.x0 + x * s), sy0 = Math.floor(r.y0 + y * s);
    let R = 0, G = 0, B = 0, n = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
      const xx = Math.min(img.width - 1, sx0 + dx), yy = Math.min(img.height - 1, sy0 + dy), o = (yy * img.width + xx) * 4;
      R += img.data[o]; G += img.data[o + 1]; B += img.data[o + 2]; n++;
    }
    const o = ((cy + y) * ATLAS + cx + x) * 4;
    atlas[o] = R / n; atlas[o + 1] = G / n; atlas[o + 2] = B / n; atlas[o + 3] = 255;
  }
  r.target.push({ photo: r.photo, atlas: atlasIdx, x: cx, y: cy, size: CELL, metresAcross: null, poly: thinTo(r.poly, 20).map(([x, y]) => [Math.round((x - r.x0) / s), Math.round((y - r.y0) / s)] as [number, number]) });
  const ev = r.target[r.target.length - 1];
  const f = frames.get(r.photo)!;
  ev.metresAcross = fix(r.size * (groundSampleAt(f, r.x0 + r.size / 2, r.y0 + r.size / 2) ?? 0.01), 2);
  cellIdx++;
  if (cellIdx === PER_ATLAS) flush();
}
if (cellIdx) flush();
console.log(`${reqs.length} evidence crops in ${atlases.length} atlases (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

const footprints = [...frames.values()].map(f => ({ photo: f.name, ring: frameCorners(f)!.map(g => [+g.lat.toFixed(7), +g.lng.toFixed(7)] as [number, number]) }));
const allPts = [...twinTrees.map(t => [t.lat, t.lng]), ...footprints.flatMap(f => f.ring)];
const first = cached[0].meta;
const bundle: TwinBundle = {
  format: FIELD_TWIN_FORMAT, id: ID,
  name: "Apricot orchard, first test field",
  builtAt: new Date().toISOString(),
  source: {
    photographs: frames.size, camera: `${first.make ?? ""} ${first.model ?? ""}`.trim(), capturedAt: first.capturedAt, groundPixelCm: r2(100 * quant([...frames.values()].map(f => groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy) ?? NaN), 0.5)),
    method: "direct georeferencing from each photograph's header, cameras adjusted to soil-texture ties between overlapping photographs (no orthomosaic); objects reconciled across photographs",
    weedModel: "RF-DETR Seg-Large, confidence 0.5, 1024 px tiles at the photographs' full resolution",
    treeModel: "planting layout (rows read per photograph, fitted, reconciled)",
  },
  origin: { lat: +origin.lat.toFixed(8), lng: +origin.lng.toFixed(8) },
  bounds: [[Math.min(...allPts.map(p => p[0])), Math.min(...allPts.map(p => p[1]))], [Math.max(...allPts.map(p => p[0])), Math.max(...allPts.map(p => p[1]))]],
  field: { rowDirectionDeg: r2(rowsDoc.field.directionRefinedDeg), rowSpacingM: r2(rowsDoc.field.rowSpacingM), plantSpacingM: r2(rowsDoc.field.plantSpacingM) },
  footprints,
  rows: rowsDoc.rows.map(r => ({ id: r.id, kept: r.kept, reason: r.reason, line: r.line, trees: r.trees, inferred: r.inferred, photos: r.photos, lengthM: r.lengthM, straightnessSdM: r.straightnessSdM })),
  trees: twinTrees,
  inferredTrees: rowsDoc.inferred.map(x => ({ row: x.row, lat: +x.lat.toFixed(8), lng: +x.lng.toFixed(8) })),
  weeds: twinWeeds,
  vegetation: twinVeg,
  atlases,
  stats: {
    photographsReadForRows: m2Report.readBy, unreadPhotographs: m2Report.unread,
    weedDetections: m1Report.weeds.detections, weedObjects: m1Report.weeds.objects, verifiedWeeds: m1Report.weeds.verified,
    verifiedBetweenRows: m1Report.weeds.verifiedBetweenRows, weedsOnTrees: m1Report.weeds.onTree, singleViewWeeds: m1Report.weeds.singleView,
    weedRepeatability: m1Report.weeds.repeatability.median, verifiedPositionSpreadM: m1Report.weeds.verifiedPositionSpreadM.median,
    trees: twinTrees.length, treePositionSpreadM: r3(quant(twinTrees.map(t => t.viewSpreadM), 0.5)), keptRows: rowsDoc.rows.filter(r => r.kept).length,
    vegetationPatches: twinVeg.length,
  },
};
// The cultivated-block boundary (scripts/directGeoref/boundary.ts) is carried over when it has been inferred.
// It was inferred on the previous twin's rows and trees: rerun boundaryEvidence.ts and boundary.ts after this
// build when those changed.
const boundaryPath = join(OUT, "boundary", "boundary.json");
if (existsSync(boundaryPath)) { bundle.boundary = (JSON.parse(readFileSync(boundaryPath, "utf8")) as { record: TwinBundle["boundary"] }).record; console.log("boundary carried over from boundary/boundary.json (rerun boundary.ts if the rows changed)"); }
writeFileSync(join(DIR, "twin.json"), JSON.stringify(bundle));
console.log(`twin ${ID}: ${twinTrees.length} trees, ${bundle.inferredTrees.length} inferred positions, ${bundle.rows.filter(r => r.kept).length} rows, ${twinWeeds.length} weed objects (${twinWeeds.filter(w => w.status === "verified").length} verified), ${twinVeg.length} other vegetation patches -> ${DIR}`);
