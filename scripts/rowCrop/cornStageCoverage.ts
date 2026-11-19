// Development only, read only (APP-1, 2026-11-18): a later-stage flight under a named app preset, as a build combines
// it (fieldTwin/build/corn.ts cornCombine). Per photograph: did the guard withhold the count, at what green cover of its
// rows; how many rows, and how much of their length stands on green (the guard's own measure: whether a row sits on the
// corn); its weed candidates. Over the field: the rows and the weed candidates the twin shows, each weed by where it
// stands (on a row's line, in an alley between rows, or on the headland past the rows). One photograph drawn: its own
// rows (cyan), its own weed candidates (red outlines), and the field's weed candidates seen in it (yellow rings).
//
//   npx vite-node scripts/rowCrop/cornStageCoverage.ts -- --flight <label> --analysis <a.json> --reads <readsDir>
//       --photos <dir> --preset final3 --out <dir> [--draw <photo name>]
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { cornCombine } from "../../src/lib/fieldTwin/build/corn";
import type { CornPhotoRead, FieldRow } from "../../src/lib/fieldTwin/cornField";
import type { CornPreset } from "../../src/lib/fieldTwin/cornPreset";
import { CORN_COUNT_GUARD } from "../../src/lib/rowCrop/cornV1";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, dir = join(arg("reads"), "reads"), preset = arg("preset") as CornPreset, FLIGHT = arg("flight"), OUT = arg("out");
const reads: CornPhotoRead[] = A.reads.map(r => join(dir, `${r.name}.json`)).filter(existsSync).map(p => JSON.parse(readFileSync(p, "utf8")));
if (reads.length !== A.reads.length) throw new Error(`${reads.length} of ${A.reads.length} photographs read`);
const C = cornCombine(reads, framesFromAnalysis(A), preset);
const r1 = (x: number | null | undefined, k = 1000) => (x == null || !Number.isFinite(x) ? null : Math.round(x * k) / k);
const q = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? { min: r1(s[0]), median: r1(s[s.length >> 1]), max: r1(s[s.length - 1]), n: s.length } : null; };

// Per photograph.
const per = C.reads.map(r => ({ name: r.name, withheld: !!r.countWithheld, reason: r.countReason ?? null, rowGreenShare: r.guard?.rowGreenShare ?? null, rows: r.rows.length, cornRows: r.rows.filter(x => x.identity === "corn").length, plants: r.plants.length, weeds: r.patches.filter(p => p.verdict === "weed candidate").length }));

