// The continuous-row reader over a folder of photographs, drawn and tabulated.
//   npm run bench:row-crop -- --photos directtestimagery [--crop corn] [--tag directtest] [--gsd-cm 0.5] [--out dir] [--stage establishment|mid]
// Without --gsd-cm the photos' scale is assumed from the measured pitch and the profile's default spacing (no EXIF
// on the test photos). Pictures: <photos>/outputs/row-crop/<tag>/<photo>.png; results beside them as <tag>.json/.md.
import "../bench/nodeStorageShim";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage, encodePng } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readRowCrop, rowCropOverlay, type RowCropRead, type RowCropStage } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import type { RuntimeCropProfile } from "../../src/lib/cropProfiles/runtime";
import { runtimePath } from "../cropProfiles/fsProfiles";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const PHOTOS = arg("photos", "directtestimagery")!;
const CROP = arg("crop", "corn")!;
const TAG = arg("tag", basename(PHOTOS))!;
const GSD = arg("gsd-cm") ? Number(arg("gsd-cm")) / 100 : null;
const STAGE = arg("stage", "establishment") as RowCropStage;
// Pictures go beside the photos (<photos>/outputs/row-crop/) so the person who gave them finds them; tables too.
const OUT = arg("out", join(PHOTOS, "outputs", "row-crop"))!;
const profile = JSON.parse(readFileSync(runtimePath(CROP), "utf8")) as RuntimeCropProfile;
const revision = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();

type Rgb = [number, number, number];
function line(c: Uint8Array, w: number, h: number, x1: number, y1: number, x2: number, y2: number, col: Rgb, t = 1) {
  const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  for (let k = 0; k <= n; k++) { const x = x1 + ((x2 - x1) * k) / n, y = y1 + ((y2 - y1) * k) / n; for (let dy = -t; dy <= t; dy++) for (let dx = -t; dx <= t; dx++) { const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const o = (yy * w + xx) * 4; c[o] = col[0]; c[o + 1] = col[1]; c[o + 2] = col[2]; } }
}
function poly(c: Uint8Array, w: number, h: number, pts: [number, number][], col: Rgb, t: number, closed: boolean) {
  for (let i = 0; i + 1 < pts.length; i++) line(c, w, h, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], col, t);
  if (closed && pts.length > 2) line(c, w, h, pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], col, t);
}
function draw(img: PhotoPixels, read: RowCropRead, file: string) {
  const { width: w, height: h } = img;
  const c = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { c[i * 4] = img.rgba[i * 4] * 0.85; c[i * 4 + 1] = img.rgba[i * 4 + 1] * 0.85; c[i * 4 + 2] = img.rgba[i * 4 + 2] * 0.85; c[i * 4 + 3] = 255; }
  const o = rowCropOverlay(read), t = Math.max(1, Math.round(w / 1800));
  for (const b of o.bands) poly(c, w, h, b, [120, 200, 255], 0, false);
  for (const r of o.rows) poly(c, w, h, r, [0, 230, 255], t, false);
  for (const g of o.gaps) line(c, w, h, g.x1, g.y1, g.x2, g.y2, [255, 160, 0], t + 1);
  for (const e of o.excluded) poly(c, w, h, e, [160, 160, 160], t, true);
  for (const [x, y] of o.seedlings) for (let dy = -t - 1; dy <= t + 1; dy++) for (let dx = -t - 1; dx <= t + 1; dx++) { const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = (yy * w + xx) * 4; c[q] = 255; c[q + 1] = 190; c[q + 2] = 0; }
  for (const wd of o.weeds) poly(c, w, h, wd, [255, 40, 40], t, true);
  for (const wd of o.escapes) poly(c, w, h, wd, [255, 0, 200], t + 2, true);
  for (const [x, y] of o.plants) line(c, w, h, x, y, x, y, [60, 255, 90], t);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, encodePng({ width: w, height: h, data: c }));
}

