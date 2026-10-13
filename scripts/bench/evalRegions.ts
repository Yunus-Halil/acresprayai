// The open-row evaluation benchmark: representative regions of real photos,
// what the pipeline did in each, and the pieces a person needs to label them.
//
//   npm run eval:regions -- [--manifest scripts/bench/evalRegions.json] [--dir samplerowtestingimagery] [--out data/bench/eval]
//
// For every region in the manifest (photo, native pixel box, the conditions it
// shows) the photo is read as the app reads it (4,096 px long edge, the pass,
// then the sizer at native on every candidate), and the region gets:
//
//   <id>.png                 the region at native resolution, nothing drawn: what a person labels
//   <id>.diag.png            the same with every component in the colour of its disposition
//   <id>.predictions.json    every component in the region: pixel, size, disposition, reason,
//                            measured size, outline; the photo, the box, the pixel size
//   predictions.json         all regions together, for evalDetections.ts
//
// The pipeline's own output is never a label. Labels come from a person,
// through scripts/annotate/annotate.html, and evalDetections.ts compares.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { parseArgs } from "./cli";
import { estimateGsd, parsePhotoHeader } from "../../src/lib/photoScout/exif";
import { analysePhoto, type PhotoPixels } from "../../src/lib/photoScout/pattern";
import { segmentWeed, vegetationThreshold } from "../../src/lib/weedScout/sizing/segment";
import { CONTEXT_M, FIRST_WINDOW_MAX_M, MAX_WINDOW_M, MIN_WINDOW_M, WINDOW_DIAMETERS, squareWindow } from "../../src/lib/weedScout/sizing/measure";
import { DEFAULT_SIZE_THRESHOLDS, type WeedMeasurement } from "../../src/lib/weedScout/sizing/types";
import { DISPOSITION_COLOUR, traceVegetation } from "../../src/lib/weedScout/structure/trace";
import type { RegionPrediction } from "../../src/lib/weedScout/sizing/detectionEval";

export type Region = { id: string; photo: string; x: number; y: number; width: number; height: number; conditions: string[]; notes?: string };

const args = parseArgs(process.argv.slice(2));
const manifestPath = String(args.manifest ?? "scripts/bench/evalRegions.json");
const dir = String(args.dir ?? "samplerowtestingimagery");
const outDir = String(args.out ?? join("data", "bench", "eval"));
// --no-png skips the region PNGs: a whole-frame region is 50 MB of PNG nobody labels at that size.
const writePng = args["no-png"] !== true;

