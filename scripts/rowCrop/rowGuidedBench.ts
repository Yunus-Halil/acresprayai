// Reading along the rows the field already knows (src/lib/fieldTwin/rowGuided.ts), run over a stored corn build: the
// analysis record gives every photograph's first-pass read and every aligned camera; the photographs are read again
// along the lattice rows. Nothing is uploaded; outputs go where --out says (keep private flights off the repository).
//
//   npx vite-node scripts/rowCrop/rowGuidedBench.ts -- --dir <photographs> --analysis <analysis.json> --out <dir>
//       [--limit N] [--every N]
//
// Each photograph's search is kept under <out>/search, so a second run only merges. Writes summary.json (the measures
// of docs/features/corn-row-guided-reading.md that need no labels) and field.json (rows and marks in local metres).
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { NODE_DECODER, decodeImage } from "../bench/images";
import { framesFromAnalysis, parseTwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { FIELD, type CornPhotoRead, cornField, plantedGround } from "../../src/lib/fieldTwin/cornField";
import { ROW_GUIDED, type PhotoSearch, type RowLine, chooseLevel, latticeRows, mergeAlongRows, applicability, recentreRows, registerAlong, rowExtents, searchPhoto, seedSpacing, shiftAlong } from "../../src/lib/fieldTwin/rowGuided";
import { frameFootprint, pixelToGround } from "../../src/lib/directGeoref/projection";
import { FEATURE_NAMES, LOOK, auc, fitLook, lookLogit } from "../../src/lib/fieldTwin/fieldLook";
import { toEnu } from "../../src/lib/sourceFrames/odm";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = arg("dir"), OUT = arg("out"), LIMIT = Number(arg("limit", "0")), EVERY = Number(arg("every", "1"));
if (!DIR || !arg("analysis") || !OUT) { console.error("need --dir, --analysis and --out"); process.exit(1); }
mkdirSync(join(OUT, "search"), { recursive: true });
const parsed = parseTwinAnalysis(JSON.parse(readFileSync(arg("analysis"), "utf8"))); if (!parsed.ok) throw new Error(parsed.reason);
const frames = framesFromAnalysis(parsed.analysis), reads = (parsed.analysis.reads as unknown as CornPhotoRead[]).filter(r => frames.has(r.name));

// The first pass over the field, as the build made it: direction, origin, and the ground judged by the plants.
const F = cornField(reads, frames);
if (F.directionDeg == null || !F.pitchM || !FIELD.planted) throw new Error("the first pass holds no rows: nothing to read along");
const th = (F.directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th);
const toAC = (e: number, n: number): [number, number] => [e * ct + n * st, -e * st + n * ct];
const fromAC = (a: number, c: number): [number, number] => [a * ct - c * st, a * st + c * ct];
const en = (lat: number, lng: number): [number, number] => { const v = toEnu({ lat, lng, altM: 0 }, F.origin); return [v[0], v[1]]; };
const sightings: [number, number][] = [];
for (const r of reads) { const f = frames.get(r.name)!; for (const [x, y] of r.plants) { const g = pixelToGround(f, x * r.scale, y * r.scale); if (g) sightings.push(toAC(...en(g.lat, g.lng))); } }
const pg = plantedGround(sightings, F.pitchM, FIELD.planted);
if (!pg || !pg.valid) { const why = "the located plants do not show the planting on this flight: not read along rows, the first pass stands"; console.log(why); writeFileSync(join(OUT, "summary.json"), JSON.stringify({ flight: basename(DIR), applies: false, applicability: { why } }, null, 1)); process.exit(0); }
let lattice = latticeRows(pg);
const lines = (L: typeof lattice): RowLine[] => L.map(r => ({ id: r.id, a0: r.ac[0][0], stepM: pg.cellA, en: r.ac.map(([a, c]) => fromAC(a, c)) }));
let rows: RowLine[] = lines(lattice);
const latticeM = lattice.reduce((s, r) => s + (r.ac.length - 1) * pg.cellA, 0), plantedM = lattice.reduce((s, r) => s + r.planted.filter(Boolean).length * pg.cellA, 0);
// Derived from the flight, not chosen: the band is twice the scatter of the photographs' rows about the field's, the
// merge gate a little over that scatter.
const agree = F.rowAgreementM ?? 0.05, bandHalfM = Math.min(0.25 * pg.spacingM, Math.max(0.03, 2 * agree)), gateM = Math.max(0.03, 1.3 * agree);
console.log(`first pass: ${F.summary.cornRows} corn rows, ${F.summary.probableRows} unconfirmed; spacing ${pg.spacingM.toFixed(3)} m; lattice ${lattice.length} rows, ${Math.round(latticeM)} m (${Math.round(plantedM)} m over planted squares); band half ${(bandHalfM * 100).toFixed(1)} cm, gate ${(gateM * 100).toFixed(1)} cm`);

let files = readdirSync(DIR).filter(f => /\.jpe?g$/i.test(f)).sort().filter(f => frames.has(basename(f).replace(/\.[^.]+$/, "")));
if (EVERY > 1) files = files.filter((_, i) => i % EVERY === 0);
if (LIMIT) files = files.slice(0, LIMIT);
const searchAll = (pass: string): PhotoSearch[] => {
const searches: PhotoSearch[] = [];
mkdirSync(join(OUT, pass), { recursive: true });
let n = 0;
for (const f of files) {
  const stem = basename(f).replace(/\.[^.]+$/, ""), cache = join(OUT, pass, `${stem}.json`);
  n++;
  if (existsSync(cache)) { searches.push(JSON.parse(readFileSync(cache, "utf8"))); continue; }
  const frame = frames.get(stem)!, fp = frameFootprint(frame);
  const box = fp ? fp.map(g => en(g.lat, g.lng)) : [];
  const [e0, e1, n0, n1] = [Math.min(...box.map(p => p[0])), Math.max(...box.map(p => p[0])), Math.min(...box.map(p => p[1])), Math.max(...box.map(p => p[1]))];
  const near = rows.filter(r => r.en.some(([e, nn]) => e >= e0 && e <= e1 && nn >= n0 && nn <= n1));
  const raw = decodeImage(new Uint8Array(readFileSync(join(DIR, f))));
  const s = searchPhoto(stem, { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) }, frame, near, F.origin, pg.spacingM, bandHalfM);
  writeFileSync(cache, JSON.stringify(s));
  searches.push(s);
  const lv = chooseLevel(s);
  const at = s.candidates.filter(c => c.z >= ROW_GUIDED.ladder[lv.level]), per = (strip: number) => ((at.filter(c => c.strip === strip).length / Math.max(1, s.rowM)) * (strip === 0 ? 1 : s.controlScale)).toFixed(2);
  if (n % 10 === 0 || n === files.length) console.log(`${pass} ${n}/${files.length} ${stem}: ${Math.round(s.rowM)} m of row, bar ${ROW_GUIDED.ladder[lv.level]}${lv.quiet ? "" : " (controls never quiet)"}, per metre: band ${per(0)}, controls ${per(1)} / ${per(2)}; by bar ${ROW_GUIDED.ladder.map(z => `${z}: ${(s.candidates.filter(c => c.strip === 0 && c.z >= z).length / Math.max(1, s.rowM)).toFixed(1)}|${(s.candidates.filter(c => c.strip !== 0 && c.z >= z).length / Math.max(1, 2 * s.rowM)).toFixed(2)}`).join("  ")}; soil spread ${s.soilSpread.toFixed(2)}, ${s.ms} ms`);
}
return searches;
};
// Pass 1 on the lattice as the planted ground places it; the lines are moved onto the plants it finds; pass 2 on the moved lines.
const pass1 = searchAll("search1");
const app = applicability(pass1);
console.log(`applies: ${app.why}`);
if (!app.applies) { writeFileSync(join(OUT, "summary.json"), JSON.stringify({ flight: basename(DIR), applies: false, applicability: app, firstPass: { cornRows: F.summary.cornRows, unconfirmedRows: F.summary.probableRows } }, null, 1)); process.exit(0); }
const re = recentreRows(lattice, mergeAlongRows(pass1, rows, gateM).marks, pg.cellA);
console.log(`re-centred: ${re.shiftedM} m of row moved more than 2 cm, median shift ${(re.medianShiftM * 100).toFixed(1)} cm`);
lattice = re.rows; rows = lines(lattice);
const searched = searchAll("search2");
// Each photograph's placement along the rows, from where the same plants appear in the others.
const seedGuess = seedSpacing(mergeAlongRows(searched, rows, gateM).marks, pg.spacingM).spacingM ?? 0.15;
const alongShift = argv.includes("--no-along") ? searched.map(() => 0) : registerAlong(searched, searched.map(s => ROW_GUIDED.ladder[chooseLevel(s).level]), seedGuess);
const absShift = alongShift.map(Math.abs).sort((x, y) => x - y);
console.log(`along: median |shift| ${(100 * absShift[absShift.length >> 1]).toFixed(1)} cm, 90th ${(100 * absShift[Math.floor(absShift.length * 0.9)]).toFixed(1)} cm, unmoved ${alongShift.filter(v => v === 0).length}`);
const searches = shiftAlong(searched, alongShift);
const M0 = mergeAlongRows(searches, rows, gateM);
// Control strips are narrower than the band: their counts scaled to the band's width.
const cS = searches.reduce((t, s) => t + (s.controlScale ?? 1), 0) / Math.max(1, searches.length);
// The look, fitted on this field from labels the rows give: candidates behind marks on verified stretches are crop,
// candidates on the control strips at their photograph's bar are not.
const verified0 = M0.stretches.filter(s => s.state === "verified");
const examples: Parameters<typeof fitLook>[0] = [];
const blockOf = (c: { row: number; a: number }) => `${c.row}:${Math.floor(c.a / LOOK.blockM)}`;
for (const m of M0.marks) if (verified0.some(s => s.row === m.row && m.a >= s.a0 && m.a < s.a1)) for (const c of m.members) examples.push({ c, y: 1, block: blockOf(c) });
searches.forEach(s => { const bar = ROW_GUIDED.ladder[chooseLevel(s).level]; for (const c of s.candidates) if (c.strip !== 0 && c.z >= bar) examples.push({ c, y: 0, block: blockOf(c) }); });
const look = fitLook(examples);
console.log(`look: ${look.positives} crop, ${look.negatives} not; AUC out of fold ${look.aucOutOfFold}; ${look.droppedAsNoise} dropped as label noise; ${look.why ?? "weights " + (look.model ? look.model.w.map((w, k) => `${FEATURE_NAMES[k]} ${w.toFixed(2)}`).join(", ") : "")}`);
// Never labelled: candidates under their photograph's bar, on the band against the controls. Does the look separate them?
const unl = searches.flatMap(s => { const bar = ROW_GUIDED.ladder[chooseLevel(s).level]; return s.candidates.filter(c => c.z < bar); });
const lookUnlabelledAuc = look.model ? auc(unl.map(c => lookLogit(look.model, c)), unl.map(c => (c.strip === 0 ? 1 : 0))) : null;
const Mfull = mergeAlongRows(searches, rows, gateM, ROW_GUIDED, () => true, look.model);
// Each row's own ends, from its marks at the seed spacing they show; beyond them a row is not drawn and its marks are
// not plants of the crop.
const seed0 = seedSpacing(Mfull.marks, pg.spacingM).spacingM ?? 0.15;
const ext = rowExtents(Mfull.marks, rows.map(r => r.id), seed0);
const inside = (row: number, a: number) => { const e = ext.get(row); return !!e && a >= e[0] && a <= e[1]; };
const M = { ...Mfull, marks: Mfull.marks.filter(m => inside(m.row, m.a)), controlMarks: Mfull.controlMarks.filter(m => inside(m.row, m.a)),
  stretches: Mfull.stretches.flatMap(s => { const e = ext.get(s.row); if (!e) return []; const a0 = Math.max(s.a0, e[0]), a1 = Math.min(s.a1, e[1]); return a1 - a0 >= 0.5 ? [{ ...s, a0, a1 }] : []; }) };
