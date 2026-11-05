// Corn V1's output, the frozen way against the current way, on the same photographs (2026-11-05). The frozen way is
// corn-v1.0's: the green read and the plant read each compute the seedling mask themselves; the current way shares one
// per photograph (seedlingGreen.ts SeedlingCache). Both run in this one process on the same decoded pixels, so any
// difference is the change's. Compares the whole compact read (rows, identities, every judged patch and its verdict,
// gaps, plants located) byte for byte, and the full Corn V1 summary, and times both.
//   npx vite-node scripts/rowCrop/cornV1Equivalence.ts --images <dir> [--gsd-cm 0.17] [--limit N] [--out <file.json>]
import "../bench/nodeStorageShim";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { NODE_DECODER, decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readCornAdaptive } from "../../src/lib/rowCrop/adaptive";
import { fuseCornV1, readCornV1 } from "../../src/lib/rowCrop/cornV1";
import { plantPointsFromGreen } from "../../src/lib/rowCrop/greenPoints";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { compactCornRead } from "../../src/lib/fieldTwin/cornField";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const IMAGES = arg("images")!, GSD = arg("gsd-cm") ? Number(arg("gsd-cm")) / 100 : null, LIMIT = Number(arg("limit", "0")), OUT = arg("out");
let files = readdirSync(IMAGES).filter(f => /\.(jpe?g|png)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (LIMIT) files = files.slice(0, LIMIT);
const P = rowCropParamsFor(cropProfileFor("corn")!, GSD);
const per: { photo: string; plans: string; identical: boolean; summaryIdentical: boolean; frozenMs: number; sharedMs: number }[] = [];
let tf = 0, ts = 0;
for (const f of files) {
  const raw = decodeImage(new Uint8Array(readFileSync(join(IMAGES, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const name = basename(f, extname(f));
  // Alternate the order so neither way always runs on a warm JIT.
  const frozen = () => { const t = Date.now(); const ad = readCornAdaptive(px, P); const pts = plantPointsFromGreen(px).points; const v = fuseCornV1(ad, pts, P, { enteredCrop: "corn", source: "green" }); return { v, ms: Date.now() - t }; };
  const shared = () => { const t = Date.now(); const v = readCornV1(px, P, { enteredCrop: "corn" }); return { v, ms: Date.now() - t }; };
  const [a, b] = per.length % 2 ? [frozen(), shared()] : (() => { const s = shared(); const fz = frozen(); return [fz, s]; })();
  const ca = JSON.stringify(compactCornRead(name, a.v)), cb = JSON.stringify(compactCornRead(name, b.v));
  const sa = JSON.stringify({ ...a.v.summary, ms: null }), sb = JSON.stringify({ ...b.v.summary, ms: null });
  const row = { photo: name, plans: a.v.green.plans.map(p => p.stage).join("+"), identical: ca === cb, summaryIdentical: sa === sb, frozenMs: a.ms, sharedMs: b.ms };
  per.push(row); tf += a.ms; ts += b.ms;
  console.log(`${name}: ${row.plans} | output ${row.identical ? "identical" : "DIFFERENT"}, summary ${row.summaryIdentical ? "identical" : "DIFFERENT"} | ${a.ms} -> ${b.ms} ms`);
}
const out = { images: IMAGES, ...NODE_DECODER, photographs: per.length, identical: per.filter(p => p.identical && p.summaryIdentical).length, frozenMs: tf, sharedMs: ts, speedup: +(tf / Math.max(1, ts)).toFixed(3), per };
console.log(`\n${out.identical} of ${out.photographs} identical; Corn V1 ${tf} -> ${ts} ms (${((1 - ts / tf) * 100).toFixed(1)} % less)`);
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
if (out.identical !== out.photographs) process.exit(1);
