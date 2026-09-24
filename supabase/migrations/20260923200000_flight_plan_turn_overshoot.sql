-- How far past the end of a line the aircraft carries on before it turns.
--
-- A serpentine grid drawn as bare segments asks the aircraft to reverse
-- direction in zero distance at the end of every line. Nothing flies that: it
-- stops, yaws and accelerates. The turn now has a shape, and this column is the
-- one part of it the operator chooses.
--
-- Zero is a clean half circle, which is already flyable, and it is the default
-- so that every plan saved before this column existed reads back as the shape
-- it is now given rather than as a number nobody chose.
ALTER TABLE public.flight_plans
  ADD COLUMN IF NOT EXISTS turn_overshoot_m numeric NOT NULL DEFAULT 0;

ALTER TABLE public.flight_plans
  DROP CONSTRAINT IF EXISTS flight_plans_turn_overshoot_check;

ALTER TABLE public.flight_plans
  ADD CONSTRAINT flight_plans_turn_overshoot_check
  CHECK (turn_overshoot_m >= 0 AND turn_overshoot_m <= 200);
