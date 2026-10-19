// The two-stage prototype on real orchard imagery, headless (2026-10-19).
//
//   npx vite-node scripts/bench/twoStageTrial.ts -- --dir <trial dir> --frames DJI_0301,DJI_0303 [--service http://127.0.0.1:8765] [--fresh]
//
// The real orthomosaic is only reachable through the signed-in app, so each orchard frame prepared by
// research/weed-vision-lab/scripts/prep_two_stage_trial.py stands in for a field map (north-up, flat ground, its
// EXIF-estimated pixel size). Everything else is the app's own code: the field row reader (fieldRowsFromPixels on the
// same read zoom), readStage1, the router, the two-stage store's Stage 2 with its window cache, groundMapResult and
// the scorecard. RF-DETR runs in the local weed-vision service, the same one the app calls. Nothing is uploaded and
// no source image is written. Outputs per frame: trial.json, overlay.png, window-cache.json.
import "./nodeStorageShim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeJpeg, encodePng } from "./images";
import type { LatLng2 } from "../../src/lib/geo";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import type { DetectOptions, WeedVisionResult } from "../../src/lib/weedVision/client";
import { type FieldRows, fieldReadPlan, fieldRowStatusAt, fieldRowsFromPixels, vegetationMask } from "../../src/lib/weedVision/fieldRows";
import type { SavedFrameRun } from "../../src/lib/weedVision/frameRunCache";
import { resetFrameRunStore, setFrameRunBoundary, setFrameRunMap } from "../../src/lib/weedVision/frameRunStore";
import type { GroundPlant } from "../../src/lib/weedVision/frames";
import { type MapChunk, chunkCanvas, latLngOfPx, mercatorPx } from "../../src/lib/weedVision/mapRun";
import { isOnRow } from "../../src/lib/weedVision/rowFilter";
import { ROUTING_REASONS } from "../../src/lib/weedVision/twoStage/router";
import { patchesOf, scoreTwoStage, weedM2ByCell } from "../../src/lib/weedVision/twoStage/score";
import { cellAt, cellKey, readStage1 } from "../../src/lib/weedVision/twoStage/stage1";
import { getTwoStage, resetTwoStageStore, runStage1, runStage2, twoStagePlants } from "../../src/lib/weedVision/twoStage/twoStageStore";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = arg("dir")!;
const FRAMES = (arg("frames") ?? "").split(",").filter(Boolean);
const SERVICE = arg("service", "http://127.0.0.1:8765")!;
const FRESH = argv.includes("--fresh");
const PARAMS = { algorithm: "rfdetr_seg_large", threshold: 0.5, tile: 1024, overlap: 256, scale: 1 };

type Raster = { z: number; X0: number; Y0: number; w: number; h: number; rgba: Uint8Array };
type Meta = { frame: string; lat: number; lng: number; gsd_m: number; mpp23: number; z23: { X0: number; Y0: number; w: number; h: number }; z22: { X0: number; Y0: number; w: number; h: number }; labels?: { cls: string; X: number; Y: number }[] };

function slice(r: Raster, gx: number, gy: number, w: number, h: number): PhotoPixels {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = gy + y - r.Y0;
    if (sy < 0 || sy >= r.h) continue;
    const x0 = Math.max(0, r.X0 - gx), x1 = Math.min(w, r.X0 + r.w - gx);
    if (x1 <= x0) continue;
    const s = (sy * r.w + (gx + x0 - r.X0)) * 4;
    out.set(r.rgba.subarray(s, s + (x1 - x0) * 4), (y * w + x0) * 4);
  }
  return { width: w, height: h, rgba: out };
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
const ms = (t0: number) => Math.round(performance.now() - t0);

type Call = { name: string; wallMs: number; serviceMs: number | null; peakGpuMb: number | null; peakWsMb: number | null; upBytes: number; downBytes: number; weeds: number; crops: number };

