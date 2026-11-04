// Corn V1 over a whole field, on a real overlapping corn flight (2026-11-04): a UAV3DCrop scene's photographs read by
// Corn V1 one by one, placed through Swardus Direct camera frames built from the scene's poses, and combined by
// src/lib/fieldTwin/cornField.ts. No labels exist for these scenes, so the bench measures what overlap makes measurable:
// whether the photographs agree where the rows are (across scatter of one row's pieces), the row spacing the field
// shows (0.76 m expected), and how many single-photograph findings the other photographs confirm or refute.
//   npx vite-node scripts/rowCrop/cornFieldBench.ts --scene <scene dir> --out <dir> [--n 30] [--reads <cache dir>]
//       [--mosaic-cm 2]
// Writes <out>/field.json (the field result), <out>/README.md (the measures) and <out>/field.jpg (the fused rows,
// weeds and gaps over a mosaic of the same photographs, each ground cell from the photograph whose centre is nearest).
import "../bench/nodeStorageShim";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readCornV1 } from "../../src/lib/rowCrop/cornV1";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { compactCornRead, cornField, type CornPhotoRead } from "../../src/lib/fieldTwin/cornField";
import { groundSampleAt, groundToPixel } from "../../src/lib/directGeoref/projection";
import { fromEnu, toEnu } from "../../src/lib/sourceFrames/odm";
import { sceneFrames } from "./uav3dcrop";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const SCENE = arg("scene")!, OUT = arg("out")!, N = Number(arg("n", "30")), READS = arg("reads", join(OUT, "reads"))!, MOSAIC_CM = Number(arg("mosaic-cm", "2"));
if (!SCENE || !OUT) { console.error("need --scene and --out"); process.exit(1); }
mkdirSync(READS, { recursive: true }); mkdirSync(OUT, { recursive: true });
const revision = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();
const sceneKey = SCENE.replace(/\\/g, "/").split("/").slice(-2).join("/");
const stageIndex = JSON.parse(readFileSync(join(SCENE, "..", "..", "stage_index.json"), "utf8")) as Record<string, { stage: string; nadir: string[] }>;
const nadir = new Set((stageIndex[sceneKey]?.nadir ?? []).map(p => p.split("/").pop()!));
// The scale: the reconstruction's units are not metres and the scenes carry no GPS, so one photograph near the middle is
// read with the pixel size unknown (the reader assumes the corn's 76.2 cm rows) and the reconstruction is scaled so its
// own pixel size there agrees. Stated in the README.
const unscaled = sceneFrames(SCENE);
const SCALE_PHOTO = (() => { const c = [...unscaled.centres].filter(([n]) => nadir.has(n) && existsSync(join(SCENE, "images", n))); const mx0 = c.map(([, q]) => q[0]).sort((a, b) => a - b)[c.length >> 1], my0 = c.map(([, q]) => q[1]).sort((a, b) => a - b)[c.length >> 1]; return c.sort((a, b) => Math.hypot(a[1][0] - mx0, a[1][1] - my0) - Math.hypot(b[1][0] - mx0, b[1][1] - my0))[0][0]; })();
const metresPerUnit = (() => {
  const cached = join(READS, "scale.json");
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8")).metresPerUnit as number;
  const raw = decodeImage(new Uint8Array(readFileSync(join(SCENE, "images", SCALE_PHOTO))));
  const v = readCornV1({ width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) }, rowCropParamsFor(cropProfileFor("corn")!, null), { enteredCrop: "corn" });
  const f = unscaled.frames.get(SCALE_PHOTO)!, unitsPerPx = groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy)!;
  const mpu = v.green.gsdM! / unitsPerPx;
  writeFileSync(cached, JSON.stringify({ photo: SCALE_PHOTO, assumedGsdM: v.green.gsdM, unitsPerPx, metresPerUnit: mpu }));
  return mpu;
})();
const { frames, centres } = sceneFrames(SCENE, metresPerUnit);
console.log(`scale: ${metresPerUnit.toFixed(4)} m per reconstruction unit (photograph ${SCALE_PHOTO}'s rows taken as 76.2 cm)`);
// The block: the N nadir photographs nearest the middle of the flight.
const cand = [...centres].filter(([n]) => nadir.has(n) && existsSync(join(SCENE, "images", n)));
const mx = cand.map(([, c]) => c[0]).sort((a, b) => a - b)[cand.length >> 1], my = cand.map(([, c]) => c[1]).sort((a, b) => a - b)[cand.length >> 1];
const chosen = cand.sort((a, b) => Math.hypot(a[1][0] - mx, a[1][1] - my) - Math.hypot(b[1][0] - mx, b[1][1] - my)).slice(0, N).map(([n]) => n);
console.log(`${sceneKey}: ${cand.length} nadir photographs, the ${chosen.length} nearest the middle (stage ${stageIndex[sceneKey]?.stage})`);

