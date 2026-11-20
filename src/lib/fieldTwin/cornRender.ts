// The corn twin's three views and what they are drawn from (2026-11-19).
//
//   Realistic  the ground in the field's own soil colour, a drawn corn plant at every located plant in the field's own
//              corn colour, weeds
//   Simple     the plants and the weeds on the twin's plain dark ground
//   Geometry   the rows and the weeds, no plants
//
// What is measured and what is drawn. Measured: where each plant stands, the soil and corn colours (two per photograph,
// cornColours.ts, blended over the ground), and one typical plant size for the flight. Drawn, not measured: a plant's
// leaves and which way they point (fixed per plant by its index, so a twin looks the same on every visit). A plant off
// the rows is counted like any other and drawn in its own colour.
//
// Everything here is plain arithmetic over typed arrays, so it is tested without a canvas; the canvas work is in
// components/app/fieldTwin (TwinCanvasLayer.ts, cornSprite.ts).
import type { TwinCorn, TwinRgb } from "./types";

export type CornViewMode = "realistic" | "simple" | "geometry";
export const CORN_VIEWS: CornViewMode[] = ["realistic", "simple", "geometry"];
export const CORN_VIEW_LABEL: Record<CornViewMode, string> = { realistic: "Realistic", simple: "Simple", geometry: "Geometry" };
export const CORN_VIEW_HINT: Record<CornViewMode, string> = {
  realistic: "The field as it looks: its own soil colour, a corn plant at every located plant in its own green, and the weeds.",
  simple: "The plants and the weeds, on a plain ground.",
  geometry: "The rows and the weeds, without the plants.",
};

export const CORN_RENDER = {
  /** Colours for a twin built before colours were read (or whose photographs gave none): a typical soil and corn. */
  defaultSoil: [124, 101, 78] as TwinRgb, defaultCorn: [92, 142, 60] as TwinRgb,
  /** The plant size drawn when the photographs measured none, metres. */
  defaultPlantSizeM: 0.1,
  /** Simple view: one flat green that reads on the dark ground. */
  simpleCorn: [127, 208, 106] as TwinRgb,
  /** A plant located off the rows, in both views: counted, and told apart by colour (not green, not the weeds' red).
   * On a twin whose plants were sorted (`plantsSorted`): the doubles, still counted until the photographs decide them. */
  offRow: [104, 178, 255] as TwinRgb,
  /** Green that is not corn (a sorted twin's dots on no row other than the doubles): a plain dot, never a corn plant. */
  notCorn: [214, 196, 86] as TwinRgb,
  /** Its dot's size, as a share of the drawn plant. */
  notCornShare: 0.3,
  /** Tints of the corn colour across the field (photographs differ in exposure): this many, so the sprites are few. */
  tints: 6,
  /** A plant under this many screen pixels is stamped as a dot; at or over it, drawn as a plant. */
  spriteMinPx: 5,
  /** More plants in view than this are stamped whatever their size (a drawn plant costs a draw call). */
  spriteCap: 8_000,
  /** Leaf directions a plant may take, and the drawn shapes per size class. */
  rotations: 12, variants: 4,
  /** Cells of the colour grids at most (the colours change slowly: a sample per photograph), and at most this many
   * cell x sample sums, so a flight of thousands of photographs costs the same as a small one. */
  maxCells: 16_384, maxWork: 6_000_000,
};

/** Classes of `TwinCornPlants.certainty` that stand on a row (0 certain, 1 probable, 4 and 5 found along a row, 6 development). */
export const isOnRow = (certainty: number) => certainty === 0 || certainty === 1 || certainty === 4 || certainty === 5 || certainty === 6;

/** Whether a twin sorted its plants off the rows (2026-11-19 on: the summary carries the doubles): the doubles counted, the rest not corn. */
export const plantsSorted = (P: { summary?: { doubles?: number } } | null | undefined) => P?.summary?.doubles != null;

/**
 * What a plant is drawn and counted as: on a row (corn); a double (on a row's line, very close to a plant on it:
 * counted, its own colour); green that is not corn (a sorted twin's other plants off the rows: a plain dot, not
 * counted); or, on a twin from before the sort, off the rows (counted, its own colour).
 */
export type PlantKind = "row" | "double" | "notCorn" | "off";
export const plantKind = (certainty: number, sorted: boolean): PlantKind => (isOnRow(certainty) ? "row" : certainty === 7 ? "double" : sorted ? "notCorn" : "off");

export type CornPlantCount = {
  /** The plants counted: on a sorted twin those on the rows and the doubles; before the sort every located plant. */
  total: number; onRows: number;
  /** Before the sort: the plants off the rows, counted (of them `betweenRows` between two rows). On a sorted twin: 0. */
  offRows: number; onNoRow: number; betweenRows: number;
  sorted: boolean;
  /** A sorted twin: the doubles (counted) and the green that is not corn (not counted; of it `betweenRows` between two rows). */
  doubles: number; notCorn: number;
};

