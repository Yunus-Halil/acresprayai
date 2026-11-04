// The MaSC maize seedling detector (masc_detect.py output) beside the adaptive corn reader: an independent "this is a
// corn plant" signal, trained on Missouri drone video (MSDD), never on our photos. Per photo:
//   - weed candidates whose centre falls inside a MaSC corn box: MaSC calls them corn (would clear them);
//   - MaSC plants on a row the reader read, and MaSC plants off every row (corn the rows missed, or MaSC wrong);
//   - with --prob, agreement with the corn check v1 clearing (cornShareInHull >= 0.5) on the same candidates.
//   npx vite-node scripts/rowCrop/mascCompare.ts --photos <dir> --masc <dir of <stem>.f3.json> --out <dir>
//       [--factor 3] [--conf 0.3] [--prob <dir of <stem>-prob.png>] [--gsd-cm 0.48]
// Pictures: the read as in every bench picture (rows cyan, kept weed candidates red), MaSC plants on a row thin blue,
// MaSC plants off every row orange, weed candidates MaSC calls corn thick magenta. Writes <out>.md and
// <out>/positions.json. Research only: nothing here is wired into the app.
import "../bench/nodeStorageShim";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { adaptiveAsRead, readCornAdaptive } from "../../src/lib/rowCrop/adaptive";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { canvasOf, drawRead, line, poly, type Rgb, type Canvas } from "./draw";
import { cornShareInHull } from "./cornCheck";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const PHOTOS = arg("photos")!, MASC = arg("masc")!, OUT = arg("out")!, PROB = arg("prob");
const FACTOR = arg("factor", "3")!, CONF = Number(arg("conf", "0.3"));
const GSD = arg("gsd-cm") ? Number(arg("gsd-cm")) / 100 : null;
if (!PHOTOS || !MASC || !OUT) { console.error("need --photos, --masc and --out"); process.exit(1); }
const revision = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();
const profile = cropProfileFor("corn")!;

type Masc = { width: number; height: number; boxes: [number, number, number, number, number, number][] };
const segDist = (px: number, py: number, [ax, ay]: [number, number], [bx, by]: [number, number]) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const distToLine = (x: number, y: number, pts: [number, number][]) => { let d = Infinity; for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(x, y, pts[i - 1], pts[i])); return pts.length === 1 ? Math.hypot(x - pts[0][0], y - pts[0][1]) : d; };
const rect = (cv: Canvas, x0: number, y0: number, x1: number, y1: number, c: Rgb, t: number) => { line(cv, x0, y0, x1, y0, c, t); line(cv, x1, y0, x1, y1, c, t); line(cv, x1, y1, x0, y1, c, t); line(cv, x0, y1, x0, y0, c, t); };

