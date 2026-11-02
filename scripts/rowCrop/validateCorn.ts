// Read-only validation runner for the corn stage readers: runs the current reader over a stage's photographs, writes
// a per-photo benchmark CSV, row-geometry measurements, and a stratified, seeded sample of observations (image
// coordinates, the reader's class, the reader's own state stored separately) for visual audit. Changes nothing in the
// readers and writes only under the output folder.
//
//   npx vite-node scripts/rowCrop/validateCorn.ts -- --stage emergence|establishment|mid|late [--out directtestimagery/validation-2026-11-02]
//
// Stage folders: emergence = veryearlystage, establishment = estabilishmentphase, mid = midphase, late =
// verylatestagecorn (no late variant exists: read with the mid variant, the nearest, and said so).
import "../bench/nodeStorageShim";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { EMERGENCE } from "../../src/lib/rowCrop/emergence";
import { readRowCrop, type RowCropRead, type RowCropStage } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { seedlingMask } from "../../src/lib/rowCrop/seedlingGreen";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const STAGE = arg("stage", "emergence")!;
const ROOT = arg("out", "directtestimagery/validation-2026-11-02")!;
const FOLDER: Record<string, string> = { emergence: "veryearlystage", establishment: "estabilishmentphase", mid: "midphase", late: "verylatestagecorn" };
const READER: Record<string, RowCropStage> = { emergence: "emergence", establishment: "establishment", mid: "mid", late: "late" };
const PHOTOS = join("directtestimagery", FOLDER[STAGE]);
const OUT = join(ROOT, STAGE);
mkdirSync(OUT, { recursive: true });
const profile = cropProfileFor("corn")!;
const revision = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();

let seed = Number(arg("seed", "20261102"));
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
const pickN = <T,>(xs: T[], n: number): T[] => { const pool = [...xs], out: T[] = []; while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]); return out; };
const r1 = (v: number) => Math.round(v * 10) / 10, r3 = (v: number) => Math.round(v * 1000) / 1000;
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : NaN; };

/** Nearest point on any row polyline: distance, the segment's unit direction, the foot point, the row index. */
function nearest(rows: [number, number][][], x: number, y: number) {
  let best = { d: Infinity, ux: 0, uy: 1, px: x, py: y, row: -1 };
  rows.forEach((pts, ri) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = pts[i][0], ay = pts[i][1], vx = pts[i + 1][0] - ax, vy = pts[i + 1][1] - ay, L2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2)), qx = ax + t * vx, qy = ay + t * vy, d = Math.hypot(x - qx, y - qy);
      if (d < best.d) { const L = Math.sqrt(L2); best = { d, ux: vx / L, uy: vy / L, px: qx, py: qy, row: ri }; }
    }
  });
  return best;
}
const inPoly = (pts: [number, number][], x: number, y: number) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) c = !c; } return c; };
const minDist = (pts: [number, number][], x: number, y: number) => { let d = Infinity; for (const [a, b] of pts) d = Math.min(d, Math.hypot(a - x, b - y)); return d; };

/** Strict seedling-mask components (photo pixels): centroid and size. */
function strictComponents(px: PhotoPixels, minPx: number, maxPx: number) {
  const m = seedlingMask(px), W = px.width, H = px.height, lab = new Uint8Array(W * H), st: number[] = [], out: { x: number; y: number; n: number }[] = [];
  for (let i0 = 0; i0 < W * H; i0++) {
    if (!m[i0] || lab[i0]) continue;
    let sx = 0, sy = 0, n = 0; lab[i0] = 1; st.push(i0);
    while (st.length) { const p = st.pop()!, x = p % W, y = (p - x) / W; sx += x; sy += y; n++; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const qq = yy * W + xx; if (m[qq] && !lab[qq]) { lab[qq] = 1; st.push(qq); } } }
    if (n >= minPx && n <= maxPx) out.push({ x: sx / n, y: sy / n, n });
  }
  return out;
}

