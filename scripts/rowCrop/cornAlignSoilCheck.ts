// Development only, read only: is the alignment of the photographs (fieldTwin/alignTogether.ts) RIGHT, or has it slid
// one photograph's plants onto the next plant along the row? Plants repeat along a row; the soil between them does
// not. So the soil is asked: at places two photographs both see, a patch of ground is cut from each (where the state
// being checked says the same ground is), and the second is slid over the first until the soil's texture lines up
// (correlation of the brightness less its local mean, centimetre steps, up to 25 cm each way). Where that is, is how
// far the two photographs truly disagree there. It never looks at a plant mark.
//
//   npx vite-node scripts/rowCrop/cornAlignSoilCheck.ts -- --analysis <analysis.json> --photos <dir> --out <dir> [--hubs 8] [--per-pair 8] [--align <json of options>]
import "../bench/nodeStorageShim";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Rgba, decodeImage } from "../bench/images";
import { groundToPixel, pixelToGround } from "../../src/lib/directGeoref/projection";
import { type PhotoShift, shiftOf } from "../../src/lib/fieldTwin/plantsFirst";
import { fromEnu, toEnu } from "../../src/lib/sourceFrames/odm";
import { flightLines, measurePairs } from "./cornAlignLib";
import { alignStates, photoFiles } from "./cornAlignStates";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); if (i < 0) { if (d == null) throw new Error(`--${k} is required`); return d; } return argv[i + 1]; };
const OUT = arg("out"), HUBS = Number(arg("hubs", "8")), PER = Number(arg("per-pair", "8"));
mkdirSync(OUT, { recursive: true });
const S = alignStates(arg("analysis"), true, JSON.parse(arg("align", "{}"))), { frames, photos, sights, origin } = S, fileOf = photoFiles(arg("photos")), nP = photos.length;
const th = (S.directionDeg * Math.PI) / 180, ax: [number, number] = [Math.cos(th), Math.sin(th)];
const cam = photos.map(n => { const f = frames.get(n)!; const [e, nn] = toEnu({ lat: f.pose.lat, lng: f.pose.lng, altM: 0 }, origin); return { e, n: nn, h: 1, W: f.intrinsics.width, H: f.intrinsics.height, cx: f.intrinsics.cx, cy: f.intrinsics.cy }; });
const lines = flightLines(cam), lineOf = new Int32Array(nP).fill(-1); lines.forEach((L, k) => { for (const p of L.photos) lineOf[p] = k; });
console.log(`${nP} photographs, ${sights.length} marks, ${lines.length} flight lines; the alignment's own report: ${JSON.stringify(S.report)}`);

const groundOf = (p: number, u: number, v: number): [number, number] | null => { const g = pixelToGround(frames.get(photos[p])!, u, v); if (!g) return null; const b = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, origin); return [b[0], b[1]]; };
const pixelOf = (Sh: PhotoShift[], p: number, e: number, n: number): [number, number] | null => {
  const f = frames.get(photos[p])!, altM = (f.ground as { altM: number }).altM ?? 0; let de = 0, dn = 0, u = 0, v = 0;
  for (let it = 0; it < 4; it++) { const q = fromEnu([e - de, n - dn, 0], origin), h = groundToPixel(f, q.lat, q.lng, altM); if (!h) return null; u = h.u; v = h.v; [de, dn] = shiftOf(Sh[p], u, v); }
  if (u < 0 || v < 0 || u >= f.intrinsics.width || v >= f.intrinsics.height) return null;
  const g = groundOf(p, u, v); if (!g) return null; const [se, sn] = shiftOf(Sh[p], u, v);
  return Math.hypot(g[0] + se - e, g[1] + sn - n) <= 0.05 ? [u, v] : null;
};

