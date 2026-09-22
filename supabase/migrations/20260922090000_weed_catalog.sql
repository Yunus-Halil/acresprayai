-- Weed reference catalog: sourced names per state, and the identification
-- columns that carry an operator's confirmed label through the archive and
-- the application record.
--
-- WHAT THE CATALOG IS. Records from a state Extension identification index,
-- crosswalked to the USDA state plants checklist, with crop-guide citations
-- where a table names the weed and the state's noxious-weed tiers kept in
-- their own columns. It is a name list with sources. It is not a list of
-- verified farm weeds, not a presence claim for any field, and nothing in it
-- is aerially validated (the importer refuses a row that says otherwise).
--
-- TWO OWNERS PER ROW. Source-owned columns are written by import_weed_catalog()
-- and only by it. Review-owned columns (review_status, review_notes,
-- reviewed_by, reviewed_at, resolved_scientific_name, pending_source_update)
-- are written by people. A re-import never touches a review-owned column; if
-- the upstream record of a reviewed entry changed, the incoming row is parked
-- in pending_source_update for the reviewer to look at.
--
-- IDENTIFICATION IS THE OPERATOR'S. weed_observations gains a suggestion
-- (what was shown, and why) separate from an identification (what the
-- operator said). A confirmed identification must equal the suggestion it
-- confirmed; unidentified and rejected rows carry no catalog id. The check
-- constraints make that structural rather than a UI promise.

