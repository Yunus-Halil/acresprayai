-- The classifier's word, stored beside the operator's, never in its place.
--
-- `prediction` is what the shipped model said about this spot when the
-- operator looked at it ({pWeed, pCrop, pOther, modelVersion}); `model_version`
-- is the same version, as a column, so disagreement between the model and the
-- operator can be counted per version without unpacking JSON. `verdict` stays
-- the label. A row saved without a model on the page carries nulls, which is
-- the truth about that row and not a zero.
ALTER TABLE public.weed_observations
  ADD COLUMN IF NOT EXISTS prediction jsonb,
  ADD COLUMN IF NOT EXISTS model_version text;

CREATE INDEX IF NOT EXISTS weed_observations_model_version_idx
  ON public.weed_observations (model_version)
  WHERE model_version IS NOT NULL;

COMMENT ON COLUMN public.weed_observations.prediction IS
  'Classifier output at save time: {pWeed, pCrop, pOther, modelVersion}. A suggestion the operator saw; verdict is the label.';
