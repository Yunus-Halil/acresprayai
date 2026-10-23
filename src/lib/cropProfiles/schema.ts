// The Crop Intelligence Profile schema: what a crop profile under crop-profiles/<crop>/ must contain.
//
// One schema for every crop. A profile is a set of JSON documents (identity, planting, growth, morphology, visual,
// weeds, field conditions, imagery, algorithms, uncertainty, validation, references) listed by its manifest. The
// schemas here are the single source of truth: the JSON Schema files under crop-profiles/schema/ are generated from
// them (scripts/cropProfiles/emitSchemas.ts) and a test keeps the two in step.
//
// Four kinds of knowledge are kept apart, by file, on purpose:
//   reference knowledge   what credible research establishes (planting, growth, morphology, visual, weeds, field
//                         conditions, imagery): every consequential number carries its sources and evidence strength;
//   algorithm config      how Swardus uses that knowledge (algorithms.json): the only part the engine reads at run time;
//   validation evidence   what independent testing showed (validation.json): benchmarks that were run, failure cases;
//   field observations    never in a profile. What the imagery or the operator establishes about one field lives with
//                         the field (settings, layouts, scans) and outranks the profile wherever the two meet.
import { z } from "zod/v4";

export const PROFILE_SCHEMA_VERSION = "1.0.0";

const Id = z.string().regex(/^[a-z0-9][a-z0-9_.-]*$/, "ids are lowercase: letters, digits, dot, dash, underscore");
/** A source id from references.json. */
const SourceRef = z.string().min(1);

export const EvidenceStrength = z.enum([
  "strong",    // several independent measured sources, or a survey with a stated base
  "moderate",  // one measured source, or extension guidance restating trials
  "weak",      // a single secondary source, a vendor figure, or guidance without data
  "snippet",   // seen in a search result or abstract, full source not read
  "estimate",  // our own arithmetic or reading from other figures, labelled as such
  "none",      // not found; the value is a placeholder that must not be relied on
]);
export type EvidenceStrength = z.infer<typeof EvidenceStrength>;

