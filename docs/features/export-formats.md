# Export formats

Every format here is open and readable by tools other than ours. A farmer's data and flight plans
leave the system in formats other software can open — this is deliberate.

| Export | File | Target | Status |
|---|---|---|---|
| DJI Agras field + Rx | `dji-agras-{taskId}.zip` | Agras T-series via SD card | **shipping (primary)** |
| Flight mission | `mission-{taskId}.waypoints` | Mission Planner / QGroundControl | shipping |
| Treatment zones | `flight-plan-{taskId}.geojson` | Any GIS | shipping |
| DJI WPML route | `mission-{taskId}.kmz` | DJI Pilot 2 | **experimental — not offered** |

All are generated from the same in-memory mission model (boundary rings + zone polygons +
planner parameters). Nothing re-parses another exporter's output.

`src/lib/exporters.ts` is the registry. Whether a format reaches a grower is one `status` field
there, not a button somewhere in a 1400-line component — the planner renders
`userFacingExporters()` and knows nothing else about which formats exist.

## What the aircraft actually want

This is the single fact that shapes everything below, and we got it wrong initially.

**Enterprise DJI aircraft** (M30 / M300 / M350 / Mavic 3E) fly a **route** you hand them, as
WPML `.kmz`.

**Agras does not work that way.** You hand an Agras a **field** — a boundary polygon plus an
optional prescription (Rx) map — and the controller plans its own flight lines *on the aircraft*.
It accepts KML, KMZ, SHP and ZIP and decompresses them itself. There is no waypoint route to give
it. That is also why DJI's published WPML spec contains zero spray or pump vocabulary: on Agras,
the route file is not where spray lives.

So **our flight lines were never the export deliverable.** They are how we *simulate* — path
length, spray vs. transit time, battery draw, swaps needed. That simulation is the actual value,
because a grower can do it from home while DJI's own planner requires standing in the field. What
has to travel to the aircraft is the treatment plan: zones, per-zone rates, boundary.

Two consequences run through the rest of this document:

- The Agras package is the primary export. The WPML route exporter is parked (see below).
- Every time/battery figure we show is an **estimate of our pattern**, not of the lines the
  aircraft will actually fly. The UI says so; so should anything else that surfaces them.

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

