// The in-browser twin build, profiled: the same drive as twinBuildBench.mjs (the dev preview's builder over a folder of
// photographs, the installed Chrome, headless), plus
//   - a memory timeline: every second, the working set of each of the benchmark's Chrome processes by kind (the page's
//     renderer, which holds the build worker and its helpers; the GPU process; the browser; utilities), with the stage
//     the build had reached (window.__twinStages, set by the builder in a development build);
//   - with --heaps: every 2 s, each worker's V8 heap and ArrayBuffer memory (Runtime.getHeapUsage over the DevTools
//     protocol), to tell the build worker from its helpers;
//   - with --trace <file>: a Chrome trace of the V8 sampling profiler on every thread (the page, the build worker, each
//     helper), for profileSummary.mjs.
// Nothing in the build changes; the trace slows it, so a traced run's times are not the benchmark's.
//
//   npx vite --port 8081   (in another terminal)
//   node scripts/directGeoref/twinBuildProfile.mjs --dir <photos> --crop corn [--base http://localhost:8081]
//       [--helpers N] [--device mobile|memory4|memory2] [--trace <file.json>] [--outputs <dir>] --out <profile.json>
//
// --outputs <dir>: the build's results, for an equivalence check between two builds (outputsDiff.mjs): twin.json,
// the analysis record (the aligned cameras; the build is asked for one), every file's SHA-256 (plants, atlases, the
// photo ground's overview when the flag is on). Written to <dir> on this computer only.
// --shot <file.png>: a screenshot of the built twin in the viewer, and what it drew.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = resolve(arg("dir", "directtestimagery")), BASE = arg("base", "http://localhost:8081"), HELPERS = arg("helpers", "");
const SHOT = arg("shot", ""), HEAPS = argv.includes("--heaps"), CROP = arg("crop", "corn"), TRACE = arg("trace", ""), OUTFILE = resolve(arg("out", "profile.json")), OUTPUTS = arg("outputs", ""), DEVICE = arg("device", "");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const files = readdirSync(DIR).filter(f => /\.jpe?g$/i.test(f)).sort().map(f => join(DIR, f));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const kindOf = cmd => { const m = /--type=([a-z-]+)/.exec(cmd ?? ""); return m ? (m[1] === "gpu-process" ? "gpu" : m[1]) : "browser"; };
const timeline = [];
let t0 = 0;
const sample = () => new Promise(res => {
  execFile("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*playwright_chromiumdev_profile*' } | Select-Object ProcessId,WorkingSetSize,PrivatePageCount,CommandLine | ConvertTo-Json -Compress"], { maxBuffer: 1 << 26 }, (err, out) => {
    if (!err && out && out.trim()) {
      try {
        const byKind = {}, privByKind = {};
        let maxOne = 0;
        for (const p of [].concat(JSON.parse(out))) {
          const k = kindOf(p.CommandLine);
          byKind[k] = (byKind[k] ?? 0) + p.WorkingSetSize; privByKind[k] = (privByKind[k] ?? 0) + p.PrivatePageCount;
          maxOne = Math.max(maxOne, p.WorkingSetSize);
        }
        timeline.push({ t: t0 ? Date.now() - t0 : null, ws: byKind, priv: privByKind, maxOne });
      } catch { /* a sample lost */ }
    }
    res();
  });
});
// Worker heaps: attach to every worker target (non-flat sessions, messages through Target.sendMessageToTarget).
const heaps = [];
let cdp = null, msgId = 0;
const pending = new Map(), workers = new Map();
if (HEAPS) {
  cdp = await browser.newBrowserCDPSession();
  cdp.on("Target.receivedMessageFromTarget", ev => { const m = JSON.parse(ev.message); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? null); pending.delete(m.id); } });
  cdp.on("Target.detachedFromTarget", ev => { for (const [k, w] of workers) if (w.sessionId === ev.sessionId) workers.delete(k); });
}
const toTarget = (sessionId, method, params = {}) => new Promise(res => { const id = ++msgId; pending.set(id, res); cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch(() => { pending.delete(id); res(null); }); setTimeout(() => { if (pending.has(id)) { pending.delete(id); res(null); } }, 1500); });
const sampleHeaps = async () => {
  const { targetInfos } = await cdp.send("Target.getTargets");
  for (const t of targetInfos) if (t.type === "worker" && !workers.has(t.targetId)) { try { const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: false }); workers.set(t.targetId, { sessionId, url: t.url }); } catch { /* gone */ } }
  const row = { t: t0 ? Date.now() - t0 : null, workers: [] };
  for (const [id, w] of workers) { const u = await toTarget(w.sessionId, "Runtime.getHeapUsage"); if (u) row.workers.push({ id: id.slice(0, 8), kind: /helper/.test(w.url) ? "helper" : /worker\.ts/.test(w.url) ? "build" : w.url.replace(/^.*\//, "").replace(/\?.*$/, ""), usedMB: Math.round(u.usedSize / 1e6), backingMB: Math.round((u.backingStorageSize ?? 0) / 1e6) }); }
  heaps.push(row);
};
let heapSampling = HEAPS;
const heapSampler = (async () => { while (heapSampling) { if (t0) await sampleHeaps().catch(() => undefined); await new Promise(r => setTimeout(r, 2000)); } })();
let sampling = true;
const sampler = (async () => { while (sampling) { await sample(); await new Promise(r => setTimeout(r, 1000)); } })();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error" && !/status of 500/.test(m.text())) errors.push(m.text()); });
await page.goto(`${BASE}/dev/field-twin?build=1${HELPERS ? `&helpers=${HELPERS}` : ""}${OUTPUTS && CROP === "corn" ? "&analysis=1" : ""}${DEVICE ? `&device=${DEVICE}` : ""}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Build a twin from photographs", { timeout: 180_000 });
await page.setInputFiles('input[type="file"][multiple]', files);
await page.check(`input[name="twin-crop"][value="${CROP}"]`);
if (TRACE) await browser.startTracing(page, { path: resolve(TRACE), categories: ["disabled-by-default-v8.cpu_profiler", "v8.execute"] });
t0 = Date.now();
await page.click("text=Build the twin");
await page.waitForFunction(() => !!window.__twinBuild, null, { timeout: 3_600_000, polling: 1000 });
const twinMs = Date.now() - t0;
await page.waitForFunction(() => !!window.__twinBuild && (window.__twinBuild.atlasesDone || !!window.__twinBuild.error), null, { timeout: 3_600_000, polling: 1000 });
const atlasesMs = Date.now() - t0;
await page.waitForFunction(() => window.__twinGround !== undefined, null, { timeout: 120_000, polling: 500 }).catch(() => undefined);
const groundAt = await page.evaluate(() => window.__twinGround?.at ?? null);
if (TRACE) await browser.stopTracing();
const stages = await page.evaluate(t => Object.fromEntries(Object.entries(window.__twinStages ?? {}).map(([k, v]) => [k, v - t])), t0);
const result = await page.evaluate(() => window.__twinBuild);
const hc = await page.evaluate(() => navigator.hardwareConcurrency);
let outputs = null;
if (OUTPUTS) {
  const got = await page.evaluate(async () => {
    const hex = async b => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await b.arrayBuffer()))].map(x => x.toString(16).padStart(2, "0")).join("");
    const out = window.__twinOut;
    if (!out) return null;
    const files = {};
    for (const [k, v] of out.files) files[k] = await hex(v);
    const g = await out.ground;
    const ground = {};
    if (g) for (const [k, v] of g.files) ground[k] = await hex(v);
    const manifest = g?.files.get("ground/ground.json");
    return { twin: JSON.stringify(out.twin), analysis: out.analysis ? await out.analysis.text() : null, files, ground, groundManifest: manifest ? await manifest.text() : null, report: JSON.stringify(out.report) };
  });
  if (got) {
    const dir = resolve(OUTPUTS);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "twin.json"), got.twin);
    if (got.analysis) writeFileSync(join(dir, "analysis.json"), got.analysis);
    writeFileSync(join(dir, "report.json"), got.report);
    if (got.groundManifest) writeFileSync(join(dir, "ground.json"), got.groundManifest);
    writeFileSync(join(dir, "files.json"), JSON.stringify({ files: got.files, ground: got.ground }, null, 1));
    outputs = { dir, files: Object.keys(got.files).length, ground: Object.keys(got.ground).length };
  }
}
// --shot <file.png> (SHIP-1): the built twin opened in the viewer the dev preview shows after a build: wait for it to be
// ready, screenshot it, and keep what it drew (window.__fieldTwin.stats()).
let shot = null;
if (SHOT) {
  try {
    await page.waitForFunction(() => window.__fieldTwin?.ready === true, null, { timeout: 180_000, polling: 500 });
    await page.waitForTimeout(4000);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: resolve(SHOT) });
    shot = { file: resolve(SHOT), ...(await page.evaluate(() => { const s = window.__fieldTwin.stats(); return { drawn: s.drawn, level: s.level, lastDrawMs: s.lastDrawMs }; })) };
  } catch (e) { shot = { error: String(e) }; }
}
sampling = false; await sampler; heapSampling = false; await heapSampler;
const peak = k => Math.max(0, ...timeline.map(s => s.ws[k] ?? 0));
const out = {
  environment: `Chrome ${browser.version()} headless, ${process.platform}-${process.arch}, ${hc} logical cores`, photographs: files.length, crop: CROP, helpers: HELPERS || "default", device: DEVICE || "this computer", traced: !!TRACE,
  twinReadyMs: twinMs, atlasesDoneMs: atlasesMs, groundReadyMs: groundAt ? groundAt - t0 : null, stagesStartMs: stages, timings: result.report?.timings ?? null,
  corn: result.report?.corn ? { msPerPhoto: result.report.corn.msPerPhoto, ms: result.report.corn.ms } : null,
  peakGB: { total: +(Math.max(...timeline.map(s => Object.values(s.ws).reduce((a, b) => a + b, 0))) / 1e9).toFixed(2), renderer: +(peak("renderer") / 1e9).toFixed(2), gpu: +(peak("gpu") / 1e9).toFixed(2), browser: +(peak("browser") / 1e9).toFixed(2), utility: +(peak("utility") / 1e9).toFixed(2) },
  outputs, shot, timeline, heaps, error: result.error ?? null, consoleErrors: errors,
};
writeFileSync(OUTFILE, JSON.stringify(out));
console.log(JSON.stringify({ ...out, timeline: `${timeline.length} samples` }, null, 1));
await browser.close();
