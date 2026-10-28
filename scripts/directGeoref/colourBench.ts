// The colour-rule weed pass, variant by variant, against DJI_0301's hand labels (414 weeds, 104 crops, projected to
// the ground in data/direct-georef/apricot/labels.geojson), on every photograph whose footprint holds the labelled
// ground. Per photograph and variant: labelled weeds found (a candidate centre within R on the ground), candidates
// near a crop label or inside a reconciled crown, candidates near nothing, total candidate area, milliseconds.
//
//   npx vite-node scripts/directGeoref/colourBench.ts -- [--photos DJI_0301,DJI_0302] [--r 0.5] [--variants v0,v1]
//
// Writes data/direct-georef/apricot/colour-bench.json and prints a table. The reference cameras are the scripts'
// (exp1 models.json), so positions are as good as the twin's.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type GeorefFrame, groundSampleAt, groundToPixel, pixelToGround } from "../../src/lib/directGeoref";
import { type GreenOptions, GREEN_DEFAULTS, greenPatches } from "../../src/lib/directGeoref/green";
import { CROWN_MARGIN_M, CROWN_SCALE, crownMask, patchInsideCrowns } from "../../src/lib/fieldTwin/build/weeds";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { encodePng } from "../bench/images";
import { OUT, loadReference, quarterPixels } from "./common";
import { loadTwin } from "./boundaryCommon";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const R = Number(arg("r", "0.5"));
const ONLY = arg("photos", "").split(",").filter(Boolean);
const ONLY_V = arg("variants", "").split(",").filter(Boolean);
const DRAW = arg("draw", "");

const { frames, model } = loadReference();
const GROUND = model.globals.groundOffsetM;
const twin = loadTwin("apricot-2021-04-27");
const labels = (JSON.parse(readFileSync(join(OUT, "labels.geojson"), "utf8")) as { features: { geometry: { coordinates: [number, number] }; properties: { cls: string } }[] }).features;
const lat0 = labels[0].geometry.coordinates[1], lng0 = labels[0].geometry.coordinates[0];
const mLat = 111_320, mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
const loc = (lat: number, lng: number): [number, number] => [(lng - lng0) * mLng, (lat - lat0) * mLat];
const LW = labels.filter(f => f.properties.cls === "weed").map(f => loc(f.geometry.coordinates[1], f.geometry.coordinates[0]));
const LC = labels.filter(f => f.properties.cls === "crop").map(f => loc(f.geometry.coordinates[1], f.geometry.coordinates[0]));
const box = { x0: Math.min(...LW.map(p => p[0])) - 1, x1: Math.max(...LW.map(p => p[0])) + 1, y0: Math.min(...LW.map(p => p[1])) - 1, y1: Math.max(...LW.map(p => p[1])) + 1 };
const crowns = twin.trees.map(t => ({ p: loc(t.lat, t.lng), r: t.crownRadiusM }));
const twinCrowns = twin.trees.map(t => ({ lat: t.lat, lng: t.lng, r: t.crownRadiusM }));
const rows = twin.rows.filter(r => r.kept).map(r => r.line.map(([lat, lng]) => loc(lat, lng)));

// Photographs that hold at least half the labelled weeds inside their frame (100 px in from the edge).
const inViewOf = (f: GeorefFrame) => (p: [number, number]) => { const lat = lat0 + p[1] / mLat, lng = lng0 + p[0] / mLng; const h = groundToPixel(f, lat, lng, GROUND); return !!h && h.u > 100 && h.v > 100 && h.u < f.intrinsics.width - 100 && h.v < f.intrinsics.height - 100; };
const covering: GeorefFrame[] = [];
for (const f of frames.values()) {
  if (ONLY.length && !ONLY.includes(f.name)) continue;
  const n = LW.filter(inViewOf(f)).length;
  if (n >= 0.5 * LW.length || (ONLY.length && n > 0)) covering.push(f);
}
console.log(`${covering.length} photographs hold half or more of the labelled weeds: ${covering.map(f => `${f.name} (${LW.filter(inViewOf(f)).length})`).join(", ")}`);

