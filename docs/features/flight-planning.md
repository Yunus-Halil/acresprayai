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

## Altitude decides the density, and the operator has to be able to see that

Every number on the panel follows from altitude and overlap. At 100 m an Air 3S frame covers
150 m x 112 m, so the lines sit 37.5 m apart and the shutter fires every 28 m. At 30.48 m,
which is 100 ft, every one of those figures is a third the size and the plan has an order of
magnitude more photographs. Both plans are correct; they are different plans.

That difference produced a real report of "waypoints only at the turns". The exported file was
opened next to a reference KMZ that had been flown at 100 ft, while the plan had been made at
100 m from a box labelled metres, on a panel whose every readout was in feet. The file was
checked by unzipping the downloaded bytes and counting Placemarks per leg against the "Photos"
stat: they matched exactly, interior points included. Nothing was dropped; the altitude was 3.3x
what the operator pictured.

Two things changed because of it:

- **The inputs follow the unit setting**, like every readout beside them. Altitude, inset and
  line spacing are asked in feet or metres and speed in mph or m/s, whichever the operator
  chose in Settings. What is stored and what is written into the file stays metres and m/s; only
  the boxes change. A panel that reports feet and asks for metres is how 100 ft becomes 100 m.
- **The preview draws every capture point**, one marker per Placemark the file will contain, so
  the density of a survey is visible before the download rather than discovered in a viewer
  afterwards.

The tests for this read `pkg.kmz`, the Blob the download button hands to the browser, unzip it
the way a viewer would and count Placemarks per leg in the bytes on disk. A regression between
waypoint generation and the file is the one thing the pre-zip tests could never catch.

## The layout: the map is the screen

The modal was a medium dialog split into a map and a 300px column of inputs, and the thing the
operator was actually trying to read, where the aircraft goes, was the smallest element on it.
It is now a near full-screen dialog in four bands: a toolbar of things you do to the map, the
map itself taking all the remaining height, a single row of settings under it, and a footer that
always holds the warnings and the two buttons.

Everything that describes the plan sits **on** the map rather than beside it: the photo count and
stats card, the legend, and the step-by-step list, each a translucent panel over the imagery, so
a number is next to the thing it describes.

The route is drawn as a thick red line over a near-black casing, which is how a route is drawn
over aerial imagery for a reason: satellite is green, brown and grey, and a thin stroke in any of
those disappears. The casing keeps it readable over a bright roof and a dark treeline in the same
frame. The transit between lines is orange and dashed, because it is a different thing: flight
with the camera off.

## The preview says what order, not only what shape

A grid drawn as coloured lines answers "where" and says nothing about "in what order". Two plans
can draw the identical picture and fly it in opposite directions from opposite corners, and the
operator finds out once the aircraft is moving. So the preview carries:

- **A numbered pin on every corner the route turns at**, carrying the real waypoint number from
  the exported file. Two per line, so a plan reads 1 to 2N the way a hand-placed mission does.
  Numbering all several hundred capture points would be illegible; the corners are what the
  operator is checking.
- **An arrowhead at each line's midpoint**, and a dimmer one on each transit, showing the
  direction of travel. This is the thing a drawn grid cannot say on its own.
- **S and E pins**, larger and in their own colours, at the first and last waypoint, with the
  corner named in the tooltip.
- **A tooltip on every capture point** giving its waypoint number out of the total, so the
  ordering is available per point without numbering hundreds of dots into illegibility.
- **A legend.** The green outline is the area, not a path: nothing flies it and no photograph is
  taken on it. That is not obvious when it is the most prominent thing on the map, and it was
  asked about directly.
- **"What the drone does, in order"**, a numbered list: take off and fly to waypoint 1 at the
  north-west corner, line 1 east for 42 m taking 8 photos (waypoints 1 to 8), turn and cross
  11 m north, line 2 west, and so on.

`lib/flightPlan/routeSteps.ts` produces that list and the map labels read the same object, so the
picture and the words cannot describe different flights. It computes nothing new: every position
and count is already on the grid, and the rest is bearing and distance between points the planner
already placed. Turns are steps in their own right rather than a footnote on the line before,
because the transit is where the aircraft crosses ground it is not photographing.

## Why the turns are straight lines and not curves

A DJI-planned mission often shows waypoints strung around a rounded U at each end of a line. Ours
puts none there: the last waypoint of one line joins the first of the next, and the transit is a
straight segment.

Those curve waypoints exist to let the aircraft arc through the turn at speed instead of stopping
dead, and they do it by flying **outside the survey area**. That is a reasonable trade over open
farmland and the wrong one over a small parcel with trees at the edge, which is the case that
prompted the low-altitude confirmation. Nothing here is missing: the file is complete and the
aircraft flies the turn either way. What changes is whether the planner is allowed to route the
aircraft over ground the operator did not draw, which is a decision, not a detail.

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

