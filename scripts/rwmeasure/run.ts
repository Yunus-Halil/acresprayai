// The ruler-referenced measurement experiment, end to end, over a folder of
// close-range photographs with a measuring tape beside each weed.
//
//   npm run rw:measure -- [--dir measurementrealworldimages/rawimagery] [--out measurementrealworldimages/results] [--only 0097,0102] [--scale 4]
//
// For every JPEG: the tape found and calibrated from its ticks; the target
// plant chosen (or taken from the person's review file); the canopy cut out;
// the span, the width across it, the area and the equivalent diameter in
// centimetres; five diagnostic pictures; a result record. Then
// measurements.csv, report.md and a contact sheet over every image. A photo
// that fails anywhere still gets a record that says why.
//
// The originals are only read. Corrections live in <out>/review/<name>.json,
// written once as a template and never overwritten; when a person fills one
// in (target, ruler points, mask erasures, a tape measurement, accept or
// reject) the next run uses it and the record says so.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { parseArgs } from "../bench/cli";
import { parsePhotoHeader } from "../../src/lib/photoScout/exif";
import { RW_VERSION, type Calibration, type ImageResult, type Pt, type Review } from "../../src/lib/rwMeasure/types";
import { alongTape, calibrateFromTicks, findTape, inchPxAt, straighten, type Rgba } from "../../src/lib/rwMeasure/tape";
import { pixelsPerCmFromInchPx } from "../../src/lib/rwMeasure/geometry";
import { prepare, segmentCanopy } from "../../src/lib/rwMeasure/canopy";
import { compare, measureCanopy } from "../../src/lib/rwMeasure/measure";
import { scaleFromRulerPoints } from "../../src/lib/rwMeasure/geometry";

const args = parseArgs(process.argv.slice(2));
const dir = String(args.dir ?? join("measurementrealworldimages", "rawimagery"));
const out = String(args.out ?? join("measurementrealworldimages", "results"));
const only = typeof args.only === "string" ? args.only.split(",") : null;
const SCALE = args.scale ? Number(args.scale) : 4;
const VIEW = 6;
mkdirSync(join(out, "images"), { recursive: true }); mkdirSync(join(out, "review"), { recursive: true });

// ---- drawing on a reduced copy, in native coordinates
type RGB = [number, number, number];
class View {
  png: PNG;
  constructor(img: Rgba, public s: number) {
    this.png = new PNG({ width: Math.floor(img.width / s), height: Math.floor(img.height / s) });
    for (let y = 0; y < this.png.height; y++) for (let x = 0; x < this.png.width; x++) { const o = (y * this.png.width + x) * 4, i = (y * s * img.width + x * s) * 4; this.png.data[o] = img.data[i]; this.png.data[o + 1] = img.data[i + 1]; this.png.data[o + 2] = img.data[i + 2]; this.png.data[o + 3] = 255; }
  }
  put(x: number, y: number, c: RGB, a = 1) { x = Math.round(x / this.s); y = Math.round(y / this.s); if (x < 0 || y < 0 || x >= this.png.width || y >= this.png.height) return; const o = (y * this.png.width + x) * 4; this.png.data[o] = this.png.data[o] * (1 - a) + c[0] * a; this.png.data[o + 1] = this.png.data[o + 1] * (1 - a) + c[1] * a; this.png.data[o + 2] = this.png.data[o + 2] * (1 - a) + c[2] * a; }
  line(a: Pt, b: Pt, c: RGB, t = 2) { const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / this.s)); for (let i = 0; i <= n; i++) { const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n; for (let dx = 0; dx < t; dx++) for (let dy = 0; dy < t; dy++) this.put(x + dx * this.s, y + dy * this.s, c); } }
  ring(cx: number, cy: number, r: number, c: RGB, t = 2) { const n = Math.max(24, Math.round(r / this.s)); for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI, b = ((i + 1) / n) * 2 * Math.PI; this.line({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }, { x: cx + r * Math.cos(b), y: cy + r * Math.sin(b) }, c, t); } }
  tint(mask: Uint8Array, mw: number, mh: number, ms: number, c: RGB, a: number) { for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (mask[y * mw + x]) for (let dy = 0; dy < ms; dy += this.s) for (let dx = 0; dx < ms; dx += this.s) this.put(x * ms + dx, y * ms + dy, c, a); }
  text(x: number, y: number, str: string, c: RGB, k = 3) { let xx = x; for (const ch of str) { const g = FONT[ch] ?? FONT[" "]; for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[r][q] === "1") for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) { const px = (xx + q * k + dx) * this.s, py = (y + r * k + dy) * this.s; this.put(px + this.s, py + this.s, [0, 0, 0]); this.put(px, py, c); } xx += 4 * k; } }
  save(path: string) { writeFileSync(path, PNG.sync.write(this.png)); }
}
const FONT: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"], "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"], "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"], "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"], "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
  ".": ["000", "000", "000", "000", "010"], "c": ["111", "100", "100", "100", "111"], "m": ["000", "000", "111", "111", "101"], " ": ["000", "000", "000", "000", "000"], "x": ["000", "101", "010", "101", "000"],
  "O": ["111", "101", "101", "101", "111"], "K": ["101", "110", "100", "110", "101"], "R": ["110", "101", "110", "101", "101"], "E": ["111", "100", "110", "100", "111"], "V": ["101", "101", "101", "101", "010"], "F": ["111", "100", "110", "100", "100"], "U": ["101", "101", "101", "101", "111"], "S": ["111", "100", "111", "001", "111"], "I": ["111", "010", "010", "010", "111"], "W": ["101", "101", "101", "111", "101"], "_": ["000", "000", "000", "000", "111"], "-": ["000", "000", "111", "000", "000"], "?": ["111", "001", "011", "000", "010"],
};
const WHITE: RGB = [255, 255, 255], RED: RGB = [255, 60, 60], GREEN: RGB = [76, 255, 80], CYAN: RGB = [0, 220, 255], MAGENTA: RGB = [255, 0, 255], YELLOW: RGB = [255, 235, 59], ORANGE: RGB = [255, 160, 40];