// Variants: the green rules at a decode ratio.
type Variant = { name: string; down: number; opts: Partial<GreenOptions>; crownMask?: boolean; crownCut?: [number, number]; /** Drop patches wholly inside this scale of the crowns (plus the margin). */ fringe?: number; /** The saved RF-DETR answers (m1/rfdetr) instead of the rules. */ model?: boolean };
const variants: Variant[] = [
  { name: "model RF-DETR Seg-Large, saved answers, weed instances", down: 4, opts: {}, model: true },
  { name: "v0 today: ExGR>0, 4 cm px, 2 px cells, 3 cells", down: 4, opts: {} },
  { name: "v1 ExGR>0, 4 cm px, 1 px cells, 2 cells", down: 4, opts: { cellPx: 1, minCells: 2 } },
  { name: "v2 v1 + soil-relative threshold", down: 4, opts: { cellPx: 1, minCells: 2, index: "exgr-soil" } },
  { name: "v3 ExGR>0, 2 cm px, 2 px cells, 3 cells", down: 2, opts: { cellPx: 2, minCells: 3 } },
  { name: "v4 v3 + soil-relative threshold", down: 2, opts: { cellPx: 2, minCells: 3, index: "exgr-soil" } },
  { name: "v5 v4 + split large patches", down: 2, opts: { cellPx: 2, minCells: 3, index: "exgr-soil", splitM2: 0.3 } },
  { name: "v6 ExG + Otsu, 4 cm px, 1 px cells", down: 4, opts: { cellPx: 1, minCells: 2, index: "exg-otsu" } },
  { name: "v7 v2 + split large patches", down: 4, opts: { cellPx: 1, minCells: 2, index: "exgr-soil", splitM2: 0.3 } },
  { name: "v8 v2 with soil margin 0.12", down: 4, opts: { cellPx: 1, minCells: 2, index: "exgr-soil", soilMargin: 0.12 } },
  { name: "v9 v2 with soil margin 0.2", down: 4, opts: { cellPx: 1, minCells: 2, index: "exgr-soil", soilMargin: 0.2 } },
  { name: "v10 v2 with 3 cells", down: 4, opts: { cellPx: 1, minCells: 3, index: "exgr-soil" } },
  { name: "v11 v7 + small patches need 0.25 above the soil", down: 4, opts: { cellPx: 1, minCells: 2, index: "exgr-soil", splitM2: 0.3, smallCells: 4, smallMargin: 0.25 } },
  { name: "v12 v11 with 0.3", down: 4, opts: { cellPx: 1, minCells: 2, index: "exgr-soil", splitM2: 0.3, smallCells: 4, smallMargin: 0.3 } },
  { name: "v13 v11 with small = under 6 cells", down: 4, opts: { cellPx: 1, minCells: 2, index: "exgr-soil", splitM2: 0.3, smallCells: 6, smallMargin: 0.25 } },
  { name: "v14 v11 + whole patches touching a crown dropped", down: 4, opts: { cellPx: 1, minCells: 2, index: "exgr-soil", splitM2: 0.3, smallCells: 4, smallMargin: 0.25 }, crownMask: true },
  { name: "v15 v11 + crown discs cut out (1.3 r + 0.3 m)", down: 4, opts: { cellPx: 1, minCells: 2, index: "exgr-soil", splitM2: 0.3, smallCells: 4, smallMargin: 0.25 }, crownCut: [1.3, 0.3] },
  { name: "v16 v11 + crown discs cut out (1.6 r + 0.3 m)", down: 4, opts: { cellPx: 1, minCells: 2, index: "exgr-soil", splitM2: 0.3, smallCells: 4, smallMargin: 0.25 }, crownCut: [1.6, 0.3] },
  { name: "v17 v11 + crown discs cut out (1.0 r + 0.3 m)", down: 4, opts: { cellPx: 1, minCells: 2, index: "exgr-soil", splitM2: 0.3, smallCells: 4, smallMargin: 0.25 }, crownCut: [1.0, 0.3] },
  { name: "v18 v17 + patches wholly within 1.3 r + 0.3 dropped (fringe)", down: 4, opts: { cellPx: 1, minCells: 2, index: "exgr-soil", splitM2: 0.3, smallCells: 4, smallMargin: 0.25 }, crownCut: [1.0, 0.3], fringe: 1.3 },
  { name: "v19 v17 + fringe 1.5", down: 4, opts: { cellPx: 1, minCells: 2, index: "exgr-soil", splitM2: 0.3, smallCells: 4, smallMargin: 0.25 }, crownCut: [1.0, 0.3], fringe: 1.5 },
  { name: "v20 v17 + fringe 1.8", down: 4, opts: { cellPx: 1, minCells: 2, index: "exgr-soil", splitM2: 0.3, smallCells: 4, smallMargin: 0.25 }, crownCut: [1.0, 0.3], fringe: 1.8 },
].filter(v => !ONLY_V.length || ONLY_V.some(k => v.name.startsWith(k)));

