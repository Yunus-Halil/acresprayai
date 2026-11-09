-- Founding pilot: who may use Swardus, enforced by the database.
--
-- Until now any signed-in account could use every table and bucket it owned, and "invite only" was a missing sign-up
-- form. This migration makes membership a server-side fact:
--
--   1. public.pilot_members: one row per invited person, with a role.
--        founder      everything (the orthomosaic workflow, the founder pages)
--        participant  the Field Twin pilot
--      Written by the service role only (the founder's pilot-admin function, or SQL). A member may read their own
--      row, which is how the app learns its role.
--   2. public.is_pilot_member() / pilot_role() / is_pilot_founder(): the checks, SECURITY DEFINER so a policy on
--      another table can consult pilot_members without that table's own policy getting in the way.
--   3. A RESTRICTIVE "pilot members only" policy on every user table and on storage.objects. Restrictive policies
--      are ANDed with the existing permissive ones, so every existing owner rule stays exactly as written and now
--      additionally requires an active membership. Nothing existing is dropped or rewritten. The two application
--      tables (pilot_applications, pilot_signups) are left alone: applicants are not members.
--   4. odm_tasks: users may no longer insert rows or rewrite the columns service-role functions trust (odm_uuid,
--      ortho_path, output_path, status, the tile plan...). Rows are created by odm-submit / ortho-import with the
--      service role; the browser only ever updated ai_analysis and ai_analysis_at (scanAssessment.ts,
--      ScanTimeline.tsx), so exactly those two stay updatable. This closes the audit's C1: a user rewriting their own
--      row's ortho_path or odm_uuid to make ortho-url / odm-poll sign or copy someone else's files.
--   5. The founder's accounts, seeded by email, so applying this does not lock the founder out.
--
-- Non-destructive: no table, column, row or existing policy is removed. An account without a membership row keeps
-- its data; it simply cannot read or write it until it is added. Before applying, list the existing accounts and add
-- any that should keep access (docs/operations/pilot-access.md has the queries).

-- ---------------------------------------------------------------------------
-- 1. Membership
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pilot_members (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('founder', 'participant')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  -- As invited. auth.users.email is the source of truth for sign-in; this is what the founder typed.
  email text,
  display_name text,
  organisation text,
  application_id uuid REFERENCES public.pilot_applications(id) ON DELETE SET NULL,
  invited_at timestamptz,
  invited_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pilot_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pilot_members FROM anon, authenticated;
GRANT SELECT ON public.pilot_members TO authenticated;
GRANT ALL ON public.pilot_members TO service_role;

DROP POLICY IF EXISTS "read own membership" ON public.pilot_members;
CREATE POLICY "read own membership" ON public.pilot_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.pilot_members_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS pilot_members_touch ON public.pilot_members;
CREATE TRIGGER pilot_members_touch BEFORE UPDATE ON public.pilot_members
  FOR EACH ROW EXECUTE FUNCTION public.pilot_members_touch();

-- ---------------------------------------------------------------------------
-- 2. The checks
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pilot_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.pilot_members WHERE user_id = auth.uid() AND status = 'active'
$$;

CREATE OR REPLACE FUNCTION public.is_pilot_member()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.pilot_members WHERE user_id = auth.uid() AND status = 'active')
$$;

CREATE OR REPLACE FUNCTION public.is_pilot_founder()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.pilot_members WHERE user_id = auth.uid() AND status = 'active' AND role = 'founder')
$$;

REVOKE ALL ON FUNCTION public.pilot_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_pilot_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_pilot_founder() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pilot_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_pilot_member() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_pilot_founder() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Members only, on every user table and on storage
--
--    `(SELECT public.is_pilot_member())` rather than a bare call: Postgres evaluates it once per statement (an
--    InitPlan) instead of once per row. Tables that do not exist in a given project are skipped, so the list can
--    name every table the app has ever used.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'fields', 'drones', 'scans', 'jobs', 'odm_tasks', 'orthomosaics', 'crop_zones', 'anomalies',
    'spray_recommendations', 'user_annotations', 'flight_logs', 'field_reports', 'flight_plans', 'treatment_choices',
    'weed_observations', 'scan_patterns', 'scan_findings', 'scan_photo_reads', 'scan_frame_detections',
    'scan_hotspot_reviews', 'field_planting_layouts', 'weed_catalog_sources', 'weed_catalog_entries',
    'weed_catalog_review_queue'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "pilot members only" ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY "pilot members only" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        'USING ((SELECT public.is_pilot_member())) WITH CHECK ((SELECT public.is_pilot_member()))', t);
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS "pilot members only" ON storage.objects;
CREATE POLICY "pilot members only" ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_pilot_member()))
  WITH CHECK ((SELECT public.is_pilot_member()));

-- ---------------------------------------------------------------------------
-- 4. odm_tasks: the columns service-role functions trust are not the user's to write
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON public.odm_tasks FROM authenticated;
GRANT UPDATE (ai_analysis, ai_analysis_at) ON public.odm_tasks TO authenticated;
REVOKE ALL ON public.odm_tasks FROM anon;

-- ---------------------------------------------------------------------------
-- 5. The founder, so the gate does not shut the founder out
-- ---------------------------------------------------------------------------
INSERT INTO public.pilot_members (user_id, role, status, email, notes)
SELECT u.id, 'founder', 'active', u.email, 'seeded by 20261109120000_pilot_access'
FROM auth.users u
WHERE lower(u.email) IN ('yunushalilerdogan5@gmail.com', 'yunus@swardus.com', 'yunus@swathwise.com')
ON CONFLICT (user_id) DO UPDATE SET role = 'founder', status = 'active';
