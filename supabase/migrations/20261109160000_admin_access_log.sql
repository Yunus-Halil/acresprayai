-- Every time the founder opens a participant's Field Twin from the admin panel.
--
-- Opening a twin shows field geometry and crops of the participant's photographs, which is their data, not
-- telemetry. The pilot-admin function allows it only while the participant's newest consent row allows
-- troubleshooting access, and writes a row here first. The participant can read the rows about them (so the access
-- is visible to them); nobody can change or delete a row through the API.
CREATE TABLE IF NOT EXISTS public.admin_access_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  founder_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  twin_id uuid REFERENCES public.field_twins(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('open_twin')),
  reason text CHECK (length(reason) <= 500)
);
CREATE INDEX IF NOT EXISTS admin_access_log_participant ON public.admin_access_log (participant_id, at DESC);

ALTER TABLE public.admin_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_access_log FROM anon, authenticated;
GRANT SELECT ON public.admin_access_log TO authenticated;
GRANT ALL ON public.admin_access_log TO service_role;

DROP POLICY IF EXISTS "see access to my data" ON public.admin_access_log;
CREATE POLICY "see access to my data" ON public.admin_access_log FOR SELECT TO authenticated USING (participant_id = auth.uid());

DROP POLICY IF EXISTS "pilot members only" ON public.admin_access_log;
CREATE POLICY "pilot members only" ON public.admin_access_log AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_pilot_member())) WITH CHECK ((SELECT public.is_pilot_member()));
