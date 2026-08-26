# Audit: treated acreage recorded by the pre-fix ring-derived path

**Window:** 2026-08-20 15:32 UTC (`166222b`, grid zones entered the flight
plan) → 2026-08-26 18:57 UTC (`309d3e0`, fix). Bounds are commit times; the
true boundaries are the frontend deploys either side of each. The constants
live in `src/lib/legacyAreaAudit.ts` — widen them there if a deploy lagged.

**What happened:** inside that window, the Log Flight zone list re-derived
grid-zone areas from the traced ring (`polygonAreaM2(z.ring)`) instead of
using the carried clipped cell sum (`z.areaM2`). Every acreage summed from
those zones over-counts, because a zone's ring includes the full footprint of
cells the field boundary clips.

**Measured discrepancy** (realistic irregular boundary, 10 m swath):

| Zone pattern            | Over-count (aggregate) | Worst single zone |
|-------------------------|------------------------|-------------------|
| Interior cells only     | 0.0%                   | 0%                |
| Full-coverage mission   | +12% (1× cells) to +19.5% (2× cells) | ~+20% |
| Boundary-hugging zones  | +75% to +91%           | +142–145% (~2.5×) |

Always an over-count — ring ≥ clipped, never under. The direction of every
derivative follows: **treated acres high, computed rate (volume ÷ acres) low,
chemical-per-acre low.** Planned chemical, marked (grid) acreage, and savings
percentages were never on this path — they use the carried areas.

**Stored figures affected** (only for missions matching the predicate:
in-window `created_at`, ≥1 completed `grid:`/`block:` zone, non-null acreage):

- `flight_logs.acres_treated` — the primary record.
- `fields.settings.last_flown_mission.acres_treated` — the same figure,
  snapshotted (overwritten by each later mission, so likely already gone).
- `field_reports.summary.rate_l_per_ac` — derived by dividing by it.
- Archived report PDFs generated in the window against such a mission: the
  "TREATED (LOGGED)" row and the computed rate row. ("MARKED (GRID)" rows and
  savings claims in the same PDFs came from carried areas and are sound.)
- Aug 20–25 logs may ALSO carry the separately-disclosed estimate-derived
  `liters_applied` (fixed `e853872` on 2026-08-25) — those records have two
  method caveats, not one.

**Nothing is rewritten.** A logged flight is a record of what was believed at
the time. Affected records are flagged at render: an amber note on the Flight
Log card and a "legacy-area" reconciliation note on any report regenerated
from such a mission (`acreageFromBuggyPath` in `src/lib/legacyAreaAudit.ts`).

## Counting the affected rows (run in the Supabase SQL editor)

```sql
-- Flight logs whose treated acreage came from the pre-fix path
select f.name as field, fl.id, fl.date_flown, fl.created_at,
       fl.acres_treated, fl.liters_applied,
       (select count(*) from jsonb_array_elements_text(fl.zones_completed) z
        where z like 'grid:%' or z like 'block:%') as grid_zones
from public.flight_logs fl
join public.fields f on f.id = fl.field_id
where fl.created_at >= '2026-08-20T15:32:20Z'
  and fl.created_at <  '2026-08-26T18:57:08Z'
  and fl.acres_treated is not null
  and exists (
    select 1 from jsonb_array_elements_text(fl.zones_completed) z
    where z like 'grid:%' or z like 'block:%')
order by fl.created_at;

-- Archived reports generated from those missions (their PDFs carry the
-- figures; the PDF files themselves are in the field-reports bucket)
select r.id, r.storage_path, r.generated_at,
       r.summary->>'rate_l_per_ac' as rate_from_inflated_area,
       fl.acres_treated as inflated_acres
from public.field_reports r
join public.flight_logs fl on fl.id = r.flight_log_id
where fl.created_at >= '2026-08-20T15:32:20Z'
  and fl.created_at <  '2026-08-26T18:57:08Z'
  and fl.acres_treated is not null
  and exists (
    select 1 from jsonb_array_elements_text(fl.zones_completed) z
    where z like 'grid:%' or z like 'block:%')
order by r.generated_at;

-- Fields whose settings snapshot still holds an in-window mission
select id, name,
       settings->'last_flown_mission'->>'created_at'   as snap_created,
       settings->'last_flown_mission'->>'acres_treated' as snap_acres
from public.fields
where settings->'last_flown_mission'->>'created_at' >= '2026-08-20T15:32:20Z'
  and settings->'last_flown_mission'->>'created_at' <  '2026-08-26T18:57:08Z'
  and settings->'last_flown_mission'->>'acres_treated' is not null;
```

Paste the row counts back and, if any archived PDF is affected, decide whether
to regenerate it (the regenerated document will carry the disclosure note) or
leave the archive as-is with the Flight Log flag as the pointer.
