// Development only: a stored flight's photographs as read with a setup's read options (cornInspect.ts reads), put in
// the form cornScoreboard.ts takes: an analysis record whose reads are those reads after the guard over the flight
// (fieldTwin/cornField.ts cornFlightGuard, as the build), and a candidates cache one file a photograph. Read only.
//
//   npx vite-node scripts/rowCrop/cornPresetFlight.ts -- --analysis <a.json> --reads <readsDir> --out <dir>
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { type CornPhotoRead, cornFlightGuard } from "../../src/lib/fieldTwin/cornField";

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); if (i < 0) throw new Error(`--${k} is required`); return argv[i + 1]; };
const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, dir = join(arg("reads"), "reads"), OUT = arg("out");
mkdirSync(join(OUT, "cache"), { recursive: true });
const reads: CornPhotoRead[] = A.reads.map(r => join(dir, `${r.name}.json`)).filter(existsSync).map(p => JSON.parse(readFileSync(p, "utf8")));
if (reads.length !== A.reads.length) throw new Error(`${reads.length} of ${A.reads.length} photographs read`);
const G = cornFlightGuard(reads);
// The cache cornScoreboard.ts joins (cornCandidates.ts's form): the candidates as the read carries them, with their extents.
for (const r of G.reads) writeFileSync(join(OUT, "cache", `${r.name}.json`), JSON.stringify({ name: r.name, applies: !!r.low?.length, plantsMatch: true, low: r.low ?? [], lowWhole: r.lowSpan ? r.low ?? [] : [], span: r.lowSpan ?? [], axis: r.lowAxis ?? null }));
writeFileSync(join(OUT, "analysis.json"), JSON.stringify({ ...A, reads: G.reads.map(({ low: _l, lowSpan: _s, lowAxis: _a, ...rest }) => rest) }));
console.log(`${G.reads.length} reads; the guard over the flight withheld ${G.withheld.length} (${G.withheld.map(w => `${w.name}: ${w.reason}`).join("; ") || "none"})`);
