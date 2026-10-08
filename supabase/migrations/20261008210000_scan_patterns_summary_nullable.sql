-- A run with no planting pattern is still a run worth keeping.
--
-- `scan_patterns.summary` was NOT NULL, so a scan whose field map showed no
-- row pattern (an orchard the pass could not read, a field that is not in
-- rows) could not be saved at all: the whole run, findings included, was lost
-- on leaving the tab. The summary is the field read when there is one; null
-- says there was none, and the result column still carries the run.
ALTER TABLE public.scan_patterns ALTER COLUMN summary DROP NOT NULL;
