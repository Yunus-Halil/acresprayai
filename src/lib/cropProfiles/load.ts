// Validating a crop profile: the schema, then the cross-references the schema cannot see.
//
// Pure: callers hand in parsed JSON (scripts read it from disk, tests read it with import.meta.glob), so the same
// checks run in the build script, the tests and anywhere else. A profile that fails here is never compiled into a
// run-time file.
import { CropProfile, DOCUMENT_SCHEMAS, PROFILE_DOCUMENTS, PROFILE_SCHEMA_VERSION, SHARED_SCHEMAS, Shared, type CropProfile as CropProfileT, type Shared as SharedT } from "./schema";

export type ValidationResult = { ok: boolean; errors: string[]; warnings: string[]; profile: CropProfileT | null };

const issues = (doc: string, e: { issues: { path: PropertyKey[]; message: string }[] }) => e.issues.map(i => `${doc}: ${i.path.map(String).join(".") || "(root)"}: ${i.message}`);

/** Validate the shared vocabularies. */
export function validateShared(raw: Record<keyof typeof SHARED_SCHEMAS, unknown>): { ok: boolean; errors: string[]; shared: SharedT | null } {
  const errors: string[] = [];
  for (const [k, schema] of Object.entries(SHARED_SCHEMAS)) {
    const r = schema.safeParse(raw[k as keyof typeof SHARED_SCHEMAS]);
    if (!r.success) errors.push(...issues(`shared/${k}`, r.error));
  }
  if (errors.length) return { ok: false, errors, shared: null };
  const shared = Shared.parse(raw);
  const dup = (xs: string[], what: string) => { const seen = new Set<string>(); for (const x of xs) { if (seen.has(x)) errors.push(`shared: duplicate ${what} id ${x}`); seen.add(x); } };
  dup(shared.weedTaxonomy.species.map(s => s.id), "species");
  dup(shared.uncertaintyCodes.codes.map(c => c.id), "uncertainty code");
  dup(shared.units.units.map(u => u.id), "unit");
  return { ok: !errors.length, errors, shared: errors.length ? null : shared };
}

/** Every value under a key named `sources` (arrays) or `source` (string ids in surveys), anywhere in a document. */
function citedSources(o: unknown, out: Set<string>, key?: string): void {
  if (Array.isArray(o)) {
    if (key === "sources") { for (const s of o) if (typeof s === "string") out.add(s); }
    else o.forEach(x => citedSources(x, out));
    return;
  }
  if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) {
    if (k === "source" && typeof v === "string" && /^[a-z0-9][a-z0-9_.-]*$/.test(v)) out.add(v);
    citedSources(v, out, k);
  }
}

/** Every `unit` string anywhere in a document. */
function unitsUsed(o: unknown, out: Set<string>): void {
  if (Array.isArray(o)) { o.forEach(x => unitsUsed(x, out)); return; }
  if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (k === "unit" && typeof v === "string") out.add(v); unitsUsed(v, out); }
}

