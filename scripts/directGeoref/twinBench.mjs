// Field Twin scale benchmark: synthetic fields of 1,000 to 1,000,000 observations through the dev preview
// (/dev/field-twin?synthetic=N), timed in the real browser (Playwright over the installed Chrome).
//
//   node scripts/directGeoref/twinBench.mjs [--base http://localhost:8081] [--sizes 1000,10000,100000,1000000] [--tag after]
//
// Writes data/direct-georef/twin/bench/<tag>.json: time to ready (generate + parse + intelligence + scene), the
// renderer's own draw time at the field, row and plant levels, pan frame times, and (when the build has them) the
// time to rank the findings for each filter.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:8081"), TAG = arg("tag", "after");
const SIZES = arg("sizes", "1000,10000,100000,1000000").split(",").map(Number);
const OUT = resolve("data/direct-georef/twin/bench");
mkdirSync(OUT, { recursive: true });
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--disable-gpu-vsync", "--js-flags=--max-old-space-size=4096"] });
const results = {};
for (const n of SIZES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const t0 = Date.now();
  await page.goto(`${BASE}/dev/field-twin?synthetic=${n}`, { waitUntil: "domcontentloaded" });
  try { await page.waitForFunction(() => window.__fieldTwin?.ready === true, null, { timeout: 600000 }); } catch (e) { results[n] = { error: String(e) }; await page.close(); continue; }
  const readyMs = Date.now() - t0;
  const settle = async () => { await page.waitForTimeout(500); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); };
  await settle();
  const stats = () => page.evaluate(() => { const s = window.__fieldTwin.stats(); return { drawMs: +s.lastDrawMs.toFixed(2), drawn: s.drawn, level: s.level, zoom: +window.__fieldTwin.map.getZoom().toFixed(2) }; });
  const info = await page.evaluate(() => { const s = window.__fieldTwin.scene; return { weeds: s.weeds.n, trees: s.trees.n, cells: s.cells.n, zones: s.zones.length, clusters: s.clusters.n, lat: s.twin.origin.lat, lng: s.twin.origin.lng, memMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }; });
  // The busiest 1.5 m cluster as the close-up spot.
  const spot = await page.evaluate(() => { const s = window.__fieldTwin.scene, K = s.clusters; let b = 0; for (let i = 1; i < K.n; i++) if (K.count[i] > K.count[b]) b = i; const ll = window.__fieldTwin.map.unproject(L.point(K.x[b], K.y[b]), 0); return { lat: ll.lat, lng: ll.lng }; });
  await page.evaluate(() => { window.__fieldTwin.map.fitBounds(window.__fieldTwin.map.getBounds()); });
  const fieldZoom = await page.evaluate(() => window.__fieldTwin.map.getZoom());
  const views = {};
  for (const [name, lat, lng, z] of [["field", info.lat, info.lng, fieldZoom], ["row", spot.lat, spot.lng, 20.5], ["plant", spot.lat, spot.lng, 23.5]]) {
    await page.evaluate(([la, ln, zz]) => window.__fieldTwin.setView(la, ln, zz), [lat, lng, z]);
    await settle();
    // Ten redraws of the same view: the median is the number.
    const ms = await page.evaluate(async () => { const t = []; for (let i = 0; i < 10; i++) { window.__fieldTwin.map.panBy([1, 0], { animate: false }); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); t.push(window.__fieldTwin.stats().lastDrawMs); } t.sort((a, b) => a - b); return +t[5].toFixed(2); });
    views[name] = { ...(await stats()), medianDrawMs: ms };
  }
  const pan = {};
  for (const [name, z] of [["plant", 23.5], ["row", 20.5], ["field", fieldZoom]]) {
    await page.evaluate(([la, ln, zz]) => window.__fieldTwin.setView(la, ln, zz), [spot.lat, spot.lng, z]);
    await settle();
    pan[name] = await page.evaluate(async () => { const m = window.__fieldTwin.map, t = []; for (let i = 0; i < 12; i++) { const a = performance.now(); m.panBy([i % 2 ? -240 : 240, i % 3 ? 120 : -120], { animate: false }); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); t.push(performance.now() - a); } t.sort((a, b) => a - b); return { medianMs: +t[6].toFixed(1), maxMs: +t[11].toFixed(1) }; });
  }
  // Findings (when the build has the engine): time to rank each filter over the whole field, and a draw with it on.
  let findings = null;
  if (await page.evaluate(() => typeof window.__fieldTwin.setFindings === "function")) {
    findings = {};
    await page.evaluate(([la, ln, zz]) => window.__fieldTwin.setView(la, ln, zz), [info.lat, info.lng, fieldZoom]);
    await settle();
    for (const mode of ["largest", "clusters", "pressure", "extent", "confidence", "rows"]) {
      const r = await page.evaluate(async m => {
        const t = performance.now(); const res = window.__fieldTwin.setFindings({ mode: m }); const rankMs = performance.now() - t;
        await new Promise(r => setTimeout(r, 150)); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { rankMs: +rankMs.toFixed(1), qualifying: res?.qualifying ?? null, emphasized: res?.emphasized ?? null, drawMs: +window.__fieldTwin.stats().lastDrawMs.toFixed(2) };
      }, mode);
      findings[mode] = r;
    }
    await page.evaluate(() => window.__fieldTwin.setFindings(null));
  }
  results[n] = { readyMs, ...info, views, pan, findings };
  console.log(n, JSON.stringify(results[n]));
  await page.close();
}
writeFileSync(join(OUT, `${TAG}.json`), JSON.stringify(results, null, 1));
await browser.close();
