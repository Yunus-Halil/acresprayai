// Development only (2026-11-20, nothing in the app changes): the ghost plant, second pass. (1) Wide crops of the
// photographs that MARKED the plant and of one that only SEES its place: the mark, the photograph's own marks, and
// the field's plants around it brought in through the camera and the registration shift. (2) Over the flight: how far
// each counted plant stands ACROSS from the line through the stricter-mark plants beside it on its row; rules on that
// distance scored on photo 0025's dev tiles (held-back tiles never read).
//
//   npx vite-node scripts/rowCrop/cornSoilSpot2.ts -- --analysis <analysis.json> --photos <dir> --out <dir> --lat .. --lng ..
//       [--see <photo base name that sees the place>] [--labels <json> --image <file>]
import "../bench/nodeStorageShim";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { groundSampleAt, groundToPixel, pixelToGround } from "../../src/lib/directGeoref/projection";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { cornCombine } from "../../src/lib/fieldTwin/build/corn";
import { candidatePoints } from "../../src/lib/fieldTwin/cornPlants";
import { PLANTS_FIRST, shiftOf } from "../../src/lib/fieldTwin/plantsFirst";
import { fromEnu, toEnu } from "../../src/lib/sourceFrames/odm";
import { decodeImage, encodeJpeg, type Rgba } from "../bench/images";
import { type Mark, fieldMarks, judgeTile, labelTiles, within } from "./cornLabelJudge";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
const OUT = arg("out"), PHOTOS = arg("photos"); mkdirSync(OUT, { recursive: true });
const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, frames = framesFromAnalysis(A);
const C = cornCombine(A.reads as never, frames, "final3");
const P = C.placed!, R = C.rows!, F = C.field, plants = C.plants!, cand = P.candidates!;
const S = R.geometry.spacingM, seed = R.geometry.seedM ?? 0.14;
console.log(`row spacing ${S.toFixed(3)} m, plant spacing ${seed.toFixed(3)} m, on-row band +-${(PLANTS_FIRST.onRowShare * S * 100).toFixed(1)} cm`);
const kept: number[] = []; for (let i = 0; i < P.all.length; i++) if (i < P.strict || R.rowOf[i] >= 0) kept.push(i);
const counted = kept.filter(i => R.rowOf[i] >= 0);

// ---------------------------------------------------------------- across the local line of the stricter plants
// Per row: its stricter-mark plants sorted along. A plant's offset: its across place less the across place the two
// nearest stricter plants (one each side along, within 3 plant spacings; else the nearer one alone) hold at its place.
const byRow = new Map<number, number[]>(); for (const i of counted) if (i < P.strict) (byRow.get(R.rowOf[i]) ?? byRow.set(R.rowOf[i], []).get(R.rowOf[i])!).push(i);
for (const l of byRow.values()) l.sort((x, y) => R.a[x] - R.a[y]);
const offsetOf = (i: number): number | null => {
  const l = byRow.get(R.rowOf[i]); if (!l) return null;
  let lo = -1, hi = -1; // nearest stricter plant before and after (not itself)
  let b = 0, e = l.length; while (b < e) { const m = (b + e) >> 1; if (R.a[l[m]] < R.a[i]) b = m + 1; else e = m; }
  for (let k = b - 1; k >= 0; k--) if (l[k] !== i) { lo = l[k]; break; }
  for (let k = b; k < l.length; k++) if (l[k] !== i) { hi = l[k]; break; }
  const okLo = lo >= 0 && R.a[i] - R.a[lo] <= 3 * seed, okHi = hi >= 0 && R.a[hi] - R.a[i] <= 3 * seed;
  if (okLo && okHi) { const t = (R.a[i] - R.a[lo]) / Math.max(1e-6, R.a[hi] - R.a[lo]); return R.c[i] - (R.c[lo] + t * (R.c[hi] - R.c[lo])); }
  if (okLo) return R.c[i] - R.c[lo]; if (okHi) return R.c[i] - R.c[hi];
  return null;
};
const off = new Map<number, number | null>(); for (const i of counted) off.set(i, offsetOf(i));
type G = "stricter" | "second look";
const lines: string[] = [];
const cuts = [3, 4, 5, 6, 8];
lines.push("## Across from the line of the stricter-mark plants beside it on its row", "", `| plant from | counted | no stricter plant within 3 spacings | ${cuts.map(c => `over ${c} cm`).join(" | ")} |`, `|---|---:|---:|${cuts.map(() => "---:").join("|")}|`);
for (const g of ["stricter", "second look"] as G[]) {
  const l = counted.filter(i => (i < P.strict) === (g === "stricter")), has = l.filter(i => off.get(i) != null);
  lines.push(`| ${g} | ${l.length} | ${l.length - has.length} | ${cuts.map(c => has.filter(i => Math.abs(off.get(i)!) > c / 100).length).join(" | ")} |`);
}
console.log(lines.join("\n"));

