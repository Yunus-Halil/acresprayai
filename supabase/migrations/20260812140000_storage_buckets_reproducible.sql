-- Make storage provisioning reproducible from this repository.
--
-- Only the `scans` bucket was ever created by a migration. `orthos`, `tiles` and
-- `field-reports` were created by hand in the Supabase dashboard, so a fresh
-- project could not be stood up from the repo: migrations would apply, then
-- every upload would fail against a bucket that does not exist.
--
-- Object policies for `orthos` and `field-reports` DO already exist (see
-- 20260624045526, 20260629155456 and 20260629183542) — it was only the bucket
-- rows that were missing. This migration adds those, closes one genuine policy
-- gap, and is idempotent so it is safe against the existing project.
--
-- Path conventions for every bucket are documented in
-- docs/architecture/storage.md. The first path segment is always the owning
-- user's id, which is what every policy below keys on.

-- ---------------------------------------------------------------------------
-- 1. Bucket rows. All private; access is exclusively via signed URLs minted by
--    an edge function, or streamed through the `tile` proxy.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('orthos',        'orthos',        false),
  ('tiles',         'tiles',         false),
  ('field-reports', 'field-reports', false)
ON CONFLICT (id) DO NOTHING;

-- Belt and braces: if any of these were created public by hand, make them
-- private. A public `orthos` bucket would expose raw farm imagery to anyone who
-- could guess a path.
UPDATE storage.buckets SET public = false
WHERE id IN ('orthos', 'tiles', 'field-reports') AND public IS DISTINCT FROM false;

-- ---------------------------------------------------------------------------
-- 2. `orthos` — owner-scoped CRUD for authenticated users.
--    Re-declared here so the full policy set for the bucket lives with the
--    bucket, rather than being split across three older migrations.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users read own orthos" ON storage.objects;
CREATE POLICY "Users read own orthos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'orthos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users insert own orthos" ON storage.objects;
CREATE POLICY "Users insert own orthos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'orthos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users update own orthos" ON storage.objects;
CREATE POLICY "Users update own orthos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'orthos' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'orthos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users delete own orthos" ON storage.objects;
CREATE POLICY "Users delete own orthos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'orthos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 3. `field-reports` — owner-scoped CRUD.
--
--    The UPDATE policy previously had USING but no WITH CHECK. USING restricts
--    which rows may be targeted; WITH CHECK restricts what they may become.
--    Without it a user could update one of their own objects into another
--    user's folder. Closed here.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners read field-report files" ON storage.objects;
CREATE POLICY "Owners read field-report files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'field-reports' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Owners upload field-report files" ON storage.objects;
CREATE POLICY "Owners upload field-report files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'field-reports' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Owners update field-report files" ON storage.objects;
CREATE POLICY "Owners update field-report files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'field-reports' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'field-reports' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Owners delete field-report files" ON storage.objects;
CREATE POLICY "Owners delete field-report files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'field-reports' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 4. `tiles` — service_role only, deliberately.
--
--    Authenticated users never touch this bucket directly. `bake-tiles` writes
--    with the service-role key and the `tile` function reads with it, rebuilding
--    the object path from the VERIFIED owner of the scan rather than from
--    anything the caller supplied. Granting authenticated users direct read here
--    would widen the surface for no benefit, so no such policy exists.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "service_role manages tiles" ON storage.objects;
CREATE POLICY "service_role manages tiles"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'tiles')
  WITH CHECK (bucket_id = 'tiles');
