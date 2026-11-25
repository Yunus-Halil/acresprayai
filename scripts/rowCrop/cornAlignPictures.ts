// Development only, read only: before and after aligning the photographs together (fieldTwin/alignTogether.ts), drawn
// on a photograph. Left half: the photographs as the registration leaves them; right half: aligned together.
//   yellow rings   this photograph's own marks (they sit on what it saw; the same in both halves)
//   cyan rings     marks of the other photographs on ITS flight line, drawn where the field puts them
//   magenta rings  marks of photographs on the OTHER flight lines, drawn where the field puts them
// A ring is drawn only where its pixel looks back at its own ground (within 5 cm), as every picture since 2026-11-16.
//
//   npx vite-node scripts/rowCrop/cornAlignPictures.ts -- --analysis <analysis.json> --photos <dir (any depth)> --out <dir>
//       --spots "<photo number>@<lat>,<lng>:<label>;<photo number>:<x>,<y>,<width>,<height>:<label>" [--zoom 3]
import "../bench/nodeStorageShim";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import { groundToPixel, pixelToGround } from "../../src/lib/directGeoref/projection";
import { type PhotoShift, shiftOf } from "../../src/lib/fieldTwin/plantsFirst";
import { fromEnu, toEnu } from "../../src/lib/sourceFrames/odm";
import { flightLines } from "./cornAlignLib";
import { alignStates, photoFiles } from "./cornAlignStates";
import { type Canvas, type Rgb, line, ring } from "./draw";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); if (i < 0) { if (d == null) throw new Error(`--${k} is required`); return d; } return argv[i + 1]; };
const DIR = arg("photos"), OUT = arg("out"), Z = Number(arg("zoom", "3"));
mkdirSync(OUT, { recursive: true });
// The right half is the alignment as fitted, whether or not its own check would keep it (the check's verdict is printed).
const S = alignStates(arg("analysis")), { frames, photos, sights } = S, F = { origin: S.origin }, P0 = { shifts: S.before }, P1 = { shifts: S.after };
console.log(`the alignment's own check: ${S.report.applied ? "kept" : `not kept (${S.report.why})`}; marks matched within 2 cm ${S.report.matched[0]} -> ${S.report.matched[1]} of ${S.report.marks}`);
const cam = photos.map(n => { const f = frames.get(n)!; const [e, nn] = toEnu({ lat: f.pose.lat, lng: f.pose.lng, altM: 0 }, F.origin); return { e, n: nn, h: 1, W: f.intrinsics.width, H: f.intrinsics.height, cx: f.intrinsics.cx, cy: f.intrinsics.cy }; });
const lines = flightLines(cam), lineOf = new Int32Array(photos.length).fill(-1); lines.forEach((L, k) => { for (const p of L.photos) lineOf[p] = k; });
const fileOf = photoFiles(DIR);
const YELLOW: Rgb = [255, 230, 0], CYAN: Rgb = [0, 230, 255], MAGENTA: Rgb = [255, 40, 220], WHITE: Rgb = [255, 255, 255];

