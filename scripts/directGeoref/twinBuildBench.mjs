// The in-browser twin build, measured: the dev preview's builder (/dev/field-twin?build=1) driven by Playwright
// with the installed Chrome over a folder of photographs; the stage timings and the twin's counts from
// window.__twinBuild. The weed tier is the colour rules (no service needed).
//
//   npx vite --port 8081   (in another terminal)
//   node scripts/directGeoref/twinBuildBench.mjs [--dir directtestimagery] [--base http://localhost:8081] [--weeds colour|none] [--limit N]
//
// Writes data/direct-georef/twin/bench/build.json. Console errors in the page fail the run.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = resolve(arg("dir", "directtestimagery")), BASE = arg("base", "http://localhost:8081"), WEEDS = arg("weeds", "colour"), LIMIT = Number(arg("limit", "0")), HELPERS = arg("helpers", "");
const OUT = resolve("data/direct-georef/twin/bench");
mkdirSync(OUT, { recursive: true });
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
let files = readdirSync(DIR).filter(f => /\.jpe?g$/i.test(f)).sort().map(f => join(DIR, f));
if (LIMIT) files = files.slice(0, LIMIT);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`${BASE}/dev/field-twin?build=1${HELPERS ? `&helpers=${HELPERS}` : ""}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Build a twin from photographs");
await page.setInputFiles('input[type="file"][multiple]', files);
await page.fill('input[placeholder="Apricot orchard, north block"]', "Apricot, browser build");
await page.check(`input[name="weed-tier"][value="${WEEDS}"]`);
const t0 = Date.now();
await page.click("text=Build the twin");
await page.waitForFunction(() => !!window.__twinBuild, null, { timeout: 1_800_000, polling: 1000 });
const twinMs = Date.now() - t0;
await page.waitForFunction(() => !!window.__twinBuild && (window.__twinBuild.atlasesDone || !!window.__twinBuild.error), null, { timeout: 1_800_000, polling: 1000 });
const totalMs = Date.now() - t0;
const result = await page.evaluate(() => window.__twinBuild);
const out = { base: BASE, photographs: files.length, weeds: WEEDS, helpers: HELPERS || "default", twinReadyMs: twinMs, atlasesDoneMs: totalMs, timings: result.report?.timings ?? null, notes: result.report?.notes ?? null, cameras: result.report?.cameras ? { ties: result.report.cameras.ties, residualM: result.report.cameras.residualM, fineResM: result.report.cameras.fineResM } : null, twin: result.twin, error: result.error ?? null, consoleErrors: errors };
writeFileSync(join(OUT, "build.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
if (errors.length || result.error) process.exit(1);
