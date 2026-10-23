// The crop-profile benchmark: what the corn profile changes in the engine, measured.
//
//   npm run bench:crop-profile -- --suite synthetic|photos|weedsgalore|stage|all [--crop corn] [--pictures]
//       [--weedsgalore D:/swardus-research/datasets/weedsgalore/rgb] [--photos CropTesting/Corn/earlystage]
//
// Every suite runs the app's own code (photoScout/pattern.ts analysePhoto, weedScout/vegetation.ts, the profile's
// checks) with the crop profile and without it, on the same pixels. Results are written to
// crop-profiles/<crop>/10_validation/results/<suite>.json and .md (small, committed: they are the evidence the
// profile's validation.json cites); pictures to data/bench/crop-profile/ (git-ignored).
//
// Suites:
//   synthetic    rendered stands with known rows and weeds (scenes.ts), evaluation seeds only: rows found, pitch and
//                angle error, whether the row lines sit on the crop, off-row weed precision and recall.
//   photos       the three early-corn photos (no labels): rows found, and how much greener the row lines are than
//                the middle of the alleys (scored with ExGR at zero, an index the pattern pass does not use).
//   weedsgalore  WeedsGalore held-out test patches (one German maize field, labels by the authors): vegetation IoU;
//                with rows from the maize labels, the position rule and between-row weed cover against the labels;
//                at 0.25 cm and box-averaged to 1 and 2 cm.
//   stage        the calendar stage estimate against the stage the WeedsGalore authors state, and the maize cover the
//                labels measure against the profile's expected cover at the estimated stages.
import "../bench/nodeStorageShim";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage, encodePng } from "../bench/images";
import { type PhotoPattern, type PhotoPixels, analysePhoto, photoMask } from "../../src/lib/photoScout/pattern";
import { overlayFromPattern } from "../../src/lib/sourceFrames/patternLook";
import { patternPriorFor } from "../../src/lib/cropProfiles/engine";
import { assessCapabilities, estimateStage, expectedCover } from "../../src/lib/cropProfiles/checks";
import type { RuntimeCropProfile } from "../../src/lib/cropProfiles/runtime";
import { renderScene, sceneSet, type Scene } from "./scenes";
import { runtimePath } from "./fsProfiles";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const SUITE = arg("suite", "all")!;
const CROP = arg("crop", "corn")!;
const PICTURES = argv.includes("--pictures");
const WG = arg("weedsgalore", "D:/swardus-research/datasets/weedsgalore/rgb")!;
const PHOTOS = arg("photos", "CropTesting/Corn/earlystage")!;
const RESULTS = join("crop-profiles", CROP, "10_validation", "results");
const PICS = join("data", "bench", "crop-profile");

const profile = JSON.parse(readFileSync(runtimePath(CROP), "utf8")) as RuntimeCropProfile;
const prior = patternPriorFor(profile);
const revision = (() => { try { const h = execSync("git rev-parse --short HEAD").toString().trim(); const dirty = execSync("git status --porcelain -- src scripts crop-profiles \":(exclude)crop-profiles/*/10_validation/results/**\"").toString().trim() ? "+uncommitted" : ""; return h + dirty; } catch { return "unknown"; } })();
const today = new Date().toISOString().slice(0, 10);

type Img = { width: number; height: number; rgba: Uint8ClampedArray };
const r3 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const share = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : null);
const angleDiff = (a: number, b: number) => { const d = Math.abs((((a - b) % 180) + 180) % 180); return Math.min(d, 180 - d); };

function resample(src: Img, f: number): Img {
  if (f <= 1) return src;
  const w = Math.max(1, Math.floor(src.width / f)), h = Math.max(1, Math.floor(src.height / f));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y * f), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * f));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * f), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * f));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = sy0; yy < sy1 && yy < src.height; yy++) for (let xx = sx0; xx < sx1 && xx < src.width; xx++) { const o = (yy * src.width + xx) * 4; r += src.rgba[o]; g += src.rgba[o + 1]; b += src.rgba[o + 2]; n++; }
      const o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { width: w, height: h, rgba: out };
}

const exgrGreen = (r: number, g: number, b: number) => { const s = r + g + b; if (!s) return false; const R = r / s, G = g / s, B = b / s; return 2 * G - R - B - (1.4 * R - G) > 0; };

