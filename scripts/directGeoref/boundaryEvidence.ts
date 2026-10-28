// Boundary evidence, step 1: the ground as the photographs saw it, measured per cell in the field's own frame.
//
//   npx vite-node scripts/directGeoref/boundaryEvidence.ts -- [--id apricot-2021-04-27] [--cell 0.25]
//
// For every `cell` x `cell` metre square inside the imagery hull, the photograph whose nadir point is nearest is
// chosen (the least oblique view of that ground), the cell centre is projected into it with the reference cameras,
// and a small box of the quarter-size frame is measured: mean colour, excess green minus red, the share of pixels
// that are cover (COVER_EXGR) and green (ExGR > 0), brightness and its spread (texture), saturation, and how far
// the cell is from that photograph's nadir. Nothing is stitched: each cell is one measurement from one
// photograph, and a cell no photograph covered stays empty. The measurements are written as typed arrays
// (boundary/measures.bin + measures.json) and a colour picture of them (measures.png) for looking at.
// The classification of the cells into soil, cover, road, canopy and unseen is NOT done here: that is
// src/lib/fieldTwin/boundaryEvidence.ts, shared with the app and its tests, and run by boundary.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage, encodePng } from "../bench/images";
import { frameCorners, groundToPixel, pixelToGround } from "../../src/lib/directGeoref";
import { localFrame, pointInRing } from "../../src/lib/fieldTwin/intelligence";
import type { TwinBundle } from "../../src/lib/fieldTwin/types";
import { COVER_EXGR } from "../../src/lib/weedVision/fieldRows";
import { OUT, loadReference } from "./common";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ID = arg("id", "apricot-2021-04-27");
const CELL = Number(arg("cell", "0.25"));
const DIR = join(OUT, "boundary");
mkdirSync(DIR, { recursive: true });
const twinPath = join(OUT, "..", "twin", ID, "twin.json");
if (!existsSync(twinPath)) throw new Error(`no twin at ${twinPath}: run buildTwin.ts first`);
const twin = JSON.parse(readFileSync(twinPath, "utf8")) as TwinBundle;
const fr = localFrame(twin);
const { frames, model } = loadReference();
const groundAlt = model.globals.groundOffsetM;
const t0 = Date.now();

// Every photograph: its footprint and nadir point in the field frame, and its quarter-size pixels (decoded lazily).
type Photo = { name: string; ring: [number, number][]; nadir: [number, number]; box: [number, number, number, number]; img: ReturnType<typeof decodeImage> | null; down: number };
const photos: Photo[] = [];
for (const f of frames.values()) {
  const corners = frameCorners(f);
  const nadir = pixelToGround(f, f.intrinsics.cx, f.intrinsics.cy);
  if (!corners || !nadir) continue;
  const ring = corners.map(c => fr.toField(...fr.toLocal(c.lat, c.lng)));
  const n = fr.toField(...fr.toLocal(nadir.lat, nadir.lng));
  photos.push({ name: f.name, ring, nadir: n, box: [Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1])), Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))], img: null, down: 4 });
}
const along0 = Math.floor(Math.min(...photos.map(p => p.box[0])) / CELL) * CELL, across0 = Math.floor(Math.min(...photos.map(p => p.box[1])) / CELL) * CELL;
const width = Math.ceil((Math.max(...photos.map(p => p.box[2])) - along0) / CELL), height = Math.ceil((Math.max(...photos.map(p => p.box[3])) - across0) / CELL);
console.log(`${photos.length} photographs; raster ${width} x ${height} cells of ${CELL} m (${(width * CELL).toFixed(0)} x ${(height * CELL).toFixed(0)} m) from along ${along0.toFixed(1)}, across ${across0.toFixed(1)}`);

const N = width * height;
const rgb = new Uint8Array(N * 3), exgr = new Float32Array(N), cover = new Float32Array(N), green = new Float32Array(N), luma = new Float32Array(N), lumaSd = new Float32Array(N), sat = new Float32Array(N), nadirM = new Float32Array(N).fill(-1);
const photoOf = new Int16Array(N).fill(-1), photosAt = new Uint8Array(N);
const exgrOf = (r: number, g: number, b: number) => { const s = r + g + b; if (s <= 0) return -1; const rr = r / s, gg = g / s, bb = b / s; return 2 * gg - rr - bb - (1.4 * rr - gg); };

