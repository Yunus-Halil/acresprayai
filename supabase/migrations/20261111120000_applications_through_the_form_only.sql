-- Applications to the pilot are written by the application form's function only.
--
-- The two application tables (pilot_applications, and the older pilot_signups) accepted inserts straight from the
-- browser, with any values a caller chose, the row's date included. The form has not written that way since it began
-- posting to the pilot-apply function, which validates the answers, dates the row in the database and counts it
-- towards its limits; the direct path was a second way in that did none of that.
--
-- This removes the direct path: the insert policies are dropped and the privilege is revoked from the two browser
-- roles. Reading was already refused. The functions (service role) are unaffected, no row is changed, and running
-- this twice is harmless.
--
-- To undo: re-create the two policies from 20260817160000 and 20260629155456 and GRANT INSERT back.

DROP POLICY IF EXISTS "anyone can submit a pilot application" ON public.pilot_applications;
REVOKE INSERT, UPDATE, DELETE ON public.pilot_applications FROM anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.pilot_signups') IS NOT NULL THEN
    DROP POLICY IF EXISTS "anyone can signup" ON public.pilot_signups;
    REVOKE INSERT, UPDATE, DELETE ON public.pilot_signups FROM anon, authenticated;
  END IF;
END $$;

COMMENT ON TABLE public.pilot_applications IS
  'Pilot programme applications. Written only by the pilot-apply edge function (service role) and read only through '
  'the founder''s functions; the browser roles can neither read nor write it.';
