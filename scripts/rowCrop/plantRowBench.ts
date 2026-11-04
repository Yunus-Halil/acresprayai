// MaSC-assisted row reconstruction (2026-11-04), four ways on the same photos:
//   A geometry:      the adaptive corn reader alone (green pixels, unchanged);
//   B detector:      rows from MaSC's plant centres alone (src/lib/rowCrop/plantRows.ts rowsFromPoints);
//   C hybrid:        reader first: its rows kept, plant rows added on its lattice (recovered), in place of reader rows
//                    the plants contradict (corrected), or away from it with neighbours (planted, crop unconfirmed);
//   D detector-led:  the detector's rows where it holds rows, the reader's rows only where it holds none.
// MaSC boxes come from masc_detect.py output (<stem>.f<factor>.json): no inference here.
//   npx vite-node scripts/rowCrop/plantRowBench.ts --images <dir> --masc <dir> --out <dir>
//       [--labels <dir of <stem>.json {boxes:[[x1,y1,x2,y2]],group}>] [--usu <mosaics dir>] [--factor 3] [--conf 0.3]
//       [--gsd-cm 0.48] [--draw-every 1] [--limit N] [--name "set label"]
// With plant labels (every plant boxed): reference rows are built from the labelled plant centres by the same
// rowsFromPoints (a mild bias towards B and D, stated in the report). Per approach: labelled plants within a quarter of
// the reference row spacing of a row; rows true (at least half their length within that of one reference row) or false;
// reference rows recovered (half their plants on a row); row offset from the reference rows; weed candidates on a
// labelled plant. With --usu (weed boxes): weed candidates on a labelled weed that C or D take off the list.
// Writes <out>/<mode>/ pictures, <out>/<mode>.md and <out>/results.json. Research only: nothing here is in the app.
import "../bench/nodeStorageShim";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { adaptiveAsRead, readCornAdaptive, type AdaptiveRead } from "../../src/lib/rowCrop/adaptive";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { detectorLedRows, distToLine, hybridRows, rowsFromPoints, type PlantPoint, type PlantRow } from "../../src/lib/rowCrop/plantRows";
import { canvasOf, dashed, drawRead, line, poly, ring, type Canvas, type Rgb } from "./draw";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const IMAGES = arg("images")!, MASC = arg("masc")!, OUT = arg("out")!, LABELS = arg("labels"), USU = arg("usu");
const FACTOR = arg("factor", "3")!, CONF = Number(arg("conf", "0.3")), GSD = arg("gsd-cm") ? Number(arg("gsd-cm")) / 100 : null;
const DRAW_EVERY = Number(arg("draw-every", "1")), LIMIT = Number(arg("limit", "0")), NAME = arg("name", basename(IMAGES.replace(/[\\/]images$/, "")))!;
if (!IMAGES || !MASC || !OUT) { console.error("need --images, --masc and --out"); process.exit(1); }
const revision = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();
const profile = cropProfileFor("corn")!;
const MODES = ["geometry", "detector", "hybrid", "detectorLed"] as const;
type Mode = typeof MODES[number];
const DIR: Record<Mode, string> = { geometry: "geometry", detector: "detector", hybrid: "hybrid", detectorLed: "detector-led" };
const LABEL: Record<Mode, string> = { geometry: "A geometry", detector: "B detector", hybrid: "C hybrid (reader first)", detectorLed: "D detector-led" };

