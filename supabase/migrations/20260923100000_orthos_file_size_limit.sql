-- Say how big an orthomosaic may be, instead of inheriting a default nobody set.
--
-- The `orthos` bucket has never carried a `file_size_limit`, so it fell back to
-- the project-wide default. On a Supabase project that default is 50 MB, which
-- is smaller than essentially every real orthomosaic: a 60-acre RGB ortho at
-- 2 cm/px is comfortably past it, and the operator got a storage rejection with
-- no indication that a size rule was what stopped them.
--
-- 5 GB is not an arbitrary ceiling. It is the documented limit of the standard
-- (single request) upload path that `uploadToSignedUrl` uses. Past it the only
-- option is a resumable/TUS upload, which this app does not implement yet, so
-- allowing more here would move the failure later rather than remove it. The
-- client refuses past the same number and says why (lib/orthoImport.ts).
--
-- THE PROJECT-WIDE LIMIT STILL WINS. This value cannot exceed the global file
-- size limit configured for the project (Dashboard: Storage, Settings). If that
-- is still at its default, raise it there too or this has no effect.
UPDATE storage.buckets
SET file_size_limit = 5368709120          -- 5 GiB, the standard-upload ceiling
WHERE id = 'orthos'
  AND (file_size_limit IS NULL OR file_size_limit < 5368709120);

-- Raw drone images are uploaded to the processing node, not here, but the
-- `scans` bucket holds the mirrored archive and has the same inherited-default
-- problem.
UPDATE storage.buckets
SET file_size_limit = 5368709120
WHERE id = 'scans'
  AND (file_size_limit IS NULL OR file_size_limit < 5368709120);
