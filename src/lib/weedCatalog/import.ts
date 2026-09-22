// Turning a state catalog package into rows, without changing what it claims.
//
// Pure. Reads the parsed JSON of a catalog package (catalog.json,
// sources.json, review_queue.json, coverage.json), checks the same
// invariants the package's own validate_catalog.py checks (and a few the
// database also enforces), and produces the payload `import_weed_catalog()`
// takes. Nothing here touches the network; the seed script and the tests are
// the callers.
//
// The checks are refusals, not repairs. A record that claims aerial
// validation, a Tier 1 listing that also claims a state checklist match, a
// crop status with no crop evidence: each of these is a catalog error and
// the import stops with the record named, rather than importing a softer
// version of it. What the catalog says is what the app is allowed to say.
import type {
  CatalogSource, CatalogStatus, CropEvidence, ReviewQueueItem, SourceEntryRow, UsdaStatus,
} from "./types";
import { CATALOG_STATUSES, USDA_STATUSES } from "./types";

export type CatalogPackage = {
  catalog: unknown;
  sources: unknown;
  reviewQueue: unknown;
  coverage?: unknown;
};

export type ImportPayload = {
  state: string;
  catalog_version: string;
  as_of: string;
  scope: string;
  sources: CatalogSource[];
  entries: SourceEntryRow[];
  review_queue: ReviewQueueItem[];
};

