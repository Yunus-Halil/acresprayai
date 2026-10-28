// Stages 5 to 8: other vegetation, the evidence crops and their atlases, the bundle, then what the photographs
// show at the edges and the cultivated block. The ports of scripts/directGeoref/buildTwin.ts,
// boundaryEvidence.ts and boundary.ts.
import { type AdjustModel, type GeorefFrame, type Observation, frameCorners, groundSampleAt, groundToPixel, pixelToGround, reconcile } from "../../directGeoref";
import { toEnu } from "../../sourceFrames/odm";
import { COVER_EXGR } from "../../weedVision/fieldRows";
import { type BoundaryResult, inferBoundary, reliableRows, toTwinBoundary, treesInCover } from "../boundary";
import { type EvidenceMeasures, type EvidenceTree, classifyEvidence, downsampleEvidence, encodeEvidence } from "../boundaryEvidence";
import { localFrame, pointInRing } from "../intelligence";
import { FIELD_TWIN_FORMAT, type TwinBundle, type TwinEvidence } from "../types";
import { yieldToEvents } from "./cameras";
import type { PhotoRead } from "./photos";
import type { RowsResult } from "./rows";
import { type BuildHooks, type Codec, type PhotoSource, type WeedDetector, checkCancelled, twinIdFrom } from "./types";
import type { WeedsResult } from "./weeds";

const quant = (v: number[], q: number) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(q * (s.length - 1))] : NaN; };
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const fix = (v: number | null | undefined, d = 3) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(d));
function thinTo<T>(pts: T[], n: number): T[] { return pts.length <= n ? pts : Array.from({ length: n }, (_, i) => pts[Math.floor((i * pts.length) / n)]); }

export type BundleInputs = {
  id?: string;
  name: string;
  photos: PhotoSource[];
  reads: PhotoRead[];
  frames: Map<string, GeorefFrame>;
  model: AdjustModel;
  rows: RowsResult | null;
  weeds: WeedsResult;
  detector: WeedDetector;
  cameraReport: Record<string, unknown>;
  codec: Codec;
  down: number;
};

export type BundleOutput = { twin: TwinBundle; atlases: Map<string, Blob | Uint8Array>; crops: number };

const CELL = 112, PER_ROW = 18, PER_ATLAS = PER_ROW * PER_ROW, ATLAS = CELL * PER_ROW;
type Req = { photo: string; x0: number; y0: number; size: number; poly: [number, number][]; target: TwinEvidence[] };

