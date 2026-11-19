// EXPERIMENT (experiment/photo-ground, not merged, never part of a build): the flight's photographs on the ground under
// a Field Twin, in two separate tiers, timed apart so neither touches the normal build's time.
//
//   overview  the whole field from each photograph's own small preview (the MPF image the build already reads; a
//             quarter decode when a file has none), at the finest zoom whose pixel is at least 3 cm and no finer than
//             the preview's; one gain per photograph and channel solved from the overlaps first
//   detail    the full photographs at the finest zoom whose pixel is no finer than 0.7 x the camera's, plus one zoom
//             coarser by averaging; tiles grouped by photograph, decoded photographs held in a small cache
// Both: nearest-nadir photograph per ground point, feathered over a band where two meet, background where none does.
// Also measured: seam agreement (the same ground from the two photographs either side of a seam, aligned by
// normalised cross-correlation), timings per phase, bytes per tier and per hectare.
//
//   npx vite-node scripts/directGeoref/photoGround.ts -- --twin <twin dir> --dir <photographs>
//       [--analysis <analysis.json>] [--tier overview|detail|both] [--feather 0.6] [--seams 120]
//
// Cameras: from the analysis record when given (the build's own cameras), else aligned here exactly as the build
// does (readPhotographs + alignCameras over the camera previews). Writes <twin>/pg/{overview,detail}/<z>/<x>/<y>.jpg and
// <twin>/pg/ground.json. Local files only: nothing is uploaded, and data/ is never committed.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { encodeJpeg } from "../bench/images";
import { nodePhoto } from "./nodePhotos";
import { framesFromAnalysis, parseTwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { readPhotographs } from "../../src/lib/fieldTwin/build/photos";
import { alignCameras } from "../../src/lib/fieldTwin/build/cameras";
import { groundSampleAt, type GeorefFrame } from "../../src/lib/directGeoref/projection";
import { BACKGROUND, type GroundImage, type PairStats, TILE, sampleInto, accumulateOverlap, groundCams, latOfY, lngOfX, metresPerPixel, parentTile, planTiles, seamOffset, shadeTile, solveGains, tileGeometry } from "../../src/lib/fieldTwin/photoGround";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const TWIN = resolve(arg("twin")), DIR = resolve(arg("dir")), TIER = arg("tier", "both"), FEATHER = Number(arg("feather", "0.6")), SEAMS = Number(arg("seams", "120")), Q = Number(arg("quality", "82"));
if (!arg("twin") || !arg("dir")) { console.error("need --twin and --dir"); process.exit(1); }
const OUT = join(TWIN, "pg");
const timings: Record<string, number> = {};
const t = async <T>(k: string, f: () => Promise<T> | T): Promise<T> => { const t0 = performance.now(); const r = await f(); timings[k] = Math.round(performance.now() - t0); console.log(`${k}: ${(timings[k] / 1000).toFixed(1)} s`); return r; };

const files = new Map(readdirSync(DIR).filter(f => /\.(jpe?g)$/i.test(f)).map(f => [f.replace(/\.[^.]+$/, ""), join(DIR, f)]));
const photos = new Map([...files].map(([n, p]) => [n, nodePhoto(p)]));

// The cameras.
let frames: Map<string, GeorefFrame>;
let cameraSource: string;
if (arg("analysis")) {
  const parsed = parseTwinAnalysis(JSON.parse(readFileSync(arg("analysis"), "utf8")));
  if (!parsed.ok) throw new Error(parsed.reason);
  frames = framesFromAnalysis(parsed.analysis);
  cameraSource = "the build's own cameras (analysis record)";
} else {
  const { reads } = await t("cameras.read", () => readPhotographs([...photos.values()], 4, {}, true));
  const cams = await t("cameras.align", () => alignCameras(reads, {}, 40, 0, null));
  frames = cams.frames;
  cameraSource = `aligned here as the build does (${cams.report.note ?? "soil ties"})`;
}
const { cams, origin } = groundCams(new Map([...frames].filter(([n]) => photos.has(n))));
console.log(`${cams.length} photographs with cameras (${cameraSource})`);
const lat = origin[0];
const nativeM = Math.min(...cams.map(c => groundSampleAt(c.f, c.f.intrinsics.cx, c.f.intrinsics.cy) ?? Infinity));
const zoomFor = (minM: number) => { let z = 26; while (z > 14 && metresPerPixel(lat, z) < minM) z--; return z; };

// Footprint union area (0.25 m raster) for bytes per hectare.
const areaHa = (() => {
  const lats = cams.flatMap(c => [c.box[0], c.box[2]]), lngs = cams.flatMap(c => [c.box[1], c.box[3]]);
  const kE = Math.cos((lat * Math.PI) / 180) * 111_320, kN = 110_574, s = 0.25;
  const W = Math.ceil(((Math.max(...lngs) - Math.min(...lngs)) * kE) / s), H = Math.ceil(((Math.max(...lats) - Math.min(...lats)) * kN) / s);
  const inRing = (r: [number, number][], la: number, lo: number) => { let hit = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[0] > la) !== (b[0] > la) && lo < ((b[1] - a[1]) * (la - a[0])) / (b[0] - a[0]) + a[1]) hit = !hit; } return hit; };
  let n = 0;
  for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) { const la = Math.min(...lats) + ((j + 0.5) * s) / kN, lo = Math.min(...lngs) + ((i + 0.5) * s) / kE; if (cams.some(c => la >= c.box[0] && la <= c.box[2] && lo >= c.box[1] && lo <= c.box[3] && inRing(c.ring, la, lo))) n++; }
  return (n * s * s) / 10_000;
})();
console.log(`photographed ground ${areaHa.toFixed(3)} ha, camera pixel ${(nativeM * 100).toFixed(2)} cm`);

