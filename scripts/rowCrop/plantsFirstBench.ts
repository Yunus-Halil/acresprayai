// Corn, plants first (src/lib/fieldTwin/plantsFirst.ts) over a flight's analysis record: the photographs' own plant
// sightings, registered against each other, merged into one dot per plant, then rows through the dots. The plants are
// measured on their own before any row is drawn (a beautiful row must not hide weak plant finding):
//   repeat     the spread of each dot's sightings about it, cm (how tightly photographs agree on a plant)
//   halves     dots from the odd photographs against dots from the even ones: the share found by both
//   photos     how many photographs a dot holds, against how many sighted anything near it
// Rows are measured after, apart. Reads only the analysis record: no photograph is decoded.
//   npx vite-node scripts/rowCrop/plantsFirstBench.ts -- --analysis <analysis.json> --out <dir> [--twin <twin dir> to write plants.json beside it]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { framesFromAnalysis, parseTwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { type CornPhotoRead, cornField } from "../../src/lib/fieldTwin/cornField";
import { PLANTS_FIRST, type Read, SEQUENCE, coverage, mergeDots, projectSightings, reconstruct, registerPhotos } from "../../src/lib/fieldTwin/plantsFirst";
import { fromEnu } from "../../src/lib/sourceFrames/odm";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = arg("out"); mkdirSync(OUT, { recursive: true });
const parsed = parseTwinAnalysis(JSON.parse(readFileSync(arg("analysis"), "utf8"))); if (!parsed.ok) throw new Error("analysis record not readable");
const frames = framesFromAnalysis(parsed.analysis);
const reads = (parsed.analysis.reads as unknown as (CornPhotoRead & Read)[]).filter(r => frames.has(r.name));
const t0 = Date.now();
// The first pass gives the frame's origin and a first direction and spacing for the rows step only.
const F = cornField(reads, frames);
const { sights, photos } = projectSightings(reads, frames, F.origin);
console.log(`${photos.length} photographs, ${sights.length} sightings (${Math.round(sights.length / photos.length)} a photograph)`);

const reg = registerPhotos(sights, photos.length);
const mags = reg.shifts.map(s => Math.hypot(s.e[0], s.n[0])).sort((a, b) => a - b);
const gateM = Math.min(PLANTS_FIRST.gateMax, Math.max(PLANTS_FIRST.gateMin, PLANTS_FIRST.gateTimes * reg.repeatM));
console.log(`registered: median correction ${(100 * mags[mags.length >> 1]).toFixed(1)} cm, 90th ${(100 * mags[Math.floor(0.9 * mags.length)]).toFixed(1)} cm; planes on ${reg.shifts.filter(s => s.cells >= 4).length} photographs; same plant repeats within ${(100 * reg.repeatM).toFixed(1)} cm (median), gate ${(100 * gateM).toFixed(1)} cm`);

const dots = mergeDots(sights, reg.shifts, gateM);
const spread = dots.map(d => d.spreadM).sort((a, b) => a - b), ph = dots.map(d => d.photos).sort((a, b) => a - b);
console.log(`dots: ${dots.length}; sightings in a dot ${dots.reduce((t, d) => t + d.photos, 0)} of ${sights.length}; photographs a dot median ${ph[ph.length >> 1]}; spread about the dot median ${(100 * spread[spread.length >> 1]).toFixed(1)} cm, 90th ${(100 * spread[Math.floor(0.9 * spread.length)]).toFixed(1)} cm`);

// Halves: the odd and the even photographs merged apart (the registration is the whole flight's).
const half = (k: number) => { const keep = sights.filter(s => s.p % 2 === k); return mergeDots(keep, reg.shifts, gateM); };
const odd = half(1), even = half(0);
let both = 0;
{ const cell = 0.1, g = new Map<string, number[]>(); even.forEach((d, i) => { const k = `${Math.floor(d.e / cell)}:${Math.floor(d.n / cell)}`; (g.get(k) ?? g.set(k, []).get(k)!).push(i); });
  for (const d of odd) { let hit = false; for (let i = -1; i <= 1 && !hit; i++) for (let j = -1; j <= 1 && !hit; j++) for (const k of g.get(`${Math.floor(d.e / cell) + i}:${Math.floor(d.n / cell) + j}`) ?? []) if (Math.hypot(even[k].e - d.e, even[k].n - d.n) <= gateM) { hit = true; break; } if (hit) both++; } }