const reviewTemplate: Review = { status: "pending", targetOverride: null, rulerPoints: null, joinGapCm: null, maskErase: null, groundTruth: { maxSpanCm: null, perpendicularSpanCm: null, measuredInField: false, notes: null }, notes: null };

(async () => {
  const files = readdirSync(dir).filter(f => /\.jpe?g$/i.test(f) && (!only || only.some(o => f.includes(o)))).sort();
  if (!files.length) { console.error(`no JPEGs in ${dir}`); process.exit(1); }
  const results: ImageResult[] = [];
  const tiles: PNG[] = [];
  for (const f of files) {
    const t0 = Date.now();
    const stem = basename(f).replace(/\.jpe?g$/i, "");
    const bytes = readFileSync(join(dir, f));
    const exif = parsePhotoHeader(new Uint8Array(bytes.subarray(0, 1 << 20)));
    const dec = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 4096 });
    const img: Rgba = { width: dec.width, height: dec.height, data: dec.data };
    const reviewPath = join(out, "review", `${stem}.json`);
    if (!existsSync(reviewPath)) writeFileSync(reviewPath, JSON.stringify(reviewTemplate, null, 2));
    const review = JSON.parse(readFileSync(reviewPath, "utf8")) as Review;
    // 1. The tape and the scale.
    const tape = findTape(img, 8);
    let cal: Calibration;
    if (review.rulerPoints && review.rulerPoints.length >= 2) {
      const s = scaleFromRulerPoints(review.rulerPoints);
      cal = s ? { status: s.relativeUncertainty <= 0.03 ? "ok" : "uncertain", method: "manual-points", units: "inch", pixelsPerCm: s.pixelsPerCm, relativeUncertainty: s.relativeUncertainty, inchPxFromLongTicks: null, inchPxFromFineTicks: null, longTicks: [], localInchPx: [], driftAlongTape: null, bodyWidthPx: null, edge: null, reason: "scale from the person's ruler points" }
        : { status: "failed", method: "manual-points", units: "inch", pixelsPerCm: null, relativeUncertainty: null, inchPxFromLongTicks: null, inchPxFromFineTicks: null, longTicks: [], localInchPx: [], driftAlongTape: null, bodyWidthPx: null, edge: null, reason: "the ruler points need two readings at least two inches apart" };
    } else if (!tape) {
      cal = { status: "failed", method: "none", units: "unknown", pixelsPerCm: null, relativeUncertainty: null, inchPxFromLongTicks: null, inchPxFromFineTicks: null, longTicks: [], localInchPx: [], driftAlongTape: null, bodyWidthPx: null, edge: null, reason: "no yellow tape found in the picture" };
    } else {
      cal = calibrateFromTicks(straighten(img, tape));
    }
    // 2, 3. The plant and its canopy. Without a scale the disc sizes fall back on a nominal pixel size so a mask can still be drawn for review.
    const nominalPpcm = cal.pixelsPerCm ?? (exif.relativeAltitudeM && exif.focalMm && exif.focal35Mm ? (exif.focalMm * img.width) / (exif.relativeAltitudeM * 100 * (36 * exif.focalMm / exif.focal35Mm)) : 40);
    const wk = prepare(img, SCALE, nominalPpcm);
    const seg = segmentCanopy(wk, { override: review.targetOverride ?? null, erase: review.maskErase ?? null, tape, joinGapCm: review.joinGapCm ?? null });
    // The scale at the plant: the local inch nearest the plant's projection on the tape's axis (a tape seen off nadir foreshortens along its length).
    let calAtPlant = cal;
    if (tape && cal.pixelsPerCm && cal.localInchPx.length && seg.target.centre) {
      const t = (seg.target.centre.x - tape.centre.x) * tape.dir.x + (seg.target.centre.y - tape.centre.y) * tape.dir.y;
      const local = inchPxAt(cal, t);
      if (local) calAtPlant = { ...cal, pixelsPerCm: pixelsPerCmFromInchPx(local) };
    }
    const { measurement, outlinePx } = measureCanopy(seg.mask, wk.width, wk.height, SCALE, calAtPlant, seg.quality, exif.gimbalPitchDeg);
    const result: ImageResult = {
      version: RW_VERSION, file: f, widthPx: img.width, heightPx: img.height,
      exif: { model: exif.model, focalMm: exif.focalMm, focal35Mm: exif.focal35Mm, relativeAltitudeM: exif.relativeAltitudeM, gimbalPitchDeg: exif.gimbalPitchDeg },
      tape, calibration: cal, pixelsPerCmAtPlant: calAtPlant.pixelsPerCm, target: seg.target, segmentation: seg.quality, measurement, review, comparison: compare(measurement, review.groundTruth), outlinePx,
    };
    results.push(result);
    writeFileSync(join(out, "images", `${stem}.result.json`), JSON.stringify({ ...result, outlinePx: outlinePx?.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })) ?? null }, null, 2));
    // 4. The pictures.
    const original = new View(img, VIEW); original.save(join(out, "images", `${stem}.1-original.png`));
    const sel = new View(img, VIEW);
    if (tape) { sel.line(alongTape(tape, -tape.halfLength), alongTape(tape, tape.halfLength), YELLOW, 2); for (const t of cal.longTicks) sel.line(alongTape(tape, t, -tape.halfWidth * 1.3), alongTape(tape, t, tape.halfWidth * 1.3), CYAN, 1); }
    for (const a of seg.target.alternatives) sel.ring(a.centre.x, a.centre.y, Math.sqrt(a.areaPx / Math.PI), ORANGE, 2);
    if (seg.target.centre) sel.ring(seg.target.centre.x, seg.target.centre.y, 0.5 * Math.sqrt(seg.quality.maskPixels / Math.PI) + 30, seg.target.status === "review" ? MAGENTA : GREEN, 3);
    sel.tint(seg.core, wk.width, wk.height, SCALE, GREEN, 0.35);
    sel.save(join(out, "images", `${stem}.2-target.png`));
    const maskPng = new PNG({ width: wk.width, height: wk.height }); for (let i = 0; i < wk.width * wk.height; i++) { const v = seg.mask[i] ? 255 : 0; maskPng.data[i * 4] = v; maskPng.data[i * 4 + 1] = v; maskPng.data[i * 4 + 2] = v; maskPng.data[i * 4 + 3] = 255; }
    writeFileSync(join(out, "images", `${stem}.3-mask.png`), PNG.sync.write(maskPng));
    const bnd = new View(img, VIEW);
    if (outlinePx) for (const p of outlinePx) bnd.put(p.x, p.y, RED); bnd.tint(seg.mask, wk.width, wk.height, SCALE, RED, 0.2);
    bnd.save(join(out, "images", `${stem}.4-boundary.png`));
    const fin = new View(img, VIEW);
    if (tape) { fin.line(alongTape(tape, -tape.halfLength), alongTape(tape, tape.halfLength), YELLOW, 1); for (const t of cal.longTicks) fin.line(alongTape(tape, t, -tape.halfWidth * 1.3), alongTape(tape, t, tape.halfWidth * 1.3), CYAN, 1); }
    if (outlinePx) for (const p of outlinePx) fin.put(p.x, p.y, RED);
    if (measurement.spanEndpoints) fin.line(measurement.spanEndpoints[0], measurement.spanEndpoints[1], WHITE, 3);
    if (measurement.perpendicularEndpoints) fin.line(measurement.perpendicularEndpoints[0], measurement.perpendicularEndpoints[1], MAGENTA, 2);
    const label = measurement.status === "measured" ? `${measurement.maxSpanCm} x ${measurement.perpendicularSpanCm ?? "?"} cm` : "REFUSED";
    const stat = measurement.status !== "measured" ? "REFUSED" : review.status === "accepted" ? "OK" : (seg.quality.status === "isolated" && cal.status === "ok" && seg.target.status === "selected") ? "OK?" : "REVIEW";
    fin.text(8, 8, label, WHITE, 4); fin.text(8, 36, stat, stat === "REFUSED" ? RED : stat === "REVIEW" ? ORANGE : GREEN, 4);
    if (cal.pixelsPerCm) fin.text(8, fin.png.height - 20, `${cal.pixelsPerCm.toFixed(1)} px cm`, CYAN, 3);
    fin.save(join(out, "images", `${stem}.5-measurement.png`));
    // A tile for the contact sheet: the measurement view at a further half, with the number.
    const tile = new PNG({ width: Math.floor(fin.png.width / 2), height: Math.floor(fin.png.height / 2) });
    for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) { const o = (y * tile.width + x) * 4, i = (y * 2 * fin.png.width + x * 2) * 4; tile.data[o] = fin.png.data[i]; tile.data[o + 1] = fin.png.data[i + 1]; tile.data[o + 2] = fin.png.data[i + 2]; tile.data[o + 3] = 255; }
    tiles.push(tile);
    console.log(`${f}: tape ${tape ? "found" : "none"}; calibration ${cal.status}${cal.pixelsPerCm ? ` ${cal.pixelsPerCm.toFixed(1)} px/cm ±${((cal.relativeUncertainty ?? 0) * 100).toFixed(1)}%` : ""} (${cal.reason ?? "ticks"}); target ${seg.target.status}; canopy ${seg.quality.status}; ${measurement.status === "measured" ? `${measurement.maxSpanCm} x ${measurement.perpendicularSpanCm} cm, ${measurement.canopyAreaCm2 ?? "area withheld"} cm2` : measurement.reason}; ${Date.now() - t0} ms`);
  }
  // 5. The CSV.
  const cols = ["filename", "image_width_px", "image_height_px", "camera", "gimbal_pitch_deg", "target_status", "ruler_detected", "ruler_units", "calibration_method", "calibration_status", "pixels_per_cm", "scale_uncertainty", "segmentation_status", "maximum_span_cm", "perpendicular_span_cm", "canopy_area_cm2", "equivalent_diameter_cm", "physical_ground_truth_cm", "absolute_error_cm", "signed_error_cm", "review_status", "refusal_reason"];
  const csv = [cols.join(",")];
  for (const r of results) {
    const m = r.measurement, c = r.calibration;
    const row = [r.file, r.widthPx, r.heightPx, r.exif.model ?? "", r.exif.gimbalPitchDeg ?? "", r.target.status, r.tape ? "yes" : "no", c.units, c.method, c.status, c.pixelsPerCm?.toFixed(2) ?? "", c.relativeUncertainty == null ? "" : (c.relativeUncertainty * 100).toFixed(1) + "%", r.segmentation.status, m.maxSpanCm ?? "", m.perpendicularSpanCm ?? "", m.canopyAreaCm2 ?? "", m.equivalentDiameterCm ?? "", r.review.groundTruth?.maxSpanCm ?? "", r.comparison.absoluteErrorCm ?? "", r.comparison.signedErrorCm ?? "", r.review.status, (m.reason ?? r.segmentation.reason ?? c.reason ?? "").replace(/,/g, ";")];
    csv.push(row.map(v => String(v)).join(","));
  }
  writeFileSync(join(out, "measurements.csv"), csv.join("\n"));
  writeFileSync(join(out, "results.json"), JSON.stringify({ at: new Date().toISOString(), version: RW_VERSION, dir, scale: SCALE, results: results.map(r => ({ ...r, outlinePx: null })) }, null, 2));
  // 6. The contact sheet: four tiles a row.
  if (tiles.length) {
    const tw = tiles[0].width, th = tiles[0].height, cols4 = 4, rows = Math.ceil(tiles.length / cols4);
    const sheet = new PNG({ width: tw * cols4, height: (th + 14) * rows });
    sheet.data.fill(20);
    tiles.forEach((t, k) => {
      const ox = (k % cols4) * tw, oy = Math.floor(k / cols4) * (th + 14) + 14;
      for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) { const o = ((oy + y) * sheet.width + ox + x) * 4, i = (y * t.width + x) * 4; sheet.data[o] = t.data[i]; sheet.data[o + 1] = t.data[i + 1]; sheet.data[o + 2] = t.data[i + 2]; sheet.data[o + 3] = 255; }
      const v = { png: sheet, s: 1, put: View.prototype.put, text: View.prototype.text } as unknown as View;
      v.text(ox + 4, oy - 12, results[k].file.replace(/^DJI_\d+_/, "").replace(/_D\.JPG$/i, ""), WHITE, 2);
    });
    writeFileSync(join(out, "contact-sheet.png"), PNG.sync.write(sheet));
  }
  console.log(`wrote ${results.length} result(s) to ${out}`);
})();
