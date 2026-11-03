// The field assessment drawn over a folder of photographs: each cell tinted by its state, a tick along its row
// direction (longer the more coherent), the pitch cluster written in it; one line per photo with the field's
// direction, its pitches and the state shares.
//   npm run bench:assess -- --photos <dir> [--tag assess] [--limit N] [--only 3,21]
// Pictures: <photos>/outputs/assess/<tag>/<photo>.png (a quarter size), the table beside them as <tag>.md.
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage, encodePng } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { assessField, type CropState, type FieldAssessment } from "../../src/lib/rowCrop/assess";
import { DEFAULT_ROW_CROP_PARAMS } from "../../src/lib/rowCrop/readRowCrop";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const PHOTOS = arg("photos", "directtestimagery")!;
const TAG = arg("tag", "assess")!;
const LIMIT = Number(arg("limit", "0"));
const ONLY = (arg("only", "") ?? "").split(",").filter(Boolean);
const OUT = join(PHOTOS, "outputs", "assess");
const SHRINK = 4;

type Rgb = [number, number, number];
const TINT: Record<CropState, Rgb> = { bare: [90, 70, 50], seedlings: [60, 140, 255], rows: [0, 230, 120], canopy: [230, 200, 0], closed: [255, 120, 0], cover: [200, 60, 200], unknown: [160, 160, 160] };

function draw(img: PhotoPixels, a: FieldAssessment, file: string) {
  const w = Math.floor(img.width / SHRINK), h = Math.floor(img.height / SHRINK);
  const c = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((y * SHRINK) * img.width + x * SHRINK) * 4, o = (y * w + x) * 4; c[o] = img.rgba[s] * 0.8; c[o + 1] = img.rgba[s + 1] * 0.8; c[o + 2] = img.rgba[s + 2] * 0.8; c[o + 3] = 255; }
  const px = (x: number, y: number, col: Rgb, mix = 1) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const o = (Math.round(y) * w + Math.round(x)) * 4; c[o] = c[o] * (1 - mix) + col[0] * mix; c[o + 1] = c[o + 1] * (1 - mix) + col[1] * mix; c[o + 2] = c[o + 2] * (1 - mix) + col[2] * mix; };
  const line = (x1: number, y1: number, x2: number, y2: number, col: Rgb, t = 1) => { const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1))); for (let k = 0; k <= n; k++) { const x = x1 + ((x2 - x1) * k) / n, y = y1 + ((y2 - y1) * k) / n; for (let dy = -t; dy <= t; dy++) for (let dx = -t; dx <= t; dx++) px(x + dx, y + dy, col); } };
  for (const cell of a.cells) {
    const x0 = cell.x0 / SHRINK, y0 = cell.y0 / SHRINK, x1 = cell.x1 / SHRINK, y1 = cell.y1 / SHRINK, col = TINT[cell.state];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px(x, y, col, 0.22);
    line(x0, y0, x1, y0, [30, 30, 30], 0); line(x0, y0, x0, y1, [30, 30, 30], 0);
    // The direction tick: through the cell's centre, length by coherence (a full cell at 1), white when aligned with the field.
    if (cell.directionDeg != null) {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, len = ((x1 - x0) / 2) * Math.min(1, cell.coherence / 0.6), ang = (cell.directionDeg * Math.PI) / 180;
      line(cx - len * Math.cos(ang), cy - len * Math.sin(ang), cx + len * Math.cos(ang), cy + len * Math.sin(ang), cell.aligned ? [255, 255, 255] : [255, 60, 60], 1);
      // Pitch cluster: one dot for the main planting, two for the second, at the cell's corner.
      if (cell.cluster != null) for (let d = 0; d <= cell.cluster; d++) { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) px(x0 + 6 + d * 8 + dx, y0 + 6 + dy, [255, 255, 0]); }
    }
  }
  // Region bounding boxes of the readable states, in the state's colour.
  for (const r of a.regions) if (["seedlings", "rows", "canopy", "closed"].includes(r.state)) { const col = TINT[r.state]; line(r.x0 / SHRINK, r.y0 / SHRINK, r.x1 / SHRINK, r.y0 / SHRINK, col, 1); line(r.x1 / SHRINK, r.y0 / SHRINK, r.x1 / SHRINK, r.y1 / SHRINK, col, 1); line(r.x1 / SHRINK, r.y1 / SHRINK, r.x0 / SHRINK, r.y1 / SHRINK, col, 1); line(r.x0 / SHRINK, r.y1 / SHRINK, r.x0 / SHRINK, r.y0 / SHRINK, col, 1); }
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, encodePng({ width: w, height: h, data: c }));
}

async function main() {
  let files = existsSync(PHOTOS) ? readdirSync(PHOTOS).filter(f => /\.(jpe?g|png)$/i.test(f)).sort() : [];
  if (ONLY.length) files = files.filter(f => ONLY.includes(basename(f, extname(f))));
  if (LIMIT) files = files.slice(0, LIMIT);
  if (!files.length) { console.error(`no photos in ${PHOTOS}`); process.exit(1); }
  const lines: string[] = [`# Field assessment: ${TAG}`, "", `Run ${new Date().toISOString().slice(0, 10)}, ${files.length} photos from ${PHOTOS}. Cells a twelfth of the long side, each judged over its 3 x 3 window.`, "", "| Image | Field dir | Pitches (px) | Scale cm/px | bare | seedlings | rows | canopy | closed | cover | unknown | regions (readable) | ms |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const f of files) {
    const raw = decodeImage(new Uint8Array(readFileSync(join(PHOTOS, f))));
    const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
    const dbg: string[] = [];
    const a = assessField(px, DEFAULT_ROW_CROP_PARAMS, { debug: l => dbg.push(l) });
    draw(px, a, join(OUT, TAG, `${basename(f, extname(f))}.png`));
    const share = (s: CropState) => `${Math.round((100 * a.cells.filter(c => c.state === s).length) / a.cells.length)}%`;
    const readable = a.regions.filter(r => ["seedlings", "rows", "canopy", "closed"].includes(r.state)).map(r => `${r.state[0]}${r.cells.length}${r.pitchPx ? `@${r.pitchPx.toFixed(0)}` : ""}`).join(" ");
    const row = `| ${f} | ${a.field ? a.field.directionDeg.toFixed(1) : "-"} | ${a.field ? a.field.clusters.map(p => p.toFixed(0)).join("/") : "-"} | ${a.gsdM ? (a.gsdM * 100).toFixed(2) : "-"} | ${share("bare")} | ${share("seedlings")} | ${share("rows")} | ${share("canopy")} | ${share("closed")} | ${share("cover")} | ${share("unknown")} | ${readable} | ${a.ms} |`;
    lines.push(row);
    console.log(row);
    if (argv.includes("--debug")) for (const l of dbg) console.log("   ", l);
  }
  writeFileSync(join(OUT, `${TAG}.md`), lines.join("\n") + "\n");
}
main().catch(e => { console.error(e); process.exit(1); });
