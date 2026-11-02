// Probe: why rows stop in a frame's dim rim. Writes the work-raster green mask (establishment / mid) or the strict
// seedling mask (emergence) of one photograph beside its read's rows, and prints the reader's debug lines.
//   npx vite-node scripts/rowCrop/rimProbe.ts -- --stage establishment --photo 72 --out <dir>
import "../bench/nodeStorageShim";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { GREEN_DEFAULTS, greenMaskWithExcess } from "../../src/lib/directGeoref/green";
import { downsample, readRowCrop, type RowCropStage } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const stage = arg("stage", "establishment")!, photo = arg("photo", "72")!, out = arg("out", "directtestimagery/rim-probe")!;
const FOLDER: Record<string, string> = { emergence: "veryearlystage", establishment: "estabilishmentphase", mid: "midphase", late: "verylatestagecorn" };
const READER: Record<string, RowCropStage> = { emergence: "emergence", establishment: "establishment", mid: "mid", late: "late" };
mkdirSync(out, { recursive: true });
const raw = decodeImage(new Uint8Array(readFileSync(join("directtestimagery", FOLDER[stage], `${photo}.JPG`))));
const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
const lines: string[] = []; 
const read = readRowCrop(px, rowCropParamsFor(cropProfileFor("corn"), null, READER[stage]), { debug: l => lines.push(l) });
writeFileSync(join(out, `${stage}-${photo}-debug.txt`), lines.join("\n"));
const f = read.workFactor, work = downsample(px, f), W = work.W, H = work.H;
const { mask } = greenMaskWithExcess({ width: W, height: H, rgba: work.rgba }, { ...GREEN_DEFAULTS, index: "exgr-soil", soilTilePx: 64, cellPx: 1, soilCapAboveGlobal: 0.05 });
const png = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) { const q = i * 4; const g = (work.rgba[q] + work.rgba[q + 1] + work.rgba[q + 2]) / 3 * 0.5; png.data[q] = mask[i] ? 60 : g; png.data[q + 1] = mask[i] ? 255 : g; png.data[q + 2] = mask[i] ? 60 : g; png.data[q + 3] = 255; }
const dot = (x: number, y: number, c: number[]) => { const X = Math.round(x / f), Y = Math.round(y / f); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = X + dx, yy = Y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const q = (yy * W + xx) * 4; png.data[q] = c[0]; png.data[q + 1] = c[1]; png.data[q + 2] = c[2]; } };
for (const r of read.rows) for (let i = 0; i + 1 < r.points.length; i++) { const [a, b] = r.points[i], [c, d] = r.points[i + 1]; const n = Math.ceil(Math.hypot(c - a, d - b) / f); for (let k = 0; k <= n; k++) dot(a + ((c - a) * k) / n, b + ((d - b) * k) / n, [0, 200, 255]); }
for (const w of read.weeds) dot(w.x, w.y, [255, 0, 0]);
writeFileSync(join(out, `${stage}-${photo}-mask.png`), PNG.sync.write(png));
console.log(JSON.stringify({ rows: read.rows.length, weeds: read.weeds.length, W, H, f, ends: read.fieldEdge?.ends.length }));
