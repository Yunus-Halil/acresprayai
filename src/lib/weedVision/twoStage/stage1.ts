// Stage 1 of the two-stage prototype: weed pressure on a cell grid, read from
// the field map with the crop rows taken out, in seconds on the CPU.
//
// Per cell (CELL_M, 2 m): the share of the imaged ground that is green and not
// on a crop row or crop plant (the field's rows, fieldRows.ts). That is
// vegetation pressure between the rows, not weeds: it cannot tell a weed from
// a cover crop, sees nothing inside the row, and reads every green pixel in a
// field without rows. So every cell also carries the reasons it is uncertain,
// and connected cells over the pressure floor become hotspot candidates for
// Stage 2 to inspect with the model. No plants, no polygons per plant.
//
// The grid lives in global Web Mercator pixels at the zoom the rows are read
// at (fieldReadPlan, about 4 to 6 cm): cell (i, j) covers x in
// [left + i * cellPx, left + (i + 1) * cellPx), the same for y. Investigation
// and evaluation plan: docs/features/two-stage-weed-intelligence.md.
import { type LatLng2, pointInRing } from "../../geo";
import type { PhotoPixels } from "../../photoScout/pattern";
import { fetchTileCached } from "../../tileCache";
import { type FieldRows, fieldReadPlan, vegetationMask } from "../fieldRows";
import { convexHull } from "../hotspots";
import { rowBandMask } from "../layout/rowBand";

export { fillConvex, fillDisc, rowBandMask } from "../layout/rowBand";
import { TILE_PX, latLngOfPx } from "../mapRun";

export type Stage1Params = {
  version: string;
  /** Cell edge, metres. */
  cellM: number;
  /** A cell is a hotspot candidate at this share of off-row green or more. */
  pressureMin: number;
  /** A candidate area is high priority at this size, m², or this mean pressure. Same as the benchmark's truth definition. */
  highPriorityAreaM2: number;
  highPriorityPressure: number;
  /** Uncertain when less of the cell than this is imaged... */
  minImagedShare: number;
  /** ...when the crop row band covers more of it than this (too little ground between the rows to judge)... */
  maxBandShare: number;
  /** ...or when more of it than this is in deep shadow. */
  maxDarkShare: number;
  /** A pixel darker than this (0.299 R + 0.587 G + 0.114 B) is deep shadow. */
  darkLuma: number;
  /** A cell farther than this many row spacings from every row line read is "no rows": the rows say nothing there. */
  rowReachSpacings: number;
};

export const DEFAULT_STAGE1: Stage1Params = {
  version: "stage1-v1",
  cellM: 2,
  pressureMin: 0.05,
  highPriorityAreaM2: 25,
  highPriorityPressure: 0.25,
  minImagedShare: 0.8,
  maxBandShare: 0.6,
  maxDarkShare: 0.25,
  darkLuma: 50,
  rowReachSpacings: 1,
};

export type UncertainReason = "no rows" | "partly imaged" | "mostly crop row" | "shadow";

export type GridFrame = { z: number; left: number; top: number; mpp: number; cellPx: number; nx: number; ny: number };

export type Stage1Cell = {
  i: number; j: number;
  key: string;
  centre: LatLng2;
  /** Corners NW, NE, SE, SW. */
  ring: LatLng2[];
  imagedShare: number;
  /** Green share of the imaged ground, rows included. */
  greenShare: number;
  /** Share of the imaged ground under the crop row band. */
  bandShare: number;
  darkShare: number;
  /** Green share of the imaged ground off the crop rows: the pressure estimate. */
  pressure: number;
  /** Estimated off-row green, m². */
  offRowGreenM2: number;
  uncertain: UncertainReason[];
};

export type Stage1Hotspot = {
  id: string;
  cells: string[];
  ring: LatLng2[];
  centre: LatLng2;
  areaM2: number;
  offRowGreenM2: number;
  meanPressure: number;
  highPriority: boolean;
};

