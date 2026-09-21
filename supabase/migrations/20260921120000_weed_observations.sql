-- Weed Scout observations: the archive the species estimates will be built from.
--
-- One row per candidate an operator chose to keep from the experimental Weed
-- Scout pipeline (src/lib/weedScout). Each row carries the event context
-- (where, local when, season, nearest-station weather), the crop and stage,
-- the pipeline's own measurements, the brain's estimate when one was asked
-- for, and the operator's verdict. The verdict is the label; the rest is the
-- feature. The chip itself lives in the private `weed-chips` bucket under the
-- owner's id, exactly like every other bucket here.
--
-- Owner-scoped by RLS. There is deliberately no cross-user read: the national
-- dataset is a later, consented, separate step.

CREATE TABLE IF NOT EXISTS public.weed_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  field_id uuid REFERENCES public.fields(id) ON DELETE SET NULL,
  scan_id uuid REFERENCES public.odm_tasks(id) ON DELETE SET NULL,
  candidate_id text NOT NULL,
  tile_id text NOT NULL,

  -- Where and when. `captured_at` is the scan's capture instant (UTC); the
  -- local columns are what a person at the field would have said.
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  captured_at timestamptz NOT NULL,
  local_time text,
  local_date date,
  season text NOT NULL,
  place text,
  time_zone text,
  weather jsonb,

  -- Agronomic context.
  crop text,
  growth_stage text,
  row_spacing_m numeric,

  -- Imagery and the chip.
  gsd_m numeric,
  chip_gsd_m numeric,
  chip_span_m numeric,
  chip_path text,

  -- What the pipeline measured. Never a verdict.
  kind text NOT NULL,
  score numeric NOT NULL,
  distance_to_row_m numeric,
  row_confidence numeric,
  anomaly_z numeric,
  anomaly_feature text,
  features jsonb,

  -- What the brain estimated, if asked. A description with stated uncertainty.
  brain jsonb,
  brain_model text,

  -- What the human decided. The label.
  verdict text,
  species text,
  notes text,
  verdict_at timestamptz,

  pipeline_version text NOT NULL DEFAULT 'weed-scout-v1',
  params jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT weed_observations_verdict_check CHECK (
    verdict IS NULL OR verdict IN ('weed', 'crop', 'not_vegetation', 'unsure')
  ),
  CONSTRAINT weed_observations_scan_candidate_unique UNIQUE (scan_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS weed_observations_user_scan_idx
  ON public.weed_observations (user_id, scan_id);
CREATE INDEX IF NOT EXISTS weed_observations_season_place_idx
  ON public.weed_observations (season, place);

ALTER TABLE public.weed_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own weed_observations all" ON public.weed_observations;
CREATE POLICY "own weed_observations all" ON public.weed_observations
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.weed_observations TO authenticated;
GRANT ALL ON public.weed_observations TO service_role;

DROP TRIGGER IF EXISTS update_weed_observations_updated_at ON public.weed_observations;
CREATE TRIGGER update_weed_observations_updated_at
  BEFORE UPDATE ON public.weed_observations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.weed_observations IS
  'Weed Scout archive: one row per candidate an operator kept. verdict is the human label; brain is the model estimate; features is the pipeline measurement.';

-- ---------------------------------------------------------------------------
-- `weed-chips` bucket: private, owner-scoped, path is <user_id>/<scan_id>/<candidate>.png
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('weed-chips', 'weed-chips', false)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets SET public = false
WHERE id = 'weed-chips' AND public IS DISTINCT FROM false;

DROP POLICY IF EXISTS "Users read own weed chips" ON storage.objects;
CREATE POLICY "Users read own weed chips"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'weed-chips' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users insert own weed chips" ON storage.objects;
CREATE POLICY "Users insert own weed chips"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'weed-chips' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users update own weed chips" ON storage.objects;
CREATE POLICY "Users update own weed chips"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'weed-chips' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'weed-chips' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users delete own weed chips" ON storage.objects;
CREATE POLICY "Users delete own weed chips"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'weed-chips' AND (storage.foldername(name))[1] = auth.uid()::text);
