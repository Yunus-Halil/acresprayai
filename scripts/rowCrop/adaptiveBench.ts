// The adaptive corn reader against the frozen stage readers, photo by photo, over several folders of photographs.
//   npm run bench:adaptive -- [--set name=dir:stage[,stage] ...] [--out dir] [--only 3,21] [--limit N] [--draw] [--debug]
// Default sets: the emergence and establishment benchmark folders, each against its own stage reader, and 2024corn2
// (V3 to V5 corn in a folder named "emergence") against the establishment reader and the emergence reader the folder
// name chose. A stage reader here is run without a geometry, the same code path as the committed reader.
//
// Per photo: rows, row length, plants, possible and missing seedlings, gaps, red weed candidates, small green, corn
// on an unsupported row, field ends, time; and how the two reads' rows agree: the share of the baseline's row length
// that an adaptive row runs along (within a quarter of a pitch), the share of the adaptive row length the baseline
// runs along, adaptive row pairs that duplicate each other, and the baseline's weed candidates standing on an empty
// slot of its own lattice with others (the "dropped row became weeds" failure).
// Out: <out>/<set>/per-photo.csv, <out>/summary.md, <out>/<set>/pictures/<photo>.jpg with --draw.
import "../bench/nodeStorageShim";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readCornAdaptive, unsupportedSlots, type AdaptiveRead } from "../../src/lib/rowCrop/adaptive";
import type { CropState } from "../../src/lib/rowCrop/assess";
import { readRowCrop, type RowCropRead, type RowCropStage } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
import { canvasOf, dashed, drawRead, line, poly, tint, type Rgb } from "./draw";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const revision = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();
const dirty = (() => { try { return execSync("git status --porcelain src/lib/rowCrop").toString().trim() ? "+wip" : ""; } catch { return ""; } })();
const OUT = arg("out", `directtestimagery/benchmark-adaptive-${revision}${dirty}`)!;
const LIMIT = Number(arg("limit", "0"));
const ONLY = (arg("only", "") ?? "").split(",").filter(Boolean);
const DRAW = argv.includes("--draw");
const sets: { name: string; dir: string; stages: RowCropStage[] }[] = [];
argv.forEach((a, i) => { if (a === "--set") { const [name, rest] = argv[i + 1].split("="); const j = rest.lastIndexOf(":"); sets.push({ name, dir: rest.slice(0, j), stages: rest.slice(j + 1).split(",") as RowCropStage[] }); } });
if (!sets.length) sets.push(
  { name: "emergence", dir: "directtestimagery/veryearlystage", stages: ["emergence"] },
  { name: "establishment", dir: "directtestimagery/estabilishmentphase", stages: ["establishment"] },
  { name: "corn2", dir: "directtestimagery/2024corn2/emergence", stages: ["establishment", "emergence"] },
);
const profile = cropProfileFor("corn")!;
const STATE_COL: Record<CropState, Rgb> = { bare: [90, 70, 50], seedlings: [60, 140, 255], rows: [0, 230, 120], canopy: [230, 200, 0], closed: [255, 120, 0], cover: [200, 60, 200], unknown: [160, 160, 160] };
const r1 = (v: number) => Math.round(v * 10) / 10, r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Polylines sampled every `step` pixels: the samples and the length each stands for. */
function samples(lines: [number, number][][], step: number): [number, number][] {
  const out: [number, number][] = [];
  for (const l of lines) for (let i = 0; i + 1 < l.length; i++) { const [ax, ay] = l[i], [bx, by] = l[i + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(L / step)); for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * (k + 0.5)) / n, ay + ((by - ay) * (k + 0.5)) / n]); }
  return out;
}
/** Segment index on a grid, for nearest-distance queries within `reach`. */
function segIndex(lines: [number, number][][], cell: number) {
  const grid = new Map<number, [number, number, number, number][]>(), key = (gx: number, gy: number) => gy * 100003 + gx;
  for (const l of lines) for (let i = 0; i + 1 < l.length; i++) {
    const [ax, ay] = l[i], [bx, by] = l[i + 1];
    for (let gy = Math.floor(Math.min(ay, by) / cell); gy <= Math.floor(Math.max(ay, by) / cell); gy++) for (let gx = Math.floor(Math.min(ax, bx) / cell); gx <= Math.floor(Math.max(ax, bx) / cell); gx++) { const k = key(gx, gy); (grid.get(k) ?? grid.set(k, []).get(k)!).push([ax, ay, bx, by]); }
  }
  return (x: number, y: number): number => {
    let best = Infinity; const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const [ax, ay, bx, by] of grid.get(key(gx + dx, gy + dy)) ?? []) {
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
      best = Math.min(best, Math.hypot(x - ax - t * vx, y - ay - t * vy));
    }
    return best;
  };
}
/** Share of `a`'s length within `tol` of a line of `b`. */
function covered(a: [number, number][][], b: [number, number][][], tol: number, step: number): number | null {
  const s = samples(a, step); if (!s.length) return null;
  const near = segIndex(b, Math.max(tol * 2, 50));
  return s.filter(([x, y]) => near(x, y) <= tol).length / s.length;
}
/** Pairs of rows that run within a third of a pitch of each other for at least a metre: one row drawn twice. */
function duplicates(lines: [number, number][][], pitchPx: number, step: number): number {
  let n = 0;
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const s = samples([lines[i]], step), near = segIndex([lines[j]], Math.max(pitchPx, 50));
    if (s.filter(([x, y]) => near(x, y) < pitchPx / 3).length * step * 2 >= pitchPx * 1.3) n++; // ~1 m at a 76 cm pitch
  }
  return n;
}

