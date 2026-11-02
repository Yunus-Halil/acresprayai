// Corn emergence V1 against V2 on a folder of photographs: the same reader run three times (EMERGENCE switches), the
// pictures drawn side by side in meaning, a table, and sheets of sampled observations cut at the photo's own pixel
// for checking by eye.
//   npx vite-node scripts/rowCrop/emergenceV2Bench.ts -- [--photos directtestimagery/veryearlystage] [--only 54,100] [--sheets 48] [--no-pictures]
//
// V1: the reader as it was (one planting, no recovery): the strict seedling mask in magenta, rows cyan, plants green,
//     gaps orange, green off the rows red.
// V2A: row reconstruction: the mask, rows cyan, ground set apart as a later planting outlined white; direction, pitch,
//     lens and row-spacing consistency in the table.
// V2B: row-aware recovery: rows, confirmed plants green dots, possible seedlings blue rings, supported missing plants
//     orange rings, uncertain positions grey rings, gaps orange (supported missing) or grey (uncertain).
// Sheets (outputs/emergence-v2/sheets/): random samples of each V2B class, each crop 23 cm
// across at 5x, the position ringed (4 cm); the order is written beside it so a verdict can be recorded per crop.
import "../bench/nodeStorageShim";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { EMERGENCE } from "../../src/lib/rowCrop/emergence";
import { readRowCrop, type RowCropRead } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { seedlingMask } from "../../src/lib/rowCrop/seedlingGreen";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const PHOTOS = arg("photos", "directtestimagery/veryearlystage")!;
const ONLY = arg("only")?.split(",");
const SHEETS = Number(arg("sheets", "48"));
const PICTURES = !argv.includes("--no-pictures");
const OUT = join(PHOTOS, "outputs", "emergence-v2");
const profile = cropProfileFor("corn")!;
const revision = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();
type Rgb = [number, number, number];

const MODES = { V1: { extraPlantings: false, recover: false }, V2A: { extraPlantings: true, recover: false }, V2B: { extraPlantings: true, recover: true } } as const;
const saved = { extraPlantings: EMERGENCE.extraPlantings, recover: EMERGENCE.recover };
function read(px: PhotoPixels, mode: keyof typeof MODES): RowCropRead {
  Object.assign(EMERGENCE, MODES[mode]);
  try { return readRowCrop(px, rowCropParamsFor(profile, null, "emergence")); } finally { Object.assign(EMERGENCE, saved); }
}

function canvas(px: PhotoPixels, mask: Uint8Array | null): Uint8Array {
  const n = px.width * px.height, c = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    if (mask && mask[i]) { c[i * 4] = 255; c[i * 4 + 1] = 0; c[i * 4 + 2] = 255; }
    else { c[i * 4] = px.rgba[i * 4] * 0.8; c[i * 4 + 1] = px.rgba[i * 4 + 1] * 0.8; c[i * 4 + 2] = px.rgba[i * 4 + 2] * 0.8; }
    c[i * 4 + 3] = 255;
  }
  return c;
}
function line(c: Uint8Array, w: number, h: number, x1: number, y1: number, x2: number, y2: number, col: Rgb, t = 1, dash = 0) {
  const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  for (let k = 0; k <= n; k++) {
    if (dash && Math.floor(k / dash) % 2) continue;
    const x = x1 + ((x2 - x1) * k) / n, y = y1 + ((y2 - y1) * k) / n;
    for (let dy = -t; dy <= t; dy++) for (let dx = -t; dx <= t; dx++) { const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const o = (yy * w + xx) * 4; c[o] = col[0]; c[o + 1] = col[1]; c[o + 2] = col[2]; }
  }
}
const poly = (c: Uint8Array, w: number, h: number, pts: [number, number][], col: Rgb, t: number) => { for (let i = 0; i + 1 < pts.length; i++) line(c, w, h, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], col, t); };
const ring = (c: Uint8Array, w: number, h: number, x: number, y: number, r: number, col: Rgb, t: number) => { for (let k = 0; k < 40; k++) { const a = (k / 40) * 2 * Math.PI, b = ((k + 1) / 40) * 2 * Math.PI; line(c, w, h, x + r * Math.cos(a), y + r * Math.sin(a), x + r * Math.cos(b), y + r * Math.sin(b), col, t); } };
const dot = (c: Uint8Array, w: number, h: number, x: number, y: number, r: number, col: Rgb) => line(c, w, h, x, y, x, y, col, r);

