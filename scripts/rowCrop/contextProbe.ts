// Probe: the reader's marks around given points of a stage's photographs, for checking a change by eye. Each cell is a
// crop of the original (half-size `half` photo px) with the read drawn thinly: rows cyan, plants white dots, possible
// blue, weed outlines red, excluded ground yellow; the point itself is ringed in magenta.
//   npx vite-node scripts/rowCrop/contextProbe.ts -- --stage emergence --points "3:4563,2674;7:2408,3032" --out <png> [--half 200]
import "../bench/nodeStorageShim";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readRowCrop, rowCropOverlay, type RowCropStage } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const stage = arg("stage", "emergence")!, out = arg("out", "context.png")!, half = Number(arg("half", "200")), cols = Number(arg("cols", "6"));
const FOLDER: Record<string, string> = { emergence: "veryearlystage", establishment: "estabilishmentphase", mid: "midphase", late: "verylatestagecorn" };
const READER: Record<string, RowCropStage> = { emergence: "emergence", establishment: "establishment", mid: "mid", late: "late" };
const pts = (arg("pointsFile") ? readFileSync(arg("pointsFile")!, "utf8").trim() : arg("points", "")!).split(";").filter(Boolean).map(s => { const [p, xy] = s.split(":"); const [x, y] = xy.split(",").map(Number); return { p, x, y }; });
const S = 2 * half, rowsN = Math.ceil(pts.length / cols);
const sheet = new PNG({ width: cols * S, height: rowsN * S });
let cache: { p: string; px: PhotoPixels; ov: ReturnType<typeof rowCropOverlay> } | null = null;
pts.forEach(({ p, x, y }, k) => {
  if (!cache || cache.p !== p) {
    const raw = decodeImage(new Uint8Array(readFileSync(join("directtestimagery", FOLDER[stage], `${p}.JPG`))));
    const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
    cache = { p, px, ov: rowCropOverlay(readRowCrop(px, rowCropParamsFor(cropProfileFor("corn"), null, READER[stage]))) };
  }
  const { px, ov } = cache, ox = (k % cols) * S, oy = Math.floor(k / cols) * S, x0 = Math.round(x - half), y0 = Math.round(y - half);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const X = x0 + i, Y = y0 + j, q = ((oy + j) * sheet.width + ox + i) * 4;
    if (X < 0 || Y < 0 || X >= px.width || Y >= px.height) { sheet.data[q + 3] = 255; continue; }
    const s = (Y * px.width + X) * 4; sheet.data[q] = px.rgba[s]; sheet.data[q + 1] = px.rgba[s + 1]; sheet.data[q + 2] = px.rgba[s + 2]; sheet.data[q + 3] = 255;
  }
  const put = (X: number, Y: number, c: number[]) => { const i = Math.round(X - x0), j = Math.round(Y - y0); if (i < 0 || j < 0 || i >= S || j >= S) return; const q = ((oy + j) * sheet.width + ox + i) * 4; sheet.data[q] = c[0]; sheet.data[q + 1] = c[1]; sheet.data[q + 2] = c[2]; };
  const line = (a: [number, number], b: [number, number], c: number[]) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])); for (let t = 0; t <= n; t++) put(a[0] + ((b[0] - a[0]) * t) / Math.max(1, n), a[1] + ((b[1] - a[1]) * t) / Math.max(1, n), c); };
  const ring = (cx: number, cy: number, r: number, c: number[]) => { for (let a = 0; a < 64; a++) put(cx + r * Math.cos((a * Math.PI) / 32), cy + r * Math.sin((a * Math.PI) / 32), c); };
  const poly = (h: [number, number][], c: number[]) => { for (let i = 0; i < h.length; i++) line(h[i], h[(i + 1) % h.length], c); };
  for (const r of ov.rows) for (let i = 0; i + 1 < r.length; i++) line(r[i], r[i + 1], [0, 220, 255]);
  for (const h of ov.excluded) poly(h, [255, 230, 0]);
  for (const g of ov.gaps) for (const o of [-2, -1, 0, 1, 2]) line([g.x1 + o, g.y1], [g.x2 + o, g.y2], [255, 140, 0]);
  for (const e of ov.fieldEdges) for (let i = 0; i + 1 < e.length; i++) line(e[i], e[i + 1], [255, 255, 255]);
  for (const h of ov.smallGreen ?? []) poly(h, [150, 150, 150]);
  for (const h of [...ov.weeds, ...ov.escapes]) poly(h, [255, 40, 40]);
  for (const [a, b] of ov.plants) ring(a, b, 3, [255, 255, 255]);
  for (const [a, b] of ov.possible) ring(a, b, 3, [60, 120, 255]);
  for (const [a, b] of ov.missing) ring(a, b, 3, [255, 150, 0]);
  for (const [a, b] of ov.seedlings) ring(a, b, 5, [0, 255, 120]);
  ring(x, y, 22, [255, 0, 255]);
});
writeFileSync(out, PNG.sync.write(sheet));
console.log(`${pts.length} cells -> ${out}`);
