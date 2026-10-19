// How long the map's canvas layers take to draw at field scale, in headless Chrome (2026-10-19).
//
//   node scripts/bench/layerRenderBench.mjs
//
// A standalone page (not the app): Leaflet from node_modules, a 1280 x 800 map, and the same per-redraw loops as
// TwoStageLayer (Stage 1 cells as quads) and ModelDetectionLayer's PlantDots (dots), timed over 20 redraws after a pan,
// for 1, 10 and 50 hectares. React, tiles and the rest of the app are not in it, so these are lower bounds.
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const leaflet = readFileSync(join(root, "node_modules/leaflet/dist/leaflet.js"), "utf8");
const css = readFileSync(join(root, "node_modules/leaflet/dist/leaflet.css"), "utf8");
const html = `<!doctype html><html><head><style>${css} html,body,#m{margin:0;width:1280px;height:800px}</style></head><body><div id="m"></div><script>${leaflet}</script></body></html>`;

const exe = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => { try { readFileSync(p, { flag: "r" }); return true; } catch { return false; } });
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.setContent(html);
const runs = {};
for (const CULL of [false, true]) runs[CULL ? "withViewCulling" : "withoutViewCulling"] = await page.evaluate((CULL) => {
  const L = window.L;
  const lat0 = 37.6, lng0 = -78.4;
  const map = L.map("m", { preferCanvas: true, zoomAnimation: false }).setView([lat0, lng0], 18);
  const mLat = 1 / 111320, mLng = 1 / (111320 * Math.cos((lat0 * Math.PI) / 180));
  const results = [];
  for (const ha of [1, 10, 50]) {
    const side = Math.sqrt(ha * 10000);
    const n = Math.floor(side / 2);
    const cells = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const la = lat0 - j * 2 * mLat, lo = lng0 + i * 2 * mLng;
      cells.push({ pressure: Math.random() * 0.2, uncertain: Math.random() < 0.2, ring: [{ lat: la, lng: lo }, { lat: la, lng: lo + 2 * mLng }, { lat: la - 2 * mLat, lng: lo + 2 * mLng }, { lat: la - 2 * mLat, lng: lo }] });
    }
    const dots = Array.from({ length: Math.round(3000 * ha) }, () => ({ lat: lat0 - Math.random() * side * mLat, lng: lng0 + Math.random() * side * mLng }));
    const canvas = document.createElement("canvas");
    map.getPanes().overlayPane.appendChild(canvas);
    const drawCells = () => {
      const size = map.getSize(); canvas.width = size.x; canvas.height = size.y;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, size.x, size.y);
      const vb = map.getBounds().pad(0.05);
      const s0 = vb.getSouth(), n0 = vb.getNorth(), w0 = vb.getWest(), e0 = vb.getEast();
      for (const c of cells) {
        if (CULL && !c.ring.some(q => q.lat >= s0 && q.lat <= n0 && q.lng >= w0 && q.lng <= e0)) continue;
        const ps = c.ring.map(q => map.latLngToContainerPoint([q.lat, q.lng]));
        if (ps.every(p => p.x < 0 || p.y < 0 || p.x > size.x || p.y > size.y)) continue;
        ctx.beginPath(); ctx.moveTo(ps[0].x, ps[0].y); for (const p of ps.slice(1)) ctx.lineTo(p.x, p.y); ctx.closePath();
        ctx.fillStyle = c.uncertain ? "rgba(156,163,175,0.25)" : "rgba(255,120,0,0.3)"; ctx.fill();
      }
    };
    const drawDots = () => {
      const size = map.getSize(); canvas.width = size.x; canvas.height = size.y;
      const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, size.x, size.y);
      for (const p of dots) {
        const q = map.latLngToContainerPoint([p.lat, p.lng]);
        if (q.x < -3 || q.y < -3 || q.x > size.x + 3 || q.y > size.y + 3) continue;
        ctx.fillStyle = "#ffe600"; ctx.beginPath(); ctx.arc(q.x, q.y, 2, 0, Math.PI * 2); ctx.fill();
      }
    };
    const time = (fn, zoom) => {
      map.setView([lat0 - (side / 2) * mLat, lng0 + (side / 2) * mLng], zoom, { animate: false });
      const t = [];
      for (let k = 0; k < 20; k++) { map.panBy([1, 0], { animate: false }); const a = performance.now(); fn(); t.push(performance.now() - a); }
      t.sort((a, b) => a - b);
      return { median: +t[10].toFixed(1), p90: +t[17].toFixed(1) };
    };
    results.push({ ha, cells: cells.length, dots: dots.length,
      cellsWholeFieldInView: time(drawCells, ha === 1 ? 18 : ha === 10 ? 17 : 16), cellsZoomedIn: time(drawCells, 20),
      dotsWholeFieldInView: time(drawDots, ha === 1 ? 18 : ha === 10 ? 17 : 16) });
    canvas.remove();
  }
  map.remove();
  const el = document.getElementById("m"); const fresh = el.cloneNode(false); el.replaceWith(fresh);
  return results;
}, CULL);
console.log(JSON.stringify({ browser: exe, runs }, null, 1));
await browser.close();
