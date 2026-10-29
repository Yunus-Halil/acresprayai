// The row-crop reader scored against USU-Corn-WeedDB's weed boxes (CC BY 4.0; Utah forage corn, 10 m, 0.48 cm a
// pixel, 27 June 2025), on the sources stitched back from their tiles by usu_mosaic.py.
//   npm run bench:row-crop:usu -- [--mosaics D:/swardus-research/datasets/usu-corn-weeddb/mosaics] [--min-tiles 20]
//       [--stage establishment|mid] [--tag usu]
// A labelled box is found when a reader weed's centroid lies inside it (grown by 10 px) or the box's centre lies
// inside a reader weed's outline. A reader weed is supported when its centroid lies inside a box. The boxes are
// per tile and exhaustive within the tile as far as the authors labelled, so recall is meaningful; a reader weed
// outside every box may still be a weed the labellers passed over (the paper labels three species only).
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { decodeImage, encodePng } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readRowCrop, rowCropOverlay, type RowCropRead, type RowCropStage } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import type { RuntimeCropProfile } from "../../src/lib/cropProfiles/runtime";
import { runtimePath } from "../cropProfiles/fsProfiles";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const MOSAICS = arg("mosaics", "D:/swardus-research/datasets/usu-corn-weeddb/mosaics")!;
const MIN_TILES = Number(arg("min-tiles", "20"));
const STAGE = arg("stage", "establishment") as RowCropStage;
const TAG = arg("tag", `usu-${STAGE}`)!;
const OUT = join(MOSAICS, "outputs", TAG);
const profile = JSON.parse(readFileSync(runtimePath("corn"), "utf8")) as RuntimeCropProfile;

type Box = { cls: string; x: number; y: number; w: number; h: number };
type Meta = { source: string; width: number; height: number; tiles: number; gsdCm: number; boxes: Box[] };

