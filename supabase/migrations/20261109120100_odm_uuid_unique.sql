-- One scan per ODM task id.
--
-- Ownership lookups by odm_uuid (tile, odm-asset, odm-submit upload/commit) use maybeSingle(): a second row carrying
-- the same id made them fail for its real owner. Users can no longer write odm_uuid (20261109120000), so a duplicate
-- can only be historical. If one exists the index is not created and the migration says so instead of failing; the
-- query in docs/operations/pilot-access.md lists the duplicates to resolve by hand, then this can be re-run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.odm_tasks WHERE odm_uuid IS NOT NULL GROUP BY odm_uuid HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'odm_tasks has duplicate odm_uuid values; unique index NOT created. Resolve them, then re-run.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS odm_tasks_odm_uuid_unique ON public.odm_tasks (odm_uuid) WHERE odm_uuid IS NOT NULL;
  END IF;
END $$;
