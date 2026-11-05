// The in-browser twin build, measured: the dev preview's builder (/dev/field-twin?build=1) driven by Playwright
// with the installed Chrome over a folder of photographs; the stage timings and the twin's counts from
// window.__twinBuild. The weed tier is the colour rules (no service needed). --crop corn builds a Corn Field Twin
// (Corn V1 on every photograph in the helper workers). Peak memory: the benchmark's own Chrome (its process and every
// descendant: the page, its workers, the GPU and utility processes), sampled every 2 s from Windows, summed working
// sets; the user's own Chrome is not counted.
//
//   npx vite --port 8081   (in another terminal)
//   node scripts/directGeoref/twinBuildBench.mjs [--dir directtestimagery] [--base http://localhost:8081] [--weeds colour|none]
//       [--crop orchard|corn] [--name "..."] [--out <file>] [--limit N] [--helpers N]
//
// Writes data/direct-georef/twin/bench/build.json (or --out). Console errors in the page fail the run.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = resolve(arg("dir", "directtestimagery")), BASE = arg("base", "http://localhost:8081"), WEEDS = arg("weeds", "colour"), LIMIT = Number(arg("limit", "0")), HELPERS = arg("helpers", "");
const CROP = arg("crop", "orchard"), NAME = arg("name", "Apricot, browser build"), OUTFILE = arg("out", "");
const OUT = resolve("data/direct-georef/twin/bench");
mkdirSync(OUT, { recursive: true });
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
let files = readdirSync(DIR).filter(f => /\.jpe?g$/i.test(f)).sort().map(f => join(DIR, f));
if (LIMIT) files = files.slice(0, LIMIT);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// Memory: the working sets of the benchmark's Chrome processes (Playwright launches them on a temporary profile whose
// folder name marks every one of them), every 2 s.
const mem = { peakBytes: 0, peakRendererBytes: 0, samples: 0 };
const sampleMemory = () => new Promise(res => {
  execFile("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*playwright_chromiumdev_profile*' } | Select-Object ProcessId,WorkingSetSize | ConvertTo-Json -Compress"], { maxBuffer: 1 << 24 }, (err, out) => {
    if (!err && out && out.trim()) {
      try {
        const list = [].concat(JSON.parse(out));
        let sum = 0, maxOne = 0;
        for (const p of list) { sum += p.WorkingSetSize; maxOne = Math.max(maxOne, p.WorkingSetSize); }
        mem.peakBytes = Math.max(mem.peakBytes, sum); mem.peakRendererBytes = Math.max(mem.peakRendererBytes, maxOne); mem.samples++;
      } catch { /* a sample lost */ }
    }
    res();
  });
});
let sampling = true;
const sampler = (async () => { while (sampling) { await sampleMemory(); await new Promise(r => setTimeout(r, 2000)); } })();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
// The builder asks the local weed-model service for its health on open; without the service that request fails
// (HTTP 500 through the dev proxy). It is not part of a corn or colour build, so it is not counted as an error.
let healthFailed = 0;
page.on("response", r => { if (r.url().includes("/weed-vision-api/health") && r.status() >= 400) healthFailed++; });
page.on("console", m => { if (m.type() === "error" && !(healthFailed && /status of 500/.test(m.text()))) errors.push(m.text()); });
await page.goto(`${BASE}/dev/field-twin?build=1${HELPERS ? `&helpers=${HELPERS}` : ""}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Build a twin from photographs");
await page.setInputFiles('input[type="file"][multiple]', files);
await page.fill('input[placeholder="Apricot orchard, north block"]', NAME);
await page.check(`input[name="twin-crop"][value="${CROP}"]`);
if (CROP !== "corn") await page.check(`input[name="weed-tier"][value="${WEEDS}"]`);
const t0 = Date.now();
await page.click("text=Build the twin");
await page.waitForFunction(() => !!window.__twinBuild, null, { timeout: 1_800_000, polling: 1000 });
const twinMs = Date.now() - t0;
await page.waitForFunction(() => !!window.__twinBuild && (window.__twinBuild.atlasesDone || !!window.__twinBuild.error), null, { timeout: 1_800_000, polling: 1000 });
const totalMs = Date.now() - t0;
const result = await page.evaluate(() => window.__twinBuild);
sampling = false; await sampler;
const out = { decoder: "Chrome createImageBitmap + OffscreenCanvas getImageData (the app's own decode)", environment: `Chrome ${browser.version()} headless (Playwright), ${process.platform}-${process.arch}`, base: BASE, crop: CROP, photographs: files.length, weeds: CROP === "corn" ? "corn v1" : WEEDS, peakMemoryGB: +(mem.peakBytes / 1e9).toFixed(2), peakOneProcessGB: +(mem.peakRendererBytes / 1e9).toFixed(2), memorySamples: mem.samples, corn: result.report?.corn ? { ...result.report.corn, summary: result.report.corn.summary } : null, helpers: HELPERS || "default", twinReadyMs: twinMs, atlasesDoneMs: totalMs, timings: result.report?.timings ?? null, notes: result.report?.notes ?? null, cameras: result.report?.cameras ? { ties: result.report.cameras.ties, residualM: result.report.cameras.residualM, fineResM: result.report.cameras.fineResM } : null, twin: result.twin, error: result.error ?? null, consoleErrors: errors };
writeFileSync(OUTFILE ? resolve(OUTFILE) : join(OUT, "build.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
if (errors.length || result.error) process.exit(1);
