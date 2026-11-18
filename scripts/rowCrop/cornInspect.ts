// Development only: the computing half of the corn inspector (/dev/corn-inspector, scripts/rowCrop/cornInspectorPlugin.ts
// runs it). Every result comes from the app's own code; nothing here decides anything. Three jobs:
//
//   reads  --analysis <a.json> --photos <dir> --out <dir> [--range a:b] [--options <json>]
//          every photograph read as a build reads it (build/corn.ts cornPhotoRead), one file each: <out>/reads/<name>.json
//   field  --analysis <a.json> --out <dir> [--options <json>]
//          the reads combined as the build combines them (build/corn.ts cornStage: cornFieldAndGround with FIELD,
//          then placeDots, readRows and cornPlantsOf with the field's ground): <out>/field.json + <out>/field.bin
//   photo  --photo <file> --out <dir> [--analysis <a.json> --name <name>] [--options <json>]
//          one photograph's views and marks (the green view, the cores view, first-pass marks and the marks the cores
//          add), and for a photograph with no flight Photo Scout's read: <out>/photo/<name>/{info.json, green.png, cores.jpg}
//
// --options (pass 2): { "cores": bool, "coresReference": "marks"|"strongest", "countGuard": bool, "sequence": {...} }.
// Without it every option is as the code has it.
import "../bench/nodeStorageShim";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { decodeImage, encodeJpeg, encodePng } from "../bench/images";
import { groundSampleAt, type GeorefFrame } from "../../src/lib/directGeoref/projection";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { cornPhotoRead } from "../../src/lib/fieldTwin/build/corn";
import { FIELD, type CornPhotoRead, cornFieldAndGround } from "../../src/lib/fieldTwin/cornField";
import { cornPlantsOf, placeDots, readRows } from "../../src/lib/fieldTwin/cornPlants";
import { PLANTS_FIRST, SEQUENCE, SETTLED, certainEvidence } from "../../src/lib/fieldTwin/plantsFirst";
import { CORN_CORES, CORN_COUNT_GUARD, cornV1AsRead, cornV1CoresAsked, cornV1PlantCache, cornV1RowCover, greenPitchPx, readCornV1 } from "../../src/lib/rowCrop/cornV1";
import { GREEN_POINTS, plantPointsFromGreen } from "../../src/lib/rowCrop/greenPoints";
import { coresView, vividGreen } from "../../src/lib/rowCrop/greenCores";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { SEEDLING_GREEN, seedlingCache, sharedSeedlingMask } from "../../src/lib/rowCrop/seedlingGreen";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { HEADER_BYTES, estimateGsd, parsePhotoHeader } from "../../src/lib/photoScout/exif";

const ROOT = resolve(__dirname, "../..");
const argv = process.argv.slice(2), job = argv[0];
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
type Options = { cores?: boolean; coresReference?: "marks" | "strongest"; countGuard?: boolean; sequence?: Partial<typeof SEQUENCE> };
const OPTIONS: Options = opt("options") ? JSON.parse(opt("options")!) : {};
// The read's options are set where the code keeps them, for this process only (as a flipped default would).
if (OPTIONS.cores != null) CORN_CORES.on = OPTIONS.cores;
if (OPTIONS.coresReference) CORN_CORES.reference = OPTIONS.coresReference;
if (OPTIONS.countGuard != null) CORN_COUNT_GUARD.on = OPTIONS.countGuard;
const pixelsOf = (file: string) => { const img = decodeImage(new Uint8Array(readFileSync(file))); return { img, px: { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength) } }; };
/** A photograph's file: its name in the folder, or (a record whose names join folder and file) the first "_" as a folder. */
const fileOf = (dir: string, name: string) => [name, name.replace("_", "/")].flatMap(n => [".JPG", ".jpg", ".jpeg", ".JPEG"].map(e => join(dir, n + e))).find(existsSync);
const r2 = (x: number) => Math.round(x * 100) / 100;