export type Stage1Result = {
  params: Stage1Params;
  grid: GridFrame;
  /** Cells inside the field with any imagery, row-major. */
  cells: Stage1Cell[];
  hotspots: Stage1Hotspot[];
  rowsUsed: boolean;
  ms: number;
  summary: { cells: number; candidates: number; highPriority: number; flaggedShare: number; uncertainShare: number; reasons: Record<UncertainReason, number> };
};

export const cellKey = (i: number, j: number) => `${i}:${j}`;
export const gridKeyOf = (g: GridFrame) => `z${g.z}|${g.left}|${g.top}|c${g.cellPx}`;

/** The grid over the field's read plan. */
export function gridFor(plan: { z: number; left: number; top: number; width: number; height: number; mpp: number }, cellM: number): GridFrame {
  const cellPx = Math.max(4, Math.round(cellM / plan.mpp));
  return { z: plan.z, left: plan.left, top: plan.top, mpp: plan.mpp, cellPx, nx: Math.ceil(plan.width / cellPx), ny: Math.ceil(plan.height / cellPx) };
}

/** The cell holding a point, or null outside the grid. */
export function cellAt(g: GridFrame, X: number, Y: number): { i: number; j: number } | null {
  const i = Math.floor((X - g.left) / g.cellPx), j = Math.floor((Y - g.top) / g.cellPx);
  return i >= 0 && j >= 0 && i < g.nx && j < g.ny ? { i, j } : null;
}

// ------------------------------------------------------------- accumulation

/** Raw per-cell pixel counts, row-major over the grid. */
export type CellCounts = { imaged: Int32Array; green: Int32Array; greenInBand: Int32Array; band: Int32Array; dark: Int32Array; /** 1 where the read rows reach the cell (rowReach); absent = everywhere. */ reached?: Uint8Array };
export const emptyCounts = (g: GridFrame): CellCounts => {
  const n = g.nx * g.ny;
  return { imaged: new Int32Array(n), green: new Int32Array(n), greenInBand: new Int32Array(n), band: new Int32Array(n), dark: new Int32Array(n) };
};

/**
 * The cells the read rows say something about: centre within `spacings` row spacings of a row line. Rows read in one
 * block of a field say nothing about the rest of it; there the off-row green is every green, trees and hedges
 * included (an orchard frame with rows read in one block flagged its hedgerow block as confident pressure).
 */
export function rowReach(g: GridFrame, rows: FieldRows, spacings: number): Uint8Array {
  const out = new Uint8Array(g.nx * g.ny);
  const f = 2 ** (rows.z - g.z);
  const reach = (spacings * rows.spacingM) / rows.mpp;
  const lines = rows.ctx.lines;
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const x = (g.left + (i + 0.5) * g.cellPx) * f - rows.left, y = (g.top + (j + 0.5) * g.cellPx) * f - rows.top;
    for (const l of lines) {
      const dx = l.x2 - l.x1, dy = l.y2 - l.y1, len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - l.x1) * dx + (y - l.y1) * dy) / len2)) : 0;
      if (Math.hypot(x - (l.x1 + t * dx), y - (l.y1 + t * dy)) <= reach) { out[j * g.nx + i] = 1; break; }
    }
  }
  return out;
}

/** Add one raster's pixels to the counts. `fx, fy` is the raster's top-left in grid frame pixels (relative to left, top). */
export function accumulate(counts: CellCounts, g: GridFrame, px: PhotoPixels, fx: number, fy: number, band: Uint8Array | null, darkLuma: number): void {
  const { width: w, height: h, rgba } = px;
  const green = vegetationMask(px);
  for (let y = 0; y < h; y++) {
    const cj = Math.floor((fy + y) / g.cellPx);
    if (cj < 0 || cj >= g.ny) continue;
    for (let x = 0; x < w; x++) {
      const p = y * w + x, o = p * 4;
      if (rgba[o + 3] === 0) continue;
      const ci = Math.floor((fx + x) / g.cellPx);
      if (ci < 0 || ci >= g.nx) continue;
      const c = cj * g.nx + ci;
      counts.imaged[c]++;
      const inBand = band ? band[p] === 1 : false;
      if (inBand) counts.band[c]++;
      if (green[p]) { counts.green[c]++; if (inBand) counts.greenInBand[c]++; }
      if (0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2] < darkLuma) counts.dark[c]++;
    }
  }
}

