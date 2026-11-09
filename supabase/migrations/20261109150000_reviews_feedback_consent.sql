-- The pilot's two-way channel, and the participant's say over their data.
--
--   twin_reviews     a participant's verdict on one finding of one of their twins: correct, unsure or wrong, an
--                    optional note, the algorithm's label at the time (so the two can be compared), and for the
--                    field boundary the corrected outline. Never written by Swardus; never changes the twin.
--   pilot_feedback   problems, ideas and "this finding is wrong" notes, with the page and twin they came from. The
--                    participant can read what they sent; the founder reads everything through pilot-admin.
--   pilot_consents   which version of the pilot terms a participant accepted, and their two optional choices:
--                    letting the founder open their twins to troubleshoot, and letting their imagery be used for
--                    research. Each change is a new row; the newest row is in force.
--
-- All three: own rows only, plus the "pilot members only" gate from 20261109120000.

CREATE TABLE IF NOT EXISTS public.twin_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  twin_id uuid NOT NULL REFERENCES public.field_twins(id) ON DELETE CASCADE,
  finding_kind text NOT NULL CHECK (finding_kind IN ('weed', 'tree', 'vegetation', 'patch', 'region', 'zone', 'corn_row', 'corn_weed', 'corn_gap', 'boundary')),
  finding_id text NOT NULL CHECK (length(finding_id) BETWEEN 1 AND 64),
  verdict text NOT NULL CHECK (verdict IN ('correct', 'unsure', 'wrong')),
  note text CHECK (length(note) <= 2000),
  algorithm_status text CHECK (length(algorithm_status) <= 64),
  payload jsonb CHECK (payload IS NULL OR pg_column_size(payload) <= 65536),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, twin_id, finding_kind, finding_id)
);
CREATE INDEX IF NOT EXISTS twin_reviews_twin ON public.twin_reviews (twin_id);

ALTER TABLE public.twin_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.twin_reviews FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.twin_reviews TO authenticated;
GRANT ALL ON public.twin_reviews TO service_role;

DROP POLICY IF EXISTS "own reviews" ON public.twin_reviews;
-- The twin must be the reviewer's own too, not only the review row: nobody can attach reviews to someone else's twin.
CREATE POLICY "own reviews" ON public.twin_reviews FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.field_twins t WHERE t.id = twin_id AND t.user_id = auth.uid()));

DROP POLICY IF EXISTS "pilot members only" ON public.twin_reviews;
CREATE POLICY "pilot members only" ON public.twin_reviews AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_pilot_member())) WITH CHECK ((SELECT public.is_pilot_member()));

CREATE OR REPLACE FUNCTION public.twin_reviews_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS twin_reviews_touch ON public.twin_reviews;
CREATE TRIGGER twin_reviews_touch BEFORE UPDATE ON public.twin_reviews FOR EACH ROW EXECUTE FUNCTION public.twin_reviews_touch();

CREATE TABLE IF NOT EXISTS public.pilot_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('problem', 'idea', 'finding', 'other')),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 5000),
  route text CHECK (length(route) <= 200),
  twin_id uuid REFERENCES public.field_twins(id) ON DELETE SET NULL,
  context jsonb CHECK (context IS NULL OR pg_column_size(context) <= 8192),
  -- The founder's own bookkeeping, written through pilot-admin.
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'done')),
  notified_at timestamptz
);
CREATE INDEX IF NOT EXISTS pilot_feedback_created ON public.pilot_feedback (created_at DESC);

ALTER TABLE public.pilot_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pilot_feedback FROM anon, authenticated;
GRANT SELECT, INSERT ON public.pilot_feedback TO authenticated;
GRANT ALL ON public.pilot_feedback TO service_role;

DROP POLICY IF EXISTS "send feedback" ON public.pilot_feedback;
CREATE POLICY "send feedback" ON public.pilot_feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'new' AND notified_at IS NULL
    AND (twin_id IS NULL OR EXISTS (SELECT 1 FROM public.field_twins t WHERE t.id = twin_id AND t.user_id = auth.uid())));
DROP POLICY IF EXISTS "read own feedback" ON public.pilot_feedback;
CREATE POLICY "read own feedback" ON public.pilot_feedback FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "pilot members only" ON public.pilot_feedback;
CREATE POLICY "pilot members only" ON public.pilot_feedback AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_pilot_member())) WITH CHECK ((SELECT public.is_pilot_member()));

CREATE TABLE IF NOT EXISTS public.pilot_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  terms_version text NOT NULL CHECK (length(terms_version) BETWEEN 1 AND 40),
  troubleshooting_access boolean NOT NULL DEFAULT false,
  research_use boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS pilot_consents_user ON public.pilot_consents (user_id, created_at DESC);

ALTER TABLE public.pilot_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pilot_consents FROM anon, authenticated;
-- Insert and read only: a change of mind is a new row, so the history of what was agreed stays intact.
GRANT SELECT, INSERT ON public.pilot_consents TO authenticated;
GRANT ALL ON public.pilot_consents TO service_role;

DROP POLICY IF EXISTS "own consents read" ON public.pilot_consents;
CREATE POLICY "own consents read" ON public.pilot_consents FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own consents write" ON public.pilot_consents;
CREATE POLICY "own consents write" ON public.pilot_consents FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "pilot members only" ON public.pilot_consents;
CREATE POLICY "pilot members only" ON public.pilot_consents AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_pilot_member())) WITH CHECK ((SELECT public.is_pilot_member()));
