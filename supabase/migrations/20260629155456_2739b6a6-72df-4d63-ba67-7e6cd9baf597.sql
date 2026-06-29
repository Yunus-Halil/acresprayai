
-- 1. Switch SECURITY DEFINER helper functions to SECURITY INVOKER.
--    Tables (crop_zones, anomalies, spray_recommendations) already have
--    "user_id = auth.uid()" RLS policies for ALL, so authenticated users
--    can still insert/update through these functions.

ALTER FUNCTION public.create_crop_zone(uuid, text, text, text, jsonb, date, text) SECURITY INVOKER;
ALTER FUNCTION public.update_crop_zone(uuid, jsonb) SECURITY INVOKER;
ALTER FUNCTION public.create_anomaly(uuid, uuid, jsonb, numeric, numeric, numeric, text, text, text, text) SECURITY INVOKER;
ALTER FUNCTION public.create_spray_recommendation(uuid, text, text, numeric, numeric, text) SECURITY INVOKER;

-- 2. Replace pilot_signups INSERT WITH CHECK(true) with a real constraint.
DROP POLICY IF EXISTS "anyone can signup" ON public.pilot_signups;
CREATE POLICY "anyone can signup"
  ON public.pilot_signups
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    email IS NOT NULL
    AND length(email) BETWEEN 3 AND 320
    AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  );

-- 3. Explicit anon deny on pilot_signups SELECT (defense in depth).
DROP POLICY IF EXISTS "no anon read" ON public.pilot_signups;
CREATE POLICY "no anon read"
  ON public.pilot_signups
  FOR SELECT
  TO anon
  USING (false);

-- 4. Owner-scoped write policies for the orthos bucket.
DROP POLICY IF EXISTS "Users insert own orthos" ON storage.objects;
CREATE POLICY "Users insert own orthos"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'orthos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users update own orthos" ON storage.objects;
CREATE POLICY "Users update own orthos"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'orthos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'orthos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users delete own orthos" ON storage.objects;
CREATE POLICY "Users delete own orthos"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'orthos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 5. Owner-scoped UPDATE policy on scans bucket (mirrors INSERT/SELECT/DELETE).
DROP POLICY IF EXISTS "own scan update" ON storage.objects;
CREATE POLICY "own scan update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'scans'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'scans'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 6. spatial_ref_sys: enable RLS + permissive read policy.
--    Contents are non-sensitive PostGIS reference data.
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping RLS on spatial_ref_sys: insufficient privilege';
    RETURN;
  END;

  BEGIN
    EXECUTE 'DROP POLICY IF EXISTS "spatial_ref_sys public read" ON public.spatial_ref_sys';
    EXECUTE 'CREATE POLICY "spatial_ref_sys public read" ON public.spatial_ref_sys FOR SELECT TO anon, authenticated USING (true)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping policy on spatial_ref_sys: insufficient privilege';
  END;
END $$;
