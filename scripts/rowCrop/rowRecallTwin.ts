// Development only: a copy of a corn twin on this computer with the plants along its rows found again at the lower bar
// (greenPoints.ts rowPlantPoints, plantsFirst.ts rowCandidates), for a look in the dev preview beside the original.
// The original twin and its analysis record are not touched; the photographs are only read.
//
//   1. the candidates of each photograph (the only step that opens the photographs; run in several processes by range):
//      npx vite-node scripts/rowCrop/rowRecallTwin.ts -- --candidates --from <twin dir> --photos <dir> --cache <dir> [--range 0:41]
//   2. the twin:
//      npx vite-node scripts/rowCrop/rowRecallTwin.ts -- --assemble --from <twin dir> --cache <dir> --to <new twin dir> --id <new id> [--baseline]
//
// The candidates step applies the lower bar to every photograph of the record (the build applies it only where the
// plant read used the dark-leaf rule: seedlings on soil). --baseline assembles without the candidates: today's result
// through the same code, to compare against.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "../bench/images";
import { groundSampleAt } from "../../src/lib/directGeoref/projection";
import { cornField, type CornPhotoRead } from "../../src/lib/fieldTwin/cornField";
import { cornPlantsFirst } from "../../src/lib/fieldTwin/cornPlants";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { cornV1RowCandidates } from "../../src/lib/rowCrop/cornV1";
import { SEEDLING_GREEN, seedlingCache } from "../../src/lib/rowCrop/seedlingGreen";

const argv = process.argv.slice(2);
const has = (k: string) => argv.includes(`--${k}`);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
const FROM = arg("from"), CACHE = arg("cache");
const A = JSON.parse(readFileSync(join(FROM, "analysis.json"), "utf8")) as TwinAnalysis;
const frames = framesFromAnalysis(A);
mkdirSync(CACHE, { recursive: true });

