// How farmers plant: the planting frames crops are set out on, as priors for the row and crop fitters.
//
// Every number here is from docs/research/planting-practice-2026-10-21.md (extension bulletins, ministries,
// machinery makers, university guides; sources listed there). Nothing is assumed about a field from this table:
// the field's own pattern decides, and the table says what that pattern is usually called, snaps the across-row
// stagger to the two values a planting crew lays out (aligned, or offset by half a spacing) when the fit is already
// within a hair of one, and names a doubt when a fit matches no known frame.

/** One planting frame: a crop and system in a region, with its row pitch and in-row spacing ranges, metres. */
export type PracticeEntry = {
  crop: string;
  system: string;
  region: string;
  /** Row spacing (pitch), metres: [low, high]. */
  pitchM: [number, number];
  /** In-row plant spacing, metres: [low, high]; null when plants are not separable along the row (drilled, vines, hedgerows at imagery scale). */
  alongM: [number, number] | null;
  /** Across-row stagger a planting crew lays out: 0 (rectangular, rows aligned) and/or 0.5 (offset, diamond, triangle), as a share of the in-row spacing. */
  stagger: (0 | 0.5)[];
};

/** Orchards and vineyards: in-row spacing and row pitch as planted, by crop, system and region. */
export const ORCHARD_PRACTICE: PracticeEntry[] = [
  { crop: "apple", system: "tall spindle, high density", region: "US, EU", pitchM: [3.0, 4.0], alongM: [0.9, 1.8], stagger: [0] },
  { crop: "apple", system: "semi-dwarf to half-standard", region: "US, Canada", pitchM: [4.5, 6.5], alongM: [2.4, 5.5], stagger: [0] },
  { crop: "apple", system: "traditional standard", region: "UK, EU", pitchM: [8, 10], alongM: [7, 9], stagger: [0, 0.5] },
  { crop: "pear", system: "dwarf to standard", region: "US", pitchM: [3.6, 6.7], alongM: [0.45, 5.5], stagger: [0] },
  { crop: "peach, nectarine", system: "perpendicular V", region: "US", pitchM: [4.6, 6.1], alongM: [1.5, 2.0], stagger: [0] },
  { crop: "peach, nectarine", system: "open vase", region: "US", pitchM: [5.5, 6.1], alongM: [3.7, 4.0], stagger: [0] },
  { crop: "apricot", system: "standard rootstock", region: "Turkey", pitchM: [5, 10], alongM: [5, 10], stagger: [0, 0.5] },
  { crop: "apricot", system: "dwarf rootstock", region: "Turkey", pitchM: [3.0, 4.0], alongM: [2.5, 3.5], stagger: [0] },
  { crop: "apricot, peach, plum", system: "standard", region: "US", pitchM: [5.0, 6.0], alongM: [3.4, 4.0], stagger: [0] },
  { crop: "plum, prune", system: "standard", region: "US", pitchM: [3.7, 7.6], alongM: [3.7, 7.6], stagger: [0, 0.5] },
  { crop: "sweet cherry", system: "mahaleb or standard", region: "Turkey", pitchM: [5, 8], alongM: [4, 8], stagger: [0, 0.5] },
  { crop: "sweet cherry", system: "dwarf (Gisela)", region: "Turkey, US", pitchM: [4.9, 6.1], alongM: [0.75, 3.0], stagger: [0] },
  { crop: "almond", system: "square to rectangle", region: "California", pitchM: [6.4, 7.3], alongM: [4.3, 7.3], stagger: [0, 0.5] },
  { crop: "almond", system: "hedgerow", region: "California", pitchM: [6.4, 6.7], alongM: [3.0, 3.7], stagger: [0] },
  { crop: "walnut", system: "square", region: "California", pitchM: [7.6, 9.1], alongM: [7.6, 9.1], stagger: [0, 0.5] },
  { crop: "walnut", system: "hedgerow", region: "California", pitchM: [6.4, 7.0], alongM: [4.3, 4.9], stagger: [0] },
  { crop: "pistachio", system: "square", region: "California", pitchM: [5.8, 6.4], alongM: [5.8, 6.4], stagger: [0, 0.5] },
  { crop: "olive", system: "traditional", region: "Spain, Turkey", pitchM: [7, 12], alongM: [7, 12], stagger: [0, 0.5] },
  { crop: "olive", system: "intensive", region: "Spain, Turkey", pitchM: [5, 8], alongM: [4, 7], stagger: [0] },
  { crop: "olive", system: "super-high-density hedgerow", region: "Spain", pitchM: [3.5, 4.0], alongM: [1.2, 1.5], stagger: [0] },
  { crop: "citrus", system: "conventional", region: "Mediterranean, Florida", pitchM: [6.5, 7.6], alongM: [3.0, 6.0], stagger: [0] },
  { crop: "citrus", system: "high density", region: "Florida", pitchM: [4.6, 6.1], alongM: [3.0, 4.6], stagger: [0] },
  { crop: "hazelnut", system: "square", region: "Oregon", pitchM: [5.5, 6.1], alongM: [5.5, 6.1], stagger: [0, 0.5] },
  { crop: "hazelnut", system: "double density, later thinned to a triangle", region: "Oregon", pitchM: [5.5, 6.1], alongM: [3.0, 3.7], stagger: [0, 0.5] },
  { crop: "hazelnut", system: "ocak (multi-stem clumps)", region: "Turkey", pitchM: [5, 6.5], alongM: [4, 5.5], stagger: [0] },
  { crop: "avocado", system: "conventional", region: "California", pitchM: [5.8, 6.4], alongM: [4.3, 4.9], stagger: [0] },
  { crop: "avocado", system: "high density", region: "California", pitchM: [2.1, 3.3], alongM: [2.1, 3.3], stagger: [0] },
  { crop: "kiwifruit", system: "pergola", region: "New Zealand, Italy", pitchM: [3, 5.8], alongM: [4.6, 6], stagger: [0] },
  { crop: "vineyard", system: "high density", region: "France", pitchM: [1.0, 1.5], alongM: null, stagger: [0] },
  { crop: "vineyard", system: "New World, US", region: "US, Australia", pitchM: [1.8, 3.7], alongM: null, stagger: [0] },
];

