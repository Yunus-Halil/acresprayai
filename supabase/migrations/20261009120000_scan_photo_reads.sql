-- A photo read once is a photo read.
--
-- The photo pass (lib/weedScout/photoPass.ts) decodes an original and runs the
-- planting-pattern pass on it: a download, a 20-megapixel decode and several
-- seconds in the worker, per photo, per run. Nothing in that depends on the
-- run: only on the photo's pixels, which never change for a scan, and on the
-- pass's settings. So the read is kept here, one row per (scan, photo,
-- settings), and the next run of the same scan, or the closer look opening a
-- spot in that photo, takes the row instead of the photo.
--
-- `pattern` is the pass's whole result for the photo (windows, blocks, blobs);
-- `decoded_width` and `native_width` are what carry it to the ground and to
-- the original's pixels. Owner-scoped by RLS like every table here.
CREATE TABLE IF NOT EXISTS public.scan_photo_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  scan_id uuid NOT NULL REFERENCES public.odm_tasks(id) ON DELETE CASCADE,
  filename text NOT NULL,
  -- The pass version and settings the read was made with; a different key is a different read.
  params_key text NOT NULL,
  decoded_width integer NOT NULL,
  native_width integer NOT NULL,
  pattern jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scan_photo_reads_unique UNIQUE (scan_id, filename, params_key)
);

CREATE INDEX IF NOT EXISTS scan_photo_reads_scan_idx ON public.scan_photo_reads (scan_id, params_key);

ALTER TABLE public.scan_photo_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own scan_photo_reads all" ON public.scan_photo_reads;
CREATE POLICY "own scan_photo_reads all" ON public.scan_photo_reads
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
