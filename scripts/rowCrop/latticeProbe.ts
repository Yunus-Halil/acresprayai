// Probe: for off-row candidates near a row, where they stand along the row against the row's own plants (read-only).
//   npx vite-node scripts/rowCrop/latticeProbe.ts -- --pointsFile <photo:x,y,code;...>
import "../bench/nodeStorageShim";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readRowCrop } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
const argv = process.argv.slice(2);
const pts = readFileSync(argv[argv.indexOf("--pointsFile") + 1], "utf8").trim().split(";").map(s => { const [p, r] = s.split(":"); const [x, y, c] = r.split(","); return { p, x: +x, y: +y, c }; });
const byP = new Map<string, typeof pts>(); for (const q of pts) (byP.get(q.p) ?? byP.set(q.p, []).get(q.p)!).push(q);
for (const [p, qs] of byP) {
  const raw = decodeImage(new Uint8Array(readFileSync(join("directtestimagery/veryearlystage", `${p}.JPG`))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const read = readRowCrop(px, rowCropParamsFor(cropProfileFor("corn"), null, "emergence"));
  const cm = read.gsdM * 100;
  for (const q of qs) {
    // Nearest row by its polyline; along that row, the plants (plant + possible points) sorted by projection.
    let best = { d: Infinity, ri: -1, ux: 0, uy: 1 };
    read.rows.forEach((r, ri) => { for (let i = 0; i + 1 < r.points.length; i++) { const [ax, ay] = r.points[i], [bx, by] = r.points[i + 1], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((q.x - ax) * vx + (q.y - ay) * vy) / L2)), d = Math.hypot(q.x - ax - t * vx, q.y - ay - t * vy); if (d < best.d) { const L = Math.sqrt(L2); best = { d, ri, ux: vx / L, uy: vy / L }; } } });
    const r = read.rows[best.ri], plants = [...(r.plantPoints ?? []), ...(r.possiblePoints ?? [])];
    const along = plants.map(([x, y]) => (x - q.x) * best.ux + (y - q.y) * best.uy).filter((_, k) => { const [x, y] = plants[k]; return Math.abs(-(x - q.x) * best.uy + (y - q.y) * best.ux) < 0.2 / read.gsdM; });
    const before = Math.max(...along.filter(a => a < 0)), after = Math.min(...along.filter(a => a >= 0));
    const sp = 16 / cm;
    console.log(`${q.c} photo ${p} across ${(best.d * cm).toFixed(1)} cm, nearest plant along ${(Math.min(-before, after) * cm).toFixed(1)} cm, slot ${((after - before) / sp).toFixed(2)} spacings`);
  }
}
