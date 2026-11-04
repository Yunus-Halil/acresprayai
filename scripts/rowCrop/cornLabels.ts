// Self-labels for a "what corn looks like" model, from the adaptive corn reader's SURE results only (no hand labels):
//   corn (1)      green inside the band of a row the reader holds strongly (support >= MIN_SUPPORT, >= MIN_ROW_M long)
//   not corn (2)  green of a small weed candidate in the middle of an alley between two held rows (>= ALLEY_SHARE of
//                 the pitch from each) at the emergence / establishment stages (later on, alley green may be corn
//                 leaves), and green on ground the assessment calls cover without rows of the field's direction
//   soil (0)      not green, within a pitch of a held row
//   ignore (255)  everything else: thin or bridged rows, leaf tips between band and alley middle, unsupported rows,
//                 uncertain and excluded ground, ground far from any row
// Tiles of 448 px at the photo's own pixel, the format scripts/rowCrop/seg_train.py reads (manifest.json + tiles/ +
// masks/), with the stage as the tile's domain. Frames are thinned (--every) and tiles per frame capped, so a set
// covers many frames rather than many tiles of a few.
//   npx vite-node scripts/rowCrop/cornLabels.ts --photos <dir> [--photos <dir> ...] --stage establishment --out <dir> [--every 10] [--tiles 10]
// Never feed it a photo set used for testing (see the corn-recognition plan: no UAV3DCrop 2025 scene, no directtestimagery).
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { decodeImage, encodeJpeg, encodePng } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { adaptiveAsRead, readCornAdaptive } from "../../src/lib/rowCrop/adaptive";
import { downsample, rowCropOverlay } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { GREEN_DEFAULTS, greenMaskWithExcess } from "../../src/lib/directGeoref/green";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIRS = argv.flatMap((a, i) => (a === "--photos" ? [argv[i + 1]] : []));
const STAGE = arg("stage", "establishment")!;
const OUT = arg("out")!;
const EVERY = Number(arg("every", "10")), PER_FRAME = Number(arg("tiles", "10"));
const TILE = 448, MIN_SUPPORT = 0.6, MIN_ROW_M = 1.5, ALLEY_SHARE = 0.3, MAX_WEED_M = 0.2, BAND_BINS = 4, ROW_BAND_SHARE = 0.7, COVER_MIN_GREEN = 0.5;
const profile = cropProfileFor("corn")!;
if (!OUT || !DIRS.length) { console.error("need --photos and --out"); process.exit(1); }

function listPhotos(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...listPhotos(p)); else if (/\.(jpe?g|png)$/i.test(f)) out.push(p);
  }
  return out;
}
/** Scanline fill of a polygon into `mask` with `value`, only where `where` passes. */
function fillPolygon(mask: Uint8Array, W: number, H: number, poly: [number, number][], value: number, where: (i: number) => boolean) {
  if (poly.length < 3) return;
  let y0 = Infinity, y1 = -Infinity; for (const [, y] of poly) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) {
    const xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi <= y) !== (yj <= y)) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi)); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.round(xs[k])); x <= Math.min(W - 1, Math.round(xs[k + 1])); x++) { const i = y * W + x; if (where(i)) mask[i] = value; }
  }
}
/** A band polygon (left edge, right edge reversed) grown by `grow` pixels each side. */
function grownBand(left: [number, number][], right: [number, number][], grow: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < left.length; i++) { const [lx, ly] = left[i], [rx, ry] = right[i], dx = lx - rx, dy = ly - ry, L = Math.hypot(dx, dy) || 1; out.push([lx + (dx / L) * grow, ly + (dy / L) * grow]); }
  for (let i = right.length - 1; i >= 0; i--) { const [lx, ly] = left[i], [rx, ry] = right[i], dx = rx - lx, dy = ry - ly, L = Math.hypot(dx, dy) || 1; out.push([rx + (dx / L) * grow, ry + (dy / L) * grow]); }
  return out;
}

