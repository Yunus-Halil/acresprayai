// Are two builds' results the same? Compares two --outputs folders of twinBuildProfile.mjs: the twin (cameras' footprints,
// rows, plants' rows, gaps, weeds, evidence links: everything in twin.json), the analysis record (the aligned cameras and
// the per-photograph corn reads), every file's SHA-256 (plants.json, the atlases, the photo ground's overview), and the
// camera report. Only the build's own clock is left out (builtAt, and the report's timings).
//
//   node scripts/directGeoref/outputsDiff.mjs <dirA> <dirB> [--max 20]
// Exit code 0 when identical, 1 when not; the first differences are printed by their path in the JSON.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [A, B] = process.argv.slice(2).filter(a => !a.startsWith("--"));
const MAX = Number(process.argv[process.argv.indexOf("--max") + 1] || 20);
const CLOCK = new Set(["builtAt", "timings", "totalMs", "elapsedMs", "ms", "msPerPhoto", "sampledMs", "classifyMs"]);
const load = (d, f) => (existsSync(join(d, f)) ? JSON.parse(readFileSync(join(d, f), "utf8")) : null);

const diffs = [];
function walk(a, b, path) {
  if (diffs.length >= MAX * 50) return;
  if (a === b) return;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return;
    diffs.push({ path, a, b }); return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { diffs.push({ path, a: "array?", b: "array?" }); return; }
  if (Array.isArray(a)) {
    if (a.length !== b.length) diffs.push({ path: `${path}.length`, a: a.length, b: b.length });
    for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], `${path}[${i}]`);
    return;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (CLOCK.has(k)) continue;
    walk(a[k], b[k], path ? `${path}.${k}` : k);
  }
}

const parts = {};
for (const f of ["twin.json", "analysis.json", "report.json", "files.json"]) {
  const a = load(A, f), b = load(B, f);
  const before = diffs.length;
  if (a == null && b == null) { parts[f] = "absent in both"; continue; }
  walk(a, b, f.replace(/\.json$/, ""));
  parts[f] = diffs.length === before ? "identical" : `${diffs.length - before} differences`;
}
console.log(JSON.stringify(parts, null, 1));
for (const d of diffs.slice(0, MAX)) console.log(`  ${d.path}: ${JSON.stringify(d.a)?.slice(0, 120)} vs ${JSON.stringify(d.b)?.slice(0, 120)}`);
process.exit(diffs.length ? 1 : 0);
