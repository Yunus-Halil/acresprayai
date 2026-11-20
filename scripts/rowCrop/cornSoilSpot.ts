// Development only (2026-11-20, nothing in the app changes): counted corn plants whose photographs' marks sit on bare
// soil. For one plant (--lat --lng): every mark each photograph made of it, whether that mark sits on green in its own
// photograph, and crops around each mark. Over the flight: every counted plant (on a row) and whether ANY of its marks
// sits on green; scored on photo 0025's dev tiles (the held-back tiles are never read) with those plants left out.
//
// Green: the read's own seedling mask (rowCrop/seedlingGreen.ts seedlingWindow, SEEDLING_GREEN), a piece of at least
// `minPiecePx` pixels, within `nearM` of the mark in the photograph that made it (its pixel, no camera, no shift).
//
//   npx vite-node scripts/rowCrop/cornSoilSpot.ts -- --analysis <analysis.json> --photos <dir> --out <dir>
//       [--lat 31.58 --lng -83.58] [--labels <corn-labels.json> --image <labelled file name>]
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { groundSampleAt, pixelToGround } from "../../src/lib/directGeoref/projection";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { cornCombine } from "../../src/lib/fieldTwin/build/corn";
import { SETTLED } from "../../src/lib/fieldTwin/plantsFirst";
import { SEEDLING_GREEN, seedlingWindow, soilLevels } from "../../src/lib/rowCrop/seedlingGreen";
import { fromEnu, toEnu } from "../../src/lib/sourceFrames/odm";
import { decodeImage, encodeJpeg, type Rgba } from "../bench/images";
import { type Mark, fieldMarks, judgeTile, labelTiles, within } from "./cornLabelJudge";

const SOIL = { nearM: 0.02, minPiecePx: 4, cropM: 0.3, cropPx: 300 };
const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
const OUT = arg("out"), PHOTOS = arg("photos");
mkdirSync(OUT, { recursive: true });
const t0 = Date.now(), secs = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;
const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, frames = framesFromAnalysis(A);
const C = cornCombine(A.reads as never, frames, "final3");
const P = C.placed!, R = C.rows!, F = C.field, plants = C.plants!;
const sights = P.sights!, cand = P.candidates;
const name = Object.fromEntries(Object.entries(SETTLED).map(([k, v]) => [v, k]));
console.log(`field: ${P.all.length} dots (${P.strict} from the stricter marks), ${plants.points.length} plants (${secs()})`);

// The plants as the twin keeps them, in its order (cornPlantsOf): dot index per plant.
const kept: number[] = []; for (let i = 0; i < P.all.length; i++) if (i < P.strict || R.rowOf[i] >= 0) kept.push(i);
if (kept.length !== plants.points.length) throw new Error(`kept ${kept.length} != plants ${plants.points.length}`);

// Every mark of a dot: { photo index, u, v (full-size pixels), kind }.
type M = { p: number; u: number; v: number; kind: "strict" | "lone strict" | "lower bar" };
const marksOf = (i: number): M[] => i < P.strict
  ? P.all[i].members.map(m => ({ p: sights[m].p, u: sights[m].u, v: sights[m].v, kind: "strict" as const }))
  : (cand?.members[i - P.strict] ?? []).map(k => { const f = cand!.from[k]; return { p: f.p, u: f.u, v: f.v, kind: f.sight >= 0 ? "lone strict" as const : "lower bar" as const }; });
const counted = kept.filter(i => R.rowOf[i] >= 0);
const byPhoto = new Map<number, { i: number; m: number; u: number; v: number }[]>();
const marks = new Map<number, M[]>();
for (const i of counted) { const ms = marksOf(i); marks.set(i, ms); ms.forEach((m, k) => (byPhoto.get(m.p) ?? byPhoto.set(m.p, []).get(m.p)!).push({ i, m: k, u: m.u, v: m.v })); }