const photos = DIRS.flatMap(listPhotos).filter((_, i) => i % EVERY === 0);
mkdirSync(join(OUT, "tiles"), { recursive: true }); mkdirSync(join(OUT, "masks"), { recursive: true });
const manifestPath = join(OUT, "manifest.json");
const manifest: { tile: string; mask: string; photo: string; x: number; y: number; shares: number[]; domain: string; split: string }[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")).tiles : [];
const done = new Set(manifest.map(t => t.photo));
let seed = 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const totals = [0, 0, 0, 0];
for (const path of photos) {
  const rel = relative(process.cwd(), path).replace(/\\/g, "/");
  if (done.has(rel)) continue;
  const raw = decodeImage(new Uint8Array(readFileSync(path)));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  let ad;
  try { ad = readCornAdaptive(px, rowCropParamsFor(profile, null)); } catch (e) { console.log(`${rel}: ${e}`); continue; }
  const read = adaptiveAsRead(ad);
  if (!read.rows.length || !Number.isFinite(read.gsdM)) { console.log(`${rel}: no rows`); continue; }
  const fac = read.workFactor, work = downsample(px, fac), W = work.W, H = work.H;
  const { mask: green } = greenMaskWithExcess({ width: W, height: H, rgba: work.rgba }, { ...GREEN_DEFAULTS, index: "exgr-soil", soilTilePx: 64, cellPx: 1, soilCapAboveGlobal: 0.05 });
  const toWork = (pts: [number, number][]): [number, number][] => pts.map(([x, y]) => [x / fac, y / fac]);
  const o = rowCropOverlay(read);
  const pitchW = (read.pitchM ?? 0.762) / read.gsdM / fac;
  const lab = new Uint8Array(W * H).fill(255);
  // Soil within a pitch of a held row; then the held rows' bands (green there = corn).
  const held = read.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.supportShare >= MIN_SUPPORT && r.lengthM >= MIN_ROW_M);
  for (const { i } of held) fillPolygon(lab, W, H, grownBand(toWork(o.bands[2 * i]), toWork(o.bands[2 * i + 1]), pitchW), 0, j => !green[j]);
  for (const { i } of held) fillPolygon(lab, W, H, grownBand(toWork(o.bands[2 * i]), toWork(o.bands[2 * i + 1]), 0), 1, j => green[j] === 1);
  // Alley-middle weed candidates at the early stages: not corn, only when bracketed by two held rows a pitch apart
  // (one on each side, each at least ALLEY_SHARE of the pitch away) and small: a row the reader dropped is green a
  // pitch from the held rows too, but only on one side of the gap it leaves, and its plants merge into big patches.
  const heldLines = held.map(({ r }) => toWork(r.points));
  /** Signed across offsets (work px) from a point to each held row's nearest segment, by that segment's normal. */
  const offsets = (x: number, y: number): number[] => heldLines.map(l => {
    let best = Infinity, sgn = 0;
    for (let i = 0; i + 1 < l.length; i++) {
      const [ax, ay] = l[i], [bx, by] = l[i + 1], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
      const ex = x - ax - t * vx, ey = y - ay - t * vy, d = Math.hypot(ex, ey);
      if (d < best) { best = d; const L = Math.sqrt(L2); sgn = Math.sign((ex * -vy + ey * vx) / L) || 1; }
    }
    return best * sgn;
  });
  let alleyWeeds = 0;
  for (const w of ad.weeds) {
    if (w.verdict !== "weed candidate" || w.distToRowM == null || !read.pitchM) continue;
    const st = ad.plans[w.plan]?.stage;
    if (st !== "emergence" && st !== "establishment") continue;
    if (w.equivDiameterM > MAX_WEED_M) continue;
    const off = offsets(w.x / fac, w.y / fac);
    const left = Math.min(...off.filter(v => v > 0)), right = Math.min(...off.filter(v => v < 0).map(v => -v));
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
    if (Math.min(left, right) < ALLEY_SHARE * pitchW || Math.abs(left + right - pitchW) > 0.25 * pitchW) continue;
    fillPolygon(lab, W, H, toWork(w.hull), 2, j => green[j] === 1 && lab[j] !== 1); alleyWeeds++;
  }
  // Cover (verge, lawn, grass): not corn, unless the cell's green is packed into one band along the rows' direction
  // (a row the reader dropped, often at the frame's edge where a cell's window is too short to show periodicity).
  const dirV = heldLines.reduce(([sx, sy], l) => { const [ax, ay] = l[0], [bx, by] = l[l.length - 1], L = Math.hypot(bx - ax, by - ay) || 1; const ux = (bx - ax) / L, uy = (by - ay) / L; return sx * ux + sy * uy >= 0 || (sx === 0 && sy === 0) ? [sx + ux, sy + uy] : [sx - ux, sy - uy]; }, [0, 0] as [number, number]);
  const dL = Math.hypot(dirV[0], dirV[1]) || 1, nx = -dirV[1] / dL, ny = dirV[0] / dL;
  let coverCells = 0, rowLikeCover = 0;
  for (const c of ad.assessment.cells) {
    // A cover cell with rows of the field's direction is a stand the reader did not read, not a verge.
    if (c.state !== "cover" || c.aligned) continue;
    const x0 = Math.floor(c.x0 / fac), y0 = Math.floor(c.y0 / fac), x1 = Math.min(W, Math.ceil(c.x1 / fac)), y1 = Math.min(H, Math.ceil(c.y1 / fac));
    const bin = Math.max(1, pitchW / 10), hist = new Map<number, number>(); let g = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (green[y * W + x]) { const b = Math.floor((x * nx + y * ny) / bin); hist.set(b, (hist.get(b) ?? 0) + 1); g++; }
    let band = 0;
    for (const b of hist.keys()) { let v = 0; for (let k = 0; k < BAND_BINS; k++) v += hist.get(b + k) ?? 0; band = Math.max(band, v); }
    if (g && band / g >= ROW_BAND_SHARE) { rowLikeCover++; continue; }
    // A verge or lawn proper: mostly green, and clear of the held rows by a pitch (a cell beside a held row holds its
    // leaves; a mixed cell holds rows under grass).
    if (g < COVER_MIN_GREEN * (x1 - x0) * (y1 - y0)) continue;
    const corners: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [(x0 + x1) / 2, (y0 + y1) / 2]];
    if (corners.some(([x, y]) => offsets(x, y).some(v => Math.abs(v) < pitchW))) continue;
    coverCells++;
    fillPolygon(lab, W, H, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 2, j => green[j] === 1 && lab[j] !== 1);
  }
  // Uncertain and excluded ground: ignore, whatever was written above.
  for (const e of read.excluded) fillPolygon(lab, W, H, toWork(e.hull), 255, () => true);
  // Tiles at native pixels: those with corn or not-corn and mostly judged, a few per frame at random.
  const cand: { tx: number; ty: number; counts: number[] }[] = [];
  for (let ty = 0; ty + TILE <= px.height; ty += TILE) for (let tx = 0; tx + TILE <= px.width; tx += TILE) {
    const counts = [0, 0, 0, 0];
    for (let y = ty; y < ty + TILE; y += 4) for (let x = tx; x < tx + TILE; x += 4) { const v = lab[Math.min(H - 1, Math.floor(y / fac)) * W + Math.min(W - 1, Math.floor(x / fac))]; counts[v === 255 ? 3 : v]++; }
    const n = counts.reduce((u, v) => u + v, 0);
    if (counts[3] / n > 0.6 || counts[1] + counts[2] < n * 0.01) continue;
    cand.push({ tx, ty, counts });
  }
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  // Tiles holding not-corn first (rarer), then the rest.
  cand.sort((a, b) => Number(b.counts[2] > 0) - Number(a.counts[2] > 0));
  const name = basename(path, extname(path)), scene = relative(process.cwd(), join(path, "..")).replace(/[\\/:]/g, "_").replace(/^_+/, "").slice(-60);
  let kept = 0;
  for (const { tx, ty } of cand.slice(0, PER_FRAME)) {
    const tile = new Uint8Array(TILE * TILE * 4), m = new Uint8Array(TILE * TILE * 4), counts = [0, 0, 0, 0];
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const si = ((ty + y) * px.width + tx + x) * 4, di = (y * TILE + x) * 4;
      tile[di] = px.rgba[si]; tile[di + 1] = px.rgba[si + 1]; tile[di + 2] = px.rgba[si + 2]; tile[di + 3] = 255;
      const v = lab[Math.min(H - 1, Math.floor((ty + y) / fac)) * W + Math.min(W - 1, Math.floor((tx + x) / fac))];
      m[di] = v; m[di + 1] = v; m[di + 2] = v; m[di + 3] = 255; counts[v === 255 ? 3 : v]++;
    }
    const stem = `${scene}_${name}_${tx}_${ty}`;
    writeFileSync(join(OUT, "tiles", `${stem}.jpg`), encodeJpeg({ width: TILE, height: TILE, data: tile }, 92));
    writeFileSync(join(OUT, "masks", `${stem}.png`), encodePng({ width: TILE, height: TILE, data: m }));
    // Every tenth frame's tiles are held out for evaluation (by frame: a frame's tiles stay together).
    const split = photos.indexOf(path) % 10 === 9 ? "val" : "train";
    manifest.push({ tile: `tiles/${stem}.jpg`, mask: `masks/${stem}.png`, photo: rel, x: tx, y: ty, shares: counts.map(c => +(c / (TILE * TILE)).toFixed(3)), domain: STAGE, split });
    for (let k = 0; k < 4; k++) totals[k] += counts[k];
    kept++;
  }
  writeFileSync(manifestPath, JSON.stringify({ stage: STAGE, tile: TILE, classes: { 0: "soil", 1: "corn", 2: "not corn", 255: "ignore" }, rules: { MIN_SUPPORT, MIN_ROW_M, ALLEY_SHARE, MAX_WEED_M }, tiles: manifest }, null, 1));
  console.log(`${rel}: ${ad.plans.filter(p => p.read).map(p => p.stage).join("+")} rows ${read.rows.length} held ${held.length}, alley weeds ${alleyWeeds}, cover cells ${coverCells} (row-like left out ${rowLikeCover}), tiles ${kept}`);
}
const n = totals.reduce((u, v) => u + v, 0) || 1;
console.log(`wrote ${manifest.length} tiles to ${OUT}; pixels soil ${(totals[0] / n * 100).toFixed(1)} % corn ${(totals[1] / n * 100).toFixed(1)} % not-corn ${(totals[2] / n * 100).toFixed(2)} % ignore ${(totals[3] / n * 100).toFixed(1)} %`);
