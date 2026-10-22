// Weed pressure, graded per cell after the crop has been taken out of the picture.
//
// Built 2026-10-21 from docs/research/weed-pressure-grading-2026-10-21.md. The rules, and where each comes from:
//
//   cover      the cell's metric is weed canopy as a share of the VISIBLE GROUND (the imaged ground off the crop row
//              band and crowns), measured from the map's own pixels by Stage 1 alone (every green thing off the rows,
//              so nothing between the rows is skipped: a ranked list of spots is not a weed map); never how green
//              anything is: every threshold people act on is cover (the Turkish ministry's 10-15% cover per m² for
//              maize, cotton, olive, apricot and citrus; German cereal thresholds of 5-10%; Peña's UAV classes
//              <5 / 5-20 / >20%), and no paper or tool grades by index intensity. Since 2026-10-22 the objects (the
//              model's plants, the scan's kept spots) give the count and the sizes, never the cover: taking the larger
//              of the two let one tree-sized detection (RF-DETR calls crowns weeds: the two-stage trial, 2026-10-19)
//              set a cell's cover on its own outline. Where the two disagree by more than a tenth of the ground, the
//              cell says so.
//   classes    by crop group, with the published action point inside them: wide-row crops act at 10%, drilled
//              cereals at 5% (barley) or 9% (wheat), orchards at 10% (apricot and citrus 15%). "High" is Peña's 20%
//              (wide-row) or Braun-Blanquet's 25% (orchards). Our old 5-25% band hid the action point.
//   scenario 1 many tiny weeds: cover reads low while the count is high. Scattered weeds compete harder than clumped
//              ones (Norris 2001) and are easiest to kill while small (late spot spraying 20% efficacy vs 86% early,
//              Allmendinger 2024), so a cell with many small objects steps up one class and is tagged "treat while
//              small", only before canopy closure. Density and size are both read over the treatment unit (the
//              median diameter of every object in it; Stage 1's mean blob where the unit has no objects), so a cell
//              with no weed of its own inside a dense unit steps up with it. The density bar is ours (inference).
//   scenario 2 one big weed: a seed and resistance risk, not a yield risk (one Palmer amaranth plant 200,000 to
//              600,000 seeds; one plant's seed infested over 95% of a field by year 3, Norsworthy 2014). It never
//              raises its cell's class; it is reported as a "large escape" point with its size. The 0.3 m size bar is
//              ours; at 1.5-5 cm a pixel a 10 cm label-size weed is near the detection floor.
//   scenario 3 one large cluster: the class comes from cover; the field's priority from the patch's area (patches
//              persist year to year, Rew & Cussans 1995). The patch rule stays at 5% (Peña's boundary); the 25 m²
//              priority is ours and labelled so.
//   relative   weed / (weed + crop) per cell, the measure that tracks yield loss (Kropff & Spitters 1991; Goldsmith
//              2025 from UAS imagery), with the crop's cover from the planting layout's crowns. Shown as a loss band
//              between q 0.54 (the UAS maize mean) and q 1, only before canopy closure, never as a number to act on.
//   tiers      "confirmed" needs corroboration (cover at or over 5%, or three objects found by a model or the scan
//              over the treatment unit, and, when the plants came from photographs, at least one object seen in two
//              photographs); everything else that was found is "possible" and kept for review, never dropped: a lone
//              escape is the costly miss (Norsworthy 2014). Stage 1's pixel blobs never count toward the three: they
//              are any green speck from 0.003 m² (Stage 1's blobMinM2), so three of them corroborate nothing.
//   floor      no plant-level claim under about four pixels (Peña 2015): objects smaller than that are counted as
//              below the floor and the floor is stated in centimetres on every grade.
//   assessed   a cell Stage 1 could not judge (no rows read, partly imaged, mostly crop row, in shadow) is "not
//              assessed", never "weed-free".
//
// Pure: weed objects, a grid, Stage 1's cells and the field's rows in; a grade out. Nothing here fetches or stores.
import type { LatLng2 } from "../../geo";
import type { Candidate } from "../../weedScout/types";
import { type FieldRows, fieldRowStatusAt } from "../fieldRows";
import type { GroundPlant } from "../frames";
import { latLngOfPx, mercatorPx } from "../mapRun";
import { isOnRow } from "../rowFilter";
import { type GridFrame, type Stage1Cell, type UncertainReason, cellAt, cellKey } from "../twoStage/stage1";

/**
 * A weed as the grade sees it, whichever system found it: the model's plants (Find weeds) or the scan's kept spots
 * (Scan this field, the operator's verdicts applied). Only what the grade needs.
 */
