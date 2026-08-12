# Stack and layout

## Runtime shape

A single-page React app talks to Supabase for data and auth, and to Supabase Edge Functions
(Deno) for anything requiring a secret. The browser never holds a credential for OpenDroneMap,
the AI gateway, or the weather provider.

```
Browser (React SPA)
  │
  ├─ supabase-js ──────────► Postgres + PostGIS   (RLS-enforced, per-user)
  │                          Auth (JWT)
  │                          Storage (private buckets, signed URLs)
  │
  └─ fetch ────────────────► Supabase Edge Functions (Deno)
                               │
                               ├─► OpenDroneMap node   (photogrammetry)
                               ├─► titiler.xyz         (COG → tiles / stats / preview)
                               ├─► ai.gateway.lovable.dev  (Gemini 2.5 Flash vision)
                               └─► OpenWeather → Open-Meteo fallback
```

## Dependencies of note

| Package | Used for |
|---|---|
| `leaflet`, `react-leaflet` | All mapping |
| `@geoman-io/leaflet-geoman-free` | Boundary and polygon drawing |
| `@turf/area`, `@turf/helpers` | Geodesic area in reporting |
| `fflate` | Streaming zip extraction in the browser |
| `piexifjs` | Reading and re-injecting EXIF (GPS) during image downscaling |
| `jspdf`, `html2canvas` | Client-side PDF report generation |
| `geotiff` | GeoTIFF handling |
| `three`, `@react-three/fiber`, `@react-three/drei` | Present in the dependency tree; **no 3D viewer is currently wired up** |
| `recharts` | Fleet endurance chart |
| `zod` | Form validation |

## External services

| Service | Purpose | Failure impact |
|---|---|---|
| **OpenDroneMap node** | Photogrammetry. Configured by `ODM_BASE_URL` + `ODM_AUTH_TOKEN`. Either self-hosted NodeODM or WebODM Lightning. | No new scans can be processed. Existing scans unaffected. |
| **titiler.xyz** | Renders the GeoTIFF into tiles, previews and zonal statistics. Public, free, not operated by us. | **Every map in the product breaks simultaneously.** See [operations/limits.md](../operations/limits.md). |
| **ai.gateway.lovable.dev** | Gemini 2.5 Flash vision. `LOVABLE_API_KEY`. | AI analysis unavailable; everything else works. |
| **OpenWeather / Open-Meteo** | Forecast. `OPENWEATHER_API_KEY` optional — Open-Meteo needs no key and is the automatic fallback. | Weather tab empty; planner loses wind/temperature derating. |

## Repository layout

```
src/
├── pages/
│   ├── Index.tsx                 marketing landing page
│   ├── Auth.tsx                  sign in / sign up
│   ├── NotFound.tsx
│   └── app/
│       ├── Dashboard.tsx         operations dashboard
│       ├── Fields.tsx            field list
│       ├── FieldDetail.tsx       upload + scan history
│       ├── Fleet.tsx             drone registry + endurance forecast
│       ├── Weather.tsx           standalone weather screen
│       └── OrthomosaicViewer.tsx the workspace shell (~950 lines)
├── lib/
│   ├── geo.ts                    pure geodesy (no React, no Leaflet)
│   ├── mission.ts                sweep generation, mission assembly, QGC output
│   ├── droneSpecs.ts             single source of truth for drone capabilities
│   ├── farmerSettings.ts         per-field config types, defaults, migration
│   ├── scanUpload.ts             resumable, fault-tolerant image upload
│   ├── imagePrep.ts              downscaling with EXIF/GPS preservation
│   ├── ndvi.ts                   vegetation index helpers
│   ├── auth.tsx                  AuthProvider / useAuth
│   └── utils.ts
├── components/
│   ├── app/                      AppLayout, ReportsTab, HistoryTab, PolygonMap, Field3D…
│   │   └── workspace/            the orthomosaic workspace, one file per tab
│   │       ├── types.ts          row shapes the shell loads
│   │       ├── constants.ts      endpoints and load-loop bounds
│   │       ├── layers.tsx        map-attached pieces: measure, annotate, AI
│   │       │                     zones, user polygons, boundary tool, controls
│   │       ├── FieldViewTab.tsx
│   │       ├── AiTab.tsx
│   │       ├── PlannerTab.tsx
│   │       ├── WeatherTab.tsx
│   │       └── SettingsTab.tsx
│   ├── site/                     landing page sections
│   └── ui/                       shadcn/Radix primitives (library code, unmodified)
├── integrations/supabase/        generated client + database types
└── test/                         80 unit tests

supabase/
├── functions/
│   ├── _shared/
│   │   ├── cors.ts
│   │   ├── net.ts                timeouts, backoff, transient classification
│   │   └── tileAuth.ts           token + ownership verification for tile endpoints
│   ├── odm-submit/               create task, stream images, commit
│   ├── odm-poll/                 advance status, mirror outputs
│   ├── odm-asset/                proxy individual ODM assets
│   ├── ortho-url/                signed GeoTIFF URL + TileJSON
│   ├── bake-tiles/               render tiles into storage
│   ├── tile/                     serve pre-baked tiles
│   ├── ndvi-tile/                render vegetation index tiles
│   ├── analyze-ortho/            the vision model call
│   └── weather/                  normalised forecast proxy
└── migrations/                   24 SQL migrations
```

## Workspace composition

`OrthomosaicViewer.tsx` was ~4,900 lines holding the map, all seven tabs, the planner UI and the
flight simulator. It is now the **shell only**: it loads the scan, drives the tile bake, and owns
the state the tabs share. Each tab lives in its own file under
`src/components/app/workspace/`, and the pure logic sits in `src/lib/*` with unit tests.

Two couplings survive the split and are load-bearing — do not "tidy" them without reading
[features/workspace.md](../features/workspace.md):

- The **Planner** reads weather from the same 20-minute `localStorage` cache the **Weather** tab
  writes. If Weather has never been opened for that location, battery estimates run without wind
  or temperature derating.
- `LogFlightModal` lives in `SettingsTab.tsx` purely because of where the file boundary fell. Its
  only consumer is the planner, which imports it.
