// Diagnostic: a twin's verified weeds inside the labelled ground of DJI_0301, drawn on the photograph (green: within
// 0.6 m of a weed label; red: not; size by area) with the labels (white rings) and the twin's crowns (blue circles),
// and a breakdown of the unlabelled ones by where they stand (at a crown's edge, on a row, between rows) and size.
//
//   npx vite-node scripts/directGeoref/colourTwinDiag.ts -- --twin data/direct-georef/twin-app/apricot-colour2/twin.json
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { encodePng } from "../bench/images";
import { groundToPixel } from "../../src/lib/directGeoref";
import type { TwinBundle } from "../../src/lib/fieldTwin/types";
import { OUT, loadReference, quarterPixels } from "./common";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const TWIN = arg("twin", "data/direct-georef/twin-app/apricot-colour2/twin.json");
const twin = JSON.parse(readFileSync(TWIN, "utf8")) as TwinBundle;
const { frames, model } = loadReference();
const f = frames.get("DJI_0301")!;
const GROUND = model.globals.groundOffsetM;
const labels = (JSON.parse(readFileSync(join(OUT, "labels.geojson"), "utf8")) as { features: { geometry: { coordinates: [number, number] }; properties: { cls: string } }[] }).features;
const lat0 = labels[0].geometry.coordinates[1], lng0 = labels[0].geometry.coordinates[0];
const mLat = 111_320, mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
const loc = (lat: number, lng: number): [number, number] => [(lng - lng0) * mLng, (lat - lat0) * mLat];
const LW = labels.filter(x => x.properties.cls === "weed").map(x => loc(x.geometry.coordinates[1], x.geometry.coordinates[0]));
const box = { x0: Math.min(...LW.map(p => p[0])) - 2, x1: Math.max(...LW.map(p => p[0])) + 2, y0: Math.min(...LW.map(p => p[1])) - 2, y1: Math.max(...LW.map(p => p[1])) + 2 };
const crowns = twin.trees.map(t => ({ p: loc(t.lat, t.lng), r: t.crownRadiusM }));
const rows = twin.rows.filter(r => r.kept).map(r => r.line.map(([lat, lng]) => loc(lat, lng)));
const segDist = (p: [number, number], a: [number, number], b: [number, number]) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0; return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]); };

const px = quarterPixels("DJI_0301", 4);
const W = px.width, H = px.height, dn = f.intrinsics.width / W;
const pic = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) { pic[i * 4] = px.rgba[i * 4]; pic[i * 4 + 1] = px.rgba[i * 4 + 1]; pic[i * 4 + 2] = px.rgba[i * 4 + 2]; pic[i * 4 + 3] = 255; }
const dot = (x: number, y: number, rgb: [number, number, number], r: number, ring = false) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const d2 = dx * dx + dy * dy; if (d2 > r * r || (ring && d2 < (r - 1.2) * (r - 1.2))) continue; const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const o = (yy * W + xx) * 4; pic[o] = rgb[0]; pic[o + 1] = rgb[1]; pic[o + 2] = rgb[2]; } };
const pixOf = (lat: number, lng: number) => { const h = groundToPixel(f, lat, lng, GROUND); return h ? [h.u / dn, h.v / dn] as [number, number] : null; };

type Tally = { crownEdge: number; onRow: number; between: number; small: number; mid: number; large: number; n: number };
const tally = (): Tally => ({ crownEdge: 0, onRow: 0, between: 0, small: 0, mid: 0, large: 0, n: 0 });
const near: Tally = tally(), far: Tally = tally();
for (const w of twin.weeds) {
  if (w.status !== "verified") continue;
  const p = loc(w.lat, w.lng);
  if (p[0] < box.x0 || p[0] > box.x1 || p[1] < box.y0 || p[1] > box.y1) continue;
  const labelled = LW.some(q => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= 0.36);
  const t = labelled ? near : far;
  t.n++;
  const dCrown = Math.min(...crowns.map(c => Math.hypot(c.p[0] - p[0], c.p[1] - p[1]) - c.r));
  const dRow = rows.length ? Math.min(...rows.map(l => segDist(p, l[0], l[1]))) : Infinity;
  if (dCrown < 0.5) t.crownEdge++; else if (dRow < 0.5) t.onRow++; else t.between++;
  if (w.areaM2 < 0.01) t.small++; else if (w.areaM2 < 0.05) t.mid++; else t.large++;
  const q = pixOf(w.lat, w.lng);
  if (q) dot(q[0], q[1], labelled ? [40, 255, 40] : dCrown < 0.5 ? [255, 160, 40] : [255, 40, 40], Math.max(2, Math.min(8, Math.round(Math.sqrt(w.areaM2) * 25))));
}
for (const q of LW) { const h = pixOf(lat0 + q[1] / mLat, lng0 + q[0] / mLng); if (h) dot(h[0], h[1], [255, 255, 255], 6, true); }
for (const c of crowns) { const h = pixOf(lat0 + c.p[1] / mLat, lng0 + c.p[0] / mLng); if (h) dot(h[0], h[1], [80, 140, 255], Math.round(c.r / 0.039), true); }
const name = `twin-weeds-${basename(dirname(TWIN))}-DJI_0301.png`;
writeFileSync(join(OUT, name), encodePng({ width: W, height: H, data: pic }));
const show = (k: string, t: Tally) => console.log(`${k}: ${t.n} verified in the box; at a crown's edge ${t.crownEdge}, on a row ${t.onRow}, between rows ${t.between}; under 100 cm² ${t.small}, to 500 ${t.mid}, over ${t.large}`);
show("near a label", near); show("no label near", far);
console.log(`-> ${join(OUT, name)}`);
