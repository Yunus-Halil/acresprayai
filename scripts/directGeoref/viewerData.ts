// The experiments, packed for the viewer (data/direct-georef/apricot/exp.js) and the viewer page copied beside it.
//
//   npx vite-node scripts/directGeoref/viewerData.ts
//
// Camera models to switch between (each photograph's four corners under that model), the held-out soil ties with
// their residuals under three of them, the simulated cheap-GPS flights before and after adjustment, and
// experiment 3's crowns, reconciled trees and field rows.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AdjustModel, type BaseFrame, type ModelSpec, type PhotoKey, type SoilTie, cloneModel, evaluateTies, frameCorners, frameUnder } from "../../src/lib/directGeoref";
import { OUT, baseFrames, isHeldOut, loadCache, r3 } from "./common";

const cached = loadCache();
const bases = baseFrames(cached);
type Saved = { name: string; spec: ModelSpec; origin: AdjustModel["origin"]; globals: AdjustModel["globals"]; photo: [string, Record<PhotoKey, number>][] };
const toModel = (s: Pick<Saved, "spec" | "origin" | "globals" | "photo">): AdjustModel => ({ spec: s.spec, origin: s.origin, globals: s.globals, photo: new Map(s.photo), terrain: null });
const saved = JSON.parse(readFileSync(join(OUT, "exp1", "models.json"), "utf8")) as Saved[];
const get = (n: string) => toModel(saved.find(m => m.name === n)!);
const header = get("header only"), g4 = get("global 4 (tilts, spin, ground)"), best = get("global + per-photo attitude 1 deg");

const cornersOf = (bs: BaseFrame[], m: AdjustModel) => Object.fromEntries(bs.map(b => [b.frame.name, frameCorners(frameUnder(b, m))!.map(g => [+g.lat.toFixed(8), +g.lng.toFixed(8)])]));
const models: { key: string; label: string; corners: Record<string, number[][]> }[] = [
  { key: "header", label: "Header only", corners: cornersOf(bases, header) },
  { key: "global", label: "Soil ties: 4 global numbers", corners: cornersOf(bases, g4) },
  { key: "best", label: "Soil ties: + per-photo attitude (best)", corners: cornersOf(bases, best) },
];

// Simulated cheap GPS (experiment 2), when its models were saved.
for (const id of ["S2", "S4"]) {
  const p = join(OUT, "exp2", `model-${id}.json`);
  if (!existsSync(p)) continue;
  const s = JSON.parse(readFileSync(p, "utf8")) as { id: string; label: string; noise: [string, number, number, number][]; model: Pick<Saved, "spec" | "origin" | "globals" | "photo"> };
  const noise = new Map(s.noise.map(([nm, e, n, h]) => [nm, [e, n, h]]));
  const nb = bases.map(b => { const [e, n, h] = noise.get(b.frame.name) ?? [0, 0, 0]; const f = b.frame, lat0 = (f.pose.lat * Math.PI) / 180; return { ...b, frame: { ...f, pose: { ...f.pose, lat: f.pose.lat + (n / 6378137) * (180 / Math.PI), lng: f.pose.lng + (e / (6378137 * Math.cos(lat0))) * (180 / Math.PI), altM: f.pose.altM + h } } }; });
  models.push({ key: `${id}-before`, label: `Cheap GPS, ${s.label}: before`, corners: cornersOf(nb, cloneModel(best, { name: "global only", globals: best.spec.globals })) });
  models.push({ key: `${id}-after`, label: `Cheap GPS, ${s.label}: after adjustment`, corners: cornersOf(nb, toModel(s.model)) });
}

// Held-out soil ties and their residuals.
const ties = (JSON.parse(readFileSync(join(OUT, "exp1", "ties.json"), "utf8")).ties as SoilTie[]).filter(isHeldOut);
const byName = new Map(bases.map(b => [b.frame.name, b]));
const residuals: Record<string, number[][]> = {};
for (const [k, m] of [["header", header], ["global", g4], ["best", best]] as const) {
  const ev = evaluateTies(byName, m, ties);
  residuals[k] = ties.map((t, i) => [+t.lat.toFixed(8), +t.lng.toFixed(8), r3(ev.vec[2 * i]), r3(ev.vec[2 * i + 1])]).filter(x => Number.isFinite(x[2]));
}

const exp = {
  models: models.map(m => ({ key: m.key, label: m.label, corners: m.corners })),
  residuals,
  exp1: existsSync(join(OUT, "exp1", "results.json")) ? JSON.parse(readFileSync(join(OUT, "exp1", "results.json"), "utf8")).rows : null,
  exp2: existsSync(join(OUT, "exp2", "results.json")) ? JSON.parse(readFileSync(join(OUT, "exp2", "results.json"), "utf8")) : null,
  exp3: existsSync(join(OUT, "exp3", "view.json")) ? { ...JSON.parse(readFileSync(join(OUT, "exp3", "view.json"), "utf8")), results: JSON.parse(readFileSync(join(OUT, "exp3", "results.json"), "utf8")) } : null,
};
writeFileSync(join(OUT, "exp.js"), `window.EXP = ${JSON.stringify(exp)};`);
writeFileSync(join(OUT, "index.html"), readFileSync(join(__dirname, "viewer.html"), "utf8"));
console.log(`written ${join(OUT, "exp.js")} (${models.length} camera models, ${ties.length} held-out ties)`);
