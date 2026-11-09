-- Pilot telemetry: what participants did, how long it took, whether it worked.
--
-- Operational facts only: event names, ids, durations, outcomes, counts, stage timings, short error text. Never
-- pixels, file names, coordinates or boundaries (the client scrubs error text before sending: src/lib/pilot/telemetry.ts).
-- A participant may insert their own events and read none, not even their own; the founder reads them through the
-- pilot-admin function (service role).
CREATE TABLE IF NOT EXISTS public.app_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL CHECK (name ~ '^[a-z_]{1,40}$'),
  session_id text CHECK (length(session_id) <= 64),
  route text CHECK (length(route) <= 120),
  twin_id uuid,
  duration_ms integer CHECK (duration_ms >= 0),
  outcome text CHECK (outcome IN ('ok', 'error', 'cancelled')),
  error text CHECK (length(error) <= 500),
  counts jsonb CHECK (counts IS NULL OR pg_column_size(counts) <= 2048),
  stages jsonb CHECK (stages IS NULL OR pg_column_size(stages) <= 2048),
  detail jsonb CHECK (detail IS NULL OR pg_column_size(detail) <= 2048),
  app_version text CHECK (length(app_version) <= 64)
);

CREATE INDEX IF NOT EXISTS app_events_user_at ON public.app_events (user_id, at DESC);
CREATE INDEX IF NOT EXISTS app_events_name_at ON public.app_events (name, at DESC);

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_events FROM anon, authenticated;
GRANT INSERT ON public.app_events TO authenticated;
GRANT ALL ON public.app_events TO service_role;

DROP POLICY IF EXISTS "record own events" ON public.app_events;
CREATE POLICY "record own events" ON public.app_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "pilot members only" ON public.app_events;
CREATE POLICY "pilot members only" ON public.app_events AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_pilot_member())) WITH CHECK ((SELECT public.is_pilot_member()));
