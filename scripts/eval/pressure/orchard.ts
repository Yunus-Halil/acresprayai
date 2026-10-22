// The grade's headline numbers on the five orchard trial frames, so a change to the grade can be stated as before
// and after (2026-10-22).
//
//   npx vite-node scripts/eval/pressure/orchard.ts -- --dir <trial dir> [--frames DJI_0301,...] [--out file.json]
//
// The frames are the kept orchard flight prepared as stand-in field maps for the two-stage trial
// (docs/features/two-stage-trial-2026-10-19.md; outputs on D:\swardus-research\weed-vision-lab-outputs\
// two-stage-trial-2026-10-19): per frame its zoom 22 raster, its fitted planting layout (layout-rows.json) and the
// RF-DETR windows run over it with the crop painted out (window-cache-layout.json), replayed from disk, so nothing
// calls the model. No truth: these are the grade's own counts, not accuracy. The layout predates the "expected"
// state's name; its "probable" and "ambiguous" plants are what the fitter now calls expected (c4454c2).
import "../../bench/nodeStorageShim";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FieldRows } from "../../../src/lib/weedVision/fieldRows";
import type { FrameDetection } from "../../../src/lib/weedVision/frames";
import { latLngOfPx } from "../../../src/lib/weedVision/mapRun";
import { type LoadedFixture, asPlant, runFixture } from "./fixture";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = arg("dir", "D:/swardus-research/weed-vision-lab-outputs/two-stage-trial-2026-10-19")!;
const FRAMES = (arg("frames") ?? "DJI_0301,DJI_0303,DJI_0312,DJI_0320,DJI_0327").split(",").filter(Boolean);

function frameFixture(frame: string): LoadedFixture {
  const d = join(DIR, frame);
  const meta = JSON.parse(readFileSync(join(d, "meta.json"), "utf8"));
  const { X0, Y0, w, h } = meta.z23;
  const ring = [latLngOfPx(X0, Y0, 23), latLngOfPx(X0 + w, Y0, 23), latLngOfPx(X0 + w, Y0 + h, 23), latLngOfPx(X0, Y0 + h, 23)];
  const rows: FieldRows = JSON.parse(readFileSync(join(d, "layout-rows.json"), "utf8"));
  for (const c of rows.ctx.crops) if ((c.state as string) === "probable" || (c.state as string) === "ambiguous") c.state = "expected";
  const cache: [string, { detections: FrameDetection[] }][] = JSON.parse(readFileSync(join(d, "window-cache-layout.json"), "utf8"));
  const plants = cache.flatMap(([, run]) => run.detections).filter(p => p.klass === "weed").map(asPlant);
  const raster = { z: 22, left: meta.z22.X0, top: meta.z22.Y0, width: meta.z22.w, height: meta.z22.h, rgba: new Uint8ClampedArray(readFileSync(join(d, "z22.rgba"))) };
  return { name: frame, crop: null, ring, raster, rows, plants, photoBased: false, truth: [] };
}

async function main() {
  const out: Record<string, unknown>[] = [];
  for (const frame of FRAMES) {
    const { grade } = await runFixture(frameFixture(frame));
    const s = grade.summary as typeof grade.summary & { disagreeing?: number };
    const row = {
      frame, assessed: s.assessed, notAssessed: s.notAssessed, confirmed: s.confirmed, possible: s.possible,
      actionCells: s.byClass.action + s.byClass.high, highCells: s.byClass.high, escapes: s.escapes, treatWhileSmall: s.treatWhileSmall,
      fieldCover: +s.fieldCover.toFixed(4), fieldClass: s.fieldClass, patches: s.patches, unitM: s.unitM,
      withLossBand: grade.cells.filter(c => c.lossBand).length, disagreeing: s.disagreeing ?? null,
    };
    console.log(JSON.stringify(row));
    out.push(row);
  }
  const total = (k: string) => out.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const sum = { frames: out.length, confirmed: total("confirmed"), possible: total("possible"), actionCells: total("actionCells"), escapes: total("escapes"), treatWhileSmall: total("treatWhileSmall"), withLossBand: total("withLossBand") };
  console.log(JSON.stringify({ total: sum }));
  if (arg("out")) writeFileSync(arg("out")!, JSON.stringify({ frames: out, total: sum }, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
