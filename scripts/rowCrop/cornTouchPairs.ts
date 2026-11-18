// Development only, read-only (TOUCH-4.md Part 1): on one photograph's dev tiles, the labelled plants missed beside a
// found one ("touching pairs"), and the wrong marks beside a found one ("duplicate pairs"), with what the field's dots
// there are made of. The field is made as the build makes it (build/corn.ts cornStage, as cornInspect.ts field), the
// score is cornLabelJudge.ts's, nothing is changed.
//
//   npx vite-node scripts/rowCrop/cornTouchPairs.ts -- --analysis <a.json> --reads <readsDir> --labels <file> --image <name> --out <file.json> [--field <json>]
//
// Definitions (fixed here, before anything was counted):
//   along / across   the field's rows' direction (rec.geometry.directionDeg), metres, in the frame the dots are in
//   same row         across distance within PLANTS_FIRST.onRowShare of the row spacing (the band a row takes plants in)
//   touching pair    a labelled plant missed, and the nearest found labelled plant on its row within TOUCH_M along it
//                    (pairs are the missed plant's; a found plant can be in several)
//   duplicate pair   a wrong mark (state 0) of a planted tile and the nearest found labelled plant within 2 R on the
//                    ground: "second" within R, "beside" from R to 2 R (FINAL-2.md's two groups)
//   the pair's dots  touching: the dot matched to the found plant; duplicate: that dot and the wrong mark's dot
//   two groups       the dot's sightings along the row, split at the largest gap between neighbours: each side's
//                    count and the distance between the two sides' centres (no split with one sighting)
//   two marks        photographs with two different marks of their own, one within T of each end of the pair
//                    (T = min(R, a third of the pair's distance)): the stricter marks, and with the lower-bar marks too
import "../bench/nodeStorageShim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pixelToGround } from "../../src/lib/directGeoref/projection";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { FIELD, type CornPhotoRead, cornFieldAndGround } from "../../src/lib/fieldTwin/cornField";
import { type CornPlantsOptions, placeDots, readRows } from "../../src/lib/fieldTwin/cornPlants";
import { PLANTS_FIRST, SEQUENCE, shiftOf } from "../../src/lib/fieldTwin/plantsFirst";
import { toEnu } from "../../src/lib/sourceFrames/odm";
import { type Label, fieldMarks, judgeTile, labelTiles, within } from "./cornLabelJudge";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
const TOUCH_M = 0.09;
const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, frames = framesFromAnalysis(A), NAME = arg("image");
const FOPT = opt("field") ? (JSON.parse(opt("field")!) as { sequence?: Partial<typeof SEQUENCE> }) : {};
const reads: CornPhotoRead[] = A.reads.map(r => join(arg("reads"), "reads", `${r.name}.json`)).filter(existsSync).map(p => JSON.parse(readFileSync(p, "utf8")));
// The field and the plants, as build/corn.ts cornStage makes them (and cornInspect.ts field), with the field options asked.
const { field: F, ground } = cornFieldAndGround(reads, frames, FIELD);
const opts: CornPlantsOptions = { ground, ...(FOPT.sequence ? { sequence: { ...SEQUENCE, ...FOPT.sequence } } : {}) };
const P = placeDots(reads, frames, F, opts)!, rec = readRows(P, F, opts), f = frames.get(NAME)!, pi = P.photos.indexOf(NAME), seed = rec.geometry.seedM!, R = seed / 2;
const M = fieldMarks(P, rec, F, f, pi);
const LAB = (JSON.parse(readFileSync(arg("labels"), "utf8")) as { images: { image: string; width: number; height: number; points: Label[] }[] }).images.find(i => i.image.replace(/\.[^.]+$/, "") === NAME)!;
const tiles = labelTiles({ x: 0, y: 0, w: LAB.width, h: LAB.height }, 4, false);
const th = (rec.geometry.directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th), band = PLANTS_FIRST.onRowShare * rec.geometry.spacingM;
const AL = (e: number, n: number) => e * ct + n * st, AC = (e: number, n: number) => -e * st + n * ct;