/** Row crops: the row pitches growers plant, metres, by crop; and the tramline periods a sprayer's wheel track repeats at. */
export const ROW_CROP_PITCHES_M: Record<string, number[]> = {
  corn: [0.762, 0.75, 0.70, 0.508, 0.559, 0.381],
  soybean: [0.762, 0.508, 0.381, 0.19],
  cotton: [0.965, 1.016, 0.914, 0.762, 0.70, 0.381],
  wheat: [0.125, 0.14, 0.15, 0.17, 0.19, 0.20, 0.25],
  sunflower: [0.762, 0.70, 0.60],
  "sugar beet": [0.45, 0.50, 0.56, 0.61],
  potato: [0.86, 0.91, 0.75, 0.90],
  "vegetable beds": [1.0, 2.0],
  rice: [0.30, 0.25, 0.20],
  tramline: [18, 24, 27, 30, 36],
};

/** In-row plant spacings that resolve in imagery, metres, by crop: corn, sunflower, sugar beet, potato, cotton; soybean and wheat do not resolve. */
export const ROW_CROP_ALONG_M: Record<string, [number, number]> = {
  corn: [0.106, 0.25],
  sunflower: [0.15, 0.40],
  "sugar beet": [0.18, 0.30],
  potato: [0.18, 0.33],
  cotton: [0.08, 0.20],
};

const within = (v: number, [lo, hi]: [number, number], slack = 0.1) => v >= lo * (1 - slack) && v <= hi * (1 + slack);
const m = (v: number) => (v >= 1 ? `${(Math.round(v * 10) / 10).toString()} m` : `${Math.round(v * 100)} cm`);

/**
 * The planting frames a fitted lattice matches: entries whose row pitch and in-row spacing ranges hold the fitted
 * values within a tenth, and a sentence for the panel. With a doubt when the fit matches no frame and looks like a
 * half-pitch or a swapped axis.
 */
export function describePlanting(alongM: number, acrossM: number): { matches: PracticeEntry[]; text: string; doubt: string | null } {
  const matches = ORCHARD_PRACTICE.filter(e => within(acrossM, e.pitchM) && (e.alongM ? within(alongM, e.alongM) : alongM < 2.5));
  const crops = [...new Set(matches.map(e => e.crop))];
  const text = crops.length
    ? `Trees ${m(alongM)} apart in rows ${m(acrossM)} apart: the frame ${crops.length === 1 ? "used for" : "shared by"} ${crops.slice(0, 4).join(", ")}${matches.some(e => e.region.includes("Turkey")) ? " (Turkey among the regions)" : ""}.`
    : `Trees ${m(alongM)} apart in rows ${m(acrossM)} apart: not a frame in the planting catalogue.`;
  let doubt: string | null = null;
  if (!crops.length && alongM < 0.8 && acrossM >= 3) doubt = "Trees closer along the row than any orchard plants them except hedgerows (apple, high-density olive, vines). If these are not hedgerow trees, the spacing along the row may be half the true one.";
  else if (!crops.length && acrossM < 0.6 * alongM) doubt = "Rows closer than the trees along them, which no orchard plants: the marked neighbour in the next row may have been in the same row.";
  return { matches, text, doubt };
}

/** The stagger a planting crew lays out: rows aligned (0) or offset by half a spacing (0.5), as a share of the in-row spacing. */
export const PRACTICE_STAGGERS = [0, 0.5] as const;
/** A fitted stagger within this share of the in-row spacing of a laid-out value is taken for it. */
export const STAGGER_SNAP_SHARE = 0.05;

/**
 * The fitted stagger snapped to what a planting crew lays out, when it is already within STAGGER_SNAP_SHARE of it:
 * rows aligned, or offset by half a spacing (square, offset, diamond and triangle plantings). Any other value is
 * kept: a stagger error compounds row by row, so the snap is tight and the caller must check the marks still hold.
 */
export function snapStagger(staggerPx: number, alongPx: number): number {
  if (!(alongPx > 0)) return staggerPx;
  const share = ((staggerPx / alongPx) % 1 + 1) % 1;
  for (const s of [0, 0.5, 1]) if (Math.abs(share - s) <= STAGGER_SNAP_SHARE) return staggerPx + (s - share) * alongPx;
  return staggerPx;
}
