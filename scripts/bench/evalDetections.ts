// Detection evaluation: a person's labels against the region predictions.
//
//   npm run eval:detections -- [--predictions data/bench/eval/predictions.json] [--labels data/bench/eval/labels] [--tolerance-px 25]
//
// Labels are the files scripts/annotate/annotate.html exports, one per
// region, in --labels (any *.labels.json there). Each region's labels are
// matched one to one to its predictions (src/lib/weedScout/sizing/detectionEval.ts)
// and the report gives segmentation and classification apart, precision,
// recall and F1 over the weed labels, the crop-to-weed confusion, the
// misses by what they were lost to, and recall by size, by distance to the
// row and by shade. Regions with no labels are listed as unlabelled. With no
// labels at all the verdict says accuracy cannot be calculated. Nothing here
// invents a label.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "./cli";
import { type Label, type Matched, type RegionPrediction, detectionLines, detectionReport, matchLabels } from "../../src/lib/weedScout/sizing/detectionEval";

const args = parseArgs(process.argv.slice(2));
const predictionsPath = String(args.predictions ?? join("data", "bench", "eval", "predictions.json"));
const labelsDir = String(args.labels ?? join("data", "bench", "eval", "labels"));
const tolerancePx = args["tolerance-px"] ? Number(args["tolerance-px"]) : undefined;

type LabelFile = { format: string; image?: string | null; region: { id: string } | null; gsdCmPx: number | null; annotator: string | null; exhaustive?: boolean; labels: (Label & { regionX: number; regionY: number })[] };
const base = (p: string) => p.replace(/^.*[\\/]/, "");

if (!existsSync(predictionsPath)) { console.error(`no predictions at ${predictionsPath}; run npm run eval:regions first`); process.exit(1); }
const preds = JSON.parse(readFileSync(predictionsPath, "utf-8")) as { regions: { region: { id: string; conditions: string[] }; gsdCmPx: number; predictions: RegionPrediction[] }[] };
const labelFiles = existsSync(labelsDir) ? readdirSync(labelsDir).filter(f => f.endsWith(".labels.json")) : [];
const byRegion = new Map<string, LabelFile>();
for (const f of labelFiles) {
  const j = JSON.parse(readFileSync(join(labelsDir, f), "utf-8")) as LabelFile;
  if (j.format !== "swardus-region-labels-v1") { console.error(`${f}: not a label file`); continue; }
  if (j.region?.id) { byRegion.set(j.region.id, j); continue; }
  // A whole-image file (labelled with no predictions loaded): its labels are the photo's native pixels; each region of that photo takes the ones inside its box.
  if (!j.image) { console.error(`${f}: neither a region nor an image is named`); continue; }
  const targets = preds.regions.filter(r => base((r.region as { photo?: string }).photo ?? "") === base(j.image!));
  if (!targets.length) { console.error(`${f}: no region of ${j.image} in the predictions`); continue; }
  for (const r of targets) {
    const box = r.region as { x: number; y: number; width: number; height: number };
    const inside = j.labels.filter(l => l.x >= box.x && l.x < box.x + box.width && l.y >= box.y && l.y < box.y + box.height);
    byRegion.set(r.region.id, { ...j, region: { id: r.region.id }, labels: inside });
  }
}
const allMatches: Matched[] = [], allPreds: RegionPrediction[] = [];
const perRegion: { id: string; conditions: string[]; labelled: boolean; annotator: string | null; lines: string[] }[] = [];
for (const r of preds.regions) {
  const lf = byRegion.get(r.region.id);
  if (!lf) { perRegion.push({ id: r.region.id, conditions: r.region.conditions, labelled: false, annotator: null, lines: ["unlabelled: no *.labels.json for this region"] }); continue; }
  const matches = matchLabels(lf.labels, r.predictions, r.gsdCmPx / 100, tolerancePx);
  const report = detectionReport(matches, r.predictions, { exhaustive: lf.exhaustive === true });
  perRegion.push({ id: r.region.id, conditions: r.region.conditions, labelled: true, annotator: lf.annotator, lines: detectionLines(report) });
  allMatches.push(...matches); allPreds.push(...r.predictions);
}
const overall = detectionReport(allMatches, preds.regions.filter(r => byRegion.has(r.region.id)).flatMap(r => r.predictions), { exhaustive: [...byRegion.values()].every(l => l.exhaustive === true) });
console.log(`Regions: ${preds.regions.length}, labelled: ${byRegion.size}.`);
for (const r of perRegion) { console.log(`\n== ${r.id} [${r.conditions.join(", ")}]${r.annotator ? ` labelled by ${r.annotator}` : ""} ==`); for (const l of r.lines) console.log(l); }
console.log("\n== all labelled regions together ==");
for (const l of detectionLines(overall)) console.log(l);
if (!byRegion.size) console.log("\nNo labels exist yet: detection precision, recall and crop/weed confusion cannot be calculated. Label the region PNGs with scripts/annotate/annotate.html and put the exports in " + labelsDir + ".");
const outDir = typeof args.out === "string" ? args.out : join("data", "bench", "eval");
mkdirSync(outDir, { recursive: true });
const matchesOut = preds.regions.filter(r => byRegion.has(r.region.id)).map(r => ({ region: r.region.id, matches: matchLabels(byRegion.get(r.region.id)!.labels, r.predictions, r.gsdCmPx / 100, tolerancePx).map(m => ({ label: m.label, prediction: m.prediction?.id ?? null, disposition: m.prediction?.disposition ?? null, distancePx: m.distancePx })) }));
writeFileSync(join(outDir, "detection-report.json"), JSON.stringify({ at: new Date().toISOString(), predictionsPath, labelsDir, tolerancePx: tolerancePx ?? 25, labelled: [...byRegion.keys()], overall, perRegion, matches: matchesOut }, null, 2));
console.log(`wrote ${join(outDir, "detection-report.json")}`);
