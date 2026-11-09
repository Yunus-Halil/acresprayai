-- The founder's tools, founder-only in the database too.
--
-- The orthomosaic workflow, spray planning, scouting and the weed catalog are founder-only during the pilot. Their
-- pages and functions already refuse participants; this makes the tables and the file storage refuse them as well,
-- so a participant cannot use the database API to fill the old tables or upload files outside the Field Twin pilot.
--
--   1. A RESTRICTIVE "founder tools only" policy on every older table (profiles stays: it holds everyone's units).
--   2. Storage: a participant may read and write only their own Field Twin folder, orthos/<uid>/field-twins/...
--      The founder keeps every bucket. The owner-folder policies from before still apply on top.
-- Non-destructive: nothing is dropped; a participant who never used these tools loses nothing.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fields', 'drones', 'scans', 'jobs', 'odm_tasks', 'orthomosaics', 'crop_zones', 'anomalies', 'spray_recommendations',
    'user_annotations', 'flight_logs', 'field_reports', 'flight_plans', 'treatment_choices', 'weed_observations',
    'scan_patterns', 'scan_findings', 'scan_photo_reads', 'scan_frame_detections', 'scan_hotspot_reviews',
    'field_planting_layouts', 'weed_catalog_sources', 'weed_catalog_entries', 'weed_catalog_review_queue'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "founder tools only" ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY "founder tools only" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        'USING ((SELECT public.is_pilot_founder())) WITH CHECK ((SELECT public.is_pilot_founder()))', t);
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS "participants keep to their field twins" ON storage.objects;
CREATE POLICY "participants keep to their field twins" ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_pilot_founder()) OR (bucket_id = 'orthos' AND split_part(name, '/', 2) = 'field-twins'))
  WITH CHECK ((SELECT public.is_pilot_founder()) OR (bucket_id = 'orthos' AND split_part(name, '/', 2) = 'field-twins'));
