-- Where a field is, worked out from its own boundary.
--
-- `fields.location` already exists and is the operator's own text. It stays
-- theirs: nothing in the app may overwrite it, because a farmer who typed
-- "Back 40, past the creek" means that and not whatever a geocoder would
-- rather say.
--
-- So the derived answer lives beside it rather than in it. One jsonb column
-- rather than four, because it is only ever read whole:
--
--   label  "Winchester, VA", the locality and state, which is the level a
--          field actually has. Never a house number: agricultural land mostly
--          has no street address and inventing one would be a lie with a
--          plausible shape.
--   road   the road the provider named, when it named one. Extra detail, and
--          absent far more often than not.
--   key    the boundary centroid rounded to roughly 100 m. It is what decides
--          whether a boundary edit was big enough to be worth asking again,
--          so the service is not called every time the page loads.
--   at     when it was fetched, so a stale answer can be recognised as one.
--
-- No new geographic data: the geometry is still `boundary`, and this column is
-- a label derived from it.
ALTER TABLE public.fields
  ADD COLUMN IF NOT EXISTS derived_location jsonb;

COMMENT ON COLUMN public.fields.derived_location IS
  'Reverse-geocoded {label, road, key, at} from the boundary centroid. Display only. fields.location, the operator''s own text, always wins.';