// Cells by photograph: the nearest-nadir photograph that holds the cell centre, then one decode per photograph.
const cellsBy = new Map<number, number[]>();
for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
  const al = along0 + (i + 0.5) * CELL, ac = across0 + (j + 0.5) * CELL;
  let best = -1, bd = Infinity, count = 0;
  photos.forEach((p, k) => {
    if (al < p.box[0] || al > p.box[2] || ac < p.box[1] || ac > p.box[3] || !pointInRing(al, ac, p.ring)) return;
    count++;
    const d = (p.nadir[0] - al) ** 2 + (p.nadir[1] - ac) ** 2;
    if (d < bd) { bd = d; best = k; }
  });
  const c = j * width + i;
  photosAt[c] = Math.min(255, count);
  if (best < 0) continue;
  photoOf[c] = best; nadirM[c] = Math.sqrt(bd);
  (cellsBy.get(best) ?? cellsBy.set(best, []).get(best)!).push(c);
}
console.log(`cells assigned in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const HALF = 3; // box half-width in quarter-size pixels: 7 x 7 px of about 3.9 cm, about the cell
let done = 0;
for (const [k, cells] of cellsBy) {
  const p = photos[k], f = frames.get(p.name)!;
  const img = decodeImage(new Uint8Array(readFileSync(join(OUT, "frames", `${p.name}.jpg`))));
  const down = f.intrinsics.width / img.width;
  for (const c of cells) {
    const i = c % width, j = (c - i) / width;
    const [e, n] = fr.fromField(along0 + (i + 0.5) * CELL, across0 + (j + 0.5) * CELL);
    const [lat, lng] = fr.toLatLng(e, n);
    const hit = groundToPixel(f, lat, lng, groundAlt);
    if (!hit) continue;
    const u = Math.round(hit.u / down), v = Math.round(hit.v / down);
    let R = 0, G = 0, B = 0, nPx = 0, sx = 0, cv = 0, gr = 0, L = 0, L2 = 0, S = 0;
    for (let dy = -HALF; dy <= HALF; dy++) for (let dx = -HALF; dx <= HALF; dx++) {
      const x = u + dx, y = v + dy;
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const o = (y * img.width + x) * 4, r = img.data[o], g = img.data[o + 1], b = img.data[o + 2];
      const ex = exgrOf(r, g, b), l = 0.299 * r + 0.587 * g + 0.114 * b, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      R += r; G += g; B += b; nPx++; sx += ex; if (ex > COVER_EXGR) cv++; if (ex > 0) gr++; L += l; L2 += l * l; S += mx > 0 ? (mx - mn) / mx : 0;
    }
    if (!nPx) continue;
    rgb[c * 3] = R / nPx; rgb[c * 3 + 1] = G / nPx; rgb[c * 3 + 2] = B / nPx;
    exgr[c] = sx / nPx; cover[c] = cv / nPx; green[c] = gr / nPx; luma[c] = L / nPx; lumaSd[c] = Math.sqrt(Math.max(0, L2 / nPx - (L / nPx) ** 2)); sat[c] = S / nPx;
  }
  done++;
  if (done % 10 === 0) console.log(`  ${done}/${cellsBy.size} photographs sampled (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

// The measurements: a header and the raw arrays, in a fixed order.
const parts: ArrayBufferView[] = [rgb, exgr, cover, green, luma, lumaSd, sat, nadirM, photoOf, photosAt];
const header = {
  twin: ID, cellM: CELL, along0, across0, width, height, rowDirectionDeg: twin.field.rowDirectionDeg, origin: twin.origin,
  photos: photos.map(p => p.name),
  layout: [["rgb", "Uint8", 3], ["exgr", "Float32", 1], ["cover", "Float32", 1], ["green", "Float32", 1], ["luma", "Float32", 1], ["lumaSd", "Float32", 1], ["sat", "Float32", 1], ["nadirM", "Float32", 1], ["photoOf", "Int16", 1], ["photosAt", "Uint8", 1]],
  sampledMs: Date.now() - t0,
};
writeFileSync(join(DIR, "measures.json"), JSON.stringify(header));
writeFileSync(join(DIR, "measures.bin"), Buffer.concat(parts.map(a => Buffer.from(a.buffer, a.byteOffset, a.byteLength))));
// The picture: the cells' mean colours, unseen cells dark grey.
const png = new Uint8Array(N * 4);
for (let c = 0; c < N; c++) { const o = c * 4; if (photoOf[c] < 0) { png[o] = png[o + 1] = png[o + 2] = 40; } else { png[o] = rgb[c * 3]; png[o + 1] = rgb[c * 3 + 1]; png[o + 2] = rgb[c * 3 + 2]; } png[o + 3] = 255; }
writeFileSync(join(DIR, "measures.png"), encodePng({ width, height, data: png }));
const seen = photoOf.filter(v => v >= 0).length;
console.log(`${seen} of ${N} cells measured (${((100 * seen) / N).toFixed(0)} %) in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${DIR}`);
