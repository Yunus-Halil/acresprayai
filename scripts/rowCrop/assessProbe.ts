// Probe for the assessment's features: the green mask drawn (quarter size), and per cell the green share, the median
// component diameter, the pitch, the coherence and the alley depth of the folded across profile.
//   vite-node scripts/rowCrop/assessProbe.ts -- <photo> [<photo> ...]
import "../bench/nodeStorageShim";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { decodeImage, encodePng } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { assessField } from "../../src/lib/rowCrop/assess";
import { DEFAULT_ROW_CROP_PARAMS, downsample, LATE, localGreenMask } from "../../src/lib/rowCrop/readRowCrop";
import { GREEN_DEFAULTS, greenMaskWithExcess } from "../../src/lib/directGeoref/green";

const OUT = process.env.PROBE_OUT ?? ".";
for (const file of process.argv.slice(2).filter(a => !a.startsWith("--"))) {
  const raw = decodeImage(new Uint8Array(readFileSync(file)));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const f = Math.max(1, Math.ceil(Math.max(px.width, px.height) / 2048));
  const work = downsample(px, f);
  const { mask, excess } = greenMaskWithExcess({ width: work.W, height: work.H, rgba: work.rgba }, { ...GREEN_DEFAULTS, index: "exgr-soil", soilTilePx: 64, cellPx: 1, soilCapAboveGlobal: 0.05 });
  const late = localGreenMask(excess, work.rgba, work.W, work.H, Math.max(4, Math.round(Math.max(work.W, work.H) * LATE.windowShare)));
  const w = Math.floor(work.W / 2), h = Math.floor(work.H / 2), c = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * 2) * work.W + x * 2, o = (y * w + x) * 4; const g = work.rgba[i * 4 + 1] * 0.5; c[o] = mask[i] ? 255 : g; c[o + 1] = g; c[o + 2] = late[i] ? 255 : g; c[o + 3] = 255; }
  writeFileSync(`${OUT}/${basename(file)}-mask.png`, encodePng({ width: w, height: h, data: c }));
  const a = assessField(px, DEFAULT_ROW_CROP_PARAMS);
  console.log(`${basename(file)}: field ${a.field ? `${a.field.directionDeg} deg, pitches ${a.field.clusters.map(p => p.toFixed(0)).join("/")}` : "none"}, scale ${a.gsdM ? (a.gsdM * 100).toFixed(2) : "-"} cm/px`);
  for (const r of [0, Math.floor(a.rows / 2), a.rows - 1]) {
    const row = a.cells.filter(cl => cl.row === r);
    console.log(`  row ${r}: ` + row.map(cl => `${cl.state[0]}${cl.aligned ? "*" : ""} g${(cl.green * 100).toFixed(1)} d${cl.plantDiamPx == null ? "-" : (cl.plantDiamPx * (a.gsdM ?? 0) * 100).toFixed(1)} n${cl.components} c${cl.coherence.toFixed(2)}${cl.alleyDepth != null ? ` a${cl.alleyDepth.toFixed(2)}` : ""}${cl.alleyLight != null ? ` L${cl.alleyLight.toFixed(2)}` : ""}`).join(" | "));
  }
}
