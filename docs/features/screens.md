# Screens and routes

| Route | Screen | What the user does |
|---|---|---|
| `/` | Landing page | Marketing sections, ending in the pilot call to action |
| `/apply` | Pilot application | The detailed application form — see [pilot-applications.md](pilot-applications.md) |
| `/auth` | Sign in / sign up | Email+password or Google |
| `/admin/pilot-applications` | Pilot pipeline | Every application, newest first. Signed in **and** on the admin allowlist |
| `/app` | Operations dashboard | KPI row and field list |
| `/app/fields` | Fields | Create, rename inline, delete fields |
| `/app/fields/:id` | Field detail | Add imagery (drone images or a finished orthomosaic), watch progress, browse and recover scans |
| `/app/fleet` | Drone fleet | Register drones, view endurance forecast |
| `/app/weather` | Weather radar | Saved locations, current conditions, 7-day outlook |
| `/app/weeds` | Weed Library | Developer mode: the state weed reference catalog, its sources and review queue. See [weed-catalog.md](weed-catalog.md) |
| `/app/orthomosaic/:taskId` | Workspace | Everything else — see [workspace.md](workspace.md) |

`/app/*` routes render inside `AppLayout`, which holds the sidebar and wraps its shell in
`RequireAuth`. `/admin/pilot-applications` uses the same `RequireAuth` guard directly — but
note that guard only proves someone is signed in; the allowlist that actually protects
applicants is enforced server-side by the `pilot-applications` function. The
workspace deliberately sits outside that shell and opens full-screen in a new tab.

## Dashboard — `/app`

Four cards, each a link to where the work is done: **Total fields** with the boundary split in
its subtitle, **Weed-affected area**, **Missions ready**, **Spray logs**. Total area and
Boundaries defined used to hold two of those places and were both restatements of Total fields;
they are replaced by the two questions an operator opens this screen with, which are what the
last scan found and what is waiting to be flown.

**Weed-affected area** totals the operator's own saved findings, **one scan per field**. A field
flown in June and again in August has two sets of annotations over one piece of ground; summing
both would roughly double the headline and would grow every time somebody re-flew a field they
had already dealt with. The scan chosen is the most recent one that actually has findings, so a
scan uploaded this morning and not yet reviewed cannot erase last week's result. What counts as a
weed is `isWeedPoly` from `treatment/groups.ts`, imported rather than restated, so a wet corner
and a rock pile stay out of the total and this card cannot disagree with the screen it links to.
It is the area found, **not the treated area**: the planner clips zones to the boundary and
insets a headland before it prices anything, and it recomputes rather than trusting the stored
figure.

**Missions ready** counts scheduled missions still ahead. A mission row exists only once the
planner produced its stats and the operator saved it, so the row is the evidence that planning
finished; an unfinished plan never becomes one. There is no completed status, because nothing
writes one and completion is recorded separately as a `flight_logs` entry, so a mission whose
slot has passed is treated as done. That last part is a judgement and it can be wrong in one
direction: a mission rained off on Tuesday stops being counted though it still needs flying. The
alternative, counting it forever, would grow a number that only ever goes up.

All four share one `Stat` component, which is what stops them drifting into four subtitle voices.
A dash is the empty state for both "nothing found" and "could not read", with the subtitle
carrying the difference: a zero in that position would be a claim neither case has earned. The
page re-reads on focus, because it is the screen people come back to after doing the work
somewhere else.

Below, a field list with a status dot, real measured area, its location, flights logged, last
flown date, and a boundary-set badge. Fields with no boundary are visually distinct because
boundary is the gate for the treatment grid and mission planning.

## Fields — `/app/fields`

Grid of field cards. Inline rename via a pencil affordance on hover. Delete confirms first,
because it cascades to every scan.

Creating a field asks only for name, location and notes — crop and size come later, since size is
*measured* from the drawn boundary rather than typed.

The dialog asks one question and offers one button. It used to carry a two-tab switcher for
choosing between flying the field and importing a finished orthomosaic, which asked the operator
to decide how imagery would arrive before the field they were creating even existed. That choice
belongs on the field page's step 2, where imagery is actually added, and it lives there. See the
Add imagery card below.

Each card shows where the field is. A field mapped to the metre used to say "No location set",
which was absurd: the app knew exactly where it was and could not say so. The boundary's centre
is reverse-geocoded through Nominatim, the provider the flight planner's address search already
uses, and the answer is persisted on the field.

