// Development only: the scoreboard's results (cornScoreboard.ts) as one table a flight, the variants side by side.
//   npx vite-node scripts/rowCrop/cornScoreboardTable.ts -- --dir <scoreboard out> --flights a,b --variants base,loose [--names "f23efc0,loosened"]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); if (i < 0) { if (d == null) throw new Error(`--${k} is required`); return d; } return argv[i + 1]; };
const DIR = arg("dir"), flights = arg("flights").split(","), variants = arg("variants").split(","), names = arg("names", variants.join(",")).split(",");
/* eslint-disable @typescript-eslint/no-explicit-any */
const TIERS = ["certain", "probable", "second look, 2+ photographs", "second look, 1 photograph", "loosened"];
const n = (x: unknown) => (x == null ? "-" : typeof x === "number" ? (Number.isInteger(x) ? x.toLocaleString("en-US") : x.toLocaleString("en-US", { maximumFractionDigits: 1 })) : String(x));
const pct = (a: number, b: number) => (b > 0 ? `${((100 * a) / b).toFixed(1)} %` : "-");
const sumObj = (o: Record<string, number>) => Object.values(o).reduce((t, x) => t + x, 0);

for (const flight of flights) {
  const R: any[] = variants.map(v => { const f = join(DIR, `${flight}.${v}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; });
  const lines: [string, (r: any) => string][] = [
    ["Photographs (with second-look candidates)", r => `${r.photographs} (${r.photographsWithCandidates})`],
    ["Row spacing / plant spacing, m", r => `${r.geometry.rowSpacingM} / ${r.geometry.plantSpacingM ?? "not measured"}`],
    ["**Plants on rows**", r => `**${n(r.onRowsTotal)}**`],
    ...TIERS.map((t): [string, (r: any) => string] => [`- ${t}`, r => n(r.onRows[t])]),
    ["- of the probable: on a row found in a free slot", r => n(r.probableOnSlotRows)],
    ["Rows", r => n(r.rows)],
    ["Row length with plants seen, m", r => n(r.rowM.plantsSeen)],
    ["Row length not confirmed, m", r => n(r.rowM.notConfirmed)],
    ["Dots on no row", r => n(r.onNoRow)],
    ["Dots between rows", r => n(r.betweenRows)],
    ["**From mid-alley ground, the rules put on rows** (expected not the crop)", () => ""],
    ...TIERS.slice(1).map((t): [string, (r: any) => string] => [`- ${t}`, r => `${n(r.fromAlley[t].mean)} (${pct(r.fromAlley[t].mean, r.onRows[t])} of the tier)`]),
    ["- of the probable: on a row found in a free slot", r => n(r.fromAlley.probableOnSlotRows.mean)],
    ["**Dots in the rows' bands / in an equal mid-alley strip**", () => ""],
    ...[0, 1, 2, 3, 4].map((k): [string, (r: any) => string] => [`- ${["certain on its own evidence", "2+ photographs, not certain", "second look, 2+ photographs", "second look, 1 photograph, frame middle", "second look, 1 photograph, anywhere"][k]}`, r => { const c = r.classes[k]; return c.dots ? `${n(c.inBands)} / ${n(c.perAlleyStrip)} (${pct(c.perAlleyStrip, c.inBands)})` : "-"; }]),
    ["Stretches of row whose band beats the alley (all dots)", r => `${n(r.stretches.bandBeatsAlleyAllDots)} of ${n(r.stretches.all)}`],
    ["**Ground judged scattered**: plants on rows there", r => (r.planting.judged ? n(sumObj(r.ground.onRowsOnScattered)) : "ground not judged")],
    ["- row length there, plants seen / not confirmed, m", r => (r.planting.judged ? `${n(r.ground.rowMPlantsSeen.scattered)} / ${n(r.ground.rowMNotConfirmed.scattered)}` : "-")],
    ["Ground judged unknown: plants on rows there", r => (r.planting.judged ? n(sumObj(r.ground.onRowsOnUnknown)) : "-")],
    ["**Alternate photographs**: plants on rows one half has, the other lacks where it looked", () => ""],
    ...TIERS.map((t): [string, (r: any) => string] => [`- ${t}`, r => { const h = r.halves; if (!h || h.failed) return "-"; const c = h.even.whereTheOtherLooked[t] + h.odd.whereTheOtherLooked[t], l = h.even.ofThoseTheOtherLacks[t] + h.odd.ofThoseTheOtherLacks[t]; return c ? `${n(l)} of ${n(c)} (${pct(l, c)})` : "-"; }]),
  ];
  console.log(`\n### ${flight}\n`);
  console.log(`| | ${names.join(" | ")} |`);
  console.log(`|---|${names.map(() => "---:").join("|")}|`);
  for (const [label, fn] of lines) console.log(`| ${label} | ${R.map(r => (r && !r.failed ? fn(r) : "not run")).join(" | ")} |`);
}