export type WeedObject = {
  id: string;
  centre: LatLng2;
  areaM2: number;
  diameterM: number;
  /** Width in the picture's pixels, when known: the floor is judged on it; else on the diameter against the map's pixel. */
  px: number | null;
  /** Photographs (or windows) that saw it. */
  views: number;
  /** On a crop row by the rows that placed it; the grade drops these, and checks the field's rows itself too. */
  onRow: boolean;
};

/** The model's plants as weed objects: weeds with a place and an area, their row status kept. */
export function weedObjectsOf(plants: GroundPlant[]): WeedObject[] {
  const out: WeedObject[] = [];
  for (const p of plants) {
    if (p.klass !== "weed" || !p.centre || p.areaM2 == null) continue;
    out.push({ id: p.id, centre: p.centre, areaM2: p.areaM2, diameterM: p.diameterM ?? 2 * Math.sqrt(p.areaM2 / Math.PI), px: p.equivalentDiameterPx > 0 ? p.equivalentDiameterPx : null, views: p.seenIn.length, onRow: isOnRow(p.rowStatus) });
  }
  return out;
}

/** The scan's spots kept as weeds (by the operator's verdicts, applied by the caller) as weed objects. */
export function weedObjectsOfScan(spots: Candidate[]): WeedObject[] {
  return spots.filter(c => c.areaM2 > 0).map(c => ({ id: c.id, centre: c.centroid, areaM2: c.areaM2, diameterM: 2 * Math.sqrt(c.areaM2 / Math.PI), px: null, views: 1, onRow: false }));
}

export type CropGroup = "wide-row" | "cereal" | "orchard";

const CEREALS = ["wheat", "barley", "oats", "oat", "rye", "triticale", "buğday", "arpa", "yulaf"];
const ORCHARD_WORDS = ["apricot", "apple", "pear", "peach", "nectarine", "plum", "prune", "cherry", "olive", "citrus", "orange", "lemon", "mandarin", "grapefruit", "almond", "walnut", "pistachio", "hazelnut", "avocado", "kiwi", "vine", "grape", "orchard", "tree", "fig", "pomegranate", "kayısı", "elma", "kiraz", "zeytin", "fındık", "badem", "ceviz"];

/** The crop group a field grades under: its crop's name, or an orchard when a planting layout (trees) was fitted. */
export function cropGroupOf(crop: string | null | undefined, hasPlantingLayout: boolean): CropGroup {
  const c = (crop ?? "").toLowerCase();
  if (c && ORCHARD_WORDS.some(w => c.includes(w))) return "orchard";
  if (c && CEREALS.some(w => c.includes(w))) return "cereal";
  if (hasPlantingLayout) return "orchard";
  return "wide-row";
}

export type PressureClass = "none" | "trace" | "low" | "moderate" | "action" | "high";
export const CLASS_ORDER: readonly PressureClass[] = ["none", "trace", "low", "moderate", "action", "high"] as const;
export const CLASS_LABEL: Record<PressureClass, string> = { none: "none", trace: "trace", low: "low", moderate: "moderate", action: "action", high: "high" };

/** Lower bounds of cover for each class; cover over zero but under `low` is "trace". */
export type ClassScheme = { group: CropGroup; low: number; moderate: number; action: number; high: number; source: string };

/** The scheme for a crop group, and the crop's own action point where the sources give one. */
export function schemeFor(group: CropGroup, crop: string | null | undefined): ClassScheme {
  const c = (crop ?? "").toLowerCase();
  if (group === "cereal") {
    const barley = c.includes("barley") || c.includes("arpa");
    return { group, low: 0.01, moderate: 0.05, action: barley ? 0.05 : 0.09, high: 0.15, source: barley ? "German barley threshold 4.5 to 8.9% cover (Gesunde Pflanzen 2014)" : "German wheat threshold 9.2 to 9.8% cover (Gesunde Pflanzen 2014)" };
  }
  if (group === "orchard") {
    const fifteen = c.includes("apricot") || c.includes("kayısı") || c.includes("citrus") || c.includes("orange") || c.includes("lemon") || c.includes("mandarin");
    return { group, low: 0, moderate: 0.05, action: fifteen ? 0.15 : 0.10, high: 0.25, source: fifteen ? "Turkish ministry: act over 15% cover (apricot annex, citrus; TAGEM 2022)" : "Turkish ministry: act at 10 to 15% cover (olive, apricot; TAGEM 2022)" };
  }
  const grassOnly = false;
  return { group, low: 0.01, moderate: 0.05, action: grassOnly ? 0.15 : 0.10, high: 0.20, source: "Turkish ministry: act at 10 to 15% cover (maize; cotton 10% broadleaf, 15% grass; TAGEM 2022); high at Peña's 20%" };
}

