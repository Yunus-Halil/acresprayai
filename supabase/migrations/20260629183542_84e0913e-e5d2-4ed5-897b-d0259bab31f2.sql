
CREATE POLICY "Owners read field-report files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'field-reports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Owners upload field-report files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'field-reports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Owners update field-report files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'field-reports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Owners delete field-report files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'field-reports' AND auth.uid()::text = (storage.foldername(name))[1]);
