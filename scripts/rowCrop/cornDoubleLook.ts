// Development only: the doubles of a corn build, looked at again in the photographs (2026-11-19, his step 1: offline,
// nothing in the app). A double is a dot of the stricter marks on a row's line, refused only as closer than the
// too-close limit to a plant on that row (plantsFirst.ts SEQUENCE.doublesApart, cornPlants.ts shown 7). One plant seen
// twice, or two plants close together: the photographs that saw both places are asked.
//
// Per double and photograph (up to `--views` photographs that hold both places, the ones whose middle is nearest the
// pair first; each place brought in through the photograph's camera and its registration shift, as the build placed
// it, kept only where the pixel looks back within 5 cm):
//   the read's own seedling mask (rowCrop/seedlingGreen.ts seedlingWindow, the rules a build reads with) in a window
//   around the pair; its pieces of green (8-connected);
//   at each place, the piece with most of its pixels within `nearM` of it;
//     no piece at either place                           -> nothing to say
//     a piece at one place only                          -> one plant (the other place is on bare ground beside it)
//     two different pieces                               -> two plants
//     one piece: its centres (the blurred mask's peaks inside the piece, a plant's leaves meeting at its middle):
//       a peak near each place, the two `minApartM` apart or more, with a dip between them below `dip` of the lower
//                                                        -> two plants; else one plant
// The double's answer: one plant, or two, where at least two photographs say so and more say it than the other;
// otherwise "can't tell".
//
// Scored on a labelled photograph's dev tiles (labelTiles, top-left dev; the held-back tiles are never read): every
// counted plant of the build (on a row, or a double) brought into the photograph (cornLabelJudge.ts fieldMarks) and
// matched to the labels at half the plant spacing. A double with a labelled plant of its own while its partner has
// another: two plants. One of the two on a labelled plant and the other left over as a second mark on it: one plant.
//
//   npx vite-node scripts/rowCrop/cornDoubleLook.ts -- --analysis <analysis.json> --photos <dir> --out <dir>
//       [--labels <corn-labels.json> --image <labelled photograph file name>] [--sheet 40] [--views 4] [--seed 7]
//       [--answers <pairs.json of an earlier run>: score those answers again without reading the photographs]
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type GeorefFrame, groundSampleAt, groundToPixel, pixelToGround } from "../../src/lib/directGeoref/projection";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { cornCombine } from "../../src/lib/fieldTwin/build/corn";
import { SETTLED, shiftOf } from "../../src/lib/fieldTwin/plantsFirst";
import { SEEDLING_GREEN, seedlingWindow, soilLevels } from "../../src/lib/rowCrop/seedlingGreen";
import { gaussianBlur } from "../../src/lib/rowCrop/greenCores";
import { fromEnu, toEnu } from "../../src/lib/sourceFrames/odm";
import { decodeImage, encodeJpeg, type Rgba } from "../bench/images";
import { type Label, type Mark, fieldMarks, judgeTile, labelTiles, within } from "./cornLabelJudge";