/**
 * The three bands the map draws (the operator, 2026-10-21: "keep it simple: low green, medium yellow, high red"):
 * low is anything under the moderate boundary (trace and low), medium is moderate, high is the action point and over.
 * The six classes stay in the panel and the data; red on the map means act.
 */
export type PressureBand = "none" | "low" | "medium" | "high";
export function bandOf(k: PressureClass): PressureBand {
  if (k === "none") return "none";
  if (k === "trace" || k === "low") return "low";
  if (k === "moderate") return "medium";
  return "high";
}
/** The band drawn for a cell: its class's band (judged over the treatment unit), capped at medium when the cell is near the crop. */
export function drawnBandOf(c: { klass: PressureClass; nearCrop: boolean }): PressureBand {
  const b = bandOf(c.klass);
  return c.nearCrop && b === "high" ? "medium" : b;
}

export function classOf(cover: number, count: number, s: ClassScheme): PressureClass {
  if (!(cover > 0) && count === 0) return "none";
  if (cover < s.low) return "trace";
  if (cover < s.moderate) return "low";
  if (cover < s.action) return "moderate";
  if (cover < s.high) return "action";
  return "high";
}

export const stepUp = (k: PressureClass): PressureClass => CLASS_ORDER[Math.min(CLASS_ORDER.length - 1, CLASS_ORDER.indexOf(k) + 1)];

export type GradeParams = {
  /** A cell is corroborated at this cover... */
  corroborateCover: number;
  /** ...or this many objects (a model's plants or the scan's spots; never Stage 1's pixel blobs) over the treatment unit. */
  corroborateCount: number;
  /** Scenario 1: at this many objects per m² of visible ground, with a median object under smallDiameterM, the cell steps up one class (ours). */
  denseObjectsPerM2: number;
  smallDiameterM: number;
  /** Scenario 2: a single object this wide or wider is a large escape (ours; a 10 cm label-size weed is near the floor at our pixel sizes). */
  escapeDiameterM: number;
  /** Patches: touching cells at this cover or more (Peña 2013's low/moderate boundary). */
  patchCover: number;
  /** A patch is a field priority at this area (ours, labelled so) or at the scheme's "high" cover. */
  patchPriorityAreaM2: number;
  /** Kropff & Spitters q at the band's two ends: the UAS maize mean (Goldsmith 2025) and one. */
  kropffQ: [number, number];
  /** No plant-level claim under this many pixels across (Peña 2015). */
  floorPx: number;
  /** A cell with less of its ground visible than this share is not assessed, whatever the cell size. */
  minGroundShare: number;
  /**
   * Near the crop: a cell with less than this share of its ground visible (the rest under the row band and crowns),
   * or touching a crown's margin, is ambiguous ground, not a place to call high. Vegetation there may be the crop's
   * own rim, and a scrap of ground reads any leaf as high cover. Such a cell is capped at the medium band and
   * reported as near the crop (the operator, 2026-10-21: "if it's too near the crop we should exercise caution
   * making it red").
   */
  nearCropGroundShare: number;
  nearCropMarginM: number;
  /**
   * The treatment unit, metres across: the window of cells a cell's class is judged over, rounded up to whole cells.
   * Published cover thresholds were measured at this scale, never at a quarter square metre (Peña 2013 on 1 m × row
   * width units; the Turkish guides on the orchard mean of 10 to 30 quadrats; Paice 1998's 6 × 6 m bound on a
   * profitable control unit); 2 m is a spot-sprayer section or a hoe's pass. Ours as a default.
   */
  unitM: number;
  /** A cell's pixels and its objects disagree when their weed areas differ by more than this share of its ground (ours). */
  disagreeShare: number;
};
export const DEFAULT_GRADE: GradeParams = { corroborateCover: 0.05, corroborateCount: 3, denseObjectsPerM2: 2, smallDiameterM: 0.15, escapeDiameterM: 0.30, patchCover: 0.05, patchPriorityAreaM2: 25, kropffQ: [0.54, 1], floorPx: 4, minGroundShare: 0.3, nearCropGroundShare: 0.5, nearCropMarginM: 0.3, unitM: 2, disagreeShare: 0.1 };

export type Tier = "confirmed" | "possible" | "none";

