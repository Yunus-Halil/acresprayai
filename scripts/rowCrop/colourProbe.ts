// Probe: the colour inside each audited off-row patch (read-only). For every point, the patch the reader draws there
// (any tier), and over the seedling-mask pixels inside its outline: how many, the share clearly green against the
// soil (tint over the local soil's by SEEDLING_GREEN.strongTint), the mean G - R, the mean tint over the soil.
//   npx vite-node scripts/rowCrop/colourProbe.ts -- --pointsFile <photo:x,y,code;...>
import "../bench/nodeStorageShim";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readRowCrop } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { SEEDLING_GREEN, seedlingMask, soilLevels } from "../../src/lib/rowCrop/seedlingGreen";
const argv = process.argv.slice(2);
const pts = readFileSync(argv[argv.indexOf("--pointsFile") + 1], "utf8").trim().split(";").map(s => { const [p, r] = s.split(":"); const [x, y, c] = r.split(","); return { p, x: +x, y: +y, c }; });
const byP = new Map<string, typeof pts>(); for (const q of pts) (byP.get(q.p) ?? byP.set(q.p, []).get(q.p)!).push(q);
const inPoly = (h: [number, number][], x: number, y: number) => { let c = false; for (let i = 0, j = h.length - 1; i < h.length; j = i++) { const [xi, yi] = h[i], [xj, yj] = h[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
for (const [p, qs] of byP) {
  const f = existsSync(join("directtestimagery/veryearlystage", `${p}.JPG`)) ? `${p}.JPG` : `${p}young.JPG`;
  const raw = decodeImage(new Uint8Array(readFileSync(join("directtestimagery/veryearlystage", f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const read = readRowCrop(px, rowCropParamsFor(cropProfileFor("corn"), null, "emergence"));
  const lv = soilLevels(px), m = seedlingMask(px, SEEDLING_GREEN, lv), W = px.width, d = px.rgba;
  for (const q of qs) {
    const w = read.weeds.find(w => Math.hypot(w.x - q.x, w.y - q.y) < 15);
    if (!w) { console.log(`${q.c}\t${p}\tgone`); continue; }
    const xs = w.hull.map(h => h[0]), ys = w.hull.map(h => h[1]);
    let n = 0, strong = 0, gr = 0, tint = 0;
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      if (x < 0 || y < 0 || x >= W || y >= px.height || !m[y * W + x] || !inPoly(w.hull, x + 0.5, y + 0.5)) continue;
      const o = (y * W + x) * 4, c = Math.floor(y / lv.B) * lv.gw + Math.floor(x / lv.B), t = d[o + 1] - (d[o] + d[o + 2]) / 2 - lv.soilT[c];
      n++; gr += d[o + 1] - d[o]; tint += t; if (t > SEEDLING_GREEN.strongTint) strong++;
    }
    console.log(`${q.c}\t${p}\t${w.tier === "small green" ? "grey" : "red"}\t${Math.round(w.areaM2 * 1e4)} cm2\tpx ${n}\tstrong ${(strong / Math.max(1, n)).toFixed(2)}\tG-R ${(gr / Math.max(1, n)).toFixed(1)}\ttint ${(tint / Math.max(1, n)).toFixed(1)}`);
  }
}
