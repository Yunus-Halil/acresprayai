# Export formats

Every format here is open and readable by tools other than ours. A farmer's data and flight plans
leave the system in formats other software can open — this is deliberate.

| Export | File | Target |
|---|---|---|
| Treatment zones | `flight-plan-{taskId}.geojson` | Any GIS |
| Flight mission | `mission-{taskId}.waypoints` | Mission Planner / QGroundControl |
| DJI Agras package | `dji-agras-{taskId}.zip` | Agras T-series via SD card |
| DJI WPML route | `mission-{taskId}.kmz` | DJI Pilot 2 |

All four are generated from the same in-memory mission model (boundary rings + zone polygons +
planner parameters). Nothing re-parses another exporter's output.

## Treatment zones — GeoJSON

Downloads as `flight-plan-{taskId}.geojson`.

A `FeatureCollection` of polygons, one per Tier 1 zone:

```jsonc
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "properties": {
      "name": "Zone 1",
      "issue": "Bare soil",
      "severity": "high",
      "coverage_pct": 2.4,
      "action": "reseed",
      "product": "…",
      "dose": "…"
    },
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[lng, lat], …, [lng, lat]]]   // ring closed
    }
  }]
}
```

Coordinates are GeoJSON order — `[longitude, latitude]` — while the internal representation is
`{lat, lng}`. The export closes the ring by repeating the first vertex.

## Flight mission — QGC WPL 110

Downloads as `mission-{taskId}.waypoints`. Tab-separated Mission Planner format.

Line 1 is the header `QGC WPL 110`. Index 0 is the home row, flagged current. Actions are encoded
with MAVLink-equivalent commands so Mission Planner and DJI converters preserve them rather than
flattening everything to plain waypoints.

| Cmd | MAVLink | Used for |
|---|---|---|
| 22 | `NAV_TAKEOFF` | Launch |
| 16 | `NAV_WAYPOINT` | Transit and spray waypoints |
| 178 | `DO_CHANGE_SPEED` | Speed transitions (param 2 = m/s) |
| 183 | `DO_SET_SERVO` | Sprayer on/off — servo channel 8, PWM 2000 on / 1000 off |
| 20 | `NAV_RETURN_TO_LAUNCH` | Return home |
| 21 | `NAV_LAND` | Landing |

### Row format

```
{idx}\t{current}\t{frame}\t{cmd}\t{p1}\t{p2}\t{p3}\t{p4}\t{lat}\t{lng}\t{alt}\t1
```

- `frame` is 3 (relative altitude) for every row except home, which is 0
- Coordinates are written at **8 decimal places** — roughly 1 mm
- Params are written at 2 decimal places

### Sprayer control

The sprayer is assumed to be on **servo channel 8**. `DO_SET_SERVO` with PWM 2000 opens it and
1000 closes it. If a given airframe wires its pump elsewhere, this is the constant to change —
`SPRAY_SERVO` in `src/lib/mission.ts`.

## Application rate — the one number that is not derivable

The `.waypoints` export carries a **binary pump state**, not a dose: `DO_SET_SERVO` PWM 2000/1000
is open/closed. Nothing in the AI analysis is a numeric rate either — `recommendation.dose` is
prose written for a human to read.

So the DJI prescription raster is driven by `settings.spray_rates_lha`, three operator-owned L/ha
numbers keyed by zone severity, with optional per-zone pins in `settings.zone_rate_overrides`.
`resolveZoneRateLha()` in `src/lib/farmerSettings.ts` is the single resolver both the planner UI
and the exporter call, so what the farmer sees is what gets burned into the raster.

## DJI Agras package — `dji-agras-{taskId}.zip`

Unzips to the layout the Agras controller reads off an SD card:

```
DJI/
├── Shapefile/  field_boundary.shp .shx .dbf .prj
└── Rx/         spot_treatment.tif .tfw
```

The **shapefile carries the boundary**; the **rate lives in the raster**. That split is confirmed
by DJI's own SmartFarm guidance and independently by PIX4Dfields and Agremo, who ship into the
same pathway.

