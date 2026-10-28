// Open-a-twin benchmark: from the bundle's bytes to the first drawn map, phase by phase, in the real browser.
//
//   node scripts/directGeoref/twinOpenBench.mjs [--base http://localhost:8081] [--id apricot-2021-04-27] [--runs 3]
//
// The page records performance marks (FieldTwinDevPreview, FieldTwinView, TwinCanvasLayer): twin:fetch (bytes
// over the wire; local here, so a lower bound), twin:json (JSON.parse), twin:parse (parseTwin's checks),
// twin:intelligence (block, cells, zones, clusters), twin:scene (projection, packing, indexes), twin:heatmap
// (rasters), twin:first-draw (the first frame). Medians over the runs; writes data/direct-georef/twin/bench/open.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:8081"), ID = arg("id", "apricot-2021-04-27"), RUNS = Number(arg("runs", "3"));
const OUT = resolve("data/direct-georef/twin/bench");
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--disable-gpu-vsync"] });
const runs = [];
for (let r = 0; r < RUNS; r++) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const t0 = Date.now();
  await page.goto(`${BASE}/dev/field-twin?id=${ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__fieldTwin?.ready === true && performance.getEntriesByName("twin:first-draw").length > 0, null, { timeout: 120000 });
  const total = Date.now() - t0;
  const m = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType("measure").filter(e => e.name.startsWith("twin:")).map(e => [e.name, +e.duration.toFixed(1)])));
  const bytes = await page.evaluate(() => performance.getEntriesByType("resource").filter(e => e.name.includes("twin.json")).map(e => e.transferSize || e.encodedBodySize)[0] ?? null);
  runs.push({ totalMs: total, bytes, ...m });
  console.log(JSON.stringify(runs[runs.length - 1]));
  await page.close();
}
const keys = [...new Set(runs.flatMap(r => Object.keys(r)))];
const median = k => { const v = runs.map(r => r[k]).filter(x => typeof x === "number").sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };
const summary = Object.fromEntries(keys.map(k => [k, median(k)]));
writeFileSync(join(OUT, "open.json"), JSON.stringify({ id: ID, runs, median: summary }, null, 1));
console.log("median", JSON.stringify(summary));
await browser.close();
