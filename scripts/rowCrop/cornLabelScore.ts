// Development only: a photograph's own corn marks, and the field's corn dots, scored against hand labels on that
// photograph. Nothing is changed; the photographs, the stored flight and the labels are only read.
//
//   npx vite-node scripts/rowCrop/cornLabelScore.ts -- --analysis <analysis.json> --cache <candidate cache> --photos <dir>
//       --labels <corn-labels-all.json> --image <labelled photograph> --out <dir> [--area x,y,w,h] [--grid 4] [--overview] [--misses <dir>]
//
// The labels are the corn-labeler's file: { images: [{ image, width, height, points: [{ x, y, type: "plant" | "unsure" }] }] },
// pixels of the original photograph. --area is the part of the photograph that was labelled (default: all of it).
//
// THE SPLIT, made before anything is read: the area is cut into --grid x --grid tiles (default 4 x 4), alternating like
// a chessboard, the top-left tile DEV, the other colour HELD-BACK. A label in a held-back tile is dropped as the file
// is read: it is never matched, counted, printed or drawn, and no picture shows a held-back tile's ground.
//
// --overview: draws the labels alone over each labelled photograph (no marks, no score).
// --misses <dir>: only run b (this branch, the sweep off) at half the plant spacing, judged as below, and then why its
//   plants not found were left off the rows (cornLabelMisses.ts), written to <dir>. No score is written and no tile of the score drawn.
//
// A) The photograph's own marks, before anything is merged across photographs, at each bar a build reads it at:
//      strict    the plant read's marks (CornPhotoRead.plants; seedlingGreen.ts SEEDLING_GREEN's dark-leaf bar)
//      low       the candidates at the lower bar as a build makes them (CornPhotoRead.low; SEEDLING_ROW), a long piece
//                split at the plant spacing one photograph assumes
//      lowfield  the same pieces as this branch carries them, split in the field at the plant spacing it measured
//                (cornPlants.ts candidatePoints)
// B) The field's final dots brought into the photograph, three runs, the loosened placement off in all three
//    (cornScoreboard.ts's variants of the same name):
//      a  base  the rules as they stood at f23efc0 (SEQUENCE_V1, PLANTS_FIRST_V1, the ground not asked)
//      b  p6    this branch, the final sweep of lone second-look marks off
//      c  p7    this branch, the final sweep on
//    A mark is a dot the rules put on a row (certain, probable, second look by 2+ photographs, second look by one). It
//    is brought into the photograph as cornPictures.ts does: through the photograph's camera, moved back by the
//    photograph's own registration shift, and kept only if the pixel it lands on looks back at the dot's own ground
//    position (5 cm). A label's place in the field is its pixel through the same camera and shift.
//
// Matching, per dev tile: the tile's "plant" labels against the marks in the tile and within the matching distance
// outside it, one to one, the most pairs that can be made (each label tries its nearest mark first). The distance is
// half the plant spacing the rules measured (B also at one full spacing), on the ground. Then each "unsure" label of
// the tile takes one mark no plant took: that mark is neither right nor wrong. A mark in the tile left over is WRONG
// (a second mark on one plant is left over), except a left-over mark within the matching distance of the tile's own
// edge: its plant may stand in the next tile, whose labels are not read, so it is counted apart as "at the edge, not
// judged". Count error: the marks in the tile, less those on an unsure label, minus the plants labelled in it.
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import { groundToPixel, pixelToGround } from "../../src/lib/directGeoref/projection";
import { type CornPhotoRead, FIELD, cornFieldAndGround, type FieldGround } from "../../src/lib/fieldTwin/cornField";
import { type CornPlantsOptions, candidatePoints, placeDots, readRows } from "../../src/lib/fieldTwin/cornPlants";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { PLANTS_FIRST, PLANTS_FIRST_V1, SEQUENCE, SEQUENCE_V1, shiftOf } from "../../src/lib/fieldTwin/plantsFirst";
import { SEEDLING_GREEN, SEEDLING_ROW } from "../../src/lib/rowCrop/seedlingGreen";
import { fromEnu, toEnu } from "../../src/lib/sourceFrames/odm";
import { diagnose } from "./cornLabelMisses";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
const DIR = arg("photos"), OUT = arg("out"), OVERVIEW = argv.includes("--overview"), LOOKS_BACK_M = 0.05;
mkdirSync(OUT, { recursive: true });
type Label = { x: number; y: number; type: "plant" | "unsure" };
type Labels = { images: { image: string; width: number; height: number; points: Label[] }[] };
const LABELS = JSON.parse(readFileSync(arg("labels"), "utf8")) as Labels;
const photoPath = (image: string) => { const stem = image.replace(/\.[^.]+$/, ""); return [".JPG", ".jpg", ".jpeg"].map(e => join(DIR, stem + e)).find(existsSync) ?? null; };