const reads: CornPhotoRead[] = [];
let msRead = 0, nRead = 0;
const decode = (name: string): PhotoPixels => { const raw = decodeImage(new Uint8Array(readFileSync(join(SCENE, "images", name)))); return { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) }; };
for (const name of chosen) {
  const cache = join(READS, `${name}.json`);
  if (existsSync(cache)) { reads.push(JSON.parse(readFileSync(cache, "utf8"))); continue; }
  const f = frames.get(name)!, px = decode(name);
  const gsd = groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy);
  const t = Date.now();
  const v = readCornV1(px, rowCropParamsFor(cropProfileFor("corn")!, gsd), { enteredCrop: "corn" });
  msRead += Date.now() - t; nRead++;
  const c = compactCornRead(name, v);
  writeFileSync(cache, JSON.stringify(c));
  reads.push(c);
  console.log(`${name}: ${v.summary.cornRows} corn + ${v.summary.probableRows} planted rows, ${v.summary.weeds} weed candidates, ${v.summary.gaps} gaps, ${Date.now() - t} ms`);
}
const field = cornField(reads, frames);
writeFileSync(join(OUT, "field.json"), JSON.stringify({ revision, scene: sceneKey, photographs: chosen, field }, null, 1));

// Measures.
const s = field.summary;
const hist = (xs: number[]) => { const h = new Map<number, number>(); for (const x of xs) h.set(x, (h.get(x) ?? 0) + 1); return [...h].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}: ${v}`).join(", "); };
const weedCands = field.weeds.filter(w => w.votes["weed candidate"] > 0);
const singleCands = weedCands.filter(w => w.votes["weed candidate"] === 1);
const md = [
  `# Corn V1 over a field: ${sceneKey}`, "",
  `Run ${new Date().toISOString().slice(0, 16)}, code ${revision}. ${chosen.length} nadir photographs nearest the flight's middle (UAV3DCrop, stage "${stageIndex[sceneKey]?.stage}"), each read by Corn V1 (crop entered: corn) and placed through Swardus Direct camera frames built from the scene's own poses and point cloud (scripts/rowCrop/uav3dcrop.ts). No labels: the measures are the photographs' agreement. Scale: ${metresPerUnit.toFixed(4)} m per reconstruction unit, fixed by photograph ${SCALE_PHOTO}'s corn rows taken as 76.2 cm (the scenes carry no GPS); so the row spacing below checks the other photographs against that one, not the absolute scale.`, "",
  "| Measure | Value |", "|---|---|",
  `| Row spacing measured across the photographs (0.76 m expected) | ${field.pitchM} m |`,
  `| Row direction | ${field.directionDeg?.toFixed(1)} deg from east |`,
  `| **Rows agree across photographs**: pieces' across scatter about their field row (median) | ${field.rowAgreementM != null ? (field.rowAgreementM * 100).toFixed(1) + " cm" : "-"} |`,
  `| Field rows: corn / planted, crop not confirmed | ${s.cornRows} / ${s.probableRows} (${s.cornRowLengthM} m of corn row) |`,
  `| Field rows by how many photographs hold them | ${hist(field.rows.map(r => r.seenBy))} |`,
  `| Rows drawn by the single photographs (sum) | ${s.perPhoto.rows} |`,
  `| Weed candidates: single-photograph reports (sum) / field weed candidates | ${s.perPhoto.weedCandidates} / ${s.weeds} |`,
  `| Patches some photograph called a weed candidate: confirmed / withheld (unknown vegetation) / crop on a row | ${weedCands.filter(w => w.verdict === "weed candidate").length} / ${weedCands.filter(w => w.verdict === "unknown vegetation").length} / ${weedCands.filter(w => w.verdict === "crop on a row").length} |`,
  `| ... of them called a weed by one photograph only, while others covered it | ${singleCands.filter(w => w.coveredBy > 1).length} |`,
  `| Stand gaps: single-photograph reports (sum) / field gaps / withheld | ${s.perPhoto.standGaps} / ${s.gaps} (${s.gapLengthM} m) / ${s.gapsWithheld} |`,
  `| Field gaps withheld because another photograph located a plant inside | ${field.gaps.filter(g => g.plantSeenBy.length).length} |`,
  `| Time: Corn V1 per photograph (read this run) / field combination | ${nRead ? Math.round(msRead / nRead) : "-"} ms / ${s.ms} ms |`,
  "", "Picture field.jpg: the photographs' mosaic (nearest camera per cell); cyan = field corn row, amber dashes = planted row, crop not confirmed; red = field weed candidate, grey = withheld patch a photograph called a weed; orange = field stand gap, grey line = withheld gap.", "",
];
writeFileSync(join(OUT, "README.md"), md.join("\n"));
console.log(md.join("\n"));

