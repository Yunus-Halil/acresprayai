// The lightweight run-time form of a crop profile: what the engine reads, and nothing else.
//
// The detailed profile (crop-profiles/<crop>/, several hundred kilobytes of sourced knowledge) never enters the image
// pipeline. compileRuntime() distils it into this shape; scripts/cropProfiles/build.ts writes the result to
// crop-profiles/<crop>/runtime/<crop>.runtime.json, and the app imports only those files (registry.ts). A test
// rebuilds every runtime file from its profile and fails when they differ, so the two cannot drift.
import type { CropProfile, Range, Shared } from "./schema";

export const RUNTIME_VERSION = 1;

export type RuntimeCapability = { status: "supported" | "experimental" | "unsupported"; maxGsdCm?: number; stages?: [string, string]; reason: string };

export type RuntimeStage = {
  id: string;
  order: number;
  name: string;
  daysAfterPlanting: Range | null;
  gddF: Range | null;
  alleyOpen: "open" | "closing" | "closed";
};

export type RuntimeWeed = {
  speciesId: string;
  name: string;
  scientificName: string;
  lifeForm: string;
  prevalence: "dominant" | "common" | "occasional" | "regional";
  lookAlikeWithCrop: "high" | "medium" | "low";
  /** Crop stages between which the main cohorts emerge, where the research gives one. */
  stages: [string, string] | null;
  months: number[] | null;
  escapesAboveCanopy: boolean;
};

export type RuntimeCropProfile = {
  runtimeVersion: number;
  id: string;
  version: string;
  schemaVersion: string;
  status: "draft" | "experimental" | "validated";
  validation: "unvalidated" | "partial" | "validated";
  name: string;
  scientificName: string;
  aliases: string[];
  group: "wide-row" | "cereal" | "orchard";
  rowReader: {
    strategy: string;
    defaultSpacingM: number;
    candidatesM: number[];
    pitchToleranceShare: number;
    windowRows: number | null;
    maxNeighbourhoodM: number;
    vegetationFractionRange: [number, number];
    verifyBrightnessAgainstVegetation: boolean;
    continuousFromStage: string | null;
  };
  plantedSpacingsM: { m: number; label: string; regions: string[] }[];
  spacingToleranceShare: number;
  plantingPositions: { alongRangeM: Range; resolvableStages: [string, string] | null; maxGsdCm: number };
  vegetation: { index: string; indexFloor: number | null; exgrGate: number | null; coverExgr: number; canopyClosedShare: number; expectedCoverByStage: { stage: string; range: Range }[] };
  pressure: {
    scheme: { low: number; moderate: number; action: number; high: number; source: string; basis: "cover" | "provisional" };
    applicableStages: [string, string];
    grade: Record<string, number>;
    stage1: Record<string, number | string>;
    actionSignals: { weedHeightActionCm: number | null; firstPassByStage: string | null; notes: string };
  };
  hotspots: { minObjectDiameterM: number };
  sourceFrames: { preferFramesForMeasurement: boolean; maxGsdCm: number };
  weedMeasurement: { minPixelsAcross: number; sizeThresholdsCm: { small: number; medium: number } };
  consistency: { rowSpacingMismatchShare: number; minRowCoherence: number; coverStageToleranceShare: number };
  capabilities: Record<string, RuntimeCapability>;
  stages: RuntimeStage[];
  priorityStages: string[];
  closure: { rowSpacingM: number; stage: string }[];
  stageEstimate: { calendarErrorStages: number; daysWindowShare: [number, number] };
  policies: Record<string, { action: "note" | "review" | "disable"; message: string }>;
  /** US state (or country) codes per region id, for placing a field. */
  regions: { id: string; name: string; states: string[]; countries: string[] }[];
  weeds: { region: string; species: RuntimeWeed[] }[];
};

/**
 * The calendar estimate's tolerance on days after planting: a stage is a candidate when its day window overlaps
 * [days × low, days × high]. From the research: a mid-April planting took 46 to 50 days to V6 against 25 to 32 in the
 * calendar table (about +60%), warm late plantings run faster; a quarter either way keeps the range honest without
 * spanning the whole season. The method's stated error (1 to 3 stages) is reported beside it.
 */
export const CALENDAR_DAYS_WINDOW: [number, number] = [0.8, 1.25];