export type GradedCell = {
  key: string; i: number; j: number;
  centre: LatLng2; ring: LatLng2[];
  /** Weed canopy as a share of the cell's own visible ground (imaged, off the crop band and crowns), from Stage 1's pixels. */
  cover: number;
  groundM2: number;
  /** Stage 1's off-row green in the cell, m²: what the cover is read from. */
  weedM2: number;
  /** The objects in the cell when there are any, else Stage 1's blobs. */
  count: number;
  /** The objects in the cell (a model's plants or the scan's spots), never blobs. */
  objects: number;
  /** The objects' canopy in the cell, m² (0 without objects). */
  objectM2: number;
  /** |pixels' weed - objects' weed| over the cell's ground, when the cell has objects; null without. */
  disagreement: number | null;
  /** Weed over visible ground across the treatment unit around the cell: what the class is judged on. */
  unitCover: number;
  unitGroundM2: number;
  unitCount: number;
  /** Objects across the treatment unit (no blobs): what the count corroboration is judged on. */
  unitObjects: number;
  /** Objects per m² of visible ground. */
  density: number;
  medianDiameterM: number | null;
  /** Median diameter over the objects across the treatment unit (Stage 1's mean blob when the unit has none): what scenario 1 is judged on. */
  unitMedianDiameterM: number | null;
  maxDiameterM: number | null;
  /** The crop's cover in the cell, m²: the layout's crowns, or the row band when no layout was fitted. */
  cropM2: number;
  /** weed / (weed + crop), null without crop cover in the cell. */
  relativeCover: number | null;
  /** Expected yield-loss band (shares) from Kropff & Spitters at the two q values, only before canopy closure. */
  lossBand: [number, number] | null;
  klass: PressureClass;
  /** Near the crop (mostly under the band, or touching a crown's margin): capped at the medium band on the map, caution not action. */
  nearCrop: boolean;
  /** Scenario 1: stepped up one class for many small objects before closure. */
  treatWhileSmall: boolean;
  tier: Tier;
  /** Objects in the cell seen by two or more photographs. */
  multiView: number;
  assessed: boolean;
  whyNot: (UncertainReason | "too little ground")[];
};

export type Escape = { id: string; centre: LatLng2; diameterM: number; areaM2: number; cell: string; views: number; tier: Tier };

export type PressurePatch = { id: string; cells: string[]; areaM2: number; meanCover: number; maxCover: number; weedM2: number; rank: number; priority: boolean; centre: LatLng2 };

export type PressureSummary = {
  cells: number; assessed: number; notAssessed: number;
  /** Why cells were not assessed, by reason (Stage 1's reasons, and "too little ground" for the grade's own floor). */
  whyNot: Record<string, number>;
  byClass: Record<PressureClass, number>;
  confirmed: number; possible: number;
  /** Visible ground in cells at the action class or over, m². */
  actionAreaM2: number;
  highAreaM2: number;
  treatWhileSmall: number;
  /** Cells at the action point or over that sit against the crop: capped at medium on the map, caution not action. */
  nearCrop: number;
  /** The field as a whole: weed over visible ground across every assessed cell, and its class against the scheme. */
  fieldCover: number;
  fieldClass: PressureClass;
  /** The treatment unit the classes were judged over, metres across (unitM rounded up to whole cells). */
  unitM: number;
  escapes: number;
  patches: number;
  priorityPatches: number;
  belowFloor: number;
  /** Median relative cover over cells at action or over, null when none. */
  medianRelativeCover: number | null;
  /** Assessed cells whose pixels and objects disagree by more than disagreeShare of the ground. */
  disagreeing: number;
};

export type PressureGrade = {
  version: string;
  crop: string | null;
  group: CropGroup;
  scheme: ClassScheme;
  params: GradeParams;
  /** The smallest object the grade can claim, metres (floorPx pixels at the map's pixel size). */
  detectionFloorM: number;
  canopyClosed: boolean | null;
  photoBased: boolean;
  cells: GradedCell[];
  patches: PressurePatch[];
  escapes: Escape[];
  summary: PressureSummary;
  notes: string[];
};

export const GRADE_VERSION = "pressure-v1";

const pctOf = (v: number) => `${(100 * v).toFixed(v < 0.1 ? 1 : 0)}%`;

/** Kropff & Spitters: yield loss as a share from the weed's share of total cover at competitiveness q. */
export const kropffLoss = (lw: number, q: number) => (q * lw) / (1 + (q - 1) * lw);

const median = (v: number[]): number | null => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };

