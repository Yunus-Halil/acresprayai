-- Saved Field Twins as records.
--
-- A twin's files stay where they are, in the owner's private folder of the `orthos` bucket:
--   orthos/<user id>/field-twins/<storage_key>/{twin.json.gz, atlas-N.jpg}
-- Until now the folder was the only record: the list showed raw folder names, a second build with the same name on
-- the same day overwrote the first (the folder name was a slug of both), a save cut off half way still listed as a
-- twin and then failed to open, and nothing said what crop, flight or camera a twin was.
--
-- This table is the list. New twins get a uuid as their storage_key, so nothing overwrites. `status` says whether
-- the files are all there: 'saving' while they upload, 'ready' when twin.json (written last) is in, 'incomplete'
-- when a save failed or was cut off. Twins saved before this table are registered by the app the first time it
-- lists the folder, under their existing folder name: nothing is moved or rewritten.
CREATE TABLE IF NOT EXISTS public.field_twins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_key text NOT NULL CHECK (storage_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  crop text CHECK (crop IN ('corn', 'orchard')),
  captured_at timestamptz,
  photographs integer CHECK (photographs >= 0),
  camera text,
  placement text CHECK (placement IN ('rtk', 'gnss', 'local')),
  area_ha numeric CHECK (area_ha >= 0),
  format text,
  status text NOT NULL DEFAULT 'saving' CHECK (status IN ('saving', 'ready', 'incomplete')),
  error text,
  build_ms integer CHECK (build_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, storage_key)
);

CREATE INDEX IF NOT EXISTS field_twins_user_created ON public.field_twins (user_id, created_at DESC);

ALTER TABLE public.field_twins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_twins FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.field_twins TO authenticated;
GRANT ALL ON public.field_twins TO service_role;

DROP POLICY IF EXISTS "own field twins" ON public.field_twins;
CREATE POLICY "own field twins" ON public.field_twins FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "pilot members only" ON public.field_twins;
CREATE POLICY "pilot members only" ON public.field_twins AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_pilot_member())) WITH CHECK ((SELECT public.is_pilot_member()));

CREATE OR REPLACE FUNCTION public.field_twins_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS field_twins_touch ON public.field_twins;
CREATE TRIGGER field_twins_touch BEFORE UPDATE ON public.field_twins
  FOR EACH ROW EXECUTE FUNCTION public.field_twins_touch();