type Rgb = [number, number, number];
function line(c: Uint8Array, w: number, h: number, x1: number, y1: number, x2: number, y2: number, col: Rgb, t = 1) {
  const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  for (let k = 0; k <= n; k++) { const x = x1 + ((x2 - x1) * k) / n, y = y1 + ((y2 - y1) * k) / n; for (let dy = -t; dy <= t; dy++) for (let dx = -t; dx <= t; dx++) { const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const o = (yy * w + xx) * 4; c[o] = col[0]; c[o + 1] = col[1]; c[o + 2] = col[2]; } }
}
function poly(c: Uint8Array, w: number, h: number, pts: [number, number][], col: Rgb, t: number, closed: boolean) {
  for (let i = 0; i + 1 < pts.length; i++) line(c, w, h, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], col, t);
  if (closed && pts.length > 2) line(c, w, h, pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], col, t);
}
const inHull = (hull: [number, number][], x: number, y: number): boolean => { let inside = false; for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) { const [xi, yi] = hull[i], [xj, yj] = hull[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; };

const files = existsSync(MOSAICS) ? readdirSync(MOSAICS).filter(f => f.endsWith(".json") && f !== "index.json").sort() : [];
if (!files.length) { console.error(`no mosaics in ${MOSAICS}`); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const rows: Record<string, unknown>[] = [];
let tBoxes = 0, tFound = 0, tWeeds = 0, tSupported = 0;
const byClass: Record<string, [number, number]> = {};
for (const f of files) {
  const meta = JSON.parse(readFileSync(join(MOSAICS, f), "utf8")) as Meta;
  if (meta.tiles < MIN_TILES) continue;
  const name = basename(f, ".json");
  const raw = decodeImage(new Uint8Array(readFileSync(join(MOSAICS, `${name}.jpg`))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const read: RowCropRead = readRowCrop(px, { ...rowCropParamsFor(profile, meta.gsdCm / 100), stage: STAGE });
  const grow = 10;
  let found = 0;
  const foundFlags = meta.boxes.map(b => {
    const hit = read.weeds.some(w => (w.x >= b.x - b.w / 2 - grow && w.x <= b.x + b.w / 2 + grow && w.y >= b.y - b.h / 2 - grow && w.y <= b.y + b.h / 2 + grow) || inHull(w.hull, b.x, b.y));
    if (hit) found++;
    const c = (byClass[b.cls] ??= [0, 0]); c[0]++; if (hit) c[1]++;
    return hit;
  });
  const supported = read.weeds.filter(w => meta.boxes.some(b => w.x >= b.x - b.w / 2 - grow && w.x <= b.x + b.w / 2 + grow && w.y >= b.y - b.h / 2 - grow && w.y <= b.y + b.h / 2 + grow)).length;
  tBoxes += meta.boxes.length; tFound += found; tWeeds += read.weeds.length; tSupported += supported;
  // Picture: boxes yellow (found) or magenta (missed), reader rows cyan, reader weeds red, bands faint.
  const c = new Uint8Array(px.width * px.height * 4);
  for (let i = 0; i < px.width * px.height; i++) { c[i * 4] = px.rgba[i * 4] * 0.85; c[i * 4 + 1] = px.rgba[i * 4 + 1] * 0.85; c[i * 4 + 2] = px.rgba[i * 4 + 2] * 0.85; c[i * 4 + 3] = 255; }
  const o = rowCropOverlay(read);
  for (const b of o.bands) poly(c, px.width, px.height, b, [120, 200, 255], 0, false);
  for (const r of o.rows) poly(c, px.width, px.height, r, [0, 230, 255], 1, false);
  for (const wd of o.weeds) poly(c, px.width, px.height, wd, [255, 40, 40], 1, true);
  meta.boxes.forEach((b, i) => { const col: Rgb = foundFlags[i] ? [255, 255, 0] : [255, 0, 255]; const x0 = b.x - b.w / 2, y0 = b.y - b.h / 2, x1 = b.x + b.w / 2, y1 = b.y + b.h / 2; poly(c, px.width, px.height, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], col, 1, true); });
  writeFileSync(join(OUT, `${name}.png`), encodePng({ width: px.width, height: px.height, data: c }));
  const s = read.summary;
  rows.push({ image: name, tiles: meta.tiles, boxes: meta.boxes.length, found, recall: meta.boxes.length ? +(found / meta.boxes.length).toFixed(3) : null, readerWeeds: read.weeds.length, supported, supportedShare: read.weeds.length ? +(supported / read.weeds.length).toFixed(3) : null, rowsTraced: s.rows, pitchCm: read.pitchM == null ? null : +(read.pitchM * 100).toFixed(1), bandCm: s.medianBandHalfWidthM == null ? null : Math.round(s.medianBandHalfWidthM * 100), coherence: s.coherence, vegetation: s.vegetationFraction, ms: s.ms, notes: read.notes });
  console.log(`${name}: boxes ${meta.boxes.length} found ${found} (${meta.boxes.length ? Math.round((100 * found) / meta.boxes.length) : 0}%), reader weeds ${read.weeds.length} supported ${supported}, rows ${s.rows}, pitch ${read.pitchM == null ? "-" : (read.pitchM * 100).toFixed(1)} cm, band ${s.medianBandHalfWidthM == null ? "-" : Math.round(s.medianBandHalfWidthM * 100)} cm, veg ${s.vegetationFraction}, ${s.ms} ms`);
}
const today = new Date().toISOString().slice(0, 10);
const summary = { sources: rows.length, boxes: tBoxes, found: tFound, recall: tBoxes ? +(tFound / tBoxes).toFixed(3) : null, readerWeeds: tWeeds, supported: tSupported, supportedShare: tWeeds ? +(tSupported / tWeeds).toFixed(3) : null, byClass: Object.fromEntries(Object.entries(byClass).map(([k, [n, h]]) => [k, { boxes: n, found: h, recall: +(h / n).toFixed(3) }])) };
console.log(JSON.stringify(summary));
const fmt = (v: unknown) => (v == null ? "-" : String(v));
const md = [`# Row-crop reader (${STAGE}) against USU-Corn-WeedDB boxes`, "", `Run ${today}. ${rows.length} stitched sources with at least ${MIN_TILES} tiles, 0.48 cm a pixel, corn profile ${profile.version}. A box is found when a reader weed's centroid lies inside it (grown by 10 px) or its centre lies inside a reader outline; a reader weed is supported when its centroid lies inside a box. Recall ${fmt(summary.recall)} over ${tBoxes} boxes (${Object.entries(summary.byClass).map(([k, v]) => `${k} ${v.recall} of ${v.boxes}`).join(", ")}); ${tWeeds} reader weeds, ${fmt(summary.supportedShare)} supported by a box. Pictures in ${OUT}: found boxes yellow, missed magenta, reader weeds red, rows cyan.`, "",
  "| Source | Tiles | Boxes | Found | Recall | Reader weeds | Supported | Rows | Pitch (cm) | Band (cm) | Coherence | Vegetation | ms |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map(r => `| ${r.image} | ${r.tiles} | ${r.boxes} | ${r.found} | ${fmt(r.recall)} | ${r.readerWeeds} | ${r.supported} | ${r.rowsTraced} | ${fmt(r.pitchCm)} | ${fmt(r.bandCm)} | ${fmt(r.coherence)} | ${fmt(r.vegetation)} | ${r.ms} |`), ""].join("\n");
writeFileSync(join(MOSAICS, "outputs", `${TAG}.json`), JSON.stringify({ tag: TAG, stage: STAGE, date: today, summary, rows }, null, 1) + "\n");
writeFileSync(join(MOSAICS, "outputs", `${TAG}.md`), md);
console.log(`wrote ${join(MOSAICS, "outputs", TAG)}.json and .md`);