// ------------------------------------------------------------------------------------------------------------ reads
if (job === "reads") {
  const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, DIR = arg("photos"), OUT = join(arg("out"), "reads"), frames = framesFromAnalysis(A);
  mkdirSync(OUT, { recursive: true });
  const [a, b] = (opt("range") ?? `0:${A.reads.length}`).split(":").map(Number);
  for (const r of A.reads.slice(a, b)) {
    const out = join(OUT, `${r.name}.json`); if (existsSync(out)) continue;
    const f = frames.get(r.name), path = fileOf(DIR, r.name);
    if (!f || !path) { console.log(`${r.name}: no camera or no photograph, skipped`); continue; }
    const t0 = Date.now(), { px } = pixelsOf(path);
    // Exactly what a build carries from the photograph (build/corn.ts:26), with the camera's pixel size.
    const read = cornPhotoRead(r.name, px, groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy));
    writeFileSync(out, JSON.stringify(read));
    console.log(`${r.name}: ${read.plants.length} marks, ${read.rows.length} rows, ${read.low ? read.low.length : 0} candidates, ${Date.now() - t0} ms`);
  }
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------------------ field
if (job === "field") {
  const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, OUT = arg("out"), frames = framesFromAnalysis(A);
  const dir = join(OUT, "reads"), reads: CornPhotoRead[] = A.reads.map(r => join(dir, `${r.name}.json`)).filter(existsSync).map(p => JSON.parse(readFileSync(p, "utf8")));
  console.log(`${reads.length} of ${A.reads.length} photographs read`);
  const t0 = Date.now();
  // As the build (build/corn.ts cornStage): the field with FIELD, then the plants with the field's ground.
  const { field: F, ground } = cornFieldAndGround(reads, frames, FIELD);
  const opts = { ground, ...(OPTIONS.sequence ? { sequence: { ...SEQUENCE, ...OPTIONS.sequence } } : {}) };
  const tField = Date.now();
  const P = placeDots(reads, frames, F, opts);
  const rec = P ? readRows(P, F, opts) : null, plants = P && rec ? cornPlantsOf(P, rec, F, opts) : null;
  console.log(`field ${tField - t0} ms, plants ${Date.now() - tField} ms; ${P ? P.all.length : 0} dots`);
  // Big arrays go in a binary file beside a small JSON that says where each is.
  const bins: { name: string; type: "f32" | "f64" | "i32" | "u8"; data: ArrayBufferView }[] = [];
  const put = (name: string, type: "f32" | "f64" | "i32" | "u8", data: ArrayLike<number>) => bins.push({ name, type, data: type === "f32" ? Float32Array.from(data) : type === "f64" ? Float64Array.from(data) : type === "i32" ? Int32Array.from(data) : Uint8Array.from(data) });
  let meta: Record<string, unknown> = { analysis: arg("analysis"), options: OPTIONS, photographsRead: reads.length, photographs: A.reads.length, fieldOptionsOfTheRecordEqualFIELD: JSON.stringify(A.fieldOptions ?? null) === JSON.stringify(FIELD) };
  // The ground the field judged, sampled on a grid (state), and its detail on a coarser one.
  if (P && rec) {
    const n = P.all.length, S = P.sights!;
    let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity; for (const d of P.all) { e0 = Math.min(e0, d.e); e1 = Math.max(e1, d.e); n0 = Math.min(n0, d.n); n1 = Math.max(n1, d.n); }
    e0 -= 3; n0 -= 3; e1 += 3; n1 += 3;
    const cell = 0.25, gw = Math.ceil((e1 - e0) / cell), gh = Math.ceil((n1 - n0) / cell), state = new Uint8Array(gw * gh);
    if (ground) for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) state[j * gw + i] = ground.state(e0 + (i + 0.5) * cell, n0 + (j + 0.5) * cell);
    const dcell = 1, dw = Math.ceil((e1 - e0) / dcell), dh = Math.ceil((n1 - n0) / dcell), dSight = new Int32Array(dw * dh).fill(-1), dConc = new Float32Array(dw * dh).fill(-1);
    if (ground?.detail) for (let j = 0; j < dh; j++) for (let i = 0; i < dw; i++) { const d = ground.detail(e0 + (i + 0.5) * dcell, n0 + (j + 0.5) * dcell); if (d) { dSight[j * dw + i] = d.sightings; dConc[j * dw + i] = d.concentration ?? -1; } }
    put("ground.state", "u8", state); put("ground.sightings", "i32", dSight); put("ground.concentration", "f32", dConc);
    // Dots.
    put("dot.e", "f64", P.all.map(d => d.e)); put("dot.n", "f64", P.all.map(d => d.n)); put("dot.photos", "i32", P.all.map(d => d.photos)); put("dot.covered", "i32", P.covered);
    put("dot.tier", "u8", Array.from({ length: n }, (_, i) => P.tier?.[i] ?? 0)); put("dot.certainty", "u8", rec.certainty); put("dot.rowOf", "i32", rec.rowOf);
    put("dot.why", "u8", rec.why); put("dot.settled", "u8", rec.settled); put("dot.between", "u8", rec.between); put("dot.offSpacing", "u8", rec.offSpacing); put("dot.spread", "f32", P.all.map(d => d.spreadM));
    put("dot.certainEvidence", "u8", P.all.map((d, i) => (certainEvidence(d, P.covered[i], opts.sequence ?? SEQUENCE) ? 1 : 0)));
    // Each dot's sightings: for the stricter marks' dots, indices into the sightings; for a candidate, into the candidates' own sightings.
    const start = new Int32Array(n + 1), mem: number[] = [];
    for (let i = 0; i < n; i++) { start[i] = mem.length; if (i < P.strict) mem.push(...P.all[i].members); else mem.push(...(P.candidates?.members[i - P.strict] ?? [])); }
    start[n] = mem.length; put("dot.memberStart", "i32", start); put("dot.members", "i32", mem);
    put("sight.p", "i32", S.map(s => s.p)); put("sight.u", "f32", S.map(s => s.u)); put("sight.v", "f32", S.map(s => s.v)); put("sight.e", "f64", S.map(s => s.e)); put("sight.n", "f64", S.map(s => s.n));
    const cf = P.candidates?.from ?? [];
    put("cand.p", "i32", cf.map(c => c.p)); put("cand.u", "f32", cf.map(c => c.u)); put("cand.v", "f32", cf.map(c => c.v)); put("cand.sight", "i32", cf.map(c => c.sight));
    // Where each SETTLED name is written in plantsFirst.ts (its rule's line), read from the source as it is now.
    const SRC = "src/lib/fieldTwin/plantsFirst.ts", lines = readFileSync(join(ROOT, SRC), "utf8").split(/\r?\n/), at: Record<string, number> = {};
    lines.forEach((L, k) => { for (const m of L.matchAll(/SETTLED\.(\w+)/g)) { if (L.slice(Math.max(0, m.index! - 4), m.index) === "=== ") continue; at[m[1]] ??= k + 1; } });
    const lineOf = (re: RegExp) => lines.findIndex(L => re.test(L)) + 1;
    meta = { ...meta,
      origin: F.origin, directionDeg: F.directionDeg, pitchM: F.pitchM, photos: P.photos, shifts: P.shifts, strict: P.strict, repeatM: P.repeatM, gateM: P.gateM, nDots: n, nSights: S.length, nCand: cf.length,
      frames: A.frames.filter(f => P.photos.includes(f.name)),
      ground: ground ? { e0, n0, cell, gw, gh, dcell, dw, dh, spacingM: ground.spacingM } : null, planting: F.planting,
      geometry: rec.geometry, tooCloseM: rec.tooCloseM, certainGaps: rec.certainGaps, spacingRules: rec.spacingRules, gaps: rec.gaps, unplanted: rec.unplanted, alleyRefused: rec.alleyRefused, alone: rec.alone.dot.length,
      rows: rec.rows.map(r => ({ id: r.id, kind: r.kind, plants: r.dots.length, lengthM: r2(r.lengthM), perM: r2(r.perM), line: r.line.map(([e, nn]) => [r2(e), r2(nn)]), segments: r.segments })),
      sequence: opts.sequence ?? SEQUENCE, placing: PLANTS_FIRST,
      settledNames: Object.fromEntries(Object.entries(SETTLED).map(([k, v]) => [v, k])), settledLine: at, source: SRC,
      lines: { certainEvidence: lineOf(/^export const certainEvidence/), reconstruct: lineOf(/^export function reconstruct/), placeDots: (() => { const L = readFileSync(join(ROOT, "src/lib/fieldTwin/cornPlants.ts"), "utf8").split(/\r?\n/); return L.findIndex(x => /^export function placeDots/.test(x)) + 1; })() },
      report: {
        plants: plants ? plants.summary : null, plantsNote: plants ? null : "The plants made no certain row: the build keeps the field's rows.", plantPoints: plants ? plants.points : [], plantShown: plants ? plants.shown : [],
        field: F.summary, weeds: F.weeds.map(w => ({ e: w.e, n: w.n, lat: w.lat, lng: w.lng, verdict: w.verdict, areaM2: w.areaM2, seenBy: w.seenBy, coveredBy: w.coveredBy })),
        gaps: F.gaps.map(g => ({ aEN: g.aEN, bEN: g.bEN, verdict: g.verdict, lengthM: g.lengthM })), fieldRows: F.rows.length,
      },
    };
  } else meta = { ...meta, failed: "the photographs made no dot (placeDots returned null)" };
  let offset = 0; const desc = bins.map(b => { const d = { name: b.name, type: b.type, length: (b.data as unknown as { length: number }).length, offset }; offset += b.data.byteLength; offset = Math.ceil(offset / 8) * 8; return d; });
  const buf = Buffer.alloc(offset); for (let k = 0; k < bins.length; k++) Buffer.from(bins[k].data.buffer, bins[k].data.byteOffset, bins[k].data.byteLength).copy(buf, desc[k].offset);
  writeFileSync(join(OUT, "field.bin"), buf); writeFileSync(join(OUT, "field.json"), JSON.stringify({ ...meta, arrays: desc }));
  // Self-check: every dot was settled by a named test.
  if (rec) { const unset = Array.from(rec.settled).filter(x => x === SETTLED.none).length; console.log(`settled: ${unset} dots by no named test`); }
  console.log(`field.json + field.bin written (${(offset / 1e6).toFixed(1)} MB)`);
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------------------ photo
if (job === "photo") {
  const PHOTO = arg("photo"), NAME = opt("name") ?? PHOTO.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, ""), OUT = join(arg("out"), "photo", NAME);
  mkdirSync(OUT, { recursive: true });
  let frame: GeorefFrame | undefined;
  if (opt("analysis")) frame = framesFromAnalysis(JSON.parse(readFileSync(opt("analysis")!, "utf8")) as TwinAnalysis).get(NAME);
  const t0 = Date.now(), { img, px } = pixelsOf(PHOTO), W = px.width, H = px.height;
  // The pixel size: the camera's (a flight, as a build), else what the file's header gives (as Photo Scout).
  const ex = parsePhotoHeader(new Uint8Array(readFileSync(PHOTO)).subarray(0, HEADER_BYTES)), est = estimateGsd(ex, { imageWidth: W });
  const gsd = frame ? groundSampleAt(frame, frame.intrinsics.cx, frame.intrinsics.cy) : est.gsdM;
  // The read: a flight's as a build makes it (rowSpans), a single photograph's as Photo Scout makes it.
  const v = readCornV1(px, rowCropParamsFor(cropProfileFor("corn")!, gsd), { enteredCrop: "corn", ...(frame ? { rowSpans: true } : {}) });
  const tRead = Date.now(), ad = v.green;
  // The plant read's own mask and marks, then the same with the cores asked (the cores option's own setting).
  const first = plantPointsFromGreen(px, GREEN_POINTS, cornV1PlantCache(px, ad, seedlingCache(px, SEEDLING_GREEN)), null);
  const asked = cornV1CoresAsked(ad), withCores = asked ? plantPointsFromGreen(px, GREEN_POINTS, cornV1PlantCache(px, ad, seedlingCache(px, SEEDLING_GREEN)), asked) : null;
  // Self-check: the read's marks are the first pass (cores off) or the pass with the cores (cores on).
  const readMarks = v.plants.points, expect = CORN_CORES.on && withCores ? withCores.points : first.points;
  const marksEqual = v.count?.withheld ? null : readMarks.length === expect.length && readMarks.every((p, i) => p.x === expect[i].x && p.y === expect[i].y);
  // The green view: the mask the plant read used, green where it is green, clear elsewhere.
  const mask = sharedSeedlingMask(cornV1PlantCache(px, ad, seedlingCache(px, SEEDLING_GREEN)), px), gr = new Uint8Array(W * H * 4); let green = 0;
  for (let i = 0; i < W * H; i++) if (mask[i]) { gr[i * 4] = 40; gr[i * 4 + 1] = 255; gr[i * 4 + 2] = 80; gr[i * 4 + 3] = 255; green++; }
  writeFileSync(join(OUT, "green.png"), encodePng({ width: W, height: H, data: gr }));
  // The cores view: its strength, white at three times the bar the option uses (none without a row spacing).
  let coresMeta: Record<string, unknown> | null = null;
  if (asked && withCores) {
    const view = coresView(vividGreen(px), W, H, asked.finePx, asked.widePx), bar = withCores.coresInfo!.threshold, white = bar ? 3 * bar : view.top, g = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) { const x = Math.min(255, Math.round((255 * view.strength[i]) / white)); g[i * 4] = x; g[i * 4 + 1] = x; g[i * 4 + 2] = x; g[i * 4 + 3] = 255; }
    writeFileSync(join(OUT, "cores.jpg"), encodeJpeg({ width: W, height: H, data: g }, 88));
    const I = withCores.coresInfo!;
    coresMeta = { finePx: asked.finePx, widePx: asked.widePx, reference: I.reference, factor: asked.factor, share: asked.share, strongest: I.strongest, medianOnMarks: I.medianOnMarks ?? null, onMarks: I.onMarks ?? null, threshold: I.threshold, peaks: I.peakStrengths ? I.peakStrengths.length : null, kept: I.kept.length, keptInCover: I.kept.filter(k => k.where === "cover").length, keptOnNoPiece: I.kept.filter(k => k.where === "none").length, added: withCores.coresAdded ?? 0, white };
  }
  const cover = cornV1RowCover(px, v);
  // Photo Scout's read of a photograph with no flight: as the page shows it (cornV1AsRead).
  const scout = frame ? null : cornV1AsRead(v);
  const info = {
    name: NAME, file: PHOTO, width: W, height: H, options: OPTIONS, flight: !!frame, readMs: tRead - t0, ms: Date.now() - t0,
    gsdM: gsd, gsdBasis: frame ? "the aligned camera (as a build)" : est.basis, readScale: { gsdM: ad.gsdM, basis: ad.scaleBasis },
    plans: ad.plans.map(p => ({ stage: p.stage, share: p.ownedShare, pitchPx: p.pitchPx })), rowSpacingPx: greenPitchPx(ad), greenShare: green / (W * H),
    firstPass: first.points.map(p => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]), typicalPx: first.typicalPx,
    coresAdded: withCores ? withCores.points.slice(first.points.length).map(p => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]) : [],
    cores: coresMeta, coresOn: CORN_CORES.on, readMarks: readMarks.length, readMarksAreTheExpectedPass: marksEqual,
    candidates: v.plants.low ? v.plants.low.length : null, rows: v.rows.map(r => ({ points: r.points, identity: r.identity, evidence: r.evidence, plants: r.plants })),
    guard: { on: CORN_COUNT_GUARD.on, share: cover.share, cut: CORN_COUNT_GUARD.cut, withheld: v.count?.withheld ?? null },
    summary: v.summary, notes: v.notes,
    scout: scout ? { rows: scout.rows.map(r => ({ points: r.points, identity: r.identity, gaps: r.gaps })), weeds: scout.weeds.map(w => ({ x: w.x, y: w.y, hull: w.hull, areaM2: w.areaM2 })), excluded: scout.excluded.length, summary: scout.summary, cornV1: scout.cornV1, notes: scout.notes } : null,
  };
  writeFileSync(join(OUT, "info.json"), JSON.stringify(info));
  console.log(`${NAME}: read ${tRead - t0} ms, all ${Date.now() - t0} ms; ${first.points.length} first-pass marks, ${info.coresAdded.length} the cores add; read marks as expected: ${marksEqual}`);
  void img; void dirname; void readdirSync; void createHash;
  process.exit(0);
}
throw new Error(`unknown job ${job}: reads, field or photo`);