/** The plant count of a corn twin (see CornPlantCount). Null: no count on this twin. */
export function cornPlantCount(corn: TwinCorn | null | undefined): CornPlantCount | null {
  const P = corn?.plants;
  if (!P) return null;
  const sorted = plantsSorted(P), n = P.points.length;
  // A twin whose classes are missing (never written so far): every plant is on a row.
  if (P.certainty.length !== n) return { total: n, onRows: n, offRows: 0, onNoRow: 0, betweenRows: 0, sorted, doubles: 0, notCorn: 0 };
  let on = 0, none = 0, between = 0, doubles = 0;
  for (const c of P.certainty) { if (isOnRow(c)) on++; else if (c === 7) doubles++; else if (c === 3) between++; else none++; }
  return sorted
    ? { total: on + doubles, onRows: on, offRows: 0, onNoRow: none, betweenRows: between, sorted, doubles, notCorn: none + between }
    : { total: n, onRows: on, offRows: none + between + doubles, onNoRow: none + doubles, betweenRows: between, sorted, doubles: 0, notCorn: 0 };
}

/** A colour sample in the viewer's world coordinates (zoom-0 units). */
export type LookSample = { x: number; y: number; soil: TwinRgb | null; corn: TwinRgb | null };
export type CornLook = {
  /** Whether the colours are this field's own (read from its photographs) or the standard ones. */
  sampled: boolean;
  soil: TwinRgb; corn: TwinRgb;
  plantSizeM: number; sizeMeasured: boolean;
  samples: LookSample[];
};

/** A corn twin's look, with the standard colours and size where the twin carries none. */
export function cornLookOf(corn: TwinCorn | null | undefined, toWorld: (lat: number, lng: number) => [number, number]): CornLook {
  const L = corn?.look ?? null, R = CORN_RENDER;
  const samples: LookSample[] = (L?.samples ?? []).map(q => { const [x, y] = toWorld(q.lat, q.lng); return { x, y, soil: q.soil, corn: q.corn }; });
  return {
    sampled: !!(L && (L.soil || L.corn)),
    soil: L?.soil ?? R.defaultSoil, corn: L?.corn ?? R.defaultCorn,
    plantSizeM: L?.plantSizeM ?? R.defaultPlantSizeM, sizeMeasured: L?.plantSizeM != null,
    samples,
  };
}

export type ColourGrid = { width: number; height: number; x0: number; y0: number; cellX: number; cellY: number; rgb: Uint8ClampedArray };

/**
 * One colour per cell over a box (zoom-0 units), blended from the samples by inverse distance: each cell the mean of
 * the samples weighted by 1 / (d² + r²), r the samples' typical spacing, so a sample shades into its neighbours and
 * the exposure of one photograph never shows as an edge. With no sample the grid is the fallback colour.
 */
export function blendGrid(samples: { x: number; y: number; c: TwinRgb }[], fallback: TwinRgb, bbox: [number, number, number, number], o = CORN_RENDER): ColourGrid {
  const [bx0, by0, bx1, by1] = bbox, w = Math.max(1e-12, bx1 - bx0), h = Math.max(1e-12, by1 - by0), n = samples.length;
  const cells = Math.max(16, Math.min(o.maxCells, n ? Math.floor(o.maxWork / n) : 16));
  const width = Math.max(2, Math.min(256, Math.round(Math.sqrt((cells * w) / h)))), height = Math.max(2, Math.min(256, Math.round(cells / width)));
  const rgb = new Uint8ClampedArray(width * height * 3), cellX = w / width, cellY = h / height;
  if (!n) { for (let k = 0; k < width * height; k++) { rgb[3 * k] = fallback[0]; rgb[3 * k + 1] = fallback[1]; rgb[3 * k + 2] = fallback[2]; } return { width, height, x0: bx0, y0: by0, cellX, cellY, rgb }; }
  const sx = Float64Array.from(samples, s => s.x), sy = Float64Array.from(samples, s => s.y);
  const r2 = (w * h) / n * 0.5;
  for (let j = 0; j < height; j++) {
    const y = by0 + (j + 0.5) * cellY;
    for (let i = 0; i < width; i++) {
      const x = bx0 + (i + 0.5) * cellX;
      let wr = 0, wg = 0, wb = 0, ws = 0;
      for (let s = 0; s < n; s++) {
        const dx = sx[s] - x, dy = sy[s] - y, q = 1 / (dx * dx + dy * dy + r2), q2 = q * q, c = samples[s].c;
        wr += q2 * c[0]; wg += q2 * c[1]; wb += q2 * c[2]; ws += q2;
      }
      const k = 3 * (j * width + i);
      rgb[k] = wr / ws; rgb[k + 1] = wg / ws; rgb[k + 2] = wb / ws;
    }
  }
  return { width, height, x0: bx0, y0: by0, cellX, cellY, rgb };
}

