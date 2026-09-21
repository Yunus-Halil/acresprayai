-- Weed Scout v2: regions, the plant-population score, the feature vector the
-- scout learns from, and the in-house estimate.
--
-- Additive on purpose. The first migration may already be applied, so nothing
-- here renames or drops; the `brain` / `brain_model` columns from v1 stay in
-- place, unused (the external model was removed; nothing writes them now).
--
--   geometry       region outline rings (WGS84) for region candidates
--   area_m2        ground area: the region's, or the plant's
--   tile_count     tiles in the region
--   class          how the region reads (bare or dry ground, thin stand, ...)
--   blob_z         how unlike the field's plants this plant was, and on what
--   vector         the standardised-comparison vector feedback.ts uses, so an
--                  archived verdict can be compared without re-running anything
--   estimate       the in-house description (rules + retrieval), never a verdict

ALTER TABLE public.weed_observations
  ADD COLUMN IF NOT EXISTS geometry jsonb,
  ADD COLUMN IF NOT EXISTS area_m2 numeric,
  ADD COLUMN IF NOT EXISTS tile_count integer,
  ADD COLUMN IF NOT EXISTS class text,
  ADD COLUMN IF NOT EXISTS blob_z numeric,
  ADD COLUMN IF NOT EXISTS blob_z_feature text,
  ADD COLUMN IF NOT EXISTS vector jsonb,
  ADD COLUMN IF NOT EXISTS estimate jsonb,
  ADD COLUMN IF NOT EXISTS estimate_model text;

-- The feedback loader reads every row with a verdict and a vector.
CREATE INDEX IF NOT EXISTS weed_observations_verdict_idx
  ON public.weed_observations (user_id, verdict)
  WHERE verdict IS NOT NULL;

COMMENT ON COLUMN public.weed_observations.vector IS
  'Feature vector (feedback.ts featureVectorOf) at save time; plants and ground use different lengths.';
COMMENT ON COLUMN public.weed_observations.estimate IS
  'In-house description (swathwise-inhouse-v1): rules over the measurements plus retrieval over this archive. Never a verdict.';
