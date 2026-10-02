-- The field-walk ground-truth table was added and withdrawn the same day; it
-- never held a row. Removed whole so nothing half-exists.
DROP TABLE IF EXISTS public.ground_truth;
DROP POLICY IF EXISTS "Users read own ground truth photos" ON storage.objects;
DROP POLICY IF EXISTS "Users insert own ground truth photos" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own ground truth photos" ON storage.objects;
DELETE FROM storage.objects WHERE bucket_id = 'ground-truth';
DELETE FROM storage.buckets WHERE id = 'ground-truth';
