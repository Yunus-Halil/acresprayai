// Development only: the scoreboard for corn plants and rows over a stored flight (an analysis record plus the cache of
// its second-look candidates, cornCandidates.ts). No hand count exists for any flight, so nothing here is an accuracy:
// it measures what the photographs themselves can say.
//
//   npx vite-node scripts/rowCrop/cornScoreboard.ts -- --flight <label> --analysis <analysis.json> --cache <dir>
//       --out <dir> [--variants base,loose] [--cache2 <dir>]
//
// Per variant (a named set of options, VARIANTS below) it writes <out>/<flight>.<variant>.json:
//   onRows      plants on rows by tier: certain, probable, second look by 2+ photographs, second look by one
//               photograph, loosened (there only by the loosened placement, or one photograph anywhere in its frame)
//   classes     per class of dot (its own evidence, whatever was made of it): how many stand in the rows' bands and how
//               many in an equally wide strip mid-alley (the mean of the two strips either side). The alley count is
//               what the same ground gives where no row runs: the expected count on the rows that is not the crop.
//   stretches   per stretch of row (rowGuided.ts stretchM): whether its band beats its two mid-alley strips by
//               rowGuided.ts's own test (bandBeatsControls), per class and for all dots together
//   fromAlley   the rules run again with every dot that is not a certain plant moved half a row spacing across the
//               rows (once each way, the mean): what they then put on the rows came from mid-alley ground. Per tier.
//               Where the band-against-alley test is on, its control strips are then read a quarter spacing either
//               side of the row lines: the ground that was a quarter and three quarters of the way across the alley,
//               so band and strips are all ground between the rows (the real rows' own dots, moved to mid-alley, are
//               in neither).
//   ground      plants on rows, row length, by what cornField's planted / scattered judgement says of the ground
//   halves      the flight read twice from alternate photographs (by name order): per tier, the plants on rows one
//               half has where the other half looked (2+ of its photographs) and has none within ROW_RECALL.exclM
import "../bench/nodeStorageShim";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GeorefFrame } from "../../src/lib/directGeoref/projection";
import { type CornPhotoRead, FIELD, type FieldGround, cornFieldAndGround } from "../../src/lib/fieldTwin/cornField";
import { type CornPlantsOptions, cornPlantsOf, placeDots, readRows } from "../../src/lib/fieldTwin/cornPlants";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { PLANTS_FIRST, PLANTS_FIRST_V1, ROW_RECALL, SEQUENCE, SEQUENCE_V1, type Dot, bandAndAlley, courseAt, coverage } from "../../src/lib/fieldTwin/plantsFirst";
import { ROW_GUIDED, bandBeatsControls } from "../../src/lib/fieldTwin/rowGuided";
import { CORN_CANDIDATE_FINAL3 } from "../../src/lib/fieldTwin/cornSetups";
import { fromEnu, toEnu } from "../../src/lib/sourceFrames/odm";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
const FLIGHT = arg("flight"), CACHE = arg("cache"), CACHE2 = opt("cache2"), OUT = arg("out");
const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis;
const frames = framesFromAnalysis(A);
mkdirSync(OUT, { recursive: true });
const revision = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();

