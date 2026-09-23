# Survey flight planning

The step before a scan exists. SwathWise could process imagery and had no way to plan the
flight that produces it; this fills that gap, on the field page, above the upload.

It is a **survey** planner, not the spray planner. `lib/mission.ts` and the workspace's Flight
Planner route an Agras over marked zones with a boom; this routes a camera drone over a whole
polygon to photograph it. Different aircraft, different job, different point in the workflow.

## Where it is

`/app/fields/:id`, as "Step 1: Create flight plan", above "Step 2: Add imagery". Collapsed to
a single button until a plan exists; after that it states the plan and offers Edit and
Re-export. A field may hold several plans; the card shows the most recent and can list the rest.

The modal opens with the field's own boundary already loaded, because most fields have one
drawn in Field View and it is usually the right survey area. Redrawing is for when the survey
area deliberately is not the field.

## The part that did not exist: capture geometry

`lib/flightPlan/camera.ts` is new work, and it is the reason the feature exists. Nothing in the
codebase computed any of this before:

- **Footprint.** What one frame covers at a given altitude, from the 35mm-equivalent focal
  length and the frame's aspect ratio. Two dimensions, and they are not interchangeable: flown
  conventionally the frame's long edge lies across the direction of travel, so the **short**
  edge is what front overlap must cover. `SENSOR_LONG_EDGE_ACROSS_TRACK` names that assumption
  rather than burying it, because swapping the two silently inflates the trigger interval by
  half as much again and the resulting gaps look like a windy day.
- **Capture interval.** The non-overlapping part of the along-track footprint. At 75% front
  overlap each frame advances a quarter of its own length.
- **Line spacing.** The same arithmetic across track. This is what the line spacing field
  defaults to; overriding it downward buys redundancy over difficult ground.

Cameras live in a short table with a `source` per entry, following the aircraft directory's
convention that a figure with no source is a figure nobody has checked.

## Waypoints are the capture positions

There is no separate list of capture points to reconcile against the route. Each leg is walked
at the computed interval and every resulting waypoint carries its own shutter release. The step
count rounds **up**, so the gap at the end of a leg is never wider than the interval, which is
exactly where overlap otherwise fails unseen.

The bug this replaces fired the camera only where the path turned. On a 400 m leg that is two
photographs covering the ends and nothing in between, and the operator finds out on the ground.

## The export

`lib/flightPlan/generateKmz.ts` is a pure `(boundary, params) -> KMZ`, testable without a
browser, a database or an API. It composes the grid and `lib/wpml.ts`.

`wpml.ts` gained camera actions for this. Element names and nesting are DJI's own published
schema (`dji-sdk/Cloud-API-Doc`), not invented: `actionGroup` with an id, start and end index,
mode and trigger; `takePhoto` with `fileSuffix` and `payloadPositionIndex`; `gimbalRotate` with
per-axis enables and angles. The trigger is `reachPoint`, not a timer, because a timed trigger
drifts against ground speed and leaves the overlap to luck.

`buildWpmlKmz` was split so a spray `Mission` and a survey grid share one implementation of the
file format and one enforcement of the waypoint ceiling.

**The spray-actuator vocabulary is still unconfirmed and still absent**, and a test still
asserts no spray-shaped tag appears in any output. Camera actions are documented by DJI; spray
actions are not.

## Two things the planner refuses to guess

- **The waypoint ceiling.** Consumer airframes cap a route at `MAX_CONSUMER_WAYPOINTS` (200),
  and `wpml.ts` refuses past it rather than truncating, because a route that quietly drops its
  last waypoints flies a partial survey the operator believes was complete. The limit is
  surfaced on the resolved plan, so a route forty waypoints over says so in the live preview
  while the operator can still fly higher or reduce overlap, not after they press download.
- **The drone identity.** `droneEnumValue` and `droneSubEnumValue` are omitted unless a caller
  supplies them. DJI publishes these for enterprise airframes only; no public table covers the
  consumer Air and Mini series. A wrong code is a silent rejection at import time and an absent
  block is not. **Fill this in from a known-working KMZ produced by the target aircraft.**

## Storage

`flight_plans` (migration `20260923170000_flight_plans.sql`): boundary plus parameters, owner
scoped by the same `auth.uid() = user_id` rule every other table uses. No new permission logic.

**Parameters, not a file.** The KMZ is regenerated on download, so a plan reopened next season
exports with whatever the generator has learned since. Storing the binary would freeze a bug
into every plan already saved.

The boundary is held per plan rather than read from the field: a plan exported in April
describes the ground as it was outlined in April, and redrawing the field boundary afterwards
must not silently change what an already-flown plan claimed to cover.

## No REST layer

The brief asked for `POST /api/fields/:id/flight-plans` and friends. There is no `/api` in this
project: every table is reached through the Supabase client with row-level security doing the
ownership check, and edge functions exist only where a service-role key or a third-party secret
is needed. A flight plan needs neither. The shape is kept as functions in
`lib/flightPlan/repo.ts`: list, save, delete, markExported.

## Still needs

- **The Air 3S drone enum**, from a known-working KMZ. Until it is supplied the file omits the
  block, which is valid but unverified against that airframe.
- **One real flight.** Nothing here has been flown. The geometry is tested against synthetic
  polygons with known answers; whether DJI Fly accepts the file and triggers the shutter where
  intended is not something a test in this repo can establish.
- **Camera specs beyond the three in the table**, each with a source.