async function main() {
  const files = existsSync(PHOTOS) ? readdirSync(PHOTOS).filter(f => /\.(jpe?g|png)$/i.test(f)).sort() : [];
  if (!files.length) { console.error(`no photos in ${PHOTOS}`); process.exit(1); }
  const rows: Record<string, unknown>[] = [];
  for (const f of files) {
    const raw = decodeImage(new Uint8Array(readFileSync(join(PHOTOS, f))));
    const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
    const dbg: string[] = [];
    const read = readRowCrop(px, rowCropParamsFor(profile, GSD, STAGE), { debug: l => dbg.push(l) });
    if (argv.includes("--debug")) for (const l of dbg) console.log("   ", l);
    draw(px, read, join(OUT, TAG, `${basename(f, extname(f))}.png`));
    const s = read.summary;
    rows.push({ seedlings: read.seedlings ? { count: read.seedlings.count, cover: read.seedlings.cover } : null, escapes: s.escapes ?? null, image: f, gsdCm: Math.round(read.gsdM * 1e4) / 100, scaleBasis: read.scaleBasis, directionDeg: read.directionDeg, pitchCm: read.pitchM == null ? null : Math.round(read.pitchM * 1000) / 10, matchedSpacingCm: read.matchedSpacingM == null ? null : Math.round(read.matchedSpacingM * 100), rows: s.rows, rowsDropped: s.rowsDropped, rowLengthM: s.totalRowLengthM, bandCm: s.medianBandHalfWidthM == null ? null : Math.round(s.medianBandHalfWidthM * 100), rowGreenShare: s.medianRowGreenShare, coherence: s.coherence, weeds: s.weeds, weedAreaM2: s.weedAreaM2, betweenRowCover: s.betweenRowCover, cropComponents: s.cropComponents, excluded: read.excluded.length, gaps: s.gaps, gapLengthM: s.gapLengthM, plants: s.plants, vegetation: s.vegetationFraction, ms: s.ms, notes: read.notes });
    process.stdout.write(`${f}: rows ${s.rows} (${s.rowsDropped} dropped), pitch ${read.pitchM == null ? "-" : (read.pitchM * 100).toFixed(1)} cm, band ${s.medianBandHalfWidthM == null ? "-" : (s.medianBandHalfWidthM * 100).toFixed(0)} cm, weeds ${s.weeds}${read.seedlings ? ` (escapes ${s.escapes}), seedlings ${read.seedlings.count} cover ${read.seedlings.cover}` : ""}, crop comps ${s.cropComponents}, gaps ${s.gaps}, plants ${s.plants ?? "-"}, coh ${s.coherence ?? "-"}, ${s.ms} ms\n`);
  }
  const today = new Date().toISOString().slice(0, 10);
  const fmt = (v: unknown) => (v == null ? "-" : String(v));
  const md = [`# Continuous-row reader (${STAGE} stage): ${TAG} (${CROP} profile ${profile.version})`, "", `Run ${today}, code ${revision}. ${files.length} photos from ${PHOTOS}. ${GSD ? `Pixel size given: ${GSD * 100} cm.` : "No pixel size: the scale is assumed from the measured pitch and the profile's default spacing, so every metre rests on that."} Rows are traced on the green (no brightness), the whole row is the crop, weeds are green patches clear of every row's band. The stand is an unverified estimate.`, "",
    "| Image | Pitch (cm) | Rows | Dropped | Band ± (cm) | Row green | Coherence | Weeds | Weed m² | Between-row cover | Crop comps | Excluded | Gaps | Gap m | Plants | ms |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map(r => `| ${String(r.image).slice(0, 16)} | ${fmt(r.pitchCm)} | ${fmt(r.rows)} | ${fmt(r.rowsDropped)} | ${fmt(r.bandCm)} | ${fmt(r.rowGreenShare)} | ${fmt(r.coherence)} | ${fmt(r.weeds)} | ${fmt(r.weedAreaM2)} | ${fmt(r.betweenRowCover)} | ${fmt(r.cropComponents)} | ${fmt(r.excluded)} | ${fmt(r.gaps)} | ${fmt(r.gapLengthM)} | ${fmt(r.plants)} | ${fmt(r.ms)} |`), ""].join("\n");
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${TAG}.json`), JSON.stringify({ tag: TAG, stage: STAGE, crop: CROP, profileVersion: profile.version, photos: PHOTOS, date: today, codeRevision: revision, gsdM: GSD, rows }, null, 1) + "\n");
  writeFileSync(join(OUT, `${TAG}.md`), md);
  console.log(`wrote ${join(OUT, TAG)}.json and .md, pictures in ${join(OUT, TAG)}/`);
}
main().catch(e => { console.error(e); process.exit(1); });
