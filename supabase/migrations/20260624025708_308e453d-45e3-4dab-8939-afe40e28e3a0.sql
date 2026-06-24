
-- Field-first workflow: wipe scan-related test data and require field_id

TRUNCATE TABLE public.spray_recommendations CASCADE;
TRUNCATE TABLE public.anomalies CASCADE;
TRUNCATE TABLE public.crop_zones CASCADE;
TRUNCATE TABLE public.orthomosaics CASCADE;
TRUNCATE TABLE public.odm_tasks CASCADE;
TRUNCATE TABLE public.scans CASCADE;
TRUNCATE TABLE public.jobs CASCADE;

-- Require field_id everywhere the field-first flow needs it
ALTER TABLE public.scans
  ALTER COLUMN field_id SET NOT NULL,
  ALTER COLUMN field_id DROP DEFAULT;

ALTER TABLE public.odm_tasks
  ALTER COLUMN field_id SET NOT NULL;

-- Re-point FK so deleting a field cascades the odm task (was SET NULL, no longer compatible with NOT NULL)
ALTER TABLE public.odm_tasks DROP CONSTRAINT IF EXISTS odm_tasks_field_id_fkey;
ALTER TABLE public.odm_tasks
  ADD CONSTRAINT odm_tasks_field_id_fkey
  FOREIGN KEY (field_id) REFERENCES public.fields(id) ON DELETE CASCADE;

ALTER TABLE public.scans DROP CONSTRAINT IF EXISTS scans_field_id_fkey;
ALTER TABLE public.scans
  ADD CONSTRAINT scans_field_id_fkey
  FOREIGN KEY (field_id) REFERENCES public.fields(id) ON DELETE CASCADE;
