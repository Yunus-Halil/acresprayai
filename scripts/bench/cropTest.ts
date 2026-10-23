// Every algorithm we have, run headless on a folder of crop photos, with pictures to look at (2026-10-23).
//
//   npx vite-node scripts/bench/cropTest.ts -- --dir "CropTesting/Corn/earlystage" [--row-spacing-m 0.762] [--crop corn]
//
// Per image, into <dir>/outputs/<image name>/:
//   1. scale        the photo's pixel size. Photos with no EXIF (Roboflow exports, screenshots) get it from the measured row
//                   pitch and the stated row spacing (US corn: 30 in, 0.762 m). Every centimetre figure follows from this.
//   2. pattern      the photo pattern pass (photoScout/pattern.ts, what Photo Scout and the photo pass run): rows, plants on
//                   the pattern, doubles, plants between plants, off-row blobs (weed candidates). Run at the photo's own
//                   resolution (as the app reads a photo, long edge at most 4096 px) and again at 2 cm and 4 cm a pixel
//                   (what a field map gives). pattern-<res>.png: cyan rows, green on pattern, yellow double, orange between
//                   plants, red off-row.
//   3. field rows   the field map's row reader (weedVision/fieldRows.ts), the orchard-style reader, at its own read pixel
//                   (about 4 cm). field-rows.png when it finds rows.
//   4. grade        Stage 1 and the weed pressure grade (twoStage/stage1.ts, pressure/grade.ts) on the photo placed as a
//                   stand-in map (north-up at 40 N), with the pattern pass's rows. The app refuses corn on rows it read
//                   itself (the row-crop guard); this runs the grade anyway, as a diagnostic, and says so. grade.png:
//                   cells green / yellow / red by band, rows cut out.
//   5. models       RF-DETR Seg-Large and ERFNet through the local weed-vision service (npm run weed-vision:service), when
//                   it answers: model-<name>.png with weeds outlined red and crop plants green. Both were trained on
//                   PhenoBench (sugar beet); nothing here has been trained on corn.
// Nothing is uploaded beyond the local service; the photos are only read.
import "./nodeStorageShim";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage, encodePng } from "./images";
import type { LatLng2 } from "../../src/lib/geo";
import { type PhotoPattern, type PhotoPixels, analysePhoto } from "../../src/lib/photoScout/pattern";
import { overlayFromPattern } from "../../src/lib/sourceFrames/patternLook";
import { type FieldRows, fieldRowsFromPixels, vegetationMask } from "../../src/lib/weedVision/fieldRows";
import { latLngOfPx, mercatorPx, metresPerPixel } from "../../src/lib/weedVision/mapRun";
import { drawnBandOf, gradePressure } from "../../src/lib/weedVision/pressure/grade";
import { PRESSURE_CELL_M, canopyClosedOf, pressureRefusal } from "../../src/lib/weedVision/pressure/pressureStore";
import { rowContextFromPattern } from "../../src/lib/weedVision/rowFilter";
import { DEFAULT_STAGE1, readStage1 } from "../../src/lib/weedVision/twoStage/stage1";
import { drawFrom } from "../eval/pressure/fixture";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = arg("dir", "CropTesting/Corn/earlystage")!;
const ROW_M = Number(arg("row-spacing-m", "0.762"));
const CROP = arg("crop", "corn")!;
const OUT = join(DIR, "outputs");
const SERVICE = arg("service", "http://127.0.0.1:8765")!;
const MODELS = ["rfdetr_seg_large", "erfnet_erode1"];

type Instance = { class: string; score: number; area_px: number; polygons_px: number[][][]; centroid_px: [number, number] };
async function serviceUp(): Promise<boolean> {
  try { const r = await fetch(`${SERVICE}/weed-vision/health`, { signal: AbortSignal.timeout(3000) }); return r.ok; } catch { return false; }
}
async function detect(file: string, algorithm: string): Promise<{ weeds: Instance[]; crops: Instance[]; ms: number } | { error: string }> {
  const fd = new FormData();
  fd.append("image", new Blob([readFileSync(file)]), basename(file));
  for (const [k, v] of Object.entries({ algorithm, threshold: "0.5", tile: "1024", overlap: "128", scale: "1", include_crop: "1", geometry: "full" })) fd.append(k, v);
  const t0 = Date.now();
  const r = await fetch(`${SERVICE}/weed-vision/detect`, { method: "POST", body: fd });
  if (!r.ok) return { error: (await r.text()).slice(0, 300) };
  const j = await r.json() as { instances: Instance[]; crop_instances?: Instance[] | null };
  return { weeds: j.instances ?? [], crops: j.crop_instances ?? [], ms: Date.now() - t0 };
}

