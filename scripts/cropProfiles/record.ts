// Write benchmark results into a profile's validation.json, from the result files the benchmark wrote.
//
//   npm run profiles:record -- [--crop corn]
//
// Each benchmark's metrics and acceptance verdicts come only from crop-profiles/<crop>/10_validation/results/*.json;
// the acceptance thresholds are the ones validation.json already holds (set before the runs), never edited here.
// Afterwards run npm run profiles:build, so the run-time file carries the new validation status.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const CROP = (() => { const i = argv.indexOf("--crop"); return i >= 0 ? argv[i + 1] : "corn"; })();
const DIR = join("crop-profiles", CROP, "10_validation");
const VALIDATION = join(DIR, "validation.json");
const res = (name: string) => { const f = join(DIR, "results", `${name}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; };

type Acceptance = { metric: string; threshold: string; met?: boolean };
type Benchmark = { id: string; status: string; metrics?: Record<string, number | string>; resultFile?: string; date?: string; codeRevision?: string; acceptance: Acceptance[]; notes?: string; sources?: string[] };
const v = JSON.parse(readFileSync(VALIDATION, "utf8")) as { status: string; summary: string; benchmarks: Benchmark[] };
const bench = (id: string) => v.benchmarks.find(b => b.id === id)!;
const setRun = (b: Benchmark, r: { date: string; codeRevision: string }, file: string, metrics: Record<string, number | string>, met: boolean[]) => {
  b.status = "run"; b.date = r.date; b.codeRevision = r.codeRevision; b.resultFile = `10_validation/results/${file}`; b.metrics = metrics;
  b.acceptance = b.acceptance.map((a, i) => ({ ...a, met: met[i] }));
};

const syn = res("synthetic");
if (syn) {
  const c = syn.summary.all[CROP], n = syn.summary.all.neutral, straw = syn.summary["straw stripes"];
  setRun(bench("synthetic-corn-stands"), syn, "synthetic.json", {
    scenes: c.scenes, rowsFound: c.rowsFound, correctRows: c.correctRows, wrongRows: c.wrongRows, medianPitchErr: c.medianPitchErr, linesOnCrop: c.linesOnCrop,
    offRowPrecision: c.offRowPrecision, offRowRecall: c.offRowRecall,
    neutralCorrectRows: n.correctRows, neutralWrongRows: n.wrongRows, neutralLinesOnCrop: n.linesOnCrop, neutralOffRowPrecision: n.offRowPrecision, neutralOffRowRecall: n.offRowRecall,
    strawCorrectRows: straw[CROP].correctRows, strawNeutralCorrectRows: straw.neutral.correctRows,
  }, [c.rowsFound >= 0.95, c.medianPitchErr <= 0.03, c.linesOnCrop >= 0.95]);
}

const ph = res("photos");
if (ph) {
  const rows = (ph.rows as { image: string; res: string; mode: string; rowsFound: boolean; onGreenRatio: number | null; pitchCm: number | null }[]).filter(r => r.res === "photo");
  const corn = rows.filter(r => r.mode === CROP), neutral = rows.filter(r => r.mode === "neutral");
  const metrics: Record<string, number | string> = { photosWithRows: corn.filter(r => r.rowsFound).length, neutralPhotosWithRows: neutral.filter(r => r.rowsFound).length, minOnGreenRatio: Math.min(...corn.map(r => r.onGreenRatio ?? 0)) };
  for (const r of corn) metrics[`onGreen ${r.image.slice(0, 8)}`] = r.onGreenRatio ?? "none";
  for (const r of neutral) metrics[`neutral onGreen ${r.image.slice(0, 8)}`] = r.onGreenRatio ?? "none";
  setRun(bench("corn-photos-label-free"), ph, "photos.json", metrics, [corn.filter(r => r.rowsFound).length === corn.length && corn.length === 3, corn.every(r => (r.onGreenRatio ?? 0) >= 2)]);
}

const wg = res("weedsgalore");
if (wg) {
  const s = wg.summary;
  const pick = (res: string, mode: string) => s[res][mode];
  setRun(bench("weedsgalore-vegetation"), wg, "weedsgalore.json", {
    iou025: pick("0.25cm", CROP).meanVegIoU, iou1: pick("1cm", CROP).meanVegIoU, iou2: pick("2cm", CROP).meanVegIoU,
    neutralIou025: pick("0.25cm", "neutral").meanVegIoU, neutralIou1: pick("1cm", "neutral").meanVegIoU, neutralIou2: pick("2cm", "neutral").meanVegIoU,
  }, [pick("0.25cm", CROP).meanVegIoU >= 0.70]);
  setRun(bench("weedsgalore-position"), wg, "weedsgalore.json", {
    weedOutsideBand025: pick("0.25cm", CROP).meanWeedOffBand, weedOutsideBand1: pick("1cm", CROP).meanWeedOffBand, weedOutsideBand2: pick("2cm", CROP).meanWeedOffBand,
    maizeInsideBand025: pick("0.25cm", CROP).meanMaizeInBand, maizeInsideBand1: pick("1cm", CROP).meanMaizeInBand, maizeInsideBand2: pick("2cm", CROP).meanMaizeInBand,
    offBandVegetationThatIsWeed1: pick("1cm", CROP).meanOffBandWeedPrecision, automaticRowsFound1cm: wg.automaticRowsFound1cm,
  }, [true, Math.min(pick("0.25cm", CROP).meanMaizeInBand, pick("1cm", CROP).meanMaizeInBand, pick("2cm", CROP).meanMaizeInBand) >= 0.85]);
  setRun(bench("weedsgalore-cover"), wg, "weedsgalore.json", {
    mae025: pick("0.25cm", CROP).coverMAE, mae1: pick("1cm", CROP).coverMAE, mae2: pick("2cm", CROP).coverMAE,
    bias025: pick("0.25cm", CROP).coverBias, bias1: pick("1cm", CROP).coverBias, bias2: pick("2cm", CROP).coverBias,
    neutralMae025: pick("0.25cm", "neutral").coverMAE, neutralMae1: pick("1cm", "neutral").coverMAE, neutralMae2: pick("2cm", "neutral").coverMAE,
  }, [Math.max(pick("0.25cm", CROP).coverMAE, pick("1cm", CROP).coverMAE, pick("2cm", CROP).coverMAE) <= 0.03]);
}

const st = res("stage");
if (st) {
  const stated = (st.rows as { statedStage: string | null; statedInRange: boolean | null; estimatedStages: string; date: string }[]).filter(r => r.statedStage);
  const metrics: Record<string, number | string> = { statedDates: stated.length, statedInRange: stated.filter(r => r.statedInRange).length };
  for (const r of st.rows) metrics[r.date] = r.estimatedStages;
  setRun(bench("weedsgalore-stage"), st, "stage.json", metrics, [stated.length > 0 && stated.every(r => r.statedInRange)]);
}

const mp = res("map");
if (mp && v.benchmarks.some(b => b.id === "map-corn-rows")) {
  const m = mp.summary;
  setRun(bench("map-corn-rows"), mp, "map.json", {
    scenes: m.scenes, rowsFound: m.rowsFound, rowsOnCrop: m.correctRows, meanLinesOnCrop: m.meanLinesOnCrop, refusedUntilConfirmed: m.refusedUntilConfirmed,
    gradedScenes: m.gradedScenes, coverMAE: m.coverMAE, coverBias: m.coverBias, coverMAEStraw: m.coverMAEStraw, photosWithRows: m.photosWithRows,
  }, [m.rowsFound >= 0.95, m.correctRows >= 0.90, m.refusedUntilConfirmed === 1, m.coverMAE != null && m.coverMAE <= 0.03]);
}

const run = v.benchmarks.filter(b => b.status === "run");
const allMet = run.length === v.benchmarks.length && run.every(b => b.acceptance.every(a => a.met));
v.status = allMet ? "validated" : run.length ? "partial" : "unvalidated";
const met = run.filter(b => b.acceptance.every(a => a.met)).map(b => b.id), missed = run.filter(b => b.acceptance.some(a => a.met === false)).map(b => b.id);
v.summary = `${run.length} of ${v.benchmarks.length} benchmarks run (${run[0]?.date ?? "-"}, code ${run[0]?.codeRevision ?? "-"}). Acceptance met: ${met.join(", ") || "none"}. Not met: ${missed.join(", ") || "none"}. Written by npm run profiles:record from the result files; the profile stays ${allMet ? "eligible for validated" : "experimental"}.`;
writeFileSync(VALIDATION, JSON.stringify(v, null, 2) + "\n");
console.log(v.summary);
