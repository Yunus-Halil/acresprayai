// Prints the reader's early stages for one photograph: direction, pitch and the across profile's autocorrelation.
//   npx vite-node scripts/rowCrop/probe.ts <photo> [gsdCm]
import "../bench/nodeStorageShim";
import { readFileSync } from "node:fs";
import { decodeImage } from "../bench/images";
import { coarseDensity, downsample, pitchFromProfile, rowDirection } from "../../src/lib/rowCrop/readRowCrop";
import { GREEN_DEFAULTS, greenMaskWithExcess } from "../../src/lib/directGeoref/green";

const file = process.argv[2];
const raw = decodeImage(new Uint8Array(readFileSync(file)));
const px = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
const f = Math.max(1, Math.ceil(Math.max(px.width, px.height) / 2048));
const w = downsample(px, f);
const { mask } = greenMaskWithExcess({ width: w.W, height: w.H, rgba: w.rgba }, { ...GREEN_DEFAULTS, index: "exgr-soil", soilTilePx: 64, cellPx: 1 });
let g = 0; for (let i = 0; i < w.W * w.H; i++) g += mask[i];
console.log("work", w.W, w.H, "factor", f, "green share", (g / (w.W * w.H)).toFixed(3));
const coarse = Math.max(1, Math.round(Math.max(w.W, w.H) / 500));
const cd = coarseDensity(mask, w.W, w.H, coarse, Math.max(2, Math.round(Math.max(w.W, w.H) / coarse / 25)));
console.log("saturated share", cd.satShare.toFixed(3));
const ang = rowDirection(cd.d, cd.w, cd.h, 2, Math.max(cd.w, cd.h) / 6);
console.log("row direction deg", ((ang * 180) / Math.PI).toFixed(1));
// Across profile
const sn = -Math.sin(ang), cs = Math.cos(ang);
const corners = [[0, 0], [w.W, 0], [0, w.H], [w.W, w.H]].map(([x, y]) => x * sn + y * cs);
const aMin = Math.floor(Math.min(...corners)), aMax = Math.ceil(Math.max(...corners));
const prof = new Float64Array(aMax - aMin + 2), cnt = new Int32Array(aMax - aMin + 2);
for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) { const b = Math.round(x * sn + y * cs) - aMin; cnt[b]++; if (mask[y * w.W + x]) prof[b]++; }
for (let b = 0; b < prof.length; b++) if (cnt[b]) prof[b] /= cnt[b];
const p = pitchFromProfile(prof, 8, prof.length / 3);
console.log("pitch px (work)", p, "-> photo px", p == null ? null : p * f);
// autocorrelation listing
let m = 0, n = 0; for (const v of prof) if (v > 0) { m += v; n++; } m /= n;
const ac = (lag: number) => { let a = 0; for (let i = 0; i + lag < prof.length; i++) a += (prof[i] - m) * (prof[i + lag] - m); return a / (prof.length - lag); };
const a0 = ac(0); const out: string[] = [];
for (let lag = 8; lag < prof.length / 3; lag += 4) out.push(`${lag}:${(ac(lag) / a0).toFixed(2)}`);
console.log(out.join(" "));