// ------------------------------------------------------------------------------------------- drawing
type Rgb = [number, number, number];
function canvas(img: Img): Uint8Array { const c = new Uint8Array(img.width * img.height * 4); for (let i = 0; i < img.width * img.height; i++) { c[i * 4] = img.rgba[i * 4] * 0.8; c[i * 4 + 1] = img.rgba[i * 4 + 1] * 0.8; c[i * 4 + 2] = img.rgba[i * 4 + 2] * 0.8; c[i * 4 + 3] = 255; } return c; }
function plot(c: Uint8Array, w: number, h: number, x: number, y: number, col: Rgb) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= w || y >= h) return; const o = (y * w + x) * 4; c[o] = col[0]; c[o + 1] = col[1]; c[o + 2] = col[2]; }
function line(c: Uint8Array, w: number, h: number, x1: number, y1: number, x2: number, y2: number, col: Rgb, t = 1) { const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1))); for (let k = 0; k <= n; k++) { const x = x1 + ((x2 - x1) * k) / n, y = y1 + ((y2 - y1) * k) / n; for (let dy = -t; dy <= t; dy++) for (let dx = -t; dx <= t; dx++) plot(c, w, h, x + dx, y + dy, col); } }
function ring(c: Uint8Array, w: number, h: number, x: number, y: number, r: number, col: Rgb) { const n = Math.max(24, Math.ceil(2 * Math.PI * r)); for (let k = 0; k < n; k++) { const t = (k / n) * 2 * Math.PI; plot(c, w, h, x + r * Math.cos(t), y + r * Math.sin(t), col); } }
const CLS: Record<string, Rgb> = { "on pattern": [60, 220, 90], double: [255, 220, 0], "between plants": [255, 140, 0], "off-row": [255, 40, 40] };
function drawPattern(img: Img, p: PhotoPattern, file: string) {
  const c = canvas(img), o = overlayFromPattern(p, null), t = Math.max(1, Math.round(img.width / 1200));
  for (const l of o.lines) line(c, img.width, img.height, l.x1, l.y1, l.x2, l.y2, [0, 230, 255], t);
  for (const ci of o.circles) ring(c, img.width, img.height, ci.x, ci.y, ci.r, CLS[ci.cls] ?? [200, 200, 200]);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, encodePng({ width: img.width, height: img.height, data: c }));
}

/** Green density on the row lines (within an eighth of a pitch) against the middle of the alleys (beyond three eighths). */
function onGreenRatio(img: Img, p: PhotoPattern): number | null {
  const o = overlayFromPattern(p, null);
  if (!o.lines.length) return null;
  const pitchPx = (p.summary.medianPitchM ?? 0) / p.gsdM;
  if (!(pitchPx > 2)) return null;
  const segs = o.lines.map(l => { const dx = l.x2 - l.x1, dy = l.y2 - l.y1, L = Math.hypot(dx, dy); return { x: l.x1, y: l.y1, nx: -dy / L, ny: dx / L }; });
  let onN = 0, onG = 0, midN = 0, midG = 0;
  const step = Math.max(1, Math.floor(Math.min(img.width, img.height) / 600));
  for (let y = 0; y < img.height; y += step) for (let x = 0; x < img.width; x += step) {
    let d = Infinity;
    for (const s of segs) d = Math.min(d, Math.abs((x - s.x) * s.nx + (y - s.y) * s.ny));
    if (d > pitchPx) continue; // outside the block's rows
    const k = (y * img.width + x) * 4, g = exgrGreen(img.rgba[k], img.rgba[k + 1], img.rgba[k + 2]);
    if (d <= pitchPx / 8) { onN++; if (g) onG++; } else if (d >= (3 * pitchPx) / 8) { midN++; if (g) midG++; }
  }
  if (!onN || !midN) return null;
  return (onG / onN) / Math.max(1e-3, midG / midN);
}

function writeResult(suite: string, data: unknown, md: string) {
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, `${suite}.json`), JSON.stringify(data, null, 1) + "\n");
  writeFileSync(join(RESULTS, `${suite}.md`), md);
  console.log(`wrote ${join(RESULTS, suite)}.json and .md`);
}