export const Evidence = z.object({
  sources: z.array(SourceRef),
  strength: EvidenceStrength,
  /** Where the sources apply: a country, state, production system. */
  geography: z.string().optional(),
  /** Growth stages the value applies to, by stage id. */
  stages: z.array(z.string()).optional(),
  notes: z.string().optional(),
  /** When sources disagree: what they say and why, kept rather than averaged away. */
  disagreement: z.string().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const Range = z.object({ low: z.number(), high: z.number(), typical: z.number().optional() })
  .refine(r => r.low <= r.high, "range low must not exceed high")
  .refine(r => r.typical == null || (r.typical >= r.low && r.typical <= r.high), "typical must sit inside the range");
export type Range = z.infer<typeof Range>;

/** A measured or reported quantity: a value or a range, in a unit from shared/units.json, with its evidence. */
export const Quantity = z.object({
  unit: z.string(),
  value: z.number().optional(),
  range: Range.optional(),
  /** How the value is distributed where the source says so ("86% of acres", "median of 37 trials"). */
  distribution: z.string().optional(),
  evidence: Evidence,
}).refine(q => q.value != null || q.range != null, "a quantity needs a value or a range");
export type Quantity = z.infer<typeof Quantity>;

export const ProfileStatus = z.enum(["draft", "experimental", "validated"]);
export type ProfileStatus = z.infer<typeof ProfileStatus>;

export const CropGroup = z.enum(["wide-row", "cereal", "orchard"]);

export const CapabilityStatus = z.enum(["supported", "experimental", "unsupported"]);
export type CapabilityStatus = z.infer<typeof CapabilityStatus>;

/** The analyses a profile configures and whose readiness it states. */
export const CapabilityId = z.enum([
  "row-detection",
  "row-spacing",
  "planting-positions",
  "crop-vs-weed-by-position",
  "vegetation-segmentation",
  "between-row-weed-cover",
  "weed-pressure-grade",
  "hotspots",
  "weed-isolation",
  "weed-measurement",
  "species-priors",
  "stand-count",
  "growth-stage-from-imagery",
  "stage-estimate",
  "canopy-height",
]);
export type CapabilityId = z.infer<typeof CapabilityId>;

// ----------------------------------------------------------------------------------------------- manifest, identity

export const Manifest = z.object({
  id: Id,
  /** Profile version, semver. Bumped with CHANGELOG.md. */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  schemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: ProfileStatus,
  /** Documents, by domain, relative to the profile folder. */
  files: z.object({
    identity: z.string(), planting: z.string(), growth: z.string(), morphology: z.string(), visual: z.string(),
    weeds: z.string(), fieldConditions: z.string(), imagery: z.string(), algorithms: z.string(),
    uncertainty: z.string(), validation: z.string(), references: z.string(),
  }),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maintainers: z.array(z.string()).optional(),
});
export type Manifest = z.infer<typeof Manifest>;

export const Region = z.object({
  id: Id,
  name: z.string(),
  countries: z.array(z.string()).optional(),
  /** US state or province codes. */
  states: z.array(z.string()).optional(),
  notes: z.string().optional(),
});
export type Region = z.infer<typeof Region>;

export const Identity = z.object({
  id: Id,
  scientificName: z.string(),
  family: z.string(),
  commonNames: z.array(z.object({ name: z.string(), language: z.string(), region: z.string().optional() })),
  /** Names and spellings the field's crop setting may carry; matched lowercase, exact or as a whole word. */
  aliases: z.array(z.string()),
  cropGroup: CropGroup,
  growthHabit: z.enum(["annual-row-crop", "annual-drilled", "perennial-tree", "perennial-vine", "perennial-forage"]),
  productionTypes: z.array(z.object({ id: Id, name: z.string(), notes: z.string().optional() })),
  regionsCovered: z.array(Region),
  notes: z.string().optional(),
});
export type Identity = z.infer<typeof Identity>;

// ----------------------------------------------------------------------------------------------- planting

export const Planting = z.object({
  patterns: z.array(z.object({
    id: Id,
    /** A type id from shared/planting-pattern-types.json. */
    type: z.string(),
    name: z.string(),
    rowSpacingM: Quantity,
    /** Share of area planted this way, where a survey gives one. */
    share: Quantity.optional(),
    regions: z.array(z.string()),
    notes: z.string().optional(),
    evidence: Evidence,
  })),
  rowSpacing: z.object({
    /** What a field is assumed to be planted at until its imagery says otherwise. */
    defaultM: z.number().positive(),
    /** Every spacing a measured pitch is read against: the pitches growers actually plant. */
    candidatesM: z.array(z.object({ m: z.number().positive(), label: z.string(), regions: z.array(z.string()), share: z.number().min(0).max(1).optional(), sources: z.array(SourceRef) })),
    /** A measured pitch within this share of a candidate is taken as that candidate. */
    toleranceShare: z.number().min(0).max(0.5),
  }),
  inRowSpacing: z.object({
    rangeM: Range,
    /** Worked examples: a population at a row spacing gives an in-row spacing. */
    byPopulation: z.array(z.object({ plantsPerHa: z.number(), rowSpacingM: z.number(), inRowM: z.number(), note: z.string().optional() })),
    evidence: Evidence,
  }),
  population: z.array(z.object({ label: z.string(), plantsPerHa: Quantity, regions: z.array(z.string()) })),
  singulation: z.object({
    skipShare: Quantity.optional(),
    doubleShare: Quantity.optional(),
    spacingSdCm: Quantity.optional(),
    emergenceNotes: z.string().optional(),
    evidence: Evidence,
  }),
  planterGeometry: z.object({
    widthsRows: z.array(z.number().int().positive()),
    guessRowErrorCm: Quantity.optional(),
    autosteerPassErrorCm: Quantity.optional(),
    notes: z.string().optional(),
    evidence: Evidence,
  }),
  fieldGeometry: z.array(z.object({ id: Id, name: z.string(), description: z.string(), imageryEffect: z.string(), evidence: Evidence })),
  tillage: z.array(z.object({ id: Id, system: z.string(), share: Quantity.optional(), residueAppearance: z.string(), regions: z.array(z.string()), evidence: Evidence })),
  gaps: z.array(z.string()),
});
export type Planting = z.infer<typeof Planting>;

// ----------------------------------------------------------------------------------------------- growth

export const Stage = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().int(),
  phase: z.enum(["emergence", "vegetative", "reproductive", "maturity"]),
  definition: z.string(),
  /** Cumulative growing degree units from planting, in the thermal-time block's units and method. */
  gddF: Range.optional(),
  daysAfterPlanting: Range.optional(),
  heightCm: Range.optional(),
  leavesVisible: Range.optional(),
  canopyWidthCm: Range.optional(),
  /** Ground cover fraction by row spacing, where a source gives it. */
  coverFraction: z.array(z.object({ rowSpacingM: z.number(), range: Range, evidence: Evidence })).optional(),
  /** Whether the alley between rows is still visible from above. */
  alleyOpen: z.enum(["open", "closing", "closed"]),
  /** What an overhead RGB image shows at this stage, in words. */
  observable: z.array(z.string()),
  evidence: Evidence,
});
export type Stage = z.infer<typeof Stage>;

