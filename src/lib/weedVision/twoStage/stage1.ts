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
import { type FieldRows, coverMask, fieldReadPlan, vegetationMask } from "../fieldRows";
import { convexHull } from "../hotspots";
import { PAINT_CROWN_MARGIN_M, rowBandMask, rowsForGround } from "../layout/rowBand";

export { fillConvex, fillDisc, rowBandMask } from "../layout/rowBand";
import { TILE_PX, latLngOfPx } from "../mapRun";

export type Stage1Params = {
  version: string;
  /** Cell edge, metres. */
  cellM: number;
  /** A cell is a hotspot candidate at this share of off-row green or more... */
  pressureMin: number;
  /** ...or at this many off-row green blobs per m² or more (small scattered weeds carry little area but many blobs). */
  densityMin: number;
  /** A blob counts from this area, m². */
  blobMinM2: number;
  /** A candidate area is high priority at this size, m², or this mean pressure. Same as the benchmark's truth definition. */
  highPriorityAreaM2: number;
  highPriorityPressure: number;
  /** Uncertain when less of the cell than this is imaged... */
  minImagedShare: number;
  /** ...when the crop row band leaves less of it than this to judge (share of the imaged cell off the band)... */
  minOffBandShare: number;
  /** ...or when more of it than this is in deep shadow. */
  maxDarkShare: number;
  /** A pixel darker than this (0.299 R + 0.587 G + 0.114 B) is deep shadow. */
  darkLuma: number;
  /** A cell farther than this many row spacings from every row line read is "no rows": the rows say nothing there. */
  rowReachSpacings: number;
  /**
   * What counts as off-row pressure: "cover" (any cover against bare ground, straw and shadowed soil: fieldRows.ts
   * coverMask) or "vegetation" (green plants only, the mask's fixed zero, which rejects yellowish cover on purpose).
   * Cover since 2026-10-21: a cell full of drying yellow-green weeds read as low under the vegetation mask.
   */
  mask: "cover" | "vegetation";
  /** Read the map at about this many metres per pixel; absent: fieldReadPlan's READ_MPP (about 4 cm). A crop profile sets it finer; 0 is the finest the map has. */
  readMpp?: number;
  /** The most pixels one read may cover; a finer zoom past it gives way to the one above (fieldReadPlan). */
  maxReadPixels?: number;
  /**
   * A green patch of at least this many pixels counts toward a cell's density even when smaller than blobMinM2: on a
   * fine read the smallest weed the imagery can show, not the 4 cm read's floor. Absent: blobMinM2 alone.
   */
  blobMinPx?: number;
};

