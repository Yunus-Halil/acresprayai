// The corn twin's three views (Realistic, Simple, Geometry), looked at and timed: screenshots at six zooms and the
// renderer's own draw time for each, over a twin on this computer or a synthetic corn field of N plants. Through the
// dev server's no-sign-in preview (/dev/field-twin); Playwright drives the installed Chrome, headless.
//
//   npx vite --port 8097   (in another terminal)
//   node scripts/directGeoref/cornViewBench.mjs --id <twin under data/direct-georef/twin> --out <dir> [--base http://localhost:8097]
//   node scripts/directGeoref/cornViewBench.mjs --synthetic 300000 --out <dir> [--shots 0]
//
// Writes <dir>/<view>-<zoom name>.png and <dir>/bench.json. A console error in the page fails the run. The draw time
// is TwinCanvasLayer.stats.lastDrawMs, the median of five redraws at each stop (the first, which builds the soil and
// the sprites, is reported apart as "first").
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ID = arg("id", ""), SYN = Number(arg("synthetic", 0)), BASE = arg("base", "http://localhost:8097"), OUT = resolve(arg("out", "corn-view-bench"));
const SHOTS = arg("shots", "1") !== "0", AUDIENCE = arg("audience", "founder"), DPR = Number(arg("dpr", 1));
const VIEWS = (arg("views", "realistic,simple,geometry")).split(",");
const AT = arg("at", "") ? arg("at", "").split(",").map(Number) : null;
mkdirSync(OUT, { recursive: true });
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: Number(arg("width", 1440)), height: Number(arg("height", 900)) }, deviceScaleFactor: DPR });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
// The preview asks for files a twin may not have (reference imagery, photo ground): their 404s are not errors here.
page.on("console", m => { if (m.type() === "error" && !/status of 404/.test(m.text())) errors.push(m.text()); });

const results = { twin: ID || `synthetic corn, ${SYN} plants`, viewport: page.viewportSize(), dpr: DPR, views: {} };
for (const view of VIEWS) {
  const t0 = Date.now();
  await page.goto(`${BASE}/dev/field-twin?${SYN ? `syntheticCorn=${SYN}` : `id=${ID}`}&view=${view}&photos=0&audience=${AUDIENCE}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__fieldTwin?.ready === true, null, { timeout: 300000 });
  const openMs = Date.now() - t0;
  await page.waitForTimeout(800);
  const info = await page.evaluate(AT => {
    const t = window.__fieldTwin.scene.twin, P = t.corn?.plants ?? null;
    // A plant near the middle of the list's on-row plants: a place with plants around it.
    let at = null;
    if (P) { const k = Math.floor(P.points.length * 0.37); at = P.points[k]; }
    // --at lat,lng: the same place on two twins of one field (their plant lists differ, so the list's own pick moves).
    if (AT) at = AT;
    const b = t.bounds;
    return { plants: P ? P.points.length : 0, at: at ?? [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2], lat: t.origin.lat, look: t.corn?.look ? { soil: t.corn.look.soil, corn: t.corn.look.corn, plantSizeM: t.corn.look.plantSizeM, samples: t.corn.look.samples.length } : null };
  }, AT);
  const fitZoom = await page.evaluate(() => window.__fieldTwin.map.getZoom());
  // Stops by pixels a metre: the whole field, then 8, 40, 60 (a 10 cm plant has just become a drawn plant: the most
  // drawn plants a view holds), 150 and 400 px/m.
  const zoomFor = pxPerM => Math.log2((156543.03392 * Math.cos((info.lat * Math.PI) / 180)) * pxPerM);
  const stops = [["field", fitZoom], ["rows-8pxm", zoomFor(8)], ["plants-40pxm", zoomFor(40)], ["plants-60pxm", zoomFor(60)], ["plants-150pxm", zoomFor(150)], ["plants-400pxm", zoomFor(400)]];
  const out = { openMs, plants: info.plants, look: info.look, stops: {} };
  for (const [name, zoom] of stops) {
    const first = await page.evaluate(async ({ at, zoom }) => {
      const F = window.__fieldTwin; F.setView(at[0], at[1], zoom);
      await new Promise(r => setTimeout(r, 350));
      return F.stats().lastDrawMs;
    }, { at: info.at, zoom });
    const times = [];
    let drawn = null;
    for (let k = 0; k < 5; k++) {
      const r = await page.evaluate(async ({ at, zoom, k }) => {
        const F = window.__fieldTwin, before = F.stats().draws;
        // A pan of a few pixels and back forces a full redraw of the same view.
        F.map.panBy([k % 2 ? 3 : -3, 0], { animate: false });
        await new Promise(r => setTimeout(r, 120));
        const s = F.stats();
        return { ms: s.lastDrawMs, drawn: s.drawn, redrew: s.draws > before };
      }, { at: info.at, zoom, k });
      if (r.redrew) times.push(r.ms);
      drawn = r.drawn;
    }
    times.sort((a, b) => a - b);
    out.stops[name] = { zoom: +zoom.toFixed(2), firstMs: +first.toFixed(1), medianMs: times.length ? +times[times.length >> 1].toFixed(1) : null, maxMs: times.length ? +times[times.length - 1].toFixed(1) : null, drawn };
    if (SHOTS) await page.screenshot({ path: join(OUT, `${view}-${name}.png`) });
  }
  results.views[view] = out;
}
results.errors = errors;
writeFileSync(join(OUT, "bench.json"), JSON.stringify(results, null, 1));
for (const [v, r] of Object.entries(results.views)) for (const [s, q] of Object.entries(r.stops)) console.log(`${v.padEnd(10)} ${s.padEnd(14)} zoom ${String(q.zoom).padEnd(6)} first ${String(q.firstMs).padStart(7)} ms  median ${String(q.medianMs).padStart(6)} ms  max ${String(q.maxMs).padStart(6)} ms  ${JSON.stringify(q.drawn)}`);
if (errors.length) { console.error("console errors:\n" + errors.slice(0, 10).join("\n")); process.exitCode = 1; }
await browser.close();
