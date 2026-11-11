-- The founder's stars on the pilot desk: the people they want to keep an eye on.
--
-- One row per starred account. It is the founder's own mark, not a fact about the participant, so it lives apart from
-- pilot_members (a participant can read their own membership row; nobody but the desk reads this). Read and written
-- only by the pilot-admin function with the service role: the browser roles have no privilege on it and no policy
-- lets them through.
--
-- Additive; running it twice is harmless. To undo: DROP TABLE public.pilot_desk_stars.

CREATE TABLE IF NOT EXISTS public.pilot_desk_stars (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  starred_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pilot_desk_stars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pilot_desk_stars FROM anon, authenticated;
GRANT ALL ON public.pilot_desk_stars TO service_role;

-- Explicit, so that a permissive policy added later has to be a deliberate act that removes this one.
DROP POLICY IF EXISTS "the desk only" ON public.pilot_desk_stars;
CREATE POLICY "the desk only" ON public.pilot_desk_stars AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

COMMENT ON TABLE public.pilot_desk_stars IS
  'The founder''s starred people on the pilot desk. Service role only (the pilot-admin function).';
