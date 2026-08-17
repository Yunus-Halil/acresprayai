-- Cache the resolved band mapping per scan.
--
-- Working out which band is red and which is NIR requires a TiTiler /cog/info
-- round-trip. That was happening inside a per-warm-instance memo, so a cold
-- instance re-probed on the first tile of every viewport, and nothing survived
-- a redeploy. The mapping is a property of the orthophoto and never changes for
-- a given scan, so it belongs on the row.
--
-- Shape (see supabase/functions/_shared/bands.ts):
--   {
--     "total": 3, "spectral": 2, "hasAlpha": true,
--     "roles": { "red": 1, "nir": 2 },
--     "method": "descriptions",
--     "available": ["ndvi"],
--     "hasNDVI": true,
--     "fingerprint": "ndvi:2-1",
--     "reason": "..."
--   }
--
-- `fingerprint` is what tile URLs embed, so a corrected mapping produces a
-- different URL and browsers stop serving tiles rendered with the old
-- expression. Clearing this column forces a clean re-probe.
ALTER TABLE public.odm_tasks
  ADD COLUMN IF NOT EXISTS band_mapping jsonb;

COMMENT ON COLUMN public.odm_tasks.band_mapping IS
  'Resolved orthophoto band roles and the index expression fingerprint. '
  'Set null to force ndvi-tile to re-probe the file.';