if (has("candidates")) {
  const DIR = arg("photos"), [a, b] = (opt("range") ?? `0:${A.reads.length}`).split(":").map(Number);
  for (const r of A.reads.slice(a, b)) {
    const out = join(CACHE, `${r.name}.json`);
    if (existsSync(out)) continue;
    const f = frames.get(r.name);
    const path = [".JPG", ".jpg", ".jpeg", ".JPEG"].map(e => join(DIR, r.name + e)).find(existsSync);
    if (!f || !path) { console.log(`${r.name}: no camera or no photograph, skipped`); continue; }
    const t0 = Date.now();
    const img = decodeImage(new Uint8Array(readFileSync(path)));
    const px = { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
    const t1 = Date.now();
    const gsd = groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy);
    const rows = r.rows.map(row => ({ points: row.points.map(([x, y]) => [x * r.scale, y * r.scale] as [number, number]) }));
    const low = cornV1RowCandidates(px, seedlingCache(px, SEEDLING_GREEN), rows, gsd).map(p => [Math.round(p.x), Math.round(p.y)] as [number, number]);
    writeFileSync(out, JSON.stringify({ name: r.name, low, ms: Date.now() - t1 }));
    console.log(`${r.name}: ${r.plants.length} marks, ${low.length} candidates at the lower bar, ${Date.now() - t1} ms (decode ${t1 - t0} ms)`);
  }
} else if (has("assemble")) {
  const TO = arg("to"), ID = arg("id"), baseline = has("baseline");
  let missing = 0, ms = 0;
  const reads: CornPhotoRead[] = A.reads.map(r => {
    const { low: _old, ...rest } = r;
    if (baseline) return rest;
    const c = join(CACHE, `${r.name}.json`);
    if (!existsSync(c)) { missing++; return rest; }
    const j = JSON.parse(readFileSync(c, "utf8")) as { low: [number, number][]; ms: number }; ms += j.ms;
    return { ...rest, low: j.low.map(([x, y]) => [x / r.scale, y / r.scale] as [number, number]) };
  });
  if (missing) console.log(`${missing} photographs have no candidates in the cache: they keep their marks only`);
  const F = cornField(reads, frames, A.fieldOptions);
  const t0 = Date.now(), P = cornPlantsFirst(reads, frames, F);
  if (!P) throw new Error("the plants made no certain row");
  console.log(`plants first in ${Date.now() - t0} ms${baseline ? " (baseline: no candidates)" : `; candidates ${Math.round(ms / Math.max(1, reads.length))} ms a photograph`}`);
  console.log(JSON.stringify({ ...P.summary, seedCm: P.geometry.seedM ? +(P.geometry.seedM * 100).toFixed(1) : null, spacingM: +P.geometry.spacingM.toFixed(3), certainRows: P.geometry.certainRows }));
  const confirmed = P.stretches.filter(s => s.confirmed), onRow = P.shown.filter(v => v === 0 || v === 1 || v >= 4).length;
  console.log(`on the rows: ${onRow} plants over ${Math.round(P.summary.confirmedM)} m with plants seen (${(onRow / Math.max(1, P.summary.confirmedM)).toFixed(2)} a metre); ${confirmed.length} stretches with plants, ${P.stretches.length - confirmed.length} not confirmed (${Math.round(P.summary.notConfirmedM)} m)`);
  mkdirSync(TO, { recursive: true });
  const twin = JSON.parse(readFileSync(join(FROM, "twin.json"), "utf8"));
  const corn = twin.corn;
  corn.rows = P.stretches.map((g, i) => ({ id: i + 1, status: g.confirmed ? "corn" : "unconfirmed", line: g.line, lengthM: g.lengthM, seenBy: 0, cornBy: 0, coveredBy: 0, why: g.why, row: g.row, plants: g.plants }));
  corn.fieldRows = P.rows.map(r => ({ ...r }));
  const note = "One dot per plant two or more photographs located, placed where they saw it. Filled: a plant on a row, seen by most photographs over it. Ring: probable (on a row, at the field's plant spacing). Yellow ring: found on a second look along a row (no colour) by two or more photographs. Pink ring: the same, one photograph's sharp view. Grey: seen, on no row. Grey cross: between two rows, not the crop. Located by the photographs, not identified as corn by its look; not a stand count.";
  corn.plants = { points: P.points, certainty: P.shown, photos: P.photos, note, summary: { plants: P.summary.plants, certain: P.summary.certain, probable: P.summary.probable, onNoRow: P.summary.onNoRow, betweenRows: P.summary.betweenRows, confirmedM: P.summary.confirmedM, notConfirmedM: P.summary.notConfirmedM, ...(P.summary.alongRowsTwo != null ? { alongRowsTwo: P.summary.alongRowsTwo, alongRowsOne: P.summary.alongRowsOne ?? 0 } : {}) } };
  corn.gaps = [];
  corn.summary.cornRows = confirmed.length; corn.summary.unconfirmedRows = P.stretches.length - confirmed.length;
  corn.summary.cornRowLengthM = Math.round(P.summary.confirmedM * 10) / 10;
  corn.summary.gaps = { confirmed: 0, withheld: 0, confirmedLengthM: 0 };
  corn.notes = [...(corn.notes ?? []).filter((n: string) => !/^Development:/.test(n)), baseline
    ? "Development: the plants first through the present code, without candidates along the rows. Not a build output."
    : `Development: plants along the rows found again at the lower bar (${P.summary.alongRowsTwo ?? 0} by two or more photographs, ${P.summary.alongRowsOne ?? 0} by one sharp view), kept only on a row; every other dot as before. Not a build output.`];
  twin.id = ID; twin.name = `${String(twin.name).replace(/ \(.*\)$/, "")} (${baseline ? "plants first, today" : "rows found again"})`;
  writeFileSync(join(TO, "twin.json"), JSON.stringify(twin));
  writeFileSync(join(TO, "plants.json"), JSON.stringify({ version: 4, source: baseline ? "plants first (development, today)" : "plants first + along the rows (development)", note, points: P.points, certainty: P.shown, photos: P.photos }));
  for (const f of ["reference.json", ...((twin.atlases ?? []) as { file: string }[]).map(a => a.file)]) if (existsSync(join(FROM, f))) cpSync(join(FROM, f), join(TO, f));
  // The photo ground of the same photographs (dev preview only), under the new twin's id.
  if (existsSync(join(FROM, "ground", "ground.json")) && !existsSync(join(TO, "ground"))) {
    cpSync(join(FROM, "ground"), join(TO, "ground"), { recursive: true });
    const g = JSON.parse(readFileSync(join(TO, "ground", "ground.json"), "utf8")); g.twinId = ID; writeFileSync(join(TO, "ground", "ground.json"), JSON.stringify(g));
  }
  console.log(`-> ${TO}`);
} else throw new Error("--candidates or --assemble");