async function trialFrame(frame: string, modelSha: string | null) {
  const d = join(DIR, frame);
  const meta: Meta = JSON.parse(readFileSync(join(d, "meta.json"), "utf8"));
  const r23: Raster = { z: 23, ...meta.z23, rgba: new Uint8Array(readFileSync(join(d, "z23.rgba"))) };
  const r22: Raster = { z: 22, ...meta.z22, rgba: new Uint8Array(readFileSync(join(d, "z22.rgba"))) };
  const draw = async (_t: unknown, z: number, gx: number, gy: number, w: number, h: number) => (z === 23 ? slice(r23, gx, gy, w, h) : z === 22 ? slice(r22, gx, gy, w, h) : null);
  const { X0, Y0, w, h } = meta.z23;
  const ring: LatLng2[] = [latLngOfPx(X0, Y0, 23), latLngOfPx(X0 + w, Y0, 23), latLngOfPx(X0 + w, Y0 + h, 23), latLngOfPx(X0, Y0 + h, 23)];
  const task = `trial-${frame}`;
  resetFrameRunStore(); resetTwoStageStore();
  setFrameRunMap(task, { tile: () => "", maxNative: 23, lat: meta.lat, lng: meta.lng });
  setFrameRunBoundary(task, [ring]);

  // The field's rows, read the way readFieldRows reads them, from the same zoom's pixels.
  let t0 = performance.now();
  const plan = fieldReadPlan([ring], 23, meta.lat)!;
  const fit = fieldRowsFromPixels((await draw(null, plan.z, plan.left, plan.top, plan.width, plan.height))!, plan.mpp);
  const rows: FieldRows | null = fit ? { ...fit, z: plan.z, left: plan.left, top: plan.top, mpp: plan.mpp } : null;
  const rowsMs = ms(t0);

  // The window cache, kept on disk between runs of this script (the app keeps it in scan_frame_detections).
  const cacheFile = join(d, "window-cache.json");
  const store = new Map<string, SavedFrameRun>(!FRESH && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : []);
  const calls: Call[] = [];
  const detect = async (file: Blob, filename: string, opts: DetectOptions): Promise<{ ok: true; value: WeedVisionResult } | { ok: false; error: string }> => {
    const fd = new FormData();
    fd.append("image", file, filename);
    for (const [k, v] of Object.entries({ algorithm: opts.algorithm, scale: String(opts.scale), tile: String(opts.tile), overlap: String(opts.overlap), threshold: String(opts.threshold), include_crop: "1", geometry: opts.geometry ?? "full" })) fd.append(k, v);
    const a = performance.now();
    const res = await fetch(`${SERVICE}/weed-vision/detect`, { method: "POST", body: fd });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: text.slice(0, 300) };
    const j = JSON.parse(text) as WeedVisionResult;
    calls.push({ name: filename, wallMs: ms(a), serviceMs: j.timings_ms?.total ?? null, peakGpuMb: j.memory?.peak_gpu_mb ?? null, peakWsMb: j.memory?.peak_working_set_mb ?? null, upBytes: file.size, downBytes: text.length, weeds: j.instances.length, crops: j.crop_instances?.length ?? 0 });
    return { ok: true, value: j };
  };
  const mapChunk = async (chunk: MapChunk) => {
    const cv = chunkCanvas(chunk);
    const px = slice(r23, cv.left, cv.top, cv.width, cv.height);
    let covered = 0;
    for (let i = 3; i < px.rgba.length; i += 4) if (px.rgba[i] > 0) covered++;
    const jpeg = encodeJpeg({ width: px.width, height: px.height, data: new Uint8Array(px.rgba.buffer) }, 95);
    return { pixels: px, image: new Blob([jpeg], { type: "image/jpeg" }), coverage: covered / (cv.width * cv.height) };
  };
  const deps = {
    readStage1: (i: Parameters<typeof readStage1>[0]) => readStage1({ ...i, draw: draw as never }),
    ensureRows: async () => undefined, rowsOf: () => rows ?? undefined,
    mapChunk, detect,
    cache: {
      load: async (_s: string, key: string) => new Map([...store.entries()].filter(([k]) => k.startsWith(`${key}|`)).map(([k, v]) => [k.slice(key.length + 1), v])),
      save: async ({ paramsKey, run }: { paramsKey: string; run: SavedFrameRun }) => { store.set(`${paramsKey}|${run.filename}`, run); return { ok: true as const }; },
    },
  };

  t0 = performance.now();
  await runStage1(task, { params: PARAMS, modelSha, photoGsdM: meta.gsd_m, deps: deps as never });
  const stage1WallMs = ms(t0);
  const s1 = getTwoStage(task);
  if (!s1.stage1 || !s1.routing) throw new Error(`stage 1 failed on ${frame}: ${s1.error}`);
  const cachedBefore = Object.keys(s1.runs).length;

  const until = async () => { while (getTwoStage(task).running) await sleep(50); const e = getTwoStage(task).error; if (e) throw new Error(e); };
  t0 = performance.now();
  runStage2(task, { userId: "trial", mode: "routed", deps: deps as never });
  await until();
  const routedWallMs = ms(t0);
  const routedCalls = calls.length;
  t0 = performance.now();
  runStage2(task, { userId: "trial", mode: "everywhere", deps: deps as never });
  await until();
  const referenceWallMs = ms(t0);
  writeFileSync(cacheFile, JSON.stringify([...store.entries()]));

  const s = getTwoStage(task);
  const st = s.stage1!, routing = s.routing!, g = st.grid;
  const plants = twoStagePlants(s);
  const ran = new Map(Object.entries(s.runs).map(([k, v]) => [k, v.ms]));
  const allWindows = s.windows.map(x => x.name);
  const report = scoreTwoStage({ stage1: st, routing, plants, ran, allWindows });

  // ---------------- diagnostics on the reference (RF-DETR on every window)
  const weeds = plants.filter(p => p.klass === "weed");
  const byStatus: Record<string, number> = {};
  for (const p of weeds) byStatus[p.rowStatus ?? "none"] = (byStatus[p.rowStatus ?? "none"] ?? 0) + 1;
  const cellOf = (p: GroundPlant) => { const [X, Y] = mercatorPx(p.centre!.lat, p.centre!.lng, g.z); const c = cellAt(g, X, Y); return c ? cellKey(c.i, c.j) : null; };
  const byKey = new Map(st.cells.map(c => [c.key, c]));
  const candidate = new Set(st.hotspots.flatMap(x => x.cells));
  const inspected = new Set(routing.order.flatMap(wn => routing.cellsOf.get(wn) ?? []));
  // Where the reference's weed canopy sits, by what Stage 1 said about the cell.
  const where: Record<string, { weeds: number; m2: number }> = {};
  const put = (k: string, p: GroundPlant) => { const e = where[k] ?? (where[k] = { weeds: 0, m2: 0 }); e.weeds++; e.m2 += p.areaM2 ?? 0; };
  for (const p of weeds) {
    if (!p.centre) continue;
    const k = cellOf(p);
    const c = k ? byKey.get(k) : undefined;
    const tag = isOnRow(p.rowStatus) ? "set aside as crop (on a row or crop plant)" : !c ? "outside the grid" : candidate.has(k!) ? "in a candidate cell" : inspected.has(k!) ? "in an inspected window, not a candidate" :
      c.uncertain.includes("mostly crop row") ? "not inspected: cell mostly crop row" : c.uncertain.length ? `not inspected: ${c.uncertain.join("+")}` : "not inspected: below the pressure floor";
    put(tag, p);
  }
  // Tree-sized "weeds" off the rows: a crown the row read missed would show here.
  const treeSized = weeds.filter(p => !isOnRow(p.rowStatus) && (p.areaM2 ?? 0) >= 0.5).map(p => ({ id: p.id, areaM2: +(p.areaM2 ?? 0).toFixed(2), score: p.score, status: p.rowStatus }));
  // Duplicates across window seams: weeds from different windows whose outline boxes overlap.
  const boxes = weeds.filter(p => p.ring && p.ring.length >= 3).map(p => {
    const xs = p.ring!.map(q => q.lng), ys = p.ring!.map(q => q.lat);
    return { p, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
  let crossWindowOverlaps = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.p.frame !== b.p.frame && a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) crossWindowOverlaps++;
  }
  const touchingCanvasEdge = weeds.filter(p => p.touchesBorder).length;
  // Placement: every weed centre back to the raster, and whether there is green within 2 px of it (z23 pixels).
  const green23 = vegetationMask(slice(r23, X0, Y0, w, h));
  let onGreen = 0, placed = 0;
  for (const p of weeds) {
    if (!p.centre) continue;
    const [X, Y] = mercatorPx(p.centre.lat, p.centre.lng, 23);
    const x = Math.round(X - 0.5 - X0), y = Math.round(Y - 0.5 - Y0);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    placed++;
    let hit = false;
    for (let dy = -2; dy <= 2 && !hit; dy++) for (let dx = -2; dx <= 2 && !hit; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && green23[yy * w + xx]) hit = true; }
    if (hit) onGreen++;
  }
  // Alignment: weed centres on green at every whole-pixel offset; a placement error shows as a peak away from (0, 0).
  const scan: { dx: number; dy: number; onGreen: number }[] = [];
  const centres = weeds.filter(p => p.centre).map(p => { const [X, Y] = mercatorPx(p.centre!.lat, p.centre!.lng, 23); return [Math.round(X - 0.5 - X0), Math.round(Y - 0.5 - Y0)]; });
  for (let dy = -8; dy <= 8; dy += 2) for (let dx = -8; dx <= 8; dx += 2) {
    let n = 0;
    for (const [x, y] of centres) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && green23[yy * w + xx]) n++; }
    scan.push({ dx, dy, onGreen: n });
  }
  const best = scan.reduce((a, b) => (b.onGreen > a.onGreen ? b : a));
  const at0 = scan.find(q => q.dx === 0 && q.dy === 0)!.onGreen;
  // Cross-window pairs in detail: centre distance and the two areas, so a plant cut in two is told from two plants.
  const pairs: { d_cm: number; a_m2: number; b_m2: number }[] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.p.frame === b.p.frame || !(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1)) continue;
    const [ax, ay] = mercatorPx(a.p.centre!.lat, a.p.centre!.lng, 23), [bx, by] = mercatorPx(b.p.centre!.lat, b.p.centre!.lng, 23);
    pairs.push({ d_cm: Math.round(Math.hypot(ax - bx, ay - by) * meta.mpp23 * 100), a_m2: +(a.p.areaM2 ?? 0).toFixed(3), b_m2: +(b.p.areaM2 ?? 0).toFixed(3) });
  }
  // Reference patches carried by tree-sized detections (0.5 m² or more, off the rows): RF-DETR calls tree crowns weed.
  const cellM2t = (g.cellPx * g.mpp) ** 2;
  const coverT = new Map<string, number>(), bigT = new Map<string, number>();
  for (const p of weeds) {
    if (!p.centre || isOnRow(p.rowStatus) || p.areaM2 == null) continue;
    const k = cellOf(p);
    if (!k) continue;
    coverT.set(k, (coverT.get(k) ?? 0) + p.areaM2);
    if (p.areaM2 >= 0.5) bigT.set(k, (bigT.get(k) ?? 0) + p.areaM2);
  }
  const coverShare = new Map([...coverT.entries()].map(([k, v]) => [k, v / ((byKey.get(k)?.imagedShare ?? 1) * cellM2t)]));
  const refPatches = patchesOf(coverShare, cellM2t);
  const treeCarried = refPatches.filter(pt => { const tot = pt.cells.reduce((a, k) => a + (coverT.get(k) ?? 0), 0); const big = pt.cells.reduce((a, k) => a + (bigT.get(k) ?? 0), 0); return tot > 0 && big / tot >= 0.5; });
  const patchesCarriedByTreeSized = { patches: refPatches.length, carried: treeCarried.length, highPriority: refPatches.filter(x => x.highPriority).length, highPriorityCarried: treeCarried.filter(x => x.highPriority).length };
  // The largest off-row tree-sized detection, at full map resolution, with its outline, for a look.
  const biggest = weeds.filter(p => !isOnRow(p.rowStatus) && p.ring && p.centre).sort((a, b) => (b.areaM2 ?? 0) - (a.areaM2 ?? 0))[0];
  if (biggest) {
    const [cx, cy] = mercatorPx(biggest.centre!.lat, biggest.centre!.lng, 23);
    const S = 300, gx = Math.round(cx - S / 2), gy = Math.round(cy - S / 2);
    const crop = slice(r23, gx, gy, S, S);
    const data = new Uint8Array(crop.rgba.buffer.slice(0));
    const ringPx = biggest.ring!.map(q => { const [X, Y] = mercatorPx(q.lat, q.lng, 23); return [X - gx, Y - gy]; });
    for (let k = 0; k < ringPx.length; k++) {
      const [ax, ay] = ringPx[k], [bx, by] = ringPx[(k + 1) % ringPx.length];
      const n = Math.ceil(Math.hypot(bx - ax, by - ay));
      for (let t = 0; t <= n; t++) { const x = Math.round(ax + ((bx - ax) * t) / n), y = Math.round(ay + ((by - ay) * t) / n); if (x >= 0 && y >= 0 && x < S && y < S) { const o = (y * S + x) * 4; data[o] = 255; data[o + 1] = 230; data[o + 2] = 0; data[o + 3] = 255; } }
    }
    writeFileSync(join(d, "largest-offrow-weed.png"), encodePng({ width: S, height: S, data }));
  }
  // How many windows a free placement would need: greedy cover of the cells that route with squares of whole cells.
  const routeCells = new Set([...candidate, ...st.cells.filter(c => c.uncertain.some(x => ROUTING_REASONS.has(x))).map(c => c.key)]);
  const span = Math.floor((s.windows[0]?.size ?? 0) * 2 ** (g.z - 23) / g.cellPx);
  let freeWindows = 0;
  if (span >= 1) {
    const left = new Set(routeCells);
    while (left.size) {
      let bestKey = "", bestN = -1;
      for (const k of left) {
        const [ci, cj] = k.split(":").map(Number);
        for (let oi = 0; oi < span; oi++) for (let oj = 0; oj < span; oj++) {
          let n = 0;
          for (let a = 0; a < span; a++) for (let b = 0; b < span; b++) if (left.has(cellKey(ci - oi + a, cj - oj + b))) n++;
          if (n > bestN) { bestN = n; bestKey = `${ci - oi}:${cj - oj}`; }
        }
      }
      const [bi, bj] = bestKey.split(":").map(Number);
      for (let a = 0; a < span; a++) for (let b = 0; b < span; b++) left.delete(cellKey(bi + a, bj + b));
      freeWindows++;
    }
  }
  // The hand-labelled weed points (DJI_0301 only; not exhaustive): where each sits.
  let labels: Record<string, number> | null = null;
  if (meta.labels) {
    const cover = new Map<string, number>();
    const wm = weedM2ByCell(weeds, g);
    const cellM2 = (g.cellPx * g.mpp) ** 2;
    for (const c of st.cells) cover.set(c.key, (wm.get(c.key) ?? 0) / (c.imagedShare * cellM2));
    const refPatchCells = new Set(patchesOf(cover, cellM2).flatMap(p => p.cells));
    labels = { weedPoints: 0, inGrid: 0, inCandidateCell: 0, inInspectedWindow: 0, inReferencePatchCell: 0, inRowBandCell: 0, inShadowCell: 0, inMostlyRowCellNotInspected: 0, onRowOrCrop: 0, nearReferenceWeed30cm: 0 };
    const refPts = weeds.filter(p => p.centre).map(p => mercatorPx(p.centre!.lat, p.centre!.lng, 23));
    for (const l of meta.labels.filter(x => x.cls === "weed")) {
      labels.weedPoints++;
      const c = cellAt(g, l.X / 2 ** (23 - g.z), l.Y / 2 ** (23 - g.z));
      const k = c ? cellKey(c.i, c.j) : null;
      const cell = k ? byKey.get(k) : undefined;
      if (!cell) continue;
      labels.inGrid++;
      if (candidate.has(k!)) labels.inCandidateCell++;
      if (inspected.has(k!)) labels.inInspectedWindow++;
      if (refPatchCells.has(k!)) labels.inReferencePatchCell++;
      if (cell.bandShare > 0) labels.inRowBandCell++;
      if (cell.uncertain.includes("shadow")) labels.inShadowCell++;
      if (cell.uncertain.includes("mostly crop row") && !inspected.has(k!)) labels.inMostlyRowCellNotInspected++;
      if (rows && isOnRow(fieldRowStatusAt(rows, latLngOfPx(l.X, l.Y, 23)))) labels.onRowOrCrop++;
      if (refPts.some(([x, y]) => Math.hypot(x - l.X, y - l.Y) * meta.mpp23 <= 0.3)) labels.nearReferenceWeed30cm++;
    }
  }
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, v) => a + (v ?? 0), 0);
  const out = {
    frame, lat: meta.lat, lng: meta.lng, rasterPx: [w, h], fieldM2: Math.round(w * h * meta.mpp23 ** 2),
    rows: rows ? { rows: rows.rows, spacingM: +rows.spacingM.toFixed(2), seedSpacingM: +rows.seedSpacingM.toFixed(2), directionDeg: +rows.directionDeg.toFixed(1), blocks: rows.blocks, readMs: rowsMs } : { found: false, readMs: rowsMs },
    stage1: { ms: Math.round(st.ms), wallMsInclCacheLoad: stage1WallMs, readZoom: g.z, mpp: +g.mpp.toFixed(4), cellPx: g.cellPx, ...st.summary },
    windows: { tilePx: s.tilePx, sizePx: s.windows[0]?.size, total: s.windows.length, ...routing.counts, inspected: routing.order.length, cachedAtStart: cachedBefore },
    stage2: {
      routed: { calls: routedCalls, wallMs: routedWallMs, serviceMs: Math.round(sum(calls.slice(0, routedCalls).map(c => c.serviceMs))) },
      referenceRemainder: { calls: calls.length - routedCalls, wallMs: referenceWallMs, serviceMs: Math.round(sum(calls.slice(routedCalls).map(c => c.serviceMs))) },
      perCall: calls.length ? { medianServiceMs: calls.map(c => c.serviceMs ?? 0).sort((a, b) => a - b)[Math.floor(calls.length / 2)], peakGpuMb: Math.max(...calls.map(c => c.peakGpuMb ?? 0)), peakServiceWorkingSetMb: Math.max(...calls.map(c => c.peakWsMb ?? 0)), meanUploadKb: Math.round(sum(calls.map(c => c.upBytes)) / calls.length / 1024) } : null,
    },
    report,
    reference: { weeds: weeds.length, crops: plants.length - weeds.length, byRowStatus: byStatus, whereTheWeedsAre: where, treeSizedOffRow: treeSized.length, treeSizedExamples: treeSized.slice(0, 5), crossWindowOverlaps, touchingCanvasEdge, crossWindowPairs: pairs, placement: { placed, withinTwoPxOfGreen: onGreen, offsetScan: { atZero: at0, best } } },
    patchesCarriedByTreeSized,
    freePlacement: { cellsThatRoute: routeCells.size, cellsPerWindowSide: span, windowsNeeded: freeWindows, gridWindowsRouted: routing.counts.hotspot + routing.counts.uncertain },
    labels,
    nodeRssMb: Math.round(process.memoryUsage().rss / 1048576),
  };
  writeFileSync(join(d, "trial.json"), JSON.stringify(out, null, 1));
  writeOverlay(join(d, "overlay.png"), r23, st, s, rows, weeds, meta);
  return out;
}