type Rgb = [number, number, number];
type Canvas = { w: number; h: number; data: Uint8Array };
const px = (c: Canvas, x: number, y: number, col: Rgb) => { const xx = Math.round(x), yy = Math.round(y); if (xx < 0 || yy < 0 || xx >= c.w || yy >= c.h) return; const o = (yy * c.w + xx) * 4; c.data[o] = col[0]; c.data[o + 1] = col[1]; c.data[o + 2] = col[2]; c.data[o + 3] = 255; };
const ring = (c: Canvas, x: number, y: number, r: number, t: number, col: Rgb) => { for (let dy = -r - t; dy <= r + t; dy++) for (let dx = -r - t; dx <= r + t; dx++) { const d = Math.hypot(dx, dy); if (d >= r && d <= r + t) px(c, x + dx, y + dy, col); } };
const disc = (c: Canvas, x: number, y: number, r: number, col: Rgb) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.hypot(dx, dy) <= r) px(c, x + dx, y + dy, col); };
const square = (c: Canvas, x: number, y: number, r: number, t: number, col: Rgb) => { for (let d = -r; d <= r; d++) for (let k = 0; k < t; k++) { px(c, x + d, y - r + k, col); px(c, x + d, y + r - k, col); px(c, x - r + k, y + d, col); px(c, x + r - k, y + d, col); } };
const cross = (c: Canvas, x: number, y: number, r: number, t: number, col: Rgb) => { for (let d = -r; d <= r; d++) for (let k = 0; k < t; k++) { px(c, x + d + k, y + d, col); px(c, x + d + k, y - d, col); } };
const box = (c: Canvas, x: number, y: number, w: number, h: number, t: number, col: Rgb) => { for (let k = 0; k < t; k++) { for (let i = 0; i < w; i++) { px(c, x + i, y + k, col); px(c, x + i, y + h - 1 - k, col); } for (let j = 0; j < h; j++) { px(c, x + k, y + j, col); px(c, x + w - 1 - k, y + j, col); } } };
const G: Record<string, string> = {
  A: "01110100011000111111100011000110001", B: "11110100011000111110100011000111110", C: "01110100011000010000100001000101110", D: "11110100011000110001100011000111110",
  E: "11111100001000011110100001000011111", F: "11111100001000011110100001000010000", G: "01110100011000010111100011000101111", H: "10001100011000111111100011000110001",
  I: "01110001000010000100001000010001110", J: "00111000100001000010000101001001100", K: "10001100101010011000101001001010001", L: "10000100001000010000100001000011111",
  M: "10001110111010110101100011000110001", N: "10001110011010110011100011000110001", O: "01110100011000110001100011000101110", P: "11110100011000111110100001000010000",
  Q: "01110100011000110001101011001001101", R: "11110100011000111110101001001010001", S: "01111100001000001110000010000111110", T: "11111001000010000100001000010000100",
  U: "10001100011000110001100011000101110", V: "10001100011000110001100010101000100", W: "10001100011000110101101011101110001", X: "10001100010101000100010101000110001",
  Y: "10001100010101000100001000010000100", Z: "11111000010001000100010001000011111",
  "0": "01110100011001110101110011000101110", "1": "00100011000010000100001000010001110", "2": "01110100010000100010001000100011111", "3": "11110000010000101110000010000111110",
  "4": "00010001100101010010111110001000010", "5": "11111100001111000001000011000101110", "6": "00110010001000011110100011000101110", "7": "11111000010001000100010000100001000",
  "8": "01110100011000101110100011000101110", "9": "01110100011000101111000010001001100",
  ":": "00000001000010000000001000010000000", ",": "00000000000000000000001000010001000", ".": "00000000000000000000000000110001100", "+": "00000001000010011111001000010000000",
  "-": "00000000000000011111000000000000000", "(": "00010001000100001000010000010000010", ")": "01000001000001000010000100010001000", "/": "00001000010001000100010001000010000", "=": "00000000001111100000111110000000000",
};
const text = (c: Canvas, x: number, y: number, s: string, sc: number, col: Rgb) => { let cx = x; for (const ch of s.toUpperCase()) { const g = G[ch]; if (g) for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (g[r * 5 + q] === "1") for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) px(c, cx + q * sc + dx, y + r * sc + dy, col); cx += 6 * sc; } };
/** A part of a photograph cut out and enlarged `z` times under a dark band `head` pixels high. */
const cut = (img: { width: number; height: number; data: Uint8Array }, x0: number, y0: number, w: number, h: number, z: number, head: number): Canvas => {
  const c: Canvas = { w: w * z, h: h * z + head, data: new Uint8Array(w * z * (h * z + head) * 4) };
  for (let i = 0; i < c.w * c.h; i++) { c.data[i * 4] = 20; c.data[i * 4 + 1] = 20; c.data[i * 4 + 2] = 20; c.data[i * 4 + 3] = 255; }
  for (let y = 0; y < h * z; y++) for (let x = 0; x < w * z; x++) { const sx = x0 + Math.floor(x / z), sy = y0 + Math.floor(y / z); if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue; const q = (sy * img.width + sx) * 4, p = ((y + head) * c.w + x) * 4; c.data[p] = img.data[q]; c.data[p + 1] = img.data[q + 1]; c.data[p + 2] = img.data[q + 2]; }
  return c;
};
const GREEN: Rgb = [60, 255, 90], RED: Rgb = [255, 40, 40], ORANGE: Rgb = [255, 140, 0], GREY: Rgb = [170, 170, 170], VIOLET: Rgb = [190, 130, 255], WHITE: Rgb = [255, 255, 255];

