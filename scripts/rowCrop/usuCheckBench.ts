// The adaptive corn reader against USU-Corn-WeedDB's WEED boxes (CC BY 4.0; Utah forage corn, V4, 10 m, 0.48 cm, the
// sources stitched by usu_mosaic.py): the other side of msddBench. MSDD boxes the corn, so it measures corn called
// weed; USU boxes the weeds (three species, exhaustive within each labelled tile as far as the authors labelled), so
// it measures weeds found and, with a corn check, real weeds the check would wrongly clear.
//   npm run bench:usu-check -- [--mosaics D:/swardus-research/datasets/usu-corn-weeddb/mosaics] [--min-tiles 20]
//       [--corn-prob <dir of <name>-prob.png>] [--corn-threshold 0.5] [--heldout-only] [--out dir]
// A weed box is found when a weed candidate's centroid lies inside it (grown by 10 px) or the box's centre inside the
// candidate's outline. The pixel size is given (0.48 cm), as EXIF would give it in the app.
import "../bench/nodeStorageShim";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readCornAdaptive, type AdaptiveWeed } from "../../src/lib/rowCrop/adaptive";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { cornShareInHull, coveredBy, modelWeeds } from "./cornCheck";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const revision = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();
const MOSAICS = arg("mosaics", "D:/swardus-research/datasets/usu-corn-weeddb/mosaics")!;
const MIN_TILES = Number(arg("min-tiles", "20"));
const CORN_PROB = arg("corn-prob"), CORN_T = Number(arg("corn-threshold", "0.5"));
/** MaSC boxes (masc_detect.py output, <name>.f<factor>.json): clear a candidate whose centre lies inside a MaSC corn box,
 * and count the labelled weeds MaSC boxes as corn. Used instead of --corn-prob. */
const MASC = arg("masc"), MASC_F = arg("masc-factor", "3")!, MASC_CONF = Number(arg("masc-conf", "0.3"));
/** Model weeds smaller than this equivalent diameter are not added (cm). */
const MIN_WEED_CM = Number(arg("min-weed-cm", "3"));
/** Extra add settings scored in the same pass, "prob:cm,prob:cm". */
const ADD_GRID = (arg("add-grid", "") ?? "").split(",").filter(Boolean).map(g => { const [pr, cm] = g.split(":").map(Number); return { pr, cm }; });
const gridTot = new Map<string, { added: number; onWeed: number; found: number }>();
/** Only the sources seg_prepare.py held out of training (number ending in 0 or 5): required when the corn check was
 * trained on USU tiles. */
const HELDOUT = argv.includes("--heldout-only");
const OUT = arg("out", `D:/swardus-research/usu-check-${revision}`)!;
const profile = cropProfileFor("corn")!;

