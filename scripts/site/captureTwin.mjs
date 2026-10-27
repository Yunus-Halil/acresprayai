// Product captures of the real Field Twin for the public website (public/site/twin, public/site/plant).
//
// The landing page's "Beyond the map" section scrubs through a zoom from the whole field down to one weed, and
// "Down to the individual plant" shows that weed selected. Both are the app's own renderer over the real apricot
// twin, through the dev server's no-sign-in preview (/dev/field-twin). Nothing is drawn for the website.
//
// Location privacy: the surroundings layer (OpenStreetMap roads and places) is switched off and every panel, the
// status strip with its coordinates, the scale bar and the mini-map are hidden. What remains is the field's own
// geometry, which carries no coordinates.
//
//   npx vite --port 8081          (in another terminal)
//   node scripts/site/captureTwin.mjs [--base http://localhost:8081] [--out <dir for PNGs>] [--plant-only]
//   python scripts/site/encodeFrames.py <dir for PNGs>
//
// The specimen is weed 1678 of apricot-2021-04-27: verified, 0.37 m across, seen in 12 of the 12 photographs that
// covered it. scripts/site/plantPhotos.py cuts its photographs from the originals.
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:8081");
const ID = "apricot-2021-04-27";
const WEED = Number(arg("weed", "1678"));
const OUT = resolve(arg("out", "data/site-frames"));
const FRAMES = Number(arg("frames", "40"));
const PLANT_ZOOM = 24;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const HIDE = `.twin-root [class*="z-[700]"], .twin-root [class*="z-[650]"], .twin-root [aria-label^="Mini-map"], .leaflet-control-container { display: none !important; }`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function open(width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/dev/field-twin?id=${ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__fieldTwin?.ready === true, null, { timeout: 120000 });
  await page.evaluate(() => window.__fieldTwin.setLayers({ surroundings: false }));
  await page.addStyleTag({ content: HIDE });
  await page.evaluate(() => { window.__fieldTwin.map.options.zoomSnap = 0; });
  return page;
}

const settle = page => page.evaluate(() => new Promise(r => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 160)));

/** Zoom-0 projected position of the specimen, and the zoom that fits the whole field in this viewport. */
async function geometry(page) {
  return page.evaluate(id => {
    const ft = window.__fieldTwin, m = ft.map, w = ft.scene.twin.weeds.find(x => x.id === id);
    if (!w) throw new Error(`weed ${id} not in the twin`);
    const b = ft.scene.twin.bounds;
    const fit = m.getBoundsZoom(L.latLngBounds(b[0], b[1]), false, L.point(24, 24));
    const c = L.latLngBounds(b[0], b[1]).getCenter();
    const pc = m.project(c, 0), pw = m.project([w.lat, w.lng], 0);
    return { fit, c: [pc.x, pc.y], w: [pw.x, pw.y] };
  }, WEED);
}

async function view(page, x, y, zoom) {
  await page.evaluate(([px, py, z]) => { const m = window.__fieldTwin.map; m.setView(m.unproject(L.point(px, py), 0), z, { animate: false }); }, [x, y, zoom]);
  await settle(page);
}

/**
 * The zoom path: linear in zoom (a constant rate of magnification), with the centre pulled from the field's
 * centre to the specimen so the specimen holds its place on screen at first and arrives at the centre at the end.
 */
async function sequence(name, width, height) {
  const page = await open(width, height);
  const g = await geometry(page);
  const z0 = g.fit, z1 = PLANT_ZOOM, dir = join(OUT, name);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < FRAMES; i++) {
    const s = i / (FRAMES - 1), z = z0 + (z1 - z0) * s;
    const ease = s * s * (3 - 2 * s), shrink = Math.pow(2, -(z - z0)) * (1 - ease);
    const x = g.w[0] + (g.c[0] - g.w[0]) * shrink, y = g.w[1] + (g.c[1] - g.w[1]) * shrink;
    await view(page, x, y, z);
    await page.screenshot({ path: join(dir, `f-${String(i).padStart(2, "0")}.png`) });
  }
  await page.evaluate(id => window.__fieldTwin.select({ kind: "weed", id }), WEED);
  await settle(page);
  await page.screenshot({ path: join(dir, "sel.png") });
  console.log(name, { fitZoom: g.fit.toFixed(2), frames: FRAMES });
  await page.close();
}

/** The plant section's still: the specimen selected, a little closer, offset left of centre for the text. */
async function plantStill(name, width, height, xShare) {
  const page = await open(width, height);
  const g = await geometry(page);
  const z = PLANT_ZOOM + 1.6, scale = Math.pow(2, z);
  const x = g.w[0] + (0.5 - xShare) * width / scale;
  await view(page, x, g.w[1], z);
  await page.evaluate(id => window.__fieldTwin.select({ kind: "weed", id }), WEED);
  await settle(page);
  mkdirSync(join(OUT, "plant"), { recursive: true });
  await page.screenshot({ path: join(OUT, "plant", `${name}.png`) });
  await page.close();
}

if (!argv.includes("--plant-only")) {
  await sequence("desktop", 1600, 1000);
  await sequence("mobile", 720, 1120);
}
await plantStill("plant-wide", 1920, 1080, 0.34);
await plantStill("plant-tall", 900, 1200, 0.5);
await browser.close();