**Two locations, stored apart, and the order between them never varies.** `fields.location` is
the operator's own text and nothing in the app overwrites it; `fields.derived_location` is what
the boundary geocodes to. The card shows the operator's words when there are any, the derived
label otherwise, and clearing the box brings the derived label back, which is the only way to
undo an override. Editing either one never touches the geometry.

**The label is a locality and a state, never a street address.** Reverse-geocoding the middle of
a field returns the nearest addressable thing, which is a neighbour's house: "1164 Millwood Pond
Dr" for a hundred acres of corn is not a location. A road name is kept when the provider gives
one, as secondary detail; a house number is discarded.

**It is asked once.** A field is sent to the geocoder only when it has no operator text, has
somewhere to ask about, and its boundary centre has moved more than `RELOCATE_THRESHOLD_M`
(100 m) since the last answer. Requests are serialised a second apart, which is Nominatim's
stated limit and a condition of use rather than a tuning knob, and each answer is written as it
arrives so navigating away keeps what was learned. A failure writes nothing, leaves the geometry
untouched, and the operator can type a location themselves. The geocoder is called from the
Fields page only; every other screen reads the stored answer.

Where there is no boundary, the centre of an orthomosaic's bounds is used instead: that imagery
was flown over this field and its extent came from the aircraft's own GPS. Per-image EXIF GPS is
not a third fallback because nothing in the database persists it.

Empty state walks a new user into creating their first field.

## Field detail — `/app/fields/:id`

The upload and monitoring screen.

- **Create flight plan card (step 1)** — plan the survey flight before anything has been flown: draw or reuse the boundary, set altitude and overlap, preview the route and its photo count, save it, export a DJI KMZ. See [flight-planning.md](flight-planning.md)
- **Add imagery card (step 2)** — two tabs. *Drone images*: file picker, GPS pre-flight check, progress,
  pause control, and a resume banner when an interrupted upload has saved progress.
  *Finished orthomosaic*: **the only place the importer lives.** It skips reconstruction
  entirely - the operator uploads an already-finished GeoTIFF (their own, or one from a Phantom 4
  Multispectral or similar sensor), and the file's own header supplies the CRS, dimensions and
  bounds, so no boundary drawing is required to start; one can still be drawn afterward in Field
  View to narrow the scan area. The card shows exactly what it read - dimensions, GSD, CRS, band
  count - and refuses plainly only if the file is not a readable TIFF or has no identifiable CRS
  at all; a geographic CRS, a non-metre unit, non-square pixels and a rotated transform are all
  accepted, since TiTiler reprojects any of that the same way it already handles ODM's own
  orthophotos. Band order is assumed where there is one sensible answer and asked where there is
  not (`bandsNeedMapping`): three bands are R, G, B in file order and four are that plus an alpha
  mask, which is what OpenDroneMap itself writes, so the most ordinary orthomosaic imports
  without a question. Five or more is a multispectral capture whose first three bands are not R,
  G and B, and the operator must say which is which before Import unlocks. The assumption is
  always shown and always overridable. See `docs/pipeline/edge-functions.md`'s `ortho-import`
  entry
- **Stat row** — total scans, in progress, orthomosaics ready
- **Scan history** — one card per scan with status, progress, and per-status controls:

| Scan status | Controls |
|---|---|
| `uploading` | — (resume happens through the upload card) |
| `queued` / `processing` / `mirroring` | Check now |
| `completed` | View orthomosaic · Download archive |
| `failed` | Retry · Remove |

Failed scans explain that retrying resumes rather than restarting.

## Drone fleet — `/app/fleet`

Register a drone by call sign and model; manufacturer specs auto-fill read-only from the shared
spec table. Battery is the only value that changes per flight.

The forecast panel shows a 60-minute battery depletion curve with a recall marker at the 25%
safety threshold. **This is a linear extrapolation from the typed battery value, not telemetry** —
nothing connects to a real aircraft.

The drain rate is derived from the same `max_flight_min` the mission planner budgets against, so
the two always describe the same aircraft.

## Weather radar — `/app/weather`

Standalone forecast screen with saved locations, place search, current conditions and a 7-day
outlook.

Forecasts come from the shared client in `src/lib/weather.ts`, which routes through the `weather`
edge function and shares its 20-minute cache with the workspace Weather tab and the flight
planner. The edge function answers in metric; this screen converts to imperial for display.
