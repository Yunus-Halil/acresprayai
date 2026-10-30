// Photographs without GPS placed by matching (src/lib/fieldTwin/build/matchPlacement.ts), checked by eye: the
// pairs found, the ones dropped, and a mosaic drawn through the real camera model from the made-up headers, so a
// wrong turn, sign or scale shows as a broken picture. Writes next to the photographs:
//   <photos>/outputs/no-gps-match/mosaic.jpg and placement.json
// Usage: vite-node scripts/directGeoref/matchProbe.ts -- --photos directtestimagery/midphase [--spacing 0.762] [--n 256] [--only 1,2,3]
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { frameCorners, frameFromDji, groundToPixel, takeoffPlane } from "../../src/lib/directGeoref";
import { placeByMatching } from "../../src/lib/fieldTwin/build/matchPlacement";
import { toEnu } from "../../src/lib/sourceFrames/odm";
import { encodeJpeg } from "../bench/images";
import { nodePhoto } from "./nodePhotos";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const dir = resolve(arg("photos") ?? "directtestimagery/midphase");
const spacing = Number(arg("spacing") ?? 0.762), n = Number(arg("n") ?? 256), down = 4;
const only = arg("only")?.split(",");
const files = readdirSync(dir).filter(f => /\.jpe?g$/i.test(f)).filter(f => !only || only.includes(f.replace(/\.[^.]+$/, ""))).sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0) || a.localeCompare(b));
const photos = files.map(f => nodePhoto(join(dir, f)));
const t0 = Date.now();
let last = "";
const res = await placeByMatching(photos, { rowSpacingM: spacing, decodeDown: down, match: { n } }, { onProgress: p => { const m = `${p.stage} ${p.done}/${p.total ?? "?"} ${p.message}`; if (m.slice(0, 40) !== last) { last = m.slice(0, 40); process.stdout.write(`\r${m.padEnd(90)}`); } } });
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(res.report);
for (const nt of res.notes) console.log(" -", nt);
for (const r of res.refused) console.log(" refused", r.name, r.reason);

// The mosaic: every placed photograph drawn on a 10 cm grid through its frame (inverse mapping), last on top.
const out = join(dir, "outputs", "no-gps-match");
mkdirSync(out, { recursive: true });
const frames = [...res.metas].map(([name, meta]) => {
  const px = { w: meta.width! / down, h: meta.height! / down };
  const f = frameFromDji(name, meta, { ground: takeoffPlane(0), imageWidth: px.w, imageHeight: px.h });
  if ("reason" in f) throw new Error(f.reason);
  return f.frame;
});
const origin = { lat: frames[0].pose.lat, lng: frames[0].pose.lng, altM: 0 };
const corners = frames.flatMap(f => frameCorners(f) ?? []).map(g => toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, origin));
const cell = 0.1;
const e0 = Math.min(...corners.map(c => c[0])), e1 = Math.max(...corners.map(c => c[0])), n0 = Math.min(...corners.map(c => c[1])), n1 = Math.max(...corners.map(c => c[1]));
const W = Math.ceil((e1 - e0) / cell), H = Math.ceil((n1 - n0) / cell);
const img = { width: W, height: H, data: new Uint8Array(W * H * 4) };
const latOf = (e: number, nn: number) => ({ lat: origin.lat + (nn / 6378137) * (180 / Math.PI), lng: origin.lng + (e / (6378137 * Math.cos((origin.lat * Math.PI) / 180))) * (180 / Math.PI) });
for (const f of frames) {
  const src = await photos.find(p => p.name === f.name)!.decode(down);
  const cs = (frameCorners(f) ?? []).map(g => toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, origin));
  const x0 = Math.max(0, Math.floor((Math.min(...cs.map(c => c[0])) - e0) / cell)), x1 = Math.min(W - 1, Math.ceil((Math.max(...cs.map(c => c[0])) - e0) / cell));
  const y0 = Math.max(0, Math.floor((n1 - Math.max(...cs.map(c => c[1]))) / cell)), y1 = Math.min(H - 1, Math.ceil((n1 - Math.min(...cs.map(c => c[1]))) / cell));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const g = latOf(e0 + (x + 0.5) * cell, n1 - (y + 0.5) * cell);
    const hit = groundToPixel(f, g.lat, g.lng, 0);
    if (!hit || !hit.inside) continue;
    const u = Math.floor(hit.u), v = Math.floor(hit.v);
    if (u < 0 || v < 0 || u >= src.width || v >= src.height) continue;
    const s = (v * src.width + u) * 4, d = (y * W + x) * 4;
    // A frame's outer 1 % drawn yellow, so the joins show.
    const edge = u < src.width * 0.01 || v < src.height * 0.01 || u > src.width * 0.99 || v > src.height * 0.99;
    img.data[d] = edge ? 255 : src.rgba[s]; img.data[d + 1] = edge ? 220 : src.rgba[s + 1]; img.data[d + 2] = edge ? 0 : src.rgba[s + 2]; img.data[d + 3] = 255;
  }
}
writeFileSync(join(out, "mosaic.jpg"), encodeJpeg(img, 88));
writeFileSync(join(out, "placement.json"), JSON.stringify({ report: res.report, notes: res.notes, refused: res.refused, metas: Object.fromEntries(res.metas) }, null, 1));
console.log(`mosaic ${W} x ${H} at ${cell * 100} cm -> ${join(out, "mosaic.jpg")}`);
for (const p of res.pairs) console.log(` ${p.a}-${p.b} turn ${p.turnDeg.toFixed(1)} d ${p.dx.toFixed(1)},${p.dy.toFixed(1)} peak ${p.peak.toFixed(3)} 2nd ${p.secondRatio.toFixed(2)} overlap ${p.overlap.toFixed(2)}`);
for (const d of res.dropped) console.log(` dropped ${d.pair.a}-${d.pair.b} turn ${d.pair.turnDeg.toFixed(1)} peak ${d.pair.peak.toFixed(3)}: ${d.why}`);
