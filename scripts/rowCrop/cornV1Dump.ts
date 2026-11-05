// Every photograph's Corn V1 compact read (rows, identities, every judged patch and its verdict, gaps, plants located)
// and summary to one JSON file, with the decoder and environment, so two code trees can be compared byte for byte on
// the same photographs (2026-11-05).
//   npx vite-node scripts/rowCrop/cornV1Dump.ts --images <dir> --out <file.json> [--gsd-cm 0.17] [--limit N]
import "../bench/nodeStorageShim";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import * as images from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readCornV1 } from "../../src/lib/rowCrop/cornV1";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { compactCornRead } from "../../src/lib/fieldTwin/cornField";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const IMAGES = arg("images")!, OUT = arg("out")!, GSD = arg("gsd-cm") ? Number(arg("gsd-cm")) / 100 : null, LIMIT = Number(arg("limit", "0"));
let files = readdirSync(IMAGES).filter(f => /\.(jpe?g|png)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (LIMIT) files = files.slice(0, LIMIT);
const P = rowCropParamsFor(cropProfileFor("corn")!, GSD);
const reads: Record<string, { compact: unknown; summary: unknown; ms: number }> = {};
for (const f of files) {
  const raw = images.decodeImage(new Uint8Array(readFileSync(join(IMAGES, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const t = Date.now(), v = readCornV1(px, P, { enteredCrop: "corn" }), ms = Date.now() - t, name = basename(f, extname(f));
  reads[name] = { compact: compactCornRead(name, v), summary: { ...v.summary, ms: null }, ms };
  console.log(`${name}: ${ms} ms`);
}
const env = (images as Record<string, unknown>).NODE_DECODER ?? { environment: `Node ${process.version}` };
writeFileSync(OUT, JSON.stringify({ images: IMAGES, ...env, reads }));
