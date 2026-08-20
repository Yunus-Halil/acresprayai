-- Scheduling: give the dormant `jobs` table what a calendar entry needs.
--
-- `jobs` has existed since the first migration and nothing has ever read or
-- written it. It already carries the hard part — user_id, field_id, scan_id,
-- drone_id, type, status, scheduled_at, chemical, dose_l_ha, area_ha, notes,
-- and an RLS policy scoping every row to its owner. Reusing it beats a new
-- `scheduled_missions` table that would duplicate all of that.
--
-- Three things it lacks, added here. All nullable and all additive: existing
-- rows (there are none, but the property matters) stay valid, and nothing is
-- dropped or retyped.

-- Which flight plan produced this. Text rather than a foreign key because
-- flight plans are computed on demand from a scan and a boundary — there is no
-- flight_plans table to reference, and inventing one to hold a derived artefact
-- would be worse than storing the identifier it was generated under.
alter table public.jobs add column if not exists flight_plan_id text;

-- {lat, lng, label}. The field already has a boundary, but the operator may
-- want to note a specific access point — where to park the truck is not the
-- centroid of the field.
alter table public.jobs add column if not exists location jsonb;

-- The stats SNAPSHOT, as computed at the moment of scheduling.
--
-- Deliberately a frozen copy rather than something recomputed on read. A
-- calendar entry answers "what did we commit to?", and that answer must not
-- change because someone later redrew the boundary or swapped the drone's
-- battery. The live recomputation lives in the planner; this is the receipt.
alter table public.jobs add column if not exists stats jsonb;

-- The calendar's only query shape: one user's missions within a month.
create index if not exists jobs_user_scheduled_idx
  on public.jobs (user_id, scheduled_at);

comment on column public.jobs.stats is
  'Frozen snapshot of computeMissionStats() output at scheduling time. Never recomputed on read — see src/lib/missionStats.ts.';
