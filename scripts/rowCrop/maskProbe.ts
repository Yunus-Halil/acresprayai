// Writes the reader's green mask of a photo as a PNG, and the across profile at a given direction.
import "../bench/nodeStorageShim";
import { readFileSync, writeFileSync } from "node:fs";
import { decodeImage, encodePng } from "../bench/images";
import { downsample } from "../../src/lib/rowCrop/readRowCrop";
import { GREEN_DEFAULTS, greenMaskWithExcess } from "../../src/lib/directGeoref/green";
const [file, out, angArg] = process.argv.slice(2);
const raw = decodeImage(new Uint8Array(readFileSync(file)));
const px = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
const f = Math.max(1, Math.ceil(Math.max(px.width, px.height) / 2048));
const w = downsample(px, f);
for (const index of ["exgr-soil", "exgr", "exg-otsu"] as const) {
  const { mask } = greenMaskWithExcess({ width: w.W, height: w.H, rgba: w.rgba }, { ...GREEN_DEFAULTS, index, soilTilePx: 64, cellPx: 1, soilCapAboveGlobal: 0.05 });
  let g = 0; for (let i = 0; i < w.W * w.H; i++) g += mask[i];
  const data = new Uint8Array(w.W * w.H * 4);
  for (let i = 0; i < w.W * w.H; i++) { const v = mask[i] ? 255 : 0; data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  writeFileSync(`${out}-${index}.png`, encodePng({ width: w.W, height: w.H, data }));
  const ang = (Number(angArg ?? 90) * Math.PI) / 180, sn = -Math.sin(ang), cs = Math.cos(ang), tx = Math.cos(ang), ty = Math.sin(ang), cx = w.W / 2, cy = w.H / 2;
  const prof = new Map<number, [number, number]>();
  for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) { const l = (x - cx) * tx + (y - cy) * ty; if (Math.abs(l) > 0.2 * Math.max(w.W, w.H)) continue; const b = Math.round((x - cx) * sn + (y - cy) * cs); const e = prof.get(b) ?? [0, 0]; e[0] += mask[y * w.W + x]; e[1]++; prof.set(b, e); }
  const keys = [...prof.keys()].sort((a, b) => a - b).filter(k => k > -200 && k < 200);
  console.log(index, "green", (g / (w.W * w.H)).toFixed(3), keys.map(k => { const [gg, n] = prof.get(k)!; return Math.round((gg / n) * 9); }).join(""));
}