// The plant asked about.
let target = -1;
if (opt("lat")) {
  const lat = Number(arg("lat")), lng = Number(arg("lng")); let bd = Infinity;
  plants.points.forEach(([a, b], k) => { const d = Math.hypot((a - lat) * 111_320, (b - lng) * 111_320 * Math.cos((lat * Math.PI) / 180)); if (d < bd) { bd = d; target = kept[k]; } });
  console.log(`plant asked about: dot ${target}, ${(bd * 100).toFixed(1)} cm from the point given; ${target < P.strict ? "from the stricter marks" : `a second-look candidate, tier ${P.tier?.[target]}`}; on row ${R.rowOf[target]}, certainty ${R.certainty[target]}, settled ${name[R.settled[target]]}, ${P.all[target].photos} photographs`);
  // Its neighbours on the field, along and across the rows.
  const th = (R.geometry.directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th), d0 = P.all[target];
  const near = counted.filter(j => j !== target).map(j => { const de = P.all[j].e - d0.e, dn = P.all[j].n - d0.n; return { j, d: Math.hypot(de, dn), along: de * ct + dn * st, across: -de * st + dn * ct }; }).sort((x, y) => x.d - y.d).slice(0, 5);
  for (const x of near) console.log(`  neighbour dot ${x.j} (${x.j < P.strict ? "stricter" : "candidate"}, certainty ${R.certainty[x.j]}): ${(x.d * 100).toFixed(1)} cm away, ${(x.along * 100).toFixed(1)} along, ${(x.across * 100).toFixed(1)} across`);
}

