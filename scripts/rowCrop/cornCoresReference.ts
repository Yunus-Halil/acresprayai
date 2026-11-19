// Development only, read-only: what the vivid cores keep on ONE photograph under each reference (greenPoints.ts
// CoresAsked): "strongest" (a share of the photograph's strongest core) against "marks" (a factor times the median
// strength of the cores on the read's own marks). Prints the factor that puts the two bars at the same place, and the
// range of factors that keep exactly the same cores. With --picture it draws the kept cores over the photograph.
//
//   npx vite-node scripts/rowCrop/cornCoresReference.ts -- --photo <file> --out <file.json> [--factor 0.5] [--picture <stem>]
//
// Where a kept core stands:
//   on a row      in a piece of green that is not cover, within CORN_V1.onRowShare of the row spacing of a row the read drew
//   on cover      in a piece the plant read takes for cover (a sward: it never gets a mark)
//   elsewhere     in another piece off the rows, or on no piece
// --edge x0,y0,x1,y1: a line across the photograph, drawn by eye, with the crop below it (larger y): each count is
// then also given for the crop side and the other side of that line.
import "../bench/nodeStorageShim";
import { readFileSync, writeFileSync } from "node:fs";
import { decodeImage, encodeJpeg } from "../bench/images";
import { CORN_CORES, CORN_V1, cornV1CoresAsked, cornV1PlantCache, greenPitchPx, readCornV1 } from "../../src/lib/rowCrop/cornV1";
import { GREEN_POINTS, plantPointsFromGreen } from "../../src/lib/rowCrop/greenPoints";
import { distToLine } from "../../src/lib/rowCrop/plantRows";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { SEEDLING_GREEN, seedlingCache } from "../../src/lib/rowCrop/seedlingGreen";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const PHOTO = opt("photo")!, OUT = opt("out")!, PICTURE = opt("picture"), FACTOR = opt("factor") ? Number(opt("factor")) : CORN_CORES.factor;
const img = decodeImage(new Uint8Array(readFileSync(PHOTO)));
const px = { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
const v = readCornV1(px, rowCropParamsFor(cropProfileFor("corn")!, null), { enteredCrop: "corn", cores: false, countGuard: false });
const pitch = greenPitchPx(v.green), asked = cornV1CoresAsked(v.green, "strongest");
if (!asked || !pitch) { console.log("The read holds no row spacing for this photograph: no cores are made."); writeFileSync(OUT, JSON.stringify({ photo: PHOTO, rowSpacingPx: null })); process.exit(0); }
const cache = () => cornV1PlantCache(px, v.green, seedlingCache(px, SEEDLING_GREEN));
const run = (reference: "strongest" | "marks") => plantPointsFromGreen(px, GREEN_POINTS, cache(), { ...asked, reference, factor: FACTOR });
const old = run("strongest"), now = run("marks"), firstPass = v.plants.points.length;
const band = CORN_V1.onRowShare * pitch, where = (k: { x: number; y: number; where: string }) => (k.where === "cover" ? "cover" : k.where === "piece" && v.rows.some(r => r.points.length >= 2 && distToLine(r.points, k.x, k.y) <= band) ? "row" : "elsewhere");
const count = (G: typeof old) => { const c = { row: 0, cover: 0, elsewhere: 0 }; for (const k of G.coresInfo!.kept) c[where(k) as keyof typeof c]++; return c; };
const added = (G: typeof old) => { const c = { row: 0, elsewhere: 0 }; for (const p of G.points.slice(G.points.length - (G.coresAdded ?? 0))) c[v.rows.some(r => r.points.length >= 2 && distToLine(r.points, p.x, p.y) <= band) ? "row" : "elsewhere"]++; return c; };
const EDGE = opt("edge")?.split(",").map(Number) ?? null, below = (k: { x: number; y: number }) => !EDGE || k.y > EDGE[1] + ((EDGE[3] - EDGE[1]) * (k.x - EDGE[0])) / (EDGE[2] - EDGE[0]);
const sides = (G: typeof old) => { const c = { cropSide: { row: 0, cover: 0, elsewhere: 0 }, otherSide: { row: 0, cover: 0, elsewhere: 0 } }; for (const k of G.coresInfo!.kept) c[below(k) ? "cropSide" : "otherSide"][where(k) as "row"]++; return c; };
const addedSides = (G: typeof old) => { const c = { cropSide: 0, otherSide: 0 }; for (const p of G.points.slice(G.points.length - (G.coresAdded ?? 0))) c[below(p) ? "cropSide" : "otherSide"]++; return c; };
const firstSides = { cropSide: v.plants.points.filter(below).length, otherSide: v.plants.points.filter(p => !below(p)).length };
const io = old.coresInfo!, inn = now.coresInfo!, ps = inn.peakStrengths!, T = io.threshold!;
// The factor that puts the new bar where the old one is, and the factors between which exactly the same peaks pass.
let under = 0, above = Infinity; for (const s of ps) { if (s < T) under = Math.max(under, s); else above = Math.min(above, s); }
const med = inn.medianOnMarks, same = med ? T / med : null, range = med ? [under / med, above / med] : null;
const sameSet = io.kept.length === inn.kept.length && io.kept.every((k, i) => k.x === inn.kept[i].x && k.y === inn.kept[i].y);
const out = {
  photo: PHOTO, width: px.width, height: px.height, rowSpacingPx: pitch, blursPx: [asked.finePx, asked.widePx], rows: v.rows.length, firstPassMarks: firstPass,
  strongestCore: io.strongest, peaks: ps.length, coresOnMarks: inn.onMarks, medianOnMarks: med,
  old: { reference: "strongest", share: asked.share, threshold: T, kept: io.kept.length, keptWhere: count(old), added: old.coresAdded, addedWhere: added(old), marks: old.points.length, ...(EDGE ? { keptBySide: sides(old), addedBySide: addedSides(old) } : {}) },
  new: { reference: "marks", factor: FACTOR, threshold: inn.threshold, kept: inn.kept.length, keptWhere: count(now), added: now.coresAdded, addedWhere: added(now), marks: now.points.length, ...(EDGE ? { keptBySide: sides(now), addedBySide: addedSides(now) } : {}) },
  ...(EDGE ? { edgeDrawnByEye: EDGE, firstPassMarksBySide: firstSides } : {}),
  factorForTheSameBar: same, factorsThatKeepTheSameCores: range, sameCoresAtThisFactor: sameSet,
  strongestOverMedianOnMarks: med ? io.strongest / med : null,
};
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
if (PICTURE) for (const [G, tag] of [[old, "old"], [now, "new"]] as const) {
  // The photograph at half its size, the read's rows as thin lines, the kept cores as spots: blue on a row, red on cover, yellow elsewhere.
  const k = 2, w = Math.floor(px.width / k), h = Math.floor(px.height / k), d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let r = 0, g = 0, b = 0; for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) { const q = ((y * k + dy) * px.width + x * k + dx) * 4; r += img.data[q]; g += img.data[q + 1]; b += img.data[q + 2]; } const o = (y * w + x) * 4; d[o] = r / 4; d[o + 1] = g / 4; d[o + 2] = b / 4; d[o + 3] = 255; }
  const dot = (x: number, y: number, rr: number, c: [number, number, number]) => { for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) { if (dx * dx + dy * dy > rr * rr) continue; const xx = Math.round(x / k) + dx, yy = Math.round(y / k) + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const o = (yy * w + xx) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; } };
  for (const r of v.rows) for (let i = 1; i < r.points.length; i++) { const [ax, ay] = r.points[i - 1], [bx, by] = r.points[i], L = Math.hypot(bx - ax, by - ay); for (let t = 0; t < L; t += 6) dot(ax + ((bx - ax) * t) / L, ay + ((by - ay) * t) / L, 0, [255, 255, 255]); }
  for (const c of G.coresInfo!.kept) { const wh = where(c); dot(c.x, c.y, 4, wh === "row" ? [0, 230, 255] : wh === "cover" ? [255, 40, 40] : [255, 230, 40]); }
  writeFileSync(`${PICTURE}-${tag}.jpg`, encodeJpeg({ width: w, height: h, data: d }, 88));
}
