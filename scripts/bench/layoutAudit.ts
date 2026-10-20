// Every labelled tree of DJI_0301 traced through the planting-layout fitter: found, or why not (2026-10-19 audit).
//
//   npx vite-node scripts/bench/layoutAudit.ts -- --dir <trial dir> [--reader]
//
// The frame stands in for the map as in layoutTrial.ts. For each of the 104 labelled crop plants: the green at the
// label (vegetation mask and crown-scale green), the lattice position it belongs to, what the fitter did with that
// position (accepted, or the recorded reason), and the nearest fitted plant. Writes audit.json, audit.md and
// audit-overlay.png (states: observed plant green ring, expected position without a plant red cross, labelled tree
// not matched magenta cross, labelled weed yellow dot).
import "./nodeStorageShim";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng } from "./images";
import { vegetationMask, fieldRowsFromPixels } from "../../src/lib/weedVision/fieldRows";
import { isOnRow, rowStatusOf } from "../../src/lib/weedVision/rowFilter";
import { LAYOUT_PARAMS, type Lattice, boxMean, fitLayoutAll, latticeFromClicks, latticeIndex, layoutsToFieldRows, rasterFromMask } from "../../src/lib/weedVision/layout/plantingLayout";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = arg("dir")!, FRAME = "DJI_0301";
const d = join(DIR, FRAME);
const meta = JSON.parse(readFileSync(join(d, "meta.json"), "utf8"));
const w = meta.z22.w, h = meta.z22.h, mpp22 = meta.mpp23 * 2;
const rgba = new Uint8ClampedArray(readFileSync(join(d, "z22.rgba")));
const mask = vegetationMask({ width: w, height: h, rgba });
const k = Math.max(1, Math.round(0.08 / mpp22));
const X0 = meta.z22.X0, Y0 = meta.z22.Y0;
const r = rasterFromMask(mask, w, h, k, 22, X0, Y0, mpp22, [[[X0, Y0], [X0 + w, Y0], [X0 + w, Y0 + h], [X0, Y0 + h]]]);
const toR = (X23: number, Y23: number): [number, number] => [(X23 / 2 - X0) / k, (Y23 / 2 - Y0) / k];
const crops = (meta.labels as { cls: string; X: number; Y: number }[]).filter(l => l.cls === "crop");
const weeds = (meta.labels as { cls: string; X: number; Y: number }[]).filter(l => l.cls === "weed");

// The same clicks as layoutTrial: a labelled tree near the middle, its neighbour, a tree in the next row.
const m = meta.mpp23;
const cx = meta.z23.X0 + meta.z23.w / 2, cy = meta.z23.Y0 + meta.z23.h / 2;
const a = [...crops].sort((p, q) => Math.hypot(p.X - cx, p.Y - cy) - Math.hypot(q.X - cx, q.Y - cy))[0];
const dist = (p: { X: number; Y: number }) => Math.hypot(p.X - a.X, p.Y - a.Y) * m;
const b = crops.filter(p => dist(p) >= 2.5 && dist(p) <= 4).sort((p, q) => dist(p) - dist(q))[0];
const ux = (b.X - a.X) / Math.hypot(b.X - a.X, b.Y - a.Y), uy = (b.Y - a.Y) / Math.hypot(b.X - a.X, b.Y - a.Y);
const across = (p: { X: number; Y: number }) => Math.abs(-(p.X - a.X) * uy + (p.Y - a.Y) * ux) * m;
const c = crops.filter(p => across(p) >= 4 && across(p) <= 7).sort((p, q) => dist(p) - dist(q))[0];
const clicks: [number, number][] = [toR(a.X, a.Y), toR(b.X, b.Y), toR(c.X, c.Y)];

const trace = new Map<string, string>();
const fits = fitLayoutAll(latticeFromClicks(...(clicks as [[number, number], [number, number], [number, number]]))!, r, clicks, trace);
const L: Lattice = fits[0].lattice;
const rows = layoutsToFieldRows(fits, r)!;
const plants = fits.flatMap(f => f.plants);
const GF = boxMean(r, LAYOUT_PARAMS.presenceRadiusM / r.mpp);
const reader = fieldRowsFromPixels({ width: w, height: h, rgba }, mpp22);

