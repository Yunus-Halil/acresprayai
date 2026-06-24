
-- jsonb input: [[lng, lat], [lng, lat], ...] (ring auto-closed)
CREATE OR REPLACE FUNCTION public.create_crop_zone(
  p_field_id uuid,
  p_name text,
  p_crop text,
  p_variety text,
  p_polygon jsonb,
  p_planted_at date DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_wkt text;
  v_id uuid;
  v_coords text;
  v_first text;
  v_last text;
  v_arr text[];
  v_item jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fields WHERE id = p_field_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'field not owned';
  END IF;
  IF jsonb_array_length(p_polygon) < 3 THEN
    RAISE EXCEPTION 'polygon needs >= 3 points';
  END IF;

  v_arr := ARRAY[]::text[];
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_polygon) LOOP
    v_arr := array_append(v_arr, (v_item->>0) || ' ' || (v_item->>1));
  END LOOP;
  v_first := v_arr[1];
  v_last := v_arr[array_length(v_arr, 1)];
  IF v_first <> v_last THEN
    v_arr := array_append(v_arr, v_first);
  END IF;
  v_coords := array_to_string(v_arr, ', ');
  v_wkt := 'SRID=4326;POLYGON((' || v_coords || '))';

  INSERT INTO public.crop_zones (user_id, field_id, name, crop, variety, polygon, planted_at, notes)
  VALUES (v_uid, p_field_id, p_name, p_crop, p_variety, v_wkt::geography, p_planted_at, p_notes)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_crop_zone(uuid, text, text, text, jsonb, date, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_crop_zone(uuid, text, text, text, jsonb, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_anomaly(
  p_zone_id uuid,
  p_orthomosaic_id uuid,
  p_polygon jsonb,
  p_ndvi_mean numeric,
  p_ndvi_p10 numeric,
  p_ndvi_p90 numeric,
  p_severity text,
  p_ai_label text,
  p_ai_reasoning text,
  p_source text DEFAULT 'ai'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_wkt text;
  v_id uuid;
  v_arr text[];
  v_first text;
  v_last text;
  v_item jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crop_zones WHERE id = p_zone_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'zone not owned';
  END IF;
  IF jsonb_array_length(p_polygon) < 3 THEN
    RAISE EXCEPTION 'polygon needs >= 3 points';
  END IF;

  v_arr := ARRAY[]::text[];
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_polygon) LOOP
    v_arr := array_append(v_arr, (v_item->>0) || ' ' || (v_item->>1));
  END LOOP;
  v_first := v_arr[1];
  v_last := v_arr[array_length(v_arr, 1)];
  IF v_first <> v_last THEN v_arr := array_append(v_arr, v_first); END IF;
  v_wkt := 'SRID=4326;POLYGON((' || array_to_string(v_arr, ', ') || '))';

  INSERT INTO public.anomalies (
    user_id, zone_id, orthomosaic_id, polygon,
    ndvi_mean, ndvi_p10, ndvi_p90, severity,
    ai_label, ai_reasoning, source
  )
  VALUES (
    v_uid, p_zone_id, p_orthomosaic_id, v_wkt::geography,
    p_ndvi_mean, p_ndvi_p10, p_ndvi_p90, COALESCE(p_severity, 'medium'),
    p_ai_label, p_ai_reasoning, COALESCE(p_source, 'ai')
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_anomaly(uuid, uuid, jsonb, numeric, numeric, numeric, text, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_anomaly(uuid, uuid, jsonb, numeric, numeric, numeric, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_spray_recommendation(
  p_anomaly_id uuid,
  p_chemical text,
  p_chemical_class text,
  p_dose_l_ha numeric,
  p_total_l numeric,
  p_rationale text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.anomalies WHERE id = p_anomaly_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'anomaly not owned';
  END IF;

  INSERT INTO public.spray_recommendations (
    user_id, anomaly_id, chemical, chemical_class, dose_l_ha, total_l, rationale
  ) VALUES (
    v_uid, p_anomaly_id, p_chemical, p_chemical_class, p_dose_l_ha, p_total_l, p_rationale
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_spray_recommendation(uuid, text, text, numeric, numeric, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_spray_recommendation(uuid, text, text, numeric, numeric, text) TO authenticated;

-- View that exposes polygons as GeoJSON for the client to render
CREATE OR REPLACE VIEW public.crop_zones_geo AS
SELECT
  z.id, z.user_id, z.field_id, z.name, z.crop, z.variety,
  z.area_ha, z.planted_at, z.notes, z.created_at,
  ST_AsGeoJSON(z.polygon::geometry)::jsonb AS geojson
FROM public.crop_zones z;

GRANT SELECT ON public.crop_zones_geo TO authenticated;

CREATE OR REPLACE VIEW public.anomalies_geo AS
SELECT
  a.id, a.user_id, a.zone_id, a.orthomosaic_id,
  a.area_ha, a.ndvi_mean, a.ndvi_p10, a.ndvi_p90,
  a.severity, a.ai_label, a.ai_reasoning, a.user_label, a.user_notes,
  a.status, a.source, a.created_at,
  ST_AsGeoJSON(a.polygon::geometry)::jsonb AS geojson
FROM public.anomalies a;

GRANT SELECT ON public.anomalies_geo TO authenticated;
