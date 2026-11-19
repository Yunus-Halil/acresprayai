// Development only, read-only: the share of each row's length that has green on it (cornV1.ts rowGreenCover), the
// measure the emergence guard reads (CORN_COUNT_GUARD), on a few photographs of a stored flight or on one photograph
// alone. The read is made with the guard and the cores off, so the measure is of the read as it stands.
//
//   npx vite-node scripts/rowCrop/cornRowCover.ts -- --flight <label> --analysis <analysis.json> --photos <dir> --out <file.json> [--pick 5]
//   npx vite-node scripts/rowCrop/cornRowCover.ts -- --flight <label> --photo <file> --out <file.json>
//
// --pick n: n photographs evenly through the flight by name order (the middle of each of n equal parts).
import "../bench/nodeStorageShim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "../bench/images";
import { groundSampleAt } from "../../src/lib/directGeoref/projection";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { CORN_COUNT_GUARD, cornV1RowCover, readCornV1 } from "../../src/lib/rowCrop/cornV1";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
const FLIGHT = arg("flight"), OUT = arg("out");
const jobs: { name: string; path: string; gsd: number | null }[] = [];
if (opt("photo")) jobs.push({ name: opt("photo")!.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, ""), path: opt("photo")!, gsd: null });
else {
  const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, DIR = arg("photos"), frames = framesFromAnalysis(A), n = Number(opt("pick") ?? 5);
  const fileOf = (name: string) => [name, name.replace("_", "/")].flatMap(m => [".JPG", ".jpg", ".jpeg", ".JPEG"].map(e => join(DIR, m + e))).find(existsSync);
  const names = A.reads.map(r => r.name).filter(m => frames.has(m) && fileOf(m)).sort();
  for (let k = 0; k < n; k++) { const name = names[Math.min(names.length - 1, Math.floor(((k + 0.5) * names.length) / n))], f = frames.get(name)!; jobs.push({ name, path: fileOf(name)!, gsd: groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy) }); }
}
const q = (xs: number[], f: number) => { const t = [...xs].sort((a, b) => a - b); return t.length ? t[Math.min(t.length - 1, Math.floor(f * t.length))] : null; };
const out = jobs.map(j => {
  const img = decodeImage(new Uint8Array(readFileSync(j.path)));
  const px = { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
  const v = readCornV1(px, rowCropParamsFor(cropProfileFor("corn")!, j.gsd), { enteredCrop: "corn", cores: false, countGuard: false }), c = cornV1RowCover(px, v);
  const row = { flight: FLIGHT, photo: j.name, rows: v.rows.length, rowsMeasured: c.perRow.length, rowSpacingPx: c.pitchPx, bandPx: c.pitchPx ? Math.round(CORN_COUNT_GUARD.bandShare * c.pitchPx) : null, share: c.share, perRow: { lowest: q(c.perRow, 0), lowQuarter: q(c.perRow, 0.25), median: q(c.perRow, 0.5), highQuarter: q(c.perRow, 0.75), highest: q(c.perRow, 1) }, marks: v.plants.points.length, plans: v.green.plans.map(p => `${p.stage} ${(p.ownedShare * 100).toFixed(0)} %`) };
  console.log(`${FLIGHT} ${j.name}: ${row.rows} rows, row spacing ${c.pitchPx?.toFixed(0) ?? "none"} px, green on ${c.share == null ? "-" : (c.share * 100).toFixed(1) + " %"} of the rows' length (rows: ${row.perRow.lowest?.toFixed(2)} to ${row.perRow.highest?.toFixed(2)}, median ${row.perRow.median?.toFixed(2)}); plans ${row.plans.join(", ")}`);
  return row;
});
writeFileSync(OUT, JSON.stringify(out, null, 1));
