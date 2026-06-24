
-- Users can only access files under <user_id>/...
CREATE POLICY "own ortho files read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'orthomosaics' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "own ortho files insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'orthomosaics' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "own ortho files update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'orthomosaics' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'orthomosaics' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "own ortho files delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'orthomosaics' AND (storage.foldername(name))[1] = auth.uid()::text);