if (OVERVIEW) {
  // The labels alone, the photograph's labelled part at its own size: plant green, unsure violet.
  for (const im of LABELS.images) {
    if (!im.points.length) { console.log(`${im.image}: no labels`); continue; }
    const path = photoPath(im.image); if (!path) { console.log(`${im.image}: no file`); continue; }
    const img = decodeImage(new Uint8Array(readFileSync(path)));
    const x0 = Math.max(0, Math.floor(Math.min(...im.points.map(p => p.x)) - 250)), x1 = Math.min(img.width, Math.ceil(Math.max(...im.points.map(p => p.x)) + 250));
    const y0 = Math.max(0, Math.floor(Math.min(...im.points.map(p => p.y)) - 250)), y1 = Math.min(img.height, Math.ceil(Math.max(...im.points.map(p => p.y)) + 250));
    const c = cut(img, x0, y0, x1 - x0, y1 - y0, 1, 0);
    for (const p of im.points) ring(c, p.x - x0, p.y - y0, 7, 2, p.type === "plant" ? GREEN : VIOLET);
    for (let gx = Math.ceil(x0 / 250) * 250; gx < x1; gx += 250) { for (let y = 0; y < c.h; y += 4) px(c, gx - x0, y, WHITE); text(c, gx - x0 + 4, 4, String(gx), 3, WHITE); }
    for (let gy = Math.ceil(y0 / 250) * 250; gy < y1; gy += 250) { for (let x = 0; x < c.w; x += 4) px(c, x, gy - y0, WHITE); text(c, 4, gy - y0 + 4, String(gy), 3, WHITE); }
    const stem = im.image.replace(/\.[^.]+$/, "").slice(-6, -2);
    writeFileSync(join(OUT, `labels-${stem}.jpg`), encodeJpeg({ width: c.w, height: c.h, data: c.data }, 85));
    // The same at a third of the size, to see the whole of it at once.
    const k = 3, s: Canvas = { w: Math.floor(c.w / k), h: Math.floor(c.h / k), data: new Uint8Array(Math.floor(c.w / k) * Math.floor(c.h / k) * 4) };
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { let r = 0, g = 0, b = 0; for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) { const q = ((y * k + dy) * c.w + x * k + dx) * 4; r += c.data[q]; g += c.data[q + 1]; b += c.data[q + 2]; } const p = (y * s.w + x) * 4; s.data[p] = r / (k * k); s.data[p + 1] = g / (k * k); s.data[p + 2] = b / (k * k); s.data[p + 3] = 255; }
    writeFileSync(join(OUT, `labels-${stem}-small.jpg`), encodeJpeg({ width: s.w, height: s.h, data: s.data }, 85));
    console.log(`${im.image}: ${im.points.filter(p => p.type === "plant").length} plant, ${im.points.filter(p => p.type === "unsure").length} unsure; drawn x ${x0}-${x1}, y ${y0}-${y1}`);
  }
  process.exit(0);
}