type Img = { width: number; height: number; rgba: Uint8ClampedArray };

/** Box-average down by a real factor (each output pixel the mean of the input pixels it covers). */
function resample(src: Img, f: number): Img {
  if (f <= 1) return src;
  const w = Math.max(1, Math.floor(src.width / f)), h = Math.max(1, Math.floor(src.height / f));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y * f), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * f));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * f), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * f));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = sy0; yy < sy1 && yy < src.height; yy++) for (let xx = sx0; xx < sx1 && xx < src.width; xx++) {
        const o = (yy * src.width + xx) * 4; r += src.rgba[o]; g += src.rgba[o + 1]; b += src.rgba[o + 2]; n++;
      }
      const o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { width: w, height: h, rgba: out };
}

/**
 * The row pitch in pixels and the row direction: the angle whose projection of the vegetation mask has the most
 * variance, then the first strong autocorrelation peak of that profile. Read on a copy about 1000 px across.
 */
function rowPitch(img: Img): { pitchPx: number; angleDeg: number } | null {
  const f = Math.max(1, Math.max(img.width, img.height) / 1000);
  const s = resample(img, f);
  const mask = vegetationMask(s);
  const pts: [number, number][] = [];
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) if (mask[y * s.width + x]) pts.push([x, y]);
  if (pts.length < 100) return null;
  const profileAt = (deg: number) => {
    const t = (deg * Math.PI) / 180, nx = Math.cos(t), ny = Math.sin(t);
    const diag = Math.ceil(Math.hypot(s.width, s.height));
    const bins = new Float64Array(2 * diag + 1);
    for (const [x, y] of pts) bins[Math.round(x * nx + y * ny) + diag]++;
    return bins;
  };
  const variance = (b: Float64Array) => { let m = 0; for (const v of b) m += v; m /= b.length; let q = 0; for (const v of b) q += (v - m) ** 2; return q / b.length; };
  let best = 0, bestV = -1;
  for (let d = 0; d < 180; d += 1) { const v = variance(profileAt(d)); if (v > bestV) { bestV = v; best = d; } }
  for (let d = best - 1; d <= best + 1; d += 0.1) { const v = variance(profileAt(d)); if (v > bestV) { bestV = v; best = d; } }
  const prof = profileAt(best);
  const used = prof.filter((_, i) => i > 0);
  const mean = used.reduce((a, v) => a + v, 0) / used.length;
  const ac = (lag: number) => { let a = 0; for (let i = 0; i + lag < prof.length; i++) a += (prof[i] - mean) * (prof[i + lag] - mean); return a; };
  const a0 = ac(0);
  let pitch = 0;
  for (let lag = 8; lag < Math.min(s.width, s.height) / 2; lag++) {
    const c = ac(lag), l = ac(lag - 1), r = ac(lag + 1);
    if (c > l && c >= r && c > 0.2 * a0) { pitch = lag; break; }
  }
  if (!pitch) return null;
  // The angle is of the profile's normal; rows run perpendicular to it.
  return { pitchPx: pitch * f, angleDeg: ((best + 90) % 180) };
}

// ------------------------------------------------------------- drawing

