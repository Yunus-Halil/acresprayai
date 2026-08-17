-- Pilot applications: the detailed form behind "Apply to Pilot".
--
-- Separate from `pilot_signups`, which is the one-field landing-page waitlist.
-- This table holds a real application - contact details, land, equipment - and
-- so it holds more personal information about a farmer than anything else in
-- the schema. It is modelled on `pilot_signups` and then tightened:
--
--   * Insert-only for anonymous submitters, with the WITH CHECK doing real
--     validation rather than `true` (same move as migration 20260629155456
--     made for pilot_signups).
--   * NOBODY can read it back through PostgREST - not anon, not authenticated.
--     There is no permissive SELECT policy and there are explicit denies, so a
--     signed-up farmer cannot enumerate other applicants' phone numbers.
--     Reads go through the `pilot-applications` edge function, which checks the
--     caller against an admin allowlist before using the service-role key.
--
-- The CHECK constraints mirror the option lists in
-- supabase/functions/_shared/pilotApplication.ts. Changing an option there
-- means a migration here - which is the point: the database should not accept
-- a value the form cannot produce.

CREATE TABLE IF NOT EXISTS public.pilot_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Contact
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  farm_name text NOT NULL,
  role text NOT NULL,

  -- The land. County-level location only; a precise address is friction we do
  -- not need to triage an applicant.
  location text NOT NULL,
  acreage_range text NOT NULL,
  crops text NOT NULL,
  has_boundary_survey text,

  -- Equipment and timing
  drone_status text NOT NULL,
  drone_model text,
  availability text NOT NULL,

  referral_source text,
  notes text,

  CONSTRAINT pilot_applications_role_check CHECK (role IN (
    'Farm owner', 'Farm manager', 'Agronomist or consultant',
    'Extension agent referring someone', 'Spray operator', 'Other'
  )),
  CONSTRAINT pilot_applications_acreage_check CHECK (acreage_range IN (
    'Under 20', '20–100', '100–500', '500+'
  )),
  CONSTRAINT pilot_applications_boundary_check CHECK (
    has_boundary_survey IS NULL OR has_boundary_survey IN ('Yes', 'No', 'Not sure')
  ),
  CONSTRAINT pilot_applications_drone_status_check CHECK (drone_status IN (
    'No drone yet', 'RGB drone (regular camera)', 'Multispectral drone', 'Have a spray drone'
  )),
  -- A model only makes sense alongside a spray drone. Anything else is a stale
  -- value from a form the applicant changed their mind on.
  CONSTRAINT pilot_applications_drone_model_check CHECK (
    drone_model IS NULL OR drone_status = 'Have a spray drone'
  ),
  CONSTRAINT pilot_applications_availability_check CHECK (availability IN (
    'This fall (Aug–Oct)', 'This winter', 'Spring 2027', 'Not sure yet'
  ))
);

ALTER TABLE public.pilot_applications ENABLE ROW LEVEL SECURITY;

-- Anyone may apply. The check is the same shape as the pilot_signups insert
-- policy: required fields present, lengths bounded, email actually an email.
DROP POLICY IF EXISTS "anyone can submit a pilot application" ON public.pilot_applications;
CREATE POLICY "anyone can submit a pilot application"
  ON public.pilot_applications
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    length(full_name) BETWEEN 1 AND 120
    AND length(email) BETWEEN 3 AND 320
    AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    AND length(farm_name) BETWEEN 1 AND 160
    AND length(location) BETWEEN 1 AND 160
    AND length(crops) BETWEEN 1 AND 400
    AND (phone IS NULL OR length(phone) <= 40)
    AND (drone_model IS NULL OR length(drone_model) <= 120)
    AND (referral_source IS NULL OR length(referral_source) <= 300)
    AND (notes IS NULL OR length(notes) <= 2000)
  );

-- No read path through the API for anyone. Both denies are explicit rather
-- than relying on "no policy means no access", so that adding a permissive
-- SELECT policy later has to be a deliberate act that removes one of these.
DROP POLICY IF EXISTS "no anon read" ON public.pilot_applications;
CREATE POLICY "no anon read"
  ON public.pilot_applications
  FOR SELECT
  TO anon
  USING (false);

DROP POLICY IF EXISTS "no authenticated read" ON public.pilot_applications;
CREATE POLICY "no authenticated read"
  ON public.pilot_applications
  FOR SELECT
  TO authenticated
  USING (false);

CREATE INDEX IF NOT EXISTS pilot_applications_created_at_idx
  ON public.pilot_applications (created_at DESC);

COMMENT ON TABLE public.pilot_applications IS
  'Pilot programme applications. Insert-only for anon; unreadable through the '
  'API by design. Read via the pilot-applications edge function, which checks '
  'the caller against PILOT_ADMIN_EMAILS before using the service-role key.';