// ---------------------------------------------------------------- the plant asked about
const lat = Number(arg("lat")), lng = Number(arg("lng")); let target = -1, bd = Infinity;
plants.points.forEach(([a, b], k) => { const d = Math.hypot((a - lat) * 111_320, (b - lng) * 111_320 * Math.cos((lat * Math.PI) / 180)); if (d < bd) { bd = d; target = kept[k]; } });
console.log(`target dot ${target}: across from its stricter neighbours' line ${((off.get(target) ?? NaN) * 100).toFixed(1)} cm`);
const files = new Map(readdirSync(PHOTOS).filter(x => /\.jpe?g$/i.test(x)).map(x => [x.replace(/\.[^.]+$/, ""), join(PHOTOS, x)]));
const pixelIn = (pi: number, e: number, nn: number): [number, number] | null => {
  const f = frames.get(P.photos[pi])!, altM = (f.ground as { altM: number }).altM ?? 0;
  let de = 0, dn = 0, u = 0, v = 0;
  for (let it = 0; it < 4; it++) { const p = fromEnu([e - de, nn - dn, 0], F.origin), h = groundToPixel(f, p.lat, p.lng, altM); if (!h) return null; u = h.u; v = h.v; [de, dn] = shiftOf(P.shifts[pi], u, v); }
  return [u, v];
};
function wide(pi: number, cu: number, cv: number, tag: string) {
  const nm = P.photos[pi], f = frames.get(nm)!, img = decodeImage(new Uint8Array(readFileSync(files.get(nm)!))) as Rgba;
  const gsd = groundSampleAt(f, cu, cv) ?? 0.003, sideM = 0.8, out = 640, side = sideM / gsd, k = side / out, data = new Uint8Array(out * out * 4);
  for (let y = 0; y < out; y++) for (let x = 0; x < out; x++) { const sx = Math.floor(cu - side / 2 + (x + 0.5) * k), sy = Math.floor(cv - side / 2 + (y + 0.5) * k), q = (y * out + x) * 4; data[q + 3] = 255; if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue; for (let c = 0; c < 3; c++) data[q + c] = img.data[(sy * img.width + sx) * 4 + c]; }
  const ring = (u: number, v: number, rgb: number[], r: number, thick = 2) => { const x0 = (u - cu) / k + out / 2, y0 = (v - cv) / k + out / 2; for (let t = 0; t < 720; t++) for (let rr = r; rr < r + thick; rr++) { const x = Math.round(x0 + rr * Math.cos((t * Math.PI) / 360)), y = Math.round(y0 + rr * Math.sin((t * Math.PI) / 360)); if (x < 0 || y < 0 || x >= out || y >= out) continue; const q = (y * out + x) * 4; data[q] = rgb[0]; data[q + 1] = rgb[1]; data[q + 2] = rgb[2]; } };
  // The photograph's own marks: stricter (green), lower bar (cyan).
  const r = (A.reads as { name: string; scale: number; plants: [number, number][] }[]).find(x => x.name === nm)!;
  let own = 0, low = 0;
  for (const [x, y] of r.plants) { const u = x * r.scale, v = y * r.scale; if (Math.abs(u - cu) < side / 2 && Math.abs(v - cv) < side / 2) { ring(u, v, [90, 255, 90], 4, 2); own++; } }
  for (const [x, y] of candidatePoints(r as never, f, F.origin, seed)) { const u = x * r.scale, v = y * r.scale; if (Math.abs(u - cu) < side / 2 && Math.abs(v - cv) < side / 2) { ring(u, v, [60, 220, 255], 7, 2); low++; } }
  // The field's counted plants here, through the camera and this photograph's shift: stricter amber, second look magenta.
  let fld = 0;
  for (const i of counted) { if (Math.hypot(P.all[i].e - P.all[target].e, P.all[i].n - P.all[target].n) > 0.7) continue; const h = pixelIn(pi, P.all[i].e, P.all[i].n); if (!h) continue; ring(h[0], h[1], i === target ? [255, 255, 255] : i < P.strict ? [255, 182, 39] : [255, 80, 220], i === target ? 14 : 10, i === target ? 3 : 2); fld++; }
  const L = Math.round(0.1 / gsd / k); for (let x = 10; x < 10 + L; x++) for (let y = out - 14; y < out - 10; y++) { const q = (y * out + x) * 4; data[q] = data[q + 1] = data[q + 2] = 255; }
  writeFileSync(join(OUT, `wide-${tag}-${nm.replace(/^DJI_\d+_/, "")}.jpg`), encodeJpeg({ width: out, height: out, data }, 92));
  const [se, sn] = shiftOf(P.shifts[pi], cu, cv);
  console.log(`  ${nm.replace(/^DJI_\d+_/, "")} (${tag}): ${(gsd * 1000).toFixed(1)} mm a pixel here; its own stricter marks in view ${own}, lower-bar ${low}; field plants drawn ${fld}; its registration shift here ${(Math.hypot(se, sn) * 100).toFixed(1)} cm; mark at ${(Math.hypot(cu - f.intrinsics.cx, cv - f.intrinsics.cy) / Math.hypot(f.intrinsics.cx, f.intrinsics.cy) * 100).toFixed(0)} % of the way from the middle to the corner`);
}
for (const k of cand.members[target - P.strict] ?? []) { const m = cand.from[k]; wide(m.p, m.u, m.v, "marked"); }
if (opt("see")) { const pi = P.photos.indexOf(arg("see")); const h = pi >= 0 ? pixelIn(pi, P.all[target].e, P.all[target].n) : null; if (h) wide(pi, h[0], h[1], "sees"); else console.log(`--see ${arg("see")}: the place is not in it`); }

