// Weed Scout: the experimental, developer-mode replacement for the treatment
// grid. Shared types for the whole pipeline.
//
// WHAT THIS IS. A port of the `offrow/` research track into the browser, wired
// to the scan on screen. The one idea carries over unchanged: do not learn what
// corn looks like, learn where corn is. Rows sit at a spacing the grower knows,
// so vegetation between rows is by construction not the planted crop. On top
// of that sits a two-scale anomaly pass (what does not look like the rest of
// this field, and what does not look like its own neighbourhood), a region
// step that turns touching not-average tiles into one shape with an area, a
// full-depth sweep of the interior for the small things, and an "event
// context" (place, local time, season, weather) that travels with every
// observation into the archive.
//
// NOTHING EXTERNAL. Every number here is computed in the browser from the
// pixels, the boundary and the operator's own past verdicts. The description
// step (describe.ts) is rules plus retrieval over the archive, not a model
// anyone else runs.
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
  /** Past verdicts to learn from, already loaded. Empty is fine. */
  feedback?: FeedbackRow[];
};

export type ScoutParams = {
  /** Analysis tile edge in metres. Ground units, never pixels. */
  tileM: number;
  /** Grower-stated row spacing in metres. 0.762 is 30 inches. */
  rowSpacingM: number;
  /** Inward buffer from the boundary that is excluded before scoring. */
  headlandM: number;
  /** Deviation at which a tile is a CORE not-average tile, in scaled units. */
  anomalyZ: number;
  /**
   * In-row band as a fraction of row spacing. A blob further than this from
   * the nearest centreline is off-row.
   */
  bandFrac: number;
  /** Smallest blob kept, in square centimetres of ground. */
  minBlobCm2: number;
  /** Deviation at which a single plant is an outlier among the field's plants. */
  blobZ: number;
  /** Touching flagged tiles below this count stay points rather than regions. */
  minRegionTiles: number;
  /** Whether to sweep the interior at full depth for small things. */
  sweep: boolean;
  /** Ceiling on full-depth windows; the zoom backs off to stay under it. */
  maxSweepWindows: number;
  /** Chips rendered for the top candidates after ranking. */
  maxChips: number;
};

export const DEFAULT_SCOUT_PARAMS: ScoutParams = {
  tileM: 3,
  rowSpacingM: 0.762,
  headlandM: 15,
  anomalyZ: 3.5,
  bandFrac: 0.3,
  minBlobCm2: 1,
  blobZ: 3.5,
  minRegionTiles: 2,
  sweep: true,
  maxSweepWindows: 400,
  maxChips: 120,
};

/** Fraction of `anomalyZ` a neighbour must reach to be grown into a region. */
export const GROW_FRACTION = 0.6;

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

export type TileFeatureName = (typeof TILE_FEATURE_NAMES)[number];

/** Indices that matter to the rules. Named so the rules read. */
export const F = {
  redShare: 0, greenShare: 1, blueShare: 2,
  brightness: 3, brightnessSd: 4,
  exg: 5, exgSd: 6,
  ngrdi: 7,
  vegetation: 8,
} as const;

export type TileSample = {
  tileId: string;
  pixelCount: number;
  features: number[];
  usable: boolean;
  /** Fraction of usable pixels the vegetation mask called vegetation. */
  vegetationFraction: number;
};

export type Driver = {
  feature: TileFeatureName;
  /** Signed deviation in scaled units; positive is above the field's typical value. */
  z: number;
  /** Which comparison produced it. */
  scale: "field" | "local";
};

/** Every tile's deviation, whether or not it crossed a threshold. */
export type TileScore = {
  tileId: string;
  /** Signed field-scale deviation per feature. */
  fieldZ: number[];
  /** Signed neighbourhood-scale deviation per feature. */
  localZ: number[];
  /** The number thresholds and ranks apply to: the leader when supported, else the support alone. */
  strength: number;
  /** Largest non-brightness deviation regardless of support; hysteresis grows on it. */
  leader: number;
  /** The two strongest drivers, strongest first. */
  drivers: Driver[];
  /** Whether the strongest driver had support (a second feature, or was overwhelming). */
  supported: boolean;
};

export type TileFlag = {
  tileId: string;
  /** Alias of the tile's strength, kept for readers that only want one number. */
  z: number;
  feature: TileFeatureName;
  direction: "above" | "below";
  drivers: Driver[];
};

/** How a region reads, from the direction of its deviations. Descriptive, never a verdict. */
export type RegionClass =
  | "bare or dry ground"
  | "dark ground (wet, shadow or residue)"
  | "thin stand"
  | "dense vegetation"
  | "pale vegetation"
  | "greener than the field"
  | "different from the field";