const CACHE = arg("cache"), IMAGE = arg("image"), GRID = Number(opt("grid") ?? 4), MISSES = opt("misses");
if (MISSES) mkdirSync(MISSES, { recursive: true });
const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, frames = framesFromAnalysis(A);
const STEM = IMAGE.replace(/\.[^.]+$/, ""), TAG = STEM.slice(-6, -2), read = A.reads.find(r => r.name === STEM), f = frames.get(STEM);
if (!read || !f) throw new Error(`${IMAGE} is not a photograph of this flight (${A.twinId}, ${A.reads.length} photographs)`);
const W = f.intrinsics.width, H = f.intrinsics.height, altM = (f.ground as { altM: number }).altM ?? 0;
const IM = LABELS.images.find(x => x.image === IMAGE); if (!IM) throw new Error(`${IMAGE}: no labels in the file`);
if (IM.width !== W || IM.height !== H) throw new Error(`${IMAGE}: labelled at ${IM.width} x ${IM.height}, the flight's photograph is ${W} x ${H}`);
const AREA = (() => { const a = opt("area"); if (!a) return { x: 0, y: 0, w: W, h: H }; const [x, y, w, h] = a.split(",").map(Number); return { x, y, w, h }; })();

// The split. Tile r, c (from 1, top-left first); dev where r + c is even.
type Tile = { id: string; x: number; y: number; w: number; h: number };
const edge = (o: number, len: number, k: number) => Math.round(o + (len * k) / GRID);
const DEV: Tile[] = [];
for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) if ((r + c) % 2 === 0) { const x = edge(AREA.x, AREA.w, c), y = edge(AREA.y, AREA.h, r); DEV.push({ id: `r${r + 1}c${c + 1}`, x, y, w: edge(AREA.x, AREA.w, c + 1) - x, h: edge(AREA.y, AREA.h, r + 1) - y }); }
const within = (t: Tile, u: number, v: number, pad = 0) => u >= t.x - pad && u < t.x + t.w + pad && v >= t.y - pad && v < t.y + t.h + pad;
// Only the dev tiles' labels are kept; the rest of the file is let go here.
const LAB = new Map(DEV.map(t => [t.id, IM.points.filter(p => within(t, p.x, p.y))]));
console.log(`${IMAGE} is photograph ${A.reads.indexOf(read) + 1} of ${A.reads.length} in ${A.twinId}. Area x ${AREA.x}-${AREA.x + AREA.w}, y ${AREA.y}-${AREA.y + AREA.h}; ${GRID} x ${GRID} tiles, ${DEV.length} dev: ${DEV.map(t => t.id).join(" ")}`);

type Mark = { u: number; v: number; e: number; n: number; tier: number; /** The field dot it is (B). */ i?: number };
type Score = { tile: string; labelled: number; unsure: number; marks: number[]; found: number[]; wrong: number[]; onUnsure: number[]; atEdge: number[]; missed: number };
type Judged = { score: Score; ms: Mark[]; state: Int8Array; plantFound: boolean[]; /** Per labelled plant: the mark it has (index into `ms`), or -1. */ plantOf: Int32Array };
const TIERS = ["certain", "probable", "second look, 2+ photographs", "second look, 1 photograph", "loosened"] as const;
const TIER_COL: Rgb[] = [[255, 255, 255], [120, 220, 255], [255, 214, 40], [255, 70, 200], [255, 120, 0]];

