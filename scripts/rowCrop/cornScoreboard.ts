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
import { PLANTS_FIRST, ROW_RECALL, SEQUENCE, SEQUENCE_V1, type Dot, bandAndAlley, coverage } from "../../src/lib/fieldTwin/plantsFirst";
import { ROW_GUIDED, bandBeatsControls } from "../../src/lib/fieldTwin/rowGuided";
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
  p4: { what: "phase 4: phase 3 (field spacing) with the between-rows label fixed: the rules as they stand now", spans: true, opts: ground => ({ sequence: SEQUENCE, ground }) },
  p4loose: { what: "the rules as they stand now, loosened placement on", spans: true, opts: ground => ({ sequence: SEQUENCE, ground, free: true }) },
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
  const opts = v.opts(ground), q = opts.sequence ?? SEQUENCE;
  const P = once(`dots ${part} spans=${!!v.spans} free=${!!opts.free} fieldSeed=${opts.fieldSeed !== false} certain=${q.certainViews}/${q.certainShare}`, () => placeDots(reads, frames, F, opts));
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
  const out = {
    flight: FLIGHT, variant: v.what, revision, photographs: reads.length, photographsWithCandidates: reads.filter(r => r.low?.length).length,
    cache: { missing, plantsDifferFromRecord: mismatched }, ms: 0, unplanted: rec.unplanted, cutOverScattered: rec.gaps.cutOverScattered, alleyRefused: rec.alleyRefused,
    geometry: { rowSpacingM: Math.round(S * 1000) / 1000, plantSpacingM: rec.geometry.seedM, directionDeg: Math.round(rec.geometry.directionDeg * 100) / 100, certainRows: rec.geometry.certainRows },
    planting: { judged: F.planting.judged, why: F.planting.why, plantedM2: F.planting.plantedM2, scatteredM2: F.planting.scatteredM2 },
    dots: { all: n, stricterMarks: P.strict, candidates: n - P.strict },
    onRows: Object.fromEntries(TIERS.map((t, k) => [t, onRows[k]])), onRowsTotal: onRows.reduce((t, x) => t + x, 0), probableOnSlotRows: inSlotRows(rec),
    rows: rec.rows.length, rowM: { plantsSeen: CP?.summary.confirmedM ?? 0, notConfirmed: CP?.summary.notConfirmedM ?? 0 },
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
