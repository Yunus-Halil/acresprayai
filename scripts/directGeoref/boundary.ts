// Boundary evidence, step 2: classify the sampled ground, infer the cultivated block, draw it over the sampled
// ground for checking, and write the record the twin bundle carries.
//
//   npx vite-node scripts/directGeoref/boundary.ts -- [--id apricot-2021-04-27] [--no-patch]
//
// Reads boundary/measures.{json,bin} (boundaryEvidence.ts) and the twin, writes boundary/:
//   classes.png     the evidence raster (soil brown, canopy green, cover yellow-green, road grey, foreign purple,
//                   unseen dark)
//   boundary.png    the sampled ground with the inferred boundary (white: supported by the photographs; dotted
//                   green: bridged; dashed amber: a cap; dotted blue: coverage), the row-aligned baseline (thin grey) and the concave
//                   baseline (thin cyan), the rows, and the excluded rows in red
//   boundary.json   the bundle record (TwinBoundary) and the full result
//   report.md       polygon, area, uncertainty, timing, failure cases
// and, unless --no-patch, writes the record into the twin's twin.json as `boundary`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng } from "../bench/images";
import { type BoundaryResult, inferBoundary, reliableRows, toTwinBoundary, treesInCover } from "../../src/lib/fieldTwin/boundary";
import { EV, EVIDENCE_CLASSES, type EvidenceMeasures, type EvidenceTree, classifyEvidence, downsampleEvidence, encodeEvidence } from "../../src/lib/fieldTwin/boundaryEvidence";
import { localFrame } from "../../src/lib/fieldTwin/intelligence";
import type { TwinBundle } from "../../src/lib/fieldTwin/types";
import { OUT } from "./common";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ID = arg("id", "apricot-2021-04-27");
const DIR = join(OUT, "boundary");
const twinPath = join(OUT, "..", "twin", ID, "twin.json");
const twin = JSON.parse(readFileSync(twinPath, "utf8")) as TwinBundle;
const fr = localFrame(twin);

// The measurements.
type Header = { cellM: number; along0: number; across0: number; width: number; height: number; layout: [string, "Uint8" | "Float32" | "Int16", number][]; sampledMs: number };
const h = JSON.parse(readFileSync(join(DIR, "measures.json"), "utf8")) as Header;
const raw = readFileSync(join(DIR, "measures.bin"));
const N = h.width * h.height;
const arrays: Record<string, Uint8Array | Float32Array | Int16Array> = {};
let off = 0;
for (const [name, typ, k] of h.layout) {
  const bytes = N * k * (typ === "Uint8" ? 1 : typ === "Int16" ? 2 : 4);
  const buf = raw.buffer.slice(raw.byteOffset + off, raw.byteOffset + off + bytes);
  arrays[name] = typ === "Uint8" ? new Uint8Array(buf) : typ === "Int16" ? new Int16Array(buf) : new Float32Array(buf);
  off += bytes;
}
const photoOf = arrays.photoOf as Int16Array;
const seen = new Uint8Array(N);
for (let c = 0; c < N; c++) seen[c] = photoOf[c] >= 0 ? 1 : 0;
const measures: EvidenceMeasures = { cellM: h.cellM, along0: h.along0, across0: h.across0, width: h.width, height: h.height, seen, cover: arrays.cover as Float32Array, luma: arrays.luma as Float32Array, sat: arrays.sat as Float32Array };

// The trees, in the field frame: on one of the reliable rows (the field's own canopy) or not (a hedge, another
// planting). Reliable rows are judged on geometry first; after classification, the trees standing in dense cover
// are found and the rows judged again with them left out, and the raster is classified once more so those
// trees are not painted as the field's canopy.
const treesFor = (rowIds: Set<number>, exclude: Set<number>): EvidenceTree[] => twin.trees.map(t => { const [al, ac] = fr.toField(...fr.toLocal(t.lat, t.lng)); return { along: al, across: ac, r: t.crownRadiusM, onRow: !exclude.has(t.id) && t.rowId != null && rowIds.has(t.rowId) }; });
const t0 = Date.now();
const pass1 = reliableRows(twin);
let { raster, stats: cstats } = classifyEvidence(measures, treesFor(new Set(pass1.rows.map(r => r.id)), new Set(pass1.trimmed.flatMap(t => t.ids))));
const inCover = treesInCover(twin, raster, fr);
const pass2 = reliableRows(twin, raster, {}, inCover, fr);
({ raster, stats: cstats } = classifyEvidence(measures, treesFor(new Set(pass2.rows.map(r => r.id)), new Set([...inCover, ...pass2.trimmed.flatMap(t => t.ids)]))));
const classifyMs = Date.now() - t0;
console.log(`classified in ${classifyMs} ms (${inCover.size} trees in cover; rows ${pass2.rows.map(r => r.id).join(", ")}):`, cstats);

