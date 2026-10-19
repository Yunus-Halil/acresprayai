// The planting-layout fitter on real orchard frames (stand-in maps from prep_two_stage_trial.py), headless.
//
//   npx vite-node scripts/bench/layoutTrial.ts -- --dir <trial dir> --frame DJI_0301 [--clicks "x,y;x,y;x,y"] [--out name]
//
// Clicks are three plants in global zoom-23 pixels of the stand-in map: two neighbours in one row, one in the next
// row. Without --clicks on a frame with hand labels, they are taken from the labelled crop plants. Scores the fit
// against the labelled crop plants and weeds when the frame has them, and writes <frame>/layout-<out>.png.
import "./nodeStorageShim";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng } from "./images";
import { vegetationMask, fieldRowsFromPixels } from "../../src/lib/weedVision/fieldRows";
import { rowStatusOf, isOnRow } from "../../src/lib/weedVision/rowFilter";
import { proposeFromRows, unexplainedGreen } from "../../src/lib/weedVision/layout/readLayout";
import { mercatorPx } from "../../src/lib/weedVision/mapRun";
import { LAYOUT_PARAMS, type FittedLayout, fitLayoutAll, latticeFromClicks, layoutsToFieldRows, mergeLayouts, rasterFromMask } from "../../src/lib/weedVision/layout/plantingLayout";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = arg("dir")!, FRAME = arg("frame")!, OUT = arg("out", "fit")!;
const d = join(DIR, FRAME);
const meta = JSON.parse(readFileSync(join(d, "meta.json"), "utf8"));
const w = meta.z22.w, h = meta.z22.h, mpp22 = meta.mpp23 * 2;
const rgba = new Uint8ClampedArray(readFileSync(join(d, "z22.rgba")));
const t0 = performance.now();
const mask = vegetationMask({ width: w, height: h, rgba });
const k = Math.max(1, Math.round(0.08 / mpp22));
const X0 = meta.z22.X0, Y0 = meta.z22.Y0;
const ring: [number, number][] = [[X0, Y0], [X0 + w, Y0], [X0 + w, Y0 + h], [X0, Y0 + h]];
const r = rasterFromMask(mask, w, h, k, 22, X0, Y0, mpp22, [ring]);
const rasterMs = performance.now() - t0;
const toR = (X23: number, Y23: number): [number, number] => [(X23 / 2 - X0) / k, (Y23 / 2 - Y0) / k];

let clicks: [number, number][];
let blocks: [number, number][][] = [];
const given = arg("clicks");
const crops = (meta.labels ?? []).filter((l: { cls: string }) => l.cls === "crop") as { X: number; Y: number }[];
const weeds = (meta.labels ?? []).filter((l: { cls: string }) => l.cls === "weed") as { X: number; Y: number }[];
if (argv.includes("--propose")) {
  const fr = fieldRowsFromPixels({ width: w, height: h, rgba }, mpp22);
  const b = fr ? proposeFromRows({ ...fr, z: 22, left: X0, top: Y0, mpp: mpp22 }) : null;
  if (!b) { console.log(JSON.stringify({ frame: FRAME, proposal: null })); process.exit(0); }
  clicks = b.points.map(q => mercatorPx(q.lat, q.lng, 23) as [number, number]);
  blocks = [clicks];
} else if (given) { blocks = given.split("|").map(b => b.split(";").map(s => s.split(",").map(Number) as [number, number])); clicks = blocks.flat(); }
else {
  // From the labels: a plant near the middle, its nearest neighbour 2.5 to 4 m away, and the nearest plant 4 to 7 m off that line.
  const m = meta.mpp23;
  const cx = meta.z23.X0 + meta.z23.w / 2, cy = meta.z23.Y0 + meta.z23.h / 2;
  const a = [...crops].sort((p, q) => Math.hypot(p.X - cx, p.Y - cy) - Math.hypot(q.X - cx, q.Y - cy))[0];
  const dist = (p: { X: number; Y: number }) => Math.hypot(p.X - a.X, p.Y - a.Y) * m;
  const b = crops.filter(p => dist(p) >= 2.5 && dist(p) <= 4).sort((p, q) => dist(p) - dist(q))[0];
  const ux = (b.X - a.X) / Math.hypot(b.X - a.X, b.Y - a.Y), uy = (b.Y - a.Y) / Math.hypot(b.X - a.X, b.Y - a.Y);
  const across = (p: { X: number; Y: number }) => Math.abs(-(p.X - a.X) * uy + (p.Y - a.Y) * ux) * m;
  const c = crops.filter(p => across(p) >= 4 && across(p) <= 7).sort((p, q) => dist(p) - dist(q))[0];
  clicks = [[a.X, a.Y], [b.X, b.Y], [c.X, c.Y]];
  blocks = [clicks];
}
for (const kv of (arg("set") ?? "").split(",").filter(Boolean)) { const [kk, vv] = kv.split("="); (LAYOUT_PARAMS as Record<string, number>)[kk] = Number(vv); }
const L0 = latticeFromClicks(toR(...blocks[0][0]), toR(...blocks[0][1]), toR(...blocks[0][2]))!;
const t1 = performance.now();
const fits: FittedLayout[] = blocks.flatMap(b => fitLayoutAll(latticeFromClicks(toR(...b[0]), toR(...b[1]), toR(...b[2]))!, r));
const merged = mergeLayouts(fits);
const fit = { ...merged[0], plants: merged.flatMap(f => f.plants), gaps: merged.flatMap(f => f.gaps), rows: merged.reduce((a, f) => a + f.rows, 0), foundShare: merged.reduce((a, f) => a + f.plants.length, 0) / Math.max(1, merged.reduce((a, f) => a + f.plants.length + f.gaps.length, 0)) };
const fitMs = performance.now() - t1;
const rows0 = layoutsToFieldRows(fits, r);
const rows = rows0 ? { ...rows0, unexplained: unexplainedGreen(r, rows0, merged) } : null;
if (arg("save-rows")) writeFileSync(arg("save-rows")!, JSON.stringify(rows));

