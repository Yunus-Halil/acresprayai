// Development only: the computing half of the corn inspector (/dev/corn-inspector, scripts/rowCrop/cornInspectorPlugin.ts
// runs it). Every result comes from the app's own code; nothing here decides anything. Four jobs:
//
//   reads  --analysis <a.json> --photos <dir> --out <readsDir> [--range a:b] [--read <json>]
//          every photograph read as a build reads it (build/corn.ts cornPhotoRead), one file each: <readsDir>/reads/<name>.json
//   field  --analysis <a.json> --reads <readsDir> --out <fieldDir> [--field <json>]
//          the reads combined as the build combines them (build/corn.ts cornStage: cornFieldAndGround with FIELD, then
//          placeDots, readRows and cornPlantsOf with the field's ground): <fieldDir>/field.json + field.bin
//   photo  --photo <file> --out <readsDir> [--analysis <a.json> --name <name>] [--read <json>]
//          one photograph's views and marks (the green view, the cores view, first-pass marks and the marks the cores
//          add), and for a photograph with no flight Photo Scout's read: <readsDir>/photo/<name>/{info.json, green.png, cores.jpg}
//   score  --labels <file> --image <name> --out <dir> [--hidden] and either
//            --analysis <a.json> --reads <readsDir> [--field <json>]     (a flight: field.ts's dots in the photograph)
//            --photo <file> [--read <json>]                              (one photograph: its read's own marks)
//          the photograph's marks against the labels by cornLabelJudge.ts (the scorer of SCORE.md onwards):
//          <dir>/score-<name>[-hidden].json. --hidden scores the held-back tiles in place of the dev tiles.
//
// Options (the inspector's switches; without them every option is as the code has it):
//   --read  { "cores": bool, "coresReference": "marks"|"strongest", "countGuard": bool, "rowSpans": bool,
//             "coresBySize": "self" | <sizes.json: { photograph: typical plant px }> }   (layers phase 3a, L1)
//   --field { "sequence": {...SEQUENCE}, "placing": {...PLANTS_FIRST}, "free": bool, "fieldSeed": bool, "groundAsked": bool,
//             "layers": {...LAYERS} }   (layers/options.ts: groundFromObvious, tooCloseFromSpread, secondLook, unsureList)
//   --photos <dir>  the flight's photographs, for the second look (L7 reads them again); field and score jobs
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodeImage, encodeJpeg, encodePng } from "../bench/images";
import { groundSampleAt, type GeorefFrame } from "../../src/lib/directGeoref/projection";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { cornPhotoRead } from "../../src/lib/fieldTwin/build/corn";
import { FIELD, type CornPhotoRead, compactCornRead, cornFieldAndGround, cornFlightGuard } from "../../src/lib/fieldTwin/cornField";
import { type CornPlantsOptions, cornPlantsOf, placeDots, readRows } from "../../src/lib/fieldTwin/cornPlants";
import { PLANTS_FIRST, SEQUENCE, SETTLED, certainEvidence } from "../../src/lib/fieldTwin/plantsFirst";
import { fieldProfile, readsProfile } from "../../src/lib/fieldTwin/layers/l5Profile";
import { LAYERS, type LayerOptions } from "../../src/lib/fieldTwin/layers/options";
import { type Looker, secondLookOnField } from "../../src/lib/fieldTwin/layers/l7SecondLook";
import { unsureList } from "../../src/lib/fieldTwin/layers/l8Report";
import { CORN_CORES, CORN_COUNT_GUARD, cornV1AsRead, cornV1CoresAsked, cornV1PlantCache, cornV1RowCover, greenPitchPx, readCornV1 } from "../../src/lib/rowCrop/cornV1";
import { GREEN_POINTS, plantPointsFromGreen } from "../../src/lib/rowCrop/greenPoints";
import { coresView, vividGreen } from "../../src/lib/rowCrop/greenCores";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { SEEDLING_GREEN, SEEDLING_V1, seedlingCache, sharedSeedlingMask } from "../../src/lib/rowCrop/seedlingGreen";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { HEADER_BYTES, estimateGsd, parsePhotoHeader } from "../../src/lib/photoScout/exif";
import { type Label, type Mark, TIERS, fieldMarks, judgeTile, labelSpacingPx, labelTiles, within } from "./cornLabelJudge";