- Boundary: one polygon feature per boundary ring, outer rings wound clockwise and explicitly
  closed. A counter-clockwise outer ring reads as a *hole*, which imports as an empty field with
  no error.
- Rx raster: single-band float32, uncompressed, north-up, EPSG:4326. Pixel values are L/ha and
  `0` means *do not spray*. Cells take a rate only where the pixel centre is inside both a zone
  and the boundary; overlapping zones resolve to the higher rate.
- Resolution targets 1 m/px, coarsened automatically to stay under DJI's 10 MB prescription cap.
- Georeferencing is written twice on purpose: GeoTIFF `ModelTiepointTag` (outer corner of the
  top-left pixel) and the `.tfw` (**centre** of that same pixel). The half-pixel difference
  between those two conventions is deliberate, not a bug.

Import on the controller with **Map Source = "Other"** and **Source Unit = "ha"** regardless of
what units you authored in.

### What DJI does not publish

DJI documents the folder layout and the import settings but **not** a `.dbf` attribute schema and
**not** the raster's bit depth. Two consequences:

- The attribute table is deliberately minimal and self-describing (`ID`, `TYPE`, `AREA_HA`) rather
  than a guess at internal column names. A reader that ignores our columns still gets valid
  geometry, which is the part it actually reads. Field names circulating online as a required
  `ID`/`VRA_Rate`/`Type` schema could not be corroborated against any DJI source.
- Single-band numeric is a strong inference — the controller asks for a *unit* and offers
  *Average* resampling, neither of which means anything over a legend-mapped RGB image — but
  float32 vs. scaled integer is unverified. `RX_BASENAME` and `writeGeoTiffFloat32` in
  `src/lib/djiAgras.ts` are the two places to change if hardware testing disagrees.

## DJI WPML route — `mission-{taskId}.kmz`

A zip with `wpmz/template.kml` and `wpmz/waylines.wpml` at the archive root — no wrapping folder,
and no standalone `wpmz/` directory entry. Namespaces and element names follow DJI's published
WPML reference (`dji-sdk/Cloud-API-Doc`, `docs/en/60.api-reference/00.dji-wpml/`):

```xml
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
```

Not the bare `http://opengis.net` / `http://dji.com` forms that circulate in third-party
skeletons, and it is `wpml:missionConfig` / `flyToWaylineMode` / `exitOnRCLost` /
`globalTransitionalSpeed` — not `MissionConfig` / `flyToMode` / `exitOnGpsLost` /
`executeRtkSpeed`. Those wrong names are asserted *against* in the tests.

Payload commands are dropped (a camera drone has no pump) and co-located points collapse, so the
waypoint count is lower than the `.waypoints` row count. `executeHeightMode` is
`relativeToStartPoint` to match the planner's AGL altitudes — `EGM96` would fly the route at
height above the geoid instead.

Missions over **200 waypoints throw `WaypointLimitError`** rather than truncating; the planner
disables the button and shows the count before you click.

**Unverified:** WPML is documented as a DJI Pilot 2 / enterprise pathway. We could not confirm
that consumer DJI Fly aircraft (Mini / Air / non-enterprise Mavic) ingest `.kmz` waypoint files at
all. `droneInfo` is emitted only when a caller supplies the enum values, since we have no
authoritative table for consumer airframes.

## Testing

`src/test/mission.test.ts` asserts the `.waypoints` serialiser directly: header, consecutive
indexing, exactly one takeoff / RTH / land, servo rows carrying channel 8 with valid PWM, speed
rows carrying the configured speed, and the coordinate decimal precision.

`src/test/djiExport.test.ts` covers the binary formats by **round-tripping them**, not by checking
files exist. The shapefile and GeoTIFF are re-parsed by readers in the same modules and asserted
on: enclosed area survives to within a rounding error, ring winding is clockwise, the raster
covers the boundary extent, EPSG:4326 is declared in the GeoKeyDirectory, the `.tfw` sits half a
pixel off the tiepoint, and burned rates match the source zones. `buildAgrasPackage` runs the same
verification at export time and throws rather than handing over a package that would fail
silently on the aircraft.

If you change a format, those tests are the specification.