// Against the labels: crop plants found (a fitted plant within 0.6 m), and where the labelled weeds and plants stand.
const score: Record<string, unknown> = {};
const reader = fieldRowsFromPixels({ width: w, height: h, rgba }, mpp22);
const status = (fr: typeof reader, X23: number, Y23: number) => (fr ? rowStatusOf(fr.ctx, X23 / 2 - X0, Y23 / 2 - Y0) : "no-rows");
if (crops.length && rows) {
  const plantsG = fit.plants.map(p => [(X0 + p.x * k) * 2, (Y0 + p.y * k) * 2]);
  const near = (l: { X: number; Y: number }) => plantsG.some(([X, Y]) => Math.hypot(X - l.X, Y - l.Y) * meta.mpp23 <= 0.6);
  score.labelledCropPlants = crops.length;
  score.foundByLayout = crops.filter(near).length;
  const gapsG = fit.gaps.map(g => [(X0 + g.x * k) * 2, (Y0 + g.y * k) * 2]);
  const nearest = (pts: number[][], l: { X: number; Y: number }) => Math.min(...pts.map(([X, Y]) => Math.hypot(X - l.X, Y - l.Y) * meta.mpp23));
  const missed = crops.filter(l => !near(l));
  score.missedTrees = { n: missed.length, nearestPlantM: missed.map(l => +nearest(plantsG, l).toFixed(2)).sort((a, b) => a - b), nearestGapM: missed.map(l => +nearest(gapsG, l).toFixed(2)).sort((a, b) => a - b) };
  score.cropOnRowsLayout = crops.filter(l => isOnRow(status(rows, l.X, l.Y))).length;
  score.cropOnRowsReader = crops.filter(l => isOnRow(status(reader, l.X, l.Y))).length;
  score.labelledWeeds = weeds.length;
  score.weedsOnRowsLayout = weeds.filter(l => isOnRow(status(rows, l.X, l.Y))).length;
  score.weedsOnRowsReader = weeds.filter(l => isOnRow(status(reader, l.X, l.Y))).length;
}
const out = {
  frame: FRAME, rasterPx: [r.w, r.h], rasterMpp: +r.mpp.toFixed(3), rasterMs: Math.round(rasterMs), fitMs: Math.round(fitMs),
  start: { alongM: +(L0.along * r.mpp).toFixed(2), acrossM: +(Math.abs(L0.across) * r.mpp).toFixed(2), angleDeg: +((L0.angle * 180) / Math.PI).toFixed(1) },
  fitted: { alongM: +(fit.lattice.along * r.mpp).toFixed(2), acrossM: +(Math.abs(fit.lattice.across) * r.mpp).toFixed(2), angleDeg: +((fit.lattice.angle * 180) / Math.PI).toFixed(1), score: +fit.score.toFixed(3) },
  rows: fit.rows, plants: fit.plants.length, gaps: fit.gaps.length, unexplained: rows?.unexplained.length ?? null, foundShare: +fit.foundShare.toFixed(3), readerRows: reader?.rows ?? null, ...score,
};
console.log(JSON.stringify(out));

// The picture: the frame at the raster's scale x 2, rows (cyan), plants (green rings), gaps (red crosses), clicks (white).
const S = 2, W = r.w * S, H = r.h * S;
const img = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const sx = Math.min(w - 1, Math.floor((x / S) * k)), sy = Math.min(h - 1, Math.floor((y / S) * k)); const o = (y * W + x) * 4, so = (sy * w + sx) * 4; img[o] = rgba[so] * 0.8; img[o + 1] = rgba[so + 1] * 0.8; img[o + 2] = rgba[so + 2] * 0.8; img[o + 3] = 255; }
const set = (x: number, y: number, c: number[]) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; };
const line = (a: number[], b: number[], c: number[]) => { const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))); for (let t = 0; t <= n; t++) set(a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n, c); };
if (rows) for (const l of rows.ctx.lines) line([(l.x1 / k) * S, (l.y1 / k) * S], [(l.x2 / k) * S, (l.y2 / k) * S], [0, 230, 255]);
for (const p of fit.plants) for (let t = 0; t < 40; t++) set((p.x + p.r * Math.cos(t / 6.366)) * S, (p.y + p.r * Math.sin(t / 6.366)) * S, [0, 255, 80]);
for (const g of fit.gaps) for (let t = -4; t <= 4; t++) { set(g.x * S + t, g.y * S + t, [255, 40, 40]); set(g.x * S + t, g.y * S - t, [255, 40, 40]); }
for (const l of weeds) { const [x, y] = toR(l.X, l.Y); for (let t = -2; t <= 2; t++) { set(x * S + t, y * S, [255, 230, 0]); set(x * S, y * S + t, [255, 230, 0]); } }
if (rows) for (const u of rows.unexplained) for (let t = 0; t < 60; t += 2) set((u.x / k + (u.r / k) * Math.cos(t / 9.55)) * S, (u.y / k + (u.r / k) * Math.sin(t / 9.55)) * S, [255, 145, 0]);
for (const c of clicks) { const [x, y] = toR(c[0], c[1]); for (let t = 0; t < 30; t++) set(x * S + 7 * Math.cos(t / 4.77), y * S + 7 * Math.sin(t / 4.77), [255, 255, 255]); }
writeFileSync(join(d, `layout-${OUT}.png`), encodePng({ width: W, height: H, data: img }));