type Row = { variant: string; photo: string; labelsInView: number; found: number; candidates: number; nearWeed: number; nearCrop: number; inCrown: number; nearNothing: number; nothingBySize: [number, number, number]; areaM2: number; bigPatches: number; ms: number };
const rowsOut: Row[] = [];
const pixelCache = new Map<string, PhotoPixels>();
const pixelsOf = (name: string, down: number) => { const k = `${name}@${down}`; let p = pixelCache.get(k); if (!p) { p = quarterPixels(name, down); pixelCache.set(k, p); } return p; };

for (const v of variants) {
  for (const f of covering) {
    const px = pixelsOf(f.name, v.down);
    const t0 = performance.now();
    const pixelM = (groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy) ?? 0.01) * (f.intrinsics.width / px.width);
    const crownAt = (u: number, vv: number) => { const g = pixelToGround(f, u, vv); if (!g) return false; const p = loc(g.lat, g.lng); return crowns.some(k => (k.p[0] - p[0]) ** 2 + (k.p[1] - p[1]) ** 2 <= (CROWN_SCALE * k.r + CROWN_MARGIN_M) ** 2); };
    const exclude = v.crownCut ? crownMask(f, px, twin.trees.map(t => ({ lat: t.lat, lng: t.lng, r: t.crownRadiusM, h: t.heightM })), v.crownCut[0], v.crownCut[1]) : null;
    const patches = v.model
      ? (JSON.parse(readFileSync(join(OUT, "m1", "rfdetr", `${f.name}.json`), "utf8")) as { instances: { centroid_px: [number, number]; area_px: number; class: string }[] }).instances.filter(i => i.class === "weed").map((i, k) => ({ id: k + 1, u: i.centroid_px[0], v: i.centroid_px[1], hull: [] as [number, number][], cells: 0, areaPx: i.area_px, touchesEdge: false }))
      : greenPatches(px, f.intrinsics.width / px.width, { ...GREEN_DEFAULTS, pixelM, ...v.opts }, v.crownMask ? o => !crownAt(o.u, o.v) && !o.hull.some(([u, vv]) => crownAt(u, vv)) : v.fringe ? o => !patchInsideCrowns(f, o, twinCrowns, v.fringe!, CROWN_MARGIN_M) : undefined, exclude);
    const ms = performance.now() - t0;
    // Candidates on the ground, inside the labelled box.
    const cands: { p: [number, number]; areaM2: number; u: number; v: number; kind: number }[] = [];
    for (const o of patches) {
      const g = pixelToGround(f, o.u, o.v), gsd = groundSampleAt(f, o.u, o.v);
      if (!g || gsd == null) continue;
      const p = loc(g.lat, g.lng);
      if (p[0] < box.x0 || p[0] > box.x1 || p[1] < box.y0 || p[1] > box.y1) continue;
      cands.push({ p, areaM2: o.areaPx * gsd * gsd, u: o.u, v: o.v, kind: 0 });
    }
    const lw = LW.filter(inViewOf(f));
    const near = (pts: [number, number][], q: [number, number], r: number) => pts.some(p => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 <= r * r);
    let nearWeed = 0, nearCrop = 0, inCrown = 0, nearNothing = 0, area = 0, big = 0;
    const nothingBySize: [number, number, number] = [0, 0, 0];
    for (const c of cands) {
      area += c.areaM2;
      if (c.areaM2 > 0.3) big++;
      const crown = crowns.some(k => (k.p[0] - c.p[0]) ** 2 + (k.p[1] - c.p[1]) ** 2 <= (k.r + 0.1) ** 2);
      if (crown || near(LC, c.p, R)) { nearCrop++; c.kind = 2; if (crown) inCrown++; }
      else if (near(LW, c.p, R)) { nearWeed++; c.kind = 1; }
      else { nearNothing++; c.kind = 3; nothingBySize[c.areaM2 < 0.005 ? 0 : c.areaM2 < 0.03 ? 1 : 2]++; }
    }
    // Found: a labelled weed with a candidate near it that is not a crown's (a crown piece next to a label does not count).
    const weedCands = cands.filter(c => c.kind !== 2).map(c => c.p);
    const found = lw.filter(q => near(weedCands, q, R)).length;
    rowsOut.push({ variant: v.name, photo: f.name, labelsInView: lw.length, found, candidates: cands.length, nearWeed, nearCrop, inCrown, nearNothing, nothingBySize, areaM2: +area.toFixed(1), bigPatches: big, ms: +ms.toFixed(0) });
    // A picture: the photograph with every candidate's centre marked (green near a weed label, blue near a crop or in
    // a crown, red near nothing) and the labels (white weed, grey crop) as small rings.
    if (DRAW && f.name === DRAW) {
      const W = px.width, H = px.height, pic = new Uint8Array(W * H * 4);
      for (let i = 0; i < W * H; i++) { pic[i * 4] = px.rgba[i * 4]; pic[i * 4 + 1] = px.rgba[i * 4 + 1]; pic[i * 4 + 2] = px.rgba[i * 4 + 2]; pic[i * 4 + 3] = 255; }
      const dot = (x: number, y: number, rgb: [number, number, number], r: number, ring = false) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const d2 = dx * dx + dy * dy; if (d2 > r * r || (ring && d2 < (r - 1.5) * (r - 1.5))) continue; const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const o = (yy * W + xx) * 4; pic[o] = rgb[0]; pic[o + 1] = rgb[1]; pic[o + 2] = rgb[2]; } };
      const dn = f.intrinsics.width / W;
      for (const q of LW) { const h = groundToPixel(f, lat0 + q[1] / mLat, lng0 + q[0] / mLng, GROUND); if (h) dot(h.u / dn, h.v / dn, [255, 255, 255], 6, true); }
      for (const q of LC) { const h = groundToPixel(f, lat0 + q[1] / mLat, lng0 + q[0] / mLng, GROUND); if (h) dot(h.u / dn, h.v / dn, [160, 160, 160], 6, true); }
      for (const c of cands) dot(c.u / dn, c.v / dn, c.kind === 1 ? [40, 255, 40] : c.kind === 2 ? [80, 140, 255] : [255, 40, 40], 2);
      const name = `colour-${v.name.split(" ")[0]}-${f.name}.png`;
      writeFileSync(join(OUT, name), encodePng({ width: W, height: H, data: pic }));
      console.log(`  drew ${name}`);
    }
  }
}
void rows;

