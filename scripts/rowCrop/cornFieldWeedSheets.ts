// Every field weed of a corn flight with every covering photograph's crop around it, for judging by eye (2026-11-05).
// Reads each photograph with Corn V1 (Node, jpeg-js), combines them with cornField, and for every field weed that any
// photograph called a weed candidate writes one contact sheet: red border = that photograph voted weed, amber = it saw
// the patch and judged it otherwise, grey = it covers the spot and reported nothing. The ring is where the cameras put
// the weed. Also lists which weeds the old field rule (corn-v1.0: a third of the covering photographs must have seen
// it) would have withheld, so a rule change can be checked on any flight, not only the one it was found on.
//   npx vite-node scripts/rowCrop/cornFieldWeedSheets.ts --dir <flight folder> --out <dir> [--reads <reads.json>]
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NODE_DECODER, decodeImage, encodeJpeg } from "../bench/images";
import { nodePhoto } from "../directGeoref/nodePhotos";
import { readPhotographs } from "../../src/lib/fieldTwin/build/photos";
import { alignCameras } from "../../src/lib/fieldTwin/build/cameras";
import { cornPhotoRead } from "../../src/lib/fieldTwin/build/corn";
import { cornField, type CornPhotoRead } from "../../src/lib/fieldTwin/cornField";
import { groundSampleAt, groundToPixel } from "../../src/lib/directGeoref/projection";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = resolve(arg("dir")!), OUT = resolve(arg("out")!), READS = arg("reads") ?? join(OUT, "reads.json");
mkdirSync(OUT, { recursive: true });
const files = readdirSync(DIR).filter(f => /\.jpe?g$/i.test(f)).sort();
const { reads: pr } = await readPhotographs(files.map(f => nodePhoto(join(DIR, f))), 4, {}, true);
const cams = await alignCameras(pr, {}, 40, 0, null);
const decode = (f: string): PhotoPixels => { const r = decodeImage(new Uint8Array(readFileSync(join(DIR, f)))); return { width: r.width, height: r.height, rgba: new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.byteLength) }; };

let reads: Record<string, CornPhotoRead>;
if (existsSync(READS)) reads = JSON.parse(readFileSync(READS, "utf8")).reads;
else {
  reads = {};
  for (const f of files) {
    const name = f.replace(/\.[^.]+$/, ""), fr = cams.frames.get(name);
    if (!fr) continue;
    reads[name] = cornPhotoRead(name, decode(f), groundSampleAt(fr, fr.intrinsics.cx, fr.intrinsics.cy));
    process.stdout.write(`${name} `);
  }
  writeFileSync(READS, JSON.stringify({ dir: DIR, ...NODE_DECODER, reads }));
  console.log();
}
const field = cornField(Object.values(reads), cams.frames);
const weeds = field.weeds.filter(w => w.votes["weed candidate"] > 0);
const OLD_SEEN_SHARE = 0.34;
const C = 200;
type Tile = { weed: number; photo: string; u: number; v: number; vote: string | null };
const tiles: Tile[] = [];
const rows: string[] = [];
for (const w of weeds) {
  for (const [name, f] of cams.frames) {
    const alt = f.ground.kind === "flat" ? f.ground.altM : f.ground.altAt(w.lat, w.lng);
    const h = groundToPixel(f, w.lat, w.lng, alt);
    if (!h || h.u < 0 || h.v < 0 || h.u >= f.intrinsics.width || h.v >= f.intrinsics.height) continue;
    tiles.push({ weed: w.id, photo: name, u: h.u, v: h.v, vote: w.sightings.find(x => x.photo === name)?.verdict ?? null });
  }
  const oldVerdict = w.verdict === "weed candidate" && w.seenBy < OLD_SEEN_SHARE * w.coveredBy ? "unknown vegetation" : w.verdict;
  const line = `weed ${w.id}: ${w.verdict}${oldVerdict !== w.verdict ? ` (old rule: ${oldVerdict})` : ""}; votes ${JSON.stringify(w.votes)}; seen ${w.seenBy} of ${w.coveredBy} covering; ${(w.areaM2 * 1e4).toFixed(1)} cm2`;
  rows.push(line); console.log(line);
}
const crops = new Map<Tile, Uint8Array>();
for (const f of files) {
  const name = f.replace(/\.[^.]+$/, ""), mine = tiles.filter(t => t.photo === name);
  if (!mine.length) continue;
  const img = decode(f);
  for (const t of mine) {
    const out = new Uint8Array(C * C * 4), x0 = Math.round(t.u - C / 2), y0 = Math.round(t.v - C / 2);
    const col = t.vote === "weed candidate" ? [230, 40, 40] : t.vote ? [240, 170, 0] : [120, 120, 120];
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const sx = x0 + x, sy = y0 + y, o = (y * C + x) * 4;
      if (x < 5 || y < 5 || x >= C - 5 || y >= C - 5) { out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; }
      else if (Math.abs(Math.hypot(x - C / 2, y - C / 2) - 40) < 1.2) { out[o] = 255; out[o + 1] = 255; out[o + 2] = 255; }
      else if (sx >= 0 && sy >= 0 && sx < img.width && sy < img.height) { const q = (sy * img.width + sx) * 4; out[o] = img.rgba[q]; out[o + 1] = img.rgba[q + 1]; out[o + 2] = img.rgba[q + 2]; }
      out[o + 3] = 255;
    }
    crops.set(t, out);
  }
}
for (const w of weeds) {
  const mine = tiles.filter(t => t.weed === w.id).sort((a, b) => (a.vote ? 0 : 1) - (b.vote ? 0 : 1)).slice(0, 24);
  const cols = 8, nr = Math.ceil(mine.length / cols), W = cols * C, H = Math.max(1, nr) * C, rgba = new Uint8Array(W * H * 4);
  mine.forEach((t, k) => { const c = crops.get(t)!; const ox = (k % cols) * C, oy = Math.floor(k / cols) * C; for (let y = 0; y < C; y++) rgba.set(c.subarray(y * C * 4, (y + 1) * C * 4), ((oy + y) * W + ox) * 4); });
  writeFileSync(join(OUT, `weed-${w.id}.jpg`), encodeJpeg({ width: W, height: H, data: rgba }, 85));
}
writeFileSync(join(OUT, "weeds.txt"), [`${DIR}`, `${NODE_DECODER.decoder}, ${NODE_DECODER.environment}`, `field: ${JSON.stringify({ ...field.summary, ms: undefined })}`, ...rows, ""].join("\n"));
console.log(`field: ${JSON.stringify({ ...field.summary, ms: undefined })}`);
