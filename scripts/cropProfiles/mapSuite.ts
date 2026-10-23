// The crop-profile benchmark's map suite: corn rows read from a field map and the weed-pressure grade on them, end to
// end through the app's own code (patternRows.readPatternRows, twoStage/stage1.readStage1, pressure/grade.gradePressure),
// on stand-in maps (standInMap.ts): rendered corn stands with known rows and weeds, and the three early-corn photos.
// No real corn field map exists here yet; that is the test still owed.
import "../bench/nodeStorageShim";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng } from "../bench/images";
import { analysePhoto, type PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readPatternRows } from "../../src/lib/weedVision/patternRows";
import type { FieldRows } from "../../src/lib/weedVision/fieldRows";
import { DEFAULT_STAGE1, readStage1 } from "../../src/lib/weedVision/twoStage/stage1";
import { drawnBandOf, gradePressure } from "../../src/lib/weedVision/pressure/grade";
import { PRESSURE_CELL_M, canopyClosedOf, pressureRefusal } from "../../src/lib/weedVision/pressure/pressureStore";
import { type StandInMap, standInMap } from "./standInMap";

export type MapRun = {
  name: string;
  rowsFound: boolean;
  rows: number;
  spacingCm: number | null;
  /** Synthetic only: share of row lines whose mean distance to a true row is under a quarter pitch. */
  linesOnCrop: number | null;
  /** Green (ExGR above zero) on the row lines over the middle of the alleys. Above 1: on the crop. */
  onGreenRatio: number | null;
  refusedUnconfirmed: boolean;
  gradedWhenConfirmed: boolean;
  readGsdCm: number | null;
  cells: number;
  assessed: number;
  fieldCover: number | null;
  fieldClass: string | null;
  /** Synthetic only: weed pixels over the ground more than the band from a true row. */
  truthCover: number | null;
  ms: number;
};

const exgr = (r: number, g: number, b: number) => { const s = r + g + b; return s ? (4 * g - 1.4 * r) / s - 1 : -1; };

/** Frame pixel of the rows to map pixel of the stand-in raster. */
const toMap = (rows: FieldRows, m: StandInMap) => { const k = 2 ** (m.raster.z - rows.z); return (x: number, y: number) => ({ x: (rows.left + x) * k - m.raster.left, y: (rows.top + y) * k - m.raster.top }); };

function linesInMap(rows: FieldRows, m: StandInMap) {
  const t = toMap(rows, m);
  return rows.ctx.lines.map(l => { const a = t(l.x1, l.y1), b = t(l.x2, l.y2); const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1; return { a, b, nx: -dy / L, ny: dx / L }; });
}

function onGreen(rows: FieldRows, m: StandInMap): number | null {
  const lines = linesInMap(rows, m);
  const pitchPx = rows.spacingM / m.mpp;
  if (!lines.length || !(pitchPx > 2)) return null;
  let onN = 0, onG = 0, midN = 0, midG = 0;
  const R = m.raster;
  for (let y = 0; y < R.height; y += 2) for (let x = 0; x < R.width; x += 2) {
    let d = Infinity; for (const l of lines) d = Math.min(d, Math.abs((x - l.a.x) * l.nx + (y - l.a.y) * l.ny));
    if (d > pitchPx) continue;
    const o = (y * R.width + x) * 4, g = exgr(R.rgba[o], R.rgba[o + 1], R.rgba[o + 2]) > 0;
    if (d <= pitchPx / 8) { onN++; if (g) onG++; } else if (d >= (3 * pitchPx) / 8) { midN++; if (g) midG++; }
  }
  return onN && midN ? (onG / onN) / Math.max(1e-3, midG / midN) : null;
}

/** Map pixel to the source image's ground metres (x right, y up from its top-left), for scenes with truth. */
const sourceGround = (m: StandInMap, gsdM: number) => (x: number, y: number) => ({ x: x * (m.mpp / gsdM) * gsdM, y: -y * (m.mpp / gsdM) * gsdM });

