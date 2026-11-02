// Probe: the size of each audited off-row candidate against the stand's own seedlings (read-only).
//   npx vite-node scripts/rowCrop/weedSizeProbe.ts -- --audit directtestimagery/validation-2026-11-02/emergence/visual-audit.csv
import "../bench/nodeStorageShim";
import { readFileSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readRowCrop } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";

const argv = process.argv.slice(2);
const audit = argv[argv.indexOf("--audit") + 1];
const lines = readFileSync(audit, "utf8").trim().split(/\r?\n/), head = lines[0].split(",");
const col = (n: string) => head.indexOf(n);
const rows = lines.slice(1).map(l => l.split(",")).filter(r => r[col("class")] === "weed");
const files = new Map(readdirSync("directtestimagery/veryearlystage").filter(f => /\.jpg$/i.test(f)).map(f => [basename(f, extname(f)), f]));
const byPhoto = new Map<string, string[][]>(); for (const r of rows) { const p = r[col("photo")]; (byPhoto.get(p) ?? byPhoto.set(p, []).get(p)!).push(r); }
for (const [p, rs] of byPhoto) {
  const raw = decodeImage(new Uint8Array(readFileSync(join("directtestimagery/veryearlystage", files.get(p) ?? files.get(p + "young") ?? `${p}.JPG`))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const read = readRowCrop(px, rowCropParamsFor(cropProfileFor("corn"), null, "emergence"));
  for (const r of rs) {
    const x = Number(r[col("x")]), y = Number(r[col("y")]);
    const w = read.weeds.reduce((b, q) => (Math.hypot(q.x - x, q.y - y) < Math.hypot(b.x - x, b.y - y) ? q : b), read.weeds[0]);
    const d = w ? Math.hypot(w.x - x, w.y - y) : NaN;
    console.log([p, x, y, r[col("visual_code")], r[col("judgement")], d < 15 ? (Math.PI * (w.equivDiameterM * 50) ** 2).toFixed(0) : "gone", d < 15 ? ((w.distToRowM ?? NaN) * 100).toFixed(1) : "", w?.status ?? "", JSON.stringify(read.emergence?.seedlingAreaCm2)].join("\t"));
  }
}