type Rgb = [number, number, number];
function canvasOf(img: Img, dim = 0.75): Uint8Array {
  const out = new Uint8Array(img.width * img.height * 4);
  for (let i = 0; i < img.width * img.height; i++) { out[i * 4] = img.rgba[i * 4] * dim; out[i * 4 + 1] = img.rgba[i * 4 + 1] * dim; out[i * 4 + 2] = img.rgba[i * 4 + 2] * dim; out[i * 4 + 3] = 255; }
  return out;
}
function plot(c: Uint8Array, w: number, h: number, x: number, y: number, col: Rgb, a = 1) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const o = (y * w + x) * 4;
  c[o] = c[o] * (1 - a) + col[0] * a; c[o + 1] = c[o + 1] * (1 - a) + col[1] * a; c[o + 2] = c[o + 2] * (1 - a) + col[2] * a;
}
function line(c: Uint8Array, w: number, h: number, x1: number, y1: number, x2: number, y2: number, col: Rgb, thick = 1) {
  const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  for (let k = 0; k <= n; k++) {
    const x = x1 + ((x2 - x1) * k) / n, y = y1 + ((y2 - y1) * k) / n;
    for (let dy = -thick; dy <= thick; dy++) for (let dx = -thick; dx <= thick; dx++) plot(c, w, h, x + dx, y + dy, col);
  }
}
function ring(c: Uint8Array, w: number, h: number, x: number, y: number, r: number, col: Rgb, thick = 1) {
  const n = Math.max(24, Math.ceil(2 * Math.PI * r));
  for (let k = 0; k < n; k++) {
    const t = (k / n) * 2 * Math.PI;
    for (let d = 0; d < thick; d++) plot(c, w, h, x + (r + d) * Math.cos(t), y + (r + d) * Math.sin(t), col);
  }
}
const CLS: Record<string, Rgb> = { "on pattern": [60, 220, 90], double: [255, 220, 0], "between plants": [255, 140, 0], "off-row": [255, 40, 40] };

/** The pattern pass drawn on its own pixels, rows cyan and blobs by class. */
function drawPattern(img: Img, p: PhotoPattern): Uint8Array {
  const c = canvasOf(img);
  const o = overlayFromPattern(p, null);
  const t = Math.max(1, Math.round(img.width / 1200));
  for (const l of o.lines) line(c, img.width, img.height, l.x1, l.y1, l.x2, l.y2, [0, 230, 255], t);
  for (const ci of o.circles) ring(c, img.width, img.height, ci.x, ci.y, ci.r, CLS[ci.cls] ?? [200, 200, 200], t + 1);
  return c;
}

// ------------------------------------------------------------- the run

type PatternRow = { res: string; gsdCm: number; width: number; height: number; ms: number; windows: number; usable: number; blocks: number; angleDeg: number | null; pitchCm: number | null; plantCm: number | null; seedCm: number | null; seedAgreement: number | null; blobs: number; onPattern: number; doubles: number; betweenPlants: number; offRow: number; unplaced: number; notes: string[] };

