
ALTER TABLE public.odm_tasks ADD COLUMN IF NOT EXISTS ortho_path text;

CREATE POLICY "Users read own orthos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'orthos' AND (storage.foldername(name))[1] = auth.uid()::text);