export const Growth = z.object({
  /** A system id from shared/growth-stage-systems.json. */
  stagingSystem: z.string(),
  thermalTime: z.object({
    baseF: z.number(),
    capF: z.number(),
    method: z.string(),
    plantingToEmergenceGddF: Quantity,
    gddPerStageEarly: Quantity,
    gddPerStageLate: Quantity,
    /** The stage after which the late rate applies. */
    lateFromStage: z.string(),
    evidence: Evidence,
  }),
  stages: z.array(Stage).min(2),
  closure: z.array(z.object({ rowSpacingM: z.number(), stage: z.string(), evidence: Evidence })),
  criticalPeriod: z.array(z.object({ condition: z.string(), startStage: z.string(), endStage: z.string(), evidence: Evidence })),
  /** The stages the profile is built to serve first. */
  priorityStages: z.array(z.string()),
  stageEstimation: z.object({
    /** How a stage may be estimated without seeing it, and how far off that can be. */
    methods: z.array(z.object({ id: Id, name: z.string(), inputs: z.array(z.string()), expectedErrorStages: Range, evidence: Evidence })),
    fromImagery: z.object({ status: CapabilityStatus, reason: z.string(), evidence: Evidence }),
  }),
  gaps: z.array(z.string()),
});
export type Growth = z.infer<typeof Growth>;

// ----------------------------------------------------------------------------------------------- morphology

export const Morphology = z.object({
  plant: z.object({
    habit: z.string(),
    leafArrangement: z.string(),
    leafShape: z.string(),
    leafOrientation: z.string(),
    notes: z.string().optional(),
    evidence: Evidence,
  }),
  leafDimensions: z.array(z.object({ leafNumber: z.string(), lengthCm: Range.optional(), widthCm: Range.optional(), evidence: Evidence })),
  byStage: z.array(z.object({
    stage: z.string(),
    projectedAreaCm2: Range.optional(),
    /** Pixels a plant covers at the given pixel size, where measured or estimated. */
    pixelsAtGsd: z.array(z.object({ gsdCm: z.number(), pixels: Range, evidence: Evidence })).optional(),
    touchingAlongRow: z.enum(["separate", "touching", "merged"]).optional(),
    notes: z.string().optional(),
    evidence: Evidence,
  })),
  /** Which features resolve at which pixel size: the basis of every capability gate. */
  resolvable: z.array(z.object({ feature: z.string(), minGsdCm: z.number(), stages: z.array(z.string()).optional(), evidence: Evidence })),
  /** Vocabulary ids from shared/morphology-vocabulary.json used above. */
  vocabulary: z.array(z.string()),
  variation: z.array(z.object({ id: Id, name: z.string(), effect: z.string(), evidence: Evidence })),
  gaps: z.array(z.string()),
});
export type Morphology = z.infer<typeof Morphology>;

