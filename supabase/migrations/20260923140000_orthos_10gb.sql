-- Raise the orthomosaic ceiling to 10 GB, now that the upload can reach it.
--
-- The earlier 5 GiB limit was not a storage decision, it was the ceiling of the
-- STANDARD upload path: one request, no resume, and Supabase stops it at 5 GB.
-- The client now sends anything over 200 MB through the resumable endpoint in
-- 6 MB chunks (lib/orthoImport.ts), which carries up to 50 GB and survives a
-- dropped connection, so the bucket is what constrains this again rather than
-- the transport.
--
-- 10 GiB against a project configured for 20 GB. THE PROJECT-WIDE LIMIT STILL
-- WINS and no migration can raise it: if an import is refused on size, check
-- Dashboard > Storage > Settings before changing anything here.
UPDATE storage.buckets
SET file_size_limit = 10737418240         -- 10 GiB
WHERE id IN ('orthos', 'scans')
  AND (file_size_limit IS NULL OR file_size_limit < 10737418240);
