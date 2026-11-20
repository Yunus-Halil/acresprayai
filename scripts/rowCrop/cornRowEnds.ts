// Development only (2026-11-20, nothing in the app changes): rows drawn past the ends of the planting. For a saved
// build: every row the plants made, with how it was made, how long and how full it is, what the field's ground
// judgement says under it, and how far it stands from the rows beside it; the rows near a given place in full; and
// over the flight, how many counted plants stand on rows that look like this.
//
//   npx vite-node scripts/rowCrop/cornRowEnds.ts -- --analysis <analysis.json> [--lat .. --lng .. --within 12] [--out <dir>]
import "../bench/nodeStorageShim";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { cornCombine } from "../../src/lib/fieldTwin/build/corn";
import { SETTLED } from "../../src/lib/fieldTwin/plantsFirst";
import { fromEnu, toEnu } from "../../src/lib/sourceFrames/odm";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const A = JSON.parse(readFileSync(opt("analysis")!, "utf8")) as TwinAnalysis, frames = framesFromAnalysis(A);
const C = cornCombine(A.reads as never, frames, "final3"), P = C.placed!, R = C.rows!, F = C.field, G = C.ground;
const S = R.geometry.spacingM, seed = R.geometry.seedM ?? 0.14, name = Object.fromEntries(Object.entries(SETTLED).map(([k, v]) => [v, k]));
console.log(`rows ${R.rows.length}; row spacing ${S.toFixed(3)} m, plant spacing ${seed.toFixed(3)} m; plants a metre on the certain rows (median) ${R.geometry.perMMedian?.toFixed(2)}`);
console.log(`row keys: ${Object.keys(R.rows[0]).join(", ")}`);
const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
// Per row: its plants' ground states, the makers of its plants, the nearest other row beside its middle.
type Row = (typeof R.rows)[number];
const ground = (i: number) => (G ? G.state(P.all[i].e, P.all[i].n) : 0);
const rowsInfo = R.rows.map((r: Row, k: number) => {
  const d = r.dots as number[], a = d.map(i => R.a[i]), c = d.map(i => R.c[i]);
  const len = Math.max(...a) - Math.min(...a), mid = (Math.max(...a) + Math.min(...a)) / 2, cMid = med(c);
  const gs = [0, 0, 0]; for (const i of d) gs[ground(i)]++;
  const makers: Record<string, number> = {}; for (const i of d) { const m = name[R.settled[i]] ?? "?"; makers[m] = (makers[m] ?? 0) + 1; }
  const strict = d.filter(i => i < P.strict).length, certain = d.filter(i => R.certainty[i] === 0).length;
  // Rows beside it at its middle: how many of the two neighbouring slots (one row spacing either side) hold a row there.
  let beside = 0;
  for (const side of [-1, 1]) if (R.rows.some((o: Row, j: number) => { if (j === k) return false; const od = o.dots as number[], oa = od.map(i => R.a[i]); if (mid < Math.min(...oa) || mid > Math.max(...oa)) return false; const oc = med(od.map(i => R.c[i])); return Math.abs(oc - (cMid + side * S)) < 0.35 * S; })) beside++;
  const g = fromEnu([P.all[d[d.length >> 1]].e, P.all[d[d.length >> 1]].n, 0], F.origin);
  return { k, id: (r as { id?: number }).id ?? k, kind: (r as { kind?: string }).kind ?? "?", n: d.length, strict, certain, len, perM: d.length / Math.max(0.1, len), gs, makers, beside, lat: g.lat, lng: g.lng, a0: Math.min(...a), a1: Math.max(...a), cMid };
});
const lines: string[] = [];
const show = (r: (typeof rowsInfo)[number]) => `row ${String(r.id).padStart(3)} ${r.kind.padEnd(8)} ${String(r.n).padStart(4)} plants (${r.strict} stricter, ${r.certain} certain) over ${r.len.toFixed(1).padStart(6)} m, ${r.perM.toFixed(1)} a metre; ground under its plants unknown/planted/scattered ${r.gs.join("/")}; rows beside it ${r.beside} of 2; made by ${JSON.stringify(r.makers)}; middle ${r.lat.toFixed(7)}, ${r.lng.toFixed(7)}`;
if (opt("lat")) {
  const lat = Number(opt("lat")), lng = Number(opt("lng")), within = Number(opt("within") ?? 12), [e0, n0] = toEnu({ lat, lng, altM: 0 }, F.origin);
  lines.push(`## Rows with a plant within ${within} m of ${lat}, ${lng}`, "");
  for (const r of rowsInfo) { const d = R.rows[r.k].dots as number[]; if (d.some(i => Math.hypot(P.all[i].e - e0, P.all[i].n - n0) <= within)) lines.push(show(r)); }
  // The dots there on no row: what settled them.
  const off: Record<string, number> = {}; for (let i = 0; i < P.strict; i++) if (R.rowOf[i] < 0 && Math.hypot(P.all[i].e - e0, P.all[i].n - n0) <= within) { const m = `${name[R.settled[i]]} (ground ${ground(i)})`; off[m] = (off[m] ?? 0) + 1; }
  lines.push("", `Dots of the stricter marks on no row there: ${JSON.stringify(off)}`, "");
}
// Over the flight: short rows, and rows over ground the field does not call planted.
lines.push("## Every row, shortest first (the 25 shortest)", "");
for (const r of [...rowsInfo].sort((a, b) => a.len - b.len).slice(0, 25)) lines.push(show(r));
const all = rowsInfo.reduce((t, r) => t + r.n, 0);
lines.push("", `## Counted plants by what stands under them (${all} on rows)`, "");
const byG = [0, 0, 0]; for (const r of rowsInfo) r.gs.forEach((v, i) => (byG[i] += v));
lines.push(`ground unknown ${byG[0]}, planted ${byG[1]}, scattered ${byG[2]}`);
for (const cut of [3, 5, 8, 12]) { const rs = rowsInfo.filter(r => r.len < cut); lines.push(`rows under ${cut} m long: ${rs.length} rows, ${rs.reduce((t, r) => t + r.n, 0)} plants; of them with no row beside them ${rs.filter(r => r.beside === 0).length} rows, ${rs.filter(r => r.beside === 0).reduce((t, r) => t + r.n, 0)} plants`); }
console.log(lines.join("\n"));
if (opt("out")) { mkdirSync(opt("out")!, { recursive: true }); writeFileSync(join(opt("out")!, "ROWS.md"), lines.join("\n") + "\n"); writeFileSync(join(opt("out")!, "rows.json"), JSON.stringify(rowsInfo)); }

