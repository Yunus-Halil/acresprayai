// Development only (2026-11-20): each plant's own look (src/lib/fieldTwin/cornPlantLook.ts) measured over a saved
// build's photographs, as the app's build would: how many plants get a direction, a size and a colour, what it costs a
// photograph, and a sheet of plants picked at random with the measured leaf line drawn over the photograph.
//
//   npx vite-node scripts/rowCrop/cornLookCheck.ts -- --analysis <analysis.json> --photos <dir> --out <dir> [--sheet 48] [--seed 3]
import "../bench/nodeStorageShim";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { groundSampleAt, groundToPixel } from "../../src/lib/directGeoref/projection";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { cornCombine } from "../../src/lib/fieldTwin/build/corn";
import { plantSightings } from "../../src/lib/fieldTwin/cornPlants";
import { type PhotoLooks, measureMarkLooks, packLooks, plantLooks } from "../../src/lib/fieldTwin/cornPlantLook";
import { fromEnu } from "../../src/lib/sourceFrames/odm";
import { decodeImage, encodeJpeg, type Rgba } from "../bench/images";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
const OUT = arg("out"), PHOTOS = arg("photos"), SHEET = Number(opt("sheet") ?? 48); mkdirSync(OUT, { recursive: true });
const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, frames = framesFromAnalysis(A);
const C = cornCombine(A.reads as never, frames, "final3"), P = C.placed!, R = C.rows!, F = C.field, plants = C.plants!;
const S = plantSightings(P, R);
if (S.length !== plants.points.length) throw new Error("sightings and plants differ in number");
const reads = new Map((A.reads as { name: string; scale: number; plants: [number, number][]; low?: [number, number][]; guard?: { gsdM?: number } }[]).map(r => [r.name, r]));
const files = new Map(readdirSync(PHOTOS).filter(x => /\.jpe?g$/i.test(x)).map(x => [x.replace(/\.[^.]+$/, ""), join(PHOTOS, x)]));
const looks = new Map<string, PhotoLooks>(), images = new Map<string, Rgba>();
// The sheet's plants: on a row, picked at random; their first photograph is kept decoded.
const onRow = plants.shown.map((c, i) => (c === 0 || c === 1 || c === 4 || c === 5 ? i : -1)).filter(i => i >= 0);
let seed = Number(opt("seed") ?? 3); const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
const pick: number[] = []; while (pick.length < Math.min(SHEET, onRow.length)) { const i = onRow[Math.floor(rnd() * onRow.length)]; if (!pick.includes(i) && S[i].length) pick.push(i); }
const keep = new Set(pick.map(i => S[i][0].photo));
let ms = 0, marks = 0, n = 0;
for (const [name, r] of reads) {
  const file = files.get(name), f = frames.get(name); if (!file || !f) continue;
  const img = decodeImage(new Uint8Array(readFileSync(file))) as Rgba, px = { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length) };
  const gsd = groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy) ?? r.guard?.gsdM ?? 0.006;
  const t = performance.now();
  looks.set(name, { plants: measureMarkLooks(px, r.plants, gsd * r.scale), low: measureMarkLooks(px, r.low ?? [], gsd * r.scale) });
  ms += performance.now() - t; marks += r.plants.length + (r.low?.length ?? 0); n++;
  if (keep.has(name)) images.set(name, img);
  if (n % 30 === 0) console.log(`  ${n} photographs`);
}
console.log(`measured ${marks} marks in ${n} photographs: ${(ms / n).toFixed(1)} ms a photograph, ${ms.toFixed(0)} ms in all (one thread)`);
const L = plantLooks(S, looks, reads as never, frames, F.origin);
const groups: [string, (c: number) => boolean][] = [["on a row, stricter marks", c => c === 0 || c === 1], ["on a row, second look", c => c === 4 || c === 5], ["doubles", c => c === 7], ["green, not corn", c => c === 2 || c === 3]];
const lines = ["| plants | number | with a direction | drawn as a line / fuller | with a size | with a colour |", "|---|---:|---:|---:|---:|---:|"];
for (const [label, is] of groups) { const idx = plants.shown.map((c, i) => (is(c) ? i : -1)).filter(i => i >= 0), d = idx.filter(i => L[i].dirDeg != null);
  lines.push(`| ${label} | ${idx.length} | ${d.length} (${((100 * d.length) / Math.max(1, idx.length)).toFixed(0)} %) | ${d.filter(i => L[i].shape === 0).length} / ${d.filter(i => L[i].shape === 1).length} | ${idx.filter(i => L[i].sizeM != null).length} | ${idx.filter(i => L[i].rgb).length} |`); }