// ----------------------------------------------------------------------------------------------- visual

export const FailureCondition = z.object({
  id: Id,
  condition: z.string(),
  /** What goes wrong: in segmentation, rows, cover, weeds, measurement. */
  effect: z.string(),
  affects: z.array(CapabilityId),
  /** Whether the image itself can reveal the condition, and how. */
  detectable: z.enum(["yes", "partly", "no"]),
  detection: z.string().optional(),
  /** The uncertainty code raised when detected, from shared/uncertainty-codes.json. */
  code: z.string().optional(),
  evidence: Evidence,
});
export type FailureCondition = z.infer<typeof FailureCondition>;

export const Visual = z.object({
  colour: z.object({
    normal: z.string(),
    variants: z.array(z.object({ id: Id, name: z.string(), appearance: z.string(), stages: z.array(z.string()).optional(), evidence: Evidence })),
  }),
  indices: z.array(z.object({ id: Id, name: z.string(), formula: z.string(), thresholds: z.string(), performance: z.string().optional(), evidence: Evidence })),
  illumination: z.array(z.object({ id: Id, name: z.string(), effect: z.string(), guidance: z.string().optional(), evidence: Evidence })),
  backgrounds: z.array(z.object({ id: Id, name: z.string(), appearance: z.string(), effectOnIndex: z.string(), evidence: Evidence })),
  orthomosaicArtefacts: z.array(z.object({ id: Id, name: z.string(), effect: z.string(), evidence: Evidence })),
  failureConditions: z.array(FailureCondition),
  gaps: z.array(z.string()),
});
export type Visual = z.infer<typeof Visual>;

// ----------------------------------------------------------------------------------------------- weeds

export const WeedAssociation = z.object({
  /** A species id from shared/weed-taxonomy/species.json. */
  speciesId: z.string(),
  prevalence: z.enum(["dominant", "common", "occasional", "regional"]),
  /** Ranks in surveys: which survey (source id), which list, which rank. */
  surveyRanks: z.array(z.object({ source: SourceRef, list: z.enum(["most-common", "most-troublesome"]), rank: z.number().int().positive(), year: z.number().int().optional() })).optional(),
  emergence: z.object({
    relativeToCrop: z.string(),
    /** Crop stages between which the main cohorts emerge, by stage id, where sources say. */
    cropStages: z.tuple([z.string(), z.string()]).optional(),
    months: z.array(z.number().int().min(1).max(12)).optional(),
    evidence: Evidence,
  }),
  habitAtPriorityStages: z.string().optional(),
  /** How easily the weed is mistaken for the crop from above at 1 to 5 cm a pixel. */
  lookAlikeWithCrop: z.enum(["high", "medium", "low"]),
  resolvableCues: z.array(z.object({ cue: z.string(), minGsdCm: z.number(), evidence: Evidence })).optional(),
  escapesAboveCanopy: z.boolean().optional(),
  resistanceNotes: z.string().optional(),
  evidence: Evidence,
});
export type WeedAssociation = z.infer<typeof WeedAssociation>;