function draw(px: PhotoPixels, r: RowCropRead, mode: keyof typeof MODES, mask: Uint8Array, file: string) {
  const { width: w, height: h } = px, t = Math.max(1, Math.round(w / 1800));
  const c = canvas(px, mode === "V2B" ? null : mask);
  const ringR = Math.max(6, Math.round(0.025 / r.gsdM));
  for (const row of r.rows) poly(c, w, h, row.points, [0, 230, 255], t);
  // V2: ground set apart (a later planting, a verge) outlined white.
  if (mode !== "V1") for (const e of r.excluded) if (/later planting/.test(e.reason)) poly(c, w, h, [...e.hull, e.hull[0]], [255, 255, 255], t + 1);
  if (mode === "V2B") {
    for (const row of r.rows) for (const g of row.gaps) line(c, w, h, g.x1, g.y1, g.x2, g.y2, g.kind === "supported missing" ? [255, 150, 0] : [170, 170, 170], t + 1, g.kind === "uncertain" ? 12 : 0);
    for (const row of r.rows) {
      for (const p of row.plantPoints ?? []) dot(c, w, h, p[0], p[1], t + 1, [60, 255, 90]);
      for (const p of row.possiblePoints ?? []) ring(c, w, h, p[0], p[1], ringR, [60, 140, 255], t);
      for (const p of row.missingPoints ?? []) ring(c, w, h, p[0], p[1], ringR, [255, 150, 0], t);
      for (const p of row.uncertainPoints ?? []) ring(c, w, h, p[0], p[1], ringR, [170, 170, 170], t);
    }
  } else {
    for (const row of r.rows) for (const g of row.gaps) line(c, w, h, g.x1, g.y1, g.x2, g.y2, [255, 150, 0], t + 1);
    for (const row of r.rows) {
      for (const p of row.plantPoints ?? []) dot(c, w, h, p[0], p[1], t, [60, 255, 90]);
    }
  }
  for (const wd of r.weeds) poly(c, w, h, [...wd.hull, wd.hull[0]], [255, 40, 40], t);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, encodeJpeg({ width: w, height: h, data: c }, 85));
}

