-- Ground truth: what a person found standing in a patch the map flagged.
--
-- This is the label the patch-level weed work is built on. The map finds an
-- area; someone walks to it, looks, photographs it and says what is there.
-- One row per visit: a patch can be visited more than once (a later date, a
-- second opinion), and each visit stands on its own.
--
-- The patch is named by its stable spot id (weed_observations.candidate_id,
-- lib/weedScout/spotId.ts) and its map position, so the record survives the
-- archive row being re-saved or the scan being removed. Species are a list
-- because a patch is rarely one plant; each entry may carry a cover estimate
-- and a dominant flag. "What is here" is asked first and on its own, because
-- a pale patch is as often a wet hollow or a compaction strip as a weed, and
-- those answers are labels too.
CREATE TABLE IF NOT EXISTS public.ground_truth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  field_id uuid REFERENCES public.fields(id) ON DELETE SET NULL,
  scan_id uuid REFERENCES public.odm_tasks(id) ON DELETE SET NULL,
  candidate_id text,
  observation_id uuid REFERENCES public.weed_observations(id) ON DELETE SET NULL,

  -- Where the map put the patch, and where the person stood when recording.
  patch_lat double precision NOT NULL,
  patch_lng double precision NOT NULL,
  visitor_lat double precision,
  visitor_lng double precision,
  visitor_accuracy_m numeric,
  visited_at timestamptz NOT NULL DEFAULT now(),

  -- What was there.
  what_is_here text NOT NULL,
  species jsonb NOT NULL DEFAULT '[]'::jsonb,
  growth_stage text,
  patch_cover_pct numeric,
  confidence text NOT NULL DEFAULT 'likely',
  identified_by text NOT NULL DEFAULT 'operator',
  crop text,
  photo_paths text[] NOT NULL DEFAULT '{}',
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ground_truth_what_check CHECK (what_is_here IN (
    'weeds', 'crop_stress', 'bare_ground', 'waterlogging', 'crop_damage', 'nothing_unusual', 'other'
  )),
  CONSTRAINT ground_truth_confidence_check CHECK (confidence IN ('certain', 'likely', 'unsure')),
  CONSTRAINT ground_truth_identified_by_check CHECK (identified_by IN ('operator', 'agronomist', 'other')),
  CONSTRAINT ground_truth_cover_check CHECK (patch_cover_pct IS NULL OR (patch_cover_pct >= 0 AND patch_cover_pct <= 100)),
  CONSTRAINT ground_truth_species_array CHECK (jsonb_typeof(species) = 'array'),
  -- A weed record names at least one plant; "I don't know which" is a name too.
  CONSTRAINT ground_truth_weeds_named CHECK (what_is_here <> 'weeds' OR jsonb_array_length(species) > 0)
);

CREATE INDEX IF NOT EXISTS ground_truth_field_spot_idx ON public.ground_truth (field_id, candidate_id);
CREATE INDEX IF NOT EXISTS ground_truth_scan_idx ON public.ground_truth (scan_id);

ALTER TABLE public.ground_truth ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own ground_truth all" ON public.ground_truth;
CREATE POLICY "own ground_truth all" ON public.ground_truth
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ground_truth TO authenticated;
GRANT ALL ON public.ground_truth TO service_role;

DROP TRIGGER IF EXISTS update_ground_truth_updated_at ON public.ground_truth;
CREATE TRIGGER update_ground_truth_updated_at
  BEFORE UPDATE ON public.ground_truth
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.ground_truth IS
  'What a person found standing in a flagged patch: the label for patch-level weed estimation. One row per visit.';
COMMENT ON COLUMN public.ground_truth.species IS
  '[{name, catalogId|null, coverPct|null, dominant}] in the visitor''s words. Never filled by a model.';

-- Ground photos: private, owner-scoped, <user_id>/<field_id>/<ground_truth_id>/<n>.jpg
INSERT INTO storage.buckets (id, name, public)
VALUES ('ground-truth', 'ground-truth', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users read own ground truth photos" ON storage.objects;
CREATE POLICY "Users read own ground truth photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ground-truth' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "Users insert own ground truth photos" ON storage.objects;
CREATE POLICY "Users insert own ground truth photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ground-truth' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "Users delete own ground truth photos" ON storage.objects;
CREATE POLICY "Users delete own ground truth photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'ground-truth' AND (storage.foldername(name))[1] = auth.uid()::text);
