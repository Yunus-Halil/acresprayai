// The adaptive corn reader against MSDD's hand-checked corn boxes (Kharismawati & Kazic, arXiv 2509.15181; CC BY-NC-SA:
// evaluation only, never training). The 2022 test set: 1920 px squares of nadir drone video, fields and plants the
// authors never trained on, every corn plant boxed (single / double / triple). Weeds are NOT labelled, so only one
// kind of weed error is measurable: a red weed candidate on a boxed corn plant ("corn called weed"). A candidate away
// from every box may be a weed or a missed plant and is reported as unjudged.
//   npm run bench:msdd -- [--dir D:/swardus-research/datasets/msdd/test] [--out dir] [--limit N] [--every N] [--draw]
// Per tile: rows read, the share of boxes our rows run through (box centre within a quarter pitch of a row line),
// our plant points inside a box (precision) and boxes holding a point (recall), weed candidates on a box.
// Groups follow the paper's Table III (video id -> stage); the oblique videos (0001-0002, 0021, 0068) are left out.
import "../bench/nodeStorageShim";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readCornAdaptive, type AdaptiveRead } from "../../src/lib/rowCrop/adaptive";
import type { RowCropRead } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { canvasOf, drawRead, line, poly, type Rgb } from "./draw";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const revision = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();
const DIR = arg("dir", "D:/swardus-research/datasets/msdd/test")!;
const OUT = arg("out", `directtestimagery/benchmark-msdd-${revision}`)!;
const LIMIT = Number(arg("limit", "0")), EVERY = Number(arg("every", "1"));
const DRAW = argv.includes("--draw");
const profile = cropProfileFor("corn")!;

/** Paper Table III: video id -> stage group, null for oblique video. */
const GROUP: Record<string, string | null> = {
  "827": "V2-V4", "876": "V2-V4", "941": "V2-V4", "942": "V2-V4", "943": "V2-V4", "953": "V2-V4", "954": "V2-V4", "955": "V2-V4",
  "870": "V4-V6", "873": "V4-V6", "993": "V4-V6", "994": "V4-V6", "997": "V4-V6", "998": "V4-V6", "023": "V4-V6", "024": "V4-V6",
  "939": "V6-V12", "984": "V6-V10", "054": "V6-V10", "055": "V6-V10", "056": "V6-V10", "061": "V6-V10", "062": "V6-V10", "092": "V6-V10",
  "001": null, "002": null, "021": null, "068": null,
};
const groupOf = (f: string): string | null => { const m = /^\d\d_\d\d_\d\d_(\d+)_/.exec(f); if (!m) return "other"; const g = GROUP[m[1].padStart(3, "0")]; return g === undefined ? "other" : g; };

type Box = { x1: number; y1: number; x2: number; y2: number; cls: number };
function boxes(file: string, W: number, H: number): Box[] {
  const p = join(DIR, "labels", basename(file, extname(file)) + ".txt");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean).map(l => { const [c, cx, cy, w, h] = l.trim().split(/\s+/).map(Number); return { x1: (cx - w / 2) * W, y1: (cy - h / 2) * H, x2: (cx + w / 2) * W, y2: (cy + h / 2) * H, cls: c }; });
}
const inBox = (b: Box, x: number, y: number, grow = 0) => { const gx = (b.x2 - b.x1) * grow, gy = (b.y2 - b.y1) * grow; return x >= b.x1 - gx && x <= b.x2 + gx && y >= b.y1 - gy && y <= b.y2 + gy; };
/** Distance from a point to the nearest row polyline. */
function distToRows(lines: [number, number][][], x: number, y: number): number {
  let best = Infinity;
  for (const l of lines) for (let i = 0; i + 1 < l.length; i++) {
    const [ax, ay] = l[i], [bx, by] = l[i + 1], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
    best = Math.min(best, Math.hypot(x - ax - t * vx, y - ay - t * vy));
  }
  return best;
}
/** Every plant point the read drew (per-row plant points; emergence rows carry the seedlings it counted as plants). */
function plantPoints(ad: AdaptiveRead): [number, number][] {
  const pts: [number, number][] = [];
  for (const r of ad.rows) for (const p of r.plantPoints ?? []) pts.push(p);
  return pts;
}

