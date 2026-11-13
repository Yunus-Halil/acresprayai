// Corn, plants first with the second look (2026-11-13). The plants-first pass (plantsFirst.ts) gives certain plants and
// the rows they make. Then each photograph is searched again along those rows, their gaps and a little past their
// ends (rowGuided.ts searchPhoto, with darkness against the soil counted as well as greenness: stressed seedlings are
// dark and barely green), against control strips mid-alley in the same photograph. Candidates are merged along each row
// across photographs (mergeAlongRows: a photograph's chance of finding a plant against that of a false one in the
// alley); a stretch of row is verified only where its band holds clearly more than its controls. A plant the second
// look finds is added only on a verified stretch, seen by two photographs or more, where no plant-first dot already
// stands; it is probable, never certain (it cannot start a row). Everything else stays as it was.
//   npx vite-node scripts/rowCrop/secondLookBench.ts -- --analysis <analysis.json> --dir <photographs> --out <dir>
//       [--twin-from <twin dir> --twin-to <twin dir> --twin-id <id>]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { decodeImage } from "../bench/images";
import { framesFromAnalysis, parseTwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { type CornPhotoRead, cornField } from "../../src/lib/fieldTwin/cornField";
import { frameFootprint, pixelToGround } from "../../src/lib/directGeoref/projection";
import { type Dot, PLANTS_FIRST, type Read, coverage, mergeDots, projectSightings, reconstruct, registerPhotos, shiftOf } from "../../src/lib/fieldTwin/plantsFirst";
import { ROW_GUIDED, type PhotoSearch, type RowLine, mergeAlongRows, searchPhoto } from "../../src/lib/fieldTwin/rowGuided";
import { fromEnu, toEnu } from "../../src/lib/sourceFrames/odm";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = arg("out"), DIR = arg("dir"); mkdirSync(join(OUT, "search"), { recursive: true });
const EXTEND_M = Number(arg("extend", "6")), DARK = Number(arg("dark", "1")), BAND_HALF_M = Number(arg("band", "0.07"));
const parsed = parseTwinAnalysis(JSON.parse(readFileSync(arg("analysis"), "utf8"))); if (!parsed.ok) throw new Error("analysis record not readable");
const frames = framesFromAnalysis(parsed.analysis);
const reads = (parsed.analysis.reads as unknown as (CornPhotoRead & Read)[]).filter(r => frames.has(r.name));
const t0 = Date.now();
const F = cornField(reads, frames), origin = F.origin;
const { sights, photos } = projectSightings(reads, frames, origin), reg = registerPhotos(sights, photos.length);
const gateM = Math.min(PLANTS_FIRST.gateMax, Math.max(PLANTS_FIRST.gateMin, PLANTS_FIRST.gateTimes * reg.repeatM));
const dots = mergeDots(sights, reg.shifts, gateM), covered = coverage(dots, frames, photos, reg.shifts, origin);
const rec1 = reconstruct(dots, covered, F.directionDeg ?? 0, F.pitchM ?? 0.76), G = rec1.geometry, S = G.spacingM;
const th = (G.directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th);
console.log(`first look: ${dots.length} dots, ${rec1.rows.length} rows, ${Math.round(rec1.rows.reduce((t, r) => t + r.lengthM, 0))} m, not confirmed ${Math.round(rec1.rows.reduce((t, r) => t + r.segments.filter(g => !g.confirmed).reduce((u, g) => u + g.a1 - g.a0, 0), 0))} m`);

// The rows to search: each plants-first row, carried EXTEND_M past both ends along its own direction, a vertex every 0.25 m.
const rows: RowLine[] = rec1.rows.map(r => {
  const ac = r.line.map(([e, n]) => [e * ct + n * st, -e * st + n * ct]);
  const cAt = (a: number) => { if (a <= ac[0][0]) return ac[0][1]; if (a >= ac[ac.length - 1][0]) return ac[ac.length - 1][1]; for (let k = 0; k + 1 < ac.length; k++) if (a >= ac[k][0] && a <= ac[k + 1][0]) return ac[k][1] + ((a - ac[k][0]) / (ac[k + 1][0] - ac[k][0] || 1)) * (ac[k + 1][1] - ac[k][1]); return ac[0][1]; };
  const a0 = r.a0 - EXTEND_M, a1 = r.a1 + EXTEND_M, step = 0.25, en: [number, number][] = [];
  for (let a = a0; a <= a1 + 1e-9; a += step) { const c = cAt(a); en.push([a * ct - c * st, a * st + c * ct]); }
  return { id: r.id, a0, stepM: step, en };
});

// Search every photograph along them (cached).
const files = readdirSync(DIR).filter(f => /\.jpe?g$/i.test(f)).sort().filter(f => frames.has(basename(f).replace(/\.[^.]+$/, "")));
const searches: PhotoSearch[] = [];
const opts = { ...ROW_GUIDED, darkWeight: DARK };
let n = 0;
for (const f of files) {
  const stem = basename(f).replace(/\.[^.]+$/, ""), cache = join(OUT, "search", `${stem}.json`); n++;
  if (existsSync(cache)) { searches.push(JSON.parse(readFileSync(cache, "utf8"))); continue; }
  const frame = frames.get(stem)!, fp = frameFootprint(frame);
  const box = fp ? fp.map(g => toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, origin)) : [];
  const [e0, e1, n0, n1] = [Math.min(...box.map(p => p[0])), Math.max(...box.map(p => p[0])), Math.min(...box.map(p => p[1])), Math.max(...box.map(p => p[1]))];
  const near = rows.filter(r => r.en.some(([e, nn]) => e >= e0 && e <= e1 && nn >= n0 && nn <= n1));
  const raw = decodeImage(new Uint8Array(readFileSync(join(DIR, f))));
  const s = searchPhoto(stem, { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) }, frame, near, origin, S, BAND_HALF_M, opts);
  writeFileSync(cache, JSON.stringify(s)); searches.push(s);
  if (n % 20 === 0) console.log(`searched ${n}/${files.length} (${Math.round(s.rowM)} m of row, ${s.ms} ms)`);
}
const M = mergeAlongRows(searches, rows, gateM, opts);
const verified = M.stretches.filter(s => s.state === "verified");
const verifiedAt = (row: number, a: number) => verified.some(s => s.row === row && a >= s.a0 && a < s.a1);
console.log(`second look: ${M.marks.length} marks on rows, ${M.controlMarks.length} on control strips; verified ${Math.round(verified.reduce((t, s) => t + s.a1 - s.a0, 0))} m of ${Math.round(M.stretches.reduce((t, s) => t + s.a1 - s.a0, 0))} m searched`);

