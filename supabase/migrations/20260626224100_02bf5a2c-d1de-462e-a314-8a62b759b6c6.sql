
CREATE TABLE public.flight_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES public.fields(id) ON DELETE CASCADE,
  scan_id uuid REFERENCES public.odm_tasks(id) ON DELETE SET NULL,
  drone_id uuid REFERENCES public.drones(id) ON DELETE SET NULL,
  date_flown date NOT NULL DEFAULT current_date,
  battery_start integer,
  battery_end integer,
  tank_refills integer NOT NULL DEFAULT 0,
  zones_completed jsonb NOT NULL DEFAULT '[]'::jsonb,
  acres_treated numeric,
  liters_applied numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flight_logs TO authenticated;
GRANT ALL ON public.flight_logs TO service_role;
ALTER TABLE public.flight_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own flight logs" ON public.flight_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX flight_logs_field_idx ON public.flight_logs(field_id, date_flown DESC);
CREATE INDEX flight_logs_user_idx ON public.flight_logs(user_id, date_flown DESC);
