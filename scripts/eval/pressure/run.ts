// The weed-pressure evaluation, headless.
//
//   npm run eval:pressure -- --fixture <fixture dir> [--date 2026-10-22] [--out docs/eval]
//   npm run eval:pressure -- --synthetic
//
// Reads the fixture (README.md beside this file), runs Stage 1 and the grade on it as the app does, scores the grade
// against the truth quadrats and writes docs/eval/<fixture>-<date>.md and .json, and the cells where pixels and
// objects disagree as <fixture>-<date>.disagreement.csv. Nothing is fetched or uploaded.
import "../../bench/nodeStorageShim";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PRESSURE_CELL_M } from "../../../src/lib/weedVision/pressure/pressureStore";
import { disagreementCsv, disagreementRows } from "./disagreement";
import { type LoadedFixture, loadFixture, runFixture } from "./fixture";
import { buildReport, reportMarkdown } from "./report";
import { scoreGrade } from "./score";
import { makeSyntheticFixture } from "./synthetic";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };

async function main() {
  const date = arg("date", new Date().toISOString().slice(0, 10))!;
  const outDir = arg("out", "docs/eval")!;
  const dir = arg("fixture");
  if (!dir && !argv.includes("--synthetic")) throw new Error("--fixture <dir> or --synthetic");
  const f: LoadedFixture = dir ? await loadFixture(dir) : makeSyntheticFixture();
  const run = await runFixture(f);
  const { metrics, quadrats } = scoreGrade(run.grade, run.stage1.grid, f.truth);
  const report = buildReport(f.name, date, run.grade, run.stage1.grid.cellPx * run.stage1.grid.mpp || PRESSURE_CELL_M, metrics, quadrats);
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `${f.name}-${date}`);
  writeFileSync(`${base}.md`, reportMarkdown(report));
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 1));
  const disagreeing = disagreementRows(f.name, run.grade);
  if (disagreeing.length) writeFileSync(`${base}.disagreement.csv`, disagreementCsv(disagreeing));
  console.log(JSON.stringify({ fixture: f.name, scored: metrics.scored, coverMae: metrics.cover.mae, coverBias: metrics.cover.bias, confusion: metrics.confusion, patchIoU: metrics.patchIoU, notAssessedCells: metrics.notAssessedCells, wrote: [`${base}.md`, `${base}.json`] }));
}
main().catch(e => { console.error(e); process.exit(1); });