export const Weeds = z.object({
  regions: z.array(z.object({
    /** A region id from identity.regionsCovered. */
    region: z.string(),
    surveys: z.array(z.object({ source: SourceRef, year: z.number().int(), list: z.enum(["most-common", "most-troublesome"]), respondents: z.string().optional(), ranked: z.array(z.string()) })),
    associations: z.array(WeedAssociation),
  })),
  spatialPatterns: z.array(z.object({ id: Id, pattern: z.string(), implication: z.string(), evidence: Evidence })),
  herbicideAftermath: z.array(z.object({ id: Id, appearance: z.string(), effectOnMask: z.string(), evidence: Evidence })),
  disambiguation: z.array(z.object({ id: Id, rule: z.string(), basis: z.string(), limits: z.string(), minGsdCm: z.number().optional(), evidence: Evidence })),
  gaps: z.array(z.string()),
});
export type Weeds = z.infer<typeof Weeds>;

// ----------------------------------------------------------------------------------------------- field conditions

export const FieldConditions = z.object({
  soils: z.array(z.object({ id: Id, name: z.string(), appearance: z.string(), regions: z.array(z.string()), effect: z.string(), evidence: Evidence })),
  residue: z.array(z.object({ id: Id, name: z.string(), appearance: z.string(), effect: z.string(), evidence: Evidence })),
  shadows: z.object({ description: z.string(), heightToShadowNote: z.string(), evidence: Evidence }),
  irrigation: z.array(z.object({ id: Id, system: z.string(), geometryEffect: z.string(), regions: z.array(z.string()), evidence: Evidence })),
  coverCrops: z.array(z.object({ id: Id, practice: z.string(), effect: z.string(), evidence: Evidence })),
  calendar: z.array(z.object({ region: z.string(), plantingWindow: z.string(), priorityStageWindow: z.string(), evidence: Evidence })),
  gaps: z.array(z.string()),
});
export type FieldConditions = z.infer<typeof FieldConditions>;

// ----------------------------------------------------------------------------------------------- imagery

export const Imagery = z.object({
  /** What each analysis needs from the pixels, and what the evidence is. */
  requirements: z.array(z.object({
    capability: CapabilityId,
    /** Coarsest pixel size the analysis is usable at. */
    maxGsdCm: z.number().positive(),
    recommendedGsdCm: z.number().positive().optional(),
    stages: z.array(z.string()).optional(),
    basis: z.string(),
    evidence: Evidence,
  })),
  flight: z.array(z.object({ id: Id, parameter: z.string(), guidance: z.string(), evidence: Evidence })),
  cameras: z.array(z.object({ id: Id, name: z.string(), gsdCmPerMetreAltitude: z.number().positive(), evidence: Evidence })),
  orthoVsFrames: z.array(z.object({ id: Id, topic: z.string(), guidance: z.string(), evidence: Evidence })),
  qualityChecks: z.array(z.object({ id: Id, check: z.string(), computedFrom: z.string(), threshold: z.string().optional(), code: z.string().optional(), evidence: Evidence })),
  gaps: z.array(z.string()),
});
export type Imagery = z.infer<typeof Imagery>;

// ----------------------------------------------------------------------------------------------- algorithms (the run-time contract)

export const RowReaderStrategy = z.enum(["continuous-row", "separate-plants", "drilled", "orchard-lattice"]);
export type RowReaderStrategy = z.infer<typeof RowReaderStrategy>;

export const ClassScheme = z.object({
  low: z.number().min(0).max(1),
  moderate: z.number().min(0).max(1),
  action: z.number().min(0).max(1),
  high: z.number().min(0).max(1),
  /** What the cover classes rest on, in a sentence the panel shows. */
  source: z.string(),
  /** "cover" when the sources act on cover; "provisional" when no source for this crop gives a cover action point. */
  basis: z.enum(["cover", "provisional"]),
  sources: z.array(SourceRef),
}).refine(s => s.low <= s.moderate && s.moderate <= s.action && s.action <= s.high, "class boundaries must be ordered");
export type ClassScheme = z.infer<typeof ClassScheme>;

