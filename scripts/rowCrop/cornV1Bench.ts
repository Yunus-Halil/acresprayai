// Corn V1 benchmark (2026-11-04): the adaptive reader as the app ran it (A) beside Corn V1 with plants located on the
// green (V1) and, when MaSC boxes are given, Corn V1 with MaSC's plants in their place (V1+MaSC), on the same photos.
//   npx vite-node scripts/rowCrop/cornV1Bench.ts --images <dir> --out <dir> [--labels <dir>] [--usu <mosaics dir>]
//       [--masc <dir of <stem>.f3.json>] [--points <dir of green points, same format, to skip locating them>]
//       [--crop corn] [--gsd-cm 0.48] [--draw-every 1] [--limit N] [--name "set label"]
// With plant labels: labelled plants on a row and on a CORN row; rows true/false overall and among corn rows (a false
// corn row is the error that would become a confident finding); crop called weed (reported weed candidates on a
// labelled plant); FALSE STAND GAPS (a reported gap with a labelled plant on the row's line inside it). With USU weed
// boxes: reported weed candidates on a labelled weed (real weeds kept). Without labels: counts and pictures.
import "../bench/nodeStorageShim";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { NODE_DECODER, decodeImage, encodeJpeg } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { adaptiveAsRead, readCornAdaptive } from "../../src/lib/rowCrop/adaptive";
import { cornV1AsRead, cornV1PlantPoints, fuseCornV1 } from "../../src/lib/rowCrop/cornV1";
import { seedlingCache } from "../../src/lib/rowCrop/seedlingGreen";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { distToLine, rowsFromPoints, type PlantPoint } from "../../src/lib/rowCrop/plantRows";
import type { RowCropRead } from "../../src/lib/rowCrop/readRowCrop";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { canvasOf, drawRead, poly, type Canvas } from "./draw";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const IMAGES = arg("images")!, OUT = arg("out")!, LABELS = arg("labels"), USU = arg("usu"), MASC = arg("masc"), POINTS = arg("points");
const CROP = arg("crop", "corn")!, GSD = arg("gsd-cm") ? Number(arg("gsd-cm")) / 100 : null;
const DRAW_EVERY = Number(arg("draw-every", "1")), LIMIT = Number(arg("limit", "0")), NAME = arg("name", basename(IMAGES.replace(/[\\/]images$/, "")))!;
if (!IMAGES || !OUT) { console.error("need --images and --out"); process.exit(1); }
const revision = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();
const profile = cropProfileFor("corn")!;
const MODES = MASC ? (["A", "V1", "V1M"] as const) : (["A", "V1"] as const);
type Mode = "A" | "V1" | "V1M";
const LABEL: Record<Mode, string> = { A: "A adaptive reader (the app until now)", V1: "Corn V1", V1M: "Corn V1 + MaSC plants" };
type Box = [number, number, number, number];
type Line = [number, number][];
const inBox = (b: Box, x: number, y: number, grow = 0.1) => { const gx = (b[2] - b[0]) * grow, gy = (b[3] - b[1]) * grow; return x >= b[0] - gx && x <= b[2] + gx && y >= b[1] - gy && y <= b[3] + gy; };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10} %` : "-");
const densify = (l: Line, step: number): Line => { if (l.length < 2) return l; const out: Line = [l[0]]; for (let i = 1; i < l.length; i++) { const [ax, ay] = l[i - 1], [bx, by] = l[i], k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step)); for (let j = 1; j <= k; j++) out.push([ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k]); } return out; };

type Acc = Record<string, number>;
const tot = new Map<string, Acc>();
const add = (group: string, k: string, v: number) => { for (const g of [group, "all"]) { const a = tot.get(g) ?? {}; a[k] = (a[k] ?? 0) + v; tot.set(g, a); } };
const per: Record<string, unknown>[] = [];
let files = readdirSync(IMAGES).filter(f => /\.(jpe?g|png)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (LIMIT) files = files.slice(0, LIMIT);
for (const m of MODES) mkdirSync(join(OUT, m), { recursive: true });
let n = 0;
for (const f of files) {
  const stem = basename(f, extname(f));
  const mf = MASC ? join(MASC, `${stem}.f3.json`) : null;
  if (mf && !existsSync(mf)) continue;
  const raw = decodeImage(new Uint8Array(readFileSync(join(IMAGES, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  let gt: Box[] | null = null, group = "all-images", weedsGt: Box[] | null = null;
  if (LABELS && existsSync(join(LABELS, `${stem}.json`))) {
    const l = JSON.parse(readFileSync(join(LABELS, `${stem}.json`), "utf8")); group = l.group ?? group;
    // Malformed boxes (a few label files hold boxes spanning the whole plot) are dropped and counted: inside one, every
    // weed candidate would count as crop called weed.
    // A box over 15 % of the photo's long side is no plant: two UAVmulticrop maize files hold mostly such boxes (their
    // plots unscoreable, skipped and counted); elsewhere a stray one is dropped and counted.
    const all = l.boxes as Box[], big = (b: Box) => Math.max(b[2] - b[0], b[3] - b[1]) > 0.15 * Math.max(px.width, px.height);
    const nBig = all.filter(big).length;
    if (nBig > 0.2 * all.length) { add(group, "brokenLabelImages", 1); console.log(`${stem}: ${nBig} of ${all.length} label boxes span the photo: not scored`); continue; }
    gt = all.filter(b => !big(b));
    add(group, "malformedBoxes", nBig);
  }
  if (USU) { const meta = JSON.parse(readFileSync(join(USU, `${stem}.json`), "utf8")); weedsGt = (meta.boxes as { x: number; y: number; w: number; h: number }[]).map(b => [b.x - b.w / 2, b.y - b.h / 2, b.x + b.w / 2, b.y + b.h / 2]); }
  const gsd = USU ? 0.0048 : GSD;
  const params = rowCropParamsFor(profile, gsd);

  // As readCornV1 reads a photograph: one seedling mask shared by the green read and the plant read, and the plant
  // read's mask chosen by what the green read found (cornV1PlantPoints).
  const seedlings = seedlingCache(px);
  const t0 = Date.now(); const ad = readCornAdaptive(px, params, { seedlings }); const msGreen = Date.now() - t0;
  let gpts: PlantPoint[], msPts: number;
  const pf = POINTS ? join(POINTS, `${stem}.f3.json`) : null;
  if (pf && existsSync(pf)) { const j = JSON.parse(readFileSync(pf, "utf8")); gpts = (j.boxes as number[][]).map(b => ({ x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 })); msPts = j.ms; }
  else { const t1 = Date.now(); gpts = cornV1PlantPoints(px, ad, seedlings); msPts = Date.now() - t1; }
  const reads: Partial<Record<Mode, RowCropRead>> = { A: adaptiveAsRead(ad) };
  const v1 = fuseCornV1(ad, gpts, params, { enteredCrop: CROP, source: "green", greenMs: msGreen, plantsMs: msPts });
  reads.V1 = cornV1AsRead(v1);
  let mascMs = 0, v1m: ReturnType<typeof fuseCornV1> | null = null;
  if (mf) {
    const mj = JSON.parse(readFileSync(mf, "utf8")) as { boxes: number[][]; ms: number };
    mascMs = mj.ms;
    v1m = fuseCornV1(ad, mj.boxes.filter(b => b[4] >= 0.3).map(b => ({ x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 })), params, { enteredCrop: CROP, source: "detector", greenMs: msGreen, plantsMs: mj.ms });
    reads.V1M = cornV1AsRead(v1m);
  }
  add(group, "images", 1); add(group, "msGreen", msGreen); add(group, "msPoints", msPts); add(group, "msFusion", v1.summary.ms.fusion); add(group, "msMasc", mascMs);
  const row: Record<string, unknown> = { image: stem, group };
  for (const m of MODES) {
    const r = reads[m]!;
    const all = r.rows.map(x => x.points), corn = r.rows.filter(x => x.identity !== "probable crop").map(x => x.points);
    const weeds = r.weeds.filter(w => w.tier !== "small green"), gaps = r.rows.flatMap(x => x.gaps);
    add(group, `rows:${m}`, all.length); add(group, `cornRows:${m}`, corn.length); add(group, `weeds:${m}`, weeds.length); add(group, `gaps:${m}`, gaps.length); add(group, `noRows:${m}`, all.length ? 0 : 1);
    row[`rows_${m}`] = all.length; row[`corn_${m}`] = corn.length; row[`weeds_${m}`] = weeds.length; row[`gaps_${m}`] = gaps.length;
    if (gt) {
      const gc = gt.map(b => ({ x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 }));
      const ref = rowsFromPoints(gc), refLines = ref.rows.map(x => x.points), refPitch = ref.pitchPx ?? null;
      const tol = refPitch ? refPitch / 4 : 0.5 * median(gt.map(b => Math.max(b[2] - b[0], b[3] - b[1])));
      const isTrue = (l: Line) => { if (!refLines.length) return gc.filter(p => distToLine(l, p.x, p.y) <= tol).length >= 3; const s = densify(l, Math.max(4, tol)); return refLines.some(rl => s.filter(([x, y]) => distToLine(rl, x, y) <= tol).length >= 0.5 * s.length); };
      if (m === "A") { add(group, "plants", gc.length); add(group, "refRows", ref.rows.length); }
      const on = gc.filter(p => all.some(l => distToLine(l, p.x, p.y) <= tol)).length, onCorn = gc.filter(p => corn.some(l => distToLine(l, p.x, p.y) <= tol)).length;
      add(group, `plantsOn:${m}`, on); add(group, `plantsOnCorn:${m}`, onCorn); row[`on_${m}`] = on;
      add(group, `trueRows:${m}`, all.filter(isTrue).length); add(group, `trueCorn:${m}`, corn.filter(isTrue).length);
      for (const x of r.rows) if (x.evidence && x.identity === "corn") { const k = x.evidence.split(" ")[0]; add(group, `ev:${m}:${k}`, 1); if (isTrue(x.points)) add(group, `evTrue:${m}:${k}`, 1); }
      add(group, `cropCalledWeed:${m}`, weeds.filter(w => gt!.some(b => inBox(b, w.x, w.y))).length);
      // A false stand gap: on no real row (its middle off every reference row), or a labelled plant on the gap's line
      // inside it (its first and last tenth left out).
      const falseGap = gaps.filter(g => { const L = Math.hypot(g.x2 - g.x1, g.y2 - g.y1) || 1; const mx = (g.x1 + g.x2) / 2, my = (g.y1 + g.y2) / 2; if (refLines.length && !refLines.some(rl => distToLine(rl, mx, my) <= tol)) return true; return gc.some(p => { const t = ((p.x - g.x1) * (g.x2 - g.x1) + (p.y - g.y1) * (g.y2 - g.y1)) / (L * L); return t > 0.1 && t < 0.9 && Math.hypot(p.x - g.x1 - t * (g.x2 - g.x1), p.y - g.y1 - t * (g.y2 - g.y1)) <= tol; }); }).length;
      add(group, `falseGaps:${m}`, falseGap);
    }
    if (weedsGt) add(group, `weedsOnWeed:${m}`, weeds.filter(w => weedsGt!.some(b => inBox(b, w.x, w.y, 0))).length);
  }
  if (weedsGt) add(group, "weedsGt", weedsGt.length);
  per.push(row);
  console.log(`${stem}: ${MODES.map(m => `${m} rows ${row[`rows_${m}`]} (corn ${row[`corn_${m}`]}) weeds ${row[`weeds_${m}`]} gaps ${row[`gaps_${m}`]}${gt ? ` on ${row[`on_${m}`]}/${gt.length}` : ""}`).join(" | ")} | ${msGreen}+${msPts} ms`);
  if (n++ % DRAW_EVERY === 0) {
    for (const m of MODES) {
      const cv: Canvas = canvasOf(px); drawRead(cv, reads[m]!);
      if (gt) { const t = Math.max(1, Math.round(px.width / 1800) - 1); for (const b of gt) poly(cv, [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]], [255, 255, 255], t, true); }
      writeFileSync(join(OUT, m, `${stem}.jpg`), encodeJpeg({ width: cv.w, height: cv.h, data: cv.c }, 82));
    }
  }
}

const groups = [...tot.keys()].filter(g => g !== "all").sort();
const cols = [...(groups.length > 1 && groups.length <= 8 ? groups : []), "all"];
const T = (g: string, k: string) => tot.get(g)?.[k] ?? 0;
const md: string[] = [`| Measure (${MODES.map(m => LABEL[m]).join(" / ")}) | ${cols.join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`];
const R = (label: string, f: (g: string) => string) => md.push(`| ${label} | ${cols.map(f).join(" | ")} |`);
const each = (k: (m: Mode) => string, g: string, f: (v: number, m: Mode) => string = v => String(v)) => MODES.map(m => f(T(g, k(m)), m)).join(" / ");
R("images", g => String(T(g, "images")));
R("images with no rows", g => each(m => `noRows:${m}`, g));
R("rows drawn (corn rows)", g => MODES.map(m => `${T(g, `rows:${m}`)} (${T(g, `cornRows:${m}`)})`).join(" / "));
R("weed candidates reported", g => each(m => `weeds:${m}`, g));
R("stand gaps reported", g => each(m => `gaps:${m}`, g));
if (LABELS) {
  R("labelled plants (stray boxes dropped; photos with broken label files not scored)", g => `${T(g, "plants").toLocaleString()} (${T(g, "malformedBoxes")}; ${T(g, "brokenLabelImages")})`);
  R("**labelled plants on a row**", g => each(m => `plantsOn:${m}`, g, v => pct(v, T(g, "plants"))));
  R("labelled plants on a corn row", g => each(m => `plantsOnCorn:${m}`, g, v => pct(v, T(g, "plants"))));
  R("false share of rows drawn", g => each(m => `trueRows:${m}`, g, (v, m) => pct(T(g, `rows:${m}`) - v, T(g, `rows:${m}`))));
  R("**false share of CORN rows** (the rows findings come from)", g => each(m => `trueCorn:${m}`, g, (v, m) => pct(T(g, `cornRows:${m}`) - v, T(g, `cornRows:${m}`))));
  R("false corn rows by what holds them: both reads agree / plants only / green only", g => MODES.filter(m => m !== "A").map(m => ["both", "plant", "green"].map(k => `${T(g, `ev:${m}:${k}`) - T(g, `evTrue:${m}:${k}`)} of ${T(g, `ev:${m}:${k}`)}`).join(", ")).join(" / "));
  R("**crop called weed** (reported candidates on a labelled plant)", g => each(m => `cropCalledWeed:${m}`, g));
  R("**false stand gaps** (a reported gap on no real row, or with a labelled plant on its line inside it)", g => each(m => `falseGaps:${m}`, g, (v, m) => `${v} of ${T(g, `gaps:${m}`)}`));
}
if (USU) {
  R("labelled weeds", g => String(T(g, "weedsGt")));
  R("**reported weed candidates on a labelled weed** (real weeds kept)", g => each(m => `weedsOnWeed:${m}`, g));
}
R("mean ms per image: green read / plant points / fusion / MaSC inference", g => ["msGreen", "msPoints", "msFusion", "msMasc"].map(k => Math.round(T(g, k) / Math.max(1, T(g, "images")))).join(" / "));
const head = [`# Corn V1 bench: ${NAME}`, "", `Run ${new Date().toISOString().slice(0, 16)}, code ${revision}. ${T("all", "images")} photos from ${IMAGES.replace(/\\/g, "/")}${MASC ? `; MaSC boxes ${MASC.replace(/\\/g, "/")}` : ""}. Crop entered: ${CROP}. Pixels: ${NODE_DECODER.decoder}, ${NODE_DECODER.environment}.`, "",
  "Pictures: A = the adaptive reader as the app drew it; V1 = Corn V1: cyan = corn row, amber dashes = planted row whose crop is not confirmed, red = weed candidate, grey outlines = withheld (crop on a row, unknown vegetation, not judged), orange = stand gap.", ""];