type Box = [number, number, number, number];
type Line = [number, number][];
const inBox = (b: Box, x: number, y: number, grow = 0.1) => { const gx = (b[2] - b[0]) * grow, gy = (b[3] - b[1]) * grow; return x >= b[0] - gx && x <= b[2] + gx && y >= b[1] - gy && y <= b[3] + gy; };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10} %` : "-");
const nearRows = (lines: Line[], x: number, y: number, tol: number) => lines.some(l => distToLine(l, x, y) <= tol);
const densify = (l: Line, step: number): Line => { if (l.length < 2) return l; const out: Line = [l[0]]; for (let i = 1; i < l.length; i++) { const [ax, ay] = l[i - 1], [bx, by] = l[i], k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step)); for (let j = 1; j <= k; j++) out.push([ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k]); } return out; };

/** The reader's row spacing in photo pixels: its main reading's measured spacing, else the plan's prior. */
function readerPitch(ad: AdaptiveRead): number | null {
  const p = ad.plans.filter(q => q.read).sort((u, v) => v.ownedShare - u.ownedShare)[0];
  if (!p) return null;
  const r = p.read!;
  return r.pitchM && Number.isFinite(r.gsdM) && r.gsdM > 0 ? r.pitchM / r.gsdM : p.pitchPx;
}

type Acc = Record<string, number>;
const tot = new Map<string, Acc>();
const add = (group: string, k: string, v: number) => { for (const g of [group, "all"]) { const a = tot.get(g) ?? {}; a[k] = (a[k] ?? 0) + v; tot.set(g, a); } };
const offsets: Record<Mode, number[]> = { geometry: [], detector: [], hybrid: [], detectorLed: [] };
const per: Record<string, unknown>[] = [];

let files = readdirSync(IMAGES).filter(f => /\.(jpe?g|png)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (LIMIT) files = files.slice(0, LIMIT);
for (const m of MODES) mkdirSync(join(OUT, DIR[m]), { recursive: true });
let n = 0;
for (const f of files) {
  const stem = basename(f, extname(f)), mf = join(MASC, `${stem}.f${FACTOR}.json`);
  if (!existsSync(mf)) continue;
  const mj = JSON.parse(readFileSync(mf, "utf8")) as { boxes: number[][]; ms: number; width: number; height: number };
  const raw = decodeImage(new Uint8Array(readFileSync(join(IMAGES, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  if (mj.width !== px.width || mj.height !== px.height) { console.log(`${stem}: MaSC size differs, skipped`); continue; }
  let gt: Box[] | null = null, group = "all-images", weedsGt: Box[] | null = null;
  if (LABELS && existsSync(join(LABELS, `${stem}.json`))) { const l = JSON.parse(readFileSync(join(LABELS, `${stem}.json`), "utf8")); gt = l.boxes; group = l.group ?? group; }
  if (USU) { const meta = JSON.parse(readFileSync(join(USU, `${stem}.json`), "utf8")); weedsGt = (meta.boxes as { x: number; y: number; w: number; h: number }[]).map(b => [b.x - b.w / 2, b.y - b.h / 2, b.x + b.w / 2, b.y + b.h / 2]); }
  const gsd = USU ? 0.0048 : GSD;

  const tA = Date.now();
  const ad = readCornAdaptive(px, rowCropParamsFor(profile, gsd));
  const msA = Date.now() - tA;
  const det: PlantPoint[] = mj.boxes.filter(b => b[4] >= CONF).map(b => ({ x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 }));
  const cand = ad.weeds.filter(w => w.verdict === "weed candidate"), candXY = cand.map(w => [w.x, w.y] as [number, number]);
  const green: PlantPoint[] = ad.weeds.map(w => ({ x: w.x, y: w.y }));
  const pitchA = readerPitch(ad), readerIn = { rows: ad.rows, directionDeg: ad.directionDeg, pitchPx: pitchA };
  const tB = Date.now(); const B = rowsFromPoints(det); const msB = Date.now() - tB;
  const tC = Date.now(); const C = hybridRows(readerIn, det, green, candXY); const msC = Date.now() - tC;
  const tD = Date.now(); const D = detectorLedRows(readerIn, det, candXY); const msD = Date.now() - tD;
  const addedC = C.rows.filter(r => r.status === "recovered corn row" || r.status === "corrected corn row" || r.status === "planted row, crop unconfirmed");
  const droppedSet = new Set(C.droppedReaderRows), keptReader = ad.rows.filter((_, i) => !droppedSet.has(i));
  const lines: Record<Mode, Line[]> = {
    geometry: ad.rows.map(r => r.points), detector: B.rows.map(r => r.points),
    hybrid: [...keptReader.map(r => r.points), ...addedC.map(r => r.points)],
    detectorLed: [...D.readerPieces, ...D.rows.map(r => r.points)],
  };
  const cornLines: Partial<Record<Mode, Line[]>> = {
    hybrid: [...keptReader.map(r => r.points), ...C.rows.filter(r => r.status === "recovered corn row" || r.status === "corrected corn row").map(r => r.points)],
    detectorLed: [...D.readerPieces, ...D.rows.filter(r => r.status === "corn row").map(r => r.points)],
  };
  const absorbed: Partial<Record<Mode, Set<number>>> = { hybrid: new Set(C.onRecoveredRows), detectorLed: new Set(D.onRows) };
  const row: Record<string, unknown> = { image: stem, group, msReader: msA, msMasc: mj.ms, detector: det.length, candidates: cand.length,
    recovered: C.rows.filter(r => r.status === "recovered corn row").length, corrected: C.rows.filter(r => r.status === "corrected corn row").length, dropped: droppedSet.size,
    unconfirmedC: C.rows.filter(r => r.status === "planted row, crop unconfirmed").length, rejectedC: C.rejected.length,
    cornRowsD: D.rows.filter(r => r.status === "corn row").length, unconfirmedD: D.rows.filter(r => r.status === "planted row, crop unconfirmed").length, readerPiecesD: D.readerPieces.length, replacedD: D.replacedReaderRows.length };
  for (const m of MODES) row[`rows_${m}`] = lines[m].length;
  add(group, "images", 1); add(group, "msReader", msA); add(group, "msMasc", mj.ms); add(group, "msB", msB); add(group, "msC", msC); add(group, "msD", msD);
  add(group, "candidates", cand.length);
  for (const k of ["recovered", "corrected", "dropped", "unconfirmedC", "rejectedC", "cornRowsD", "unconfirmedD", "readerPiecesD", "replacedD"]) add(group, k, row[k] as number);
  for (const m of MODES) { add(group, `rows:${m}`, lines[m].length); add(group, `noRows:${m}`, lines[m].length ? 0 : 1); }
  for (const m of ["hybrid", "detectorLed"] as const) add(group, `absorbed:${m}`, absorbed[m]!.size);

  if (gt) {
    const gc = gt.map(b => ({ x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 }));
    const ref = rowsFromPoints(gc);
    const refLines = ref.rows.map(r => r.points), refPitch = ref.pitchPx ?? null;
    const tol = refPitch ? refPitch / 4 : 0.5 * median(gt.map(b => Math.max(b[2] - b[0], b[3] - b[1])));
    /** A row is true when at least half its length lies within tol of one reference row (with no reference rows: three
     * labelled plants along it). */
    const isTrue = (l: Line) => {
      if (!refLines.length) return gc.filter(p => distToLine(l, p.x, p.y) <= tol).length >= 3;
      const s = densify(l, Math.max(4, tol)); return refLines.some(rl => s.filter(([x, y]) => distToLine(rl, x, y) <= tol).length >= 0.5 * s.length);
    };
    add(group, "plants", gc.length); add(group, "refRows", ref.rows.length); add(group, "noRefRows", ref.rows.length ? 0 : 1);
    const readerLess = ad.rows.length === 0;
    if (readerLess) add(group, "plantsNoReader", gc.length);
    for (const m of MODES) {
      const on = gc.filter(p => nearRows(lines[m], p.x, p.y, tol)).length;
      add(group, `plantsOn:${m}`, on); if (readerLess) add(group, `plantsOnNoReader:${m}`, on);
      row[`plantsOn_${m}`] = on;
      const t = lines[m].filter(isTrue).length; add(group, `trueRows:${m}`, t); add(group, `falseRows:${m}`, lines[m].length - t);
      add(group, `refRecovered:${m}`, ref.rows.filter(r => r.members.filter(i => nearRows(lines[m], gc[i].x, gc[i].y, tol)).length >= 0.5 * r.members.length).length);
      if (refPitch) for (const l of lines[m]) { const s = densify(l, Math.max(4, tol)); const best = refLines.map(rl => median(s.map(([x, y]) => distToLine(rl, x, y)))).sort((a, b) => a - b)[0]; if (best != null && best <= tol) offsets[m].push(best / refPitch); }
      const cl = cornLines[m]; if (cl) add(group, `cornOn:${m}`, gc.filter(p => nearRows(cl, p.x, p.y, tol)).length);
    }
    // Plants the reader's rows held that an approach loses (on an A row, on none of its rows): errors MaSC introduces.
    const onA = gc.filter(p => nearRows(lines.geometry, p.x, p.y, tol));
    for (const m of MODES) if (m !== "geometry") add(group, `lost:${m}`, onA.filter(p => !nearRows(lines[m], p.x, p.y, tol)).length);
    add(group, "onA", onA.length);
    const tr = (rs: PlantRow[]) => rs.filter(r => isTrue(r.points)).length;
    add(group, "recoveredTrue", tr(C.rows.filter(r => r.status === "recovered corn row")));
    add(group, "correctedTrue", tr(C.rows.filter(r => r.status === "corrected corn row")));
    add(group, "unconfirmedCTrue", tr(C.rows.filter(r => r.status === "planted row, crop unconfirmed")));
    add(group, "droppedTrue", ad.rows.filter((r, i) => droppedSet.has(i) && isTrue(r.points)).length);
    add(group, "cornRowsDTrue", tr(D.rows.filter(r => r.status === "corn row")));
    add(group, "unconfirmedDTrue", tr(D.rows.filter(r => r.status === "planted row, crop unconfirmed")));
    add(group, "replacedDTrue", D.replacedReaderRows.filter(i => isTrue(ad.rows[i].points)).length);
    const onCorn = cand.map((w, i) => ({ w, i })).filter(({ w }) => gt!.some(b => inBox(b, w.x, w.y)));
    add(group, "weedsOnCorn:geometry", onCorn.length);
    for (const m of ["hybrid", "detectorLed"] as const) {
      add(group, `weedsOnCorn:${m}`, onCorn.filter(({ i }) => !absorbed[m]!.has(i)).length);
      add(group, `absorbedOffCorn:${m}`, [...absorbed[m]!].filter(i => !gt!.some(b => inBox(b, cand[i].x, cand[i].y))).length);
    }
  }
  if (weedsGt) {
    const onWeed = cand.map((w, i) => ({ w, i })).filter(({ w }) => weedsGt!.some(b => inBox(b, w.x, w.y, 0)));
    add(group, "weeds", weedsGt.length); add(group, "candOnWeed", onWeed.length);
    for (const m of ["hybrid", "detectorLed"] as const) add(group, `candOnWeedAbsorbed:${m}`, onWeed.filter(({ i }) => absorbed[m]!.has(i)).length);
  }
  per.push(row);
  console.log(`${stem}: rows A ${lines.geometry.length} B ${lines.detector.length} C ${lines.hybrid.length} D ${lines.detectorLed.length} | candidates ${cand.length}, off the list C ${absorbed.hybrid!.size} D ${absorbed.detectorLed!.size}${gt ? ` | plants ${gt.length} on rows A ${row.plantsOn_geometry} B ${row.plantsOn_detector} C ${row.plantsOn_hybrid} D ${row.plantsOn_detectorLed}` : ""}`);

  // Pictures.
  if (n++ % DRAW_EVERY === 0) {
    const t = Math.max(1, Math.round(px.width / 1800)), read = adaptiveAsRead(ad);
    const save = (m: Mode, cv: Canvas) => writeFileSync(join(OUT, DIR[m], `${stem}.jpg`), encodeJpeg({ width: cv.w, height: cv.h, data: cv.c }, 82));
    const gtDraw = (cv: Canvas) => { if (gt) for (const b of gt) poly(cv, [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]], [255, 255, 255], Math.max(1, t - 1), true); };
    const dots = (cv: Canvas) => { const r = Math.max(3, Math.round(px.width / 600)); for (const p of det) ring(cv, p.x, p.y, r, [90, 160, 255], t); };
    const linesDraw = (cv: Canvas, ls: Line[], col: Rgb, w: number, dash = false) => { for (const l of ls) for (let i = 0; i + 1 < l.length; i++) { const [a, b] = [l[i], l[i + 1]]; if (dash) dashed(cv, a[0], a[1], b[0], b[1], col, w, 8 * t); else line(cv, a[0], a[1], b[0], b[1], col, w); } };
    const rowsDraw = (cv: Canvas, rows: PlantRow[], col: Rgb, w: number, dash = false) => linesDraw(cv, rows.map(r => r.points), col, w, dash);
    const keepWeeds = (ab: Set<number>) => { const kept = new Set(cand.filter((_, i) => !ab.has(i)).map(w => w.hull)); return (h: [number, number][]) => kept.has(h) || !cand.some(w => w.hull === h); };
    { const cv = canvasOf(px); drawRead(cv, read); gtDraw(cv); save("geometry", cv); }
    { const cv = canvasOf(px); gtDraw(cv); dots(cv); rowsDraw(cv, B.rejected, [150, 150, 150], t); rowsDraw(cv, B.rows, [180, 255, 0], t + 2); save("detector", cv); }
    {
      const cv = canvasOf(px), ab = absorbed.hybrid!;
      drawRead(cv, { ...read, rows: read.rows.filter((_, i) => !droppedSet.has(i)) }, keepWeeds(ab));
      for (const i of droppedSet) linesDraw(cv, [ad.rows[i].points], [255, 60, 200], t, true);
      gtDraw(cv); dots(cv);
      rowsDraw(cv, C.rejected, [150, 150, 150], t);
      rowsDraw(cv, C.rows.filter(r => r.status === "corrected corn row"), [0, 255, 120], t + 2);
      rowsDraw(cv, C.rows.filter(r => r.status === "recovered corn row"), [180, 255, 0], t + 2);
      rowsDraw(cv, C.rows.filter(r => r.status === "planted row, crop unconfirmed"), [255, 190, 0], t + 2, true);
      for (const i of ab) poly(cv, cand[i].hull, [0, 255, 255], t + 2, true);
      save("hybrid", cv);
    }
    {
      const cv = canvasOf(px), ab = absorbed.detectorLed!;
      drawRead(cv, { ...read, rows: [] }, keepWeeds(ab));
      linesDraw(cv, D.readerPieces, [0, 230, 255], t + 1);
      gtDraw(cv); dots(cv);
      rowsDraw(cv, D.rows.filter(r => r.status === "corn row"), [180, 255, 0], t + 2);
      rowsDraw(cv, D.rows.filter(r => r.status === "planted row, crop unconfirmed"), [255, 190, 0], t + 2, true);
      for (const i of ab) poly(cv, cand[i].hull, [0, 255, 255], t + 2, true);
      save("detectorLed", cv);
    }
  }
}

// Report.
const groups = [...tot.keys()].filter(g => g !== "all").sort();
const cols = [...(groups.length > 1 && groups.length <= 8 ? groups : []), "all"];
const T = (g: string, k: string) => tot.get(g)?.[k] ?? 0;
const md: string[] = [];
const tableRow = (label: string, f: (g: string) => string) => md.push(`| ${label} | ${cols.map(f).join(" | ")} |`);
const each = (k: (m: Mode) => string, g: string, f: (v: number, m: Mode) => string = v => String(v)) => MODES.map(m => f(T(g, k(m)), m)).join(" / ");
md.push(`| Measure (A geometry / B detector / C hybrid / D detector-led) | ${cols.join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`);
tableRow("images", g => String(T(g, "images")));
tableRow("images with no rows", g => each(m => `noRows:${m}`, g));
tableRow("rows drawn", g => each(m => `rows:${m}`, g));
tableRow("C: recovered corn + corrected corn + planted (crop unconfirmed) rows added / reader rows dropped / plant lines rejected", g => `${T(g, "recovered")} + ${T(g, "corrected")} + ${T(g, "unconfirmedC")} / ${T(g, "dropped")} / ${T(g, "rejectedC")}`);
tableRow("D: detector corn rows + planted (crop unconfirmed) / reader pieces kept / reader rows replaced in full", g => `${T(g, "cornRowsD")} + ${T(g, "unconfirmedD")} / ${T(g, "readerPiecesD")} / ${T(g, "replacedD")}`);
if (LABELS) {
  tableRow("labelled plants", g => T(g, "plants").toLocaleString());
  tableRow("**labelled plants on a row**", g => each(m => `plantsOn:${m}`, g, v => pct(v, T(g, "plants"))));
  tableRow("labelled plants on a CORN row (C, D: rows whose crop is unconfirmed left out)", g => `${pct(T(g, "cornOn:hybrid"), T(g, "plants"))} / ${pct(T(g, "cornOn:detectorLed"), T(g, "plants"))}`);
  tableRow("where the reader read no rows: labelled plants / on a row", g => `${T(g, "plantsNoReader")} / ${each(m => `plantsOnNoReader:${m}`, g, v => pct(v, T(g, "plantsNoReader")))}`);
  tableRow("reference rows (built from the labelled plants)", g => String(T(g, "refRows")));
  tableRow("reference rows recovered", g => each(m => `refRecovered:${m}`, g, v => pct(v, T(g, "refRows"))));
  tableRow("rows true / false", g => MODES.map(m => `${T(g, `trueRows:${m}`)}/${T(g, `falseRows:${m}`)}`).join(" · "));
  tableRow("false share of rows drawn", g => each(m => `falseRows:${m}`, g, (v, m) => pct(v, T(g, `rows:${m}`))));
  tableRow("C rows true: recovered / corrected / unconfirmed", g => `${T(g, "recoveredTrue")} of ${T(g, "recovered")} / ${T(g, "correctedTrue")} of ${T(g, "corrected")} / ${T(g, "unconfirmedCTrue")} of ${T(g, "unconfirmedC")}`);
  tableRow("D rows true: corn / unconfirmed", g => `${T(g, "cornRowsDTrue")} of ${T(g, "cornRowsD")} / ${T(g, "unconfirmedDTrue")} of ${T(g, "unconfirmedD")}`);
  tableRow("ERRORS the reader avoided: labelled plants on a reader row that B / C / D leave on no row", g => `${T(g, "lost:detector")} / ${T(g, "lost:hybrid")} / ${T(g, "lost:detectorLed")} of ${T(g, "onA")}`);
  tableRow("C: real reader rows dropped", g => `${T(g, "droppedTrue")} of ${T(g, "dropped")}`);
  tableRow("weed candidates on a labelled plant (crop called weed): A / C / D", g => `${T(g, "weedsOnCorn:geometry")} / ${T(g, "weedsOnCorn:hybrid")} / ${T(g, "weedsOnCorn:detectorLed")} (of ${T(g, "candidates")})`);
  tableRow("candidates taken off the list away from every labelled plant (unjudged): C / D", g => `${T(g, "absorbedOffCorn:hybrid")} / ${T(g, "absorbedOffCorn:detectorLed")}`);
}
if (USU) {
  tableRow("labelled weeds / weed candidates on a labelled weed (A)", g => `${T(g, "weeds")} / ${T(g, "candOnWeed")}`);
  tableRow("REAL WEEDS taken off the list: C / D", g => `${T(g, "candOnWeedAbsorbed:hybrid")} / ${T(g, "candOnWeedAbsorbed:detectorLed")} of ${T(g, "candOnWeed")}`);
  tableRow("candidates taken off the list in all: C / D", g => `${T(g, "absorbed:hybrid")} / ${T(g, "absorbed:detectorLed")} of ${T(g, "candidates")}`);
}
tableRow("mean ms per image: reader / MaSC inference / B / C / D row steps", g => [T(g, "msReader"), T(g, "msMasc"), T(g, "msB"), T(g, "msC"), T(g, "msD")].map(v => Math.round(v / Math.max(1, T(g, "images")))).join(" / "));
const offTxt = LABELS ? MODES.map(m => `${LABEL[m]} ${offsets[m].length ? `${Math.round(median(offsets[m]) * 1000) / 10} %` : "-"}`).join(", ") : "";
const legend: Record<Mode, string> = {
  geometry: "A, geometry only: the adaptive reader as it is (cyan rows, red weed candidates).",
  detector: "B, detector only: rows from MaSC's plant centres alone (blue rings); lime = row, grey = a line of plants rejected (no neighbouring row at the spacing).",
  hybrid: "C, hybrid, reader first: the reader's rows (cyan) kept; lime = recovered corn row (MaSC plants on the reader's spacing next to a corn row); bright green = corrected corn row (on MaSC's plants where a reader row ran beside them); pink dashes = that reader row, dropped; amber dashes = planted row, crop NOT confirmed; grey = plant lines rejected; thick cyan outline = weed candidate taken off the list (on an added row).",
  detectorLed: "D, detector-led: lime = MaSC's rows inside the reader's corn ground (corn rows); amber dashes = MaSC's rows away from it (crop NOT confirmed); cyan = the reader's rows kept only where MaSC holds no rows; thick cyan outline = weed candidate taken off the list (on a MaSC row).",
};
for (const m of MODES) writeFileSync(join(OUT, `${DIR[m]}.md`), [`# Plant rows: ${LABEL[m]} (${NAME})`, "",
  `Run ${new Date().toISOString().slice(0, 16)}, code ${revision}. ${T("all", "images")} photos from ${IMAGES.replace(/\\/g, "/")}. MaSC boxes ${MASC.replace(/\\/g, "/")} (factor ${FACTOR}, confidence >= ${CONF}).${LABELS ? " Every plant labelled (white boxes); reference rows built from the labelled plants." : ""}`, "",
  legend[m], "", ...md, "", LABELS ? `Median offset of rows lying on a reference row, share of its spacing: ${offTxt}. Reference rows come from the same row builder as B and D (a mild bias towards them).` : ""].join("\n") + "\n");
writeFileSync(join(OUT, "results.json"), JSON.stringify({ revision, name: NAME, totals: Object.fromEntries(tot), offsets: Object.fromEntries(MODES.map(m => [m, offsets[m].length ? median(offsets[m]) : null])), per }, null, 1));
console.log(md.join("\n")); if (offTxt) console.log("offsets:", offTxt);