// ---------------------------------------------------------------- read the photographs
const files = new Map(readdirSync(PHOTOS).filter(x => /\.jpe?g$/i.test(x)).map(x => [x.replace(/\.[^.]+$/, ""), join(PHOTOS, x)]));
const onGreen = new Map<number, Int8Array>(); for (const [i, ms] of marks) onGreen.set(i, new Int8Array(ms.length).fill(-1));
const greenCm = new Map<string, number>();
const shape = new Map<number, { bearing: number; elong: number; lenM: number; rgb: number[]; px: number; edge: boolean }[]>();
let done = 0;
for (const [pi, list] of byPhoto) {
  const nm = P.photos[pi], file = files.get(nm); if (!file) continue;
  const img = decodeImage(new Uint8Array(readFileSync(file))), px = { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length) };
  const lv = soilLevels(px as never), f = frames.get(nm)!;
  for (const x of list) {
    const gsd = groundSampleAt(f, x.u, x.v) ?? 0.003, rPx = Math.ceil(0.05 / gsd);
    const x0 = Math.max(0, Math.floor(x.u - rPx)), y0 = Math.max(0, Math.floor(x.v - rPx)), x1 = Math.min(img.width, Math.ceil(x.u + rPx)), y1 = Math.min(img.height, Math.ceil(x.v + rPx));
    const m = seedlingWindow(px as never, lv, SEEDLING_GREEN, x0, y0, x1, y1), w = x1 - x0, h = y1 - y0;
    // Pieces (8-connected), and the nearest pixel of a piece big enough.
    const lab = new Int32Array(w * h).fill(-1), size: number[] = [];
    for (let s = 0; s < w * h; s++) { if (!m[s] || lab[s] >= 0) continue; const id = size.length, stk = [s]; lab[s] = id; let c = 0;
      while (stk.length) { const q = stk.pop()!; c++; const qx = q % w, qy = (q - qx) / w; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = qx + dx, yy = qy + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const r = yy * w + xx; if (m[r] && lab[r] < 0) { lab[r] = id; stk.push(r); } } }
      size.push(c); }
    let best = Infinity, bestId = -1;
    for (let s = 0; s < w * h; s++) { const id = lab[s]; if (id < 0 || size[id] < SOIL.minPiecePx) continue; const sx = s % w, sy = (s - sx) / w, d = Math.hypot(sx + x0 - x.u, sy + y0 - x.v); if (d < best) { best = d; bestId = id; } }
    const cm = best * gsd * 100;
    // POLISH TEST: the piece at the mark: its long axis (ground bearing, mod 180), how long against how wide, its length, its colour.
    if (bestId >= 0 && cm <= SOIL.nearM * 100) {
      let n = 0, mx = 0, my = 0, r = 0, g = 0, bl = 0;
      for (let s = 0; s < w * h; s++) if (lab[s] === bestId) { const sx = s % w, sy = (s - sx) / w; n++; mx += sx; my += sy; const q = ((sy + y0) * img.width + sx + x0) * 4; r += img.data[q]; g += img.data[q + 1]; bl += img.data[q + 2]; }
      mx /= n; my /= n; let sxx = 0, syy = 0, sxy = 0;
      for (let s = 0; s < w * h; s++) if (lab[s] === bestId) { const sx = s % w - mx, sy = (s - s % w) / w - my; sxx += sx * sx; syy += sy * sy; sxy += sx * sy; }
      sxx /= n; syy /= n; sxy /= n;
      const tr = sxx + syy, det = sxx * syy - sxy * sxy, l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ax = Math.cos(ang), ay = Math.sin(ang);
      const g0 = pixelToGround(f, x.u - ax * 20, x.v - ay * 20), g1 = pixelToGround(f, x.u + ax * 20, x.v + ay * 20);
      if (g0 && g1) { const e0 = toEnu({ lat: g0.lat, lng: g0.lng, altM: 0 }, F.origin), e1 = toEnu({ lat: g1.lat, lng: g1.lng, altM: 0 }, F.origin);
        const bearing = ((Math.atan2(e1[0] - e0[0], e1[1] - e0[1]) * 180) / Math.PI + 360) % 180;
        (shape.get(x.i) ?? shape.set(x.i, []).get(x.i)!).push({ bearing, elong: Math.sqrt(l1 / Math.max(1e-6, l2)), lenM: 4 * Math.sqrt(l1) * gsd, rgb: [r / n, g / n, bl / n], px: n, edge: lab.some((v, s) => v === bestId && (s % w === 0 || s % w === w - 1 || s < w || s >= w * (h - 1))) }); }
    }
    onGreen.get(x.i)![x.m] = cm <= SOIL.nearM * 100 ? 1 : 0;
    greenCm.set(`${x.i}:${x.m}`, cm);
    if (x.i === target) writeFileSync(join(OUT, `target-${nm.replace(/^DJI_\d+_/, "")}.jpg`), encodeJpeg(cropAround(img, gsd, x.u, x.v, list.filter(o => o.i !== target)), 90));
  }
  done++; if (done % 20 === 0) console.log(`  ${done} of ${byPhoto.size} photographs (${secs()})`);
}
/** SOIL.cropM of the photograph around (u, v): the mark ringed white, the photograph's other counted marks amber, a 5 cm bar. */
function cropAround(img: Rgba, gsd: number, u: number, v: number, others: { u: number; v: number }[]): Rgba {
  const out = SOIL.cropPx, side = SOIL.cropM / gsd, k = side / out, data = new Uint8Array(out * out * 4);
  for (let y = 0; y < out; y++) for (let x = 0; x < out; x++) {
    const sx = u - side / 2 + (x + 0.5) * k, sy = v - side / 2 + (y + 0.5) * k, ix = Math.floor(sx), iy = Math.floor(sy), q = (y * out + x) * 4;
    data[q + 3] = 255; if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) continue;
    for (let c = 0; c < 3; c++) data[q + c] = img.data[(iy * img.width + ix) * 4 + c];
  }
  const ring = (cu: number, cv: number, rgb: number[], r: number) => { const cx = (cu - u) / k + out / 2, cy = (cv - v) / k + out / 2;
    for (let t = 0; t < 360; t++) for (const rr of [r, r + 1]) { const x = Math.round(cx + rr * Math.cos((t * Math.PI) / 180)), y = Math.round(cy + rr * Math.sin((t * Math.PI) / 180)); if (x < 0 || y < 0 || x >= out || y >= out) continue; const q = (y * out + x) * 4; data[q] = rgb[0]; data[q + 1] = rgb[1]; data[q + 2] = rgb[2]; } };
  for (const o of others) if (Math.abs(o.u - u) < side / 2 && Math.abs(o.v - v) < side / 2) ring(o.u, o.v, [255, 182, 39], 6);
  ring(u, v, [255, 255, 255], 9);
  const L = Math.round(0.05 / gsd / k); for (let x = 8; x < 8 + L; x++) for (let y = out - 12; y < out - 9; y++) { const q = (y * out + x) * 4; data[q] = data[q + 1] = data[q + 2] = 255; }
  return { width: out, height: out, data };
}

