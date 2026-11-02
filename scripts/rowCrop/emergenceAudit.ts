// An audit of the frozen emergence reader (tag emergence-v2-frozen), reading it and changing nothing. Three questions:
//
// 1. Do the row lines follow the seedlings or the soil furrows? At sampled clear seedlings (strict-mask components of
//    at least SEED_MIN_PX photo pixels within half a pitch of a line), the perpendicular distance from the seedling's
//    centre to the drawn line; and around each, across a window 1 m along the line, the across-profile of green
//    (where the plants stand) and of darkness (the furrow), each peak's offset from the line. Where the furrow and the
//    plants part, the line should sit on the plants.
// 2. The red off-row patches: a sample cut for checking by eye.
// 3. The row ends: those in the bottom fifth of the frame, away from the frame's edge, cut for checking by eye.
//
//   npx vite-node scripts/rowCrop/emergenceAudit.ts -- [--photos directtestimagery/veryearlystage] [--per 5]
// Writes <photos>/outputs/emergence-audit/: audit.json, audit.md, seedlings-1.jpg, seedlings-2.jpg, off-row.jpg, ends.jpg
// and the sample lists beside each sheet (the order a verdict is recorded in).
import "../bench/nodeStorageShim";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readRowCrop, type RowCropRead } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { seedlingMask } from "../../src/lib/rowCrop/seedlingGreen";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const PHOTOS = arg("photos", "directtestimagery/veryearlystage")!;
const PER = Number(arg("per", "5"));
const OUT = join(PHOTOS, "outputs", "emergence-audit");
const SEED_MIN_PX = 40;
const revision = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();
mkdirSync(OUT, { recursive: true });

let seed = 11;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
const pickN = <T,>(xs: T[], n: number): T[] => { const pool = [...xs], out: T[] = []; while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]); return out; };

type Seg = { ax: number; ay: number; bx: number; by: number };
/** Nearest point on any row's polyline: distance (signed by the segment's left normal), the segment's unit direction. */
function nearest(rows: [number, number][][], x: number, y: number) {
  let best = { d: Infinity, sd: 0, ux: 0, uy: 1, px: 0, py: 0 };
  for (const pts of rows) for (let i = 0; i + 1 < pts.length; i++) {
    const s: Seg = { ax: pts[i][0], ay: pts[i][1], bx: pts[i + 1][0], by: pts[i + 1][1] };
    const vx = s.bx - s.ax, vy = s.by - s.ay, L2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (y - s.ay) * vy) / L2));
    const qx = s.ax + t * vx, qy = s.ay + t * vy, d = Math.hypot(x - qx, y - qy);
    if (d < best.d) { const L = Math.sqrt(L2), ux = vx / L, uy = vy / L; best = { d, sd: (x - qx) * -uy + (y - qy) * ux, ux, uy, px: qx, py: qy }; }
  }
  return best;
}

/** Across-profiles at a line point: mean darkness and green share per across offset, over `alongPx` along. */
function profiles(px: PhotoPixels, mask: Uint8Array, cx: number, cy: number, ux: number, uy: number, halfAcross: number, halfAlong: number) {
  const n = 2 * halfAcross + 1, dark = new Float64Array(n), green = new Float64Array(n), cnt = new Float64Array(n);
  const nx = -uy, ny = ux;
  for (let a = -halfAlong; a <= halfAlong; a++) for (let c = -halfAcross; c <= halfAcross; c++) {
    const x = Math.round(cx + a * ux + c * nx), y = Math.round(cy + a * uy + c * ny);
    if (x < 0 || y < 0 || x >= px.width || y >= px.height) continue;
    const i = y * px.width + x, o = i * 4, j = c + halfAcross;
    dark[j] += 255 - (0.3 * px.rgba[o] + 0.59 * px.rgba[o + 1] + 0.11 * px.rgba[o + 2]); green[j] += mask[i]; cnt[j]++;
  }
  for (let j = 0; j < n; j++) if (cnt[j]) { dark[j] /= cnt[j]; green[j] /= cnt[j]; }
  const smooth = (v: Float64Array, r: number) => v.map((_, j) => { let s = 0, k = 0; for (let q = Math.max(0, j - r); q <= Math.min(n - 1, j + r); q++) { s += v[q]; k++; } return s / k; });
  return { dark, green, smooth, n };
}

