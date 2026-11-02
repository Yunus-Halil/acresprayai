// Probe: field ends near given points with an EDGE rule on and off (read-only).
//   npx vite-node scripts/rowCrop/edgeRuleProbe.ts -- --points "42:1591,169;73:2823,294" --rule bothAlleysGreen --off 99
import "../bench/nodeStorageShim";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { EDGE, readRowCrop } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const pts = arg("points", "")!.split(";").filter(Boolean).map(s => { const [p, xy] = s.split(":"); const [x, y] = xy.split(",").map(Number); return { p, x, y }; });
const rule = arg("rule", "bothAlleysGreen")! as keyof typeof EDGE, off = JSON.parse(arg("off", "99")!);
const on = EDGE[rule];
for (const { p, x, y } of pts) {
  const raw = decodeImage(new Uint8Array(readFileSync(join("directtestimagery/estabilishmentphase", `${p}.JPG`))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const out: string[] = [];
  for (const v of [on, off]) {
    (EDGE as Record<string, unknown>)[rule] = v;
    const read = readRowCrop(px, rowCropParamsFor(cropProfileFor("corn"), null, "establishment"));
    const e = read.fieldEdge!.ends.reduce((b, q) => (Math.hypot(q.x - x, q.y - y) < Math.hypot(b.x - x, b.y - y) ? q : b), read.fieldEdge!.ends[0]);
    out.push(`${rule}=${v}: nearest end ${Math.round(e.x)},${Math.round(e.y)} (${Math.round(Math.hypot(e.x - x, e.y - y))} px)`);
  }
  (EDGE as Record<string, unknown>)[rule] = on;
  console.log(`${p} @${x},${y}: ${out.join(" | ")}`);
}
