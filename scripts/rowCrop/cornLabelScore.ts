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
// --single: ONE photograph with no stored flight (no --analysis, no --cache). Only "A", the photograph's own marks, as a
//   build reads one photograph (fieldTwin/build/corn.ts cornPhotoRead: cornV1.ts readCornV1 at the photograph's own size):
//   the stricter bar and the lower bar. Everything is in PIXELS: the matching distance is half the median distance
//   between neighbouring "plant" labels on a row, measured on the dev tiles' labels alone. Photo Scout's read of the same
//   photograph (pages/app/PhotoScout.tsx: the same reader on the photograph drawn down to 4096 pixels) is run beside it.
// --single --touch: beside it, the touching plants (cornLabelLook.ts touchReport), written to <out>/touch.json.
// --single --cores-on: the same read with the vivid cores on (cornV1.ts CORN_CORES), in the build's read and in Photo
//                   Scout's; written to <out>/score-single-cores-on.json, pictures P-cores-on-<set>-<tile>.jpg.
// --single --cores: beside it, the plants of a green piece counted by its vivid cores (cornLabelCores.ts), written to
//                   <out>/cores.json, with the two close-together tiles drawn in the cores view beside the photograph.
// --look <dir>: only run d (this branch with the plant spacing not asked) at half the plant spacing, and what the
//   photograph's own read measures of the green under every dot of the dev tiles (cornLabelLook.ts lookReport).
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
import { decodeImage, encodeJpeg, imageSize } from "../bench/images";
import type { GeorefFrame } from "../../src/lib/directGeoref/projection";
import { compactCornRead } from "../../src/lib/fieldTwin/cornField";
import { HEADER_BYTES, estimateGsd, parsePhotoHeader } from "../../src/lib/photoScout/exif";
import { MAX_EDGE_PX } from "../../src/lib/photoScout/decode";
import { CORN_CORES, cornV1RowCandidates, greenPitchPx, readCornV1 } from "../../src/lib/rowCrop/cornV1";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { groundToPixel, pixelToGround } from "../../src/lib/directGeoref/projection";
import { type CornPhotoRead, FIELD, cornFieldAndGround, type FieldGround } from "../../src/lib/fieldTwin/cornField";
import { type CornPlantsOptions, candidatePoints, placeDots, readRows } from "../../src/lib/fieldTwin/cornPlants";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { PLANTS_FIRST, PLANTS_FIRST_V1, SEQUENCE, SEQUENCE_V1, courseAt, shiftOf } from "../../src/lib/fieldTwin/plantsFirst";
import { SEEDLING_GREEN, SEEDLING_ROW, seedlingCache } from "../../src/lib/rowCrop/seedlingGreen";
import { fromEnu, toEnu } from "../../src/lib/sourceFrames/odm";
import { diagnose } from "./cornLabelMisses";
import { lookReport, touchReport } from "./cornLabelLook";
import { type Judged as JudgedT, type Mark, type Score, type Tile, TIERS, fieldMarks, judgeTile, labelSpacingPx, labelTiles, within } from "./cornLabelJudge";
import { coresReport } from "./cornLabelCores";

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


const SINGLE = argv.includes("--single"), CORES_ON = argv.includes("--cores-on"), CORES_BLUR = argv.includes("--cores-blur") ? argv[argv.indexOf("--cores-blur") + 1].split(",").map(Number) : null, SUF = CORES_ON ? (CORES_BLUR ? `-cores-${argv.includes("--cores-tag") ? argv[argv.indexOf("--cores-tag") + 1] : "other"}` : "-cores-on") : "";
// --cores-blur <fine share>,<wide share> --cores-tag <name>: with --cores-on, another blur pair for this run only (shares of the row spacing; CORN_CORES is not changed in the code).
if (CORES_BLUR) Object.assign(CORN_CORES, { fineShare: CORES_BLUR[0], wideShare: CORES_BLUR[1] });
// --cores-reference strongest|marks: what a core is measured against, for this run only (CORN_CORES.reference otherwise).
if (argv.includes("--cores-reference")) Object.assign(CORN_CORES, { reference: argv[argv.indexOf("--cores-reference") + 1] });
const CACHE = SINGLE ? "" : arg("cache"), IMAGE = arg("image"), GRID = Number(opt("grid") ?? 4), MISSES = opt("misses");
if (MISSES) mkdirSync(MISSES, { recursive: true });
const A = (SINGLE ? { reads: [], twinId: "" } : JSON.parse(readFileSync(arg("analysis"), "utf8"))) as TwinAnalysis, frames = SINGLE ? new Map<string, GeorefFrame>() : framesFromAnalysis(A);
const STEM = IMAGE.replace(/\.[^.]+$/, ""), TAG = SINGLE ? STEM : STEM.slice(-6, -2), read = A.reads.find(r => r.name === STEM)!, f = frames.get(STEM)!;
if (SINGLE && !photoPath(IMAGE)) throw new Error(`${IMAGE}: no such photograph in ${DIR}`);
if (!SINGLE && (!read || !f)) throw new Error(`${IMAGE} is not a photograph of this flight (${A.twinId}, ${A.reads.length} photographs)`);
const SIZE = SINGLE ? imageSize(new Uint8Array(readFileSync(photoPath(IMAGE)!)))! : { width: f.intrinsics.width, height: f.intrinsics.height };
const W = SIZE.width, H = SIZE.height, altM = SINGLE ? 0 : ((f.ground as { altM: number }).altM ?? 0);
const IM = LABELS.images.find(x => x.image === IMAGE); if (!IM) throw new Error(`${IMAGE}: no labels in the file`);
if (IM.width !== W || IM.height !== H) throw new Error(`${IMAGE}: labelled at ${IM.width} x ${IM.height}, the flight's photograph is ${W} x ${H}`);
const AREA = (() => { const a = opt("area"); if (!a) return { x: 0, y: 0, w: W, h: H }; const [x, y, w, h] = a.split(",").map(Number); return { x, y, w, h }; })();