// ---------------------------------------------------------------- the picture

function writeOverlay(file: string, r: Raster, st: NonNullable<ReturnType<typeof getTwoStage>["stage1"]>, s: ReturnType<typeof getTwoStage>, rows: FieldRows | null, weeds: GroundPlant[], meta: Meta) {
  const K = 3; // z23 pixels per picture pixel
  const W = Math.floor(r.w / K), H = Math.floor(r.h / K);
  const img = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, si = ((y * K) * r.w + x * K) * 4; img[o] = r.rgba[si] * 0.7; img[o + 1] = r.rgba[si + 1] * 0.7; img[o + 2] = r.rgba[si + 2] * 0.7; img[o + 3] = 255; }
  const P = (X23: number, Y23: number): [number, number] => [(X23 - r.X0) / K, (Y23 - r.Y0) / K];
  const set = (x: number, y: number, c: [number, number, number], a = 1) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; img[o] = img[o] * (1 - a) + c[0] * a; img[o + 1] = img[o + 1] * (1 - a) + c[1] * a; img[o + 2] = img[o + 2] * (1 - a) + c[2] * a; };
  const line = (a: [number, number], b: [number, number], c: [number, number, number], dash = 0) => { const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))); for (let k = 0; k <= n; k++) { if (dash && Math.floor(k / dash) % 2) continue; set(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, c); } };
  const ll23 = (q: LatLng2) => P(...(mercatorPx(q.lat, q.lng, 23) as [number, number]));
  const f = 2 ** (23 - st.grid.z);
  // Uncertain cells that route (grey) and candidate cells (orange / red), tinted.
  const cand = new Map<string, boolean>();
  for (const h of st.hotspots) for (const k of h.cells) cand.set(k, h.highPriority);
  for (const c of st.cells) {
    const hp = cand.get(c.key);
    const routes = c.uncertain.some(x => ROUTING_REASONS.has(x));
    if (hp === undefined && !routes) continue;
    const col: [number, number, number] = hp === true ? [255, 40, 40] : hp === false ? [255, 150, 0] : [160, 160, 160];
    const [x0, y0] = P((st.grid.left + c.i * st.grid.cellPx) * f, (st.grid.top + c.j * st.grid.cellPx) * f);
    const [x1, y1] = P((st.grid.left + (c.i + 1) * st.grid.cellPx) * f, (st.grid.top + (c.j + 1) * st.grid.cellPx) * f);
    for (let y = Math.ceil(y0); y < y1; y++) for (let x = Math.ceil(x0); x < x1; x++) set(x, y, col, 0.28);
  }
  // Row lines (green).
  if (rows) {
    const fr = 2 ** (23 - rows.z);
    for (const l of rows.ctx.lines) line(P((rows.left + l.x1) * fr, (rows.top + l.y1) * fr), P((rows.left + l.x2) * fr, (rows.top + l.y2) * fr), [0, 255, 120]);
    for (const c of rows.ctx.crops) { const [cx, cy] = P((rows.left + c.x) * fr, (rows.top + c.y) * fr); const rr = (c.r * fr) / K; for (let k = 0; k < 48; k++) set(cx + rr * Math.cos((k / 48) * 6.283), cy + rr * Math.sin((k / 48) * 6.283), [0, 255, 120]); }
  }
  // Windows: inspected white, audit cyan dashed.
  for (const wdw of s.windows) {
    const reason = s.routing!.reasons[wdw.name];
    if (reason === "skipped") continue;
    const col: [number, number, number] = reason === "audit" ? [0, 220, 255] : [255, 255, 255];
    const a = P(wdw.x0, wdw.y0), b = P(wdw.x0 + wdw.size, wdw.y0), c = P(wdw.x0 + wdw.size, wdw.y0 + wdw.size), d = P(wdw.x0, wdw.y0 + wdw.size);
    const dash = reason === "audit" ? 4 : 0;
    line(a, b, col, dash); line(b, c, col, dash); line(c, d, col, dash); line(d, a, col, dash);
  }
  // Reference weeds: yellow off the rows, magenta set aside on the rows.
  for (const p of weeds) {
    if (!p.centre) continue;
    const [x, y] = ll23(p.centre);
    const col: [number, number, number] = isOnRow(p.rowStatus) ? [255, 0, 255] : [255, 230, 0];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) set(x + dx, y + dy, col);
  }
  // Hand-labelled weeds: blue crosses.
  for (const l of meta.labels?.filter(x => x.cls === "weed") ?? []) { const [x, y] = P(l.X, l.Y); for (let k = -3; k <= 3; k++) { set(x + k, y, [60, 140, 255]); set(x, y + k, [60, 140, 255]); } }
  writeFileSync(file, encodePng({ width: W, height: H, data: img }));
}

async function main() {
  const h = await (await fetch(`${SERVICE}/weed-vision/health`)).json() as { models?: { rfdetr?: { loaded: boolean; checkpoint_sha256: string | null; device?: string } } };
  if (!h.models?.rfdetr?.loaded) throw new Error("RF-DETR is not loaded in the service");
  const sha = h.models.rfdetr.checkpoint_sha256;
  const all = [];
  for (const f of FRAMES) {
    const t0 = performance.now();
    const r = await trialFrame(f, sha);
    console.log(JSON.stringify({ frame: f, totalWallMs: ms(t0), rows: r.rows, stage1: { ms: r.stage1.ms, candidates: r.stage1.candidates, uncertainShare: r.stage1.uncertainShare }, windows: r.windows, stage2: r.stage2 }));
    all.push(r);
  }
  writeFileSync(join(DIR, "trial-summary.json"), JSON.stringify(all, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
