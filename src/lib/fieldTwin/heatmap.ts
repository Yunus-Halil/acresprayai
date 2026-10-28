// The weed-pressure heatmap: a raster in the field's own frame (metres along and across the rows), one value per
// pixel interpolated between the measured pressure cells, coloured on fixed bands. Built once per twin, drawn with
// one transformed drawImage per frame, so the field view costs the same whether the field holds ten weeds or a
// million.
//
// What a pixel means: the verified weed cover, as a percent of the observable ground, interpolated (bilinear)
// between the centres of the four nearest OBSERVED cells. A pixel whose own cell no photograph saw is transparent
// (the ground shows through, hatched as "not observed"); a pixel whose cell is mostly under canopy is painted in
// the canopy tone, not in a pressure colour. Nothing is smoothed beyond the interpolation between neighbours.
//
// Two scales. "fixed": the same cover is the same colour on every field (the bands of intelligence.ts). "field":
// the stops are raised to this field's own distribution of cover (its 50th, 80th, 95th and 99th percentiles over
// the observed, non-canopy cells of the crop block; the headland cells beyond it would only drag the percentiles
// down), so on a field where everything is above the top fixed band the colour still spreads from this field's
// ordinary ground to its few worst spots. A stop is never lowered below the fixed band,
// so a clean field never shows a red spot at 0.3 % cover. The legend always prints the real cover at each stop.
import type { FieldIntelligence, PressureCell } from "./intelligence";

/** Colour stops on verified cover percent of observable ground (fixed, the pressure bands of intelligence.ts). */
export const HEAT_STOPS: { pct: number; rgb: [number, number, number]; alpha: number; label: string }[] = [
  { pct: 0, rgb: [74, 128, 78], alpha: 0.32, label: "none" },
  { pct: 0.5, rgb: [141, 165, 66], alpha: 0.45, label: "low" },
  { pct: 1.5, rgb: [232, 164, 52], alpha: 0.62, label: "moderate" },
  { pct: 4, rgb: [236, 96, 44], alpha: 0.76, label: "high" },
  { pct: 8, rgb: [204, 44, 36], alpha: 0.85, label: "severe" },
];
/** Ground under tree canopy: not observable, drawn in the crop's own tone. */
export const CANOPY_RGBA: [number, number, number, number] = [96, 122, 98, 110];

export type HeatScaleMode = "field" | "fixed";
export type HeatScale = {
  mode: HeatScaleMode;
  /** The cover percent at each colour stop (HEAT_STOPS order). */
  stops: number[];
  /** This field's cover percentiles over the block's observed, non-canopy cells (50, 80, 95, 99), or null without cells. */
  quantiles: [number, number, number, number] | null;
  /** True when at least one stop sits above its fixed band: the colours were spread to this field. */
  stretched: boolean;
};

const FIELD_QUANTILES = [0.5, 0.8, 0.95, 0.99];