const agreement = (2 * both) / Math.max(1, odd.length + even.length);
console.log(`halves: odd ${odd.length}, even ${even.length}, found by both ${both} (agreement ${agreement.toFixed(3)})`);
const tPlants = Date.now() - t0;

// Rows, after and apart, in the order a person reads a field: certain plants, their rows, the field's geometry from
// those, then the uncertain plants and rows again against it.
const covered = coverage(dots, frames, photos, reg.shifts, F.origin);
const rec = reconstruct(dots, covered, F.directionDeg ?? 0, F.pitchM ?? 0.76);
const G = rec.geometry, cnt = [0, 0, 0]; for (const c of rec.certainty) cnt[c]++;
const certainRowsN = rec.rows.filter(r => r.kind === "certain").length, geomRowsN = rec.rows.length - certainRowsN;
const rowM = rec.rows.reduce((t, r) => t + r.lengthM, 0), notConfirmedM = rec.rows.reduce((t, r) => t + r.segments.filter(g => !g.confirmed).reduce((u, g) => u + g.a1 - g.a0, 0), 0);
console.log(`certain plants ${G.certainDots} (of ${dots.length}); certain rows ${G.certainRows}: spacing ${G.spacingM.toFixed(3)} m at ${G.directionDeg.toFixed(2)} deg, plant spacing ${G.seedM != null ? (100 * G.seedM).toFixed(1) + " cm" : "not measured"}, row length median ${G.rowLengthMedianM.toFixed(1)} m, ${G.perMMedian.toFixed(1)} plants a metre`);
console.log(`second look: certain ${cnt[0]}, probable ${cnt[1]}, uncertain ${cnt[2]}; rows ${rec.rows.length} (${certainRowsN} certain, ${geomRowsN} from geometry), ${Math.round(rowM)} m, of which ${Math.round(notConfirmedM)} m "row continues, plants not confirmed"; dots on a row ${Array.from(rec.rowOf).filter(r => r >= 0).length}`);
console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s (plants ${(tPlants / 1000).toFixed(1)} s)`);

const ll = (e: number, n: number) => { const p = fromEnu([e, n, 0], F.origin); return [Math.round(p.lat * 1e8) / 1e8, Math.round(p.lng * 1e8) / 1e8]; };
// What each dot is drawn as: 0 a certain plant on a row, 1 a probable one (the certain rows' geometry supports it),
// 2 seen but on no row (headland, weeds, anything the rows do not explain), 3 between two rows: not the crop.
const shown = dots.map((_, i) => (rec.rowOf[i] >= 0 ? (rec.certainty[i] === 0 ? 0 : 1) : rec.between[i] ? 3 : 2));
const shownN = [0, 0, 0, 0]; for (const v of shown) shownN[v]++;
const whyN = [0, 0, 0, 0, 0]; for (const v of rec.why) whyN[v]++;
const certainOff = [0, 0, 0, 0, 0]; rec.why.forEach((v, i) => { if (rec.certainty[i] === 0) certainOff[v]++; });
console.log(`why on no row (all dots): no row reaches ${whyN[1]}, double ${whyN[2]}, off the plant spacing ${whyN[3]}, between rows ${whyN[4]}; certain plants: on a row ${certainOff[0]}, no row ${certainOff[1]}, double ${certainOff[2]}, off spacing ${certainOff[3]}, between ${certainOff[4]}`);
console.log(`gaps: rows ${Math.round(100 * rec.gaps.filled)} % full, so up to ${(100 * rec.gaps.gapM).toFixed(0)} cm without a plant is still confirmed; ${rec.gaps.bridged} such gaps bridged, ${rec.gaps.notConfirmedStretches} stretches not confirmed, ${rec.gaps.cutOverMaxBridge} rows cut at a gap over the bridge limit (${Math.round(rec.gaps.cutLengthM)} m)`);
console.log(`drawn: plants on rows ${shownN[0]} certain + ${shownN[1]} probable; on no row ${shownN[2]}; between rows (not the crop) ${shownN[3]}`);
const summary = {
  analysis: arg("analysis"), photographs: photos.length, sightings: sights.length, at: new Date().toISOString(), settings: { PLANTS_FIRST, SEQUENCE },
  plants: { dots: dots.length, gateM, repeatM: reg.repeatM, photographsPerDotMedian: ph[ph.length >> 1], spreadCmMedian: 100 * spread[spread.length >> 1], spreadCmP90: 100 * spread[Math.floor(0.9 * spread.length)], halves: { odd: odd.length, even: even.length, both, agreement }, correctionCmMedian: 100 * mags[mags.length >> 1], correctionCmP90: 100 * mags[Math.floor(0.9 * mags.length)], certain: cnt[0], probable: cnt[1], uncertain: cnt[2] },
  geometry: G,
  rows: { count: rec.rows.length, certain: certainRowsN, fromGeometry: geomRowsN, lengthM: rowM, notConfirmedM, dotsOnRow: Array.from(rec.rowOf).filter(r => r >= 0).length },
  diagnostics: { whyOnNoRow: { noRowReaches: whyN[1], double: whyN[2], offPlantSpacing: whyN[3], betweenRows: whyN[4] }, certainPlants: { onRow: certainOff[0], noRowReaches: certainOff[1], double: certainOff[2], offPlantSpacing: certainOff[3], betweenRows: certainOff[4] }, gaps: rec.gaps },
};
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
const plantsOut = { version: 3, source: "plants first (development)", note: "One dot per plant two or more photographs located, placed where they saw it. Filled: a certain plant on a row. Ring: probable (on a row, at the field's plant spacing). Grey: seen, on no row. Grey cross: between two rows, not the crop. Not identified as corn by its look; development output, not a count.", points: dots.map(d => ll(d.e, d.n)), certainty: shown, why: Array.from(rec.why), photos: dots.map(d => d.photos), covered: Array.from(covered) };
writeFileSync(join(OUT, "plants.json"), JSON.stringify(plantsOut));
const rowsOut = rec.rows.map(r => {
  const th = (G.directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th);
  const seg = (g: { a0: number; a1: number; confirmed: boolean }) => ({ confirmed: g.confirmed, line: stretchLine(r.line, g.a0, g.a1, ct, st).map(([e, n]) => ll(e, n)) });
  return { id: r.id, kind: r.kind, line: r.line.map(([e, n]) => ll(e, n)), lengthM: r.lengthM, perM: r.perM, plants: r.dots.length, certain: r.dots.filter(i => rec.certainty[i] === 0).length, segments: r.segments.map(seg) };
});
writeFileSync(join(OUT, "rows.json"), JSON.stringify({ geometry: G, rows: rowsOut }));
writeFileSync(join(OUT, "shifts.json"), JSON.stringify({ photos, shifts: reg.shifts }));
if (arg("twin")) { writeFileSync(join(arg("twin"), "plants.json"), JSON.stringify(plantsOut)); console.log(`plants.json -> ${arg("twin")}`); }

/** A stretch of a row's course from exactly `a0` to exactly `a1` along (the course is stored a metre apart: its own points inside, the ends interpolated). */
function stretchLine(line: [number, number][], a0: number, a1: number, ct: number, st: number): [number, number][] {
  const ac = line.map(([e, n]) => [e * ct + n * st, -e * st + n * ct] as [number, number]).sort((x, y) => x[0] - y[0]);
  const cAt = (a: number) => { if (a <= ac[0][0]) return ac[0][1]; if (a >= ac[ac.length - 1][0]) return ac[ac.length - 1][1]; for (let k = 0; k + 1 < ac.length; k++) if (a >= ac[k][0] && a <= ac[k + 1][0]) return ac[k][1] + ((a - ac[k][0]) / (ac[k + 1][0] - ac[k][0] || 1)) * (ac[k + 1][1] - ac[k][1]); return ac[0][1]; };
  const pts: [number, number][] = [[a0, cAt(a0)], ...ac.filter(([a]) => a > a0 + 1e-6 && a < a1 - 1e-6), [a1, cAt(a1)]];
  return pts.map(([a, c]) => [a * ct - c * st, a * st + c * ct]);
}