writeFileSync(join(OUT, "README.md"), [...head, ...md, ""].join("\n"));
// One note per picture folder (the results hub reads <folder>.md beside each folder).
const legendOf: Record<Mode, string> = {
  A: "The adaptive reader as the app drew it until Corn V1: cyan rows, red weed candidates, orange gaps, grey not judged.",
  V1: "Corn V1 with plants located on the green (no model, what the app runs): cyan = corn row (the field entered as corn and both reads support it), amber dashes = planted row whose crop is not confirmed, red = weed candidate (only beside corn rows), orange = stand gap (only where both reads see nothing), grey outlines = withheld (the crop on a row, unknown vegetation, not judged).",
  V1M: "Corn V1 with MaSC's plants in place of the plants located on the green (the server tier, NOT shipped): same colours as V1.",
};
for (const m of MODES) writeFileSync(join(OUT, `${m}.md`), [`# Corn V1: ${LABEL[m]} (${NAME})`, "", `Run ${new Date().toISOString().slice(0, 16)}, code ${revision}. ${T("all", "images")} photos from ${IMAGES.replace(/\\/g, "/")}.${MASC ? ` MaSC boxes ${MASC.replace(/\\/g, "/")}.` : ""} Crop entered: ${CROP}.`, "", legendOf[m], "", ...md, ""].join("\n"));
writeFileSync(join(OUT, "results.json"), JSON.stringify({ revision, ...NODE_DECODER, name: NAME, modes: MODES, totals: Object.fromEntries(tot), per }, null, 1));
console.log(md.join("\n"));
