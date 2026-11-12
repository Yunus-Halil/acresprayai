// A flight's photographs laid out on the ground by the cameras a twin build aligned, cut into map tiles, so the
// Field Twin's developer preview (/dev/field-twin) can show them under the twin in its reference-imagery pane.
// Not an orthomosaic: no surface is reconstructed and nothing is blended. Every tile is one photograph (the one whose
// centre is nearest), projected through its camera onto the flat ground the build fitted. It is the twin's own
// alignment made visible: where two photographs meet, the seam shows how well they agree.
//
//   npx vite-node scripts/directGeoref/twinReferenceTiles.ts -- --dir <photographs> --analysis <a corn build's analysis.json>
//       --out data/direct-georef/twin/<set id> [--max-zoom 24] [--min-zoom 16] [--for <twin id>,<twin id>]
//
// Writes <out>/tiles/<z>/<x>/<y>.jpg and <out>/reference.json; with --for, a reference.json beside each named twin
// pointing at this set. The dev server serves them (vite.config.ts, /__field-twin); nothing is uploaded, and data/ is
// never committed.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import { framesFromAnalysis, parseTwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { frameFootprint, groundToPixel, pixelToGround, type GeorefFrame } from "../../src/lib/directGeoref/projection";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = arg("dir"), OUT = resolve(arg("out")), ZMAX = Number(arg("max-zoom", "24")), ZMIN = Number(arg("min-zoom", "16")), FOR = arg("for").split(",").filter(Boolean);
if (!DIR || !arg("analysis") || !arg("out")) { console.error("need --dir, --analysis and --out"); process.exit(1); }
const parsed = parseTwinAnalysis(JSON.parse(readFileSync(arg("analysis"), "utf8"))); if (!parsed.ok) throw new Error(parsed.reason);
const frames = framesFromAnalysis(parsed.analysis);
const T = 256, BG = [26, 28, 26];
const tx = (lng: number, z: number) => ((lng + 180) / 360) * 2 ** z;
const ty = (lat: number, z: number) => { const s = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z; };
const lngOf = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const latOf = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
const inRing = (ring: { lat: number; lng: number }[], lat: number, lng: number) => { let hit = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.lat > lat) !== (b.lat > lat) && lng < ((b.lng - a.lng) * (lat - a.lat)) / (b.lat - a.lat) + a.lng) hit = !hit; } return hit; };

