-- Plots in the account (2026-11-24, his word): the regions of a field an operator draws on a Field Twin to get numbers
-- for just that region (a research trial's plots, "the wet corner"). Until now they lived only in the browser they
-- were drawn in: a plot drawn on the computer was not on the iPad in the field, and clearing the browser lost a whole
-- trial layout. Shapes, names and colours only: no photograph, no measurement (the numbers are worked out in the page
-- from the twin each time).
--
--   one row a plot   uid     the plot's own id, made on the device that drew it, so sending a plot twice is one plot
--                    ring    its corners as latitude / longitude: real ground, not the twin's pixels or its plants
--                    shape   which tool drew it (polygon / rectangle along the rows / snapped to rows) and its box
--   where it belongs twin_id   the Field Twin it was drawn on
--                    field_id  the field it belongs to (not used yet). A plot moves from a twin to a field by
--                              setting this: its corners are already ground coordinates, so it is never redrawn, and
--                              a later flight of the same field can be measured inside the same plots.
--   history          drawn_at / edited_at  the drawing device's clock (the newer edit wins between two devices)
--                    deleted_at            a delete is a mark, never a removal: it reaches every device, and a
--                                          trial layout deleted by mistake can be brought back by the founder.
--
-- Who can see it: the owner only, enforced here, not in the page. Nobody can read, write or attach a plot to
-- another person's twin or field. Founder-only for now (his condition: until he has checked it across his computer
-- and his iPad): the policy "founder only, for now" at the end is the switch; dropping it opens plots to every pilot
-- member, still each to their own.
--
-- Additive: one new table, nothing else changes. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.twin_plots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  uid text NOT NULL CHECK (uid ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- A deleted twin or field leaves its plots in place (unattached, not lost).
  twin_id uuid REFERENCES public.field_twins(id) ON DELETE SET NULL,
  field_id uuid REFERENCES public.fields(id) ON DELETE SET NULL,
  number integer NOT NULL CHECK (number BETWEEN 1 AND 9999),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  colour text NOT NULL CHECK (colour ~ '^#[0-9a-fA-F]{6}$'),
  ring jsonb NOT NULL CHECK (jsonb_typeof(ring) = 'array' AND jsonb_array_length(ring) BETWEEN 3 AND 2000 AND pg_column_size(ring) <= 65536),
  shape jsonb NOT NULL CHECK (jsonb_typeof(shape) = 'object' AND shape ? 'tool' AND shape->>'tool' IN ('polygon', 'rectangle', 'rows') AND pg_column_size(shape) <= 2048),
  drawn_at timestamptz,
  edited_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, uid)
);
CREATE INDEX IF NOT EXISTS twin_plots_twin ON public.twin_plots (twin_id) WHERE twin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS twin_plots_field ON public.twin_plots (field_id) WHERE field_id IS NOT NULL;

ALTER TABLE public.twin_plots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.twin_plots FROM anon, authenticated;
-- No DELETE: a plot is deleted by marking it (deleted_at). Not user_id, uid, created_at or updated_at on update: the
-- owner and the timestamps are the server's, and a plot keeps its own id.
GRANT SELECT ON public.twin_plots TO authenticated;
GRANT INSERT (uid, twin_id, field_id, number, name, colour, ring, shape, drawn_at, edited_at, deleted_at) ON public.twin_plots TO authenticated;
GRANT UPDATE (twin_id, field_id, number, name, colour, ring, shape, drawn_at, edited_at, deleted_at) ON public.twin_plots TO authenticated;
GRANT ALL ON public.twin_plots TO service_role;

DROP POLICY IF EXISTS "own plots" ON public.twin_plots;
-- The row is the caller's, and so is the twin or field it is attached to.
CREATE POLICY "own plots" ON public.twin_plots FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (twin_id IS NULL OR EXISTS (SELECT 1 FROM public.field_twins t WHERE t.id = twin_id AND t.user_id = auth.uid()))
    AND (field_id IS NULL OR EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_id AND f.user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "pilot members only" ON public.twin_plots;
CREATE POLICY "pilot members only" ON public.twin_plots AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_pilot_member())) WITH CHECK ((SELECT public.is_pilot_member()));

-- The switch: plots are the founder's alone until he has checked them on his own devices.
DROP POLICY IF EXISTS "founder only, for now" ON public.twin_plots;
CREATE POLICY "founder only, for now" ON public.twin_plots AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_pilot_founder())) WITH CHECK ((SELECT public.is_pilot_founder()));

CREATE OR REPLACE FUNCTION public.twin_plots_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS twin_plots_touch ON public.twin_plots;
CREATE TRIGGER twin_plots_touch BEFORE UPDATE ON public.twin_plots FOR EACH ROW EXECUTE FUNCTION public.twin_plots_touch();

-- A limit a real person never meets, so a script cannot fill the table: 300 plots written a minute, 2,000 kept.
CREATE OR REPLACE FUNCTION public.twin_plots_rate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT count(*) FROM public.twin_plots WHERE user_id = NEW.user_id AND updated_at > now() - interval '1 minute') >= 300 THEN
    RAISE EXCEPTION 'too many plot changes at once' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' AND (SELECT count(*) FROM public.twin_plots WHERE user_id = NEW.user_id) >= 2000 THEN
    RAISE EXCEPTION 'too many plots: write to the founder' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.twin_plots_rate() FROM PUBLIC;
DROP TRIGGER IF EXISTS twin_plots_rate ON public.twin_plots;
CREATE TRIGGER twin_plots_rate BEFORE INSERT OR UPDATE ON public.twin_plots FOR EACH ROW EXECUTE FUNCTION public.twin_plots_rate();
