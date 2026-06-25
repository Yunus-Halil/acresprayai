ALTER TABLE public.fields
  ADD COLUMN IF NOT EXISTS boundary jsonb,
  ADD COLUMN IF NOT EXISTS boundary_area_hectares numeric;