// Every mark of every photograph in the dots' frame: the stricter marks (sightings) and the lower-bar marks (candidates' own).
type Pt = { e: number; n: number; p: number; key: number };
const S = P.sights!, all: Pt[] = [];
S.forEach((s, k) => { const [de, dn] = shiftOf(P.shifts[s.p], s.u, s.v); all.push({ e: s.e + de, n: s.n + dn, p: s.p, key: k }); });
const nStrict = all.length, cf = P.candidates?.from ?? [];
const candPos = cf.map(c => {
  if (c.sight >= 0) return { e: all[c.sight].e, n: all[c.sight].n };
  const fr = frames.get(P.photos[c.p])!, g = pixelToGround(fr, c.u, c.v); if (!g) return null;
  const b = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, F.origin), [de, dn] = shiftOf(P.shifts[c.p], c.u, c.v); return { e: b[0] + de, n: b[1] + dn };
});
cf.forEach((c, k) => { const q = candPos[k]; if (q && c.sight < 0) all.push({ e: q.e, n: q.n, p: c.p, key: nStrict + k }); });
const G = 0.1, grid = new Map<string, number[]>(), gk = (e: number, n: number) => `${Math.floor(e / G)},${Math.floor(n / G)}`;
all.forEach((q, k) => { const key = gk(q.e, q.n); (grid.get(key) ?? grid.set(key, []).get(key)!).push(k); });
const near = (e: number, n: number, r: number) => { const out: number[] = []; const i0 = Math.floor((e - r) / G), i1 = Math.floor((e + r) / G), j0 = Math.floor((n - r) / G), j1 = Math.floor((n + r) / G); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const k of grid.get(`${i},${j}`) ?? []) if (Math.hypot(all[k].e - e, all[k].n - n) <= r) out.push(k); return out; };
/** Photographs with two different marks of their own, one within t of each end. */
const twoMarks = (a: [number, number], b: [number, number], t: number, lower: boolean) => {
  const A1 = near(a[0], a[1], t).filter(k => lower || k < nStrict), B1 = near(b[0], b[1], t).filter(k => lower || k < nStrict), photos = new Set<number>();
  for (const x of A1) for (const y of B1) if (x !== y && all[x].p === all[y].p) photos.add(all[x].p);
  return photos.size;
};
/** A dot's sightings along the row, split at the largest gap. */
const groups = (i: number) => {
  const pos: number[] = [];
  if (i < P.strict) for (const m of P.all[i].members) pos.push(AL(all[m].e, all[m].n));
  else for (const m of P.candidates!.members[i - P.strict]) { const q = candPos[m]; if (q) pos.push(AL(q.e, q.n)); }
  pos.sort((x, y) => x - y);
  if (pos.length < 2) return { sightings: pos.length, left: pos.length, right: 0, gapM: 0, largestStepM: 0 };
  let best = 1, bg = -1; for (let k = 1; k < pos.length; k++) if (pos[k] - pos[k - 1] > bg) { bg = pos[k] - pos[k - 1]; best = k; }
  const m = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length, L = pos.slice(0, best), Rr = pos.slice(best);
  return { sightings: pos.length, left: L.length, right: Rr.length, gapM: m(Rr) - m(L), largestStepM: bg };
};
const dotInfo = (i: number) => ({ dot: i, kind: i < P.strict ? "stricter" : ["", "second look 2+", "second look 1 sharp", "second look 1"][P.tier![i]], photos: P.all[i].photos, covered: P.covered[i], spreadCm: Math.round(P.all[i].spreadM * 1000) / 10, ...groups(i) });

const touching: Record<string, unknown>[] = [], dup: Record<string, unknown>[] = [];
let missedAll = 0;
for (const t of tiles) {
  const labs = LAB.points.filter(p => within(t, p.x, p.y)), plants = labs.filter(l => l.type === "plant");
  if (!plants.length) continue;
  const J = judgeTile(t, M.marks, M.place, R, labs), g = plants.map(l => M.place(l.x, l.y)!);
  const foundIdx = plants.map((_, k) => k).filter(k => J.plantFound[k]);
  plants.forEach((_, k) => {
    if (J.plantFound[k]) return; missedAll++;
    let best = -1, bd = Infinity;
    for (const j of foundIdx) { const da = Math.abs(AL(...g[j]) - AL(...g[k])), dc = Math.abs(AC(...g[j]) - AC(...g[k])); if (da <= TOUCH_M && dc <= band && da < bd) { bd = da; best = j; } }
    if (best < 0) return;
    const mk = J.ms[J.plantOf[best]], i = mk.i!, aF = AL(...g[best]), aM = AL(...g[k]), aD = AL(mk.e, mk.n), d = aM - aF;
    touching.push({ tile: t.id, missed: [Math.round(plants[k].x), Math.round(plants[k].y)], found: [Math.round(plants[best].x), Math.round(plants[best].y)], alongCm: Math.round(Math.abs(d) * 1000) / 10, acrossCm: Math.round(Math.abs(AC(...g[k]) - AC(...g[best])) * 1000) / 10,
      dotAt: Math.round(((aD - aF) / d) * 100) / 100, dotFromFoundCm: Math.round(Math.hypot(mk.e - g[best][0], mk.n - g[best][1]) * 1000) / 10, matched: dotInfo(i), tier: mk.tier,
      twoMarksStricter: twoMarks(g[best], g[k], Math.min(R, Math.abs(d) / 3), false), twoMarksAll: twoMarks(g[best], g[k], Math.min(R, Math.abs(d) / 3), true) });
  });
  J.ms.forEach((m, j) => {
    if (J.state[j] !== 0) return;
    let best = -1, bd = Infinity; g.forEach((q, k) => { const dd = Math.hypot(q[0] - m.e, q[1] - m.n); if (dd <= 2 * R && dd < bd && J.plantFound[k]) { bd = dd; best = k; } });
    if (best < 0) return;
    const fm = J.ms[J.plantOf[best]], d = Math.abs(AL(m.e, m.n) - AL(...g[best]));
    dup.push({ tile: t.id, kind: bd <= R ? "second" : "beside", plant: [Math.round(plants[best].x), Math.round(plants[best].y)], alongCm: Math.round(d * 1000) / 10, distanceCm: Math.round(bd * 1000) / 10, tier: m.tier,
      plantDot: dotInfo(fm.i!), extraDot: dotInfo(m.i!), twoMarksStricter: twoMarks(g[best], [m.e, m.n], Math.min(R, Math.max(d, 0.01) / 3), false), twoMarksAll: twoMarks(g[best], [m.e, m.n], Math.min(R, Math.max(d, 0.01) / 3), true) });
  });
}
const out = { image: NAME, fieldOptions: FOPT, plantSpacingM: seed, R, touchM: TOUCH_M, bandM: band, missedAll, touching, dup };
writeFileSync(arg("out"), JSON.stringify(out, null, 1));
console.log(`${NAME}: ${missedAll} plants missed; ${touching.length} touching pairs; ${dup.filter(d => d.kind === "second").length} second marks and ${dup.filter(d => d.kind === "beside").length} beside a marked plant`);