// Table: per variant, summed over the photographs.
const byVariant = new Map<string, Row[]>();
for (const r of rowsOut) (byVariant.get(r.variant) ?? byVariant.set(r.variant, []).get(r.variant)!).push(r);
const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)} %` : "-");
console.log("\n| Variant | Labelled weeds found (sum over views) | Candidates in the box | near a weed | near a crop / in a crown | near nothing (by size) | area m² | patches > 0.3 m² | ms per photo |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const [name, rs] of byVariant) {
  const s = (k: keyof Row) => rs.reduce((a, r) => a + (r[k] as number), 0);
  const nb = rs.reduce((a, r) => [a[0] + r.nothingBySize[0], a[1] + r.nothingBySize[1], a[2] + r.nothingBySize[2]], [0, 0, 0]);
  console.log(`| ${name} | ${s("found")} of ${s("labelsInView")} (${pc(s("found"), s("labelsInView"))}) | ${s("candidates")} | ${s("nearWeed")} (${pc(s("nearWeed"), s("candidates"))}) | ${s("nearCrop")} / ${s("inCrown")} | ${s("nearNothing")} (${pc(s("nearNothing"), s("candidates"))}; under 50 cm2 ${nb[0]}, to 300 cm2 ${nb[1]}, over ${nb[2]}) | ${s("areaM2").toFixed(0)} | ${s("bigPatches")} | ${(s("ms") / rs.length).toFixed(0)} |`);
}
const d301 = rowsOut.filter(r => r.photo === "DJI_0301");
if (d301.length) { console.log("\nDJI_0301 alone:"); for (const r of d301) console.log(`  ${r.variant}: found ${r.found}/${r.labelsInView}, candidates ${r.candidates} (weed ${r.nearWeed}, crop/crown ${r.nearCrop}/${r.inCrown}, nothing ${r.nearNothing}), area ${r.areaM2} m², big ${r.bigPatches}, ${r.ms} ms`); }
writeFileSync(join(OUT, "colour-bench.json"), JSON.stringify({ r: R, covering: covering.map(f => f.name), rows: rowsOut }, null, 1));
