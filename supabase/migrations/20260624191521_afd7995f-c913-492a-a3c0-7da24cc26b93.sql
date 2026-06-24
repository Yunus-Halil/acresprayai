
ALTER TABLE public.odm_tasks
  ADD COLUMN IF NOT EXISTS tiles_baked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tiles_done integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tiles_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tiles_min_zoom integer,
  ADD COLUMN IF NOT EXISTS tiles_max_zoom integer;

DROP POLICY IF EXISTS "service_role manages tiles" ON storage.objects;
CREATE POLICY "service_role manages tiles"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'tiles')
  WITH CHECK (bucket_id = 'tiles');
