// Screenshots and benchmarks of the Field Twin over the real apricot twin, through the dev server's no-sign-in
// preview (/dev/field-twin). Playwright drives the Chrome installed on this machine.
//
//   npm run dev   (in another terminal, port 8080)
//   node scripts/directGeoref/twinShots.mjs [--id apricot-2021-04-27] [--base http://localhost:8080]
//
// Writes data/direct-georef/twin/shots/{field,row,plant,inspector,surroundings}.png, one screenshot per Explore
// Findings filter (findings-<mode>.png) and benchmark.json. Console errors in the page fail the run. The
// numbers come from the renderer's own timing (TwinCanvasLayer.stats) and from frame times measured in the page.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ID = arg("id", "apricot-2021-04-27"), BASE = arg("base", "http://localhost:8080");
const OUT = resolve("data/direct-georef/twin/shots");
mkdirSync(OUT, { recursive: true });
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--disable-gpu-vsync"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
const t0 = Date.now();
await page.goto(`${BASE}/dev/field-twin?id=${ID}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__fieldTwin?.ready === true, null, { timeout: 120000 });
const loadMs = Date.now() - t0;
const settle = async () => { await page.waitForTimeout(700); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); };
await settle();
const stats = () => page.evaluate(() => { const s = window.__fieldTwin.stats(); return { lastDrawMs: s.lastDrawMs, drawn: s.drawn, level: s.level, zoom: window.__fieldTwin.map.getZoom() }; });
const sceneInfo = await page.evaluate(() => { const s = window.__fieldTwin.scene; return { weeds: s.weeds.n, trees: s.trees.n, cells: s.cells.n, zones: s.zones.length, clusters: s.clusters.n, vegetation: s.vegetation.n, lat: s.twin.origin.lat, lng: s.twin.origin.lng }; });

// A busy spot: the densest cluster.
const spot = await page.evaluate(() => {
  const s = window.__fieldTwin.scene, K = s.clusters;
  let best = 0; for (let i = 1; i < K.n; i++) if (K.count[i] > K.count[best]) best = i;
  const ll = window.__fieldTwin.map.unproject(L.point(K.x[best], K.y[best]), 0);
  return { lat: ll.lat, lng: ll.lng, count: K.count[best] };
}).catch(async () => ({ lat: sceneInfo.lat, lng: sceneInfo.lng, count: 0 }));

const bench = { loadMs, scene: sceneInfo, views: {}, pan: null, zoom: null, layerSwitch: null };
const shot = async (name, lat, lng, zoom) => {
  await page.evaluate(([la, ln, z]) => window.__fieldTwin.setView(la, ln, z), [lat, lng, zoom]);
  await settle();
  const s = await stats();
  bench.views[name] = s;
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  return s;
};
// Field: everything in view (the locate control's framing).
await page.evaluate(() => { window.__fieldTwin.map.fitBounds(window.__fieldTwin.map.getBounds()); });
const fieldZoom = await page.evaluate(() => window.__fieldTwin.map.getZoom());
await shot("surroundings", sceneInfo.lat, sceneInfo.lng, Math.max(12, fieldZoom - 2.5));
await shot("field", sceneInfo.lat, sceneInfo.lng, fieldZoom);
await shot("row", spot.lat, spot.lng, 20.5);
await shot("plant", spot.lat, spot.lng, 23.5);

// Inspector: the weed nearest the busy spot.
const weedId = await page.evaluate(([la, ln]) => {
  const s = window.__fieldTwin.scene, W = s.weeds, p = window.__fieldTwin.map.project([la, ln], 0);
  let best = -1, bd = Infinity; for (let i = 0; i < W.n; i++) { if (W.status[i] !== 0) continue; const d = (W.x[i] - p.x) ** 2 + (W.y[i] - p.y) ** 2; if (d < bd) { bd = d; best = i; } }
  return best >= 0 ? W.id[best] : null;
}, [spot.lat, spot.lng]);
if (weedId != null) {
  await page.evaluate(id => window.__fieldTwin.select({ kind: "weed", id }), weedId);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, "inspector.png") });
  await page.evaluate(() => window.__fieldTwin.select(null));
}

// Explore Findings: each filter at the field view, the results panel open, then the top result selected.
bench.findings = {};
for (const mode of ["largest", "clusters", "pressure", "extent", "confidence", "rows"]) {
  const r = await page.evaluate(async m => {
    const t = performance.now(); const res = window.__fieldTwin.setFindings({ mode: m }); const rankMs = performance.now() - t;
    await new Promise(r => setTimeout(r, 200)); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const s = window.__fieldTwin.stats();
    return { rankMs: +rankMs.toFixed(1), ...res, drawMs: +s.lastDrawMs.toFixed(2), labels: s.labels, drawn: s.drawn };
  }, mode);
  bench.findings[mode] = r;
  await page.evaluate(([la, ln, z]) => window.__fieldTwin.setView(la, ln, z), [sceneInfo.lat, sceneInfo.lng, fieldZoom]);
  await settle();
  await page.screenshot({ path: join(OUT, `findings-${mode}.png`) });
}
// The top patch selected from the panel: zooms to it and highlights it.
await page.evaluate(() => window.__fieldTwin.setFindings({ mode: "clusters" }));
await page.waitForTimeout(300);
await page.click('ol[aria-label="Findings"] li:first-child button');
await page.waitForTimeout(1200);
await page.screenshot({ path: join(OUT, "findings-selected.png") });
await page.evaluate(() => { window.__fieldTwin.select(null); window.__fieldTwin.setFindings(null); });
await settle();

// Pan: 12 steps of 240 px at the plant level, frame time per step (moveend -> redraw).
const panAt = async (zoom) => {
  await page.evaluate(([la, ln, z]) => window.__fieldTwin.setView(la, ln, z), [spot.lat, spot.lng, zoom]);
  await settle();
  return page.evaluate(async () => {
    const m = window.__fieldTwin.map, times = [];
    for (let i = 0; i < 12; i++) {
      const t = performance.now();
      m.panBy([i % 2 ? -240 : 240, i % 3 ? 120 : -120], { animate: false });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    return { medianMs: times[6], maxMs: times[11], lastDrawMs: window.__fieldTwin.stats().lastDrawMs };
  });
};
bench.pan = { plant: await panAt(23.5), row: await panAt(20.5), field: await panAt(fieldZoom) };
// Zoom: step from the field to the plant level and back, time to a settled frame per step.
bench.zoom = await page.evaluate(async ([la, ln, z0, z1]) => {
  const m = window.__fieldTwin.map, times = [];
  for (let z = z0; z <= z1 + 0.01; z += 0.5) { const t = performance.now(); m.setView([la, ln], z, { animate: false }); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); times.push({ zoom: z, ms: performance.now() - t, level: window.__fieldTwin.stats().level, drawMs: window.__fieldTwin.stats().lastDrawMs }); }
  return { steps: times, worstMs: Math.max(...times.map(t => t.ms)) };
}, [spot.lat, spot.lng, fieldZoom, 23.5]);
// Layer switching at the plant level: toggle the heavy layers and time the redraw.
await page.evaluate(([la, ln]) => window.__fieldTwin.setView(la, ln, 23.5), [spot.lat, spot.lng]);
await settle();
bench.layerSwitch = {};
for (const key of ["weeds", "structure", "vegetation", "singleView", "onTree", "pressure"]) {
  const r = await page.evaluate(async k => {
    const on = window.__fieldTwin.stats();
    const t = performance.now(); window.__fieldTwin.setLayers({ [k]: k === "singleView" || k === "onTree" }); await new Promise(r => setTimeout(r, 120)); const off = performance.now() - t;
    const s1 = window.__fieldTwin.stats();
    window.__fieldTwin.setLayers({ [k]: !(k === "singleView" || k === "onTree") }); await new Promise(r => setTimeout(r, 120));
    return { toggledDrawMs: s1.lastDrawMs, drawnBefore: on.drawn, drawnAfter: s1.drawn, roundTripMs: off };
  }, key);
  bench.layerSwitch[key] = r;
}
bench.pageErrors = errors;
writeFileSync(join(OUT, "benchmark.json"), JSON.stringify(bench, null, 1));
console.log(JSON.stringify(bench, null, 1));
await browser.close();
if (errors.length) { console.error("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