const writeTile = (tier: string, z: number, x: number, y: number, rgba: Uint8Array) => {
  const dir = join(OUT, tier, String(z), String(x)); mkdirSync(dir, { recursive: true });
  const jpg = encodeJpeg({ width: TILE, height: TILE, data: rgba }, Q);
  writeFileSync(join(dir, `${y}.jpg`), jpg);
  return jpg.length;
};
const pyramid = (tier: string, zTop: number, zMin: number, top: Map<string, Uint8Array>, bytes: Record<number, { tiles: number; bytes: number }>) => {
  let level = top;
  for (let z = zTop - 1; z >= zMin; z--) {
    const parents = new Map<string, (Uint8Array | null)[]>();
    for (const [k, rgba] of level) { const [x, y] = k.split("/").map(Number); const pk = `${x >> 1}/${y >> 1}`; const arr = parents.get(pk) ?? [null, null, null, null]; arr[(y & 1) * 2 + (x & 1)] = rgba; parents.set(pk, arr); }
    const next = new Map<string, Uint8Array>();
    for (const [pk, ch] of parents) { const [x, y] = pk.split("/").map(Number); const rgba = parentTile(ch, TILE); next.set(pk, rgba); const b = writeTile(tier, z, x, y, rgba); (bytes[z] ??= { tiles: 0, bytes: 0 }); bytes[z].tiles++; bytes[z].bytes += b; }
    level = next;
  }
};

const summary: Record<string, unknown> = { twin: TWIN.split(/[\\/]/).pop(), photographs: cams.length, cameraSource, areaHa: +areaHa.toFixed(4), cameraPixelCm: +(nativeM * 100).toFixed(3), featherM: FEATHER, jpegQuality: Q, timings };
const prev = existsSync(join(OUT, "ground.json")) ? JSON.parse(readFileSync(join(OUT, "ground.json"), "utf8")) : {};

