// Direction scores and pitch candidates for one rendered scene, and the comb check.
import "../bench/nodeStorageShim";
import { renderScene, sceneSet } from "../cropProfiles/scenes";
import { coarseDensity, downsample, pitchFromProfile } from "../../src/lib/rowCrop/readRowCrop";
import { GREEN_DEFAULTS, greenMaskWithExcess } from "../../src/lib/directGeoref/green";
const name = process.argv[2] ?? "development-5";
const s = sceneSet("development").find(x => x.name === name)!;
const { px } = renderScene(s);
const f = Math.max(1, Math.round(0.01 / s.gsdM)), w = downsample(px, f), gsdW = s.gsdM * f;
const { mask } = greenMaskWithExcess({ width: w.W, height: w.H, rgba: w.rgba }, { ...GREEN_DEFAULTS, index: "exgr-soil", soilTilePx: Math.max(16, Math.min(256, Math.round(0.64 / gsdW))), cellPx: 1, soilCapAboveGlobal: 0.05 });
let g = 0; for (let i = 0; i < w.W * w.H; i++) g += mask[i];
const coarse = Math.max(1, Math.round(0.04 / gsdW)), satR = Math.max(2, Math.round(0.75 / gsdW / coarse));
const cd = coarseDensity(mask, w.W, w.H, coarse, satR);
console.log(`scene ${name}: truth angle ${s.angleDeg} (image ${(180 - s.angleDeg) % 180}), pitch ${s.pitchM}, work ${w.W}x${w.H} f ${f} green ${(g / (w.W * w.H)).toFixed(3)} coarse ${coarse} cells ${cd.w}x${cd.h} sat ${cd.satShare.toFixed(3)}`);
// periodicity per angle (copy of the reader's, exposed here for the probe)
function boxSmooth(src: Float64Array, r: number) { const n = src.length, out = new Float64Array(n), pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src[i]; for (let i = 0; i < n; i++) { const lo = Math.max(0, i - r), hi = Math.min(n - 1, i + r); out[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1); } return out; }
function periodicity(d: Float32Array, W: number, H: number, alpha: number, minLag: number, maxLag: number) {
  const c = Math.cos(alpha), sn = Math.sin(alpha), D = Math.ceil(Math.hypot(W, H));
  const bins = new Float64Array(2 * D + 2), counts = new Int32Array(2 * D + 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const b = Math.round(x * c + y * sn) + D; bins[b] += d[y * W + x]; counts[b]++; }
  let lo = -1, hi = -1; for (let b = 0; b < bins.length; b++) if (counts[b] > 0) { if (lo < 0) lo = b; hi = b; bins[b] /= counts[b]; }
  const p = boxSmooth(bins.slice(lo, hi + 1), Math.round(maxLag));
  const q = new Float64Array(hi - lo + 1); for (let i = 0; i < q.length; i++) q[i] = bins[lo + i] - p[i];
  let m = 0; for (const v of q) m += v; m /= q.length;
  const ac = (lag: number) => { let a = 0; for (let i = 0; i + lag < q.length; i++) a += (q[i] - m) * (q[i + lag] - m); return a / Math.max(1, q.length - lag); };
  const a0 = ac(0); if (!(a0 > 0)) return { score: 0, bestLag: 0, bestAc: 0 };
  let best = 0, bl = 0; for (let lag = Math.max(2, Math.round(minLag)); lag <= Math.min(q.length / 3, maxLag); lag++) { const v = ac(lag) / a0; if (v > best) { best = v; bl = lag; } }
  return { score: best * a0, bestLag: bl, bestAc: best, a0 };
}
const minLag = 0.8 * 0.381 / gsdW / coarse, maxLag = 2.0 / gsdW / coarse;
const rows: { deg: number; score: number; lag: number; ac: number; a0: number }[] = [];
for (let deg = 0; deg < 180; deg += 1) { const r = periodicity(cd.d, cd.w, cd.h, (deg * Math.PI) / 180, minLag, maxLag); rows.push({ deg, score: r.score, lag: r.bestLag, ac: r.bestAc, a0: r.a0 ?? 0 }); }
rows.sort((a, b) => b.score - a.score);
console.log("top angles (projection axis = across the rows; row angle = axis+90):", rows.slice(0, 6).map(r => `${r.deg}: score ${r.score.toExponential(2)} lag ${r.lag} ac ${r.ac.toFixed(2)} var ${r.a0.toExponential(2)}`).join(" | "));
const trueAxis = ((180 - s.angleDeg) % 180 + 90) % 180;
const t = rows.find(r => r.deg === Math.round(trueAxis))!;
console.log(`true axis ${trueAxis}: score ${t.score.toExponential(2)} lag ${t.lag} ac ${t.ac.toFixed(2)} var ${t.a0.toExponential(2)} (pitch in cells ${(s.pitchM / gsdW / coarse).toFixed(1)})`);
// comb
const p = new Float64Array(600); for (let i = 0; i < 600; i++) p[i] = (i % 37) < 6 ? 1 : 0.05;
console.log("comb pitch", pitchFromProfile(p, 8, 200));
