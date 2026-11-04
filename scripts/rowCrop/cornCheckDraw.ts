// Pictures of the corn check over the adaptive reader, for the results hub: the read drawn as in every bench picture
// (rows cyan, kept weed candidates red), weed candidates the check clears as corn leaf in thick cyan, weed patches the
// model adds (in-row weeds the position rules call corn) as orange boxes, and a small legend line in the notes file.
//   npx vite-node scripts/rowCrop/cornCheckDraw.ts --photos <dir> --prob <dir of <name>-prob.png> --out <dir>
//       [--corn-threshold 0.5] [--add-prob 0.8 | 2 for no additions] [--add-cm 5] [--gsd-cm 0.48]
// Also writes <out>/positions.json: per photo the centres of the cleared, kept and added weeds.
// Research pictures only: nothing here is wired into the app.
import "../bench/nodeStorageShim";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { adaptiveAsRead, readCornAdaptive } from "../../src/lib/rowCrop/adaptive";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { canvasOf, drawRead, line, poly } from "./draw";
import { cornShareInHull, coveredBy, modelWeeds } from "./cornCheck";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const PHOTOS = arg("photos")!, PROB = arg("prob")!, OUT = arg("out")!;
const CORN_T = Number(arg("corn-threshold", "0.5")), ADD_P = Number(arg("add-prob", "0.8")), ADD_CM = Number(arg("add-cm", "5"));
const GSD = arg("gsd-cm") ? Number(arg("gsd-cm")) / 100 : null;
const revision = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();
const profile = cropProfileFor("corn")!;
if (!PHOTOS || !PROB || !OUT) { console.error("need --photos, --prob and --out"); process.exit(1); }

mkdirSync(OUT, { recursive: true });
const files = readdirSync(PHOTOS).filter(f => /\.(jpe?g|png)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
let tCand = 0, tCleared = 0, tAdded = 0, n = 0;
const ADD_ON = ADD_P <= 1;
const positions: Record<string, { cleared: [number, number][]; kept: [number, number][]; added: [number, number][] }> = {};
for (const f of files) {
  const name = basename(f, extname(f)), pf = join(PROB, `${name}-prob.png`);
  if (!existsSync(pf)) continue;
  const raw = decodeImage(new Uint8Array(readFileSync(join(PHOTOS, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const pm = decodeImage(new Uint8Array(readFileSync(pf)));
  if (pm.width !== px.width || pm.height !== px.height) { console.log(`${name}: probability map ${pm.width}x${pm.height} does not match the photo, skipped`); continue; }
  const ad = readCornAdaptive(px, rowCropParamsFor(profile, GSD));
  const read = adaptiveAsRead(ad);
  const cleared = read.weeds.filter(w => { const m = cornShareInHull(pm, w.hull); return m != null && m >= CORN_T; });
  const clearedSet = new Set(cleared.map(w => w.hull));
  const kept = read.weeds.filter(w => !clearedSet.has(w.hull));
  const gsd = Number.isFinite(read.gsdM) ? read.gsdM : 0.004;
  const added = !ADD_ON ? [] : modelWeeds(pm, Math.PI * (ADD_CM / 200 / gsd) ** 2, ADD_P).filter(m => !coveredBy(m, kept.map(w => w.hull)));
  const cv = canvasOf(px), t = Math.max(1, Math.round(px.width / 1800));
  drawRead(cv, { ...read, weeds: kept });
  for (const w of cleared) poly(cv, w.hull, [0, 255, 255], t + 2, true);
  const pad = Math.max(4, Math.round(0.02 / gsd));
  for (const m of added) { const x0 = m.x0 - pad, y0 = m.y0 - pad, x1 = m.x1 + pad, y1 = m.y1 + pad; line(cv, x0, y0, x1, y0, [255, 140, 0], t + 1); line(cv, x1, y0, x1, y1, [255, 140, 0], t + 1); line(cv, x1, y1, x0, y1, [255, 140, 0], t + 1); line(cv, x0, y1, x0, y0, [255, 140, 0], t + 1); }
  writeFileSync(join(OUT, `${name}.jpg`), encodeJpeg({ width: cv.w, height: cv.h, data: cv.c }, 85));
  positions[name] = { cleared: cleared.map(w => [Math.round(w.x), Math.round(w.y)]), kept: kept.map(w => [Math.round(w.x), Math.round(w.y)]), added: added.map(m => [Math.round(m.x), Math.round(m.y)]) };
  tCand += read.weeds.length; tCleared += cleared.length; tAdded += added.length; n++;
  console.log(`${name}: rows ${read.rows.length} | weed candidates ${read.weeds.length}, cleared as corn leaf ${cleared.length} | model weeds added ${added.length}`);
}
const md = [`# Corn check over the adaptive reader (${basename(OUT)})`, "",
  `Run ${new Date().toISOString().slice(0, 16)}, code ${revision}. ${n} photos from ${PHOTOS.replace(/\\/g, "/")}. Probability maps: ${PROB.replace(/\\/g, "/")}.`, "",
  `Red: weed candidates kept. Thick cyan: candidates the check clears as corn leaf (corn share of their plant pixels >= ${CORN_T}). ${ADD_ON ? `Orange boxes: patches the model calls weed (p >= ${ADD_P}, >= ${ADD_CM} cm) that no kept candidate covers.` : "Adding is OFF here (--add-prob > 1)."}`, "",
  `Totals: ${tCand} candidates, ${tCleared} cleared, ${tAdded} added.`];
writeFileSync(`${OUT}.md`, md.join("\n") + "\n");
writeFileSync(join(OUT, "positions.json"), JSON.stringify(positions));
console.log(md.join("\n"));