/** A variant: how the candidates are joined to the reads, and the options the plants and rows are read with. */
type Variant = { what: string; spans?: boolean; opts: (ground: FieldGround | null) => CornPlantsOptions };
const P2 = { ...SEQUENCE_V1, patternCellsOnly: true, refuseScattered: true };
// The rules before the final sweep (2026-11-16): every variant up to p6 is the rules of its day, the sweep off.
const NOSWEEP = { ...SEQUENCE, sweepLoneMarks: false };
const ROUND1 = { ...NOSWEEP, spacingRulesNeedASpacing: false };
const VARIANTS: Record<string, Variant> = {
  base: { what: "the rules as they stood at f23efc0 (second look where a build makes candidates; loosened placement off)", opts: () => ({ sequence: SEQUENCE_V1 }) },
  loose: { what: "f23efc0 with the loosened placement on (SEQUENCE.free, ROW_RECALL.anyView)", opts: () => ({ sequence: SEQUENCE_V1, free: true }) },
  p2: { what: "phase 2: no rows on unplanted ground (patternCellsOnly, refuseScattered)", opts: ground => ({ sequence: { ...SEQUENCE_V1, patternCellsOnly: true, refuseScattered: true }, ground }) },
  p2loose: { what: "phase 2 with the loosened placement on", opts: ground => ({ sequence: { ...SEQUENCE_V1, patternCellsOnly: true, refuseScattered: true }, ground, free: true }) },
  p3: { what: "phase 3: a candidate or loosened dot only where the band beats the alley (alleyTest row)", opts: ground => ({ sequence: { ...P2, alleyTest: "row" }, ground }) },
  p3loose: { what: "phase 3 with the loosened placement on", opts: ground => ({ sequence: { ...P2, alleyTest: "row" }, ground, free: true }) },
  p3own: { what: "phase 3, the dot's own kind must beat the alley (alleyTest own)", opts: ground => ({ sequence: { ...P2, alleyTest: "own" }, ground }) },
  p3ownloose: { what: "phase 3 own kind, loosened on", opts: ground => ({ sequence: { ...P2, alleyTest: "own" }, ground, free: true }) },
  p3all: { what: "phase 3, the test on every dot together (alleyTest all)", opts: ground => ({ sequence: { ...P2, alleyTest: "all" }, ground }) },
  p3allloose: { what: "phase 3 on every dot together, loosened on", opts: ground => ({ sequence: { ...P2, alleyTest: "all" }, ground, free: true }) },
  p3span15: { what: "phase 3, candidates carried with their extents and split in the field at the assumed 0.15 m", spans: true, opts: ground => ({ sequence: { ...P2, alleyTest: "row" }, ground, fieldSeed: false }) },
  p3spanfield: { what: "phase 3, candidates split in the field at its measured plant spacing", spans: true, opts: ground => ({ sequence: { ...P2, alleyTest: "row" }, ground }) },
  p3spanfieldloose: { what: "phase 3, field spacing, loosened on", spans: true, opts: ground => ({ sequence: { ...P2, alleyTest: "row" }, ground, free: true }) },
  p4: { what: "phase 4: phase 3 (field spacing) with the between-rows label fixed (a plane a photograph, the plant spacing taken whatever its score)", spans: true, opts: ground => ({ sequence: NOSWEEP, ground }) },
  p4loose: { what: "phase 4, loosened placement on", spans: true, opts: ground => ({ sequence: NOSWEEP, ground, free: true }) },
  // The registration / plant-spacing round as it was first built (2026-11-16): the tilt terms for every photograph with
  // cells enough, and 0.18 m standing in for a plant spacing that is not measured.
  p5seed: { what: "phase 4 + the plant spacing not measured where its score has no single peak", spans: true, opts: ground => ({ sequence: ROUND1, ground, placing: { ...PLANTS_FIRST_V1, seedNeedsAPeak: true } }) },
  p5tilt: { what: "phase 4 + photographs registered by a plane and the two tilt terms on a 6 x 4 grid", spans: true, opts: ground => ({ sequence: ROUND1, ground, placing: { ...PLANTS_FIRST, tiltMustHelp: false, seedNeedsAPeak: false } }) },
  p5: { what: "both, as first built", spans: true, opts: ground => ({ sequence: ROUND1, ground, placing: { ...PLANTS_FIRST, tiltMustHelp: false } }) },
  p5loose: { what: "both, as first built, loosened placement on", spans: true, opts: ground => ({ sequence: ROUND1, ground, placing: { ...PLANTS_FIRST, tiltMustHelp: false }, free: true }) },
  p6spacing: { what: "as first built + no spacing rule where the spacing is not measured", spans: true, opts: ground => ({ sequence: NOSWEEP, ground, placing: { ...PLANTS_FIRST, tiltMustHelp: false } }) },
  p6tilt: { what: "as first built + the tilt terms only where they help", spans: true, opts: ground => ({ sequence: ROUND1, ground, placing: PLANTS_FIRST }) },
  p6oldreg: { what: "the registration exactly as before (a plane on 4 x 3) with the plant-spacing rules as they stand now", spans: true, opts: ground => ({ sequence: NOSWEEP, ground, placing: { ...PLANTS_FIRST_V1, seedNeedsAPeak: true } }) },
  p6: { what: "the rules before the final sweep", spans: true, opts: ground => ({ sequence: NOSWEEP, ground, placing: PLANTS_FIRST }) },
  p6loose: { what: "the rules before the final sweep, loosened placement on", spans: true, opts: ground => ({ sequence: NOSWEEP, ground, placing: PLANTS_FIRST, free: true }) },
  // The final sweep: a second-look mark alone on its row is taken off it.
  p7: { what: "the rules as they stand now (the final sweep on: company is a certain or a probable plant)", spans: true, opts: ground => ({ sequence: SEQUENCE, ground, placing: PLANTS_FIRST }) },
  p7loose: { what: "the rules as they stand now, loosened placement on", spans: true, opts: ground => ({ sequence: SEQUENCE, ground, placing: PLANTS_FIRST, free: true }) },
  p7other: { what: "the final sweep with the other company: " + (SEQUENCE.loneMarkCompany === "certain" ? "a certain or a probable plant" : "a certain plant only"), spans: true, opts: ground => ({ sequence: { ...SEQUENCE, loneMarkCompany: SEQUENCE.loneMarkCompany === "certain" ? "located" as const : "certain" as const }, ground, placing: PLANTS_FIRST }) },
  // 2026-11-17: the plant spacing not asked of a dot on a row's line (SEQUENCE.placeOffSpacing), off by default.
  p8: { what: "the rules as they stand now + the plant spacing not asked of a dot on a row's line (placeOffSpacing)", spans: true, opts: ground => ({ sequence: { ...SEQUENCE, placeOffSpacing: true }, ground, placing: PLANTS_FIRST }) },
  final3: { what: "the setup frozen for FINAL-3 (fieldTwin/cornSetups.ts CORN_CANDIDATE_FINAL3): its field options; the reads must be read with its read options (cornPresetFlight.ts)", spans: true, opts: ground => ({ sequence: { ...SEQUENCE, ...CORN_CANDIDATE_FINAL3.field.sequence }, ground, placing: PLANTS_FIRST }) },
  // 2026-11-18, the layers (layers/options.ts): the frozen preset with one layer option, or two.
  final3_2a: { what: "final3 + the ground judged from L4's certain plants only (LAYERS.groundFromObvious)", spans: true, opts: ground => ({ sequence: { ...SEQUENCE, ...CORN_CANDIDATE_FINAL3.field.sequence }, ground, placing: PLANTS_FIRST, layers: { groundFromObvious: true } }) },
  final3_3b: { what: "final3 + the too-close limit from the spacing's spread (LAYERS.tooCloseFromSpread)", spans: true, opts: ground => ({ sequence: { ...SEQUENCE, ...CORN_CANDIDATE_FINAL3.field.sequence }, ground, placing: PLANTS_FIRST, layers: { tooCloseFromSpread: true } }) },
  final3_2a3b: { what: "final3 + both", spans: true, opts: ground => ({ sequence: { ...SEQUENCE, ...CORN_CANDIDATE_FINAL3.field.sequence }, ground, placing: PLANTS_FIRST, layers: { groundFromObvious: true, tooCloseFromSpread: true } }) },
  p9: { what: "p8, the stricter marks' dots only (offSpacingStricterOnly)", spans: true, opts: ground => ({ sequence: { ...SEQUENCE, placeOffSpacing: true, offSpacingStricterOnly: true }, ground, placing: PLANTS_FIRST }) },
  p10: { what: "p8 with the too-close limit learned from the field (tooCloseFromField)", spans: true, opts: ground => ({ sequence: { ...SEQUENCE, placeOffSpacing: true, tooCloseFromField: true }, ground, placing: PLANTS_FIRST }) },
  p11: { what: "p8 with both: the stricter marks' dots only, and the too-close limit learned from the field", spans: true, opts: ground => ({ sequence: { ...SEQUENCE, placeOffSpacing: true, offSpacingStricterOnly: true, tooCloseFromField: true }, ground, placing: PLANTS_FIRST }) },
  // Measured only (2026-11-17): rows only on ground judged planted. Ground the field did not judge is read as scattered,
  // so nothing on it is the planting (no row fitted, no dot placed, a row cut where it would cross it). No such rule exists.
  p7planted: { what: "MEASURED ONLY: the rules as they stand now, ground the field did not judge read as scattered (rows only on ground judged planted)", spans: true, opts: ground => ({ sequence: SEQUENCE, ground: ground ? { ...ground, state: (e: number, n: number) => (ground.state(e, n) === 1 ? 1 : 2) } : null, placing: PLANTS_FIRST }) },
  p2cells: { what: "phase 2, only patternCellsOnly", opts: ground => ({ sequence: { ...SEQUENCE_V1, patternCellsOnly: true }, ground }) },
  p2ground: { what: "phase 2, only refuseScattered", opts: ground => ({ sequence: { ...SEQUENCE_V1, refuseScattered: true }, ground }) },
};

