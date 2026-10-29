// Probe: the full-resolution seedling pass on one photo with no judging, and a picture of what it found.
//   npx vite-node scripts/rowCrop/fineProbe.ts -- <photo> <out.png> [gsdCm=0.5] [x y w h]
import "../bench/nodeStorageShim";
import { readFileSync, writeFileSync } from "node:fs";
import { decodeImage, encodePng } from "../bench/images";
import { FINE_DEBUG, fineSeedlings } from "../../src/lib/rowCrop/fineSeedlings";

const a = process.argv.slice(2).filter(s => s !== "--");
const raw = decodeImage(new Uint8Array(readFileSync(a[0])));
const px = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
const gsd = Number(a[2] ?? 0.5) / 100;
const t0 = Date.now();
FINE_DEBUG.keep = true;
const rej: { x: number; y: number; why: string }[] = [];
const r = fineSeedlings(px, gsd, () => true, rej);
const tally: Record<string, number> = {}; for (const q of rej) tally[q.why] = (tally[q.why] ?? 0) + 1; console.log("rejected", tally);
console.log(`seedlings ${r.seedlings.length}, corn share ${r.cornShare.toFixed(3)}, ${Date.now() - t0} ms`);
const [x0, y0, w, h] = a.length > 6 ? a.slice(3, 7).map(Number) : [0, 0, px.width, px.height];
const c = new Uint8Array(w * h * 4);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((y + y0) * px.width + x + x0) * 4, o = (y * w + x) * 4; c[o] = px.rgba[s]; c[o + 1] = px.rgba[s + 1]; c[o + 2] = px.rgba[s + 2]; c[o + 3] = 255; }
const fl = FINE_DEBUG.flag!;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = fl[(y + y0) * px.width + x + x0], o = (y * w + x) * 4; if (v & 4) { c[o] = c[o] * 0.4; c[o + 1] = c[o + 1] * 0.4 + 60; c[o + 2] = c[o + 2] * 0.4 + 120; } else if (v & 32) { c[o] = c[o] * 0.7 + 50; c[o + 1] *= 0.7; c[o + 2] = c[o + 2] * 0.7 + 50; } else if (v & 64) { c[o] = 255; c[o + 1] = 255; c[o + 2] = 0; } }
for (const sd of r.seedlings) for (let k = 0; k < 64; k++) { const t = (k / 64) * 2 * Math.PI, xx = Math.round(sd.x - x0 + 8 * Math.cos(t)), yy = Math.round(sd.y - y0 + 8 * Math.sin(t)); if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const o = (yy * w + xx) * 4; c[o] = 255; c[o + 1] = 190; c[o + 2] = 0; }
const col: Record<string, [number, number, number]> = { large: [255, 0, 255], "near corn": [0, 160, 255], dark: [120, 120, 120], ring: [255, 40, 40], edge: [255, 255, 255] };
for (const q of rej) { const cc = col[q.why]; for (let k = 0; k < 32; k++) { const t = (k / 32) * 2 * Math.PI, xx = Math.round(q.x - x0 + 5 * Math.cos(t)), yy = Math.round(q.y - y0 + 5 * Math.sin(t)); if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const o = (yy * w + xx) * 4; c[o] = cc[0]; c[o + 1] = cc[1]; c[o + 2] = cc[2]; } }
writeFileSync(a[1], encodePng({ width: w, height: h, data: c }));
