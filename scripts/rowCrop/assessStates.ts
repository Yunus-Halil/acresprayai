// The field assessment's cell states over folders of photographs, as one JSON (for comparing two versions of
// assess.ts cell by cell: a speed change must not move the states), with the time of each.
//   npx vite-node scripts/rowCrop/assessStates.ts -- --out states.json [--compare other.json] dir1 dir2 ...
import "../bench/nodeStorageShim";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { assessField } from "../../src/lib/rowCrop/assess";
import { DEFAULT_ROW_CROP_PARAMS } from "../../src/lib/rowCrop/readRowCrop";

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = arg("out") ?? "states.json", CMP = arg("compare");
const dirs = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
type Rec = { photo: string; dir: number | null; pitches: number[]; states: string; ms: number };
const out: Rec[] = [];
for (const d of dirs) for (const f of readdirSync(d).filter(f => /\.jpe?g$/i.test(f)).sort()) {
  const raw = decodeImage(new Uint8Array(readFileSync(join(d, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  const a = assessField(px, DEFAULT_ROW_CROP_PARAMS);
  out.push({ photo: `${d}/${f}`, dir: a.field?.directionDeg ?? null, pitches: a.field?.clusters.map(p => Math.round(p)) ?? [], states: a.cells.map(c => c.state[0] + (c.cluster ?? "")).join(""), ms: a.ms });
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
const ms = out.map(r => r.ms).sort((a, b) => a - b);
console.log(`${out.length} photos, assess median ${ms[ms.length >> 1]} ms, max ${ms[ms.length - 1]} ms -> ${OUT}`);
if (CMP && existsSync(CMP)) {
  const old = new Map((JSON.parse(readFileSync(CMP, "utf8")) as Rec[]).map(r => [r.photo, r]));
  let cells = 0, moved = 0, photos = 0;
  for (const r of out) {
    const o = old.get(r.photo); if (!o) continue;
    const a = r.states.match(/[a-z]\d*/g) ?? [], b = o.states.match(/[a-z]\d*/g) ?? [];
    const diff = a.filter((s, i) => s !== b[i]).length; cells += a.length; moved += diff;
    if (diff || JSON.stringify(r.pitches) !== JSON.stringify(o.pitches)) { photos++; console.log(`  ${r.photo}: ${diff} cells moved; pitches ${o.pitches.join("/")} -> ${r.pitches.join("/")}; dir ${o.dir} -> ${r.dir}`); }
  }
  console.log(`compared with ${CMP}: ${moved} of ${cells} cells changed state on ${photos} photos`);
}
