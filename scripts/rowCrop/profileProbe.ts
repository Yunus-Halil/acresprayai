// Across-row green profile of one photo at the reader's direction: what a strip sees at mid stage.
import "../bench/nodeStorageShim";
import { readFileSync } from "node:fs";
import { decodeImage } from "../bench/images";
import { coarseDensity, downsample, rowDirection } from "../../src/lib/rowCrop/readRowCrop";
import { GREEN_DEFAULTS, greenMaskWithExcess } from "../../src/lib/directGeoref/green";
const file = process.argv[2];
const raw = decodeImage(new Uint8Array(readFileSync(file)));
const px = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
const f = Math.max(1, Math.ceil(Math.max(px.width, px.height) / 2048));
const w = downsample(px, f);
const { mask } = greenMaskWithExcess({ width: w.W, height: w.H, rgba: w.rgba }, { ...GREEN_DEFAULTS, index: "exgr-soil", soilTilePx: 64, cellPx: 1, soilCapAboveGlobal: 0.05 });
let g = 0; for (let i = 0; i < w.W * w.H; i++) g += mask[i];
console.log("green share", (g / (w.W * w.H)).toFixed(3));
const coarse = Math.max(1, Math.round(Math.max(w.W, w.H) / 500));
const cd = coarseDensity(mask, w.W, w.H, coarse, Math.max(2, Math.round(Math.max(w.W, w.H) / coarse / 25)));
const ang = rowDirection(cd.d, cd.w, cd.h, 2, Math.max(cd.w, cd.h) / 6);
console.log("direction", ((ang * 180) / Math.PI).toFixed(1));
// profile over the middle 40% of the photo along the rows, one bin per work px across
const sn = -Math.sin(ang), cs = Math.cos(ang), tx = Math.cos(ang), ty = Math.sin(ang);
const cx = w.W / 2, cy = w.H / 2;
const prof = new Map<number, [number, number]>();
for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) { const l = (x - cx) * tx + (y - cy) * ty; if (Math.abs(l) > 0.2 * Math.max(w.W, w.H)) continue; const b = Math.round((x - cx) * sn + (y - cy) * cs); const e = prof.get(b) ?? [0, 0]; e[0] += mask[y * w.W + x]; e[1]++; prof.set(b, e); }
const keys = [...prof.keys()].sort((a, b) => a - b);
const line = keys.filter(k => k > -300 && k < 300).map(k => { const [gg, n] = prof.get(k)!; return Math.round((gg / n) * 9); }).join("");
console.log(line);