const result = inferBoundary(twin, raster);
if (!result) throw new Error("no reliable row: nothing to infer");
console.log(`inferred in ${result.processingMs.toFixed(1)} ms: ${result.vertices.length} vertices, ${(result.areaM2 / 10_000).toFixed(3)} ha +- ${(result.uncertaintyM2 / 10_000).toFixed(3)}`);
for (const f of result.failures) console.log(`  failure: ${f}`);

// The bundle record: the raster at 0.5 m (two cells), run-length encoded.
const coarse = downsampleEvidence(raster, Math.max(1, Math.round(0.5 / raster.cellM)));
const encoded = encodeEvidence(coarse);
const record = toTwinBoundary(result, fr, encoded);
console.log(`evidence raster for the bundle: ${coarse.width} x ${coarse.height} at ${coarse.cellM} m, ${(encoded.rle.length / 1024).toFixed(0)} KB encoded`);

// ------------------------------------------------------------------------------------------------------------------
// Pictures
// ------------------------------------------------------------------------------------------------------------------
const W = raster.width, H = raster.height;
const CLASS_RGB: Record<number, [number, number, number]> = { [EV.unseen]: [34, 36, 34], [EV.soil]: [150, 110, 80], [EV.canopy]: [70, 150, 80], [EV.cover]: [190, 200, 70], [EV.road]: [200, 200, 200], [EV.foreign]: [170, 90, 200] };
const classes = new Uint8Array(N * 4);
for (let c = 0; c < N; c++) { const [r, g, b] = CLASS_RGB[raster.cls[c]]; classes[c * 4] = r; classes[c * 4 + 1] = g; classes[c * 4 + 2] = b; classes[c * 4 + 3] = 255; }
writeFileSync(join(DIR, "classes.png"), encodePng({ width: W, height: H, data: classes }));

const rgb = arrays.rgb as Uint8Array;
const pic = new Uint8Array(N * 4);
for (let c = 0; c < N; c++) { const o = c * 4; if (!seen[c]) { pic[o] = pic[o + 1] = pic[o + 2] = 40; } else { pic[o] = rgb[c * 3]; pic[o + 1] = rgb[c * 3 + 1]; pic[o + 2] = rgb[c * 3 + 2]; } pic[o + 3] = 255; }
const px = (al: number, ac: number): [number, number] => [(al - raster.along0) / raster.cellM, (ac - raster.across0) / raster.cellM];
const put = (x: number, y: number, rgbv: [number, number, number], a = 1) => { const i = Math.round(x), j = Math.round(y); if (i < 0 || j < 0 || i >= W || j >= H) return; const o = (j * W + i) * 4; pic[o] = pic[o] * (1 - a) + rgbv[0] * a; pic[o + 1] = pic[o + 1] * (1 - a) + rgbv[1] * a; pic[o + 2] = pic[o + 2] * (1 - a) + rgbv[2] * a; };
const line = (p: [number, number], q: [number, number], col: [number, number, number], width = 1, dash: [number, number] | null = null) => {
  const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) * 2);
  for (let k = 0; k <= n; k++) {
    if (dash && Math.floor((k / 2) / dash[0]) % 2 === 1 && dash[1]) continue;
    const x = p[0] + ((q[0] - p[0]) * k) / n, y = p[1] + ((q[1] - p[1]) * k) / n;
    for (let dx = -width + 1; dx < width; dx++) for (let dy = -width + 1; dy < width; dy++) put(x + dx, y + dy, col);
  }
};
const ring = (pts: [number, number][], col: [number, number, number], width = 1, dash: [number, number] | null = null) => { for (let i = 0; i < pts.length; i++) line(px(...pts[i]), px(...pts[(i + 1) % pts.length]), col, width, dash); };
// Rows (kept sage, excluded red), baselines, then the boundary by support.
for (const r of twin.rows) {
  const ends = r.line.map(([lat, lng]) => fr.toField(...fr.toLocal(lat, lng)));
  const excluded = result.rowsExcluded.some(x => x.id === r.id);
  line(px(...ends[0]), px(...ends[1]), excluded ? [230, 60, 60] : r.kept ? [167, 191, 168] : [120, 120, 120], 1, r.kept ? null : [3, 3]);
}
ring(result.baselines.rowAligned.ringField, [160, 160, 160], 1, [2, 2]);
if (result.baselines.concave) ring(result.baselines.concave.ringField, [60, 200, 220], 1);
const V = result.vertices;
for (let i = 0; i < V.length; i++) {
  const a = V[i], b = V[(i + 1) % V.length];
  const weak = a.support === "photographs" ? b.support : a.support;
  const col: [number, number, number] = weak === "photographs" ? [255, 255, 255] : weak === "cap" ? [240, 166, 58] : weak === "coverage" ? [100, 160, 255] : weak === "bridged" ? [170, 240, 170] : [220, 220, 220];
  line(px(a.along, a.across), px(b.along, b.across), col, 2, weak === "photographs" ? null : weak === "cap" ? [4, 4] : [2, 3]);
}
writeFileSync(join(DIR, "boundary.png"), encodePng({ width: W, height: H, data: pic }));