export const LOOK = { nearM: 0.035, windowM: 0.07, blurM: 0.01, peakShare: 0.5, minApartM: 0.03, dip: 0.75, minPiecePx: 4, marginPx: 60, views: 4 };

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
const OUT = arg("out"), PHOTOS = arg("photos"), VIEWS = Number(opt("views") ?? LOOK.views), SHEET = Number(opt("sheet") ?? 40);
mkdirSync(join(OUT, "sheet"), { recursive: true });
const t0 = Date.now();
const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, frames = framesFromAnalysis(A);
const C = cornCombine(A.reads as never, frames, "final3");
const P = C.placed!, R = C.rows!, F = C.field;
if (!P || !R) throw new Error("the build placed no plants");
const n = P.all.length;
console.log(`field: ${n} dots, ${R.rows.length} rows, plant spacing ${R.geometry.seedM?.toFixed(3)} m, too close ${(R.tooCloseM * 100).toFixed(1)} cm (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

// ---------------------------------------------------------------- the doubles and their partners
const isDouble = (i: number) => i < P.strict && R.rowOf[i] < 0 && R.settled[i] === SETTLED.tooClose;
const cell = 0.2, key = (e: number, nn: number) => `${Math.floor(e / cell)},${Math.floor(nn / cell)}`, grid = new Map<string, number[]>();
for (let i = 0; i < n; i++) if (R.rowOf[i] >= 0) { const k = key(P.all[i].e, P.all[i].n); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); }
type Pair = { k: number; i: number; j: number; dM: number; votes: { photo: string; says: Say; note: string }[]; verdict?: Verdict };
type Say = "one" | "two" | "nothing";
type Verdict = "one plant" | "two plants" | "can't tell";
const pairs: Pair[] = [];
for (let i = 0; i < n; i++) {
  if (!isDouble(i)) continue;
  const d = P.all[i]; let best = Infinity, bj = -1;
  const cx = Math.floor(d.e / cell), cy = Math.floor(d.n / cell);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) { const dd = Math.hypot(P.all[j].e - d.e, P.all[j].n - d.n); if (dd < best) { best = dd; bj = j; } }
  if (bj >= 0) pairs.push({ k: pairs.length, i, j: bj, dM: best, votes: [] });
}
console.log(`doubles: ${pairs.length} (a partner on a row found for each)`);

// ---------------------------------------------------------------- the places in each photograph (as fieldMarks)
const pixelIn = (pi: number, e: number, nn: number): [number, number] | null => {
  const f = frames.get(P.photos[pi])!, W = f.intrinsics.width, H = f.intrinsics.height, altM = (f.ground as { altM: number }).altM ?? 0;
  let de = 0, dn = 0, u = 0, v = 0;
  for (let it = 0; it < 4; it++) { const p = fromEnu([e - de, nn - dn, 0], F.origin), h = groundToPixel(f, p.lat, p.lng, altM); if (!h) return null; u = h.u; v = h.v; [de, dn] = shiftOf(P.shifts[pi], u, v); }
  if (u < LOOK.marginPx || v < LOOK.marginPx || u >= W - LOOK.marginPx || v >= H - LOOK.marginPx) return null;
  const g = pixelToGround(f, u, v); if (!g) return null;
  const b = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, F.origin), [se, sn] = shiftOf(P.shifts[pi], u, v);
  return Math.hypot(b[0] + se - e, b[1] + sn - nn) <= 0.05 ? [u, v] : null;
};
const byPhoto = new Map<number, { pair: Pair; a: [number, number]; b: [number, number] }[]>();
for (const pr of pairs) {
  const views: { pi: number; a: [number, number]; b: [number, number]; mid: number }[] = [];
  for (let pi = 0; pi < P.photos.length; pi++) {
    const a = pixelIn(pi, P.all[pr.i].e, P.all[pr.i].n); if (!a) continue;
    const b = pixelIn(pi, P.all[pr.j].e, P.all[pr.j].n); if (!b) continue;
    const f = frames.get(P.photos[pi])!;
    views.push({ pi, a, b, mid: Math.hypot((a[0] + b[0]) / 2 - f.intrinsics.cx, (a[1] + b[1]) / 2 - f.intrinsics.cy) });
  }
  views.sort((x, y) => x.mid - y.mid);
  for (const v of views.slice(0, VIEWS)) (byPhoto.get(v.pi) ?? byPhoto.set(v.pi, []).get(v.pi)!).push({ pair: pr, a: v.a, b: v.b });
}
console.log(`photographs to read: ${byPhoto.size} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

// ---------------------------------------------------------------- one pair in one photograph
function look(px: { width: number; height: number; rgba: Uint8ClampedArray }, lv: ReturnType<typeof soilLevels>, gsd: number, a: [number, number], b: [number, number]): { says: Say; note: string } {
  const rPx = Math.max(0.08, Math.hypot(a[0] - b[0], a[1] - b[1]) * gsd / 2 + LOOK.windowM) / gsd;
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, x0 = Math.floor(mx - rPx), y0 = Math.floor(my - rPx), x1 = Math.ceil(mx + rPx), y1 = Math.ceil(my + rPx);
  const m = seedlingWindow(px as never, lv, SEEDLING_GREEN, x0, y0, x1, y1), w = Math.min(px.width, x1) - Math.max(0, x0), h = Math.min(px.height, y1) - Math.max(0, y0);
  const ox = Math.max(0, x0), oy = Math.max(0, y0);
  // Pieces (8-connected).
  const lab = new Int32Array(w * h).fill(-1), size: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || lab[s] >= 0) continue;
    const id = size.length, st = [s]; lab[s] = id; let c = 0;
    while (st.length) { const p = st.pop()!; c++; const x = p % w, y = (p - x) / w; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = yy * w + xx; if (m[q] && lab[q] < 0) { lab[q] = id; st.push(q); } } }
    size.push(c);
  }
  const near = LOOK.nearM / gsd;
  const pieceAt = (p: [number, number]) => {
    const cnt = new Map<number, number>(), cx = p[0] - ox, cy = p[1] - oy;
    for (let y = Math.max(0, Math.floor(cy - near)); y <= Math.min(h - 1, Math.ceil(cy + near)); y++) for (let x = Math.max(0, Math.floor(cx - near)); x <= Math.min(w - 1, Math.ceil(cx + near)); x++) {
      const id = lab[y * w + x]; if (id < 0 || size[id] < LOOK.minPiecePx || Math.hypot(x - cx, y - cy) > near) continue; cnt.set(id, (cnt.get(id) ?? 0) + 1);
    }
    let best = -1, bc = 0; for (const [id, c] of cnt) if (c > bc) { bc = c; best = id; }
    return best;
  };
  const pa = pieceAt(a), pb = pieceAt(b);
  if (pa < 0 && pb < 0) return { says: "nothing", note: "no green at either place" };
  if (pa < 0 || pb < 0) return { says: "one", note: "green at one place only" };
  if (pa !== pb) return { says: "two", note: "two separate pieces of green" };
  // One piece: its centres.
  const f = new Float32Array(w * h); for (let s = 0; s < w * h; s++) f[s] = lab[s] === pa ? 1 : 0;
  const bl = gaussianBlur(f, w, h, LOOK.blurM / gsd);
  let top = 0; for (let s = 0; s < w * h; s++) if (lab[s] === pa && bl[s] > top) top = bl[s];
  const peaks: [number, number, number][] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const s = y * w + x, v = bl[s]; if (lab[s] !== pa || v < LOOK.peakShare * top) continue;
    let isMax = true; for (let dy = -1; dy <= 1 && isMax; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && bl[s + dy * w + dx] > v) { isMax = false; break; }
    if (isMax) peaks.push([x + ox, y + oy, v]);
  }
  const nearest = (p: [number, number]) => { let bd = Infinity, bi = -1; peaks.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; bi = i; } }); return bd <= LOOK.nearM / gsd * 1.15 ? bi : -1; };
  const qa = nearest(a), qb = nearest(b);
  if (qa < 0 || qb < 0 || qa === qb) return { says: "one", note: `one piece, ${peaks.length} centre${peaks.length === 1 ? "" : "s"}` };
  const A1 = peaks[qa], B1 = peaks[qb], apart = Math.hypot(A1[0] - B1[0], A1[1] - B1[1]) * gsd;
  if (apart < LOOK.minApartM) return { says: "one", note: `one piece, centres ${(apart * 100).toFixed(1)} cm apart` };
  let low = Infinity; for (let t = 0; t <= 20; t++) { const x = Math.round(A1[0] + (t / 20) * (B1[0] - A1[0])) - ox, y = Math.round(A1[1] + (t / 20) * (B1[1] - A1[1])) - oy; low = Math.min(low, bl[y * w + x]); }
  return low < LOOK.dip * Math.min(A1[2], B1[2]) ? { says: "two", note: `one piece, two centres ${(apart * 100).toFixed(1)} cm apart` } : { says: "one", note: `one piece, no dip between its centres` };
}

