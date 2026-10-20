// Stage 1 weed hotspots against the labelled weeds of DJI_0301, by cell density (2026-10-19).
//
//   npx vite-node scripts/bench/hotspotEval.ts -- --dir <trial dir>
//
// Truth per 2 m cell: how many labelled weed points fall in it (labels are not exhaustive, so this is a lower bound
// everywhere). A "dense" cell holds at least DENSE labels. Each pressure signal ranks the cells; reported: Spearman
// rank correlation with the label count, the share of dense cells in the top 10 / 20 / 30% of cells, and what the
// candidate areas (connected cells over the floor) catch. Signals: off-row green share (Stage 1 today), off-row
// green blob count per cell, and the two combined.
import "./nodeStorageShim";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LatLng2 } from "../../src/lib/geo";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { type FieldRows, vegetationMask } from "../../src/lib/weedVision/fieldRows";
import { rowBandMask, PAINT_CROWN_MARGIN_M } from "../../src/lib/weedVision/layout/rowBand";
import { latLngOfPx } from "../../src/lib/weedVision/mapRun";
import { DEFAULT_STAGE1, cellAt, cellKey, readStage1 } from "../../src/lib/weedVision/twoStage/stage1";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = arg("dir")!, FRAME = "DJI_0301", DENSE = Number(arg("dense", "3"));
const d = join(DIR, FRAME);
const meta = JSON.parse(readFileSync(join(d, "meta.json"), "utf8"));
const rows: FieldRows = JSON.parse(readFileSync(join(d, "layout-rows.json"), "utf8"));
const r23 = { X0: meta.z23.X0, Y0: meta.z23.Y0, w: meta.z23.w, h: meta.z23.h, rgba: new Uint8Array(readFileSync(join(d, "z23.rgba"))) };
const r22 = { X0: meta.z22.X0, Y0: meta.z22.Y0, w: meta.z22.w, h: meta.z22.h, rgba: new Uint8Array(readFileSync(join(d, "z22.rgba"))) };
function slice(r: typeof r23, gx: number, gy: number, w: number, h: number): PhotoPixels {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) { const sy = gy + y - r.Y0; if (sy < 0 || sy >= r.h) continue; const x0 = Math.max(0, r.X0 - gx), x1 = Math.min(w, r.X0 + r.w - gx); if (x1 <= x0) continue; const s = (sy * r.w + (gx + x0 - r.X0)) * 4; out.set(r.rgba.subarray(s, s + (x1 - x0) * 4), (y * w + x0) * 4); }
  return { width: w, height: h, rgba: out };
}
const draw = async (_t: unknown, z: number, gx: number, gy: number, w: number, h: number) => (z === 23 ? slice(r23, gx, gy, w, h) : z === 22 ? slice(r22, gx, gy, w, h) : null);
const { X0, Y0, w, h } = meta.z23;
const ring: LatLng2[] = [latLngOfPx(X0, Y0, 23), latLngOfPx(X0 + w, Y0, 23), latLngOfPx(X0 + w, Y0 + h, 23), latLngOfPx(X0, Y0 + h, 23)];