function draw(img: PhotoPixels, ad: AdaptiveRead, bx: Box[], wrong: Set<number>, file: string) {
  const cv = canvasOf(img), t = Math.max(1, Math.round(cv.w / 900));
  ad.plans.forEach((p, pi) => {
    if (!p.read) return;
    const base = p.read;
    const r: RowCropRead = { ...base, rows: ad.rows.filter(x => x.plan === pi), weeds: ad.weeds.filter(w => w.plan === pi && w.verdict === "weed candidate"), excluded: ad.excluded.filter(e => e.plan === pi), seedlings: base.seedlings ? { ...base.seedlings, points: ad.seedlingPoints } : null, fieldEdge: { ends: ad.fieldEnds.filter(e => e.plan === pi), lines: ad.fieldLines } };
    drawRead(cv, r);
  });
  const cyan: Rgb = [0, 220, 255];
  for (const b of bx) { line(cv, b.x1, b.y1, b.x2, b.y1, cyan, t); line(cv, b.x2, b.y1, b.x2, b.y2, cyan, t); line(cv, b.x2, b.y2, b.x1, b.y2, cyan, t); line(cv, b.x1, b.y2, b.x1, b.y1, cyan, t); }
  ad.weeds.forEach((w, i) => { if (wrong.has(i)) poly(cv, w.hull, [255, 0, 255], t + 2, true); });
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, encodeJpeg({ width: cv.w, height: cv.h, data: cv.c }, 82));
}