type Cam = { f: GeorefFrame; ring: { lat: number; lng: number }[]; nadir: { lat: number; lng: number }; alt: number };
const cams: Cam[] = [];
for (const f of frames.values()) { const ring = frameFootprint(f), nadir = pixelToGround(f, f.intrinsics.cx, f.intrinsics.cy); if (ring && nadir) cams.push({ f, ring, nadir, alt: f.ground.kind === "flat" ? f.ground.altM : f.pose.altM }); }
const lats = cams.flatMap(c => c.ring.map(p => p.lat)), lngs = cams.flatMap(c => c.ring.map(p => p.lng));
const x0 = Math.floor(tx(Math.min(...lngs), ZMAX)), x1 = Math.floor(tx(Math.max(...lngs), ZMAX)), y0 = Math.floor(ty(Math.max(...lats), ZMAX)), y1 = Math.floor(ty(Math.min(...lats), ZMAX));
const kLng = Math.cos((cams[0].nadir.lat * Math.PI) / 180);
// Every tile's photograph: the nearest centre among those that hold all four corners, else among those that hold its middle.
const jobs = new Map<number, [number, number][]>();
for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
  const cLat = latOf(y + 0.5, ZMAX), cLng = lngOf(x + 0.5, ZMAX), corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].map(([a, b]) => [latOf(b, ZMAX), lngOf(a, ZMAX)]);
  let best = -1, bd = Infinity, bestAll = false;
  cams.forEach((c, k) => {
    if (!inRing(c.ring, cLat, cLng)) return;
    const all = corners.every(([la, lo]) => inRing(c.ring, la, lo)), d = (c.nadir.lat - cLat) ** 2 + ((c.nadir.lng - cLng) * kLng) ** 2;
    if ((all && !bestAll) || (all === bestAll && d < bd)) { best = k; bd = d; bestAll = all; }
  });
  if (best >= 0) (jobs.get(best) ?? jobs.set(best, []).get(best)!).push([x, y]);
}
const files = new Map(readdirSync(DIR).filter(f => /\.jpe?g$/i.test(f)).map(f => [basename(f).replace(/\.[^.]+$/, ""), join(DIR, f)]));
const tilePath = (z: number, x: number, y: number) => join(OUT, "tiles", String(z), String(x), `${y}.jpg`);
const put = (z: number, x: number, y: number, data: Uint8Array) => { const p = tilePath(z, x, y); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, encodeJpeg({ width: T, height: T, data }, 82)); };
let done = 0, tiles = 0; const t0 = Date.now(), G = 4;
for (const [k, list] of jobs) {
  const c = cams[k], path = files.get(c.f.name); done++;
  if (!path) continue;
  const img = decodeImage(new Uint8Array(readFileSync(path))), sx = img.width / c.f.intrinsics.width, sy = img.height / c.f.intrinsics.height;
  for (const [x, y] of list) {
    // The camera at a 5 x 5 grid over the tile, bilinear between: over two metres of flat ground a projection is as good as linear.
    const gu = new Float64Array((G + 1) * (G + 1)), gv = new Float64Array((G + 1) * (G + 1)); let ok = true;
    for (let j = 0; j <= G && ok; j++) for (let i = 0; i <= G; i++) { const h = groundToPixel(c.f, latOf(y + j / G, ZMAX), lngOf(x + i / G, ZMAX), c.alt); if (!h) { ok = false; break; } gu[j * (G + 1) + i] = h.u * sx; gv[j * (G + 1) + i] = h.v * sy; }
    if (!ok) continue;
    const data = new Uint8Array(T * T * 4); let any = false;
    for (let py = 0; py < T; py++) { const fy = ((py + 0.5) / T) * G, j = Math.min(G - 1, Math.floor(fy)), wy = fy - j;
      for (let px = 0; px < T; px++) { const fx = ((px + 0.5) / T) * G, i = Math.min(G - 1, Math.floor(fx)), wx = fx - i, a = j * (G + 1) + i, b = a + G + 1;
        const u = Math.round((gu[a] * (1 - wx) + gu[a + 1] * wx) * (1 - wy) + (gu[b] * (1 - wx) + gu[b + 1] * wx) * wy), v = Math.round((gv[a] * (1 - wx) + gv[a + 1] * wx) * (1 - wy) + (gv[b] * (1 - wx) + gv[b + 1] * wx) * wy), q = (py * T + px) * 4;
        if (u < 0 || v < 0 || u >= img.width || v >= img.height) { data[q] = BG[0]; data[q + 1] = BG[1]; data[q + 2] = BG[2]; } else { const o = (v * img.width + u) * 4; data[q] = img.data[o]; data[q + 1] = img.data[o + 1]; data[q + 2] = img.data[o + 2]; any = true; }
        data[q + 3] = 255; } }
    if (any) { put(ZMAX, x, y, data); tiles++; }
  }
  if (done % 10 === 0) console.log(`${done}/${jobs.size} photographs, ${tiles} tiles (${Math.round((Date.now() - t0) / 1000)} s)`);
}
// The zooms above: each tile the mean of its four children.
let level = { x0, x1, y0, y1 }, total = tiles;
for (let z = ZMAX - 1; z >= ZMIN; z--) {
  const nx = { x0: level.x0 >> 1, x1: level.x1 >> 1, y0: level.y0 >> 1, y1: level.y1 >> 1 }; let n = 0;
  for (let y = nx.y0; y <= nx.y1; y++) for (let x = nx.x0; x <= nx.x1; x++) {
    const data = new Uint8Array(T * T * 4); let any = false;
    for (let q = 0; q < T * T; q++) { data[q * 4] = BG[0]; data[q * 4 + 1] = BG[1]; data[q * 4 + 2] = BG[2]; data[q * 4 + 3] = 255; }
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const p = tilePath(z + 1, 2 * x + dx, 2 * y + dy); if (!existsSync(p)) continue;
      const ch = decodeImage(new Uint8Array(readFileSync(p))); any = true;
      for (let py = 0; py < T / 2; py++) for (let px = 0; px < T / 2; px++) { const q = ((py + (dy * T) / 2) * T + px + (dx * T) / 2) * 4; for (let k = 0; k < 3; k++) { const o = (2 * py * T + 2 * px) * 4 + k; data[q + k] = (ch.data[o] + ch.data[o + 4] + ch.data[o + T * 4] + ch.data[o + T * 4 + 4]) >> 2; } }
    }
    if (any) { put(z, x, y, data); n++; }
  }
  total += n; level = nx; console.log(`zoom ${z}: ${n} tiles`);
}
const reference = { set: basename(OUT), label: "The flight's photographs, placed by the twin's cameras (this computer only)", maxNativeZoom: ZMAX, minZoom: ZMIN, photographs: jobs.size,
  note: "The original photographs laid on the ground by the cameras this build aligned, one photograph per tile: not an orthomosaic, nothing reconstructed or blended. Seams show how well neighbouring photographs agree. Display only: it never moves the twin's objects. Local files, never uploaded." };
writeFileSync(join(OUT, "reference.json"), JSON.stringify(reference, null, 1));
for (const id of FOR) { const d = join(dirname(OUT), id); if (existsSync(d)) writeFileSync(join(d, "reference.json"), JSON.stringify(reference, null, 1)); else console.log(`no twin ${id} beside the set: not linked`); }
console.log(`${total} tiles (zoom ${ZMIN} to ${ZMAX}) from ${jobs.size} photographs in ${Math.round((Date.now() - t0) / 1000)} s -> ${OUT}`);
