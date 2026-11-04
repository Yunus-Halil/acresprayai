// Classical plant points (Corn V1 decision experiment, 2026-11-04): can plant positions taken from the green itself,
// with no model, stand in for MaSC's boxes in the row builder? Writes MaSC-format files (<stem>.f3.json, boxes
// [x1,y1,x2,y2,conf]) so plantRowBench.ts reads them unchanged:
//   npx vite-node scripts/rowCrop/greenPoints.ts --images <dir> --out <dir> [--limit N]
// Points: the seedling mask (green against the soil beside it, src/lib/rowCrop/seedlingGreen.ts) at a working size,
// 8-connected pieces; a piece up to 4 typical plants is one point at its centre, a larger piece (plants touching along
// a row, a canopy) is cut into squares two typical plants across, one point per square with enough green.
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { plantPointsFromGreen } from "../../src/lib/rowCrop/greenPoints";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const IMAGES = arg("images")!, OUT = arg("out")!, LIMIT = Number(arg("limit", "0"));
mkdirSync(OUT, { recursive: true });
let files = readdirSync(IMAGES).filter(f => /\.(jpe?g|png)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (LIMIT) files = files.slice(0, LIMIT);
for (const f of files) {
  const stem = basename(f, extname(f)), out = join(OUT, `${stem}.f3.json`);
  if (existsSync(out)) continue;
  const raw = decodeImage(new Uint8Array(readFileSync(join(IMAGES, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const t = Date.now();
  const r = plantPointsFromGreen(px);
  const ms = Date.now() - t, h = Math.max(2, r.typicalPx / 2);
  writeFileSync(out, JSON.stringify({ width: px.width, height: px.height, ms, typicalPx: r.typicalPx, boxes: r.points.map(p => [p.x - h, p.y - h, p.x + h, p.y + h, 1]) }));
  console.log(`${stem}: ${r.points.length} points, typical ${r.typicalPx.toFixed(1)} px, ${ms} ms`);
}
