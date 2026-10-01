-- Whose verdict this row carries.
--
-- "Save all" writes every spot in a scan, including the ones the operator never
-- opened. Those carry the verdict the scout proposed (from the model, the
-- operator's past verdicts or the geometry rule), not a human decision. Without
-- this column the two are indistinguishable, and model-versus-operator agreement
-- would be inflated by the model agreeing with its own defaults.
--
--   operator  the operator pressed a verdict button or named the spot
--   default   saved as proposed, untouched
--   null      written before this column existed: unknown, not "operator"
ALTER TABLE public.weed_observations
  ADD COLUMN IF NOT EXISTS verdict_source text
  CHECK (verdict_source IS NULL OR verdict_source IN ('operator', 'default'));

COMMENT ON COLUMN public.weed_observations.verdict_source IS
  'operator = set by a human on this spot; default = saved as the scout proposed; null = row predates the column. Only operator rows are ground truth for model evaluation.';
