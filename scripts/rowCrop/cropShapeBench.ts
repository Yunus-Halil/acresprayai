// Crop shape (Corn V1 decision experiment, 2026-11-04): does the outline of the lone plants on a planted row tell a
// grass (corn: a few narrow leaves spread out) from a broadleaf seedling (sugar beet, sunflower, soybean)?
//   npx vite-node scripts/rowCrop/cropShapeBench.ts --images <dir> --out <file.json> [--limit N] [--every K]
// Per photo: plant points from the green (src/lib/rowCrop/greenPoints.ts), rows from them (rowsFromPoints), and for the
// lone plants on those rows: solidity (area over hull) and leaf width over the plant's size. Per row too.
import "../bench/nodeStorageShim";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { plantPointsFromGreen } from "../../src/lib/rowCrop/greenPoints";
import { rowsFromPoints } from "../../src/lib/rowCrop/plantRows";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const IMAGES = arg("images")!, OUT = arg("out")!, LIMIT = Number(arg("limit", "0")), EVERY = Number(arg("every", "1"));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
let files = readdirSync(IMAGES).filter(f => /\.(jpe?g|png)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).filter((_, i) => i % EVERY === 0);
if (LIMIT) files = files.slice(0, LIMIT);
const per: unknown[] = [];
for (const f of files) {
  const raw = decodeImage(new Uint8Array(readFileSync(join(IMAGES, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const t = Date.now();
  const g = plantPointsFromGreen(px);
  const B = rowsFromPoints(g.points);
  const rows = B.rows.map(r => {
    const sh = r.members.map(i => g.points[i].shape).filter((s): s is NonNullable<typeof s> => !!s);
    return { plants: r.members.length, shaped: sh.length, solidity: median(sh.map(s => s.solidity)), elong: median(sh.map(s => s.widthPx / Math.sqrt(s.areaPx))), widthPx: median(sh.map(s => s.widthPx)), areaPx: median(sh.map(s => s.areaPx)), y: median(r.points.map(p => p[1])), x: median(r.points.map(p => p[0])) };
  });
  const all = B.rows.flatMap(r => r.members.map(i => g.points[i].shape)).filter((s): s is NonNullable<typeof s> => !!s);
  const rec = { image: basename(f, extname(f)), points: g.points.length, rows: B.rows.length, shaped: all.length, solidity: median(all.map(s => s.solidity)), elong: median(all.map(s => s.widthPx / Math.sqrt(s.areaPx))), widthPx: median(all.map(s => s.widthPx)), areaPx: median(all.map(s => s.areaPx)), typicalPx: g.typicalPx, ms: Date.now() - t, perRow: rows };
  per.push(rec);
  console.log(`${rec.image}: rows ${rec.rows}, shaped ${rec.shaped}, solidity ${rec.solidity?.toFixed(3)}, elong ${rec.elong?.toFixed(3)}, width ${rec.widthPx?.toFixed(1)} px, area ${rec.areaPx}, ${rec.ms} ms`);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ images: IMAGES, per }, null, 1));