mkdirSync(OUT, { recursive: true });
const files = readdirSync(PHOTOS).filter(f => /\.(jpe?g|png)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const T = { photos: 0, cand: 0, inBox: 0, plants: 0, onRow: 0, offRow: 0, photosWithRows: 0, plantsInRowPhotos: 0, onRowInRowPhotos: 0, probBoth: 0, probOnly: 0, mascOnly: 0, probChecked: 0 };
const positions: Record<string, { mascCorn: [number, number][]; kept: [number, number][]; offRow: [number, number][] }> = {};
for (const f of files) {
  const stem = basename(f, extname(f)), mf = join(MASC, `${stem}.f${FACTOR}.json`);
  if (!existsSync(mf)) continue;
  const m = JSON.parse(readFileSync(mf, "utf8")) as Masc;
  const raw = decodeImage(new Uint8Array(readFileSync(join(PHOTOS, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  if (m.width !== px.width || m.height !== px.height) { console.log(`${stem}: MaSC ran on ${m.width}x${m.height}, photo is ${px.width}x${px.height}, skipped`); continue; }
  const read = adaptiveAsRead(readCornAdaptive(px, rowCropParamsFor(profile, GSD)));
  const gsd = Number.isFinite(read.gsdM) ? read.gsdM : 0.004;
  const boxes = m.boxes.filter(b => b[4] >= CONF);
  // A candidate is MaSC corn when its centre lies inside a MaSC box.
  const inBox = (x: number, y: number) => boxes.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  const mascCorn = read.weeds.filter(w => inBox(w.x, w.y)), mascSet = new Set(mascCorn);
  const kept = read.weeds.filter(w => !mascSet.has(w));
  // A MaSC plant is on a row when its centre lies within the row's band (+5 cm) of a read row's centreline.
  const onRow = (x: number, y: number) => read.rows.some(r => distToLine(x, y, r.points) <= r.bandHalfWidthM / gsd + 0.05 / gsd);
  const centres = boxes.map(([x0, y0, x1, y1]) => [(x0 + x1) / 2, (y0 + y1) / 2] as [number, number]);
  const on = centres.filter(([x, y]) => onRow(x, y)), off = centres.filter(([x, y]) => !onRow(x, y));
  // Agreement with the corn check v1 clearing, when its probability map is there.
  let probNote = "";
  if (PROB) {
    const pf = join(PROB, `${stem}-prob.png`);
    if (existsSync(pf)) {
      const pm = decodeImage(new Uint8Array(readFileSync(pf)));
      if (pm.width === px.width && pm.height === px.height) {
        for (const w of read.weeds) { const s = cornShareInHull(pm, w.hull), p = s != null && s >= 0.5, k = mascSet.has(w); if (p && k) T.probBoth++; else if (p) T.probOnly++; else if (k) T.mascOnly++; }
        T.probChecked++; probNote = " | corn check compared";
      }
    }
  }
  const cv = canvasOf(px), t = Math.max(1, Math.round(px.width / 1800));
  drawRead(cv, { ...read, weeds: kept });
  for (const [x0, y0, x1, y1, , ] of boxes) { const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; rect(cv, x0, y0, x1, y1, onRow(cx, cy) ? [90, 160, 255] : [255, 140, 0], onRow(cx, cy) ? t : t + 1); }
  for (const w of mascCorn) poly(cv, w.hull, [255, 0, 255], t + 2, true);
  writeFileSync(join(OUT, `${stem}.jpg`), encodeJpeg({ width: cv.w, height: cv.h, data: cv.c }, 85));
  positions[stem] = { mascCorn: mascCorn.map(w => [Math.round(w.x), Math.round(w.y)]), kept: kept.map(w => [Math.round(w.x), Math.round(w.y)]), offRow: off.map(([x, y]) => [Math.round(x), Math.round(y)]) };
  T.photos++; T.cand += read.weeds.length; T.inBox += mascCorn.length; T.plants += boxes.length; T.onRow += on.length; T.offRow += off.length;
  if (read.rows.length) { T.photosWithRows++; T.plantsInRowPhotos += boxes.length; T.onRowInRowPhotos += on.length; }
  console.log(`${stem}: rows ${read.rows.length} | weed candidates ${read.weeds.length}, MaSC calls corn ${mascCorn.length} | MaSC plants ${boxes.length}: on a row ${on.length}, off every row ${off.length}${probNote}`);
}
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10} %` : "-");
const md = [`# MaSC beside the adaptive reader (${basename(OUT)})`, "",
  `Run ${new Date().toISOString().slice(0, 16)}, code ${revision}. ${T.photos} photos from ${PHOTOS.replace(/\\/g, "/")}. MaSC boxes: ${MASC.replace(/\\/g, "/")} (factor ${FACTOR}, confidence >= ${CONF}).`, "",
  "Red: weed candidates kept. Thick magenta: weed candidates inside a MaSC corn box (MaSC calls them corn). Thin blue: MaSC plants on a row the reader read. Orange: MaSC plants off every read row (corn the rows missed, or MaSC wrong).", "",
  "| Measure | Value |", "|---|---|",
  `| weed candidates | ${T.cand} |`,
  `| ... inside a MaSC corn box | ${T.inBox} (${pct(T.inBox, T.cand)}) |`,
  `| MaSC plants | ${T.plants} |`,
  `| ... on a read row | ${T.onRow} (${pct(T.onRow, T.plants)}) |`,
  `| ... on a read row, photos where the reader read rows | ${T.onRowInRowPhotos} of ${T.plantsInRowPhotos} (${pct(T.onRowInRowPhotos, T.plantsInRowPhotos)}) |`,
  `| ... off every read row | ${T.offRow} |`];
if (PROB) md.push(`| photos compared with the corn check v1 | ${T.probChecked} |`, `| candidates both call corn / only the corn check / only MaSC | ${T.probBoth} / ${T.probOnly} / ${T.mascOnly} |`);
writeFileSync(`${OUT}.md`, md.join("\n") + "\n");
writeFileSync(join(OUT, "positions.json"), JSON.stringify(positions));
console.log(md.join("\n"));