for (const spec of arg("spots").split(";").filter(Boolean)) {
  const byGround = spec.includes("@"), [head, ...rest] = spec.split(":"), label = rest[rest.length - 1];
  const key = byGround ? head.split("@")[0] : head, pi = photos.findIndex(n => n.includes(`_${key}_`) || n.endsWith(`_${key}`));
  if (pi < 0) { console.log(`${key}: no such photograph`); continue; }
  const f = frames.get(photos[pi])!, altM = (f.ground as { altM: number }).altM ?? 0, W = f.intrinsics.width, H = f.intrinsics.height;
  // A ground place in this photograph under one state's corrections, and whether the pixel looks back at it.
  const pixelOf = (S: PhotoShift[], e: number, n: number): [number, number] | null => {
    let de = 0, dn = 0, u = 0, v = 0;
    for (let it = 0; it < 4; it++) { const p = fromEnu([e - de, n - dn, 0], F.origin), h = groundToPixel(f, p.lat, p.lng, altM); if (!h) return null; u = h.u; v = h.v; [de, dn] = shiftOf(S[pi], u, v); }
    if (u < 0 || v < 0 || u >= W || v >= H) return null;
    const g = pixelToGround(f, u, v); if (!g) return null;
    const b = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, F.origin), [se, sn] = shiftOf(S[pi], u, v);
    return Math.hypot(b[0] + se - e, b[1] + sn - n) <= 0.05 ? [u, v] : null;
  };
  let x0: number, y0: number, w: number, h: number;
  if (byGround) { const [lat, lng] = head.split("@")[1].split(",").map(Number), [e, n] = toEnu({ lat, lng, altM: 0 }, F.origin), q = pixelOf(P1.shifts, e, n); if (!q) { console.log(`${spec}: that place is not in the photograph`); continue; } w = 520; h = 400; x0 = Math.round(q[0] - w / 2); y0 = Math.round(q[1] - h / 2); }
  else [x0, y0, w, h] = rest[0].split(",").map(Number);
  x0 = Math.max(0, Math.min(W - w, x0)); y0 = Math.max(0, Math.min(H - h, y0));
  const file = fileOf(photos[pi]); if (!file) { console.log(`${key}: no file`); continue; }
  const img = decodeImage(new Uint8Array(readFileSync(file)));
  const GAP = 12, cw = w * Z, ch = h * Z, cv: Canvas = { w: 2 * cw + GAP, h: ch, c: new Uint8Array((2 * cw + GAP) * ch * 4).fill(255) };
  for (let half = 0; half < 2; half++) for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const s = ((y0 + Math.floor(y / Z)) * img.width + x0 + Math.floor(x / Z)) * 4, d = (y * cv.w + half * (cw + GAP) + x) * 4; cv.c[d] = img.data[s]; cv.c[d + 1] = img.data[s + 1]; cv.c[d + 2] = img.data[s + 2]; cv.c[d + 3] = 255; }
  const counts: number[][] = [];
  [P0.shifts, P1.shifts].forEach((S, half) => {
    const ox = half * (cw + GAP), put = (u: number, v: number, col: Rgb, r: number) => { const x = (u - x0) * Z, y = (v - y0) * Z; if (x < r || y < r || x >= cw - r || y >= ch - r) return false; ring(cv, ox + x, y, r, col, 1); return true; };
    let own = 0, same = 0, other = 0, matched = 0;
    const ownPx: [number, number][] = [];
    for (const s of sights) if (s.p === pi && put(s.u, s.v, YELLOW, 4)) { own++; ownPx.push([s.u, s.v]); }
    for (const s of sights) {
      if (s.p === pi) continue;
      const [de, dn] = shiftOf(S[s.p], s.u, s.v), q = pixelOf(S, s.e + de, s.n + dn); if (!q) continue;
      const onLine = lineOf[s.p] === lineOf[pi];
      if (!put(q[0], q[1], onLine ? CYAN : MAGENTA, onLine ? 7 : 10)) continue;
      if (onLine) same++; else { other++; const g = pixelToGround(f, q[0], q[1]), g1 = pixelToGround(f, q[0] + 1, q[1]); const px = g && g1 ? Math.hypot(...(toEnu({ lat: g1.lat, lng: g1.lng, altM: 0 }, F.origin).map((x, k) => x - toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, F.origin)[k]) as [number, number, number])) : 0.006; if (ownPx.some(([u, v]) => Math.hypot(u - q[0], v - q[1]) * px <= 0.02)) matched++; }
    }
    counts.push([own, same, other, matched]);
  });
  // A 10 cm bar, bottom left of each half.
  { const g = pixelToGround(f, x0, y0), g1 = pixelToGround(f, x0 + 100, y0); if (g && g1) { const a = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, F.origin), b = toEnu({ lat: g1.lat, lng: g1.lng, altM: 0 }, F.origin), per100 = Math.hypot(b[0] - a[0], b[1] - a[1]), bar = (0.1 / per100) * 100 * Z; for (let half = 0; half < 2; half++) line(cv, half * (cw + GAP) + 20, ch - 20, half * (cw + GAP) + 20 + bar, ch - 20, WHITE, 2); } }
  const name = `${key}-${label}.jpg`;
  writeFileSync(join(OUT, name), encodeJpeg({ width: cv.w, height: cv.h, data: cv.c }, 90));
  console.log(`${name}: photograph ${photos[pi].slice(-6)} (flight line ${lineOf[pi] + 1}), crop x ${x0} y ${y0} ${w} x ${h}, ${((Math.hypot(x0 + w / 2 - f.intrinsics.cx, y0 + h / 2 - f.intrinsics.cy) / Math.hypot(W / 2, H / 2)) * 100).toFixed(0)} % of the way from the frame's middle to its corner. Before: own marks ${counts[0][0]}, same line ${counts[0][1]}, other lines ${counts[0][2]} (of those, within 2 cm of an own mark: ${counts[0][3]}). After: other lines ${counts[1][2]} (within 2 cm of an own mark: ${counts[1][3]}).`);
}
