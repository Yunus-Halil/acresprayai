
-- Enable PostGIS for geospatial data
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================
-- orthomosaics
-- ============================================================
CREATE TABLE public.orthomosaics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  field_id uuid REFERENCES public.fields(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'rgb', -- 'rgb' | 'ndvi' | 'multispectral'
  storage_path text NOT NULL,
  preview_path text,
  thumbnail_path text,
  bounds geography(Polygon, 4326), -- footprint of the ortho on earth
  center geography(Point, 4326),
  gsd_m_per_px numeric,
  width_px integer,
  height_px integer,
  captured_at timestamptz,
  status text NOT NULL DEFAULT 'processing', -- 'processing' | 'ready' | 'failed'
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orthomosaics TO authenticated;
GRANT ALL ON public.orthomosaics TO service_role;
ALTER TABLE public.orthomosaics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own orthomosaics" ON public.orthomosaics
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX orthomosaics_field_idx ON public.orthomosaics(field_id);
CREATE INDEX orthomosaics_user_idx ON public.orthomosaics(user_id);

-- ============================================================
-- crop_zones
-- ============================================================
CREATE TABLE public.crop_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  field_id uuid NOT NULL REFERENCES public.fields(id) ON DELETE CASCADE,
  name text NOT NULL,
  crop text NOT NULL,
  variety text,
  polygon geography(Polygon, 4326) NOT NULL,
  area_ha numeric GENERATED ALWAYS AS (ST_Area(polygon) / 10000.0) STORED,
  planted_at date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crop_zones TO authenticated;
GRANT ALL ON public.crop_zones TO service_role;
ALTER TABLE public.crop_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own crop_zones" ON public.crop_zones
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX crop_zones_field_idx ON public.crop_zones(field_id);
CREATE INDEX crop_zones_user_idx ON public.crop_zones(user_id);
CREATE INDEX crop_zones_polygon_gix ON public.crop_zones USING GIST(polygon);

-- ============================================================
-- anomalies
-- ============================================================
CREATE TABLE public.anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  zone_id uuid NOT NULL REFERENCES public.crop_zones(id) ON DELETE CASCADE,
  orthomosaic_id uuid REFERENCES public.orthomosaics(id) ON DELETE SET NULL,
  polygon geography(Polygon, 4326) NOT NULL,
  area_ha numeric GENERATED ALWAYS AS (ST_Area(polygon) / 10000.0) STORED,
  ndvi_mean numeric,
  ndvi_p10 numeric,
  ndvi_p90 numeric,
  severity text NOT NULL DEFAULT 'medium', -- 'low' | 'medium' | 'high'
  ai_label text,
  ai_reasoning text,
  user_label text,
  user_notes text,
  status text NOT NULL DEFAULT 'open', -- 'open' | 'dismissed' | 'sprayed'
  source text NOT NULL DEFAULT 'ai', -- 'ai' | 'manual'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.anomalies TO authenticated;
GRANT ALL ON public.anomalies TO service_role;
ALTER TABLE public.anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own anomalies" ON public.anomalies
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX anomalies_zone_idx ON public.anomalies(zone_id);
CREATE INDEX anomalies_user_idx ON public.anomalies(user_id);
CREATE INDEX anomalies_polygon_gix ON public.anomalies USING GIST(polygon);

-- ============================================================
-- spray_recommendations
-- ============================================================
CREATE TABLE public.spray_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  anomaly_id uuid NOT NULL REFERENCES public.anomalies(id) ON DELETE CASCADE,
  chemical text NOT NULL,
  chemical_class text,
  dose_l_ha numeric NOT NULL,
  total_l numeric,
  target_polygon geography(Polygon, 4326),
  weather_window_start timestamptz,
  weather_window_end timestamptz,
  rationale text,
  status text NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected' | 'executed'
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spray_recommendations TO authenticated;
GRANT ALL ON public.spray_recommendations TO service_role;
ALTER TABLE public.spray_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own spray_recommendations" ON public.spray_recommendations
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX spray_recs_anomaly_idx ON public.spray_recommendations(anomaly_id);
CREATE INDEX spray_recs_user_idx ON public.spray_recommendations(user_id);

-- ============================================================
-- updated_at triggers
-- ============================================================
CREATE TRIGGER update_orthomosaics_updated_at BEFORE UPDATE ON public.orthomosaics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_crop_zones_updated_at BEFORE UPDATE ON public.crop_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_anomalies_updated_at BEFORE UPDATE ON public.anomalies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_spray_recs_updated_at BEFORE UPDATE ON public.spray_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