// ---------------------------------------------------------------- the long rows' ends against their neighbours'
{
  const long = rowsInfo.filter(r => r.len > 0.5 * med(rowsInfo.map(x => x.len))).sort((a, b) => a.cMid - b.cMid);
  const out: string[] = ["", "## Long rows: each end against the ends of the three rows either side of it", ""];
  let tailPlants = 0, tailRows = 0, tailUnknown = 0;
  long.forEach((r, k) => {
    const nb = long.filter((_, j) => j !== k && Math.abs(j - k) <= 3), m0 = med(nb.map(x => x.a0)), m1 = med(nb.map(x => x.a1));
    const d = R.rows[r.k].dots as number[], before = d.filter(i => R.a[i] < m0 - 1), after = d.filter(i => R.a[i] > m1 + 1);
    for (const [label, part, over] of [["start", before, m0 - r.a0], ["end", after, r.a1 - m1]] as [string, number[], number][]) {
      if (over <= 1 || !part.length) continue;
      const gs = [0, 0, 0]; for (const i of part) gs[ground(i)]++;
      const g = fromEnu([P.all[part[0]].e, P.all[part[0]].n, 0], F.origin);
      tailPlants += part.length; tailRows++; tailUnknown += gs[0] + gs[2];
      out.push(`row ${String(r.id).padStart(3)} runs ${over.toFixed(1)} m past its neighbours at its ${label}: ${part.length} plants there (${(part.length / over).toFixed(1)} a metre against ${r.perM.toFixed(1)} over the row), ground unknown/planted/scattered ${gs.join("/")}, about ${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}`);
    }
  });
  out.push("", `Row ends over 1 m past their neighbours': ${tailRows}, holding ${tailPlants} plants (${tailUnknown} of them on ground not judged planted).`);
  console.log(out.join("\n"));
  if (opt("out")) writeFileSync(join(opt("out")!, "ROW-ENDS.md"), out.join("\n") + "\n");
}