export const DEFAULT_STAGE1: Stage1Params = {
  version: "stage1-v1",
  cellM: 2,
  pressureMin: 0.05,
  densityMin: 1,
  blobMinM2: 0.003,
  highPriorityAreaM2: 25,
  highPriorityPressure: 0.25,
  minImagedShare: 0.8,
  minOffBandShare: 0.15,
  maxDarkShare: 0.25,
  darkLuma: 50,
  rowReachSpacings: 1,
  mask: "cover",
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
  /** Green share of the imaged ground off the crop rows (the band and crowns out of the denominator too): the pressure estimate. */
  pressure: number;
  /** Off-row green blobs per m² of off-band ground: the density estimate. */
  density: number;
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
export type CellCounts = { imaged: Int32Array; green: Int32Array; greenInBand: Int32Array; band: Int32Array; dark: Int32Array; blobs: Int32Array; /** 1 where the read rows reach the cell (rowReach); absent = everywhere. */ reached?: Uint8Array };
export const emptyCounts = (g: GridFrame): CellCounts => {
  const n = g.nx * g.ny;
  return { imaged: new Int32Array(n), green: new Int32Array(n), greenInBand: new Int32Array(n), band: new Int32Array(n), dark: new Int32Array(n), blobs: new Int32Array(n) };
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
export function accumulate(counts: CellCounts, g: GridFrame, px: PhotoPixels, fx: number, fy: number, band: Uint8Array | null, darkLuma: number, blobMinPx = 1, mask: Stage1Params["mask"] = "cover"): void {
  const { width: w, height: h, rgba } = px;
  const green = mask === "cover" ? coverMask(px) : vegetationMask(px);
  // Off-row green blobs, each counted in the cell of its centre (a blob cut by the raster's edge counts in each part).
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!green[s] || (band && band[s]) || seen[s] || rgba[s * 4 + 3] === 0) continue;
    seen[s] = 1; stack.push(s);
    let n = 0, sx = 0, sy = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i - x) / w;
      n++; sx += x; sy += y;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (green[j] && !(band && band[j]) && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (n < blobMinPx) continue;
    const ci = Math.floor((fx + sx / n) / g.cellPx), cj = Math.floor((fy + sy / n) / g.cellPx);
    if (ci >= 0 && cj >= 0 && ci < g.nx && cj < g.ny) counts.blobs[cj * g.nx + ci]++;
  }
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
    const offBand = Math.max(1, imaged - (rowsUsed ? counts.band[c] : 0));
    const offBandM2 = offBand * g.mpp * g.mpp;
    const rowsHere = rowsUsed && (!counts.reached || counts.reached[c] === 1);
    const cell: Stage1Cell = {
      i, j, key: cellKey(i, j), centre, ring: [ll(X0, Y0), ll(X1, Y0), ll(X1, Y1), ll(X0, Y1)],
      imagedShare: imaged / (g.cellPx * g.cellPx),
      greenShare: counts.green[c] / imaged,
      bandShare: counts.band[c] / imaged,
      darkShare: counts.dark[c] / imaged,
      pressure: offRowGreen / offBand,
      density: counts.blobs[c] / offBandM2,
      offRowGreenM2: offRowGreen * g.mpp * g.mpp,
      uncertain: [],
    };
    if (!rowsHere) cell.uncertain.push("no rows");
    if (cell.imagedShare < params.minImagedShare) cell.uncertain.push("partly imaged");
    if (rowsUsed && 1 - cell.bandShare < params.minOffBandShare) cell.uncertain.push("mostly crop row");
    if (cell.darkShare > params.maxDarkShare) cell.uncertain.push("shadow");
    cells.push(cell);
    byKey.set(cell.key, cell);
  }
  // Candidates: 8-connected cells at or over the pressure floor, or the density floor.
  const hot = (c: Stage1Cell) => c.pressure >= params.pressureMin || c.density >= params.densityMin;
  const seen = new Set<string>();
  const hotspots: Stage1Hotspot[] = [];
  for (const cell of cells) {
    if (!hot(cell) || seen.has(cell.key)) continue;
    const group: Stage1Cell[] = [];
    const stack = [cell];
    seen.add(cell.key);
    while (stack.length) {
      const cur = stack.pop()!;
      group.push(cur);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const n = byKey.get(cellKey(cur.i + dx, cur.j + dy));
        if (n && !seen.has(n.key) && hot(n)) { seen.add(n.key); stack.push(n); }
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

/** The smallest green patch, in pixels, that counts toward a cell's density at this read's pixel. */
export function blobFloorPx(params: Pick<Stage1Params, "blobMinM2" | "blobMinPx">, mpp: number): number {
  const byArea = Math.max(1, Math.round(params.blobMinM2 / (mpp * mpp)));
  return params.blobMinPx ? Math.max(1, Math.min(byArea, params.blobMinPx)) : byArea;
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
  const plan = fieldReadPlan(input.rings, input.maxNative, input.lat, params.readMpp, params.maxReadPixels);
  if (!plan) return null;
  const g = gridFor(plan, params.cellM);
  const counts = emptyCounts(g);
  if (input.rows) counts.reached = rowReach(g, input.rows, params.rowReachSpacings);
  const draw = input.draw ?? drawMapRect;
  // The crop taken out as the model's input takes it out (the crowns with their margin, so a crown's rim is not
  // pressure), except where the layout only expects a plant: there it is cut small (layout/rowBand.ts, groundCutPx).
  const ground = input.rows ? rowsForGround(input.rows, PAINT_CROWN_MARGIN_M / input.rows.mpp) : null;
  for (let k = 0; k < plan.tiles.length; k++) {
    if (input.signal?.aborted) return null;
    const t = plan.tiles[k];
    const w = t.x1 - t.x0, h = t.y1 - t.y0;
    const px = await draw(input.tile, g.z, g.left + t.x0, g.top + t.y0, w, h, input.signal);
    if (!px) { if (input.signal?.aborted) return null; continue; }
    const band = ground ? rowBandMask(ground, g.z, g.left + t.x0, g.top + t.y0, w, h) : null;
    accumulate(counts, g, px, t.x0, t.y0, band, params.darkLuma, blobFloorPx(params, plan.mpp), params.mask ?? "cover");
    input.onProgress?.((k + 1) / plan.tiles.length);
    await new Promise(res => setTimeout(res, 0));
  }
  return finishStage1(g, counts, input.rings, !!input.rows, params, performance.now() - t0);
}