-- ---------------------------------------------------------------------------
-- Sources
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.weed_catalog_sources (
  source_id text PRIMARY KEY,
  state text NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  accessed date,
  scope text,
  catalog_version text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Entries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.weed_catalog_entries (
  -- Source-owned
  catalog_id text PRIMARY KEY,
  state text NOT NULL,
  catalog_version text NOT NULL,
  as_of date,
  common_name text NOT NULL,
  scientific_name_as_source text NOT NULL,
  plant_type text NOT NULL DEFAULT 'unclassified',
  vt_profile_url text,
  usda_status text NOT NULL,
  usda_symbol text,
  usda_candidate_symbols jsonb NOT NULL DEFAULT '[]'::jsonb,
  usda_match_method text,
  crop_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  crop_contexts text[] NOT NULL DEFAULT '{}',
  regulatory_tier text,
  regulatory_scientific_name text,
  regulatory_source_id text REFERENCES public.weed_catalog_sources(source_id),
  catalog_status text NOT NULL,
  aerial_identification_validated boolean NOT NULL DEFAULT false,
  source_ids text[] NOT NULL DEFAULT '{}',
  habitat_flags text[] NOT NULL DEFAULT '{}',
  habitat_profile_checked boolean NOT NULL DEFAULT false,
  habitat_where_found_present boolean NOT NULL DEFAULT false,
  habitat_mentions_state boolean NOT NULL DEFAULT false,
  source_hash text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  -- Review-owned
  review_status text NOT NULL DEFAULT 'unreviewed',
  review_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  resolved_scientific_name text,
  pending_source_update jsonb,

  CONSTRAINT weed_catalog_entries_status_check CHECK (
    catalog_status IN ('source_index_only', 'crop_context_sourced', 'regulatory_only')
  ),
  CONSTRAINT weed_catalog_entries_usda_check CHECK (
    usda_status IN ('matched', 'unmatched_requires_review', 'not_crosswalked')
  ),
  CONSTRAINT weed_catalog_entries_review_check CHECK (
    review_status IN ('unreviewed', 'expert_reviewed', 'excluded')
  ),
  -- No field-image accuracy study exists. A row cannot claim one.
  CONSTRAINT weed_catalog_entries_no_aerial_claim CHECK (aerial_identification_validated = false),
  -- Tier 1 means "not known present in Virginia"; it cannot also be a checklist match.
  CONSTRAINT weed_catalog_entries_tier1_presence CHECK (
    NOT (regulatory_tier = 'Tier 1' AND usda_status = 'matched')
  ),
  -- Crop status requires crop evidence; index-only status may carry none.
  CONSTRAINT weed_catalog_entries_crop_evidence CHECK (
    (catalog_status = 'crop_context_sourced') = (jsonb_array_length(crop_evidence) > 0)
  )
);

CREATE INDEX IF NOT EXISTS weed_catalog_entries_state_idx ON public.weed_catalog_entries (state, catalog_status);
CREATE INDEX IF NOT EXISTS weed_catalog_entries_common_name_idx ON public.weed_catalog_entries (state, lower(common_name));

-- ---------------------------------------------------------------------------
-- Review queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.weed_catalog_review_queue (
  id text PRIMARY KEY,
  state text NOT NULL,
  catalog_id text REFERENCES public.weed_catalog_entries(catalog_id) ON DELETE CASCADE,
  label text NOT NULL,
  reason text NOT NULL,
  source_id text REFERENCES public.weed_catalog_sources(source_id),
  catalog_version text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  -- Review-owned
  resolved boolean NOT NULL DEFAULT false,
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS weed_catalog_review_queue_state_idx ON public.weed_catalog_review_queue (state, resolved);

-- ---------------------------------------------------------------------------
-- Access: every signed-in user may read reference data; only the service
-- role (the importer) writes it. Review edits arrive later behind a
-- reviewer allowlist; nothing here grants them yet.
-- ---------------------------------------------------------------------------
ALTER TABLE public.weed_catalog_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weed_catalog_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weed_catalog_review_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read weed_catalog_sources" ON public.weed_catalog_sources;
CREATE POLICY "read weed_catalog_sources" ON public.weed_catalog_sources FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "read weed_catalog_entries" ON public.weed_catalog_entries;
CREATE POLICY "read weed_catalog_entries" ON public.weed_catalog_entries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "read weed_catalog_review_queue" ON public.weed_catalog_review_queue;
CREATE POLICY "read weed_catalog_review_queue" ON public.weed_catalog_review_queue FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.weed_catalog_sources, public.weed_catalog_entries, public.weed_catalog_review_queue TO authenticated;
GRANT ALL ON public.weed_catalog_sources, public.weed_catalog_entries, public.weed_catalog_review_queue TO service_role;

-- ---------------------------------------------------------------------------
-- The importer. Repeatable: same payload twice changes nothing; a changed
-- upstream row updates source-owned columns on an unreviewed entry and is
-- parked on a reviewed one. Never writes a review-owned column.
--
-- Payload (built by src/lib/weedCatalog/import.ts):
--   { state, catalog_version, as_of, scope, sources: [...], entries: [...], review_queue: [...] }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_weed_catalog(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state text := p->>'state';
  v_version text := p->>'catalog_version';
  v_as_of date := (p->>'as_of')::date;
  r jsonb;
  existing record;
  n_sources int := 0;
  n_inserted int := 0;
  n_updated int := 0;
  n_unchanged int := 0;
  n_held int := 0;
  n_queue int := 0;
BEGIN
  IF v_state IS NULL OR v_version IS NULL THEN
    RAISE EXCEPTION 'import_weed_catalog: payload needs state and catalog_version';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p->'sources', '[]'::jsonb)) LOOP
    INSERT INTO weed_catalog_sources (source_id, state, title, url, accessed, scope, catalog_version, imported_at)
    VALUES (r->>'source_id', v_state, r->>'title', r->>'url', (r->>'accessed')::date, r->>'scope', v_version, now())
    ON CONFLICT (source_id) DO UPDATE SET
      state = EXCLUDED.state, title = EXCLUDED.title, url = EXCLUDED.url, accessed = EXCLUDED.accessed,
      scope = EXCLUDED.scope, catalog_version = EXCLUDED.catalog_version, imported_at = now();
    n_sources := n_sources + 1;
  END LOOP;

  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p->'entries', '[]'::jsonb)) LOOP
    -- Defence in depth: the parser refuses these too, but the database is the last word.
    IF coalesce((r->>'aerial_identification_validated')::boolean, false) THEN
      RAISE EXCEPTION 'import_weed_catalog: % claims aerial identification validation', r->>'catalog_id';
    END IF;
    IF r->>'regulatory_tier' = 'Tier 1' AND r->>'usda_status' = 'matched' THEN
      RAISE EXCEPTION 'import_weed_catalog: % is Tier 1 (not known present) and cannot be a checklist match', r->>'catalog_id';
    END IF;

    SELECT catalog_id, source_hash, review_status INTO existing
    FROM weed_catalog_entries WHERE catalog_id = r->>'catalog_id';

    IF NOT FOUND THEN
      INSERT INTO weed_catalog_entries (
        catalog_id, state, catalog_version, as_of, common_name, scientific_name_as_source, plant_type,
        vt_profile_url, usda_status, usda_symbol, usda_candidate_symbols, usda_match_method, crop_evidence,
        crop_contexts, regulatory_tier, regulatory_scientific_name, regulatory_source_id, catalog_status,
        aerial_identification_validated, source_ids, habitat_flags, habitat_profile_checked,
        habitat_where_found_present, habitat_mentions_state, source_hash, imported_at
      ) VALUES (
        r->>'catalog_id', v_state, v_version, v_as_of, r->>'common_name', r->>'scientific_name_as_source',
        coalesce(r->>'plant_type', 'unclassified'), r->>'vt_profile_url', r->>'usda_status', r->>'usda_symbol',
        coalesce(r->'usda_candidate_symbols', '[]'::jsonb), r->>'usda_match_method',
        coalesce(r->'crop_evidence', '[]'::jsonb),
        ARRAY(SELECT jsonb_array_elements_text(coalesce(r->'crop_contexts', '[]'::jsonb))),
        r->>'regulatory_tier', r->>'regulatory_scientific_name', r->>'regulatory_source_id', r->>'catalog_status',
        false,
        ARRAY(SELECT jsonb_array_elements_text(coalesce(r->'source_ids', '[]'::jsonb))),
        ARRAY(SELECT jsonb_array_elements_text(coalesce(r->'habitat_flags', '[]'::jsonb))),
        coalesce((r->>'habitat_profile_checked')::boolean, false),
        coalesce((r->>'habitat_where_found_present')::boolean, false),
        coalesce((r->>'habitat_mentions_state')::boolean, false),
        r->>'source_hash', now()
      );
      n_inserted := n_inserted + 1;
    ELSIF existing.source_hash = r->>'source_hash' THEN
      -- Same content: only the version stamp moves.
      UPDATE weed_catalog_entries
      SET catalog_version = v_version, as_of = v_as_of, imported_at = now()
      WHERE catalog_id = existing.catalog_id;
      n_unchanged := n_unchanged + 1;
    ELSIF existing.review_status <> 'unreviewed' THEN
      -- Reviewed by a person: park the change, touch nothing they own or saw.
      UPDATE weed_catalog_entries
      SET pending_source_update = r
      WHERE catalog_id = existing.catalog_id;
      n_held := n_held + 1;
    ELSE
      UPDATE weed_catalog_entries SET
        state = v_state, catalog_version = v_version, as_of = v_as_of,
        common_name = r->>'common_name', scientific_name_as_source = r->>'scientific_name_as_source',
        plant_type = coalesce(r->>'plant_type', 'unclassified'), vt_profile_url = r->>'vt_profile_url',
        usda_status = r->>'usda_status', usda_symbol = r->>'usda_symbol',
        usda_candidate_symbols = coalesce(r->'usda_candidate_symbols', '[]'::jsonb),
        usda_match_method = r->>'usda_match_method',
        crop_evidence = coalesce(r->'crop_evidence', '[]'::jsonb),
        crop_contexts = ARRAY(SELECT jsonb_array_elements_text(coalesce(r->'crop_contexts', '[]'::jsonb))),
        regulatory_tier = r->>'regulatory_tier', regulatory_scientific_name = r->>'regulatory_scientific_name',
        regulatory_source_id = r->>'regulatory_source_id', catalog_status = r->>'catalog_status',
        aerial_identification_validated = false,
        source_ids = ARRAY(SELECT jsonb_array_elements_text(coalesce(r->'source_ids', '[]'::jsonb))),
        habitat_flags = ARRAY(SELECT jsonb_array_elements_text(coalesce(r->'habitat_flags', '[]'::jsonb))),
        habitat_profile_checked = coalesce((r->>'habitat_profile_checked')::boolean, false),
        habitat_where_found_present = coalesce((r->>'habitat_where_found_present')::boolean, false),
        habitat_mentions_state = coalesce((r->>'habitat_mentions_state')::boolean, false),
        source_hash = r->>'source_hash', imported_at = now(),
        pending_source_update = NULL
      WHERE catalog_id = existing.catalog_id;
      n_updated := n_updated + 1;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p->'review_queue', '[]'::jsonb)) LOOP
    INSERT INTO weed_catalog_review_queue (id, state, catalog_id, label, reason, source_id, catalog_version, imported_at)
    VALUES (r->>'id', v_state, r->>'catalog_id', r->>'label', r->>'reason', r->>'source_id', v_version, now())
    ON CONFLICT (id) DO UPDATE SET
      state = EXCLUDED.state, catalog_id = EXCLUDED.catalog_id, label = EXCLUDED.label, reason = EXCLUDED.reason,
      source_id = EXCLUDED.source_id, catalog_version = EXCLUDED.catalog_version, imported_at = now();
    -- resolved / resolution / resolved_by / resolved_at are never written here.
    n_queue := n_queue + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'state', v_state, 'catalog_version', v_version,
    'sources', n_sources, 'inserted', n_inserted, 'updated', n_updated,
    'unchanged', n_unchanged, 'held_for_review', n_held, 'review_queue', n_queue
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_weed_catalog(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_weed_catalog(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.import_weed_catalog(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.import_weed_catalog(jsonb) TO service_role;

COMMENT ON TABLE public.weed_catalog_entries IS
  'State weed reference catalog: sourced names, not detections and not presence claims. Source-owned columns are written by import_weed_catalog() only; review_* and pending_source_update are written by people only.';

-- ---------------------------------------------------------------------------
-- weed_observations: the suggestion shown, and the identification made.
-- ---------------------------------------------------------------------------
ALTER TABLE public.weed_observations
  ADD COLUMN IF NOT EXISTS suggested_catalog_id text REFERENCES public.weed_catalog_entries(catalog_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggestion_basis text,
  ADD COLUMN IF NOT EXISTS identification_status text NOT NULL DEFAULT 'unidentified',
  ADD COLUMN IF NOT EXISTS catalog_id text REFERENCES public.weed_catalog_entries(catalog_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS identification_source text,
  ADD COLUMN IF NOT EXISTS identification_basis text,
  ADD COLUMN IF NOT EXISTS identified_at timestamptz;

ALTER TABLE public.weed_observations DROP CONSTRAINT IF EXISTS weed_observations_identification_status_check;
ALTER TABLE public.weed_observations ADD CONSTRAINT weed_observations_identification_status_check CHECK (
  identification_status IN ('unidentified', 'confirmed', 'edited', 'rejected')
);

-- A stated identification carries a label; an unstated one carries no catalog id.
ALTER TABLE public.weed_observations DROP CONSTRAINT IF EXISTS weed_observations_identification_shape;
ALTER TABLE public.weed_observations ADD CONSTRAINT weed_observations_identification_shape CHECK (
  (identification_status IN ('confirmed', 'edited') AND species IS NOT NULL AND btrim(species) <> '')
  OR (identification_status IN ('unidentified', 'rejected') AND catalog_id IS NULL)
);

-- A confirmation can only confirm what was suggested.
ALTER TABLE public.weed_observations DROP CONSTRAINT IF EXISTS weed_observations_confirmed_matches_suggestion;
ALTER TABLE public.weed_observations ADD CONSTRAINT weed_observations_confirmed_matches_suggestion CHECK (
  identification_status <> 'confirmed' OR (catalog_id IS NOT NULL AND catalog_id = suggested_catalog_id)
);

COMMENT ON COLUMN public.weed_observations.suggested_catalog_id IS
  'What the scout offered (retrieval over the operator''s own verdicts), never a finding. See catalog_id for what the operator said.';
COMMENT ON COLUMN public.weed_observations.identification_status IS
  'unidentified | confirmed (equals the suggestion) | edited (operator''s own pick or text) | rejected. Only confirmed and edited may be printed as findings.';

-- ---------------------------------------------------------------------------
-- user_annotations: the label an applied candidate carries onto Field View,
-- the Flight Planner and the report. Null unless the operator stated one.
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_annotations
  ADD COLUMN IF NOT EXISTS weed_label text,
  ADD COLUMN IF NOT EXISTS weed_label_status text,
  ADD COLUMN IF NOT EXISTS weed_catalog_id text REFERENCES public.weed_catalog_entries(catalog_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS weed_label_source text,
  ADD COLUMN IF NOT EXISTS weed_observation_id uuid REFERENCES public.weed_observations(id) ON DELETE SET NULL;

ALTER TABLE public.user_annotations DROP CONSTRAINT IF EXISTS user_annotations_weed_label_shape;
ALTER TABLE public.user_annotations ADD CONSTRAINT user_annotations_weed_label_shape CHECK (
  (weed_label IS NULL AND weed_label_status IS NULL AND weed_catalog_id IS NULL)
  OR (weed_label IS NOT NULL AND weed_label_status IN ('confirmed', 'edited'))
);

COMMENT ON COLUMN public.user_annotations.weed_label IS
  'Operator-stated weed name carried from a Weed Scout identification. Null means not identified; a suggestion never lands here.';