/** Distil a validated profile into its run-time form. Pure; the same input always gives the same output. */
export function compileRuntime(p: CropProfile, shared: Pick<Shared, "weedTaxonomy">): RuntimeCropProfile {
  const a = p.algorithms;
  const taxa = new Map(shared.weedTaxonomy.species.map(s => [s.id, s]));
  const calendar = p.growth.stageEstimation.methods.find(m => m.id === "calendar");
  return {
    runtimeVersion: RUNTIME_VERSION,
    id: p.manifest.id,
    version: p.manifest.version,
    schemaVersion: p.manifest.schemaVersion,
    status: p.manifest.status,
    validation: p.validation.status,
    name: p.identity.commonNames[0]?.name ?? p.identity.id,
    scientificName: p.identity.scientificName,
    aliases: [...new Set(p.identity.aliases.map(s => s.toLowerCase()))],
    group: p.identity.cropGroup,
    rowReader: {
      strategy: a.rowReader.strategy,
      defaultSpacingM: a.rowReader.defaultSpacingM,
      candidatesM: [...a.rowReader.candidatesM],
      pitchToleranceShare: a.rowReader.pitchToleranceShare,
      windowRows: a.rowReader.windowRows,
      maxNeighbourhoodM: a.rowReader.maxNeighbourhoodM,
      vegetationFractionRange: [...a.rowReader.vegetationFractionRange] as [number, number],
      verifyBrightnessAgainstVegetation: a.rowReader.verifyBrightnessAgainstVegetation,
      continuousFromStage: a.rowReader.continuousFromStage ?? null,
    },
    plantedSpacingsM: p.planting.rowSpacing.candidatesM.map(c => ({ m: c.m, label: c.label, regions: [...c.regions] })),
    spacingToleranceShare: p.planting.rowSpacing.toleranceShare,
    plantingPositions: { alongRangeM: a.plantingPositions.alongRangeM, resolvableStages: (a.plantingPositions.resolvableStages as [string, string] | undefined) ?? null, maxGsdCm: a.plantingPositions.maxGsdCm },
    vegetation: { index: a.vegetation.index, indexFloor: a.vegetation.indexFloor, exgrGate: a.vegetation.exgrGate, coverExgr: a.vegetation.coverExgr, canopyClosedShare: a.vegetation.canopyClosedShare, expectedCoverByStage: a.vegetation.expectedCoverByStage.map(e => ({ stage: e.stage, range: e.range })) },
    pressure: {
      scheme: { low: a.pressure.scheme.low, moderate: a.pressure.scheme.moderate, action: a.pressure.scheme.action, high: a.pressure.scheme.high, source: a.pressure.scheme.source, basis: a.pressure.scheme.basis },
      applicableStages: a.pressure.applicableStages as [string, string],
      grade: { ...a.pressure.grade },
      stage1: { ...a.pressure.stage1 },
      actionSignals: { weedHeightActionCm: a.pressure.actionSignals.weedHeightActionCm ?? null, firstPassByStage: a.pressure.actionSignals.firstPassByStage ?? null, notes: a.pressure.actionSignals.notes },
    },
    hotspots: { minObjectDiameterM: a.hotspots.minObjectDiameterM },
    sourceFrames: { preferFramesForMeasurement: a.sourceFrames.preferFramesForMeasurement, maxGsdCm: a.sourceFrames.maxGsdCm },
    weedMeasurement: { minPixelsAcross: a.weedMeasurement.minPixelsAcross, sizeThresholdsCm: { ...a.weedMeasurement.sizeThresholdsCm } },
    consistency: { rowSpacingMismatchShare: a.consistency.rowSpacingMismatchShare, minRowCoherence: a.consistency.minRowCoherence, coverStageToleranceShare: a.consistency.coverStageToleranceShare },
    capabilities: Object.fromEntries(Object.entries(a.capabilities).map(([k, c]) => [k, { status: c.status, ...(c.maxGsdCm != null ? { maxGsdCm: c.maxGsdCm } : {}), ...(c.stages ? { stages: c.stages as [string, string] } : {}), reason: c.reason }])),
    stages: [...p.growth.stages].sort((x, y) => x.order - y.order).map(s => ({ id: s.id, order: s.order, name: s.name, daysAfterPlanting: s.daysAfterPlanting ?? null, gddF: s.gddF ?? null, alleyOpen: s.alleyOpen })),
    priorityStages: [...p.growth.priorityStages],
    closure: p.growth.closure.map(c => ({ rowSpacingM: c.rowSpacingM, stage: c.stage })),
    stageEstimate: { calendarErrorStages: calendar?.expectedErrorStages.typical ?? calendar?.expectedErrorStages.high ?? 2, daysWindowShare: CALENDAR_DAYS_WINDOW },
    policies: Object.fromEntries(p.uncertainty.policies.map(x => [x.code, { action: x.action, message: x.message }])),
    regions: p.identity.regionsCovered.map(r => ({ id: r.id, name: r.name, states: [...(r.states ?? [])], countries: [...(r.countries ?? [])] })),
    weeds: p.weeds.regions.map(r => ({
      region: r.region,
      species: r.associations.map(w => {
        const t = taxa.get(w.speciesId);
        return {
          speciesId: w.speciesId,
          name: t?.commonNames[0] ?? w.speciesId,
          scientificName: t?.scientificName ?? w.speciesId,
          lifeForm: t?.lifeForm ?? "unknown",
          prevalence: w.prevalence,
          lookAlikeWithCrop: w.lookAlikeWithCrop,
          stages: (w.emergence.cropStages as [string, string] | undefined) ?? null,
          months: w.emergence.months ?? null,
          escapesAboveCanopy: w.escapesAboveCanopy ?? false,
        };
      }),
    })),
  };
}