type Raw = { width: number; height: number; data: Uint8Array };
const cut = (img: Raw, w: { x: number; y: number; width: number; height: number }): PhotoPixels => {
  const W = Math.min(w.width, img.width - w.x), H = Math.min(w.height, img.height - w.y);
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let r = 0; r < H; r++) rgba.set(img.data.subarray(((w.y + r) * img.width + w.x) * 4, ((w.y + r) * img.width + w.x + W) * 4), r * W * 4);
  return { width: W, height: H, rgba };
};
function downsample(src: Raw, f: number): Raw {
  const w = Math.floor(src.width / f), h = Math.floor(src.height / f), data = new Uint8Array(w * h * 4), n = f * f;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) { const o = ((y * f + dy) * src.width + x * f + dx) * 4; r += src.data[o]; g += src.data[o + 1]; b += src.data[o + 2]; }
    const o = (y * w + x) * 4; data[o] = r / n; data[o + 1] = g / n; data[o + 2] = b / n; data[o + 3] = 255;
  }
  return { width: w, height: h, data };
}
function measureAt(img: Raw, centre: { x: number; y: number }, gsdM: number, expectedM: number, crops: { x: number; y: number; r: number }[]): WeedMeasurement {
  let sideM = Math.min(FIRST_WINDOW_MAX_M, Math.max(MIN_WINDOW_M, WINDOW_DIAMETERS * expectedM));
  const context = vegetationThreshold(cut(img, squareWindow(centre, CONTEXT_M / gsdM, img.width, img.height)));
  for (let attempt = 0; ; attempt++) {
    const win = squareWindow(centre, sideM / gsdM, img.width, img.height);
    const o = segmentWeed({ px: cut(img, win), centre: { x: centre.x - win.x, y: centre.y - win.y }, gsdM, thresholds: DEFAULT_SIZE_THRESHOLDS, context, expectedDiameterM: expectedM,
      cropCircles: crops.map(c => ({ x: c.x - win.x, y: c.y - win.y, r: c.r })),
      photoEdge: { left: win.x === 0, top: win.y === 0, right: win.x + win.width >= img.width, bottom: win.y + win.height >= img.height }, viewAngleDeg: 0 });
    if (o.wider && attempt === 0 && sideM < MAX_WINDOW_M) { sideM = Math.min(MAX_WINDOW_M, sideM * 2); continue; }
    const m = o.measurement;
    return { ...m, sourceFrame: null, source: null, outline: null, outlinePx: m.outlinePx?.map(p => ({ x: p.x + win.x, y: p.y + win.y })) ?? null, centrePx: m.centrePx ? { x: m.centrePx.x + win.x, y: m.centrePx.y + win.y } : null };
  }
}
const put = (png: PNG, x: number, y: number, c: [number, number, number]) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= png.width || y >= png.height) return; const o = (y * png.width + x) * 4; png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2]; };
const line = (png: PNG, x1: number, y1: number, x2: number, y2: number, c: [number, number, number], t = 2) => { const n = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)))); for (let i = 0; i <= n; i++) { const x = x1 + ((x2 - x1) * i) / n, y = y1 + ((y2 - y1) * i) / n; for (let dx = 0; dx < t; dx++) for (let dy = 0; dy < t; dy++) put(png, x + dx, y + dy, c); } };
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