type Row = { id: number; greenAtLabel: boolean; crownGreen: number; lattice: string; offAlongM: number; offAcrossM: number; fate: string; nearestPlantM: number; onRowNow: boolean; onRowReader: boolean; state: string };
const out: Row[] = crops.map((l, n) => {
  const [x, y] = toR(l.X, l.Y);
  const [i, j] = latticeIndex(L, x, y);
  const { e1, e2 } = (() => { const uxl = Math.cos(L.angle), uyl = Math.sin(L.angle), nx = -uyl, ny = uxl; return { e1: [L.along * uxl, L.along * uyl], e2: [L.across * nx + L.stagger * uxl, L.across * ny + L.stagger * uyl] }; })();
  const lx = L.ox + i * e1[0] + j * e2[0], ly = L.oy + i * e1[1] + j * e2[1];
  const uxl = Math.cos(L.angle), uyl = Math.sin(L.angle);
  const offA = ((x - lx) * uxl + (y - ly) * uyl) * r.mpp, offC = (-(x - lx) * uyl + (y - ly) * uxl) * r.mpp;
  const xi = Math.min(w - 1, Math.max(0, Math.round(l.X / 2 - X0))), yi = Math.min(h - 1, Math.max(0, Math.round(l.Y / 2 - Y0)));
  const rx = Math.min(r.w - 1, Math.max(0, Math.round(x))), ry = Math.min(r.h - 1, Math.max(0, Math.round(y)));
  const nearest = Math.min(...plants.map(p => Math.hypot(p.x - x, p.y - y) * r.mpp));
  const fate = trace.get(`${i},${j}`) ?? "never looked at (growth did not reach this position)";
  const onRowNow = isOnRow(rowStatusOf(rows.ctx, l.X / 2 - X0, l.Y / 2 - Y0));
  const onRowReader = reader ? isOnRow(rowStatusOf(reader.ctx, l.X / 2 - X0, l.Y / 2 - Y0)) : false;
  const matched = nearest <= 0.6;
  const state = matched ? "observed plant" : onRowNow ? "on a row line, no plant placed within 0.6 m" : "not on any row";
  return { id: n + 1, greenAtLabel: mask[yi * w + xi] === 1, crownGreen: +GF[ry * r.w + rx].toFixed(2), lattice: `${i},${j}`, offAlongM: +offA.toFixed(2), offAcrossM: +offC.toFixed(2), fate, nearestPlantM: +nearest.toFixed(2), onRowNow, onRowReader, state };
});
const missed = out.filter(o => o.nearestPlantM > 0.6);
const byFate = new Map<string, number>();
for (const o of missed) { const f = o.fate.replace(/[-\d.]+ m along, [-\d.]+ m across \(limits [\d.]+, [\d.]+\)/, "… (limits)").replace(/[\d.]+ under the bar [\d.]+/, "… under the bar").replace(/: [\d.]+ between/, ""); byFate.set(f, (byFate.get(f) ?? 0) + 1); }
const summary = {
  labelledTrees: crops.length, matchedWithin60cm: out.length - missed.length, onRowLine: out.filter(o => o.onRowNow).length, onRowLineReader: out.filter(o => o.onRowReader).length,
  missedByFate: Object.fromEntries([...byFate.entries()].sort((x, y) => y[1] - x[1])),
  missedWithoutGreenAtLabel: missed.filter(o => !o.greenAtLabel).length,
  missedCrownGreenMedian: missed.length ? [...missed].sort((x, y) => x.crownGreen - y.crownGreen)[missed.length >> 1].crownGreen : null,
  labelledWeedsOnRowNow: weeds.filter(l => isOnRow(rowStatusOf(rows.ctx, l.X / 2 - X0, l.Y / 2 - Y0))).length,
  labelledWeedsOnRowReader: reader ? weeds.filter(l => isOnRow(rowStatusOf(reader.ctx, l.X / 2 - X0, l.Y / 2 - Y0))).length : null,
  fittedPlants: plants.length, expectedPositionsWithoutPlant: fits.reduce((s, f) => s + f.gaps.length, 0), rows: rows.rows,
};
writeFileSync(join(d, "audit.json"), JSON.stringify({ summary, trees: out }, null, 1));
const md = [`# DJI_0301 tree audit`, "", "```json", JSON.stringify(summary, null, 1), "```", "", "| # | green at label | crown green | lattice | off along m | off across m | fate | nearest plant m | state |", "|---|---|---|---|---|---|---|---|---|",
  ...out.filter(o => o.nearestPlantM > 0.6).map(o => `| ${o.id} | ${o.greenAtLabel ? "yes" : "no"} | ${o.crownGreen} | ${o.lattice} | ${o.offAlongM} | ${o.offAcrossM} | ${o.fate} | ${o.nearestPlantM} | ${o.state} |`)];
writeFileSync(join(d, "audit.md"), md.join("\n"));
console.log(JSON.stringify(summary));

// Overlay at raster scale x2.
const S = 2, W = r.w * S, H = r.h * S;
const img = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const sx = Math.min(w - 1, Math.floor((x / S) * k)), sy = Math.min(h - 1, Math.floor((y / S) * k)); const o = (y * W + x) * 4, so = (sy * w + sx) * 4; img[o] = rgba[so] * 0.8; img[o + 1] = rgba[so + 1] * 0.8; img[o + 2] = rgba[so + 2] * 0.8; img[o + 3] = 255; }
const set = (x: number, y: number, cc: number[]) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; img[o] = cc[0]; img[o + 1] = cc[1]; img[o + 2] = cc[2]; };
const line = (p: number[], q: number[], cc: number[]) => { const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]))); for (let t = 0; t <= n; t++) set(p[0] + ((q[0] - p[0]) * t) / n, p[1] + ((q[1] - p[1]) * t) / n, cc); };
for (const l of rows.ctx.lines) line([(l.x1 / k) * S, (l.y1 / k) * S], [(l.x2 / k) * S, (l.y2 / k) * S], [0, 200, 255]);
for (const p of plants) for (let t = 0; t < 40; t++) set((p.x + p.r * Math.cos(t / 6.366)) * S, (p.y + p.r * Math.sin(t / 6.366)) * S, [0, 255, 80]);
for (const f of fits) for (const g of f.gaps) for (let t = -4; t <= 4; t++) { set(g.x * S + t, g.y * S + t, [255, 40, 40]); set(g.x * S + t, g.y * S - t, [255, 40, 40]); }
for (const l of weeds) { const [x, y] = toR(l.X, l.Y); set(x * S, y * S, [255, 230, 0]); set(x * S + 1, y * S, [255, 230, 0]); set(x * S, y * S + 1, [255, 230, 0]); }
for (const o of out) { if (o.nearestPlantM <= 0.6) continue; const l = crops[o.id - 1]; const [x, y] = toR(l.X, l.Y); for (let t = -5; t <= 5; t++) { set(x * S + t, y * S + t, [255, 0, 255]); set(x * S + t, y * S - t, [255, 0, 255]); } }
writeFileSync(join(d, "audit-overlay.png"), encodePng({ width: W, height: H, data: img }));