const csv = (rows: Record<string, unknown>[]) => { const keys = [...new Set(rows.flatMap(r => Object.keys(r)))]; return [keys.join(","), ...rows.map(r => keys.map(k => { const s = String(r[k] ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(","))].join("\n") + "\n"; };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10} %` : "-");

type T = { tiles: number; noRows: number; boxes: number; boxesOnRows: number; points: number; pointsInBox: number; boxesWithPoint: number; weeds: number; weedsOnCorn: number; boxesHitByWeed: number; ms: number };
const T0 = (): T => ({ tiles: 0, noRows: 0, boxes: 0, boxesOnRows: 0, points: 0, pointsInBox: 0, boxesWithPoint: 0, weeds: 0, weedsOnCorn: 0, boxesHitByWeed: 0, ms: 0 });

async function main() {
  let files = readdirSync(join(DIR, "images")).filter(f => /\.(png|jpe?g)$/i.test(f)).sort().filter(f => groupOf(f) !== null);
  if (EVERY > 1) files = files.filter((_, i) => i % EVERY === 0);
  if (LIMIT) files = files.slice(0, LIMIT);
  mkdirSync(OUT, { recursive: true });
  const per: Record<string, unknown>[] = [];
  const tot = new Map<string, T>();
  for (const f of files) {
    const g = groupOf(f)!, name = basename(f, extname(f));
    const raw = decodeImage(new Uint8Array(readFileSync(join(DIR, "images", f))));
    const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
    const bx = boxes(f, px.width, px.height);
    const t0 = Date.now();
    let ad: AdaptiveRead | null = null, err = "";
    try { ad = readCornAdaptive(px, rowCropParamsFor(profile, null)); } catch (e) { err = String(e); }
    const ms = Date.now() - t0;
    const row: Record<string, unknown> = { tile: name, group: g, boxes: bx.length, error: err, ms };
    const S = tot.get(g) ?? T0(); tot.set(g, S);
    const A = tot.get("all") ?? T0(); tot.set("all", A);
    for (const s of [S, A]) { s.tiles++; s.boxes += bx.length; s.ms += ms; }
    if (ad) {
      const lines = ad.rows.map(r => r.points);
      const pitchPx = ad.plans.find(p => p.read)?.pitchPx ?? 0;
      const onRows = pitchPx ? bx.filter(b => distToRows(lines, (b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2) <= pitchPx / 4).length : 0;
      const pts = plantPoints(ad);
      const pIn = pts.filter(([x, y]) => bx.some(b => inBox(b, x, y, 0.1))).length;
      const bHas = bx.filter(b => pts.some(([x, y]) => inBox(b, x, y, 0.1))).length;
      const cand = ad.weeds.map((w, i) => ({ w, i })).filter(({ w }) => w.verdict === "weed candidate");
      const wrong = new Set(cand.filter(({ w }) => bx.some(b => inBox(b, w.x, w.y, 0.1))).map(({ i }) => i));
      const hit = bx.filter(b => cand.some(({ w }) => inBox(b, w.x, w.y, 0.1))).length;
      Object.assign(row, { plans: ad.plans.filter(p => p.read).map(p => p.stage).join("+") || "none", rows: ad.rows.length, boxesOnRows: onRows, points: pts.length, pointsInBox: pIn, boxesWithPoint: bHas, weeds: cand.length, weedsOnCorn: wrong.size, boxesHitByWeed: hit });
      for (const s of [S, A]) { if (!ad.rows.length) s.noRows++; s.boxesOnRows += onRows; s.points += pts.length; s.pointsInBox += pIn; s.boxesWithPoint += bHas; s.weeds += cand.length; s.weedsOnCorn += wrong.size; s.boxesHitByWeed += hit; }
      if (DRAW) draw(px, ad, bx, wrong, join(OUT, g, `${name}.jpg`));
    } else for (const s of [S, A]) s.noRows++;
    per.push(row);
    console.log(`${g} ${name}: ${row.plans ?? "error"} rows ${row.rows ?? 0} | boxes ${bx.length} on rows ${row.boxesOnRows ?? 0} | points ${row.points ?? 0} in box ${row.pointsInBox ?? 0} | weeds ${row.weeds ?? 0} on corn ${row.weedsOnCorn ?? 0} | ${ms} ms`);
  }
  writeFileSync(join(OUT, "per-tile.csv"), csv(per));
  const groups = ["V2-V4", "V4-V6", "V6-V10", "V6-V12", "all"].filter(g => tot.has(g));
  const md = [`# Adaptive corn reader against MSDD's hand-checked corn boxes`, "",
    `Code ${revision}, run ${new Date().toISOString().slice(0, 16)}. ${files.length} nadir tiles from ${DIR} (MSDD 2022 test set; CC BY-NC-SA, evaluation only). No pixel size given. Weeds are not labelled in MSDD: only weed candidates on a boxed corn plant are judged.`, "",
    `| Measure | ${groups.join(" | ")} |`, `|---|${groups.map(() => "---").join("|")}|`];
  const rowOf = (label: string, f: (t: T) => string) => md.push(`| ${label} | ${groups.map(g => f(tot.get(g)!)).join(" | ")} |`);
  rowOf("tiles", t => String(t.tiles));
  rowOf("tiles with no rows read", t => `${t.noRows} (${pct(t.noRows, t.tiles)})`);
  rowOf("corn boxes", t => t.boxes.toLocaleString());
  rowOf("corn our rows run through", t => pct(t.boxesOnRows, t.boxes));
  rowOf("our plant points inside a corn box", t => `${pct(t.pointsInBox, t.points)} of ${t.points.toLocaleString()}`);
  rowOf("corn boxes holding one of our points", t => pct(t.boxesWithPoint, t.boxes));
  rowOf("red weed candidates", t => t.weeds.toLocaleString());
  rowOf("weed candidates ON a corn plant (wrong)", t => `${t.weedsOnCorn} (${pct(t.weedsOnCorn, t.weeds)})`);
  rowOf("corn plants marked as a weed", t => `${t.boxesHitByWeed} (${pct(t.boxesHitByWeed, t.boxes)})`);
  rowOf("mean ms per tile", t => String(Math.round(t.ms / Math.max(1, t.tiles))));
  md.push("", "Pictures (with --draw): our read as in the bench pictures, MSDD's corn boxes in cyan, weed candidates on a corn box outlined thick magenta.");
  writeFileSync(join(OUT, "summary.md"), md.join("\n") + "\n");
  console.log(md.join("\n"));
}
main().catch(e => { console.error(e); process.exit(1); });