const s1 = (await readStage1({ rings: [ring], tile: () => "", maxNative: 23, lat: meta.lat, rows, draw: draw as never }))!;
const g = s1.grid;
// Off-row green blobs per cell at the grid's zoom: components of the vegetation mask outside the crop band.
const px = (await draw(null, g.z, g.left, g.top, g.nx * g.cellPx, g.ny * g.cellPx))!;
const W = px.width, H = px.height;
const veg = vegetationMask(px);
const band = rowBandMask(rows, g.z, g.left, g.top, W, H, PAINT_CROWN_MARGIN_M / rows.mpp);
const seen = new Uint8Array(W * H);
const blobs = new Map<string, number>(), blobArea = new Map<string, number>();
const minPx = Math.max(1, Math.round(0.003 / (g.mpp * g.mpp))); // 30 cm² at the grid's pixel
for (let s = 0; s < W * H; s++) {
  if (!veg[s] || band[s] || seen[s]) continue;
  const stack = [s]; seen[s] = 1; let n = 0, sx = 0, sy = 0;
  while (stack.length) { const i = stack.pop()!; const x = i % W, y = (i - x) / W; n++; sx += x; sy += y; for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const j = yy * W + xx; if (veg[j] && !band[j] && !seen[j]) { seen[j] = 1; stack.push(j); } } }
  if (n < minPx) continue;
  const c = cellAt(g, g.left + sx / n, g.top + sy / n); if (!c) continue;
  const k = cellKey(c.i, c.j); blobs.set(k, (blobs.get(k) ?? 0) + 1); blobArea.set(k, (blobArea.get(k) ?? 0) + n * g.mpp * g.mpp);
}
// Truth.
const count = new Map<string, number>();
for (const l of (meta.labels as { cls: string; X: number; Y: number }[]).filter(x => x.cls === "weed")) { const f = 2 ** (23 - g.z); const c = cellAt(g, l.X / f, l.Y / f); if (c) { const k = cellKey(c.i, c.j); count.set(k, (count.get(k) ?? 0) + 1); } }
const cells = s1.cells;
const dense = new Set(cells.filter(c => (count.get(c.key) ?? 0) >= DENSE).map(c => c.key));
const withAny = new Set(cells.filter(c => (count.get(c.key) ?? 0) >= 1).map(c => c.key));
const rank = (v: number[]) => { const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]); const out = new Array(v.length).fill(0); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const rr = (i + j) / 2 + 1; for (let k = i; k <= j; k++) out[idx[k][1]] = rr; i = j + 1; } return out; };
const spearman = (a: number[], b: number[]) => { const ra = rank(a), rb = rank(b); const ma = ra.reduce((s, x) => s + x, 0) / ra.length, mb = rb.reduce((s, x) => s + x, 0) / rb.length; let num = 0, da = 0, db = 0; for (let i = 0; i < ra.length; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; } return num / Math.sqrt(da * db); };
const truth = cells.map(c => count.get(c.key) ?? 0);
const signals: Record<string, number[]> = {
  "off-row green share (Stage 1)": cells.map(c => c.pressure),
  "off-row blobs per cell": cells.map(c => blobs.get(c.key) ?? 0),
  "blob area (30 cm2 floor)": cells.map(c => blobArea.get(c.key) ?? 0),
  "share x blobs": cells.map(c => c.pressure * (1 + (blobs.get(c.key) ?? 0))),
  "random": cells.map(() => Math.random()),
};
console.log(JSON.stringify({ frame: FRAME, cells: cells.length, cellM: s1.params.cellM, readZoom: g.z, mpp: +g.mpp.toFixed(3), labelledWeeds: truth.reduce((a, b) => a + b, 0), cellsWithAny: withAny.size, denseCells: dense.size, denseAt: DENSE, stage1Ms: Math.round(s1.ms), candidates: s1.hotspots.length, candidateCells: s1.hotspots.reduce((a, hh) => a + hh.cells.length, 0), uncertain: s1.summary.reasons }));
const cand = new Set(s1.hotspots.flatMap(hh => hh.cells));
console.log("candidate areas catch: dense cells", [...dense].filter(k => cand.has(k)).length, "/", dense.size, "; cells with any label", [...withAny].filter(k => cand.has(k)).length, "/", withAny.size, "; candidate cells with no label", [...cand].filter(k => !withAny.has(k)).length, "/", cand.size);
for (const [name, v] of Object.entries(signals)) {
  const order = v.map((x, i) => [x, i] as const).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  const at = (share: number) => { const top = new Set(order.slice(0, Math.round(share * cells.length)).map(i => cells[i].key)); return `${[...dense].filter(k => top.has(k)).length}/${dense.size}`; };
  console.log(`${name.padEnd(30)} spearman ${spearman(v, truth).toFixed(2)}  dense cells in top 10/20/30%: ${at(0.1)} ${at(0.2)} ${at(0.3)}`);
}
console.log("cell floor sweep (off-row green share): candidate cells / dense caught / with-any caught");
for (const floor of [0.05, 0.03, 0.02, 0.01]) { const on = new Set(cells.filter(c => c.pressure >= floor).map(c => c.key)); console.log(`  ${floor}: ${on.size} / ${[...dense].filter(k => on.has(k)).length} of ${dense.size} / ${[...withAny].filter(k => on.has(k)).length} of ${withAny.size}`); }
void DEFAULT_STAGE1;
