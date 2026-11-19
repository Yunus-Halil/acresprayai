// Development only: how far the photographs agree with one another over a flight (APP-1, 2026-11-18). No label: each
// spot of ground is seen by several overlapping photographs, and a plant every photograph over it marks is better
// supported than one only a single photograph marks. Run exactly as an app build combines the reads under a named
// preset (fieldTwin/build/corn.ts cornCombine), on reads made under that preset (cornInspect.ts reads --read {"preset"}).
//
//   npx vite-node scripts/rowCrop/cornAgreement.ts -- --flight <label> --analysis <a.json> --reads <readsDir> --preset today|final3 --out <dir>
//
// Writes <out>/<flight>.agreement-<preset>.json (the scoreboard's folder):
//   marks         the photographs' own marks over the flight, and the share of them in a dot that another photograph
//                 also marked (a mark no other photograph repeats is the photograph's word alone)
//   onRows        the plants on rows: how many; per plant the share of the photographs over it that marked it
//                 (photos / covered: median, mean, quartiles), the share marked by every photograph over it, by half or
//                 more, and by one photograph only
//   photographs   how many gave marks (a withheld count gives none)
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { cornCombine } from "../../src/lib/fieldTwin/build/corn";
import type { CornPhotoRead } from "../../src/lib/fieldTwin/cornField";
import type { CornPreset } from "../../src/lib/fieldTwin/cornPreset";
import { photoAgreement } from "./cornAgreementMeasure";

{
  const argv = process.argv.slice(2);
  const arg = (k: string) => { const i = argv.indexOf(`--${k}`); if (i < 0) throw new Error(`--${k} is required`); return argv[i + 1]; };
  const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, dir = join(arg("reads"), "reads"), preset = arg("preset") as CornPreset, FLIGHT = arg("flight"), OUT = arg("out");
  if (preset !== "today" && preset !== "final3") throw new Error("--preset today or final3");
  const reads: CornPhotoRead[] = A.reads.map(r => join(dir, `${r.name}.json`)).filter(existsSync).map(p => JSON.parse(readFileSync(p, "utf8")));
  if (reads.length !== A.reads.length) throw new Error(`${reads.length} of ${A.reads.length} photographs read`);
  const t0 = Date.now(), C = cornCombine(reads, framesFromAnalysis(A), preset);
  const withheld = C.reads.filter(r => r.countWithheld).length;
  const out = {
    flight: FLIGHT, preset, photographs: reads.length, countWithheld: withheld,
    field: { cornRows: C.field.summary.cornRows, probableRows: C.field.summary.probableRows, weeds: C.field.summary.weeds, gaps: C.field.summary.gaps },
    plants: C.plants ? C.plants.summary : null,
    agreement: C.placed ? photoAgreement(C.placed, C.rows) : null,
    note: C.placed ? null : "the photographs made no dot (every count withheld, or no mark)", ms: Date.now() - t0,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${FLIGHT}.agreement-${preset}.json`), JSON.stringify(out, null, 1));
  const a = out.agreement;
  console.log(`${FLIGHT} ${preset}: ${withheld}/${reads.length} withheld; ${a ? `marks ${a.marks.total} (${a.marks.sharePercent} % another photograph also marked); on rows ${a.onRows.plants}, median share of photographs over a plant that marked it ${a.onRows.ratio.median}, by one photograph only ${a.onRows.byOnePhotographPercent} %` : out.note}`);
}
