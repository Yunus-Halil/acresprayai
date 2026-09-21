// Weed Scout: the experimental, developer-mode replacement for the treatment
// grid. Shared types for the whole pipeline.
//
// WHAT THIS IS. A port of the `offrow/` research track into the browser, wired
// to the scan on screen. The one idea carries over unchanged: do not learn what
// corn looks like, learn where corn is. Rows sit at a spacing the grower knows,
// so vegetation between rows is by construction not the planted crop. On top
// of that sits a field-baseline anomaly pass (what does not look like the rest
// of this field), a zoom-in step that re-reads the flagged ground at the
// deepest zoom the scan was baked at, and an "event context" (place, local
// time, season, weather) that travels with every observation into the
// database the species estimates will one day be built from.
//
// WHAT IT IS NOT. A verdict. Every output here is a candidate for a human to
// look at. Nothing in this module tree may call a blob a weed; the operator
// does that, on the record, with the chip in front of them.
import type { LatLng2 } from "../geo";

/** Everything the pipeline needs about the imagery, and nothing about the UI. */
export type ScoutInputs = {
  /** Field outline, WGS84, one or more rings. */
  boundary: LatLng2[][];
  /** Ortho tile URL with {z}/{x}/{y} placeholders, token included. */
  tileUrl: string;
  /** Deepest zoom the scan was baked at. */
  maxNative: number;
  params: ScoutParams;
};

export type ScoutParams = {
  /** Analysis tile edge in metres. Ground units, never pixels. */
  tileM: number;
  /** Grower-stated row spacing in metres. 0.762 is 30 inches. */
  rowSpacingM: number;
  /** Inward buffer from the boundary that is excluded before scoring. */
  headlandM: number;
  /** Robust z at which a tile counts as "not average". */
  anomalyZ: number;
  /**
   * In-row band as a fraction of row spacing. A blob further than this from
   * the nearest centreline is off-row.
   */
  bandFrac: number;
  /** Smallest blob kept, in square centimetres of ground. */
  minBlobCm2: number;
  /** How many flagged tiles the zoom step re-reads at full depth. */
  maxZoomTiles: number;
};

export const DEFAULT_SCOUT_PARAMS: ScoutParams = {
  tileM: 3,
  rowSpacingM: 0.762,
  headlandM: 15,
  anomalyZ: 3.5,
  bandFrac: 0.3,
  minBlobCm2: 1,
  maxZoomTiles: 24,
};

/** One analysis tile of the field. */
export type AnalysisTile = {
  id: string;
  col: number;
  row: number;
  ring: LatLng2[];
  centroid: LatLng2;
  /** True when part of the tile lies outside the boundary. */
  clipped: boolean;
  /** True when the centroid is within the headland buffer. */
  headland: boolean;
};

/** Field-baseline features per tile, aligned with TILE_FEATURE_NAMES. */
export const TILE_FEATURE_NAMES = [
  "red share", "green share", "blue share",
  "brightness", "brightness variation",
  "greenness (ExG)", "greenness variation",
  "green-red index",
  "vegetation fraction",
] as const;

export type TileSample = {
  tileId: string;
  pixelCount: number;
  features: number[];
  usable: boolean;
  /** Fraction of usable pixels the vegetation mask called vegetation. */
  vegetationFraction: number;
};

export type TileFlag = {
  tileId: string;
  /** Robust z of the most deviant feature, scaled-MAD units. */
  z: number;
  /** Which measurement drove it. */
  feature: string;
  /** Signed: above or below the field's typical value. */
  direction: "above" | "below";
};

/** One connected vegetation component, in ground units. */
export type Blob = {
  id: string;
  tileId: string;
  centroid: LatLng2;
  areaM2: number;
  equivDiameterM: number;
  /** Bounding box in metres, for the aspect a coarse leaf shape leaves. */
  widthM: number;
  heightM: number;
  extent: number;
  /** Mean chromaticity and greenness over the blob's pixels. */
  chromaR: number;
  chromaG: number;
  chromaB: number;
  exgMean: number;
  brightness: number;
  /** Ground sample distance the blob was measured at. */
  gsdM: number;
  touchesBorder: boolean;
};

export type RowTileFit = {
  centre: { x: number; y: number };
  sizeM: number;
  /** Degrees counterclockwise from ground +x (east), in [0, 180). */
  angleDeg: number;
  pitchM: number;
  phaseM: number;
  confidence: number;
  angleConfidence: number;
  pitchConfidence: number;
  vegetationFraction: number;
  pitchFromGrower: boolean;
  recoveredPitchM: number;
};

export type RowModel = {
  tiles: RowTileFit[];
  confidence: number;
  usable: boolean;
  medianAngleDeg: number;
  medianPitchM: number;
  /** Local metric frame origin the tile centres are expressed in. */
  origin: LatLng2;
};

export type CandidateKind = "off-row vegetation" | "field outlier" | "off-row and outlier";

/** One thing worth an operator's glance. Never a verdict. */
export type Candidate = {
  id: string;
  tileId: string;
  centroid: LatLng2;
  kind: CandidateKind;
  /** 0..1 rank score, higher first. */
  score: number;
  /** Metres from the nearest fitted row centreline, or null without a row model. */
  distanceToRowM: number | null;
  rowConfidence: number | null;
  /** The tile's anomaly flag, when it had one. */
  anomalyZ: number | null;
  anomalyFeature: string | null;
  /**
   * The vegetation component behind this candidate, or null when the
   * candidate is a whole tile that read as not-average without holding any
   * vegetation at all (a bare patch, standing water, residue). Those are
   * exactly the "not average things" the operator asked to be shown, so they
   * are not dropped for lacking a blob.
   */
  blob: Blob | null;
  /** PNG data URL of the zoomed-in chip around the blob, when the zoom step ran. */
  chip: string | null;
  /** Ground metres across the chip, so the reader knows the scale. */
  chipSpanM: number | null;
  /** GSD the chip was read at. */
  chipGsdM: number | null;
};

export type ScoutStage =
  | "stitching" | "tiling" | "masking" | "baseline" | "rows" | "blobs" | "zooming" | "ranking" | "done";

export type ScoutProgress = {
  stage: ScoutStage;
  /** 0..1 within the stage, or null when the stage is indivisible. */
  fraction: number | null;
  note?: string;
};

export type ScoutResult = {
  tiles: AnalysisTile[];
  samples: TileSample[];
  flags: TileFlag[];
  rows: RowModel | null;
  candidates: Candidate[];
  /** Ground sample distance of the base pass, metres per pixel. */
  gsdM: number;
  /** GSD of the zoom pass, or null when it did not run. */
  zoomGsdM: number | null;
  missingTiles: number;
  /** Tiles the baseline was computed over. */
  baselineTiles: number;
  /** Plain-language notes the UI shows verbatim. */
  notes: string[];
  startedAt: string;
  finishedAt: string;
};
