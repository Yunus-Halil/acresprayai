// The four questions a crop profile answers about a field, as testable functions:
//   1. What should I expect to see?          expectations(): spacing, stage, cover, closure
//   2. What does the imagery actually show?  the caller's observations (pixel size, measured pitch, coherence, cover)
//   3. Are the two consistent?               checkRowSpacing, checkCoverVsStage, checkRows, checkVegetationSplit
//   4. If not, what can safely be concluded? assessCapabilities(): each analysis enabled, flagged for review, or
//                                            disabled, with the policy code and the operator's sentence
//
// Every finding carries a code from crop-profiles/shared/uncertainty-codes.json and the profile's own message for it.
// The profile is a prior: a measurement that disagrees with it is reported, never corrected toward the profile.
import type { RuntimeCropProfile, RuntimeStage } from "./runtime";

export type FindingAction = "note" | "review" | "disable";
export type Finding = { code: string; action: FindingAction; message: string; capability?: string; detail?: string };

const finding = (p: RuntimeCropProfile, code: string, detail?: string, capability?: string, fallback?: { action: FindingAction; message: string }): Finding => {
  const pol = p.policies[code] ?? fallback ?? { action: "note" as const, message: code };
  return { code, action: pol.action, message: pol.message, ...(capability ? { capability } : {}), ...(detail ? { detail } : {}) };
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const cm = (m: number) => `${Math.round(m * 1000) / 10} cm`;

// ------------------------------------------------------------------------------------------------ stage

export type StageEstimate =
  | { status: "unknown"; reason: string }
  | { status: "estimated"; method: "calendar"; daysAfterPlanting: number; from: RuntimeStage; to: RuntimeStage; errorStages: number; note: string };

/** Whole days between a YYYY-MM-DD planting date and a date, or null. */
export function daysSincePlanting(plantingDate: string | null | undefined, on: Date): number | null {
  if (!plantingDate || !/^\d{4}-\d{2}-\d{2}$/.test(plantingDate)) return null;
  const t = Date.parse(`${plantingDate}T12:00:00Z`);
  if (!Number.isFinite(t)) return null;
  const d = Math.floor((on.getTime() - t) / 86_400_000);
  return d >= 0 ? d : null;
}

/**
 * The stage range the calendar allows on a date: every stage whose days-after-planting window overlaps the days since
 * planting widened by the profile's tolerance (a quarter either way for corn). Never one stage: the calendar ignores
 * temperature, and the profile states its error beside the range.
 */
export function estimateStage(p: RuntimeCropProfile, plantingDate: string | null | undefined, on: Date): StageEstimate {
  const days = daysSincePlanting(plantingDate, on);
  if (days == null) return { status: "unknown", reason: plantingDate ? "The planting date is after the flight or not a date." : "No planting date on file." };
  const [lo, hi] = p.stageEstimate.daysWindowShare;
  const a = days * lo, b = days * hi;
  const hits = p.stages.filter(s => s.daysAfterPlanting && s.daysAfterPlanting.high >= a && s.daysAfterPlanting.low <= b);
  const dated = p.stages.filter(s => s.daysAfterPlanting);
  if (!dated.length) return { status: "unknown", reason: "The profile has no stage calendar." };
  let from: RuntimeStage, to: RuntimeStage;
  if (hits.length) { from = hits[0]; to = hits[hits.length - 1]; }
  else if (days < dated[0].daysAfterPlanting!.low) { from = to = dated[0]; }
  else { from = to = dated[dated.length - 1]; }
  const errorStages = p.stageEstimate.calendarErrorStages;
  return { status: "estimated", method: "calendar", daysAfterPlanting: days, from, to, errorStages, note: `${days} days after planting: about ${from.id === to.id ? from.id : `${from.id} to ${to.id}`} by the stage calendar (estimated from the planting date, not observed; often off by ${errorStages} leaf stages or more in a cold or stressed season).` };
}

const orderOf = (p: RuntimeCropProfile, id: string): number => p.stages.find(s => s.id === id)?.order ?? NaN;

/** Whether a stage range lies wholly outside a capability's stage window: "before", "after", or null when they overlap or nothing is known. */
export function stageOutside(p: RuntimeCropProfile, est: StageEstimate, window: [string, string] | undefined): "before" | "after" | null {
  if (est.status !== "estimated" || !window) return null;
  const [w0, w1] = window.map(id => orderOf(p, id));
  if (!Number.isFinite(w0) || !Number.isFinite(w1)) return null;
  if (est.from.order > w1) return "after";
  if (est.to.order < w0) return "before";
  return null;
}

// ------------------------------------------------------------------------------------------------ geometry

/** The planted spacing nearest a measured pitch, and how far off it is (share of the planted spacing). */
export function nearestPlantedSpacing(p: RuntimeCropProfile, measuredM: number): { m: number; label: string; offShare: number } | null {
  if (!(measuredM > 0) || !p.plantedSpacingsM.length) return null;
  let best = p.plantedSpacingsM[0], off = Infinity;
  for (const c of p.plantedSpacingsM) { const e = Math.abs(measuredM - c.m) / c.m; if (e < off) { off = e; best = c; } }
  return { m: best.m, label: best.label, offShare: off };
}

/** A measured row pitch against the crop's planted spacings. The measurement stands either way. */
export function checkRowSpacing(p: RuntimeCropProfile, measuredM: number | null | undefined): { nearest: ReturnType<typeof nearestPlantedSpacing>; finding: Finding | null } {
  if (measuredM == null || !(measuredM > 0)) return { nearest: null, finding: null };
  const nearest = nearestPlantedSpacing(p, measuredM);
  const bad = !nearest || nearest.offShare > p.consistency.rowSpacingMismatchShare;
  return { nearest, finding: bad ? finding(p, "ROW_SPACING_UNEXPECTED", `Rows measured ${cm(measuredM)} apart; the nearest spacing ${p.name} is planted at is ${nearest ? `${nearest.label} (${cm(nearest.m)}, ${pct(nearest.offShare)} off)` : "none"}.`, "row-spacing") : null };
}

/** The row read itself: found, coherent, from the vegetation or only from brightness. */
export function checkRows(p: RuntimeCropProfile, rows: { found: boolean; coherence?: number | null; fromBrightnessShare?: number | null }): Finding | null {
  if (!rows.found) return finding(p, "NO_ROWS", undefined, "crop-vs-weed-by-position", { action: "disable", message: "No rows found." });
  if (rows.coherence != null && rows.coherence < p.consistency.minRowCoherence) return finding(p, "ROWS_UNCERTAIN", `Row coherence ${rows.coherence.toFixed(2)} (under ${p.consistency.minRowCoherence}).`, "crop-vs-weed-by-position");
  if (rows.fromBrightnessShare != null && rows.fromBrightnessShare > 0.5) return finding(p, "ROWS_UNCERTAIN", "Most rows were read from brightness, not from green against soil.", "crop-vs-weed-by-position");
  return null;
}

/** The automatic vegetation split against the profile's floor: under it the split was soil against residue. */
/** The vegetation index of a grey pixel: ExG (and CIVE) of r = g = b, about zero. A split below it is not a plant split. */
export const GREY_INDEX = 0;

export function checkVegetationSplit(p: RuntimeCropProfile, otsuThreshold: number | null | undefined): Finding | null {
  const below = p.vegetation.indexFloor ?? GREY_INDEX;
  if (otsuThreshold == null || !Number.isFinite(otsuThreshold) || otsuThreshold >= below) return null;
  return finding(p, "VEGETATION_MASK_SUSPECT", `Automatic split at ${otsuThreshold.toFixed(2)}, below the index of grey.`, "vegetation-segmentation");
}

// ------------------------------------------------------------------------------------------------ cover

/** What the crop alone covers over a stage range at its default spacing, joined over the stages with a figure. */
export function expectedCover(p: RuntimeCropProfile, est: StageEstimate): { low: number; high: number } | null {
  if (est.status !== "estimated") return null;
  const within = p.vegetation.expectedCoverByStage.filter(e => { const o = orderOf(p, e.stage); return o >= est.from.order && o <= est.to.order; });
  const use = within.length ? within : (() => {
    // No figure inside the range: the nearest stages either side bracket it.
    const before = [...p.vegetation.expectedCoverByStage].filter(e => orderOf(p, e.stage) < est.from.order).pop();
    const after = p.vegetation.expectedCoverByStage.find(e => orderOf(p, e.stage) > est.to.order);
    return [before, after].filter(Boolean) as typeof p.vegetation.expectedCoverByStage;
  })();
  if (!use.length) return null;
  return { low: Math.min(...use.map(e => e.range.low)), high: Math.max(...use.map(e => e.range.high)) };
}

/**
 * Measured green cover (crop and weeds together) against what the crop covers at the estimated stage. Cover below the
 * crop's range by more than the tolerance means the stage or the planting date is off (or a poor stand); far above it
 * means the stage is off or weeds are heavy. Either way: review, never a correction.
 */
export function checkCoverVsStage(p: RuntimeCropProfile, est: StageEstimate, measuredCover: number | null | undefined): Finding | null {
  const exp = expectedCover(p, est);
  if (!exp || measuredCover == null || !Number.isFinite(measuredCover)) return null;
  const tol = p.consistency.coverStageToleranceShare;
  if (measuredCover < exp.low - tol || measuredCover > exp.high + tol) {
    const side = measuredCover < exp.low ? "less" : "more";
    return finding(p, "COVER_STAGE_MISMATCH", `Green cover ${pct(measuredCover)}: ${side} than ${p.name} alone covers at the estimated stage (${pct(exp.low)} to ${pct(exp.high)}).`);
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ capabilities

export type CapabilityVerdict = {
  id: string;
  /** enabled: run it; review: run it and say why to look; disabled: do not run it, say why. */
  state: "enabled" | "review" | "disabled";
  status: "supported" | "experimental" | "unsupported";
  reason: string;
  findings: Finding[];
};

export type FieldObservations = {
  /** Ground size of a pixel of the imagery the analysis runs on, metres; null when unknown. */
  gsdM: number | null;
  plantingDate?: string | null;
  /** When the imagery was taken. */
  on: Date;
  measuredRowSpacingM?: number | null;
  rowsFound?: boolean | null;
  rowCoherence?: number | null;
  rowsFromBrightnessShare?: number | null;
  /** Green share of the imaged ground (crop and weeds). */
  vegetationShare?: number | null;
  otsuThreshold?: number | null;
};

export type FieldAssessment = {
  profile: { id: string; name: string; version: string; status: RuntimeCropProfile["status"]; validation: RuntimeCropProfile["validation"] };
  stage: StageEstimate;
  expected: { rowSpacingM: number; spacings: string[]; coverAtStage: { low: number; high: number } | null; closureStage: string | null };
  findings: Finding[];
  capabilities: CapabilityVerdict[];
};

/** The profile's closure stage for the field's rows: the closest row spacing on file. */
export function closureStage(p: RuntimeCropProfile, rowSpacingM: number | null | undefined): string | null {
  if (!p.closure.length) return null;
  const s = rowSpacingM && rowSpacingM > 0 ? rowSpacingM : p.rowReader.defaultSpacingM;
  return [...p.closure].sort((a, b) => Math.abs(a.rowSpacingM - s) - Math.abs(b.rowSpacingM - s))[0].stage;
}

/** Each capability, gated by the profile's status, the pixel size, the stage and the row read. */
export function assessCapabilities(p: RuntimeCropProfile, o: FieldObservations): FieldAssessment {
  const stage = estimateStage(p, o.plantingDate, o.on);
  const general: Finding[] = [];
  if (p.status !== "validated") general.push(finding(p, "PROFILE_EXPERIMENTAL"));
  if (stage.status === "unknown") general.push(finding(p, "UNKNOWN_STAGE", stage.reason));
  else general.push(finding(p, "STAGE_ESTIMATED", stage.note));
  const spacing = checkRowSpacing(p, o.measuredRowSpacingM);
  if (spacing.finding) general.push(spacing.finding);
  const rowsF = o.rowsFound == null ? null : checkRows(p, { found: o.rowsFound, coherence: o.rowCoherence, fromBrightnessShare: o.rowsFromBrightnessShare });
  if (rowsF) general.push(rowsF);
  const split = checkVegetationSplit(p, o.otsuThreshold);
  if (split) general.push(split);
  const coverF = checkCoverVsStage(p, stage, o.vegetationShare);
  if (coverF) general.push(coverF);
  const closed = o.vegetationShare != null && o.vegetationShare >= p.vegetation.canopyClosedShare;
  if (closed) general.push(finding(p, "CANOPY_CLOSED", `Green over ${pct(o.vegetationShare!)} of the ground.`));

  const needsRows = new Set(["crop-vs-weed-by-position", "between-row-weed-cover", "weed-pressure-grade", "hotspots"]);
  const needsGround = new Set(["between-row-weed-cover", "weed-pressure-grade", "crop-vs-weed-by-position", "hotspots"]);
  const metric = new Set(["row-spacing", "weed-measurement", "weed-isolation", "between-row-weed-cover", "planting-positions", "stand-count"]);
  const capabilities: CapabilityVerdict[] = Object.entries(p.capabilities).map(([id, c]) => {
    const f: Finding[] = [];
    let state: CapabilityVerdict["state"] = c.status === "unsupported" ? "disabled" : "enabled";
    if (c.status === "unsupported") f.push(finding(p, "CAPABILITY_UNSUPPORTED", c.reason, id, { action: "disable", message: "Not supported for this crop yet." }));
    if (state !== "disabled" && metric.has(id) && o.gsdM == null) { f.push(finding(p, "UNKNOWN_RESOLUTION", undefined, id)); state = "disabled"; }
    if (state !== "disabled" && c.maxGsdCm != null && o.gsdM != null && o.gsdM * 100 > c.maxGsdCm + 1e-9) {
      f.push(finding(p, "INSUFFICIENT_RESOLUTION", `${(o.gsdM * 100).toFixed(1)} cm a pixel; ${p.name} needs ${c.maxGsdCm} cm or finer for this.`, id));
      state = "disabled";
    }
    const out = stageOutside(p, stage, c.stages);
    if (state !== "disabled" && out === "after") { f.push(finding(p, "UNSUPPORTED_STAGE", stage.status === "estimated" ? `Estimated ${stage.from.id} to ${stage.to.id}; this analysis applies ${c.stages![0]} to ${c.stages![1]}.` : undefined, id)); state = "disabled"; }
    if (state !== "disabled" && out === "before") { f.push({ code: "UNSUPPORTED_STAGE", action: "review", message: `Earlier than this analysis is built for (${c.stages![0]} to ${c.stages![1]}): the crop may not be visible yet.`, capability: id }); state = "review"; }
    if (state !== "disabled" && needsGround.has(id) && closed) { f.push(finding(p, "CANOPY_CLOSED", undefined, id)); state = "disabled"; }
    if (state !== "disabled" && needsRows.has(id) && rowsF) { f.push({ ...rowsF, capability: id }); state = rowsF.action === "disable" ? "disabled" : "review"; }
    if (state === "enabled" && (id === "row-spacing" || id === "row-detection") && spacing.finding) { f.push({ ...spacing.finding, capability: id }); state = "review"; }
    if (state === "enabled" && id === "vegetation-segmentation" && split) { f.push({ ...split, capability: id }); }
    if (state !== "disabled" && (id === "crop-vs-weed-by-position" || id === "between-row-weed-cover")) f.push(finding(p, "WITHIN_ROW_UNRESOLVED", undefined, id));
    if (id === "species-priors") f.push(finding(p, "SPECIES_NOT_RESOLVABLE", undefined, id));
    if (state !== "disabled" && id === "weed-pressure-grade" && p.pressure.scheme.basis === "provisional") f.push(finding(p, "THRESHOLD_PROVISIONAL", undefined, id));
    return { id, state, status: c.status, reason: c.reason, findings: f };
  });

  return {
    profile: { id: p.id, name: p.name, version: p.version, status: p.status, validation: p.validation },
    stage,
    expected: { rowSpacingM: p.rowReader.defaultSpacingM, spacings: p.plantedSpacingsM.map(s => s.label), coverAtStage: expectedCover(p, stage), closureStage: closureStage(p, o.measuredRowSpacingM) },
    findings: general,
    capabilities,
  };
}

// ------------------------------------------------------------------------------------------------ species priors

export type SpeciesPrior = { speciesId: string; name: string; scientificName: string; prevalence: string; inSeason: boolean | null; lookAlikeWithCrop: string; why: string };

/** The profile's region for a US state code or a country code, or null. */
export function regionFor(p: RuntimeCropProfile, place: { state?: string | null; country?: string | null }): string | null {
  const st = place.state?.toUpperCase(), co = place.country?.toUpperCase();
  if (st) { const r = p.regions.find(r => r.states.includes(st)); if (r) return r.id; }
  if (co && co !== "US") { const r = p.regions.find(r => r.countries.includes(co) && !r.states.length); if (r) return r.id; }
  return null;
}

/**
 * The weeds most associated with the crop in a region, ordered by prevalence, with whether the estimated stage falls in
 * their emergence window. A prior for ordering the operator's reference list, never an identification.
 */
export function speciesPriors(p: RuntimeCropProfile, region: string | null, stage: StageEstimate, limit = 8): SpeciesPrior[] {
  const r = region ? p.weeds.find(w => w.region === region) : null;
  if (!r) return [];
  const rank = { dominant: 0, common: 1, regional: 2, occasional: 3 } as Record<string, number>;
  const inSeason = (s: [string, string] | null): boolean | null => {
    if (!s || stage.status !== "estimated") return null;
    const [a, b] = s.map(id => orderOf(p, id));
    return !(stage.to.order < a || stage.from.order > b);
  };
  return r.species
    .map(w => ({ w, season: inSeason(w.stages) }))
    .sort((x, y) => (Number(y.season === true) - Number(x.season === true)) || (rank[x.w.prevalence] - rank[y.w.prevalence]))
    .slice(0, limit)
    .map(({ w, season }) => ({
      speciesId: w.speciesId, name: w.name, scientificName: w.scientificName, prevalence: w.prevalence, inSeason: season, lookAlikeWithCrop: w.lookAlikeWithCrop,
      why: `${w.prevalence} in ${p.name} here${season === true ? ", emerging around this stage" : season === false ? ", outside its usual emergence window now" : ""}${w.lookAlikeWithCrop === "high" ? "; looks like the crop from above" : ""}${w.escapesAboveCanopy ? "; can escape above the canopy" : ""}`,
    }));
}