// The split. Tile r, c (from 1, top-left first); dev where r + c is even.
// The tiles and the scoring are cornLabelJudge.ts's (the corn inspector runs the same code).
// --hidden: the held-back tiles in place of the dev tiles (FINAL-1.md Part 4: each check run once). Nothing is drawn.
const HIDDEN = argv.includes("--hidden");
const DEV: Tile[] = labelTiles(AREA, GRID, HIDDEN);
// Only the dev tiles' labels are kept; the rest of the file is let go here.
const LAB = new Map(DEV.map(t => [t.id, IM.points.filter(p => within(t, p.x, p.y))]));
console.log(`${IMAGE} ${SINGLE ? "alone, no stored flight" : `is photograph ${A.reads.indexOf(read) + 1} of ${A.reads.length} in ${A.twinId}`}. Area x ${AREA.x}-${AREA.x + AREA.w}, y ${AREA.y}-${AREA.y + AREA.h}; ${GRID} x ${GRID} tiles, ${DEV.length} ${HIDDEN ? "HELD BACK" : "dev"}: ${DEV.map(t => t.id).join(" ")}`);

type Judged = JudgedT;
const TIER_COL: Rgb[] = [[255, 255, 255], [120, 220, 255], [255, 214, 40], [255, 70, 200], [80, 255, 200], [200, 255, 80]];
/** One dev tile judged (cornLabelJudge.ts judgeTile, with the tile's own labels). */
function judge(t: Tile, marks: Mark[], place: (u: number, v: number) => [number, number] | null, R: number): Judged & { pad: number } {
  return judgeTile(t, marks, place, R, LAB.get(t.id)!);
}
const sum = (a: number[]) => a.reduce((t, x) => t + x, 0);
let IMG: { width: number; height: number; data: Uint8Array } | null = null;
/** The tile's picture: the tile alone (not a pixel of its neighbours), twice its size, under its legend. */
function draw(t: Tile, J: Judged, file: string, title: string, rings: string, extra: Mark[] = []) {
  if (HIDDEN) return;
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

// ---- One photograph alone (--single): its own marks against the labels, in pixels.
if (SINGLE) {
  const med = (xs: number[]) => { const t = [...xs].sort((x, y) => x - y); return t.length ? t[t.length >> 1] : NaN; };
  // The labels' own spacing, from the dev tiles' labels alone (cornLabelJudge.ts labelSpacingPx).
  const { devPlants, th, cutPx, gapsPx, withUnsure, rowsPerTile, medianPerTile } = labelSpacingPx(DEV, t => LAB.get(t.id)!);
  // --match-px: the matching distance given (the dev tiles' own, when the held-back tiles are scored), not read from these tiles' labels.
  const sorted = [...gapsPx].sort((x, y) => x - y), R = opt("match-px") ? Number(opt("match-px")) : med(gapsPx) / 2;
  if (HIDDEN && !opt("match-px")) throw new Error("--hidden needs --match-px: the matching distance is the dev tiles' own");
  console.log(`Labels on the dev tiles: rows run at ${Math.round(((th * 180) / Math.PI) * 10) / 10} degrees in the photograph; ${gapsPx.length} pairs of neighbouring "plant" labels on a row (${withUnsure} pairs with an "unsure" label left out); distance between neighbours: lowest quarter ${sorted[sorted.length >> 2].toFixed(1)} px, median ${med(gapsPx).toFixed(1)} px, highest quarter ${sorted[(3 * sorted.length) >> 2].toFixed(1)} px. Matching distance: ${R.toFixed(1)} px. Rows found per tile: ${JSON.stringify(rowsPerTile)}`);
  // The photograph, read as a build reads one photograph. No camera data: the scale is what the photograph's header gives (Photo Scout's estimate), else none.
  const bytes = new Uint8Array(readFileSync(photoPath(IMAGE)!));
  IMG = decodeImage(bytes);
  const ex = parsePhotoHeader(bytes.subarray(0, HEADER_BYTES)), est = estimateGsd(ex, { imageWidth: IMG.width });
  const params = rowCropParamsFor(cropProfileFor("corn")!, est.gsdM);
  const full = { width: IMG.width, height: IMG.height, rgba: new Uint8ClampedArray(IMG.data.buffer, IMG.data.byteOffset, IMG.data.byteLength) };
  const t0 = Date.now(), v = readCornV1(full, params, { enteredCrop: "corn", cores: CORES_ON }), c = compactCornRead(STEM, v, 1), ms = Date.now() - t0;
  { const pitch = greenPitchPx(v.green); console.log(`Vivid cores ${CORES_ON ? "ON" : "off"}. Row spacing the green read holds: ${pitch == null ? "none" : `${pitch.toFixed(2)} px`}${CORES_ON && pitch ? `; blurs ${(CORN_CORES.fineShare * pitch).toFixed(2)} and ${(CORN_CORES.wideShare * pitch).toFixed(2)} px, share ${CORN_CORES.share}` : ""}.`); }
  // Whether the read used the dark-leaf rule here (cornV1.ts darkRuleApplies): only then does a build make the lower bar's candidates.
  const darkApplied = v.plants.low != null, plans = v.green.plans.map(p0 => ({ stage: p0.stage, share: Math.round(p0.ownedShare * 1000) / 1000 }));
  console.log(`The green read's plans: ${plans.map(p0 => `${p0.stage} ${(p0.share * 100).toFixed(1)} %`).join(", ") || "none"}. Dark-leaf rule used: ${darkApplied ? "yes" : "no"}.`);
  // Where a build makes no lower-bar candidates: the same call it makes where the rule applies (cornV1.ts:398), run here to see what that bar marks. Not what a build carries.
  const forced = darkApplied ? null : cornV1RowCandidates(full, seedlingCache(full, SEEDLING_GREEN), v.rows, params.gsdM ?? null).map(p0 => [Math.round(p0.x), Math.round(p0.y)] as [number, number]);
  console.log(`Read at its own size in ${ms} ms. Scale from the file: ${est.gsdM ?? "none"} (${est.basis}). The read's own: ${v.green.gsdM} m a pixel, ${v.green.scaleBasis}. Stricter marks ${c.plants.length}; lower-bar marks ${c.low ? c.low.length : "NOT MADE (the dark-leaf rule does not apply to this photograph)"}; rows ${v.rows.length} (${v.summary.cornRows} corn, ${v.summary.probableRows} planted, crop not confirmed).`);
  const ident = (u: number, vv: number): [number, number] => [u, vv];
  const asM = (pts: [number, number][], k = 1): Mark[] => pts.map(([x, y]) => ({ u: x * k, v: y * k, e: x * k, n: y * k, tier: 0 }));
  const dk = SEEDLING_GREEN.dark!, dl = SEEDLING_ROW.dark!;
  const sets: { key: string; what: string; title: string; marks: Mark[] }[] = [{ key: "strict", what: darkApplied ? `the stricter bar: the plant read's marks (dark-leaf tint ${dk.strongTint} strong / ${dk.weakTint} weak)` : "the stricter bar: the plant read's marks. On this photograph the plant read keeps the earlier mask, without the dark-leaf rule (cornV1.ts:381)", title: "THIS PHOTO OWN MARKS: STRICTER BAR", marks: asM(c.plants) }];
  if (forced) sets.push({ key: "lowforced", what: `the lower bar (${dl.strongTint} / ${dl.weakTint}). A build makes NO lower-bar marks on this photograph (cornV1.ts:395 and 406-409); these are made by the same call a build makes where the rule applies (cornV1.ts:398), a long piece split at the spacing one photograph assumes`, title: "LOWER BAR, NOT MADE BY A BUILD ON THIS PHOTO, MADE HERE BY THE SAME CALL", marks: asM(forced) });
  if (c.low) sets.push({ key: "low", what: `the lower bar (${dl.strongTint} / ${dl.weakTint}): the candidates as a build makes them, a long piece split at the spacing one photograph assumes`, title: "THIS PHOTO OWN MARKS: LOWER BAR AS A BUILD SPLITS IT", marks: asM(c.low) });
  // Photo Scout: the same reader, the photograph drawn down to MAX_EDGE_PX as the page does (a box average here; the page's canvas draws it down its own way).
  const k = Math.min(1, MAX_EDGE_PX / Math.max(IMG.width, IMG.height)), sw = Math.max(1, Math.round(IMG.width * k)), sh = Math.max(1, Math.round(IMG.height * k)), small = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const x0 = Math.floor(x / k), x1 = Math.max(x0 + 1, Math.min(IMG.width, Math.floor((x + 1) / k))), y0 = Math.floor(y / k), y1 = Math.max(y0 + 1, Math.min(IMG.height, Math.floor((y + 1) / k)));
    let r = 0, g = 0, b = 0, n = 0; for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const q = (yy * IMG.width + xx) * 4; r += IMG.data[q]; g += IMG.data[q + 1]; b += IMG.data[q + 2]; n++; }
    const o = (y * sw + x) * 4; small[o] = r / n; small[o + 1] = g / n; small[o + 2] = b / n; small[o + 3] = 255;
  }
  const estS = estimateGsd(ex, { imageWidth: sw }), t1 = Date.now(), ps = readCornV1({ width: sw, height: sh, rgba: small }, rowCropParamsFor(cropProfileFor("corn")!, estS.gsdM), { enteredCrop: "corn", cores: CORES_ON }), msS = Date.now() - t1;
  console.log(`Photo Scout (drawn down to ${sw} x ${sh}, ${(k * 100).toFixed(1)} %): read in ${msS} ms; scale ${ps.green.gsdM} m a pixel, ${ps.green.scaleBasis}; plant marks ${ps.plants.points.length}; lower-bar marks ${ps.plants.low ? ps.plants.low.length : "not made"}; rows ${ps.rows.length} (${ps.summary.cornRows} corn, ${ps.summary.probableRows} planted, crop not confirmed); weed candidates ${ps.summary.weeds}; stand gaps ${ps.summary.gaps} (${ps.summary.gapsWithheld} withheld).`);
  sets.push({ key: "photoscout", what: `Photo Scout's read: the same reader on the photograph drawn down to ${sw} x ${sh} pixels; its plant marks, brought back to the photograph's own pixels`, title: "PHOTO SCOUT READ: ITS PLANT MARKS", marks: asM(ps.plants.points.map(p0 => [p0.x, p0.y] as [number, number]), 1 / k) });
  const outSets = sets.map(S => {
    const tiles = DEV.map(t => { const J = judge(t, S.marks, ident, R); draw(t, J, `P${SUF}-${S.key}-${t.id}.jpg`, `${S.title}${CORES_ON ? " (VIVID CORES ON)" : ""}`, "WHITE RING = THE MARK ON A FOUND PLANT"); return J.score; });
    console.log(`${S.key}: ${S.marks.length} marks in the photograph`);
    for (const x of tiles) console.log(`  ${x.tile}: labelled ${x.labelled}, found ${x.found[0]}, wrong ${x.wrong[0]}, marks ${x.marks[0]}, on unsure ${x.onUnsure[0]}, at edge ${x.atEdge[0]}, missed ${x.missed}`);
    return { set: S.key, what: S.what, marksInPhoto: S.marks.length, tiles };
  });
  // What Photo Scout would show, on the dev tiles: weed candidates on a labelled plant, and reported stand gaps with labelled plants standing in them.
  const inDev = (u: number, vv: number) => DEV.find(t => within(t, u, vv)) ?? null;
  const verdictOf = new Map(ps.weedVerdicts.map(w => [w.index, w.verdict]));
  let weedsDev = 0, weedsOnPlant = 0; ps.green.weeds.forEach((w, i) => { if (verdictOf.get(i) !== "weed candidate") return; const u = w.x / k, vv = w.y / k, t = inDev(u, vv); if (!t) return; weedsDev++; if (LAB.get(t.id)!.some(l => l.type === "plant" && Math.hypot(l.x - u, l.y - vv) <= R)) weedsOnPlant++; });
  let gapsDev = 0, gapsWithPlants = 0, plantsInGaps = 0;
  for (const g of ps.gaps) {
    if (g.verdict !== "stand gap") continue;
    const x1 = g.x1 / k, y1 = g.y1 / k, x2 = g.x2 / k, y2 = g.y2 / k, t = inDev((x1 + x2) / 2, (y1 + y2) / 2); if (!t || !within(t, x1, y1) || !within(t, x2, y2)) continue;
    gapsDev++; const L = Math.hypot(x2 - x1, y2 - y1) || 1;
    // A labelled plant inside the gap: within the matching distance of its line, and further than that from both its ends along it.
    const inside = LAB.get(t.id)!.filter(l => { if (l.type !== "plant") return false; const a = ((l.x - x1) * (x2 - x1) + (l.y - y1) * (y2 - y1)) / L, d = Math.abs((l.x - x1) * (y2 - y1) - (l.y - y1) * (x2 - x1)) / L; return d <= R && a >= R && a <= L - R; }).length;
    if (inside) { gapsWithPlants++; plantsInGaps += inside; }
  }
  console.log(`Photo Scout on the dev tiles: weed candidates ${weedsDev}, of them on a labelled plant ${weedsOnPlant}; stand gaps lying wholly in a dev tile ${gapsDev}, of them with a labelled plant standing inside ${gapsWithPlants} (${plantsInGaps} labelled plants).`);
  if (argv.includes("--touch")) {
    const T = touchReport({ out: OUT, px: full, darkApplied, marks: c.plants, tiles: DEV, labels: LAB, judge, R, within });
    for (const t of DEV) draw(t, judge(t, T.cutMarks, ident, R), `P-cut-${t.id}.jpg`, "STRICTER BAR, EVERY LONG PIECE CUT INTO EQUAL PARTS (MEASURED ONLY)", "WHITE RING = THE MARK ON A FOUND PLANT");
  }
  if (argv.includes("--cores")) {
    // The close-together tiles drawn per size of the blur pair: the photograph on the left, the cores view on the right
    // (brightness = the core strength as a share of the photograph's strongest), the labels and the cores on both.
    const CLOSE = ["r4c2", "r4c4"], Z = 2, HEAD = 190, GAP = 24, YELLOW: Rgb = [255, 230, 40], CYAN: Rgb = [0, 230, 255];
    // --cores-sweep "doubled:8:34,tripled:12:51" --cores-shares 0.15,0.2 --cores-file cores-3.json: another sweep, no pictures.
    const sweep = opt("cores-sweep"), sizes = sweep ? sweep.split(",").map(x => { const [key, fine, wide] = x.split(":"); return { key, fine: Number(fine), wide: Number(wide) }; }) : undefined, shares = opt("cores-shares")?.split(",").map(Number);
    coresReport({ out: OUT, px: full, darkApplied, marks: c.plants, tiles: DEV, labels: LAB, judge, R, within, closeTiles: CLOSE, sizes, shares, file: opt("cores-file") ?? undefined, picture: (size, strength, top, cores) => {
      if (sweep) return;
      for (const t of DEV.filter(x => CLOSE.includes(x.id))) {
        const left = cut(IMG!, t.x, t.y, t.w, t.h, Z, HEAD), cv: Canvas = { w: 2 * left.w + GAP, h: left.h, data: new Uint8Array((2 * left.w + GAP) * left.h * 4) };
        for (let i = 0; i < cv.w * cv.h; i++) { cv.data[i * 4] = 20; cv.data[i * 4 + 1] = 20; cv.data[i * 4 + 2] = 20; cv.data[i * 4 + 3] = 255; }
        for (let y = 0; y < left.h; y++) cv.data.set(left.data.subarray(y * left.w * 4, (y + 1) * left.w * 4), y * cv.w * 4);
        const X0 = left.w + GAP;
        for (let y = 0; y < t.h * Z; y++) for (let x = 0; x < t.w * Z; x++) { const g = Math.min(255, Math.round((255 * strength[(t.y + Math.floor(y / Z)) * W + t.x + Math.floor(x / Z)]) / top)), q = ((y + HEAD) * cv.w + X0 + x) * 4; cv.data[q] = g; cv.data[q + 1] = g; cv.data[q + 2] = g; }
        const labs = LAB.get(t.id)!, inT = cores.filter(k => within(t, k.x, k.y)), n = (sh: number) => inT.filter(k => k.s >= sh).length;
        for (const side of [0, X0]) {
          for (const l of labs) { const x = (l.x - t.x) * Z + side, y = (l.y - t.y) * Z + HEAD; if (l.type === "plant") ring(cv, x, y, 11, 2, CYAN); else cross(cv, x, y, 7, 2, VIOLET); }
          for (const k of inT) disc(cv, (k.x - t.x) * Z + side, (k.y - t.y) * Z + HEAD, 4, k.s >= 0.45 ? RED : k.s >= 0.35 ? ORANGE : YELLOW);
        }
        for (let i = 0; i < cv.w * HEAD; i++) { cv.data[i * 4] = 20; cv.data[i * 4 + 1] = 20; cv.data[i * 4 + 2] = 20; }
        const leg: [Rgb, string][] = [
          [WHITE, `TILE ${t.id} OF PHOTO ${TAG} (X ${t.x}-${t.x + t.w}, Y ${t.y}-${t.y + t.h}). LEFT: THE PHOTO. RIGHT: THE CORES VIEW, BLUR ${size.fine} PX LESS ${size.wide} PX (${size.key})`],
          [CYAN, `BLUE RING = A PLANT YOU LABELLED: ${labs.filter(l => l.type === "plant").length}. VIOLET CROSS = YOUR UNSURE LABEL: ${labs.filter(l => l.type === "unsure").length}`],
          [RED, `RED SPOT = A CORE AT 0.45 OF THE PHOTO STRONGEST CORE OR OVER: ${n(0.45)}`],
          [ORANGE, `ORANGE SPOT = A CORE FROM 0.35 TO 0.45: ${n(0.35) - n(0.45)} (AT SHARE 0.35 THE CORES ARE RED + ORANGE: ${n(0.35)})`],
          [YELLOW, `YELLOW SPOT = A CORE FROM 0.25 TO 0.35: ${n(0.25) - n(0.35)} (AT SHARE 0.25 THE CORES ARE ALL THREE: ${n(0.25)})`],
        ];
        leg.forEach(([col, str], li) => text(cv, 12, 12 + li * 34, str, 3, col));
        writeFileSync(join(OUT, `C-${size.key}-${t.id}.jpg`), encodeJpeg({ width: cv.w, height: cv.h, data: cv.data }, 88));
      }
    } });
  }
  writeFileSync(join(OUT, `score-single${SUF}.json`), JSON.stringify({ image: IMAGE, vividCores: CORES_ON, hiddenHalf: HIDDEN, width: W, height: H, area: AREA, grid: GRID, devTiles: DEV, labelsRead: { plant: sum(devPlants.map(x => x.length)), unsure: sum([...LAB.values()].map(l => l.filter(p0 => p0.type === "unsure").length)) },
    labels: { rowDirectionDeg: (th * 180) / Math.PI, pairs: gapsPx.length, pairsWithUnsureLeftOut: withUnsure, lowQuarterPx: sorted[sorted.length >> 2], medianPx: med(gapsPx), highQuarterPx: sorted[(3 * sorted.length) >> 2], rowsPerTile, medianPerTile, newRowBeyondPx: cutPx }, matchPx: R,
    read: { ms, darkRuleApplied: darkApplied, plans, lowerBarForced: forced ? forced.length : null, scaleFromFile: est.gsdM, scaleBasisFromFile: est.basis, gsdM: v.green.gsdM, scaleBasis: v.green.scaleBasis, strict: c.plants.length, low: c.low ? c.low.length : null, rows: v.rows.length, cornRows: v.summary.cornRows, probableRows: v.summary.probableRows, notes: v.notes },
    photoScout: { width: sw, height: sh, share: k, ms: msS, gsdM: ps.green.gsdM, scaleBasis: ps.green.scaleBasis, plantMarks: ps.plants.points.length, low: ps.plants.low ? ps.plants.low.length : null, rows: ps.rows.length, summary: ps.summary, identity: ps.identity, notes: ps.notes, dev: { weedCandidates: weedsDev, weedCandidatesOnALabelledPlant: weedsOnPlant, standGaps: gapsDev, standGapsWithALabelledPlantInside: gapsWithPlants, labelledPlantsInsideGaps: plantsInGaps } },
    sets: outSets }, null, 1));
  process.exit(0);
}

