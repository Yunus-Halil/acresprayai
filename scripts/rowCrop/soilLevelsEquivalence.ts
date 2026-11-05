// The soil levels (seedlingGreen.ts soilLevels) computed the frozen way (corn-v1.0: every 9 x 9 median by a full sort)
// against the current way, on the same decoded photographs, bit for bit (2026-11-05). Times the block pass and the two
// medians separately, so the share the median takes is measured rather than assumed.
//   npx vite-node scripts/rowCrop/soilLevelsEquivalence.ts --images <dir> [--limit N] [--out <file.json>]
import "../bench/nodeStorageShim";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NODE_DECODER, decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { SEEDLING_GREEN, medianGrid, soilLevels, type SeedlingGreenOptions, type SoilLevels } from "../../src/lib/rowCrop/seedlingGreen";

/** corn-v1.0's median, verbatim. */
function medianGridFrozen(v: Float32Array, w: number, h: number, win: number): Float32Array {
  const out = new Float32Array(w * h), r = win >> 1, buf: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    buf.length = 0;
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) { const q = v[yy * w + xx]; if (Number.isFinite(q)) buf.push(q); }
    if (!buf.length) { out[y * w + x] = NaN; continue; }
    buf.sort((a, b) => a - b); out[y * w + x] = buf[buf.length >> 1];
  }
  return out;
}

/** corn-v1.0's soilLevels, verbatim, with the block pass and the medians timed. */
function soilLevelsFrozen(px: PhotoPixels, o: SeedlingGreenOptions, t: { blocks: number; median: number }): SoilLevels {
  const t0 = performance.now();
  const W = px.width, H = px.height, N = W * H, d = px.rgba;
  const hist = new Int32Array(256);
  for (let i = 0; i < N; i += 7) { const q = i * 4; hist[Math.max(0, Math.min(255, Math.round(d[q + 1] - (d[q] + d[q + 2]) / 2) + 128))]++; }
  let tot = 0; for (const v of hist) tot += v;
  let acc = 0, pT = 0; for (let tt = 0; tt < 256; tt++) { acc += hist[tt]; if (acc >= o.soilTintPercentile * tot) { pT = tt - 128; break; } }
  const soilCut = pT + o.soilTintSpread;
  const B = o.blockPx, gw = Math.ceil(W / B), gh = Math.ceil(H / B);
  const bl = new Float32Array(gw * gh), bt = new Float32Array(gw * gh), bn = new Float32Array(gw * gh), ba = new Float32Array(gw * gh);
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / B) * gw;
    for (let x = 0; x < W; x++) {
      const q = (y * W + x) * 4, r = d[q], g = d[q + 1], b = d[q + 2], c = row + Math.floor(x / B), tt = g - (r + b) / 2;
      ba[c]++;
      if (tt >= soilCut) continue;
      bl[c] += 0.3 * r + 0.59 * g + 0.11 * b; bt[c] += tt; bn[c]++;
    }
  }
  for (let c = 0; c < gw * gh; c++) { const ok = bn[c] >= 0.2 * ba[c]; bl[c] = ok ? bl[c] / bn[c] : NaN; bt[c] = ok ? bt[c] / bn[c] : NaN; }
  const t1 = performance.now();
  const soilL = medianGridFrozen(bl, gw, gh, o.soilWin), soilT = medianGridFrozen(bt, gw, gh, o.soilWin);
  const t2 = performance.now();
  t.blocks += t1 - t0; t.median += t2 - t1;
  const ls = Array.from(soilL).filter(Number.isFinite).sort((a, b) => a - b);
  return { W, H, B, gw, gh, soilL, soilT, globalL: ls.length ? ls[ls.length >> 1] : 128 };
}

const bytes = (a: Float32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const IMAGES = arg("images")!, LIMIT = Number(arg("limit", "0")), OUT = arg("out");
let files = readdirSync(IMAGES).filter(f => /\.(jpe?g|png)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (LIMIT) files = files.slice(0, LIMIT);
const per: { photo: string; identical: boolean; frozenMs: number; currentMs: number; frozenMedianMs: number; currentMedianMs: number }[] = [];
// A synthetic grid with gaps (NaN), ties and edges, every window size the readers use, before any photograph.
{
  let s = 7; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  for (const [w, h, win] of [[37, 23, 9], [5, 3, 9], [1, 1, 9], [64, 40, 5], [64, 40, 3], [20, 20, 1]] as const) {
    const v = new Float32Array(w * h); for (let i = 0; i < v.length; i++) v[i] = rnd() < 0.15 ? NaN : Math.round(rnd() * 20) / 4;
    if (!bytes(medianGrid(v, w, h, win)).equals(bytes(medianGridFrozen(v, w, h, win)))) { console.log(`synthetic ${w}x${h} win ${win}: DIFFERENT`); process.exit(1); }
  }
  console.log("synthetic grids: identical");
}
for (const f of files) {
  const raw = decodeImage(new Uint8Array(readFileSync(join(IMAGES, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const tf = { blocks: 0, median: 0 };
  const a0 = performance.now(); const a = soilLevelsFrozen(px, SEEDLING_GREEN, tf); const a1 = performance.now();
  const b = soilLevels(px, SEEDLING_GREEN); const b1 = performance.now();
  const identical = bytes(a.soilL).equals(bytes(b.soilL)) && bytes(a.soilT).equals(bytes(b.soilT)) && Object.is(a.globalL, b.globalL) && a.gw === b.gw && a.gh === b.gh;
  const row = { photo: f, identical, frozenMs: +(a1 - a0).toFixed(1), currentMs: +(b1 - a1).toFixed(1), frozenMedianMs: +tf.median.toFixed(1), currentMedianMs: +((b1 - a1) - tf.blocks).toFixed(1) };
  per.push(row);
  console.log(`${f}: ${identical ? "identical" : "DIFFERENT"} | soilLevels ${row.frozenMs} -> ${row.currentMs} ms (frozen: blocks ${tf.blocks.toFixed(0)} + medians ${tf.median.toFixed(0)})`);
}
const sum = (k: keyof typeof per[number]) => per.reduce((s, p) => s + (p[k] as number), 0);
const out = { images: IMAGES, ...NODE_DECODER, photographs: per.length, identical: per.filter(p => p.identical).length, frozenMs: +sum("frozenMs").toFixed(0), currentMs: +sum("currentMs").toFixed(0), frozenMedianMs: +sum("frozenMedianMs").toFixed(0), per };
console.log(`\n${out.identical} of ${out.photographs} identical; soilLevels ${out.frozenMs} -> ${out.currentMs} ms over the set (frozen medians ${out.frozenMedianMs} ms)`);
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
if (out.identical !== out.photographs) process.exit(1);