/** Stages 5 and 8: the twin bundle with its atlases (no boundary yet). */
export async function assembleBundle(inp: BundleInputs, hooks: BuildHooks = {}): Promise<BundleOutput> {
  const t0 = Date.now();
  const { frames, model, reads, rows, weeds: weedsRes, codec, photos } = inp;
  const origin = model.origin;
  const enOf = (lat: number, lng: number) => { const e = toEnu({ lat, lng, altM: 0 }, origin); return [e[0], e[1]] as [number, number]; };
  const ll = (e: number, n: number) => { const lat0 = (origin.lat * Math.PI) / 180; return [+(origin.lat + (n / 6378137) * (180 / Math.PI)).toFixed(7), +(origin.lng + (e / (6378137 * Math.cos(lat0))) * (180 / Math.PI)).toFixed(7)] as [number, number]; };
  const trees = (rows?.trees ?? []).filter(t => t.observed);
  const treeOfRow = new Map<number, number>();
  for (const r of rows?.rows ?? []) if (r.kept) for (const t of r.treeIds) treeOfRow.set(t, r.id);
  const weeds = weedsRes.weeds;

  // Stage 5: other vegetation, green patches seen in 2+ photographs that are neither a tree nor a weed.
  hooks.onProgress?.({ stage: "vegetation", done: 0, total: null, message: "reconciling the green patches", elapsedMs: Date.now() - t0 });
  await yieldToEvents();
  const vegObs: Observation[] = [];
  for (const c of reads) {
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
  hooks.log?.(`${vegetation.length} other vegetation patches`);
  checkCancelled(hooks.signal);

  // Evidence crops: requests first, then one pass over the photographs.
  const reqs: Req[] = [];
  const centreDist = (frame: string, u: number, v: number) => { const f = frames.get(frame)!; return Math.hypot(u - f.intrinsics.cx, v - f.intrinsics.cy); };
  function request(frame: string, u: number, v: number, extentM: number, polyPx: [number, number][], target: TwinEvidence[]) {
    const f = frames.get(frame);
    if (!f) return;
    const gsd = groundSampleAt(f, u, v) ?? 0.01;
    const size = Math.max(48, Math.round(extentM / gsd));
    const { width: w, height: h } = f.intrinsics;
    const x0 = Math.round(Math.min(Math.max(0, u - size / 2), w - size)), y0 = Math.round(Math.min(Math.max(0, v - size / 2), h - size));
    reqs.push({ photo: frame, x0, y0, size, poly: polyPx, target });
  }
  const circlePx = (u: number, v: number, r: number): [number, number][] => Array.from({ length: 24 }, (_, i) => [u + r * Math.cos((i * Math.PI) / 12), v + r * Math.sin((i * Math.PI) / 12)]);

  const twinTrees = trees.map(t => {
    const evidence: TwinEvidence[] = [];
    const best = [...t.members].filter(m => frames.has(m.frame)).sort((a, b) => centreDist(a.frame, a.u, a.v) - centreDist(b.frame, b.u, b.v)).slice(0, 2);
    for (const m of best) { const gsd = groundSampleAt(frames.get(m.frame)!, m.u, m.v) ?? 0.01; request(m.frame, m.u, m.v, Math.max(1.2, 2.6 * t.crownRadiusM), circlePx(m.u, m.v, m.rM / gsd), evidence); }
    return { id: t.id, lat: +t.lat.toFixed(8), lng: +t.lng.toFixed(8), crownRadiusM: fix(t.crownRadiusM)!, heightM: fix(t.heightM, 2), seenBy: t.seenBy, coveredBy: t.coveredBy, viewSpreadM: fix(t.viewSpreadM)!, sizeCv: fix(t.sizeCv)!, rowId: treeOfRow.get(t.id) ?? null, evidence };
  });
  const twinWeeds = weeds.map(w => {
    const evidence: TwinEvidence[] = [];
    const best = [...w.members].filter(m => frames.has(m.frame)).sort((a, b) => centreDist(a.frame, a.u, a.v) - centreDist(b.frame, b.u, b.v));
    const nEvidence = w.onTree ? 1 : 2;
    for (const m of best.slice(0, nEvidence)) request(m.frame, m.u, m.v, Math.max(0.6, 2.4 * w.diameterM), m.poly ?? [], evidence);
    const b = best[0], f = b ? frames.get(b.frame)! : null;
    const c0 = f ? pixelToGround(f, b.u, b.v) : null, [ce, cn] = enOf(w.lat, w.lng);
    const ring = c0 && f ? thinTo(b.poly ?? [], 16).map(([x, y]) => { const g = pixelToGround(f, x + 0.5, y + 0.5); if (!g) return null; const [e, n] = enOf(g.lat, g.lng), [e0, n0] = enOf(c0.lat, c0.lng); return ll(ce + e - e0, cn + n - n0); }).filter((p): p is [number, number] => !!p) : [];
    const status: "verified" | "single view" | "on a tree" = w.onTree ? "on a tree" : w.verified ? "verified" : "single view";
    return { id: w.id, lat: +w.lat.toFixed(8), lng: +w.lng.toFixed(8), status, rowStatus: w.rowStatus, diameterM: fix(w.diameterM)!, areaM2: fix(w.areaM2, 4)!, spanM: fix(w.spanM), heightM: fix(w.heightM, 2), seenBy: w.seenBy, coveredBy: w.coveredBy, viewSpreadM: fix(w.viewSpreadM)!, sizeCv: fix(w.sizeCv)!, score: fix(w.score, 2), treeId: w.treeId, ring, evidence };
  });
  const twinVeg = vegetation.map(v => {
    const m = [...v.members].filter(x => frames.has(x.frame)).sort((a, b) => centreDist(a.frame, a.u, a.v) - centreDist(b.frame, b.u, b.v))[0], f = m ? frames.get(m.frame)! : null;
    const c0 = f ? pixelToGround(f, m.u, m.v) : null, [ce, cn] = enOf(v.lat, v.lng);
    const ring = c0 && f ? thinTo((m.data?.hull as [number, number][]) ?? [], 16).map(([x, y]) => { const g = pixelToGround(f, x, y); if (!g) return null; const [e, n] = enOf(g.lat, g.lng), [e0, n0] = enOf(c0.lat, c0.lng); return ll(ce + e - e0, cn + n - n0); }).filter((p): p is [number, number] => !!p) : [];
    return { id: v.id, lat: +v.lat.toFixed(8), lng: +v.lng.toFixed(8), areaM2: fix(v.areaM2, 3)!, seenBy: v.seenBy, ring };
  });

  // Stage 8: cut the crops, photographs in order, atlases filled in order.
  reqs.sort((a, b) => (a.photo < b.photo ? -1 : a.photo > b.photo ? 1 : 0));
  const byPhoto = new Map<string, Req[]>();
  for (const r of reqs) (byPhoto.get(r.photo) ?? byPhoto.set(r.photo, []).get(r.photo)!).push(r);
  const sources = new Map(photos.map(p => [p.name, p]));
  let atlas = new Uint8ClampedArray(ATLAS * ATLAS * 4).fill(255), atlasIdx = 0, cellIdx = 0;
  const atlases: { file: string; width: number; height: number }[] = [];
  const atlasFiles = new Map<string, Blob | Uint8Array>();
  const flush = async () => {
    const rowsN = Math.ceil(cellIdx / PER_ROW), hgt = rowsN * CELL;
    const file = `atlas-${atlasIdx}.jpg`;
    atlasFiles.set(file, await codec.encodeJpeg(atlas.subarray(0, ATLAS * hgt * 4), ATLAS, hgt, 0.72));
    atlases.push({ file, width: ATLAS, height: hgt });
    atlasIdx++; cellIdx = 0; atlas = new Uint8ClampedArray(ATLAS * ATLAS * 4).fill(255);
  };
  let done = 0;
  for (const [name, list] of byPhoto) {
    checkCancelled(hooks.signal);
    hooks.onProgress?.({ stage: "bundle", done, total: reqs.length, message: `${name}: ${list.length} evidence crops`, elapsedMs: Date.now() - t0 });
    const src = sources.get(name);
    if (!src) continue;
    const cut = await src.crops(list.map(r => ({ x0: r.x0, y0: r.y0, size: r.size, out: CELL })));
    for (const [k, r] of list.entries()) {
      const px = cut[k], cx = (cellIdx % PER_ROW) * CELL, cy = Math.floor(cellIdx / PER_ROW) * CELL, s = r.size / CELL;
      for (let y = 0; y < CELL; y++) atlas.set(px.subarray(y * CELL * 4, (y + 1) * CELL * 4), ((cy + y) * ATLAS + cx) * 4);
      const f = frames.get(r.photo)!;
      r.target.push({ photo: r.photo, atlas: atlasIdx, x: cx, y: cy, size: CELL, metresAcross: fix(r.size * (groundSampleAt(f, r.x0 + r.size / 2, r.y0 + r.size / 2) ?? 0.01), 2), poly: thinTo(r.poly, 20).map(([x, y]) => [Math.round((x - r.x0) / s), Math.round((y - r.y0) / s)] as [number, number]) });
      cellIdx++; done++;
      if (cellIdx === PER_ATLAS) await flush();
    }
  }
  if (cellIdx) await flush();
  hooks.log?.(`${reqs.length} evidence crops in ${atlases.length} atlases`);

  const footprints = [...frames.values()].map(f => ({ photo: f.name, ring: (frameCorners(f) ?? []).map(g => [+g.lat.toFixed(7), +g.lng.toFixed(7)] as [number, number]) })).filter(f => f.ring.length === 4);
  const allPts = [...twinTrees.map(t => [t.lat, t.lng]), ...footprints.flatMap(f => f.ring)];
  const first = reads[0]?.meta;
  const capturedAt = first?.capturedAt ?? null;
  const id = inp.id ?? twinIdFrom(inp.name, capturedAt);
  const bundle: TwinBundle = {
    format: FIELD_TWIN_FORMAT, id,
    name: inp.name,
    builtAt: new Date().toISOString(),
    source: {
      photographs: frames.size, camera: `${first?.make ?? ""} ${first?.model ?? ""}`.trim(), capturedAt, groundPixelCm: r2(100 * quant([...frames.values()].map(f => groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy) ?? NaN), 0.5)),
      method: "direct georeferencing from each photograph's header, cameras adjusted to soil-texture ties between overlapping photographs (no orthomosaic); objects reconciled across photographs; built in the app",
      weedModel: inp.detector ? "RF-DETR Seg-Large, confidence 0.5, 1024 px tiles at the photographs' full resolution" : "none (built without the weed model)",
      treeModel: "planting layout (rows read per photograph, fitted, reconciled)",
    },
    origin: { lat: +origin.lat.toFixed(8), lng: +origin.lng.toFixed(8) },
    bounds: allPts.length ? [[Math.min(...allPts.map(p => p[0])), Math.min(...allPts.map(p => p[1]))], [Math.max(...allPts.map(p => p[0])), Math.max(...allPts.map(p => p[1]))]] : [[origin.lat, origin.lng], [origin.lat, origin.lng]],
    field: rows ? { rowDirectionDeg: r2(rows.field.directionRefinedDeg), rowSpacingM: r2(rows.field.rowSpacingM), plantSpacingM: r2(rows.field.plantSpacingM) } : { rowDirectionDeg: 0, rowSpacingM: 0, plantSpacingM: 0 },
    footprints,
    rows: (rows?.rows ?? []).map(r => ({ id: r.id, kept: r.kept, reason: r.reason, line: r.line, trees: r.trees, inferred: r.inferred, photos: r.photos, lengthM: r.lengthM, straightnessSdM: r.straightnessSdM })),
    trees: twinTrees,
    inferredTrees: (rows?.inferred ?? []).map(x => ({ row: x.row, lat: +x.lat.toFixed(8), lng: +x.lng.toFixed(8) })),
    weeds: twinWeeds,
    vegetation: twinVeg,
    atlases,
    stats: {
      photographsReadForRows: rows?.report.readBy ?? null, unreadPhotographs: rows?.report.unread ?? null,
      cameras: inp.cameraReport,
      weedDetections: weedsRes.detections, weedObjects: weeds.length, verifiedWeeds: twinWeeds.filter(w => w.status === "verified").length,
      verifiedBetweenRows: twinWeeds.filter(w => w.status === "verified" && w.rowStatus === "between rows").length, weedsOnTrees: twinWeeds.filter(w => w.status === "on a tree").length, singleViewWeeds: twinWeeds.filter(w => w.status === "single view").length,
      weedStats: weedsRes.stats, photographsWithoutWeedAnswer: weedsRes.photographsFailed,
      trees: twinTrees.length, treePositionSpreadM: r3(quant(twinTrees.map(t => t.viewSpreadM), 0.5)), keptRows: (rows?.rows ?? []).filter(r => r.kept).length,
      vegetationPatches: twinVeg.length,
    },
  };
  return { twin: bundle, atlases: atlasFiles, crops: reqs.length };
}

