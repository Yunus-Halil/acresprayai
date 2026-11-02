// One photograph through the establishment reader with the field-edge step's per-strip numbers printed: for each row,
// band / left alley / right alley green (%) per half-metre strip, S where the row stands, G where the ground is green,
// x where the strip is half out of the frame; the trace's own strips in brackets. Development only.
//   npx vite-node scripts/rowCrop/edgeProbe.ts -- <photo> [--tail 14]
import "../bench/nodeStorageShim";
import { readFileSync } from "node:fs";
import { decodeImage } from "../bench/images";
import { readRowCrop } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";

const argv = process.argv.slice(2);
const file = argv.find(a => !a.startsWith("--"))!;
const tail = Number(argv[argv.indexOf("--tail") + 1] || 14);
const raw = decodeImage(new Uint8Array(readFileSync(file)));
const px = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
const read = readRowCrop(px, rowCropParamsFor(cropProfileFor("corn")!, null, "establishment"), { debug: l => {
  if (!l.startsWith("edge row")) { if (l.startsWith("edge")) console.log(l); return; }
  const [head, cells] = l.split(": "); const c = cells.split(" ");
  console.log(`${head}: ... ${c.slice(-tail).join(" ")}`);
} });
console.log(`rows ${read.rows.length}, ends ${read.fieldEdge?.ends.length}, gaps ${read.summary.gaps}`);
