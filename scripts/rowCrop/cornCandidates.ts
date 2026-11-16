// Development only: the second-look candidates of a stored corn flight (an analysis record plus its photographs), read
// exactly as a build reads them (cornV1.ts readCornV1: only on a photograph where the dark-leaf rule applies), kept in
// a cache one file a photograph. The record is not touched; the photographs are only read. Run by range in several
// processes. The scoreboard (cornScoreboard.ts) joins the cache to the record's reads.
//
//   npx vite-node scripts/rowCrop/cornCandidates.ts -- --analysis <analysis.json> --photos <dir> --cache <dir> [--range 0:40]
//
// Each cache file holds: `applies` (the build would carry candidates for this photograph), `low` (the candidates as a
// build makes them today, long pieces split at the assumed plant spacing), `lowWhole` + `span` + `axis` (the same
// pieces unsplit, with their extent along the photograph's rows: Corn V1's `rowSpans`), and `plantsMatch` (whether the
// plants read now equal the record's, so the record's reads and the cache belong together).
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "../bench/images";
import { groundSampleAt } from "../../src/lib/directGeoref/projection";
import { compactCornRead } from "../../src/lib/fieldTwin/cornField";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { readCornV1 } from "../../src/lib/rowCrop/cornV1";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, DIR = arg("photos"), CACHE = arg("cache");
const frames = framesFromAnalysis(A);
mkdirSync(CACHE, { recursive: true });
const [a, b] = (opt("range") ?? `0:${A.reads.length}`).split(":").map(Number);
// A photograph's file: its name in the folder, or (a record whose names join folder and file) the first "_" as a folder.
const fileOf = (name: string) => [name, name.replace("_", "/")].flatMap(n => [".JPG", ".jpg", ".jpeg", ".JPEG"].map(e => join(DIR, n + e))).find(existsSync);
for (const r of A.reads.slice(a, b)) {
  const out = join(CACHE, `${r.name}.json`);
  if (existsSync(out)) continue;
  const f = frames.get(r.name), path = fileOf(r.name);
  if (!f || !path) { console.log(`${r.name}: no camera or no photograph, skipped`); continue; }
  if (r.scale !== 1) { console.log(`${r.name}: read at scale ${r.scale}, skipped (the cache is for full-size reads)`); continue; }
  const t0 = Date.now();
  const img = decodeImage(new Uint8Array(readFileSync(path)));
  const px = { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
  const t1 = Date.now();
  const gsd = groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy), params = rowCropParamsFor(cropProfileFor("corn")!, gsd);
  const today = compactCornRead(r.name, readCornV1(px, params, { enteredCrop: "corn" }), 1);
  const t2 = Date.now();
  const spans = today.low ? compactCornRead(r.name, readCornV1(px, params, { enteredCrop: "corn", rowSpans: true }), 1) : null;
  const plantsMatch = today.plants.length === r.plants.length && today.plants.every((p, i) => p[0] === r.plants[i][0] && p[1] === r.plants[i][1]);
  writeFileSync(out, JSON.stringify({ name: r.name, applies: !!today.low, plantsMatch, plantsNow: today.plants.length, plantsRecord: r.plants.length, low: today.low ?? [], lowWhole: spans?.low ?? [], span: spans?.lowSpan ?? [], axis: spans?.lowAxis ?? null, readMs: t2 - t1 }));
  console.log(`${r.name}: ${r.plants.length} marks in the record, ${today.plants.length} now (${plantsMatch ? "equal" : "DIFFERENT"}); candidates ${today.low ? today.low.length : "not made (not seedlings on soil)"}; read ${t2 - t1} ms, decode ${t1 - t0} ms`);
}