const beyondEnds = { marks: Mfull.marks.length - M.marks.length, controlMarks: Mfull.controlMarks.length - M.controlMarks.length, rowM: Math.round(Mfull.stretches.reduce((t, s) => t + s.a1 - s.a0, 0) - M.stretches.reduce((t, s) => t + s.a1 - s.a0, 0)) };
const R = Math.round, r2 = (x: number) => R(x * 100) / 100, r3 = (x: number) => R(x * 1000) / 1000;
const len = (s: { a0: number; a1: number }) => s.a1 - s.a0;
const verified = M.stretches.filter(s => s.state === "verified"), notCovered = M.stretches.filter(s => s.state === "not covered");
const verifiedM = verified.reduce((t, s) => t + len(s), 0), coveredM = M.stretches.filter(s => s.state !== "not covered").reduce((t, s) => t + len(s), 0);
// Over planted squares only: the row length the planted ground carries, and how much of it is verified.
const plantedAt = (row: number, a: number) => { const L = lattice[row - 1], i = Math.round((a - L.ac[0][0]) / pg.cellA); return !!L.planted[Math.max(0, Math.min(L.planted.length - 1, i))]; };
let plantedVerified = 0, plantedAll = 0;
for (const s of M.stretches) for (let a = s.a0 + pg.cellA / 2; a < s.a1; a += pg.cellA) if (plantedAt(s.row, a)) { plantedAll += pg.cellA; if (s.state === "verified") plantedVerified += pg.cellA; }
const onVerified = M.marks.filter(m => verified.some(s => s.row === m.row && m.a >= s.a0 && m.a < s.a1));
// The seed spacing the marks themselves show on well-filled rows: the median gap between neighbouring marks.
const gaps: number[] = [];
for (const row of rows) { const as = onVerified.filter(m => m.row === row.id).map(m => m.a).sort((x, y) => x - y); for (let i = 1; i < as.length; i++) gaps.push(as[i] - as[i - 1]); }
gaps.sort((x, y) => x - y);
const seedM = gaps.length ? gaps[gaps.length >> 1] : NaN;
// The repeat check: the odd photographs and the even, merged apart, and the marks one half shares with the other.
const cut = (r: ReturnType<typeof mergeAlongRows>) => ({ ...r, marks: r.marks.filter(m => inside(m.row, m.a)) });
const odd = cut(mergeAlongRows(searches, rows, gateM, ROW_GUIDED, i => i % 2 === 1, look.model)), even = cut(mergeAlongRows(searches, rows, gateM, ROW_GUIDED, i => i % 2 === 0, look.model));
const tol = Number.isFinite(seedM) ? seedM / 2 : gateM;
const byRow = (ms: typeof M.marks) => { const m = new Map<number, number[]>(); for (const x of ms) (m.get(x.row) ?? m.set(x.row, []).get(x.row)!).push(x.a); for (const v of m.values()) v.sort((x, y) => x - y); return m; };
const E = byRow(even.marks); let both = 0;
for (const m of odd.marks) { const as = E.get(m.row); if (!as) continue; let lo = 0, hi = as.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (as[mid] < m.a) lo = mid + 1; else hi = mid; } if (Math.min(Math.abs((as[lo] ?? Infinity) - m.a), Math.abs((as[lo - 1] ?? Infinity) - m.a)) <= tol) both++; }
const lincoln = both ? ((odd.marks.length + 1) * (even.marks.length + 1)) / (both + 1) - 1 : null;
const levels = searches.map(s => chooseLevel(s));
const summary = {
  flight: basename(DIR), photographs: searches.length, ...NODE_DECODER,
  firstPass: { cornRows: F.summary.cornRows, unconfirmedRows: F.summary.probableRows, cornRowLengthM: F.summary.cornRowLengthM, readShare: F.planting.readShare, spacingM: F.pitchM },
  derived: { spacingM: r3(pg.spacingM), bandHalfM: r3(bandHalfM), gateM: r3(gateM), rowAgreementM: F.rowAgreementM },
  applicability: app,
  along: { medianAbsM: absShift[absShift.length >> 1], p90AbsM: absShift[Math.floor(absShift.length * 0.9)], unmoved: alongShift.filter(v => v === 0).length },
  recentre: { shiftedM: re.shiftedM, medianShiftM: re.medianShiftM },
  lattice: { rows: lattice.length, lengthM: R(latticeM), overPlantedSquaresM: R(plantedM) },
  search: { rowMetresRead: R(searches.reduce((t, s) => t + s.rowM, 0)), msPerPhoto: R(searches.reduce((t, s) => t + s.ms, 0) / Math.max(1, searches.length)), bars: Object.fromEntries(ROW_GUIDED.ladder.map((z, i) => [z, levels.filter(l => l.level === i).length])), photographsWhoseControlsNeverQuiet: levels.filter(l => !l.quiet).length, medianSoilSpread: r3(searches.map(s => s.soilSpread).sort((x, y) => x - y)[searches.length >> 1]), medianUnreadablePct: r2(100 * searches.map(s => s.unreadableShare).sort((x, y) => x - y)[searches.length >> 1]) },
  look: { positives: look.positives, negatives: look.negatives, droppedAsNoise: look.droppedAsNoise, aucOutOfFold: look.aucOutOfFold, aucOnNeverLabelledBelowBar: lookUnlabelledAuc != null ? r3(lookUnlabelledAuc) : null, weights: look.model ? Object.fromEntries(look.model.w.map((w, k) => [FEATURE_NAMES[k], r2(w)])) : null, why: look.why },
  beyondRowEnds: beyondEnds,
  withoutLook: { marks: M0.marks.length, controlMarks: M0.controlMarks.length, verifiedM: R(M0.stretches.filter(s => s.state === "verified").reduce((t, s) => t + s.a1 - s.a0, 0)) },
  merge: { perViewFind: M.p, perViewFalseInGate: M.q, marks: M.marks.length, controlMarks: M.controlMarks.length },
  rows: { verifiedM: R(verifiedM), coveredM: R(coveredM), notCoveredM: R(notCovered.reduce((t, s) => t + len(s), 0)), verifiedShareOfCovered: r3(verifiedM / Math.max(1, coveredM)), verifiedShareOverPlantedSquares: r3(plantedVerified / Math.max(1, plantedAll)), overPlantedSquaresM: R(plantedAll) },
  seedSpacing: seedSpacing(onVerified, pg.spacingM),
  offsets: (() => { const o = M.marks.map(m => m.off).sort((x, y) => x - y), ab = o.map(Math.abs).sort((x, y) => x - y); const per = new Map<string, number[]>(); for (const m of M.marks) { const k = `${m.row}:${Math.floor(m.a / 5)}`; (per.get(k) ?? per.set(k, []).get(k)!).push(m.off); } const meds = [...per.values()].filter(v => v.length >= 10).map(v => Math.abs(v.sort((x, y) => x - y)[v.length >> 1])).sort((x, y) => x - y); return { medianOffM: r3(o[o.length >> 1]), medianAbsOffM: r3(ab[ab.length >> 1]), stretchMedianAbsOffM: { p50: r3(meds[meds.length >> 1]), p90: r3(meds[Math.floor(meds.length * 0.9)]) } }; })(),
  marks: { perMetreOnVerifiedRows: r2(onVerified.length / Math.max(1, verifiedM)), perMetreOnControlStrips: r3((cS * M.controlMarks.length) / Math.max(1, 2 * coveredM)), controlOverRow: r3(((cS * M.controlMarks.length) / Math.max(1, 2 * coveredM)) / Math.max(1e-9, M.marks.length / Math.max(1, coveredM))), medianGapM: r3(seedM), medianViews: M.marks.map(m => m.views).sort((x, y) => x - y)[M.marks.length >> 1] ?? null, medianCovered: M.marks.map(m => m.covered).sort((x, y) => x - y)[M.marks.length >> 1] ?? null },
  repeat: { oddMarks: odd.marks.length, evenMarks: even.marks.length, both, agreement: r3(both / Math.max(1, (odd.marks.length + even.marks.length) / 2)), toleranceM: r3(tol), plantsEstimatedFromRepeat: lincoln ? R(lincoln) : null, marksOverEstimate: lincoln ? r3(M.marks.length / lincoln) : null },
  settings: ROW_GUIDED,
};
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
// --sweep: the merge-level settings moved either side, everything else as it stands; is the result flat around them?
if (argv.includes("--sweep")) {
  const run = (label: string, o: typeof ROW_GUIDED, gate: number) => {
    const Mx = mergeAlongRows(searches, rows, gate, o, () => true, look.model);
    const mk = Mx.marks.filter(m => inside(m.row, m.a)), ck = Mx.controlMarks.filter(m => inside(m.row, m.a));
    const st = Mx.stretches.flatMap(s => { const e = ext.get(s.row); if (!e) return []; const a0 = Math.max(s.a0, e[0]), a1 = Math.min(s.a1, e[1]); return a1 - a0 >= 0.5 ? [{ ...s, a0, a1 }] : []; });
    let pv = 0, pa = 0; for (const s of st) for (let a = s.a0 + pg.cellA / 2; a < s.a1; a += pg.cellA) if (plantedAt(s.row, a)) { pa += pg.cellA; if (s.state === "verified") pv += pg.cellA; }
    const cov = st.filter(s => s.state !== "not covered").reduce((t, s) => t + s.a1 - s.a0, 0);
    console.log(`sweep ${label.padEnd(26)} marks ${String(mk.length).padStart(6)}  verified over planted ${(pv / Math.max(1, pa)).toFixed(3)}  control/row ${(((cS * ck.length) / Math.max(1, 2 * cov)) / Math.max(1e-9, mk.length / Math.max(1, cov))).toFixed(3)}`);
  };
  run("as set", ROW_GUIDED, gateM);
  for (const k of [0.67, 1.5]) run(`controlPerM x${k}`, { ...ROW_GUIDED, controlPerM: ROW_GUIDED.controlPerM * k }, gateM);
  for (const k of [0.75, 1.33]) run(`merge gate x${k}`, ROW_GUIDED, gateM * k);
  for (const v of [1, 3]) run(`minViews ${v}`, { ...ROW_GUIDED, minViews: v }, gateM);
  for (const v of [3, 8]) run(`minBand ${v}`, { ...ROW_GUIDED, minBand: v }, gateM);
  for (const v of [0.001, 0.05]) run(`alpha ${v}`, { ...ROW_GUIDED, alpha: v }, gateM);
}
const rowEN = (id: number, a: number, off = 0): [number, number] => { const L = lattice[id - 1], x = (a - L.ac[0][0]) / pg.cellA, i = Math.max(0, Math.min(L.ac.length - 2, Math.floor(x))), t = x - i; return fromAC(a, L.ac[i][1] + t * (L.ac[i + 1][1] - L.ac[i][1]) + off); };
writeFileSync(join(OUT, "field.json"), JSON.stringify({
  directionDeg: F.directionDeg, pitchM: pg.spacingM,
  rows: M.stretches.filter(s => s.state !== "not covered").map(s => ({ identity: s.state === "verified" ? "corn" : "probable crop", lineEN: [rowEN(s.row, s.a0), rowEN(s.row, s.a1)] })),
  marks: M.marks.map(m => rowEN(m.row, m.a, m.off)), controlMarks: M.controlMarks.map(m => rowEN(m.row, m.a, m.off)),
  // Where each photograph itself saw each mark (photo name, pixel u, v): lets a check drawn in one photograph correct that photograph's own placement.
  markViews: M.marks.map(m => m.members.map(c => [searches[c.photo].name, c.u, c.v])),
  lattice: lattice.map(L => ({ id: L.id, lineEN: L.ac.map(([a, c]) => fromAC(a, c)) })),
  firstPassRows: F.rows.map(r => ({ identity: r.identity, lineEN: r.lineEN })),
}));
console.log(JSON.stringify({ ...summary, settings: undefined }, null, 1));
