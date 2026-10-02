-- The field-walk ground-truth table was added and withdrawn the same day; it
-- never held a row. The table and its photo policies go. The empty private
-- bucket stays: SQL may not touch storage rows, and an empty bucket harms
-- nothing.
DROP TABLE IF EXISTS public.ground_truth;
DROP POLICY IF EXISTS "Users read own ground truth photos" ON storage.objects;
DROP POLICY IF EXISTS "Users insert own ground truth photos" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own ground truth photos" ON storage.objects;
