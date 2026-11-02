// One photograph through the emergence reader with its diagnostic lines printed (direction, lens, plantings, rows).
// Development only.   npx vite-node scripts/rowCrop/emergenceProbe.ts -- <photo> [--grep text]
import "../bench/nodeStorageShim";
import { readFileSync } from "node:fs";
import { decodeImage } from "../bench/images";
import { readRowCrop } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";

const argv = process.argv.slice(2);
const file = argv.find(a => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--grep")!;
const gi = argv.indexOf("--grep"), grep = gi >= 0 ? argv[gi + 1] : "";
const raw = decodeImage(new Uint8Array(readFileSync(file)));
const px = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
const read = readRowCrop(px, rowCropParamsFor(cropProfileFor("corn")!, null, "emergence"), { debug: l => { if (!grep || l.includes(grep)) console.log(l); } });
console.log(`rows ${read.rows.length}, plants ${read.summary.plants}, gaps ${read.summary.gaps}, weeds ${read.weeds.length}, ${read.summary.ms} ms`, JSON.stringify(read.emergence));
for (const n of read.notes) console.log(`note: ${n}`);