// Where a field weed stands, by the field's rows: along / across the rows' direction.
const F = C.field, pitch = F.pitchM, th = ((F.directionDeg ?? 0) * Math.PI) / 180, ux = Math.cos(th), uy = Math.sin(th);
const lineDist = (row: FieldRow, e: number, n: number) => { let best = Infinity; const L = row.lineEN; for (let k = 1; k < L.length; k++) { const [ax, ay] = L[k - 1], [bx, by] = L[k], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - ay) * dy) / l2)); best = Math.min(best, Math.hypot(e - ax - t * dx, n - ay - t * dy)); } return best; };
let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity;
for (const row of F.rows) for (const [e, n] of row.lineEN) { const a = e * ux + n * uy, c = -e * uy + n * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
const placeOf = (e: number, n: number): "on a row" | "alley" | "headland" | "no rows" => {
  if (!F.rows.length || !pitch) return "no rows";
  const a = e * ux + n * uy, c = -e * uy + n * ux, margin = 0.5 * pitch;
  if (a < a0 - margin || a > a1 + margin || c < c0 - margin || c > c1 + margin) return "headland";
  const d = Math.min(...F.rows.map(r => lineDist(r, e, n)));
  return d <= 0.2 * pitch ? "on a row" : "alley";
};
const weeds = F.weeds.filter(w => w.verdict === "weed candidate").map(w => ({ id: w.id, e: w.e, n: w.n, areaM2: w.areaM2, seenBy: w.seenBy, place: placeOf(w.e, w.n) }));
const byPlace = weeds.reduce<Record<string, number>>((t, w) => ((t[w.place] = (t[w.place] ?? 0) + 1), t), {});
// Rows on the corn: the guard's measure over the photographs that hold rows (share of each row's length under green).
const out = {
  flight: FLIGHT, preset, photographs: per.length,
  guard: { cut: CORN_COUNT_GUARD.cut, withheld: per.filter(p => p.withheld).length, byReason: per.reduce<Record<string, number>>((t, p) => (p.withheld ? ((t[p.reason ?? "?"] = (t[p.reason ?? "?"] ?? 0) + 1), t) : t), {}), rowGreenShare: q(per.map(p => p.rowGreenShare ?? NaN)), countedAnyway: per.filter(p => !p.withheld).map(p => ({ name: p.name, rowGreenShare: p.rowGreenShare, plants: p.plants })) },
  rows: { perPhotograph: q(per.map(p => p.rows)), photographsWithRows: per.filter(p => p.rows).length, field: { rows: F.rows.length, corn: F.rows.filter(r => r.identity === "corn").length, pitchM: r1(pitch), directionDeg: r1(F.directionDeg, 100), rowAgreementM: r1(F.rowAgreementM) } },
  weeds: { perPhotograph: q(per.map(p => p.weeds)), field: weeds.length, byPlace, list: weeds },
  plants: C.plants ? C.plants.summary : null, plantsNote: C.plants ? null : C.placed ? "no certain row from the plants" : "no plant dot (every count withheld)",
  perPhotograph: per,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${FLIGHT}.stage-${preset}.json`), JSON.stringify(out, null, 1));
console.log(`${FLIGHT} ${preset}: count withheld on ${out.guard.withheld} of ${per.length} (green on the rows ${JSON.stringify(out.guard.rowGreenShare)}); field rows ${F.rows.length} (${out.rows.field.corn} corn); field weed candidates ${weeds.length} ${JSON.stringify(byPlace)}; plants ${C.plants ? C.plants.summary.plants : 0}`);

// One photograph drawn (the one asked, else the one most field weed candidates were seen in).
const PH = opt("photos");
if (PH) {
  // The one asked, else the one most of the field's weed candidates were seen in, then the most of its own.
  const seenIn = (n: string) => F.weeds.filter(w => w.verdict === "weed candidate" && w.sightings.some(g => g.photo === n)).length;
  const name = opt("draw") ?? [...per].sort((a, b) => seenIn(b.name) - seenIn(a.name) || b.weeds - a.weeds || b.rows - a.rows)[0].name;
  const file = [".JPG", ".jpg", ".JPEG", ".jpeg"].map(e => join(PH, name + e)).find(existsSync); if (!file) throw new Error(`${name}: no photograph`);
  const img = decodeImage(new Uint8Array(readFileSync(file))), W = img.width, H = img.height, k = Math.max(1, Math.ceil(W / 1800)), w = Math.floor(W / k), h = Math.floor(H / k);
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((y * k) * W + x * k) * 4, d = (y * w + x) * 4; px[d] = img.data[s]; px[d + 1] = img.data[s + 1]; px[d + 2] = img.data[s + 2]; px[d + 3] = 255; }
  const put = (x: number, y: number, c: [number, number, number], r = 1) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = Math.round(x) + dx, Y = Math.round(y) + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const d = (Y * w + X) * 4; px[d] = c[0]; px[d + 1] = c[1]; px[d + 2] = c[2]; } };
  const seg = (ax: number, ay: number, bx: number, by: number, c: [number, number, number], r = 1) => { const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay))); for (let i = 0; i <= n; i++) put(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, c, r); };
  const R = C.reads.find(r => r.name === name)!, s = R.scale / k;
  for (const row of R.rows) for (let i = 1; i < row.points.length; i++) seg(row.points[i - 1][0] * s, row.points[i - 1][1] * s, row.points[i][0] * s, row.points[i][1] * s, row.identity === "corn" ? [0, 230, 255] : [255, 190, 0], 1);
  for (const p of R.patches) if (p.verdict === "weed candidate") for (let i = 0; i < p.hull.length; i++) { const a = p.hull[i], b = p.hull[(i + 1) % p.hull.length]; seg(a[0] * s, a[1] * s, b[0] * s, b[1] * s, [255, 40, 40], 1); }
  let fieldInPhoto = 0;
  for (const wd of F.weeds) if (wd.verdict === "weed candidate") for (const sg of wd.sightings) if (sg.photo === name) { fieldInPhoto++; const cx = sg.u / k, cy = sg.v / k; for (let t = 0; t < 64; t++) put(cx + 14 * Math.cos((t / 64) * 2 * Math.PI), cy + 14 * Math.sin((t / 64) * 2 * Math.PI), [255, 235, 0], 1); }
  writeFileSync(join(OUT, `${FLIGHT}.${name}.jpg`), encodeJpeg({ width: w, height: h, data: px }, 88));
  const me = per.find(p => p.name === name)!;
  writeFileSync(join(OUT, `${FLIGHT}.${name}.json`), JSON.stringify({ name, ...me, fieldWeedsSeenHere: fieldInPhoto }, null, 1));
  console.log(`drawn ${name}: ${me.rows} rows, ${me.weeds} of its own weed candidates, ${fieldInPhoto} field weed candidates seen in it; count withheld: ${me.withheld} (green ${me.rowGreenShare})`);
}
