// Recall of labelled weed points against the grade, count only: for each weed a person marked, did the grade see it,
// and if not, why not. No sizes are invented and no cover is computed: the labels are points.
//
//   npx vite-node scripts/eval/pressure/points-recall.ts -- [--frame DJI_0301] [--labels <labels.json>] [--date 2026-10-22] [--out docs/eval]
//
// The classes, in order (seen, below-floor, in-band, not-assessed, missed), are defined in recall.ts.
import "../../bench/nodeStorageShim";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fieldRowStatusAt } from "../../../src/lib/weedVision/fieldRows";
import { PAINT_CROWN_MARGIN_M, typicalCrownPx } from "../../../src/lib/weedVision/layout/rowBand";
import { latLngOfPx } from "../../../src/lib/weedVision/mapRun";
import { CLASS_ORDER, sortObjects, weedObjectsOf } from "../../../src/lib/weedVision/pressure/grade";
import { runFixture } from "./fixture";
import { type PointLabel, RECALL_CLASSES, RECALL_RADIUS_M, type RecallClass, pointsRecall, recallCsv } from "./recall";
import { trialFixture, trialMeta } from "./trialFrames";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };

async function main() {
  const frame = arg("frame", "DJI_0301")!;
  const labelsFile = arg("labels", "evaluation/groundtruth/image1/DJI_0301.labels.json")!;
  const date = arg("date", new Date().toISOString().slice(0, 10))!;
  const outDir = arg("out", "docs/eval")!;
  const f = trialFixture(frame);
  const meta = trialMeta(frame);
  const run = await runFixture(f);
  const g = run.stage1.grid;
  // The labels are in the photo's native pixels; the trial placed the photo at zoom 23 as X0 + x * scale (meta.json).
  const all = (JSON.parse(readFileSync(labelsFile, "utf8")).labels as { id: string; cls: string; x: number; y: number }[]);
  const weeds = all.filter(l => l.cls === "weed");
  const points: PointLabel[] = weeds.map(l => ({ id: l.id, x: l.x, y: l.y, centre: latLngOfPx(meta.z23.X0 + l.x * meta.scale_to_z23, meta.z23.Y0 + l.y * meta.scale_to_z23, 23) }));
  // The objects as the store tags them against the rows, then as the grade takes them.
  const plants = f.plants.map(p => (p.centre ? { ...p, rowStatus: f.rows ? fieldRowStatusAt(f.rows, p.centre) : "no-rows" as const } : p));
  const objects = weedObjectsOf(plants);
  const rs = pointsRecall({ grade: run.grade, grid: g, rows: f.rows, objects, points });
  const sorted = sortObjects(objects, f.rows, g, run.grade.params.floorPx);

  const n = rs.length, by = (k: RecallClass) => rs.filter(r => r.class === k);
  const pct = (a: number) => `${((100 * a) / Math.max(1, n)).toFixed(1)}%`;
  const seen = by("seen");
  const klassOf: Record<string, number> = {};
  for (const r of seen) { const k = r.klass ?? "not assessed"; klassOf[k] = (klassOf[k] ?? 0) + 1; }
  const reasons: Record<string, number> = {};
  for (const r of by("not-assessed")) reasons[r.reason!] = (reasons[r.reason!] ?? 0) + 1;
  // The cut's widths in metres, for the B4 check.
  const rows = f.rows!;
  const bands = [...new Set(rows.ctx.lines.map(l => +((l.band ?? rows.ctx.bandPx) * rows.mpp).toFixed(3)))].sort((a, b) => a - b);
  const typicalM = typicalCrownPx(rows.ctx.crops) * rows.mpp;
  const lostToCut = by("in-band").length + by("below-floor").length;

  const L: string[] = [];
  L.push(`# ${frame}: recall of labelled weed points (${date})`, "");
  L.push("**What this measures, and what it does not.** Recall of labelled weed points only: of the weeds a person marked, how many the grade saw, and where the rest went. There is no precision (nothing here says how many of the grade's weeds are real), no cover error (the labels have no size, and none was invented), and no act / don't act verdict. The labels are not a complete census of the frame's weeds, and that does not affect these numbers: every label is a real weed, and an unlabelled weed cannot be a miss; it can only go uncounted.", "");
  L.push(`Inputs: the ${weeds.length} weed points of \`${labelsFile}\` (${all.length - weeds.length} other labels ignored), placed on the trial's stand-in map of ${frame} with the trial's own transform (photo pixel times ${meta.scale_to_z23.toFixed(4)} onto zoom 23, north-up, flat ground, EXIF pixel size); the frame's fitted planting layout (\`layout-rows.json\`, ${rows.ctx.crops.length} crowns); the saved RF-DETR results of 2026-10-19 (\`window-cache-layout.json\`, ${objects.length} weed objects, the crop painted out before the model ran); Stage 1 and the grade as the app runs them (0.5 m cells, grade ${run.grade.version}, no parameter changed). Of the objects the grade counted ${sorted.counted.length}, set ${sorted.belowFloor.length} under its floor and ${sorted.onRow.length} aside on a crop row. A label is "seen" when a counted object's centre is within ${RECALL_RADIUS_M} m.`, "");
  L.push("## Where the labelled weeds went", "");
  L.push("| Class | Labels | Share | Meaning |", "|---|---|---|---|");
  const meaning: Record<RecallClass, string> = {
    "seen": `a counted object within ${RECALL_RADIUS_M} m (any tier)`,
    "below-floor": "the nearest object within the radius was set apart under the detection floor",
    "in-band": "inside the ground the grade cuts away (row band, or a crown and its margin)",
    "not-assessed": "in a cell the grade did not judge, or outside its grid",
    "missed": `an assessed cell and no object within ${RECALL_RADIUS_M} m`,
  };
  for (const k of RECALL_CLASSES) L.push(`| ${k} | ${by(k).length} | ${pct(by(k).length)} | ${meaning[k]} |`);
  L.push(`| total | ${n} | 100% | |`, "");
  if (Object.keys(reasons).length) {
    L.push("Not assessed, by reason:", "", "| Reason | Labels |", "|---|---|");
    for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
    L.push("");
  }
  L.push("## The cells of the seen labels", "");
  L.push("The class the grade gave the cell each seen label stands in (judged over the 2.5 m treatment unit):", "");
  L.push("| Class | Seen labels |", "|---|---|");
  for (const k of [...CLASS_ORDER, "not assessed"]) if (klassOf[k]) L.push(`| ${k} | ${klassOf[k]} |`);
  L.push("", `Of the seen labels, ${seen.filter(r => r.tier === "confirmed").length} stand in confirmed cells and ${seen.filter(r => r.tier === "possible").length} in possible ones; ${seen.filter(r => r.nearCrop).length} are in cells near the crop.`, "");
  L.push("## The row band and the floor", "");
  const share = lostToCut / Math.max(1, n);
  L.push(`In-band plus below-floor: ${lostToCut} of ${n} labels, ${(100 * share).toFixed(1)}%. ${share > 0.3 ? "**That is over 30%.** The widths that produced it:" : "Under the 30% bar. The widths, for the record:"}`, "");
  L.push(`- Row band half-width: ${bands.map(b => `${b.toFixed(2)} m`).join(", ")} each side of a row line.`);
  L.push(`- Crown cut: a confirmed or operator crown at its painted radius plus ${PAINT_CROWN_MARGIN_M} m (typical confirmed crown radius ${typicalM.toFixed(2)} m, so about ${(typicalM + PAINT_CROWN_MARGIN_M).toFixed(2)} m from the trunk); an expected crown at half the typical radius, ${(0.5 * typicalM).toFixed(2)} m, with no margin.`);
  L.push(`- Detection floor: ${run.grade.params.floorPx} pixels, ${(run.grade.detectionFloorM * 100).toFixed(1)} cm at this map's ${(g.mpp * 100).toFixed(1)} cm a pixel.`, "");
  L.push(`Every label with its class is in \`${frame}-points-recall-${date}.csv\` beside this report: id, photo pixel, position, class, reason, distance to the nearest counted and below-floor object, cell, the cell's class, tier and near-crop flag.`, "");
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `${frame}-points-recall-${date}`);
  writeFileSync(`${base}.md`, L.join("\n"));
  writeFileSync(`${base}.csv`, recallCsv(rs));
  console.log(JSON.stringify({ n, ...Object.fromEntries(RECALL_CLASSES.map(k => [k, by(k).length])), reasons, seenKlass: klassOf, inBandPlusBelowFloorShare: +share.toFixed(3), bands, typicalCrownM: +typicalM.toFixed(3), floorM: run.grade.detectionFloorM, wrote: [`${base}.md`, `${base}.csv`] }));
}

main().catch(e => { console.error(e); process.exit(1); });
