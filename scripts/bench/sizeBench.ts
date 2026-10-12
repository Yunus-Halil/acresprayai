// The weed-size benchmark: the measurement (src/lib/weedScout/sizing) over
// real photos, so every change to it is measured before it ships, and so the
// numbers it claims are the numbers it was checked against.
//
// Two modes:
//
//   npm run bench:size -- --truth scripts/bench/weedSizes.example.json [--dir samplerowtestingimagery] [--factors 1,2,4]
//
//     Ground truth: a list of plants with a hand-measured canopy diameter (and
//     area when known) and where each sits in which photo. The measurement is
//     run at the photo's native pixel size and, with --factors, on the same
//     photo box-downsampled so the failure rate by resolution is seen. Reports
//     the median absolute diameter and area errors, the share of plants the
//     measurement was willing to give a number for, the failure rate per
//     resolution, and the plants it over- or under-segmented (measured more
//     than 1.5x or less than 0.67x the truth).
//
//   npm run bench:size -- --dir samplerowtestingimagery [--only DJI_03] [--max-photos 3] [--factors 1,2,4] [--examples 12]
//
//     Survey, no truth: the pass reads each photo the way the app does (4,096
//     px long edge), its off-pattern plants are the targets, and each is
//     measured at native resolution and at the coarser factors. Reports
//     eligibility, reasons, failure rate by resolution, and how the native
//     size compares with the coarse one and with the pass's own blob. This
//     mode measures CONSISTENCY, not accuracy: nothing here is a true size.
//     Crops of the first --examples measured plants are written as PNGs with
//     the outline drawn, for eyes.
//
// Pixel size from the photo's EXIF (height above take-off, focal length,
// sensor), as Photo Scout reads it; --gsd-cm overrides. Imagery folders are
// gitignored; the records go to data/bench/size/. Read-only apart from that.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { parseArgs } from "./cli";
import { estimateGsd, parsePhotoHeader } from "../../src/lib/photoScout/exif";
import { analysePhoto, type PhotoPixels } from "../../src/lib/photoScout/pattern";
import { segmentWeed, vegetationThreshold } from "../../src/lib/weedScout/sizing/segment";
import { DEFAULT_SIZE_THRESHOLDS, type WeedMeasurement } from "../../src/lib/weedScout/sizing/types";
import { CONTEXT_M, MIN_WINDOW_M, FIRST_WINDOW_MAX_M, MAX_WINDOW_M, WINDOW_DIAMETERS, squareWindow } from "../../src/lib/weedScout/sizing/measure";

const args = parseArgs(process.argv.slice(2));
const dir = String(args.dir ?? "samplerowtestingimagery");
const truthFile = typeof args.truth === "string" ? args.truth : null;
const only = args.only ? String(args.only) : "";
const maxPhotos = args["max-photos"] ? Number(args["max-photos"]) : 3;
const factors = String(args.factors ?? "1,2,4").split(",").map(Number).filter(f => f >= 1);
const examples = args.examples ? Number(args.examples) : 12;
const gsdOverrideCm = args["gsd-cm"] ? Number(args["gsd-cm"]) : null;

type Raw = { width: number; height: number; data: Uint8Array };

/** Box-average by an integer factor. */
function downsample(src: Raw, f: number): Raw {
  if (f === 1) return src;
  const w = Math.floor(src.width / f), h = Math.floor(src.height / f);
  const data = new Uint8Array(w * h * 4);
  const n = f * f;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
      const o = ((y * f + dy) * src.width + (x * f + dx)) * 4;
      r += src.data[o]; g += src.data[o + 1]; b += src.data[o + 2];
    }
    const o = (y * w + x) * 4;
    data[o] = r / n; data[o + 1] = g / n; data[o + 2] = b / n; data[o + 3] = 255;
  }
  return { width: w, height: h, data };
}

function cutWindow(img: Raw, win: { x: number; y: number; width: number; height: number }): PhotoPixels {
  const w = Math.min(win.width, img.width - win.x), h = Math.min(win.height, img.height - win.y);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) rgba.set(img.data.subarray(((win.y + row) * img.width + win.x) * 4, ((win.y + row) * img.width + win.x + w) * 4), row * w * 4);
  return { width: w, height: h, rgba };
}