export const Capability = z.object({
  status: CapabilityStatus,
  /** Coarsest pixel size the capability is offered at; coarser imagery disables it with a code. */
  maxGsdCm: z.number().positive().optional(),
  /** Stage ids between which it is offered (inclusive); outside them it is disabled with a code. */
  stages: z.tuple([z.string(), z.string()]).optional(),
  reason: z.string(),
  /** The validation benchmark ids that back the status, from validation.json. */
  validatedBy: z.array(z.string()).optional(),
});
export type Capability = z.infer<typeof Capability>;

export const Algorithms = z.object({
  rowReader: z.object({
    strategy: RowReaderStrategy,
    defaultSpacingM: z.number().positive(),
    candidatesM: z.array(z.number().positive()).min(1),
    pitchToleranceShare: z.number().min(0).max(0.5),
    /** Windows for the row fit, in rows of the default spacing, and the neighbourhood cap in metres. */
    windowRows: z.number().positive().nullable(),
    maxNeighbourhoodM: z.number().positive(),
    /** Vegetation fraction band a window can carry rows in: under it bare, over it a closed canopy. */
    vegetationFractionRange: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
    /** Rows read from brightness are checked against the green where the mask could carry rows (residue stripes). */
    verifyBrightnessAgainstVegetation: z.boolean(),
    /** Plants merge into a continuous line along the row from this stage at the stated pixel size. */
    continuousFromStage: z.string().optional(),
    rationale: z.string(),
    sources: z.array(SourceRef),
  }),
  plantingPositions: z.object({
    alongRangeM: Range,
    resolvableStages: z.tuple([z.string(), z.string()]).optional(),
    maxGsdCm: z.number().positive(),
    rationale: z.string(),
    sources: z.array(SourceRef),
  }),
  vegetation: z.object({
    index: z.enum(["exg-cive-otsu", "exgr"]),
    /**
     * The automatic (Otsu) vegetation threshold never falls below this: a split under the index of grey is splitting
     * soil from residue, not plants from ground. Null: no floor (the engine's crop-neutral behaviour).
     */
    indexFloor: z.number().nullable(),
    /**
     * A pixel is vegetation only if its ExGR (Meyer and Neto 2008, on chromaticity) is also above this: ExGR separates
     * straw (about -0.14) and soil (about -0.24) from green leaves (well above zero) where ExG with Otsu does not, since
     * bright yellow straw has a positive ExG. Null: no gate (crop-neutral behaviour).
     */
    exgrGate: z.number().nullable(),
    coverExgr: z.number(),
    canopyClosedShare: z.number().min(0).max(1),
    /** Expected ground cover by stage at the default row spacing, for the cover-versus-stage check. */
    expectedCoverByStage: z.array(z.object({ stage: z.string(), range: Range })),
    rationale: z.string(),
    sources: z.array(SourceRef),
  }),
  pressure: z.object({
    group: CropGroup,
    scheme: ClassScheme,
    /** Stages between which between-row cover is observable and the grade applies. */
    applicableStages: z.tuple([z.string(), z.string()]),
    grade: z.record(z.string(), z.number()),
    stage1: z.record(z.string(), z.union([z.number(), z.string()])),
    /** Action signals the sources actually use, reported beside the cover class. */
    actionSignals: z.object({
      weedHeightActionCm: z.number().positive().optional(),
      firstPassByStage: z.string().optional(),
      notes: z.string(),
      sources: z.array(SourceRef),
    }),
    rationale: z.string(),
  }),
  hotspots: z.object({ minObjectDiameterM: z.number().positive(), rationale: z.string() }),
  sourceFrames: z.object({ preferFramesForMeasurement: z.boolean(), maxGsdCm: z.number().positive(), rationale: z.string() }),
  weedMeasurement: z.object({ minPixelsAcross: z.number().int().positive(), sizeThresholdsCm: z.object({ small: z.number(), medium: z.number() }), rationale: z.string(), sources: z.array(SourceRef) }),
  species: z.object({ method: z.literal("environmental-priors-only"), rationale: z.string(), sources: z.array(SourceRef) }),
  consistency: z.object({
    /** A measured pitch further than this share from every candidate raises ROW_SPACING_UNEXPECTED. */
    rowSpacingMismatchShare: z.number().min(0).max(1),
    /** Row coherence under this with vegetation in range raises ROWS_UNCERTAIN. */
    minRowCoherence: z.number().min(0).max(1),
    /** Observed cover outside the stage's expected range by more than this (absolute share) raises COVER_STAGE_MISMATCH. */
    coverStageToleranceShare: z.number().min(0).max(1),
    rationale: z.string(),
  }),
  capabilities: z.partialRecord(CapabilityId, Capability),
});
export type Algorithms = z.infer<typeof Algorithms>;