const ROOT = resolve(__dirname, "../..");
const argv = process.argv.slice(2), job = argv[0];
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
type ReadOptions = { cores?: boolean; coresReference?: "marks" | "strongest"; countGuard?: boolean; rowSpans?: boolean; coresBySize?: string };
type FieldOptions = { sequence?: Partial<typeof SEQUENCE>; placing?: Partial<typeof PLANTS_FIRST>; free?: boolean; fieldSeed?: boolean; groundAsked?: boolean; layers?: Partial<LayerOptions> };
const READ: ReadOptions = opt("read") ? JSON.parse(opt("read")!) : {}, FOPT: FieldOptions = opt("field") ? JSON.parse(opt("field")!) : {};
// The read's options are set where the code keeps them, for this process only (as a flipped default would).
if (READ.cores != null) CORN_CORES.on = READ.cores;
if (READ.coresReference) CORN_CORES.reference = READ.coresReference;
if (READ.countGuard != null) CORN_COUNT_GUARD.on = READ.countGuard;
const pixelsOf = (file: string) => { const img = decodeImage(new Uint8Array(readFileSync(file))); return { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength) }; };
/** A photograph's file: its name in the folder, or (a record whose names join folder and file) the first "_" as a folder. */
const fileOf = (dir: string, name: string) => [name, name.replace("_", "/")].flatMap(n => [".JPG", ".jpg", ".jpeg", ".JPEG"].map(e => join(dir, n + e))).find(existsSync);
const r2 = (x: number) => Math.round(x * 100) / 100;
/** A flight's photograph read as a build reads it: build/corn.ts cornPhotoRead, or (rowSpans off) the same read without the candidates' extents. */
// Phase 3a (L1): the typical plant's size per photograph, from a field profile's sizes file, or each photograph's own ("self").
// A sizes file is { photograph: px }, or a field.json whose L5 profile holds them (profile.perPhoto[].sizePx).
const SIZES: Record<string, number> | null = READ.coresBySize && READ.coresBySize !== "self" ? (j => (j.profile?.perPhoto ? Object.fromEntries((j.profile.perPhoto as { name: string; sizePx?: number | null }[]).filter(x => x.sizePx != null).map(x => [x.name, x.sizePx!])) : j))(JSON.parse(readFileSync(READ.coresBySize, "utf8"))) : null;
const sizeFor = (name: string): number | "self" | null => (!READ.coresBySize ? null : SIZES ? SIZES[name] ?? null : "self");
const flightRead = (name: string, px: ReturnType<typeof pixelsOf>, gsd: number | null): CornPhotoRead =>
  READ.rowSpans === false ? compactCornRead(name, readCornV1(px, rowCropParamsFor(cropProfileFor("corn")!, gsd), { enteredCrop: "corn", ...(READ.coresBySize ? { coresSizePx: sizeFor(name) } : {}) }), 1) : cornPhotoRead(name, px, gsd, false, sizeFor(name));