Downloads as `mission-{taskId}.waypoints`. Tab-separated Mission Planner format. For ground-station
software — **an Agras cannot read this**; it wants the field package instead.

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
└── Rx/         spot_treatment.tiff .tfw
```

The **shapefile carries the boundary**; the **rate lives in the raster**. That split is confirmed
by DJI's own SmartFarm guidance and independently by PIX4Dfields and Agremo, who ship into the
same pathway.

- Boundary: one polygon feature per boundary ring, outer rings wound clockwise and explicitly
  closed. A counter-clockwise outer ring reads as a *hole*, which imports as an empty field with
  no error.
- Rx raster: single-band float32, uncompressed, north-up, EPSG:4326. Pixel values are L/ha.
  Cells take a rate only where the pixel centre is inside both a zone and the boundary;
  overlapping zones resolve to the higher rate.

### What a pixel value means

Three genuinely different states, and conflating any two is an agronomic error rather than a
formatting choice:

| Value | Meaning |
|---|---|
| NoData | Not part of the prescription. Not applicable. |
| `0` | Part of the prescription, rate zero — fly it, do not spray it. |
| `> 0` | Apply at this rate, in L/ha. |

We previously declared a NoData sentinel of `-9999` and then never wrote it, so `0` silently
carried both of the first two meanings: outside-the-field and inside-but-untreated were the same
number, and the NoData declaration was decorative. `PrescriptionFill` in `src/lib/djiAgras.ts`
now makes the choice explicit:

- **`zero-untreated` (default)** — every cell is a real rate, most of them `0`, and **no NoData
  value is declared at all**. Chosen purely on risk asymmetry: if the controller ignores
  `GDAL_NODATA`, a `-9999` cell is read as a rate, and a large negative rate is an unknown
  failure mode in the field. A `0` cell degrades to "don't spray" under every interpretation.
- **`nodata-outside`** — `-9999` outside the boundary, `0` inside the boundary but outside every
  zone, rate inside zones. Strictly more informative, and the semantically correct answer *if*
  the controller honours NoData.

**Which one DJI actually wants is untested.** Both are implemented and neither is asserted to be
correct. The writer now refuses to declare a sentinel it does not write, in either direction, so
the ambiguity cannot come back by accident. Flip the default only on hardware evidence.

### Resolution and georeferencing

- Resolution targets 1 m/px, coarsened automatically to stay under DJI's 10 MB prescription cap.
- Georeferencing is written twice on purpose: GeoTIFF `ModelTiepointTag` (outer corner of the
  top-left pixel) and the `.tfw` (**centre** of that same pixel). The half-pixel difference
  between those two conventions is deliberate, not a bug, and a test asserts it holds in both
  axes with the right sign.

### Units are a safety issue, not a formatting detail

The raster **does not describe its own unit.** The Agras operator selects one on the controller at
import time:

```
Map Source:   Other
Source unit:  ha
```

We write **L/ha**. If the operator picks something else, the import succeeds, the aircraft flies,
and the field is mis-dosed — nothing anywhere in the chain warns them.

`RX_RATE_UNIT` and `AGRAS_IMPORT_STEPS` in `src/lib/djiAgras.ts` are the single source for this
string, consumed by the export toast, the planner's amber callout above the export buttons, and
this document, so the three cannot drift apart. Treat any change to them as a safety change.

### Why `.tiff` and not `.tif`

The generic world-file rule derives the sidecar name from the first, last and trailing letters of
the raster extension, which pairs `.tiff` with `.tfwf` — sound in the abstract, and we briefly
shipped `.tif` on that basis. It was wrong. Two independent descriptions of *this* pathway (the
original DJI folder spec and PIX4Dfields, who ship into it successfully) both say `.tiff` next to
`.tfw`, and vendor importers routinely match a literal basename rather than implementing the
generic rule. `rxExtension` on `buildAgrasPackage` flips it back to `.tif` in one argument if a
captured package ever says otherwise.

### What DJI does not publish

DJI documents the folder layout and the import settings but **not** a `.dbf` attribute schema and
**not** the raster's bit depth. Two consequences:

- The attribute table is deliberately minimal and self-describing (`ID`, `TYPE`, `AREA_HA`) rather
  than a guess at internal column names. A reader that ignores our columns still gets valid
  geometry, which is the part it actually reads. Field names circulating online as a required
  `ID`/`VRA_Rate`/`Type` schema could not be corroborated against any DJI source.
- Single-band numeric is a strong inference — the controller asks for a *unit* and offers
  *Average* resampling, neither of which means anything over a legend-mapped RGB image — but
  float32 vs. scaled integer is unverified. `writeGeoTiffFloat32` in `src/lib/djiAgras.ts` is the
  place to change if hardware testing disagrees.

**Settling this is cheap.** A PIX4Dfields trial exports exactly this `DJI/Shapefile` + `DJI/Rx`
package from any field; unzipping one export answers extension naming, band count, data type and
the DBF field list at once, from a vendor whose output is known to import. DJI SmartFarm Web, or a
dealer/operator who has flown a variable-rate job, are the fallbacks. Diff the metadata against
ours byte-for-byte.

## DJI WPML route — `mission-{taskId}.kmz` — PARKED

**Experimental. Registered but not offered to growers** (`status: "experimental"` in
`src/lib/exporters.ts`). Kept and tested rather than deleted, because the file itself is correct
against DJI's spec and re-enabling it is one field if hardware evidence ever appears.

Why it is parked — two independent reasons:

1. **No confirmed delivery path to a consumer aircraft.** DJI Fly — the app Air 3S, Mini and
   non-enterprise Mavic use — ships no route-import function at all. The known workarounds
   sideload a `.kmz` into the app's private storage, which Android 11+ scoped storage blocks. The
   file matches the spec; the way to get it onto the aircraft does not exist.
2. **Agras cannot use it either.** An Agras wants a field, not a route. See above.

Do not re-register it without evidence from real hardware.

A zip with `wpmz/template.kml` and `wpmz/waylines.wpml` at the archive root — no wrapping folder,
and no standalone `wpmz/` directory entry. An optional `wpmz/res/` folder (DJI's example use is AI
Spot-Check reference photos) is emitted only when a caller supplies resources, never as an empty
directory. Namespaces and element names follow DJI's published WPML reference
(`dji-sdk/Cloud-API-Doc`, `docs/en/60.api-reference/00.dji-wpml/`):

```xml
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
```

Not the bare `http://opengis.net` / `http://dji.com` forms that circulate in third-party
skeletons, and it is `wpml:missionConfig` / `flyToWaylineMode` / `exitOnRCLost` /
`globalTransitionalSpeed` — not `MissionConfig` / `flyToMode` / `exitOnGpsLost` /
`executeRtkSpeed`. Those wrong names are asserted *against* in the tests.