/** Validate one crop's documents against the schema and against each other and the shared vocabularies. */
export function validateProfile(raw: Record<string, unknown>, shared: SharedT): ValidationResult {
  const errors: string[] = [], warnings: string[] = [];
  for (const d of ["manifest", ...PROFILE_DOCUMENTS] as const) {
    if (raw[d] == null) { errors.push(`${d}: missing`); continue; }
    const r = DOCUMENT_SCHEMAS[d].safeParse(raw[d]);
    if (!r.success) errors.push(...issues(d, r.error));
  }
  if (errors.length) return { ok: false, errors, warnings, profile: null };
  const p = CropProfile.parse(raw);

  if (p.manifest.id !== p.identity.id) errors.push(`manifest.id ${p.manifest.id} differs from identity.id ${p.identity.id}`);
  if (p.manifest.schemaVersion.split(".")[0] !== PROFILE_SCHEMA_VERSION.split(".")[0]) errors.push(`manifest.schemaVersion ${p.manifest.schemaVersion} is not compatible with the schema ${PROFILE_SCHEMA_VERSION} (major version differs)`);

  // Sources: every citation resolves, and every reference is cited somewhere (unused ones are warned, not refused).
  const refs = new Set(p.references.sources.map(s => s.id));
  const cited = new Set<string>();
  for (const d of PROFILE_DOCUMENTS) if (d !== "references") citedSources(p[d], cited);
  for (const s of cited) if (!refs.has(s)) errors.push(`source "${s}" is cited but not in references`);
  for (const s of refs) if (!cited.has(s)) warnings.push(`reference "${s}" is never cited`);
  const seenRef = new Set<string>();
  for (const s of p.references.sources) { if (seenRef.has(s.id)) errors.push(`references: duplicate id ${s.id}`); seenRef.add(s.id); }

  // Stages.
  const stageIds = new Set(p.growth.stages.map(s => s.id));
  const needStage = (id: string | undefined | null, where: string) => { if (id != null && !stageIds.has(id)) errors.push(`${where}: unknown stage "${id}"`); };
  const orders = p.growth.stages.map(s => s.order);
  if (new Set(orders).size !== orders.length) errors.push("growth.stages: duplicate order");
  if (!shared.growthStageSystems.systems.some(s => s.id === p.growth.stagingSystem)) errors.push(`growth.stagingSystem "${p.growth.stagingSystem}" is not in shared/growth-stage-systems.json`);
  needStage(p.growth.thermalTime.lateFromStage, "growth.thermalTime.lateFromStage");
  p.growth.priorityStages.forEach(s => needStage(s, "growth.priorityStages"));
  p.growth.closure.forEach(c => needStage(c.stage, "growth.closure"));
  p.growth.criticalPeriod.forEach(c => { needStage(c.startStage, "growth.criticalPeriod"); needStage(c.endStage, "growth.criticalPeriod"); });
  p.morphology.byStage.forEach(b => needStage(b.stage, "morphology.byStage"));
  p.morphology.resolvable.forEach(r => r.stages?.forEach(s => needStage(s, "morphology.resolvable")));
  p.imagery.requirements.forEach(r => r.stages?.forEach(s => needStage(s, `imagery.requirements[${r.capability}]`)));
  const a = p.algorithms;
  needStage(a.rowReader.continuousFromStage, "algorithms.rowReader.continuousFromStage");
  a.plantingPositions.resolvableStages?.forEach(s => needStage(s as string, "algorithms.plantingPositions"));
  a.vegetation.expectedCoverByStage.forEach(e => needStage(e.stage, "algorithms.vegetation.expectedCoverByStage"));
  a.pressure.applicableStages.forEach(s => needStage(s as string, "algorithms.pressure.applicableStages"));
  for (const [k, c] of Object.entries(a.capabilities)) c.stages?.forEach(s => needStage(s as string, `algorithms.capabilities.${k}`));
  for (const r of p.weeds.regions) for (const w of r.associations) w.emergence.cropStages?.forEach(s => needStage(s as string, `weeds.${r.region}.${w.speciesId}`));

  // Regions.
  const regionIds = new Set(p.identity.regionsCovered.map(r => r.id));
  const needRegion = (id: string, where: string) => { if (!regionIds.has(id)) errors.push(`${where}: unknown region "${id}"`); };
  p.planting.patterns.forEach(x => x.regions.forEach(r => needRegion(r, `planting.patterns.${x.id}`)));
  p.planting.rowSpacing.candidatesM.forEach(c => c.regions.forEach(r => needRegion(r, `planting.rowSpacing ${c.label}`)));
  p.planting.population.forEach(x => x.regions.forEach(r => needRegion(r, `planting.population ${x.label}`)));
  p.planting.tillage.forEach(x => x.regions.forEach(r => needRegion(r, `planting.tillage.${x.id}`)));
  p.weeds.regions.forEach(r => needRegion(r.region, "weeds.regions"));
  p.fieldConditions.soils.forEach(x => x.regions.forEach(r => needRegion(r, `fieldConditions.soils.${x.id}`)));
  p.fieldConditions.irrigation.forEach(x => x.regions.forEach(r => needRegion(r, `fieldConditions.irrigation.${x.id}`)));
  p.fieldConditions.calendar.forEach(x => needRegion(x.region, "fieldConditions.calendar"));

  // Shared vocabularies.
  const species = new Set(shared.weedTaxonomy.species.map(s => s.id));
  for (const r of p.weeds.regions) {
    for (const w of r.associations) if (!species.has(w.speciesId)) errors.push(`weeds.${r.region}: species "${w.speciesId}" is not in shared/weed-taxonomy`);
    for (const s of r.surveys) for (const id of s.ranked) if (!species.has(id)) errors.push(`weeds.${r.region} survey ${s.source}: species "${id}" is not in shared/weed-taxonomy`);
  }
  const codes = new Set(shared.uncertaintyCodes.codes.map(c => c.id));
  p.uncertainty.policies.forEach(x => { if (!codes.has(x.code)) errors.push(`uncertainty.policies: unknown code "${x.code}"`); });
  p.visual.failureConditions.forEach(f => { if (f.code && !codes.has(f.code)) errors.push(`visual.failureConditions.${f.id}: unknown code "${f.code}"`); });
  p.imagery.qualityChecks.forEach(q => { if (q.code && !codes.has(q.code)) errors.push(`imagery.qualityChecks.${q.id}: unknown code "${q.code}"`); });
  const patternTypes = new Set(shared.plantingPatternTypes.types.map(t => t.id));
  p.planting.patterns.forEach(x => { if (!patternTypes.has(x.type)) errors.push(`planting.patterns.${x.id}: unknown pattern type "${x.type}"`); });
  const terms = new Set(shared.morphologyVocabulary.terms.map(t => t.id));
  p.morphology.vocabulary.forEach(t => { if (!terms.has(t)) errors.push(`morphology.vocabulary: unknown term "${t}"`); });
  const units = new Set(shared.units.units.map(u => u.id));
  const used = new Set<string>();
  for (const d of PROFILE_DOCUMENTS) unitsUsed(p[d], used);
  for (const u of used) if (!units.has(u)) errors.push(`unit "${u}" is not in shared/units.json`);

  // Algorithm configuration against the reference knowledge it rests on.
  for (const m of a.rowReader.candidatesM) if (!p.planting.rowSpacing.candidatesM.some(c => Math.abs(c.m - m) / c.m <= p.planting.rowSpacing.toleranceShare)) warnings.push(`algorithms.rowReader.candidatesM ${m} m matches no planted spacing in planting.rowSpacing`);
  if (!p.planting.rowSpacing.candidatesM.some(c => Math.abs(c.m - a.rowReader.defaultSpacingM) < 1e-6)) errors.push("algorithms.rowReader.defaultSpacingM is not a planted spacing");
  for (const [k, c] of Object.entries(a.capabilities)) {
    const req = p.imagery.requirements.find(r => r.capability === k);
    if (c.maxGsdCm != null && req && c.maxGsdCm > req.maxGsdCm) errors.push(`algorithms.capabilities.${k}: maxGsdCm ${c.maxGsdCm} is coarser than the imagery requirement ${req.maxGsdCm}`);
  }
  const s = a.pressure.scheme;
  if (s.basis === "provisional" && !/provisional/i.test(s.source)) errors.push("algorithms.pressure.scheme: a provisional scheme must say so in its source text");

  // Validation and status: a profile is only "validated" on evidence.
  const benchIds = new Set(p.validation.benchmarks.map(b => b.id));
  for (const [k, c] of Object.entries(a.capabilities)) for (const v of c.validatedBy ?? []) if (!benchIds.has(v)) errors.push(`algorithms.capabilities.${k}: validatedBy "${v}" is not a benchmark in validation.json`);
  for (const b of p.validation.benchmarks) {
    if (b.status === "run" && (!b.metrics || !b.resultFile || !b.date || !b.codeRevision)) errors.push(`validation.benchmarks.${b.id}: a run benchmark needs metrics, resultFile, date and codeRevision`);
    if (b.status !== "run" && b.metrics) errors.push(`validation.benchmarks.${b.id}: metrics on a benchmark that was not run`);
  }
  if (p.manifest.status === "validated") {
    if (p.validation.status !== "validated") errors.push("manifest.status is validated but validation.status is not");
    for (const [k, c] of Object.entries(a.capabilities)) {
      if (c.status === "unsupported") continue;
      const backing = (c.validatedBy ?? []).map(id => p.validation.benchmarks.find(b => b.id === id)).filter(Boolean);
      if (!backing.length || backing.some(b => b!.status !== "run" || b!.acceptance.some(x => x.met !== true))) errors.push(`manifest.status is validated but capability ${k} has no run benchmark meeting its acceptance criteria`);
    }
  }
  for (const [k, c] of Object.entries(a.capabilities)) if (c.status === "supported" && k !== "species-priors" && !(c.validatedBy ?? []).length) warnings.push(`algorithms.capabilities.${k} is supported without a benchmark`);

  return { ok: !errors.length, errors, warnings, profile: errors.length ? null : p };
}
