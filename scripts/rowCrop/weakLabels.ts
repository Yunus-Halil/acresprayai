// Weak pixel labels for a segmentation model, from the continuous-row reader: the crop bands are corn, the patches
// between the rows are weeds, soil is background, and everything the reader did not judge (green outside the bands
// that is not a weed, excluded patches) is ignored. Tiles of 448 px at the photo's native pixel.
//   npx vite-node scripts/rowCrop/weakLabels.ts --photos directtestimagery/midphase --stage mid [--tag mid] [--gsd-cm 0.5]
// Output: <photos>/outputs/seg-weak/<tag>/tiles/<photo>_<x>_<y>.jpg + masks/<same>.png (0 bg, 1 crop, 2 weed, 255 ignore)
// and manifest.json. Labels are weak: a weed under the corn leaves is labelled corn, and the model learns that too.
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage, encodeJpeg, encodePng } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { downsample, readRowCrop, rowCropOverlay, type RowCropStage } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { GREEN_DEFAULTS, greenMaskWithExcess } from "../../src/lib/directGeoref/green";
import type { RuntimeCropProfile } from "../../src/lib/cropProfiles/runtime";
import { runtimePath } from "../cropProfiles/fsProfiles";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const PHOTOS = arg("photos", "directtestimagery/midphase")!;
const STAGE = arg("stage", "mid") as RowCropStage;
const TAG = arg("tag", STAGE)!;
const GSD = arg("gsd-cm") ? Number(arg("gsd-cm")) / 100 : null;
const TILE = 448;
const OUT = join(PHOTOS, "outputs", "seg-weak", TAG);
const profile = JSON.parse(readFileSync(runtimePath("corn"), "utf8")) as RuntimeCropProfile;

/** Scanline fill of a polygon into `mask` (work scale) with `value`, only where `where` passes. */
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

const files = existsSync(PHOTOS) ? readdirSync(PHOTOS).filter(f => /\.(jpe?g|png)$/i.test(f)).sort() : [];
if (!files.length) { console.error(`no photos in ${PHOTOS}`); process.exit(1); }
mkdirSync(join(OUT, "tiles"), { recursive: true }); mkdirSync(join(OUT, "masks"), { recursive: true });
const manifest: { tile: string; mask: string; photo: string; x: number; y: number; shares: number[] }[] = [];
for (const f of files) {
  const raw = decodeImage(new Uint8Array(readFileSync(join(PHOTOS, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const read = readRowCrop(px, rowCropParamsFor(profile, GSD, STAGE));
  if (!read.rows.length) { console.log(`${f}: no rows, skipped`); continue; }
  // The reader's own green mask at its work scale.
  const fac = read.workFactor, work = downsample(px, fac), W = work.W, H = work.H;
  const gsdW = read.gsdM * fac;
  const soilTilePx = GSD ? Math.max(16, Math.min(256, Math.round(0.64 / gsdW))) : 64;
  const { mask: green } = greenMaskWithExcess({ width: W, height: H, rgba: work.rgba }, { ...GREEN_DEFAULTS, index: "exgr-soil", soilTilePx, cellPx: 1, soilCapAboveGlobal: 0.05 });
  // Labels: start with soil 0 / green 255 (unjudged), then bands -> crop, weeds -> weed, excluded -> ignore.
  const lab = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) lab[i] = green[i] ? 255 : 0;
  const o = rowCropOverlay(read);
  const toWork = (pts: [number, number][]): [number, number][] => pts.map(([x, y]) => [x / fac, y / fac]);
  for (let r = 0; r < read.rows.length; r++) { const left = o.bands[2 * r], right = o.bands[2 * r + 1]; fillPolygon(lab, W, H, toWork([...left, ...[...right].reverse()]), 1, i => green[i] === 1); }
  for (const h of [...o.weeds, ...o.escapes]) fillPolygon(lab, W, H, toWork(h), 2, i => green[i] === 1);
  for (const e of o.excluded) fillPolygon(lab, W, H, toWork(e), 255, () => true);
  // Ground the reader did not judge (no rows there): leave soil as background only within a pitch of a row; mark the rest ignore.
  // Approximation: a bounding strip around all bands. Pixels whose nearest band polygon is far are ignored.
  const near = new Uint8Array(W * H);
  const reach = read.pitchM ? (read.pitchM / gsdW) : 50;
  for (let r = 0; r < read.rows.length; r++) {
    const left = toWork(o.bands[2 * r]), right = toWork(o.bands[2 * r + 1]);
    // Grow the band polygon outward by `reach` along its normals: a wider strip.
    const wide: [number, number][] = [];
    for (let i = 0; i < left.length; i++) { const [lx, ly] = left[i], [rx, ry] = right[i]; const dx = lx - rx, dy = ly - ry, L = Math.hypot(dx, dy) || 1; wide.push([lx + (dx / L) * reach, ly + (dy / L) * reach]); }
    for (let i = right.length - 1; i >= 0; i--) { const [lx, ly] = left[i], [rx, ry] = right[i]; const dx = rx - lx, dy = ry - ly, L = Math.hypot(dx, dy) || 1; wide.push([rx + (dx / L) * reach, ry + (dy / L) * reach]); }
    fillPolygon(near, W, H, wide, 1, () => true);
  }
  for (let i = 0; i < W * H; i++) if (!near[i]) lab[i] = 255;
  // Tiles at native pixels.
  const name = basename(f, extname(f));
  let kept = 0;
  for (let ty = 0; ty + TILE <= px.height; ty += TILE) for (let tx = 0; tx + TILE <= px.width; tx += TILE) {
    const tile = new Uint8Array(TILE * TILE * 4), m = new Uint8Array(TILE * TILE * 4);
    const counts = [0, 0, 0, 0];
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const si = ((ty + y) * px.width + tx + x) * 4, di = (y * TILE + x) * 4;
      tile[di] = px.rgba[si]; tile[di + 1] = px.rgba[si + 1]; tile[di + 2] = px.rgba[si + 2]; tile[di + 3] = 255;
      const wx = Math.min(W - 1, Math.floor((tx + x) / fac)), wy = Math.min(H - 1, Math.floor((ty + y) / fac));
      const v = lab[wy * W + wx]; m[di] = v; m[di + 1] = v; m[di + 2] = v; m[di + 3] = 255;
      counts[v === 255 ? 3 : v]++;
    }
    const n = TILE * TILE;
    if (counts[3] / n > 0.6 || counts[1] + counts[2] === 0) continue; // mostly unjudged, or no crop at all
    const stem = `${name}_${tx}_${ty}`;
    writeFileSync(join(OUT, "tiles", `${stem}.jpg`), encodeJpeg({ width: TILE, height: TILE, data: tile }, 92));
    writeFileSync(join(OUT, "masks", `${stem}.png`), encodePng({ width: TILE, height: TILE, data: m }));
    manifest.push({ tile: `tiles/${stem}.jpg`, mask: `masks/${stem}.png`, photo: f, x: tx, y: ty, shares: counts.map(c => +(c / n).toFixed(3)) });
    kept++;
  }
  console.log(`${f}: rows ${read.rows.length}, weeds ${read.weeds.length}, tiles kept ${kept}`);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ photos: PHOTOS, stage: STAGE, tile: TILE, gsdCm: GSD ? GSD * 100 : "assumed", classes: { 0: "background", 1: "crop", 2: "weed", 255: "ignore" }, tiles: manifest }, null, 1));
console.log(`wrote ${manifest.length} tiles to ${OUT}`);
