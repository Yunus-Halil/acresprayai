// Find weeds on the map, request by request, as the app sent it before the 2026-10-19 quick wins and as it sends it now.
//
//   npx vite-node scripts/bench/mapRunEndToEnd.ts -- --dir <trial dir> --frames DJI_0301 --mode before --service http://127.0.0.1:8766
//   npx vite-node scripts/bench/mapRunEndToEnd.ts -- --dir <trial dir> --frames DJI_0301 --mode after  --service http://127.0.0.1:8765
//
// before: each 1536 px chunk (plus 96 px overlap) enlarged 1.5x (bilinear here; the browser's "high" smoothing),
//         JPEG q95, tiles 1024 / 256, full geometry, service code of commit fd54060
// after:  the chunk at its own pixels, JPEG q95, tiles 680 / 171 (mapTiling), lite geometry, current service
// Both: the same chunks of the same stand-in map (prep_two_stage_trial.py), the app's groundMapResult, and the
// stored JSON as the app would write it (after: compactDetection). The JPEG encoder here is JavaScript (jpeg-js),
// far slower than a browser's, so its time is reported apart from the request.
import "./nodeStorageShim";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeJpeg } from "./images";
import type { LatLng2 } from "../../src/lib/geo";
import type { WeedVisionResult } from "../../src/lib/weedVision/client";
import { compactDetection } from "../../src/lib/weedVision/frameRunCache";
import { MIN_COVERAGE, chunkCanvas, groundMapResult, latLngOfPx, mapTiling, planMapChunks, upscaleFor } from "../../src/lib/weedVision/mapRun";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = arg("dir")!, FRAMES = (arg("frames") ?? "").split(",").filter(Boolean), MODE = arg("mode") as "before" | "after", SERVICE = arg("service")!;
const PARAMS = { algorithm: "rfdetr_seg_large", threshold: 0.5, tile: 1024, overlap: 256, scale: 1 };

type Img = { width: number; height: number; data: Uint8Array };
function slice(r: Img & { X0: number; Y0: number }, gx: number, gy: number, w: number, h: number): Img {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = gy + y - r.Y0;
    if (sy < 0 || sy >= r.height) continue;
    const x0 = Math.max(0, r.X0 - gx), x1 = Math.min(w, r.X0 + r.width - gx);
    if (x1 <= x0) continue;
    const s = (sy * r.width + (gx + x0 - r.X0)) * 4;
    out.set(r.data.subarray(s, s + (x1 - x0) * 4), (y * w + x0) * 4);
  }
  return { width: w, height: h, data: out };
}
function bilinear(src: Img, k: number): Img {
  const W = Math.round(src.width * k), H = Math.round(src.height * k);
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(src.height - 1, Math.max(0, (y + 0.5) / k - 0.5)), y0 = Math.floor(fy), y1 = Math.min(src.height - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(src.width - 1, Math.max(0, (x + 0.5) / k - 0.5)), x0 = Math.floor(fx), x1 = Math.min(src.width - 1, x0 + 1), tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const a = src.data[(y0 * src.width + x0) * 4 + c], b = src.data[(y0 * src.width + x1) * 4 + c], d = src.data[(y1 * src.width + x0) * 4 + c], e = src.data[(y1 * src.width + x1) * 4 + c];
        out[(y * W + x) * 4 + c] = Math.round((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty);
      }
    }
  }
  return { width: W, height: H, data: out };
}

async function main() {
  const rows = [];
  for (const frame of FRAMES) {
    const d = join(DIR, frame);
    const meta = JSON.parse(readFileSync(join(d, "meta.json"), "utf8"));
    const r = { ...meta.z23, width: meta.z23.w, height: meta.z23.h, data: new Uint8Array(readFileSync(join(d, "z23.rgba"))) };
    const { X0, Y0, w, h } = meta.z23;
    const ring: LatLng2[] = [latLngOfPx(X0, Y0, 23), latLngOfPx(X0 + w, Y0, 23), latLngOfPx(X0 + w, Y0 + h, 23), latLngOfPx(X0, Y0 + h, 23)];
    const upscale = upscaleFor(meta.mpp23, meta.gsd_m);
    const tiling = MODE === "after" ? mapTiling(PARAMS, upscale) : { tile: PARAMS.tile, overlap: PARAMS.overlap };
    const dets = [];
    for (const chunk of planMapChunks([ring], 23)) {
      const cv = chunkCanvas(chunk);
      const px = slice(r, cv.left, cv.top, cv.width, cv.height);
      let covered = 0;
      for (let i = 3; i < px.data.length; i += 4) if (px.data[i] > 0) covered++;
      if (covered / (cv.width * cv.height) < MIN_COVERAGE) continue;
      let t = performance.now();
      const img = MODE === "before" ? bilinear(px, upscale) : px;
      const jpeg = encodeJpeg(img, 95);
      const prepMs = performance.now() - t;
      const fd = new FormData();
      fd.append("image", new Blob([jpeg], { type: "image/jpeg" }), `${chunk.name.replace(/\//g, "_")}.jpg`);
      const form: Record<string, string> = { algorithm: PARAMS.algorithm, scale: "1", tile: String(tiling.tile), overlap: String(tiling.overlap), threshold: String(PARAMS.threshold), include_crop: "1" };
      if (MODE === "after") form.geometry = "lite";
      for (const [k, v] of Object.entries(form)) fd.append(k, v);
      t = performance.now();
      const res = await fetch(`${SERVICE}/weed-vision/detect`, { method: "POST", body: fd });
      const text = await res.text();
      const requestMs = performance.now() - t;
      if (!res.ok) throw new Error(text.slice(0, 300));
      t = performance.now();
      const j = JSON.parse(text) as WeedVisionResult;
      const g = groundMapResult({ chunk, result: j, upscale: MODE === "before" ? upscale : 1, rows: null, lat: meta.lat });
      const placeMs = performance.now() - t;
      const stored = JSON.stringify(MODE === "after" ? g.map(compactDetection) : g).length;
      dets.push(...g.map(x => ({ klass: x.klass, lat: x.centre?.lat, lng: x.centre?.lng, areaM2: x.areaM2 })));
      rows.push({ frame, chunk: chunk.name, mode: MODE, canvasPx: img.width, uploadKb: Math.round(jpeg.length / 1024), prepMsNodeJs: Math.round(prepMs), requestMs: Math.round(requestMs), serviceMs: j.timings_ms?.total, tiles: j.processing?.tiles, responseKb: Math.round(text.length / 1024), parseAndPlaceMs: Math.round(placeMs), storedKb: Math.round(stored / 1024), weeds: g.filter(x => x.klass === "weed").length, crops: g.filter(x => x.klass === "crop").length });
      console.log(JSON.stringify(rows[rows.length - 1]));
    }
    writeFileSync(join(d, `e2e-${MODE}-detections.json`), JSON.stringify(dets));
  }
  writeFileSync(join(DIR, `e2e-${MODE}.json`), JSON.stringify(rows, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