/** The app's measurement on a decoded photo: the same window rule as measure.ts, with a flat pixel size (no pose here). */
function measureAt(img: Raw, centre: { x: number; y: number }, gsdM: number, expectedM: number, cropCircles: { x: number; y: number; r: number }[] | null): WeedMeasurement {
  let sideM = Math.min(FIRST_WINDOW_MAX_M, Math.max(MIN_WINDOW_M, WINDOW_DIAMETERS * expectedM));
  const context = vegetationThreshold(cutWindow(img, squareWindow(centre, CONTEXT_M / gsdM, img.width, img.height)));
  for (let attempt = 0; ; attempt++) {
    const win = squareWindow(centre, sideM / gsdM, img.width, img.height);
    const px = cutWindow(img, win);
    const out = segmentWeed({
      px, centre: { x: centre.x - win.x, y: centre.y - win.y }, gsdM, thresholds: DEFAULT_SIZE_THRESHOLDS, context,
      cropCircles: cropCircles ? cropCircles.map(c => ({ x: c.x - win.x, y: c.y - win.y, r: c.r })) : null,
      photoEdge: { left: win.x === 0, top: win.y === 0, right: win.x + win.width >= img.width, bottom: win.y + win.height >= img.height },
      viewAngleDeg: 0,
    });
    if (out.wider && attempt === 0 && sideM < MAX_WINDOW_M) { sideM = Math.min(MAX_WINDOW_M, sideM * 2); continue; }
    const m = out.measurement;
    return {
      ...m, sourceFrame: null, source: { frame: "", nativeWidth: img.width, nativeHeight: img.height, window: win, viewAngleDeg: 0, groundAltM: null },
      outlinePx: m.outlinePx ? m.outlinePx.map(p => ({ x: p.x + win.x, y: p.y + win.y })) : null,
      centrePx: m.centrePx ? { x: m.centrePx.x + win.x, y: m.centrePx.y + win.y } : null,
    };
  }
}

/** A crop of the photo around a measurement with its outline drawn, for eyes. */
function examplePng(img: Raw, m: WeedMeasurement, path: string): void {
  if (!m.source || !m.outlinePx) return;
  const win = m.source.window;
  const png = new PNG({ width: win.width, height: win.height });
  const px = cutWindow(img, win);
  png.data = Buffer.from(px.rgba.buffer, px.rgba.byteOffset, px.rgba.byteLength);
  const pts = m.outlinePx;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))));
    for (let k = 0; k <= n; k++) {
      const x = Math.round(a.x + ((b.x - a.x) * k) / n) - win.x, y = Math.round(a.y + ((b.y - a.y) * k) / n) - win.y;
      if (x < 0 || y < 0 || x >= win.width || y >= win.height) continue;
      const o = (y * win.width + x) * 4;
      png.data[o] = 255; png.data[o + 1] = 255; png.data[o + 2] = 255;
    }
  }
  writeFileSync(path, PNG.sync.write(png));
}

const median = (xs: number[]): number | null => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");
const fmt = (v: number | null | undefined, d = 1) => (v == null ? "-" : v.toFixed(d));

function loadPhoto(path: string): { raw: Raw; gsdM: number | null; basis: string } {
  const bytes = readFileSync(path);
  const exif = parsePhotoHeader(new Uint8Array(bytes.subarray(0, 1 << 20)));
  const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 });
  const raw: Raw = { width: img.width, height: img.height, data: img.data };
  if (gsdOverrideCm) return { raw, gsdM: gsdOverrideCm / 100, basis: "--gsd-cm" };
  const est = estimateGsd(exif, { imageWidth: raw.width });
  return { raw, gsdM: est.gsdM, basis: est.basis };
}

type TruthEntry = { photo: string; x: number; y: number; diameterCm: number; areaCm2?: number | null; note?: string };

type Record_ = { photo: string; id: string; factor: number; gsdCm: number; status: string; reason: string | null; diameterCm: number | null; areaCm2: number | null; confidence: number | null; touching: number; touchesCrop: boolean; truthDiameterCm?: number; truthAreaCm2?: number | null; passDiameterCm?: number; nativeDiameterCm?: number | null };

