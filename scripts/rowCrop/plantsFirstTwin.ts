// Development only: a copy of a corn twin on this computer with its rows replaced by the plants-first rows
// (scripts/rowCrop/plantsFirstBench.ts, rows.json), for a look in the dev preview beside the original. Stretches of row
// where plants were seen are corn rows (cyan); stretches where the row probably continues but no plant was seen are
// "not confirmed" (amber dashes), with that reason. The original twin is not touched.
//   npx vite-node scripts/rowCrop/plantsFirstTwin.ts -- --from <twin dir> --bench <bench out> --to <new twin dir> --id <new id>
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); if (i < 0) throw new Error(`--${k} is required`); return argv[i + 1]; };
const FROM = arg("from"), TO = arg("to"), ID = arg("id"), B = arg("bench");
mkdirSync(TO, { recursive: true });
const twin = JSON.parse(readFileSync(join(FROM, "twin.json"), "utf8"));
const R = JSON.parse(readFileSync(join(B, "rows.json"), "utf8")) as { rows: { id: number; kind: string; perM: number; plants: number; certain: number; segments: { confirmed: boolean; line: [number, number][] }[] }[] };
const hav = (a: [number, number], b: [number, number]) => { const k = Math.PI / 180, dLat = (b[0] - a[0]) * k, dLng = (b[1] - a[1]) * k, x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * k) * Math.cos(b[0] * k) * Math.sin(dLng / 2) ** 2; return 2 * 6371008.8 * Math.asin(Math.sqrt(x)); };
const rows: unknown[] = [];
for (const r of R.rows) for (const g of r.segments) {
  if (g.line.length < 2) continue;
  const lengthM = g.line.slice(1).reduce((t, p, i) => t + hav(g.line[i], p), 0);
  if (lengthM < 0.3) continue;
  rows.push({ id: rows.length + 1, status: g.confirmed ? "corn" : "unconfirmed", line: g.line, lengthM: Math.round(lengthM * 100) / 100, seenBy: 0, cornBy: 0, coveredBy: 0,
    why: g.confirmed ? `Plants seen along it (row ${r.id}: ${r.plants} plants, ${r.certain} certain, ${r.perM.toFixed(1)} a metre${r.kind === "geometry" ? "; found on the second look, in a slot the certain rows leave" : ""}).` : `The row probably continues here (row ${r.id}), but no plant was confirmed on this stretch.` });
}
const corn = twin.corn;
corn.rows = rows; corn.gaps = [];
corn.summary.cornRows = rows.filter((r: any) => r.status === "corn").length;
corn.summary.unconfirmedRows = rows.length - corn.summary.cornRows;
corn.summary.cornRowLengthM = Math.round(rows.filter((r: any) => r.status === "corn").reduce((t: number, r: any) => t + r.lengthM, 0) * 10) / 10;
corn.summary.gaps = { confirmed: 0, withheld: 0, confirmedLengthM: 0 };
corn.notes = [...(corn.notes ?? []), "Development: rows from the plants first (certain plants, their rows, the field's geometry, then a second look at the uncertain). Not a build output."];
twin.id = ID; twin.name = `${twin.name} (plants first)`;
writeFileSync(join(TO, "twin.json"), JSON.stringify(twin));
for (const f of ["reference.json", "analysis.json", ...twin.atlases.map((a: { file: string }) => a.file)]) if (existsSync(join(FROM, f))) copyFileSync(join(FROM, f), join(TO, f));
copyFileSync(join(B, "plants.json"), join(TO, "plants.json"));
console.log(`${rows.length} row stretches (${corn.summary.cornRows} with plants seen) -> ${TO}`);
