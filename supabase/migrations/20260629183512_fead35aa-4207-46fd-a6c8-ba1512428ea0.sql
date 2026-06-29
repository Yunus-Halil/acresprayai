
CREATE TABLE public.field_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  field_id UUID REFERENCES public.fields(id) ON DELETE CASCADE,
  scan_id UUID REFERENCES public.odm_tasks(id) ON DELETE SET NULL,
  flight_log_id UUID REFERENCES public.flight_logs(id) ON DELETE SET NULL,
  pilot_name TEXT,
  storage_path TEXT NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.field_reports TO authenticated;
GRANT ALL ON public.field_reports TO service_role;

ALTER TABLE public.field_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their field reports"
  ON public.field_reports FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_field_reports_field ON public.field_reports(field_id, generated_at DESC);
CREATE INDEX idx_field_reports_scan ON public.field_reports(scan_id, generated_at DESC);