const q = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
const sz = onRow.map(i => L[i].sizeM).filter((x): x is number => x != null), gg = onRow.map(i => L[i].rgb?.[1]).filter((x): x is number => x != null);
lines.push("", `Sizes of the plants on rows (10th / 50th / 90th percentile): ${(q(sz, 0.1) * 100).toFixed(1)} / ${(q(sz, 0.5) * 100).toFixed(1)} / ${(q(sz, 0.9) * 100).toFixed(1)} cm. Green channel: ${q(gg, 0.1)} / ${q(gg, 0.5)} / ${q(gg, 0.9)}.`);
// Directions against the rows' own: a field of seedlings is not all turned one way.
const dirs = onRow.map(i => L[i].dirDeg).filter((x): x is number => x != null), hist = new Array(6).fill(0); for (const d of dirs) hist[Math.min(5, Math.floor(d / 30))]++;
lines.push(`Directions of the plants on rows, in 30-degree bins from north: ${hist.join(", ")} (rows run at ${R.geometry.directionDeg.toFixed(0)} degrees).`);
const packed = packLooks(L), bytes = packed.dir.length + packed.size.length + packed.colour.length;
lines.push(`In the twin: ${(bytes / 1024).toFixed(0)} KB for ${L.length} plants.`);
console.log(lines.join("\n"));

// ---------------------------------------------------------------- the sheet
const cell = 220, cols = 8, rows = Math.ceil(pick.length / cols), sheet = new Uint8Array(cols * cell * rows * cell * 4).fill(30);
pick.forEach((i, at) => {
  const s = S[i][0], img = images.get(s.photo), f = frames.get(s.photo)!; if (!img) return;
  const gsd = groundSampleAt(f, s.u, s.v) ?? 0.006, side = 0.3 / gsd, k = side / cell, ox = (at % cols) * cell, oy = Math.floor(at / cols) * cell;
  const put = (x: number, y: number, rgb: number[]) => { if (x < 0 || y < 0 || x >= cell || y >= cell) return; const o2 = ((oy + y) * cols * cell + ox + x) * 4; sheet[o2] = rgb[0]; sheet[o2 + 1] = rgb[1]; sheet[o2 + 2] = rgb[2]; sheet[o2 + 3] = 255; };
  for (let y = 0; y < cell - 2; y++) for (let x = 0; x < cell - 2; x++) { const sx = Math.floor(s.u - side / 2 + (x + 0.5) * k), sy = Math.floor(s.v - side / 2 + (y + 0.5) * k); if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue; const p = (sy * img.width + sx) * 4; put(x, y, [img.data[p], img.data[p + 1], img.data[p + 2]]); }
  const look = L[i];
  if (look.dirDeg != null && look.sizeM != null) {
    // The measured line, at the plant's place in this photograph, as long as the plant was measured: through the camera.
    const th = (look.dirDeg * Math.PI) / 180, [e, nn] = [P.all[0].e, P.all[0].n]; void e; void nn;
    const g0 = fromEnu([0, 0, 0], F.origin), altM = (f.ground as { altM: number }).altM ?? 0; void g0;
    const here = (() => { const [lat, lng] = plants.points[i]; return { lat, lng }; })();
    const mLat = 111_320, mLng = 111_320 * Math.cos((here.lat * Math.PI) / 180), half = look.sizeM / 2;
    const a = groundToPixel(f, here.lat - (Math.cos(th) * half) / mLat, here.lng - (Math.sin(th) * half) / mLng, altM), b = groundToPixel(f, here.lat + (Math.cos(th) * half) / mLat, here.lng + (Math.sin(th) * half) / mLng, altM);
    if (a && b) { const du = b.u - a.u, dv = b.v - a.v; // drawn through the photograph's own mark (the twin's place is a few cm off it)
      for (let t = 0; t <= 100; t++) { const u = s.u + (t / 100 - 0.5) * du, v = s.v + (t / 100 - 0.5) * dv, x = Math.round((u - s.u) / k + cell / 2), y = Math.round((v - s.v) / k + cell / 2); const c = look.shape === 0 ? [255, 60, 60] : [255, 190, 40]; put(x, y, c); put(x + 1, y, c); } }
    const [r, g, bl] = look.rgb ?? [0, 0, 0]; for (let y = 4; y < 20; y++) for (let x = 4; x < 20; x++) put(x, y, [r, g, bl]);
  } else for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) put(x, y, [255, 255, 255]);
});
for (let i = 3; i < sheet.length; i += 4) sheet[i] = 255;
writeFileSync(join(OUT, "look-sheet.jpg"), encodeJpeg({ width: cols * cell, height: rows * cell, data: sheet }, 92));
writeFileSync(join(OUT, "LOOK.md"), `# Each plant's own look: ${A.twinId}\n\n${lines.join("\n")}\n\nlook-sheet.jpg: ${pick.length} plants on rows picked at random, 30 cm of the first photograph that marked each. Red line: the measured leaf line (a plant drawn as a line); amber: drawn fuller; a white square: no direction agreed (drawn as before). The square at the top left is the plant's measured colour.\n`);
console.log(`wrote ${OUT}`);