// ------------------------------------------------------------------------------------------------------------------
// The record, the report, and the twin
// ------------------------------------------------------------------------------------------------------------------
writeFileSync(join(DIR, "boundary.json"), JSON.stringify({ record, result: { ...result, ring: undefined, ringLatLng: undefined } }, null, 1));
const s = result.stats;
const pct = (v: number) => `${Math.round(100 * v)} %`;
const report = `# Cultivated-block boundary: ${twin.name} (${ID})

Inferred ${new Date().toISOString().slice(0, 10)} from ${result.rowsUsed.length} rows and the photographs; no boundary was drawn by hand.

| | |
|---|---|
| Method | ${result.method} |
| Polygon | ${result.vertices.length} vertices (after simplification at ${0.3} m) |
| Area | ${(result.areaM2 / 10_000).toFixed(3)} ha, plausible range ${((result.areaM2 - result.uncertaintyM2) / 10_000).toFixed(3)} to ${((result.areaM2 + result.uncertaintyM2) / 10_000).toFixed(3)} ha |
| Extent | ${s.extentAlongM.toFixed(1)} m along the rows, ${s.extentAcrossM.toFixed(1)} m across |
| Rows used | ${result.rowsUsed.join(", ")} |
| Rows excluded | ${result.rowsExcluded.map(x => `${x.id} (${x.reason})`).join("; ") || "none"} |
| Row pitch, plant spacing | ${s.rowPitchM.toFixed(2)} m, ${s.plantSpacingM.toFixed(2)} m |
| End-of-row margin beyond the last tree | median ${s.endMarginM.median.toFixed(1)} m (${s.endMarginM.min.toFixed(1)} to ${s.endMarginM.max.toFixed(1)}) |
| Side margin beyond the outer rows | median ${s.sideMarginM.median.toFixed(1)} m (${s.sideMarginM.min.toFixed(1)} to ${s.sideMarginM.max.toFixed(1)}) |
| Vertices by support | photographs ${pct(s.support.photographs)}, bridged ${pct(s.support.bridged)}, cap ${pct(s.support.cap)}, coverage ${pct(s.support.coverage)}, default ${pct(s.support.default)} |
| What stopped the probes | ${Object.entries(s.stoppedBy).map(([k, v]) => `${k} ${v}`).join(", ") || "nothing"} |
| Trees on the rows inside / outside / in cover / trimmed from row ends | ${s.treesInside} / ${s.onRowTreesOutside} / ${s.treesInCover} / ${s.treesTrimmed} |
| Trees off the rows outside | ${s.offRowTreesOutside} |
| Ground inside by class | ${s.inside ? EVIDENCE_CLASSES.map(k => `${k} ${pct(s.inside![k])}`).join(", ") : "no photographs"} |
| Row-aligned baseline (half-spacing margins) | ${(result.baselines.rowAligned.areaM2 / 10_000).toFixed(3)} ha |
| Concave baseline (closing of the on-row trees) | ${result.baselines.concave ? `${(result.baselines.concave.areaM2 / 10_000).toFixed(3)} ha, overlap ${pct(result.baselines.concave.overlapShare)}` : "none"} |
| Processing | sampling ${(h.sampledMs / 1000).toFixed(1)} s (71 photographs), classification ${classifyMs} ms, inference ${result.processingMs.toFixed(0)} ms |
| Evidence raster | ${raster.width} x ${raster.height} cells at ${raster.cellM} m; in the bundle ${coarse.width} x ${coarse.height} at ${coarse.cellM} m, ${(encoded.rle.length / 1024).toFixed(0)} KB |

## Failure cases

${result.failures.length ? result.failures.map(f => `- ${f}`).join("\n") : "- none diagnosed"}

## Polygon (latitude, longitude)

${record.cultivated.ring.map((p, i) => `${i + 1}. ${p[0]}, ${p[1]} (${record.cultivated.vertices[i].support}${record.cultivated.vertices[i].stoppedBy ? `: ${record.cultivated.vertices[i].stoppedBy}` : ""}, margin ${record.cultivated.vertices[i].marginM} m, ± ${record.cultivated.vertices[i].uncertaintyM} m)`).join("\n")}
`;
writeFileSync(join(DIR, "report.md"), report);
if (!argv.includes("--no-patch")) {
  (twin as TwinBundle & { boundary?: unknown }).boundary = record;
  writeFileSync(twinPath, JSON.stringify(twin));
  console.log(`boundary written into ${twinPath}`);
}
console.log(`-> ${DIR}`);
void existsSync; void (null as unknown as BoundaryResult);
