// The grade's headline numbers on the five orchard trial frames, so a change to the grade can be stated as before
// and after (2026-10-22).
//
//   npx vite-node scripts/eval/pressure/orchard.ts -- --dir <trial dir> [--frames DJI_0301,...] [--out file.json] [--disagreement file.csv]
//
// The frames are the kept orchard flight prepared as stand-in field maps for the two-stage trial (trialFrames.ts).
// No truth: these are the grade's own counts, not accuracy.
import "../../bench/nodeStorageShim";
import { writeFileSync } from "node:fs";
import { type DisagreementRow, disagreementCsv, disagreementRows } from "./disagreement";
import { runFixture } from "./fixture";
import { TRIAL_DIR, trialFixture } from "./trialFrames";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = arg("dir", TRIAL_DIR)!;
const FRAMES = (arg("frames") ?? "DJI_0301,DJI_0303,DJI_0312,DJI_0320,DJI_0327").split(",").filter(Boolean);


async function main() {
  const out: Record<string, unknown>[] = [];
  const disagreeing: DisagreementRow[] = [];
  for (const frame of FRAMES) {
    const { grade } = await runFixture(trialFixture(frame, DIR));
    disagreeing.push(...disagreementRows(frame, grade));
    const s = grade.summary as typeof grade.summary & { disagreeing?: number };
    const row = {
      frame, assessed: s.assessed, notAssessed: s.notAssessed, confirmed: s.confirmed, possible: s.possible,
      actionCells: s.byClass.action + s.byClass.high, highCells: s.byClass.high, escapes: s.escapes, escapesConfirmed: grade.escapes.filter(e => e.tier === "confirmed").length, treatWhileSmall: s.treatWhileSmall,
      fieldCover: +s.fieldCover.toFixed(4), fieldClass: s.fieldClass, patches: s.patches, unitM: s.unitM,
      withLossBand: grade.cells.filter(c => c.lossBand).length, disagreeing: s.disagreeing ?? null,
    };
    console.log(JSON.stringify(row));
    out.push(row);
  }
  const total = (k: string) => out.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const sum = { frames: out.length, confirmed: total("confirmed"), possible: total("possible"), actionCells: total("actionCells"), escapes: total("escapes"), escapesConfirmed: total("escapesConfirmed"), treatWhileSmall: total("treatWhileSmall"), withLossBand: total("withLossBand") };
  console.log(JSON.stringify({ total: sum }));
  if (arg("out")) writeFileSync(arg("out")!, JSON.stringify({ frames: out, total: sum }, null, 1));
  if (arg("disagreement")) writeFileSync(arg("disagreement")!, disagreementCsv(disagreeing));
}
main().catch(e => { console.error(e); process.exit(1); });
