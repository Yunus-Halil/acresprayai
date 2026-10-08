// The planting-pattern benchmark: the pass over a folder of real photos,
// one row per photo and a summary, so every change to pattern.ts is measured
// before it ships.
//
//   npm run bench:pattern -- --dir samplerowtestingimagery [--gsd-cm 5] [--spacing auto|0.76] [--window 4] [--only DJI_03]
//
// --gsd-cm downsamples each photo to that pixel size first, which is how the
// pass is tested at the field map's resolution (about 5 cm) rather than the
// photo's. Imagery folders are gitignored; the records go to data/bench/pattern/.
// Read-only apart from that.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import jpeg from "jpeg-js";
import { parseArgs } from "./cli";
import { estimateGsd, parsePhotoHeader } from "../../src/lib/photoScout/exif";
import { analysePhoto, type PhotoPixels } from "../../src/lib/photoScout/pattern";

const args = parseArgs(process.argv.slice(2));
const dir = String(args.dir ?? "samplerowtestingimagery");
const targetCm = args["gsd-cm"] ? Number(args["gsd-cm"]) : null;
const spacing: number | "auto" = args.spacing && args.spacing !== "auto" ? Number(args.spacing) : "auto";
const windowM = args.window ? Number(args.window) : 4;
const only = args.only ? String(args.only) : "";

/** Box-average by an integer factor. */
function downsample(src: { width: number; height: number; data: Uint8Array }, f: number): PhotoPixels {
  const w = Math.floor(src.width / f), h = Math.floor(src.height / f);
  const rgba = new Uint8ClampedArray(w * h * 4);
  const n = f * f;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
      const o = ((y * f + dy) * src.width + (x * f + dx)) * 4;
      r += src.data[o]; g += src.data[o + 1]; b += src.data[o + 2];
    }
    const o = (y * w + x) * 4;
    rgba[o] = r / n; rgba[o + 1] = g / n; rgba[o + 2] = b / n; rgba[o + 3] = 255;
  }
  return { width: w, height: h, rgba };
}

type Row = {
  photo: string; gsdCm: number; ms: number; windows: number; usable: number; blocks: number; squareGrid: boolean;
  angleDeg: number | null; pitchCm: number | null; plantCm: number | null; seedCm: number | null; agreement: number | null;
  blobs: number; onPattern: number; offRow: number; betweenPlants: number; doubles: number; unplaced: number; notes: string[];
};

const fmt = (v: number | null, d = 0) => (v == null ? "-" : v.toFixed(d));
const median = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

(async () => {
  const files = readdirSync(dir).filter(f => /\.jpe?g$/i.test(f) && (!only || f.includes(only))).sort();
  if (files.length === 0) { console.error(`no JPEGs in ${dir}`); process.exit(1); }
  const rows: Row[] = [];
  console.log("photo | gsd cm | ms | usable/win | blocks | sq | angle | pitch cm | plant cm | seed cm | agree | on | off | between | dbl | unpl");
  for (const name of files) {
    const bytes = readFileSync(join(dir, name));
    const exif = parsePhotoHeader(new Uint8Array(bytes.subarray(0, 1 << 20)));
    const raw = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 });
    const native = estimateGsd(exif, { imageWidth: raw.width }).gsdM ?? (process.env.GSD_CM ? Number(process.env.GSD_CM) / 100 : null);
    if (!native) { console.log(`${name}: no pixel size (set GSD_CM)`); continue; }
    // The app decodes to a 4096 px long edge; the bench does the same unless a coarser target is asked for.
    const f = targetCm ? Math.max(1, Math.round(targetCm / 100 / native)) : Math.max(1, Math.ceil(Math.max(raw.width, raw.height) / 4096));
    const px = downsample(raw, f);
    const gsdM = native * f;
    const t0 = Date.now();
    const r = await analysePhoto(px, { gsdM, rowSpacingM: spacing, windowM }, { yieldBetweenWindows: false });
    const s = r.summary;
    const row: Row = {
      photo: name, gsdCm: gsdM * 100, ms: Date.now() - t0, windows: s.windows, usable: s.usableWindows, blocks: s.blocks, squareGrid: s.squareGrid,
      angleDeg: s.medianAngleDeg, pitchCm: s.medianPitchM == null ? null : s.medianPitchM * 100, plantCm: s.plantDiameterM == null ? null : s.plantDiameterM * 100,
      seedCm: s.seedSpacingM == null ? null : s.seedSpacingM * 100, agreement: s.seedAgreement, blobs: s.blobs, onPattern: s.onPattern, offRow: s.offRow,
      betweenPlants: s.betweenPlants, doubles: s.doubles, unplaced: s.unplaced, notes: r.notes,
    };
    rows.push(row);
    console.log([name, row.gsdCm.toFixed(1), row.ms, `${row.usable}/${row.windows}`, row.blocks, row.squareGrid ? "y" : "", fmt(row.angleDeg, 1), fmt(row.pitchCm), fmt(row.plantCm), fmt(row.seedCm), row.agreement == null ? "-" : Math.round(row.agreement * 100) + "%", row.onPattern, row.offRow, row.betweenPlants, row.doubles, row.unplaced].join(" | "));
  }
  const pitches = rows.map(r => r.pitchCm).filter((v): v is number => v != null);
  const medPitch = median(pitches);
  const summary = {
    dir, gsdCm: targetCm, spacing, windowM, photos: rows.length,
    withSeed: rows.filter(r => r.seedCm != null).length,
    medianPitchCm: medPitch, pitchWithin5pct: medPitch == null ? 0 : pitches.filter(p => Math.abs(p - medPitch) / medPitch <= 0.05).length,
    medianAgreement: median(rows.map(r => r.agreement ?? NaN)), medianPlantCm: median(rows.map(r => r.plantCm ?? NaN)),
    medianBlocks: median(rows.map(r => r.blocks)), squareGrid: rows.filter(r => r.squareGrid).length,
    totalOnPattern: rows.reduce((a, r) => a + r.onPattern, 0), totalOffRow: rows.reduce((a, r) => a + r.offRow, 0), totalDoubles: rows.reduce((a, r) => a + r.doubles, 0),
    medianMs: median(rows.map(r => r.ms)),
  };
  console.log("\nsummary: " + JSON.stringify(summary));
  const outDir = join("data", "bench", "pattern");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${basename(dir)}-${targetCm ?? "native"}cm.json`);
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 2));
  console.log("wrote " + out);
})();
