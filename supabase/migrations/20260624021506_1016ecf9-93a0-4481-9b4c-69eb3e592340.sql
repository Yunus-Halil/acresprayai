
CREATE OR REPLACE VIEW public.orthomosaics_geo AS
SELECT
  o.id, o.user_id, o.field_id, o.kind, o.storage_path,
  o.gsd_m_per_px, o.width_px, o.height_px, o.captured_at, o.status, o.created_at,
  ST_YMax(o.bounds::geometry) AS north,
  ST_YMin(o.bounds::geometry) AS south,
  ST_XMax(o.bounds::geometry) AS east,
  ST_XMin(o.bounds::geometry) AS west
FROM public.orthomosaics o;

ALTER VIEW public.orthomosaics_geo SET (security_invoker = on);
GRANT SELECT ON public.orthomosaics_geo TO authenticated;