type Cached = { applies: boolean; plantsMatch: boolean; low: [number, number][]; lowWhole: [number, number][]; span: [number, number][]; axis: [number, number] | null };
const cached = new Map<string, Cached>();
let missing = 0, mismatched = 0;
for (const r of A.reads) { const f = join(CACHE, `${r.name}.json`); if (!existsSync(f)) { missing++; continue; } const c = JSON.parse(readFileSync(f, "utf8")) as Cached; cached.set(r.name, c); if (!c.plantsMatch) mismatched++; }
const extra = (name: string): [number, number][] => { const f = CACHE2 ? join(CACHE2, `${name}.json`) : null; return f && existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as { low: [number, number][] }).low : []; };

/** The record's reads with their candidates, as a build on this code would carry them. */
function readsFor(v: Variant): CornPhotoRead[] {
  return A.reads.map(r => {
    const { low: _l, lowSpan: _s, lowAxis: _a, ...rest } = r, c = cached.get(r.name), more = extra(r.name);
    if (!c?.applies && !more.length) return rest;
    if (v.spans && c?.applies && c.axis && !more.length) return { ...rest, low: c.lowWhole, lowSpan: c.span, lowAxis: c.axis };
    return { ...rest, low: [...(c?.applies ? c.low : []), ...more] };
  });
}

