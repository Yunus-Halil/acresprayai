CREATE TABLE public.odm_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  field_id uuid REFERENCES public.fields(id) ON DELETE SET NULL,
  odm_uuid text,
  status text NOT NULL DEFAULT 'queued',
  progress numeric NOT NULL DEFAULT 0,
  image_count integer NOT NULL DEFAULT 0,
  output_path text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.odm_tasks TO authenticated;
GRANT ALL ON public.odm_tasks TO service_role;

ALTER TABLE public.odm_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own odm_tasks all" ON public.odm_tasks
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_odm_tasks_updated_at
  BEFORE UPDATE ON public.odm_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();