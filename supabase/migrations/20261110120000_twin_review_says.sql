-- A review that says what is there, not only that the finding is wrong.
--
--   twin_reviews.says   on a CORN finding marked wrong, the reviewer's own word for what is there instead: a weed
--                       candidate that is corn in the row, corn outside the row (a volunteer), or soil or residue; a
--                       stand gap where the plants are there, or where nothing was planted; a row that is not there,
--                       is drawn in the wrong place, or is not corn. One answer from a short list per kind of
--                       finding, or nothing.
--
-- Additive: one nullable column. Every review written before this stays valid (says is null) and reads as before.
-- Nothing else about the table changes: the same owner-only policy, pilot gate, rate limit and grants. The answer is
-- the reviewer's, kept beside algorithm_status (what Swardus said); it never changes the twin and Swardus never
-- writes it. Orchard findings and the boundary take no answer.
--
-- What the plant is and whether it belongs to the planted row are separate facts, so corn has two answers: in the
-- row, and outside it. No answer names a weed species.

ALTER TABLE public.twin_reviews ADD COLUMN IF NOT EXISTS says text;

ALTER TABLE public.twin_reviews DROP CONSTRAINT IF EXISTS twin_reviews_says_check;
ALTER TABLE public.twin_reviews ADD CONSTRAINT twin_reviews_says_check CHECK (
  says IS NULL
  OR (finding_kind = 'corn_weed' AND says IN ('corn_in_row', 'corn_off_row', 'soil_or_residue', 'other'))
  OR (finding_kind = 'corn_gap' AND says IN ('plants_present', 'not_planted', 'other'))
  OR (finding_kind = 'corn_row' AND says IN ('no_row', 'row_misplaced', 'not_corn', 'other'))
);

-- The reviewer writes it with the rest of their review (user_id and the timestamps stay the server's).
GRANT INSERT (says), UPDATE (says) ON public.twin_reviews TO authenticated;

-- An answer belongs to "wrong" only. A review changed to correct or not sure drops it here, in the database, so a
-- page loaded before this migration (which does not know the column and so never clears it) cannot leave a
-- "correct" review still saying "it is corn".
CREATE OR REPLACE FUNCTION public.twin_reviews_says()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.verdict IS DISTINCT FROM 'wrong' THEN
    NEW.says = NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS twin_reviews_says ON public.twin_reviews;
CREATE TRIGGER twin_reviews_says BEFORE INSERT OR UPDATE ON public.twin_reviews FOR EACH ROW EXECUTE FUNCTION public.twin_reviews_says();