type Sample = { photo: string; x: number; y: number; cls: string };
const samples: Sample[] = [];
const pixelsOf = new Map<string, PhotoPixels>();
const rows: Record<string, unknown>[] = [];
const files = readdirSync(PHOTOS).filter(f => /\.(jpe?g|png)$/i.test(f)).filter(f => !ONLY || ONLY.includes(basename(f, extname(f)))).sort((a, b) => parseInt(a) - parseInt(b));
for (const f of files) {
  const name = basename(f, extname(f));
  const raw = decodeImage(new Uint8Array(readFileSync(join(PHOTOS, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const reads = { V1: read(px, "V1"), V2A: read(px, "V2A"), V2B: read(px, "V2B") };
  if (PICTURES) { const mask = seedlingMask(px); for (const m of ["V1", "V2A", "V2B"] as const) draw(px, reads[m], m, mask, join(OUT, m, `${name}.jpg`)); }
  const e = reads.V2B.emergence!, a = reads.V2A.emergence!;
  rows.push({
    photo: name,
    v1: { rows: reads.V1.summary.rows, plants: reads.V1.summary.plants, gaps: reads.V1.summary.gaps, gapM: reads.V1.summary.gapLengthM, weeds: reads.V1.summary.weeds, ms: reads.V1.summary.ms, directionDeg: reads.V1.directionDeg, pitchCm: reads.V1.pitchM == null ? null : Math.round(reads.V1.pitchM * 1000) / 10 },
    v2a: { rows: reads.V2A.summary.rows, laterPlanting: a.laterPlanting ? a.laterPlanting.greenPatches : null, plants: reads.V2A.summary.plants, weeds: reads.V2A.summary.weeds, rowSpacingCm: a.rowSpacingM == null ? null : Math.round(a.rowSpacingM * 1000) / 10, rowSpacingCv: a.rowSpacingCv, lensK1: a.lensK1, ms: reads.V2A.summary.ms },
    v2b: { confirmed: e.confirmed, strictFound: e.strictFound, possible: e.possible, uncertain: e.uncertain, missing: e.missing, searched: e.searched, controlRate: e.controlRate, gaps: reads.V2B.summary.gaps, gapM: reads.V2B.summary.gapLengthM, gapsBefore: e.gapsBefore, gapMBefore: e.gapLengthBeforeM, ms: reads.V2B.summary.ms },
  });
  for (const row of reads.V2B.rows) {
    for (const [x, y] of row.possiblePoints ?? []) samples.push({ photo: name, x, y, cls: "possible" });
    for (const [x, y] of row.missingPoints ?? []) samples.push({ photo: name, x, y, cls: "missing" });
    for (const [x, y] of row.uncertainPoints ?? []) samples.push({ photo: name, x, y, cls: "uncertain" });
  }
  if (SHEETS) pixelsOf.set(name, px);
  const r = rows[rows.length - 1] as { v1: { ms: number }; v2b: { possible: number; missing: number; uncertain: number; gaps: number; gapsBefore: number; ms: number }; v2a: { laterPlanting: number | null } };
  console.log(`${name}: later planting ${r.v2a.laterPlanting ?? "-"}, possible ${r.v2b.possible}, missing ${r.v2b.missing}, uncertain ${r.v2b.uncertain}, gaps ${r.v2b.gapsBefore} -> ${r.v2b.gaps}, ${r.v1.ms} / ${r.v2b.ms} ms`);
}

// Sample sheets: each class, a seeded random sample, crops 23 cm across at 5x with the position ringed.
if (SHEETS) {
  let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  mkdirSync(join(OUT, "sheets"), { recursive: true });
  for (const cls of ["possible", "missing", "uncertain"]) {
    const pool = samples.filter(s => s.cls === cls);
    const pick: Sample[] = [];
    while (pick.length < Math.min(SHEETS, pool.length)) { const s = pool[Math.floor(rnd() * pool.length)]; if (!pick.includes(s)) pick.push(s); }
    if (!pick.length) continue;
    const half = 24, Z = 5, cellPx = 2 * half * Z, cols = 6, rowsN = Math.ceil(pick.length / cols);
    const W = cols * cellPx, H = rowsN * cellPx, img = new Uint8Array(W * H * 4);
    pick.forEach((s, k) => {
      const px = pixelsOf.get(s.photo)!, ox = (k % cols) * cellPx, oy = Math.floor(k / cols) * cellPx;
      for (let y = 0; y < cellPx; y++) for (let x = 0; x < cellPx; x++) {
        const sx = Math.round(s.x - half + x / Z), sy = Math.round(s.y - half + y / Z), o = ((oy + y) * W + ox + x) * 4;
        if (sx < 0 || sy < 0 || sx >= px.width || sy >= px.height) { img[o + 3] = 255; continue; }
        const q = (sy * px.width + sx) * 4; img[o] = px.rgba[q]; img[o + 1] = px.rgba[q + 1]; img[o + 2] = px.rgba[q + 2]; img[o + 3] = 255;
      }
      const r0 = 0.02 / 0.0048 * Z; // a 4 cm ring
      for (let a = 0; a < 64; a++) { const t = (a / 64) * 2 * Math.PI, x = Math.round(ox + cellPx / 2 + r0 * Math.cos(t)), y = Math.round(oy + cellPx / 2 + r0 * Math.sin(t)); for (const [ddx, ddy] of [[0, 0], [1, 0], [0, 1]]) { const o = ((y + ddy) * W + x + ddx) * 4; if (o >= 0 && o < img.length) { img[o] = 255; img[o + 1] = 255; img[o + 2] = 255; } } }
      for (let x = ox; x < ox + cellPx; x++) { const o1 = (oy * W + x) * 4, o2 = ((oy + cellPx - 1) * W + x) * 4; img[o1] = img[o2] = 20; img[o1 + 1] = img[o2 + 1] = 20; img[o1 + 2] = img[o2 + 2] = 20; }
      for (let y = oy; y < oy + cellPx; y++) { const o1 = (y * W + ox) * 4, o2 = (y * W + ox + cellPx - 1) * 4; img[o1] = img[o2] = 20; img[o1 + 1] = img[o2 + 1] = 20; img[o1 + 2] = img[o2 + 2] = 20; }
    });
    writeFileSync(join(OUT, "sheets", `${cls}.jpg`), encodeJpeg({ width: W, height: H, data: img }, 90));
    writeFileSync(join(OUT, "sheets", `${cls}.json`), JSON.stringify(pick, null, 1));
  }
}

const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(OUT, "results.json"), JSON.stringify({ date: today, codeRevision: revision, photos: PHOTOS, rows }, null, 1) + "\n");
const fmt = (v: unknown) => (v == null ? "-" : String(v));
type Row = { photo: string; v1: Record<string, unknown>; v2a: Record<string, unknown>; v2b: Record<string, unknown> };
const md = [`# Corn emergence V1 against V2 (${today}, code ${revision})`, "", `${rows.length} photographs from ${PHOTOS}; no pixel size, so every metre rests on the assumed 76.2 cm row spacing. No counted plants exist: the classes are the reader's own, checked by eye on the sample sheets.`, "",
  "| Photo | V1 rows | V1 plants | V1 gaps (m) | V1 weeds | V1 ms | V2A rows | Later planting (green set apart) | V2A weeds | Row spacing cm (CV) | Strict found | Possible | Missing | Uncertain | Control rate | V2B gaps (m) | V2B ms |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...(rows as Row[]).map(r => `| ${r.photo} | ${fmt(r.v1.rows)} | ${fmt(r.v1.plants)} | ${fmt(r.v1.gaps)} (${fmt(r.v1.gapM)}) | ${fmt(r.v1.weeds)} | ${fmt(r.v1.ms)} | ${fmt(r.v2a.rows)} | ${fmt(r.v2a.laterPlanting)} | ${fmt(r.v2a.weeds)} | ${fmt(r.v2a.rowSpacingCm)} (${fmt(r.v2a.rowSpacingCv)}) | ${fmt(r.v2b.strictFound)} | ${fmt(r.v2b.possible)} | ${fmt(r.v2b.missing)} | ${fmt(r.v2b.uncertain)} | ${fmt(r.v2b.controlRate)} | ${fmt(r.v2b.gaps)} (${fmt(r.v2b.gapM)}) | ${fmt(r.v2b.ms)} |`), ""].join("\n");
writeFileSync(join(OUT, "results.md"), md);
console.log(`wrote ${OUT}`);