// ---- Overview tier: previews in memory, gains, then tiles.
let gains: Float64Array | null = prev.gains ? Float64Array.from(prev.gains as number[]) : null;
if (TIER === "overview" || TIER === "both") {
  const previews = new Map<number, GroundImage>();
  let fromPreview = 0;
  await t("overview.decodePreviews", async () => {
    for (const [k, c] of cams.entries()) {
      const p = photos.get(c.name)!;
      let px = await p.preview(); if (px) fromPreview++; else px = await p.decode(4);
      previews.set(k, { width: px.width, height: px.height, rgba: px.rgba, scale: px.width / c.f.intrinsics.width });
    }
  });
  const previewM = nativeM * (cams[0].f.intrinsics.width / previews.get(0)!.width);
  const zO = Math.min(zoomFor(0.9 * Math.max(0.03, previewM)), 24);
  const img = (k: number) => previews.get(k)!;
  // Gains from the overlaps, two zooms coarser (a quarter of the pixels each step), wide band: all shared ground near seams.
  await t("overview.gains", () => {
    const stats: PairStats = new Map();
    for (const tl of planTiles(cams, zO - 2, origin, 3)) accumulateOverlap(cams, origin, zO - 2, tl.x, tl.y, tl.cands, 128, 3, img, stats);
    gains = solveGains(cams.length, stats);
  });
  const top = new Map<string, Uint8Array>(), bytes: Record<number, { tiles: number; bytes: number }> = {};
  let renderMs = 0, encodeMs = 0;
  await t("overview.tiles", () => {
    for (const tl of planTiles(cams, zO, origin, FEATHER)) {
      const r0 = performance.now();
      const g = tileGeometry(cams, origin, zO, tl.x, tl.y, tl.cands, TILE, FEATHER);
      if (!g.used.length) continue;
      const rgba = shadeTile(g, TILE, img, gains);
      const r1 = performance.now(); renderMs += r1 - r0;
      top.set(`${tl.x}/${tl.y}`, rgba);
      const b = writeTile("overview", zO, tl.x, tl.y, rgba); encodeMs += performance.now() - r1;
      (bytes[zO] ??= { tiles: 0, bytes: 0 }); bytes[zO].tiles++; bytes[zO].bytes += b;
    }
  });
  await t("overview.pyramid", () => pyramid("overview", zO, 15, top, bytes));
  const total = Object.values(bytes).reduce((s, v) => s + v.bytes, 0);
  summary.overview = { zoom: zO, pixelCm: +(metresPerPixel(lat, zO) * 100).toFixed(2), previewPixelCm: +(previewM * 100).toFixed(2), fromPreview, quarterDecode: cams.length - fromPreview, renderMs: Math.round(renderMs), encodeMs: Math.round(encodeMs), byZoom: bytes, bytes: total, mbPerHa: +(total / 1e6 / areaHa).toFixed(2) };
  summary.gains = { min: Math.min(...gains!), max: Math.max(...gains!) };
} else { summary.overview = prev.overview; summary.gains = prev.gainsSummary ?? prev.gains_summary ?? null; }