// ------------------------------------------------------------- the cells and candidates

/** Cells, candidates and summary from the counts. Pure. */
export function finishStage1(g: GridFrame, counts: CellCounts, rings: LatLng2[][], rowsUsed: boolean, params: Stage1Params = DEFAULT_STAGE1, ms = 0): Stage1Result {
  const ll = (X: number, Y: number) => latLngOfPx(X, Y, g.z);
  const cellM2 = (g.cellPx * g.mpp) ** 2;
  const cells: Stage1Cell[] = [];
  const byKey = new Map<string, Stage1Cell>();
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const c = j * g.nx + i;
    const imaged = counts.imaged[c];
    if (!imaged) continue;
    const X0 = g.left + i * g.cellPx, Y0 = g.top + j * g.cellPx, X1 = X0 + g.cellPx, Y1 = Y0 + g.cellPx;
    const centre = ll((X0 + X1) / 2, (Y0 + Y1) / 2);
    if (rings.length && !rings.some(r => pointInRing(centre, r))) continue;
    const offRowGreen = counts.green[c] - (rowsUsed ? counts.greenInBand[c] : 0);
    const rowsHere = rowsUsed && (!counts.reached || counts.reached[c] === 1);
    const cell: Stage1Cell = {
      i, j, key: cellKey(i, j), centre, ring: [ll(X0, Y0), ll(X1, Y0), ll(X1, Y1), ll(X0, Y1)],
      imagedShare: imaged / (g.cellPx * g.cellPx),
      greenShare: counts.green[c] / imaged,
      bandShare: counts.band[c] / imaged,
      darkShare: counts.dark[c] / imaged,
      pressure: offRowGreen / imaged,
      offRowGreenM2: offRowGreen * g.mpp * g.mpp,
      uncertain: [],
    };
    if (!rowsHere) cell.uncertain.push("no rows");
    if (cell.imagedShare < params.minImagedShare) cell.uncertain.push("partly imaged");
    if (rowsUsed && cell.bandShare > params.maxBandShare) cell.uncertain.push("mostly crop row");
    if (cell.darkShare > params.maxDarkShare) cell.uncertain.push("shadow");
    cells.push(cell);
    byKey.set(cell.key, cell);
  }
  // Candidates: 8-connected cells at or over the pressure floor.
  const seen = new Set<string>();
  const hotspots: Stage1Hotspot[] = [];
  for (const cell of cells) {
    if (cell.pressure < params.pressureMin || seen.has(cell.key)) continue;
    const group: Stage1Cell[] = [];
    const stack = [cell];
    seen.add(cell.key);
    while (stack.length) {
      const cur = stack.pop()!;
      group.push(cur);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const n = byKey.get(cellKey(cur.i + dx, cur.j + dy));
        if (n && !seen.has(n.key) && n.pressure >= params.pressureMin) { seen.add(n.key); stack.push(n); }
      }
    }
    const corners: [number, number][] = group.flatMap(q => [[q.i, q.j], [q.i + 1, q.j], [q.i + 1, q.j + 1], [q.i, q.j + 1]] as [number, number][]);
    const hull = convexHull(corners);
    const ci = corners.reduce((s, p) => s + p[0], 0) / corners.length, cj = corners.reduce((s, p) => s + p[1], 0) / corners.length;
    const areaM2 = group.length * cellM2;
    const meanPressure = group.reduce((s, q) => s + q.pressure, 0) / group.length;
    hotspots.push({
      id: `${params.version}:${Math.min(...group.map(q => q.i))}:${Math.min(...group.map(q => q.j))}`,
      cells: group.map(q => q.key),
      ring: hull.map(([x, y]) => ll(g.left + x * g.cellPx, g.top + y * g.cellPx)),
      centre: ll(g.left + ci * g.cellPx, g.top + cj * g.cellPx),
      areaM2,
      offRowGreenM2: group.reduce((s, q) => s + q.offRowGreenM2, 0),
      meanPressure,
      highPriority: areaM2 >= params.highPriorityAreaM2 || meanPressure >= params.highPriorityPressure,
    });
  }
  hotspots.sort((a, b) => Number(b.highPriority) - Number(a.highPriority) || b.offRowGreenM2 - a.offRowGreenM2);
  const reasons: Record<UncertainReason, number> = { "no rows": 0, "partly imaged": 0, "mostly crop row": 0, shadow: 0 };
  for (const c of cells) for (const r of c.uncertain) reasons[r]++;
  const flagged = hotspots.reduce((s, h) => s + h.cells.length, 0);
  return {
    params, grid: g, cells, hotspots, rowsUsed, ms,
    summary: {
      cells: cells.length, candidates: hotspots.length, highPriority: hotspots.filter(h => h.highPriority).length,
      flaggedShare: cells.length ? flagged / cells.length : 0,
      uncertainShare: cells.length ? cells.filter(c => c.uncertain.length).length / cells.length : 0,
      reasons,
    },
  };
}