## The number boxes

`MIN_ALTITUDE_M` is 1 m and `MAX_ALTITUDE_M` is 500 m. The floor was 5 m, chosen for no stated
reason; 1 m is a real bound, since DJI's own take-off security height bottoms out at 1.2 m and
below a metre a frame covers less ground than the aircraft is wide. Neither is a safety limit.
The safety limit is the confirmation below, and it warns rather than refuses.

Every numeric field goes through `NumBox`, which exists because of a bug worth remembering. A
controlled `<input type="number">` whose handler rejects whatever it cannot parse snaps straight
back to the old number, so **the last digit cannot be deleted**: at "3" the backspace produces
"", the handler keeps 3 because "" is not a number, React re-renders "3". Every value above 9 is
still reachable by deleting down to two digits, which is why it presents as a mysterious floor at
3 rather than as a field that plainly does not work. It was reported exactly that way: "I can't
make the altitude go below 3."

`NumBox` keeps whatever was typed for as long as the box has focus, including nothing at all, and
commits only the values that parse. On blur the draft is dropped and the canonical number returns,
which is what makes an abandoned empty box harmless rather than a way to store a blank altitude.
The line spacing box is deliberately **not** a `NumBox`: there an empty box is a real answer,
meaning "work it out from the side overlap".

## Flying low is allowed. Flying low by accident is not.

Below `LOW_ALTITUDE_M` (20 m, roughly 65 ft) the panel shows a caution and both **Save** and
**Download** stop for a confirmation the operator has to answer. Re-exporting a saved low plan
from the card asks again, because the card exports without the modal ever opening.

It is not a block, and the button is not disabled. A low pass is a legitimate plan and refusing
it would be this planner overruling the person who can see the field. What it must not be is a
default someone inherits without noticing, which is what happened: a test flight at 10 m nearly
hit a tree.

The threshold is a judgement, not a regulation. Nothing in Part 107 sets a floor; the ceiling
(400 ft AGL) is the limit with a number. 20 m is where it is because that is under the mature
height of the trees that line most field edges, and under a grain leg, a pole or a span of wire.

The wording lives in `lowAltitudeCaution()` beside the threshold, so the panel, the card and the
confirmation cannot drift apart, and it takes altitudes already formatted in the operator's own
units. It names the hazards and then says what the planner does not know: no terrain model, no
obstacle data, no forward sensing. It does **not** suggest a height to fly instead, which this
planner has no basis for.

Two details that matter:

- **The acknowledgement is per action, not sticky.** Saving a low plan and exporting a file
  somebody is about to fly are different commitments, and an acknowledgement made at 19 m must
  not still be in force after the operator drops it to 5 m.
- **The caution and the waypoint ceiling are independent, and a low plan can hit both.** At 10 m
  the line spacing is 3.75 m, so anything field-sized needs thousands of waypoints against a
  limit of 200. Over a small area the plan is flyable and only the caution applies.

## Two things the planner refuses to guess

- **The waypoint ceiling.** Consumer airframes cap a route at `MAX_CONSUMER_WAYPOINTS` (200),
  and `wpml.ts` refuses past it rather than truncating, because a route that quietly drops its
  last waypoints flies a partial survey the operator believes was complete. The limit is
  surfaced on the resolved plan, so a route forty waypoints over says so in the live preview
  while the operator can still fly higher or reduce overlap, not after they press download.
- **The drone identity.** `droneEnumValue` and `droneSubEnumValue` are never guessed. DJI
  publishes them for enterprise airframes only; nothing public covers the consumer Air and Mini
  series. A wrong code is a silent rejection at import time and an absent block is not, so where
  no verified code exists the whole `droneInfo` block is omitted.

  The Air 3S carries **68 / 0**, read off a KMZ that a real Air 3S accepted, and the code is
  recorded with that provenance rather than presented as documented fact. It is attached to the
  camera entry in `camera.ts`, not applied as a global default, so choosing a different aircraft
  cannot stamp an Air 3S code onto a file meant for something else. The other two entries have
  no verified code and so emit no `droneInfo` at all.

  **To revert it**, if a flight test shows DJI Fly rejecting the file: set `DJI_AIR_3S` to
  `null` in `camera.ts`. Nothing else changes; the export falls back to omitting the block,
  which is what it did before the value existed. A single export can also force the omission by
  passing `drone: null`.

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

- **One real flight.** Nothing here has been flown. The geometry is tested against synthetic
  polygons with known answers; whether DJI Fly accepts the file and triggers the shutter where
  intended is not something a test in this repo can establish.
- **Camera specs beyond the three in the table**, each with a source.
