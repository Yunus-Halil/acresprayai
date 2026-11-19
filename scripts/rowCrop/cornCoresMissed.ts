// Development only, read only (CORES-2, 2026-11-18): one photograph's own L2 marks under the frozen FINAL-3 read,
// against its hand labels on the DEV tiles only (never the held-back ones). Of the labelled plants no L2 mark of this
// photograph stands within half a plant spacing of, how many have a vivid core (greenCores.ts, every local peak of the
// cores view) within half a spacing, and how strong; against the cores that became marks, and the cores on spots no
// label is near. Also where each such core stands: on a piece of the plant read's green or on none (the reach the
// cores pass uses, greenPoints.ts GREEN_POINTS.coreReachPx work pixels), and over the bar or under it.
//
//   npx vite-node scripts/rowCrop/cornCoresMissed.ts -- --photo <file> --analysis <a.json> --labels <file> --image <name> --out <file.json> [--reads <dir>]
import "../bench/nodeStorageShim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "../bench/images";
import { groundSampleAt } from "../../src/lib/directGeoref/projection";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { photoViews } from "../../src/lib/fieldTwin/layers/l1Views";
import { findMarks } from "../../src/lib/fieldTwin/layers/l2Find";
import { cornV1PlantCache, greenPitchPx, readCornV1 } from "../../src/lib/rowCrop/cornV1";
import { corePeaks } from "../../src/lib/rowCrop/greenCores";
import { GREEN_POINTS } from "../../src/lib/rowCrop/greenPoints";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { seedlingCache, sharedSeedlingMask } from "../../src/lib/rowCrop/seedlingGreen";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { type Label, labelTiles, within } from "./cornLabelJudge";

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); if (i < 0) throw new Error(`--${k} is required`); return argv[i + 1]; };
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const NAME = arg("image"), img = decodeImage(new Uint8Array(readFileSync(arg("photo")))), W = img.width, H = img.height;
const px = { width: W, height: H, rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, f = framesFromAnalysis(A).get(NAME)!, gsd = groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy);
// The frozen FINAL-3 read (cornPreset.ts "final3"'s read options), as a build reads it.
const v = readCornV1(px, rowCropParamsFor(cropProfileFor("corn")!, gsd), { enteredCrop: "corn", rowSpans: true, rowCandidates: true, cores: true, coresReference: "marks", countGuard: true });
// L1 and L2 again, to have the cores pass's own record (the same functions the read ran).
const seedlings = seedlingCache(px), plant = cornV1PlantCache(px, v.green, seedlings), V = photoViews(px, { seedlings, plant, pitchPx: greenPitchPx(v.green) }, true, "marks"), G = findMarks(px, V);
const same = G.points.length === v.plants.points.length && G.points.every((p, i) => p.x === v.plants.points[i].x && p.y === v.plants.points[i].y);
if (!same) throw new Error("L2 again is not the read's marks");
const reads = opt("reads"); if (reads) { const r = JSON.parse(readFileSync(join(reads, "reads", `${NAME}.json`), "utf8")) as { plants: [number, number][] }; const ok = r.plants.length === G.points.length && r.plants.every((p, i) => p[0] === Math.round(G.points[i].x) && p[1] === Math.round(G.points[i].y)); console.log(`the stored read's marks are these: ${ok}`); }
const info = G.coresInfo!, bar = info.threshold!, med = info.medianOnMarks!, f0 = G.workFactor, reachPx = GREEN_POINTS.coreReachPx * f0 + f0;
const mask = sharedSeedlingMask(plant, px);
const greenNear = (x: number, y: number) => { for (let dy = -reachPx; dy <= reachPx; dy++) for (let dx = -reachPx; dx <= reachPx; dx++) { const X = Math.round(x) + dx, Y = Math.round(y) + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && mask[Y * W + X]) return true; } return false; };
const peaks = corePeaks(V.cores!.strength, W, H, V.cores!.top, 0);
// Half a plant spacing in this photograph's pixels (0.14 m, the flight's plant spacing; the judge matches on the ground).
const R = 0.07 / gsd;
const LAB = (JSON.parse(readFileSync(arg("labels"), "utf8")) as { images: { image: string; width: number; height: number; points: Label[] }[] }).images.find(x => x.image.replace(/\.[^.]+$/, "") === NAME)!;
const dev = labelTiles({ x: 0, y: 0, w: LAB.width, h: LAB.height }, 4, false), inDev = (x: number, y: number) => dev.some(t => within(t, x, y));
const labels = LAB.points.filter(l => inDev(l.x, l.y)), plants = labels.filter(l => l.type === "plant");
const marks = G.points, fb = G.foundBy!;
const nearest = <T extends { x: number; y: number }>(x: number, y: number, L: T[]) => { let b = -1, bd = Infinity; L.forEach((q, i) => { const d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; b = i; } }); return { i: b, d: bd }; };
// Labelled plants with no L2 mark within half a spacing.
const missed = plants.filter(l => nearest(l.x, l.y, marks).d > R);
const rel = (s: number) => Math.round((s / med) * 1000) / 1000;
const missedCores = missed.map(l => { const n = nearest(l.x, l.y, peaks); const c = n.d <= R ? peaks[n.i] : null; return { x: l.x, y: l.y, core: c ? { dPx: Math.round(n.d * 10) / 10, strength: c.v, ofMedianOnMarks: rel(c.v), overBar: c.v >= bar, onGreen: greenNear(c.x, c.y) } : null }; });
// The cores that became marks: those the pass added (foundBy 2, at the core) and, for a mark that took a core (foundBy 3), the kept core nearest it.
const kept = info.kept.filter(k => k.where === "piece"), became: number[] = [];
marks.forEach((m, i) => { if (!inDev(m.x, m.y)) return; if (fb[i] === 2) became.push(peaks[nearest(m.x, m.y, peaks).i].v); else if (fb[i] === 3) { const n = nearest(m.x, m.y, kept); if (n.i >= 0 && n.d <= R) became.push(kept[n.i].v); } });
// Cores on spots no label (plant or unsure) is within half a spacing of, in the dev tiles.
const unl = peaks.filter(c => inDev(c.x, c.y) && nearest(c.x, c.y, labels).d > R);
const q = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const at = (t: number) => (s.length ? rel(s[Math.min(s.length - 1, Math.floor(t * s.length))]) : null); return { n: s.length, p10: at(0.1), q1: at(0.25), median: at(0.5), q3: at(0.75), p90: at(0.9) }; };
const withCore = missedCores.filter(m => m.core);
const out = {
  photo: NAME, gsdM: gsd, halfSpacingPx: Math.round(R * 10) / 10, bar: { reference: info.reference, medianOnMarks: med, factor: V.cores!.asked.factor, threshold: bar, barOfMedian: rel(bar) },
  devTiles: dev.map(t => t.id), labelledPlants: plants.length, l2Marks: marks.filter(m => inDev(m.x, m.y)).length,
  missedByL2: missed.length,
  missedWithACore: { count: withCore.length, overBar: withCore.filter(m => m.core!.overBar).length, onGreen: withCore.filter(m => m.core!.onGreen).length, onNoGreen: withCore.filter(m => !m.core!.onGreen).length, overBarOnNoGreen: withCore.filter(m => m.core!.overBar && !m.core!.onGreen).length, overBarOnGreen: withCore.filter(m => m.core!.overBar && m.core!.onGreen).length },
  strengthsAsShareOfMedianCoreOnMarks: { missedLabelledPlants: q(withCore.map(m => m.core!.strength)), coresThatBecameMarks: q(became), coresOnUnlabelledSpots: q(unl.map(c => c.v)), coresOnUnlabelledSpotsOnNoGreen: q(unl.filter(c => !greenNear(c.x, c.y)).map(c => c.v)) },
  // How many cores on unlabelled spots and on no green stand at or over each multiple of the median (what an option at that strength would add there).
  unlabelledOnNoGreenAtOrOver: Object.fromEntries([0.4, 0.6, 0.8, 1.0, 1.2, 1.5].map(k => [k, unl.filter(c => !greenNear(c.x, c.y) && c.v >= k * med).length])),
  missedOnNoGreenAtOrOver: Object.fromEntries([0.4, 0.6, 0.8, 1.0, 1.2, 1.5].map(k => [k, withCore.filter(m => !m.core!.onGreen && m.core!.strength >= k * med).length])),
  missed: missedCores,
};
writeFileSync(arg("out"), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, missed: undefined }, null, 1));
