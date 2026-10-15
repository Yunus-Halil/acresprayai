-- A photograph scored by a model is scored.
--
-- Weed Scout can run an instance-segmentation model (lib/weedVision, the local
-- research service: RF-DETR Seg-Large or ERFNet) over every kept original of a
-- scan. A photo's result depends on its pixels, the algorithm, its settings and
-- the checkpoint, none of which change between visits, so it is kept here, one
-- row per (scan, photo, run key), and the next run with the same key, or a
-- reload of the page, takes the rows instead of the photos.
--
-- `detections` is the photo's instances carried to the ground (lib/weedVision/
-- frames.ts FrameDetection[]): class, confidence, the outline in the original
-- photo's pixels and on the ground, size in metres. Owner-scoped by RLS like
-- every table here.
CREATE TABLE IF NOT EXISTS public.scan_frame_detections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  scan_id uuid NOT NULL REFERENCES public.odm_tasks(id) ON DELETE CASCADE,
  filename text NOT NULL,
  -- The run version, algorithm, settings and checkpoint hash; a different key is a different run.
  params_key text NOT NULL,
  algorithm text NOT NULL,
  model_sha256 text,
  params jsonb,
  native_width integer NOT NULL,
  native_height integer NOT NULL,
  count_weed integer NOT NULL DEFAULT 0,
  count_crop integer NOT NULL DEFAULT 0,
  timings_ms jsonb,
  detections jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scan_frame_detections_unique UNIQUE (scan_id, filename, params_key)
);

CREATE INDEX IF NOT EXISTS scan_frame_detections_scan_idx ON public.scan_frame_detections (scan_id, params_key);

ALTER TABLE public.scan_frame_detections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own scan_frame_detections all" ON public.scan_frame_detections;
CREATE POLICY "own scan_frame_detections all" ON public.scan_frame_detections
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