/** Touching not-average tiles, grown by hysteresis into one shape. */
export type Region = {
  id: string;
  tileIds: string[];
  /** Outline rings on the tile lattice; the first is the outer ring. */
  rings: LatLng2[][];
  centroid: LatLng2;
  /** Tile count times tile area; edge tiles are counted whole. */
  areaM2: number;
  tileCount: number;
  /** Tiles that crossed the core threshold on their own. */
  coreTiles: number;
  meanStrength: number;
  maxStrength: number;
  /** Mean signed field deviation per feature over the region. */
  meanFieldZ: number[];
  drivers: Driver[];
  klass: RegionClass;
};

/** One connected vegetation component, in ground units. */
export type Blob = {
  id: string;
  tileId: string;
  centroid: LatLng2;
  areaM2: number;
  equivDiameterM: number;
  widthM: number;
  heightM: number;
  extent: number;
  chromaR: number;
  chromaG: number;
  chromaB: number;
  exgMean: number;
  brightness: number;
  /** Ground sample distance the blob was measured at. */
  gsdM: number;
  touchesBorder: boolean;
  /** Metres to the nearest fitted row centreline, when a window fit was available. */
  distanceToRowM?: number | null;
  /** Confidence of the fit that distance came from. */
  rowConfidence?: number | null;
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

export type CandidateKind =
  | "not-average region"
  | "field outlier"
  | "off-row vegetation"
  | "vegetation outlier"
  | "off-row and outlier";

/** What the archive said about candidates like this one. */
export type Feedback = {
  /** Archived neighbours the operator marked as a weed. */
  confirmed: number;
  /** Archived neighbours the operator marked crop or not vegetation. */
  dismissed: number;
  /** Species or group text those neighbours carried, most common first. */
  species: string[];
  /** Score multiplier that was applied. */
  factor: number;
};

/** The in-house description. Rules and retrieval, computed in the browser. */
export type Estimate = {
  model: "swathwise-inhouse-v1";
  summary: string;
  sizeClass: string;
  habit: string | null;
  colourNote: string | null;
  positionNote: string;
  seasonNote: string;
  whatWouldConfirm: string[];
  caveats: string[];
};

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
  /** The tile's strength when it was flagged. */
  anomalyZ: number | null;
  anomalyFeature: string | null;
  /** Deviation of this plant from the field's plants, when that is why it is here. */
  blobZ: number | null;
  blobZFeature: string | null;
  /**
   * The vegetation component behind this candidate, or null when the
   * candidate is a tile or a region rather than a plant.
   */
  blob: Blob | null;
  /** The region this candidate IS, for region candidates. */
  region: Region | null;
  /** Ground area, for regions; the blob's area for plants. */
  areaM2: number;
  feedback: Feedback | null;
  estimate: Estimate | null;
  /** PNG data URL of the chip, when one was rendered. */
  chip: string | null;
  chipSpanM: number | null;
  chipGsdM: number | null;
};

export type ScoutStage =
  | "stitching" | "tiling" | "masking" | "baseline" | "regions" | "rows" | "blobs"
  | "sweeping" | "ranking" | "chips" | "done";

export type ScoutProgress = {
  stage: ScoutStage;
  /** 0..1 within the stage, or null when the stage is indivisible. */
  fraction: number | null;
  note?: string;
};

/** A past verdict, as the pipeline consumes it. */
export type FeedbackRow = {
  kind: CandidateKind;
  verdict: "weed" | "crop" | "not_vegetation" | "unsure";
  species: string | null;
  /** Feature vector as featureVectorOf() produced it when the row was saved. */
  vector: number[];
  fieldId: string | null;
};

export type SweepStats = {
  ran: boolean;
  windows: number;
  gsdM: number | null;
  /** Zoom levels backed off from the deepest baked zoom to fit the budget. */
  backedOff: number;
  /** Windows whose imagery failed to load. */
  failed: number;
  /** Windows whose own row fit was trusted. */
  rowWindows: number;
};

export type ScoutResult = {
  tiles: AnalysisTile[];
  samples: TileSample[];
  scores: TileScore[];
  flags: TileFlag[];
  regions: Region[];
  rows: RowModel | null;
  candidates: Candidate[];
  /** Ground sample distance of the base pass, metres per pixel. */
  gsdM: number;
  sweep: SweepStats;
  missingTiles: number;
  /** Tiles the baseline was computed over. */
  baselineTiles: number;
  /** Plants measured across the field, and the size below which they cannot be. */
  blobCount: number;
  smallestMeasurableM: number;
  /** Plain-language notes the UI shows verbatim. */
  notes: string[];
  startedAt: string;
  finishedAt: string;
};