/** The colour scale for a field: the fixed bands, or the bands raised to the field's own distribution of cover. */
export function heatScaleFor(intel: FieldIntelligence, mode: HeatScaleMode): HeatScale {
  const fixed = HEAT_STOPS.map(st => st.pct);
  const values: number[] = [];
  for (const c of intel.grid.cells) if (c.inBlock && c.observable > 0 && !c.canopy) values.push(c.coverPct);
  if (!values.length) return { mode, stops: fixed, quantiles: null, stretched: false };
  values.sort((a, b) => a - b);
  const q = FIELD_QUANTILES.map(f => values[Math.min(values.length - 1, Math.floor(f * (values.length - 1)))]) as [number, number, number, number];
  if (mode === "fixed") return { mode, stops: fixed, quantiles: q, stretched: false };
  const stops = fixed.slice();
  // Stops rise to the field's percentiles, never fall below the fixed bands, and stay strictly increasing.
  for (let i = 1; i < stops.length; i++) stops[i] = Math.max(fixed[i], round1(q[i - 1]), stops[i - 1] + 0.1);
  return { mode, stops, quantiles: q, stretched: stops.some((v, i) => v > fixed[i]) };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function heatColour(pct: number, stops: number[] = HEAT_STOPS.map(st => st.pct)): [number, number, number, number] {
  const s = HEAT_STOPS;
  if (pct <= stops[0]) return [...s[0].rgb, Math.round(255 * s[0].alpha)];
  for (let i = 1; i < s.length; i++) {
    if (pct <= stops[i]) {
      const t = (pct - stops[i - 1]) / (stops[i] - stops[i - 1]), a = s[i - 1], b = s[i];
      return [Math.round(a.rgb[0] + t * (b.rgb[0] - a.rgb[0])), Math.round(a.rgb[1] + t * (b.rgb[1] - a.rgb[1])), Math.round(a.rgb[2] + t * (b.rgb[2] - a.rgb[2])), Math.round(255 * (a.alpha + t * (b.alpha - a.alpha)))];
    }
  }
  const last = s[s.length - 1];
  return [...last.rgb, Math.round(255 * last.alpha)];
}

export type HeatRaster = {
  width: number;
  height: number;
  /** Metres per raster pixel. */
  mPerPx: number;
  /** Field-frame coordinates (along, across) of the raster's top-left pixel corner. */
  along0: number;
  across0: number;
  data: Uint8ClampedArray;
  /** How many pixels were painted as pressure, as canopy, and left transparent (not observed). */
  painted: number;
  canopy: number;
  unobserved: number;
};

/**
 * The raster at `mPerPx` metres per pixel. Pixels run along the rows (x) and across them (y), from the cells'
 * minimum corner.
 */
export function buildHeatRaster(intel: FieldIntelligence, mPerPx = 1, scale?: HeatScale): HeatRaster | null {
  const grid = intel.grid, cells = grid.cells, cellM = grid.cellM, stops = scale?.stops;
  if (!cells.length) return null;
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const c of cells) { if (c.i < i0) i0 = c.i; if (c.i > i1) i1 = c.i; if (c.j < j0) j0 = c.j; if (c.j > j1) j1 = c.j; }
  const ni = i1 - i0 + 1, nj = j1 - j0 + 1;
  // Cells as a dense lookup (index -1 where no cell): a few hundred thousand entries at most.
  const lookup = new Int32Array(ni * nj).fill(-1);
  cells.forEach((c, k) => { lookup[(c.j - j0) * ni + (c.i - i0)] = k; });
  const cellAt = (i: number, j: number): PressureCell | null => { if (i < i0 || i > i1 || j < j0 || j > j1) return null; const k = lookup[(j - j0) * ni + (i - i0)]; return k < 0 ? null : cells[k]; };
  const width = Math.ceil((ni * cellM) / mPerPx), height = Math.ceil((nj * cellM) / mPerPx);
  const data = new Uint8ClampedArray(width * height * 4);
  const along0 = i0 * cellM, across0 = j0 * cellM;
  let painted = 0, canopy = 0, unobserved = 0;
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const al = along0 + (px + 0.5) * mPerPx, ac = across0 + (py + 0.5) * mPerPx;
    const own = cellAt(Math.floor(al / cellM), Math.floor(ac / cellM));
    const o = (py * width + px) * 4;
    if (!own) { unobserved++; continue; }
    if (own.canopy) { data[o] = CANOPY_RGBA[0]; data[o + 1] = CANOPY_RGBA[1]; data[o + 2] = CANOPY_RGBA[2]; data[o + 3] = CANOPY_RGBA[3]; canopy++; continue; }
    // Bilinear between the four cell centres around the pixel, over observed, non-canopy cells only.
    const fi = al / cellM - 0.5, fj = ac / cellM - 0.5, bi = Math.floor(fi), bj = Math.floor(fj), ti = fi - bi, tj = fj - bj;
    let v = 0, wsum = 0;
    for (let di = 0; di <= 1; di++) for (let dj = 0; dj <= 1; dj++) {
      const c = cellAt(bi + di, bj + dj);
      if (!c || c.canopy) continue;
      const w = (di ? ti : 1 - ti) * (dj ? tj : 1 - tj);
      v += w * c.coverPct; wsum += w;
    }
    const pct = wsum > 0 ? v / wsum : own.coverPct;
    const [r, g, b, a] = heatColour(pct, stops);
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
    painted++;
  }
  return { width, height, mPerPx, along0, across0, data, painted, canopy, unobserved };
}

export type HeatLevels = { fine: HeatRaster | null; coarse: HeatRaster | null; scale: HeatScale };

/** Two levels of detail: 1 m per pixel for the field and row views, 4 m (one cell) for the whole field seen small. */
export function buildHeatLevels(intel: FieldIntelligence, mode: HeatScaleMode = "field"): HeatLevels {
  const scale = heatScaleFor(intel, mode);
  return { fine: buildHeatRaster(intel, 1, scale), coarse: buildHeatRaster(intel, intel.grid.cellM, scale), scale };
}

/** The level whose pixels are closest to the screen's at `mpp` metres per screen pixel. */
export function pickHeatLevel(levels: HeatLevels, mpp: number): HeatRaster | null {
  if (!levels.fine) return levels.coarse;
  if (!levels.coarse) return levels.fine;
  return mpp >= levels.coarse.mPerPx * 0.75 ? levels.coarse : levels.fine;
}