(async () => {
  const outDir = join("data", "bench", "size");
  mkdirSync(outDir, { recursive: true });
  const records: Record_[] = [];
  let written = 0;

  if (truthFile) {
    // ---- Ground truth mode ------------------------------------------------
    if (!existsSync(truthFile)) { console.error(`no truth file at ${truthFile}`); process.exit(1); }
    const truth = JSON.parse(readFileSync(truthFile, "utf-8")) as TruthEntry[];
    const byPhoto = new Map<string, TruthEntry[]>();
    for (const t of truth) byPhoto.set(t.photo, [...(byPhoto.get(t.photo) ?? []), t]);
    console.log(`photo | plant | factor | gsd cm | status | measured cm | true cm | err cm | measured cm2 | true cm2 | confidence`);
    for (const [photo, entries] of byPhoto) {
      const path = existsSync(photo) ? photo : join(dir, photo);
      if (!existsSync(path)) { console.log(`${photo}: not found`); continue; }
      const { raw, gsdM } = loadPhoto(path);
      if (!gsdM) { console.log(`${photo}: no pixel size (set --gsd-cm or a gsdCm in the entry)`); continue; }
      for (const f of factors) {
        const img = downsample(raw, f), g = gsdM * f;
        entries.forEach((t, i) => {
          const m = measureAt(img, { x: t.x / f, y: t.y / f }, g, t.diameterCm / 100, null);
          const id = `${basename(photo)}#${i}`;
          records.push({ photo: basename(photo), id, factor: f, gsdCm: g * 100, status: m.status, reason: m.reason, diameterCm: m.canopyDiameterCm, areaCm2: m.canopyAreaCm2, confidence: m.confidence, touching: m.quality?.touchingNeighbours ?? 0, touchesCrop: m.quality?.touchesCrop ?? false, truthDiameterCm: t.diameterCm, truthAreaCm2: t.areaCm2 ?? null });
          console.log([basename(photo), i, f, (g * 100).toFixed(2), m.status, fmt(m.canopyDiameterCm), t.diameterCm, m.canopyDiameterCm == null ? "-" : (m.canopyDiameterCm - t.diameterCm).toFixed(1), fmt(m.canopyAreaCm2, 0), t.areaCm2 ?? "-", fmt(m.confidence, 2)].join(" | "));
          if (f === 1 && m.status === "measured" && written < examples) { examplePng(raw, m, join(outDir, `truth-${basename(photo, ".JPG")}-${i}.png`)); written++; }
        });
      }
    }
    const native = records.filter(r => r.factor === 1);
    const measured = native.filter(r => r.status === "measured");
    const dErr = measured.map(r => Math.abs(r.diameterCm! - r.truthDiameterCm!));
    const aErr = measured.filter(r => r.truthAreaCm2 != null).map(r => Math.abs(r.areaCm2! - r.truthAreaCm2!));
    const over = measured.filter(r => r.diameterCm! / r.truthDiameterCm! > 1.5), under = measured.filter(r => r.diameterCm! / r.truthDiameterCm! < 0.67);
    const summary = {
      mode: "truth", truthFile, plants: truth.length, factors,
      eligibleShare: native.length ? measured.length / native.length : 0,
      medianAbsDiameterErrorCm: median(dErr), medianAbsAreaErrorCm2: aErr.length ? median(aErr) : null,
      failureByResolution: factors.map(f => { const rs = records.filter(r => r.factor === f); return { factor: f, gsdCm: median(rs.map(r => r.gsdCm)), plants: rs.length, failed: rs.filter(r => r.status !== "measured").length }; }),
      oversegmented: over.map(r => r.id), undersegmented: under.map(r => r.id),
      verdict: truth.length >= 20 ? "accuracy measured on the ground truth above" : `only ${truth.length} plant(s) of ground truth: accuracy is NOT established (20 or more are needed)`,
    };
    console.log("\nsummary: " + JSON.stringify(summary, null, 1));
    const out = join(outDir, `truth-${basename(truthFile).replace(/\.json$/, "")}.json`);
    writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), summary, records }, null, 2));
    console.log("wrote " + out);
    return;
  }

  // ---- Survey mode ----------------------------------------------------------
  const files = readdirSync(dir).filter(f => /\.jpe?g$/i.test(f) && (!only || f.includes(only))).sort().slice(0, maxPhotos);
  if (!files.length) { console.error(`no JPEGs in ${dir}`); process.exit(1); }
  console.log("NO GROUND TRUTH: this survey measures consistency across resolutions, not accuracy.\n");
  console.log("photo | targets | factor | gsd cm | measured | unknown | reasons | median cm | median ratio to native | median ratio to pass blob | touching | reaches crop");
  for (const name of files) {
    const { raw, gsdM, basis } = loadPhoto(join(dir, name));
    if (!gsdM) { console.log(`${name}: no pixel size (${basis}); set --gsd-cm`); continue; }
    // The pass as the app runs it: 4,096 px long edge.
    const appFactor = Math.max(1, Math.ceil(Math.max(raw.width, raw.height) / 4096));
    const appPx = downsample(raw, appFactor);
    const t0 = Date.now();
    const pattern = await analysePhoto({ width: appPx.width, height: appPx.height, rgba: new Uint8ClampedArray(appPx.data.buffer, appPx.data.byteOffset, appPx.data.byteLength) }, { gsdM: gsdM * appFactor, rowSpacingM: "auto", windowM: 4 }, { yieldBetweenWindows: false });
    const targets = pattern.blobs.filter(b => (b.cls === "off-row" || b.cls === "between plants") && !b.touchesBorder);
    const crops = pattern.blobs.filter(b => b.cls === "on pattern" || b.cls === "double").map(b => ({ x: b.x * appFactor, y: b.y * appFactor, r: (b.equivDiameterM / pattern.gsdM / 2) * appFactor }));
    console.log(`${name}: pass read ${pattern.summary.blocks} block(s), ${targets.length} off-pattern plants, ${crops.length} crop plants in ${Date.now() - t0} ms (${basis})`);
    const nativeById = new Map<number, number | null>();
    for (const f of factors) {
      const img = downsample(raw, f), g = gsdM * f;
      const rows: Record_[] = [];
      for (const b of targets) {
        const centre = { x: (b.x * appFactor) / f, y: (b.y * appFactor) / f };
        const m = measureAt(img, centre, g, b.equivDiameterM, crops.map(c => ({ x: c.x / f, y: c.y / f, r: c.r / f })));
        const id = `${name}#${b.id}`;
        if (f === 1) nativeById.set(b.id, m.canopyDiameterCm);
        const rec: Record_ = { photo: name, id, factor: f, gsdCm: g * 100, status: m.status, reason: m.reason, diameterCm: m.canopyDiameterCm, areaCm2: m.canopyAreaCm2, confidence: m.confidence, touching: m.quality?.touchingNeighbours ?? 0, touchesCrop: m.quality?.touchesCrop ?? false, passDiameterCm: b.equivDiameterM * 100, nativeDiameterCm: nativeById.get(b.id) ?? null };
        rows.push(rec); records.push(rec);
        if (f === 1 && m.status === "measured" && written < examples) { examplePng(raw, m, join(outDir, `survey-${basename(name, ".JPG")}-${b.id}.png`)); written++; }
      }
      const ok = rows.filter(r => r.status === "measured");
      const reasons = new Map<string, number>();
      for (const r of rows) if (r.status !== "measured") { const k = (r.reason ?? "?").replace(/[\d.]+ cm away/, "N cm away").replace(/confidence [\d.]+ is under [\d.]+: .*/, "low confidence").slice(0, 60); reasons.set(k, (reasons.get(k) ?? 0) + 1); }
      console.log([name, targets.length, f, (g * 100).toFixed(2), ok.length, rows.length - ok.length, [...reasons].map(([k, v]) => `${v}x ${k}`).join("; ") || "-",
        fmt(median(ok.map(r => r.diameterCm!))), f === 1 ? "1.00" : fmt(median(ok.filter(r => r.nativeDiameterCm).map(r => r.diameterCm! / r.nativeDiameterCm!)), 2),
        fmt(median(ok.map(r => r.diameterCm! / r.passDiameterCm!)), 2), ok.filter(r => r.touching).length, ok.filter(r => r.touchesCrop).length].join(" | "));
    }
  }
  const native = records.filter(r => r.factor === 1);
  const measured = native.filter(r => r.status === "measured");
  const vsPass = measured.map(r => r.diameterCm! / r.passDiameterCm!);
  const summary = {
    mode: "survey", dir, photos: files.length, factors, targets: native.length,
    eligibleShare: native.length ? measured.length / native.length : 0,
    medianDiameterCm: median(measured.map(r => r.diameterCm!)),
    medianRatioToPassBlob: median(vsPass),
    largerThanPassBlob: measured.filter(r => r.diameterCm! / r.passDiameterCm! > 1.5).map(r => r.id).slice(0, 20),
    smallerThanPassBlob: measured.filter(r => r.diameterCm! / r.passDiameterCm! < 0.67).map(r => r.id).slice(0, 20),
    failureByResolution: factors.map(f => { const rs = records.filter(r => r.factor === f); return { factor: f, gsdCm: median(rs.map(r => r.gsdCm)), targets: rs.length, failed: rs.filter(r => r.status !== "measured").length, medianRatioToNative: f === 1 ? 1 : median(rs.filter(r => r.status === "measured" && r.nativeDiameterCm).map(r => r.diameterCm! / r.nativeDiameterCm!)) }; }),
    verdict: "no ground truth: accuracy is NOT established; these are consistency numbers",
  };
  console.log("\nsummary: " + JSON.stringify(summary, null, 1));
  const out = join(outDir, `survey-${basename(dir)}.json`);
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), summary, records }, null, 2));
  console.log(`wrote ${out}; ${written} example crop(s) in ${outDir}`);
})();
