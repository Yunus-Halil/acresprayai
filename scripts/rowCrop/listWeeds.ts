// Lists every red (weed-candidate) patch the emergence reader draws, as photo:x,y points for contextProbe (read-only).
//   npx vite-node scripts/rowCrop/listWeeds.ts -- --out <file>
import "../bench/nodeStorageShim";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readRowCrop } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
const argv = process.argv.slice(2), out = argv[argv.indexOf("--out") + 1];
const dir = "directtestimagery/veryearlystage", pts: string[] = [];
for (const f of readdirSync(dir).filter(f => /\.jpg$/i.test(f)).sort((a, b) => parseInt(a) - parseInt(b))) {
  const raw = decodeImage(new Uint8Array(readFileSync(join(dir, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const read = readRowCrop(px, rowCropParamsFor(cropProfileFor("corn"), null, "emergence"));
  for (const w of read.weeds) if (w.tier !== "small green") pts.push(`${basename(f, extname(f))}:${Math.round(w.x)},${Math.round(w.y)}`);
}
writeFileSync(out, pts.join(";"));
console.log(pts.length);
