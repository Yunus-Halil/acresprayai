-- Weed size v1: how large each finding is on the ground, measured in its
-- original photograph (src/lib/weedScout/sizing/).
--
-- The measurement lives inside the finding's own record, scan_findings.candidate
-- (the candidate as the review reads it), under the key "measurement", so a
-- client older than this migration writes and reads findings exactly as before
-- and a finding without one simply has none. The columns below are generated
-- from that JSON: nothing inserts them, they exist so the sizes can be queried
-- and indexed without parsing the record. The archive (weed_observations) gets a
-- plain jsonb column, written only when the saved spot carries a measurement.

ALTER TABLE public.scan_findings
  ADD COLUMN IF NOT EXISTS measurement_status text
    GENERATED ALWAYS AS (candidate #>> '{measurement,status}') STORED,
  ADD COLUMN IF NOT EXISTS canopy_diameter_cm numeric
    GENERATED ALWAYS AS (
      CASE WHEN jsonb_typeof(candidate #> '{measurement,canopyDiameterCm}') = 'number'
           THEN (candidate #>> '{measurement,canopyDiameterCm}')::numeric END
    ) STORED,
  ADD COLUMN IF NOT EXISTS canopy_area_cm2 numeric
    GENERATED ALWAYS AS (
      CASE WHEN jsonb_typeof(candidate #> '{measurement,canopyAreaCm2}') = 'number'
           THEN (candidate #>> '{measurement,canopyAreaCm2}')::numeric END
    ) STORED,
  ADD COLUMN IF NOT EXISTS size_category text
    GENERATED ALWAYS AS (candidate #>> '{measurement,sizeCategory}') STORED,
  ADD COLUMN IF NOT EXISTS measurement_version text
    GENERATED ALWAYS AS (candidate #>> '{measurement,version}') STORED;

CREATE INDEX IF NOT EXISTS scan_findings_scan_size_idx ON public.scan_findings (scan_id, size_category);

COMMENT ON COLUMN public.scan_findings.measurement_status IS
  'From candidate.measurement: measured, unknown (the photo could not say) or unavailable (no photo). Null on findings older than weed-size-v1.';
COMMENT ON COLUMN public.scan_findings.canopy_diameter_cm IS
  'Equivalent-circle diameter of the canopy segmented in the original photo, centimetres. Only when measurement_status is measured.';
COMMENT ON COLUMN public.scan_findings.canopy_area_cm2 IS
  'Segmented canopy pixels times the ground area of a native pixel, square centimetres. Only when measurement_status is measured.';
COMMENT ON COLUMN public.scan_findings.size_category IS
  'small, medium or large against the thresholds stored in candidate.measurement.thresholds.';

ALTER TABLE public.weed_observations
  ADD COLUMN IF NOT EXISTS measurement jsonb;

COMMENT ON COLUMN public.weed_observations.measurement IS
  'The weed size measurement (sizing/types.ts WeedMeasurement) the spot carried when it was saved. Null when it had none. Never the verdict.';
