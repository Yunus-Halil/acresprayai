// Development only: the row spacing in pixels the green read holds for ONE photograph (cornV1.ts greenPitchPx), the
// number the vivid cores' blurs are shares of (CORN_CORES). Prints it; nothing is written.
//
//   npx vite-node scripts/rowCrop/cornPitchOf.ts -- <photograph> [long side to draw it down to]
import "../bench/nodeStorageShim";
import { readFileSync } from "node:fs";
import { decodeImage } from "../bench/images";
import { CORN_CORES, greenPitchPx, readCornV1 } from "../../src/lib/rowCrop/cornV1";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";

const [file, side] = process.argv.slice(2).filter(a => a !== "--");
const img = decodeImage(new Uint8Array(readFileSync(file)));
let px = { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
if (side) {
  // Drawn down by a box average, as cornLabelScore.ts --single draws a photograph down for Photo Scout's read.
  const k = Math.min(1, Number(side) / Math.max(px.width, px.height)), sw = Math.max(1, Math.round(px.width * k)), sh = Math.max(1, Math.round(px.height * k)), small = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const x0 = Math.floor(x / k), x1 = Math.max(x0 + 1, Math.min(px.width, Math.floor((x + 1) / k))), y0 = Math.floor(y / k), y1 = Math.max(y0 + 1, Math.min(px.height, Math.floor((y + 1) / k)));
    let r = 0, g = 0, b = 0, n = 0; for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const q = (yy * px.width + xx) * 4; r += px.rgba[q]; g += px.rgba[q + 1]; b += px.rgba[q + 2]; n++; }
    const o = (y * sw + x) * 4; small[o] = r / n; small[o + 1] = g / n; small[o + 2] = b / n; small[o + 3] = 255;
  }
  px = { width: sw, height: sh, rgba: small };
}
const v = readCornV1(px, rowCropParamsFor(cropProfileFor("corn")!, null), { enteredCrop: "corn", cores: false });
const p = greenPitchPx(v.green);
console.log(`${px.width} x ${px.height}: row spacing ${p == null ? "none" : `${p.toFixed(2)} px`}; plans ${v.green.plans.map(q => `${q.stage} ${(q.ownedShare * 100).toFixed(1)} % (${q.pitchPx?.toFixed(1)} px)`).join(", ")}; the blurs would be ${p ? `${(CORN_CORES.fineShare * p).toFixed(2)} px and ${(CORN_CORES.wideShare * p).toFixed(2)} px` : "not made"}.`);
