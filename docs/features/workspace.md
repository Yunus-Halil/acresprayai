# The orthomosaic workspace

`/app/orthomosaic/:taskId` — a dark, full-screen, tabbed environment built around a Leaflet map.
Tabs open on demand (Ctrl/Cmd+T opens the tab menu) and each keeps its own state.

This is where the farmer spends their time.

## Load sequence

1. Resolve the session; fetch the `odm_tasks` row and its field
2. Rehydrate any saved AI analysis so zones survive a reload
3. Call `ortho-url` for a signed GeoTIFF URL and TileJSON
4. Validate the bounds are WGS84
5. Drive `bake-tiles` to completion, showing a progress count
6. Point Leaflet at the pre-baked tile template

Steps 3 and 5 are bounded and retryable — see [pipeline/resilience.md](../pipeline/resilience.md).
Any terminal error renders a message with a **Try again** control rather than a dead end.

## Field view — the map

### Layers

Each independently toggleable:

| Layer | Contents |
|---|---|
| Orthomosaic | The pre-baked tiles |
| NDVI / VARI | Vegetation-index overlay. The legend names which index is actually in use and the **spectral** band count behind it — see the note below |
| Boundary | The field outline |
| AI zones | Treatment polygons, colour-coded by severity, labelled with real acreage and estimated cost |
| Manual annotations | Farmer-drawn polygons |
| Freehand annotations | Pen and text markup |
| Measurements | The measure tool's output |

### Tools

- **Boundary tool** — draw and edit the field outline using Geoman. Supports multiple rings, so a
  field split by a road or a wood is one field with several parts. Saving computes true geodesic
  area and writes both `boundary` and `boundary_area_hectares`.
- **Measure tool** — click a path for running distance; close it for area. Shows live distance to
  the cursor.
- **Annotation tool** — freehand pen and text labels with colour and width. Stored per scan in
  `localStorage`.
- **Polygon tool** — draw a treatment zone by hand, then name it, classify the issue, colour it
  and add notes. Persisted to `user_annotations` and fed to the planner exactly like an AI zone.
- **Zone editing** — AI zone vertices are draggable. The farmer can correct the model's outline
  and the area and cost recompute live.

That last point matters: the model proposes, the farmer decides, and the numbers follow the
farmer.

## The seven tabs

| Tab | Purpose |
|---|---|
| **Field** | The map and all drawing tools. Default tab. |
| **Weather** | Forecast for the field's centre. Caches for 20 minutes in `localStorage`; the planner reads that same cache for wind and temperature. |
| **AI** | Runs the analysis; shows health score, summary, per-zone findings with confidence and recommended action, the Tier 2 watch list, the NDVI grid readout, and the disclaimer. Zones can be deleted individually. |
| **Planner** | Mission generation, physics validation, battery estimation, flight simulation. See [mission-planner.md](mission-planner.md). |
| **Reports** | PDF generation and the archive of previous reports. See [cost-and-reports.md](cost-and-reports.md). |
| **History** | Every scan for this field as a card with mini-map, zone count and stressed acreage. Select two for a draggable swipe comparison and a percentage change in stressed area. |
| **Settings** | Crop type, planting and harvest dates, unit system, per-acre input costs, which inputs the farmer actually has, up to three custom inputs, drone selection and tank load. |

### Why the index label matters

ODM writes `odm_orthophoto.tif` as **RGBA** for ordinary RGB drone imagery, so a
naive band count reports 4 and looks multispectral. Computing NDVI from that gives
`(alpha − red)/(alpha + red)` — alpha is constant inside the footprint, so the result
is a smooth function of red painted with a red-yellow-green colormap. It resembles
NDVI and means nothing.

`supabase/functions/_shared/bands.ts` therefore counts only **spectral** bands, using
GDAL's `colorinterp` to exclude alpha, and under-claims when the evidence is ambiguous.
The legend shows the spectral count with `+α` when an alpha mask is present, and says
"VARI, not NDVI" whenever the overlay is the visible-light proxy.

## Coupling to know about

- The **Planner** reads weather from the `localStorage` cache the **Weather** tab writes. If the
  Weather tab has never been opened for that location, battery estimates run without wind or
  temperature derating. This is a real coupling, not a designed dependency.
- The **Reports** tab briefly switches the workspace to Field view to screenshot the map for the
  PDF, then switches back. A module-level `Set` guards against re-triggering during that flip.
- **Settings** writes to `fields.settings`, so it applies to every scan of that field, not just
  the one being viewed.