(async () => {
  if (!existsSync(manifestPath)) { console.error(`no manifest at ${manifestPath}`); process.exit(1); }
  const regions = JSON.parse(readFileSync(manifestPath, "utf-8")) as Region[];
  mkdirSync(outDir, { recursive: true });
  const byPhoto = new Map<string, Region[]>();
  for (const r of regions) byPhoto.set(r.photo, [...(byPhoto.get(r.photo) ?? []), r]);
  const all: { region: Region; gsdCmPx: number; predictions: RegionPrediction[] }[] = [];
  for (const [photo, list] of byPhoto) {
    const path = existsSync(photo) ? photo : join(dir, photo);
    if (!existsSync(path)) { console.error(`${photo}: not found under ${dir}`); continue; }
    const bytes = readFileSync(path);
    const exif = parsePhotoHeader(new Uint8Array(bytes.subarray(0, 1 << 20)));
    const dec = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 });
    const raw: Raw = { width: dec.width, height: dec.height, data: dec.data };
    const gsdM = estimateGsd(exif, { imageWidth: raw.width }).gsdM;
    if (!gsdM) { console.error(`${photo}: no pixel size in EXIF`); continue; }
    const f = Math.max(1, Math.ceil(Math.max(raw.width, raw.height) / 4096));
    const app = downsample(raw, f);
    console.log(`${photo}: ${(gsdM * 100).toFixed(2)} cm/px, reading the pattern...`);
    const t0 = Date.now();
    const pattern = await analysePhoto({ width: app.width, height: app.height, rgba: new Uint8ClampedArray(app.data.buffer) }, { gsdM: gsdM * f, rowSpacingM: "auto", windowM: 4 }, { yieldBetweenWindows: false });
    const crops = pattern.blobs.filter(b => b.cls === "on pattern" || b.cls === "double").map(b => ({ x: b.x * f, y: b.y * f, r: (b.equivDiameterM / pattern.gsdM / 2) * f }));
    // Every candidate in any region, measured at native as the app would.
    const inAny = (bx: number, by: number) => list.some(r => bx >= r.x && bx < r.x + r.width && by >= r.y && by < r.y + r.height);
    const measured = new Map<number, WeedMeasurement>();
    for (const b of pattern.blobs) {
      if ((b.cls !== "off-row" && b.cls !== "between plants") || b.touchesBorder || !inAny(b.x * f, b.y * f)) continue;
      measured.set(b.id, measureAt(raw, { x: b.x * f, y: b.y * f }, gsdM, b.equivDiameterM, crops));
    }
    const tMeasure = Date.now();
    console.log(`  runtime: pass ${tMeasure - t0} ms`);
    const trace = traceVegetation(pattern, { displayFloorM: 0.15, measured: new Map([...measured].map(([id, m]) => [id, { status: m.status, reason: m.reason }])) });
    for (const r of list) {
      const preds: RegionPrediction[] = [];
      const png = new PNG({ width: r.width, height: r.height });
      const px = cut(raw, r);
      png.data = Buffer.from(px.rgba.buffer, px.rgba.byteOffset, px.rgba.byteLength);
      if (writePng) writeFileSync(join(outDir, `${r.id}.png`), PNG.sync.write(png));
      const diag = new PNG({ width: r.width, height: r.height });
      diag.data = Buffer.from(png.data);
      for (const c of trace.components) {
        const bx = c.blob.x * f, by = c.blob.y * f;
        if (bx < r.x || bx >= r.x + r.width || by < r.y || by >= r.y + r.height) continue;
        const m = measured.get(c.blob.id) ?? null;
        preds.push({
          id: `${r.id}:b${c.blob.id}`, x: +bx.toFixed(1), y: +by.toFixed(1), equivDiameterM: c.blob.equivDiameterM, disposition: c.disposition, reason: c.reason,
          measuredCm: m?.status === "measured" ? m.canopyDiameterCm : null, distanceToRowM: c.blob.acrossM,
          ...(m?.outlinePx ? { outlinePx: m.outlinePx.map(q => ({ x: +q.x.toFixed(0), y: +q.y.toFixed(0) })) } : {}),
        } as RegionPrediction);
        const col = hex(DISPOSITION_COLOUR[c.disposition]);
        if (m?.outlinePx) { const o = m.outlinePx; for (let i = 0; i < o.length; i++) { const a = o[i], b2 = o[(i + 1) % o.length]; line(diag, a.x - r.x, a.y - r.y, b2.x - r.x, b2.y - r.y, col); } }
        else {
          const w = (c.blob.widthM ?? c.blob.equivDiameterM) / gsdM, h = (c.blob.heightM ?? c.blob.equivDiameterM) / gsdM;
          const x0 = bx - w / 2 - r.x, y0 = by - h / 2 - r.y;
          line(diag, x0, y0, x0 + w, y0, col); line(diag, x0 + w, y0, x0 + w, y0 + h, col); line(diag, x0 + w, y0 + h, x0, y0 + h, col); line(diag, x0, y0 + h, x0, y0, col);
        }
      }
      if (writePng) writeFileSync(join(outDir, `${r.id}.diag.png`), PNG.sync.write(diag));
      const fragments = pattern.fragments ? pattern.fragments.cells.filter(([col, row]) => { const cx = (col + 0.5) * (pattern.fragments!.cellM / pattern.gsdM) * f, cy = (row + 0.5) * (pattern.fragments!.cellM / pattern.gsdM) * f; return cx >= r.x && cx < r.x + r.width && cy >= r.y && cy < r.y + r.height; }).reduce((n, c) => n + c[2], 0) : null;
      const counts: Record<string, number> = {};
      for (const p of preds) counts[p.disposition] = (counts[p.disposition] ?? 0) + 1;
      writeFileSync(join(outDir, `${r.id}.predictions.json`), JSON.stringify({ region: r, photo: basename(photo), gsdCmPx: gsdM * 100, passGsdCmPx: pattern.gsdM * 100, runtimeMs: { pass: tMeasure - t0, total: Date.now() - t0 }, counts, fragments, predictions: preds }, null, 2));
      console.log(`  ${r.id} [${r.conditions.join(", ")}]: ${preds.length} components (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join("; ")}); ${fragments ?? "?"} fragments`);
      all.push({ region: r, gsdCmPx: gsdM * 100, predictions: preds });
    }
  }
  writeFileSync(join(outDir, "predictions.json"), JSON.stringify({ at: new Date().toISOString(), manifest: manifestPath, regions: all }, null, 2));
  console.log(`wrote ${all.length} region(s) to ${outDir}`);
})();