// Picture: a mosaic of the block (each cell from the nearest camera), the fused field drawn over it.
const origin = field.origin, en = (lat: number, lng: number) => { const v = toEnu({ lat, lng, altM: 0 }, origin); return [v[0], v[1]] as [number, number]; };
const camEN = new Map(chosen.map(n => { const f = frames.get(n)!; return [n, en(f.pose.lat, f.pose.lng)] as const; }));
const allE = [...camEN.values()].map(p => p[0]), allN = [...camEN.values()].map(p => p[1]);
const pad = 4, e0 = Math.min(...allE) - pad, e1 = Math.max(...allE) + pad, n0 = Math.min(...allN) - pad, n1 = Math.max(...allN) + pad;
const res = MOSAIC_CM / 100, W = Math.ceil((e1 - e0) / res), H = Math.ceil((n1 - n0) / res);
const img = new Uint8Array(W * H * 3);
const small = new Map<string, { px: PhotoPixels; f: number }>();
const DOWN = 4;
for (const n of chosen) {
  const p = decode(n), w = Math.floor(p.width / DOWN), h = Math.floor(p.height / DOWN), o = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y * DOWN) * p.width + x * DOWN) * 4, j = (y * w + x) * 4; o[j] = p.rgba[i]; o[j + 1] = p.rgba[i + 1]; o[j + 2] = p.rgba[i + 2]; o[j + 3] = 255; }
  small.set(n, { px: { width: w, height: h, rgba: o }, f: DOWN });
}
const groundAlt = (f: ReturnType<typeof frames.get>, lat: number, lng: number) => f!.ground.kind === "flat" ? f!.ground.altM : (f!.ground.altAt(lat, lng) ?? 0);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const e = e0 + (x + 0.5) * res, nn = n1 - (y + 0.5) * res;
  const order = chosen.map(n => [n, Math.hypot(camEN.get(n)![0] - e, camEN.get(n)![1] - nn)] as const).sort((a, b) => a[1] - b[1]);
  const ll = fromEnu([e, nn, 0], origin);
  for (const [n] of order.slice(0, 3)) {
    const f = frames.get(n)!, hp = groundToPixel(f, ll.lat, ll.lng, groundAlt(f, ll.lat, ll.lng));
    if (!hp || !hp.inside) continue;
    const sm = small.get(n)!, sx = Math.min(sm.px.width - 1, Math.floor(hp.u / sm.f)), sy = Math.min(sm.px.height - 1, Math.floor(hp.v / sm.f)), i = (sy * sm.px.width + sx) * 4, j = (y * W + x) * 3;
    img[j] = sm.px.rgba[i] * 0.85; img[j + 1] = sm.px.rgba[i + 1] * 0.85; img[j + 2] = sm.px.rgba[i + 2] * 0.85;
    break;
  }
}
const toXY = (e: number, n: number): [number, number] => [(e - e0) / res, (n1 - n) / res];
const put = (x: number, y: number, c: [number, number, number], r = 1) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = Math.round(x + dx), Y = Math.round(y + dy); if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = (Y * W + X) * 3; img[j] = c[0]; img[j + 1] = c[1]; img[j + 2] = c[2]; } };
const seg = (a: [number, number], b: [number, number], c: [number, number, number], r = 1, dash = 0) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(L)); for (let i = 0; i <= k; i++) { if (dash && Math.floor(i / dash) % 2) continue; put(a[0] + ((b[0] - a[0]) * i) / k, a[1] + ((b[1] - a[1]) * i) / k, c, r); } };
for (const r of field.rows) for (let i = 1; i < r.lineEN.length; i++) seg(toXY(...r.lineEN[i - 1]), toXY(...r.lineEN[i]), r.identity === "corn" ? [0, 230, 255] : [255, 190, 0], 1, r.identity === "corn" ? 0 : 6);
for (const g of field.gaps) seg(toXY(...g.aEN), toXY(...g.bEN), g.verdict === "stand gap" ? [255, 150, 0] : [170, 170, 170], g.verdict === "stand gap" ? 2 : 1);
for (const w of field.weeds) { if (w.votes["weed candidate"] === 0) continue; const [x, y] = toXY(w.e, w.n), rr = Math.max(4, Math.sqrt(w.areaM2 / Math.PI) / res); const col: [number, number, number] = w.verdict === "weed candidate" ? [255, 40, 40] : [170, 170, 170]; for (let t = 0; t < 64; t++) put(x + rr * Math.cos((t / 64) * 2 * Math.PI), y + rr * Math.sin((t / 64) * 2 * Math.PI), col, 1); }
const rgba = new Uint8Array(W * H * 4); for (let i = 0; i < W * H; i++) { rgba[i * 4] = img[i * 3]; rgba[i * 4 + 1] = img[i * 3 + 1]; rgba[i * 4 + 2] = img[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
writeFileSync(join(OUT, "field.jpg"), encodeJpeg({ width: W, height: H, data: rgba }, 85));
console.log(`field.jpg ${W} x ${H} at ${MOSAIC_CM} cm`);
