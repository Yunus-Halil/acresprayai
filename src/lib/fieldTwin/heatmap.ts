// The weed-pressure heatmap: a raster in the field's own frame (metres along and across the rows), one value per
// pixel interpolated between the measured pressure cells, coloured on fixed bands. Built once per twin, drawn with
// one transformed drawImage per frame, so the field view costs the same whether the field holds ten weeds or a
// million.
//
// What a pixel means: the verified weed cover, as a percent of the observable ground, interpolated (bilinear)
// between the centres of the four nearest OBSERVED cells. A pixel whose own cell no photograph saw is transparent
// (the ground shows through, hatched as "not observed"); a pixel whose cell is mostly under canopy is painted in
// the canopy tone, not in a pressure colour. Nothing is smoothed beyond the interpolation between neighbours, and
// no colour is scaled to this field: the same cover is the same colour on every field.
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

export function heatColour(pct: number): [number, number, number, number] {
  const s = HEAT_STOPS;
  if (pct <= s[0].pct) return [...s[0].rgb, Math.round(255 * s[0].alpha)];
  for (let i = 1; i < s.length; i++) {
    if (pct <= s[i].pct) {
      const t = (pct - s[i - 1].pct) / (s[i].pct - s[i - 1].pct), a = s[i - 1], b = s[i];
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
export function buildHeatRaster(intel: FieldIntelligence, mPerPx = 1): HeatRaster | null {
  const grid = intel.grid, cells = grid.cells, cellM = grid.cellM;
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
    const [r, g, b, a] = heatColour(pct);
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
    painted++;
  }
  return { width, height, mPerPx, along0, across0, data, painted, canopy, unobserved };
}

export type HeatLevels = { fine: HeatRaster | null; coarse: HeatRaster | null };

/** Two levels of detail: 1 m per pixel for the field and row views, 4 m (one cell) for the whole field seen small. */
export function buildHeatLevels(intel: FieldIntelligence): HeatLevels {
  return { fine: buildHeatRaster(intel, 1), coarse: buildHeatRaster(intel, intel.grid.cellM) };
}

/** The level whose pixels are closest to the screen's at `mpp` metres per screen pixel. */
export function pickHeatLevel(levels: HeatLevels, mpp: number): HeatRaster | null {
  if (!levels.fine) return levels.coarse;
  if (!levels.coarse) return levels.fine;
  return mpp >= levels.coarse.mPerPx * 0.75 ? levels.coarse : levels.fine;
}