/** The grid's cell under a point (clamped to the grid). */
export function gridCell(g: ColourGrid, x: number, y: number): number {
  const i = Math.min(g.width - 1, Math.max(0, Math.floor((x - g.x0) / g.cellX))), j = Math.min(g.height - 1, Math.max(0, Math.floor((y - g.y0) / g.cellY)));
  return j * g.width + i;
}

const lum = (c: ArrayLike<number>, o = 0) => 0.299 * c[o] + 0.587 * c[o + 1] + 0.114 * c[o + 2];

/**
 * The corn colour's tints over the field: the grid's cells sorted by brightness and cut into `tints` equal groups,
 * each group's mean colour. Per cell, the tint it takes. A plant takes its cell's tint, so a field of any size is
 * drawn from a handful of sprites.
 */
export function cornTints(grid: ColourGrid, tints = CORN_RENDER.tints): { palette: TwinRgb[]; cellTint: Uint8Array } {
  const n = grid.width * grid.height, order = Array.from({ length: n }, (_, k) => k).sort((a, b) => lum(grid.rgb, 3 * a) - lum(grid.rgb, 3 * b));
  const k = Math.max(1, Math.min(tints, n)), palette: TwinRgb[] = [], cellTint = new Uint8Array(n);
  for (let t = 0; t < k; t++) {
    const a = Math.floor((t * n) / k), b = Math.floor(((t + 1) * n) / k);
    let r = 0, g = 0, bl = 0;
    for (let q = a; q < b; q++) { const c = order[q]; r += grid.rgb[3 * c]; g += grid.rgb[3 * c + 1]; bl += grid.rgb[3 * c + 2]; cellTint[c] = t; }
    const m = Math.max(1, b - a);
    palette.push([Math.round(r / m), Math.round(g / m), Math.round(bl / m)]);
  }
  return { palette, cellTint };
}

/** A fixed pseudo-random number per plant (its index): the same leaves on every visit. */
export function plantHash(i: number): number {
  let h = (i + 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** How a view of plants is drawn: each as a plant, or stamped as dots (too small to show leaves, or too many in view). */
export function plantDrawMode(plantPx: number, inView: number, o = CORN_RENDER): "sprite" | "stamp" {
  return plantPx >= o.spriteMinPx && inView <= o.spriteCap ? "sprite" : "stamp";
}

/**
 * A stamped plant: a square of this many pixels at this opacity. Under a pixel a plant is fainter than a full pixel
 * (fainter the smaller it is, never under 0.3), so a whole field seen from far reads as soil with green rows, not a
 * green sheet.
 */
export function stampOf(plantPx: number): { size: number; alpha: number } {
  if (plantPx < 1.4) return { size: 1, alpha: Math.max(0.3, Math.min(1, plantPx * 0.7)) };
  if (plantPx < 2.6) return { size: 2, alpha: 0.9 };
  if (plantPx < 4.2) return { size: 3, alpha: 1 };
  return { size: Math.min(9, Math.round(plantPx * 0.8)), alpha: 1 };
}

export type Leaf = { /** Direction, radians. */ angle: number; /** Tip distance from the centre, the plant's half span = 1. */ length: number; /** Half width at the widest. */ width: number; /** The tip's sideways bend. */ curl: number };

/**
 * The drawn leaves of a plant, by its span and a shape number: two or three leaves on a seedling under 8 cm across,
 * three or four up to 20 cm, four to six beyond. Maize leaves stand in two ranks, so the leaves come in opposed pairs,
 * each pair turned a little from the last and shorter. Illustration: no photograph measured a plant's leaves.
 */
export function leavesFor(sizeM: number, variant: number): Leaf[] {
  const v = ((variant % CORN_RENDER.variants) + CORN_RENDER.variants) % CORN_RENDER.variants;
  const count = sizeM < 0.08 ? [2, 2, 3, 3][v] : sizeM < 0.2 ? [3, 4, 4, 3][v] : [4, 5, 6, 5][v];
  const turn = [0.5, -0.42, 0.62, -0.55][v], leaves: Leaf[] = [];
  for (let k = 0; k < count; k++) {
    const pair = k >> 1, side = k % 2;
    const length = (1 - 0.2 * pair) * (side ? 0.82 + 0.04 * v : 1);
    leaves.push({ angle: pair * (Math.PI / 2 + turn) * 0.62 + side * Math.PI + (side ? 0.12 * (v - 1.5) : 0), length, width: 0.15 + 0.02 * ((v + k) % 3), curl: (side ? -1 : 1) * (0.1 + 0.05 * ((v + pair) % 3)) });
  }
  return leaves;
}

export const rgbCss = (c: ArrayLike<number>, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
export const mixRgb = (a: ArrayLike<number>, b: ArrayLike<number>, t: number): TwinRgb => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
