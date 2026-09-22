// The weed reference catalog: sourced names for a state, never detections.
//
// WHAT THIS IS. A state-at-a-time inventory of weed NAMES with the source each
// name came from (an Extension identification index, the USDA state plants
// checklist, a crop guide table, the state's noxious weed regulation). It
// exists so an operator identifying a candidate on screen can pick a real,
// sourced name instead of typing free text, and so that name travels into
// the archive and the application record with its source and its
// confirmation status attached.
//
// WHAT IT IS NOT. A record here is not evidence that the plant is on a given
// farm, in a given field, or in the pixels of a given candidate. Nothing in
// the catalog is aerially validated (`aerial_identification_validated` is
// false on every row and the importer refuses a row that says otherwise). A
// regulatory tier is a legal status and is kept apart from crop relevance;
// Tier 1 in Virginia means "not known present in the state" and can never be
// read as an occurrence. The detector (lib/weedScout) does not use the
// catalog to see anything; it only offers a name when the operator's own past
// verdicts already named one (see suggest.ts).
//
// Two families of columns live on an entry. Source-owned columns are written
// by the importer and only by the importer. Review-owned columns
// (`review_status`, `review_notes`, `resolved_scientific_name`, ...) are
// written by people and are never touched by an import; a re-import of a
// reviewed entry parks the incoming change in `pending_source_update` for the
// reviewer instead of overwriting them.

/** How a name got into the catalog. From STATE_METHOD.md. */
export type CatalogStatus =
  /** Named in a broad identification index. Research and human triage only. */
  | "source_index_only"
  /** Named in a crop or pasture guide table. Preliminary reference with cited context. */
  | "crop_context_sourced"
  /** Named in state law; possibly absent locally. Compliance research with the tier shown. */
  | "regulatory_only";

export const CATALOG_STATUSES: readonly CatalogStatus[] = [
  "source_index_only", "crop_context_sourced", "regulatory_only",
];

export type UsdaStatus = "matched" | "unmatched_requires_review" | "not_crosswalked";
export const USDA_STATUSES: readonly UsdaStatus[] = ["matched", "unmatched_requires_review", "not_crosswalked"];

/** Crop contexts the crop guide tables name. */
export type CropContext = "corn" | "soybean" | "small_grains" | "pasture_hay";
export const CROP_CONTEXTS: readonly CropContext[] = ["corn", "soybean", "small_grains", "pasture_hay"];
export const CROP_CONTEXT_LABEL: Record<CropContext, string> = {
  corn: "corn", soybean: "soybean", small_grains: "small grains", pasture_hay: "pasture and hay",
};

export type PlantType = "broadleaf" | "grass_or_grasslike" | "unclassified" | "other";

/** Human review state. Never written by the importer. */
export type ReviewStatus = "unreviewed" | "expert_reviewed" | "excluded";

export type CropEvidence = {
  crop: string;
  source_id: string;
  locator: string;
  evidence?: string;
};

/** One catalog entry, as stored in `weed_catalog_entries`. */
export type CatalogEntry = {
  // ---- Source-owned: written by the importer only ----
  catalog_id: string;
  state: string;
  catalog_version: string;
  as_of: string;
  common_name: string;
  scientific_name_as_source: string;
  plant_type: PlantType | string;
  vt_profile_url: string | null;
  usda_status: UsdaStatus;
  usda_symbol: string | null;
  usda_candidate_symbols: string[];
  usda_match_method: string | null;
  crop_evidence: CropEvidence[];
  /** Distinct crops from `crop_evidence`, for filtering. */
  crop_contexts: string[];
  /** Legal status, kept apart from crop relevance. Null when not listed. */
  regulatory_tier: string | null;
  regulatory_scientific_name: string | null;
  regulatory_source_id: string | null;
  catalog_status: CatalogStatus;
  /** Always false in this build. The importer refuses a true. */
  aerial_identification_validated: boolean;
  source_ids: string[];
  /** Automated review CUES from profile habitat text. Not verified crop associations. */
  habitat_flags: string[];
  habitat_profile_checked: boolean;
  habitat_where_found_present: boolean;
  habitat_mentions_state: boolean;
  /** Content hash of the source-owned columns; unchanged rows are left alone on re-import. */
  source_hash: string;
  // ---- Review-owned: written by people, never by the importer ----
  review_status: ReviewStatus;
  review_notes: string | null;
  reviewed_at: string | null;
  resolved_scientific_name: string | null;
  pending_source_update: unknown | null;
};

/** The source-owned part of an entry: exactly what an import may write. */
export type SourceEntryRow = Omit<
  CatalogEntry,
  "review_status" | "review_notes" | "reviewed_at" | "resolved_scientific_name" | "pending_source_update"
>;

export const REVIEW_OWNED_COLUMNS = [
  "review_status", "review_notes", "reviewed_by", "reviewed_at", "resolved_scientific_name", "pending_source_update",
] as const;

export type CatalogSource = {
  source_id: string;
  state: string;
  title: string;
  url: string;
  accessed: string;
  scope: string;
  catalog_version: string;
};

/** An unresolved name or association, from the catalog's review queue. */
export type ReviewQueueItem = {
  /** Stable across imports: derived from state, source, catalog id and label, not from position. */
  id: string;
  state: string;
  catalog_id: string | null;
  label: string;
  reason: string;
  source_id: string | null;
  catalog_version: string;
  // Review-owned
  resolved: boolean;
  resolution: string | null;
};

/** Where a field is taken to be, and on what basis. */
export type FieldRegion = {
  /** Two-letter state code. */
  state: string;
  stateName: string;
  /** Why we think so. "assumed for testing" until a real location source exists. */
  basis: "assumed for testing";
};