// The places: squares two photographs both marked, taken from the aligned state's pairs.
const xs = new Float64Array(sights.length), ys = new Float64Array(sights.length);
sights.forEach((s, i) => { const [de, dn] = shiftOf(S.after[s.p], s.u, s.v); xs[i] = s.e + de; ys[i] = s.n + dn; });
const M = measurePairs(sights, xs, ys, nP, cam, { cellM: 4, axis: ax, seedM: 0.15 });
const byPair = new Map<number, typeof M>(); for (const m of M) (byPair.get(m.i * nP + m.j) ?? byPair.set(m.i * nP + m.j, []).get(m.i * nP + m.j)!).push(m);
const hubs = Array.from({ length: HUBS }, (_, k) => Math.floor(((k + 0.5) * nP) / HUBS));
type Job = { a: number; b: number; ua: number; va: number; ra: number; rb: number };
const jobs: Job[] = [];
for (const hub of hubs) {
  const partners = [...byPair.entries()].filter(([k]) => Math.floor(k / nP) === hub || k % nP === hub).map(([k, ms]) => ({ other: Math.floor(k / nP) === hub ? k % nP : Math.floor(k / nP), ms }));
  // One partner on the hub's own flight line (the furthest with squares enough), and up to two on other lines.
  const same = partners.filter(p => lineOf[p.other] === lineOf[hub] && p.ms.length >= PER).sort((p, q) => Math.abs(q.other - hub) - Math.abs(p.other - hub)).slice(0, 1);
  const other = partners.filter(p => lineOf[p.other] !== lineOf[hub]).sort((p, q) => q.ms.length - p.ms.length).slice(0, 2);
  for (const P of [...same, ...other]) {
    // Squares over the whole overlap, in order of how far out in the frames they lie, every so-many taken.
    const ms = [...P.ms].sort((p, q) => Math.max(q.ri, q.rj) - Math.max(p.ri, p.rj)), step = Math.max(1, Math.floor(ms.length / PER));
    let taken = 0; for (let k = 0; k < ms.length && taken < PER; k += step, taken++) { const m = ms[k]; jobs.push({ a: m.i, b: m.j, ua: m.ui, va: m.vi, ra: m.ri, rb: m.rj }); }
  }
}
console.log(`${jobs.length} places in ${new Set(jobs.map(j => j.a * nP + j.b)).size} pairs of photographs (${jobs.filter(j => lineOf[j.a] !== lineOf[j.b]).length} between flight lines)`);

