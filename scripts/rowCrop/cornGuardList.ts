// Development only, read-only (FINAL-3.md Part 1): every photograph the emergence guard withholds, and why, on a
// stored flight read with the guard on (cornInspect.ts reads --read '{"countGuard":true,...}'), through the guard over
// the flight (fieldTwin/cornField.ts cornFlightGuard); or on one photograph alone (the cut only: no flight).
//
//   npx vite-node scripts/rowCrop/cornGuardList.ts -- --flight <label> --analysis <a.json> --reads <readsDir> --out <file.json>
//   npx vite-node scripts/rowCrop/cornGuardList.ts -- --flight <label> --photo <file> --out <file.json> [--read <json>]
import "../bench/nodeStorageShim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "../bench/images";
import type { TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { type CornPhotoRead, cornFlightGuard } from "../../src/lib/fieldTwin/cornField";
import { CORN_CORES, CORN_COUNT_GUARD, readCornV1 } from "../../src/lib/rowCrop/cornV1";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { HEADER_BYTES, estimateGsd, parsePhotoHeader } from "../../src/lib/photoScout/exif";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
const FLIGHT = arg("flight"), OUT = arg("out");
if (opt("photo")) {
  const READ = opt("read") ? (JSON.parse(opt("read")!) as { cores?: boolean }) : {};
  if (READ.cores != null) CORN_CORES.on = READ.cores;
  const file = arg("photo"), img = decodeImage(new Uint8Array(readFileSync(file))), px = { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
  const est = estimateGsd(parsePhotoHeader(new Uint8Array(readFileSync(file)).subarray(0, HEADER_BYTES)), { imageWidth: px.width });
  const v = readCornV1(px, rowCropParamsFor(cropProfileFor("corn")!, est.gsdM), { enteredCrop: "corn", countGuard: true });
  const out = { flight: FLIGHT, photographs: 1, readWithTheGuard: 1, medianSpacingM: null, note: "one photograph alone: no flight, so the cut alone (no misread check)", cut: CORN_COUNT_GUARD.cut, misreadRatio: CORN_COUNT_GUARD.misreadRatio, photos: [{ name: file.replace(/^.*[\\/]/, ""), rowGreenShare: v.count?.rowGreenShare ?? null, rowSpacingPx: v.count?.rowSpacingPx ?? null, withheld: v.count?.withheld ?? false, reason: v.count?.withheld ? CORN_COUNT_GUARD.message : null }], withheld: v.count?.withheld ? [{ name: file, reason: CORN_COUNT_GUARD.message }] : [] };
  writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log(JSON.stringify(out.photos)); process.exit(0);
}
const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, dir = join(arg("reads"), "reads");
const reads: CornPhotoRead[] = A.reads.map(r => join(dir, `${r.name}.json`)).filter(existsSync).map(p => JSON.parse(readFileSync(p, "utf8")));
const G = cornFlightGuard(reads);
const spacing = (r: CornPhotoRead) => (r.guard?.rowSpacingPx && r.guard.gsdM ? r.guard.rowSpacingPx * r.scale * r.guard.gsdM : null);
const out = {
  flight: FLIGHT, photographs: A.reads.length, read: reads.length, readWithTheGuard: reads.filter(r => r.guard).length, medianSpacingM: G.medianSpacingM, cut: CORN_COUNT_GUARD.cut, misreadRatio: CORN_COUNT_GUARD.misreadRatio,
  photos: G.reads.map(r => ({ name: r.name, rowGreenShare: r.guard?.rowGreenShare ?? null, rowSpacingPx: r.guard?.rowSpacingPx ?? null, rowSpacingM: spacing(r), ratio: spacing(r) != null && G.medianSpacingM ? spacing(r)! / G.medianSpacingM : null, withheld: !!r.countWithheld, reason: r.countReason ?? null })),
  withheld: G.withheld,
};
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`${FLIGHT}: ${reads.length} of ${A.reads.length} read (${out.readWithTheGuard} with the guard); median row spacing ${G.medianSpacingM?.toFixed(3)} m; withheld ${G.withheld.length}: ${G.withheld.map(w => `${w.name} (${w.reason}, ${w.ratio?.toFixed(2)}x, green ${w.rowGreenShare == null ? "-" : (w.rowGreenShare * 100).toFixed(1) + " %"})`).join("; ")}`);
