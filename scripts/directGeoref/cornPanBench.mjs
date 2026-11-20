// How a corn twin pans (2026-11-20): at given places and pixels a metre, many full redraws of the same view (a pan of
// a few pixels and back), the renderer's own draw time for each: median, quartiles, worst. For comparing two twins of
// one field at the SAME places (cornViewBench.mjs picks its place from the twin's own plant list, which differs).
//
//   node scripts/directGeoref/cornPanBench.mjs --ids <twin a>,<twin b> --at "<lat,lng>;<lat,lng>" [--pxm 60,150] [--view realistic] [--n 60] [--base http://localhost:8097]
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const IDS = arg("ids", "").split(","), PLACES = arg("at", "").split(";").map(p => p.split(",").map(Number)), PXM = arg("pxm", "60,150").split(",").map(Number);
const VIEW = arg("view", "realistic"), N = Number(arg("n", 60)), BASE = arg("base", "http://localhost:8097");
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const q = (s, p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
for (const id of IDS) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/dev/field-twin?id=${id}&view=${VIEW}&photos=0&audience=founder`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__fieldTwin?.ready === true, null, { timeout: 300000 });
  const lat0 = await page.evaluate(() => window.__fieldTwin.scene.twin.origin.lat);
  for (const [pi, at] of PLACES.entries()) for (const pxm of PXM) {
    const zoom = Math.log2(156543.03392 * Math.cos((lat0 * Math.PI) / 180) * pxm);
    const r = await page.evaluate(async ({ at, zoom, N }) => {
      const F = window.__fieldTwin; F.setView(at[0], at[1], zoom);
      await new Promise(r => setTimeout(r, 500));
      const times = [];
      for (let k = 0; k < N + 5; k++) {
        const before = F.stats().draws;
        F.map.panBy([k % 2 ? 3 : -3, 0], { animate: false });
        await new Promise(r => setTimeout(r, 60));
        const s = F.stats();
        if (k >= 5 && s.draws > before) times.push(s.lastDrawMs);
      }
      return { times, drawn: F.stats().drawn };
    }, { at, zoom, N });
    const s = r.times.sort((a, b) => a - b);
    console.log(`${id.padEnd(14)} place ${pi + 1}  ${String(pxm).padStart(4)} px/m  plants ${String(r.drawn.plants ?? 0).padStart(5)}  median ${q(s, 0.5).toFixed(2)} ms  quartiles ${q(s, 0.25).toFixed(2)} - ${q(s, 0.75).toFixed(2)}  worst ${s[s.length - 1].toFixed(1)}  (${s.length} redraws)`);
  }
  await page.close();
}
await browser.close();