// Photographs decoded as needed, a few kept.
const kept = new Map<number, Rgba>();
const image = (p: number): Rgba | null => { let im = kept.get(p); if (im) return im; const f = fileOf(photos[p]); if (!f) return null; im = decodeImage(new Uint8Array(readFileSync(f))); if (kept.size >= 6) kept.delete(kept.keys().next().value as number); kept.set(p, im); return im; };
const STEP = 0.01, HALF = 60, REACH = 25; // a patch 1.2 m wide at 1 cm, slid up to 25 cm each way
/** A patch of ground around pixel (u, v) of photograph p: brightness on a ground grid (east right, north up), `half` cells each way. */
const patch = (p: number, u: number, v: number, half: number): Float32Array | null => {
  const im = image(p); if (!im) return null;
  const g0 = groundOf(p, u, v), g1 = groundOf(p, u + 40, v), g2 = groundOf(p, u, v + 40); if (!g0 || !g1 || !g2) return null;
  // Pixels per metre east and north: the inverse of the ground's slopes along u and v.
  const a = (g1[0] - g0[0]) / 40, b = (g2[0] - g0[0]) / 40, c = (g1[1] - g0[1]) / 40, d = (g2[1] - g0[1]) / 40, det = a * d - b * c; if (Math.abs(det) < 1e-12) return null;
  const ue = d / det, un = -b / det, ve = -c / det, vn = a / det, n = 2 * half + 1, out = new Float32Array(n * n);
  const at = (xx: number, yy: number) => { const o = (yy * im.width + xx) * 4; return 0.3 * im.data[o] + 0.6 * im.data[o + 1] + 0.1 * im.data[o + 2]; };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const de = (i - half) * STEP, dn = (j - half) * STEP, x = u + ue * de + un * dn, y = v + ve * de + vn * dn, x0 = Math.floor(x), y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= im.width || y0 + 1 >= im.height) return null;
    const fx = x - x0, fy = y - y0;
    out[j * n + i] = (1 - fy) * ((1 - fx) * at(x0, y0) + fx * at(x0 + 1, y0)) + fy * ((1 - fx) * at(x0, y0 + 1) + fx * at(x0 + 1, y0 + 1));
  }
  return out;
};
/** Brightness less its mean over a 15 cm box: the soil's texture, without the light falling off across a frame. */
const highPass = (g: Float32Array, n: number): Float32Array => {
  const r = 7, I = new Float64Array((n + 1) * (n + 1)), out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) { let row = 0; for (let x = 0; x < n; x++) { row += g[y * n + x]; I[(y + 1) * (n + 1) + x + 1] = I[y * (n + 1) + x + 1] + row; } }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const x0 = Math.max(0, x - r), x1 = Math.min(n - 1, x + r), y0 = Math.max(0, y - r), y1 = Math.min(n - 1, y + r); out[y * n + x] = g[y * n + x] - (I[(y1 + 1) * (n + 1) + x1 + 1] - I[y0 * (n + 1) + x1 + 1] - I[(y1 + 1) * (n + 1) + x0] + I[y0 * (n + 1) + x0]) / ((x1 - x0 + 1) * (y1 - y0 + 1)); }
  return out;
};
/** Where the second patch's soil lies from the first's: metres east and north, and how sure (the peak, and the best score further than 4 cm from it). */
const slide = (T: Float32Array, B: Float32Array): { e: number; n: number; peak: number; next: number } => {
  const nt = 2 * HALF + 1, nb = 2 * (HALF + REACH) + 1, ns = 2 * REACH + 1; let tt = 0; for (let k = 0; k < T.length; k++) tt += T[k] * T[k];
  const score = new Float32Array(ns * ns); let best = -2, bx = 0, by = 0;
  for (let sy = -REACH; sy <= REACH; sy++) for (let sx = -REACH; sx <= REACH; sx++) {
    let tb = 0, bb = 0;
    for (let y = 0; y < nt; y++) { const ro = (y + REACH + sy) * nb + REACH + sx, to = y * nt; for (let x = 0; x < nt; x++) { const bv = B[ro + x]; tb += T[to + x] * bv; bb += bv * bv; } }
    const s = tb / Math.sqrt(tt * bb + 1e-9); score[(sy + REACH) * ns + sx + REACH] = s; if (s > best) { best = s; bx = sx; by = sy; }
  }
  let next = -2; for (let sy = -REACH; sy <= REACH; sy++) for (let sx = -REACH; sx <= REACH; sx++) if (Math.abs(sx - bx) > 4 || Math.abs(sy - by) > 4) next = Math.max(next, score[(sy + REACH) * ns + sx + REACH]);
  return { e: bx * STEP, n: by * STEP, peak: best, next };
};