type Box = { cls: string; x: number; y: number; w: number; h: number };
type Meta = { source: string; width: number; height: number; tiles: number; gsdCm: number; boxes: Box[] };
const inHull = (hull: [number, number][], x: number, y: number): boolean => { let c = false; for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) { const [xi, yi] = hull[i], [xj, yj] = hull[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const G = 10;
const inBox = (b: Box, x: number, y: number) => x >= b.x - b.w / 2 - G && x <= b.x + b.w / 2 + G && y >= b.y - b.h / 2 - G && y <= b.y + b.h / 2 + G;
const hits = (w: AdaptiveWeed, b: Box) => inBox(b, w.x, w.y) || (w.hull.length >= 3 && inHull(w.hull, b.x, b.y));

const files = readdirSync(MOSAICS).filter(f => f.endsWith(".json") && f !== "index.json").sort();
mkdirSync(OUT, { recursive: true });
const per: Record<string, unknown>[] = [];
const T = { mascPlants: 0, mascOnWeed: 0, weedsInMasc: 0, sources: 0, boxes: 0, found: 0, foundAfter: 0, cand: 0, onWeed: 0, cleared: 0, clearedOnWeed: 0, noProb: 0, added: 0, addedOnWeed: 0, foundWithAdded: 0 };
for (const f of files) {
  const meta = JSON.parse(readFileSync(join(MOSAICS, f), "utf8")) as Meta;
  if (meta.tiles < MIN_TILES) continue;
  const name = basename(f, ".json");
  if (HELDOUT) { const m = /(\d+)$/.exec(name); if (!m || Number(m[1]) % 5 !== 0) continue; }
  const raw = decodeImage(new Uint8Array(readFileSync(join(MOSAICS, `${name}.jpg`))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const ad = readCornAdaptive(px, rowCropParamsFor(profile, meta.gsdCm / 100));
  const cand = ad.weeds.filter(w => w.verdict === "weed candidate");
  let prob: { data: Uint8Array; width: number; height: number } | null = null;
  if (CORN_PROB) { const pf = join(CORN_PROB, `${name}-prob.png`); if (existsSync(pf)) prob = decodeImage(new Uint8Array(readFileSync(pf))); else T.noProb++; }
  const clearedSet = new Set<AdaptiveWeed>();
  if (MASC) {
    const mf = join(MASC, `${name}.f${MASC_F}.json`);
    if (!existsSync(mf)) T.noProb++;
    else {
      const mb = (JSON.parse(readFileSync(mf, "utf8")).boxes as number[][]).filter(b => b[4] >= MASC_CONF);
      const inM = (x: number, y: number) => mb.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
      for (const w of cand) if (inM(w.x, w.y)) clearedSet.add(w);
      T.mascPlants += mb.length;
      T.mascOnWeed += mb.filter(([x0, y0, x1, y1]) => meta.boxes.some(b => inBox(b, (x0 + x1) / 2, (y0 + y1) / 2))).length;
      T.weedsInMasc += meta.boxes.filter(b => inM(b.x, b.y)).length;
    }
  }
  if (prob) for (const w of cand) { const m = cornShareInHull(prob, w.hull); if (m != null && m >= CORN_T) clearedSet.add(w); }
  const kept = cand.filter(w => !clearedSet.has(w));
  const minAreaPx = Math.PI * (MIN_WEED_CM / 200 / (meta.gsdCm / 100)) ** 2;
  const added = prob ? modelWeeds(prob, minAreaPx).filter(m => !coveredBy(m, kept.map(w => w.hull))) : [];
  const addedOnWeed = added.filter(m => meta.boxes.some(b => inBox(b, m.x, m.y))).length;
  const foundWithAdded = meta.boxes.filter(b => kept.some(w => hits(w, b)) || added.some(m => inBox(b, m.x, m.y))).length;
  if (prob) for (const { pr, cm } of ADD_GRID) {
    const a = modelWeeds(prob, Math.PI * (cm / 200 / (meta.gsdCm / 100)) ** 2, pr).filter(m => !coveredBy(m, kept.map(w => w.hull)));
    const t = gridTot.get(`${pr}:${cm}`) ?? { added: 0, onWeed: 0, found: 0 };
    t.added += a.length; t.onWeed += a.filter(m => meta.boxes.some(b => inBox(b, m.x, m.y))).length; t.found += meta.boxes.filter(b => kept.some(w => hits(w, b)) || a.some(m => inBox(b, m.x, m.y))).length;
    gridTot.set(`${pr}:${cm}`, t);
  }
  const found = meta.boxes.filter(b => cand.some(w => hits(w, b))).length, foundAfter = meta.boxes.filter(b => kept.some(w => hits(w, b))).length;
  const onWeed = cand.filter(w => meta.boxes.some(b => inBox(b, w.x, w.y))).length;
  const clearedOnWeed = [...clearedSet].filter(w => meta.boxes.some(b => inBox(b, w.x, w.y))).length;
  T.sources++; T.boxes += meta.boxes.length; T.found += found; T.foundAfter += foundAfter; T.cand += cand.length; T.onWeed += onWeed; T.cleared += clearedSet.size; T.clearedOnWeed += clearedOnWeed; T.added += added.length; T.addedOnWeed += addedOnWeed; T.foundWithAdded += foundWithAdded;
  per.push({ source: name, boxes: meta.boxes.length, found, foundAfter, candidates: cand.length, onWeed, cleared: clearedSet.size, clearedOnWeed, added: added.length, addedOnWeed, foundWithAdded, rows: ad.rows.length, plans: ad.plans.filter(p => p.read).map(p => p.stage).join("+") || "none" });
  console.log(`${name}: boxes ${meta.boxes.length} found ${found}${prob ? ` -> ${foundAfter}` : ""} | candidates ${cand.length}, on a weed ${onWeed}${prob || MASC ? ` | cleared ${clearedSet.size}, of them on a weed ${clearedOnWeed} | model added ${added.length}, on a weed ${addedOnWeed}; found with added ${foundWithAdded}` : ""} | rows ${ad.rows.length}`);
}
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10} %` : "-");
const md = [`# Adaptive corn reader against USU-Corn-WeedDB's weed boxes`, "",
  `Code ${revision}, run ${new Date().toISOString().slice(0, 16)}. ${T.sources} stitched sources (>= ${MIN_TILES} labelled tiles) from ${MOSAICS}; pixel size given (0.48 cm).${HELDOUT ? " Held-out sources only (number ending in 0 or 5)." : ""}${CORN_PROB ? ` Corn check: ${CORN_PROB}, threshold ${CORN_T}.` : ""}${MASC ? ` MaSC boxes: ${MASC} (factor ${MASC_F}, confidence >= ${MASC_CONF}); a candidate is cleared when its centre lies in a MaSC corn box.` : ""}`, "",
  "| Measure | Value |", "|---|---|",
  `| labelled weeds | ${T.boxes} |`,
  `| labelled weeds found (a weed candidate on them) | ${T.found} (${pct(T.found, T.boxes)}) |`,
  `| weed candidates | ${T.cand} |`,
  `| weed candidates on a labelled weed | ${T.onWeed} (${pct(T.onWeed, T.cand)}) |`];
if (MASC) md.push(
  `| sources with no MaSC boxes | ${T.noProb} |`,
  `| MaSC corn plants | ${T.mascPlants} |`,
  `| ... centred on a labelled WEED (MaSC calls a weed corn) | ${T.mascOnWeed} (${pct(T.mascOnWeed, T.mascPlants)}) |`,
  `| labelled weeds inside a MaSC corn box | ${T.weedsInMasc} (${pct(T.weedsInMasc, T.boxes)}) |`,
  `| weed candidates MaSC clears | ${T.cleared} |`,
  `| ... of them on a labelled weed (WRONG to clear) | ${T.clearedOnWeed} (${pct(T.clearedOnWeed, T.onWeed)} of the candidates on weeds) |`,
  `| labelled weeds still found after MaSC clearing | ${T.foundAfter} (${pct(T.foundAfter, T.boxes)}) |`);
if (CORN_PROB) md.push(
  `| sources with no probability map | ${T.noProb} |`,
  `| weed candidates the corn check clears | ${T.cleared} |`,
  `| ... of them on a labelled weed (WRONG to clear) | ${T.clearedOnWeed} (${pct(T.clearedOnWeed, T.onWeed)} of the candidates on weeds) |`,
  `| labelled weeds still found after the check | ${T.foundAfter} (${pct(T.foundAfter, T.boxes)}) |`,
  `| weed patches the model adds (>= ${MIN_WEED_CM} cm, not under a kept candidate) | ${T.added} |`,
  `| ... of them on a labelled weed | ${T.addedOnWeed} (${pct(T.addedOnWeed, T.added)}) |`,
  `| labelled weeds found with the kept candidates and the model's additions | ${T.foundWithAdded} (${pct(T.foundWithAdded, T.boxes)}) |`);
for (const { pr, cm } of ADD_GRID) { const t = gridTot.get(`${pr}:${cm}`) ?? { added: 0, onWeed: 0, found: 0 }; md.push(`| added at weed p >= ${pr}, >= ${cm} cm: patches / on a weed / weeds found | ${t.added} / ${t.onWeed} (${pct(t.onWeed, t.added)}) / ${t.found} (${pct(t.found, T.boxes)}) |`); }
writeFileSync(join(OUT, "summary.md"), md.join("\n") + "\n");
writeFileSync(join(OUT, "per-source.json"), JSON.stringify(per, null, 1));
console.log(md.join("\n"));