// Each mark where its photographs saw it, through their own corrected cameras (the dots' frame).
const nameIdx = new Map(photos.map((p, i) => [p, i]));
const placed = M.marks.map(m => {
  let e = 0, nn = 0, k = 0;
  for (const c of m.members) { const name = searches[c.photo].name, f = frames.get(name), p = nameIdx.get(name); if (!f || p == null) continue; const g = pixelToGround(f, c.u, c.v); if (!g) continue; const [x, y] = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, origin), [de, dn] = shiftOf(reg.shifts[p], c.u, c.v); e += x + de; nn += y + dn; k++; }
  return k ? { m, e: e / k, n: nn / k } : null;
}).filter((x): x is NonNullable<typeof x> => !!x);
// New plants: on a verified stretch, two photographs or more, no plants-first dot within the gate.
const cell = 0.1, grid = new Map<string, number[]>(); dots.forEach((d, i) => { const k = `${Math.floor(d.e / cell)}:${Math.floor(d.n / cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
const nearDot = (e: number, nn: number) => { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const k of grid.get(`${Math.floor(e / cell) + i}:${Math.floor(nn / cell) + j}`) ?? []) if (Math.hypot(dots[k].e - e, dots[k].n - nn) <= gateM) return true; return false; };
const added: Dot[] = [], addedCov: number[] = [];
let rejected = { notVerified: 0, oneView: 0, alreadyDot: 0 };
for (const p of placed) {
  if (p.m.views < 2) { rejected.oneView++; continue; }
  if (!verifiedAt(p.m.row, p.m.a)) { rejected.notVerified++; continue; }
  if (nearDot(p.e, p.n)) { rejected.alreadyDot++; continue; }
  added.push({ e: p.e, n: p.n, members: [], photos: p.m.views, spreadM: 0 }); addedCov.push(p.m.covered);
}
console.log(`added on the second look: ${added.length} plants; not added: ${rejected.alreadyDot} already a dot, ${rejected.notVerified} on a stretch not verified, ${rejected.oneView} one photograph only`);

// Rows again with the added plants; they may confirm a stretch, never start a row (they are not certain).
const all = [...dots, ...added], cov2 = Int32Array.from([...covered, ...addedCov]);
const notCertain = new Uint8Array(all.length); for (let i = dots.length; i < all.length; i++) notCertain[i] = 1;
const rec2 = reconstruct(all, cov2, F.directionDeg ?? 0, F.pitchM ?? 0.76, PLANTS_FIRST, undefined, notCertain);
const nc = (r: typeof rec2) => Math.round(r.rows.reduce((t, x) => t + x.segments.filter(g => !g.confirmed).reduce((u, g) => u + g.a1 - g.a0, 0), 0));
console.log(`after: ${rec2.rows.length} rows, ${Math.round(rec2.rows.reduce((t, r) => t + r.lengthM, 0))} m, not confirmed ${nc(rec2)} m (before ${nc(rec1)} m); plants on rows ${Array.from(rec2.rowOf).filter(x => x >= 0).length} (before ${Array.from(rec1.rowOf).filter(x => x >= 0).length}); ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const ll = (e: number, nn: number) => { const p = fromEnu([e, nn, 0], origin); return [Math.round(p.lat * 1e8) / 1e8, Math.round(p.lng * 1e8) / 1e8]; };
const shown = all.map((_, i) => (rec2.rowOf[i] >= 0 ? (rec2.certainty[i] === 0 ? 0 : 1) : rec2.between[i] ? 3 : 2));
const plantsOut = { version: 4, source: "plants first with the second look (development)", note: "Filled: a certain plant on a row. Ring: probable (on a row at the field's plant spacing, or found on the second look along a verified stretch of row). Grey: seen, on no row. Grey cross: between two rows, not the crop. Not identified as corn by its look; development output, not a count.", points: all.map(d => ll(d.e, d.n)), certainty: shown, secondLook: all.map((_, i) => (i >= dots.length ? 1 : 0)) };
writeFileSync(join(OUT, "plants.json"), JSON.stringify(plantsOut));
const rowsOut = rec2.rows.map(r => { const seg = (g: { a0: number; a1: number; confirmed: boolean }) => ({ confirmed: g.confirmed, line: stretchLine(r.line, g.a0, g.a1, ct, st).map(([e, nn]) => ll(e, nn)) }); return { id: r.id, kind: r.kind, line: r.line.map(([e, nn]) => ll(e, nn)), lengthM: r.lengthM, perM: r.perM, plants: r.dots.length, certain: r.dots.filter(i => rec2.certainty[i] === 0).length, segments: r.segments.map(seg) }; });
writeFileSync(join(OUT, "rows.json"), JSON.stringify({ geometry: rec2.geometry, rows: rowsOut }));
writeFileSync(join(OUT, "summary.json"), JSON.stringify({ firstLook: { dots: dots.length, rows: rec1.rows.length, notConfirmedM: nc(rec1) }, secondLook: { marks: M.marks.length, controlMarks: M.controlMarks.length, verifiedM: verified.reduce((t, s) => t + s.a1 - s.a0, 0), added: added.length, rejected }, after: { rows: rec2.rows.length, notConfirmedM: nc(rec2) }, settings: { EXTEND_M, DARK, BAND_HALF_M } }, null, 1));

/** A stretch of a row's course from exactly `a0` to exactly `a1` along (the course is stored a metre apart: its own points inside, the ends interpolated). */
function stretchLine(line: [number, number][], a0: number, a1: number, ct: number, st: number): [number, number][] {
  const ac = line.map(([e, n]) => [e * ct + n * st, -e * st + n * ct] as [number, number]).sort((x, y) => x[0] - y[0]);
  const cAt = (a: number) => { if (a <= ac[0][0]) return ac[0][1]; if (a >= ac[ac.length - 1][0]) return ac[ac.length - 1][1]; for (let k = 0; k + 1 < ac.length; k++) if (a >= ac[k][0] && a <= ac[k + 1][0]) return ac[k][1] + ((a - ac[k][0]) / (ac[k + 1][0] - ac[k][0] || 1)) * (ac[k + 1][1] - ac[k][1]); return ac[0][1]; };
  const pts: [number, number][] = [[a0, cAt(a0)], ...ac.filter(([a]) => a > a0 + 1e-6 && a < a1 - 1e-6), [a1, cAt(a1)]];
  return pts.map(([a, c]) => [a * ct - c * st, a * st + c * ct]);
}