type Row = { a: string; b: string; betweenLines: boolean; fromMiddle: number; movedCm: number; before: { cm: number; along: number; across: number; peak: number; next: number }; after: { cm: number; along: number; across: number; peak: number; next: number } };
const rows: Row[] = [];
// Pairs in order, so a decoded photograph serves all its places before it is let go.
jobs.sort((p, q) => p.a * nP + p.b - (q.a * nP + q.b));
for (const j of jobs) {
  const T0 = patch(j.a, j.ua, j.va, HALF); if (!T0) continue;
  const T = highPass(T0, 2 * HALF + 1), g = groundOf(j.a, j.ua, j.va)!;
  const res: Row["before"][] = [], at: [number, number][] = [];
  for (const Sh of [S.before, S.after]) {
    const [se, sn] = shiftOf(Sh[j.a], j.ua, j.va), q = pixelOf(Sh, j.b, g[0] + se, g[1] + sn); if (!q) break;
    const B0 = patch(j.b, q[0], q[1], HALF + REACH); if (!B0) break;
    // The second photograph's soil lies at r from where the state says the same ground is: the two disagree by r there.
    const r = slide(T, highPass(B0, 2 * (HALF + REACH) + 1));
    res.push({ cm: +(Math.hypot(r.e, r.n) * 100).toFixed(1), along: +((r.e * ax[0] + r.n * ax[1]) * 100).toFixed(1), across: +((-r.e * ax[1] + r.n * ax[0]) * 100).toFixed(1), peak: +r.peak.toFixed(2), next: +r.next.toFixed(2) }); at.push(q);
  }
  if (res.length < 2) continue;
  // How far the alignment moved the second photograph against the first at this place.
  const g0 = groundOf(j.b, at[0][0], at[0][1]), g1 = groundOf(j.b, at[1][0], at[1][1]);
  rows.push({ a: photos[j.a].slice(-9), b: photos[j.b].slice(-9), betweenLines: lineOf[j.a] !== lineOf[j.b], fromMiddle: +Math.max(j.ra, j.rb).toFixed(2), movedCm: g0 && g1 ? +(Math.hypot(g1[0] - g0[0], g1[1] - g0[1]) * 100).toFixed(1) : NaN, before: res[0], after: res[1] });
}
writeFileSync(join(OUT, "soil-check.json"), JSON.stringify({ report: S.report, places: rows }, null, 1));
// A place is read only where the soil gave a clear answer in both states: a peak of 0.3 or more, 0.08 above any other.
const sure = (r: Row["before"]) => r.peak >= 0.3 && r.peak - r.next >= 0.08, clear = rows.filter(r => sure(r.before) && sure(r.after));
const q = (v: number[], f: number) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN; };
const out: string[] = [];
const say = (s: string) => { console.log(s); out.push(s); };
const line = (name: string, rs: Row[]) => { if (!rs.length) { say(`| ${name} | 0 | | | | | | | |`); return; } const b = rs.map(r => r.before.cm), a = rs.map(r => r.after.cm); say(`| ${name} | ${rs.length} | ${q(b, 0.5)} | ${q(b, 0.9)} | ${q(a, 0.5)} | ${q(a, 0.9)} | ${b.filter(x => x <= 3).length} -> ${a.filter(x => x <= 3).length} | ${b.filter(x => x > 7).length} -> ${a.filter(x => x > 7).length} | ${rs.filter(r => r.after.cm < r.before.cm - 1).length} / ${rs.filter(r => r.after.cm > r.before.cm + 1).length} | ${q(rs.map(r => r.movedCm), 0.5)} |`); };
say(`${rows.length} places cut; the soil gave a clear answer in both states at ${clear.length}.`);
say("");
say(`| Places | How many | Soil disagreement BEFORE: median, cm | 90th percentile | AFTER: median, cm | 90th percentile | Within 3 cm | Over 7 cm | Better / worse by over 1 cm | The alignment moved the pair there by (median), cm |`);
say(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
line("all", clear); line("between flight lines", clear.filter(r => r.betweenLines)); line("on one flight line", clear.filter(r => !r.betweenLines)); line("beyond 0.6 of the way to the corner", clear.filter(r => r.fromMiddle >= 0.6)); line("where the alignment moved the pair by 7 cm or more", clear.filter(r => r.movedCm >= 7));
say("");
say(`After, still over 7 cm: ${clear.filter(r => r.after.cm > 7).map(r => `${r.a}/${r.b} along ${r.after.along} across ${r.after.across} (before ${r.before.along}/${r.before.across}, moved ${r.movedCm})`).join("; ") || "none"}`);
writeFileSync(join(OUT, "SOIL-CHECK.md"), out.join("\n") + "\n");
