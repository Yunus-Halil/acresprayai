// Vegetation structure: what the vegetation off the planting pattern IS, at
// the scale the imagery can support. Three things, never confused:
//
//   individual   one vegetation object the imagery can measure on its own:
//                at least `minPixelsAcross` across at this pixel size, not
//                touching another, not cut by the edge
//   cluster      vegetation objects whose canopies touch or come within
//                `clusterGapM` of one another, so no single one can be
//                measured on its own. Its canopy area is the sum of its
//                members' mask pixels; its footprint is the hull around them;
//                its plant count is not claimed
//   zone         a cell of the field holding vegetation too small to measure
//                one by one (fragments under the component floor, and objects
//                under the measurable size): coverage, area and density, no
//                circles
//
// Every mask pixel is in exactly one account: crop (on the pattern), an
// individual, a cluster, a zone's micro vegetation, or cut by the edge. The
// accounting says so and a test holds it to that.
//
// "Detect at the finest reliable scale, display at the most useful scale,
// never confuse the two": the minimum measurable size is the pixel floor
// times the pixel size, so a 3 cm/px map gives 18 cm and a 1 cm/px photo 6
// cm, and the same structure is read from each with its scale on the record.
// Nothing here calls anything a weed: an individual off the pattern is a
// candidate for a person.

export const STRUCTURE_VERSION = "veg-structure-v1";

export type VegClass = "off-pattern" | "crop" | "unplaced" | "fragment";

/** One vegetation object in a local metric frame (any orientation: only distances and areas are read). */
export type VegItem = {
  id: string;
  x: number;
  y: number;
  areaM2: number;
  equivDiameterM: number;
  cls: VegClass;
  /** Off the row, or on the row between crop plants, when the pattern placed it. */
  kind?: "off-row" | "between plants" | null;
  touchesBorder?: boolean;
  /** The item's box, metres, when known: a strip is told from a plant by it. */
  widthM?: number;
  heightM?: number;
  /** Outside the field's boundary: counted, never grouped. */
  outside?: boolean;
  /** Fragments only: how many fragments this item stands for (one cell's worth). */
  count?: number;
};

export type StructureParams = {
  /** Under this many pixels across an object is not measured on its own; its area goes to a zone. */
  minPixelsAcross: number;
  /** Two canopies closer than this, edge to edge in metres, are one cluster. */
  clusterGapM: number;
  /** Zone cell edge, metres. */
  cellM: number;
  /** A cell becomes a zone when its micro vegetation covers at least this share of it... */
  zoneMinCoverage: number;
  /** ...or holds at least this many fragments and sub-measurable objects. */
  zoneMinCount: number;
};

export const DEFAULT_STRUCTURE_PARAMS: StructureParams = {
  minPixelsAcross: 6,
  clusterGapM: 0.15,
  cellM: 4,
  zoneMinCoverage: 0.001,
  zoneMinCount: 3,
};

export type Pt = { x: number; y: number };

export type Individual = {
  id: string;
  itemId: string;
  x: number;
  y: number;
  /** Mask pixels times the pixel's ground area. */
  areaM2: number;
  equivDiameterM: number;
  pixelsAcross: number;
  kind: "off-row" | "between plants" | null;
  /** False when no trusted row pattern placed this object: it is vegetation, not known to be off the crop. */
  rowsKnown: boolean;
};

export type Cluster = {
  id: string;
  /** Area-weighted centre. */
  x: number;
  y: number;
  members: string[];
  /** Mask components in the cluster. Not a plant count. */
  components: number;
  /** Sum of the members' canopy areas: the vegetation, not the ground between. */
  canopyAreaM2: number;
  /** The convex hull around the members' canopies, and its area: the ground the cluster stands on. */
  hull: Pt[];
  footprintAreaM2: number;
  boxWidthM: number;
  boxHeightM: number;
  maxExtentM: number;
  /** Never claimed in v1: no validated method counts plants in a clump. */
  plantCount: null;
  kinds: { offRow: number; between: number };
  rowsKnown: boolean;
  /** One component too long and thin to be one plant: continuous vegetation, given by length and width, never a diameter. */
  continuous: boolean;
  /** The longest axis and the extent across it, metres. */
  lengthM: number;
  widthM: number;
};

export type Zone = {
  id: string;
  col: number;
  row: number;
  x0: number; y0: number; x1: number; y1: number;
  /** The cell's ground, metres squared (a cell at the edge is clipped). */
  cellAreaM2: number;
  /** Vegetation too small to measure one by one: fragments plus sub-measurable objects. */
  microAreaM2: number;
  /** microAreaM2 over cellAreaM2. */
  coverage: number;
  /** Fragments and sub-measurable objects in the cell. */
  count: number;
  /** count per square metre of cell. */
  density: number;
  fragments: number;
  subMeasurable: number;
  /** Individuals and cluster members whose centres are in the cell: counted, NOT added to the micro area. */
  measurableObjects: number;
  rowsKnown: boolean;
};

export type Accounting = {
  /** Every item's area, metres squared. */
  totalM2: number;
  cropM2: number;
  individualsM2: number;
  clustersM2: number;
  /** In zones and in cells under the zone floor alike: all the micro vegetation. */
  microM2: number;
  /** Objects cut by the imagery's edge: not measured, not grouped. */
  borderM2: number;
  /** Objects outside the field's boundary: counted here, nowhere else. */
  outsideM2: number;
  counts: { items: number; crop: number; individuals: number; clusters: number; clusterMembers: number; micro: number; border: number; outside: number; zones: number; strips: number };
};

export type Structure = {
  version: string;
  params: StructureParams;
  gsdM: number;
  /** minPixelsAcross times gsdM: the smallest object measured on its own here. */
  minMeasurableM: number;
  individuals: Individual[];
  clusters: Cluster[];
  zones: Zone[];
  accounting: Accounting;
  notes: string[];
};

export function readStructureParams(v: unknown, fallback: StructureParams = DEFAULT_STRUCTURE_PARAMS): StructureParams {
  const o = (v ?? {}) as Partial<StructureParams>;
  const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : d);
  return {
    minPixelsAcross: num(o.minPixelsAcross, fallback.minPixelsAcross),
    clusterGapM: num(o.clusterGapM, fallback.clusterGapM),
    cellM: num(o.cellM, fallback.cellM),
    zoneMinCoverage: num(o.zoneMinCoverage, fallback.zoneMinCoverage),
    zoneMinCount: Math.round(num(o.zoneMinCount, fallback.zoneMinCount)),
  };
}