The output tracks DJI's published examples closely, including three things that look like
omissions and are not:

- `waylines.wpml` carries only `missionConfig` and `Folder` under `Document`. The
  author/createTime block lives in `template.kml`, which is the document a human edits.
- `Folder` children are ordered `templateId`, `executeHeightMode`, `waylineId`,
  `autoFlightSpeed` — DJI's order, since schema validation can be order-sensitive.
- No `useStraightLine`. It is required only for certain turn modes, and DJI's example omits it
  alongside `toPointAndStopWithDiscontinuityCurvature`, where the aircraft stops at each point and
  there is no curve to straighten.

**No spray vocabulary, deliberately.** Both of DJI's published WPML examples are camera/survey
missions — gimbal rotation and `takePhoto` on an M30-class airframe. Neither documents a single
agriculture actuator: no pump rate, no spray on/off, no spreader. So this exporter emits pure
navigation. Inventing plausible `wpml:` spray tags would produce a file that looks right and does
nothing. On Agras the rate travels in the prescription raster instead, which is consistent with
that silence. A test asserts no spray/pump/spreader/dosage strings appear in either document.

Payload commands are therefore dropped (a camera drone has no pump) and co-located points
collapse, so the waypoint count is lower than the `.waypoints` row count. `executeHeightMode` is
`relativeToStartPoint` to match the planner's AGL altitudes — DJI's example shows `WGS84`, but
that is a documented alternative and using it would fly the route at height above the ellipsoid
instead.

`droneInfo` and `payloadInfo` are emitted only when a caller supplies the enum values. DJI's
examples carry both, but the values are per-airframe and we have no authoritative table for
consumer models — a wrong enum is worse than an absent one.

Missions over **200 waypoints throw `WaypointLimitError`** rather than truncating; the planner
disables the button and shows the count before you click.

## Still unverified — flag, do not resolve by inference

Three open questions. None should be hardened into an assertion until a real package settles it:

1. **Rx raster bit depth** — float32 vs. scaled integer. The "Source unit: ha" prompt implies a
   numeric single band rather than an RGB legend, which supports single-band, but not the type.
2. **The boundary shapefile DBF schema** — no published spec found anywhere.
3. **Whether current T40/T50 firmware can *also* ingest a full route** rather than only a
   boundary. The one forum source found concerned an older MG-1P and does not settle current
   behaviour.

All three are answered at once by obtaining one real, known-good Agras Rx package and diffing it
against our output on: file extensions, band count, data type, CRS declaration, DBF field list.
Cheapest route is a **PIX4Dfields trial**, which exports exactly this `DJI/Shapefile` + `DJI/Rx`
structure. Fallbacks: DJI SmartFarm Web, or a dealer/operator who has flown a variable-rate job.

Sources for everything above: DJI's `dji-sdk/Cloud-API-Doc` repo
([overview](https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/60.api-reference/00.dji-wpml/10.overview.md),
[template.kml](https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/60.api-reference/00.dji-wpml/20.template-kml.md),
[waylines.wpml](https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/60.api-reference/00.dji-wpml/30.waylines-wpml.md)),
[PIX4Dfields' Agras export guide](https://support.pix4d.com/hc/en-us/articles/360019956578), and the
[DJI SmartFarm Web user guide](https://support.dji.com/help/content?customId=01700009100&spaceId=17&re=US&lang=en).

## Testing

`src/test/mission.test.ts` asserts the `.waypoints` serialiser directly: header, consecutive
indexing, exactly one takeoff / RTH / land, servo rows carrying channel 8 with valid PWM, speed
rows carrying the configured speed, and the coordinate decimal precision.

`src/test/djiExport.test.ts` also asserts the registry's shape: that the Agras package leads, that
the WPML exporter stays registered-but-unlisted, and that anything not shipping carries a written
reason. Those tests are what stop the descope quietly reversing.

The same file covers the binary formats by **round-tripping them**, not by checking files exist. The shapefile and GeoTIFF are re-parsed by readers in the same modules and asserted
on: enclosed area survives to within a rounding error, ring winding is clockwise, the raster
covers the boundary extent, EPSG:4326 is declared in the GeoKeyDirectory, the `.tfw` sits half a
pixel off the tiepoint, and burned rates match the source zones. `buildAgrasPackage` runs the same
verification at export time and throws rather than handing over a package that would fail
silently on the aircraft.

If you change a format, those tests are the specification.
