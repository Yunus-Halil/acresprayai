-- Weed spots keep their id across runs, a plainer verdict vocabulary, and
-- operator-reviewed treatment choices with their label provenance.
--
-- SPOT IDS. Weed Scout candidates now carry an id derived from what they are
-- and where they sit (lib/weedScout/spotId.ts), so a re-run of the same scan
-- finds the same spot under the same id. `weed_observations.candidate_id`
-- already holds it; `user_annotations.spot_id` lets an applied spot be found
-- again when the scout reopens ("already on Field View").
--
-- VERDICTS. The review flow is now "keep or remove": weed / not_weed / unsure.
-- The older crop / not_vegetation values stay valid (existing rows carry
-- them) and count as dismissals in the scout's own learning, as before.
--
-- TREATMENTS ARE SEPARATE FROM IDENTIFICATION. A treatment choice is a
-- product the operator chose and a label they say they checked: product,
-- registration number, where the label came from, when it was checked, the
-- crop and method it was read for, its restrictions, and the rate and units
-- as printed. Nothing here is prefilled from the weed catalog, which carries
-- no herbicide information by design, and nothing is calculated from a
-- choice whose label was not marked verified (lib/treatment/quantities.ts).

ALTER TABLE public.user_annotations
  ADD COLUMN IF NOT EXISTS spot_id text;
CREATE INDEX IF NOT EXISTS user_annotations_spot_idx ON public.user_annotations (task_id, spot_id) WHERE spot_id IS NOT NULL;

ALTER TABLE public.weed_observations DROP CONSTRAINT IF EXISTS weed_observations_verdict_check;
ALTER TABLE public.weed_observations ADD CONSTRAINT weed_observations_verdict_check CHECK (
  verdict IS NULL OR verdict IN ('weed', 'not_weed', 'unsure', 'crop', 'not_vegetation')
);

CREATE TABLE IF NOT EXISTS public.treatment_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  field_id uuid REFERENCES public.fields(id) ON DELETE SET NULL,
  -- What it is for: a catalog weed, an operator-typed label, or unidentified weed zones.
  weed_catalog_id text REFERENCES public.weed_catalog_entries(catalog_id) ON DELETE SET NULL,
  weed_label text,
  -- The product and the label it was read from.
  product_name text NOT NULL,
  epa_reg_no text,
  label_source text,
  label_checked_on date,
  label_crop text,
  application_method text,
  restrictions text,
  -- The rate as printed on the label, in the label's units. Converted only on the way to a screen or a sum.
  rate_value numeric,
  rate_unit text,
  carrier_volume_value numeric,
  carrier_unit text,
  -- The operator's statement that they read the current label for this crop, place and method.
  label_verified boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT treatment_choices_rate_unit_check CHECK (
    rate_unit IS NULL OR rate_unit IN ('L/ha', 'mL/ha', 'gal/ac', 'qt/ac', 'pt/ac', 'fl oz/ac', 'kg/ha', 'g/ha', 'lb/ac', 'oz/ac')
  ),
  CONSTRAINT treatment_choices_carrier_unit_check CHECK (
    carrier_unit IS NULL OR carrier_unit IN ('L/ha', 'gal/ac')
  ),
  CONSTRAINT treatment_choices_rate_positive CHECK (rate_value IS NULL OR rate_value > 0),
  CONSTRAINT treatment_choices_carrier_positive CHECK (carrier_volume_value IS NULL OR carrier_volume_value > 0),
  -- A verified label has a date and a source; the box cannot be ticked over blanks.
  CONSTRAINT treatment_choices_verified_shape CHECK (
    label_verified = false OR (label_checked_on IS NOT NULL AND label_source IS NOT NULL AND btrim(label_source) <> '')
  )
);

CREATE INDEX IF NOT EXISTS treatment_choices_user_idx ON public.treatment_choices (user_id, field_id);

ALTER TABLE public.treatment_choices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own treatment_choices all" ON public.treatment_choices;
CREATE POLICY "own treatment_choices all" ON public.treatment_choices
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatment_choices TO authenticated;
GRANT ALL ON public.treatment_choices TO service_role;

DROP TRIGGER IF EXISTS update_treatment_choices_updated_at ON public.treatment_choices;
CREATE TRIGGER update_treatment_choices_updated_at
  BEFORE UPDATE ON public.treatment_choices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.treatment_choices IS
  'Operator-chosen product and the label they verified for it. Separate from weed identification; never prefilled from the weed catalog; quantities are computed only from verified rows.';