// ------------------------------------------------------------------------------------------- synthetic
async function synthetic() {
  const set = (arg("set", "evaluation") as "evaluation" | "development");
  const scenes = sceneSet(set);
  type Row = { scene: string; mode: string; gsdCm: number; pitchM: number; soil: string; straw: boolean; twin: boolean; widthM: number; found: boolean; pitchErr: number | null; angleErr: number | null; linesOnCrop: number | null; offRowPrecision: number | null; offRowRecall: number | null; ms: number };
  const rows: Row[] = [];
  for (const s of scenes) {
    const { px, truth } = renderScene(s);
    for (const mode of ["neutral", CROP] as const) {
      const t0 = Date.now();
      const p = await analysePhoto(px, { gsdM: s.gsdM, rowSpacingM: "auto", prior: mode === "neutral" ? null : prior }, { yieldBetweenWindows: false });
      const ms = Date.now() - t0;
      const found = p.summary.blocks > 0;
      const pitchErr = found && p.summary.medianPitchM ? Math.abs(p.summary.medianPitchM - s.pitchM) / s.pitchM : null;
      const angleErr = found && p.summary.medianAngleDeg != null ? angleDiff(p.summary.medianAngleDeg, s.angleDeg) : null;
      // Lines on the crop: each overlay line's mean distance to the nearest true row under a quarter pitch.
      const o = overlayFromPattern(p, null);
      const onCrop = o.lines.map(l => { let sum = 0, n = 0; for (let k = 0; k <= 10; k++) { const x = (l.x1 + ((l.x2 - l.x1) * k) / 10) * s.gsdM, y = -(l.y1 + ((l.y2 - l.y1) * k) / 10) * s.gsdM; sum += Math.abs(truth.acrossToRow(x, y)); n++; } return sum / n < s.pitchM / 4; });
      // Off-row blobs against the weeds placed between rows.
      const off = p.blobs.filter(b => b.cls === "off-row").map(b => ({ x: b.x * s.gsdM, y: -b.y * s.gsdM }));
      const near = (a: { x: number; y: number }, w: { x: number; y: number; r: number }) => Math.hypot(a.x - w.x, a.y - w.y) <= Math.max(0.06, w.r * 1.5);
      const tp = off.filter(b => truth.weeds.some(w => near(b, w))).length;
      const hit = truth.weeds.filter(w => off.some(b => near(b, w))).length;
      rows.push({ scene: s.name, mode, gsdCm: s.gsdM * 100, pitchM: s.pitchM, soil: s.soil, straw: !!s.straw, twin: !!s.twinM, widthM: r3(s.widthM)!, found, pitchErr: r3(pitchErr), angleErr: r3(angleErr), linesOnCrop: r3(share(onCrop)), offRowPrecision: off.length ? r3(tp / off.length) : null, offRowRecall: truth.weeds.length && found ? r3(hit / truth.weeds.length) : null, ms });
      if (PICTURES) drawPattern(px, p, join(PICS, "synthetic", `${s.name}-${mode}.png`));
    }
    process.stdout.write(".");
  }
  console.log();
  const sum = (mode: string, filter: (r: Row) => boolean = () => true) => {
    const rs = rows.filter(r => r.mode === mode && filter(r));
    return {
      scenes: rs.length,
      rowsFound: r3(share(rs.map(r => r.found))),
      // Correct: rows found, at least three quarters of the lines on the crop, pitch within 5%. Wrong: found, and not that.
      correctRows: r3(share(rs.map(r => r.found && (r.linesOnCrop ?? 0) >= 0.75 && (r.pitchErr ?? 1) <= 0.05))),
      wrongRows: r3(share(rs.map(r => r.found && !((r.linesOnCrop ?? 0) >= 0.75 && (r.pitchErr ?? 1) <= 0.05)))),
      medianPitchErr: r3(median(rs.filter(r => r.pitchErr != null).map(r => r.pitchErr!))),
      medianAngleErrDeg: r3(median(rs.filter(r => r.angleErr != null).map(r => r.angleErr!))),
      linesOnCrop: r3(mean(rs.filter(r => r.linesOnCrop != null).map(r => r.linesOnCrop!))),
      scenesAllLinesOnCrop: r3(share(rs.map(r => r.found && r.linesOnCrop === 1))),
      offRowPrecision: r3(mean(rs.filter(r => r.offRowPrecision != null).map(r => r.offRowPrecision!))),
      offRowRecall: r3(mean(rs.filter(r => r.offRowRecall != null).map(r => r.offRowRecall!))),
      medianMs: median(rs.map(r => r.ms)),
    };
  };
  const groups: Record<string, (r: Row) => boolean> = { all: () => true, "straw stripes": r => r.straw, "no straw": r => !r.straw, "small photo (under 7.5 m)": r => r.widthM < 7.5, "twin rows": r => r.twin, "red soil": r => r.soil === "red", "gsd 2 to 3 cm": r => r.gsdCm >= 2 };
  const table = Object.fromEntries(Object.entries(groups).map(([k, f]) => [k, { neutral: sum("neutral", f), [CROP]: sum(CROP, f) }]));
  const fmt = (v: number | null) => (v == null ? "-" : String(v));
  const md = [`# Crop profile benchmark: synthetic (${CROP})`, "", `Run ${today}, code ${revision}, ${scenes.length} ${set} scenes (${set === "evaluation" ? "seeds 3000+, run once after the last change to the profile" : "seeds 1000+ and the first evaluation set, seeds 2000+, which became development data when it prompted the ExGR gate"}), rendered by scripts/cropProfiles/scenes.ts. Synthetic: it tests the engine against known geometry and known failure conditions, not field accuracy.`, "",
    "Correct rows: found, at least three quarters of the row lines within a quarter pitch of a true row, pitch within 5%. Wrong rows: found, and not correct. Off-row precision and recall: blobs the pass calls off-row against the weeds rendered between the rows (matched within 1.5 radii or 6 cm).", "",
    "| Group | Mode | Scenes | Rows found | Correct rows | Wrong rows | Median pitch error | Median angle error (deg) | Lines on the crop | Scenes with every line on the crop | Off-row precision | Off-row recall |", "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...Object.entries(table).flatMap(([g, t]) => Object.entries(t).map(([m, x]) => `| ${g} | ${m} | ${x.scenes} | ${fmt(x.rowsFound)} | ${fmt(x.correctRows)} | ${fmt(x.wrongRows)} | ${fmt(x.medianPitchErr)} | ${fmt(x.medianAngleErrDeg)} | ${fmt(x.linesOnCrop)} | ${fmt(x.scenesAllLinesOnCrop)} | ${fmt(x.offRowPrecision)} | ${fmt(x.offRowRecall)} |`)), ""].join("\n");
  writeResult(set === "evaluation" ? "synthetic" : "synthetic-development", { suite: "synthetic", set, crop: CROP, date: today, codeRevision: revision, summary: table, rows }, md);
  return table;
}

// ------------------------------------------------------------------------------------------- photos
/** Row pitch in pixels from the vegetation (as scripts/bench/cropTest.ts): the angle of most projection variance, then the first autocorrelation peak. */
function pitchPx(img: Img): number | null {
  const f = Math.max(1, Math.max(img.width, img.height) / 1000), s = resample(img, f);
  const pts: [number, number][] = [];
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) { const o = (y * s.width + x) * 4; if (exgrGreen(s.rgba[o], s.rgba[o + 1], s.rgba[o + 2])) pts.push([x, y]); }
  if (pts.length < 100) return null;
  const prof = (deg: number) => { const t = (deg * Math.PI) / 180, nx = Math.cos(t), ny = Math.sin(t), D = Math.ceil(Math.hypot(s.width, s.height)), b = new Float64Array(2 * D + 1); for (const [x, y] of pts) b[Math.round(x * nx + y * ny) + D]++; return b; };
  const v = (b: Float64Array) => { let m = 0; for (const x of b) m += x; m /= b.length; let q = 0; for (const x of b) q += (x - m) ** 2; return q; };
  let best = 0, bv = -1; for (let d = 0; d < 180; d++) { const x = v(prof(d)); if (x > bv) { bv = x; best = d; } }
  const p = prof(best), m = p.reduce((a, b) => a + b, 0) / p.length, ac = (lag: number) => { let a = 0; for (let i = 0; i + lag < p.length; i++) a += (p[i] - m) * (p[i + lag] - m); return a; };
  const a0 = ac(0);
  for (let lag = 8; lag < Math.min(s.width, s.height) / 2; lag++) { const c = ac(lag); if (c > ac(lag - 1) && c >= ac(lag + 1) && c > 0.2 * a0) return lag * f; }
  return null;
}

