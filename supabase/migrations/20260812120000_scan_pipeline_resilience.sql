-- Scan pipeline resilience.
--
-- The orthomosaic pipeline had no way to (a) stop two pollers mirroring the same
-- ODM output concurrently, (b) recover a transfer whose edge instance died
-- mid-flight, (c) distinguish a transient upstream blip from a real failure, or
-- (d) notice that tiles failed to store. These columns make each of those
-- states explicit and recoverable.

ALTER TABLE public.odm_tasks
  -- Lease held while an edge instance is mirroring ODM output into storage.
  -- Claimed with a conditional UPDATE so only one worker ever holds it; a lease
  -- older than the staleness window is reclaimable, which is how a transfer
  -- killed mid-flight gets picked back up instead of hanging at 99% forever.
  ADD COLUMN IF NOT EXISTS mirror_started_at timestamptz,
  -- Consecutive transient mirror failures. Reset on success. Only once this
  -- passes the retry budget does the scan actually get marked failed.
  ADD COLUMN IF NOT EXISTS mirror_attempts integer NOT NULL DEFAULT 0,
  -- Tiles that errored on the last bake pass. Non-zero keeps tiles_baked false
  -- so the next pass retries them rather than leaving holes in the map.
  ADD COLUMN IF NOT EXISTS tiles_failed integer NOT NULL DEFAULT 0,
  -- Frozen on the first bake pass. Re-deriving the zoom range from TiTiler on
  -- every invocation made the tile list non-deterministic, which silently
  -- shifted the resume index and skipped tiles.
  ADD COLUMN IF NOT EXISTS tiles_plan_locked boolean NOT NULL DEFAULT false,
  -- Image upload accounting, so an interrupted upload can be resumed instead of
  -- restarted and a stuck 'uploading' row can be diagnosed.
  ADD COLUMN IF NOT EXISTS upload_expected integer,
  ADD COLUMN IF NOT EXISTS upload_received integer NOT NULL DEFAULT 0;

-- Pollers scan for their own active work constantly; keep that cheap.
CREATE INDEX IF NOT EXISTS odm_tasks_user_status_idx
  ON public.odm_tasks (user_id, status);

-- Reclaiming stale mirror leases is a status+timestamp lookup.
CREATE INDEX IF NOT EXISTS odm_tasks_mirror_lease_idx
  ON public.odm_tasks (status, mirror_started_at)
  WHERE status = 'mirroring';

COMMENT ON COLUMN public.odm_tasks.status IS
  'uploading | queued | processing | mirroring | completed | failed. '
  '"mirroring" means an edge worker holds the transfer lease (see mirror_started_at).';
