// Contact sheet of a photo's mid-stage escapes (and a few small weeds), cut from the reader's own picture.
//   npx vite-node scripts/rowCrop/escapeSheet.ts <photo> <reader picture png> <out jpg>
import "../bench/nodeStorageShim";
import { readFileSync, writeFileSync } from "node:fs";
import { decodeImage, encodeJpeg } from "../bench/images";
import { readRowCrop } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
const [photo, pic, out] = process.argv.slice(2);
const raw = decodeImage(new Uint8Array(readFileSync(photo)));
const px = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
const read = readRowCrop(px, rowCropParamsFor(cropProfileFor("corn"), null, "mid"));
const img = decodeImage(new Uint8Array(readFileSync(pic)));
const esc = read.weeds.filter(w => w.sizeClass === "escape").slice(0, 12);
const small = read.weeds.filter(w => w.sizeClass === "small").slice(0, 6);
const cells = [...esc, ...small], C = 300, cols = 6, rows = Math.ceil(cells.length / cols);
const data = new Uint8Array(cols * C * rows * C * 4);
cells.forEach((w, k) => {
  const ox = (k % cols) * C, oy = Math.floor(k / cols) * C;
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
    const sx = Math.round(w.x - C / 2 + x), sy = Math.round(w.y - C / 2 + y), d = ((oy + y) * cols * C + ox + x) * 4;
    if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
    const s = (sy * img.width + sx) * 4; data[d] = img.data[s]; data[d + 1] = img.data[s + 1]; data[d + 2] = img.data[s + 2]; data[d + 3] = 255;
  }
});
writeFileSync(out, encodeJpeg({ width: cols * C, height: rows * C, data }, 88));
console.log(`escapes ${esc.length} (first row and a half), small ${small.length} (last); diameters cm:`, esc.map(w => Math.round(w.equivDiameterM * 100)).join(","));