async function photos() {
  const files = existsSync(PHOTOS) ? readdirSync(PHOTOS).filter(f => /\.(jpe?g|png)$/i.test(f)).sort() : [];
  const out: Record<string, unknown>[] = [];
  for (const f of files) {
    const raw = decodeImage(new Uint8Array(readFileSync(join(PHOTOS, f))));
    const full: Img = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
    const pp = pitchPx(full);
    if (!pp) { out.push({ image: f, error: "no pitch for the scale" }); continue; }
    const gsdM = 0.762 / pp; // no EXIF: scale from the measured pitch and an assumed 30 in (stated in the result)
    for (const [res, fac] of [["photo", Math.max(1, Math.max(full.width, full.height) / 4096)], ["2cm", 0.02 / gsdM], ["4cm", 0.04 / gsdM]] as [string, number][]) {
      if (fac < 1 && res !== "photo") continue;
      const img = resample(full, Math.max(1, fac)), g = gsdM * Math.max(1, fac);
      for (const mode of ["neutral", CROP]) {
        const t0 = Date.now();
        // The neutral read is the app's photo pass as it stood (4 m windows); the crop read takes its window from the profile.
        const p = await analysePhoto(img as PhotoPixels, { gsdM: g, rowSpacingM: "auto", ...(mode === "neutral" ? { windowM: 4 } : { prior }) }, { yieldBetweenWindows: false });
        const ratio = onGreenRatio(img, p);
        const a = assessCapabilities(profile, { gsdM: g, on: new Date(), rowsFound: p.summary.blocks > 0, rowCoherence: p.summary.medianRowCoherence ?? null, measuredRowSpacingM: p.summary.medianPitchM, vegetationShare: p.vegetationFraction, otsuThreshold: p.summary.otsuThreshold ?? null });
        out.push({ image: f, res, mode, gsdCm: r3(g * 100), ms: Date.now() - t0, rowsFound: p.summary.blocks > 0, blocks: p.summary.blocks, pitchCm: p.summary.medianPitchM ? r3(p.summary.medianPitchM * 100) : null, angleDeg: r3(p.summary.medianAngleDeg), brightnessWindows: p.summary.brightnessWindows, brightnessReplaced: p.summary.brightnessReplaced ?? 0, flooredMaskWindows: p.summary.flooredMaskWindows ?? 0, exgrGatedShare: r3(p.summary.exgrGatedShare ?? 0), priorSupportedWindows: p.summary.priorSupportedWindows ?? 0, otsu: r3(p.summary.otsuThreshold), vegetationFraction: r3(p.vegetationFraction), medianRowCoherence: r3(p.summary.medianRowCoherence), onGreenRatio: r3(ratio), offRow: p.summary.offRow, onPattern: p.summary.onPattern, findings: a.findings.map(x => x.code), notes: p.notes });
        if (PICTURES || res === "photo") drawPattern(img, p, join(PICS, "photos", basename(f, extname(f)), `pattern-${res}-${mode}.png`));
      }
      process.stdout.write(".");
    }
  }
  console.log();
  const fmt = (v: unknown) => (v == null ? "-" : String(v));
  const md = [`# Crop profile benchmark: early-corn photos (${CROP})`, "", `Run ${today}, code ${revision}. Three photos, no EXIF and no labels: the pixel size comes from the measured pitch and an assumed 30 in (76.2 cm) row spacing. The on-green ratio is the share of green (ExGR above zero, an index the pattern pass does not use) within an eighth of a pitch of the row lines, over the same share in the middle of the alleys: above 1 the lines sit on the green, under 1 they sit between the rows. Photo 0359 was used to diagnose the residue failure, so these are development results.`, "",
    "| Image | Resolution | Mode | Rows found | Pitch (cm) | On-green ratio | Brightness windows | Re-placed on green | ExGR-gated share | Otsu split | Row coherence |", "|---|---|---|---|---|---|---|---|---|---|---|",
    ...out.map(r => `| ${String(r.image).slice(0, 14)} | ${fmt(r.res)} | ${fmt(r.mode)} | ${fmt(r.rowsFound)} | ${fmt(r.pitchCm)} | ${fmt(r.onGreenRatio)} | ${fmt(r.brightnessWindows)} | ${fmt(r.brightnessReplaced)} | ${fmt(r.exgrGatedShare)} | ${fmt(r.otsu)} | ${fmt(r.medianRowCoherence)} |`), ""].join("\n");
  writeResult("photos", { suite: "photos", crop: CROP, date: today, codeRevision: revision, scaleBasis: "no EXIF: pixel size from the measured pitch and an assumed 0.762 m row spacing", rows: out }, md);
  return out;
}

