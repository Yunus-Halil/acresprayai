-- Where the crop plants of a field stand, confirmed by the operator.
--
-- A planting (an orchard block, a vineyard block) is a lattice: rows a fixed
-- distance apart, plants a fixed distance apart along them. The operator marks
-- three plants per planting once (two neighbours in a row, one in the next
-- row); Weed Scout fits the lattice to the field map and keeps the refined
-- version here, per field, so every later scan of the field starts from it
-- with no clicks (lib/weedVision/layout). It says what is supposed to be
-- there, so the weed model looks only between the rows. Owner-scoped by RLS.
CREATE TABLE IF NOT EXISTS public.field_planting_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES public.fields(id) ON DELETE CASCADE,
  -- { version: 1, blocks: [{ points: [{lat,lng} x 3] }], confirmedAt }
  layout jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_planting_layouts_unique UNIQUE (field_id)
);

ALTER TABLE public.field_planting_layouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own field_planting_layouts all" ON public.field_planting_layouts;
CREATE POLICY "own field_planting_layouts all" ON public.field_planting_layouts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