/** One dev tile judged: `marks` in the photograph with their place on the ground, `place` a pixel's place on the same ground, `R` metres. */
function judge(t: Tile, marks: Mark[], place: (u: number, v: number) => [number, number] | null, R: number): Judged & { pad: number } {
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2, g0 = place(cx, cy), g1 = place(cx + 100, cy), g2 = place(cx, cy + 100);
  if (!g0 || !g1 || !g2) throw new Error(`${t.id}: the photograph's camera does not reach the ground there`);
  const pad = (R * 100) / ((Math.hypot(g1[0] - g0[0], g1[1] - g0[1]) + Math.hypot(g2[0] - g0[0], g2[1] - g0[1])) / 2);
  const labs = LAB.get(t.id)!.map(p => { const g = place(p.x, p.y); if (!g) throw new Error(`${t.id}: a label the camera does not put on the ground`); return { ...p, e: g[0], n: g[1] }; });
  const plants = labs.filter(l => l.type === "plant"), unsure = labs.filter(l => l.type === "unsure"), ms = marks.filter(k => within(t, k.u, k.v, pad)), msIn = ms.map(k => within(t, k.u, k.v));
  const near = (l: { e: number; n: number }[]) => l.map(a => ms.map((k, j) => [Math.hypot(k.e - a.e, k.n - a.n), j] as [number, number]).filter(x => x[0] <= R).sort((x, y) => x[0] - y[0]));
  // taken[j]: the label that has mark j, -1 free, -2 not to be had.
  const match = (cand: [number, number][][], taken: Int32Array) => {
    const of = new Int32Array(cand.length).fill(-1), order = cand.map((c, i) => [c.length ? c[0][0] : Infinity, i] as [number, number]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
    const tryL = (i: number, seen: Set<number>): boolean => { for (const [, j] of cand[i]) { if (taken[j] === -2 || seen.has(j)) continue; seen.add(j); if (taken[j] < 0 || tryL(taken[j], seen)) { taken[j] = i; of[i] = j; return true; } } return false; };
    for (const i of order) tryL(i, new Set());
    // A label an augmenting path moved to another mark: read back from the marks.
    of.fill(-1); taken.forEach((i, j) => { if (i >= 0) of[i] = j; });
    return of;
  };
  const takenP = new Int32Array(ms.length).fill(-1), plantOf = match(near(plants), takenP);
  const takenU = Int32Array.from(takenP, x => (x >= 0 ? -2 : -1)); match(near(unsure), takenU);
  const s: Score = { tile: t.id, labelled: plants.length, unsure: unsure.length, marks: [0, 0, 0, 0, 0], found: [0, 0, 0, 0, 0], wrong: [0, 0, 0, 0, 0], onUnsure: [0, 0, 0, 0, 0], atEdge: [0, 0, 0, 0, 0], missed: 0 };
  // 1 on a labelled plant, 2 on an unsure label, 3 left over at the tile's edge (not judged), 0 left over (wrong), 4 outside the tile and left over (not this tile's).
  const state = new Int8Array(ms.length);
  ms.forEach((k, j) => {
    const nearEdge = k.u < t.x + pad || k.u >= t.x + t.w - pad || k.v < t.y + pad || k.v >= t.y + t.h - pad;
    state[j] = takenP[j] >= 0 ? 1 : takenU[j] >= 0 ? 2 : !msIn[j] ? 4 : nearEdge ? 3 : 0;
    if (!msIn[j]) return;
    s.marks[k.tier]++; if (state[j] === 0) s.wrong[k.tier]++; else if (state[j] === 2) s.onUnsure[k.tier]++; else if (state[j] === 3) s.atEdge[k.tier]++;
  });
  const plantFound = plants.map((_, i) => plantOf[i] >= 0);
  plants.forEach((_, i) => { if (plantOf[i] >= 0) s.found[ms[plantOf[i]].tier]++; else s.missed++; });
  return { score: s, ms, state, plantFound, plantOf, pad };
}
const sum = (a: number[]) => a.reduce((t, x) => t + x, 0);
let IMG: { width: number; height: number; data: Uint8Array } | null = null;
/** The tile's picture: the tile alone (not a pixel of its neighbours), twice its size, under its legend. */
function draw(t: Tile, J: Judged, file: string, title: string, rings: string, extra: Mark[] = []) {
  IMG ??= decodeImage(new Uint8Array(readFileSync(photoPath(IMAGE)!)));
  const Z = 2, HEAD = 220, c = cut(IMG, t.x, t.y, t.w, t.h, Z, HEAD), at = (u: number, v: number): [number, number] => [(u - t.x) * Z, (v - t.y) * Z + HEAD], s = J.score;
  for (const k of extra) if (within(t, k.u, k.v)) { const [x, y] = at(k.u, k.v); ring(c, x, y, 5, 1, GREY); }
  const labs = LAB.get(t.id)!, plants = labs.filter(l => l.type === "plant");
  plants.forEach((l, i) => { const [x, y] = at(l.x, l.y); if (J.plantFound[i]) disc(c, x, y, 3, GREEN); else { square(c, x, y, 14, 3, RED); disc(c, x, y, 3, RED); } });
  labs.filter(l => l.type === "unsure").forEach(l => { const [x, y] = at(l.x, l.y); cross(c, x, y, 6, 2, VIOLET); });
  J.ms.forEach((k, j) => { if (!within(t, k.u, k.v)) return; const [x, y] = at(k.u, k.v), st = J.state[j]; if (st === 1) ring(c, x, y, 10, 2, TIER_COL[k.tier]); else if (st === 2) ring(c, x, y, 10, 1, VIOLET); else if (st === 3) ring(c, x, y, 10, 1, GREY); else if (st === 0) { ring(c, x, y, 12, 3, ORANGE); cross(c, x, y, 7, 2, ORANGE); } });
  // The legend band is drawn last, over anything a ring put into it.
  for (let i = 0; i < c.w * HEAD; i++) { c.data[i * 4] = 20; c.data[i * 4 + 1] = 20; c.data[i * 4 + 2] = 20; }
  const leg: [Rgb, string][] = [
    [WHITE, `TILE ${t.id} OF PHOTO ${TAG} (X ${t.x}-${t.x + t.w}, Y ${t.y}-${t.y + t.h}): ${title}`],
    [GREEN, `GREEN SPOT = A PLANT YOU LABELLED, FOUND: ${sum(s.found)} OF ${s.labelled}`],
    [WHITE, rings],
    [RED, `RED SQUARE = A PLANT YOU LABELLED WITH NO MARK ON IT: ${s.missed}`],
    [ORANGE, `ORANGE RING WITH A CROSS = A MARK THAT IS WRONG: ${sum(s.wrong)}`],
    [VIOLET, `VIOLET CROSS = YOUR UNSURE LABEL (${s.unsure}); THIN VIOLET RING = A MARK ON ONE, COUNTS FOR NOTHING (${sum(s.onUnsure)})`],
    [GREY, `THIN GREY RING = A LEFT-OVER MARK AT THE TILE EDGE, NOT JUDGED (${sum(s.atEdge)})${extra.length ? ". SMALL GREY RING = A DOT ON NO ROW, NOT A MARK" : ""}`],
  ];
  leg.forEach(([col, str], li) => text(c, 12, 10 + li * 30, str, 3, col));
  writeFileSync(join(OUT, file), encodeJpeg({ width: c.w, height: c.h, data: c.data }, 88));
}

// ---- B: the field's final dots, three runs.
type Variant = { key: string; what: string; spans: boolean; opts: (ground: FieldGround | null) => CornPlantsOptions };
const RUNS: Variant[] = [
  { key: "a-old-rules", what: "the old rules: every switch from this branch off (SEQUENCE_V1, PLANTS_FIRST_V1, the ground not asked; cornScoreboard.ts `base`)", spans: false, opts: () => ({ sequence: SEQUENCE_V1, placing: PLANTS_FIRST_V1 }) },
  { key: "b-branch-sweep-off", what: "this branch, the lone-mark sweep off (cornScoreboard.ts `p6`)", spans: true, opts: ground => ({ sequence: { ...SEQUENCE, sweepLoneMarks: false }, ground, placing: PLANTS_FIRST }) },
  { key: "c-branch-sweep-on", what: "this branch, the lone-mark sweep on (cornScoreboard.ts `p7`)", spans: true, opts: ground => ({ sequence: { ...SEQUENCE, sweepLoneMarks: true }, ground, placing: PLANTS_FIRST }) },
];
type Cached = { applies?: boolean; plantsMatch?: boolean; low: [number, number][]; lowWhole?: [number, number][]; span?: [number, number][]; axis?: [number, number] | null };
const cached = (name: string): Cached | null => { const p = join(CACHE, `${name}.json`); return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Cached) : null; };
// The record's reads with their candidates, as cornScoreboard.ts joins them.
const readsFor = (spans: boolean): CornPhotoRead[] => A.reads.map(r => {
  const { low: _l, lowSpan: _s, lowAxis: _a, ...rest } = r, c = cached(r.name);
  if (!c?.applies) return rest;
  if (spans && c.axis && c.lowWhole && c.span) return { ...rest, low: c.lowWhole, lowSpan: c.span, lowAxis: c.axis };
  return { ...rest, low: c.low };
});
const B: { run: string; what: string; plantSpacingM: number; wholeFlightOnRows: number[]; wholeFlightOnNoRow: number; landed: number; foldedBack: number; marksInPhoto: number[]; noRowInPhoto: number; half: (Score & { missedWithADotOnNoRow: number; noRowDots: number })[]; full: Score[] }[] = [];
let origin: { lat: number; lng: number; altM: number } | null = null;
for (const run of MISSES ? RUNS.filter(r => r.key === "b-branch-sweep-off") : RUNS) {
  const t0 = Date.now(), reads = readsFor(run.spans);
  // The field does not read the candidates (cornScoreboard.ts), so it is the same field in all three runs; made again each run all the same.
  const { field: F, ground } = cornFieldAndGround(reads, frames, A.fieldOptions ?? FIELD);
  origin ??= F.origin;
  const opts = run.opts(ground), P = placeDots(reads, frames, F, opts); if (!P) throw new Error("the photographs made no dot");
  const rec = readRows(P, F, opts), n = P.all.length, seedM = rec.geometry.seedM, pi = P.photos.indexOf(STEM);
  if (seedM == null) throw new Error(`${run.key}: the plant spacing is not measured on this flight, so there is no matching distance`);
  if (pi < 0) throw new Error(`${IMAGE} is not among the photographs the dots were made from`);
  // -1 on no row; else the tier, as cornScoreboard.ts counts it.
  const tierOf = (i: number) => (rec.rowOf[i] < 0 ? -1 : rec.loose[i] || P.tier?.[i] === 3 ? 4 : P.tier?.[i] === 1 ? 2 : P.tier?.[i] === 2 ? 3 : rec.certainty[i] === 0 ? 0 : 1);
  const whole = [0, 0, 0, 0, 0]; let onNoRow = 0; for (let i = 0; i < n; i++) { const t = tierOf(i); if (t >= 0) whole[t]++; else if (i < P.strict) onNoRow++; }
  // A field dot in this photograph, and whether its pixel looks back at it (cornPictures.ts pixelOf).
  const pixelOf = (e: number, nn: number): [number, number, boolean] | null => {
    let de = 0, dn = 0, u = 0, v = 0;
    for (let it = 0; it < 4; it++) { const p = fromEnu([e - de, nn - dn, 0], F.origin), h = groundToPixel(f, p.lat, p.lng, altM); if (!h) return null; u = h.u; v = h.v; [de, dn] = shiftOf(P.shifts[pi], u, v); }
    if (u < 0 || v < 0 || u >= W || v >= H) return null;
    const g = pixelToGround(f, u, v); if (!g) return [u, v, false];
    const b = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, F.origin), [se, sn] = shiftOf(P.shifts[pi], u, v);
    return [u, v, Math.hypot(b[0] + se - e, b[1] + sn - nn) <= LOOKS_BACK_M];
  };
  const place = (u: number, v: number): [number, number] | null => { const g = pixelToGround(f, u, v); if (!g) return null; const b = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, F.origin), [se, sn] = shiftOf(P.shifts[pi], u, v); return [b[0] + se, b[1] + sn]; };
  let landed = 0, fold = 0; const marks: Mark[] = [], noRow: Mark[] = [], inPhoto = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const t = tierOf(i); if (t < 0 && i >= P.strict) continue;
    const q = pixelOf(P.all[i].e, P.all[i].n); if (!q) continue;
    landed++; if (!q[2]) { fold++; continue; }
    (t >= 0 ? marks : noRow).push({ u: q[0], v: q[1], e: P.all[i].e, n: P.all[i].n, tier: Math.max(0, t), i }); if (t >= 0) inPhoto[t]++;
  }
  const half = DEV.map(t => {
    const J = judge(t, marks, place, seedM / 2), nr = noRow.filter(k => within(t, k.u, k.v, J.pad));
    // Not scored, told beside it: the dots the rules left on no row, and the labelled plants not found that have one on them.
    const plants = LAB.get(t.id)!.filter(l => l.type === "plant").map(l => place(l.x, l.y)!);
    const withNoRow = plants.filter((g, i) => !J.plantFound[i] && nr.some(k => Math.hypot(k.e - g[0], k.n - g[1]) <= seedM / 2)).length;
    if (!MISSES) draw(t, J, `B-${run.key}-${t.id}.jpg`, `THE FIELD DOTS BROUGHT INTO THIS PHOTO, RUN ${run.key[0].toUpperCase()}: ${run.key.slice(2).toUpperCase().replace(/-/g, " ")}`, `RING ON A FOUND PLANT: WHITE CERTAIN ${J.score.found[0]}, BLUE PROBABLE ${J.score.found[1]}, YELLOW SECOND LOOK 2+ ${J.score.found[2]}, PINK SECOND LOOK 1 ${J.score.found[3]}`, noRow);
    return { ...J.score, missedWithADotOnNoRow: withNoRow, noRowDots: noRow.filter(k => within(t, k.u, k.v)).length };
  });
  const full = DEV.map(t => judge(t, marks, place, seedM).score);
  B.push({ run: run.key, what: run.what, plantSpacingM: seedM, wholeFlightOnRows: whole, wholeFlightOnNoRow: onNoRow, landed, foldedBack: fold, marksInPhoto: inPhoto, noRowInPhoto: noRow.length, half, full });
  console.log(`${run.key}: plant spacing ${seedM} m; whole flight on rows ${JSON.stringify(whole)}; in the photograph ${JSON.stringify(inPhoto)} (${landed} dots land, ${fold} folded back and left out); ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const s of half) console.log(`  ${s.tile}: labelled ${s.labelled}, found ${JSON.stringify(s.found)}, wrong ${JSON.stringify(s.wrong)}, marks ${JSON.stringify(s.marks)}, on unsure ${JSON.stringify(s.onUnsure)}, at edge ${JSON.stringify(s.atEdge)}, missed ${s.missed}`);
  if (MISSES) {
    diagnose({ out: MISSES, tag: TAG, reads, frames, F, ground, opts, P, rec, pi, tiles: DEV, labels: LAB, marks, noRow, place, pixelOf, judge, within,
      image: () => (IMG ??= decodeImage(new Uint8Array(readFileSync(photoPath(IMAGE)!)))), cut, ring, disc, square, text, encode: c => encodeJpeg({ width: c.w, height: c.h, data: c.data }, 88) });
    process.exit(0);
  }
}

// ---- A: the photograph's own marks, before anything is merged. Its own camera, no registration shift.
const seeds = [...new Set(B.map(b => b.plantSpacingM))]; if (seeds.length !== 1) console.log(`the runs measured different plant spacings (${seeds.join(", ")}); A uses run c's`);
const SEED = B[B.length - 1].plantSpacingM, O = origin!;
const own = (u: number, v: number): [number, number] | null => { const g = pixelToGround(f, u, v); if (!g) return null; const b = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, O); return [b[0], b[1]]; };
const asMarks = (pts: [number, number][]): Mark[] => pts.flatMap(([x, y]) => { const u = x * read.scale, v = y * read.scale, g = own(u, v); return g ? [{ u, v, e: g[0], n: g[1], tier: 0 }] : []; });
const C = cached(STEM); if (!C?.applies) throw new Error(`${IMAGE}: no candidates in the cache`);
const dk = SEEDLING_GREEN.dark!, dl = SEEDLING_ROW.dark!;
const SETS: { key: string; what: string; pts: [number, number][] }[] = [
  { key: "strict", what: `the stricter bar: the plant read's marks (dark-leaf tint ${dk.strongTint} strong / ${dk.weakTint} weak)`, pts: read.plants },
  { key: "low", what: `the lower bar (${dl.strongTint} / ${dl.weakTint}): the candidates as a build makes them, a long piece split at the spacing one photograph assumes`, pts: C.low },
  ...(C.lowWhole && C.span && C.axis ? [{ key: "lowfield", what: `the lower bar (${dl.strongTint} / ${dl.weakTint}): the same pieces as this branch carries them, split at the measured plant spacing`, pts: candidatePoints({ ...read, low: C.lowWhole, lowSpan: C.span, lowAxis: C.axis }, f, O, SEED) }] : []),
];
const Aout = SETS.map(S => {
  const marks = asMarks(S.pts);
  const tiles = DEV.map(t => { const J = judge(t, marks, own, SEED / 2); draw(t, J, `A-${S.key}-${t.id}.jpg`, `THIS PHOTO OWN MARKS, BEFORE MERGING: ${S.key === "strict" ? "STRICTER BAR" : S.key === "low" ? "LOWER BAR AS A BUILD SPLITS IT" : "LOWER BAR AS THIS BRANCH SPLITS IT"}`, "WHITE RING = THE MARK ON A FOUND PLANT"); return J.score; });
  console.log(`A ${S.key}: ${marks.length} marks in the photograph`);
  for (const s of tiles) console.log(`  ${s.tile}: labelled ${s.labelled}, found ${s.found[0]}, wrong ${s.wrong[0]}, marks ${s.marks[0]}, on unsure ${s.onUnsure[0]}, at edge ${s.atEdge[0]}, missed ${s.missed}`);
  return { set: S.key, what: S.what, marksInPhoto: marks.length, tiles };
});
writeFileSync(join(OUT, "score.json"), JSON.stringify({ image: IMAGE, twin: A.twinId, photographs: A.reads.length, recordPlantsEqualTheCacheRead: C.plantsMatch ?? null, area: AREA, grid: GRID, devTiles: DEV, labelsRead: { plant: sum([...LAB.values()].map(l => l.filter(p => p.type === "plant").length)), unsure: sum([...LAB.values()].map(l => l.filter(p => p.type === "unsure").length)) }, plantSpacingM: SEED, tiers: TIERS, A: Aout, B }, null, 1));