// ---- B: the field's final dots, three runs.
type Variant = { key: string; what: string; spans: boolean; opts: (ground: FieldGround | null) => CornPlantsOptions };
const RUNS: Variant[] = [
  { key: "a-old-rules", what: "the old rules: every switch from this branch off (SEQUENCE_V1, PLANTS_FIRST_V1, the ground not asked; cornScoreboard.ts `base`)", spans: false, opts: () => ({ sequence: SEQUENCE_V1, placing: PLANTS_FIRST_V1 }) },
  { key: "b-branch-sweep-off", what: "this branch, the lone-mark sweep off (cornScoreboard.ts `p6`)", spans: true, opts: ground => ({ sequence: { ...SEQUENCE, sweepLoneMarks: false }, ground, placing: PLANTS_FIRST }) },
  { key: "c-branch-sweep-on", what: "this branch, the lone-mark sweep on (cornScoreboard.ts `p7`)", spans: true, opts: ground => ({ sequence: { ...SEQUENCE, sweepLoneMarks: true }, ground, placing: PLANTS_FIRST }) },
  { key: "d-branch-option-on", what: "this branch with the plant spacing not asked of a dot on a row's line (SEQUENCE.placeOffSpacing; cornScoreboard.ts `p8`)", spans: true, opts: ground => ({ sequence: { ...SEQUENCE, placeOffSpacing: true }, ground, placing: PLANTS_FIRST }) },
  { key: "e-spacing-stricter-only", what: "d, the stricter marks' dots only (offSpacingStricterOnly; `p9`)", spans: true, opts: ground => ({ sequence: { ...SEQUENCE, placeOffSpacing: true, offSpacingStricterOnly: true }, ground, placing: PLANTS_FIRST }) },
  { key: "f-spacing-learned-limit", what: "d with the too-close limit learned from the field (tooCloseFromField; `p10`)", spans: true, opts: ground => ({ sequence: { ...SEQUENCE, placeOffSpacing: true, tooCloseFromField: true }, ground, placing: PLANTS_FIRST }) },
  { key: "g-spacing-both", what: "d with both (`p11`)", spans: true, opts: ground => ({ sequence: { ...SEQUENCE, placeOffSpacing: true, offSpacingStricterOnly: true, tooCloseFromField: true }, ground, placing: PLANTS_FIRST }) },
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
const B: { run: string; what: string; tooCloseM: number; certainGaps: number; plantSpacingM: number; wholeFlightOnRows: number[]; wholeFlightOnNoRow: number; landed: number; foldedBack: number; marksInPhoto: number[]; noRowInPhoto: number; half: (Score & { missedWithADotOnNoRow: number; noRowDots: number })[]; full: Score[] }[] = [];
let origin: { lat: number; lng: number; altM: number } | null = null;
// --runs a,c,d: only those runs (by their first letter), written to <out>/score-runs.json; part A is not run. Without it: a, b, c as SCORE.md.
const ONLY = opt("runs")?.split(",") ?? null, LOOK = opt("look"), LINES = opt("lines"), PAIRS = opt("pairs"), NOTHING = opt("nothing") ?? (PAIRS ? "-" : null), HEADLAND_X = Number(opt("headland-x") ?? 3330);
if (LOOK) mkdirSync(LOOK, { recursive: true });
for (const run of MISSES ? RUNS.filter(r => r.key === (opt("misses-run") ?? "b-branch-sweep-off")) : RUNS.filter(r => (LINES ? r.key[0] === (ONLY?.[0] ?? "c") : LOOK ? r.key[0] === "d" : ONLY ? ONLY.includes(r.key[0]) : "abc".includes(r.key[0])))) {
  const t0 = Date.now(), reads = readsFor(run.spans);
  // The field does not read the candidates (cornScoreboard.ts), so it is the same field in all three runs; made again each run all the same.
  const { field: F, ground } = cornFieldAndGround(reads, frames, A.fieldOptions ?? FIELD);
  origin ??= F.origin;
  const opts = run.opts(ground), P = placeDots(reads, frames, F, opts); if (!P) throw new Error("the photographs made no dot");
  const rec = readRows(P, F, opts), n = P.all.length, seedM = rec.geometry.seedM, pi = P.photos.indexOf(STEM);
  if (seedM == null) throw new Error(`${run.key}: the plant spacing is not measured on this flight, so there is no matching distance`);
  if (pi < 0) throw new Error(`${IMAGE} is not among the photographs the dots were made from`);
  if (opts.free) throw new Error("the loosened placement is not scored here");
  // The field's dots in this photograph (cornLabelJudge.ts fieldMarks).
  const { tierOf, whole, onNoRow, pixelOf, place, landed, fold, marks, noRow, inPhoto } = fieldMarks(P, rec, F, f, pi);
  if (LINES) {
    // --lines <file>: the row lines the certain plants made in this run (rec.courses), each with its certain plants, its
    // length, what the field judged of the ground under it, where it runs in this photograph, and the labelled plants of
    // the dev tiles that stand on it. Read only; nothing is scored.
    const th = (rec.geometry.directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th), band = (opts.placing ?? PLANTS_FIRST).onRowShare * rec.geometry.spacingM;
    const labs = DEV.flatMap(t => LAB.get(t.id)!.filter(l => l.type === "plant").map(l => { const g = place(l.x, l.y)!; return { tile: t.id, a: g[0] * ct + g[1] * st, c: -g[0] * st + g[1] * ct }; }));
    const out = rec.courses.map((L, k) => {
      const line: [number, number][] = [], state = [0, 0, 0]; let inPhoto = 0, left = 0, uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
      for (let a = L.a0; ; a = Math.min(L.a1, a + 0.25)) {
        const c = courseAt(L, a), e = a * ct - c * st, nn = a * st + c * ct; line.push([Math.round(e * 100) / 100, Math.round(nn * 100) / 100]);
        state[ground ? ground.state(e, nn) : 0]++;
        const q = pixelOf(e, nn); if (q) { inPhoto++; if (q[0] < HEADLAND_X) left++; uMin = Math.min(uMin, q[0]); uMax = Math.max(uMax, q[0]); vMin = Math.min(vMin, q[1]); vMax = Math.max(vMax, q[1]); }
        if (a >= L.a1) break;
      }
      const on = labs.filter(l => l.a >= L.a0 - 0.5 && l.a <= L.a1 + 0.5 && Math.abs(l.c - courseAt(L, l.a)) <= band);
      const all = rec.rowOf.reduce((t, r, i) => t + (r >= 0 && Math.abs(rec.c[i] - courseAt(L, rec.a[i])) <= band && rec.a[i] >= L.a0 - 0.5 && rec.a[i] <= L.a1 + 0.5 ? 1 : 0), 0);
      return { line: k, certainPlants: L.dots.length, lengthM: Math.round((L.a1 - L.a0) * 10) / 10, plantsOnRowsInItsBand: all, ground: { notJudged: state[0], planted: state[1], scattered: state[2] }, samples: line.length, inThisPhoto: inPhoto, ofThemLeftOfTheHeadlandLine: left, pixelsX: inPhoto ? [Math.round(uMin), Math.round(uMax)] : null, pixelsY: inPhoto ? [Math.round(vMin), Math.round(vMax)] : null, labelledPlantsOfTheDevTilesOnIt: on.length, devTilesOfThose: [...new Set(on.map(l => l.tile))], en: line };
    });
    writeFileSync(LINES, JSON.stringify({ run: run.key, rowSpacingM: rec.geometry.spacingM, plantSpacingM: rec.geometry.seedM, directionDeg: rec.geometry.directionDeg, bandM: band, headlandLeftOfX: HEADLAND_X, lines: out }));
    console.log(`${run.key}: ${out.length} row lines written to ${LINES}`);
    process.exit(0);
  }
  if (LOOK) {
    const img = (IMG ??= decodeImage(new Uint8Array(readFileSync(photoPath(IMAGE)!)))), dir = (rec.geometry.directionDeg * Math.PI) / 180;
    lookReport({ out: LOOK, px: { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength) }, tiles: DEV, labels: LAB, judge, R: seedM / 2, marks, noRow, place, pixelOf, within, photos: i => P.all[i].photos, looked: i => P.covered[i], alongEN: [Math.cos(dir), Math.sin(dir)] });
    process.exit(0);
  }
  if (NOTHING) {
    // --nothing <file>: every wrong mark of this run in the tiles scored (matched at half the plant spacing), with the
    // labelled plants of its tile within one whole plant spacing of it, whether each of those has a mark, and how far
    // the mark stands from its tile's edge. Read only; nothing is scored anew.
    const R = seedM / 2, all: [number, number][] = [], ctx: { t: Tile; J: ReturnType<typeof judge> }[] = [];
    const rows = DEV.flatMap(t => {
      const J = judge(t, marks, place, R), labs = LAB.get(t.id)!.filter(l => l.type === "plant"), plants = labs.map(l => place(l.x, l.y)!), pxPerM = J.pad / R;
      return J.ms.flatMap((k, j) => {
        if (!within(t, k.u, k.v)) return [];
        all.push([Math.round(k.u), Math.round(k.v)]);
        if (J.state[j] !== 0) return [];
        ctx.push({ t, J });
        const near = plants.map((g, i) => ({ plant: `${t.id}:${i}`, m: Math.hypot(g[0] - k.e, g[1] - k.n), found: J.plantFound[i] })).filter(x => x.m <= seedM).sort((a, b) => a.m - b.m);
        return [{ tile: t.id, planted: labs.length > 0, tier: k.tier, u: Math.round(k.u), v: Math.round(k.v), second: near.some(x => x.m <= R), near, edgeM: Math.min(k.u - t.x, t.x + t.w - k.u, k.v - t.y, t.y + t.h - k.v) / pxPerM }];
      });
    });
    if (PAIRS) {
      // --pairs <dir> --pairs-groups <groups.json>: a close-up of every wrong mark of the groups asked (--pairs-of
      // x,second), about 40 cm across at the photograph's own pixels (enlarged, not resampled), on contact sheets.
      // The labels of the mark's tile as rings, every mark in the tile as a cross, the mark itself in orange, numbered.
      // Only the mark's own tile is shown: anything past its edge is left grey.
      if (HIDDEN) throw new Error("the held-back tiles are not drawn");
      const G = JSON.parse(readFileSync(arg("pairs-groups"), "utf8")) as { u: number; v: number; group: string }[];
      if (G.length !== rows.length || G.some((g, i) => g.u !== rows[i].u || g.v !== rows[i].v)) throw new Error("the groups file is not of this run's wrong marks");
      mkdirSync(PAIRS, { recursive: true });
      const img = (IMG ??= decodeImage(new Uint8Array(readFileSync(photoPath(IMAGE)!)))), Z = 8, HEADC = 34, CYAN: Rgb = [0, 230, 255], COLS = 5, GAPC = 10, HEADS = 150;
      const list: Record<string, unknown>[] = []; let num = 0;
      for (const [group, file, title] of (opt("pairs-of") ?? "x,second").split(",").map(g => [g, g === "x" ? "beside" : g, g === "x" ? "MARKS 7 TO 14 CM FROM A LABELLED PLANT THAT ALREADY HAS ITS MARK" : g === "second" ? "SECOND MARKS: WITHIN 7 CM OF A LABELLED PLANT THAT ALREADY HAS ITS MARK" : `GROUP ${g}`] as const)) {
        const cells: Canvas[] = [], first = num + 1;
        rows.forEach((r, i) => {
          if (G[i].group !== group) return; num++;
          const { t, J } = ctx[i], pxPerM = J.pad / R, half = Math.round(0.2 * pxPerM), size = 2 * half + 1, x0 = r.u - half, y0 = r.v - half;
          const c: Canvas = { w: size * Z, h: size * Z + HEADC, data: new Uint8Array(size * Z * (size * Z + HEADC) * 4) };
          for (let y = 0; y < size * Z; y++) for (let x = 0; x < size * Z; x++) {
            const sx = x0 + Math.floor(x / Z), sy = y0 + Math.floor(y / Z), q = ((y + HEADC) * c.w + x) * 4, inside = within(t, sx, sy) && sx >= 0 && sy >= 0 && sx < img.width && sy < img.height, o = (sy * img.width + sx) * 4;
            c.data[q] = inside ? img.data[o] : 70; c.data[q + 1] = inside ? img.data[o + 1] : 70; c.data[q + 2] = inside ? img.data[o + 2] : 70; c.data[q + 3] = 255;
          }
          const at = (u: number, v: number): [number, number] => [(u - x0 + 0.5) * Z, (v - y0 + 0.5) * Z + HEADC], seen = (u: number, v: number) => u >= x0 && v >= y0 && u < x0 + size && v < y0 + size;
          for (const l of LAB.get(t.id)!) if (seen(l.x, l.y)) { const [x, y] = at(l.x, l.y); ring(c, x, y, 22, 2, l.type === "plant" ? CYAN : VIOLET); }
          J.ms.forEach(k => { if (!within(t, k.u, k.v) || !seen(k.u, k.v)) return; const [x, y] = at(k.u, k.v), own = Math.round(k.u) === r.u && Math.round(k.v) === r.v; cross(c, x, y, own ? 13 : 9, own ? 3 : 2, own ? ORANGE : WHITE); });
          for (let k = 0; k < c.w * HEADC; k++) { c.data[k * 4] = 20; c.data[k * 4 + 1] = 20; c.data[k * 4 + 2] = 20; c.data[k * 4 + 3] = 255; }
          text(c, 6, 6, String(num), 3, WHITE);
          // One plant spacing, to scale.
          const bar = Math.round(seedM * pxPerM * Z); for (let x = 0; x < bar; x++) for (let k = 0; k < 3; k++) px(c, c.w - 8 - x, 14 + k, WHITE);
          text(c, c.w - 8 - bar - 70, 8, `${Math.round(seedM * 100)} CM`, 2, WHITE);
          cells.push(c);
          list.push({ number: num, sheet: `${file}.jpg`, tile: t.id, x: r.u, y: r.v, tier: TIERS[r.tier], nearestLabelledPlantCm: r.near[0] ? Math.round(r.near[0].m * 1000) / 10 : null, labelledPlantsWithin14Cm: r.near.length, acrossCm: Math.round((size / pxPerM) * 100) });
        });
        if (!cells.length) continue;
        const cw = Math.max(...cells.map(c => c.w)), ch = Math.max(...cells.map(c => c.h)), nr = Math.ceil(cells.length / COLS);
        const S: Canvas = { w: COLS * cw + (COLS + 1) * GAPC, h: HEADS + nr * ch + (nr + 1) * GAPC, data: new Uint8Array((COLS * cw + (COLS + 1) * GAPC) * (HEADS + nr * ch + (nr + 1) * GAPC) * 4) };
        for (let k = 0; k < S.w * S.h; k++) { S.data[k * 4] = 20; S.data[k * 4 + 1] = 20; S.data[k * 4 + 2] = 20; S.data[k * 4 + 3] = 255; }
        cells.forEach((c, k) => { const ox = GAPC + (k % COLS) * (cw + GAPC), oy = HEADS + GAPC + Math.floor(k / COLS) * (ch + GAPC); for (let y = 0; y < c.h; y++) S.data.set(c.data.subarray(y * c.w * 4, (y + 1) * c.w * 4), ((oy + y) * S.w + ox) * 4); });
        ([[WHITE, `PHOTO ${TAG}, DEV TILES. ${title}: NUMBERS ${first} TO ${num}`], [ORANGE, "ORANGE CROSS = THE MARK THE PICTURE IS OF. WHITE CROSS = ANY OTHER MARK"], [CYAN, "BLUE RING = A PLANT YOU LABELLED. VIOLET RING = YOUR UNSURE LABEL. EACH PICTURE IS ABOUT 40 CM ACROSS, THE PHOTO AT ITS OWN PIXELS, ENLARGED 8 TIMES"], [GREY, "FLAT GREY = PAST THE EDGE OF THE TILE THE MARK IS IN, NOT SHOWN. THE WHITE BAR IS ONE PLANT SPACING"]] as [Rgb, string][]).forEach(([col, str], li) => text(S, 12, 12 + li * 34, str, 3, col));
        writeFileSync(join(PAIRS, `${file}.jpg`), encodeJpeg({ width: S.w, height: S.h, data: S.data }, 92));
        console.log(`${file}.jpg: ${cells.length} close-ups, numbers ${first} to ${num}`);
      }
      writeFileSync(join(PAIRS, "list.json"), JSON.stringify(list, null, 1));
      process.exit(0);
    }
    writeFileSync(NOTHING, JSON.stringify({ run: run.key, hiddenHalf: HIDDEN, plantSpacingM: seedM, width: W, height: H, tiers: TIERS, wrongMarks: rows, allMarksInTheTiles: all }));
    console.log(`${run.key}: ${rows.length} wrong marks written to ${NOTHING}`);
    process.exit(0);
  }
  const half = DEV.map(t => {
    const J = judge(t, marks, place, seedM / 2), nr = noRow.filter(k => within(t, k.u, k.v, J.pad));
    // Not scored, told beside it: the dots the rules left on no row, and the labelled plants not found that have one on them.
    const plants = LAB.get(t.id)!.filter(l => l.type === "plant").map(l => place(l.x, l.y)!);
    const withNoRow = plants.filter((g, i) => !J.plantFound[i] && nr.some(k => Math.hypot(k.e - g[0], k.n - g[1]) <= seedM / 2)).length;
    if (!MISSES && !LOOK) draw(t, J, `B-${run.key}-${t.id}.jpg`, `THE FIELD DOTS BROUGHT INTO THIS PHOTO, RUN ${run.key[0].toUpperCase()}: ${run.key.slice(2).toUpperCase().replace(/-/g, " ")}`, `RING ON A FOUND PLANT: WHITE CERTAIN ${J.score.found[0]}, BLUE PROBABLE ${J.score.found[1]}, YELLOW SECOND LOOK 2+ ${J.score.found[2]}, PINK SECOND LOOK 1 ${J.score.found[3]}${J.score.marks[4] + J.score.marks[5] ? `, PALE GREEN BY THE OPTION ${J.score.found[4] + J.score.found[5]}` : ""}`, noRow);
    return { ...J.score, missedWithADotOnNoRow: withNoRow, noRowDots: noRow.filter(k => within(t, k.u, k.v)).length };
  });
  const full = DEV.map(t => judge(t, marks, place, seedM).score);
  B.push({ run: run.key, what: run.what, tooCloseM: rec.tooCloseM, certainGaps: rec.certainGaps, plantSpacingM: seedM, wholeFlightOnRows: whole, wholeFlightOnNoRow: onNoRow, landed, foldedBack: fold, marksInPhoto: inPhoto, noRowInPhoto: noRow.length, half, full });
  console.log(`${run.key}: plant spacing ${seedM} m; whole flight on rows ${JSON.stringify(whole)}; in the photograph ${JSON.stringify(inPhoto)} (${landed} dots land, ${fold} folded back and left out); ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const s of half) console.log(`  ${s.tile}: labelled ${s.labelled}, found ${JSON.stringify(s.found)}, wrong ${JSON.stringify(s.wrong)}, marks ${JSON.stringify(s.marks)}, on unsure ${JSON.stringify(s.onUnsure)}, at edge ${JSON.stringify(s.atEdge)}, missed ${s.missed}`);
  if (MISSES) {
    diagnose({ out: MISSES, tag: TAG, reads, frames, F, ground, opts, P, rec, pi, tiles: DEV, labels: LAB, marks, noRow, place, pixelOf, judge, within,
      image: () => (IMG ??= decodeImage(new Uint8Array(readFileSync(photoPath(IMAGE)!)))), cut, ring, disc, square, text, encode: c => encodeJpeg({ width: c.w, height: c.h, data: c.data }, 88) });
    process.exit(0);
  }
}

if (ONLY) { writeFileSync(join(OUT, "score-runs.json"), JSON.stringify({ image: IMAGE, hiddenHalf: HIDDEN, twin: A.twinId, area: AREA, grid: GRID, devTiles: DEV, tiers: TIERS, B }, null, 1)); process.exit(0); }

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
