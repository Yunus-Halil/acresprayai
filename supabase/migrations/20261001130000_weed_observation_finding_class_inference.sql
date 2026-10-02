-- What a finding is, and whether the model was asked about it.
--
-- finding_class separates the findings the weed question applies to
-- (vegetation) from the ones it does not (bare ground, a thin stand, wet or
-- dark ground, an anomaly of no known kind). Only vegetation goes to the
-- classifier; the rest are findings in their own right and are never scored
-- as weeds. Derived from the pipeline's own measurements at save time.
--
-- inference records whether the classifier ran on this spot and on what:
--   {modelVersion, source: orthomosaic|source_frame, effectiveGsdM, requiredGsdM,
--    status: scored|unknown_resolution|not_vegetation|not_a_single_plant|no_chip}
-- A prediction exists only when status is "scored". "unknown_resolution" is
-- the model declining pixels coarser than it was trained on, which is a fact
-- about the imagery worth keeping, not a missing value.
ALTER TABLE public.weed_observations
  ADD COLUMN IF NOT EXISTS finding_class text
    CHECK (finding_class IS NULL OR finding_class IN ('vegetation', 'bare_ground', 'thin_stand', 'wet_or_dark_ground', 'other_anomaly')),
  ADD COLUMN IF NOT EXISTS inference jsonb;

COMMENT ON COLUMN public.weed_observations.finding_class IS
  'vegetation | bare_ground | thin_stand | wet_or_dark_ground | other_anomaly. Only vegetation is a weed question. Null on rows older than the column.';
COMMENT ON COLUMN public.weed_observations.inference IS
  'Whether the classifier ran on this spot at save time and on what pixels; prediction is set only when status = scored.';

-- Field history: a finding keeps its candidate_id across scans of the same
-- field (lib/weedScout/spotId.ts keys it on family and rounded centroid), so
-- the same ground flagged in two flights is two rows with one key.
CREATE INDEX IF NOT EXISTS weed_observations_field_spot_idx
  ON public.weed_observations (field_id, candidate_id)
  WHERE field_id IS NOT NULL;

-- One row per spot per field across every scan that flagged it. The base
-- table's row-level security applies (security_invoker), so each operator
-- sees their own history only.
CREATE OR REPLACE VIEW public.finding_history
WITH (security_invoker = true) AS
SELECT
  field_id,
  candidate_id,
  count(*)::int AS times_flagged,
  min(captured_at) AS first_seen,
  max(captured_at) AS last_seen,
  array_agg(scan_id ORDER BY captured_at) AS scan_ids,
  array_agg(captured_at ORDER BY captured_at) AS captured_ats,
  array_agg(verdict ORDER BY captured_at) AS verdicts,
  array_agg(finding_class ORDER BY captured_at) AS finding_classes,
  bool_or(verdict = 'weed' AND verdict_source = 'operator') AS operator_confirmed_weed,
  max(lat) AS lat,
  max(lng) AS lng
FROM public.weed_observations
WHERE field_id IS NOT NULL
GROUP BY field_id, candidate_id;

GRANT SELECT ON public.finding_history TO authenticated;

COMMENT ON VIEW public.finding_history IS
  'A finding across scans of one field, keyed on the stable spot id. The data model for change over time; no comparison is computed here.';
