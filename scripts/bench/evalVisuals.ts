// The visual evidence for a labelled image: the human labels, the pipeline's
// components by disposition, the two together with the matches, hits and
// misses, the rows the pass fitted against the crop labels (not a reference,
// and said so), and the refused and uncertain vegetation. Readable sizes:
// the whole frame at a quarter, and native cuts of the places that matter.
//
//   npm run eval:visuals -- --image <photo> --labels <labels.json> --predictions <region.predictions.json> --report <detection-report.json> --region <region id> --out <dir>
//
// Nothing here changes a number: it draws what the scorer decided.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { parseArgs } from "./cli";
import { estimateGsd, parsePhotoHeader } from "../../src/lib/photoScout/exif";
import { analysePhoto } from "../../src/lib/photoScout/pattern";
import { overlayFromPattern } from "../../src/lib/sourceFrames/patternLook";
import { DISPOSITION_COLOUR } from "../../src/lib/weedScout/structure/trace";
import type { RegionPrediction } from "../../src/lib/weedScout/sizing/detectionEval";

const args = parseArgs(process.argv.slice(2));
const imagePath = String(args.image), labelsPath = String(args.labels), predictionsPath = String(args.predictions), reportPath = String(args.report);
const regionId = String(args.region), outDir = String(args.out);
mkdirSync(outDir, { recursive: true });

type RGB = [number, number, number];
type Raw = { width: number; height: number; data: Uint8Array };
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const RED: RGB = [255, 60, 60], GREEN: RGB = [76, 255, 80], GREY: RGB = [200, 200, 200], MAGENTA: RGB = [255, 0, 255], YELLOW: RGB = [255, 235, 59], WHITE: RGB = [255, 255, 255], CYAN: RGB = [0, 220, 255];

/** A canvas cut from the photo at 1/s, with drawing in the PHOTO's native pixels. */
class View {
  png: PNG;
  constructor(private raw: Raw, public x0: number, public y0: number, w: number, h: number, public s: number) {
    this.png = new PNG({ width: Math.floor(w / s), height: Math.floor(h / s) });
    for (let y = 0; y < this.png.height; y++) for (let x = 0; x < this.png.width; x++) {
      const o = (y * this.png.width + x) * 4, i = ((y0 + y * s) * raw.width + x0 + x * s) * 4;
      this.png.data[o] = raw.data[i]; this.png.data[o + 1] = raw.data[i + 1]; this.png.data[o + 2] = raw.data[i + 2]; this.png.data[o + 3] = 255;
    }
  }
  put(x: number, y: number, c: RGB) { x = Math.round((x - this.x0) / this.s); y = Math.round((y - this.y0) / this.s); if (x < 0 || y < 0 || x >= this.png.width || y >= this.png.height) return; const o = (y * this.png.width + x) * 4; this.png.data[o] = c[0]; this.png.data[o + 1] = c[1]; this.png.data[o + 2] = c[2]; }
  line(x1: number, y1: number, x2: number, y2: number, c: RGB, t = 1, dash = 0) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / this.s));
    for (let i = 0; i <= n; i++) { if (dash && Math.floor(i / dash) % 2) continue; const x = x1 + ((x2 - x1) * i) / n, y = y1 + ((y2 - y1) * i) / n; for (let dx = 0; dx < t; dx++) for (let dy = 0; dy < t; dy++) this.put(x + dx * this.s, y + dy * this.s, c); }
  }
  ring(cx: number, cy: number, rPx: number, c: RGB, t = 1) { const r = Math.max(rPx, 3 * this.s); const n = Math.max(16, Math.round(r / this.s)); for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI, b = ((i + 1) / n) * 2 * Math.PI; this.line(cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b), c, t); } }
  outline(pts: { x: number; y: number }[], c: RGB, t = 1) { for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; this.line(a.x, a.y, b.x, b.y, c, t); } }
  cross(cx: number, cy: number, c: RGB) { const d = 5 * this.s; this.line(cx - d, cy - d, cx + d, cy + d, c, 2); this.line(cx - d, cy + d, cx + d, cy - d, c, 2); }
  save(name: string) { writeFileSync(join(outDir, name), PNG.sync.write(this.png)); console.log("wrote", name); }
}