/** L7's view of a photograph again: its pixels and the green view the plant read used (the read says which mask). */
const lookerFor = (dir: string | null, reads: CornPhotoRead[]): Looker | null => {
  if (!dir) return null;
  const readOf = new Map(reads.map(r => [r.name, r]));
  return name => {
    const path = fileOf(dir, name); if (!path) return null;
    const px = pixelsOf(path), seedlings = seedlingCache(px, SEEDLING_GREEN);
    const cache = readOf.get(name)?.look?.plantMask === "v1" ? { ...seedlingCache(px, SEEDLING_V1), levels: seedlings.levels } : seedlings;
    return { px, green: sharedSeedlingMask(cache, px) };
  };
};
/** The field and the plants, as build/corn.ts cornStage makes them, with the field options asked. */
function field(A: TwinAnalysis, readsDir: string) {
  const frames = framesFromAnalysis(A), dir = join(readsDir, "reads");
  // As the build: the guard over the flight (cornField.ts cornFlightGuard), then the field.
  const G = cornFlightGuard(A.reads.map(r => join(dir, `${r.name}.json`)).filter(existsSync).map(p => JSON.parse(readFileSync(p, "utf8")) as CornPhotoRead)), reads = G.reads;
  const { field: F, ground } = cornFieldAndGround(reads, frames, FIELD);
  const opts: CornPlantsOptions = { ground: FOPT.groundAsked === false ? null : ground, ...(FOPT.sequence ? { sequence: { ...SEQUENCE, ...FOPT.sequence } } : {}), ...(FOPT.placing ? { placing: { ...PLANTS_FIRST, ...FOPT.placing } } : {}), ...(FOPT.free != null ? { free: FOPT.free } : {}), ...(FOPT.fieldSeed != null ? { fieldSeed: FOPT.fieldSeed } : {}), ...(FOPT.layers ? { layers: FOPT.layers } : {}) };
  const P0 = placeDots(reads, frames, F, opts), rec0 = P0 ? readRows(P0, F, opts) : null, L = { ...LAYERS, ...(FOPT.layers ?? {}) };
  // L7 (LAYERS.secondLook): the spots where L6 and L5 disagree, read again in the photographs (--photos).
  const second = P0 && rec0 && L.secondLook ? secondLookOnField(P0, rec0, frames, F.origin, reads, lookerFor(opt("photos"), reads), L) : null;
  const P = second ? second.P : P0, rec = second ? second.rec : rec0, plants = P && rec ? cornPlantsOf(P, rec, F, opts) : null;
  // L8's unsure list (LAYERS.unsureList): recorded only.
  const unsure = P && rec && L.unsureList ? unsureList(P, rec, reads) : null;
  return { A, frames, reads, F, ground, opts, P, rec, plants, guard: G, second: second?.record ?? null, unsure };
}

