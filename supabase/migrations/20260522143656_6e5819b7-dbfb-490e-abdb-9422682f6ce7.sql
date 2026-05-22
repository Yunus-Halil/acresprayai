CREATE TABLE public.pilot_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pilot_signups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can signup" ON public.pilot_signups FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "no public read" ON public.pilot_signups FOR SELECT TO authenticated USING (false);
CREATE INDEX pilot_signups_created_at_idx ON public.pilot_signups (created_at DESC);