// ------------------------------------------------------------------------------------------- weedsgalore
type Labelled = { id: string; date: string; img: Img; labels: Uint8Array };
function loadWG(split: string): Labelled[] {
  const dir = join(WG, split);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(".png") && !f.endsWith(".labels.png")).sort().map(f => {
    const raw = decodeImage(new Uint8Array(readFileSync(join(dir, f))));
    const lab = decodeImage(new Uint8Array(readFileSync(join(dir, f.replace(".png", ".labels.png")))));
    const labels = new Uint8Array(lab.width * lab.height);
    for (let i = 0; i < labels.length; i++) labels[i] = lab.data[i * 4];
    return { id: f.replace(".png", ""), date: f.slice(0, 10), img: { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) }, labels };
  });
}

/** Box-average labels to a coarser grid: each coarse pixel takes the class covering most of it (background unless vegetation is at least half). */
function resampleLabels(labels: Uint8Array, w: number, h: number, f: number): { labels: Uint8Array; w: number; h: number } {
  if (f <= 1) return { labels, w, h };
  const W = Math.floor(w / f), H = Math.floor(h / f), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cnt = new Array(6).fill(0); let n = 0;
    for (let yy = Math.floor(y * f); yy < Math.floor((y + 1) * f); yy++) for (let xx = Math.floor(x * f); xx < Math.floor((x + 1) * f); xx++) { cnt[labels[yy * w + xx]]++; n++; }
    const veg = n - cnt[0];
    if (veg * 2 < n) { out[y * W + x] = 0; continue; }
    let best = 1; for (let c = 2; c < 6; c++) if (cnt[c] > cnt[best]) best = c;
    out[y * W + x] = best;
  }
  return { labels: out, w: W, h: H };
}