// ---------------------------------------------------------------- read the photographs
const files = new Map(readdirSync(PHOTOS).filter(x => /\.jpe?g$/i.test(x)).map(x => [x.replace(/\.[^.]+$/, ""), join(PHOTOS, x)]));
const sheetPick = (() => { let s = Number(opt("seed") ?? 7); const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff); const idx = pairs.map(p => p.k); for (let q = idx.length - 1; q > 0; q--) { const r = Math.floor(rnd() * (q + 1)); [idx[q], idx[r]] = [idx[r], idx[q]]; } return new Set(idx.slice(0, SHEET)); })();
const IMAGE = opt("image"), labelledName = IMAGE ? IMAGE.replace(/\.[^.]+$/, "") : null;
const crops = new Map<number, { photo: string; jpg: string }[]>();
let done = 0;
// --answers <pairs.json>: the answers of an earlier run (the photographs are not read again; the sheet is not made).
const EARLIER = opt("answers") ? new Map((JSON.parse(readFileSync(arg("answers"), "utf8")) as { dot: number; verdict: Verdict; votes: Pair["votes"] }[]).map(x => [x.dot, x])) : null;
if (EARLIER) for (const pr of pairs) { const e = EARLIER.get(pr.i); if (e) pr.votes = e.votes; }
for (const [pi, list] of EARLIER ? [] : byPhoto) {
  const name = P.photos[pi], file = files.get(name); if (!file) { console.log(`${name}: not in --photos`); continue; }
  const img = decodeImage(new Uint8Array(readFileSync(file))), px = { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length) };
  const lv = soilLevels(px as never), f = frames.get(name)!;
  for (const { pair, a, b } of list) {
    const gsd = groundSampleAt(f, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2) ?? 0.006;
    const r = look(px, lv, gsd, a, b); pair.votes.push({ photo: name, ...r });
    // The sheet: up to two crops per pair, never from the labelled photograph (its held-back tiles stay unseen).
    if (sheetPick.has(pair.k) && name !== labelledName && (crops.get(pair.k)?.length ?? 0) < 2) {
      const jpg = `p${pair.k}-${crops.get(pair.k)?.length ?? 0}.jpg`;
      writeFileSync(join(OUT, "sheet", jpg), encodeJpeg(cropFor(img, gsd, a, b), 90));
      (crops.get(pair.k) ?? crops.set(pair.k, []).get(pair.k)!).push({ photo: name, jpg });
    }
  }
  done++; if (done % 20 === 0) console.log(`  ${done} of ${byPhoto.size} photographs (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
/** 0.3 m of the photograph around the pair at 300 px: the double ringed white, its partner amber. */
function cropFor(img: Rgba, gsd: number, a: [number, number], b: [number, number]): Rgba {
  const out = 300, side = 0.3 / gsd, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, k = side / out, data = new Uint8Array(out * out * 4);
  for (let y = 0; y < out; y++) for (let x = 0; x < out; x++) {
    const sx = mx - side / 2 + (x + 0.5) * k, sy = my - side / 2 + (y + 0.5) * k, ix = Math.floor(sx), iy = Math.floor(sy), q = (y * out + x) * 4;
    if (ix < 0 || iy < 0 || ix + 1 >= img.width || iy + 1 >= img.height) { data[q + 3] = 255; continue; }
    const fx = sx - ix, fy = sy - iy;
    for (let c = 0; c < 3; c++) { const p = (yy: number, xx: number) => img.data[(yy * img.width + xx) * 4 + c]; data[q + c] = Math.round(p(iy, ix) * (1 - fx) * (1 - fy) + p(iy, ix + 1) * fx * (1 - fy) + p(iy + 1, ix) * (1 - fx) * fy + p(iy + 1, ix + 1) * fx * fy); }
    data[q + 3] = 255;
  }
  const ring = (p: [number, number], rgb: [number, number, number]) => {
    const cx = (p[0] - (mx - side / 2)) / k, cy = (p[1] - (my - side / 2)) / k, rr = 0.012 / gsd / k;
    for (let t = 0; t < 360; t += 1) for (const dr of [-1, 0, 1]) { const x = Math.round(cx + (rr + dr) * Math.cos((t * Math.PI) / 180)), y = Math.round(cy + (rr + dr) * Math.sin((t * Math.PI) / 180)); if (x < 0 || y < 0 || x >= out || y >= out) continue; const q = (y * out + x) * 4; data[q] = rgb[0]; data[q + 1] = rgb[1]; data[q + 2] = rgb[2]; }
  };
  ring(b, [255, 182, 39]); ring(a, [255, 255, 255]);
  // A 5 cm bar, bottom left.
  const L = Math.round(0.05 / gsd / k); for (let x = 8; x < 8 + L; x++) for (let y = out - 12; y < out - 9; y++) { const q = (y * out + x) * 4; data[q] = data[q + 1] = data[q + 2] = 255; }
  return { width: out, height: out, data };
}

// ---------------------------------------------------------------- the answers
for (const pr of pairs) {
  const one = pr.votes.filter(v => v.says === "one").length, two = pr.votes.filter(v => v.says === "two").length;
  pr.verdict = one >= 2 && one > two ? "one plant" : two >= 2 && two > one ? "two plants" : "can't tell";
}
const tally = (list: Pair[]) => ({ one: list.filter(p => p.verdict === "one plant").length, two: list.filter(p => p.verdict === "two plants").length, cant: list.filter(p => p.verdict === "can't tell").length });
const T = tally(pairs);
console.log(`answers over the flight: one plant ${T.one}, two plants ${T.two}, can't tell ${T.cant} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
const lines: string[] = [`# The doubles looked at again: ${A.twinId}`, "", `${pairs.length} doubles; one plant ${T.one}, two plants ${T.two}, can't tell ${T.cant}. Rules: LOOK = ${JSON.stringify(LOOK)}, up to ${VIEWS} photographs a pair.`, ""];

// ---------------------------------------------------------------- scored on the labelled photograph's dev tiles
if (IMAGE) {
  const L = JSON.parse(readFileSync(arg("labels"), "utf8")) as { images: { image: string; width: number; height: number; points: Label[] }[] };
  const im = L.images.find(x => x.image === IMAGE); if (!im) throw new Error(`${IMAGE}: no labels`);
  const pi = P.photos.indexOf(labelledName!), f = frames.get(labelledName!)!;
  const FM = fieldMarks(P, R, F, f, pi), dbl = new Set(pairs.map(p => p.i));
  // The counted plants: on a row (fieldMarks' marks), and the doubles (of its dots on no row).
  const counted: Mark[] = [...FM.marks, ...FM.noRow.filter(m => dbl.has(m.i!))];
  const Rm = (R.geometry.seedM ?? 0.14) / 2, dev = labelTiles({ x: 0, y: 0, w: im.width, h: im.height }, 4, false);
  const score = (marks: Mark[]) => {
    const st = new Map<number, number>(), sec = new Map<number, number>(); let found = 0, wrong = 0, labelled = 0, inTiles = 0, onUnsure = 0;
    for (const t of dev) {
      const J = judgeTile(t, marks, FM.place, Rm, im.points.filter(p => within(t, p.x, p.y)));
      J.ms.forEach((k, j) => { if (J.state[j] !== 4) { st.set(k.i!, J.state[j]); sec.set(k.i!, J.second[j]); } });
      found += J.score.found.reduce((x, y) => x + y, 0); wrong += J.score.wrong.reduce((x, y) => x + y, 0); labelled += J.score.labelled;
      inTiles += J.score.marks.reduce((x, y) => x + y, 0); onUnsure += J.score.onUnsure.reduce((x, y) => x + y, 0);
    }
    return { st, sec, found, wrong, labelled, count: inTiles - onUnsure - labelled };
  };
  const before = score(counted);
  // Truth per double in the dev tiles.
  type Truth = "one plant" | "two plants" | "unclear";
  const truthOf = (p: Pair): Truth | null => {
    const si = before.st.get(p.i), sj = before.st.get(p.j); if (si == null || sj == null) return null;
    if (si === 1 && sj === 1) return "two plants";
    if ((si === 1 && sj === 0 && before.sec.get(p.j) === 1) || (sj === 1 && si === 0 && before.sec.get(p.i) === 1)) return "one plant";
    return "unclear";
  };
  const inDev = pairs.map(p => ({ p, truth: truthOf(p) })).filter(x => x.truth != null) as { p: Pair; truth: Truth }[];
  const cross: Record<string, Record<string, number>> = {};
  for (const x of inDev) { (cross[x.truth] ??= {})[x.p.verdict!] = (cross[x.truth][x.p.verdict!] ?? 0) + 1; }
  // Merging: every double the photographs call one plant leaves the count.
  const merged = new Set(pairs.filter(p => p.verdict === "one plant").map(p => p.i));
  const after = score(counted.filter(m => !merged.has(m.i!)));
  // The two plain rules beside it: no double counted at all, and (the merged ones aside) the "two plants" answers only.
  const noDoubles = score(counted.filter(m => !dbl.has(m.i!)));
  const onlyTwo = score(counted.filter(m => !dbl.has(m.i!) || pairs.find(p => p.i === m.i)?.verdict === "two plants"));
  console.log(`  no double counted: found ${noDoubles.found}, wrong ${noDoubles.wrong}, count ${noDoubles.count >= 0 ? "+" : ""}${noDoubles.count}; only the doubles answered two plants: found ${onlyTwo.found}, wrong ${onlyTwo.wrong}, count ${onlyTwo.count >= 0 ? "+" : ""}${onlyTwo.count}`);
  const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)} %`;
  console.log(`photo ${IMAGE}, dev tiles, matched at ${(Rm * 100).toFixed(1)} cm: doubles in them ${inDev.length}; truth x answer ${JSON.stringify(cross)}`);
  console.log(`  counted plants as built: found ${before.found} of ${before.labelled} (${pct(before.found, before.labelled)}), wrong ${before.wrong}, count ${before.count >= 0 ? "+" : ""}${before.count}`);
  console.log(`  with the doubles called one plant merged: found ${after.found}, wrong ${after.wrong}, count ${after.count >= 0 ? "+" : ""}${after.count}`);
  lines.push(`## Scored on ${IMAGE}, dev tiles only (matched at ${(Rm * 100).toFixed(1)} cm, half the plant spacing)`, "",
    `Doubles in the dev tiles: ${inDev.length}. What your labels say they are, against what the photographs answered:`, "",
    "| Your labels say | answered one plant (merged) | answered two plants | can't tell |", "|---|---:|---:|---:|",
    ...(["one plant", "two plants", "unclear"] as Truth[]).map(t => `| ${t} | ${cross[t]?.["one plant"] ?? 0} | ${cross[t]?.["two plants"] ?? 0} | ${cross[t]?.["can't tell"] ?? 0} |`), "",
    "| Counted plants | found, of " + before.labelled + " | wrong marks | count error |", "|---|---:|---:|---:|",
    `| as built (on a row + doubles) | ${before.found} | ${before.wrong} | ${before.count >= 0 ? "+" : ""}${before.count} |`,
    `| doubles answered "one plant" merged | ${after.found} | ${after.wrong} | ${after.count >= 0 ? "+" : ""}${after.count} |`,
    `| only the doubles answered "two plants" kept | ${onlyTwo.found} | ${onlyTwo.wrong} | ${onlyTwo.count >= 0 ? "+" : ""}${onlyTwo.count} |`,
    `| no double counted | ${noDoubles.found} | ${noDoubles.wrong} | ${noDoubles.count >= 0 ? "+" : ""}${noDoubles.count} |`, "");
}

