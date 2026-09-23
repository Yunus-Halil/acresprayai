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

Four KPI cards: total fields, total area (ha and acres), boundaries defined, spray logs recorded.

Below, a field list with a status dot, real measured area, flights logged, last flown date, and a
boundary-set badge. Fields with no boundary are visually distinct because boundary is the gate
for the treatment grid and mission planning.

## Fields — `/app/fields`

Grid of field cards. Inline rename via a pencil affordance on hover. Delete confirms first,
because it cascades to every scan.

Creating a field asks only for name, location and notes — crop and size come later, since size is
*measured* from the drawn boundary rather than typed.

Two tabs in the creation dialog, not two flows for the same thing: **Fly & upload images** is
the flow above, unchanged. **Import an orthomosaic** skips reconstruction entirely - the
operator uploads an already-finished GeoTIFF (their own, or one from a Phantom 4 Multispectral
or similar sensor), and the file's own header supplies the CRS, dimensions and bounds, so no
boundary drawing is required to start (one can still be drawn afterward in Field View to narrow
the scan area). The dialog shows exactly what it read - dimensions, GSD, CRS, band count - and
refuses plainly only if the file is not a readable TIFF or has no identifiable CRS at all -
a geographic CRS, a non-metre unit, non-square pixels and a rotated transform are all
accepted, since TiTiler reprojects any of that the same way it already handles ODM's own
orthophotos. Band order is assumed where there is one sensible answer and asked where there is
not (`bandsNeedMapping`): three bands are R, G, B in file order and four are that plus an alpha
mask, which is what OpenDroneMap itself writes, so the most ordinary orthomosaic imports without
a question. Five or more is a multispectral capture whose first three bands are not R, G and B,
and the operator must say which is which before Import unlocks. The assumption is always shown
and always overridable. See `docs/pipeline/edge-functions.md`'s `ortho-import` entry.

Empty state walks a new user into creating their first field.

## Field detail — `/app/fields/:id`

The upload and monitoring screen.

- **Add imagery card** — two tabs. *Drone images*: file picker, GPS pre-flight check, progress,
  pause control, and a resume banner when an interrupted upload has saved progress.
  *Finished orthomosaic*: the same importer the create-a-field dialog offers, pointed at this
  field, so an operator who already has a GeoTIFF does not have to make a second field to use it
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