const TIERS = ["certain", "probable", "second look, 2+ photographs", "second look, 1 photograph", "loosened"] as const;
const CLASSES = ["certain on its own evidence", "2+ photographs, not certain", "second look, 2+ photographs", "second look, 1 photograph near its frame's middle", "second look, 1 photograph anywhere"] as const;

const memo = new Map<string, unknown>();
const once = <T>(key: string, make: () => T): T => { if (!memo.has(key)) { const t = Date.now(); memo.set(key, make()); if (TIMES) console.log(`    [${key}: ${((Date.now() - t) / 1000).toFixed(1)} s]`); } return memo.get(key) as T; };
const TIMES = argv.includes("--times");
function run(reads: CornPhotoRead[], v: Variant, part = "all") {
  // The field does not read the candidates, and the dots depend on them only through how they are joined to the reads.
  const { field: F, ground } = once(`field ${part}`, () => cornFieldAndGround(reads, frames, A.fieldOptions ?? FIELD));
  const opts: CornPlantsOptions = { placing: PLANTS_FIRST_V1, ...v.opts(ground) }, q = opts.sequence ?? SEQUENCE, pl = opts.placing!;
  const P = once(`dots ${part} spans=${!!v.spans} free=${!!opts.free} fieldSeed=${opts.fieldSeed !== false} certain=${q.certainViews}/${q.certainShare} grid=${pl.gridU}x${pl.gridV} tilt=${pl.tilt}/${pl.tiltMustHelp} peak=${pl.seedNeedsAPeak}`, () => placeDots(reads, frames, F, opts));
  if (!P) return null;
  const t = Date.now(), rec = readRows(P, F, opts), CP = cornPlantsOf(P, rec, F, opts);
  if (TIMES) console.log(`    [rows ${part}: ${((Date.now() - t) / 1000).toFixed(1)} s]`);
  const n = P.all.length;
  const tierOf = (r: typeof rec, i: number) => (r.rowOf[i] < 0 ? -1 : r.loose[i] || P.tier?.[i] === 3 ? 4 : P.tier?.[i] === 1 ? 2 : P.tier?.[i] === 2 ? 3 : r.certainty[i] === 0 ? 0 : 1);
  const cls = Int8Array.from({ length: n }, (_, i) => (i < P.strict ? (rec.certainty[i] === 0 ? 0 : 1) : 1 + P.tier![i]));
  return { F, ground, opts, P, rec, CP, n, tierOf, cls };
}