export async function runMap(name: string, px: PhotoPixels, gsdM: number, opts: { truth?: { acrossToRow: (x: number, y: number) => number; pitchM: number; layer: Uint8Array; width: number; bandM: number }; picture?: string } = {}): Promise<MapRun> {
  const t0 = Date.now();
  const m = standInMap(px, gsdM);
  const { rows } = await readPatternRows({ rings: [m.ring], tile: () => "", maxNative: m.maxNative, crop: "corn", fetch: m.fetch, analyse: (r, p) => analysePhoto(r, p, { yieldBetweenWindows: false }) });
  const out: MapRun = { name, rowsFound: !!rows, rows: rows?.rows ?? 0, spacingCm: rows ? Math.round(rows.spacingM * 1000) / 10 : null, linesOnCrop: null, onGreenRatio: null, refusedUnconfirmed: false, gradedWhenConfirmed: false, readGsdCm: null, cells: 0, assessed: 0, fieldCover: null, fieldClass: null, truthCover: null, ms: 0 };
  if (opts.truth) {
    // Truth cover: weed pixels over the ground more than the band from a true row, in the source image.
    const T = opts.truth; let ground = 0, weed = 0;
    for (let i = 0; i < T.layer.length; i++) { const x = (i % T.width + 0.5) * gsdM, y = -(Math.floor(i / T.width) + 0.5) * gsdM; if (Math.abs(T.acrossToRow(x, y)) <= T.bandM) continue; ground++; if (T.layer[i] === 2) weed++; }
    out.truthCover = ground ? weed / ground : null;
  }
  if (!rows) { out.ms = Date.now() - t0; return out; }
  out.onGreenRatio = onGreen(rows, m);
  if (opts.truth) {
    const g = sourceGround(m, gsdM);
    const on = linesInMap(rows, m).map(l => { let s = 0; for (let k = 0; k <= 10; k++) { const p = g(l.a.x + ((l.b.x - l.a.x) * k) / 10, l.a.y + ((l.b.y - l.a.y) * k) / 10); s += Math.abs(opts.truth!.acrossToRow(p.x, p.y)); } return s / 11 < opts.truth!.pitchM / 4; });
    out.linesOnCrop = on.filter(Boolean).length / on.length;
  }
  out.refusedUnconfirmed = /^Confirm the corn rows first/.test(pressureRefusal("corn", rows, { rowsConfirmed: false }) ?? "");
  out.gradedWhenConfirmed = pressureRefusal("corn", rows, { rowsConfirmed: true }) === null;
  const st = await readStage1({ rings: [m.ring], tile: () => "", maxNative: m.maxNative, lat: m.lat, rows, params: { ...DEFAULT_STAGE1, cellM: PRESSURE_CELL_M, readMpp: 0.03 }, draw: m.draw as never });
  if (st) {
    const gr = gradePressure({ objects: [], grid: st.grid, cells: st.cells, rows, crop: "corn", canopyClosed: canopyClosedOf(st.cells), photoBased: false });
    Object.assign(out, { readGsdCm: Math.round(st.grid.mpp * 1000) / 10, cells: gr.summary.cells, assessed: gr.summary.assessed, fieldCover: Math.round(gr.summary.fieldCover * 1000) / 1000, fieldClass: gr.summary.fieldClass });
    if (opts.picture) drawGrade(m, rows, gr, st.grid, opts.picture);
  }
  out.ms = Date.now() - t0;
  return out;
}

/** The stand-in map with the corn rows (cyan) and the grade's cells tinted by the band the app draws. */
function drawGrade(m: StandInMap, rows: FieldRows, gr: ReturnType<typeof gradePressure>, g: { z: number; left: number; top: number; cellPx: number }, file: string) {
  const R = m.raster, c = new Uint8Array(R.width * R.height * 4);
  for (let i = 0; i < R.width * R.height; i++) { c[i * 4] = R.rgba[i * 4] * 0.8; c[i * 4 + 1] = R.rgba[i * 4 + 1] * 0.8; c[i * 4 + 2] = R.rgba[i * 4 + 2] * 0.8; c[i * 4 + 3] = 255; }
  const col: Record<string, [number, number, number]> = { low: [74, 222, 128], medium: [250, 204, 21], high: [239, 68, 68] };
  const k = 2 ** (R.z - g.z), cell = g.cellPx * k;
  for (const cl of gr.cells) {
    if (!cl.assessed || cl.klass === "none") continue;
    const b = drawnBandOf(cl); if (b === "none") continue;
    const x0 = (g.left + cl.i * g.cellPx) * k - R.left, y0 = (g.top + cl.j * g.cellPx) * k - R.top;
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(R.height, y0 + cell); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(R.width, x0 + cell); x++) {
      const o = (y * R.width + x) * 4; for (let j = 0; j < 3; j++) c[o + j] = c[o + j] * 0.6 + col[b][j] * 0.4;
    }
  }
  for (const l of linesInMap(rows, m)) {
    const n = Math.ceil(Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y));
    for (let s = 0; s <= n; s++) { const x = Math.round(l.a.x + ((l.b.x - l.a.x) * s) / n), y = Math.round(l.a.y + ((l.b.y - l.a.y) * s) / n); for (let d = -1; d <= 1; d++) for (const [px, py] of [[x + d, y], [x, y + d]]) if (px >= 0 && py >= 0 && px < R.width && py < R.height) { const o = (py * R.width + px) * 4; c[o] = 0; c[o + 1] = 230; c[o + 2] = 255; } }
  }
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, encodePng({ width: R.width, height: R.height, data: c }));
}