// ---- Detail tier: full photographs, grouped by the tile's nearest-nadir photograph; a small cache of decoded ones.
if (TIER === "detail" || TIER === "both") {
  const zD = zoomFor(0.7 * nativeM);
  const plan = planTiles(cams, zD, origin, FEATHER);
  // Photograph by photograph, as the build's own full-size decode would go: each photograph decoded ONCE adds its share
  // of every tile it shows to that tile's sums; a tile is finished, encoded and written when its last photograph is in.
  const G0 = performance.now();
  const contributors = plan.map(tl => tileGeometry(cams, origin, zD, tl.x, tl.y, tl.cands, TILE, FEATHER).used);
  const byPhoto = cams.map(() => [] as number[]);
  contributors.forEach((u, ti) => { for (const k of u) byPhoto[k].push(ti); });
  const remaining = contributors.map(u => u.length);
  let renderMs = performance.now() - G0, decodeMs = 0, encodeMs = 0, decodes = 0, peakOpen = 0;
  const acc = new Map<number, Float32Array>();
  const half = new Map<string, Uint8Array>(), bytes: Record<number, { tiles: number; bytes: number }> = {};
  const mpp = metresPerPixel(lat, zD);
  const T0 = performance.now();
  const tmp = new Float64Array(3);
  const finish = (ti: number) => {
    const tl = plan[ti], sum = acc.get(ti); acc.delete(ti);
    const e0 = performance.now();
    const rgba = new Uint8Array(TILE * TILE * 4);
    for (let o = 0; o < TILE * TILE; o++) { const q = o * 4, w = sum ? sum[o * 4 + 3] : 0; if (!sum || w < 1e-6) { rgba[q] = BACKGROUND[0]; rgba[q + 1] = BACKGROUND[1]; rgba[q + 2] = BACKGROUND[2]; } else for (let c = 0; c < 3; c++) rgba[q + c] = Math.max(0, Math.min(255, Math.round(sum[o * 4 + c] / w))); rgba[q + 3] = 255; }
    const b = writeTile("detail", zD, tl.x, tl.y, rgba); encodeMs += performance.now() - e0;
    (bytes[zD] ??= { tiles: 0, bytes: 0 }); bytes[zD].tiles++; bytes[zD].bytes += b;
    half.set(`${tl.x}/${tl.y}`, rgba);
  };
  for (let k = 0; k < cams.length; k++) {
    if (!byPhoto[k].length) continue;
    const d0 = performance.now();
    const px = await photos.get(cams[k].name)!.decode(1);
    decodeMs += performance.now() - d0; decodes++;
    const im: GroundImage = { width: px.width, height: px.height, rgba: px.rgba, scale: px.width / cams[k].f.intrinsics.width };
    const r0 = performance.now();
    for (const ti of byPhoto[k]) {
      const tl = plan[ti], g = tileGeometry(cams, origin, zD, tl.x, tl.y, tl.cands, TILE, FEATHER);
      let sum = acc.get(ti); if (!sum) { sum = new Float32Array(TILE * TILE * 4); acc.set(ti, sum); }
      const gk = gains ? [gains[k * 3], gains[k * 3 + 1], gains[k * 3 + 2]] : [1, 1, 1];
      for (let o = 0; o < TILE * TILE; o++) {
        const isA = g.a[o] === k, isB = g.b[o] === k;
        if (!isA && !isB) continue;
        const w = isA ? (g.b[o] >= 0 ? 1 - g.wb[o] : 1) : g.wb[o];
        if (w <= 0) continue;
        sampleInto(im, isA ? g.ua[o] : g.ub[o], isA ? g.va[o] : g.vb[o], tmp);
        sum[o * 4] += w * tmp[0] * gk[0]; sum[o * 4 + 1] += w * tmp[1] * gk[1]; sum[o * 4 + 2] += w * tmp[2] * gk[2]; sum[o * 4 + 3] += w;
      }
      peakOpen = Math.max(peakOpen, acc.size);
      if (--remaining[ti] === 0) { renderMs += 0; finish(ti); }
    }
    renderMs += performance.now() - r0;
  }
  renderMs -= encodeMs;
  timings["detail.tiles"] = Math.round(performance.now() - T0);
  const top = half;
  await t("detail.pyramid", () => pyramid("detail", zD, zD - 1, top, bytes));
  const total = Object.values(bytes).reduce((s, v) => s + v.bytes, 0);
  summary.detail = { zoom: zD, pixelCm: +(mpp * 100).toFixed(3), minZoom: zD - 1, tiles: plan.length, decodes, peakTilesOpen: peakOpen, decodeMs: Math.round(decodeMs), renderMs: Math.round(renderMs), encodeMs: Math.round(encodeMs), byZoom: bytes, bytes: total, mbPerHa: +(total / 1e6 / areaHa).toFixed(2) };

  // Seam agreement (a measurement, not part of the tier): tiles of about 1 cm pixels where the two nearest photographs'
  // nadir distances differ by under 0.4 m (on their seam) and both hold the whole tile; at most two per pair.
  const S0 = performance.now();
  const cache = new Map<number, GroundImage>();
  const get = async (k: number) => { let im = cache.get(k); if (im) return im; const px = await photos.get(cams[k].name)!.decode(1); im = { width: px.width, height: px.height, rgba: px.rgba, scale: px.width / cams[k].f.intrinsics.width }; cache.set(k, im); while (cache.size > 6) cache.delete(cache.keys().next().value!); return im; };
  const zS = Math.min(zD, zoomFor(0.008)), mS = metresPerPixel(lat, zS), R = Math.round(0.24 / mS);
  const L = { kE: Math.cos((origin[0] * Math.PI) / 180) * 111_320, kN: 110_574 };
  const onSeam = planTiles(cams, zS, origin, 0.4).filter(tl => {
    if (tl.cands.length < 2) return false;
    const la = latOfY(tl.y + 0.5, zS), lo = lngOfX(tl.x + 0.5, zS), e = (lo - origin[1]) * L.kE, n = (la - origin[0]) * L.kN;
    const [a, b] = tl.cands.map(k => Math.hypot(cams[k].ne - e, cams[k].nn - n));
    return Math.abs(a - b) < 0.4;
  }).sort((p, q) => p.cands[0] - q.cands[0] || p.cands[1] - q.cands[1]);
  const seams: { a: string; b: string; dxCm: number; dyCm: number; offsetCm: number; peak: number; atEdge: boolean }[] = [];
  const pairSeen = new Map<string, number>();
  for (const tl of onSeam) {
    if (seams.length >= SEAMS) break;
    const [ka, kb] = tl.cands, key = `${Math.min(ka, kb)}:${Math.max(ka, kb)}`;
    if ((pairSeen.get(key) ?? 0) >= 2) continue;
    const both = tileGeometry(cams, origin, zS, tl.x, tl.y, [ka, kb], TILE, 1e9);
    if (both.a.some(v => v < 0) || both.b.some(v => v < 0)) continue;
    await get(ka); await get(kb);
    const off = seamOffset(both, TILE, ka, kb, k => cache.get(k)!, R);
    if (!off) continue;
    pairSeen.set(key, (pairSeen.get(key) ?? 0) + 1);
    seams.push({ a: cams[ka].name, b: cams[kb].name, dxCm: +(off.dx * mS * 100).toFixed(2), dyCm: +(off.dy * mS * 100).toFixed(2), offsetCm: +(Math.hypot(off.dx, off.dy) * mS * 100).toFixed(2), peak: +off.peak.toFixed(3), atEdge: off.atEdge });
  }
  const off = seams.map(s => s.offsetCm).sort((a, b) => a - b), q = (p: number) => off.length ? off[Math.min(off.length - 1, Math.floor(p * off.length))] : null;
  summary.seams = { zoom: zS, pixelCm: +(mS * 100).toFixed(3), searchCm: +(R * mS * 100).toFixed(1), candidates: onSeam.length, samples: seams.length, atEdge: seams.filter(s => s.atEdge).length, medianCm: q(0.5), p90Cm: q(0.9), maxCm: off.length ? off[off.length - 1] : null, measureMs: Math.round(performance.now() - S0), list: seams };
} else { summary.detail = prev.detail; summary.seams = prev.seams; }

// Provenance: the rule and its inputs, so any pixel can be traced to the photograph it came from.
summary.provenance = { rule: "each ground point from the photograph whose nadir is nearest among those holding it; within featherM of the next one's nadir distance, blended linearly with it; colour x one gain per photograph and channel", photographs: cams.map((c, k) => ({ name: c.name, nadir: c.nadir.map(v => +v.toFixed(8)), gain: gains ? [0, 1, 2].map(i => +gains![k * 3 + i].toFixed(4)) : null })) };
summary.gains = gains ? Array.from(gains, v => +v.toFixed(4)) : null;
summary.timings = { ...(prev.timings ?? {}), ...timings };
writeFileSync(join(OUT, "ground.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ overview: summary.overview && { ...(summary.overview as object), byZoom: undefined }, detail: summary.detail && { ...(summary.detail as object), byZoom: undefined }, seams: summary.seams && { ...(summary.seams as object), list: undefined } }, null, 1));
