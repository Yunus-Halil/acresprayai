-- Weed Scout runs, saved per scan so nothing is recomputed per visit.
--
-- Two tables. `scan_patterns` holds one row per scan: the planting pattern the
-- scout read from the field map (blocks, row lines, plants) and the slim run
-- result around it (regions, numbers, notes), under the pass version and the
-- parameters it ran with. `scan_findings` holds one row per candidate the run
-- produced, the whole candidate as the review screen reads it, minus the chip
-- (chips are rendered from imagery on demand and archived with a verdict in
-- weed_observations, never here). Verdicts stay in weed_observations, joined
-- by (scan_id, candidate_id).
--
-- A re-run replaces both: the pattern row is upserted on scan_id, the
-- findings are deleted and inserted. Owner-scoped by RLS like every table
-- here; no cross-user read.

CREATE TABLE IF NOT EXISTS public.scan_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  field_id uuid REFERENCES public.fields(id) ON DELETE SET NULL,
  scan_id uuid NOT NULL REFERENCES public.odm_tasks(id) ON DELETE CASCADE,
  pass_version text NOT NULL,
  params jsonb,
  -- The field read: row spacing, bearing, plant spacing and size, counts.
  summary jsonb NOT NULL,
  -- The run without its candidates and without the per-tile arrays.
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scan_patterns_scan_unique UNIQUE (scan_id)
);

CREATE INDEX IF NOT EXISTS scan_patterns_user_scan_idx ON public.scan_patterns (user_id, scan_id);

ALTER TABLE public.scan_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own scan_patterns all" ON public.scan_patterns;
CREATE POLICY "own scan_patterns all" ON public.scan_patterns
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_patterns TO authenticated;
GRANT ALL ON public.scan_patterns TO service_role;

DROP TRIGGER IF EXISTS update_scan_patterns_updated_at ON public.scan_patterns;
CREATE TRIGGER update_scan_patterns_updated_at
  BEFORE UPDATE ON public.scan_patterns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.scan_patterns IS
  'Weed Scout run per scan: the planting pattern read from the field map and the slim result around it. Candidates are in scan_findings; verdicts in weed_observations.';

CREATE TABLE IF NOT EXISTS public.scan_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  scan_id uuid NOT NULL REFERENCES public.odm_tasks(id) ON DELETE CASCADE,
  candidate_id text NOT NULL,
  kind text NOT NULL,
  finding_class text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  area_m2 numeric,
  score numeric NOT NULL,
  -- The original photo the finding was read in, when it came from the photo pass.
  source_photo text,
  -- The candidate as the review screen reads it, without the chip.
  candidate jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scan_findings_scan_candidate_unique UNIQUE (scan_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS scan_findings_user_scan_idx ON public.scan_findings (user_id, scan_id);

ALTER TABLE public.scan_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own scan_findings all" ON public.scan_findings;
CREATE POLICY "own scan_findings all" ON public.scan_findings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_findings TO authenticated;
GRANT ALL ON public.scan_findings TO service_role;

DROP TRIGGER IF EXISTS update_scan_findings_updated_at ON public.scan_findings;
CREATE TRIGGER update_scan_findings_updated_at
  BEFORE UPDATE ON public.scan_findings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.scan_findings IS
  'Weed Scout findings per scan, one row per candidate, the candidate as the review reads it minus the chip. Verdicts are in weed_observations.';