function measure(reads: CornPhotoRead[], v: Variant, withHalves: boolean) {
  const t0 = Date.now(), R = run(reads, v);
  if (!R) return { failed: "the photographs made no dot" };
  const { F, ground, opts, P, rec, CP, n, tierOf, cls } = R;
  const S = rec.geometry.spacingM, seed = rec.geometry.seedM ?? 0.18;
  const onRows = [0, 0, 0, 0, 0]; for (let i = 0; i < n; i++) { const t = tierOf(rec, i); if (t >= 0) onRows[t]++; }
  // Plants on a row found in a slot the certain rows leave (a "geometry" row): they are in the probable tier.
  const inSlotRows = (r: typeof rec) => { let c = 0; for (let i = 0; i < n; i++) if (r.rowOf[i] >= 0 && r.rows[r.rowOf[i]].kind === "geometry" && cls[i] !== 0) c++; return c; };
  // Band and mid-alley, per class of dot and per stretch.
  const courses = [...rec.courses, ...rec.geomCourses], half = PLANTS_FIRST.onRowShare * S, reach = (opts.sequence ?? SEQUENCE).maxGapSeeds * seed;
  const BA = bandAndAlley(courses, rec.a, rec.c, cls, CLASSES.length, S, half, reach);
  const classes = CLASSES.map((name, k) => {
    const dots = cls.reduce((t, c) => t + (c === k ? 1 : 0), 0), band = BA.stretches.reduce((t, s) => t + s.band[k], 0), alley = BA.stretches.reduce((t, s) => t + s.alley[k], 0) * BA.controlScale / 2;
    const withAny = BA.stretches.filter(s => s.band[k] > 0), ok = withAny.filter(s => bandBeatsControls(s.band[k], Math.round(s.alley[k] * BA.controlScale), Math.max(s.a1 - s.a0, 1e-6)));
    return { name, dots, inBands: band, perAlleyStrip: Math.round(alley * 10) / 10, alleyShareOfBand: band ? Math.round((1000 * alley) / band) / 1000 : null, stretchesWithAny: withAny.length, stretchesBandBeatsAlley: ok.length, inBandsOfThoseStretches: ok.reduce((t, s) => t + s.band[k], 0) };
  });
  const sum = (a: Int32Array) => a.reduce((t, x) => t + x, 0);
  const pooledOk = BA.stretches.filter(s => bandBeatsControls(sum(s.band), Math.round(sum(s.alley) * BA.controlScale), Math.max(s.a1 - s.a0, 1e-6)));
  // The rules again with mid-alley ground moved onto the rows: every dot that is not a certain plant, half a spacing across.
  const th = (rec.geometry.directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th);
  const fromAlley = [-1, 1].map(sign => {
    const d = sign * ROW_GUIDED.controlShare * S, all = P.all.map((dot, i): Dot => (cls[i] === 0 ? dot : { ...dot, e: dot.e - st * d, n: dot.n + ct * d }));
    const moved = { ...opts, sequence: { ...(opts.sequence ?? SEQUENCE), alleyControlShare: ROW_GUIDED.controlShare / 2 } };
    const r2 = readRows({ ...P, all, ...(opts.ground ? { groundState: Uint8Array.from(P.all, dot => opts.ground!.state(dot.e, dot.n)) } : {}) }, F, moved), c = [0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) { const t = tierOf(r2, i); if (t > 0 && cls[i] !== 0) c[t]++; }
    return [...c, inSlotRows(r2)];
  });
  // By what cornField's judgement says of the ground.
  const groundAt = (e: number, nn: number) => (ground ? ground.state(e, nn) : 0);
  const byGround = [0, 1, 2].map(g => { const c = [0, 0, 0, 0, 0]; for (let i = 0; i < n; i++) { const t = tierOf(rec, i); if (t >= 0 && groundAt(P.all[i].e, P.all[i].n) === g) c[t]++; } return c; });
  const rowM = [0, 0, 0], unconfirmedM = [0, 0, 0];
  for (const s of CP?.stretches ?? []) for (let k = 1; k < s.lineEN.length; k++) { const a = s.lineEN[k - 1], b = s.lineEN[k], g = groundAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), L = Math.hypot(b[0] - a[0], b[1] - a[1]); (s.confirmed ? rowM : unconfirmedM)[g] += L; }
  const r1 = (x: number) => Math.round(x * 10) / 10;
  // Neighbouring dots on one row: how far apart along it, 1 cm bins to 40 cm (a registration that merged neighbours, or
  // left one plant as two dots on its row, shows at the short end).
  const neighbours = new Array<number>(41).fill(0);
  for (const row of rec.rows) for (let k = 1; k < row.dots.length; k++) { const d = Math.round((rec.a[row.dots[k]] - rec.a[row.dots[k - 1]]) * 100); if (d <= 40) neighbours[Math.max(0, d)]++; }
  // The final sweep (SEQUENCE.sweepLoneMarks). What it took off the rows, by tier, and where each stood. There is no
  // map of wheel tracks: "where the rows either side are interrupted too" is measured from the plants. A plant here is
  // one the stricter marks made, on a row (certain or probable). A neighbouring row (a course within a row and a half
  // across, on that side, running past the mark) is interrupted near the mark when it has no plant over at least twice
  // the reach (the shortest bare run the mark's own row must have for the mark to be alone), somewhere within the reach
  // of the mark along the rows. The mark stands in a strip crossing the rows when every neighbouring row it has is
  // interrupted so. The narrower count, "bare across three rows": no plant at all within the reach of the mark along the
  // rows on its own row or the row either side. And, measured only: the candidates still on a row that would go too if
  // company were asked on BOTH sides (company as the sweep counts it, on the mark's own built row).
  const q = opts.sequence ?? SEQUENCE, T3 = ["second look, 2+ photographs", "second look, 1 photograph near its frame's middle", "second look, 1 photograph anywhere"];
  const byTier = (c: number[]) => Object.fromEntries(T3.map((t, k) => [t, c[k]]));
  const found: number[] = []; for (let i = 0; i < P.strict; i++) if (rec.rowOf[i] >= 0) found.push(i);
  const bins = new Map<number, number[]>(), binOf = (a: number) => Math.floor(a / Math.max(reach, 1e-6));
  for (const i of found) { const b = binOf(rec.a[i]); (bins.get(b) ?? bins.set(b, []).get(b)!).push(i); }
  const bare = (i: number) => { for (let b = binOf(rec.a[i]) - 1; b <= binOf(rec.a[i]) + 1; b++) for (const j of bins.get(b) ?? []) if (Math.abs(rec.a[j] - rec.a[i]) <= reach && Math.abs(rec.c[j] - rec.c[i]) <= 1.5 * S) return false; return true; };
  const side = (i: number, sign: number, c: number) => { const d = (c - rec.c[i]) * sign; return d > 0.5 * S && d <= 1.5 * S; };
  const hasRow = (i: number, sign: number) => courses.some(L => rec.a[i] >= L.a0 && rec.a[i] <= L.a1 && side(i, sign, courseAt(L, rec.a[i])));
  const interrupted = (i: number, sign: number) => {
    const a = rec.a[i], ps = [a - 3 * reach, a + 3 * reach];
    for (let b = binOf(a) - 3; b <= binOf(a) + 3; b++) for (const j of bins.get(b) ?? []) if (side(i, sign, rec.c[j]) && Math.abs(rec.a[j] - a) < 3 * reach) ps.push(rec.a[j]);
    ps.sort((x, y) => x - y);
    for (let k = 1; k < ps.length; k++) if (ps[k] - ps[k - 1] >= 2 * reach) return true;
    return false;
  };
  const acrossStrip = (i: number) => { const sides = [-1, 1].filter(sg => hasRow(i, sg)); return sides.length > 0 && sides.every(sg => interrupted(i, sg)); };
  const removed = [0, 0, 0], inStrip = [0, 0, 0], inBare = [0, 0, 0], kept = [0, 0, 0], bothSides = [0, 0, 0];
  for (const i of rec.alone.dot) { const k = Math.min(3, P.tier![i]) - 1; removed[k]++; if (acrossStrip(i)) inStrip[k]++; if (bare(i)) inBare[k]++; }
  const isCompany = (j: number) => (q.loneMarkCompany === "located" ? j < P.strict : rec.certainty[j] === 0);
  for (let i = P.strict; i < n; i++) {
    if (rec.rowOf[i] < 0) continue;
    const k = Math.min(3, P.tier![i]) - 1; kept[k]++;
    let below = false, above = false; for (const j of rec.rows[rec.rowOf[i]].dots) { if (!isCompany(j)) continue; const d = rec.a[j] - rec.a[i]; if (d < 0 && d >= -reach) below = true; else if (d > 0 && d <= reach) above = true; }
    if (!(below && above)) bothSides[k]++;
  }
  // Of the marks removed: those with another second-look mark that stood on the same line within the reach (a run of
  // second-look marks with no plant of the stricter marks among them), and those with none (one mark by itself).
  const wasOn: number[] = [...rec.alone.dot]; for (let i = P.strict; i < n; i++) if (rec.rowOf[i] >= 0) wasOn.push(i);
  const inARun = [0, 0, 0];
  for (const i of rec.alone.dot) if (wasOn.some(j => j !== i && Math.abs(rec.a[j] - rec.a[i]) <= reach && Math.abs(rec.c[j] - rec.c[i]) <= half)) inARun[Math.min(3, P.tier![i]) - 1]++;
  const alone = { sweep: q.sweepLoneMarks, company: q.loneMarkCompany, reachM: Math.round(reach * 1000) / 1000, removed: byTier(removed), removedTotal: removed.reduce((t, x) => t + x, 0), removedWhereTheRowsEitherSideAreInterrupted: byTier(inStrip), removedElsewhere: byTier(removed.map((x, k) => x - inStrip[k])), removedBareAcrossThreeRows: byTier(inBare), removedWithAnotherSecondLookMarkWithinReach: byTier(inARun), removedWithNoMarkOfAnyKindWithinReach: byTier(removed.map((x, k) => x - inARun[k])), removedDots: rec.alone.dot.map(i => ({ e: Math.round(P.all[i].e * 100) / 100, n: Math.round(P.all[i].n * 100) / 100, tier: P.tier![i], strip: acrossStrip(i) })), candidatesOnRows: byTier(kept), ofThoseWithCompanyOnOneSideOnly: byTier(bothSides) };
  const out = {
    flight: FLIGHT, variant: v.what, revision, photographs: reads.length, photographsWithCandidates: reads.filter(r => r.low?.length).length,
    cache: { missing, plantsDifferFromRecord: mismatched }, ms: 0, spacingRules: rec.spacingRules, photographsWithTilt: P.shifts.filter(s => s.tilt && (s.tilt.t[0] !== 0 || s.tilt.t[1] !== 0)).length, unplanted: rec.unplanted, cutOverScattered: rec.gaps.cutOverScattered, alleyRefused: rec.alleyRefused, alone,
    geometry: { rowSpacingM: Math.round(S * 1000) / 1000, plantSpacingM: rec.geometry.seedM, directionDeg: Math.round(rec.geometry.directionDeg * 100) / 100, certainRows: rec.geometry.certainRows, tooCloseM: rec.tooCloseM, certainGaps: rec.certainGaps },
    planting: { judged: F.planting.judged, why: F.planting.why, plantedM2: F.planting.plantedM2, scatteredM2: F.planting.scatteredM2 },
    dots: { all: n, stricterMarks: P.strict, candidates: n - P.strict },
    // On a row only because the spacing was not asked (placeOffSpacing): counted inside the tiers above.
    byTheOption: (() => { const c = [0, 0, 0, 0, 0]; for (let i = 0; i < n; i++) if (rec.offSpacing[i] && rec.rowOf[i] >= 0) c[tierOf(rec, i)]++; return Object.fromEntries(TIERS.map((t, k) => [t, c[k]])); })(),
    certainOnRowsByGround: (() => { const c = [0, 0, 0]; for (let i = 0; i < n; i++) if (rec.rowOf[i] >= 0 && rec.certainty[i] === 0) c[groundAt(P.all[i].e, P.all[i].n)]++; return { notJudged: c[0], planted: c[1], scattered: c[2] }; })(),
    onRows: Object.fromEntries(TIERS.map((t, k) => [t, onRows[k]])), onRowsTotal: onRows.reduce((t, x) => t + x, 0), probableOnSlotRows: inSlotRows(rec),
    rows: rec.rows.length, rowM: { plantsSeen: CP?.summary.confirmedM ?? 0, notConfirmed: CP?.summary.notConfirmedM ?? 0 }, neighboursOnARowCm: neighbours,
    onNoRow: CP?.summary.onNoRow ?? null, betweenRows: CP?.summary.betweenRows ?? null,
    classes, stretches: { all: BA.stretches.length, bandBeatsAlleyAllDots: pooledOk.length },
    fromAlley: { ...Object.fromEntries(TIERS.slice(1).map((t, k) => [t, { mean: (fromAlley[0][k + 1] + fromAlley[1][k + 1]) / 2, eachWay: [fromAlley[0][k + 1], fromAlley[1][k + 1]] }])), probableOnSlotRows: { mean: (fromAlley[0][5] + fromAlley[1][5]) / 2, eachWay: [fromAlley[0][5], fromAlley[1][5]] } },
    ground: {
      onRowsOnUnknown: Object.fromEntries(TIERS.map((t, k) => [t, byGround[0][k]])), onRowsOnPlanted: Object.fromEntries(TIERS.map((t, k) => [t, byGround[1][k]])), onRowsOnScattered: Object.fromEntries(TIERS.map((t, k) => [t, byGround[2][k]])),
      rowMPlantsSeen: { unknown: r1(rowM[0]), planted: r1(rowM[1]), scattered: r1(rowM[2]) }, rowMNotConfirmed: { unknown: r1(unconfirmedM[0]), planted: r1(unconfirmedM[1]), scattered: r1(unconfirmedM[2]) },
    },
    halves: withHalves ? halves(reads, v) : null,
  };
  out.ms = Date.now() - t0;
  return out;
}