// ------------------------------------------------------------- browser

/** A rectangle of the map at zoom z, global pixels, drawn from its tiles through the tile cache; null when the browser cannot draw. */
export async function drawMapRect(tile: (z: number, x: number, y: number) => string, z: number, gx: number, gy: number, w: number, h: number, signal?: AbortSignal): Promise<PhotoPixels | null> {
  if (typeof createImageBitmap === "undefined") return null;
  const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = (canvas as HTMLCanvasElement).getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  if (!ctx) return null;
  const jobs: Promise<void>[] = [];
  for (let ty = Math.floor(gy / TILE_PX); ty <= Math.floor((gy + h - 1) / TILE_PX); ty++) {
    for (let tx = Math.floor(gx / TILE_PX); tx <= Math.floor((gx + w - 1) / TILE_PX); tx++) {
      jobs.push(fetchTileCached(tile(z, tx, ty), { signal })
        .then(b => createImageBitmap(b))
        .then(bmp => { ctx.drawImage(bmp, tx * TILE_PX - gx, ty * TILE_PX - gy); bmp.close?.(); })
        .catch(() => { /* a missing tile stays transparent */ }));
    }
  }
  await Promise.all(jobs);
  if (signal?.aborted) return null;
  return { width: w, height: h, rgba: ctx.getImageData(0, 0, w, h).data };
}

/** Stage 1 over the field: the map read in the row reader's tiles, the rows' band taken out. */
export async function readStage1(input: {
  rings: LatLng2[][]; tile: (z: number, x: number, y: number) => string; maxNative: number; lat: number; rows: FieldRows | null;
  params?: Stage1Params; onProgress?: (fraction: number) => void; signal?: AbortSignal;
  /** For tests: the map drawn without a browser. */
  draw?: typeof drawMapRect;
}): Promise<Stage1Result | null> {
  const t0 = performance.now();
  const params = input.params ?? DEFAULT_STAGE1;
  const plan = fieldReadPlan(input.rings, input.maxNative, input.lat);
  if (!plan) return null;
  const g = gridFor(plan, params.cellM);
  const counts = emptyCounts(g);
  if (input.rows) counts.reached = rowReach(g, input.rows, params.rowReachSpacings);
  const draw = input.draw ?? drawMapRect;
  for (let k = 0; k < plan.tiles.length; k++) {
    if (input.signal?.aborted) return null;
    const t = plan.tiles[k];
    const w = t.x1 - t.x0, h = t.y1 - t.y0;
    const px = await draw(input.tile, g.z, g.left + t.x0, g.top + t.y0, w, h, input.signal);
    if (!px) { if (input.signal?.aborted) return null; continue; }
    const band = input.rows ? rowBandMask(input.rows, g.z, g.left + t.x0, g.top + t.y0, w, h) : null;
    accumulate(counts, g, px, t.x0, t.y0, band, params.darkLuma);
    input.onProgress?.((k + 1) / plan.tiles.length);
    await new Promise(res => setTimeout(res, 0));
  }
  return finishStage1(g, counts, input.rings, !!input.rows, params, performance.now() - t0);
}