type Sample = { photo: string; x: number; y: number; lx?: number; ly?: number; ux?: number; uy?: number; kind: string; distCm?: number; signedCm?: number; greenPeakCm?: number; furrowPeakCm?: number; radius?: number };
const seedlings: Sample[] = [], offRow: Sample[] = [], ends: Sample[] = [];
const pix = new Map<string, PhotoPixels>();
const perPhoto: Record<string, unknown>[] = [];
const files = readdirSync(PHOTOS).filter(f => /\.jpe?g$/i.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
for (const f of files) {
  const name = basename(f, extname(f));
  const raw = decodeImage(new Uint8Array(readFileSync(join(PHOTOS, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  pix.set(name, px);
  const read: RowCropRead = readRowCrop(px, rowCropParamsFor(cropProfileFor("corn")!, null, "emergence"));
  const lines = read.rows.map(r => r.points);
  const gsdCm = read.gsdM * 100, pitchPx = (read.pitchM ?? 0.762) / read.gsdM;
  const mask = seedlingMask(px);
  // Clear seedlings: strict-mask components of at least SEED_MIN_PX pixels, within half a pitch of a line.
  const W = px.width, H = px.height, lab = new Uint8Array(W * H), st: number[] = [];
  const cands: { x: number; y: number; n: number }[] = [];
  for (let i0 = 0; i0 < W * H; i0++) {
    if (!mask[i0] || lab[i0]) continue;
    let sx = 0, sy = 0, n = 0; lab[i0] = 1; st.push(i0);
    while (st.length) { const p = st.pop()!, x = p % W, y = (p - x) / W; sx += x; sy += y; n++; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const q = yy * W + xx; if (mask[q] && !lab[q]) { lab[q] = 1; st.push(q); } } }
    if (n >= SEED_MIN_PX && n <= 1500) cands.push({ x: sx / n, y: sy / n, n });
  }
  const near = cands.map(c => ({ c, nb: nearest(lines, c.x, c.y) })).filter(o => o.nb.d <= pitchPx / 2);
  // Stratified by distance from the frame's centre (the lens bends most at the rim): a third each.
  const rOf = (x: number, y: number) => Math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2)) / Math.SQRT2;
  const strata = [near.filter(o => rOf(o.c.x, o.c.y) < 0.4), near.filter(o => { const r = rOf(o.c.x, o.c.y); return r >= 0.4 && r < 0.7; }), near.filter(o => rOf(o.c.x, o.c.y) >= 0.7)];
  const picked = strata.flatMap((s, k) => pickN(s, Math.ceil(PER / 3) + (k === 2 ? 0 : 0))).slice(0, PER);
  for (const { c, nb } of picked) {
    const pr = profiles(px, mask, nb.px, nb.py, nb.ux, nb.uy, Math.round(pitchPx * 0.3), Math.round(0.5 / read.gsdM));
    const g = pr.smooth(pr.green, Math.round(1 / gsdCm)), dk = pr.smooth(pr.dark, Math.round(1.5 / gsdCm));
    let gi = 0, di = 0; for (let j = 0; j < pr.n; j++) { if (g[j] > g[gi]) gi = j; if (dk[j] > dk[di]) di = j; }
    const half = (pr.n - 1) / 2;
    seedlings.push({ photo: name, x: c.x, y: c.y, lx: nb.px, ly: nb.py, ux: nb.ux, uy: nb.uy, kind: "seedling", distCm: nb.d * gsdCm, signedCm: nb.sd * gsdCm, greenPeakCm: (gi - half) * gsdCm, furrowPeakCm: (di - half) * gsdCm, radius: rOf(c.x, c.y) });
  }
  // Off-row patches and bottom row ends, for the eye.
  for (const w of read.weeds) { const nb = nearest(lines, w.x, w.y); offRow.push({ photo: name, x: w.x, y: w.y, lx: nb.px, ly: nb.py, ux: nb.ux, uy: nb.uy, distCm: nb.d * gsdCm, kind: `${w.status}, ${Math.round(w.areaM2 * 1e4)} cm², ${Math.round(nb.d * gsdCm)} cm from a line` }); }
  for (const r of read.rows) {
    for (const [i, j] of [[r.points.length - 1, r.points.length - 2], [0, 1]] as const) {
      const p = r.points[i], q = r.points[j] ?? p;
      if (p[1] < 0.8 * H || p[1] > 0.985 * H || p[0] < 0.015 * W || p[0] > 0.985 * W) continue;
      const L = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
      const ux = (p[0] - q[0]) / L, uy = (p[1] - q[1]) / L, oneM = 1 / read.gsdM, tol = 0.03 / read.gsdM;
      const beyond = cands.filter(c => { const a = (c.x - p[0]) * ux + (c.y - p[1]) * uy, b = Math.abs((c.x - p[0]) * -uy + (c.y - p[1]) * ux); return a > 0.05 * oneM && a <= oneM && b <= tol; });
      const asWeed = beyond.filter(c => read.weeds.some(w => Math.hypot(w.x - c.x, w.y - c.y) < 0.03 / read.gsdM)).length;
      const onOther = beyond.filter(c => read.rows.some(r2 => r2 !== r && (r2.plantPoints ?? []).some(([x, y]) => Math.hypot(x - c.x, y - c.y) < 0.03 / read.gsdM))).length;
      // the frame's edge along the line from the end: how much photograph is left past it
      let left = 0; while (left < 3 * oneM) { const x = p[0] + left * ux, y = p[1] + left * uy; if (x < 0 || y < 0 || x >= W || y >= H) break; left += 2; }
      ends.push({ photo: name, x: p[0], y: p[1], ux, uy, kind: `end: ${beyond.length} clear seedlings within 3 cm of the line's extension in the next metre (${asWeed} listed off-row, ${onOther} on another row), ${Math.round(left * read.gsdM * 100)} cm of photo left`, distCm: beyond.length });
    }
  }
  perPhoto.push({ photo: name, rows: read.rows.length, clearSeedlingsNearLines: near.length, weeds: read.weeds.length, bottomEnds: ends.filter(e => e.photo === name).length, gsdCm: Math.round(gsdCm * 1000) / 1000 });
  console.log(`${name}: ${near.length} clear seedlings near lines, ${read.weeds.length} off-row, ${ends.filter(e => e.photo === name).length} bottom ends`);
}

// Sheets: square crops with the line (or the hull centre) marked, at Z times.
function sheet(samples: Sample[], file: string, halfPx: number, Z: number, cols: number, drawLine: boolean) {
  const cell = 2 * halfPx * Z, rowsN = Math.ceil(samples.length / cols), W = cols * cell, H = rowsN * cell, img = new Uint8Array(W * H * 4);
  samples.forEach((s, k) => {
    const px = pix.get(s.photo)!, ox = (k % cols) * cell, oy = Math.floor(k / cols) * cell;
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const sx = Math.floor(s.x - halfPx + x / Z), sy = Math.floor(s.y - halfPx + y / Z), o = ((oy + y) * W + ox + x) * 4;
      img[o + 3] = 255; if (sx < 0 || sy < 0 || sx >= px.width || sy >= px.height) continue;
      const q = (sy * px.width + sx) * 4; img[o] = px.rgba[q]; img[o + 1] = px.rgba[q + 1]; img[o + 2] = px.rgba[q + 2];
    }
    const put = (x: number, y: number, c: [number, number, number]) => { if (x < ox || y < oy || x >= ox + cell || y >= oy + cell) return; const o = (Math.round(y) * W + Math.round(x)) * 4; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; };
    const toCell = (x: number, y: number): [number, number] => [ox + (x - s.x + halfPx) * Z, oy + (y - s.y + halfPx) * Z];
    if (s.kind !== "seedling" && drawLine) for (let a = 0; a < 64; a++) { const t = (a / 64) * 2 * Math.PI, r = 0.03 / 0.0048 * Z; put(ox + cell / 2 + r * Math.cos(t), oy + cell / 2 + r * Math.sin(t), [255, 60, 60]); }
    if (drawLine && s.lx != null && s.ux != null) {
      // The row's line, dotted so the plant under it stays visible.
      for (let a = -2 * halfPx; a <= 2 * halfPx; a += 0.25) { if (Math.floor(a) % 3 === 0) continue; const [x, y] = toCell(s.lx + a * s.ux, s.ly! + a * s.uy!); put(x, y, [0, 230, 255]); }
      // Tick marks every 2 cm across the line at the sample's place.
      const nx = -s.uy!, ny = s.ux, cm = 1 / 0.48;
      for (let t = -4; t <= 4; t++) for (let a = -1.5; a <= 1.5; a += 0.25) { const [x, y] = toCell(s.lx + t * 2 * cm * nx + a * s.ux, s.ly! + t * 2 * cm * ny + a * s.uy!); put(x, y, t ? [255, 255, 0] : [0, 230, 255]); }
    } else if (s.ux != null) {
      // A row end: the line's last metre drawn up to the end, a white bar across it there.
      for (let a = 0; a <= 2 * halfPx; a += 0.25) { if (Math.floor(a) % 3 === 0) continue; const [x, y] = toCell(s.x - a * s.ux, s.y - a * s.uy!); put(x, y, [0, 230, 255]); }
      for (let a = -12; a <= 12; a += 0.25) { const [x, y] = toCell(s.x + a * -s.uy!, s.y + a * s.ux); put(x, y, [255, 255, 255]); }
    } else {
      for (let a = 0; a < 64; a++) { const t = (a / 64) * 2 * Math.PI, r = 0.03 / 0.0048 * Z; put(ox + cell / 2 + r * Math.cos(t), oy + cell / 2 + r * Math.sin(t), [255, 60, 60]); }
    }
    for (let i = 0; i < cell; i++) { put(ox + i, oy, [20, 20, 20]); put(ox, oy + i, [20, 20, 20]); }
  });
  writeFileSync(join(OUT, `${file}.jpg`), encodeJpeg({ width: W, height: H, data: img }, 90));
  writeFileSync(join(OUT, `${file}.json`), JSON.stringify(samples.map(({ photo, x, y, kind, distCm }) => ({ photo, x: Math.round(x), y: Math.round(y), kind, distCm: distCm == null ? undefined : Math.round(distCm * 10) / 10 })), null, 1));
}
sheet(seedlings.slice(0, 54), "seedlings-1", 32, 4, 6, true);
sheet(seedlings.slice(54, 108), "seedlings-2", 32, 4, 6, true);
const offPick = pickN(offRow, 48);
sheet(offPick, "off-row", 32, 4, 6, true);
const endPick = pickN(ends, 36);
sheet(endPick, "ends", 64, 2, 6, false);

const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : NaN; };
const r1 = (v: number) => Math.round(v * 10) / 10;
const dist = seedlings.map(s => s.distCm!), byR = (lo: number, hi: number) => seedlings.filter(s => s.radius! >= lo && s.radius! < hi).map(s => s.distCm!);
const parted = seedlings.filter(s => Math.abs(s.greenPeakCm! - s.furrowPeakCm!) >= 2);
const summary = {
  date: new Date().toISOString().slice(0, 10), code: revision, photos: files.length, seedlings: seedlings.length,
  distanceCm: { median: r1(q(dist, 0.5)), p90: r1(q(dist, 0.9)), max: r1(q(dist, 1)), within2cm: seedlings.filter(s => s.distCm! <= 2).length, within4cm: seedlings.filter(s => s.distCm! <= 4).length },
  byRadius: { centre: { n: byR(0, 0.4).length, median: r1(q(byR(0, 0.4), 0.5)), p90: r1(q(byR(0, 0.4), 0.9)) }, middle: { n: byR(0.4, 0.7).length, median: r1(q(byR(0.4, 0.7), 0.5)), p90: r1(q(byR(0.4, 0.7), 0.9)) }, rim: { n: byR(0.7, 9).length, median: r1(q(byR(0.7, 9), 0.5)), p90: r1(q(byR(0.7, 9), 0.9)) } },
  signedBiasCm: r1(q(seedlings.map(s => s.signedCm!), 0.5)),
  greenPeakFromLineCm: { median: r1(q(seedlings.map(s => Math.abs(s.greenPeakCm!)), 0.5)), p90: r1(q(seedlings.map(s => Math.abs(s.greenPeakCm!)), 0.9)) },
  furrowPeakFromLineCm: { median: r1(q(seedlings.map(s => Math.abs(s.furrowPeakCm!)), 0.5)), p90: r1(q(seedlings.map(s => Math.abs(s.furrowPeakCm!)), 0.9)) },
  furrowAndPlantsPart: { n: parted.length, lineToGreenMedianCm: r1(q(parted.map(s => Math.abs(s.greenPeakCm!)), 0.5)), lineToFurrowMedianCm: r1(q(parted.map(s => Math.abs(s.furrowPeakCm!)), 0.5)) },
  offRow: offRow.length, offRowDistanceCm: { median: r1(q(offRow.map(o => o.distCm!), 0.5)), under12: offRow.filter(o => o.distCm! < 12).length },
  bottomEnds: ends.length, bottomEndsWithSeedlingsBeyond: ends.filter(e => e.distCm! > 0).length, seedlingsBeyondEnds: ends.reduce((u, e) => u + e.distCm!, 0),
};
writeFileSync(join(OUT, "audit.json"), JSON.stringify({ summary, perPhoto, seedlings }, null, 1));
console.log(JSON.stringify(summary, null, 1));