// ----------------------------------------------------------------------------------------------- uncertainty

export const UncertaintyPolicy = z.object({
  /** A code from shared/uncertainty-codes.json. */
  code: z.string(),
  when: z.string(),
  action: z.enum(["note", "review", "disable"]),
  /** What the operator reads. */
  message: z.string(),
  affects: z.array(CapabilityId),
  sources: z.array(SourceRef).optional(),
});
export type UncertaintyPolicy = z.infer<typeof UncertaintyPolicy>;

export const Uncertainty = z.object({
  principles: z.array(z.string()),
  policies: z.array(UncertaintyPolicy),
  gaps: z.array(z.string()),
});
export type Uncertainty = z.infer<typeof Uncertainty>;

// ----------------------------------------------------------------------------------------------- validation

export const Benchmark = z.object({
  id: Id,
  name: z.string(),
  capability: CapabilityId,
  dataset: z.string(),
  licence: z.string().optional(),
  images: z.number().int().nonnegative(),
  gsdCm: z.string(),
  stages: z.array(z.string()),
  /** Field- or acquisition-level split; "none" when the data is development data. */
  split: z.string(),
  command: z.string(),
  codeRevision: z.string().optional(),
  date: z.string().optional(),
  /** Present only when the benchmark was actually run; numbers come from the result file. */
  metrics: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  resultFile: z.string().optional(),
  acceptance: z.array(z.object({ metric: z.string(), threshold: z.string(), met: z.boolean().optional() })),
  status: z.enum(["planned", "run", "blocked"]),
  notes: z.string().optional(),
  /** The dataset's or method's references, from references.json. */
  sources: z.array(SourceRef).optional(),
});
export type Benchmark = z.infer<typeof Benchmark>;

export const FailureCase = z.object({
  id: Id,
  date: z.string(),
  image: z.string(),
  symptom: z.string(),
  cause: z.string(),
  fix: z.string().optional(),
  regressionTest: z.string().optional(),
  status: z.enum(["open", "fixed", "accepted"]),
});
export type FailureCase = z.infer<typeof FailureCase>;

export const Validation = z.object({
  status: z.enum(["unvalidated", "partial", "validated"]),
  summary: z.string(),
  benchmarks: z.array(Benchmark),
  failureCases: z.array(FailureCase),
  gaps: z.array(z.string()),
});
export type Validation = z.infer<typeof Validation>;

// ----------------------------------------------------------------------------------------------- references

export const Source = z.object({
  id: Id,
  title: z.string(),
  authors: z.string().optional(),
  year: z.number().int().optional(),
  publisher: z.string().optional(),
  url: z.string().optional(),
  doi: z.string().optional(),
  type: z.enum(["extension", "peer-reviewed", "government", "vendor", "dataset", "own-measurement", "secondary", "other"]),
  geography: z.string().optional(),
  accessed: z.string().optional(),
  notes: z.string().optional(),
});
export type Source = z.infer<typeof Source>;

export const References = z.object({ sources: z.array(Source) });
export type References = z.infer<typeof References>;

// ----------------------------------------------------------------------------------------------- the whole profile

