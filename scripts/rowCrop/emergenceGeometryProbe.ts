// The emergence reader on one photo with and without the assessment's geometry handed to it.
//   vite-node scripts/rowCrop/emergenceGeometryProbe.ts -- <photo>
import "../bench/nodeStorageShim";
import { readFileSync } from "node:fs";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { assessField } from "../../src/lib/rowCrop/assess";
import { readRowCrop, DEFAULT_ROW_CROP_PARAMS } from "../../src/lib/rowCrop/readRowCrop";
const file = process.argv.slice(2).filter(a => !a.startsWith("--"))[0];
const raw = decodeImage(new Uint8Array(readFileSync(file)));
const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
const a = assessField(px, DEFAULT_ROW_CROP_PARAMS);
console.log("assessment", a.field, "gsd", a.gsdM);
for (const variant of ["plain", "scale only", "geometry", "geometry + scale"] as const) {
  const dbg: string[] = [];
  const P = { ...DEFAULT_ROW_CROP_PARAMS, stage: "emergence" as const, gsdM: variant.includes("scale") ? a.gsdM : null, geometry: variant.includes("geometry") && a.field ? { directionDeg: a.field.directionDeg, pitchPx: a.field.pitchPx } : null };
  const r = readRowCrop(px, P, { debug: l => dbg.push(l) });
  console.log(`${variant}: rows ${r.summary.rows} dropped ${r.summary.rowsDropped} plants ${r.summary.plants} gaps ${r.summary.gaps} weeds ${r.summary.weeds} dir ${r.directionDeg} pitch ${r.pitchM} gsd ${r.gsdM} f ${r.workFactor}`);
  console.log("   ", dbg.filter(l => /direction|comb 0 row/.test(l)).slice(0, 6).join("\n    "));
}
