// Development only: photographs of a stored corn flight marked up with the field's dots, for a look by eye. Nothing
// is changed; the photographs are only read.
//
//   npx vite-node scripts/rowCrop/cornPictures.ts -- --analysis <analysis.json> --cache <candidate cache> --photos <dir>
//       --names 0033,0101 --out <dir> [--rules before|after] [--free] [--cache2 <dir>] [--positions field|marks]
//
// --positions field (the default, and the mode for every picture from 2026-11-16 on): every dot is drawn where the
// FIELD puts it, through the photograph's camera and moved back by that photograph's registration shift, and by
// nothing else. A ring then sits on its plant only if the field and this photograph agree where the plant is.
// --positions marks is the earlier way, kept to compare: a dot this photograph helped make is drawn on the photograph's
// own mark (so it always sits on what the photograph marked), and the others are moved by the local median difference
// between this photograph's marks and the dots it helped make. That way hid a disagreement between photographs.
// --rules: how the photographs are registered and the plant spacing taken (before: PLANTS_FIRST_V1; after: the rules
// now). --free: the loosened placement on. --cache2: a second set of candidates joined to the first.
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import { groundToPixel } from "../../src/lib/directGeoref/projection";
import { type CornPhotoRead, FIELD, cornFieldAndGround } from "../../src/lib/fieldTwin/cornField";
import { placeDots, readRows } from "../../src/lib/fieldTwin/cornPlants";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { PLANTS_FIRST, PLANTS_FIRST_V1, SEQUENCE, projectSightings, shiftOf } from "../../src/lib/fieldTwin/plantsFirst";
import { fromEnu } from "../../src/lib/sourceFrames/odm";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
const CACHE = arg("cache"), CACHE2 = opt("cache2"), DIR = arg("photos"), OUT = arg("out"), NAMES = arg("names").split(","), RULES = opt("rules") ?? "after", FREE = argv.includes("--free"), AT = opt("positions") ?? "field";
const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, frames = framesFromAnalysis(A);
mkdirSync(OUT, { recursive: true });
type Cached = { applies?: boolean; low: [number, number][]; lowWhole?: [number, number][]; span?: [number, number][]; axis?: [number, number] | null };
const cached = (dir: string | null, name: string): Cached | null => { const f = dir ? join(dir, `${name}.json`) : null; return f && existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Cached) : null; };
// The record's reads with their candidates, as cornScoreboard.ts joins them.
const reads: CornPhotoRead[] = A.reads.map(r => {
  const { low: _l, lowSpan: _s, lowAxis: _a, ...rest } = r, c = cached(CACHE, r.name), more = cached(CACHE2, r.name)?.low ?? [], on = c && c.applies !== false;
  if (!on && !more.length) return rest;
  if (on && c!.axis && c!.lowWhole && c!.span && !more.length) return { ...rest, low: c!.lowWhole, lowSpan: c!.span, lowAxis: c!.axis };
  return { ...rest, low: [...(on ? c!.low : []), ...more] };
});
const { field: F, ground } = cornFieldAndGround(reads, frames, A.fieldOptions ?? FIELD);
// "before": PLANTS_FIRST_V1. "round1": the registration / plant-spacing round as first built. Anything else: the rules now.
const opts = { ground, free: FREE, placing: RULES === "before" ? PLANTS_FIRST_V1 : RULES === "round1" ? { ...PLANTS_FIRST, tiltMustHelp: false } : PLANTS_FIRST, sequence: RULES === "round1" ? { ...SEQUENCE, spacingRulesNeedASpacing: false } : SEQUENCE };
const P = placeDots(reads, frames, F, opts); if (!P) throw new Error("the photographs made no dot");
const rec = readRows(P, F, opts), all = P.all, strict = P.strict, tier = P.tier ?? new Uint8Array(all.length), photos = P.photos;
const { sights } = projectSightings(reads, frames, F.origin);
// 0 certain, 1 probable, 2 on no row, 4 second look (two or more photographs), 5 second look (one photograph), 6 only by the loosened placement.
const kind = new Int8Array(all.length).fill(-1);
for (let i = 0; i < all.length; i++) { if (rec.rowOf[i] >= 0) kind[i] = rec.loose[i] || tier[i] === 3 ? 6 : i >= strict ? (tier[i] === 1 ? 4 : 5) : rec.certainty[i] === 0 ? 0 : 1; else if (i < strict) kind[i] = 2; }
const COL: Record<number, [number, number, number]> = { 0: [255, 255, 255], 1: [120, 220, 255], 2: [150, 150, 150], 4: [255, 214, 40], 5: [255, 70, 200], 6: [255, 120, 0] };
const RAD = (k: number) => (k === 2 ? 7 : k >= 4 ? 13 : 11), THICK = (k: number) => (k === 1 || k === 2 ? 1 : 2);
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
const text = (buf: Uint8Array, bw: number, bh: number, x: number, y: number, s: string, sc: number, col: [number, number, number]) => {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = G[ch];
    if (g) for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r * 5 + c] === "1") for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) { const xx = cx + c * sc + dx, yy = y + r * sc + dy; if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue; const o = (yy * bw + xx) * 4; buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; }
    cx += 6 * sc;
  }
};
const onRows = Array.from(kind).filter(k => k === 0 || k === 1 || k >= 4).length, lines: string[] = [`Rules ${RULES}; loosened placement ${FREE ? "on" : "off"}; ${CACHE2 ? "both second looks" : "second look as a build makes it"}; dots drawn ${AT === "field" ? "where the field puts them" : "on the photograph's own marks where it has one"}. Whole flight: ${onRows} plants on rows, ${Array.from(kind).filter(k => k === 2).length} dots on no row.`];
for (const want of NAMES) {
  const pi = photos.findIndex(p => p.includes(want)); if (pi < 0) { console.log(`no photograph named like ${want}`); continue; }
  const name = photos[pi], f = frames.get(name)!, path = [".JPG", ".jpg", ".jpeg"].map(e => join(DIR, name + e)).find(existsSync); if (!path) { console.log(`${name}: no file`); continue; }
  const img = decodeImage(new Uint8Array(readFileSync(path))), W = img.width, H = img.height, buf = img.data;
  const ring = (x: number, y: number, r: number, t: number, col: [number, number, number]) => { for (let dy = -r - t; dy <= r + t; dy++) for (let dx = -r - t; dx <= r + t; dx++) { const d = Math.hypot(dx, dy); if (d < r || d > r + t) continue; const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const o = (yy * W + xx) * 4; buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; } };
  // A field dot in this photograph: through its camera, moved back by its own registration shift (the shift depends on
  // where in the frame the dot lands, so it is found in a few rounds).
  const pixelOf = (e: number, n: number): [number, number] | null => { let de = 0, dn = 0, u = 0, v = 0; for (let it = 0; it < 4; it++) { const p = fromEnu([e - de, n - dn, 0], F.origin), h = groundToPixel(f, p.lat, p.lng, (f.ground as { altM: number }).altM ?? 0); if (!h) return null; u = h.u; v = h.v; [de, dn] = shiftOf(P.shifts[pi], u, v); } return u < 0 || v < 0 || u >= W || v >= H ? null : [u, v]; };
  const own = new Map<number, [number, number]>();
  if (AT === "marks") for (let i = 0; i < strict; i++) for (const m of all[i].members) if (sights[m].p === pi) own.set(i, [sights[m].u, sights[m].v]);
  const proj: ([number, number] | null)[] = all.map((d, i) => (kind[i] < 0 ? null : pixelOf(d.e, d.n)));
  // --positions marks only: the local median difference between this photograph's marks and the dots it helped make.
  const CELL = 300, gw = Math.ceil(W / CELL), gh = Math.ceil(H / CELL), rx: number[][] = Array.from({ length: gw * gh }, () => []), ry: number[][] = Array.from({ length: gw * gh }, () => []);
  for (const [i, o] of own) { const p = proj[i]; if (p) { const c = Math.floor(p[1] / CELL) * gw + Math.floor(p[0] / CELL); rx[c].push(o[0] - p[0]); ry[c].push(o[1] - p[1]); } }
  const med = (v: number[]) => { const t = [...v].sort((a, b) => a - b); return t[t.length >> 1]; };
  const cell = rx.map((v, c) => (v.length >= 4 ? ([med(v), med(ry[c])] as [number, number]) : null));
  const corr = (u: number, v: number): [number, number] => { const cx = Math.floor(u / CELL), cy = Math.floor(v / CELL); for (let r = 0; r <= 3; r++) { let sx = 0, sy = 0, k = 0; for (let j = cy - r; j <= cy + r; j++) for (let i = cx - r; i <= cx + r; i++) { if (i < 0 || j < 0 || i >= gw || j >= gh || Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue; const c = cell[j * gw + i]; if (c) { sx += c[0]; sy += c[1]; k++; } } if (k) return [sx / k, sy / k]; } return [0, 0]; };
  const cnt = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < all.length; i++) {
    const k = kind[i], p = proj[i]; if (k < 0) continue;
    let at: [number, number] | null = p;
    if (AT === "marks") { const o = own.get(i); at = o ?? (p ? (() => { const [dx, dy] = corr(p[0], p[1]); return [p[0] + dx, p[1] + dy] as [number, number]; })() : null); }
    if (!at || at[0] < 0 || at[1] < 0 || at[0] >= W || at[1] >= H) continue;
    ring(at[0], at[1], RAD(k), THICK(k), COL[k]); cnt[k]++;
  }
  const SC = 4, LH = 44, rowsOn = cnt[0] + cnt[1] + cnt[4] + cnt[5] + cnt[6], tag = name.slice(-6, -2);
  const leg: [number | null, string][] = [
    [null, `PHOTO ${tag}: ${rowsOn} PLANTS ON ROWS (ALL PHOTOS TOGETHER), RULES ${RULES}`],
    [null, AT === "field" ? "EVERY RING IS DRAWN WHERE THE FIELD PUTS THE DOT" : "RINGS ON THIS PHOTO'S OWN MARKS WHERE IT HAS ONE"],
    [0, `WHITE = PLANT ON A ROW, MOST PHOTOS SAW IT: ${cnt[0]}`],
    [1, `BLUE = PLANT ON A ROW, PROBABLE: ${cnt[1]}`],
    [4, `YELLOW = SECOND LOOK, 2+ PHOTOS: ${cnt[4]}`],
    [5, `PINK = SECOND LOOK, 1 PHOTO NEAR FRAME MIDDLE: ${cnt[5]}`],
    ...(FREE ? [[6, `ORANGE = ADDED BY THE LOOSENED ROW RULE: ${cnt[6]}`] as [number, string]] : []),
    [2, `GREY SMALL = A DOT ON NO ROW: ${cnt[2]}`],
  ];
  const bw = Math.max(...leg.map(l => l[1].length)) * 6 * SC + 110, bh = leg.length * LH + 30;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const o = (y * W + x) * 4; buf[o] = 20; buf[o + 1] = 20; buf[o + 2] = 20; }
  leg.forEach(([k, s], li) => { const y = 18 + li * LH; if (k != null) ring(40, y + 14, RAD(k), THICK(k) + 1, COL[k]); text(buf, W, H, k == null ? 20 : 80, y, s, SC, k == null ? [255, 255, 255] : COL[k]); });
  writeFileSync(join(OUT, `${tag}-${RULES}.jpg`), encodeJpeg(img, 88));
  const line = `${tag}: on rows ${rowsOn} (white ${cnt[0]}, blue ${cnt[1]}, yellow ${cnt[4]}, pink ${cnt[5]}, orange ${cnt[6]}); on no row (grey) ${cnt[2]}`;
  lines.push(line); console.log(line);
}
writeFileSync(join(OUT, `counts-${RULES}.txt`), lines.join("\r\n"));
