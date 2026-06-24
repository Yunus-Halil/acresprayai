
CREATE OR REPLACE FUNCTION public.update_crop_zone(
  p_id uuid,
  p_polygon jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_wkt text;
  v_arr text[];
  v_item jsonb;
  v_first text;
  v_last text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crop_zones WHERE id = p_id AND user_id = v_uid) THEN
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
  IF v_first <> v_last THEN
    v_arr := array_append(v_arr, v_first);
  END IF;
  v_wkt := 'SRID=4326;POLYGON((' || array_to_string(v_arr, ', ') || '))';

  UPDATE public.crop_zones
  SET polygon = v_wkt::geography, updated_at = now()
  WHERE id = p_id AND user_id = v_uid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_crop_zone(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_crop_zone(uuid, jsonb) TO authenticated;