/** The flight read twice from alternate photographs. */
function halves(reads: CornPhotoRead[], v: Variant) {
  const sorted = [...reads].sort((a, b) => (a.name < b.name ? -1 : 1));
  const H = [0, 1].map(par => run(sorted.filter((_, i) => i % 2 === par), v, par ? "odd half" : "even half"));
  if (!H[0] || !H[1]) return { failed: "a half made no dot" };
  const origin = H[0].F.origin;
  // Each half's plants on rows in one frame (the first half's origin).
  const plants = H.map(h => { const out: { e: number; n: number; tier: number }[] = []; for (let i = 0; i < h!.n; i++) { const t = h!.tierOf(h!.rec, i); if (t < 0) continue; const d = h!.P.all[i], p = fromEnu([d.e, d.n, 0], h!.F.origin), [e, nn] = toEnu({ lat: p.lat, lng: p.lng, altM: 0 }, origin); out.push({ e, n: nn, tier: t }); } return out; });
  const cellM = 10, key = (e: number, n: number, s: number) => `${Math.floor(e / s)}:${Math.floor(n / s)}`;
  const grid = (ps: { e: number; n: number }[], s: number) => { const g = new Map<string, number[]>(); ps.forEach((p, i) => { const k = key(p.e, p.n, s); (g.get(k) ?? g.set(k, []).get(k)!).push(i); }); return g; };
  const near = (g: Map<string, number[]>, ps: { e: number; n: number }[], e: number, n: number, r: number, s: number, fn: (i: number, de: number, dn: number) => void) => { for (let i = Math.floor((e - r) / s); i <= Math.floor((e + r) / s); i++) for (let j = Math.floor((n - r) / s); j <= Math.floor((n + r) / s); j++) for (const k of g.get(`${i}:${j}`) ?? []) { const de = ps[k].e - e, dn = ps[k].n - n; if (Math.abs(de) <= r && Math.abs(dn) <= r) fn(k, de, dn); } };
  // How the second half sits against the first, per 10 m of ground (the two are placed separately): the peak of the
  // differences between their plants, centimetre bins within 0.3 m (as registerPhotos reads a repeat); the flight's
  // peak where a square has too few.
  const R = PLANTS_FIRST.reachM, nb = Math.round((2 * R) / 0.01) + 1, g1 = grid(plants[1], R);
  const hist = new Map<string, Float32Array>(), whole = new Float32Array(nb * nb);
  for (const p of plants[0]) near(g1, plants[1], p.e, p.n, R, R, (_k, de, dn) => { const b = Math.round((dn + R) / 0.01) * nb + Math.round((de + R) / 0.01), k = key(p.e, p.n, cellM); (hist.get(k) ?? hist.set(k, new Float32Array(nb * nb)).get(k)!)[b]++; whole[b]++; });
  const peak = (h: Float32Array): [number, number, number] => { let b = 0; for (let k = 1; k < h.length; k++) if (h[k] > h[b]) b = k; return [(b % nb) * 0.01 - R, Math.floor(b / nb) * 0.01 - R, h[b]]; };
  const wholePeak = peak(whole), offsets = new Map<string, [number, number]>();
  for (const [k, h] of hist) { const pk = peak(h); offsets.set(k, pk[2] >= PLANTS_FIRST.minVotes ? [pk[0], pk[1]] : [wholePeak[0], wholePeak[1]]); }
  const offAt = (e: number, n: number) => offsets.get(key(e, n, cellM)) ?? [wholePeak[0], wholePeak[1]];
  const gate = ROW_RECALL.exclM, gs = [grid(plants[0], 0.5), g1];
  const lacks = [0, 1].map(a => {
    const b = 1 - a, hb = H[b]!, mine = plants[a];
    // Where the other half looked: 2+ of its photographs over the plant (in the other half's own frame).
    const asDots = mine.map((p): Dot => { const o = a === 0 ? offAt(p.e, p.n) : (() => { const q = offAt(p.e, p.n); return [-q[0], -q[1]]; })(); const ll = fromEnu([p.e + o[0], p.n + o[1], 0], origin), [e, n] = toEnu({ lat: ll.lat, lng: ll.lng, altM: 0 }, hb.F.origin); return { e, n, members: [], photos: 0, spreadM: 0 }; });
    const cov = coverage(asDots, frames as Map<string, GeorefFrame>, hb.P.photos, hb.P.shifts, hb.F.origin);
    const comparable = [0, 0, 0, 0, 0], lacking = [0, 0, 0, 0, 0], gb = b === 1 ? g1 : gs[0], sb = b === 1 ? R : 0.5;
    mine.forEach((p, i) => {
      if (cov[i] < 2) return;
      comparable[p.tier]++;
      const o = offAt(p.e, p.n), e = p.e + (a === 0 ? o[0] : -o[0]), n = p.n + (a === 0 ? o[1] : -o[1]);
      let hit = false; near(gb, plants[b], e, n, gate, sb, (_k, de, dn) => { if (Math.hypot(de, dn) <= gate) hit = true; });
      if (!hit) lacking[p.tier]++;
    });
    return { photographs: H[a]!.P.photos.length, onRows: mine.length, whereTheOtherLooked: Object.fromEntries(TIERS.map((t, k) => [t, comparable[k]])), ofThoseTheOtherLacks: Object.fromEntries(TIERS.map((t, k) => [t, lacking[k]])) };
  });
  return { gateM: gate, halfAgainstHalfM: [Math.round(wholePeak[0] * 100) / 100, Math.round(wholePeak[1] * 100) / 100], even: lacks[0], odd: lacks[1] };
}

for (const name of (opt("variants") ?? "base,loose").split(",")) {
  const v = VARIANTS[name]; if (!v) throw new Error(`no variant ${name}`);
  const m = measure(readsFor(v), v, !argv.includes("--no-halves"));
  writeFileSync(join(OUT, `${FLIGHT}.${name}.json`), JSON.stringify(m, null, 1));
  console.log(`${FLIGHT} / ${name}: ${JSON.stringify("onRows" in m ? { onRows: m.onRows, rows: m.rows, rowM: m.rowM, onNoRow: m.onNoRow, betweenRows: m.betweenRows, s: Math.round(m.ms / 1000) } : m)}`);
}