// ---------------------------------------------------------------- the sheet
const shown = pairs.filter(p => sheetPick.has(p.k)).sort((x, y) => x.k - y.k);
const html = `<!doctype html><meta charset="utf-8"><title>Doubles sheet</title><style>body{font:13px system-ui;background:#151715;color:#ddd;margin:16px}h1{font-size:16px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}.c{background:#1e211e;border:1px solid #333;border-radius:4px;padding:8px}.c img{width:150px;height:150px;margin-right:6px;border:1px solid #444}.v{font-weight:600}.one{color:#ffb627}.two{color:#7fd36a}.cant{color:#aaa}.n{color:#999;font-size:11px}</style>
<h1>The doubles: one plant or two? (${shown.length} picked at random of ${pairs.length})</h1>
<p>Each card: 30 cm of a photograph that saw both places (never photo ${labelledName ?? "-"}), the double ringed <b style="color:#fff">white</b>, the plant on the row beside it <b style="color:#ffb627">amber</b>, a 5 cm bar. Under it, the answer the photographs gave and what each photograph said. Judge the answer by eye: note the card numbers you disagree with.</p>
<div class="g">${shown.map(p => `<div class="c"><div>#${p.k} &middot; ${(p.dM * 100).toFixed(1)} cm apart &middot; <span class="v ${p.verdict === "one plant" ? "one" : p.verdict === "two plants" ? "two" : "cant"}">${p.verdict}</span></div><div>${(crops.get(p.k) ?? []).map(c => `<img src="sheet/${c.jpg}" title="${c.photo}">`).join("")}</div><div class="n">${p.votes.map(v => `${v.photo.replace(/^DJI_\d+_/, "")}: ${v.says} (${v.note})`).join("<br>")}</div></div>`).join("")}</div>`;
if (!EARLIER) writeFileSync(join(OUT, "sheet.html"), html);
writeFileSync(join(OUT, "RESULTS.md"), lines.join("\n"));
writeFileSync(join(OUT, "pairs.json"), JSON.stringify(pairs.map(p => ({ k: p.k, dot: p.i, partner: p.j, dM: +p.dM.toFixed(4), verdict: p.verdict, votes: p.votes }))));
console.log(`wrote ${join(OUT, "sheet.html")}, RESULTS.md, pairs.json (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
