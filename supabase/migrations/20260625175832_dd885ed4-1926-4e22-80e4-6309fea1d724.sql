
-- Persist AI analysis results per task
ALTER TABLE public.odm_tasks
  ADD COLUMN IF NOT EXISTS ai_analysis jsonb,
  ADD COLUMN IF NOT EXISTS ai_analysis_at timestamptz;

-- Manual user annotations (polygons drawn by farmer)
CREATE TABLE IF NOT EXISTS public.user_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  task_id uuid NOT NULL,
  field_id uuid,
  name text NOT NULL,
  issue_type text NOT NULL,
  color text NOT NULL DEFAULT 'orange',
  notes text,
  ring jsonb NOT NULL,
  area_hectares numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_annotations TO authenticated;
GRANT ALL ON public.user_annotations TO service_role;

ALTER TABLE public.user_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own annotations"
  ON public.user_annotations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS user_annotations_task_idx ON public.user_annotations(task_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS user_annotations_set_updated_at ON public.user_annotations;
CREATE TRIGGER user_annotations_set_updated_at
  BEFORE UPDATE ON public.user_annotations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
