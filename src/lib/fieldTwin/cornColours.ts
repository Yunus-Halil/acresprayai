// A photograph's soil colour and corn colour, for the twin's Realistic view (2026-11-19).
//
// Read from the pixels the corn stage has already decoded, after its read is finished: no second decode, and nothing
// the read does or returns depends on it. A few hundred pixel reads per photograph: a sparse grid for the soil, and the
// greenest pixel at up to COLOUR_SAMPLING.plants of the plants the read located for the corn. The photograph itself
// never leaves the browser; two colours per photograph go into the twin.
//
// Where the read located no plant (its count withheld on a later stage), the corn colour is the grid's green pixels.
import type { PhotoPixels } from "../photoScout/pattern";

export type Rgb = [number, number, number];

export type PhotoColours = {
  /** Median of the soil samples; null when too few of the grid's pixels were soil. */
  soil: Rgb | null;
  /** Median of the corn samples; null when too few were green. */
  corn: Rgb | null;
  soilN: number; cornN: number;
  /** What the corn colour was read from: the located plants, or (no plant located) the grid's green pixels. */
  cornFrom: "plants" | "green" | null;
};

export const COLOUR_SAMPLING = {
  /** The soil grid over the frame (columns, rows), inside a margin of the frame's edge (lens falloff). */
  grid: [28, 20] as [number, number], margin: 0.08,
  /** Plants read for the corn colour, spread evenly through the read's list. */
  plants: 48,
  /** Around a plant's mark, the greenest pixel within this many pixels is its leaf. */
  reach: 3,
  /** Soil is told from leaf against the photograph's own soil, not a fixed number (a tan soil has an excess green,
   * 2g - r - b, of 6 to 15 by itself): the grid's least green tenth sets the soil's level, a grid pixel within
   * `soilBand` of it and not green-dominant is soil, and a leaf is at least `leafOverSoil` over the soil's median
   * (never under `leafMin`). */
  soilBand: 10, leafOverSoil: 10, leafMin: 12,
  /** Pixels darker or brighter than this (mean of r, g, b) are shadow or glare, not a colour to keep. */
  darkest: 28, brightest: 245,
  /** Fewer samples than these give no colour. */
  minSoil: 24, minCorn: 4,
};

const median = (v: number[]) => { v.sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2); };
function medianRgb(r: number[], g: number[], b: number[]): Rgb { return [median(r), median(g), median(b)]; }

/** The two colours of one photograph. `plants`: the read's located plants, in these pixels. */
export function samplePhotoColours(px: PhotoPixels, plants: readonly (readonly [number, number])[], o = COLOUR_SAMPLING): PhotoColours {
  const { width: W, height: H, rgba } = px;
  if (W < 8 || H < 8) return { soil: null, corn: null, soilN: 0, cornN: 0, cornFrom: null };
  // The grid: each point the mean of its 3 x 3 block (one pixel is noise); dark and blown points left out.
  const G: { r: number; g: number; b: number; e: number }[] = [];
  const [nx, ny] = o.grid, mx = W * o.margin, my = H * o.margin;
  for (let j = 0; j < ny; j++) {
    const y = Math.min(H - 2, Math.max(1, Math.round(my + ((H - 2 * my) * (j + 0.5)) / ny)));
    for (let i = 0; i < nx; i++) {
      const x = Math.min(W - 2, Math.max(1, Math.round(mx + ((W - 2 * mx) * (i + 0.5)) / nx)));
      let r = 0, g = 0, b = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = ((y + dy) * W + x + dx) * 4; r += rgba[k]; g += rgba[k + 1]; b += rgba[k + 2]; }
      r /= 9; g /= 9; b /= 9;
      const lum = (r + g + b) / 3;
      if (lum < o.darkest || lum > o.brightest) continue;
      G.push({ r: Math.round(r), g: Math.round(g), b: Math.round(b), e: 2 * g - r - b });
    }
  }
  // The soil: the least green of the grid, within a band of its own level, and never green-dominant (a canopy's
  // least green pixels are still leaf: then the photograph gives no soil colour).
  const es = G.map(q => q.e).sort((a, b) => a - b), floor = es.length ? es[Math.floor(es.length * 0.1)] : 0;
  const S = G.filter(q => q.e <= floor + o.soilBand && !(q.g > q.r + 4 && q.g > q.b + 4));
  const soilE = S.length ? median(S.map(q => q.e)) : floor, leafMin = Math.max(o.leafMin, soilE + o.leafOverSoil);
  const greens = G.filter(q => q.e >= leafMin);
  // The corn: at each chosen plant, its greenest pixel within reach of the mark.
  const cr: number[] = [], cg: number[] = [], cb: number[] = [];
  const step = Math.max(1, plants.length / o.plants);
  for (let q = 0; q < plants.length && cr.length < o.plants; q += step) {
    const p = plants[Math.floor(q)], cx = Math.round(p[0]), cy = Math.round(p[1]);
    let best = -1, be = -Infinity;
    for (let dy = -o.reach; dy <= o.reach; dy++) {
      const y = cy + dy; if (y < 0 || y >= H) continue;
      for (let dx = -o.reach; dx <= o.reach; dx++) {
        const x = cx + dx; if (x < 0 || x >= W) continue;
        const k = (y * W + x) * 4, e = 2 * rgba[k + 1] - rgba[k] - rgba[k + 2];
        if (e > be) { be = e; best = k; }
      }
    }
    if (best < 0 || be < leafMin) continue;
    const lum = (rgba[best] + rgba[best + 1] + rgba[best + 2]) / 3;
    if (lum < o.darkest || lum > o.brightest) continue;
    cr.push(rgba[best]); cg.push(rgba[best + 1]); cb.push(rgba[best + 2]);
  }
  const rgbOf = (v: { r: number; g: number; b: number }[]) => medianRgb(v.map(q => q.r), v.map(q => q.g), v.map(q => q.b));
  const soil = S.length >= o.minSoil ? rgbOf(S) : null;
  if (cr.length >= o.minCorn) return { soil, corn: medianRgb(cr, cg, cb), soilN: S.length, cornN: cr.length, cornFrom: "plants" };
  if (!plants.length && greens.length >= o.minCorn) return { soil, corn: rgbOf(greens), soilN: S.length, cornN: greens.length, cornFrom: "green" };
  return { soil, corn: null, soilN: S.length, cornN: cr.length, cornFrom: null };
}

/** The field's own colour from its photographs' colours: the median per channel (null with none). */
export function fieldColour(colours: (Rgb | null)[]): Rgb | null {
  const v = colours.filter((c): c is Rgb => !!c);
  return v.length ? medianRgb(v.map(c => c[0]), v.map(c => c[1]), v.map(c => c[2])) : null;
}