(async () => {
  const bytes = readFileSync(imagePath);
  const dec = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 });
  const raw: Raw = { width: dec.width, height: dec.height, data: dec.data };
  const labels = JSON.parse(readFileSync(labelsPath, "utf-8")).labels as { id: string; x: number; y: number; cls: string }[];
  const predFile = JSON.parse(readFileSync(predictionsPath, "utf-8")) as { gsdCmPx: number; predictions: (RegionPrediction & { outlinePx?: { x: number; y: number }[] | null })[] };
  const report = JSON.parse(readFileSync(reportPath, "utf-8")) as { matches: { region: string; matches: { label: { id: string; x: number; y: number; cls: string }; prediction: string | null; disposition: string | null }[] }[] };
  const matches = report.matches.find(m => m.region === regionId)?.matches ?? [];
  const predById = new Map(predFile.predictions.map(p => [p.id, p]));
  const gsdM = predFile.gsdCmPx / 100;
  const candidate = (d: string | null) => !!d && (d.startsWith("candidate") || d.startsWith("hidden"));
  const W = raw.width, H = raw.height;

  // 1. The human labels.
  { const v = new View(raw, 0, 0, W, H, 4); for (const l of labels) v.ring(l.x, l.y, l.cls === "crop" ? 40 : 24, l.cls === "weed" ? RED : l.cls === "crop" ? GREEN : GREY, 1); v.save("1-labels.png"); }
  // 2. The pipeline's components by disposition.
  { const v = new View(raw, 0, 0, W, H, 4); for (const p of predFile.predictions) v.ring(p.x, p.y, (p.equivDiameterM / gsdM) / 2, hex(DISPOSITION_COLOUR[p.disposition]), 1); v.save("2-predictions.png"); }
  // 3. Labels and predictions together, with a line from each label to its match.
  { const v = new View(raw, 0, 0, W, H, 4);
    for (const p of predFile.predictions) v.ring(p.x, p.y, (p.equivDiameterM / gsdM) / 2, hex(DISPOSITION_COLOUR[p.disposition]), 1);
    for (const m of matches) { const l = m.label; v.ring(l.x, l.y, l.cls === "crop" ? 40 : 24, l.cls === "weed" ? RED : l.cls === "crop" ? GREEN : GREY, 1); const p = m.prediction ? predById.get(m.prediction) : null; if (p) v.line(l.x, l.y, p.x, p.y, WHITE, 1); }
    v.save("3-labels-vs-predictions.png"); }
  // 4. Hits, misses, and the candidates no label covers.
  { const v = new View(raw, 0, 0, W, H, 4);
    const matchedIds = new Set(matches.map(m => m.prediction).filter(Boolean) as string[]);
    for (const p of predFile.predictions) if (candidate(p.disposition) && !matchedIds.has(p.id)) v.ring(p.x, p.y, 20, GREY, 1);
    for (const m of matches) {
      const l = m.label;
      if (l.cls === "weed") { if (candidate(m.disposition)) v.ring(l.x, l.y, 24, GREEN, 2); else if (m.disposition) v.ring(l.x, l.y, 24, YELLOW, 2); else v.cross(l.x, l.y, RED); }
      else if (l.cls === "crop" && candidate(m.disposition)) v.ring(l.x, l.y, 40, MAGENTA, 2);
    }
    v.save("4-hits-misses.png"); }
  // 5. The rows the pass fitted, with the crop labels: the labels are plants, not rows, so this is a comparison of crop positions, not a row reference.
  { const f = Math.max(1, Math.ceil(Math.max(W, H) / 4096));
    const app = { width: Math.floor(W / f), height: Math.floor(H / f), rgba: new Uint8ClampedArray(Math.floor(W / f) * Math.floor(H / f) * 4) };
    for (let y = 0; y < app.height; y++) for (let x = 0; x < app.width; x++) { let r = 0, g = 0, b = 0; for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) { const o = ((y * f + dy) * W + x * f + dx) * 4; r += raw.data[o]; g += raw.data[o + 1]; b += raw.data[o + 2]; } const o = (y * app.width + x) * 4; app.rgba[o] = r / (f * f); app.rgba[o + 1] = g / (f * f); app.rgba[o + 2] = b / (f * f); app.rgba[o + 3] = 255; }
    const exif = parsePhotoHeader(new Uint8Array(bytes.subarray(0, 1 << 20)));
    const g0 = estimateGsd(exif, { imageWidth: W }).gsdM ?? gsdM;
    const pattern = await analysePhoto(app, { gsdM: g0 * f, rowSpacingM: "auto", windowM: 4 }, { yieldBetweenWindows: false });
    const o = overlayFromPattern(pattern);
    const v = new View(raw, 0, 0, W, H, 4);
    for (const l of o.lines) v.line(l.x1 * f, l.y1 * f, l.x2 * f, l.y2 * f, YELLOW, 2);
    for (const c of o.circles) if (c.cls === "on pattern" || c.cls === "double") v.ring(c.x * f, c.y * f, c.r * f, CYAN, 1);
    for (const l of labels) if (l.cls === "crop") v.ring(l.x, l.y, 40, GREEN, 2);
    v.save("5-rows-vs-crop-labels.png");
    // Crop labels against the pass's placed crop plants: the nearest placed plant to each labelled tree.
    const placed = o.circles.filter(c => c.cls === "on pattern" || c.cls === "double").map(c => ({ x: c.x * f, y: c.y * f }));
    const dists = labels.filter(l => l.cls === "crop").map(l => Math.min(...placed.map(p => Math.hypot(p.x - l.x, p.y - l.y))));
    const sorted = [...dists].sort((a, b) => a - b);
    writeFileSync(join(outDir, "5-rows.json"), JSON.stringify({ blocks: pattern.blocks.map(b => ({ id: b.id, angleDeg: b.angleDeg, pitchM: b.pitchM, windows: b.windows.length, plants: b.plants, seedSpacingM: b.seedSpacingM })), usableWindows: pattern.summary.usableWindows, windows: pattern.summary.windows, placedCrop: placed.length, cropLabels: dists.length, cropLabelToNearestPlacedPx: { median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * 0.9)], max: sorted[sorted.length - 1], over60px: dists.filter(d => d > 60).length } }, null, 2));
  }
  // 6. The refused and the uncertain, with the weed labels on them.
  { const v = new View(raw, 0, 0, W, H, 4);
    for (const p of predFile.predictions) if (p.disposition === "candidate: refused") v.ring(p.x, p.y, 20, MAGENTA, 1); else if (p.disposition.startsWith("uncertain")) v.ring(p.x, p.y, 20, GREY, 1); else if (p.disposition.startsWith("filtered")) v.ring(p.x, p.y, 20, hex(DISPOSITION_COLOUR[p.disposition]), 1);
    for (const m of matches) if (m.label.cls === "weed" && (m.disposition === "candidate: refused" || (m.disposition ?? "").startsWith("uncertain") || (m.disposition ?? "").startsWith("filtered"))) v.ring(m.label.x, m.label.y, 30, RED, 1);
    v.save("6-refused-uncertain.png"); }
  // Native cuts of the places that matter: the misses, by kind.
  const misses = matches.filter(m => m.label.cls === "weed" && !candidate(m.disposition));
  const byKind = new Map<string, typeof misses>();
  for (const m of misses) { const k = m.disposition ?? "missed by segmentation"; byKind.set(k, [...(byKind.get(k) ?? []), m]); }
  let n = 0;
  for (const [kind, list] of byKind) {
    for (const m of list.slice(0, 3)) {
      n++;
      const cx = Math.round(m.label.x), cy = Math.round(m.label.y), half = 200;
      const x0 = Math.max(0, Math.min(W - 2 * half, cx - half)), y0 = Math.max(0, Math.min(H - 2 * half, cy - half));
      const v = new View(raw, x0, y0, 2 * half, 2 * half, 1);
      for (const p of predFile.predictions) { const d = Math.hypot(p.x - cx, p.y - cy); if (d > 300) continue; if (p.outlinePx) v.outline(p.outlinePx, hex(DISPOSITION_COLOUR[p.disposition]), 2); else v.ring(p.x, p.y, (p.equivDiameterM / gsdM) / 2, hex(DISPOSITION_COLOUR[p.disposition]), 2); }
      for (const l of labels) if (Math.hypot(l.x - cx, l.y - cy) < 300) v.ring(l.x, l.y, 14, l.cls === "weed" ? RED : GREEN, 2);
      v.save(`miss-${n}-${kind.replace(/[^a-z]+/gi, "-")}.png`);
    }
  }
})();
