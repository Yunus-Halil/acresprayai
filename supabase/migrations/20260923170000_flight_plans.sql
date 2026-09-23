-- Survey flight plans: the mapping flight that produces a field's imagery.
--
-- Distinct from anything else here. `user_annotations` and the treatment grid
-- describe ground that has already been photographed; a flight plan describes
-- the flight that has not been flown yet. It is the step before a scan exists,
-- which is why it sits above the upload on the field page.
--
-- PARAMS, NOT A FILE. The KMZ is regenerated from these values on download
-- (lib/flightPlan/generateKmz.ts, a pure function), so a plan reopened next
-- season exports with whatever the generator has learned since, and nothing
-- here can drift out of step with the code that writes the file. Storing the
-- binary would freeze a bug into every plan that had already been saved.
--
-- A field may hold several plans over time: a boundary gets redrawn, or the
-- same field is flown at two altitudes for two purposes. The page shows the
-- most recent and offers the rest.

CREATE TABLE IF NOT EXISTS public.flight_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES public.fields(id) ON DELETE CASCADE,

  /* Optional label, for a field carrying more than one plan. */
  name text,

  /* The area to be surveyed, WGS84, the same ring shape `fields.boundary`
     uses. Held per plan rather than read from the field: a plan exported in
     April describes the ground as it was outlined in April, and redrawing the
     field boundary afterwards must not silently change what an already-flown
     plan claimed to cover. */
  boundary jsonb NOT NULL,

  direction text NOT NULL DEFAULT 'auto',
  altitude_m numeric NOT NULL,
  /* Null means "derive it from the side overlap". The distinction is kept
     rather than resolved on save, so reopening a plan shows the operator the
     same choice they made rather than a number they never typed. */
  line_spacing_m numeric,
  front_overlap_pct numeric NOT NULL,
  side_overlap_pct numeric NOT NULL,
  gimbal_pitch_deg numeric NOT NULL,
  speed_ms numeric NOT NULL,
  /* Which camera the footprint arithmetic assumed. Without it, a plan cannot
     be reproduced: the same altitude and overlap give different spacing on a
     different lens. */
  camera_key text NOT NULL,
  inset_m numeric NOT NULL DEFAULT 0,

  /* When the operator last downloaded a KMZ, so the card can say so. Null
     means it has been saved but never exported. */
  last_exported_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT flight_plans_direction_check CHECK (direction IN ('ew', 'ns', 'auto')),
  CONSTRAINT flight_plans_altitude_check CHECK (altitude_m > 0 AND altitude_m <= 1500),
  CONSTRAINT flight_plans_overlap_check CHECK (
    front_overlap_pct >= 0 AND front_overlap_pct < 100
    AND side_overlap_pct >= 0 AND side_overlap_pct < 100
  ),
  /* -90 is straight down and 30 is well above the horizon; past either end is
     not a survey attitude. */
  CONSTRAINT flight_plans_gimbal_check CHECK (gimbal_pitch_deg >= -90 AND gimbal_pitch_deg <= 30),
  CONSTRAINT flight_plans_speed_check CHECK (speed_ms > 0 AND speed_ms <= 15),
  CONSTRAINT flight_plans_spacing_check CHECK (line_spacing_m IS NULL OR line_spacing_m > 0),
  CONSTRAINT flight_plans_inset_check CHECK (inset_m >= 0)
);

CREATE INDEX IF NOT EXISTS flight_plans_field_idx
  ON public.flight_plans (field_id, created_at DESC);

-- Owner-scoped, exactly like every other table here. No new permission logic:
-- the field's own ownership is what grants access, and the user_id column is
-- what the policy keys on, matching user_annotations and weed_observations.
ALTER TABLE public.flight_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own flight_plans all" ON public.flight_plans;
CREATE POLICY "own flight_plans all" ON public.flight_plans
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.flight_plans TO authenticated;
GRANT ALL ON public.flight_plans TO service_role;

DROP TRIGGER IF EXISTS update_flight_plans_updated_at ON public.flight_plans;
CREATE TRIGGER update_flight_plans_updated_at
  BEFORE UPDATE ON public.flight_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.flight_plans IS
  'Survey flight plans: parameters for the mapping flight that produces a field''s imagery. The KMZ is regenerated from these on download, never stored.';
