-- An agronomist's word on a review area is theirs and stays.
--
-- Weed Scout groups a scan's model detections into review areas (lib/weedVision/
-- hotspots.ts) ranked for a look, not for treatment. Confirming, dismissing or
-- marking one uncertain is a human decision, kept here per scan and area id so
-- a rescan or a re-grouping never overwrites it; an area whose id moved keeps
-- its row and is listed as orphaned. Owner-scoped by RLS like every table here.
CREATE TABLE IF NOT EXISTS public.scan_hotspot_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  scan_id uuid NOT NULL REFERENCES public.odm_tasks(id) ON DELETE CASCADE,
  hotspot_id text NOT NULL,
  -- The run key the area was built from (settings + checkpoint), for provenance.
  params_key text,
  verdict text NOT NULL CHECK (verdict IN ('confirmed', 'dismissed', 'uncertain')),
  notes text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scan_hotspot_reviews_unique UNIQUE (scan_id, hotspot_id)
);

CREATE INDEX IF NOT EXISTS scan_hotspot_reviews_scan_idx ON public.scan_hotspot_reviews (scan_id);

ALTER TABLE public.scan_hotspot_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own scan_hotspot_reviews all" ON public.scan_hotspot_reviews;
CREATE POLICY "own scan_hotspot_reviews all" ON public.scan_hotspot_reviews
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