/** Rows from the maize labels: the direction of most projection variance of maize pixels, then the profile's peaks. */
function oracleRows(labels: Uint8Array, w: number, h: number, gsdM: number): { angleRad: number; centres: number[]; pitchM: number } | null {
  const pts: [number, number][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (labels[y * w + x] === 1) pts.push([x, y]);
  if (pts.length < 50) return null;
  const binPx = Math.max(1, Math.round(0.02 / gsdM));
  const prof = (t: number) => { const nx = Math.cos(t), ny = Math.sin(t), D = Math.ceil(Math.hypot(w, h) / binPx) + 1, b = new Float64Array(2 * D + 1); for (const [x, y] of pts) b[Math.round((x * nx + y * ny) / binPx) + D]++; return { b, D }; };
  const v = (b: Float64Array) => { let m = 0; for (const x of b) m += x; m /= b.length; let q = 0; for (const x of b) q += (x - m) ** 2; return q; };
  let best = 0, bv = -1; for (let d = 0; d < 180; d++) { const t = (d * Math.PI) / 180, x = v(prof(t).b); if (x > bv) { bv = x; best = t; } }
  const { b, D } = prof(best);
  // Smooth over 10 cm and take maxima at least 35 cm apart (rows are 70 cm apart) holding 10% of the maize.
  const k = Math.max(1, Math.round(0.05 / (binPx * gsdM)));
  const sm = b.map((_, i) => { let s = 0; for (let j = i - k; j <= i + k; j++) s += b[j] ?? 0; return s; });
  const minSep = Math.round(0.35 / (binPx * gsdM)), total = pts.length;
  const peaks: number[] = [];
  const order = [...sm.keys()].sort((a, z) => sm[z] - sm[a]);
  for (const i of order) { if (sm[i] < 0.03 * total) break; if (peaks.every(p => Math.abs(p - i) >= minSep)) peaks.push(i); if (peaks.length >= 4) break; }
  const centres = peaks.map(i => (i - D) * binPx).sort((a, z) => a - z);
  const pitchM = centres.length >= 2 ? median(centres.slice(1).map((c, i) => (c - centres[i]) * gsdM))! : 0.70;
  return { angleRad: best, centres, pitchM };
}

async function weedsgalore() {
  const test = loadWG("test");
  if (!test.length) { console.warn(`WeedsGalore not found at ${WG}: run scripts/cropProfiles/prep_weedsgalore.py first`); return null; }
  const manifest = JSON.parse(readFileSync(join(WG, "manifest.json"), "utf8")) as { gsdCm: number; rowSpacingM: number };
  const g0 = manifest.gsdCm / 100;
  type Row = Record<string, number | string | boolean | null>;
  const rows: Row[] = [];
  for (const t of test) {
    for (const [res, f] of [["0.25cm", 1], ["1cm", 4], ["2cm", 8]] as [string, number][]) {
      const img = resample(t.img, f), g = g0 * f;
      const L = resampleLabels(t.labels, t.img.width, t.img.height, f);
      const n = L.w * L.h;
      const truthVeg = (i: number) => L.labels[i] > 0;
      const masks: Record<string, Uint8Array> = {};
      const windowPx = Math.max(16, Math.round(4 / g));
      masks.neutral = photoMask(img as PhotoPixels, windowPx, null).mask;
      masks[CROP] = photoMask(img as PhotoPixels, windowPx, profile.vegetation.indexFloor, profile.vegetation.exgrGate ?? null).mask;
      masks["exgr0 (reference)"] = (() => { const m = new Uint8Array(n); for (let i = 0; i < n; i++) m[i] = exgrGreen(img.rgba[i * 4], img.rgba[i * 4 + 1], img.rgba[i * 4 + 2]) ? 1 : 0; return m; })();
      const rowsO = oracleRows(L.labels, L.w, L.h, g);
      for (const [mode, m] of Object.entries(masks)) {
        let inter = 0, uni = 0;
        for (let i = 0; i < n; i++) { const a = m[i] === 1, b = truthVeg(i); if (a && b) inter++; if (a || b) uni++; }
        const row: Row = { image: t.id, date: t.date, res, mode, vegIoU: uni ? r3(inter / uni) : null, truthVegShare: r3([...L.labels].filter(x => x > 0).length / n), maskShare: r3(m.reduce((a, b) => a + b, 0) / n) };
        if (rowsO && rowsO.centres.length) {
          // The engine's row band: half-width max(0.15 m, 0.15 x pitch) (weedVision/rowFilter.ts ROW_BAND_MIN_M, ROW_BAND_PITCH_SHARE).
          const half = Math.max(0.15, 0.15 * rowsO.pitchM) / g;
          const nx = Math.cos(rowsO.angleRad), ny = Math.sin(rowsO.angleRad);
          const reach = (rowsO.pitchM / g) * 0.75;
          let maize = 0, maizeIn = 0, weed = 0, weedOff = 0, offGround = 0, offMask = 0, offTruthWeed = 0, offLabelledVeg = 0;
          for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
            const i = y * L.w + x, a = x * nx + y * ny;
            let d = Infinity; for (const c of rowsO.centres) d = Math.min(d, Math.abs(a - c));
            if (d > reach) continue; // only ground the found rows speak for
            const lab = L.labels[i], inBand = d <= half;
            if (lab === 1) { maize++; if (inBand) maizeIn++; }
            if (lab >= 2) { weed++; if (!inBand) weedOff++; }
            if (!inBand) { offGround++; if (m[i]) offMask++; if (lab >= 2) offTruthWeed++; if (lab > 0) offLabelledVeg++; }
          }
          Object.assign(row, {
            oracleRows: rowsO.centres.length, oraclePitchM: r3(rowsO.pitchM),
            maizeInBand: maize ? r3(maizeIn / maize) : null,
            weedOffBand: weed ? r3(weedOff / weed) : null,
            offBandWeedPrecision: offLabelledVeg ? r3(offTruthWeed / offLabelledVeg) : null,
            offRowCoverEstimate: offGround ? r3(offMask / offGround) : null,
            offRowCoverTruth: offGround ? r3(offTruthWeed / offGround) : null,
          });
        }
        rows.push(row);
      }
      // Fully automatic rows on the patch with the crop prior: 1.5 m holds about two rows (reported, not scored).
      if (res === "1cm") {
        const p = await analysePhoto(img as PhotoPixels, { gsdM: g, rowSpacingM: "auto", prior }, { yieldBetweenWindows: false });
        rows.push({ image: t.id, date: t.date, res, mode: `${CROP} automatic rows`, rowsFound: p.summary.blocks > 0, pitchCm: p.summary.medianPitchM ? r3(p.summary.medianPitchM * 100) : null });
        if (PICTURES) drawPattern(img, p, join(PICS, "weedsgalore", `${t.id}-1cm.png`));
      }
    }
    process.stdout.write(".");
  }
  console.log();
  const agg = (res: string, mode: string) => {
    const rs = rows.filter(r => r.res === res && r.mode === mode);
    const num = (k: string) => rs.map(r => r[k]).filter((v): v is number => typeof v === "number");
    const mae = rs.filter(r => typeof r.offRowCoverEstimate === "number" && typeof r.offRowCoverTruth === "number").map(r => Math.abs((r.offRowCoverEstimate as number) - (r.offRowCoverTruth as number)));
    const bias = rs.filter(r => typeof r.offRowCoverEstimate === "number" && typeof r.offRowCoverTruth === "number").map(r => (r.offRowCoverEstimate as number) - (r.offRowCoverTruth as number));
    return { patches: rs.length, meanVegIoU: r3(mean(num("vegIoU"))), meanMaizeInBand: r3(mean(num("maizeInBand"))), meanWeedOffBand: r3(mean(num("weedOffBand"))), meanOffBandWeedPrecision: r3(mean(num("offBandWeedPrecision"))), coverMAE: r3(mean(mae)), coverBias: r3(mean(bias)) };
  };
  const byDate = (res: string, mode: string) => Object.fromEntries([...new Set(test.map(t => t.date))].map(d => {
    const rs = rows.filter(r => r.res === res && r.mode === mode && r.date === d);
    const num = (k: string) => rs.map(r => r[k]).filter((v): v is number => typeof v === "number");
    const mae = rs.filter(r => typeof r.offRowCoverEstimate === "number").map(r => Math.abs((r.offRowCoverEstimate as number) - (r.offRowCoverTruth as number)));
    return [d, { patches: rs.length, vegIoU: r3(mean(num("vegIoU"))), coverMAE: r3(mean(mae)), maizeInBand: r3(mean(num("maizeInBand"))), weedOffBand: r3(mean(num("weedOffBand"))) }];
  }));
  const modes = ["neutral", CROP, "exgr0 (reference)"];
  const summary = Object.fromEntries(["0.25cm", "1cm", "2cm"].map(res => [res, Object.fromEntries(modes.map(m => [m, agg(res, m)]))]));
  const auto = rows.filter(r => r.mode === `${CROP} automatic rows`);
  const autoFound = share(auto.map(r => r.rowsFound === true));
  const md = [`# Crop profile benchmark: WeedsGalore held-out test patches (${CROP})`, "", `Run ${today}, code ${revision}. WeedsGalore (Celikkan et al. 2025, CC BY 4.0): one maize field near Potsdam, Germany, 70 cm rows, four dates (sown 9 May 2023; 25 May, 30 May, 6 June, 15 June). ${test.length} test patches of 1.5 x 1.5 m (the authors' spatial split; nothing here was set on them). RGB composites of the P4 Multispectral R, G and B bands with one gain from train and val (scripts/cropProfiles/prep_weedsgalore.py): not a consumer RGB camera. Scores at 1 and 2 cm come from box-averaging 0.25 cm pixels and are upper bounds for native imagery at those sizes (Velumani 2021).`, "",
    "Rows for the position rule are taken from the maize labels (oracle rows): these numbers measure the rule and the band width given correct rows, not the row reader. The row band is the engine's: half-width max(15 cm, 0.15 x pitch).", "",
    "| Pixel | Mask | Patches | Vegetation IoU | Maize inside the band | Weed outside the band | Off-band vegetation that is weed | Off-row cover MAE | Off-row cover bias |", "|---|---|---|---|---|---|---|---|---|",
    ...Object.entries(summary).flatMap(([res, ms]) => Object.entries(ms).map(([m, x]) => `| ${res} | ${m} | ${x.patches} | ${x.meanVegIoU ?? "-"} | ${x.meanMaizeInBand ?? "-"} | ${x.meanWeedOffBand ?? "-"} | ${x.meanOffBandWeedPrecision ?? "-"} | ${x.coverMAE ?? "-"} | ${x.coverBias ?? "-"} |`)), "",
    `Automatic rows (pattern pass with the ${CROP} prior) on the 1.5 m patches at 1 cm: found on ${autoFound == null ? "-" : Math.round(autoFound * 100) + "%"} of patches. A patch holds about two rows, under what a pitch measurement needs; field photos are 4 m and more.`, "",
    "By date, 1 cm, corn mask:", "", "| Date | Patches | Vegetation IoU | Off-row cover MAE | Maize inside the band | Weed outside the band |", "|---|---|---|---|---|---|",
    ...Object.entries(byDate("1cm", CROP)).map(([d, x]) => `| ${d} | ${x.patches} | ${x.vegIoU ?? "-"} | ${x.coverMAE ?? "-"} | ${x.maizeInBand ?? "-"} | ${x.weedOffBand ?? "-"} |`), ""].join("\n");
  writeResult("weedsgalore", { suite: "weedsgalore", crop: CROP, date: today, codeRevision: revision, dataset: "WeedsGalore test split", summary, byDate1cm: byDate("1cm", CROP), automaticRowsFound1cm: r3(autoFound), rows }, md);
  return summary;
}