function draw(img: PhotoPixels, ad: AdaptiveRead, file: string) {
  const cv = canvasOf(img), t = Math.max(1, Math.round(cv.w / 1800)), a = ad.assessment;
  // Ownership first, faintly: each cell tinted by the state of the plan that owns it, unowned unknown cells hatched.
  a.cells.forEach((c, i) => {
    const o = ad.owner[i];
    if (o < 0) { if (c.state === "unknown") { tint(cv, c.x0, c.y0, c.x1, c.y1, [120, 120, 120], 0.35); for (let d = 0; d < c.x1 - c.x0 + (c.y1 - c.y0); d += Math.max(10, cv.w / 100)) line(cv, c.x0 + Math.min(d, c.x1 - c.x0), c.y0 + Math.max(0, d - (c.x1 - c.x0)), c.x0 + Math.max(0, d - (c.y1 - c.y0)), c.y0 + Math.min(d, c.y1 - c.y0), [200, 200, 200], 0); } return; }
  });
  const asRead = (pi: number): RowCropRead => {
    const base = ad.plans[pi].read!;
    return { ...base, rows: ad.rows.filter(r => r.plan === pi), weeds: ad.weeds.filter(w => w.plan === pi && w.verdict === "weed candidate"), excluded: ad.excluded.filter(e => e.plan === pi), seedlings: base.seedlings ? { ...base.seedlings, points: ad.seedlingPoints } : null, fieldEdge: { ends: ad.fieldEnds.filter(e => e.plan === pi), lines: ad.fieldLines } };
  };
  ad.plans.forEach((p, pi) => { if (p.read) drawRead(cv, asRead(pi)); });
  for (const w of ad.weeds) if (w.verdict === "corn on an unsupported row") poly(cv, w.hull, [255, 190, 0], t, true); else if (w.verdict === "uncertain: no readable rows") poly(cv, w.hull, [200, 200, 200], t, true);
  for (const u of ad.unsupportedRows) dashed(cv, u.line[0][0], u.line[0][1], u.line[1][0], u.line[1][1], [255, 190, 0], t, Math.max(8, cv.w / 120));
  // Plan boundaries: the outline of each plan's owned cells, in its stage's colour.
  const stageCol: Record<RowCropStage, Rgb> = { emergence: STATE_COL.seedlings, establishment: STATE_COL.rows, mid: STATE_COL.canopy, late: STATE_COL.closed };
  a.cells.forEach((c, i) => {
    const o = ad.owner[i]; if (o < 0) return;
    const col = stageCol[ad.plans[o].stage], at = (cc: number, rr: number) => (cc < 0 || rr < 0 || cc >= a.cols || rr >= a.rows ? -2 : ad.owner[rr * a.cols + cc]);
    if (at(c.col - 1, c.row) !== o) line(cv, c.x0, c.y0, c.x0, c.y1, col, t + 1);
    if (at(c.col + 1, c.row) !== o) line(cv, c.x1, c.y0, c.x1, c.y1, col, t + 1);
    if (at(c.col, c.row - 1) !== o) line(cv, c.x0, c.y0, c.x1, c.y0, col, t + 1);
    if (at(c.col, c.row + 1) !== o) line(cv, c.x0, c.y1, c.x1, c.y1, col, t + 1);
  });
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, encodeJpeg({ width: cv.w, height: cv.h, data: cv.c }, 85));
}

