// Positions of the weed candidates the detector-led rows (D) take off the list, for eye checks: writes
// <out> as {photo: {absorbed: [[x, y]], kept: [[x, y]]}} in the sheet format of positions.json.
//   npx vite-node scripts/rowCrop/plantRowAbsorbed.ts --images <dir> --masc <dir> --out <file.json> [--factor 3]
import "../bench/nodeStorageShim";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readCornAdaptive } from "../../src/lib/rowCrop/adaptive";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { detectorLedRows } from "../../src/lib/rowCrop/plantRows";

const argv = process.argv.slice(2), arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const IMAGES = arg("images")!, MASC = arg("masc")!, OUT = arg("out")!, FACTOR = arg("factor", "3");
const out: Record<string, { absorbed: [number, number][]; kept: [number, number][] }> = {};
for (const f of readdirSync(IMAGES).filter(f => /\.(jpe?g|png)$/i.test(f))) {
  const stem = basename(f, extname(f)), mf = join(MASC, `${stem}.f${FACTOR}.json`); if (!existsSync(mf)) continue;
  const raw = decodeImage(new Uint8Array(readFileSync(join(IMAGES, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const ad = readCornAdaptive(px, rowCropParamsFor(cropProfileFor("corn")!, null));
  const p = ad.plans.filter(q => q.read).sort((u, v) => v.ownedShare - u.ownedShare)[0], r = p?.read;
  const pitch = r && r.pitchM && Number.isFinite(r.gsdM) ? r.pitchM / r.gsdM : p?.pitchPx ?? null;
  const cand = ad.weeds.filter(w => w.verdict === "weed candidate");
  const det = (JSON.parse(readFileSync(mf, "utf8")).boxes as number[][]).filter(b => b[4] >= 0.3).map(b => ({ x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 }));
  const D = detectorLedRows({ rows: ad.rows, directionDeg: ad.directionDeg, pitchPx: pitch }, det, cand.map(w => [w.x, w.y]));
  const ab = new Set(D.onRows);
  out[stem] = { absorbed: cand.filter((_, i) => ab.has(i)).map(w => [Math.round(w.x), Math.round(w.y)]), kept: cand.filter((_, i) => !ab.has(i)).map(w => [Math.round(w.x), Math.round(w.y)]) };
  console.log(stem, ab.size);
}
writeFileSync(OUT, JSON.stringify(out));