export const CropProfile = z.object({
  manifest: Manifest,
  identity: Identity,
  planting: Planting,
  growth: Growth,
  morphology: Morphology,
  visual: Visual,
  weeds: Weeds,
  fieldConditions: FieldConditions,
  imagery: Imagery,
  algorithms: Algorithms,
  uncertainty: Uncertainty,
  validation: Validation,
  references: References,
});
export type CropProfile = z.infer<typeof CropProfile>;

/** The domain documents a manifest lists, in the order they are read. */
export const PROFILE_DOCUMENTS = ["identity", "planting", "growth", "morphology", "visual", "weeds", "fieldConditions", "imagery", "algorithms", "uncertainty", "validation", "references"] as const;
export type ProfileDocument = (typeof PROFILE_DOCUMENTS)[number];

/** Each document's schema, by name, for the loader and the JSON Schema emitter. */
export const DOCUMENT_SCHEMAS = {
  manifest: Manifest, identity: Identity, planting: Planting, growth: Growth, morphology: Morphology, visual: Visual,
  weeds: Weeds, fieldConditions: FieldConditions, imagery: Imagery, algorithms: Algorithms, uncertainty: Uncertainty,
  validation: Validation, references: References,
} as const;

// ----------------------------------------------------------------------------------------------- shared vocabularies

export const Units = z.object({ units: z.array(z.object({ id: Id, name: z.string(), symbol: z.string(), dimension: z.string(), notes: z.string().optional() })) });
export const GrowthStageSystems = z.object({ systems: z.array(z.object({ id: Id, name: z.string(), crops: z.array(z.string()), description: z.string(), source: z.string() })) });
export const PlantingPatternTypes = z.object({ types: z.array(z.object({ id: Id, name: z.string(), description: z.string() })) });
export const MorphologyVocabulary = z.object({ terms: z.array(z.object({ id: Id, name: z.string(), category: z.string(), definition: z.string() })) });
export const ImageQualityStandards = z.object({
  gsdBands: z.array(z.object({ id: Id, name: z.string(), gsdCm: z.tuple([z.number(), z.number()]), description: z.string() })),
  smallestObjectRule: z.object({ pixelsAcross: z.number().int().positive(), statement: z.string(), source: z.string() }),
  checks: z.array(z.object({ id: Id, name: z.string(), definition: z.string() })),
});
export const UncertaintyCodes = z.object({ codes: z.array(z.object({ id: z.string().regex(/^[A-Z][A-Z0-9_]*$/), name: z.string(), severity: z.enum(["info", "caution", "blocking"]), meaning: z.string(), defaultAction: z.enum(["note", "review", "disable"]) })) });
export const WeedTaxonomy = z.object({ species: z.array(z.object({
  id: Id,
  scientificName: z.string(),
  family: z.string(),
  commonNames: z.array(z.string()),
  lifeForm: z.enum(["annual-grass", "annual-broadleaf", "perennial-grass", "perennial-broadleaf", "sedge", "vine", "biennial-broadleaf"]),
  photosynthesis: z.enum(["C3", "C4"]).optional(),
  habit: z.string().optional(),
  notes: z.string().optional(),
  sources: z.array(z.string()).optional(),
})) });

export const SHARED_SCHEMAS = {
  units: Units, growthStageSystems: GrowthStageSystems, plantingPatternTypes: PlantingPatternTypes,
  morphologyVocabulary: MorphologyVocabulary, imageQualityStandards: ImageQualityStandards,
  uncertaintyCodes: UncertaintyCodes, weedTaxonomy: WeedTaxonomy,
} as const;

export const Shared = z.object({
  units: Units,
  growthStageSystems: GrowthStageSystems,
  plantingPatternTypes: PlantingPatternTypes,
  morphologyVocabulary: MorphologyVocabulary,
  imageQualityStandards: ImageQualityStandards,
  uncertaintyCodes: UncertaintyCodes,
  weedTaxonomy: WeedTaxonomy,
});
export type Shared = z.infer<typeof Shared>;