const csv = (rows: Record<string, unknown>[]) => { const keys = [...new Set(rows.flatMap(r => Object.keys(r)))]; return [keys.join(","), ...rows.map(r => keys.map(k => { const s = String(r[k] ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(","))].join("\n") + "\n"; };
type Tot = Record<string, number>;
const add = (t: Tot, k: string, v: number | null | undefined) => { if (v != null && Number.isFinite(v)) t[k] = (t[k] ?? 0) + v; };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const md: string[] = [`# Adaptive corn reader against the frozen stage readers`, "", `Code ${revision}${dirty}, run ${new Date().toISOString().slice(0, 16)}. No stage, folder name or pixel size is given to the adaptive reader. Agreement: share of one read's row length that the other's rows run along within a quarter of a pitch.`, ""];
  for (const set of sets) {
    let files = readdirSync(set.dir).filter(f => /\.(jpe?g|png)$/i.test(f)).sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b));
    if (ONLY.length) files = files.filter(f => ONLY.includes(basename(f, extname(f))));
    if (LIMIT) files = files.slice(0, LIMIT);
    const per: Record<string, unknown>[] = [];
    const tot: Record<string, Tot> = { adaptive: {}, ...Object.fromEntries(set.stages.map(s => [s, {}])) };
    const ms: Record<string, number[]> = { adaptive: [], ...Object.fromEntries(set.stages.map(s => [s, [] as number[]])) };
    const plansSeen = new Map<string, number>();
    for (const f of files) {
      const name = basename(f, extname(f));
      const raw = decodeImage(new Uint8Array(readFileSync(join(set.dir, f))));
      const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
      const dbg: string[] = [];
      let ad: AdaptiveRead | null = null, err = "";
      try { ad = readCornAdaptive(px, rowCropParamsFor(profile, null), { debug: l => dbg.push(l) }); } catch (e) { err = String(e); }
      if (argv.includes("--debug")) for (const l of dbg) console.log("   ", l);
      const row: Record<string, unknown> = { photo: name, error: err };
      if (ad) {
        const s = ad.summary, st = s.states, planKey = ad.plans.filter(p => p.read).map(p => `${p.stage}@${ad!.gsdM ? Math.round(p.pitchPx * ad!.gsdM * 100) : "?"}cm:${Math.round(p.ownedShare * 100)}%`).join(" + ") || "none";
        const kind = ad.plans.filter(p => p.read).map(p => p.stage).join("+") || "none";
        plansSeen.set(kind, (plansSeen.get(kind) ?? 0) + 1);
        const pitchPx = ad.gsdM ? 0.762 / ad.gsdM : 200, step = pitchPx / 8;
        const lines = ad.rows.map(r => r.points);
        Object.assign(row, {
          plans: planKey, states: `seed ${Math.round(st.seedlings * 100)} rows ${Math.round(st.rows * 100)} canopy ${Math.round(st.canopy * 100)} closed ${Math.round(st.closed * 100)} cover ${Math.round(st.cover * 100)} unknown ${Math.round(st.unknown * 100)} bare ${Math.round(st.bare * 100)}`,
          dir: ad.directionDeg, pitchesCm: ad.pitchesM.map(p => r1(p * 100)).join("/"),
          rows: s.rows, rowPieces: s.rowPieces, rowLengthM: r1(ad.rows.reduce((u, r) => u + r.lengthM, 0)), rowsDropped: s.rowsDropped, plants: s.plants ?? "", possible: s.possible, missing: s.missing, gaps: s.gaps, weeds: s.weeds, smallGreen: s.smallGreen,
          unsupportedCorn: s.unsupportedRowCorn, unsupportedRows: s.unsupportedRows, uncertainGreen: s.uncertainGreen, uncertainShare: s.uncertainShare, fieldEnds: s.fieldEnds,
          duplicates: duplicates(lines, pitchPx, step), ms: s.ms, assessMs: s.assessMs, readMs: s.readMs,
        });
        const T = tot.adaptive;
        for (const k of ["rows", "rowPieces", "rowLengthM", "plants", "possible", "missing", "gaps", "weeds", "smallGreen", "unsupportedCorn", "fieldEnds", "duplicates", "uncertainGreen"]) add(T, k, Number(row[k]));
        add(T, "assessMs", s.assessMs);
        ms.adaptive.push(s.ms);
        if (DRAW) draw(px, ad, join(OUT, set.name, "pictures", `${name}.jpg`));
        // Each frozen stage reader.
        for (const stage of set.stages) {
          let base: RowCropRead | null = null, berr = "";
          const t0 = Date.now();
          try { base = readRowCrop(px, rowCropParamsFor(profile, null, stage)); } catch (e) { berr = String(e); }
          const wall = Date.now() - t0, p = stage.slice(0, 3) + "_";
          if (!base) { row[p + "error"] = berr; continue; }
          const bl = base.rows.map(r => r.points), bPitch = base.pitchM ? base.pitchM / base.gsdM : pitchPx;
          const typical = (() => { const ds = ad!.assessment.cells.filter(c => c.state === "rows" && c.plantDiamPx != null).map(c => c.plantDiamPx!).sort((u, v) => u - v); return ds.length ? ds[ds.length >> 1] : 0; })();
          const slotWeeds = stage === "establishment" ? unsupportedSlots(base, bPitch, base.directionDeg ?? 0, typical).members.size : 0;
          const bs = base.summary;
          Object.assign(row, {
            [p + "rows"]: bs.rows, [p + "rowLengthM"]: r1(bs.totalRowLengthM), [p + "rowsDropped"]: bs.rowsDropped, [p + "plants"]: bs.plants ?? "", [p + "possible"]: base.emergence?.possible ?? "", [p + "missing"]: base.emergence?.missing ?? "",
            [p + "gaps"]: bs.gaps, [p + "weeds"]: bs.weeds, [p + "smallGreen"]: base.emergence?.smallGreen ?? "", [p + "weedsOnEmptySlots"]: slotWeeds, [p + "fieldEnds"]: base.fieldEdge?.ends.length ?? "",
            [p + "duplicates"]: duplicates(bl, bPitch, bPitch / 8), [p + "ms"]: wall,
            [p + "baseCoveredByAdaptive"]: r3(covered(bl, lines, bPitch / 4, bPitch / 8) ?? NaN), [p + "adaptiveCoveredByBase"]: r3(covered(lines, bl, bPitch / 4, bPitch / 8) ?? NaN),
          });
          const B = tot[stage];
          for (const k of ["rows", "rowLengthM", "plants", "possible", "missing", "gaps", "weeds", "smallGreen", "weedsOnEmptySlots", "fieldEnds", "duplicates"]) add(B, k, Number(row[p + k]));
          // Length-weighted agreement totals.
          add(B, "baseLenCovered", (Number(row[p + "baseCoveredByAdaptive"]) || 0) * bs.totalRowLengthM);
          add(B, "adLenCovered", (Number(row[p + "adaptiveCoveredByBase"]) || 0) * Number(row.rowLengthM));
          ms[stage].push(wall);
        }
      }
      per.push(row);
      console.log(`${set.name} ${name}: ${row.plans ?? "error " + err} | rows ${row.rows} weeds ${row.weeds} unsupported ${row.unsupportedCorn} | ${set.stages.map(s => `${s}: rows ${row[s.slice(0, 3) + "_rows"]} weeds ${row[s.slice(0, 3) + "_weeds"]} covered ${row[s.slice(0, 3) + "_baseCoveredByAdaptive"]}/${row[s.slice(0, 3) + "_adaptiveCoveredByBase"]}`).join(" | ")} | ${row.ms} ms`);
    }
    mkdirSync(join(OUT, set.name), { recursive: true });
    writeFileSync(join(OUT, set.name, "per-photo.csv"), csv(per));
    const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
    const errors = per.filter(r => r.error).length;
    md.push(`## ${set.name}: ${files.length} photographs from ${set.dir}`, "", `Plans chosen: ${[...plansSeen.entries()].map(([k, v]) => `${k} on ${v}`).join(", ")}. Errors: ${errors}.`, "");
    const cols = ["adaptive", ...set.stages];
    md.push(`| Measure | ${cols.join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`);
    for (const k of ["rows", "rowPieces", "rowLengthM", "plants", "possible", "missing", "gaps", "weeds", "smallGreen", "unsupportedCorn", "weedsOnEmptySlots", "uncertainGreen", "fieldEnds", "duplicates"]) md.push(`| ${k} | ${cols.map(c => (tot[c][k] == null ? "-" : r1(tot[c][k]).toLocaleString())).join(" | ")} |`);
    md.push(`| median ms | ${cols.map(c => med(ms[c])).join(" | ")} |`, `| max ms | ${cols.map(c => Math.max(...ms[c])).join(" | ")} |`);
    for (const s of set.stages) md.push(`| ${s} row length the adaptive rows run along | ${r3((tot[s].baseLenCovered ?? 0) / (tot[s].rowLengthM || 1))} |`, `| adaptive row length the ${s} rows run along | ${r3((tot[s].adLenCovered ?? 0) / (tot.adaptive.rowLengthM || 1))} |`);
    md.push("");
    writeFileSync(join(OUT, "summary.md"), md.join("\n") + "\n");
  }
  console.log(`wrote ${join(OUT, "summary.md")}`);
}
main().catch(e => { console.error(e); process.exit(1); });
