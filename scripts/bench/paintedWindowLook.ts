// One window as the model saw it with the rows painted over, and what it found, side by side with the unpainted
// window and its finds: npx vite-node scripts/bench/paintedWindowLook.ts -- --dir <trial dir> --frame DJI_0301 [--n 0]
import "./nodeStorageShim";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng } from "./images";
import { betweenRowsPainter } from "../../src/lib/weedVision/layout/rowBand";
import { chunkCanvas, mercatorPx } from "../../src/lib/weedVision/mapRun";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const d = join(arg("dir")!, arg("frame")!);
const meta = JSON.parse(readFileSync(join(d, "meta.json"), "utf8"));
const rows = JSON.parse(readFileSync(join(d, "layout-rows.json"), "utf8"));
const r23 = { X0: meta.z23.X0, Y0: meta.z23.Y0, w: meta.z23.w, h: meta.z23.h, rgba: new Uint8Array(readFileSync(join(d, "z23.rgba"))) };
const painted = JSON.parse(readFileSync(join(d, "window-cache-layout-m30.json"), "utf8")) as [string, { filename: string; detections: { klass: string; centre: { lat: number; lng: number }; ring: { lat: number; lng: number }[] | null }[] }][];
const plain = new Map((JSON.parse(readFileSync(join(d, "window-cache-layout-nopaint.json"), "utf8")) as typeof painted).map(([, v]) => [v.filename, v]));
// The window with the most painted detections near trees.
const pick = painted.map(([, v]) => v).sort((a, b) => b.detections.length - a.detections.length)[Number(arg("n", "0"))];
const [, wz, size, cxy] = pick.filename.split("/");
const [cx, cy] = cxy.split("_").map(Number);
const S = Number(size.slice(1));
const chunk = { name: pick.filename, z: Number(wz.slice(1)), x0: cx * S, y0: cy * S, size: S, overlap: 96 };
const cv = chunkCanvas(chunk);
const W = cv.width, H = cv.height;
const cut = () => { const out = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const sx = cv.left + x - r23.X0, sy = cv.top + y - r23.Y0; if (sx < 0 || sy < 0 || sx >= r23.w || sy >= r23.h) continue; out.set(r23.rgba.subarray((sy * r23.w + sx) * 4, (sy * r23.w + sx) * 4 + 4), (y * W + x) * 4); } return out; };
const a = cut(), b = cut();
betweenRowsPainter(rows)(b, W, H, cv.left, cv.top, chunk.z);
const img = new Uint8Array(W * 2 * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { img.set(a.subarray((y * W + x) * 4, (y * W + x) * 4 + 4), (y * 2 * W + x) * 4); img.set(b.subarray((y * W + x) * 4, (y * W + x) * 4 + 4), (y * 2 * W + W + x) * 4); }
const set = (x: number, y: number, c: number[]) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= 2 * W || y >= H) return; const o = (y * 2 * W + x) * 4; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; img[o + 3] = 255; };
const drawRing = (ring: { lat: number; lng: number }[], dx: number, c: number[]) => {
  const p = ring.map(q => { const [X, Y] = mercatorPx(q.lat, q.lng, chunk.z); return [X - cv.left + dx, Y - cv.top]; });
  for (let k = 0; k < p.length; k++) { const [x1, y1] = p[k], [x2, y2] = p[(k + 1) % p.length]; const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1)); for (let t = 0; t <= n; t++) set(x1 + ((x2 - x1) * t) / n, y1 + ((y2 - y1) * t) / n, c); }
};
for (const det of plain.get(pick.filename)?.detections ?? []) if (det.klass === "weed" && det.ring) drawRing(det.ring, 0, [255, 230, 0]);
for (const det of pick.detections) if (det.klass === "weed" && det.ring) drawRing(det.ring, W, [255, 230, 0]);
writeFileSync(join(d, "painted-window.png"), encodePng({ width: 2 * W, height: H, data: img }));
console.log(pick.filename, "plain", plain.get(pick.filename)?.detections.length, "painted", pick.detections.length);