// ---------------------------------------------------------------- scored on the labelled photograph's dev tiles
if (opt("image")) {
  const IMAGE = arg("image"), base = IMAGE.replace(/\.[^.]+$/, "");
  const L = JSON.parse(readFileSync(arg("labels"), "utf8")) as { images: { image: string; width: number; height: number; points: { x: number; y: number }[] }[] };
  const im = L.images.find(x => x.image === IMAGE)!, pi = P.photos.indexOf(base), f = frames.get(base)!;
  const FM = fieldMarks(P, R, F, f, pi), Rm = seed / 2, dev = labelTiles({ x: 0, y: 0, w: im.width, h: im.height }, 4, false);
  const score = (ms: Mark[]) => { let found = 0, wrong = 0, labelled = 0, inTiles = 0, onUnsure = 0; const st = new Map<number, number>();
    for (const t of dev) { const J = judgeTile(t, ms, FM.place, Rm, im.points.filter(p => within(t, p.x, p.y)) as never);
      J.ms.forEach((k, j) => { if (J.state[j] !== 4) st.set(k.i!, J.state[j]); });
      found += J.score.found.reduce((x, y) => x + y, 0); wrong += J.score.wrong.reduce((x, y) => x + y, 0); labelled += J.score.labelled; inTiles += J.score.marks.reduce((x, y) => x + y, 0); onUnsure += J.score.onUnsure.reduce((x, y) => x + y, 0); }
    return { found, wrong, labelled, count: inTiles - onUnsure - labelled, st }; };
  const before = score(FM.marks), sign = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
  lines.push("", `## Scored on ${IMAGE}, dev tiles only (matched at ${(Rm * 100).toFixed(1)} cm)`, "", `| counted | left out in the tiles | of them on a labelled plant | found, of ${before.labelled} | wrong | count error |`, "|---|---:|---:|---:|---:|---:|", `| as built | 0 | 0 | ${before.found} | ${before.wrong} | ${sign(before.count)} |`);
  for (const second of [true, false]) for (const c of cuts) {
    const drop = (i: number) => (second ? i >= P.strict : true) && off.get(i) != null && Math.abs(off.get(i)!) > c / 100;
    const gone = FM.marks.filter(m => drop(m.i!) && before.st.has(m.i!)), s = score(FM.marks.filter(m => !drop(m.i!)));
    lines.push(`| ${second ? "second-look plants" : "any plant"} over ${c} cm across left out | ${gone.length} | ${gone.filter(m => before.st.get(m.i!) === 1).length} | ${s.found} | ${s.wrong} | ${sign(s.count)} |`);
  }
  console.log(lines.slice(-cuts.length * 2 - 4).join("\n"));
}
writeFileSync(join(OUT, "RESULTS-2.md"), lines.join("\n") + "\n");
void pixelToGround; void toEnu;
