// Probe: the emergence tier of the off-row patch at each given point (read-only).
//   npx vite-node scripts/rowCrop/tierProbe.ts -- --pointsFile <photo:x,y,code;...>
import "../bench/nodeStorageShim";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readRowCrop } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
const argv = process.argv.slice(2);
const pts = readFileSync(argv[argv.indexOf("--pointsFile") + 1], "utf8").trim().split(";").map(s => { const [p, r] = s.split(":"); const [x, y, c] = r.split(","); return { p, x: +x, y: +y, c }; });
const byP = new Map<string, typeof pts>(); for (const q of pts) (byP.get(q.p) ?? byP.set(q.p, []).get(q.p)!).push(q);
const tally: Record<string, number> = {};
for (const [p, qs] of byP) {
  const f = existsSync(join("directtestimagery/veryearlystage", `${p}.JPG`)) ? `${p}.JPG` : `${p}young.JPG`;
  const raw = decodeImage(new Uint8Array(readFileSync(join("directtestimagery/veryearlystage", f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const read = readRowCrop(px, rowCropParamsFor(cropProfileFor("corn"), null, "emergence"));
  for (const q of qs) {
    const w = read.weeds.find(w => Math.hypot(w.x - q.x, w.y - q.y) < 15);
    const k = `${q.c} -> ${w ? (w.tier === "small green" ? "grey" : "red") : "gone"}`;
    tally[k] = (tally[k] ?? 0) + 1;
  }
}
console.log(Object.entries(tally).sort().map(([k, v]) => `${k}: ${v}`).join("\n"));