type Sample = { id: string; photo: string; cls: string; x: number; y: number; ux: number; uy: number; info: string; reader: Record<string, unknown> };
const samples: Sample[] = [];
const perPhoto: Record<string, unknown>[] = [];
const geometry: Record<string, unknown>[] = [];
const files = readdirSync(PHOTOS).filter(f => /\.jpe?g$/i.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
const PER = STAGE === "emergence" ? { confirmed: 2, strictFound: 1, possible: 2, missing: 2, uncertain: 1, weed: 2, smallGreen: 2, rowRandom: 2, rowEnd: 1 }
  : STAGE === "establishment" ? { weed: 3, rowRandom: 3, gap: 2, fieldEnd: 2 }
  : STAGE === "mid" ? { weed: 1, seedling: 1, rowRandom: 1 }
  : { weed: 2, rowRandom: 2 };
let sid = 0;
const add = (photo: string, cls: string, x: number, y: number, ux: number, uy: number, info: string, reader: Record<string, unknown> = {}) => samples.push({ id: `${STAGE.slice(0, 2)}${String(++sid).padStart(4, "0")}`, photo, cls, x: r1(x), y: r1(y), ux: r3(ux), uy: r3(uy), info, reader });

for (const f of files) {
  const name = basename(f, extname(f));
  const raw = decodeImage(new Uint8Array(readFileSync(join(PHOTOS, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  let read: RowCropRead, err = "";
  const t0 = Date.now();
  try { read = readRowCrop(px, rowCropParamsFor(profile, null, READER[STAGE])); } catch (e) { err = String(e); perPhoto.push({ photo: name, error: err }); continue; }
  const wall = Date.now() - t0;
  const lines = read.rows.map(r => r.points);
  const gsdCm = read.gsdM * 100, pitchPx = (read.pitchM ?? 0.762) / read.gsdM, W = px.width, H = px.height;
  const plants = read.rows.flatMap(r => r.plantPoints ?? []);
  const possible = read.rows.flatMap(r => r.possiblePoints ?? []), missing = read.rows.flatMap(r => r.missingPoints ?? []), uncertain = read.rows.flatMap(r => r.uncertainPoints ?? []);
  const e = read.emergence;
  // Rows into ground the reader itself left out (a verge, a lawn, a later planting): row points inside an excluded outline.
  let rowPtsOutside = 0, rowPts = 0;
  for (const r of read.rows) for (const [x, y] of r.points) { rowPts++; if (read.excluded.some(ex => inPoly(ex.hull, x, y))) rowPtsOutside++; }
  // Duplicated rows: two rows whose lines run within a third of a pitch for a metre or more.
  let duplicates = 0;
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) { const near = lines[i].filter(([x, y]) => nearest([lines[j]], x, y).d < pitchPx / 3).length; if (near * 0.25 >= 1) duplicates++; }
  perPhoto.push({
    photo: name, stage: STAGE, reader: READER[STAGE], rows: read.rows.length, rowsDropped: read.summary.rowsDropped, plants: read.summary.plants ?? "", possible: e?.possible ?? "", missing: e?.missing ?? "", uncertain: e?.uncertain ?? "", strictFound: e?.strictFound ?? "",
    weeds: read.summary.weeds, smallGreen: read.emergence?.smallGreen ?? "", escapes: read.summary.escapes ?? "", seedlingLayer: read.seedlings?.count ?? "", gaps: read.summary.gaps, gapM: r1(read.summary.gapLengthM), rowLengthM: r1(read.summary.totalRowLengthM),
    coherence: read.summary.coherence ?? "", pitchCm: read.pitchM == null ? "" : r1(read.pitchM * 100), directionDeg: read.directionDeg ?? "", rowSpacingCv: e?.rowSpacingCv ?? "", lensK1: e?.lensK1 ?? "",
    laterPlanting: e?.laterPlanting?.greenPatches ?? "", fieldEnds: read.fieldEdge?.ends.length ?? "", excluded: read.excluded.length, rowPointsInExcluded: rowPtsOutside, rowPoints: rowPts, duplicateRowPairs: duplicates,
    ms: read.summary.ms, wallMs: wall, scaleBasis: read.scaleBasis, notes: read.notes.join(" | "), error: err,
  });

  // Geometry: every clear strict-mask seedling (40 to 1500 px) within half a pitch of a line: its distance to the line.
  if (STAGE === "emergence") {
    const comps = strictComponents(px, 40, 1500);
    const ds = comps.map(c => nearest(lines, c.x, c.y)).filter(nb => nb.d <= pitchPx / 2).map(nb => nb.d * gsdCm);
    geometry.push({ photo: name, seedlingsNearLines: ds.length, alignMedianCm: r1(q(ds, 0.5)), alignP90Cm: r1(q(ds, 0.9)), over4cm: ds.filter(d => d > 4).length, directionDeg: read.directionDeg, pitchCm: read.pitchM == null ? null : r1(read.pitchM * 100), rowSpacingCv: e?.rowSpacingCv, lensK1: e?.lensK1 });
  } else geometry.push({ photo: name, directionDeg: read.directionDeg, pitchCm: read.pitchM == null ? null : r1(read.pitchM * 100), coherence: read.summary.coherence, rows: read.rows.length });

  // Samples.
  const along = (x: number, y: number) => { const nb = nearest(lines, x, y); return { ux: nb.ux, uy: nb.uy, d: nb.d }; };
  if (STAGE === "emergence") {
    // V1 mode for the plants V1 already had (the rest of V2's plants are the strict-found ones).
    const saved = { recover: EMERGENCE.recover, extraPlantings: EMERGENCE.extraPlantings };
    Object.assign(EMERGENCE, { recover: false, extraPlantings: false });
    let v1Plants: [number, number][] = [];
    try { v1Plants = readRowCrop(px, rowCropParamsFor(profile, null, "emergence")).rows.flatMap(r => r.plantPoints ?? []); } finally { Object.assign(EMERGENCE, saved); }
    const v1Set = new Set(v1Plants.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`));
    const conf = plants.filter(([x, y]) => v1Set.has(`${Math.round(x)},${Math.round(y)}`)), sf = plants.filter(([x, y]) => !v1Set.has(`${Math.round(x)},${Math.round(y)}`));
    for (const [x, y] of pickN(conf, PER.confirmed)) { const a = along(x, y); add(name, "confirmed", x, y, a.ux, a.uy, "plant on a row (strict seedling test, a point since V1)"); }
    for (const [x, y] of pickN(sf, PER.strictFound)) { const a = along(x, y); add(name, "strictFound", x, y, a.ux, a.uy, "plant at an expected position the strict test sees (V2, over the point cap)"); }
    for (const [x, y] of pickN(possible, PER.possible)) { const a = along(x, y); add(name, "possible", x, y, a.ux, a.uy, "possible seedling: relaxed test on the planter's line"); }
    for (const [x, y] of pickN(missing, PER.missing)) { const a = along(x, y); add(name, "missing", x, y, a.ux, a.uy, "supported missing plant: nothing found, good light, quiet control"); }
    for (const [x, y] of pickN(uncertain, PER.uncertain)) { const a = along(x, y); add(name, "uncertain", x, y, a.ux, a.uy, "uncertain: dim, rim, edge or noisy control"); }
    // Weed candidates (the "larger than the crop" tier when tiers are on) and, apart, the small green the reader declines to call.
    for (const w of pickN(read.weeds.filter(q => q.tier !== "small green"), PER.weed)) { const a = along(w.x, w.y); add(name, "weed", w.x, w.y, a.ux, a.uy, `off-row green ${Math.round(w.areaM2 * 1e4)} cm², ${w.status}`, { distToRowCm: w.distToRowM == null ? null : r1(w.distToRowM * 100), areaCm2: r1(w.areaM2 * 1e4) }); }
    for (const w of pickN(read.weeds.filter(q => q.tier === "small green"), (PER as Record<string, number>).smallGreen ?? 0)) { const a = along(w.x, w.y); add(name, "smallGreen", w.x, w.y, a.ux, a.uy, `small off-row green ${Math.round(w.areaM2 * 1e4)} cm²`, { distToRowCm: w.distToRowM == null ? null : r1(w.distToRowM * 100), areaCm2: r1(w.areaM2 * 1e4) }); }
  }
  // Blind samples: uniform positions along the drawn rows (by length); the reader's state there kept apart.
  const segs: { ax: number; ay: number; bx: number; by: number; L: number }[] = [];
  for (const r of read.rows) for (let i = 0; i + 1 < r.points.length; i++) { const [ax, ay] = r.points[i], [bx, by] = r.points[i + 1]; segs.push({ ax, ay, bx, by, L: Math.hypot(bx - ax, by - ay) }); }
  const total = segs.reduce((u, s) => u + s.L, 0);
  for (let k = 0; k < (PER as Record<string, number>).rowRandom && total > 0; k++) {
    let u = rnd() * total, s = segs[0];
    for (const sg of segs) { if (u <= sg.L) { s = sg; break; } u -= sg.L; }
    const t = s.L ? u / s.L : 0, x = s.ax + t * (s.bx - s.ax), y = s.ay + t * (s.by - s.ay), ux = (s.bx - s.ax) / (s.L || 1), uy = (s.by - s.ay) / (s.L || 1);
    const cm = (d: number) => (Number.isFinite(d) ? r1(d * gsdCm) : null);
    add(name, "rowRandom", x, y, ux, uy, "a random point on a drawn row (blind)", { plantCm: cm(minDist(plants, x, y)), possibleCm: cm(minDist(possible, x, y)), missingCm: cm(minDist(missing, x, y)), uncertainCm: cm(minDist(uncertain, x, y)), inGap: read.rows.some(r => r.gaps.some(g => { const vx = g.x2 - g.x1, vy = g.y2 - g.y1, L2 = vx * vx + vy * vy || 1, tt = ((x - g.x1) * vx + (y - g.y1) * vy) / L2; return tt > 0 && tt < 1 && Math.hypot(x - g.x1 - tt * vx, y - g.y1 - tt * vy) < 8; })) });
  }
  if (STAGE === "emergence") {
    // Row ends inside the frame (not cut by the frame's edge).
    const ends: { x: number; y: number; ux: number; uy: number }[] = [];
    for (const r of read.rows) {
      const p = r.points, n = p.length; if (n < 2) continue;
      for (const [a, b] of [[n - 1, n - 2], [0, 1]] as const) { const [x, y] = p[a], [x2, y2] = p[b], L = Math.hypot(x - x2, y - y2) || 1; if (x > 0.02 * W && x < 0.98 * W && y > 0.02 * H && y < 0.98 * H) ends.push({ x, y, ux: (x - x2) / L, uy: (y - y2) / L }); }
    }
    for (const e2 of pickN(ends, PER.rowEnd)) add(name, "rowEnd", e2.x, e2.y, e2.ux, e2.uy, "a row's end inside the frame; the row runs toward it along (ux, uy)");
  }
  if (STAGE === "establishment" || STAGE === "late") {
    for (const w of pickN(read.weeds, PER.weed)) { const a = along(w.x, w.y); add(name, "weed", w.x, w.y, a.ux, a.uy, `between-row patch ${Math.round(w.areaM2 * 1e4)} cm²`, { distToRowCm: w.distToRowM == null ? null : r1(w.distToRowM * 100) }); }
  }
  if (STAGE === "establishment") {
    const gaps = read.rows.flatMap(r => r.gaps);
    for (const g of pickN(gaps, (PER as Record<string, number>).gap)) { const L = Math.hypot(g.x2 - g.x1, g.y2 - g.y1) || 1; add(name, "gap", (g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2, (g.x2 - g.x1) / L, (g.y2 - g.y1) / L, `gap ${r1(g.lengthM * 100)} cm along the row`, { lengthCm: r1(g.lengthM * 100) }); }
    for (const fe of pickN(read.fieldEdge?.ends ?? [], (PER as Record<string, number>).fieldEnd)) { const a = along(fe.x, fe.y); add(name, "fieldEnd", fe.x, fe.y, a.ux, a.uy, `field edge: ${fe.beyond} beyond`); }
  }
  if (STAGE === "mid") {
    for (const w of pickN(read.weeds, PER.weed)) { const a = along(w.x, w.y); add(name, w.sizeClass === "escape" ? "escape" : "weed", w.x, w.y, a.ux, a.uy, `between-row plant ${Math.round(w.areaM2 * 1e4)} cm²`); }
    for (const [x, y] of pickN(read.seedlings?.points ?? [], PER.seedling)) { const a = along(x, y); add(name, "seedling", x, y, a.ux, a.uy, "late-flush seedling (layer)"); }
  }
  console.log(`${name}: rows ${read.rows.length}, plants ${read.summary.plants ?? "-"}, weeds ${read.summary.weeds}, ${read.summary.ms} ms`);
}

const csv = (rows: Record<string, unknown>[]) => { const keys = [...new Set(rows.flatMap(r => Object.keys(r)))]; return [keys.join(","), ...rows.map(r => keys.map(k => { const v = r[k] ?? ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(","))].join("\n") + "\n"; };
writeFileSync(join(OUT, "per-photo.csv"), csv(perPhoto));
writeFileSync(join(OUT, "geometry.json"), JSON.stringify(geometry, null, 1));
writeFileSync(join(OUT, "samples.json"), JSON.stringify({ stage: STAGE, code: revision, photos: PHOTOS, samples }, null, 1));
console.log(`${STAGE}: ${perPhoto.length} photos, ${samples.length} samples -> ${OUT} (code ${revision})`);