/** The crop's crown area per cell from the planting layout, m², by the cell each crown's centre falls in; and the cells any crown's margin touches. */
function crownsByCell(rows: FieldRows | null, g: GridFrame, marginM: number): { area: Map<string, number>; touched: Set<string> } {
  const area = new Map<string, number>(), touched = new Set<string>();
  if (!rows) return { area, touched };
  for (const c of rows.ctx.crops) {
    const q = latLngOfPx(rows.left + c.x, rows.top + c.y, rows.z);
    const [X, Y] = mercatorPx(q.lat, q.lng, g.z);
    const cell = cellAt(g, X, Y);
    if (cell && rows.source === "layout") { const k = cellKey(cell.i, cell.j); area.set(k, (area.get(k) ?? 0) + Math.PI * (c.r * rows.mpp) ** 2); }
    // Every cell the crown's margin reaches into.
    const rPx = (c.r * rows.mpp + marginM) / g.mpp;
    const i0 = Math.floor((X - rPx - g.left) / g.cellPx), i1 = Math.floor((X + rPx - g.left) / g.cellPx), j0 = Math.floor((Y - rPx - g.top) / g.cellPx), j1 = Math.floor((Y + rPx - g.top) / g.cellPx);
    for (let j = Math.max(0, j0); j <= Math.min(g.ny - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(g.nx - 1, i1); i++) {
      // Nearest point of the cell to the crown's centre.
      const nx = Math.max(g.left + i * g.cellPx, Math.min(X, g.left + (i + 1) * g.cellPx)), ny = Math.max(g.top + j * g.cellPx, Math.min(Y, g.top + (j + 1) * g.cellPx));
      if (Math.hypot(nx - X, ny - Y) <= rPx) touched.add(cellKey(i, j));
    }
  }
  return { area, touched };
}

export function gradePressure(input: {
  objects: WeedObject[];
  grid: GridFrame;
  cells: Stage1Cell[];
  rows: FieldRows | null;
  crop: string | null;
  group?: CropGroup;
  canopyClosed: boolean | null;
  /** The plants came from the kept photographs (seen-in counts mean something) rather than from the map. */
  photoBased: boolean;
  params?: Partial<GradeParams>;
}): PressureGrade {
  const P = { ...DEFAULT_GRADE, ...(input.params ?? {}) };
  const g = input.grid;
  const group = input.group ?? cropGroupOf(input.crop, input.rows?.source === "layout");
  const scheme = schemeFor(group, input.crop);
  const cellM2 = (g.cellPx * g.mpp) ** 2;
  const floorM = P.floorPx * g.mpp;
  const crowns = crownsByCell(input.rows, g, P.nearCropMarginM);

  // The weeds between the rows, by cell; objects under the floor counted apart. A weed on a row by the field's own
  // rows is the crop, whichever system found it.
  type Obj = { p: WeedObject; d: number };
  const byCell = new Map<string, Obj[]>();
  let belowFloor = 0;
  for (const p of input.objects) {
    if (p.onRow || !(p.areaM2 > 0)) continue;
    if (input.rows && isOnRow(fieldRowStatusAt(input.rows, p.centre))) continue;
    const d = p.diameterM;
    if ((p.px != null && p.px < P.floorPx) || d < floorM) { belowFloor++; continue; }
    const [X, Y] = mercatorPx(p.centre.lat, p.centre.lng, g.z);
    const c = cellAt(g, X, Y);
    if (!c) continue;
    const k = cellKey(c.i, c.j);
    (byCell.get(k) ?? byCell.set(k, []).get(k)!).push({ p, d });
  }

  const cells: GradedCell[] = [];
  const escapes: Escape[] = [];
  for (const s of input.cells) {
    const objs = byCell.get(s.key) ?? [];
    const groundM2 = cellM2 * s.imagedShare * (1 - s.bandShare);
    const assessed = s.uncertain.length === 0 && groundM2 >= P.minGroundShare * cellM2;
    const whyNot: GradedCell["whyNot"] = assessed ? [] : s.uncertain.length ? s.uncertain : ["too little ground"];
    // Cover from the map's own measure (Stage 1: off-row green over the visible ground): a spot list is ranked and
    // capped, the pixels are not. The count and the sizes from the objects when there are any, else Stage 1's blobs.
    const objM2 = objs.reduce((a, o) => a + (o.p.areaM2 ?? 0), 0);
    const pixelM2 = Math.min(groundM2, s.offRowGreenM2);
    const weedM2 = pixelM2;
    const pixelBlobs = Math.round(s.density * groundM2);
    const count = objs.length ? objs.length : pixelBlobs;
    const disagreement = objs.length && groundM2 > 0 ? Math.abs(pixelM2 - objM2) / groundM2 : null;
    const cover = groundM2 > 0 ? Math.min(1, weedM2 / groundM2) : 0;
    const density = groundM2 > 0 ? count / groundM2 : 0;
    // Sizes from the objects when there are any; else the mean blob of the pixels.
    const ds = objs.length ? objs.map(o => o.d) : pixelBlobs > 0 && pixelM2 > 0 ? [2 * Math.sqrt(pixelM2 / pixelBlobs / Math.PI)] : [];
    const cropM2 = crowns.area.get(s.key) ?? (input.rows ? cellM2 * s.imagedShare * s.bandShare : 0);
    const nearCrop = assessed && (1 - s.bandShare < P.nearCropGroundShare || crowns.touched.has(s.key));
    const relativeCover = cropM2 > 0 || weedM2 > 0 ? (weedM2 + cropM2 > 0 ? weedM2 / (weedM2 + cropM2) : null) : null;
    const lossBand: [number, number] | null = relativeCover != null && input.canopyClosed === false
      ? [kropffLoss(relativeCover, Math.min(...P.kropffQ)), kropffLoss(relativeCover, Math.max(...P.kropffQ))]
      : null;
    const med = median(ds);
    const multiView = objs.filter(o => o.p.views >= 2).length;
    // The class, the step-up and the tier are judged over the treatment unit below, once every cell is read.
    cells.push({
      key: s.key, i: s.i, j: s.j, centre: s.centre, ring: s.ring,
      cover: assessed ? cover : 0, groundM2, weedM2, count, objects: objs.length, objectM2: objM2, disagreement, density, medianDiameterM: med, maxDiameterM: ds.length ? Math.max(...ds) : null,
      unitCover: 0, unitGroundM2: 0, unitCount: 0, unitObjects: 0, unitMedianDiameterM: null,
      cropM2, relativeCover: assessed ? relativeCover : null, lossBand: assessed ? lossBand : null,
      klass: "none", nearCrop, treatWhileSmall: false, tier: "none", multiView, assessed, whyNot,
    });
    for (const o of objs) {
      if (o.d < P.escapeDiameterM || !o.p.centre) continue;
      escapes.push({ id: o.p.id, centre: o.p.centre, diameterM: o.d, areaM2: o.p.areaM2, cell: s.key, views: o.p.views, tier: !input.photoBased || o.p.views >= 2 ? "confirmed" : "possible" });
    }
  }
  escapes.sort((a, b) => b.diameterM - a.diameterM);

  // The treatment unit: a cell's class is judged over the window of cells around it that a sprayer section or a hoe
  // treats together (P.unitM across, rounded up to whole cells), weed over ground summed across the assessed cells in
  // it. A lone 20 cm plant is 12% of a 0.5 m cell and 3% of a square metre: judged at the unit it is a plant, not a
  // patch, and a patch the grid cut reads whole (the operator, 2026-10-22: "so much red; how do we know what to show
  // the agronomist"). The cell keeps its own cover for the card.
  const cellM = Math.sqrt(cellM2);
  const r = Math.max(0, Math.ceil((P.unitM / cellM - 1) / 2 - 0.01)); // a cell within 2% of the unit is the unit
  const unitSideM = (2 * r + 1) * cellM;
  const byKey = new Map(cells.map(c => [c.key, c]));
  for (const c of cells) {
    if (!c.assessed) continue;
    let weed = 0, ground = 0, count = 0, objects = 0, blobs = 0, blobM2 = 0;
    const diameters: number[] = [];
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const n = byKey.get(cellKey(c.i + di, c.j + dj));
      if (!n || !n.assessed) continue;
      weed += n.weedM2; ground += n.groundM2; count += n.count; objects += n.objects;
      for (const o of byCell.get(n.key) ?? []) diameters.push(o.d);
      if (!n.objects) { blobs += n.count; blobM2 += n.weedM2; }
    }
    c.unitGroundM2 = ground; c.unitCount = count; c.unitObjects = objects;
    c.unitMedianDiameterM = diameters.length ? median(diameters) : blobs > 0 && blobM2 > 0 ? 2 * Math.sqrt(blobM2 / blobs / Math.PI) : null;
    c.unitCover = ground > 0 ? Math.min(1, weed / ground) : 0;
    let klass = classOf(c.unitCover, count, scheme);
    const unitDensity = ground > 0 ? count / ground : 0;
    c.treatWhileSmall = input.canopyClosed !== true && count >= 2 && unitDensity >= P.denseObjectsPerM2 && c.unitMedianDiameterM != null && c.unitMedianDiameterM < P.smallDiameterM && klass !== "none" && klass !== "high";
    if (c.treatWhileSmall) klass = stepUp(klass);
    c.klass = klass;
    const corroborated = c.unitCover >= P.corroborateCover || objects >= P.corroborateCount;
    c.tier = count === 0 ? "none" : corroborated && (!input.photoBased || c.multiView >= 1) ? "confirmed" : "possible";
  }
  // Patches: 8-connected assessed cells at the patch cover or over (judged at the unit), ranked by weed area: the
  // most weed first is "treat first".
  const on = new Set(cells.filter(c => c.assessed && c.unitCover >= P.patchCover).map(c => c.key));
  const seen = new Set<string>();
  const patches: PressurePatch[] = [];
  for (const k of on) {
    if (seen.has(k)) continue;
    const members: GradedCell[] = [];
    const stack = [k]; seen.add(k);
    while (stack.length) {
      const cur = byKey.get(stack.pop()!)!;
      members.push(cur);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const nk = cellKey(cur.i + di, cur.j + dj);
        if (on.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
    const areaM2 = members.reduce((a, c) => a + c.groundM2, 0), weedM2 = members.reduce((a, c) => a + c.weedM2, 0);
    const meanCover = areaM2 > 0 ? weedM2 / areaM2 : 0;
    const lat = members.reduce((a, c) => a + c.centre.lat, 0) / members.length, lng = members.reduce((a, c) => a + c.centre.lng, 0) / members.length;
    patches.push({ id: `patch-${members[0].key}`, cells: members.map(c => c.key), areaM2, meanCover, maxCover: Math.max(...members.map(c => c.cover)), weedM2, rank: 0, priority: areaM2 >= P.patchPriorityAreaM2 || meanCover >= scheme.high, centre: { lat, lng } });
  }
  patches.sort((a, b) => b.weedM2 - a.weedM2 || b.areaM2 - a.areaM2);
  patches.forEach((p, n) => { p.rank = n + 1; });

  const byClass = Object.fromEntries(CLASS_ORDER.map(k => [k, 0])) as Record<PressureClass, number>;
  for (const c of cells) if (c.assessed) byClass[c.klass]++;
  const assessedCells = cells.filter(c => c.assessed);
  const over = (k: PressureClass) => assessedCells.filter(c => CLASS_ORDER.indexOf(c.klass) >= CLASS_ORDER.indexOf(k));
  const whyNot: Record<string, number> = {};
  for (const c of cells) if (!c.assessed) for (const w of c.whyNot) whyNot[w] = (whyNot[w] ?? 0) + 1;
  const fieldGround = assessedCells.reduce((a, c) => a + c.groundM2, 0), fieldWeed = assessedCells.reduce((a, c) => a + c.weedM2, 0);
  const fieldCover = fieldGround > 0 ? Math.min(1, fieldWeed / fieldGround) : 0;
  const summary: PressureSummary = {
    cells: cells.length, assessed: assessedCells.length, notAssessed: cells.length - assessedCells.length, whyNot,
    byClass,
    confirmed: cells.filter(c => c.tier === "confirmed").length, possible: cells.filter(c => c.tier === "possible").length,
    actionAreaM2: over("action").reduce((a, c) => a + c.groundM2, 0),
    highAreaM2: over("high").reduce((a, c) => a + c.groundM2, 0),
    treatWhileSmall: cells.filter(c => c.treatWhileSmall).length,
    nearCrop: cells.filter(c => c.nearCrop && CLASS_ORDER.indexOf(c.klass) >= CLASS_ORDER.indexOf("action")).length,
    fieldCover, fieldClass: assessedCells.length ? classOf(fieldCover, assessedCells.reduce((a, c) => a + c.count, 0), scheme) : "none", unitM: unitSideM,
    escapes: escapes.length, patches: patches.length, priorityPatches: patches.filter(p => p.priority).length,
    belowFloor,
    medianRelativeCover: median(over("action").map(c => c.relativeCover).filter((v): v is number => v != null)),
    disagreeing: assessedCells.filter(c => c.disagreement != null && c.disagreement > P.disagreeShare).length,
  };

  const cm = (m: number) => `${Math.round(m * 100)} cm`;
  const notes: string[] = [];
  notes.push(`Cover is green canopy over the visible ground between the rows, measured from the map's own pixels after the crop rows and crowns are taken out, so no patch between the rows is skipped; greenness only decides what is a plant. Ground within the row band (half a metre each side of a row line) and 0.3 m around a crown is not assessed. Classes: ${scheme.source}.`);
  if (assessedCells.length >= 20 && over("action").length > 0.6 * assessedCells.length) notes.push("More than six in ten cells read at the action point or over: the ground between the rows may be a managed cover (a sward or cover crop) rather than weeds. If so, the alleys are cover, not pressure.");
  notes.push(`The smallest weed this grade can claim is about ${cm(floorM)} across (${P.floorPx} pixels at this map's ${(g.mpp * 100).toFixed(1)} cm a pixel)${belowFloor ? `; ${belowFloor} smaller object${belowFloor === 1 ? "" : "s"} counted as below the floor` : ""}.`);
  if (input.canopyClosed === true) notes.push("The canopy reads as closed: weeds under it are not seen, and no loss band is given. Grades after canopy closure under-count (Goldsmith 2025; Allmendinger 2024).");
  if (summary.treatWhileSmall) notes.push(`${summary.treatWhileSmall} cell${summary.treatWhileSmall === 1 ? "" : "s"} stepped up one class for many small weeds: scattered small weeds compete harder than clumped ones and are easiest to treat while small.`);
  notes.push(`Classes are judged over a ${unitSideM.toFixed(1)} m treatment unit around each cell, not the cell alone: a lone plant is not a patch, and a patch the grid cut reads whole. Published action points were measured at that scale (Peña 2013; the Turkish guides' orchard mean; Paice 1998).`);
  if (CLASS_ORDER.indexOf(summary.fieldClass) >= CLASS_ORDER.indexOf("action")) notes.push(group === "orchard"
    ? `The floor as a whole reads at the action point (${pctOf(fieldCover)} cover): a floor pass first (mowing, hoeing or tillage; the Turkish guides bar non-selective herbicides where trunks are not yet woody), then the worst areas, ranked first in the list.`
    : `The field as a whole reads at the action point (${pctOf(fieldCover)} cover between the rows): a whole-field pass rather than spot work; the worst areas are ranked first in the list.`);
  if (summary.nearCrop) notes.push(`${summary.nearCrop} cell${summary.nearCrop === 1 ? "" : "s"} at the action point sit against the crop (mostly under the row band, or touching a crown's margin): shown as medium, not high. Green there may be the crop's own rim, and a scrap of ground reads any leaf as high cover. Look before acting.`);
  if (summary.disagreeing) notes.push(`${summary.disagreeing} cell${summary.disagreeing === 1 ? "" : "s"} where the map's pixels and the weeds found differ by more than ${pctOf(P.disagreeShare)} of the ground: cover is read from the pixels, the count from the weeds found; look at ${summary.disagreeing === 1 ? "it" : "them"} before acting.`);
  if (summary.escapes) notes.push(`${summary.escapes} large escape${summary.escapes === 1 ? "" : "s"} (${cm(P.escapeDiameterM)} across or more): a seed and resistance risk apart from any cell's class.`);
  if (summary.notAssessed) notes.push(`${summary.notAssessed} cell${summary.notAssessed === 1 ? " was" : "s were"} not assessed (no rows read, partly imaged, mostly crop row, or in shadow): not weed-free, unseen.`);
  notes.push(`"Possible" cells and escapes are kept for review, never dropped: a missed weed costs more than a false mark (every source), and nobody reaches zero false marks (best published 2 to 5%).`);

  return { version: GRADE_VERSION, crop: input.crop, group, scheme, params: P, detectionFloorM: floorM, canopyClosed: input.canopyClosed, photoBased: input.photoBased, cells, patches, escapes, summary, notes };
}

/** One line for the panel: the field in the operator's terms. */
export function pressureLine(gr: PressureGrade, fmtArea: (m2: number) => string): string {
  const s = gr.summary;
  if (!s.assessed) {
    if (!s.cells) return "No cell could be assessed: the read produced no cells inside the field boundary.";
    const why = Object.entries(s.whyNot).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
    return `No cell could be assessed: ${s.cells} cells read, none judged (${why}).`;
  }
  const at = s.byClass.action + s.byClass.high;
  const parts = [`Field as a whole: ${pctOf(s.fieldCover)} cover, ${CLASS_LABEL[s.fieldClass]} (action at ${pctOf(gr.scheme.action)})`, `${s.assessed} cells assessed`];
  parts.push(at ? `${at} at the action point or over (${fmtArea(s.actionAreaM2)} of ground)` : "none at the action point");
  if (s.priorityPatches) parts.push(`${s.priorityPatches} priority patch${s.priorityPatches === 1 ? "" : "es"}`);
  if (s.escapes) parts.push(`${s.escapes} large escape${s.escapes === 1 ? "" : "s"}`);
  if (s.possible) parts.push(`${s.possible} possible, for review`);
  return parts.join("; ") + ".";
}
