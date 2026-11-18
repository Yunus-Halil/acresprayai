// Development only: every photograph of a stored corn flight read again by the per-photo read as it is today, once with
// the vivid cores off and once on (cornV1.ts CORN_CORES), so the two can be scored against each other by the scripts
// that take an analysis record and a candidates cache (cornScoreboard.ts, cornLabelScore.ts). The stored record is not
// touched; the photographs are only read. Run by range in several processes, then once with --assemble.
//
//   npx vite-node scripts/rowCrop/cornReadsWith.ts -- --analysis <analysis.json> --photos <dir> --out <dir> [--range 0:40] [--check <cand cache>]
//   npx vite-node scripts/rowCrop/cornReadsWith.ts -- --analysis <analysis.json> --out <dir> --assemble
//   --variants off,on,gentle (default off,on). "gentle": the cores with another blur pair, set for this run only by
//   --gentle <fine share>,<wide share> (shares of the row spacing; CORN_CORES itself is not changed in the code).
//
// Per variant (off, on) it writes <out>/<variant>/<photograph>.json in the candidates cache's own form (cornCandidates.ts:
// applies, low, lowWhole, span, axis) with the whole read beside it (`read`), and --assemble writes
// <out>/analysis-<variant>.json: the record with its reads replaced by these. A photograph with no camera, no file or
// not read at full size keeps the record's read in both.
// --check: the cache made earlier by cornCandidates.ts; the off read's candidates are compared with it, and its marks,
// rows, patches and gaps with the record's.
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "../bench/images";
import { groundSampleAt } from "../../src/lib/directGeoref/projection";
import { compactCornRead } from "../../src/lib/fieldTwin/cornField";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { CORN_CORES, cornV1RowCandidates, greenPitchPx, readCornV1 } from "../../src/lib/rowCrop/cornV1";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { SEEDLING_GREEN, seedlingCache } from "../../src/lib/rowCrop/seedlingGreen";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, OUT = arg("out"), VARIANTS = (opt("variants") ?? "off,on").split(",");
const BUILT = { fineShare: CORN_CORES.fineShare, wideShare: CORN_CORES.wideShare }, GENTLE = opt("gentle")?.split(",").map(Number) ?? null;
// --cores-reference strongest|marks: what a core is measured against, for this run only (CORN_CORES.reference otherwise).
if (opt("cores-reference")) Object.assign(CORN_CORES, { reference: opt("cores-reference") });
if (VARIANTS.includes("gentle") && !GENTLE) throw new Error("--gentle <fine share>,<wide share> is required for the gentle variant");
for (const v of VARIANTS) mkdirSync(join(OUT, v), { recursive: true });

if (argv.includes("--assemble")) {
  for (const v of VARIANTS) {
    let kept = 0;
    const reads = A.reads.map(r => { const f = join(OUT, v, `${r.name}.json`); if (!existsSync(f)) { kept++; return r; } return (JSON.parse(readFileSync(f, "utf8")) as { read: (typeof A.reads)[number] }).read; });
    writeFileSync(join(OUT, `analysis-${v}.json`), JSON.stringify({ ...A, reads }));
    console.log(`analysis-${v}.json: ${reads.length} reads, ${kept} kept from the record (not read again)`);
  }
  process.exit(0);
}

const DIR = arg("photos"), CHECK = opt("check"), frames = framesFromAnalysis(A);
const [a, b] = (opt("range") ?? `0:${A.reads.length}`).split(":").map(Number);
const fileOf = (name: string) => [name, name.replace("_", "/")].flatMap(n => [".JPG", ".jpg", ".jpeg", ".JPEG"].map(e => join(DIR, n + e))).find(existsSync);
const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
for (const r of A.reads.slice(a, b)) {
  const todo = VARIANTS.filter(v => !existsSync(join(OUT, v, `${r.name}.json`)));
  if (!todo.length) continue;
  const f = frames.get(r.name), path = fileOf(r.name);
  if (!f || !path) { console.log(`${r.name}: no camera or no photograph, skipped`); continue; }
  if (r.scale !== 1) { console.log(`${r.name}: read at scale ${r.scale}, skipped (full-size reads only)`); continue; }
  const img = decodeImage(new Uint8Array(readFileSync(path)));
  const px = { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
  const gsd = groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy), params = rowCropParamsFor(cropProfileFor("corn")!, gsd);
  const line: string[] = []; let pitch: number | null = null;
  for (const variant of todo) {
    // The blur pair of this variant, for this read only.
    Object.assign(CORN_CORES, variant === "gentle" ? { fineShare: GENTLE![0], wideShare: GENTLE![1] } : BUILT);
    const t0 = Date.now();
    // As a build reads it (build/corn.ts cornPhotoRead: rowSpans), the cores as this variant says.
    const v = readCornV1(px, params, { enteredCrop: "corn", rowSpans: true, cores: variant !== "off" }), c = compactCornRead(r.name, v, 1), ms = Date.now() - t0;
    pitch = greenPitchPx(v.green);
    // The candidates split at the spacing one photograph assumes (what the read makes without rowSpans): the same call it makes.
    const split = v.plants.low ? cornV1RowCandidates(px, seedlingCache(px, SEEDLING_GREEN), v.rows, params.gsdM ?? null).map(p => [Math.round(p.x), Math.round(p.y)] as [number, number]) : [];
    const { low, lowSpan, lowAxis, ...read } = c;
    const out = { name: r.name, variant, blurShares: variant === "off" ? null : [CORN_CORES.fineShare, CORN_CORES.wideShare], applies: !!v.plants.low, plantsMatch: true, plantsNow: c.plants.length, plantsRecord: r.plants.length, low: split, lowWhole: lowSpan && lowAxis ? low ?? [] : [], span: lowSpan ?? [], axis: lowAxis ?? null, readMs: ms, rowSpacingPx: pitch, read };
    writeFileSync(join(OUT, variant, `${r.name}.json`), JSON.stringify(out));
    let note = "";
    if (variant === "off") {
      const rec = r as unknown as Record<string, unknown>;
      note = ` (the record's: marks ${same(read.plants, rec.plants) ? "equal" : "DIFFERENT"}, rows ${same(read.rows, rec.rows) ? "equal" : "DIFFERENT"}, patches ${same(read.patches, rec.patches) ? "equal" : "DIFFERENT"}, gaps ${same(read.gaps, rec.gaps) ? "equal" : "DIFFERENT"}`;
      const cf = CHECK ? join(CHECK, `${r.name}.json`) : null;
      if (cf && existsSync(cf)) { const k = JSON.parse(readFileSync(cf, "utf8")) as typeof out; note += `; the earlier cache's candidates ${k.applies === out.applies && same(k.low, out.low) && same(k.lowWhole, out.lowWhole) && same(k.span, out.span) && same(k.axis, out.axis) ? "equal" : "DIFFERENT"}`; }
      note += ")";
    }
    line.push(`${variant}: ${c.plants.length} marks, ${c.rows.length} rows, ${v.plants.low ? `${split.length} candidates` : "no candidates"}, ${ms} ms${note}`);
  }
  Object.assign(CORN_CORES, BUILT);
  console.log(`${r.name}: row spacing ${pitch == null ? "none" : `${pitch.toFixed(1)} px`}; ${line.join("; ")}`);
}