// ------------------------------------------------------------------------------------------- stage
async function stage() {
  const sown = "2023-05-09";
  const stated: Record<string, string> = { "2023-05-25": "V1" };
  const dates = ["2023-05-25", "2023-05-30", "2023-06-06", "2023-06-15"];
  // Maize cover per date from the labels of every split (labels only; no image is read).
  const cover: Record<string, number | null> = {};
  for (const d of dates) {
    let maize = 0, n = 0;
    for (const split of ["train", "val", "test"]) {
      const dir = join(WG, split);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter(x => x.startsWith(d) && x.endsWith(".labels.png"))) {
        const lab = decodeImage(new Uint8Array(readFileSync(join(dir, f))));
        for (let i = 0; i < lab.width * lab.height; i++) { n++; if (lab.data[i * 4] === 1) maize++; }
      }
    }
    cover[d] = n ? maize / n : null;
  }
  const rows = dates.map(d => {
    const est = estimateStage(profile, sown, new Date(`${d}T12:00:00Z`));
    const exp = expectedCover(profile, est);
    const range = est.status === "estimated" ? `${est.from.id} to ${est.to.id}` : null;
    const inRange = stated[d] && est.status === "estimated" ? (() => { const o = profile.stages.find(s => s.id === stated[d])!.order; return o >= est.from.order && o <= est.to.order; })() : null;
    // Expected cover is for 30 in rows at about 84,000 plants/ha; WeedsGalore is 70 cm x 20 cm (about 71,000/ha).
    const c = cover[d];
    const coverInExpected = exp && c != null ? c >= exp.low - profile.consistency.coverStageToleranceShare && c <= exp.high + profile.consistency.coverStageToleranceShare : null;
    return { date: d, daysAfterSowing: est.status === "estimated" ? est.daysAfterPlanting : null, estimatedStages: range, statedStage: stated[d] ?? null, statedInRange: inRange, maizeCoverFromLabels: r3(c), expectedCropCover: exp ? [r3(exp.low), r3(exp.high)] : null, coverWithinTolerance: coverInExpected };
  });
  const md = [`# Crop profile benchmark: stage estimate (${CROP})`, "", `Run ${today}, code ${revision}. The calendar estimate from the WeedsGalore sowing date (9 May 2023) for each flight, against the one stage the authors state (V1 on 25 May), and the maize cover measured from the labels of every patch against the profile's expected crop cover at the estimated stages (tolerance ${profile.consistency.coverStageToleranceShare}). One field; the expected cover is for 30 in rows at about 84,000 plants/ha, WeedsGalore is 70 x 20 cm (about 71,000/ha).`, "",
    "| Date | Days after sowing | Estimated stages | Stated | Stated in range | Maize cover (labels) | Expected crop cover | Within tolerance |", "|---|---|---|---|---|---|---|---|",
    ...rows.map(r => `| ${r.date} | ${r.daysAfterSowing} | ${r.estimatedStages} | ${r.statedStage ?? "-"} | ${r.statedInRange ?? "-"} | ${r.maizeCoverFromLabels ?? "-"} | ${r.expectedCropCover ? r.expectedCropCover.join(" to ") : "-"} | ${r.coverWithinTolerance ?? "-"} |`), ""].join("\n");
  writeResult("stage", { suite: "stage", crop: CROP, date: today, codeRevision: revision, rows }, md);
  return rows;
}

(async () => {
  const want = (s: string) => SUITE === "all" || SUITE === s;
  if (want("synthetic")) console.log(JSON.stringify(await synthetic(), null, 1));
  if (want("photos")) await photos();
  if (want("weedsgalore")) console.log(JSON.stringify(await weedsgalore(), null, 1));
  if (want("stage")) console.log(JSON.stringify(await stage(), null, 1));
})().catch(e => { console.error(e); process.exit(1); });
