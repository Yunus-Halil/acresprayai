# Data model

Postgres with the PostGIS extension enabled. Fourteen tables in `public`. Eight are active; six
are remnants of an earlier data model and will always be empty.

## Active tables

### `fields`

The farm parcel. Everything else hangs off this.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | → `auth.users`, cascade delete |
| `name` | text | |
| `crop` | text | Legacy; the live value is `settings.crop_type` |
| `area_hectares` | numeric | Legacy; superseded by `boundary_area_hectares` |
| `location` | text | Free text, optional |
| `notes` | text | |
| `boundary` | jsonb | Either a single ring of `{lat,lng}` (legacy) **or** an array of rings for multi-part fields. Always pass through `normalizeBoundary()` |
| `boundary_area_hectares` | numeric | True geodesic area of the drawn boundary |
| `settings` | jsonb | The whole `FarmerSettings` blob — see [features/cost-and-reports.md](../features/cost-and-reports.md) |

### `odm_tasks`

One row per scan. Despite the name this is the central object of the product.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | This is the `:taskId` in the workspace URL |
| `user_id` | uuid | |
| `field_id` | uuid | → `fields`, set null on delete |
| `odm_uuid` | text | The task id on the processing node |
| `status` | text | `uploading` \| `queued` \| `processing` \| `mirroring` \| `completed` \| `failed` |
| `progress` | numeric | 0–100 |
| `image_count` | integer | |
| `output_path` | text | `all.zip` in the `scans` bucket |
| `ortho_path` | text | GeoTIFF in the `orthos` bucket |
| `error` | text | User-facing failure reason |
| `ai_analysis` | jsonb | Persisted analysis result — see [features/ai-analysis.md](../features/ai-analysis.md) |
| `ai_analysis_at` | timestamptz | |
| `tiles_baked` | boolean | True only when **every** tile actually stored |
| `tiles_done` | integer | Resume cursor into the tile list |
| `tiles_total` | integer | |
| `tiles_failed` | integer | Unresolved tiles from the last pass; doubles as a stall counter |
| `tiles_plan_locked` | boolean | Freezes the zoom range so the tile list stays deterministic |
| `tiles_min_zoom` / `tiles_max_zoom` | integer | |
| `mirror_started_at` | timestamptz | Transfer lease timestamp |
| `mirror_attempts` | integer | Consecutive transient mirror failures |
| `upload_expected` | integer | Images the client intends to send |
| `upload_received` | integer | Images the node has accepted |
| `created_at` / `updated_at` | timestamptz | `updated_at` maintained by trigger |

The resilience columns (`mirror_*`, `tiles_failed`, `tiles_plan_locked`, `upload_*`) exist so
that a stalled or partly-failed scan is a **recoverable state** rather than an unrecoverable one.
See [pipeline/resilience.md](../pipeline/resilience.md).

### `drones`

| Column | Notes |
|---|---|
| `id`, `user_id` | |
| `name` | Call sign |
| `model` | String key into `DRONE_SPECS` — see [features/mission-planner.md](../features/mission-planner.md) |
| `battery` | Current charge %, typed by the user |
| `signal`, `health`, `status` | **Static placeholders.** Nothing reads real telemetry |
| `serial`, `notes`, `specs` | Optional |

### `user_annotations`

Farmer-drawn polygons. These feed the mission planner alongside AI zones.

`id`, `user_id`, `task_id`, `field_id`, `name`, `issue_type`, `color`, `notes`,
`ring` (jsonb), `area_hectares`.

### `flight_logs`

What was actually flown. Drives the post-flight state of the report.

`id`, `user_id`, `field_id`, `scan_id` → `odm_tasks`, `drone_id`, `date_flown`,
`battery_start`, `battery_end`, `tank_refills`, `zones_completed` (jsonb), `acres_treated`,
`liters_applied`, `notes`.

### `field_reports`

Archive index for generated PDFs. The PDF itself lives in storage.

`id`, `user_id`, `field_id`, `scan_id`, `flight_log_id`, `pilot_name`, `storage_path`,
`summary` (jsonb), `generated_at`.

### `profiles`

`id` (= `auth.users.id`), `full_name`, `farm_name`. Created by a trigger on signup. Currently
written but not surfaced anywhere in the UI.

### `pilot_signups`

`email`. Landing-page waitlist. Insert-only for anon; **nobody can read it back** through the
API (the select policy is `USING (false)`).

## Dormant tables

`scans`, `jobs`, `orthomosaics`, `crop_zones`, `anomalies`, `spray_recommendations`.

These are from an earlier data model. They have tables, RLS policies and PostGIS geometry views,
but **no code path writes to them**. Treat them as dead schema — they will always be empty.

In particular: AI analysis results live in `odm_tasks.ai_analysis`, **not** in `anomalies` or
`crop_zones`.

## The `ring` vs `polygon` trap

> **Read this before writing anything that consumes AI zones.**

The vision model returns each zone's outline under the key `polygon`. The `analyze-ortho`
function validates, reprojects and clips it, then persists it under the key **`ring`**.

Anything reading zones back out of `odm_tasks.ai_analysis` must use `ring`. Reading `polygon`
silently yields `undefined`, and every derived area computes as zero with no error. This bug
shipped once already and made the entire scan-comparison feature read `0.00 ac` forever.

## Row Level Security

Every user-owned table has RLS enabled with a policy of the form `auth.uid() = user_id` for all
operations. The browser queries tables directly and only ever sees its own rows.

Edge functions that use the service-role key **bypass RLS** and therefore re-check ownership
explicitly before acting. See [architecture/auth.md](auth.md).
