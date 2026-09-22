// Reads of the catalog tables. Reference data, readable by every signed-in
// user, written only by the importer (service role) and, for the review
// columns, by people. Cached per state for the session: 755 rows do not
// change while a scan is on screen.
import { supabase } from "@/integrations/supabase/client";
import type { CatalogEntry, CatalogSource, ReviewQueueItem } from "./types";

const ENTRY_COLUMNS = [
  "catalog_id", "state", "catalog_version", "as_of", "common_name", "scientific_name_as_source", "plant_type",
  "vt_profile_url", "usda_status", "usda_symbol", "usda_candidate_symbols", "usda_match_method", "crop_evidence",
  "crop_contexts", "regulatory_tier", "regulatory_scientific_name", "regulatory_source_id", "catalog_status",
  "aerial_identification_validated", "source_ids", "habitat_flags", "habitat_profile_checked",
  "habitat_where_found_present", "habitat_mentions_state", "source_hash", "review_status", "review_notes",
  "reviewed_at", "resolved_scientific_name", "pending_source_update",
].join(", ");

const PAGE = 1000;
const cache = new Map<string, Promise<CatalogEntry[]>>();

async function fetchEntries(state: string): Promise<CatalogEntry[]> {
  const out: CatalogEntry[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("weed_catalog_entries")
      .select(ENTRY_COLUMNS)
      .eq("state", state)
      .order("common_name", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as CatalogEntry[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Every entry for a state. Throws on a failed read; an empty state is an empty list. */
export function loadCatalog(state: string, opts: { fresh?: boolean } = {}): Promise<CatalogEntry[]> {
  if (opts.fresh || !cache.has(state)) {
    const p = fetchEntries(state).catch(e => { cache.delete(state); throw e; });
    cache.set(state, p);
  }
  return cache.get(state)!;
}

export async function loadSources(state: string): Promise<CatalogSource[]> {
  const { data, error } = await supabase.from("weed_catalog_sources")
    .select("source_id, state, title, url, accessed, scope, catalog_version")
    .eq("state", state)
    .order("source_id", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CatalogSource[];
}

export async function loadReviewQueue(state: string): Promise<ReviewQueueItem[]> {
  const { data, error } = await supabase.from("weed_catalog_review_queue")
    .select("id, state, catalog_id, label, reason, source_id, catalog_version, resolved, resolution")
    .eq("state", state)
    .order("label", { ascending: true })
    .range(0, 1999);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReviewQueueItem[];
}