export type EvidenceOutput = { boundary: BoundaryResult | null; cells: number; sampledMs: number; classifyMs: number; note: string | null };

/**
 * Stages 6 and 7: the evidence raster sampled from the photographs (the nearest-nadir photograph per cell), the
 * classes, and the cultivated block written into the twin. Without rows there is no block and nothing is sampled.
 */
export async function evidenceAndBoundary(twin: TwinBundle, photos: PhotoSource[], frames: Map<string, GeorefFrame>, model: AdjustModel, down: number, cellM: number, hooks: BuildHooks = {}): Promise<EvidenceOutput> {
  const t0 = Date.now();
  if (!twin.rows.some(r => r.kept)) { twin.boundary = null; return { boundary: null, cells: 0, sampledMs: 0, classifyMs: 0, note: "no kept rows: no cultivated block" }; }
  const fr = localFrame(twin);
  const groundAlt = model.globals.groundOffsetM;
  type Photo = { name: string; ring: [number, number][]; nadir: [number, number]; box: [number, number, number, number] };
  const ph: Photo[] = [];
  for (const f of frames.values()) {
    const corners = frameCorners(f), nadir = pixelToGround(f, f.intrinsics.cx, f.intrinsics.cy);
    if (!corners || !nadir) continue;
    const ring = corners.map(c => fr.toField(...fr.toLocal(c.lat, c.lng)));
    const n = fr.toField(...fr.toLocal(nadir.lat, nadir.lng));
    ph.push({ name: f.name, ring, nadir: n, box: [Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1])), Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))] });
  }
  const along0 = Math.floor(Math.min(...ph.map(p => p.box[0])) / cellM) * cellM, across0 = Math.floor(Math.min(...ph.map(p => p.box[1])) / cellM) * cellM;
  const width = Math.ceil((Math.max(...ph.map(p => p.box[2])) - along0) / cellM), height = Math.ceil((Math.max(...ph.map(p => p.box[3])) - across0) / cellM);
  const N = width * height;
  const cover = new Float32Array(N), luma = new Float32Array(N), sat = new Float32Array(N), seen = new Uint8Array(N);
  const exgrOf = (r: number, g: number, b: number) => { const s = r + g + b; if (s <= 0) return -1; const rr = r / s, gg = g / s, bb = b / s; return 2 * gg - rr - bb - (1.4 * rr - gg); };
  const cellsBy = new Map<number, number[]>();
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const al = along0 + (i + 0.5) * cellM, ac = across0 + (j + 0.5) * cellM;
    let best = -1, bd = Infinity;
    for (let k = 0; k < ph.length; k++) {
      const p = ph[k];
      if (al < p.box[0] || al > p.box[2] || ac < p.box[1] || ac > p.box[3] || !pointInRing(al, ac, p.ring)) continue;
      const d = (p.nadir[0] - al) ** 2 + (p.nadir[1] - ac) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    if (best < 0) continue;
    (cellsBy.get(best) ?? cellsBy.set(best, []).get(best)!).push(j * width + i);
  }
  const sources = new Map(photos.map(p => [p.name, p]));
  let done = 0;
  for (const [k, cells] of cellsBy) {
    checkCancelled(hooks.signal);
    hooks.onProgress?.({ stage: "evidence", done, total: cellsBy.size, message: `${ph[k].name}: ${cells.length} cells`, elapsedMs: Date.now() - t0 });
    const src = sources.get(ph[k].name), f = frames.get(ph[k].name);
    done++;
    if (!src || !f) continue;
    const img = await src.decode(down);
    const dn = f.intrinsics.width / img.width;
    // The box averaged per cell: the cell's width in this photograph's own pixels (its ground sample at the
    // frame centre times the decode ratio), half each way.
    const pxM = (groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy) ?? 0.01) * dn;
    const HALF = Math.max(1, Math.round(cellM / pxM / 2));
    for (const c of cells) {
      const i = c % width, j = (c - i) / width;
      const [e, n] = fr.fromField(along0 + (i + 0.5) * cellM, across0 + (j + 0.5) * cellM);
      const [lat, lng] = fr.toLatLng(e, n);
      const hit = groundToPixel(f, lat, lng, groundAlt);
      if (!hit) continue;
      const u = Math.round(hit.u / dn), v = Math.round(hit.v / dn);
      let nPx = 0, cv = 0, L = 0, S = 0;
      for (let dy = -HALF; dy <= HALF; dy++) for (let dx = -HALF; dx <= HALF; dx++) {
        const x = u + dx, y = v + dy;
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
        const o = (y * img.width + x) * 4, r = img.rgba[o], g = img.rgba[o + 1], b = img.rgba[o + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        nPx++; if (exgrOf(r, g, b) > COVER_EXGR) cv++; L += 0.299 * r + 0.587 * g + 0.114 * b; S += mx > 0 ? (mx - mn) / mx : 0;
      }
      if (!nPx) continue;
      seen[c] = 1; cover[c] = cv / nPx; luma[c] = L / nPx; sat[c] = S / nPx;
    }
  }
  const sampledMs = Date.now() - t0;
  const measures: EvidenceMeasures = { cellM, along0, across0, width, height, seen, cover, luma, sat };
  checkCancelled(hooks.signal);
  hooks.onProgress?.({ stage: "boundary", done: 0, total: null, message: "classifying the ground and walking the edges", elapsedMs: Date.now() - t0 });
  await yieldToEvents();
  const t1 = Date.now();
  const treesFor = (rowIds: Set<number>, exclude: Set<number>): EvidenceTree[] => twin.trees.map(t => { const [al, ac] = fr.toField(...fr.toLocal(t.lat, t.lng)); return { along: al, across: ac, r: t.crownRadiusM, onRow: !exclude.has(t.id) && t.rowId != null && rowIds.has(t.rowId) }; });
  const pass1 = reliableRows(twin);
  let raster = classifyEvidence(measures, treesFor(new Set(pass1.rows.map(r => r.id)), new Set(pass1.trimmed.flatMap(t => t.ids)))).raster;
  const inCover = treesInCover(twin, raster, fr);
  const pass2 = reliableRows(twin, raster, {}, inCover, fr);
  raster = classifyEvidence(measures, treesFor(new Set(pass2.rows.map(r => r.id)), new Set([...inCover, ...pass2.trimmed.flatMap(t => t.ids)]))).raster;
  const result = inferBoundary(twin, raster);
  const classifyMs = Date.now() - t1;
  if (!result) { twin.boundary = null; return { boundary: null, cells: N, sampledMs, classifyMs, note: "no reliable row: no cultivated block" }; }
  const coarse = downsampleEvidence(raster, Math.max(1, Math.round(0.5 / raster.cellM)));
  twin.boundary = toTwinBoundary(result, fr, encodeEvidence(coarse));
  hooks.log?.(`cultivated block ${(result.areaM2 / 10_000).toFixed(3)} ha, ${result.vertices.length} vertices, ${Math.round(100 * result.stats.support.photographs)} % of the edges seen in the photographs`);
  for (const f of result.failures) hooks.log?.(`  note: ${f}`);
  return { boundary: result, cells: N, sampledMs, classifyMs, note: null };
}