// ---------------------------------------------------------------- the plant asked about
const lines: string[] = [];
if (target >= 0) {
  const ms = marks.get(target)!;
  lines.push(`## The plant asked about (dot ${target})`, "", "| photograph | mark | pixel | green nearest the mark |", "|---|---|---|---:|");
  ms.forEach((m, k) => lines.push(`| ${P.photos[m.p].replace(/^DJI_\d+_/, "")} | ${m.kind} | ${m.u.toFixed(0)}, ${m.v.toFixed(0)} | ${(greenCm.get(`${target}:${k}`) ?? NaN).toFixed(1)} cm |`));
  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------- over the flight
type Group = "stricter" | "second look, two or more" | "second look, one sharp view";
const groupOf = (i: number): Group => (i < P.strict ? "stricter" : P.tier?.[i] === 1 ? "second look, two or more" : "second look, one sharp view");
const noGreen = new Set<number>();
const tab = new Map<Group, { n: number; none: number; some: number; all: number }>();
for (const i of counted) {
  const g = onGreen.get(i)!, read = [...g].filter(x => x >= 0), any = read.some(x => x === 1), every = read.length > 0 && read.every(x => x === 1);
  const t = tab.get(groupOf(i)) ?? tab.set(groupOf(i), { n: 0, none: 0, some: 0, all: 0 }).get(groupOf(i))!;
  t.n++; if (!read.length) continue; if (!any) { t.none++; noGreen.add(i); } else if (every) t.all++; else t.some++;
}
lines.push("", "## Counted plants (on a row) over the flight: do their marks sit on green?", "", "| plant from | counted | no mark on green | some marks | every mark |", "|---|---:|---:|---:|---:|");
for (const [g, t] of tab) lines.push(`| ${g} | ${t.n} | ${t.none} | ${t.some} | ${t.all} |`);
console.log(lines.slice(-tab.size - 4).join("\n"));

// ---------------------------------------------------------------- POLISH TEST: do the photographs agree on a plant's look?
{
  const med = (x: number[]) => { const s = [...x].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
  const dirDev: number[] = [], dirDevLong: number[] = [], lenCv: number[] = [], colDev: number[] = [], elongs: number[] = [], lens: number[] = [], perPlantLen: number[] = [], perPlantG: number[] = [];
  let withTwo = 0, longPlants = 0, cut = 0, all = 0;
  for (const [i, v0] of shape) {
    for (const s of v0) { all++; if (s.edge) cut++; }
    const v = v0.filter(s => !s.edge); if (v.length < 2) continue; withTwo++;
    // Direction: the mean of the doubled angles; each photograph's distance from it.
    const c = v.reduce((t, s) => t + Math.cos((2 * s.bearing * Math.PI) / 180), 0), sn = v.reduce((t, s) => t + Math.sin((2 * s.bearing * Math.PI) / 180), 0), mean = ((Math.atan2(sn, c) * 90) / Math.PI + 180) % 180;
    const dev = v.map(s => { const d = Math.abs(s.bearing - mean) % 180; return Math.min(d, 180 - d); });
    const el = med(v.map(s => s.elong)); elongs.push(el);
    dirDev.push(med(dev)); if (el >= 1.8) { dirDevLong.push(med(dev)); longPlants++; }
    const L = v.map(s => s.lenM), mL = L.reduce((a, b) => a + b, 0) / L.length; lenCv.push(Math.sqrt(L.reduce((t, x) => t + (x - mL) ** 2, 0) / L.length) / mL); lens.push(...L); perPlantLen.push(med(L));
    const G = v.map(s => s.rgb[1]); colDev.push(Math.max(...G) - Math.min(...G)); perPlantG.push(med(G));
    void i;
  }
  const pct = (x: number[], q: number) => { const s = [...x].sort((a, b) => a - b); return s[Math.floor(q * (s.length - 1))]; };
  lines.push("", "## Polish test: one plant's look across its photographs (pieces cut by the 5 cm window left out)", "",
    `Marks on green ${all}; their piece cut by the window ${cut}. Plants with two or more whole pieces: ${withTwo}.`,
    `- Long axis against width, per plant (median over its photographs): median ${med(elongs).toFixed(2)}; 1.8 or more (a clear line) on ${longPlants} of ${withTwo} (${((100 * longPlants) / withTwo).toFixed(0)} %).`,
    `- Direction: a photograph's distance from the plant's mean direction, median per plant: all plants ${med(dirDev).toFixed(0)} deg (90th percentile ${pct(dirDev, 0.9).toFixed(0)}); plants with a clear line ${med(dirDevLong).toFixed(0)} deg (90th percentile ${pct(dirDevLong, 0.9).toFixed(0)}). Random would be 45.`,
    `- Length: per plant 10th / 50th / 90th percentile ${(pct(perPlantLen, 0.1) * 100).toFixed(1)} / ${(med(perPlantLen) * 100).toFixed(1)} / ${(pct(perPlantLen, 0.9) * 100).toFixed(1)} cm; spread between a plant's photographs (std / mean), median ${(med(lenCv) * 100).toFixed(0)} %.`,
    `- Colour (green channel): per plant 10th / 50th / 90th percentile ${pct(perPlantG, 0.1).toFixed(0)} / ${med(perPlantG).toFixed(0)} / ${pct(perPlantG, 0.9).toFixed(0)}; range between a plant's photographs, median ${med(colDev).toFixed(0)}.`);
  console.log(lines.slice(-6).join(String.fromCharCode(10)));
}

// ---------------------------------------------------------------- scored on the labelled photograph's dev tiles
if (opt("image")) {
  const IMAGE = arg("image"), base = IMAGE.replace(/\.[^.]+$/, "");
  const L = JSON.parse(readFileSync(arg("labels"), "utf8")) as { images: { image: string; width: number; height: number; points: never[] }[] };
  const im = L.images.find(x => x.image === IMAGE)!, pi = P.photos.indexOf(base), f = frames.get(base)!;
  const FM = fieldMarks(P, R, F, f, pi), Rm = (R.geometry.seedM ?? 0.14) / 2, dev = labelTiles({ x: 0, y: 0, w: im.width, h: im.height }, 4, false);
  const score = (ms: Mark[]) => { let found = 0, wrong = 0, labelled = 0, inTiles = 0, onUnsure = 0; const st = new Map<number, number>();
    for (const t of dev) { const J = judgeTile(t, ms, FM.place, Rm, im.points.filter((p: { x: number; y: number }) => within(t, p.x, p.y)));
      J.ms.forEach((k, j) => { if (J.state[j] !== 4) st.set(k.i!, J.state[j]); });
      found += J.score.found.reduce((x, y) => x + y, 0); wrong += J.score.wrong.reduce((x, y) => x + y, 0); labelled += J.score.labelled; inTiles += J.score.marks.reduce((x, y) => x + y, 0); onUnsure += J.score.onUnsure.reduce((x, y) => x + y, 0); }
    return { found, wrong, labelled, count: inTiles - onUnsure - labelled, st }; };
  const before = score(FM.marks);
  const rules: [string, (i: number) => boolean][] = [
    ["no mark on green, any plant", i => noGreen.has(i)],
    ["no mark on green, second-look plants only", i => noGreen.has(i) && i >= P.strict],
    ["no mark on green, stricter-mark plants only", i => noGreen.has(i) && i < P.strict],
  ];
  lines.push("", `## Scored on ${IMAGE}, dev tiles only (matched at ${(Rm * 100).toFixed(1)} cm)`, "", `In the dev tiles: plants with no mark on green ${FM.marks.filter(m => noGreen.has(m.i!)).length}; of them on a labelled plant ${FM.marks.filter(m => noGreen.has(m.i!) && before.st.get(m.i!) === 1).length}, a second mark on one ${FM.marks.filter(m => noGreen.has(m.i!) && before.st.get(m.i!) === 0).length}.`, "", `| counted | found, of ${before.labelled} | wrong | count error |`, "|---|---:|---:|---:|", `| as built | ${before.found} | ${before.wrong} | ${before.count >= 0 ? "+" : ""}${before.count} |`);
  for (const [label, drop] of rules) { const s = score(FM.marks.filter(m => !drop(m.i!))); lines.push(`| ${label} left out | ${s.found} | ${s.wrong} | ${s.count >= 0 ? "+" : ""}${s.count} |`); }
  console.log(lines.slice(-rules.length - 6).join("\n"));
}
writeFileSync(join(OUT, "RESULTS.md"), `# Counted plants on bare soil: ${A.twinId}\n\nGreen: SEEDLING_GREEN pieces of ${SOIL.minPiecePx}+ px within ${SOIL.nearM * 100} cm of the mark, in the photograph that made it.\n\n${lines.join("\n")}\n`);
writeFileSync(join(OUT, "noGreen.json"), JSON.stringify([...noGreen].map(i => { const [lat, lng] = (() => { const p = fromEnu([P.all[i].e, P.all[i].n, 0], F.origin); return [p.lat, p.lng]; })(); return { dot: i, lat: +lat.toFixed(8), lng: +lng.toFixed(8), group: groupOf(i), marks: marks.get(i)!.map((m, k) => ({ photo: P.photos[m.p], kind: m.kind, greenCm: +(greenCm.get(`${i}:${k}`) ?? -1).toFixed(1) })) }; })));
console.log(`wrote ${OUT} (${secs()})`);
void existsSync; void toEnu;
