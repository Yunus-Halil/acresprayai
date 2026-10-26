// Probe: are the held-out residuals tie noise (scatter inside a pair) or misalignment (a pair-wide offset)?
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AdjustModel, type SoilTie, evaluateTies } from "../../src/lib/directGeoref";
import { OUT, baseFrames, isHeldOut, loadCache, pairKind, quant, r3 } from "./common";

const cached = loadCache(), bases = baseFrames(cached), byName = new Map(bases.map(b => [b.frame.name, b]));
const { ties } = JSON.parse(readFileSync(join(OUT, "exp1", "ties.json"), "utf8")) as { ties: SoilTie[] };
const models = JSON.parse(readFileSync(join(OUT, "exp1", "models.json"), "utf8")) as { name: string; spec: AdjustModel["spec"]; origin: AdjustModel["origin"]; globals: AdjustModel["globals"]; photo: [string, Record<string, number>][]; terrain: null }[];
const pick = process.argv.includes("--loose") ? models[6] : models[1];
const m: AdjustModel = { spec: pick.spec, origin: pick.origin, globals: pick.globals, photo: new Map(pick.photo) as AdjustModel["photo"], terrain: null };
const test = ties.filter(t => isHeldOut(t));
const ev = evaluateTies(byName, m, test);
const pairs = new Map<string, number[]>();
test.forEach((t, i) => { if (Number.isFinite(ev.dist[i])) (pairs.get(`${t.a}|${t.b}`) ?? pairs.set(`${t.a}|${t.b}`, []).get(`${t.a}|${t.b}`)!).push(i); });
const rows: { kind: string; n: number; offset: number; scatter: number; peak: number }[] = [];
for (const [k, idx] of pairs) {
  if (idx.length < 3) continue;
  const [a, b] = k.split("|");
  const me = quant(idx.map(i => ev.vec[2 * i]), 0.5), mn = quant(idx.map(i => ev.vec[2 * i + 1]), 0.5);
  const scatter = quant(idx.map(i => Math.hypot(ev.vec[2 * i] - me, ev.vec[2 * i + 1] - mn)), 0.5);
  rows.push({ kind: pairKind(byName.get(a)!.frame, byName.get(b)!.frame), n: idx.length, offset: Math.hypot(me, mn), scatter, peak: quant(idx.map(i => test[i].peak), 0.5) });
}
console.log(`model: ${pick.name}`);
for (const kind of ["same", "opposite", "turn"]) {
  const r = rows.filter(x => x.kind === kind);
  console.log(kind.padEnd(9), `pairs ${r.length}`, `| pair offset median ${r3(quant(r.map(x => x.offset), 0.5))} p90 ${r3(quant(r.map(x => x.offset), 0.9))}`, `| scatter inside a pair median ${r3(quant(r.map(x => x.scatter), 0.5))}`);
}
// Residual against tie peak strength.
const bins = [[0, 0.2], [0.2, 0.3], [0.3, 0.5], [0.5, 1.1]];
for (const [lo, hi] of bins) { const d = test.map((t, i) => ({ t, d: ev.dist[i] })).filter(x => x.t.peak >= lo && x.t.peak < hi && Number.isFinite(x.d)).map(x => x.d); console.log(`peak ${lo}-${hi}: ${d.length} ties, residual median ${r3(quant(d, 0.5))}`); }