async function runImage(file: string) {
  const name = basename(file, extname(file));
  const out = join(OUT, name);
  mkdirSync(out, { recursive: true });
  const raw = decodeImage(new Uint8Array(readFileSync(file)));
  const full: Img = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const result: Record<string, unknown> = { image: basename(file), width: full.width, height: full.height };

  // 1. scale
  const pitch = rowPitch(full);
  if (!pitch) { result.error = "no row pitch found: cannot set a pixel size"; writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 1)); return result; }
  const gsdM = ROW_M / pitch.pitchPx;
  result.scale = { rowPitchPx: +pitch.pitchPx.toFixed(1), rowAngleDeg: +pitch.angleDeg.toFixed(1), assumedRowSpacingM: ROW_M, gsdCm: +(gsdM * 100).toFixed(3), groundM: [+(full.width * gsdM).toFixed(1), +(full.height * gsdM).toFixed(1)], source: "no EXIF: pixel size from the measured row pitch and the assumed row spacing" };

  // 2. pattern pass at three resolutions
  const patterns: PatternRow[] = [];
  let photoPattern: { img: Img; p: PhotoPattern } | null = null;
  const plans: [string, number][] = [["photo", Math.max(1, Math.max(full.width, full.height) / 4096)], ["2cm", 0.02 / gsdM], ["4cm", 0.04 / gsdM]];
  for (const [res, f] of plans) {
    if (f < 1 && res !== "photo") continue; // coarser than the photo only
    const img = resample(full, Math.max(1, f));
    const g = gsdM * Math.max(1, f);
    const t0 = Date.now();
    const p = await analysePhoto(img as PhotoPixels, { gsdM: g, rowSpacingM: "auto", windowM: 4 }, { yieldBetweenWindows: false });
    const s = p.summary;
    patterns.push({
      res, gsdCm: +(g * 100).toFixed(2), width: img.width, height: img.height, ms: Date.now() - t0, windows: s.windows, usable: s.usableWindows, blocks: s.blocks,
      angleDeg: s.medianAngleDeg, pitchCm: s.medianPitchM == null ? null : +(s.medianPitchM * 100).toFixed(1), plantCm: s.plantDiameterM == null ? null : +(s.plantDiameterM * 100).toFixed(1),
      seedCm: s.seedSpacingM == null ? null : +(s.seedSpacingM * 100).toFixed(1), seedAgreement: s.seedAgreement, blobs: s.blobs, onPattern: s.onPattern, doubles: s.doubles,
      betweenPlants: s.betweenPlants, offRow: s.offRow, unplaced: s.unplaced, notes: p.notes,
    });
    writeFileSync(join(out, `pattern-${res}.png`), encodePng({ width: img.width, height: img.height, data: drawPattern(img, p) }));
    if (res === "photo") photoPattern = { img, p };
  }
  result.pattern = patterns;

  // 3. the field map's row reader at its own read pixel (about 4 cm)
  {
    const f = Math.max(1, 0.04 / gsdM);
    const img = resample(full, f), mpp = gsdM * f;
    const fr = fieldRowsFromPixels(img as PhotoPixels, mpp);
    result.fieldRows = fr ? { found: true, rows: fr.rows, spacingM: +fr.spacingM.toFixed(3), seedSpacingM: +fr.seedSpacingM.toFixed(3), directionDeg: +fr.directionDeg.toFixed(1), blocks: fr.blocks, gsdCm: +(mpp * 100).toFixed(2) }
      : { found: false, gsdCm: +(mpp * 100).toFixed(2), why: "the orchard reader needs separate plants at least 1 m apart on evenly spaced rows; continuous corn rows give it none" };
    if (fr) {
      const c = canvasOf(img), t = 1;
      for (const l of fr.ctx.lines) line(c, img.width, img.height, l.x1, l.y1, l.x2, l.y2, [0, 230, 255], t);
      for (const cr of fr.ctx.crops) ring(c, img.width, img.height, cr.x, cr.y, cr.r, [60, 220, 90], 1);
      writeFileSync(join(out, "field-rows.png"), encodePng({ width: img.width, height: img.height, data: c }));
    }
  }

  // 4. Stage 1 and the grade on a stand-in map, with the pattern pass's rows
  if (photoPattern) {
    const lat = 40, z = 23, mpp23 = metresPerPixel(lat, z);
    const f = mpp23 / gsdM;
    const img = resample(full, Math.max(1, f));
    const [X0, Y0] = mercatorPx(lat, -75, z).map(Math.floor);
    const raster = { z, left: X0, top: Y0, width: img.width, height: img.height, rgba: img.rgba };
    const ring4: LatLng2[] = [latLngOfPx(X0 + 1, Y0 + 1, z), latLngOfPx(X0 + img.width - 1, Y0 + 1, z), latLngOfPx(X0 + img.width - 1, Y0 + img.height - 1, z), latLngOfPx(X0 + 1, Y0 + img.height - 1, z)];
    const ctx = rowContextFromPattern(photoPattern.p, photoPattern.p.gsdM / mpp23);
    const rows: FieldRows | null = ctx ? { z, left: X0, top: Y0, mpp: mpp23, ctx, rows: photoPattern.p.summary.blocks, spacingM: photoPattern.p.summary.medianPitchM ?? ROW_M, seedSpacingM: photoPattern.p.summary.seedSpacingM ?? 0, directionDeg: photoPattern.p.summary.medianAngleDeg ?? 0, blocks: photoPattern.p.summary.blocks, source: "reader" } : null;
    const refusal = pressureRefusal(CROP, rows);
    const stage1 = await readStage1({ rings: [ring4], tile: () => "", maxNative: z, lat, rows, params: { ...DEFAULT_STAGE1, cellM: PRESSURE_CELL_M }, draw: drawFrom(raster) as never });
    if (stage1) {
      const grade = gradePressure({ objects: [], grid: stage1.grid, cells: stage1.cells, rows, crop: CROP, canopyClosed: canopyClosedOf(stage1.cells), photoBased: false });
      const s = grade.summary;
      result.grade = {
        appRefuses: refusal, note: "diagnostic: the grade run on the pattern pass's rows; the app itself refuses corn on rows it read (row-crop guard)",
        readGsdCm: +(stage1.grid.mpp * 100).toFixed(2), cellM: +(stage1.grid.cellPx * stage1.grid.mpp).toFixed(2), cells: s.cells, assessed: s.assessed, notAssessed: s.notAssessed, whyNot: s.whyNot,
        fieldCover: +s.fieldCover.toFixed(4), fieldClass: s.fieldClass, byClass: s.byClass, actionCells: s.byClass.action + s.byClass.high, patches: s.patches, canopyClosed: grade.canopyClosed,
        scheme: { action: grade.scheme.action, source: grade.scheme.source },
      };
      // grade.png: the read raster with each assessed cell tinted by band, rows on top.
      const g = stage1.grid, scale = 2 ** (z - g.z);
      const rd = resample(img, scale);
      const c = canvasOf(rd, 0.85);
      const col: Record<string, Rgb> = { low: [74, 222, 128], medium: [250, 204, 21], high: [239, 68, 68] };
      for (const cell of grade.cells) {
        if (!cell.assessed || cell.klass === "none") continue;
        const b = drawnBandOf(cell);
        if (b === "none") continue;
        const x0 = cell.i * g.cellPx + (g.left - X0 / scale), y0 = cell.j * g.cellPx + (g.top - Y0 / scale);
        for (let y = Math.max(0, Math.floor(y0)); y < Math.min(rd.height, y0 + g.cellPx); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(rd.width, x0 + g.cellPx); x++) plot(c, rd.width, rd.height, x, y, col[b], 0.35);
      }
      if (rows) for (const l of rows.ctx.lines) line(c, rd.width, rd.height, l.x1 / scale, l.y1 / scale, l.x2 / scale, l.y2 / scale, [0, 230, 255], 0);
      writeFileSync(join(out, "grade.png"), encodePng({ width: rd.width, height: rd.height, data: c }));
    } else result.grade = { error: "Stage 1 read nothing" };
  }
  // 5. the models, drawn on the photo at up to 4096 px
  if (await serviceUp()) {
    const models: Record<string, unknown> = {};
    const f = Math.max(1, Math.max(full.width, full.height) / 4096);
    const img = resample(full, f);
    for (const m of MODELS) {
      const d = await detect(file, m);
      if ("error" in d) { models[m] = d; continue; }
      const c = canvasOf(img), t = Math.max(1, Math.round(img.width / 1500));
      const draw = (list: Instance[], col: Rgb) => { for (const ins of list) for (const poly of ins.polygons_px ?? []) for (let k = 0; k < poly.length; k++) { const [ax, ay] = poly[k], [bx, by] = poly[(k + 1) % poly.length]; line(c, img.width, img.height, ax / f, ay / f, bx / f, by / f, col, t); } };
      draw(d.crops, [60, 220, 90]); draw(d.weeds, [255, 40, 40]);
      writeFileSync(join(out, `model-${m}.png`), encodePng({ width: img.width, height: img.height, data: c }));
      const areaM2 = (l: Instance[]) => +(l.reduce((a, i) => a + i.area_px, 0) * gsdM * gsdM).toFixed(3);
      models[m] = { weeds: d.weeds.length, crops: d.crops.length, weedAreaM2: areaM2(d.weeds), cropAreaM2: areaM2(d.crops), medianWeedScore: d.weeds.length ? +[...d.weeds].sort((a, b) => a.score - b.score)[d.weeds.length >> 1].score.toFixed(2) : null, ms: d.ms };
    }
    result.models = models;
  } else result.models = { skipped: `no weed-vision service at ${SERVICE}` };
  writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 1));
  return result;
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const files = readdirSync(DIR).filter(f => /\.(jpe?g|png)$/i.test(f)).sort();
  const all: Record<string, unknown>[] = [];
  for (const f of files) {
    const t0 = Date.now();
    const r = await runImage(join(DIR, f));
    console.log(JSON.stringify({ image: f, ms: Date.now() - t0, scale: r.scale, fieldRows: r.fieldRows, gradeCover: (r.grade as { fieldCover?: number } | undefined)?.fieldCover }));
    all.push(r);
  }
  writeFileSync(join(OUT, "all-results.json"), JSON.stringify({ at: new Date().toISOString(), rowSpacingAssumedM: ROW_M, crop: CROP, results: all }, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
