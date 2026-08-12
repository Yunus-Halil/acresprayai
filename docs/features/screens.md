# Screens and routes

| Route | Screen | What the user does |
|---|---|---|
| `/` | Landing page | Marketing sections plus a waitlist email capture writing to `pilot_signups` |
| `/auth` | Sign in / sign up | Email+password or Google |
| `/app` | Operations dashboard | KPI row and field list |
| `/app/fields` | Fields | Create, rename inline, delete fields |
| `/app/fields/:id` | Field detail | Upload images, watch progress, browse and recover scans |
| `/app/fleet` | Drone fleet | Register drones, view endurance forecast |
| `/app/weather` | Weather radar | Saved locations, current conditions, 7-day outlook |
| `/app/orthomosaic/:taskId` | Workspace | Everything else — see [workspace.md](workspace.md) |

`/app/*` routes render inside `AppLayout`, which holds the sidebar and the auth guard. The
workspace deliberately sits outside that shell and opens full-screen in a new tab.

## Dashboard — `/app`

Four KPI cards: total fields, total area (ha and acres), boundaries defined, spray logs recorded.

Below, a field list with a status dot, real measured area, flights logged, last flown date, and a
boundary-set badge. Fields with no boundary are visually distinct because boundary is the gate
for AI analysis.

## Fields — `/app/fields`

Grid of field cards. Inline rename via a pencil affordance on hover. Delete confirms first,
because it cascades to every scan.

Creating a field asks only for name, location and notes — crop and size come later, since size is
*measured* from the drawn boundary rather than typed.

Empty state walks a new user into creating their first field.

## Field detail — `/app/fields/:id`

The upload and monitoring screen.

- **Upload card** — file picker, GPS pre-flight check, progress, pause control, and a resume
  banner when an interrupted upload has saved progress
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