export class CatalogImportError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Catalog refused: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n  ${problems.slice(0, 20).join("\n  ")}${problems.length > 20 ? `\n  ... and ${problems.length - 20} more` : ""}`);
    this.name = "CatalogImportError";
  }
}

// ---------------------------------------------------------------------------
// Hashing: a content hash of the source-owned columns, so a re-import can
// tell "changed upstream" from "same as before" without a diff per column.
// cyrb53, two 32-bit lanes; no crypto dependency so the browser and the
// script share one implementation.
// ---------------------------------------------------------------------------

export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/** JSON with keys sorted at every level, so the hash does not depend on key order. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** The columns the hash covers: content, not the version stamp that wraps it. */
const HASHED_KEYS: readonly (keyof SourceEntryRow)[] = [
  "catalog_id", "state", "common_name", "scientific_name_as_source", "plant_type", "vt_profile_url",
  "usda_status", "usda_symbol", "usda_candidate_symbols", "usda_match_method", "crop_evidence", "crop_contexts",
  "regulatory_tier", "regulatory_scientific_name", "regulatory_source_id", "catalog_status",
  "aerial_identification_validated", "source_ids", "habitat_flags", "habitat_profile_checked",
  "habitat_where_found_present", "habitat_mentions_state",
];

export function sourceHashOf(row: Omit<SourceEntryRow, "source_hash">): string {
  const picked: Record<string, unknown> = {};
  for (const k of HASHED_KEYS) picked[k] = (row as Record<string, unknown>)[k];
  return cyrb53(canonicalJson(picked));
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function normaliseEntry(
  rec: Record<string, unknown>, state: string, version: string, asOf: string, problems: string[],
): Omit<SourceEntryRow, "source_hash"> | null {
  const id = str(rec.catalog_id);
  const where = id ?? "(record without catalog_id)";
  if (!id) { problems.push(`${where}: missing catalog_id`); return null; }
  const common = str(rec.common_name);
  const sci = str(rec.scientific_name_as_source);
  if (!common) problems.push(`${id}: missing common_name`);
  if (!sci) problems.push(`${id}: missing scientific_name_as_source`);
  const status = str(rec.catalog_status) as CatalogStatus | null;
  if (!status || !CATALOG_STATUSES.includes(status)) problems.push(`${id}: catalog_status "${status}" is not one of ${CATALOG_STATUSES.join(", ")}`);
  if (rec.aerial_identification_validated !== false) {
    problems.push(`${id}: aerial_identification_validated must be false (no field-image accuracy study exists in this build)`);
  }
  const usda = isRecord(rec.usda_virginia) ? rec.usda_virginia : null;
  const usdaStatus = (usda ? str(usda.status) : null) as UsdaStatus | null;
  if (!usdaStatus || !USDA_STATUSES.includes(usdaStatus)) problems.push(`${id}: usda status "${usdaStatus}" is not one of ${USDA_STATUSES.join(", ")}`);
  const cropEvidence: CropEvidence[] = Array.isArray(rec.crop_evidence)
    ? rec.crop_evidence.filter(isRecord).map(e => ({
      crop: str(e.crop) ?? "", source_id: str(e.source_id) ?? "", locator: str(e.locator) ?? "",
      ...(str(e.evidence) ? { evidence: str(e.evidence)! } : {}),
    }))
    : [];
  for (const e of cropEvidence) {
    if (!e.crop || !e.source_id || !e.locator) problems.push(`${id}: crop evidence needs crop, source_id and locator`);
  }
  const sourceIds = strArray(rec.source_ids);
  if (!sourceIds.length) problems.push(`${id}: no source_ids`);
  for (const e of cropEvidence) {
    if (e.source_id && !sourceIds.includes(e.source_id)) problems.push(`${id}: crop evidence cites ${e.source_id}, which is not in its source_ids`);
  }
  const reg = isRecord(rec.regulatory) ? rec.regulatory : null;
  const tier = reg ? str(reg.tier) : null;
  if (reg && !tier) problems.push(`${id}: regulatory listing without a tier`);
  // The rule the whole regulatory crosswalk hangs on: Tier 1 means "not known
  // present in Virginia". A record cannot be both that and a checklist match.
  if (tier === "Tier 1" && usdaStatus === "matched") problems.push(`${id}: Tier 1 must not imply state presence (usda status is "matched")`);
  if (status === "crop_context_sourced" && !cropEvidence.length) problems.push(`${id}: crop_context_sourced with no crop evidence`);
  if (status === "source_index_only" && cropEvidence.length) problems.push(`${id}: crop evidence left in source-only status`);
  if (status === "regulatory_only" && !reg) problems.push(`${id}: regulatory_only with no regulatory listing`);
  const cues = isRecord(rec.habitat_review_cues) ? rec.habitat_review_cues : null;
  const cropContexts = [...new Set(cropEvidence.map(e => e.crop).filter(Boolean))].sort();

  return {
    catalog_id: id,
    state,
    catalog_version: version,
    as_of: asOf,
    common_name: common ?? "",
    scientific_name_as_source: sci ?? "",
    plant_type: str(rec.plant_type_as_source) ?? "unclassified",
    vt_profile_url: str(rec.vt_profile_url),
    usda_status: usdaStatus ?? "not_crosswalked",
    usda_symbol: usda ? str(usda.usda_symbol) : null,
    usda_candidate_symbols: usda ? strArray(usda.candidate_accepted_symbols) : [],
    usda_match_method: usda ? str(usda.match_method) : null,
    crop_evidence: cropEvidence,
    crop_contexts: cropContexts,
    regulatory_tier: tier,
    regulatory_scientific_name: reg ? str(reg.scientific_name_as_law) : null,
    regulatory_source_id: reg ? str(reg.source_id) : null,
    catalog_status: status ?? "source_index_only",
    aerial_identification_validated: false,
    source_ids: sourceIds,
    habitat_flags: cues ? strArray(cues.automated_flags) : [],
    habitat_profile_checked: cues ? cues.profile_checked === true : false,
    habitat_where_found_present: cues ? cues.where_found_present === true : false,
    habitat_mentions_state: cues ? cues.mentions_virginia === true : false,
  };
}

/** Stable id for a review queue item: what it is about, not where it sat in the file. */
export function reviewQueueId(state: string, item: { source_id?: string | null; catalog_id?: string | null; label: string }): string {
  return `${state}:${cyrb53(`${item.source_id ?? ""}|${item.catalog_id ?? ""}|${item.label}`)}`;
}

/**
 * Parse and check a catalog package. Throws CatalogImportError listing every
 * problem found; returns the payload for `import_weed_catalog()` otherwise.
 */
export function parseCatalog(pkg: CatalogPackage): ImportPayload {
  const problems: string[] = [];
  const cat = isRecord(pkg.catalog) ? pkg.catalog : null;
  if (!cat) throw new CatalogImportError(["catalog.json is not an object"]);
  const state = str(cat.state);
  const version = str(cat.catalog_version);
  const asOf = str(cat.as_of);
  const scope = str(cat.scope) ?? "";
  if (!state || !/^[A-Z]{2}$/.test(state)) problems.push(`state "${state}" is not a two-letter code`);
  if (!version) problems.push("catalog_version missing");
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) problems.push(`as_of "${asOf}" is not a date`);
  const declaredSourceIds = strArray(cat.source_ids);

  const sourcesIn = isRecord(pkg.sources) ? pkg.sources : {};
  const sources: CatalogSource[] = [];
  for (const [sid, v] of Object.entries(sourcesIn)) {
    if (!isRecord(v)) { problems.push(`source ${sid} is not an object`); continue; }
    const title = str(v.title), url = str(v.url), accessed = str(v.accessed), sscope = str(v.scope);
    if (!title || !url || !accessed) problems.push(`source ${sid} needs title, url and accessed`);
    sources.push({
      source_id: sid, state: state ?? "", title: title ?? "", url: url ?? "", accessed: accessed ?? "",
      scope: sscope ?? "", catalog_version: version ?? "",
    });
  }
  for (const sid of declaredSourceIds) if (!(sid in sourcesIn)) problems.push(`catalog declares source ${sid}, which sources.json does not register`);

  const records = Array.isArray(cat.records) ? cat.records : null;
  if (!records || !records.length) problems.push("catalog has no records");
  const entries: SourceEntryRow[] = [];
  const seen = new Set<string>();
  for (const rec of records ?? []) {
    if (!isRecord(rec)) { problems.push("record is not an object"); continue; }
    const row = normaliseEntry(rec, state ?? "", version ?? "", asOf ?? "", problems);
    if (!row) continue;
    if (seen.has(row.catalog_id)) problems.push(`duplicate catalog_id ${row.catalog_id}`);
    seen.add(row.catalog_id);
    for (const sid of row.source_ids) if (!(sid in sourcesIn)) problems.push(`${row.catalog_id}: unknown source ${sid}`);
    entries.push({ ...row, source_hash: sourceHashOf(row) });
  }

  const queueIn = Array.isArray(pkg.reviewQueue) ? pkg.reviewQueue : [];
  const queue: ReviewQueueItem[] = [];
  const queueIds = new Set<string>();
  for (const q of queueIn) {
    if (!isRecord(q)) { problems.push("review queue item is not an object"); continue; }
    const label = str(q.label), reason = str(q.reason);
    if (!label || !reason) { problems.push("review queue item needs label and reason"); continue; }
    const catalogId = str(q.catalog_id);
    if (catalogId && !seen.has(catalogId)) problems.push(`review queue item "${label}" points at unknown ${catalogId}`);
    const item: ReviewQueueItem = {
      id: reviewQueueId(state ?? "", { source_id: str(q.source_id), catalog_id: catalogId, label }),
      state: state ?? "", catalog_id: catalogId, label, reason, source_id: str(q.source_id),
      catalog_version: version ?? "", resolved: false, resolution: null,
    };
    if (queueIds.has(item.id)) continue; // the same question asked twice is one question
    queueIds.add(item.id);
    queue.push(item);
  }

  // Coverage: the package's own counts must describe the records it ships.
  const cover = isRecord(pkg.coverage) ? pkg.coverage : null;
  if (cover) {
    const n = (k: string) => (typeof cover[k] === "number" ? (cover[k] as number) : null);
    const check = (k: string, actual: number) => {
      const declared = n(k);
      if (declared != null && declared !== actual) problems.push(`coverage.${k} says ${declared}, records say ${actual}`);
    };
    check("total_catalog_records", entries.length);
    check("vt_source_records", entries.filter(e => !!e.vt_profile_url).length);
    check("crop_context_sourced", entries.filter(e => e.crop_evidence.length > 0).length);
    check("regulatory_list_entries", entries.filter(e => !!e.regulatory_tier).length);
    check("review_queue_items", queueIn.length);
    if (cover.agricultural_completeness_claimed === true) problems.push("coverage claims agricultural completeness; this build must not");
    if (n("aerial_species_detection_validated")) problems.push("coverage claims aerial species detection validation; this build must not");
  }

  if (problems.length) throw new CatalogImportError(problems);
  return {
    state: state!, catalog_version: version!, as_of: asOf!, scope,
    sources, entries, review_queue: queue,
  };
}

/** Counts a reviewer wants to see, computed from the rows rather than trusted from a file. */
export function summariseEntries(entries: readonly Pick<SourceEntryRow, "catalog_status" | "usda_status" | "regulatory_tier" | "crop_contexts" | "habitat_flags">[]) {
  const byStatus: Record<CatalogStatus, number> = { source_index_only: 0, crop_context_sourced: 0, regulatory_only: 0 };
  const byTier = new Map<string, number>();
  let unresolvedUsda = 0, agriculturalCueOnly = 0;
  for (const e of entries) {
    byStatus[e.catalog_status] += 1;
    if (e.regulatory_tier) byTier.set(e.regulatory_tier, (byTier.get(e.regulatory_tier) ?? 0) + 1);
    if (e.usda_status === "unmatched_requires_review") unresolvedUsda += 1;
    if (e.catalog_status === "source_index_only" && e.habitat_flags.some(f => f === "agronomic_crops" || f === "pasture_forage" || f === "horticultural_crops")) agriculturalCueOnly += 1;
  }
  return {
    total: entries.length,
    byStatus,
    byTier: [...byTier.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    unresolvedUsda,
    agriculturalCueOnly,
  };
}