// ------------------------------------------------------------------------------------------------------------ reads
if (job === "reads") {
  const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, DIR = arg("photos"), OUT = join(arg("out"), "reads"), frames = framesFromAnalysis(A);
  mkdirSync(OUT, { recursive: true });
  const [a, b] = (opt("range") ?? `0:${A.reads.length}`).split(":").map(Number);
  for (const r of A.reads.slice(a, b)) {
    const out = join(OUT, `${r.name}.json`); if (existsSync(out)) continue;
    const f = frames.get(r.name), path = fileOf(DIR, r.name);
    if (!f || !path) { console.log(`${r.name}: no camera or no photograph, skipped`); continue; }
    const t0 = Date.now(), read = flightRead(r.name, pixelsOf(path), groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy));
    writeFileSync(out, JSON.stringify(read));
    console.log(`${r.name}: ${read.plants.length} marks, ${read.rows.length} rows, ${read.low ? read.low.length : 0} candidates, ${Date.now() - t0} ms`);
  }
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------------------ field
if (job === "field") {
  const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, OUT = arg("out"), t0 = Date.now();
  mkdirSync(OUT, { recursive: true });
  const { reads, F, ground, opts, P, rec, plants, guard, second, unsure } = field(A, arg("reads"));
  console.log(`${reads.length} of ${A.reads.length} photographs read; field and plants ${Date.now() - t0} ms; ${P ? P.all.length : 0} dots`);
  const q = opts.sequence ?? SEQUENCE;
  // Big arrays go in a binary file beside a small JSON that says where each is.
  const bins: { name: string; type: "f32" | "f64" | "i32" | "u8"; data: ArrayBufferView }[] = [];
  const put = (name: string, type: "f32" | "f64" | "i32" | "u8", data: ArrayLike<number>) => bins.push({ name, type, data: type === "f32" ? Float32Array.from(data) : type === "f64" ? Float64Array.from(data) : type === "i32" ? Int32Array.from(data) : Uint8Array.from(data) });
  let meta: Record<string, unknown> = { analysis: arg("analysis"), readOptions: READ, fieldOptions: FOPT, guard: { medianSpacingM: guard.medianSpacingM, withheld: guard.withheld }, photographsRead: reads.length, photographs: A.reads.length, fieldOptionsOfTheRecordEqualFIELD: JSON.stringify(A.fieldOptions ?? null) === JSON.stringify(FIELD) };
  if (P && rec) {
    const n = P.all.length, S = P.sights!;
    // The ground the field judged, sampled on a grid (state), and its detail on a coarser one.
    let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity; for (const d of P.all) { e0 = Math.min(e0, d.e); e1 = Math.max(e1, d.e); n0 = Math.min(n0, d.n); n1 = Math.max(n1, d.n); }
    e0 -= 3; n0 -= 3; e1 += 3; n1 += 3;
    const cell = 0.25, gw = Math.ceil((e1 - e0) / cell), gh = Math.ceil((n1 - n0) / cell), state = new Uint8Array(gw * gh);
    if (ground) for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) state[j * gw + i] = ground.state(e0 + (i + 0.5) * cell, n0 + (j + 0.5) * cell);
    const dcell = 1, dw = Math.ceil((e1 - e0) / dcell), dh = Math.ceil((n1 - n0) / dcell), dSight = new Int32Array(dw * dh).fill(-1), dConc = new Float32Array(dw * dh).fill(-1);
    if (ground?.detail) for (let j = 0; j < dh; j++) for (let i = 0; i < dw; i++) { const d = ground.detail(e0 + (i + 0.5) * dcell, n0 + (j + 0.5) * dcell); if (d) { dSight[j * dw + i] = d.sightings; dConc[j * dw + i] = d.concentration ?? -1; } }
    put("ground.state", "u8", state); put("ground.sightings", "i32", dSight); put("ground.concentration", "f32", dConc);
    put("dot.e", "f64", P.all.map(d => d.e)); put("dot.n", "f64", P.all.map(d => d.n)); put("dot.photos", "i32", P.all.map(d => d.photos)); put("dot.covered", "i32", P.covered);
    put("dot.tier", "u8", Array.from({ length: n }, (_, i) => P.tier?.[i] ?? 0)); put("dot.certainty", "u8", rec.certainty); put("dot.rowOf", "i32", rec.rowOf);
    put("dot.why", "u8", rec.why); put("dot.settled", "u8", rec.settled); put("dot.between", "u8", rec.between); put("dot.offSpacing", "u8", rec.offSpacing); put("dot.spread", "f32", P.all.map(d => d.spreadM));
    put("dot.certainEvidence", "u8", P.all.map((d, i) => (certainEvidence(d, P.covered[i], q) ? 1 : 0)));
    // Each dot's sightings: for the stricter marks' dots, indices into the sightings; for a candidate, into the candidates' own sightings.
    const start = new Int32Array(n + 1), mem: number[] = [];
    for (let i = 0; i < n; i++) { start[i] = mem.length; if (i < P.strict) mem.push(...P.all[i].members); else mem.push(...(P.candidates?.members[i - P.strict] ?? [])); }
    start[n] = mem.length; put("dot.memberStart", "i32", start); put("dot.members", "i32", mem);
    put("sight.p", "i32", S.map(s => s.p)); put("sight.u", "f32", S.map(s => s.u)); put("sight.v", "f32", S.map(s => s.v)); put("sight.e", "f64", S.map(s => s.e)); put("sight.n", "f64", S.map(s => s.n));
    const cf = P.candidates?.from ?? [];
    put("cand.p", "i32", cf.map(c => c.p)); put("cand.u", "f32", cf.map(c => c.u)); put("cand.v", "f32", cf.map(c => c.v)); put("cand.sight", "i32", cf.map(c => c.sight));
    // Where each SETTLED name is written (its rule's line), read from the source as it is now: since the layers
    // (2026-11-18) the rules that settle a dot are L6's, fieldTwin/layers/l6Judge.ts.
    const SRC = "src/lib/fieldTwin/layers/l6Judge.ts", lines = readFileSync(join(ROOT, SRC), "utf8").split(/\r?\n/), at: Record<string, number> = {};
    lines.forEach((L, k) => { for (const m of L.matchAll(/SETTLED\.(\w+)/g)) { if (L.slice(Math.max(0, m.index! - 4), m.index) === "=== ") continue; at[m[1]] ??= k + 1; } });
    const lineOf = (re: RegExp, file = SRC) => readFileSync(join(ROOT, file), "utf8").split(/\r?\n/).findIndex(L => re.test(L)) + 1;
    meta = { ...meta,
      origin: F.origin, directionDeg: F.directionDeg, pitchM: F.pitchM, photos: P.photos, shifts: P.shifts, strict: P.strict, repeatM: P.repeatM, gateM: P.gateM, nDots: n, nSights: S.length, nCand: cf.length,
      frames: A.frames.filter(f => P.photos.includes(f.name)),
      ground: ground ? { e0, n0, cell, gw, gh, dcell, dw, dh, spacingM: ground.spacingM } : null, groundAsked: opts.ground != null, planting: F.planting,
      // L5's record (layers/l5Profile.ts fieldProfile): every value measured or not.
      profile: fieldProfile(P, rec, reads, F.planting, guard, CORN_COUNT_GUARD.misreadMessage, rec.profile ?? {}),
      // L7 and L8's unsure list, when asked (LAYERS.secondLook, unsureList): every spot with what was decided and why.
      secondLook: second ? { examined: second.examined, added: second.added, refusedBecause: second.refusedBecause, photographsRead: second.photographsRead,
        spots: second.spots.map(s => ({ kind: s.kind, e: r2(s.e), n: r2(s.n), a0: s.a0, a1: s.a1, dot: s.dot, why: s.why, row: s.row, decision: s.decision, reason: s.reason, added: s.added, looked: new Set(s.looks.map(l => l.photo)).size, shows: s.looks.filter(l => l.shows).length, looks: s.looks.map(l => ({ photo: l.photo, u: Math.round(l.u), v: Math.round(l.v), shows: l.shows, why: l.why })) })) } : null,
      unsure: unsure ? { recorded: unsure.recorded, plantsLooked: unsure.plantsLooked, count: unsure.dots.length, coresOnly: unsure.dots.filter(d => d.kind === "cores only").length, dots: unsure.dots } : null,
      geometry: rec.geometry, tooCloseM: rec.tooCloseM, certainGaps: rec.certainGaps, spacingRules: rec.spacingRules, gaps: rec.gaps, unplanted: rec.unplanted, alleyRefused: rec.alleyRefused, alone: rec.alone.dot.length,
      rows: rec.rows.map(r => ({ id: r.id, kind: r.kind, plants: r.dots.length, lengthM: r2(r.lengthM), perM: r2(r.perM), line: r.line.map(([e, nn]) => [r2(e), r2(nn)]), segments: r.segments })),
      sequence: q, placing: opts.placing ?? PLANTS_FIRST,
      settledNames: Object.fromEntries(Object.entries(SETTLED).map(([k, v]) => [v, k])), settledLine: at, source: SRC,
      lines: { certainEvidence: lineOf(/^export const certainEvidence/, "src/lib/fieldTwin/plantsFirst.ts"), reconstruct: lineOf(/^export function reconstruct/, "src/lib/fieldTwin/layers/chain.ts"), placeDots: lineOf(/^export function placeDots/, "src/lib/fieldTwin/layers/l3Place.ts"), obvious: lineOf(/^export function obviousPlants/, "src/lib/fieldTwin/layers/l4Obvious.ts"), profile: lineOf(/^export function rowProfile/, "src/lib/fieldTwin/layers/l5Profile.ts"), judge: lineOf(/^export function judgeDots/, "src/lib/fieldTwin/layers/l6Judge.ts") },
      report: {
        plants: plants ? plants.summary : null, plantsNote: plants ? null : "The plants made no certain row: the build keeps the field's rows.", plantPoints: plants ? plants.points : [], plantShown: plants ? plants.shown : [],
        field: F.summary, weeds: F.weeds.map(w => ({ e: w.e, n: w.n, verdict: w.verdict, areaM2: w.areaM2, seenBy: w.seenBy, coveredBy: w.coveredBy })),
        gaps: F.gaps.map(g => ({ aEN: g.aEN, bEN: g.bEN, verdict: g.verdict, lengthM: g.lengthM })), fieldRows: F.rows.length,
      },
    };
    const unset = Array.from(rec.settled).filter(x => x === SETTLED.none).length; console.log(`settled: ${unset} dots by no named test`);
  } else meta = { ...meta, failed: "the photographs made no dot (placeDots returned null)", profile: readsProfile(reads, guard, CORN_COUNT_GUARD.misreadMessage) };
  let offset = 0; const desc = bins.map(b => { const d = { name: b.name, type: b.type, length: (b.data as unknown as { length: number }).length, offset }; offset += b.data.byteLength; offset = Math.ceil(offset / 8) * 8; return d; });
  const buf = Buffer.alloc(offset); for (let k = 0; k < bins.length; k++) Buffer.from(bins[k].data.buffer, bins[k].data.byteOffset, bins[k].data.byteLength).copy(buf, desc[k].offset);
  writeFileSync(join(OUT, "field.bin"), buf); writeFileSync(join(OUT, "field.json"), JSON.stringify({ ...meta, arrays: desc }));
  console.log(`field.json + field.bin written (${(offset / 1e6).toFixed(1)} MB)`);
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------------------ photo
if (job === "photo") {
  const PHOTO = arg("photo"), NAME = opt("name") ?? PHOTO.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, ""), OUT = join(arg("out"), "photo", NAME);
  mkdirSync(OUT, { recursive: true });
  const frame: GeorefFrame | undefined = opt("analysis") ? framesFromAnalysis(JSON.parse(readFileSync(opt("analysis")!, "utf8")) as TwinAnalysis).get(NAME) : undefined;
  const t0 = Date.now(), px = pixelsOf(PHOTO), W = px.width, H = px.height;
  // The pixel size: the camera's (a flight, as a build), else what the file's header gives (as Photo Scout).
  const est = estimateGsd(parsePhotoHeader(new Uint8Array(readFileSync(PHOTO)).subarray(0, HEADER_BYTES)), { imageWidth: W });
  const gsd = frame ? groundSampleAt(frame, frame.intrinsics.cx, frame.intrinsics.cy) : est.gsdM;
  // The read: a flight's as a build makes it (rowSpans, unless switched off), a single photograph's as Photo Scout makes it.
  const v = readCornV1(px, rowCropParamsFor(cropProfileFor("corn")!, gsd), { enteredCrop: "corn", ...(frame && READ.rowSpans !== false ? { rowSpans: true } : {}), ...(READ.coresBySize ? { coresSizePx: sizeFor(NAME) } : {}) });
  const tRead = Date.now(), ad = v.green;
  // The plant read's own marks, then the same with the cores asked (the cores option's own settings).
  const first = plantPointsFromGreen(px, GREEN_POINTS, cornV1PlantCache(px, ad, seedlingCache(px, SEEDLING_GREEN)), null);
  // Phase 3a: with the cores by size the read's own blurs (its record), else the row spacing's.
  const cr = v.plants.coresRef, asked = READ.coresBySize && cr ? { finePx: cr.finePx, widePx: cr.widePx, share: CORN_CORES.share, reference: CORN_CORES.reference, factor: CORN_CORES.factor } : cornV1CoresAsked(ad), withCores = asked ? plantPointsFromGreen(px, GREEN_POINTS, cornV1PlantCache(px, ad, seedlingCache(px, SEEDLING_GREEN)), asked) : null;
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
  const cover = cornV1RowCover(px, v), scout = frame ? null : cornV1AsRead(v);
  const p1 = (p: { x: number; y: number }): [number, number] => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
  const info = {
    name: NAME, file: PHOTO, width: W, height: H, readOptions: READ, flight: !!frame, readMs: tRead - t0, ms: Date.now() - t0,
    gsdM: gsd, gsdBasis: frame ? "the aligned camera (as a build)" : est.basis, readScale: { gsdM: ad.gsdM, basis: ad.scaleBasis },
    plans: ad.plans.map(p => ({ stage: p.stage, share: p.ownedShare, pitchPx: p.pitchPx })), rowSpacingPx: greenPitchPx(ad), greenShare: green / (W * H),
    firstPass: first.points.map(p1), typicalPx: first.typicalPx, coresAdded: withCores ? withCores.points.slice(first.points.length).map(p1) : [],
    // L2: which views found each mark (the pass with the cores asked, else the first pass).
    foundPoints: (withCores ?? first).points.map(p1), foundBy: Array.from((withCores ?? first).foundBy ?? []),
    cores: coresMeta, coresOn: CORN_CORES.on, readMarks: readMarks.length, readMarksAreTheExpectedPass: marksEqual, marks: readMarks.map(p1),
    candidates: v.plants.low ? v.plants.low.length : null, rows: v.rows.map(r => ({ points: r.points, identity: r.identity, evidence: r.evidence, plants: r.plants })),
    guard: { on: CORN_COUNT_GUARD.on, share: cover.share, cut: CORN_COUNT_GUARD.cut, withheld: v.count?.withheld ?? null },
    summary: v.summary, notes: v.notes,
    // What the read alone says of this photograph (layers/l5Profile.ts readsProfile): its marks' look, the cores' reference.
    profile: readsProfile([compactCornRead(NAME, v)], null, null),
    scout: scout ? { rows: scout.rows.map(r => ({ points: r.points, identity: r.identity, gaps: r.gaps })), weeds: scout.weeds.map(w => ({ x: w.x, y: w.y, hull: w.hull, areaM2: w.areaM2 })), excluded: scout.excluded.length, summary: scout.summary, cornV1: scout.cornV1, notes: scout.notes } : null,
  };
  writeFileSync(join(OUT, "info.json"), JSON.stringify(info));
  console.log(`${NAME}: read ${tRead - t0} ms, all ${Date.now() - t0} ms; ${first.points.length} first-pass marks, ${info.coresAdded.length} the cores add; read marks as expected: ${marksEqual}`);
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------------------ score
let lastField: ReturnType<typeof field> | null = null;
if (job === "score") {
  const LAB = JSON.parse(readFileSync(arg("labels"), "utf8")) as { images: { image: string; width: number; height: number; points: Label[] }[] };
  const NAME = arg("image"), HIDDEN = argv.includes("--hidden"), OUT = arg("out"), stem = (s: string) => s.replace(/\.[^.]+$/, "");
  const IM = LAB.images.find(x => stem(x.image) === NAME); if (!IM) throw new Error(`${NAME}: no labels for this photograph in the file`);
  if (!IM.points.length) throw new Error(`${NAME}: the labels file holds no point for this photograph`);
  mkdirSync(OUT, { recursive: true });
  const area = { x: 0, y: 0, w: IM.width, h: IM.height }, dev = labelTiles(area, 4, false), tiles = labelTiles(area, 4, HIDDEN);
  const labelsOf = (t: { x: number; y: number; w: number; h: number }) => IM.points.filter(p => within(t as never, p.x, p.y));
  let R: number, Rfull: number | null, unit: "m" | "px", marks: Mark[], place: (u: number, v: number) => [number, number] | null, extra: Record<string, unknown> = {};
  if (opt("analysis")) {
    // A flight: the field's final dots brought into the photograph, matched on the ground within half the plant spacing.
    const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, X = field(A, arg("reads")); lastField = X;
    const f = X.frames.get(NAME); if (!f || !X.P || !X.rec) throw new Error(`${NAME}: not in the flight, or the flight made no dot`);
    if (IM.width !== f.intrinsics.width || IM.height !== f.intrinsics.height) throw new Error(`${NAME}: labelled at ${IM.width} x ${IM.height}, the photograph is ${f.intrinsics.width} x ${f.intrinsics.height}`);
    const pi = X.P.photos.indexOf(NAME), seedM = X.rec.geometry.seedM;
    if (pi < 0) throw new Error(`${NAME} is not among the photographs the dots were made from`);
    if (seedM == null) throw new Error("the plant spacing is not measured on this flight, so there is no matching distance");
    if (X.opts.free) throw new Error("the loosened placement is not scored (as cornLabelScore.ts)");
    const M = fieldMarks(X.P, X.rec, X.F, f, pi); marks = M.marks; place = M.place; R = seedM / 2; Rfull = seedM; unit = "m";
    extra = { plantSpacingM: seedM, wholeFlightOnRows: M.whole, wholeFlightOnNoRow: M.onNoRow, landed: M.landed, foldedBack: M.fold, marksInPhoto: M.inPhoto };
  } else {
    // One photograph: its read's own marks, matched in pixels within half the median distance between the dev tiles' neighbouring labels.
    const PHOTO = arg("photo"), px = pixelsOf(PHOTO);
    const est = estimateGsd(parsePhotoHeader(new Uint8Array(readFileSync(PHOTO)).subarray(0, HEADER_BYTES)), { imageWidth: px.width });
    const v = readCornV1(px, rowCropParamsFor(cropProfileFor("corn")!, est.gsdM), { enteredCrop: "corn", ...(READ.coresBySize ? { coresSizePx: sizeFor(NAME) } : {}) });
    marks = v.plants.points.map(p => ({ u: p.x, v: p.y, e: p.x, n: p.y, tier: 0 })); place = (u, vv) => [u, vv];
    const L = labelSpacingPx(dev, labelsOf); R = L.medianPx / 2; Rfull = null; unit = "px";
    extra = { labelSpacing: { medianPx: L.medianPx, medianPerTile: L.medianPerTile, pairs: L.gapsPx.length }, marksInPhoto: [marks.length, 0, 0, 0, 0, 0] };
  }
  const judgeAt = (r: number) => tiles.map(t => judgeTile(t, marks, place, r, labelsOf(t)));
  const half = judgeAt(R), full = Rfull ? judgeAt(Rfull) : null;
  // The marks L7 put there, and the marks of L8's unsure list, by what the labels make of them (half the spacing).
  if (opt("analysis")) {
    const X = lastField!, isL7 = (i: number | undefined) => i != null && !!X.rec!.secondLook?.[i], uns = new Set((X.unsure?.dots ?? []).map(d => d.dot));
    const tally = (pick: (i: number | undefined) => boolean) => { const t = { marks: 0, found: 0, wrongSecond: 0, wrongNothing: 0, onUnsure: 0, atEdge: 0 }; half.forEach((J, k) => J.ms.forEach((m, j) => { if (!within(tiles[k], m.u, m.v) || !pick(m.i)) return; t.marks++; const s = J.state[j]; if (s === 1) t.found++; else if (s === 2) t.onUnsure++; else if (s === 3) t.atEdge++; else if (s === 0) (J.second[j] ? t.wrongSecond++ : t.wrongNothing++); })); return t; };
    extra = { ...extra, secondLook: X.second ? { examined: X.second.examined, added: X.second.added, refusedBecause: X.second.refusedBecause, marksInTiles: tally(isL7) } : null, unsure: X.unsure ? { count: X.unsure.dots.length, marksInTiles: tally(i => i != null && uns.has(i)) } : null };
  }
  // What the page draws (half the spacing): every label of the scored tiles with what it got, every mark in them with its verdict.
  const labels: { x: number; y: number; type: string; tile: string; found: boolean }[] = [], drawn: { u: number; v: number; tier: number; state: number; second: number; tile: string }[] = [];
  half.forEach((J, k) => {
    const t = tiles[k], plants = labelsOf(t).filter(l => l.type === "plant");
    plants.forEach((l, i) => labels.push({ x: l.x, y: l.y, type: "plant", tile: t.id, found: J.plantFound[i] }));
    labelsOf(t).filter(l => l.type === "unsure").forEach(l => labels.push({ x: l.x, y: l.y, type: "unsure", tile: t.id, found: false }));
    J.ms.forEach((m, j) => { if (within(t, m.u, m.v)) drawn.push({ u: Math.round(m.u * 10) / 10, v: Math.round(m.v * 10) / 10, tier: m.tier, state: J.state[j], second: J.second[j], tile: t.id }); });
  });
  const out = { image: NAME, hidden: HIDDEN, unit, R, Rfull, tiers: TIERS, tiles, heldBack: labelTiles(area, 4, !HIDDEN), readOptions: READ, fieldOptions: FOPT, ...extra, half: half.map(J => J.score), full: full ? full.map(J => J.score) : null, labels, marks: drawn };
  writeFileSync(join(OUT, `score-${NAME}${HIDDEN ? "-hidden" : ""}.json`), JSON.stringify(out));
  const s = (k: "found" | "wrong" | "marks") => half.reduce((a, J) => a + J.score[k].reduce((p, q) => p + q, 0), 0);
  console.log(`${NAME} ${HIDDEN ? "HELD-BACK" : "dev"} tiles, matched within ${R.toFixed(unit === "m" ? 3 : 1)} ${unit}: found ${s("found")} of ${half.reduce((a, J) => a + J.score.labelled, 0)}, wrong ${s("wrong")}, marks ${s("marks")}`);
  process.exit(0);
}
throw new Error(`unknown job ${job}: reads, field, photo or score`);
